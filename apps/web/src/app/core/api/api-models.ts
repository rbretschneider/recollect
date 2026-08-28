/** Mirrors the server's UserProfile. */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  permission: 'read' | 'write' | 'delete';
  isAdmin: boolean;
  mustChangePassword: boolean;
  personId: string | null;
  /** Present in the admin members list. */
  disabled?: boolean;
}

/** Mirrors the server's TimelineAsset. */
export interface TimelineAsset {
  id: string;
  mediaType: 'image' | 'video';
  capturedAt: string;
  capturedDay: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  hasThumbnail: boolean;
  /** Whether the signed-in user has hearted this photo. */
  isFavorite: boolean;
  // Card-view metadata — present on timeline responses, optional elsewhere
  // (viewer lists synthesized by other pages don't carry it).
  mime?: string;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lensModel?: string | null;
  iso?: number | null;
  exposureTime?: string | null;
  fNumber?: number | null;
  focalLength35?: number | null;
  takenBy?: string | null;
  fileName?: string | null;
  folder?: string | null;
  sizeBytes?: number | null;
  place?: string | null;
}

/**
 * Builds the minimal {@link TimelineAsset} the asset viewer needs from just an
 * id and media type. Pages that synthesize viewer lists (people, search, share,
 * contribute) use this instead of hand-writing the same placeholder literal, so
 * a new required field is added in exactly one place.
 */
export function toViewerAsset(
  id: string,
  mediaType: 'image' | 'video' = 'image',
  capturedAt = '',
): TimelineAsset {
  return {
    id,
    mediaType,
    capturedAt,
    capturedDay: capturedAt.slice(0, 10),
    width: null,
    height: null,
    durationMs: null,
    hasThumbnail: true,
    isFavorite: false,
  };
}

/** Mirrors the server's TimelinePage. */
export interface TimelinePage {
  items: TimelineAsset[];
  nextCursor: string | null;
}

/** Mirrors the server's LibraryRootView. */
export interface LibraryRootView {
  id: string;
  path: string;
  name: string;
  enabled: boolean;
  lastScanStartedAt: string | null;
  lastScanCompletedAt: string | null;
}

/** Mirrors the server's AssetDetail. */
export interface AssetDetail {
  id: string;
  mediaType: 'image' | 'video';
  mime: string;
  capturedAt: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  /** Who took it, per the camera→owner mapping in Settings. */
  takenBy: string | null;
  /** The mapped person's id, so "Taken by" can link to their page. */
  takenByPersonId: string | null;
  /** Name a guest gave when uploading this through a contribution link. */
  uploadedByGuest: string | null;
  /** True for 360° equirectangular panoramas (GPano metadata or filename). */
  isPhotosphere: boolean;
  isFavorite: boolean;
  gpsLat: number | null;
  gpsLon: number | null;
  relPath: string | null;
  rootId: string | null;
  sizeBytes: number | null;
  hasThumbnail: boolean;
  stageErrors: Record<string, string> | null;
}

/** Mirrors the server's InboxSuggestion. */
export interface InboxSuggestion {
  id: string;
  seedTitle: string;
  startAt: string;
  endAt: string;
  assetCount: number;
  previewAssetIds: string[];
  score: number;
}

/** Mirrors the server's MemorySummary. */
export interface MemorySummary {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  coverAssetId: string | null;
  assetCount: number;
  journalPreview: string | null;
  locationLabel: string | null;
}

/** Mirrors the server's JournalEntryView. */
export interface JournalEntryView {
  id: string;
  authorName: string;
  authorUserId: string;
  bodyMd: string;
  updatedAt: string;
}

/** Mirrors the server's MemoryDetail. */
export interface MemoryDetail {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  datePrecision: string;
  locationLabel: string | null;
  coverAssetId: string | null;
  assetIds: string[];
  /** Scrapbook captions keyed by asset id (only captioned photos appear). */
  captions: Record<string, string>;
  journal: JournalEntryView[];
  quotes: MemoryQuote[];
  people: MemoryPerson[];
  unnamedPeopleCount: number;
  gpsLat: number | null;
  gpsLon: number | null;
}

/** Someone recognized in a memory's photos; name null = not yet named. */
export interface MemoryPerson {
  id: string;
  name: string | null;
  coverFaceId: string;
  photoCount: number;
  /** True when they're here only as the photographer (device mapping). */
  behindCamera: boolean;
}

/** A "quote of the day": what was said and who said it. */
export interface MemoryQuote {
  id: string;
  text: string;
  saidBy: string;
  /** Linked Person, so the attribution can jump to their photos. */
  saidByPersonId: string | null;
}

/** Mirrors the server's AlbumSummary. */
export interface AlbumSummary {
  id: string;
  title: string;
  coverAssetId: string | null;
  assetCount: number;
  updatedAt: string;
  isPublic: boolean;
  hasGuestLink: boolean;
}

/** Mirrors the server's AlbumDetail. */
export interface AlbumDetail {
  id: string;
  title: string;
  description: string | null;
  coverAssetId: string | null;
  assetIds: string[];
}

/** Mirrors the server's ShareLinkView. */
export interface ShareLinkView {
  id: string;
  token: string;
  includeJournal: boolean;
  createdAt: string;
  expiresAt: string | null;
  viewCount: number;
}

/** Mirrors the server's SharedView. */
export interface SharedView {
  targetType: 'memory' | 'album' | 'asset';
  title: string;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  assetIds: string[];
  /** Same assets with media types, so viewers and slideshows play videos. */
  mediaItems: Array<{ id: string; mediaType: 'image' | 'video' }>;
  journal: Array<{ authorName: string; bodyMd: string }>;
  quotes: Array<{ text: string; saidBy: string }>;
  /** Named people in the memory — shown but NOT linkable on the public page. */
  people: Array<{ name: string; coverFaceId: string; behindCamera: boolean }>;
  /** Per-photo captions, woven into the public read just like the private one. */
  captions: Record<string, string>;
}

/** Mirrors the server's BrowseEntry. */
export interface BrowseEntry {
  name: string;
  path: string;
}

/** Mirrors the server's BrowseListing. */
export interface BrowseListing {
  path: string | null;
  entries: BrowseEntry[];
}

/** Mirrors the server's LibraryStatus. */
export interface LibraryStatus {
  totalAssets: number;
  thumbnailed: number;
  failedStages: number;
  queuedJobs: number;
  runningJobs: number;
  ingestPending: number;
  batchTotal: number;
  byType: Array<{ type: string; queued: number; running: number }>;
}

/** Mirrors the server's LibraryFailure. */
export interface LibraryFailure {
  name: string;
  reason: string;
}
