/** What the scanner already knows about a path from a previous scan. */
export interface KnownFileState {
  sizeBytes: number;
  fsMtimeMs: number;
}

/** What the scanner observed on disk for a path. */
export interface ObservedFileState {
  sizeBytes: number;
  fsMtimeMs: number;
}

/** The scanner's verdict for one on-disk file. */
export type ScanVerdict = 'new' | 'changed' | 'unchanged';

/**
 * Fast-path change detection (FRD story S2.3): a file is re-ingested only when
 * it is unknown or its size/mtime differ. Content hashing happens during ingest.
 */
export function classifyScannedFile(
  known: KnownFileState | undefined,
  observed: ObservedFileState,
): ScanVerdict {
  if (!known) {
    return 'new';
  }
  const isUnchanged =
    known.sizeBytes === observed.sizeBytes && known.fsMtimeMs === observed.fsMtimeMs;
  return isUnchanged ? 'unchanged' : 'changed';
}

const ALWAYS_EXCLUDED_DIRECTORY_NAMES = new Set(['@eaDir', '#recycle', '.recollect-trash']);

/** Whether a directory should be skipped entirely during a scan. */
export function isExcludedDirectory(name: string, extraExcludes: readonly string[]): boolean {
  if (name.startsWith('.')) {
    return true;
  }
  if (ALWAYS_EXCLUDED_DIRECTORY_NAMES.has(name)) {
    return true;
  }
  return extraExcludes.includes(name);
}
