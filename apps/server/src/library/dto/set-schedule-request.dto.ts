import { IsIn, IsInt, Matches, Max, Min } from 'class-validator';

/** Body for setting the automatic-scan schedule. */
export class SetScheduleRequestDto {
  @IsIn(['off', 'interval', 'daily', 'weekly'])
  mode!: 'off' | 'interval' | 'daily' | 'weekly';

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time!: string;

  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;
}
