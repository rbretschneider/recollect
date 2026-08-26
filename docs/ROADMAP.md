# Recollect Roadmap

The living short-list. The exhaustive backlog with acceptance criteria stays in
[plan.md](plan.md); this is what's actually next, in rough order. Updated as
real-library testing (30k items on the prod server) teaches us things.

## Shipped (highlights)

- Photo timeline, viewer (zoom/pan/gestures, back-button-safe), folders view,
  albums, trash with holding period, multi-user grants, settings, live activity
  + logs, Docker single-container deploy with GHCR auto-publish
- Memories: Tier-1 event detection (≥7 photos, tunable), inspectable inbox,
  journal-as-story, embedded map, share links
- Video: orientation-safe playback, background HEVC→H.264 transcoding
- Self-healing pipelines: thumbnail repair sweeps, single-file reprocess

## Next up

1. **Search v1** — one box: text, dates ("July 2025"), filename/folder,
   filters. The biggest daily-use gap vs PhotoPrism.
2. **Album share-link management (PhotoPrism-parity)** — per-album panel
   listing its links: create with optional **expiration**, toggle
   on/off (revoke/re-enable), copy, view counts, and **short URLs**
   (`/s/<short-token>`). Backend fields already exist (expiry, revoke);
   this is the management UX + short tokens.
3. **Settings completeness** — edit/disable members, change password
   (incl. forced first-login change), remove/re-enable library roots.
4. **Favorites** (per-user hearts + view).
5. **Live Photos pairing** — needs a couple of real iPhone HEIC+MOV pairs
   to test honestly.

## The big design pass

6. **Memory as a written story ("flowy journalistic" redesign)** — the memory
   page becomes a composed piece, not a page of sections: inline photos woven
   between paragraphs, day-by-day chapters for multi-day memories, pull-quote
   covers, print-worthy typography. Deliberately parked until the current
   journal shape has survived a week of real family use; its lessons feed
   the design.

## Phase 2+ (unchanged from plan.md)

- People & faces (ML sidecar), Places view, semantic search (CLIP),
  smarter clustering, On This Day / year-in-review.

## Last, deliberately

7. **Guest uploads for an event** — a share link that accepts photos from
   guests ("drop your photos from the party here") into a review queue.
   The only path where files enter by upload; lands in a configurable
   library folder. Powerful, but it touches trust boundaries (public
   write endpoint), so it ships after everything above is boring and
   stable.
