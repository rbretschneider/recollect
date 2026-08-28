# Recollect — repo rules

## The prime directive: speed of viewing

**Speed of viewing the info a user wants is paramount.** The content the user
came for renders first, immediately, always. Nothing decorative — music,
animations, metadata, ML results, secondary panels — may ever gate or delay
the primary content. Enhancements attach themselves when they're ready
(fire-and-forget, never awaited on the critical path), and if they fail they
fail silently. When in doubt: show the photos now, garnish later.

Corollaries already in force:
- Slideshows start on tap; background music joins whenever it's buffered.
- Grids render from cached thumbnails; detail/ML data hydrates after.
- A failed enhancement (geocode, faces, transcode) never blocks the photo.

## Other standing rules

- Runs on home servers and slow connections, used from anywhere: SQL speed,
  indexes, payload size, and loading states are features, not polish.
- Three-signal async feedback: every user-triggered action shows immediate
  acknowledgement, live progress, and completion/failure.
- Wife Approval: intuitive, no jargon, nothing destructive without
  undo/confirm. "Remove" takes things out of collections; "delete" is real
  and goes through Trash.
- Edit mode is explicit and app-wide: read-only until the pencil is tapped.
- Sheets/drawers portal to <body>; one consistent modal language.
- Originals live on the NAS; the app-data volume holds only derived,
  regenerable caches.
- Deploy loop: build ON hawaii from the GitHub tarball; commit+push+deploy
  after each verified change.
