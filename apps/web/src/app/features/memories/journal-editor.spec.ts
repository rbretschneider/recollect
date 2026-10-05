import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regression cover for the journal box that cut your writing off.
 *
 * The field auto-grows to fit what you have written. It only exists while edit
 * mode is on, and edit mode always starts off — so the one call that sized it
 * ran during load(), against a textarea that was not in the DOM yet. Tapping
 * the pencil afterwards built a four-row box that nothing ever resized, and
 * because the field had `overflow: hidden` there was no scrollbar either: a
 * long entry was cut off mid-sentence with no way to reach the rest.
 *
 * The sizing itself now runs from an effect that fires whenever the field
 * appears or its text changes. That half cannot be asserted here — jsdom
 * reports every element as zero-height, so scrollHeight-based growth is
 * invisible to it. What this pins is the backstop that makes the failure
 * non-destructive: the field must be able to scroll, so text can never again
 * become unreachable even if the sizing regresses.
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

/** Read lazily: import.meta.url only resolves to a file path once running. */
function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const styles = () => read('./memory-detail-page.scss');
const component = () => read('./memory-detail-page.ts');

describe('the journal editor can never hide what you wrote', () => {
  it('scrolls rather than clipping once it stops growing', () => {
    const textarea = blockBody(blockBody(styles(), '.journal-edit'), 'textarea');

    expect(textarea).toMatch(/overflow-y:\s*auto/);
    // `overflow: hidden` is what made the lost text unreachable.
    expect(textarea).not.toMatch(/overflow:\s*hidden/);
  });

  it('stops growing before it buries the rest of the page', () => {
    const textarea = blockBody(blockBody(styles(), '.journal-edit'), 'textarea');

    expect(textarea).toMatch(/max-height:/);
  });

  // THE REGRESSION: sizing has to react to the field appearing, not to the
  // page loading — edit mode is always off at load, so the field is not there.
  it('sizes the field from an effect rather than only during load', () => {
    const effectBody = component().slice(component().indexOf('growWhenEditorAppears'));

    expect(effectBody).toMatch(/this\.editor\(\)/);
    expect(effectBody).toMatch(/autoGrow/);
    // load() must no longer be the thing that sizes it.
    const load = component().slice(component().indexOf('protected async load()'));
    expect(load.slice(0, load.indexOf('private async saveJournal'))).not.toMatch(/autoGrow/);
  });
});
