import { IsUUID } from 'class-validator';

/** Body for merging this person into another. */
export class MergePersonRequestDto {
  @IsUUID()
  targetPersonId!: string;
}
