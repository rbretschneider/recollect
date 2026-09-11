import { execFile } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * A media file's duration in seconds, read from ffmpeg's own probe output (we
 * ship ffmpeg, not ffprobe). Null when the file has no readable duration - a
 * truncated or corrupt file prints no "Duration:" line.
 */
export async function probeDurationSeconds(path: string): Promise<number | null> {
  if (!ffmpegPath) {
    return null;
  }
  let stderr = '';
  try {
    // No output target: ffmpeg exits non-zero after printing stream info, and
    // the duration is on stderr either way.
    await execFileAsync(ffmpegPath, ['-nostdin', '-hide_banner', '-i', path], {
      maxBuffer: 64 * 1024 * 1024,
      timeout: 60_000,
    });
  } catch (error) {
    stderr = String((error as { stderr?: string }).stderr ?? '');
  }
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
