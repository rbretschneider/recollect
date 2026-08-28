import { Module, OnModuleInit } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { join } from 'path';
import { AlbumsModule } from '../albums/albums.module';
import { AssetsModule } from '../assets/assets.module';
import { APP_CONFIG } from '../config/app-config';
import type { AppConfig } from '../config/app-config';
import { LibraryModule } from '../library/library.module';
import { MediaModule } from '../media/media.module';
import { ContributionsController } from './contributions.controller';
import { ContributionsService } from './contributions.service';
import { PublicContributeController } from './public-contribute.controller';

/** A phone video can be large; anything beyond this is not a family photo. */
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

@Module({
  imports: [
    AlbumsModule,
    AssetsModule,
    LibraryModule,
    MediaModule,
    // Multer streams uploads straight to disk in the staging temp dir (it
    // creates the directory itself), never buffering a 2GB video in memory.
    MulterModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        dest: join(config.appDataDir, 'staging', 'tmp'),
        limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      }),
    }),
  ],
  controllers: [ContributionsController, PublicContributeController],
  providers: [ContributionsService],
})
export class ContributionsModule implements OnModuleInit {
  constructor(private readonly contributions: ContributionsService) {}

  async onModuleInit(): Promise<void> {
    await this.contributions.ensureStagingDir();
  }
}
