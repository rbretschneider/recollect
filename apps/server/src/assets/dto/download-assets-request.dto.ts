import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export const MAX_BULK_DOWNLOAD = 1000;

/**
 * Body for the bulk ZIP download. A JSON client sends an array; the browser's
 * form POST sends one comma-separated string, which is split before validation.
 */
export class DownloadAssetsRequestDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value.split(',').filter((part) => part !== '')
      : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_DOWNLOAD)
  @IsUUID(undefined, { each: true })
  assetIds!: string[];
}
