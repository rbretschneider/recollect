import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for signing in. */
export class LoginRequestDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  deviceLabel?: string;
}
