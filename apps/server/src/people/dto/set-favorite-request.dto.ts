import { IsBoolean } from 'class-validator';

/** Body for marking a person as close family (or clearing it). */
export class SetFavoriteRequestDto {
  @IsBoolean()
  favorite!: boolean;
}
