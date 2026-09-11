import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { promisify } from 'util';
import { MediaTypeInfo } from './media-types';
import { probeDurationSeconds } from './probe-duration';
import { ThumbnailStore, THUMBNAIL_SIZES } from './thumbnail-store';

const execFileAsync = promisify(execFile);

/** Grid tiles (240) read fine at q68 and halve the grid's byte weight. */
const WEBP_QUALITY_BY_SIZE: Record<number, number> = { 240: 68, 720: 80, 1440: 80 };
const VIDEO_POSTER_SEEK_SECONDS = 1;
/** Where in the video the poster is taken from: a fifth of the way through. */
const VIDEO_POSTER_FRACTION = 0.2;
/** Below this length there is no leader to skip; a second in is fine. */
const VIDEO_POSTER_MIN_SECONDS_FOR_SEEK = 5;
/** Frames the thumbnail filter samples to pick a representative one. */
const VIDEO_POSTER_SAMPLE_FRAMES = 30;
const FFMPEG_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
/** A poster extraction that hasn't produced a frame by now is hung on hostile input. */
const FFMPEG_TIMEOUT_MS = 30_000;
/**
 * Hard ceiling on decoded pixels (~100MP). Blocks decompression bombs — a tiny
 * file that expands to a multi-gigapixel raster — while still clearing real
 * phone photos and generous panoramas. Untrusted guest uploads hit this path.
 */
const SHARP_MAX_PIXELS = 100_000_000;

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
    const pipeline = sharp(source, {
      failOn: 'truncated',
      limitInputPixels: SHARP_MAX_PIXELS,
    }).rotate();
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
    await sharp(source, { failOn: 'truncated', limitInputPixels: SHARP_MAX_PIXELS })
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toFile(outPath);
  }

  private async extractVideoPoster(absolutePath: string): Promise<Buffer> {
    // The opening of a video is the worst place to look for a picture of it:
    // black on phone clips, minutes of grey leader on digitised tapes. So aim
    // a fifth of the way in - far enough past any leader, early enough to
    // still be "the start" for a long recording - and let ffmpeg's thumbnail
    // filter pick the most representative of the next 30 frames, so a lone
    // dark frame at that spot doesn't win either. Short clips and files whose
    // length can't be read fall back to a second in, then the first frame.
    const duration = await probeDurationSeconds(absolutePath);
    if (duration !== null && duration > VIDEO_POSTER_MIN_SECONDS_FOR_SEEK) {
      const representative = await this.extractFrame(absolutePath, duration * VIDEO_POSTER_FRACTION, true);
      if (representative.length > 0) {
        return representative;
      }
    }
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

  private async extractFrame(
    absolutePath: string,
    seekSeconds: number,
    representative = false,
  ): Promise<Buffer> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg binary is not available on this platform.');
    }
    try {
      const { stdout } = await execFileAsync(
        ffmpegPath,
        [
          // Restrict input to the local-file protocol: a "video" whose bytes are
          // really an HLS/concat playlist can otherwise make ffmpeg fetch
          // file:/http: URLs of the attacker's choosing (LFI/SSRF). -nostdin
          // stops it blocking on a prompt for a truncated input.
          '-nostdin',
          '-protocol_whitelist', 'file',
          '-ss', String(seekSeconds),
          '-i', absolutePath,
          // thumbnail=N buffers N frames and emits the one closest to their
          // average - the "typical" frame of that stretch, not whatever the
          // seek happened to land on.
          ...(representative ? ['-vf', `thumbnail=${VIDEO_POSTER_SAMPLE_FRAMES}`] : []),
          '-frames:v', '1',
          '-f', 'image2pipe',
          '-vcodec', 'png',
          '-',
        ],
        { encoding: 'buffer', maxBuffer: FFMPEG_MAX_BUFFER_BYTES, timeout: FFMPEG_TIMEOUT_MS },
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
