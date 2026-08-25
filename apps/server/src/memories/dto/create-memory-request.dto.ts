import { IsArray, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Body for creating a Memory manually from a selection. */
export class CreateMemoryRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsArray()
  @IsUUID('all', { each: true })
  assetIds!: string[];
}
