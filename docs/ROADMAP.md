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

## Locked: Memory vs Album

- **Album** = a bucket. Photos you grouped on purpose; unbounded grid; no
  narrative, no date semantics. Organization.
- **Memory** = a story. One bounded, composed page about a moment — hero,
  written journal, quotes of the day, a swipeable photo strip (media scrolls
  *within* its region, never page-infinitely), and where it happened. Usually
  a curated subset, smaller than an album.
- An album can be **converted** to a memory ("Make a memory" on the album
  page): the album's photos open pre-selected for pruning down to the story.

## Next up

(2026-08-28 sweep: items 1–5, 7–9 SHIPPED, plus a Dashboard home with On
This Day, suggestions, and recent memories; the bottom nav folded into the
left drawer. Details in git history.)

1. **Live Photos pairing** (needs real iPhone HEIC+MOV pairs).
2. **Memory day-by-day chapters** — date subheads inside multi-day
   memories (needs per-asset dates on MemoryDetail). DEFERRED by user
   (2026-08-30) until they can test it on a real multi-day memory.
3. **Cleanup advisor v2**: CLIP zero-shot junk categories (floor/pocket/
   blur), oversized-image conversion, photo-frame-face cluster flag (every
   face under ~5% of frame width). User confirmed 2026-08-30: NO autodeletes
   (flag only), and every flagged item must open full-screen in one tap to
   verify before removal — tap-to-open SHIPPED 2026-08-30 (flagged rows open
   the AssetViewer with info/delete). CLIP zero-shot "Possibly accidental"
   (floor / all-dark / blur) SHIPPED 2026-08-30 — zero-shot over existing CLIP
   embeddings, isolated + conservative + dismissible; thresholds
   (CLIP_ACCIDENTAL_MARGIN/_MAX_DISTANCE constants) need tuning on the real
   library. Remaining: oversized-image conversion + photo-of-a-frame (tiny-faces)
   flag.
4. **Pixel/Android motion photos** — SHIPPED 2026-08-30. MP4 embedded in the
   JPEG (GCamera MicroVideo / MotionPhoto XMP) is extracted at ingest to an
   app-data cache and served at /assets/:id/motion; viewer shows a LIVE badge
   with press-and-hold playback. Best-effort, no schema change. Needs a real
   Pixel/Samsung motion photo to confirm extraction end-to-end.
5. **Push notifications (larger feature)** — INFRA SHIPPED 2026-08-30
   (self-hosted Web Push / VAPID): push_subscription table, PushService
   (subscribe/unsubscribe/sendToUser + dead-endpoint pruning), /push/key|
   subscribe|unsubscribe|test routes, Settings "Notifications" toggle over
   Angular SwPush, VAPID_* config. To ACTIVATE: set VAPID_PUBLIC_KEY /
   VAPID_PRIVATE_KEY / VAPID_SUBJECT in hawaii .env and restart (disabled +
   no-op until then). REMAINING — the actual conditions (still TBD with user;
   candidates: new guest photos on your album, new suggested memories, On This
   Day mornings, a member joined) and per-condition opt-in toggles.

## The big design pass

8. **Memory as a written story ("flowy journalistic" redesign)** — inline
   photos between paragraphs, day-by-day chapters, pull-quote covers,
   print-worthy typography. Parked until the current journal shape survives
   a week of real family use.

## Later

- **Places v2**: bubble map SHIPPED 2026-08-27 (card/map toggle, Leaflet,
  count-sized bubbles, tap-to-drill). Remaining: per-place date ranges;
  places in search results; maybe per-cell dots / heatmap at high zoom
- **ML auto-tagging** (zero-shot CLIP over a tag vocabulary) + a download
  button that names files from tags + original name (yearly family book flow)
- Smarter clustering, year-in-review
- Housekeeping: hawaii doc (`hawaii/docs/recollect.md`), delete unused
  `production` GitHub environment, fix red CI (Linux lockfile / `npm ci`)

## Last, deliberately

- **Guest uploads for an event** — the only public write path. SHIPPED
  2026-08-27 (pulled forward at user request). Reachable publicly only once
  nginx exists; works on LAN today. Design as locked (2026-08-27):

  **An event is not a new entity.** It's an album wearing a *contribution
  link*, and the memory comes afterwards as curation. The layering is:
  guest raw feed → album (bucket) → memory (story) — reusing the existing
  album→memory conversion, no third top-level concept.

  **Flow**
  1. Create the album ("Nana's 80th"), enable a contribution link on it —
     an unguessable token URL in the same family as share tokens.
  2. Guest page is dead simple: type your name once (stored as uploader
     attribution, feeds "Taken by"), pick photos, upload. No account.
  3. Uploads are validated by actually decoding the file (the security
     review), then auto-ingest through the normal pipeline straight into
     the album (design revised 2026-08-28: near-immediate, no human
     gate). The quarantine review queue remains as the FALLBACK for
     files that fail ingest (approve = retry, reject = delete).
  4. Curate the memory from the album afterwards, as with any album.

  **Token scope** grants exactly: upload to this one event, plus an
  optional *pool view* toggle (guests see the whole album — on for a
  birthday, off for upload-only drops). Never people data, never search,
  never anything outside the event.

  **nginx reverse proxy DONE & tested (2026-08-30)** — the public path
  exists, so guest uploads and share links are reachable off-LAN over HTTPS.

  **Security**
  - Link auto-expires (default one week after the event date) and is
    revocable instantly.
  - Server-side validation, not trust: cap file size and per-token total
    count; accept only media verified by probing bytes (sharp/ffprobe);
    rate-limit per token/IP at Nest and at nginx.
  - Quarantine is the security boundary: nothing reaches the library, ML
    pipeline, or other guests (pool view shows approved items only)
    without a household member approving it.
  - Transport/HTTPS is the nginx reverse proxy's job — this feature only
    makes sense once the public path exists, which is why it stays last.

## Decisions locked

GPU 1 for inference · antelopev2 faces + CLIP search · edit-mode app-wide ·
suggestions as a grid · sharing private-until-explicit with expiration ·
modularity via env vars · guest uploads last.

**The household is one shared space**: every member sees everyone's memories,
albums, and people; write-grant members co-edit them (add photos, quotes,
titles) — there is no per-user ownership wall. The one per-author boundary:
each person's journal entry is theirs alone (others read it attributed, and
write their own alongside). Deletes need the delete grant.

**Admin-only curation**: face management (naming, merging, splitting,
ignoring, disbanding, hiding people) and all library configuration (roots,
scans, schedules, camera→person mappings) are admin actions. Write-grant
members organize content; admins shape the machinery.
