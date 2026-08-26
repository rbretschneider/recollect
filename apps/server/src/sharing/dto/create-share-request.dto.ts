import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';

/** Body for creating a public share link. */
export class CreateShareRequestDto {
  @IsIn(['memory', 'album'])
  targetType!: 'memory' | 'album';

  @IsUUID()
  targetId!: string;

  @IsOptional()
  @IsBoolean()
  includeJournal?: boolean;
}
