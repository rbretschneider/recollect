import type { ConvertManifest } from './cleanup.service';

/** Everything the purge is allowed to know before deleting a parked original. */
export interface PurgeEvidence {
  manifest: ConvertManifest;
  /** The library root the manifest names still exists. */
  rootExists: boolean;
  /** Size of the converted file on disk, or null if it is not there. */
  convertedSizeOnDisk: number | null;
  /** The asset that currently owns the converted path in the index, if any. */
  owner: { assetId: string; status: string; playbackError: string | null } | null;
  /** Restores of this original that failed within the recent window. */
  recentFailedRestores: number;
}

/**
 * Why a parked original must be kept, or null when its replacement is proven
 * good on every count a restore would need. The rule is asymmetric on purpose:
 * every unknown is a reason to keep. Deleting is the one action here that
 * cannot be taken back, so it is the one that has to earn its evidence.
 */
export function purgeVerdict(evidence: PurgeEvidence): string | null {
  const { manifest, owner } = evidence;
  if (!evidence.rootExists) {
    return 'its library root is gone';
  }
  if (evidence.convertedSizeOnDisk === null) {
    return 'the converted file is missing from the library';
  }
  if (evidence.convertedSizeOnDisk !== manifest.convertedSizeBytes) {
    return `the converted file is ${evidence.convertedSizeOnDisk} bytes, not the ${manifest.convertedSizeBytes} the conversion produced`;
  }
  if (!owner) {
    return 'the converted file has not been indexed';
  }
  if (owner.assetId !== manifest.assetId) {
    return 'the converted file was re-indexed as a different asset';
  }
  if (owner.status !== 'active') {
    return `its asset is ${owner.status}`;
  }
  if (owner.playbackError) {
    return 'the converted video is flagged as damaged';
  }
  if (evidence.recentFailedRestores > 0) {
    return 'a restore of it failed recently';
  }
  return null;
}
