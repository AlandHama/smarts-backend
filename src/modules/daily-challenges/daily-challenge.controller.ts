import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserResponseDto } from "../auth/dtos/user-response.dto";
import { DailyChallengeAnswerDto } from "./dtos";
import { DailyChallengeService } from "./daily-challenge.service";

@ApiTags("Daily challenge")
@ApiBearerAuth("access-token")
@Controller("daily-challenge")
export class DailyChallengeController {
  constructor(private readonly dailyChallenge: DailyChallengeService) {}

  @Get("today")
  today(@CurrentUser() user: UserResponseDto) {
    return this.dailyChallenge.today(user.id);
  }

  @Post("today/start")
  start(@CurrentUser() user: UserResponseDto) {
    return this.dailyChallenge.start(user.id);
  }

  @Post("attempts/:attemptId/answer")
  answer(
    @CurrentUser() user: UserResponseDto,
    @Param("attemptId", ParseUUIDPipe) attemptId: string,
    @Body() dto: DailyChallengeAnswerDto,
  ) {
    return this.dailyChallenge.answer(user.id, attemptId, dto.position, dto.selectedIndex, dto.timeTakenMs);
  }

  @Post("attempts/:attemptId/complete")
  complete(@CurrentUser() user: UserResponseDto, @Param("attemptId", ParseUUIDPipe) attemptId: string) {
    return this.dailyChallenge.complete(user.id, attemptId);
  }

  @Get("today/leaderboard")
  leaderboard(@CurrentUser() user: UserResponseDto, @Query("scope") scope?: string, @Query("limit") limit?: string) {
    return this.dailyChallenge.leaderboard(user.id, scope === "friends" ? "friends" : "global", Number(limit) || 50);
  }
}
