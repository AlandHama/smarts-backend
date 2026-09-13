import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"
import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { GiftsService } from "./gifts.service"
import { GiftCatalogQueryDto, SendGiftDto } from "./dtos/gift.dto"

@ApiTags("Gifts")
@ApiBearerAuth("access-token")
@Controller("gifts")
export class GiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Get("catalog")
  @ApiOperation({ summary: "List active GLD gift catalog items" })
  catalog(@Query() query: GiftCatalogQueryDto) { return this.giftsService.listCatalog(query.catalogKey) }

  @Post("send")
  @ApiOperation({ summary: "Send a catalog gift and burn its GLD price" })
  send(@CurrentUser() user: UserResponseDto, @Body() dto: SendGiftDto) { return this.giftsService.send(user.id, dto) }
}

@ApiTags("Player gifts")
@ApiBearerAuth("access-token")
@Controller("players")
export class PlayerGiftsController {
  constructor(private readonly giftsService: GiftsService) {}

  @Get(":userId/gifts")
  list(@CurrentUser() user: UserResponseDto, @Param("userId", ParseUUIDPipe) userId: string) { return this.giftsService.listForPlayer(user.id, userId) }

  @Get(":userId/gifts/stats")
  stats(@CurrentUser() user: UserResponseDto, @Param("userId", ParseUUIDPipe) userId: string) { return this.giftsService.stats(user.id, userId) }
}
