import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, eventCluster, eventClusterAsset, memory, memoryAsset } from '../database/schema';

/** A Memory suggestion card for the inbox. */
export interface InboxSuggestion {
  id: string;
  seedTitle: string;
  startAt: string;
  endAt: string;
  assetCount: number;
  /** Up to four asset ids for the cover mosaic. */
  previewAssetIds: string[];
  score: number;
}

const PREVIEW_ASSET_COUNT = 4;

/**
 * The Memory Inbox: suggested clusters and the human decisions on them.
 * Accepting copies membership into a human-owned Memory (data-model.md §1.2).
 */
@Injectable()
export class InboxService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listSuggestions(): Promise<InboxSuggestion[]> {
    const clusters = await this.db
      .select()
      .from(eventCluster)
      .where(eq(eventCluster.status, 'suggested'))
      .orderBy(desc(eventCluster.startAt));
    const suggestions: InboxSuggestion[] = [];
    for (const cluster of clusters) {
      const memberIds = await this.loadMemberIdsOldestFirst(cluster.id);
      suggestions.push({
        id: cluster.id,
        seedTitle: cluster.seedTitle,
        startAt: cluster.startAt.toISOString(),
        endAt: cluster.endAt.toISOString(),
        assetCount: memberIds.length,
        previewAssetIds: memberIds.slice(0, PREVIEW_ASSET_COUNT),
        score: cluster.score,
      });
    }
    return suggestions;
  }

  /** Full member list of one suggestion, for the preview grid. */
  async getSuggestionAssets(clusterId: string): Promise<string[]> {
    await this.requireSuggested(clusterId);
    return this.loadMemberIdsOldestFirst(clusterId);
  }

  /** Accepts a suggestion into a Memory owned by the accepting user. */
  async accept(clusterId: string, userId: string, title?: string): Promise<{ memoryId: string }> {
    const cluster = await this.requireSuggested(clusterId);
    const memberIds = await this.loadMemberIdsOldestFirst(clusterId);
    const memoryId = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(memory).values({
        id: memoryId,
        title: title?.trim() || cluster.seedTitle,
        startAt: cluster.startAt,
        endAt: cluster.endAt,
        coverAssetId: memberIds[0] ?? null,
        createdBy: userId,
      });
      if (memberIds.length > 0) {
        await tx.insert(memoryAsset).values(
          memberIds.map((assetId, index) => ({
            memoryId,
            assetId,
            sortOrder: index,
            addedBy: userId,
          })),
        );
      }
      await tx
        .update(eventCluster)
        .set({ status: 'accepted', acceptedMemoryId: memoryId, updatedAt: new Date() })
        .where(eq(eventCluster.id, clusterId));
    });
    return { memoryId };
  }

  /** Dismisses a suggestion; an identical re-detection will not resurface (S8.5). */
  async dismiss(clusterId: string): Promise<void> {
    await this.requireSuggested(clusterId);
    await this.db
      .update(eventCluster)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(eq(eventCluster.id, clusterId));
  }

  /** Merges several suggestions into one Memory (S8.3). */
  async merge(
    clusterIds: string[],
    userId: string,
    title?: string,
  ): Promise<{ memoryId: string }> {
    const clusters = await this.db
      .select()
      .from(eventCluster)
      .where(inArray(eventCluster.id, clusterIds));
    if (clusters.length !== clusterIds.length || clusters.some((c) => c.status !== 'suggested')) {
      throw new NotFoundException('One of those suggestions is no longer available.');
    }
    const memberRows = await this.db
      .select({ assetId: eventClusterAsset.assetId, capturedAt: asset.capturedAt })
      .from(eventClusterAsset)
      .innerJoin(asset, eq(asset.id, eventClusterAsset.assetId))
      .where(inArray(eventClusterAsset.clusterId, clusterIds))
      .orderBy(asc(asset.capturedAt), asc(asset.id));
    const memberIds = [...new Set(memberRows.map((row) => row.assetId))];
    const startAt = new Date(Math.min(...clusters.map((c) => c.startAt.getTime())));
    const endAt = new Date(Math.max(...clusters.map((c) => c.endAt.getTime())));
    const memoryId = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(memory).values({
        id: memoryId,
        title: title?.trim() || clusters[0].seedTitle,
        startAt,
        endAt,
        coverAssetId: memberIds[0] ?? null,
        createdBy: userId,
      });
      await tx.insert(memoryAsset).values(
        memberIds.map((assetId, index) => ({ memoryId, assetId, sortOrder: index, addedBy: userId })),
      );
      await tx
        .update(eventCluster)
        .set({ status: 'accepted', acceptedMemoryId: memoryId, updatedAt: new Date() })
        .where(inArray(eventCluster.id, clusterIds));
    });
    return { memoryId };
  }

  private async requireSuggested(clusterId: string): Promise<typeof eventCluster.$inferSelect> {
    const [cluster] = await this.db
      .select()
      .from(eventCluster)
      .where(eq(eventCluster.id, clusterId))
      .limit(1);
    if (!cluster || cluster.status !== 'suggested') {
      throw new NotFoundException('That suggestion is no longer available.');
    }
    return cluster;
  }

  private async loadMemberIdsOldestFirst(clusterId: string): Promise<string[]> {
    const rows = await this.db
      .select({ assetId: eventClusterAsset.assetId })
      .from(eventClusterAsset)
      .innerJoin(asset, eq(asset.id, eventClusterAsset.assetId))
      .where(eq(eventClusterAsset.clusterId, clusterId))
      .orderBy(asc(asset.capturedAt), asc(asset.id));
    return rows.map((row) => row.assetId);
  }
}
