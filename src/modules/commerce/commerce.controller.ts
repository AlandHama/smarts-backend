import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { EquipAvatarFrameDto, PaidRewardRequestDto, PurchaseDto } from "./dtos"
import { CommerceService } from "./commerce.service"
import { AVATAR_FRAME_PRESETS } from "./avatar-frame-presets"
import { NAME_EFFECT_PRESETS } from "./name-effect-presets"
import { EMOTE_PRESETS } from "./emote-presets"

@ApiTags("Commerce")
@ApiBearerAuth("access-token")
@Controller("commerce")
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}
  @Get("catalogs/:key") @ApiOperation({ summary: "List active catalog items and server prices" }) catalog(@Param("key") key: string) { return this.commerce.listCatalog(key) }
  @Get("avatar-frame-presets") @ApiOperation({ summary: "List server-owned avatar frame templates" }) avatarFramePresets() { return AVATAR_FRAME_PRESETS }
  @Get("name-effect-presets") @ApiOperation({ summary: "List server-owned player-name effect templates" }) nameEffectPresets() { return NAME_EFFECT_PRESETS }
  @Get("emote-presets") @ApiOperation({ summary: "List server-owned match emote templates" }) emotePresets() { return EMOTE_PRESETS }
  @Get("inventory") inventory(@CurrentUser() user: UserResponseDto) { return this.commerce.listPlayerInventory(user.id) }
  @Post("avatar-frames/equip") equipAvatarFrame(@CurrentUser() user: UserResponseDto, @Body() dto: EquipAvatarFrameDto) { return this.commerce.equipAvatarFrame(user.id, dto.assetKey) }
  @Post("name-effects/equip") equipNameEffect(@CurrentUser() user: UserResponseDto, @Body() dto: EquipAvatarFrameDto) { return this.commerce.equipNameEffect(user.id, dto.assetKey) }
  @Get("entitlements") entitlements(@CurrentUser() user: UserResponseDto) { return this.commerce.listPlayerEntitlements(user.id) }
  @Get("purchases") purchases(@CurrentUser() user: UserResponseDto) { return this.commerce.listPurchases(user.id) }
  @Post("purchases") @ApiOperation({ summary: "Purchase a catalog item with a virtual wallet" }) purchase(@CurrentUser() user: UserResponseDto, @Body() dto: PurchaseDto) { return this.commerce.purchase(user.id, dto) }
  @Get("paid-reward-requests") @ApiOperation({ summary: "List the authenticated player's paid reward requests" }) paidRewardRequests(@CurrentUser() user: UserResponseDto) { return this.commerce.listPaidRewardRequests(user.id) }
  @Get("paid-reward-quote/:assetKey") @ApiOperation({ summary: "Get the server-calculated GLD price for a paid reward" }) paidRewardQuote(@Param("assetKey") assetKey: string, @Query("variationKey") variationKey?: string) { return this.commerce.getPaidRewardQuote(assetKey, variationKey) }
  @Post("paid-reward-requests") @ApiOperation({ summary: "Request a redeem-code-backed paid reward for administrator review" }) requestPaidReward(@CurrentUser() user: UserResponseDto, @Body() dto: PaidRewardRequestDto) { return this.commerce.requestPaidReward(user.id, dto) }
}
