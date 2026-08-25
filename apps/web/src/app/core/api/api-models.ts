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

/** Mirrors the server's LibraryStatus. */
export interface LibraryStatus {
  totalAssets: number;
  thumbnailed: number;
  failedStages: number;
  queuedJobs: number;
  runningJobs: number;
}
