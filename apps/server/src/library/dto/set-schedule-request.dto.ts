import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { MIN_SCAN_EVERY_MINUTES } from '../scan-schedule';

/** Body for setting the automatic-scan schedule. */
export class SetScheduleRequestDto {
  @IsIn(['off', 'every', 'interval', 'daily', 'weekly'])
  mode!: 'off' | 'every' | 'interval' | 'daily' | 'weekly';

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  /** Minutes between rescans in 'every' mode (floored server-side). */
  @IsOptional()
  @IsInt()
  @Min(MIN_SCAN_EVERY_MINUTES)
  @Max(1440)
  everyMinutes?: number;
}
