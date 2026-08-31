import { Body, Controller, Get, Param, Post } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { PurchaseDto } from "./dtos"
import { CommerceService } from "./commerce.service"

@ApiTags("Commerce")
@ApiBearerAuth("access-token")
@Controller("commerce")
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}
  @Get("catalogs/:key") @ApiOperation({ summary: "List active catalog items and server prices" }) catalog(@Param("key") key: string) { return this.commerce.listCatalog(key) }
  @Get("inventory") inventory(@CurrentUser() user: UserResponseDto) { return this.commerce.listPlayerInventory(user.id) }
  @Get("entitlements") entitlements(@CurrentUser() user: UserResponseDto) { return this.commerce.listPlayerEntitlements(user.id) }
  @Get("purchases") purchases(@CurrentUser() user: UserResponseDto) { return this.commerce.listPurchases(user.id) }
  @Post("purchases") @ApiOperation({ summary: "Purchase a catalog item with a virtual wallet" }) purchase(@CurrentUser() user: UserResponseDto, @Body() dto: PurchaseDto) { return this.commerce.purchase(user.id, dto) }
}
