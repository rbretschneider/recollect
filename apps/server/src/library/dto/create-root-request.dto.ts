import { IsArray, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for registering a library root to index in place. */
export class CreateRootRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  path!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  excludeGlobs?: string[];
}
