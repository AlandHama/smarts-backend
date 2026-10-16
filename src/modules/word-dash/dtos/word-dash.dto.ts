import { Type } from "class-transformer"
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from "class-validator"

export class WordDashSubmissionDto {
  @IsInt()
  @Min(1)
  @Max(1000000)
  sequence!: number

  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(25)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(24, { each: true })
  tileIndexes!: number[]

  @IsString()
  @MaxLength(128)
  @ValidateIf((value) => !value.clientSubmissionId)
  @IsUUID()
  clientSubmissionId!: string

  @IsOptional()
  @IsDateString()
  clientStartedAt?: string

  @IsOptional()
  @IsDateString()
  clientReleasedAt?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  boardHashBefore?: string
}
