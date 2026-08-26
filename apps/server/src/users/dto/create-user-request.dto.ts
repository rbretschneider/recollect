import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for an admin creating a household member account. */
export class CreateUserRequestDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;

  @IsIn(['read', 'write', 'delete'])
  permission!: 'read' | 'write' | 'delete';

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}
