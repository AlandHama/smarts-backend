import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from "@nestjs/common"
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { SystemAdminGuard } from "../system-admin/system-admin.guard"
import { ClaimSpinningWheelDto, CreateSpinningWheelDto, PurchaseSpinningWheelDto, SpinSpinningWheelDto, UpdateSpinningWheelDto } from "./dtos"
import { SpinningWheelService } from "./spinning-wheel.service"

@ApiTags("Spinning wheels")
@ApiBearerAuth("access-token")
@Controller("spinning-wheels")
export class SpinningWheelController {
  constructor(private readonly service: SpinningWheelService) {}
  @Get() list(@CurrentUser() user: UserResponseDto) { return this.service.listForPlayer(user.id) }
  @Get("history") history(@CurrentUser() user: UserResponseDto) { return this.service.getPlayerHistory(user.id) }
  @Post(":wheelKey/purchase") purchase(@CurrentUser() user: UserResponseDto, @Param("wheelKey") wheelKey: string, @Body() dto: PurchaseSpinningWheelDto) { return this.service.purchase(user.id, wheelKey, dto.quantity ?? 1) }
  @Post("spin") spin(@CurrentUser() user: UserResponseDto, @Body() dto: SpinSpinningWheelDto) { return this.service.spin(user.id, dto.wheelKey) }
  @Post("spins/:spinId/claim") claim(@CurrentUser() user: UserResponseDto, @Param("spinId", ParseUUIDPipe) spinId: string, @Body() dto: ClaimSpinningWheelDto) { return this.service.claimGld(user.id, spinId, dto.claimToken) }
  @UseGuards(SystemAdminGuard)
  @Get("admin/list") adminList() { return this.service.adminList() }
  @UseGuards(SystemAdminGuard)
  @Post("admin") adminCreate(@Body() dto: CreateSpinningWheelDto) { return this.service.adminCreate(dto) }
  @UseGuards(SystemAdminGuard)
  @Patch("admin/:id") adminUpdate(@Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateSpinningWheelDto) { return this.service.adminUpdate(id, dto) }
  @UseGuards(SystemAdminGuard)
  @Post("admin/:id/archive") adminArchive(@Param("id", ParseUUIDPipe) id: string) { return this.service.adminArchive(id) }
}
