import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SupportAgentStatusDtoClass, SupportAssignDto, SupportListQueryDto, SupportTicketMessageDto, SupportTicketStatusUpdateDto } from "./dtos"
import { SupportService } from "./support.service"

@ApiTags("Support agents")
@ApiBearerAuth("access-token")
@Controller("support/agent")
export class SupportAgentController {
  constructor(private readonly support: SupportService) {}

  @Get("me") me(@CurrentUser() user: UserResponseDto) { return this.support.agentMe(user.id) }
  @Patch("status") status(@CurrentUser() user: UserResponseDto, @Body() dto: SupportAgentStatusDtoClass) { return this.support.updateAgentStatus(user.id, dto) }
  @Get("queue") queue(@CurrentUser() user: UserResponseDto, @Query() query: SupportListQueryDto) { return this.support.agentQueue(user.id, query) }
  @Post("tickets/:ticketId/claim") claim(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.support.claim(user.id, ticketId) }
  @Get("tickets/:ticketId") ticket(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string) { return this.support.getTicket(user.id, ticketId, true) }
  @Post("tickets/:ticketId/messages") message(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketMessageDto) { return this.support.addAgentMessage(user.id, ticketId, dto) }
  @Post("tickets/:ticketId/notes") note(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketMessageDto) { return this.support.addAgentMessage(user.id, ticketId, dto, true) }
  @Patch("tickets/:ticketId/status") ticketStatus(@CurrentUser() user: UserResponseDto, @Param("ticketId", ParseUUIDPipe) ticketId: string, @Body() dto: SupportTicketStatusUpdateDto) { return this.support.updateTicketStatus(user.id, ticketId, dto) }
}
