import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Body for adding a "quote of the day" to a memory. */
export class AddQuoteRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  saidBy!: string;

  /** Explicit Person link from the picker; omitted = auto-match by name. */
  @IsOptional()
  @IsUUID()
  saidByPersonId?: string;
}
