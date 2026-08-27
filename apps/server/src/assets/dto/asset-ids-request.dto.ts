import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

/** Body for batch timeline-item lookup (album/memory viewer lists). */
export class AssetIdsRequestDto {
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID(undefined, { each: true })
  assetIds!: string[];
}
