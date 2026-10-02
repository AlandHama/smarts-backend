import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { LiveChatListQueryDto, LiveChatMessageDto, LiveChatStatusUpdateDto, SupportAgentStatusDtoClass, SupportEscalateDto, SupportListQueryDto, SupportTicketMessageDto, SupportTicketStatusUpdateDto } from "./dtos"
import { SupportService } from "./support.service"
import { SupportLiveChatService } from "./support-live-chat.service"

@ApiTags("Support agents")
@ApiBearerAuth("access-token")
@Controller("support/agent")
export class SupportAgentController {
  constructor(private readonly support: SupportService, private readonly liveChat: SupportLiveChatService) {}

  @Get("me") me(@CurrentUser() user: UserResponseDto) { return this.support.agentMe(user.id) }
  @Patch("status") status(@CurrentUser() user: UserResponseDto, @Body() dto: SupportAgentStatusDtoClass) { return this.support.updateAgentStatus(user.id, dto) }
  @Get("queue") queue(@CurrentUser() user: UserResponseDto, @Query() query: SupportListQueryDto) { return this.support.agentQueue(user.id, query) }
  @Get("canned-replies") cannedReplies(@Query("categoryId") categoryId?: string) { return this.support.listCannedReplies(categoryId) }
  @Post("tickets/:ticketId/claim") claim(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.support.claim(user.id, ticketId) }
  @Get("tickets/:ticketId") ticket(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.support.getTicket(user.id, ticketId, true) }
  @Post("tickets/:ticketId/messages") message(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketMessageDto) { return this.support.addAgentMessage(user.id, ticketId, dto) }
  @Post("tickets/:ticketId/notes") note(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketMessageDto) { return this.support.addAgentMessage(user.id, ticketId, dto, true) }
  @Post("tickets/:ticketId/escalate") escalate(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportEscalateDto) { return this.support.escalateTicket(user.id, ticketId, dto) }
  @Patch("tickets/:ticketId/status") ticketStatus(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketStatusUpdateDto) { return this.support.updateTicketStatus(user.id, ticketId, dto) }
  @Get("live-chats") liveChats(@CurrentUser() user: UserResponseDto, @Query() query: LiveChatListQueryDto) { return this.liveChat.agentQueue(user.id, query) }
  @Get("live-chats/:sessionId") liveChatDetail(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string) { return this.liveChat.get(user.id, sessionId, true) }
  @Post("live-chats/:sessionId/claim") claimLive(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string) { return this.liveChat.claim(user.id, sessionId) }
  @Post("live-chats/:sessionId/messages") liveMessage(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string, @Body() dto: LiveChatMessageDto) { return this.liveChat.sendAgentMessage(user.id, sessionId, dto) }
  @Patch("live-chats/:sessionId/status") liveStatus(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string, @Body() dto: LiveChatStatusUpdateDto) { return this.liveChat.updateStatus(user.id, sessionId, dto) }
  @Post("live-chats/:sessionId/end") endLive(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string) { return this.liveChat.end(user.id, sessionId) }
}
