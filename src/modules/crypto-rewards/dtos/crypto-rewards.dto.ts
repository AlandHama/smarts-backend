import { Type } from "class-transformer"
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator"

import { CRYPTO_REWARD_CURRENCIES, CryptoRewardCurrency } from "../crypto-rewards.config"

export class CryptoAddressValidationDto {
  @IsEnum(CRYPTO_REWARD_CURRENCIES)
  currencyCode!: CryptoRewardCurrency

  @IsString()
  @Matches(/^SOLANA$/)
  networkCode!: "SOLANA"

  @IsString()
  @MaxLength(128)
  destinationAddress!: string
}

export class CryptoRewardQuoteDto extends CryptoAddressValidationDto {
  @IsString()
  @Matches(/^\d+$/)
  gldAmount!: string
}

export class CreateCryptoPayoutRequestDto {
  @IsUUID()
  quoteId!: string

  @IsString()
  @MaxLength(128)
  destinationAddress!: string

  @IsBoolean()
  acknowledged!: boolean

  @IsString()
  @MaxLength(128)
  idempotencyKey!: string
}

export class CryptoAdminDecisionDto {
  @IsEnum(["APPROVE", "REJECT"])
  decision!: "APPROVE" | "REJECT"

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string
}

export class CryptoPayoutVerificationDto {
  @IsString()
  @Matches(/^\d{6,8}$/)
  verificationCode!: string
}

export class UpdateCryptoRewardConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,6})?$/) usdtSolGldRate?: string
  @IsOptional() @IsString() @Matches(/^\d+(?:\.\d{1,6})?$/) usdcSolGldRate?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) platformFeeBps?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(60) @Max(86400) quoteTtlSeconds?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) maxQuoteDriftBps?: number
  @IsOptional() @IsString() @Matches(/^\d+$/) minGld?: string
  @IsOptional() @IsString() @Matches(/^\d+$/) maxGld?: string
  @IsOptional() @IsString() @Matches(/^\d+$/) dailyGldLimit?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) maxPendingRequestsPerPlayer?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(3600) @Max(2592000) holdExpirySeconds?: number
  @IsOptional() @IsBoolean() requireAdminApproval?: boolean
}
