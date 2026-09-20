import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator"
import { ApiPropertyOptional } from "@nestjs/swagger"

export class UpdateGldControlsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emissionsPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() catalogSinksPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() giftsPaused?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() paidRewardsPaused?: boolean
  @ApiPropertyOptional({ description: "Global player-to-player GLD transfer fee in basis points (100 = 1%)", example: 100 }) @IsOptional() @IsInt() @Min(0) @Max(10000) gldTransferFeeBps?: number
  @ApiPropertyOptional({ description: "Maximum GLD emitted to one player by ads per UTC day" }) @IsOptional() @IsString() @Matches(/^\d+$/) @MaxLength(32) adDailyGldCap?: string
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) adMaxValidatedAds?: number
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d+$/) @MaxLength(32) adMaxRewardPerClaim?: string
  @ApiPropertyOptional({ description: "AdMob revenue allocation added to the USD reserve in basis points (100 = 1%)" }) @IsOptional() @IsInt() @Min(0) @Max(10000) admobReserveAllocationBps?: number
  @ApiPropertyOptional({ description: "Gift burn basis points" }) @IsOptional() @IsInt() @Min(0) @Max(10000) giftBurnBps?: number
  @ApiPropertyOptional({ description: "Paid reward safety margin basis points" }) @IsOptional() @IsInt() @Min(10001) @Max(100000) paidRewardSafetyMarginBps?: number
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) paidRewardDailyRequestLimit?: number
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) reason?: string
}
