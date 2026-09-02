import { Controller, Get } from "@nestjs/common"
import { ApiOperation, ApiTags } from "@nestjs/swagger"

import { SkipAuth } from "../../common/decorators/skip-auth.decorator"
import { ConfigService } from "./config.service"

@ApiTags("Configuration")
@Controller("configuration")
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @SkipAuth()
  @Get("public")
  @ApiOperation({ summary: "Get the safe public configuration projection" })
  publicConfig() { return this.configService.publicProjection() }

}
