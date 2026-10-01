import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { ChatsService } from "./chats.service"
import { ChatConversationsQueryDto, ChatMessagesQueryDto, CreateChatConversationDto, MarkChatReadDto, MuteChatDto, SendChatMessageDto } from "./dtos"

@ApiTags("Friend chats")
@ApiBearerAuth("access-token")
@Controller("chats")
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get("configuration") configuration() { return this.chats.getPublicConfiguration() }

  @Get("conversations") conversations(@CurrentUser() user: UserResponseDto, @Query() query: ChatConversationsQueryDto) { return this.chats.listConversations(user.id, query.limit, query.cursor) }

  @Post("conversations") createConversation(@CurrentUser() user: UserResponseDto, @Body() dto: CreateChatConversationDto) { return this.chats.createConversation(user.id, dto.friendId) }

  @Get("conversations/:conversationId/messages") messages(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Query() query: ChatMessagesQueryDto) { return this.chats.listMessages(user.id, conversationId, query.limit, query.before) }

  @Post("conversations/:conversationId/messages") send(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: SendChatMessageDto) { return this.chats.sendMessage(user.id, conversationId, dto.clientMessageId, dto.body) }

  @Patch("conversations/:conversationId/read") read(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: MarkChatReadDto) { return this.chats.markRead(user.id, conversationId, dto.sequence) }

  @Patch("conversations/:conversationId/mute") mute(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: MuteChatDto) { return this.chats.mute(user.id, conversationId, dto.mutedUntil) }
}
