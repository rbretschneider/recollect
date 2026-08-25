import { Module } from '@nestjs/common';
import { MetadataExtractorService } from './metadata-extractor.service';
import { ThumbnailService } from './thumbnail.service';
import { ThumbnailStore } from './thumbnail-store';

@Module({
  providers: [MetadataExtractorService, ThumbnailService, ThumbnailStore],
  exports: [MetadataExtractorService, ThumbnailService, ThumbnailStore],
})
export class MediaModule {}
