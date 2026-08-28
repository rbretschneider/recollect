import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig, loadAppConfig } from './config/app-config';
import { ContributionsService } from './contributions/contributions.service';
import { SharingService } from './sharing/sharing.service';
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** The og:/twitter: block that makes a pasted link unfurl in chats and socials. */
function unfurlTags(title: string, description: string, imageUrl: string | null): string {
  const safeTitle = escapeHtml(title);
  const tags = [
    `<meta property="og:site_name" content="Recollect">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${safeTitle}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
  ];
  if (imageUrl) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(imageUrl)}">`,
      `<meta name="twitter:card" content="summary_large_image">`,
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary">`);
  }
  tags.push(`<meta name="twitter:title" content="${safeTitle}">`);
  return tags.join('');
}

/**
 * Serves the built PWA with an SPA fallback when WEB_DIST_DIR is configured.
 * Public share (/s/) and contribute (/c/) pages get server-injected og: tags —
 * link-preview bots don't run the app, so the metadata must be in the HTML.
 */
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
  // Resolved lazily so a failed lookup degrades to the plain shell, never a 500.
  const sharing = app.get(SharingService, { strict: false });
  const contributions = app.get(ContributionsService, { strict: false });
  const indexPath = join(config.webDistDir, 'index.html');
  app.use(
    (
      req: import('express').Request,
      res: import('express').Response,
      next: () => void,
    ) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      // The app shell must revalidate so deploys reach users immediately.
      res.setHeader('Cache-Control', 'no-cache');
      const shareToken = /^\/s\/([A-Za-z0-9_-]{16,})$/.exec(req.path)?.[1];
      const contributeToken = /^\/c\/([A-Za-z0-9_-]{16,})$/.exec(req.path)?.[1];
      if (!shareToken && !contributeToken) {
        res.sendFile(indexPath);
        return;
      }
      void (async () => {
        const origin = `${req.protocol}://${req.get('host') ?? ''}`;
        let tags: string | null = null;
        try {
          if (shareToken) {
            const meta = await sharing.getShareMeta(shareToken);
            if (meta) {
              tags = unfurlTags(
                meta.title,
                'Shared from our family photo home.',
                meta.coverAssetId
                  ? `${origin}/api/v1/share/${shareToken}/assets/${meta.coverAssetId}/thumb/720`
                  : null,
              );
            }
          } else if (contributeToken) {
            const view = await contributions.getContributeView(contributeToken);
            const cover = view.poolItems[0]?.id ?? null;
            tags = unfurlTags(
              `Add your photos to “${view.albumTitle}”`,
              'Tap to add your photos and videos — no account needed.',
              cover
                ? `${origin}/api/v1/contribute/${contributeToken}/assets/${cover}/thumb/720`
                : null,
            );
          }
        } catch {
          tags = null; // Dead/expired link: plain shell, the app shows its own message.
        }
        if (!tags) {
          res.sendFile(indexPath);
          return;
        }
        const html = await readFile(indexPath, 'utf8');
        res.type('html').send(html.replace('</head>', `${tags}</head>`));
      })();
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
