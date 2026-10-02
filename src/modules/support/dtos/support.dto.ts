import { Type } from "class-transformer"
import { ArrayMaxSize, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator"

export enum SupportPriorityDto { LOW = "LOW", NORMAL = "NORMAL", HIGH = "HIGH", URGENT = "URGENT" }
export enum SupportStatusDto { OPEN = "OPEN", TRIAGED = "TRIAGED", ASSIGNED = "ASSIGNED", WAITING_FOR_PLAYER = "WAITING_FOR_PLAYER", WAITING_FOR_SUPPORT = "WAITING_FOR_SUPPORT", ESCALATED = "ESCALATED", RESOLVED = "RESOLVED", CLOSED = "CLOSED", REOPENED = "REOPENED" }
export enum SupportAgentLevelDto { AGENT = "AGENT", SENIOR = "SENIOR", SUPERVISOR = "SUPERVISOR" }
export enum SupportAgentStatusDto { OFFLINE = "OFFLINE", AVAILABLE = "AVAILABLE", BUSY = "BUSY", SUSPENDED = "SUSPENDED" }
export enum SupportLiveChatStatusDto { PAYMENT_PENDING = "PAYMENT_PENDING", QUEUED = "QUEUED", ASSIGNED = "ASSIGNED", ACTIVE = "ACTIVE", PAUSED = "PAUSED", WAITING_FOR_PLAYER = "WAITING_FOR_PLAYER", ENDED = "ENDED", REFUND_PENDING = "REFUND_PENDING", REFUNDED = "REFUNDED", EXPIRED = "EXPIRED" }

export class CreateSupportTicketDto {
  @IsUUID() categoryId!: string
  @IsString() @MinLength(1) @MaxLength(160) subject!: string
  @IsString() @MinLength(1) @MaxLength(4000) body!: string
  @IsOptional() @IsString() @MaxLength(120) clientMessageId?: string
  @IsOptional() @IsObject() customData?: Record<string, unknown>
}

export class SupportTicketMessageDto {
  @IsString() @MinLength(1) @MaxLength(120) clientMessageId!: string
  @IsString() @MinLength(1) @MaxLength(4000) body!: string
}

export class SupportListQueryDto {
  @IsOptional() @IsEnum(SupportStatusDto) status?: SupportStatusDto
  @IsOptional() @IsEnum(SupportPriorityDto) priority?: SupportPriorityDto
  @IsOptional() @IsUUID() categoryId?: string
  @IsOptional() @IsString() @MaxLength(120) search?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) offset = 0
}

export class SupportReadDto {
  @Type(() => Number) @IsInt() @Min(0) sequence!: number
}

export class SupportAgentStatusDtoClass {
  @IsEnum(SupportAgentStatusDto) status!: SupportAgentStatusDto
}

export class SupportTicketStatusUpdateDto {
  @IsEnum(SupportStatusDto) status!: SupportStatusDto
  @IsOptional() @IsString() @MaxLength(1000) note?: string
}

export class StartLiveChatDto {
  @IsUUID() quoteId!: string
  @IsString() @MinLength(8) @MaxLength(120) idempotencyKey!: string
}

export class LiveChatMessageDto {
  @IsString() @MinLength(1) @MaxLength(4000) body!: string
  @IsString() @MinLength(1) @MaxLength(120) clientMessageId!: string
}

export class LiveChatStatusUpdateDto {
  @IsEnum(SupportLiveChatStatusDto) status!: SupportLiveChatStatusDto
}

export class LiveChatListQueryDto {
  @IsOptional() @IsEnum(SupportLiveChatStatusDto) status?: SupportLiveChatStatusDto
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0
}

export class SupportAssignDto {
  @IsUUID() agentId!: string
  @IsOptional() @IsString() @MaxLength(500) reason?: string
}

export class UpdateSupportConfigurationDto {
  @IsOptional() @IsBoolean() enabled?: boolean
  @IsOptional() @IsString() @MaxLength(300) maintenanceMessage?: string | null
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) ticketRetentionDays?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) messageRetentionDays?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) maxOpenTicketsPerPlayer?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(20000) maxMessageLength?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(20) @Max(500) maxSubjectLength?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10080) firstResponseSlaMinutes?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(720) playerReplyTimeoutHours?: number
  @IsOptional() @IsBoolean() pushNotificationsEnabled?: boolean
  @IsOptional() @IsBoolean() liveChatEnabled?: boolean
  @IsOptional() @IsString() @MaxLength(40) liveChatPriceGld?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(240) liveChatSessionMinutes?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(120) liveChatGraceMinutes?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) maxLiveChatQueueSize?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1440) autoCloseInactiveMinutes?: number
  @IsOptional() @IsBoolean() refundOnNoAgentConnection?: boolean
  @IsOptional() @IsBoolean() refundOnSystemFailure?: boolean
  @IsOptional() @IsBoolean() refundOnAgentCancellation?: boolean
  @IsOptional() @IsBoolean() requirePlayerRating?: boolean
  @IsOptional() @IsString() @MaxLength(16) liveChatCurrencyCode?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) playerCanReopenDays?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) attachmentRetentionDays?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10) maxAttachmentsPerMessage?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1024) @Max(52428800) maxAttachmentSizeBytes?: number
  @IsOptional() @IsString() @MaxLength(20) profanityPolicy?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) playerTicketRatePerHour?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) playerLiveChatRatePerDay?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(120) agentReplyRatePerMinute?: number
  @IsOptional() @IsBoolean() allowRestrictedPlayers?: boolean
  @IsOptional() @IsBoolean() slaWorkerEnabled?: boolean
}

export enum SupportArticleStatusDto { DRAFT = "DRAFT", PUBLISHED = "PUBLISHED", ARCHIVED = "ARCHIVED" }

export class SupportArticleListQueryDto {
  @IsOptional() @IsString() @MaxLength(120) query?: string
  @IsOptional() @IsUUID() categoryId?: string
  @IsOptional() @IsEnum(SupportArticleStatusDto) status?: SupportArticleStatusDto
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0
}

export class CreateSupportArticleDto {
  @IsString() @MinLength(2) @MaxLength(160) slug!: string
  @IsString() @MinLength(2) @MaxLength(180) title!: string
  @IsString() @MinLength(2) @MaxLength(500) summary!: string
  @IsString() @MinLength(2) @MaxLength(50000) body!: string
  @IsOptional() @IsUUID() categoryId?: string | null
  @IsOptional() @IsEnum(SupportArticleStatusDto) status?: SupportArticleStatusDto
  @IsOptional() @IsString() @MaxLength(500) tags?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number
}

export class CreateSupportCannedReplyDto {
  @IsString() @MinLength(2) @MaxLength(80) key!: string
  @IsString() @MinLength(2) @MaxLength(160) title!: string
  @IsString() @MinLength(1) @MaxLength(10000) body!: string
  @IsOptional() @IsUUID() categoryId?: string | null
  @IsOptional() @IsBoolean() active?: boolean
}

export class SupportRatingDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number
  @IsOptional() @IsString() @MaxLength(1000) comment?: string
}

export class SupportEscalateDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string
}

export class SupportAttachmentPresignDto {
  @IsUUID() ticketId!: string
  @IsString() @MinLength(1) @MaxLength(255) fileName!: string
  @IsString() @MinLength(1) @MaxLength(120) mimeType!: string
  @Type(() => Number) @IsInt() @Min(1) sizeBytes!: number
}

export class CreateSupportCategoryDto {
  @IsString() @MinLength(2) @MaxLength(60) key!: string
  @IsString() @MinLength(1) @MaxLength(100) name!: string
  @IsOptional() @IsString() @MaxLength(300) description?: string | null
  @IsOptional() @IsString() @MaxLength(60) queueKey?: string | null
  @IsOptional() @IsEnum(SupportPriorityDto) defaultPriority?: SupportPriorityDto
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number
  @IsOptional() @IsBoolean() active?: boolean
  @IsOptional() @IsObject() formSchema?: Record<string, unknown>
}

export class UpdateSupportCategoryDto extends CreateSupportCategoryDto {}

export class GrantSupportAgentDto {
  @IsUUID() userId!: string
  @IsOptional() @IsEnum(SupportAgentLevelDto) level?: SupportAgentLevelDto
  @IsOptional() @IsInt() @Min(1) @Max(1000) @Type(() => Number) maxConcurrentTickets?: number
  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number) maxConcurrentLiveChats?: number
}

export class UpdateSupportAgentDto {
  @IsOptional() @IsEnum(SupportAgentLevelDto) level?: SupportAgentLevelDto
  @IsOptional() @IsEnum(SupportAgentStatusDto) status?: SupportAgentStatusDto
  @IsOptional() @IsInt() @Min(1) @Max(1000) @Type(() => Number) maxConcurrentTickets?: number
  @IsOptional() @IsString() @MaxLength(500) suspensionReason?: string | null
  @IsOptional() @IsInt() @Min(1) @Max(100) @Type(() => Number) maxConcurrentLiveChats?: number
}

export class LiveChatRefundDto {
  @IsString() @MinLength(1) @MaxLength(500) reason!: string
}
