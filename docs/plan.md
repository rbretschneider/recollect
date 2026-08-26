# Recollect — Feature Plan (Epics & Stories)

> Companion to [frd.md](frd.md) (requirements) and [data-model.md](data-model.md) (schema).
> Stories are grouped into epics; epics are ordered into the four phases from FRD §14.
> Every story is judged against the **Wife Approval** heuristic (FRD §0): zero tutorial, no jargon, nothing destructive without undo.
>
> Status legend: `P1` = MVP, `P2` = Remember It, `P3` = Understand It, `P4` = Your Life.
> Priority within a phase: 🔴 must · 🟡 should · 🟢 nice.

---

## Epic overview

| # | Epic | Phase | Depends on |
|---|------|-------|-----------|
| E1 | Accounts & Household | P1 | — |
| E2 | Library Engine (in-place scan) | P1 | — |
| E3 | Processing Pipeline (metadata/thumbs/jobs) | P1 | E2 |
| E4 | Photo Experience (grid, viewer, timeline) | P1 | E3 |
| E5 | File Management (trash, delete, move) | P1 | E2, E4 |
| E6 | Search v1 (text/metadata/date) | P1 | E3 |
| E7 | Event Detection Tier-1 | P1 | E3 |
| E8 | Memory Inbox | P1 | E7 |
| E9 | Memories & Journal | P1 | E8 |
| E10 | PWA & Offline | P1 | E4, E9 |
| E11 | Admin & Observability | P1 | E3 |
| E12 | People & Faces (ML) | P2 | E3, ML sidecar |
| E13 | Places & Map | P2 | E3 |
| E14 | Sharing & Visibility | P2 | E1, E9 |
| E15 | Semantic Search (CLIP) | P3 | ML sidecar |
| E16 | Smarter Clustering (Tier 2/3) | P3 | E12, E15 |
| E17 | AI Assists (titles/summaries) | P3 | E9 |
| E18 | Resurfacing & Life Timeline | P4 | E9, E12 |

---

# Phase 1 — "A photo app that earns trust"

## E1 — Accounts & Household

**Goal:** a household shares one library; each person has their own identity; **deletion is a grant**, not a default.

- **S1.1 🔴 First-run setup** — As the first user, I complete a one-time setup wizard: create the initial admin account (admin + delete grant), point at one or more library folders, and start the first scan.
  *AC:* wizard appears only when zero users exist; validates folder paths exist and are readable; scan kicks off immediately after finish; no config file editing required.
- **S1.2 🔴 Sign in / sign out** — As a user, I sign in with email + password and stay signed in on my devices.
  *AC:* Argon2id hashing; short-lived access token in memory + httpOnly refresh cookie; refresh rotation; sessions revocable; rate-limited login; works on the installed PWA.
- **S1.3 🔴 Invite household members** — As an admin, I create accounts for family members (name, email, temp password or invite link) and choose their permission grant at creation.
  *AC:* new member forced to set password on first login; grant selectable (read/write/delete) at creation, changeable later.
- **S1.4 🔴 Permission grants: Read / Write / Delete** — Deletion is a grant. Each user has exactly one level; each includes the ones below:
  - **Read** — browse, search, view only. No changes to shared state (per-user favorites/hidden allowed — they affect only the viewer).
  - **Write** — Read + memories, journal, tags, naming people, albums. No file operations.
  - **Delete** — Write + remove media permanently (trash/move/purge), always via the holding period (S5.3).
  *AC:* every API route declares a required grant; enforced server-side; UI hides what your grant doesn't allow (never shows then errors).
- **S1.5 🔴 Admin flag** — Orthogonal to grants: manage users/settings/library roots, view audit log, empty trash early. First account = admin + delete.
  *AC:* admin without delete grant still cannot delete media (grants govern content; admin governs the system).
- **S1.6 🟡 Profile basics** — As a user, I set my display name and avatar (pick any photo of me).
- **S1.7 🟢 Audit trail** — As an admin, I can see who deleted/moved/edited what and when.
  *AC:* all destructive + structural ops logged with user, timestamp, entity, before/after.

## E2 — Library Engine (in-place, writable-ready)

**Goal:** index the NAS library where it lives; never copy; survive renames/moves.

- **S2.1 🔴 Add library roots** — As the owner, I register one or more folders (e.g. `/nas/Photos`, `/nas/Videos`) to be indexed in place.
  *AC:* per-root enable/disable; include/exclude glob patterns (e.g. skip `@eaDir`, hidden files); roots editable later without re-copying anything.
- **S2.2 🔴 Initial full scan** — As a user, after adding a root the app discovers every supported file and streams progress ("12,410 of 20,000 indexed").
  *AC:* supported: JPEG/PNG/HEIC/WebP/GIF/RAW(list TBD)/MP4/MOV/AVI…; unsupported files skipped and counted; scan is resumable after restart; progress via SSE.
- **S2.3 🔴 Incremental scheduled rescan** — As a user, new files I drop onto the NAS appear in the app after the scheduled scan (default nightly, configurable cron).
  *AC:* rescan detects adds/changes/removals by (path, size, mtime) fast-path + content hash on suspicion; only changed files reprocessed; never a forced full re-hash of the library.
- **S2.4 🟡 Filesystem watching** — As a user, on mounts that support it, new files appear within a minute without waiting for the nightly scan.
  *AC:* chokidar watch per root, toggleable; degrades silently to scheduled scan on network shares where events don't fire; debounced (file-still-being-copied detection).
- **S2.5 🔴 Stable identity across moves** — As a user, when I reorganize folders on the NAS, my memories/favorites/journal links survive.
  *AC:* identity = content hash (SHA-256); a moved/renamed file re-links to the same asset row (path updated, id unchanged); true duplicate content at two paths tracked as one logical asset with multiple file locations *or* flagged as duplicates (decision: single asset + duplicates list).
- **S2.6 🔴 Missing/offline media handling** — As a user, if a file disappears (mount down, file gone), the app shows a placeholder and never destroys the memory/journal that referenced it.
  *AC:* asset marked `missing`, auto-heals if the hash reappears anywhere; admin sees a "missing files" report.
- **S2.7 🔴 Live Photo pairing** — As a user, my iPhone Live Photos show as one item (photo with motion), not two files.
  *AC:* pair by content ID / filename+timestamp heuristics; video half hidden from the grid; playable on press-and-hold in viewer.
- **S2.8 🟡 Duplicate detection** — As a user, I can see exact-duplicate files (same hash, different paths) and resolve them.
  *AC:* review UI lists dupes grouped; resolving = keep one, trash others (goes through E5 trash).

## E3 — Processing Pipeline

**Goal:** every discovered file gets metadata + thumbnails fast; heavy work never blocks browsing.

- **S3.1 🔴 Metadata extraction** — Every asset gets EXIF/metadata: captured-at (with timezone logic), GPS, camera/lens, dimensions, duration, orientation.
  *AC:* exiftool-vendored; fallbacks: EXIF date → filename-parsed date → file mtime, with the source recorded; user-corrected dates always win and are never overwritten by rescans.
- **S3.2 🔴 Thumbnail generation** — Every asset gets thumbnails at fixed sizes (e.g. 240 / 720 / 1440) generated via libvips, video thumbs + animated hover preview via ffmpeg.
  *AC:* HEIC/RAW decode supported; correct EXIF orientation; thumbs stored under app data keyed by asset id + size; original never modified; grid uses 240, viewer preloads 1440, full-res streamed on zoom.
- **S3.3 🔴 Job queue** — All processing runs through a DB-backed queue with bounded workers.
  *AC:* priorities (user-visible work > background ML); resumable after restart; per-job retry with backoff; cancellable; concurrency caps configurable ("NAS mode": max N workers).
- **S3.4 🔴 Per-asset processing state** — Each asset tracks stage completion (metadata → thumbs → faces → embeddings → clustered).
  *AC:* a failure in any stage marks that stage failed but the asset still appears in the grid with whatever it has; failed stages retryable in bulk from admin.
- **S3.5 🔴 Perceptual hashing** — Every image gets a pHash for burst/near-dupe detection (feeds E7/E16, S2.8).
- **S3.6 🟡 Video previews** — Videos get a short muted preview (hover/press) and a poster frame.
- **S3.7 🟡 On-demand transcode** — Videos the browser can't play (HEVC in some browsers) transcode on demand with caching.
  *AC:* never pre-transcodes the whole library; cache size-bounded LRU.

## E4 — Photo Experience

**Goal:** the daily-driver photo app. This epic is where Wife Approval is won or lost.

- **S4.1 🔴 Photo grid (timeline)** — As a user, I scroll my entire library newest-first in a justified grid with day/month headers, at 60fps, on my phone.
  *AC:* virtualized (only visible rows rendered); thumbnail-first, blur-up placeholders; 20k+ assets scroll smoothly on a mid-range phone; pinch (or toggle) to change density; selection mode via long-press then tap, with drag-select on desktop.
- **S4.2 🔴 Timeline scrubber** — As a user, I drag a scrubber on the edge to jump to any month/year instantly (Immich-style).
  *AC:* shows year/month labels while dragging; landing is instant (grid data windowed by date, not offset).
- **S4.3 🔴 Fullscreen viewer** — As a user, I tap a photo to view fullscreen and swipe between items.
  *AC:* pinch-zoom + double-tap zoom; swipe-down to close; videos play inline with controls; Live Photos play on press; info sheet (date, camera, location, size, path) swipes up; preloads neighbors; back button/gesture behaves correctly.
- **S4.4 🔴 Favorites** — As a user, I heart photos; favorites are **mine**, not shared.
  *AC:* per-user state; favorites view; syncs across my devices.
- **S4.5 🟡 Hidden items** — As a user, I can hide items from my main grid (per-user) without affecting others or the files.
- **S4.6 🔴 Multi-select actions** — As a user, I select many items and act: favorite, add to memory, share, delete, move.
  *AC:* selection survives scrolling; count shown; actions honor grants (delete/move need the delete grant; add-to-memory needs write).
- **S4.7 🟡 Share out** — As a user, I share photos to other apps via the native share sheet (Web Share API), original or resized.
- **S4.8 🟢 Basic edit** — Rotate/crop saved non-destructively (sidecar/DB transform, original untouched). *(P2 candidate; keep out of MVP if tight.)*

## E5 — File Management (the differentiator vs Immich-external)

**Goal:** manage the *actual NAS files* from anywhere — safely.

- **S5.1 🔴 Delete → Trash** — As a user, deleting a photo removes it from every view and moves the original into an app-managed Trash on the same volume.
  *AC:* single confirm ("Move 3 items to Trash?"); undo snackbar; file physically moved to `<root>/.recollect-trash/<date>/…` (same filesystem = instant, preserves original path in DB); memory/journal references keep a tombstone, never break.
- **S5.2 🔴 Trash view + restore** — As a user, I open Trash, see what's there and who trashed it, and restore items to their original location.
  *AC:* restore replaces the file at the original path (conflict → auto-rename); restored assets rejoin all memories they were in.
- **S5.3 🔴 Holding period (auto-purge)** — Trash auto-empties after N days (**default 7**, admin-configurable); admins can empty immediately.
  *AC:* purge = real file deletion + audit log entry; upcoming purge visible in Trash.
- **S5.4 🟡 Move / organize files** — As a user with the delete grant, I move selected items to another folder within the library roots.
  *AC:* physical move on disk; identity survives (S2.5); folder browser shows only library roots; collision handling.
- **S5.5 🟢 Rename file** — Single-item rename on disk, identity preserved.
- **S5.6 🔴 External-change reconciliation** — If someone deletes/moves files directly on the NAS, the next scan reconciles without breaking memories.
  *AC:* moved-on-disk = re-linked by hash; deleted-on-disk = marked missing (S2.6), surfaced in admin report; never silently drops journal content.

## E6 — Search v1

- **S6.1 🔴 One search box** — As a user, I search from a persistent search entry point and get grouped results: memories, dates, places (text match), file/folder names.
  *AC:* instant-as-you-type; recent searches; empty-state suggestions ("Try: Maine, July 2025").
- **S6.2 🔴 Date/time queries** — "July 2025", "2024", "last summer" resolve to date-range filters.
- **S6.3 🔴 Filters** — Filter any grid by: type (photo/video), date range, camera, folder/root, favorite.
- **S6.4 🟡 Metadata text search** — Matches folder names, filenames, memory titles/descriptions/journal text, tags (FTS).

## E7 — Event Detection (Tier 1)

**Goal:** deterministic clustering that's useful before any ML exists.

- **S7.1 🔴 Time+geo clustering** — The system groups incoming assets into candidate events using time-gap segmentation (e.g. new cluster after >3h gap, tunable) refined by GPS distance (e.g. >X km jump splits).
  *AC:* runs incrementally as assets are processed; deterministic + idempotent (same input → same clusters); algorithm versioned; thresholds configurable but with sane defaults nobody must touch.
- **S7.2 🔴 Cluster scoring & naming seed** — Each candidate gets a confidence score and a seed label from metadata: date span + geocoded place ("Jul 18–21 · Bar Harbor") — no LLM required.
  *AC:* reverse-geocode via offline dataset (bundled cities DB) so no cloud calls; falls back to raw date span.
- **S7.3 🔴 Re-cluster on new evidence** — Late-arriving photos (e.g. camera imported a week later) join the right existing cluster/memory suggestion instead of forming noise.
  *AC:* only *unconfirmed* clusters are mutated automatically; confirmed Memories get a gentle suggestion ("14 new photos look like they belong to *Maine Vacation* — add?") and are never silently changed.
- **S7.4 🟡 Burst collapse** — Rapid-fire near-identical shots (pHash + <2s apart) group as a burst: one grid tile, expandable.

## E8 — Memory Inbox

- **S8.1 🔴 Inbox of suggestions** — As a user, I open Memories → Inbox and see suggestion cards: cover mosaic, seed title, date span, place, counts.
  *AC:* newest first; badge count on nav; card tap → full preview grid of the cluster.
- **S8.2 🔴 Create Memory from suggestion** — One tap accepts a suggestion into a Memory (editable title pre-filled from seed).
  *AC:* accept is instant + optimistic; lands in timeline immediately.
- **S8.3 🔴 Merge suggestions** — Select 2+ suggestions (or a suggestion + existing Memory) and merge.
- **S8.4 🔴 Split suggestion** — Inside a suggestion, select a subset and split it into its own suggestion/Memory.
- **S8.5 🔴 Dismiss** — "Not an event" removes the card; assets remain in the photo grid; dismissed clusters don't re-suggest identically.
- **S8.6 🟡 Inbox hygiene** — Low-confidence clusters auto-expire from the inbox after N days (assets unaffected); one place to review "everything unsorted this month."

## E9 — Memories & Journal

- **S9.1 🔴 Memory timeline** — As a user, the Memories tab shows a chronological, magazine-like timeline grouped by year/month: cover, title, date, place, people (P2), snippet of journal.
  *AC:* this is the emotional heart of the app — design-first; fast; infinite scroll by year.
- **S9.2 🔴 Memory detail page** — Title, hero cover, date range, place, media grid, journal entries, tags, related memories.
- **S9.3 🔴 Edit everything** — Title, description, start/end date (with "approximate" precision: day/month/year), location (search or pin on map), cover image, tags.
  *AC:* every AI/system value is overridable; user edits are never clobbered by re-clustering.
- **S9.4 🔴 Manage media in a memory** — Add (from grid/search picker), remove, reorder, set cover.
- **S9.5 🔴 Manual memory creation** — Create a Memory from any selection in the grid, or from scratch (even with zero photos — "Grandpa's stories").
- **S9.6 🔴 Journal entries** — As a user, I write a journal entry on a memory; multiple household members can each write their own.
  *AC:* markdown-lite editor (bold/italic/lists); entries attributed + timestamped ("Andrea · Aug 2"); autosaved drafts; edit history kept (revisions, at least last-known-good).
- **S9.7 🔴 Merge/split/delete memories** — Merge two Memories (journals concatenate, attributed); split media out into a new Memory; delete Memory (assets untouched; journal recoverable from trash for retention window).
- **S9.8 🟡 Related memories** — Manually link memories ("Maine 2025" ↔ "Maine 2026"); shown on detail page.
- **S9.9 🟡 Tags** — Freeform tags on memories, with autocomplete; tag pages list matching memories.

## E10 — PWA & Offline

- **S10.1 🔴 Installable PWA** — Manifest + service worker; installs to home screen on iOS/Android/desktop; app-like launch (no browser chrome); custom icon/splash.
- **S10.2 🔴 Offline browse** — Previously viewed memories, their journal text, and cached thumbnails are readable offline.
  *AC:* IndexedDB (Dexie) mirror of visited memories + LRU thumbnail cache in Cache Storage; clear offline indicator, never an error page.
- **S10.3 🔴 Offline journal writing** — I can write/edit journal entries and memory titles offline; changes sync on reconnect.
  *AC:* mutation outbox with client op-ids (idempotent replay); text conflicts resolve last-write-wins **with the losing version preserved** and surfaced ("edited on another device — view other version").
- **S10.4 🟡 Background sync** — Outbox flushes via Background Sync API where supported; else on next open.
- **S10.5 🟢 Notifications** — Opt-in web push: "You have 3 new memory suggestions" / (P4) "On this day."

## E11 — Admin & Observability

- **S11.1 🔴 Status panel** — Admin sees: assets indexed / pending / failed per stage, queue depth, last scan per root, storage used by app data, ML sidecar health.
- **S11.2 🔴 Health endpoint + structured logs** — `/health` (liveness/readiness incl. DB + roots reachable); JSON logs.
- **S11.3 🔴 Retry & repair** — Bulk-retry failed jobs; re-run a stage for selected assets; trigger manual rescan/reconcile per root.
- **S11.4 🔴 Settings UI** — Everything configurable in FRD §13 (scan cron, thresholds, holding period, ML on/off, worker caps, user grants) editable by an admin in the UI, stored in DB.
- **S11.5 🔴 Backup/export** — One-click DB backup; scheduled auto-backup to a chosen folder; export all memories+journals as JSON + Markdown (media referenced by hash/path). Restore path documented and tested.
- **S11.6 🔴 API contract** — Versioned `/api/v1`, OpenAPI spec in repo, Angular client generated from it, CI check for breaking changes.

---

# Phase 2 — "Remember it"

## E12 — People & Faces (ML sidecar)

- **S12.1 🔴 ML sidecar service** — Python/FastAPI + ONNX Runtime container; core talks to it over HTTP; core degrades gracefully when it's down/disabled.
  *AC:* CPU-only baseline works on mini-PC-class hardware; GPU optional; bounded batch endpoints; model files versioned; every stored embedding records its model version.
- **S12.2 🔴 Face detection + embedding** — Every photo (and video keyframes 🟢) gets face boxes + embeddings, queued at low priority.
- **S12.3 🔴 Face clustering → People** — Similar faces cluster into unnamed people; People tab shows avatar circles, biggest first (Google Photos pattern).
  *AC:* incremental clustering (new faces join existing clusters); re-cluster job available; clusters never auto-merge two *named* people.
- **S12.4 🔴 Name / merge / ignore** — Tap a cluster → name it → it becomes a Person; merge clusters/persons; "This isn't the same person" split; ignore-this-face and hide-this-person.
- **S12.5 🔴 People on memories** — Memories auto-list detected people (from member assets); user can add/remove; person chips filter the timeline ("Memories with Grandma").
- **S12.6 🔴 Person page** — All photos of a person + all memories they appear in, chronological.
- **S12.7 🟡 Person ↔ User link** — Optionally link a Person to a household User ("this is Andrea") for "photos of me" and future private-by-default logic.

## E13 — Places & Map

- **S13.1 🔴 Reverse geocoding** — GPS → city/region/country using a bundled offline dataset (no cloud calls by default).
- **S13.2 🔴 Places view** — Browse by place hierarchy; place chips on memories; place filter in search.
- **S13.3 🟡 Map view** — Clustered pins of the library / a memory on an OpenStreetMap-based map (self-hostable tiles or user-provided tile key).
- **S13.4 🟡 Manual location** — Set/fix location for assets or memories missing GPS (search place or drop pin).

## E14 — Sharing & Visibility

- **S14.1 🔴 Shared vs private memories** — Memories default shared to the household; a creator can mark one private (only they see it, including its inbox suggestions when derivable 🟢).
- **S14.2 🟡 Public share link** — Share a Memory or Album as a read-only public link: title, journal (opt-in), media in web sizes. *(Basic version shipped.)*
- **S14.2b 🟡 Share-link management (PhotoPrism-parity)** — Per-album/memory panel listing its links: create with optional **expiration**, toggle on/off (revoke + re-enable), copy, view counts, short URLs.
- **S14.3 🟢 Guest album upload** — A share link that accepts uploads ("drop your photos from the party here") into a review queue. **Deliberately the last feature on the roadmap** — it's the only public write path, so it ships after everything else is stable. *(Files land in a configurable library folder.)*

---

# Phase 3 — "Understand it"

## E15 — Semantic Search (CLIP)

- **S15.1 🔴 Image embeddings** — Every asset gets a CLIP embedding (ML sidecar, low-priority queue, resumable).
- **S15.2 🔴 Natural-language search** — "beach sunset", "kids in snow", "birthday cake" return ranked results blended with metadata/FTS results in the one search box.
  *AC:* pgvector HNSW; query embedded via sidecar; sub-second on 50k assets on target hardware.
- **S15.3 🟡 Similar photos** — "More like this" from the viewer.

## E16 — Smarter Clustering (Tier 2/3)

- **S16.1 🔴 People-aware clustering** — Overlapping people strengthen/repair event grouping.
- **S16.2 🟡 Visual-coherence refinement** — Embedding similarity splits mixed clusters ("hike + restaurant same afternoon") and joins fragmented ones.
- **S16.3 🟡 Trip detection** — Multi-day away-from-home spans roll up into a parent "Trip" memory containing day/event child memories.

## E17 — AI Assists (optional, local-first)

- **S17.1 🟡 Suggested titles/summaries** — Optional LLM (Ollama local, or user-keyed cloud) proposes a title/summary for a cluster; always shown as a suggestion to accept/edit, never auto-applied to user text.
- **S17.2 🟢 Journal prompts** — Gentle prompts on empty journals ("Who was there? What do you want to remember?"). Never generates fake memories.

---

# Phase 4 — "Your life"

## E18 — Resurfacing & Life Timeline

- **S18.1 🔴 On This Day** — Home-surface carousel + opt-in push of memories from past years.
- **S18.2 🟡 Year in review** — Auto-compiled yearly summary (top memories, people, places, stats) as a browsable story; exportable 🟢 as a PDF "yearbook."
- **S18.3 🟡 Person/place timelines** — "Emma over the years"; "Every trip to Maine."
- **S18.4 🟢 Life timeline** — The North Star view: zoomable years → months → memories.
- **S18.5 🟢 Import adapters** — Read-only import of PhotoPrism/Immich albums+people metadata, and Google Takeout JSON (dates/GPS sidecars), mapped onto existing in-place files by hash.

---

## Cross-cutting definition of done (every story)

1. Server-side authorization enforced (grant + admin flag), not just hidden UI.
2. Works on mobile viewport first; desktop enhanced.
3. Destructive paths: confirm → undo → audit.
4. Original files never modified except by explicit E5 operations.
5. Failure of ML/optional services never blocks the core path.
6. OpenAPI updated; Angular client regenerated; contract test passes.
