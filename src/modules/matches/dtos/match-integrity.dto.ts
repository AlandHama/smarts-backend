import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator"

export class UpdateMatchIntegrityPolicyDto {
  @IsString() @MinLength(2) @MaxLength(120) scopeKey!: string
  @IsOptional() @IsString() @MaxLength(64) gameKey?: string
  @IsOptional() @IsIn(["CASUAL", "RANKED", "PRACTICE", "BOT", "ALL"]) mode?: string
  @IsInt() @Min(1) version!: number
  @IsOptional() @IsBoolean() active?: boolean
  @IsOptional() @IsBoolean() killSwitch?: boolean
  @IsOptional() @IsInt() @Min(0) @Max(100) rolloutPercentage?: number
  @IsOptional() @IsBoolean() casualEnabled?: boolean
  @IsOptional() @IsBoolean() rankedEnabled?: boolean
  @IsOptional() @IsBoolean() practiceEnabled?: boolean
  @IsOptional() @IsObject() settings?: Record<string, unknown>
  @IsString() @MinLength(3) @MaxLength(500) reason!: string
}

export class MatchRewardReviewDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string
}

export class MatchRewardCorrectionDto {
  @IsString() @MinLength(8) @MaxLength(120) idempotencyKey!: string
  @IsString() @MinLength(2) @MaxLength(64) progressionKey!: string
  @IsString() @MinLength(1) @MaxLength(32) amount!: string
  @IsString() @MinLength(3) @MaxLength(500) reason!: string
}
