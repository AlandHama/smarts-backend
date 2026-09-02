import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger"
import { IsDateString, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator"
import { GameMode, MatchEventType } from "@prisma/client"

export class CreateMatchDto {
  @ApiProperty({ example: "trivia" })
  @IsString()
  @MaxLength(64)
  gameKey!: string

  @ApiProperty({ enum: GameMode })
  @IsEnum(GameMode)
  mode!: GameMode

  @ApiPropertyOptional({ description: "Only used by an authenticated friend/casual match flow." })
  @IsOptional()
  @IsUUID()
  opponentUserId?: string

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>
}

export class MatchEventDto {
  @ApiProperty({ enum: MatchEventType })
  @IsEnum(MatchEventType)
  eventType!: MatchEventType

  @ApiProperty({ example: "answer-1" })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  clientEventId!: string

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  @Max(1000000)
  sequence!: number

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  clientOccurredAt?: string
}

export class CompleteMatchDto {
  @ApiProperty({ example: "complete-match-uuid" })
  @IsString()
  @MaxLength(128)
  idempotencyKey!: string
}
