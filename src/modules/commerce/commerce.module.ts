import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { EconomyModule } from "../economy/economy.module"
import { ProgressionModule } from "../progression/progression.module"
import { AuthModule } from "../auth/auth.module"
import { CommerceController } from "./commerce.controller"
import { CommerceService } from "./commerce.service"
import { CreateCatalogItemTransaction } from "./transactions/create-catalog-item-transaction"
import { CreatePurchaseTransaction } from "./transactions/create-purchase-transaction"
import { GrantInventoryItemTransaction } from "./transactions/grant-inventory-item-transaction"
import { RevokeInventoryItemTransaction } from "./transactions/revoke-inventory-item-transaction"

@Module({
  imports: [DatabaseModule, AuthModule, EconomyModule, ProgressionModule],
  controllers: [CommerceController],
  providers: [CommerceService, CreateCatalogItemTransaction, CreatePurchaseTransaction, GrantInventoryItemTransaction, RevokeInventoryItemTransaction],
  exports: [CommerceService, CreateCatalogItemTransaction, CreatePurchaseTransaction, GrantInventoryItemTransaction, RevokeInventoryItemTransaction],
})
export class CommerceModule {}
