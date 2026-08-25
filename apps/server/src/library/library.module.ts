import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { IngestFileHandler } from './handlers/ingest-file.handler';
import { ScanRootHandler } from './handlers/scan-root.handler';
import { IngestService } from './ingest.service';
import { LibraryController } from './library.controller';
import { LibraryService } from './library.service';
import { ScannerService } from './scanner.service';

@Module({
  imports: [MediaModule],
  controllers: [LibraryController],
  providers: [LibraryService, ScannerService, IngestService, ScanRootHandler, IngestFileHandler],
})
export class LibraryModule {}
