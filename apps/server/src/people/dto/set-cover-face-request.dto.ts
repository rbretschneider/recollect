import { IsUUID } from 'class-validator';

/** Body for pinning one of a person's faces as their avatar. */
export class SetCoverFaceRequestDto {
  @IsUUID()
  faceId!: string;
}
