import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [MediaModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
