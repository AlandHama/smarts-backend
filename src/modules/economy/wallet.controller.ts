import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { UserResponseDto } from "../auth/dtos/user-response.dto";
import { GldTransferDto, WalletQueryDto } from "./dtos";
import { WalletService } from "./wallet.service";

@ApiTags("Economy")
@ApiBearerAuth("access-token")
@Controller("wallet")
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({
    summary: "Get the authenticated player's safe wallet balances",
  })
  wallet(@CurrentUser() user: UserResponseDto) {
    return this.walletService.getWalletForUser(user.id);
  }

  @Get("transactions")
  @ApiOperation({ summary: "List the authenticated player's wallet ledger" })
  transactions(
    @CurrentUser() user: UserResponseDto,
    @Query() query: WalletQueryDto,
  ) {
    return this.walletService.listTransactions(user.id, query);
  }

  @Get("transactions/:transactionId")
  @ApiOperation({
    summary: "Get one authenticated player's wallet transaction",
  })
  transaction(
    @CurrentUser() user: UserResponseDto,
    @Param("transactionId", ParseUUIDPipe) transactionId: string,
  ) {
    return this.walletService.getTransactionForUser(user.id, transactionId);
  }

  @Get("transfer/quote")
  @ApiOperation({ summary: "Quote the current GLD player transfer fee" })
  transferQuote(@Query("amount") amount?: string) {
    return this.walletService.quoteGldTransfer(amount ?? "0");
  }

  @Post("transfer")
  @ApiOperation({ summary: "Send GLD to another player" })
  transfer(@CurrentUser() user: UserResponseDto, @Body() dto: GldTransferDto) {
    return this.walletService.transferGld(user.id, dto);
  }
}

@ApiTags("Economy")
@ApiBearerAuth("access-token")
@Controller("currencies")
export class CurrencyController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: "List active public currencies" })
  currencies() {
    return this.walletService.listCurrencies(false);
  }
}
