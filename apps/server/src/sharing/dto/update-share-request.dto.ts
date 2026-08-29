import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

/** Body for changing an existing share link's expiration (extend / make permanent). */
export class UpdateShareRequestDto {
  /** New hours-from-now until expiry; omit to fall back to the 90-day default. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  expiresInHours?: number;

  /** Opt in to a link that never expires. */
  @IsOptional()
  @IsBoolean()
  neverExpires?: boolean;
}
