import { Type } from "class-transformer"
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from "class-validator"

export class TileRushPointDto {
  @IsInt() @Min(0) @Max(8)
  row!: number

  @IsInt() @Min(0) @Max(8)
  column!: number
}

export class TileRushActionDto {
  @IsInt() @Min(1) @Max(1000000)
  sequence!: number

  @IsArray() @ArrayMinSize(3) @ArrayMaxSize(81)
  @ValidateNested({ each: true })
  @Type(() => TileRushPointDto)
  path!: TileRushPointDto[]

  @IsUUID()
  clientActionId!: string

  @IsOptional() @IsDateString()
  clientStartedAt?: string

  @IsOptional() @IsDateString()
  clientReleasedAt?: string

  @IsOptional() @IsString() @Length(1, 256)
  boardHashBefore?: string
}
