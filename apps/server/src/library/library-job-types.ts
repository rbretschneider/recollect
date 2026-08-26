/** Job type: walk a library root and enqueue ingest work. */
export const SCAN_ROOT_JOB = 'scan_root';

/** Job type: hash, extract metadata, and thumbnail one file. */
export const INGEST_FILE_JOB = 'ingest_file';

/** Background transcode priority: last productive work — after ingest (100)
 *  and ML (140); an opened video upgrades its job to user priority anyway. */
export const TRANSCODE_BACKGROUND_PRIORITY = 190;
