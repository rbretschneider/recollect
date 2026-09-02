import { IsEmail, IsString, MinLength } from 'class-validator';

/** Body for asking for a reset link. */
export class ForgotPasswordRequestDto {
  @IsEmail()
  email!: string;
}

/** Body for redeeming a reset link (distinct from the admin-driven reset). */
export class CompletePasswordResetDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
