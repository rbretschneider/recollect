import { IsInt } from 'class-validator';

/**
 * Quarter turns to apply, signed and unbounded: the client debounces a burst of
 * taps and sends the net result, so one save lands however many times the user
 * pressed the button.
 */
export class RotateRequestDto {
  @IsInt()
  turns!: number;
}
