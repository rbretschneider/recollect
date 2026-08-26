import { z } from 'zod';

const configSchema = z.object({
  databaseUrl: z.string().min(1),
  port: z.coerce.number().int().positive().default(8080),
  authTokenSecret: z.string().min(32),
  appDataDir: z.string().min(1).default('./data'),
  workerConcurrency: z.coerce.number().int().positive().default(2),
  clusterMaxGapHours: z.coerce.number().positive().default(3),
  clusterMaxJumpKm: z.coerce.number().positive().default(50),
  clusterMinSize: z.coerce.number().int().positive().default(3),
  trashRetentionDays: z.coerce.number().int().positive().default(7),
  scanIntervalHours: z.coerce.number().positive().default(24),
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
  });
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
  }
  return parsed.data;
}
