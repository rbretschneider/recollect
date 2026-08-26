/** Job type: walk a library root and enqueue ingest work. */
export const SCAN_ROOT_JOB = 'scan_root';

/** Job type: hash, extract metadata, and thumbnail one file. */
export const INGEST_FILE_JOB = 'ingest_file';

/** Background transcode priority: after ingest (100), before purge (250). */
export const TRANSCODE_BACKGROUND_PRIORITY = 150;
