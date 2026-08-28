import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Admin edits to a member; only the provided fields change. */
export class UpdateUserRequestDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsIn(['read', 'write', 'delete'])
  permission?: 'read' | 'write' | 'delete';

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  /** A person id links the account; explicit null unlinks it. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  personId?: string | null;
}
