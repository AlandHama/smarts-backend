import { Type } from "class-transformer"
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator"

export class ChatConversationsQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 30
}

export class ChatMessagesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  before?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50
}

export class CreateChatConversationDto {
  @IsUUID()
  friendId!: string
}

export class SendChatMessageDto {
  @IsString()
  @MinLength(1)
  clientMessageId!: string

  @IsString()
  @MinLength(1)
  body!: string
}

export class MarkChatReadDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sequence!: number
}

export class MuteChatDto {
  @IsOptional()
  @IsDateString()
  mutedUntil?: string | null
}

export class UpdateChatConfigurationDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) retentionDays?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) maxMessageLength?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) maxMessagesPerMinute?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) maxMessagesPerDay?: number
  @IsOptional() @IsBoolean() typingEnabled?: boolean
  @IsOptional() @IsBoolean() readReceiptsEnabled?: boolean
  @IsOptional() @IsBoolean() pushNotificationsEnabled?: boolean
  @IsOptional() @IsBoolean() friendChatOnly?: boolean
  @IsOptional() @IsBoolean() allowLinks?: boolean
  @IsOptional() @IsString() @MaxLength(300) maintenanceMessage?: string | null
}
