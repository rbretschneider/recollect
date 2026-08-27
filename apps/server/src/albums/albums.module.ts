import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AlbumsController } from './albums.controller';
import { AlbumsService } from './albums.service';

@Module({
  imports: [AssetsModule],
  controllers: [AlbumsController],
  providers: [AlbumsService],
  exports: [AlbumsService],
})
export class AlbumsModule {}
