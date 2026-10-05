import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regression cover for the sheet that ran off the right edge of the phone.
 *
 * Opening "Add to album" with a long album title pushed the sheet's content —
 * the list AND the search box above it — about 170px past the viewport on a
 * 375px screen. <body> carries `overflow-x: clip`, so there was no scrollbar
 * either: the search box was simply gone, with no way to reach it.
 *
 * The cause is structural, not cosmetic. Both the sheet body and the album
 * list are `display: grid`, and a grid column sized `auto` can never be
 * narrower than its widest child's min-content width. One `white-space:
 * nowrap` album title is therefore enough to widen the column, and the column
 * drags every sibling — including the `width: 100%` search input — out with
 * it.
 *
 * These assert on the stylesheets rather than on geometry because the suite
 * runs in jsdom, which has no layout engine and reports every box as
 * zero-width — and because this build does not attach component CSS to the
 * test document at all, so it cannot be read back off a rendered component
 * either. Measured proof lives in the PR; this is the part that can be kept
 * honest automatically.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

/**
 * The declarations inside one SCSS block, with comments stripped so a rule
 * merely *described* in prose can never satisfy an assertion.
 */
function blockBody(scss: string, selector: string): string {
  const withoutComments = scss.replace(/\/\/[^\n]*/g, '');
  const start = withoutComments.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`No "${selector}" block found — was it renamed?`);
  }
  let depth = 0;
  for (let i = start; i < withoutComments.length; i += 1) {
    if (withoutComments[i] === '{') {
      depth += 1;
    } else if (withoutComments[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return withoutComments.slice(start, i + 1);
      }
    }
  }
  throw new Error(`Unbalanced braces in "${selector}" block.`);
}

/** `minmax(0, …)` is the floor; a bare `1fr` or `auto` reintroduces the bug. */
const FLOORED_COLUMN = /grid-template-columns:\s*minmax\(\s*0/;

describe('sheet content cannot widen the sheet', () => {
  it('floors the shared sheet body column at zero width', () => {
    const body = blockBody(read('./sheet.scss'), '.body');

    expect(body).toMatch(/display:\s*grid/);
    expect(body).toMatch(FLOORED_COLUMN);
  });

  it('floors the album picker list column at zero width', () => {
    const list = blockBody(read('./album-picker.scss'), '.list');

    expect(list).toMatch(/display:\s*grid/);
    expect(list).toMatch(FLOORED_COLUMN);
  });

  // The floor alone is not enough: a flex item still refuses to shrink below
  // its own text, so the ellipsis never engages and the row grows instead.
  it('lets a long album title shrink so it ellipsises instead of pushing', () => {
    const title = blockBody(blockBody(read('./album-picker.scss'), '.list'), '.title');

    expect(title).toMatch(/min-width:\s*0/);
    expect(title).toMatch(/text-overflow:\s*ellipsis/);
  });
});
