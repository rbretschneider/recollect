import { Module } from '@nestjs/common';
import { MetadataExtractorService } from './metadata-extractor.service';
import { MotionPhotoService } from './motion-photo.service';
import { ThumbnailService } from './thumbnail.service';
import { ThumbnailStore } from './thumbnail-store';
import { TranscodeService } from './transcode.service';

@Module({
  providers: [
    MetadataExtractorService,
    MotionPhotoService,
    ThumbnailService,
    ThumbnailStore,
    TranscodeService,
  ],
  exports: [
    MetadataExtractorService,
    MotionPhotoService,
    ThumbnailService,
    ThumbnailStore,
    TranscodeService,
  ],
})
export class MediaModule {}
