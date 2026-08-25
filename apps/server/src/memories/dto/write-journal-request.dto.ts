import { IsString, MaxLength } from 'class-validator';

/** Body for writing the calling user's journal entry on a Memory. */
export class WriteJournalRequestDto {
  @IsString()
  @MaxLength(100_000)
  bodyMd!: string;
}
