import { IsString, MaxLength } from 'class-validator';

/** Body for writing one photo's scrapbook caption (empty clears it). */
export class SetCaptionRequestDto {
  @IsString()
  @MaxLength(500)
  caption!: string;
}
