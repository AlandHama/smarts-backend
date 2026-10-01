import { Type } from "class-transformer"
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator"

export enum ChatReportCategoryDto {
  HARASSMENT = "HARASSMENT",
  HATE_THREATS = "HATE_THREATS",
  SEXUAL_UNSAFE = "SEXUAL_UNSAFE",
  SPAM_SCAM = "SPAM_SCAM",
  CHEATING_SOLICITATION = "CHEATING_SOLICITATION",
  INAPPROPRIATE_LINK = "INAPPROPRIATE_LINK",
  OTHER = "OTHER",
}

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

export class ReportChatMessageDto {
  @IsOptional()
  @IsUUID()
  messageId?: string

  @IsEnum(ChatReportCategoryDto)
  category!: ChatReportCategoryDto

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

export class AdminChatsQueryDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @IsString() @MaxLength(30) status?: string
  @IsOptional() @IsUUID() userId?: string
  @IsOptional() @IsUUID() cursor?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 30
}

export class AdminChatMessagesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 100
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) before?: number
}

export class AdminChatStatusDto {
  @IsString() @IsIn(["ACTIVE", "ARCHIVED"]) status!: "ACTIVE" | "ARCHIVED"
  @IsOptional() @IsString() @MaxLength(500) reason?: string
}

export class AdminChatRestrictionDto {
  @IsUUID() userId!: string
  @IsOptional() @IsDateString() restrictedUntil?: string | null
  @IsString() @MinLength(1) @MaxLength(500) reason!: string
}

export class AdminChatUnrestrictionDto {
  @IsUUID() userId!: string
  @IsOptional() @IsString() @MaxLength(500) reason?: string
}

export class AdminMuteChatDto {
  @IsUUID() userId!: string
  @IsOptional() @IsDateString() mutedUntil?: string | null
  @IsOptional() @IsString() @MaxLength(500) reason?: string
}

export class AdminPreserveChatEvidenceDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string
  @IsOptional() @IsString() @MaxLength(120) caseReference?: string
  @IsOptional() @IsDateString() expiresAt?: string | null
}

export class AdminRemoveChatMessageDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string
}

export class AdminChatReportQueryDto {
  @IsOptional() @IsString() @IsIn(["OPEN", "RESOLVED", "DISMISSED"]) status?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50
}

export class AdminResolveChatReportDto {
  @IsIn(["RESOLVED", "DISMISSED"]) status!: "RESOLVED" | "DISMISSED"
  @IsString() @MinLength(1) @MaxLength(500) resolutionNote!: string
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
  @IsOptional() @IsBoolean() includeMessagePreview?: boolean
  @IsOptional() @IsBoolean() friendChatOnly?: boolean
  @IsOptional() @IsBoolean() allowLinks?: boolean
  @IsOptional() @IsString() @MaxLength(300) maintenanceMessage?: string | null
}
