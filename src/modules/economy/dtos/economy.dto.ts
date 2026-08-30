import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger"
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator"

import { CurrencyKind, WalletTransactionSourceType } from "@prisma/client"

export class CreateCurrencyDto {
  @ApiProperty({ example: "MCN" })
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]{0,31}$/)
  code!: string

  @ApiProperty({ example: "MCN Coins" })
  @IsString()
  @MaxLength(100)
  name!: string

  @ApiProperty({ enum: CurrencyKind })
  @IsEnum(CurrencyKind)
  kind!: CurrencyKind

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  precision?: number

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class UpdateCurrencyDto extends PartialType(CreateCurrencyDto) {}

export class WalletMutationDto {
  @ApiProperty({ example: "MCN" })
  @IsString()
  @MaxLength(32)
  currencyCode!: string

  @ApiProperty({ example: "1500" })
  @IsString()
  @Matches(/^\d+$/)
  amount!: string

  @ApiProperty({ example: "manual-grant-2026-001" })
  @IsString()
  @MaxLength(255)
  sourceId!: string

  @ApiPropertyOptional({ enum: WalletTransactionSourceType, default: WalletTransactionSourceType.ADMIN })
  @IsOptional()
  @IsEnum(WalletTransactionSourceType)
  sourceType?: WalletTransactionSourceType

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class ReverseWalletDto {
  @ApiPropertyOptional({ example: "ledger-uuid", description: "Either ledgerId or originalGrantKey is required." })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ledgerId?: string

  @ApiPropertyOptional({ example: "ADMIN:manual-grant-2026-001" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalGrantKey?: string

  @ApiProperty({ example: "correction-2026-001" })
  @IsString()
  @MaxLength(255)
  sourceId!: string
}

export class WalletQueryDto {
  @ApiPropertyOptional({ default: 25 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number
}
