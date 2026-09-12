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

  /**
   * Brings the suggested set in line with what was just detected WITHOUT
   * renaming anything that didn't change.
   *
   * This used to delete every suggestion and re-insert them all with fresh
   * ids - and it runs after every ingest and every scan, ~480 times a day on
   * the live library. Any suggestion on screen was invalid within minutes:
   * tapping Create or Dismiss hit an id that no longer existed, while the
   * identical cluster sat in the table under a new one. "That suggestion is
   * no longer available" for something you were looking at.
   *
   * A cluster is identified by its member signature. Same members: the row
   * is kept (its dates and score refreshed) and its id survives. New members:
   * inserted. No longer detected: removed. Ids only change when the cluster
   * itself does.
   */
  private async replaceSuggestions(clusters: DetectedCluster[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: eventCluster.id, memberSignature: eventCluster.memberSignature })
        .from(eventCluster)
        .where(eq(eventCluster.status, 'suggested'));
      const idBySignature = new Map(existing.map((row) => [row.memberSignature, row.id]));
      const kept = new Set<string>();
      for (const cluster of clusters) {
        const signature = this.signatureOf(cluster.assetIds);
        const known = idBySignature.get(signature);
        if (known) {
          kept.add(known);
          await tx
            .update(eventCluster)
            .set({
              algoVersion: CLUSTERING_ALGO_VERSION,
              startAt: cluster.startAt,
              endAt: cluster.endAt,
              seedTitle: formatDateSpan(cluster.startAt, cluster.endAt),
              score: cluster.score,
              signals: cluster.signals,
              updatedAt: new Date(),
            })
            .where(eq(eventCluster.id, known));
          continue;
        }
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
          memberSignature: signature,
        });
        await tx.insert(eventClusterAsset).values(
          cluster.assetIds.map((assetId) => ({ clusterId, assetId })),
        );
      }
      const stale = existing.filter((row) => !kept.has(row.id)).map((row) => row.id);
      if (stale.length > 0) {
        await tx.delete(eventCluster).where(inArray(eventCluster.id, stale));
      }
    });
  }

  private signatureOf(assetIds: readonly string[]): string {
    return createHash('sha256').update([...assetIds].sort().join('|')).digest('hex');
  }
}
