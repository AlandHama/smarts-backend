import { ApiPropertyOptional } from "@nestjs/swagger"
import { Transform, Type } from "class-transformer"
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator"

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() || undefined : value

export class SystemAdminAnalyticsQueryDto {
  @ApiPropertyOptional({ default: 30, minimum: 7, maximum: 365, description: "Number of UTC days when from/to are omitted" })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  @Max(365)
  readonly days: number = 30

  @ApiPropertyOptional({ description: "Inclusive UTC start date/time" })
  @IsOptional()
  @IsDateString()
  readonly from?: string

  @ApiPropertyOptional({ description: "Inclusive UTC end date/time" })
  @IsOptional()
  @IsDateString()
  readonly to?: string

  @ApiPropertyOptional({ default: "UTC" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly timezone: string = "UTC"

  @ApiPropertyOptional({ enum: ["auto", "day", "week", "month"], default: "auto" })
  @IsOptional()
  @IsIn(["auto", "day", "week", "month"])
  readonly resolution: "auto" | "day" | "week" | "month" = "auto"

  @ApiPropertyOptional({ enum: ["previous", "none"], default: "previous" })
  @IsOptional()
  @IsIn(["previous", "none"])
  readonly comparison: "previous" | "none" = "previous"

  @ApiPropertyOptional({ description: "Filter by player country code" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly country?: string

  @ApiPropertyOptional({ description: "Filter by session platform" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly platform?: string

  @ApiPropertyOptional({ description: "Filter by client/app version" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly appVersion?: string

  @ApiPropertyOptional({ description: "Filter by game definition key" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly gameKey?: string

  @ApiPropertyOptional({ description: "Filter by match mode" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly mode?: string

  @ApiPropertyOptional({ enum: ["all", "new", "returning"], default: "all" })
  @IsOptional()
  @IsIn(["all", "new", "returning"])
  readonly audience: "all" | "new" | "returning" = "all"

  @ApiPropertyOptional({ description: "Filter by player account status" })
  @IsOptional()
  @Transform(trim)
  @IsString()
  readonly accountStatus?: string
}
