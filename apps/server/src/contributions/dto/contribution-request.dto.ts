import { ArrayNotEmpty, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Options when turning on guest contributions for an album. */
export class CreateContributionLinkDto {
  @IsOptional()
  @IsBoolean()
  poolView?: boolean;

  /** 1 hour .. 60 days; default one week after creation. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  expiresInHours?: number;
}

/** A batch approve/reject from the review queue. */
export class ReviewUploadsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids!: string[];
}
