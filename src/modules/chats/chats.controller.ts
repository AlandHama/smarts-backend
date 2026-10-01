import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { ChatsService } from "./chats.service"
import { AddChatGroupMembersDto, ChatConversationsQueryDto, ChatMessagesQueryDto, ChatWallpaperDto, CreateChatConversationDto, CreateChatGroupDto, MarkChatReadDto, MuteChatDto, ReportChatMessageDto, SendChatMessageDto, UpdateChatGroupDto } from "./dtos"

@ApiTags("Friend chats")
@ApiBearerAuth("access-token")
@Controller("chats")
export class ChatsController {
  constructor(private readonly chats: ChatsService) {}

  @Get("configuration") configuration(@CurrentUser() user: UserResponseDto) { return this.chats.getPublicConfiguration(user.id) }

  @Get("conversations") conversations(@CurrentUser() user: UserResponseDto, @Query() query: ChatConversationsQueryDto) { return this.chats.listConversations(user.id, query.limit, query.cursor) }

  @Post("conversations") createConversation(@CurrentUser() user: UserResponseDto, @Body() dto: CreateChatConversationDto) { return this.chats.createConversation(user.id, dto.friendId) }

  @Post("groups") createGroup(@CurrentUser() user: UserResponseDto, @Body() dto: CreateChatGroupDto) { return this.chats.createGroup(user.id, dto.name, dto.memberIds, dto.imageUrl) }

  @Post("conversations/:conversationId/members") addGroupMembers(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: AddChatGroupMembersDto) { return this.chats.addGroupMembers(user.id, conversationId, dto.memberIds) }

  @Delete("conversations/:conversationId/members/:memberId") removeGroupMember(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Param("memberId", ParseUUIDPipe) memberId: string) { return this.chats.removeGroupMember(user.id, conversationId, memberId) }

  @Post("conversations/:conversationId/leave") leaveGroup(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string) { return this.chats.leaveGroup(user.id, conversationId) }

  @Patch("conversations/:conversationId/group") updateGroup(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: UpdateChatGroupDto) { return this.chats.updateGroup(user.id, conversationId, dto) }

  @Get("conversations/:conversationId/messages") messages(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Query() query: ChatMessagesQueryDto) { return this.chats.listMessages(user.id, conversationId, query.limit, query.before) }

  @Post("conversations/:conversationId/messages") send(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: SendChatMessageDto) { return this.chats.sendMessage(user.id, conversationId, dto.clientMessageId, dto.body) }

  @Patch("conversations/:conversationId/read") read(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: MarkChatReadDto) { return this.chats.markRead(user.id, conversationId, dto.sequence) }

  @Patch("conversations/:conversationId/mute") mute(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: MuteChatDto) { return this.chats.mute(user.id, conversationId, dto.mutedUntil) }

  @Patch("conversations/:conversationId/wallpaper") wallpaper(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: ChatWallpaperDto) { return this.chats.setWallpaper(user.id, conversationId, dto.wallpaperKey) }

  @Post("conversations/:conversationId/messages/:messageId/report") report(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Param("messageId", ParseUUIDPipe) messageId: string, @Body() dto: ReportChatMessageDto) { return this.chats.reportMessage(user.id, conversationId, messageId, dto) }

  @Post("conversations/:conversationId/report") reportConversation(@CurrentUser() user: UserResponseDto, @Param("conversationId", ParseUUIDPipe) conversationId: string, @Body() dto: ReportChatMessageDto) { return this.chats.reportConversation(user.id, conversationId, dto) }
}
