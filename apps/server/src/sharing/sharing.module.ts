import { Module } from '@nestjs/common';
import { AlbumsModule } from '../albums/albums.module';
import { AssetsModule } from '../assets/assets.module';
import { MemoriesModule } from '../memories/memories.module';
import { PeopleModule } from '../people/people.module';
import { PublicShareController } from './public-share.controller';
import { SharingController } from './sharing.controller';
import { SharingService } from './sharing.service';

@Module({
  imports: [MemoriesModule, AlbumsModule, AssetsModule, PeopleModule],
  controllers: [SharingController, PublicShareController],
  providers: [SharingService],
})
export class SharingModule {}
