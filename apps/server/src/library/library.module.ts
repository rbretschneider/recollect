import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ExifBackfillHandler } from './handlers/exif-backfill.handler';
import { IngestFileHandler } from './handlers/ingest-file.handler';
import { ScanRootHandler } from './handlers/scan-root.handler';
import { IngestService } from './ingest.service';
import { ReprocessAssetHandler } from './handlers/reprocess-asset.handler';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { ScannerService } from './scanner.service';
import { ScanSchedulerService } from './scan-scheduler.service';

@Module({
  imports: [MediaModule],
  controllers: [LibraryController],
  providers: [
    LibraryService,
    ScannerService,
    ScanSchedulerService,
    IngestService,
    ScanRootHandler,
    ExifBackfillHandler,
    IngestFileHandler,
    ReprocessAssetHandler,
  ],
})
export class LibraryModule {}
