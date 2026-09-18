import { ApiProperty } from "@nestjs/swagger"

export class PlayerProfileResponseDto {
  @ApiProperty()
  displayName!: string

  @ApiProperty({ nullable: true })
  avatarUrl!: string | null

  @ApiProperty({ nullable: true })
  countryCode!: string | null

  @ApiProperty({ nullable: true })
  bio!: string | null

  @ApiProperty()
  level!: number

  @ApiProperty({ description: "XP represented as a decimal string" })
  xp!: string

  @ApiProperty()
  elo!: number
}

export class PlayerStatsResponseDto {
  @ApiProperty()
  gamesPlayed!: number

  @ApiProperty()
  wins!: number

  @ApiProperty()
  losses!: number

  @ApiProperty()
  draws!: number

  @ApiProperty()
  currentWinStreak!: number

  @ApiProperty()
  highestWinStreak!: number

  @ApiProperty()
  highestElo!: number

  @ApiProperty({ description: "Total score represented as a decimal string" })
  totalScore!: string
}

export class PlayerCognitiveStatsResponseDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  calculation!: number

  @ApiProperty({ minimum: 0, maximum: 100 })
  speed!: number

  @ApiProperty({ minimum: 0, maximum: 100 })
  accuracy!: number

  @ApiProperty({ minimum: 0, maximum: 100 })
  judgement!: number

  @ApiProperty({ minimum: 0, maximum: 100 })
  observation!: number

  @ApiProperty({ minimum: 0, maximum: 100 })
  memory!: number

  @ApiProperty()
  matchesEvaluated!: number
}

export class PlayerWalletBalanceResponseDto {
  @ApiProperty({ example: "MCN" })
  code!: string

  @ApiProperty({ example: "0", description: "Balance represented as a decimal string" })
  amount!: string
}

export class PlayerWalletResponseDto {
  @ApiProperty({ enum: ["ACTIVE", "LOCKED", "CLOSED"] })
  status!: string

  @ApiProperty({ type: () => [PlayerWalletBalanceResponseDto] })
  balances!: PlayerWalletBalanceResponseDto[]
}

export class PublicPlayerStatsResponseDto {
  @ApiProperty()
  gamesPlayed!: number

  @ApiProperty()
  wins!: number

  @ApiProperty()
  losses!: number

  @ApiProperty()
  draws!: number

  @ApiProperty()
  currentWinStreak!: number

  @ApiProperty()
  highestWinStreak!: number

  @ApiProperty()
  highestElo!: number

  @ApiProperty({ description: "Total score represented as a decimal string" })
  totalScore!: string
}

export class PlayerResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string

  @ApiProperty()
  username!: string

  @ApiProperty({ required: false, nullable: true })
  email?: string | null

  @ApiProperty({ enum: ["ACTIVE", "INACTIVE", "BANNED"] })
  status!: string

  @ApiProperty({ type: () => PlayerProfileResponseDto })
  profile!: PlayerProfileResponseDto

  @ApiProperty({ type: () => PlayerStatsResponseDto })
  stats!: PlayerStatsResponseDto

  @ApiProperty({ type: () => PlayerCognitiveStatsResponseDto })
  cognitiveStats!: PlayerCognitiveStatsResponseDto

  @ApiProperty({ type: () => PlayerWalletResponseDto })
  wallet!: PlayerWalletResponseDto
}

export class PublicPlayerResponseDto {
  @ApiProperty({ format: "uuid" })
  id!: string

  @ApiProperty()
  username!: string

  @ApiProperty({ type: () => PlayerProfileResponseDto })
  profile!: PlayerProfileResponseDto

  @ApiProperty({ type: () => PublicPlayerStatsResponseDto })
  stats!: PublicPlayerStatsResponseDto

  @ApiProperty({ type: () => PlayerCognitiveStatsResponseDto })
  cognitiveStats!: PlayerCognitiveStatsResponseDto
}
