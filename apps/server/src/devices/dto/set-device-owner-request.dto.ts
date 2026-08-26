import { IsString, MaxLength } from 'class-validator';

/** Body for mapping a camera to its owner (empty name clears the mapping). */
export class SetDeviceOwnerRequestDto {
  @IsString()
  @MaxLength(200)
  cameraMake!: string;

  @IsString()
  @MaxLength(200)
  cameraModel!: string;

  @IsString()
  @MaxLength(100)
  ownerName!: string;
}
