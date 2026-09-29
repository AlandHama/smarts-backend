import { Controller, Get } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { StreaksService } from "./streaks.service"

@ApiTags("Daily streaks")
@ApiBearerAuth("access-token")
@Controller("streaks")
export class StreaksController {
  constructor(private readonly streaks: StreaksService) {}
  @Get("me") me(@CurrentUser() user: UserResponseDto) { return this.streaks.getStatus(user.id) }
}
