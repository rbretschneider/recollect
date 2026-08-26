import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body for accepting a suggestion into a Memory. */
export class AcceptSuggestionRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  /**
   * The reviewer's edited photo selection. When present, the Memory is created
   * from exactly these assets (some suggested ones dropped, others added)
   * instead of the suggestion's own members.
   */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  assetIds?: string[];
}
