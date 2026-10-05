import { IsDateString, IsInt, IsOptional, Max, Min } from "class-validator"

export class GemBlitzMoveDto {
  @IsInt() @Min(1) @Max(1000000)
  sequence!: number
  @IsInt() @Min(0) @Max(8)
  fromRow!: number
  @IsInt() @Min(0) @Max(8)
  fromColumn!: number
  @IsInt() @Min(0) @Max(8)
  toRow!: number
  @IsInt() @Min(0) @Max(8)
  toColumn!: number
  @IsOptional() @IsDateString()
  clientTimestamp?: string
}
