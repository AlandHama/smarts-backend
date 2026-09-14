import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { CurrencyController, WalletController } from "./wallet.controller"
import { WalletService } from "./wallet.service"
import { CreateCurrencyTransaction } from "./transactions/create-currency-transaction"
import { CreditWalletTransaction } from "./transactions/credit-wallet-transaction"
import { DebitWalletTransaction } from "./transactions/debit-wallet-transaction"
import { ReverseWalletTransaction } from "./transactions/reverse-wallet-transaction"
import { UpdateCurrencyTransaction } from "./transactions/update-currency-transaction"
import { TransferGldTransaction } from "./transactions/transfer-gld-transaction"

@Module({
  imports: [DatabaseModule],
  controllers: [WalletController, CurrencyController],
  providers: [WalletService, CreateCurrencyTransaction, UpdateCurrencyTransaction, CreditWalletTransaction, DebitWalletTransaction, ReverseWalletTransaction, TransferGldTransaction],
  exports: [WalletService, CreditWalletTransaction, DebitWalletTransaction, ReverseWalletTransaction],
})
export class EconomyModule {}
