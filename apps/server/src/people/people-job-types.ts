/** Job type: detect + cluster faces for one asset. */
export const DETECT_FACES_JOB = 'detect_faces';

/** Job type: CLIP-embed one asset for semantic search. */
export const EMBED_CLIP_JOB = 'embed_clip';

/**
 * ML runs after ingest but BEFORE background video transcodes: faces and
 * search results are worth seeing; pre-transcoding old videos is purely
 * opportunistic (opening one jumps it to user priority anyway).
 */
export const ML_JOB_PRIORITY = 140;
