import { Controller, Get, Query } from "@nestjs/common"
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger"

import { CurrentUser } from "../../common/decorators/current-user.decorator"
import { UserResponseDto } from "../auth/dtos/user-response.dto"
import { WalletQueryDto } from "./dtos"
import { WalletService } from "./wallet.service"

@ApiTags("Economy")
@ApiBearerAuth("access-token")
@Controller("wallet")
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: "Get the authenticated player's safe wallet balances" })
  wallet(@CurrentUser() user: UserResponseDto) { return this.walletService.getWalletForUser(user.id) }

  @Get("transactions")
  @ApiOperation({ summary: "List the authenticated player's wallet ledger" })
  transactions(@CurrentUser() user: UserResponseDto, @Query() query: WalletQueryDto) { return this.walletService.listTransactions(user.id, query) }
}

@ApiTags("Economy")
@ApiBearerAuth("access-token")
@Controller("currencies")
export class CurrencyController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: "List active public currencies" })
  currencies() { return this.walletService.listCurrencies(false) }
}

