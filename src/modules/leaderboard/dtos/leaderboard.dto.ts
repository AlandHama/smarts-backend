import { ApiProperty, ApiPropertyOptional, PartialType } from "@nestjs/swagger"
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator"
import { LeaderboardDirection, LeaderboardMemberType, LeaderboardPeriod, LeaderboardScoreSourceType, LeaderboardWritePolicy } from "@prisma/client"

const SIGNED_INTEGER = /^-?\d+$/
const MEMBER_KEY = /^[A-Za-z0-9:_-]{1,128}$/

export class CreateLeaderboardDto {
  @ApiProperty({ example: "players_weekly" })
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9:_-]{0,79}$/)
  key!: string

  @ApiProperty({ example: "Players · Weekly" })
  @IsString()
  @MaxLength(120)
  name!: string

  @ApiProperty({ enum: LeaderboardMemberType })
  @IsEnum(LeaderboardMemberType)
  memberType!: LeaderboardMemberType

  @ApiProperty({ enum: LeaderboardPeriod })
  @IsEnum(LeaderboardPeriod)
  period!: LeaderboardPeriod

  @ApiPropertyOptional({ enum: LeaderboardDirection, default: LeaderboardDirection.DESCENDING })
  @IsOptional()
  @IsEnum(LeaderboardDirection)
  direction?: LeaderboardDirection

  @ApiPropertyOptional({ enum: LeaderboardWritePolicy, default: LeaderboardWritePolicy.SERVER_ONLY })
  @IsOptional()
  @IsEnum(LeaderboardWritePolicy)
  writePolicy?: LeaderboardWritePolicy

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class UpdateLeaderboardDto extends PartialType(CreateLeaderboardDto) {}

export class LeaderboardQueryDto {
  @ApiPropertyOptional({ default: 25, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number
}

export class LeaderboardMembersDto {
  @ApiProperty({ type: [String], example: ["country-code", "player-uuid"] })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(128, { each: true })
  memberKeys!: string[]
}

export class ApplyLeaderboardScoreDto {
  @ApiPropertyOptional({ example: "US", description: "Required for country/generic boards." })
  @IsOptional()
  @IsString()
  @Matches(MEMBER_KEY)
  memberKey?: string

  @ApiPropertyOptional({ example: "player-uuid", description: "Required for player boards." })
  @IsOptional()
  @IsString()
  @IsUUID()
  playerId?: string

  @ApiProperty({ example: "25" })
  @IsString()
  @Matches(SIGNED_INTEGER)
  delta!: string

  @ApiProperty({ example: "match-settlement-uuid" })
  @IsString()
  @MaxLength(255)
  sourceId!: string

  @ApiPropertyOptional({ enum: LeaderboardScoreSourceType })
  @IsOptional()
  @IsEnum(LeaderboardScoreSourceType)
  sourceType?: LeaderboardScoreSourceType

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class CreateLeaderboardSeasonDto {
  @ApiProperty({ example: "2026-09-07T00:00:00.000Z" })
  @IsDateString()
  startsAt!: string

  @ApiProperty({ example: "2026-09-14T00:00:00.000Z" })
  @IsDateString()
  endsAt!: string
}

export class LeaderboardTopQueryDto extends LeaderboardQueryDto {}
