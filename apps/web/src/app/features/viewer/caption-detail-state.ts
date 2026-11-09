import { AssetCaption, AssetDetail } from '../../core/api/api-models';
import { applyCaptionChange, CaptionChange } from './asset-captions';

/** Reconcile metadata requests that began before a successful caption mutation. */
export class CaptionDetailState {
  private readonly revisions = new Map<string, number>();
  private readonly saved = new Map<string, AssetCaption[]>();
  revision(id: string): number {
    return this.revisions.get(id) ?? 0;
  }
  change(detail: AssetDetail, change: CaptionChange): AssetDetail {
    const captions = applyCaptionChange(detail.captions ?? [], change);
    this.revisions.set(change.assetId, this.revision(change.assetId) + 1);
    this.saved.set(change.assetId, captions);
    return { ...detail, captions };
  }
  resolve(detail: AssetDetail, startedRevision: number): AssetDetail {
    return this.revision(detail.id) === startedRevision
      ? detail
      : { ...detail, captions: this.saved.get(detail.id) ?? detail.captions };
  }
}
