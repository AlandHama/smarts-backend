import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { ChatsService } from "./chats.service"
import { AdminChatMessagesQueryDto, AdminChatReportQueryDto, AdminChatsQueryDto, AdminChatRestrictionDto, AdminChatStatusDto, AdminChatUnrestrictionDto, AdminMuteChatDto, AdminPreserveChatEvidenceDto, AdminRemoveChatMessageDto, AdminResolveChatReportDto, UpdateChatConfigurationDto } from "./dtos"

@ApiTags("System admin friend chats")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api/chats")
export class ChatsAdminController {
  constructor(private readonly chats: ChatsService) {}

  @Get("configuration") configuration() { return this.chats.getConfiguration() }

  @Patch("configuration") update(@Body() dto: UpdateChatConfigurationDto, @CurrentUser() admin: UserResponseDto) { return this.chats.updateConfiguration(dto, admin.id) }

  @Get("conversations") conversations(@Query() query: AdminChatsQueryDto) { return this.chats.listAdminConversations(query) }

  @Get("conversations/:conversationId/messages") messages(@Param("conversationId", ParseUUIDPipe) conversationId: string, @Query() query: AdminChatMessagesQueryDto) { return this.chats.listAdminMessages(conversationId, query) }

  @Patch("conversations/:conversationId/status") status(@Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: AdminChatStatusDto, @CurrentUser() admin: UserResponseDto) { return this.chats.updateAdminConversationStatus(conversationId, dto, admin.id) }

  @Post("conversations/:conversationId/restrict") restrict(@Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: AdminChatRestrictionDto, @CurrentUser() admin: UserResponseDto) { return this.chats.restrictConversation(conversationId, dto, admin.id) }

  @Post("conversations/:conversationId/unrestrict") unrestrict(@Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: AdminChatUnrestrictionDto, @CurrentUser() admin: UserResponseDto) { return this.chats.unrestrictConversation(conversationId, dto, admin.id) }

  @Patch("conversations/:conversationId/mute") mute(@Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: AdminMuteChatDto, @CurrentUser() admin: UserResponseDto) { return this.chats.muteConversation(conversationId, dto, admin.id) }

  @Post("messages/:messageId/remove") remove(@Param("messageId", ParseUUIDPipe) messageId: string, @Body() dto: AdminRemoveChatMessageDto, @CurrentUser() admin: UserResponseDto) { return this.chats.removeAdminMessage(messageId, dto, admin.id) }

  @Post("messages/:messageId/preserve") preserve(@Param("messageId", ParseUUIDPipe) messageId: string, @Body() dto: AdminPreserveChatEvidenceDto, @CurrentUser() admin: UserResponseDto) { return this.chats.preserveAdminMessage(messageId, dto, admin.id) }

  @Get("reports") reports(@Query() query: AdminChatReportQueryDto) { return this.chats.listAdminReports(query) }

  @Patch("reports/:reportId") resolveReport(@Param("reportId", ParseUUIDPipe) reportId: string, @Body() dto: AdminResolveChatReportDto, @CurrentUser() admin: UserResponseDto) { return this.chats.resolveAdminReport(reportId, dto, admin.id) }

  @Get("retention/status") retentionStatus() { return this.chats.retentionStatus() }

  @Post("retention/run") retentionRun(@CurrentUser() admin: UserResponseDto) { return this.chats.runRetentionCleanup(admin.id) }
}
