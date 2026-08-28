import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ContributionsService } from './contributions.service';

/**
 * Runs before the file interceptor on the public upload route. Guards execute
 * ahead of interceptors in Nest, so rejecting an inactive/expired/maxed-out
 * token here stops multer from streaming the (up to 2GB) body to disk at all —
 * the difference between a 404 and a full upload written then thrown away.
 */
@Injectable()
export class ContributionUploadGuard implements CanActivate {
  constructor(private readonly contributions: ContributionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = (request.params as Record<string, string> | undefined)?.token ?? '';
    await this.contributions.assertLinkAcceptsUploads(token);
    return true;
  }
}
