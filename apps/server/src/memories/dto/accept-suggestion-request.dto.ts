import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for accepting a suggestion into a Memory. */
export class AcceptSuggestionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
