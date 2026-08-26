import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for renaming an album. */
export class RenameAlbumRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;
}
