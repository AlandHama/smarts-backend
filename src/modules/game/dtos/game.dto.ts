import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger"
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, Matches, Max, Min } from "class-validator"

const DECIMAL = /^\d+(\.\d{1,8})?$/

export class UpdateGameConfigDto {
  @ApiPropertyOptional({ example: "main" })
  @IsOptional()
  @IsString()
  mainProgressionKey?: string

  @ApiPropertyOptional({ example: "elo" })
  @IsOptional()
  @IsString()
  eloProgressionKey?: string

  @ApiPropertyOptional({ example: "MCN" })
  @IsOptional()
  @IsString()
  rewardCurrencyCode?: string

  @ApiPropertyOptional({ example: "1.0" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  scoreMultiplierForXp?: string

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxEloDelta?: number

  @ApiPropertyOptional({ example: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  soloEloScoreDivisor?: number

  @ApiPropertyOptional({ example: 200 })
  @IsOptional()
  @IsInt()
  @Min(0)
  soloEloMaxDelta?: number

  @ApiPropertyOptional({ example: "300" })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  winnerBaseReward?: string

  @ApiPropertyOptional({ example: "100" })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  loserBaseReward?: string

  @ApiPropertyOptional({ example: "250" })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  drawReward?: string

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  scoreRewardDivisor?: number

  @ApiPropertyOptional({ example: "200" })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  scoreRewardCap?: string

  @ApiPropertyOptional({ example: "200" })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  winnerRewardBonusMax?: string

  @ApiPropertyOptional({ example: "100" })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  loserRewardBonusMax?: string

  @ApiPropertyOptional({ example: "1000" })
  @IsOptional()
  @IsString()
  @Matches(/^\d+$/)
  multiplayerRewardReference?: string

  @ApiPropertyOptional({ example: { "1": 100, "2": 120, "3": 150, "4": 180, "5": 200 } })
  @IsOptional()
  @IsObject()
  correctAnswerPoints?: Record<string, number>

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  wrongAnswerPenaltyPercent?: number

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAnswerTimeSeconds?: number

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxMatchDurationSeconds?: number

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxQuestions?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  rankingEnabled?: boolean

  @ApiPropertyOptional({ example: "1.5" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  rankingEloMultiplier?: string

  @ApiPropertyOptional({ example: "1.5" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  rankingLevelMultiplier?: string

  @ApiPropertyOptional({ example: "1.5" })
  @IsOptional()
  @IsString()
  @Matches(DECIMAL)
  rankingCoinMultiplier?: string

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>
}

export class CreateGameContentDto {
  @ApiProperty({ example: "trivia" })
  @IsString()
  gameKey!: string

  @ApiProperty({ example: "multiple_choice" })
  @IsString()
  contentType!: string

  @ApiProperty({ type: Object, example: { en: "What is 2 + 2?" } })
  @IsObject()
  prompt!: Record<string, unknown>

  @ApiProperty({ type: Object, example: ["3", "4", "5", "6"] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(8)
  options!: unknown[]

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  difficulty!: number

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  @Max(7)
  answerIndex!: number

  @ApiPropertyOptional({ example: "general" })
  @IsOptional()
  @IsString()
  category?: string
}

export class UpdateGameContentDto extends PartialType(CreateGameContentDto) {}
