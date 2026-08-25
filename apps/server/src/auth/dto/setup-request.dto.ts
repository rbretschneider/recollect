import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for completing first-run setup (creates the initial admin). */
export class SetupRequestDto {
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
}
