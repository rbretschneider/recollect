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
  gpsLat: number | null;
  gpsLon: number | null;
  relPath: string | null;
  sizeBytes: number | null;
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
}
