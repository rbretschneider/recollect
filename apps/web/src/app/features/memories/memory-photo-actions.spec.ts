import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Cover for the memory page's one grid and its verbs.
 *
 * The page carried two grids that looked identical and behaved differently:
 * read mode opened a photo, edit mode selected it for a caption. Which one you
 * were touching depended on invisible state — and because the edit grid's tap
 * was already spent on captioning, there was nowhere to put "remove". For a
 * long time you simply could not take a photo out of a memory, even though the
 * server has always had DELETE /memories/:id/assets/:assetId.
 *
 * There is now one grid: tap opens, press-and-hold selects, and the verbs live
 * in the shared action bar. These assertions pin the parts that would quietly
 * rot — the wiring and the gesture — since the suite runs in jsdom and the
 * page itself needs a live route and API to render.
 */

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const template = () => read('./memory-detail-page.html');
const component = () => read('./memory-detail-page.ts');
const api = () => read('../../core/api/memories-api.service.ts');

describe('photos can be taken out of a memory', () => {
  // THE REGRESSION: the endpoint existed for months with no client calling it.
  it('has a client call for the remove endpoint', () => {
    expect(api()).toMatch(/removeAsset\s*\(/);
    expect(api()).toMatch(/delete<void>\([^)]*memories\/\$\{memoryId\}\/assets\/\$\{assetId\}/);
  });

  it('offers Remove from memory once photos are selected', () => {
    expect(template()).toMatch(/Remove from memory/);
    expect(component()).toMatch(/removeSelectedFromMemory/);
  });

  // Removing from a memory is not deleting a photo, and the confirm has to
  // say so — otherwise it reads as destructive and nobody dares tap it.
  it('confirms in terms of the memory, not the library', () => {
    const method = component().slice(component().indexOf('async removeSelectedFromMemory'));
    const body = method.slice(0, method.indexOf('endSelecting'));

    expect(body).toMatch(/confirms\.ask/);
    expect(body).toMatch(/stay in your library/i);
  });
});

describe('the memory grid speaks the same gestures as the rest of the app', () => {
  it('selects on press-and-hold rather than on a bare tap', () => {
    expect(template()).toMatch(/appLongPress/);
    expect(template()).toMatch(/\(longPress\)="onPhotoLongPress\(assetId\)"/);
    expect(template()).toMatch(/\(click\)="onPhotoClick\(assetId\)"/);
  });

  it('only lets selection start while editing, since removal is structural', () => {
    const method = component().slice(component().indexOf('onPhotoLongPress'));

    expect(method.slice(0, method.indexOf('}'))).toMatch(/editMode\.isEditing\(\)/);
  });

  // The second grid is what made the page two pages wearing one URL.
  it('no longer carries a separate edit-mode grid', () => {
    expect(template()).not.toMatch(/caption-grid/);
    expect(template()).not.toMatch(/cap-tile/);
  });
});
