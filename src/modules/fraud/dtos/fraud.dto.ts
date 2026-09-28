import { Type } from "class-transformer"
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator"
import { FraudActionType, FraudCaseStatus, FraudProfileStatus, FraudRiskLevel } from "@prisma/client"

export class FraudProfilesQueryDto {
  @IsOptional() @IsEnum(FraudRiskLevel) riskLevel?: FraudRiskLevel
  @IsOptional() @IsEnum(FraudProfileStatus) status?: FraudProfileStatus
  @IsOptional() @IsString() @MaxLength(100) search?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) limit?: number
}

export class UpdateFraudRuleDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsInt() @Min(0) @Max(100) scoreDelta?: number
  @IsOptional() @IsInt() @Min(1) threshold?: number | null
  @IsOptional() @IsInt() @Min(1) windowSeconds?: number | null
  @IsOptional() @IsInt() @Min(0) @Max(3650) decayDays?: number
  @IsOptional() @IsInt() @Min(1) @Max(100) autoOpenScore?: number | null
  @IsOptional() @IsObject() metadata?: Record<string, unknown>
  @IsString() @MinLength(3) @MaxLength(500) reason!: string
}

export class FraudActionDto {
  @IsEnum(FraudActionType) action!: FraudActionType
  @IsString() @MinLength(3) @MaxLength(500) reason!: string
  @IsOptional() @IsEnum(FraudCaseStatus) caseStatus?: FraudCaseStatus
  @IsOptional() @IsString() @MaxLength(2000) notes?: string
}

export class ObserveFraudDto {
  @IsString() @MinLength(2) @MaxLength(80) type!: string
  @IsString() @MinLength(2) @MaxLength(80) sourceType!: string
  @IsOptional() @IsString() @MaxLength(255) sourceId?: string
  @IsOptional() @IsObject() metadata?: Record<string, unknown>
}
