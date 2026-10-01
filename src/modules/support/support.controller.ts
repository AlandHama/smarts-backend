import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { CreateSupportTicketDto, LiveChatListQueryDto, LiveChatMessageDto, StartLiveChatDto, SupportListQueryDto, SupportReadDto, SupportTicketMessageDto } from "./dtos"
import { SupportService } from "./support.service"
import { SupportLiveChatService } from "./support-live-chat.service"

@ApiTags("Support center")
@ApiBearerAuth("access-token")
@Controller("support")
export class SupportController {
  constructor(private readonly support: SupportService, private readonly liveChat: SupportLiveChatService) {}

  @Get("configuration") configuration() { return this.support.getConfiguration() }
  @Get("summary") summary(@CurrentUser() user: UserResponseDto) { return this.support.getPublicSummary(user.id) }
  @Get("categories") categories() { return this.support.listCategories() }
  @Get("tickets") tickets(@CurrentUser() user: UserResponseDto, @Query() query: SupportListQueryDto) { return this.support.listPlayerTickets(user.id, query) }
  @Post("tickets") create(@CurrentUser() user: UserResponseDto, @Body() dto: CreateSupportTicketDto) { return this.support.createTicket(user.id, dto) }
  @Get("tickets/:ticketId") ticket(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.support.getTicket(user.id, ticketId) }
  @Post("tickets/:ticketId/messages") message(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketMessageDto) { return this.support.addPlayerMessage(user.id, ticketId, dto) }
  @Patch("tickets/:ticketId/read") read(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportReadDto) { return this.support.markRead(user.id, ticketId, dto.sequence) }
  @Post("tickets/:ticketId/reopen") reopen(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.support.reopen(user.id, ticketId) }
  @Post("live-chats/quote") liveQuote(@CurrentUser() user: UserResponseDto) { return this.liveChat.quote(user.id) }
  @Post("live-chats") startLive(@CurrentUser() user: UserResponseDto, @Body() dto: StartLiveChatDto) { return this.liveChat.start(user.id, dto) }
  @Get("live-chats") liveChats(@CurrentUser() user: UserResponseDto, @Query() query: LiveChatListQueryDto) { return this.liveChat.listPlayer(user.id, query) }
  @Get("live-chats/:sessionId") liveChatDetail(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string) { return this.liveChat.get(user.id, sessionId) }
  @Post("live-chats/:sessionId/messages") liveMessage(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string, @Body() dto: LiveChatMessageDto) { return this.liveChat.sendPlayerMessage(user.id, sessionId, dto) }
  @Patch("live-chats/:sessionId/read") liveRead(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string, @Body() dto: SupportReadDto) { return this.liveChat.markRead(user.id, sessionId, dto.sequence) }
  @Post("live-chats/:sessionId/cancel") liveCancel(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string) { return this.liveChat.cancel(user.id, sessionId) }
  @Post("live-chats/:sessionId/end") liveEnd(@CurrentUser() user: UserResponseDto, @Param("sessionId", ParseUUIDPipe) sessionId: string) { return this.liveChat.end(user.id, sessionId) }
}
