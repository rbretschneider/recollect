import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The slideshow is offered twice on a story, on purpose.
 *
 * There was briefly a real duplicate — two Play buttons rendering about 250px
 * apart on a sparse page — and removing one was right. This is the opposite
 * case: after a long journal the header's button is thousands of pixels up the
 * page by the time you reach the photos, so the offer is repeated where they
 * are. The two are never on screen together, and a future reader should not
 * "fix" this one by mistaking it for the duplicate that was removed.
 *
 * The path is resolved from the test root rather than from import.meta.url,
 * which this build does not resolve to a file:// URL for every spec.
 */

function template(): string {
  return readFileSync(
    resolve(process.cwd(), 'src/app/features/share/shared-view-page.html'),
    'utf8',
  );
}

/** The markup of one `<section class="…">`, up to its closing tag. */
function section(html: string, className: string): string {
  const start = html.indexOf(`class="${className}"`);
  if (start < 0) {
    throw new Error(`No "${className}" section — was it renamed?`);
  }
  return html.slice(start, html.indexOf('</section>', start));
}

describe('the end of a story offers the slideshow again', () => {
  it('puts a play button with the photos at the end of the story', () => {
    expect(section(template(), 'more-photos')).toMatch(/play-here/);
  });

  // It belongs beside the pile, not inside the button that opens the viewer —
  // nesting it there would make tapping play open the photos instead, and
  // nests a <button> inside a <button>.
  it('keeps it a sibling of the stack rather than nested inside it', () => {
    const more = section(template(), 'more-photos');

    expect(more.indexOf('play-here')).toBeLessThan(more.indexOf('class="stack"'));
  });
});
