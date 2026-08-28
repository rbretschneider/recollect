import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
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
  app.useStaticAssets(config.webDistDir, {
    index: false,
    setHeaders: (res, path) => {
      // Angular content-hashes its bundles; those never change under a name.
      const isHashed = /-[0-9A-Z]{8,}\.(js|css)$|\.(woff2?|webp|png|svg|ico)$/i.test(path);
      res.setHeader(
        'Cache-Control',
        isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      );
    },
  });
  app.use(
    (
      req: { path: string },
      res: { sendFile: (p: string) => void; setHeader: (k: string, v: string) => void },
      next: () => void,
    ) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      // The app shell must revalidate so deploys reach users immediately.
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(config.webDistDir, 'index.html'));
    },
  );
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
  // Behind nginx: honor X-Forwarded-For/Proto from that one hop so req.ip is
  // the real client (rate limiting) and req.secure is true (Secure cookies).
  if (config.trustProxyHops > 0) {
    app.set('trust proxy', config.trustProxyHops);
  }
  // Baseline security headers. CSP stays off at the app layer — the Angular
  // bundle needs a tuned policy, which belongs to the nginx config.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      // HSTS is meaningful only on the HTTPS host; nginx sets it there.
      strictTransportSecurity: false,
    }),
  );
  // Slow-link essential: JSON compresses 8-10x, the web bundle ~4x.
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  serveWebApp(app, config);
  await app.listen(config.port);
  // Node's 5s keep-alive default races resuming mobile clients: they reuse a
  // socket the server just closed and the request dies with a reset. Keep
  // sockets open longer than any client would idle-reuse them.
  const server = app.getHttpServer() as import('http').Server;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

void bootstrap();
