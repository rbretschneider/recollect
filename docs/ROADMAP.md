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
- **Search v1**: memories (incl. journal text), albums, folders, filenames,
  date expressions — plus **CLIP semantic search** ("Looks like 'beach'")
- **Grid view options**: justified mosaic (default) / uniform / small squares
- **Edit mode app-wide**; album typeahead picker + auto covers; viewer
  load spinner
- **ML live in production**: sidecar wired (faces → People with incremental
  clustering, CLIP embeddings), ml service in compose on GPU 1, backfill
  sweeping the library; People pages shipped

## Next up

1. **On This Day** — resurface past years' photos for today's date on the
   Memories page; cheap on existing clustering, big emotional payoff.
2. **Share a single photo** — the most common share intent; extends
   share_link to asset targets with the same private-until-action policy.
3. **Selection → create memory/album** — multi-select currently only offers
   album-add and trash.
4. **Person ↔ user linking** ("this is Andrea") — data model reserves it;
   unlocks "photos of us". Also: viewer info "Taken by" links to the person.
5. **Settings completeness** — edit/disable members, change password
   (incl. forced first-login change), remove/re-enable library roots.
6. **Live Photos pairing** (needs real iPhone HEIC+MOV pairs).
4. **Special photo types**: photospheres/panoramas currently display as flat
   wide images (correct data, no 360° projection) — add an interactive 360°
   viewer for assets with GPano XMP or `.PHOTOSPHERE.` names; Pixel motion
   photos show their still (embedded video not yet played). Note: a
   `PHOTOSPHERE.jpg` that renders as a grey mountain icon is a Google Photos
   cloud-only stub on the NAS (7KB placeholder), not an app bug.
4. **Wait-state sweep** — audit remaining async actions against the
   three-signal standard.

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
