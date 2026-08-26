import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { appendFile, mkdir, rename, stat, unlink } from 'fs/promises';
import { join } from 'path';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const ROTATED_FILES_KEPT = 3;

/** The current log file name inside the logs directory. */
export const LOG_FILE_NAME = 'recollect.log';

/**
 * Console logging plus a rotating file (on by default — self-hosted users need
 * yesterday's errors, not just what's in the terminal). Rotates at 5MB keeping
 * three older files. Writes are serialized and never crash the app.
 */
export class RotatingFileLogger extends ConsoleLogger {
  private readonly logFilePath: string;
  private writeChain: Promise<void> = Promise.resolve();
  private approximateSize = 0;
  private isSizeKnown = false;

  constructor(private readonly logsDirectory: string) {
    super();
    this.logFilePath = join(logsDirectory, LOG_FILE_NAME);
  }

  override log(message: unknown, context?: string): void {
    super.log(message as string, context ?? '');
    this.append('LOG', message, context);
  }

  override error(message: unknown, stack?: string, context?: string): void {
    super.error(message as string, stack, context ?? '');
    this.append('ERROR', message, context, stack);
  }

  override warn(message: unknown, context?: string): void {
    super.warn(message as string, context ?? '');
    this.append('WARN', message, context);
  }

  override debug(message: unknown, context?: string): void {
    super.debug(message as string, context ?? '');
  }

  override setLogLevels(levels: LogLevel[]): void {
    super.setLogLevels(levels);
  }

  private append(level: string, message: unknown, context?: string, stack?: string): void {
    const line =
      `${new Date().toISOString()} ${level.padEnd(5)} ` +
      `${context ? `[${context}] ` : ''}${String(message)}${stack ? `\n${stack}` : ''}\n`;
    this.writeChain = this.writeChain
      .then(() => this.writeLine(line))
      .catch(() => undefined); // File logging must never take the app down.
  }

  private async writeLine(line: string): Promise<void> {
    if (!this.isSizeKnown) {
      await mkdir(this.logsDirectory, { recursive: true });
      this.approximateSize = await stat(this.logFilePath).then((s) => s.size).catch(() => 0);
      this.isSizeKnown = true;
    }
    if (this.approximateSize + line.length > MAX_LOG_BYTES) {
      await this.rotate();
      this.approximateSize = 0;
    }
    await appendFile(this.logFilePath, line, 'utf8');
    this.approximateSize += line.length;
  }

  private async rotate(): Promise<void> {
    await unlink(`${this.logFilePath}.${ROTATED_FILES_KEPT}`).catch(() => undefined);
    for (let index = ROTATED_FILES_KEPT - 1; index >= 1; index--) {
      await rename(`${this.logFilePath}.${index}`, `${this.logFilePath}.${index + 1}`).catch(
        () => undefined,
      );
    }
    await rename(this.logFilePath, `${this.logFilePath}.1`).catch(() => undefined);
  }
}
