import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger"
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator"

import { ProgressionKind, ProgressionResetPolicy, ProgressionRewardType } from "@prisma/client"

const INTEGER_STRING = /^\d+$/

export class CreateProgressionDto {
  @ApiProperty({ example: "main" })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9:_-]{0,63}$/)
  key!: string

  @ApiProperty({ example: "Main Level" })
  @IsString()
  @MaxLength(100)
  name!: string

  @ApiProperty({ enum: ProgressionKind })
  @IsEnum(ProgressionKind)
  kind!: ProgressionKind

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  allowNegative?: boolean

  @ApiPropertyOptional({ enum: ProgressionResetPolicy, default: ProgressionResetPolicy.NEVER })
  @IsOptional()
  @IsEnum(ProgressionResetPolicy)
  resetPolicy?: ProgressionResetPolicy

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class UpdateProgressionDto extends PartialType(CreateProgressionDto) {}

export class CreateProgressionTierDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(100000)
  step!: number

  @ApiProperty({ example: "0", description: "Cumulative points required; sent as a string to preserve BIGINT precision." })
  @IsString()
  @Matches(INTEGER_STRING)
  pointsThreshold!: string

  @ApiPropertyOptional({ example: "Beginner" })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class UpdateProgressionTierDto extends PartialType(CreateProgressionTierDto) {}

export class CreateProgressionRewardDto {
  @ApiProperty({ enum: ProgressionRewardType })
  @IsEnum(ProgressionRewardType)
  rewardType!: ProgressionRewardType

  @ApiPropertyOptional({ example: "100", description: "Positive integer amount for currency or progression-point rewards." })
  @IsOptional()
  @IsString()
  @Matches(INTEGER_STRING)
  amount?: string

  @ApiPropertyOptional({ example: "elo" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  targetProgressionKey?: string

  @ApiPropertyOptional({ example: "MCN" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  currencyCode?: string

  @ApiPropertyOptional({ example: "skin:blue" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  targetKey?: string

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class UpdateProgressionRewardDto extends PartialType(CreateProgressionRewardDto) {}

export class AwardProgressionPointsDto {
  @ApiProperty({ example: "250" })
  @IsString()
  @Matches(/^-?\d+$/)
  amount!: string

  @ApiProperty({ example: "admin-adjustment-2026-08-31-001" })
  @IsString()
  @MaxLength(255)
  sourceId!: string

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class ResetProgressionDto {
  @ApiProperty({ example: "manual-reset-2026-08-31-001" })
  @IsString()
  @MaxLength(255)
  sourceId!: string
}

