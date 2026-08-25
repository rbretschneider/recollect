import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './config/app-config';

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

async function bootstrap(): Promise<void> {
  loadEnvironment();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
}

void bootstrap();
