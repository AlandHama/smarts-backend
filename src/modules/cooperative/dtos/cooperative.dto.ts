import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator"

export class CreatePartyInviteDto {
  @IsUUID()
  inviteeId!: string
}

export class QueuePartyDto {
  @IsIn(["RANDOM", "RANKED"])
  mode!: "RANDOM" | "RANKED"

  @IsOptional()
  @IsString()
  clientVersion?: string
}

export class CooperativePolicyDto {
  @IsOptional() enabled?: boolean
  @IsOptional() randomEnabled?: boolean
  @IsOptional() rankedEnabled?: boolean
  @IsOptional() cooperativePartyEnabled?: boolean
  @IsOptional() cooperativeRandomEnabled?: boolean
  @IsOptional() cooperativeBotFillEnabled?: boolean
  @IsOptional() cooperativeRankedEnabled?: boolean
  @IsOptional() cooperativeVoiceEnabled?: boolean
  @IsOptional() cooperativeRewardsEnabled?: boolean
  @IsOptional() allowSoloParty?: boolean
  @IsOptional() botFillEnabled?: boolean
  @IsOptional() @IsInt() @Min(5) @Max(1440) partyIdleMinutes?: number
  @IsOptional() @IsInt() @Min(1) @Max(60) inviteExpiryMinutes?: number
  @IsOptional() @IsInt() @Min(15) @Max(3600) queueTimeoutSeconds?: number
  @IsOptional() @IsInt() @Min(1) minLevel?: number
  @IsOptional() @IsInt() @Min(0) minElo?: number
  @IsOptional() @IsInt() @Min(0) minCompletedMatches?: number
  @IsOptional() @IsString() rankedEntryFeeGld?: string
  @IsOptional() @IsString() rankedStakeAmountGld?: string
  @IsOptional() @IsInt() @Min(1) @Max(100) rankedPayoutPercent?: number
  @IsOptional() @IsInt() @Min(1) @Max(100) rankedEloBaseDelta?: number
  @IsOptional() @IsInt() @Min(1) @Max(500) rankedEloMaxDelta?: number
  @IsOptional() @IsInt() @Min(0) @Max(100) rankedTeamRatingWeightPercent?: number
  @IsOptional() @IsInt() @Min(0) @Max(10000) rankedPartyRatingSpread?: number
  @IsOptional() rankedBotFillEnabled?: boolean
  @IsOptional() rewardsEnabled?: boolean
  @IsOptional() hardeningAlertsEnabled?: boolean
  @IsOptional() @IsInt() @Min(1) @Max(20) settlementRetryLimit?: number
  @IsOptional() @IsInt() @Min(1) @Max(100) botAccuracyPercent?: number
  @IsOptional() @IsString() botPaceMultiplier?: string
  @IsOptional() voiceEnabled?: boolean
  @IsOptional() @IsInt() @Min(5) @Max(300) botFallbackDelaySeconds?: number
  @IsOptional() @IsInt() @Min(25) @Max(5000) initialRatingWindow?: number
  @IsOptional() @IsInt() @Min(25) @Max(10000) maxRatingWindow?: number
  @IsOptional() @IsInt() @Min(5) @Max(300) ratingWidenIntervalSeconds?: number
  @IsOptional() @IsInt() @Min(5) @Max(120) confirmationTimeoutSeconds?: number
  @IsOptional() @IsInt() @Min(5) @Max(180) disconnectGraceSeconds?: number
}
