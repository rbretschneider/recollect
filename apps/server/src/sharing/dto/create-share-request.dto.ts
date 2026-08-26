import { IsBoolean, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Body for creating a public share link. */
export class CreateShareRequestDto {
  @IsIn(['memory', 'album'])
  targetType!: 'memory' | 'album';

  @IsUUID()
  targetId!: string;

  @IsOptional()
  @IsBoolean()
  includeJournal?: boolean;

  /** Hours until the link expires; omit for a link that never expires (explicit choice). */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  expiresInHours?: number;
}
