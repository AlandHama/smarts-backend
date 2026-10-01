import { Type } from "class-transformer"
import { ArrayMaxSize, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from "class-validator"

export enum SupportPriorityDto { LOW = "LOW", NORMAL = "NORMAL", HIGH = "HIGH", URGENT = "URGENT" }
export enum SupportStatusDto { OPEN = "OPEN", TRIAGED = "TRIAGED", ASSIGNED = "ASSIGNED", WAITING_FOR_PLAYER = "WAITING_FOR_PLAYER", WAITING_FOR_SUPPORT = "WAITING_FOR_SUPPORT", ESCALATED = "ESCALATED", RESOLVED = "RESOLVED", CLOSED = "CLOSED", REOPENED = "REOPENED" }
export enum SupportAgentLevelDto { AGENT = "AGENT", SENIOR = "SENIOR", SUPERVISOR = "SUPERVISOR" }
export enum SupportAgentStatusDto { OFFLINE = "OFFLINE", AVAILABLE = "AVAILABLE", BUSY = "BUSY", SUSPENDED = "SUSPENDED" }

export class CreateSupportTicketDto {
  @IsUUID() categoryId!: string
  @IsString() @MinLength(1) @MaxLength(160) subject!: string
  @IsString() @MinLength(1) @MaxLength(4000) body!: string
  @IsOptional() @IsString() @MaxLength(120) clientMessageId?: string
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
}

export class CreateSupportCategoryDto {
  @IsString() @MinLength(2) @MaxLength(60) key!: string
  @IsString() @MinLength(1) @MaxLength(100) name!: string
  @IsOptional() @IsString() @MaxLength(300) description?: string | null
  @IsOptional() @IsString() @MaxLength(60) queueKey?: string | null
  @IsOptional() @IsEnum(SupportPriorityDto) defaultPriority?: SupportPriorityDto
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number
  @IsOptional() @IsBoolean() active?: boolean
}

export class UpdateSupportCategoryDto extends CreateSupportCategoryDto {}

export class GrantSupportAgentDto {
  @IsUUID() userId!: string
  @IsOptional() @IsEnum(SupportAgentLevelDto) level?: SupportAgentLevelDto
  @IsOptional() @IsInt() @Min(1) @Max(1000) @Type(() => Number) maxConcurrentTickets?: number
}

export class UpdateSupportAgentDto {
  @IsOptional() @IsEnum(SupportAgentLevelDto) level?: SupportAgentLevelDto
  @IsOptional() @IsEnum(SupportAgentStatusDto) status?: SupportAgentStatusDto
  @IsOptional() @IsInt() @Min(1) @Max(1000) @Type(() => Number) maxConcurrentTickets?: number
  @IsOptional() @IsString() @MaxLength(500) suspensionReason?: string | null
}
