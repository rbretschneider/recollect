import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** Body for trashing or restoring a set of assets. */
export class TrashRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  assetIds!: string[];
}
