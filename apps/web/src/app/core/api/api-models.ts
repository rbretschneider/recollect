/** Mirrors the server's UserProfile. */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  permission: 'read' | 'write' | 'delete';
  isAdmin: boolean;
  mustChangePassword: boolean;
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
  journal: JournalEntryView[];
  quotes: MemoryQuote[];
  gpsLat: number | null;
  gpsLon: number | null;
}

/** A "quote of the day": what was said and who said it. */
export interface MemoryQuote {
  id: string;
  text: string;
  saidBy: string;
}

/** Mirrors the server's AlbumSummary. */
export interface AlbumSummary {
  id: string;
  title: string;
  coverAssetId: string | null;
  assetCount: number;
  updatedAt: string;
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
  targetType: 'memory' | 'album';
  title: string;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  assetIds: string[];
  journal: Array<{ authorName: string; bodyMd: string }>;
  quotes: Array<{ text: string; saidBy: string }>;
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
}

/** Mirrors the server's LibraryFailure. */
export interface LibraryFailure {
  name: string;
  reason: string;
}
