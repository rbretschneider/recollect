import { IsString, MaxLength } from 'class-validator';

/** Body for naming an item. An empty string clears the title. */
export class SetTitleRequestDto {
  @IsString()
  @MaxLength(200)
  title!: string;
}
