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
7. **Cleanup advisor (storage on location)** — a suggestion panel for
   reclaiming NAS space, review-inbox style (accept / dismiss, never
   auto-delete):
   - **No-subject flags**: CLIP zero-shot against junk categories (floor /
     ceiling / pocket shot / all-black / heavy blur) plus cheap signals
     (near-zero luminance variance, tiny stub files like the 7KB cloud-only
     placeholders, 0-byte and moov-less videos already marked by the
     pipeline). Accept = Trash (normal holding period applies).
   - **Space hogs**: biggest files by absolute size and videos by
     bytes-per-second; offer **in-place conversion** (re-encode bloated
     video to efficient H.264/HEVC at sane bitrate, oversized images to
     high-quality JPEG/WebP). Conversion REPLACES the original on the NAS —
     delete-grant only, confirm drawer, original goes through the trash
     holding period as the undo window.
   - Panel shows projected savings ("~14.2 GB reclaimable") and per-item
     before/after sizes; lives next to the Library page's health card.
8. **Special photo types**: photospheres/panoramas currently display as flat
   wide images (correct data, no 360° projection) — add an interactive 360°
   viewer for assets with GPano XMP or `.PHOTOSPHERE.` names; Pixel motion
   photos show their still (embedded video not yet played). Note: a
   `PHOTOSPHERE.jpg` that renders as a grey mountain icon is a Google Photos
   cloud-only stub on the NAS (7KB placeholder), not an app bug. Also: BMP
   thumbnails via ffmpeg fallback (old scanned-photo folders have them).
9. **Wait-state sweep** — audit remaining async actions against the
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

**The household is one shared space**: every member sees everyone's memories,
albums, and people; write-grant members co-edit them (add photos, quotes,
titles) — there is no per-user ownership wall. The one per-author boundary:
each person's journal entry is theirs alone (others read it attributed, and
write their own alongside). Deletes need the delete grant.

**Admin-only curation**: face management (naming, merging, splitting,
ignoring, disbanding, hiding people) and all library configuration (roots,
scans, schedules, camera→person mappings) are admin actions. Write-grant
members organize content; admins shape the machinery.
