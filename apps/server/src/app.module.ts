import { Module } from '@nestjs/common';
import { AlbumsModule } from './albums/albums.module';
import { AssetsModule } from './assets/assets.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { ContributionsModule } from './contributions/contributions.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { DevicesModule } from './devices/devices.module';
import { FoldersModule } from './folders/folders.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.module';
import { LibraryModule } from './library/library.module';
import { MemoriesModule } from './memories/memories.module';
import { MlModule } from './ml/ml.module';
import { PeopleModule } from './people/people.module';
import { PlacesModule } from './places/places.module';
import { SearchModule } from './search/search.module';
import { SharingModule } from './sharing/sharing.module';
import { SystemModule } from './system/system.module';
import { TrashModule } from './trash/trash.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    JobsModule,
    UsersModule,
    AuthModule,
    LibraryModule,
    AssetsModule,
    DevicesModule,
    FoldersModule,
    MemoriesModule,
    AlbumsModule,
    ContributionsModule,
    DashboardModule,
    MlModule,
    PeopleModule,
    PlacesModule,
    SearchModule,
    SharingModule,
    SystemModule,
    TrashModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
