import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger"
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator"

import { AssetOwnershipPolicy, AssetType, CatalogRewardType, InventoryAcquisitionSource } from "@prisma/client"

const KEY = /^[a-z0-9][a-z0-9:_-]{0,99}$/
const INTEGER = /^\d+$/

export class CreateAssetDto {
  @ApiProperty({ example: "avatar:gold-crown" }) @IsString() @Matches(KEY) key!: string
  @ApiProperty({ example: "Gold Crown" }) @IsString() @MaxLength(120) name!: string
  @ApiProperty({ enum: AssetType }) @IsEnum(AssetType) assetType!: AssetType
  @ApiPropertyOptional({ enum: AssetOwnershipPolicy }) @IsOptional() @IsEnum(AssetOwnershipPolicy) ownershipPolicy?: AssetOwnershipPolicy
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string
  @ApiPropertyOptional({ description: "HTTPS image URL used by clients and the admin catalog." }) @IsOptional() @IsString() imageUrl?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) imageAlt?: string
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) imageUrls?: string[]
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() metadata?: Record<string, unknown>
}

export class UpdateAssetDto extends PartialType(CreateAssetDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
}

export class CreateCatalogDto {
  @ApiProperty({ example: "main" }) @IsString() @Matches(/^[a-z0-9][a-z0-9:_-]{0,79}$/) key!: string
  @ApiProperty({ example: "Main Store" }) @IsString() @MaxLength(120) name!: string
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
  @ApiPropertyOptional() @IsOptional() startsAt?: string
  @ApiPropertyOptional() @IsOptional() endsAt?: string
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() metadata?: Record<string, unknown>
}

export class UpdateCatalogDto extends PartialType(CreateCatalogDto) {}

export type CatalogPriceInput = { currencyCode: string; amount: string; active?: boolean }
export type CatalogRewardInput = { rewardType: CatalogRewardType; assetKey?: string; variationKey?: string; currencyCode?: string; progressionKey?: string; targetKey?: string; amount?: string; quantity?: number; sortOrder?: number; metadata?: Record<string, unknown> }

export class CreateCatalogItemDto {
  @ApiProperty({ example: "gold-crown-bundle" }) @IsString() @Matches(KEY) key!: string
  @ApiProperty({ example: "Gold Crown Bundle" }) @IsString() @MaxLength(120) name!: string
  @ApiProperty({ example: "main-catalog-uuid" }) @IsString() catalogId!: string
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string
  @ApiPropertyOptional({ example: "avatar:gold-crown" }) @IsOptional() @IsString() @MaxLength(100) assetKey?: string
  @ApiPropertyOptional() @IsOptional() @IsString() imageUrl?: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) imageAlt?: string
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) imageUrls?: string[]
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() purchasable?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
  @ApiPropertyOptional() @IsOptional() startsAt?: string
  @ApiPropertyOptional() @IsOptional() endsAt?: string
  @ApiProperty({ type: [Object], description: "Prices in minor units, for example [{currencyCode:'MCN', amount:'500'}]." }) @IsArray() @ArrayMaxSize(20) @IsObject({ each: true }) prices!: CatalogPriceInput[]
  @ApiPropertyOptional({ type: [Object] }) @IsOptional() @IsArray() @ArrayMaxSize(30) @IsObject({ each: true }) rewards?: CatalogRewardInput[]
  @ApiPropertyOptional({ type: Object }) @IsOptional() @IsObject() metadata?: Record<string, unknown>
}

export class UpdateCatalogItemDto extends PartialType(CreateCatalogItemDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() purchasable?: boolean
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean
}

export class PurchaseDto {
  @ApiPropertyOptional({ default: "main" }) @IsOptional() @IsString() @MaxLength(80) catalogKey?: string
  @ApiProperty({ example: "gold-crown-bundle" }) @IsString() @MaxLength(100) catalogItemKey!: string
  @ApiProperty({ example: "MCN" }) @IsString() @MaxLength(32) currencyCode!: string
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(99) quantity!: number
  @ApiProperty({ example: "purchase-device-2026-0001" }) @IsString() @MaxLength(128) idempotencyKey!: string
}

export class InventoryQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() userId?: string
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) page?: number
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number
}

export class InventoryMutationDto {
  @ApiProperty({ example: "avatar:gold-crown" }) @IsString() @MaxLength(100) assetKey!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) variationKey?: string
  @ApiProperty({ example: 1 }) @IsInt() @Min(1) @Max(1000000) quantity!: number
  @ApiPropertyOptional({ enum: InventoryAcquisitionSource, default: InventoryAcquisitionSource.ADMIN }) @IsOptional() @IsEnum(InventoryAcquisitionSource) source?: InventoryAcquisitionSource
  @ApiProperty({ example: "admin-grant-2026-0001" }) @IsString() @MaxLength(255) sourceId!: string
  @ApiProperty({ example: "Compensation for support ticket" }) @IsString() @MaxLength(500) reason!: string
}

export class EntitlementMutationDto {
  @ApiProperty({ example: "premium-season-pass" }) @IsString() @MaxLength(160) entitlementKey!: string
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) assetKey?: string
  @ApiProperty({ example: "admin-grant-2026-0001" }) @IsString() @MaxLength(255) sourceId!: string
  @ApiProperty({ example: "Manual grant" }) @IsString() @MaxLength(500) reason!: string
}
