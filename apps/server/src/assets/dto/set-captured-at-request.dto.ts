import { IsInt, IsISO8601, Max, Min } from 'class-validator';

/** Body for correcting an asset's capture date. */
export class SetCapturedAtRequestDto {
  /** The corrected instant, ISO 8601. */
  @IsISO8601()
  capturedAt!: string;

  /** Local UTC offset in minutes (e.g. -240), for the local calendar day. */
  @IsInt()
  @Min(-840)
  @Max(840)
  tzOffsetMin!: number;
}
