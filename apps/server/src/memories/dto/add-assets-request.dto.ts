import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** Body for attaching assets to a Memory. */
export class AddAssetsRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  assetIds!: string[];
}
