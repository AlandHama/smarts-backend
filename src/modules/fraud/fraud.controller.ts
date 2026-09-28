import { Controller, Get } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { FraudService } from "./fraud.service"

@ApiTags("Fraud protection")
@ApiBearerAuth("access-token")
@Controller("fraud")
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get("me")
  me(@CurrentUser() user: UserResponseDto) { return this.fraud.getMyStatus(user.id) }
}
