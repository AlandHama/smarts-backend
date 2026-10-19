import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator"

export class PerfectTimingTapDto {
  @IsInt()
  @Min(1)
  @Max(1000000)
  sequence!: number

  @IsUUID()
  clientActionId!: string

  @IsInt()
  @Min(0)
  @Max(9000000000000)
  clientTapMonotonicMs!: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9000000000000)
  clientClockMs?: number

  @IsOptional()
  @IsInt()
  @Min(-10000)
  @Max(10000)
  clientServerOffsetMs?: number

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  clientRoundTripMs?: number

  @ApiPropertyOptional({ minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  clientRenderedMarkerX?: number

  @IsOptional()
  @IsDateString()
  clientOccurredAt?: string
}
