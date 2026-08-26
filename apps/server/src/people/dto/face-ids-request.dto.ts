import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/** Body carrying a set of face ids (split / ignore). */
export class FaceIdsRequestDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  faceIds!: string[];
}
