import { haversineKm } from './haversine';

/** The metadata Tier-1 clustering needs about one asset. */
export interface ClusterInput {
  id: string;
  capturedAt: Date;
  gpsLat: number | null;
  gpsLon: number | null;
}

/** Tunable thresholds for Tier-1 segmentation. */
export interface ClusteringConfig {
  /** A time gap larger than this starts a new event. */
  maxGapHours: number;
  /** A geographic jump larger than this starts a new event, even within the gap. */
  maxJumpKm: number;
  /** Groups smaller than this are not events (stray one-off shots). */
  minClusterSize: number;
}

/** A detected candidate event. */
export interface DetectedCluster {
  assetIds: string[];
  startAt: Date;
  endAt: Date;
  /** 0..1 confidence used for inbox ordering. */
  score: number;
  signals: { memberCount: number; spanHours: number };
}

/** Bump when segmentation logic changes; stored on every cluster row. */
export const CLUSTERING_ALGO_VERSION = 1;

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const FULL_SCORE_MEMBER_COUNT = 12;

/**
 * Tier-1 event detection (FRD story S7.1): deterministic time-gap segmentation
 * refined by GPS jumps. Same input always yields the same clusters, so the
 * detection job can regenerate suggestions idempotently.
 */
export function detectClusters(
  assetsOldestFirst: readonly ClusterInput[],
  config: ClusteringConfig,
): DetectedCluster[] {
  const segments: ClusterInput[][] = [];
  let current: ClusterInput[] = [];
  for (const item of assetsOldestFirst) {
    if (current.length > 0 && startsNewEvent(current[current.length - 1], item, config)) {
      segments.push(current);
      current = [];
    }
    current.push(item);
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments
    .filter((segment) => segment.length >= config.minClusterSize)
    .map((segment) => toCluster(segment));
}

function startsNewEvent(
  previous: ClusterInput,
  next: ClusterInput,
  config: ClusteringConfig,
): boolean {
  const gapHours = (next.capturedAt.getTime() - previous.capturedAt.getTime()) / MILLISECONDS_PER_HOUR;
  if (gapHours > config.maxGapHours) {
    return true;
  }
  return geoJumpExceeds(previous, next, config.maxJumpKm);
}

function geoJumpExceeds(previous: ClusterInput, next: ClusterInput, maxJumpKm: number): boolean {
  if (
    previous.gpsLat === null ||
    previous.gpsLon === null ||
    next.gpsLat === null ||
    next.gpsLon === null
  ) {
    return false;
  }
  return haversineKm(previous.gpsLat, previous.gpsLon, next.gpsLat, next.gpsLon) > maxJumpKm;
}

function toCluster(segment: ClusterInput[]): DetectedCluster {
  const startAt = segment[0].capturedAt;
  const endAt = segment[segment.length - 1].capturedAt;
  const spanHours = (endAt.getTime() - startAt.getTime()) / MILLISECONDS_PER_HOUR;
  return {
    assetIds: segment.map((item) => item.id),
    startAt,
    endAt,
    score: Math.min(1, segment.length / FULL_SCORE_MEMBER_COUNT),
    signals: { memberCount: segment.length, spanHours: Math.round(spanHours * 10) / 10 },
  };
}
