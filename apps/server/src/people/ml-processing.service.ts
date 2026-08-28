import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { DATABASE } from '../database/database.module';
import type { Database } from '../database/database.module';
import { asset, assetEmbedding, face, person } from '../database/schema';
import { MlClientService } from '../ml/ml-client.service';
import { ThumbnailStore } from '../media/thumbnail-store';

/** Thumbnail edge sent to the sidecar — plenty for detection, cheap to move. */
const ML_INPUT_SIZE = 720 as const;

/**
 * Runs the ML stages for one asset: face detection with incremental person
 * clustering, and CLIP image embedding. Failures mark the asset's stage error
 * and never block anything else (FRD: ML is isolated and optional).
 */
@Injectable()
export class MlProcessingService {
  private readonly logger = new Logger(MlProcessingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly ml: MlClientService,
    private readonly thumbnails: ThumbnailStore,
  ) {}

  /**
   * ML reads the 720 thumbnail; without one (thumbnailing failed for this
   * file) there is nothing to analyze. The job completes quietly — the scan
   * backfill only re-queues ML once a thumbnail exists, so a later thumbnail
   * fix (reprocess) picks these up again automatically.
   */
  private async skipWhenThumbMissing(assetId: string, stage: 'faces' | 'embed'): Promise<boolean> {
    const [row] = await this.db
      .select({ stageThumbsAt: asset.stageThumbsAt })
      .from(asset)
      .where(eq(asset.id, assetId))
      .limit(1);
    if (!row || row.stageThumbsAt !== null) {
      return false;
    }
    this.logger.warn(`Asset ${assetId} has no thumbnail; skipping ${stage} stage.`);
    return true;
  }

  /** Detects faces, stores embeddings, and clusters each into a Person. */
  async processFaces(assetId: string): Promise<void> {
    if (await this.skipWhenThumbMissing(assetId, 'faces')) {
      return;
    }
    const thumbPath = this.thumbnails.pathFor(assetId, ML_INPUT_SIZE);
    const result = await this.ml.detectFaces(thumbPath);
    const sentDims = await sharp(thumbPath).metadata();
    const width = sentDims.width ?? 1;
    const height = sentDims.height ?? 1;
    for (const detected of result.faces) {
      const [x1, y1, x2, y2] = detected.bbox;
      const faceId = uuidv7();
      // Only attribute confident detections to a person. A borderline one (a
      // pet, a cushion, a tiny background head) is still recorded but left
      // unassigned, so it can never snap onto whoever has the most photos.
      const personId =
        detected.score >= this.config.faceMinClusterScore
          ? await this.clusterIntoPerson(detected.embedding)
          : null;
      await this.db.insert(face).values({
        id: faceId,
        assetId,
        personId,
        bbox: [x1 / width, y1 / height, (x2 - x1) / width, (y2 - y1) / height],
        quality: detected.score,
        embedding: detected.embedding,
        embedModel: result.model,
      });
    }
    await this.db
      .update(asset)
      .set({ stageFacesAt: new Date(), updatedAt: new Date() })
      .where(eq(asset.id, assetId));
  }

  /** CLIP-embeds the asset for semantic search. */
  async processClipEmbedding(assetId: string): Promise<void> {
    if (await this.skipWhenThumbMissing(assetId, 'embed')) {
      return;
    }
    const thumbPath = this.thumbnails.pathFor(assetId, ML_INPUT_SIZE);
    const result = await this.ml.embedImage(thumbPath);
    if (result.embedding.length > 0) {
      await this.db
        .insert(assetEmbedding)
        .values({ assetId, model: result.model, embedding: result.embedding })
        .onConflictDoUpdate({
          target: [assetEmbedding.assetId, assetEmbedding.model],
          set: { embedding: result.embedding },
        });
    }
    await this.db
      .update(asset)
      .set({ stageEmbedAt: new Date(), updatedAt: new Date() })
      .where(eq(asset.id, assetId));
  }

  /**
   * Incremental greedy clustering: join the person of the nearest existing
   * face when it's close enough, otherwise start a new unnamed person.
   */
  /**
   * Public so disbanding a bad cluster can re-cluster its faces one by one.
   * excludePersonId keeps a face REMOVED from a person from snapping straight
   * back to it (its nearest neighbors are usually its old cluster).
   */
  async clusterIntoPerson(embedding: number[], excludePersonId?: string): Promise<string> {
    const vectorLiteral = JSON.stringify(embedding);
    const nearest = await this.db.execute(sql`
      SELECT f.person_id, f.embedding <=> ${vectorLiteral}::vector AS distance
      FROM face f
      JOIN person p ON p.id = f.person_id AND p.merged_into_id IS NULL
      WHERE f.person_id IS NOT NULL AND f.ignored = false
        ${excludePersonId ? sql`AND f.person_id != ${excludePersonId}` : sql``}
      ORDER BY f.embedding <=> ${vectorLiteral}::vector
      LIMIT 1
    `);
    const hit = nearest.rows[0] as { person_id: string; distance: number } | undefined;
    if (hit && Number(hit.distance) < this.config.faceClusterDistance) {
      return hit.person_id;
    }
    const personId = uuidv7();
    await this.db.insert(person).values({ id: personId });
    return personId;
  }
}
