import { BadRequestException, Controller, Get, Inject, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { open, stat } from 'fs/promises';
import { join } from 'path';
import { RequireAdmin } from '../auth/decorators/require-admin.decorator';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { LOG_FILE_NAME } from '../logging/rotating-file-logger';

const DEFAULT_TAIL_LINES = 500;
const MAX_TAIL_LINES = 2000;
const TAIL_READ_BYTES = 512 * 1024;

/** Self-hosting introspection: the app's own logs, viewable and downloadable. */
@RequireAdmin()
@Controller('system')
export class SystemController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('logs')
  async tail(@Query('lines') lines?: string): Promise<{ lines: string[] }> {
    const requested = lines === undefined ? DEFAULT_TAIL_LINES : Number(lines);
    if (!Number.isInteger(requested) || requested < 1 || requested > MAX_TAIL_LINES) {
      throw new BadRequestException(`lines must be an integer between 1 and ${MAX_TAIL_LINES}.`);
    }
    return { lines: await this.readTail(requested) };
  }

  @Get('logs/download')
  download(@Res() res: Response): void {
    res.download(this.logFilePath(), LOG_FILE_NAME, (error) => {
      if (error && !res.headersSent) {
        res.status(404).json({ message: 'No log file yet.' });
      }
    });
  }

  private logFilePath(): string {
    return join(this.config.appDataDir, 'logs', LOG_FILE_NAME);
  }

  /** Reads the last N lines from the tail of the current log file. */
  private async readTail(requestedLines: number): Promise<string[]> {
    const path = this.logFilePath();
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch {
      return [];
    }
    const readBytes = Math.min(size, TAIL_READ_BYTES);
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(readBytes);
      await handle.read(buffer, 0, readBytes, size - readBytes);
      return buffer
        .toString('utf8')
        .split('\n')
        .filter((line) => line.length > 0)
        .slice(-requestedLines);
    } finally {
      await handle.close();
    }
  }
}
