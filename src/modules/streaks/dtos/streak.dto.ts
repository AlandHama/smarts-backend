import { Type } from "class-transformer"
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator"

export class UpdateStreakConfigurationDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsString() @MinLength(3) @MaxLength(40) qualifyingActivity?: string
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) timezone?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) maxBonusPercent?: number
}

export class CreateStreakMilestoneDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) day!: number
  @Type(() => Number) @IsInt() @Min(0) @Max(100) bonusPercent!: number
  @IsOptional() @IsString() @MaxLength(120) title?: string
  @IsOptional() @IsString() @MaxLength(300) description?: string
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number
}

export class UpdateStreakMilestoneDto extends CreateStreakMilestoneDto {}
