import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { asc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, eventCluster, eventClusterAsset, memoryAsset } from '../database/schema';
import { formatDateSpan } from './date-span';
import {
  CLUSTERING_ALGO_VERSION,
  ClusterInput,
  DetectedCluster,
  detectClusters,
} from './event-clustering';

/**
 * Regenerates Memory suggestions from Tier-1 signals. Only machine-owned rows
 * are touched: suggested clusters are rewritten wholesale; accepted and
 * dismissed clusters are never modified (data-model.md §1.2). A re-detected
 * cluster whose member set matches a dismissed one stays dismissed (S8.5).
 */
@Injectable()
export class EventDetectionService {
  private readonly logger = new Logger(EventDetectionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Full deterministic re-detection pass. Idempotent; safe to run repeatedly. */
  async detectEvents(): Promise<{ suggested: number }> {
    const candidates = await this.loadUnassignedAssets();
    const detected = detectClusters(candidates, {
      maxGapHours: this.config.clusterMaxGapHours,
      maxJumpKm: this.config.clusterMaxJumpKm,
      minClusterSize: this.config.clusterMinSize,
    });
    const preservedSignatures = await this.loadPreservedSignatures();
    const fresh = detected.filter(
      (cluster) => !preservedSignatures.has(this.signatureOf(cluster.assetIds)),
    );
    await this.replaceSuggestions(fresh);
    this.logger.log(`Event detection: ${fresh.length} suggestions from ${candidates.length} assets.`);
    return { suggested: fresh.length };
  }

  /** Active assets not already part of a Memory, oldest first. */
  private async loadUnassignedAssets(): Promise<ClusterInput[]> {
    return this.db
      .select({
        id: asset.id,
        capturedAt: asset.capturedAt,
        gpsLat: asset.gpsLat,
        gpsLon: asset.gpsLon,
      })
      .from(asset)
      .leftJoin(memoryAsset, eq(memoryAsset.assetId, asset.id))
      .where(sql`${asset.status} = 'active' and ${memoryAsset.assetId} is null`)
      .orderBy(asc(asset.capturedAt), asc(asset.id));
  }

  /** Signatures of clusters a human already ruled on — never resurface those. */
  private async loadPreservedSignatures(): Promise<Set<string>> {
    const rows = await this.db
      .select({ memberSignature: eventCluster.memberSignature })
      .from(eventCluster)
      .where(inArray(eventCluster.status, ['dismissed', 'accepted']));
    return new Set(rows.map((row) => row.memberSignature));
  }

  private async replaceSuggestions(clusters: DetectedCluster[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(eventCluster).where(eq(eventCluster.status, 'suggested'));
      for (const cluster of clusters) {
        const clusterId = uuidv7();
        await tx.insert(eventCluster).values({
          id: clusterId,
          algoVersion: CLUSTERING_ALGO_VERSION,
          status: 'suggested',
          startAt: cluster.startAt,
          endAt: cluster.endAt,
          seedTitle: formatDateSpan(cluster.startAt, cluster.endAt),
          score: cluster.score,
          signals: cluster.signals,
          memberSignature: this.signatureOf(cluster.assetIds),
        });
        await tx.insert(eventClusterAsset).values(
          cluster.assetIds.map((assetId) => ({ clusterId, assetId })),
        );
      }
    });
  }

  private signatureOf(assetIds: readonly string[]): string {
    return createHash('sha256').update([...assetIds].sort().join('|')).digest('hex');
  }
}
