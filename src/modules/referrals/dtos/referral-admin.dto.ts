import { ApiPropertyOptional } from "@nestjs/swagger"
import { Type } from "class-transformer"
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator"

export class UpdateReferralConfigDto {
  @ApiPropertyOptional({ description: "Enable referral attribution and rewards" })
  @IsOptional() @IsBoolean()
  enabled?: boolean

  @ApiPropertyOptional({ example: 25, description: "Maximum successful referrals attributed to one player" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000)
  maxInvitesPerUser?: number

  @ApiPropertyOptional({ example: 1000, description: "Share of the referred player's gross eligible ad reward in basis points; max 50%" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5000)
  rewardBps?: number

  @ApiPropertyOptional({ example: "1000", description: "Lifetime GLD reward cap for one referral" })
  @IsOptional() @IsString() @Matches(/^\d+$/) @MaxLength(32)
  maxRewardPerReferral?: string

  @ApiPropertyOptional({ example: 1, description: "Verified rewarded ads required before referral rewards start" })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  minQualifyingAds?: number

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string
}

export class UpdateReferralPlayerOverrideDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean | null
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) maxInvitesPerUser?: number | null
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5000) rewardBps?: number | null
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(/^\d+$/) @MaxLength(32) maxRewardPerReferral?: string | null
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) minQualifyingAds?: number | null
  @ApiPropertyOptional({ description: "Delete the override and return the player to the global policy" }) @IsOptional() @IsBoolean() clear?: boolean
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) reason?: string
}
