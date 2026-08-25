import { Module } from '@nestjs/common';
import { AssetsModule } from './assets/assets.module';
import { AuthModule } from './auth/auth.module';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.module';
import { LibraryModule } from './library/library.module';
import { MemoriesModule } from './memories/memories.module';
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
    MemoriesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
