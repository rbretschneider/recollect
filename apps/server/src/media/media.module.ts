import { Module } from '@nestjs/common';
import { MetadataExtractorService } from './metadata-extractor.service';
import { ThumbnailService } from './thumbnail.service';
import { ThumbnailStore } from './thumbnail-store';
import { TranscodeService } from './transcode.service';

@Module({
  providers: [MetadataExtractorService, ThumbnailService, ThumbnailStore, TranscodeService],
  exports: [MetadataExtractorService, ThumbnailService, ThumbnailStore, TranscodeService],
})
export class MediaModule {}
