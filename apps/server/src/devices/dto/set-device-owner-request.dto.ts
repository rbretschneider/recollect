import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** Body for mapping a camera to its owning Person (null personId clears it). */
export class SetDeviceOwnerRequestDto {
  @IsString()
  @MaxLength(200)
  cameraMake!: string;

  @IsString()
  @MaxLength(200)
  cameraModel!: string;

  @IsOptional()
  @IsUUID()
  personId?: string | null;
}
