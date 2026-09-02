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

## Restoring

Restore into an **empty** database — `pg_restore` will not merge into a
populated one.

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
