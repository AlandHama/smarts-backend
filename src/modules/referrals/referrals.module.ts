import { Module } from "@nestjs/common"

import { DatabaseModule } from "../../database/database.module"
import { EconomyModule } from "../economy/economy.module"
import { ReferralsController } from "./referrals.controller"
import { ReferralsService } from "./referrals.service"
import { ClaimReferralTransaction } from "./transactions/claim-referral-transaction"
import { UpdateReferralConfigTransaction } from "./transactions/update-referral-config-transaction"

@Module({ imports: [DatabaseModule, EconomyModule], controllers: [ReferralsController], providers: [ReferralsService, ClaimReferralTransaction, UpdateReferralConfigTransaction], exports: [ReferralsService] })
export class ReferralsModule {}

