import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regression cover for the selection bar's buttons rendering bare.
 *
 * The bar started out owning its three buttons, so component-scoped styles
 * dressed them. It then became a shell — each page projects its own verbs into
 * it, because the timeline files and trashes, search files only, and a memory
 * captions and removes.
 *
 * That broke the styling everywhere at once. With emulated encapsulation,
 * projected content keeps the HOST page's `_ngcontent` attribute, not the
 * shell's, so rules written in selection-bar.scss stopped matching the very
 * buttons they were written for. The bar kept its panel and the buttons inside
 * it turned into browser defaults, on three pages simultaneously.
 *
 * The appearance therefore has to live in the global stylesheet. These
 * assertions pin that, because the failure mode is silent: nothing errors,
 * nothing fails to build, the page just looks wrong.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const globalStyles = () => read('../../styles.scss');
const barStyles = () => read('./selection-bar.scss');
const barComponent = () => read('./selection-bar.ts');

describe('the selection bar dresses buttons it does not own', () => {
  // THE REGRESSION: these rules were component-scoped and matched nothing.
  it('styles .action-bar buttons from the global stylesheet', () => {
    const css = globalStyles();
    const bar = css.slice(css.indexOf('.action-bar {'));

    expect(css).toMatch(/\.action-bar\s*\{/);
    expect(bar).toMatch(/button\s*\{/);
    expect(bar).toMatch(/min-height:/);
  });

  it('keeps the destructive variant global too, since it is projected as well', () => {
    const css = globalStyles();
    const bar = css.slice(css.indexOf('.action-bar {'));

    expect(bar.slice(0, bar.indexOf('\n}\n'))).toMatch(/\.danger/);
  });

  // If the component ever reclaims the button styles, they silently stop
  // applying again — so its own stylesheet must not describe their appearance.
  it('does not try to style projected buttons from the component stylesheet', () => {
    expect(barStyles()).not.toMatch(/button\s*\{/);
  });

  it('is a shell that projects whatever verbs a page gives it', () => {
    expect(barComponent()).toMatch(/<ng-content\s*\/>/);
  });
});
