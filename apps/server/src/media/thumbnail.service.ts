import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { promisify } from 'util';
import { MediaTypeInfo } from './media-types';
import { ThumbnailStore, THUMBNAIL_SIZES } from './thumbnail-store';

const execFileAsync = promisify(execFile);

const WEBP_QUALITY = 80;
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
    const pipeline = sharp(source, { failOn: 'truncated' }).rotate();
    const metadata = await pipeline.metadata();
    for (const size of THUMBNAIL_SIZES) {
      await pipeline
        .clone()
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY })
        .toFile(this.store.pathFor(assetId, size));
    }
    return this.orientedDimensions(metadata);
  }

  private async extractVideoPoster(absolutePath: string): Promise<Buffer> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg binary is not available on this platform.');
    }
    const { stdout } = await execFileAsync(
      ffmpegPath,
      [
        '-ss', String(VIDEO_POSTER_SEEK_SECONDS),
        '-i', absolutePath,
        '-frames:v', '1',
        '-f', 'image2pipe',
        '-vcodec', 'png',
        '-',
      ],
      { encoding: 'buffer', maxBuffer: FFMPEG_MAX_BUFFER_BYTES },
    );
    if (stdout.length === 0) {
      throw new Error('ffmpeg produced no poster frame.');
    }
    return stdout;
  }

  /** Sharp reports pre-rotation dimensions; swap when EXIF orientation turns the image. */
  private orientedDimensions(metadata: sharp.Metadata): RenderedDimensions {
    const isTurned = (metadata.orientation ?? 1) >= 5;
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    return isTurned ? { width: height, height: width } : { width, height };
  }
}
