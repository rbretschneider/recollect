import { ArrayMinSize, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body for merging several suggestions into one Memory. */
export class MergeSuggestionsRequestDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID('all', { each: true })
  clusterIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
