# Backup & restore

Your photos are never in danger from Recollect — it indexes your library **in
place** and the originals stay where they are. What only exists in the database
is everything your household *wrote*:

- Memories, their titles, dates, and locations
- Journal entries (attributed per author)
- Quotes of the day, and per-photo captions
- The **names on faces** and every merge/split decision
- Albums, favorites, share links, and camera→person mappings

That is irreplaceable. Recollect backs it up for you.

## Setting it up

**Settings → Backups** (admin only):

| Setting | What it does |
|---|---|
| **Schedule** | Off, daily, or weekly at a time you pick (server-local). |
| **Folder** | Where backups are written. Put it on your NAS so your own backup routine covers it. Blank = the app's data folder. |
| **Keep** | How many backups to retain; older ones are pruned automatically. |
| **Include AI data** | Off by default. Face/search vectors re-derive from your photos, so skipping them keeps backups small. Everything a human wrote is *always* included. |

**Back up now** runs one immediately. The folder must sit inside a mounted
volume (the same ones the library folder picker allows), so a typo can't write
somewhere that vanishes with the container.

## What each run produces

Two files per run, named by timestamp:

- **`recollect-<timestamp>.dump`** — a `pg_dump` custom-format archive. This is
  the restore path.
- **`recollect-<timestamp>.json`** — a plain-JSON export of the memory layer:
  memories, journals, quotes, albums, and people, with photos referenced by
  **content hash + library-relative path**. Readable forever, with or without
  this app. No lock-in.

The background **job queue is deliberately excluded**. It is transient
operational state rather than anything you authored, it is usually the largest
table in the database (completed history), and restoring it resurrects stale
work — including the backup job that was running at the moment of the dump,
which would then run a fresh backup right after every restore.

## Restoring from the app (opt-in)

Set `RESTORE_ENABLED=true` in `.env` and restart. A **Restore** button then
appears on every `.dump` in Settings → Backups.

It never writes into the live database. The app holds a connection pool to its
own database, and Postgres refuses to drop or rename a database that has
connections — so restoring in place would mean pulling tables out from under a
running app, leaving a half-restored database if anything failed. Instead:

1. **Stage** — restore into a scratch `recollect_restore` database. Production
   is not touched at all in this step.
2. **Verify** — the archive must contain the core tables and at least one user
   account, or the restore stops here.
3. **Swap** — block new connections to the live database, terminate the
   existing ones, then rename: `recollect` → `recollect_old_<timestamp>` and
   `recollect_restore` → `recollect`. This is the only destructive moment and
   it takes milliseconds.
4. **Restart** — the server exits and the container's restart policy brings it
   back on the restored database. You'll be signed out.

**If any step fails, nothing changed** — the scratch database is dropped and
production carries on untouched. If the *second* rename fails, the original is
renamed straight back, so there is never a moment with no live database.

### If the server won't start after a restore

Two recoverable states, both fixed with SQL from the `db` container. Check what
exists first:

```bash
docker compose exec -T db psql -U recollect -d postgres \
  -c "select datname, datallowconn from pg_database where datname like 'recollect%';"
```

- **No `recollect`, but `recollect_restore` or `recollect_old_<ts>` exists** — a
  swap was interrupted. Promote one back (`_old_` is your original data,
  `_restore` is the backup you were restoring):
  ```bash
  docker compose exec -T db psql -U recollect -d postgres \
    -c 'alter database recollect_old_20260101120000 rename to recollect;'
  ```
- **`recollect` exists but `datallowconn` is `f`** — the "block connections"
  step is still in effect; `allow_connections` follows a database through a
  rename. The server will crash-loop on `FATAL 55000`. Re-enable it:
  ```bash
  docker compose exec -T db psql -U recollect -d postgres \
    -c 'alter database recollect with allow_connections true;'
  ``` After a successful restore your previous
database is retained as `recollect_old_<timestamp>`; drop it once you're happy:

```bash
docker compose exec -T db psql -U recollect -d postgres \
  -c 'drop database "recollect_old_20260901120000";'
```

Then **rescan your library** (Settings → Library → Scan now) so assets re-link
to their files by content hash.

## Restoring by hand

Also fine, and the only option with `RESTORE_ENABLED` off. Restore into an
**empty** database — `pg_restore` will not merge into a populated one.

```bash
# 1. Stop the app (leave the database running).
docker compose stop server

# 2. Recreate an empty database.
docker compose exec -T db psql -U recollect -d postgres \
  -c "drop database recollect;" -c "create database recollect;"

# 3. pgvector must exist before the vector columns restore.
docker compose exec -T db psql -U recollect -d recollect \
  -c "create extension if not exists vector;"

# 4. Restore the archive.
docker compose exec -T db pg_restore -U recollect -d recollect --no-owner \
  < /path/to/recollect-<timestamp>.dump

# 5. Start the app. Pending migrations apply automatically at boot.
docker compose start server
```

Then **rescan your library** (Settings → Library → Scan now). Assets are keyed
by content hash, so a rescan re-links every file to the memory it belonged to,
even if paths moved.

If you backed up **without** AI data, faces and semantic search will be empty
until the ML sidecar re-derives them — that happens automatically in the
background once it's running.

## Verifying a backup

Downloading is the honest test. In **Settings → Backups**, every saved backup
has a **Download** button — pull one and confirm it opens:

```bash
pg_restore --list recollect-<timestamp>.dump | head
```

A healthy archive lists the tables. It's worth doing once after you set the
schedule up, so you find out now rather than on the day you need it.
