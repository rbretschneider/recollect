import { ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';

/**
 * Writes every failed request to the log, not just the 500s.
 *
 * NestJS's default filter logs a 5xx and stays silent on a 4xx - the client
 * asked for something impossible, so it's the client's problem. On a
 * self-hosted app the person reading the log IS the client, and "create
 * memory failed, no reason why, nothing in the log" is exactly what that
 * silence produces. So a 4xx is logged as a WARN with the route and the
 * reason. 401s are skipped: the token refresh cycle produces them by design.
 * The response itself is unchanged - BaseExceptionFilter still builds it.
 */
@Catch()
export class HttpExceptionLogFilter extends BaseExceptionFilter {
  private readonly log = new Logger('HTTP');

  override catch(exception: unknown, host: ArgumentsHost): void {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 400 && status < 500 && status !== 401) {
        const request = host.switchToHttp().getRequest<Request>();
        this.log.warn(`${request.method} ${request.originalUrl} -> ${status} ${reasonOf(exception)}`);
      }
    }
    super.catch(exception, host);
  }
}

function reasonOf(exception: HttpException): string {
  const body = exception.getResponse();
  if (typeof body === 'string') return body;
  const message = (body as { message?: unknown }).message;
  return Array.isArray(message) ? message.join('; ') : String(message ?? exception.message);
}
