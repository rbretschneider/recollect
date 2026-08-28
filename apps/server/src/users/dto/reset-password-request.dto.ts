import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for an admin resetting a member's password. */
export class ResetPasswordRequestDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  password!: string;
}
