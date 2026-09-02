import { z } from 'zod';

const configSchema = z.object({
  databaseUrl: z.string().min(1),
  port: z.coerce.number().int().positive().default(8080),
  authTokenSecret: z.string().min(32),
  appDataDir: z.string().min(1).default('./data'),
  workerConcurrency: z.coerce.number().int().positive().default(2),
  clusterMaxGapHours: z.coerce.number().positive().default(3),
  clusterMaxJumpKm: z.coerce.number().positive().default(50),
  // Real-library learning: 3 produced thousands of trivial suggestions; an
  // "event" worth remembering usually has a healthier handful of photos.
  clusterMinSize: z.coerce.number().int().positive().default(7),
  trashRetentionDays: z.coerce.number().int().positive().default(7),
  scanIntervalHours: z.coerce.number().positive().default(24),
  /** CPU threads per ffmpeg transcode; keep low so playback never starves. */
  transcodeThreads: z.coerce.number().int().positive().default(2),
  /** Directory of the built web app to serve; empty disables static serving (dev). */
  webDistDir: z.string().default(''),
  /** Directory of SQL migrations to apply at boot; empty disables (dev uses drizzle-kit). */
  migrationsDir: z.string().default(''),
  /** Base URL of the ML sidecar; empty disables faces + semantic search entirely. */
  mlUrl: z.string().default(''),
  /** Cosine distance below which a face joins an existing person cluster. */
  faceClusterDistance: z.coerce.number().positive().default(0.45),
  /**
   * Detector confidence a face must clear to be ATTRIBUTED to a person. The
   * sidecar already drops non-faces below its own detection floor, but a
   * borderline detection (a pet's face, a patterned cushion, a tiny blurred
   * head in the background) can still clear it — and greedy nearest-neighbour
   * over a huge cluster will then happily snap it onto whoever has the most
   * photos. Faces below this are still stored (bbox + embedding) but left
   * unassigned, so they never pollute a person. Tune down to catch more blurry
   * real faces, up to be stricter.
   */
  faceMinClusterScore: z.coerce.number().min(0).max(1).default(0.62),
  /** Reverse-geocoding of memory locations via Nominatim; 'off' disables. */
  geocodeEnabled: z
    .string()
    .default('on')
    .transform((value) => value !== 'off'),
  /**
   * Number of reverse-proxy hops to trust for X-Forwarded-* (0 disables).
   * MUST be set (typically 1) when nginx fronts the app, or per-IP rate
   * limiting sees every visitor as the proxy and Secure cookies never engage.
   */
  trustProxyHops: z.coerce.number().int().min(0).default(0),
  /**
   * Where approved guest uploads live as originals. Point this at the NAS
   * (e.g. /library/Guest Uploads) so they're covered by the NAS backup;
   * empty falls back to APP_DATA_DIR/guest-library (the Docker volume).
   */
  guestLibraryDir: z.string().default(''),
  /** SMTP for outgoing mail (invites, notifications). Empty host = mail off. */
  smtpHost: z.string().default(''),
  smtpPort: z.coerce.number().int().positive().default(587),
  smtpUser: z.string().default(''),
  smtpPass: z.string().default(''),
  /** From header, e.g. "Recollect <you@gmail.com>". Required when host is set. */
  smtpFrom: z.string().default(''),
  /** Web Push VAPID keys; empty disables push notifications entirely. */
  vapidPublicKey: z.string().default(''),
  vapidPrivateKey: z.string().default(''),
  /** Contact URI web-push sends to push services (mailto: or https:). */
  vapidSubject: z.string().default('mailto:admin@recollect.app'),
  /** Where scheduled database backups are written (override in Settings). */
  backupDir: z.string().default(''),
  /**
   * Allows restoring a backup from the UI. Off by default: it replaces the live
   * database and restarts the server, so an operator has to opt in on purpose.
   */
  restoreEnabled: z
    .string()
    .default('')
    .transform((value) => value === '1' || value.toLowerCase() === 'true'),
  /** Comma-separated bases the library folder picker may browse (mounted volumes). */
  libraryBrowseBases: z
    .string()
    .default('/library')
    .transform((value) => value.split(',').map((base) => base.trim()).filter((base) => base.length > 0)),
});

/** Validated application configuration, loaded once from the environment at startup. */
export type AppConfig = z.infer<typeof configSchema>;

/** Injection token for {@link AppConfig}. */
export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * Parses and validates configuration from the environment.
 * Throws with a clear message when a required variable is missing or malformed.
 */
export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.safeParse({
    databaseUrl: env.DATABASE_URL,
    port: env.PORT,
    authTokenSecret: env.AUTH_TOKEN_SECRET,
    appDataDir: env.APP_DATA_DIR,
    workerConcurrency: env.WORKER_CONCURRENCY,
    clusterMaxGapHours: env.CLUSTER_MAX_GAP_HOURS,
    clusterMaxJumpKm: env.CLUSTER_MAX_JUMP_KM,
    clusterMinSize: env.CLUSTER_MIN_SIZE,
    trashRetentionDays: env.TRASH_RETENTION_DAYS,
    scanIntervalHours: env.SCAN_INTERVAL_HOURS,
    transcodeThreads: env.TRANSCODE_THREADS,
    webDistDir: env.WEB_DIST_DIR,
    migrationsDir: env.MIGRATIONS_DIR,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    guestLibraryDir: env.GUEST_LIBRARY_DIR,
    smtpHost: env.SMTP_HOST,
    smtpPort: env.SMTP_PORT,
    smtpUser: env.SMTP_USER,
    smtpPass: env.SMTP_PASS,
    smtpFrom: env.SMTP_FROM,
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    vapidPrivateKey: env.VAPID_PRIVATE_KEY,
    vapidSubject: env.VAPID_SUBJECT,
    backupDir: env.BACKUP_DIR,
    restoreEnabled: env.RESTORE_ENABLED,
    libraryBrowseBases: env.LIBRARY_BROWSE_BASES,
    mlUrl: env.RECOLLECT_ML_URL,
    faceClusterDistance: env.FACE_CLUSTER_DISTANCE,
    faceMinClusterScore: env.FACE_MIN_CLUSTER_SCORE,
    geocodeEnabled: env.RECOLLECT_GEOCODE,
  });
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return parsed.data;
}
