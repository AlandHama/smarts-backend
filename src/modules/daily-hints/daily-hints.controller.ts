import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserResponseDto } from "../auth/dtos/user-response.dto";
import { DailyHintsService } from "./daily-hints.service";

@ApiTags("Daily hints")
@ApiBearerAuth("access-token")
@Controller("daily-hints")
export class DailyHintsController {
  constructor(private readonly dailyHints: DailyHintsService) {}

  @Get("today")
  today(@CurrentUser() user: UserResponseDto, @Query("language") language?: string) {
    return this.dailyHints.today(user.id, language);
  }

  @Post(":hintId/view")
  markViewed(@CurrentUser() user: UserResponseDto, @Param("hintId", ParseUUIDPipe) hintId: string) {
    return this.dailyHints.markViewed(user.id, hintId);
  }
}
