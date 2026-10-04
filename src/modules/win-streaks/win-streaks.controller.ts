import { Controller, Get } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { WinStreaksService } from "./win-streaks.service"

@ApiTags("Win streaks")
@ApiBearerAuth("access-token")
@Controller("win-streaks")
export class WinStreaksController {
  constructor(private readonly winStreaks: WinStreaksService) {}
  @Get("me") me(@CurrentUser() user: UserResponseDto) { return this.winStreaks.getStatus(user.id) }
}
