import { IsBoolean } from 'class-validator';

/** Body for enabling/disabling a library root. */
export class SetRootEnabledRequestDto {
  @IsBoolean()
  enabled!: boolean;
}
