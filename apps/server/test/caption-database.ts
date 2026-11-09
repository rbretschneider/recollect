import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { resolve } from 'path';
import * as schema from '../src/database/schema';

/** Each suite creates its own database; the supplied URL must allow CREATE DATABASE. */
export async function captionDatabase() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required (disposable PostgreSQL with pgvector).');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const name = `caption_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = '/' + name;
  const pool = new Pool({ connectionString: url.href, max: 3 });
  const db = drizzle(pool, { schema });
  const close = async () => {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  };
  try {
    await migrate(db, { migrationsFolder: resolve(__dirname, '../drizzle') });
    return { db, pool, url: url.href, close };
  } catch (error) { await close(); throw error; }
}

export async function image(db: ReturnType<typeof drizzle<typeof schema>>, mediaType = 'image') {
  const id = randomUUID();
  await db.insert(schema.asset).values({ id, contentHash: randomUUID(), mediaType, mime: mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
    capturedAt: new Date(), capturedDay: '2026-01-01', capturedAtSource: 'user' });
  return id;
}
