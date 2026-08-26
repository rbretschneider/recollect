# Recollect Roadmap

The living short-list. The exhaustive backlog with acceptance criteria stays in
[plan.md](plan.md); this is what's actually next, in rough order. Updated as
real-library testing (~18.5k assets on hawaii) teaches us things.

## Shipped (highlights)

- Photo timeline, viewer (zoom/pan/gestures, back-button-safe, Info toggle),
  folders view, albums, trash with holding period, multi-user grants, settings,
  live activity + logs, Docker deploy with GHCR auto-publish
- Memories: Tier-1 detection (≥7 photos, tunable), suggestion review grid with
  per-photo curation + naming, journal-as-story, embedded map, sharing
  (private-until-explicit-link, expiration, revoke)
- Video: orientation-safe playback, background HEVC→H.264 transcoding
- Self-healing pipelines: thumbnail repair sweeps, single-file reprocess
- ML sidecar built (FastAPI + InsightFace antelopev2 + open_clip ViT-L-14,
  GPU 1 on hawaii, env-configurable down to CPU) — not yet wired to the server

## In progress

- **ML wiring (E12/E15)**: server jobs `detect_faces` / `embed_clip`,
  face/person/embedding schema (specced in data-model.md), backfill →
  face clustering → People UI (name/merge/ignore) → CLIP semantic search UI

## Next up

1. **Search v1** — one box: text, dates, filename/folder, filters. Biggest
   daily-use gap; CLIP search lands on top of it later.
2. **Grid view options** — keep today's uniform grid, add PhotoPrism-style
   alternatives with a view switcher: **mosaic tiling** (fills dead space,
   their default), **cards** (photo + metadata block), **small squares**.
3. **Edit-mode app-wide** — read-only by default across Photos/Albums/Memories;
   destructive/curation controls appear only in an explicit edit mode
   (kills the stray per-image ✕). *(Decision locked: full scope.)*
4. **Album QOL** — creation via typeahead select-list; auto cover thumbnail
   from a member photo (user-selectable later).
5. **Wait-state sweep** — audit every async action against the three-signal
   standard; includes a viewer spinner while the full image loads.
6. **Settings completeness** — edit/disable members, change password
   (incl. forced first-login change), remove/re-enable library roots.
7. **Favorites**; **Live Photos pairing** (needs real iPhone HEIC+MOV pairs).

## The big design pass

8. **Memory as a written story ("flowy journalistic" redesign)** — inline
   photos between paragraphs, day-by-day chapters, pull-quote covers,
   print-worthy typography. Parked until the current journal shape survives
   a week of real family use.

## Later

- **ML auto-tagging** (zero-shot CLIP over a tag vocabulary) + a download
  button that names files from tags + original name (yearly family book flow)
- Places view, smarter clustering, On This Day / year-in-review
- Housekeeping: hawaii doc (`hawaii/docs/recollect.md`), delete unused
  `production` GitHub environment, fix red CI (Linux lockfile / `npm ci`)

## Last, deliberately

- **Guest uploads for an event** — the only public write path; ships after
  everything above is boring and stable.

## Decisions locked

GPU 1 for inference · antelopev2 faces + CLIP search · edit-mode app-wide ·
suggestions as a grid · sharing private-until-explicit with expiration ·
modularity via env vars · guest uploads last.
