import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator"
import { ApiPropertyOptional } from "@nestjs/swagger"

export class UpdateGldControlsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emissionsPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() catalogSinksPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() giftsPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() paidRewardsPaused?: boolean
  @ApiPropertyOptional({ description: "Global player-to-player GLD transfer fee in basis points (100 = 1%)", example: 100 }) @IsOptional() @IsInt() @Min(0) @Max(10000) gldTransferFeeBps?: number
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) reason?: string
}
