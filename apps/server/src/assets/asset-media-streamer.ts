import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { isThumbnailSize } from '../media/thumbnail-store';
import { AssetsService } from './assets.service';

/**
 * The one place that streams asset bytes to the client. Authenticated,
 * share-token, and contribution-token routes all funnel their thumb/original/
 * playback responses through here after doing their own scope check, so the
 * three surfaces can't drift — same webp typing, same 202-while-preparing
 * dance, and the same not-found fallback on every one of them.
 */
@Injectable()
export class AssetMediaStreamer {
  constructor(private readonly assets: AssetsService) {}

  async streamThumbnail(res: Response, assetId: string, size: number): Promise<void> {
    if (!isThumbnailSize(size)) {
      throw new BadRequestException('Unsupported thumbnail size.');
    }
    const path = await this.assets.getThumbnailPath(assetId, size);
    res.type('image/webp');
    this.send(res, path, 'The image is not available.');
  }

  async streamOriginal(res: Response, assetId: string): Promise<void> {
    const file = await this.assets.getOriginalFile(assetId);
    res.type(file.mime);
    this.send(res, file.path, 'The original file is not available.');
  }

  async streamPlayback(res: Response, assetId: string): Promise<void> {
    const resolution = await this.assets.getPlayback(assetId);
    if (resolution.kind === 'preparing') {
      res.status(HttpStatus.ACCEPTED).json({ status: 'preparing' });
      return;
    }
    // Asset content is hash-identified; a playable rendition never changes.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.type(resolution.mime);
    this.send(res, resolution.path, 'This video is not available.');
  }

  async streamMotion(res: Response, assetId: string): Promise<void> {
    const file = await this.assets.getMotionFile(assetId);
    // The clip is derived from a hash-identified still, so it never changes.
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.type(file.mime);
    this.send(res, file.path, 'This motion clip is not available.');
  }

  private send(res: Response, path: string, notFoundMessage: string): void {
    res.sendFile(path, (error) => {
      if (error && !res.headersSent) {
        res.status(HttpStatus.NOT_FOUND).json({ message: notFoundMessage });
      }
    });
  }
}
