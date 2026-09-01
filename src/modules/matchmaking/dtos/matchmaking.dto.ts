import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator"

export class EnqueuePlayerDto {
  @ApiProperty({ example: "trivia" })
  @IsString()
  @MaxLength(64)
  gameKey!: string

  @ApiProperty({ enum: ["CASUAL", "RANKED"] })
  @IsString()
  @MaxLength(16)
  mode!: "CASUAL" | "RANKED"

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  allowBotFallback?: boolean

  @ApiPropertyOptional({ example: "1.0.0" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  clientVersion?: string

  @ApiPropertyOptional({ example: "queue-retry-uuid" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string

  @ApiPropertyOptional({ type: Object, description: "Bounded preferences; never treated as a player snapshot." })
  @IsOptional()
  @IsObject()
  constraints?: Record<string, unknown>
}

export class TicketHeartbeatDto {
  @ApiPropertyOptional({ example: "queue-heartbeat-uuid" })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  idempotencyKey?: string
}

export class CreateFriendInviteDto {
  @ApiProperty({ example: "292c37c1-6aaa-4dbd-bc15-a895f9bc41a6" })
  @IsUUID()
  friendId!: string

  @ApiProperty({ example: "trivia" })
  @IsString()
  @MaxLength(64)
  gameKey!: string

  @ApiPropertyOptional({ example: "1.0.0" })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  clientVersion?: string
}

export class MatchmakingQueryDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20
}
