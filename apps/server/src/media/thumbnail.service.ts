import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { promisify } from 'util';
import { MediaTypeInfo } from './media-types';
import { ThumbnailStore, THUMBNAIL_SIZES } from './thumbnail-store';

const execFileAsync = promisify(execFile);

/** Grid tiles (240) read fine at q68 and halve the grid's byte weight. */
const WEBP_QUALITY_BY_SIZE: Record<number, number> = { 240: 68, 720: 80, 1440: 80 };
const VIDEO_POSTER_SEEK_SECONDS = 1;
const FFMPEG_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** Pixel dimensions discovered while generating thumbnails. */
export interface RenderedDimensions {
  width: number;
  height: number;
}

/**
 * Generates webp thumbnails at every {@link THUMBNAIL_SIZES} edge via sharp
 * (libvips). Video posters are extracted with ffmpeg, then run through the same
 * pipeline. Originals are only ever read (FRD story S3.2).
 */
@Injectable()
export class ThumbnailService {
  constructor(private readonly store: ThumbnailStore) {}

  /** Generates all sizes for an asset; returns the source's true dimensions. */
  async generateAll(
    assetId: string,
    absolutePath: string,
    typeInfo: MediaTypeInfo,
  ): Promise<RenderedDimensions> {
    const source =
      typeInfo.mediaType === 'video' ? await this.extractVideoPoster(absolutePath) : absolutePath;
    await this.store.ensureDirectoryFor(assetId);
    try {
      return await this.renderSizes(assetId, source);
    } catch (error) {
      // Formats this libvips can't decode (old scanned BMPs, oddball TIFFs):
      // ffmpeg reads almost anything — extract one frame and thumbnail that.
      if (typeInfo.mediaType !== 'image') {
        throw error;
      }
      const frame = await this.extractFrame(absolutePath, 0);
      if (frame.length === 0) {
        throw error;
      }
      return this.renderSizes(assetId, frame);
    }
  }

  private async renderSizes(
    assetId: string,
    source: string | Buffer,
  ): Promise<RenderedDimensions> {
    const pipeline = sharp(source, { failOn: 'truncated' }).rotate();
    const metadata = await pipeline.metadata();
    await Promise.all(
      THUMBNAIL_SIZES.map((size) =>
        pipeline
          .clone()
          .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: WEBP_QUALITY_BY_SIZE[size] ?? 80 })
          .toFile(this.store.pathFor(assetId, size)),
      ),
    );
    return this.orientedDimensions(metadata);
  }

  /**
   * Renders a single review-sized webp for a file that is NOT (yet) an asset —
   * used by guest-upload quarantine. Decoding doubles as validation: a file
   * that claims to be media but isn't fails here and gets rejected.
   */
  async renderPreview(
    absolutePath: string,
    typeInfo: MediaTypeInfo,
    outPath: string,
    edge = 480,
  ): Promise<void> {
    const source =
      typeInfo.mediaType === 'video' ? await this.extractVideoPoster(absolutePath) : absolutePath;
    await sharp(source, { failOn: 'truncated' })
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(outPath);
  }

  private async extractVideoPoster(absolutePath: string): Promise<Buffer> {
    // Prefer a frame past the first second (first frames are often black),
    // but clips shorter than that need the very first frame instead.
    const frameAtOneSecond = await this.extractFrame(absolutePath, VIDEO_POSTER_SEEK_SECONDS);
    if (frameAtOneSecond.length > 0) {
      return frameAtOneSecond;
    }
    const firstFrame = await this.extractFrame(absolutePath, 0);
    if (firstFrame.length === 0) {
      throw new Error('ffmpeg produced no poster frame (tried 1s and 0s).');
    }
    return firstFrame;
  }

  private async extractFrame(absolutePath: string, seekSeconds: number): Promise<Buffer> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg binary is not available on this platform.');
    }
    try {
      const { stdout } = await execFileAsync(
        ffmpegPath,
        [
          '-ss', String(seekSeconds),
          '-i', absolutePath,
          '-frames:v', '1',
          '-f', 'image2pipe',
          '-vcodec', 'png',
          '-',
        ],
        { encoding: 'buffer', maxBuffer: FFMPEG_MAX_BUFFER_BYTES },
      );
      return stdout;
    } catch {
      return Buffer.alloc(0); // A failed seek is "no frame", not a hard error yet.
    }
  }

  /** Sharp reports pre-rotation dimensions; swap when EXIF orientation turns the image. */
  private orientedDimensions(metadata: sharp.Metadata): RenderedDimensions {
    const isTurned = (metadata.orientation ?? 1) >= 5;
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    return isTurned ? { width: height, height: width } : { width, height };
  }
}
