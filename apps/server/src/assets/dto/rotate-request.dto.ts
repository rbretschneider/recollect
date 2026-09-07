import { IsIn } from 'class-validator';

/** Body for rotating a photo a quarter turn. */
export class RotateRequestDto {
  @IsIn(['cw', 'ccw'])
  direction!: 'cw' | 'ccw';
}
