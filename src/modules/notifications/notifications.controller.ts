import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserResponseDto } from "../auth/dtos/user-response.dto";
import { NotificationsService } from "./notifications.service";
import { RegisterDeviceTokenDto, UnregisterDeviceTokenDto } from "./dtos";

@ApiTags("Notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "List durable in-app notifications" })
  list(@CurrentUser() user: UserResponseDto) {
    return this.notifications.listForUser(user.id);
  }

  @Get("push-status")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Get push registration status" })
  pushStatus() {
    return this.notifications.pushStatus();
  }

  @Post("device-token")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Register an FCM device token" })
  registerDevice(
    @CurrentUser() user: UserResponseDto,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notifications.registerDevice(user.id, dto);
  }

  @Delete("device-token")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Deactivate an FCM device token" })
  unregisterDevice(
    @CurrentUser() user: UserResponseDto,
    @Body() dto: UnregisterDeviceTokenDto,
  ) {
    return this.notifications.unregisterDevice(user.id, dto.token);
  }

  @Post("read-all")
  @ApiBearerAuth("access-token")
  @ApiOperation({ summary: "Mark all in-app notifications as read" })
  markAllRead(@CurrentUser() user: UserResponseDto) {
    return this.notifications.markAllRead(user.id);
  }

  @Post(":id/read")
  @ApiBearerAuth("access-token")
  markRead(
    @CurrentUser() user: UserResponseDto,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.notifications.markRead(user.id, id);
  }
}
