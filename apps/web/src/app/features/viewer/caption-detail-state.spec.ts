import { CaptionDetailState } from './caption-detail-state';
import { FIXTURE_DETAIL } from './asset-detail.fixture';

const caption = {
  id: 'entry',
  text: 'saved',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  saidByLabel: null,
  saidByPersonId: null,
};
describe('caption reconciliation', () => {
  it('patches stable identities, preserves unrelated entries and preserves metadata fields', () => {
    const state = new CaptionDetailState();
    const other = { ...caption, id: 'other', text: 'other' };
    const detail = { ...FIXTURE_DETAIL, captions: [other, caption] };
    const changed = state.change(detail, {
      assetId: detail.id,
      caption: { ...caption, text: 'edited' },
    });
    expect(changed.captions).toHaveLength(2);
    expect(changed.captions).toContainEqual(other);
    expect(changed.title).toBe(detail.title);
    expect(state.change(changed, { assetId: detail.id, deletedId: caption.id }).captions).toEqual([
      other,
    ]);
  });
  it('rejects stale caption snapshots while accepting other refreshed metadata', () => {
    const state = new CaptionDetailState(),
      revision = state.revision(FIXTURE_DETAIL.id);
    state.change(FIXTURE_DETAIL, { assetId: FIXTURE_DETAIL.id, caption });
    const updated = state.resolve({ ...FIXTURE_DETAIL, title: 'fresh' }, revision);
    expect(updated.title).toBe('fresh');
    expect(updated.captions).toEqual([caption]);
    expect(state.resolve(FIXTURE_DETAIL, state.revision(FIXTURE_DETAIL.id)).captions).toEqual([]);
  });
  it('keeps independent revision histories per photo', () => {
    const state = new CaptionDetailState();
    state.change(FIXTURE_DETAIL, { assetId: FIXTURE_DETAIL.id, caption });
    const other = { ...FIXTURE_DETAIL, id: 'other' };
    expect(state.resolve(other, 0).captions).toEqual([]);
  });
});
