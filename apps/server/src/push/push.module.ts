import { Global, Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DailyLookbackScheduler } from './daily-lookback.scheduler';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/** Web Push is global so any feature can deliver a notification later. */
@Global()
@Module({
  imports: [DashboardModule],
  controllers: [PushController],
  providers: [PushService, DailyLookbackScheduler],
  exports: [PushService],
})
export class PushModule {}
