import { Inject, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { mkdir, rename } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';

const execFileAsync = promisify(execFile);

/** Old containers can spew megabytes of warnings; never let stderr kill the job. */
const FFMPEG_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
/**
 * Wall-clock backstop. A transcode still running after this is hung on hostile
 * input, not making progress — kill it so it can't pin a worker forever. Set
 * generously so a genuinely long home video (2 threads, veryfast) finishes; a
 * content-length cap (-t) is deliberately NOT used, as it would silently
 * truncate the family's own long recordings.
 */
const FFMPEG_TIMEOUT_MS = 2 * 60 * 60_000;

/** ffmpeg messages that mean the SOURCE file is broken, not the transcode. */
const CORRUPT_SOURCE_MARKERS = [
  'moov atom not found',
  'Invalid data found when processing input',
  'Header missing',
];

/** The source video itself is damaged/incomplete — retrying can never help. */
export class CorruptSourceError extends Error {
  constructor(sourcePath: string) {
    super(`Source video is incomplete or damaged: ${sourcePath}`);
    this.name = 'CorruptSourceError';
  }
}

/** Codec ids browsers decode natively — these stream as the original file. */
const WEB_SAFE_VIDEO_CODECS = new Set(['avc1', 'avc3', 'h264', 'vp08', 'vp8', 'vp09', 'vp9', 'av01']);

/** Whether a container codec id needs transcoding for browser playback. */
export function isWebSafeVideoCodec(codec: string | null): boolean {
  return codec !== null && WEB_SAFE_VIDEO_CODECS.has(codec);
}

/**
 * One-time H.264 playback renditions for videos browsers can't decode (HEVC
 * phone footage being the big one). Re-encoding auto-applies the rotation
 * display matrix, so orientation is baked in correctly — never sideways.
 */
@Injectable()
export class TranscodeService {
  private readonly logger = new Logger(TranscodeService.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Cache location of an asset's playback rendition. */
  playbackPathFor(assetId: string): string {
    return join(this.config.appDataDir, 'playback', assetId.slice(0, 2), `${assetId}.mp4`);
  }

  /** Transcodes to H.264/AAC; writes atomically so partial files never serve. */
  async createPlaybackRendition(assetId: string, sourcePath: string): Promise<void> {
    if (!ffmpegPath) {
      throw new Error('ffmpeg binary is not available on this platform.');
    }
    const destination = this.playbackPathFor(assetId);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.part.mp4`;
    this.logger.log(`Transcoding ${sourcePath} for playback…`);
    // Threads stay capped (TRANSCODE_THREADS, default 2): ffmpeg defaults to
    // every core, which starves playback streaming on busy self-hosted boxes.
    try {
      await execFileAsync(
        ffmpegPath,
        [
          '-y',
          '-nostdin',
          // Untrusted guest video reaches this path; keep ffmpeg on local files
          // only so a disguised HLS/concat playlist can't fetch file:/http: URLs.
          '-protocol_whitelist', 'file',
          '-loglevel', 'error',
          '-threads', String(this.config.transcodeThreads),
          '-i', sourcePath,
          '-map_metadata', '0',
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '23',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac',
          '-movflags', '+faststart',
          temporary,
        ],
        { maxBuffer: FFMPEG_MAX_BUFFER_BYTES, timeout: FFMPEG_TIMEOUT_MS },
      );
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (CORRUPT_SOURCE_MARKERS.some((marker) => message.includes(marker))) {
        throw new CorruptSourceError(sourcePath);
      }
      throw error;
    }
    await rename(temporary, destination);
  }
}
