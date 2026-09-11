import type { ConvertManifest } from './cleanup.service';

/** Everything the purge is allowed to know before deleting a parked original. */
export interface PurgeEvidence {
  manifest: ConvertManifest;
  /** The library root the manifest names still exists. */
  rootExists: boolean;
  /** Size of the converted file on disk, or null if it is not there. */
  convertedSizeOnDisk: number | null;
  /**
   * The asset that currently owns the converted path in the index, if any,
   * with the size the library last verified for that file.
   */
  owner: { assetId: string; status: string; playbackError: string | null; indexedSizeBytes: number } | null;
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
  if (!owner) {
    return 'the converted file has not been indexed';
  }
  if (owner.assetId !== manifest.assetId) {
    return 'the converted file was re-indexed as a different asset';
  }
  // The file may legitimately have changed since the conversion wrote it: a
  // confirmed date is written into its metadata afterwards, which grows it by
  // a few KB, and the library re-verifies the size when that happens. So the
  // size on disk must match EITHER what the conversion produced OR what the
  // library last verified for this same asset. A truncated or clobbered file
  // matches neither. (Four tapes were held on exactly this false positive.)
  const size = evidence.convertedSizeOnDisk;
  if (size !== manifest.convertedSizeBytes && size !== owner.indexedSizeBytes) {
    return `the converted file is ${size} bytes, but the conversion produced ${manifest.convertedSizeBytes} and the library last saw ${owner.indexedSizeBytes}`;
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
