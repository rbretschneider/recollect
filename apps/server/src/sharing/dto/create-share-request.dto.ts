import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Body for creating a public share link. */
export class CreateShareRequestDto {
  @IsIn(['memory', 'album', 'asset'])
  targetType!: 'memory' | 'album' | 'asset';

  @IsUUID()
  targetId!: string;

  @IsOptional()
  @IsBoolean()
  includeJournal?: boolean;

  /** Hours until the link expires; omit to fall back to the 90-day default. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  expiresInHours?: number;

  /**
   * Opt in to a link that never expires. Requires an explicit choice — a link
   * left to default is bounded, so a URL pasted into a chat can't quietly serve
   * originals forever.
   */
  @IsOptional()
  @IsBoolean()
  neverExpires?: boolean;
}
