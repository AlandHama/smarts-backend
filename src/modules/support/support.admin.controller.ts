import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { CreateSupportArticleDto, CreateSupportCategoryDto, CreateSupportCannedReplyDto, GrantSupportAgentDto, LiveChatListQueryDto, LiveChatRefundDto, SupportArticleListQueryDto, SupportListQueryDto, SupportTicketMessageDto, SupportTicketStatusUpdateDto, UpdateSupportAgentDto, UpdateSupportCategoryDto, UpdateSupportConfigurationDto } from "./dtos"
import { SupportService } from "./support.service"
import { SupportLiveChatService } from "./support-live-chat.service"

@ApiTags("System admin support center")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api/support")
export class SupportAdminController {
  constructor(private readonly support: SupportService, private readonly liveChat: SupportLiveChatService) {}

  @Get("configuration") configuration() { return this.support.getConfiguration() }
  @Patch("configuration") updateConfiguration(@CurrentUser() admin: UserResponseDto, @Body() dto: UpdateSupportConfigurationDto) { return this.support.updateConfiguration(admin.id, dto) }
  @Get("categories") categories() { return this.support.listCategories(true) }
  @Post("categories") createCategory(@CurrentUser() admin: UserResponseDto, @Body() dto: CreateSupportCategoryDto) { return this.support.createCategory(admin.id, dto) }
  @Patch("categories/:categoryId") updateCategory(@CurrentUser() admin: UserResponseDto, @Param("categoryId", ParseUUIDPipe) categoryId: string, @Body() dto: UpdateSupportCategoryDto) { return this.support.updateCategory(admin.id, categoryId, dto) }
  @Get("articles") articles(@Query() query: SupportArticleListQueryDto) { return this.support.adminArticles(query) }
  @Post("articles") createArticle(@CurrentUser() admin: UserResponseDto, @Body() dto: CreateSupportArticleDto) { return this.support.createArticle(admin.id, dto) }
  @Patch("articles/:articleId") updateArticle(@CurrentUser() admin: UserResponseDto, @Param("articleId", ParseUUIDPipe) articleId: string, @Body() dto: CreateSupportArticleDto) { return this.support.updateArticle(admin.id, articleId, dto) }
  @Post("articles/:articleId/archive") archiveArticle(@CurrentUser() admin: UserResponseDto, @Param("articleId", ParseUUIDPipe) articleId: string) { return this.support.archiveArticle(admin.id, articleId) }
  @Get("canned-replies") cannedReplies() { return this.support.adminCannedReplies() }
  @Post("canned-replies") createCannedReply(@CurrentUser() admin: UserResponseDto, @Body() dto: CreateSupportCannedReplyDto) { return this.support.createCannedReply(admin.id, dto) }
  @Patch("canned-replies/:replyId") updateCannedReply(@CurrentUser() admin: UserResponseDto, @Param("replyId", ParseUUIDPipe) replyId: string, @Body() dto: CreateSupportCannedReplyDto) { return this.support.updateCannedReply(admin.id, replyId, dto) }
  @Get("agents") agents() { return this.support.adminAgents() }
  @Post("agents") grantAgent(@CurrentUser() admin: UserResponseDto, @Body() dto: GrantSupportAgentDto) { return this.support.grantAgent(admin.id, dto) }
  @Patch("agents/:agentId") updateAgent(@CurrentUser() admin: UserResponseDto, @Param("agentId", ParseUUIDPipe) agentId: string, @Body() dto: UpdateSupportAgentDto) { return this.support.updateAgent(admin.id, agentId, dto) }
  @Post("agents/:agentId/revoke") revokeAgent(@CurrentUser() admin: UserResponseDto, @Param("agentId", ParseUUIDPipe) agentId: string) { return this.support.revokeAgent(admin.id, agentId) }
  @Get("tickets") tickets(@Query() query: SupportListQueryDto) { return this.support.adminListTickets(query) }
  @Get("audit") audit(@Query("limit") limit?: string) { return this.support.adminAudit(Number(limit) || 100) }
  @Get("reports") reports(@CurrentUser() admin: UserResponseDto, @Query("from") from?: string, @Query("to") to?: string) { return this.support.supportReports(admin.id, from, to) }
  @Get("reports/export") exportReport(@CurrentUser() admin: UserResponseDto, @Query("from") from?: string, @Query("to") to?: string) { return this.support.exportSupportReport(admin.id, from, to) }
  @Get("tickets/:ticketId") ticket(@CurrentUser() admin: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.support.getTicket(admin.id, ticketId, true) }
  @Post("tickets/:ticketId/messages") message(@CurrentUser() admin: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketMessageDto) { return this.support.addAgentMessage(admin.id, ticketId, dto, false, true) }
  @Post("tickets/:ticketId/assign") assign(@CurrentUser() admin: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: { agentId: string; reason?: string }) { return this.support.assign(admin.id, ticketId, dto.agentId, dto.reason) }
  @Patch("tickets/:ticketId/status") status(@CurrentUser() admin: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketStatusUpdateDto) { return this.support.updateTicketStatus(admin.id, ticketId, dto, true) }
  @Post("retention/run") retention(@CurrentUser() admin: UserResponseDto) { return this.support.runRetentionCleanup(admin.id) }
  @Get("live-chats") liveChats(@Query() query: LiveChatListQueryDto) { return this.liveChat.adminList(query) }
  @Get("live-chats/:sessionId") liveChatDetail(@CurrentUser() admin: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string) { return this.liveChat.get(admin.id, sessionId, true) }
  @Post("live-chats/:sessionId/refund") refund(@CurrentUser() admin: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string, @Body() dto: LiveChatRefundDto) { return this.liveChat.adminRefund(admin.id, sessionId, dto) }
  @Post("live-chats/refund-sweep") refundSweep(@CurrentUser() admin: UserResponseDto) { return this.liveChat.runNoAgentRefunds(admin.id) }
}
