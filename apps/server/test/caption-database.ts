import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { PgDialect } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { resolve } from 'path';
import * as schema from '../src/database/schema';

/** Each suite creates its own database; the supplied URL must allow CREATE DATABASE. */
export async function captionDatabase(
  beforeCaptions?: (
    db: ReturnType<typeof drizzle<typeof schema>>,
  ) => Promise<void>,
) {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      'TEST_DATABASE_URL is required (disposable PostgreSQL with pgvector).',
    );
  const admin = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    max: 1,
  });
  const name = `caption_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.href, max: 3 });
  const db = drizzle(pool, { schema });
  const close = async () => {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  };
  try {
    const config = { migrationsFolder: resolve(__dirname, '../drizzle') };
    if (beforeCaptions) {
      await new PgDialect().migrate(
        readMigrationFiles(config).slice(0, -1),
        db._.session,
        config,
      );
      await beforeCaptions(db);
    }
    await migrate(db, config);
    return { db, pool, url: url.href, close };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function image(
  db: ReturnType<typeof drizzle<typeof schema>>,
  mediaType = 'image',
) {
  const id = randomUUID();
  await db
    .insert(schema.asset)
    .values({
      id,
      contentHash: randomUUID(),
      mediaType,
      mime: mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
      capturedAt: new Date(),
      capturedDay: '2026-01-01',
      capturedAtSource: 'user',
    });
  return id;
}
