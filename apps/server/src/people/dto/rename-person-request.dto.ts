import { IsString, MaxLength } from 'class-validator';

/** Body for naming a person. */
export class RenamePersonRequestDto {
  @IsString()
  @MaxLength(100)
  name!: string;
}
