import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for a signed-in user changing their own password. */
export class ChangePasswordRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(200)
  newPassword!: string;
}
