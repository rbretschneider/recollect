import { IsString, MaxLength } from 'class-validator';
import { PUBLIC_NAME_MAX } from '../public-name';

/** Body for naming the household on anything an outsider sees. */
export class SetPublicNameRequestDto {
  /** Empty clears it, falling back to the product's own wording. */
  @IsString()
  @MaxLength(PUBLIC_NAME_MAX)
  name!: string;
}
