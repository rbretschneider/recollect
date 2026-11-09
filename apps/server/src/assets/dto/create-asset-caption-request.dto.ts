import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateAssetCaptionRequestDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 500)
  text!: string;

  @IsOptional()
  @IsUUID()
  saidByPersonId?: string | null;
}
