import { ApiPropertyOptional } from "@nestjs/swagger"
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from "class-validator"

export class AnalyticsSavedReportDto {
  @IsString() name!: string
  @IsString() reportKey!: string
  @IsOptional() @IsIn(["PRIVATE", "TEAM", "ALL_PERMITTED"]) visibility?: string
  @IsObject() configuration!: Record<string, unknown>
}

export class AnalyticsScheduledReportDto {
  @IsString() savedReportId!: string
  @IsIn(["DAILY", "WEEKLY", "MONTHLY"]) frequency!: string
  @IsOptional() @IsString() timezone?: string
  @IsOptional() @IsString() sendAt?: string
  @IsObject() recipients!: unknown
  @IsObject() formats!: unknown
  @IsOptional() @IsBoolean() enabled?: boolean
}

export class AnalyticsAlertRuleDto {
  @IsString() key!: string
  @IsString() name!: string
  @IsString() metricKey!: string
  @IsIn(["GT", "GTE", "LT", "LTE", "DELTA_PERCENT"]) condition!: string
  @IsInt() threshold!: number
  @IsOptional() @IsInt() @Min(1) @Max(90) baselineWindow?: number
  @IsOptional() @IsInt() @Min(5) @Max(1440) evaluationMinutes?: number
  @IsOptional() @IsInt() @Min(1) minimumSample?: number
  @IsOptional() @IsIn(["INFO", "WARNING", "CRITICAL"]) severity?: string
  @IsOptional() @IsInt() @Min(1) cooldownMinutes?: number
  @IsObject() recipients!: unknown
  @IsOptional() @IsBoolean() enabled?: boolean
}

export class AnalyticsPlayerExplorerQueryDto {
  @IsOptional() @IsString() search?: string
  @IsOptional() @IsString() cursor?: string
  @IsOptional() @IsInt() @Min(1) @Max(100) limit?: number
}
