import { Controller, Get, Param, ParseUUIDPipe, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { NotificationsService } from "./notifications.service"

@ApiTags("Notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List durable in-app notifications" })
  list(@CurrentUser() user: UserResponseDto) { return this.notifications.listForUser(user.id) }

  @Post(":id/read")
  @ApiBearerAuth("access-token")
  markRead(@CurrentUser() user: UserResponseDto, @Param("id", ParseUUIDPipe) id: string) { return this.notifications.markRead(user.id, id) }
}
