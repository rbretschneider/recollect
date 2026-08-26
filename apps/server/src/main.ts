import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig, loadAppConfig } from './config/app-config';
import { RotatingFileLogger } from './logging/rotating-file-logger';

/** Loads the nearest .env (cwd, then repo root) without overriding real env vars. */
function loadEnvironment(): void {
  for (const candidate of ['.env', '../../.env']) {
    const path = resolve(candidate);
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return;
    }
  }
}

/** Applies SQL migrations at boot in containerized deployments (MIGRATIONS_DIR set). */
async function runMigrations(config: AppConfig): Promise<void> {
  if (!config.migrationsDir || !existsSync(config.migrationsDir)) {
    return;
  }
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await migrate(drizzle(pool), { migrationsFolder: config.migrationsDir });
    new Logger('Migrations').log('Database migrations applied.');
  } finally {
    await pool.end();
  }
}

/** Serves the built PWA with an SPA fallback when WEB_DIST_DIR is configured. */
function serveWebApp(app: NestExpressApplication, config: AppConfig): void {
  if (!config.webDistDir || !existsSync(config.webDistDir)) {
    return;
  }
  app.useStaticAssets(config.webDistDir, { maxAge: '1h', index: false });
  app.use((req: { path: string }, res: { sendFile: (p: string) => void }, next: () => void) => {
    if (req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(join(config.webDistDir, 'index.html'));
  });
}

async function bootstrap(): Promise<void> {
  loadEnvironment();
  const bootConfig = loadAppConfig();
  await runMigrations(bootConfig);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new RotatingFileLogger(join(bootConfig.appDataDir, 'logs')),
  });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  serveWebApp(app, config);
  await app.listen(config.port);
}

void bootstrap();
