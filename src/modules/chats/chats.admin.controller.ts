import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { ChatsService } from "./chats.service"
import { UpdateChatConfigurationDto } from "./dtos"

@ApiTags("System admin friend chats")
@ApiBearerAuth("access-token")
@UseGuards(SystemAdminGuard)
@Controller("system-admin/api/chats")
export class ChatsAdminController {
  constructor(private readonly chats: ChatsService) {}

  @Get("configuration") configuration() { return this.chats.getConfiguration() }

  @Patch("configuration") update(@Body() dto: UpdateChatConfigurationDto, @CurrentUser() admin: UserResponseDto) { return this.chats.updateConfiguration(dto, admin.id) }
}
