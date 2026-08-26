import { IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Body for creating an album, optionally seeded with a selection. */
export class CreateAlbumRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  assetIds?: string[];
}
