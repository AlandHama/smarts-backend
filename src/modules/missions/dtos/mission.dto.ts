import { Type } from "class-transformer"
import { IsBoolean, IsDateString, IsIn, IsInt, IsJSON, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator"

export const ENGAGEMENT_EVENT_TYPES = [
  "MATCH_PLAYED",
  "MATCH_WON",
  "CORRECT_ANSWER",
  "PERFECT_MATCH",
  "RANKED_MATCH_PLAYED",
  "RANKED_MATCH_WON",
  "FRIEND_ADDED",
  "GIFT_SENT",
  "REWARDED_AD_VERIFIED",
] as const

export class CreateMissionDto {
  @IsString() @MinLength(2) @MaxLength(80) key!: string
  @IsString() @MinLength(1) @MaxLength(120) title!: string
  @IsString() @MinLength(1) @MaxLength(300) description!: string
  @IsOptional() @IsString() @MaxLength(40) icon?: string
  @IsOptional() @IsString() @MaxLength(40) category?: string
  @IsString() @IsIn(ENGAGEMENT_EVENT_TYPES as unknown as string[]) eventType!: string
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) target!: number
  @IsOptional() @IsIn(["DAILY", "WEEKLY"]) period?: "DAILY" | "WEEKLY"
  @IsOptional() @IsString() @MaxLength(40) rewardGld?: string
  @IsOptional() @IsString() @MaxLength(30) rewardXp?: string
  @IsOptional() @IsJSON() filters?: string
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsDateString() startsAt?: string
  @IsOptional() @IsDateString() endsAt?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number
}

export class UpdateMissionDto extends CreateMissionDto {}

export class CreateAchievementDto {
  @IsString() @MinLength(2) @MaxLength(80) key!: string
  @IsString() @MinLength(1) @MaxLength(120) title!: string
  @IsString() @MinLength(1) @MaxLength(300) description!: string
  @IsOptional() @IsString() @MaxLength(40) icon?: string
  @IsOptional() @IsString() @MaxLength(40) category?: string
  @IsString() @IsIn(ENGAGEMENT_EVENT_TYPES as unknown as string[]) eventType!: string
  @IsOptional() @IsJSON() filters?: string
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number
}

export class UpdateAchievementDto extends CreateAchievementDto {}

export class CreateAchievementTierDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000) tier!: number
  @IsString() @MinLength(1) @MaxLength(100) title!: string
  @Type(() => Number) @IsInt() @Min(1) @Max(1000000) target!: number
  @IsOptional() @IsString() @MaxLength(40) rewardGld?: string
  @IsOptional() @IsString() @MaxLength(30) rewardXp?: string
}

export class UpdateAchievementTierDto extends CreateAchievementTierDto {}

export class ClaimAchievementDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) tier?: number
}
