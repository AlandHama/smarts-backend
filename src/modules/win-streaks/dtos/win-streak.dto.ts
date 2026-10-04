import { Type } from "class-transformer"
import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator"

export class UpdateWinStreakConfigurationDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsBoolean() resetOnNonWin?: boolean
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(100) maxBonusPercent?: number
}

export class CreateWinStreakMilestoneDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(10000) wins!: number
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) @Max(100) bonusPercent!: number
  @IsOptional() @IsString() @MaxLength(120) title?: string
  @IsOptional() @IsString() @MaxLength(300) description?: string
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number
}

export class UpdateWinStreakMilestoneDto extends CreateWinStreakMilestoneDto {}
