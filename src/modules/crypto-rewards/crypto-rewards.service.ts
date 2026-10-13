import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common"
import { Prisma, CryptoPayoutHoldStatus, CryptoPayoutRequestStatus, PlayerAuditActorType, WalletTransactionSourceType } from "@prisma/client"
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto"

import { writeAdminAudit } from "../../common/helpers/admin-audit"
import { writePlayerAudit } from "../../common/helpers/player-audit"
import { PrismaService } from "../../prisma.service"
import { FraudService } from "../fraud/fraud.service"
import { getAuthConfig } from "../auth/auth.config"
import { CreditWalletTransaction } from "../economy/transactions/credit-wallet-transaction"
import { DebitWalletTransaction } from "../economy/transactions/debit-wallet-transaction"
import { CryptoRewardQuoteDto, CreateCryptoPayoutRequestDto, CryptoAdminDecisionDto, UpdateCryptoRewardConfigDto } from "./dtos"
import { CRYPTO_REWARD_ASSETS, CRYPTO_REWARD_CURRENCIES, CryptoRewardCurrency, getCryptoRewardAsset, getCryptoRewardsConfig, isCryptoRewardCurrency } from "./crypto-rewards.config"
import { NowPaymentsHttpError, NowPaymentsPayoutAdapter } from "./nowpayments-payout.adapter"

const ACTIVE_REQUEST_STATUSES: CryptoPayoutRequestStatus[] = [CryptoPayoutRequestStatus.PENDING_ADMIN_APPROVAL, CryptoPayoutRequestStatus.APPROVED]
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

@Injectable()
export class CryptoRewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fraud: FraudService,
    private readonly debitWallet: DebitWalletTransaction,
    private readonly creditWallet: CreditWalletTransaction,
    private readonly provider: NowPaymentsPayoutAdapter,
  ) {}

  async getPublicConfig() {
    const config = await this.getConfig()
    return { enabled: config.enabled, networkCode: config.networkCode, currencies: CRYPTO_REWARD_CURRENCIES, assets: this.assetViews(config), quoteTtlSeconds: config.quoteTtlSeconds, minGld: config.minGld.toString(), maxGldPerRequest: config.maxGldPerRequest.toString(), requireAdminApproval: config.requireAdminApproval }
  }

  async validateAddress(userId: string, input: { currencyCode: CryptoRewardCurrency; networkCode: string; destinationAddress: string }) {
    const asset = this.assertCurrency(input.currencyCode, input.networkCode)
    this.assertDestinationAddress(input.destinationAddress, asset.addressKind, asset.networkLabel)
    const config = await this.getConfig()
    if (!config.enabled || !getCryptoRewardsConfig().providerEnabled) throw new ServiceUnavailableException("Crypto rewards are not available")
    const result = await this.provider.validatePayoutAddress(input.destinationAddress.trim(), input.currencyCode)
    const valid = this.providerBoolean(result)
    if (valid === false) throw new BadRequestException("The payout address was rejected by NOWPayments")
    return { valid: true, provider: "NOWPayments", providerValidated: true, currencyCode: input.currencyCode, networkCode: asset.networkCode, destinationAddressMasked: this.mask(input.destinationAddress) }
  }

  async quote(userId: string, input: CryptoRewardQuoteDto) {
    await this.fraud.assertRewardAllowed(userId)
    const asset = this.assertCurrency(input.currencyCode, input.networkCode)
    this.assertDestinationAddress(input.destinationAddress, asset.addressKind, asset.networkLabel)
    const gld = this.parseGld(input.gldAmount)
    const config = await this.getConfig()
    this.assertEnabled(config)
    this.assertLimits(gld, config)
    await this.assertRequestLimits(userId, gld, config)
    await this.assertGldBalance(userId, gld)
    const address = await this.provider.validatePayoutAddress(input.destinationAddress.trim(), input.currencyCode)
    if (this.providerBoolean(address) === false) throw new BadRequestException("The payout address was rejected by NOWPayments")
    const rate = this.rateFor(config, input.currencyCode)
    if (rate.lte(0)) throw new ServiceUnavailableException("This crypto reward currency has not been configured")
    const gross = new Prisma.Decimal(gld.toString()).div(rate)
    const platformFee = gross.mul(config.platformFeeBps).div(10000)
    const [feeResult, providerStatus, providerBalance] = await Promise.all([
      this.provider.getPayoutFeeEstimate(input.currencyCode, gross.toFixed(9)),
      this.provider.getApiStatus(),
      this.provider.getPayoutBalance(),
    ])
    const providerFee = this.extractDecimal(feeResult, ["fee", "estimated_fee", "fee_amount", "amount"], "0")
    const minimumResult = await this.provider.getMinimumPayoutAmount(input.currencyCode)
    const minimum = this.extractDecimal(minimumResult, ["min_amount", "minimum", "amount"], "0")
    const net = gross.sub(platformFee).sub(providerFee)
    if (net.lte(0) || net.lt(minimum)) throw new BadRequestException(`The payout must be at least ${minimum.toString()} ${input.currencyCode}`)
    const expiresAt = new Date(Date.now() + config.quoteTtlSeconds * 1000)
    const providerConfig = getCryptoRewardsConfig()
    const snapshot = { provider: "NOWPayments", environment: providerConfig.providerEnvironment, addressValidated: true, feeResponse: this.safeJson(feeResult), minimumResponse: this.safeJson(minimumResult), providerStatus: this.safeJson(providerStatus), providerBalance: this.safeJson(providerBalance) }
    const quote = await this.prisma.cryptoPayoutQuote.create({ data: { userId, currencyCode: input.currencyCode, networkCode: asset.networkCode, destinationAddressHash: this.hashAddress(input.destinationAddress), destinationAddressMasked: this.mask(input.destinationAddress), gldAmount: BigInt(gld.toString()), gldRatePerStablecoin: rate, gldRateVersion: config.rateVersion, platformFeeBps: config.platformFeeBps, platformFeeCrypto: platformFee, providerFeeCrypto: providerFee, providerFeeCurrency: input.currencyCode, grossCryptoAmount: gross, netCryptoAmount: net, minimumPayoutAmount: minimum, quoteSnapshot: snapshot, expiresAt } })
    return this.serializeQuote(quote)
  }

  async createRequest(userId: string, input: CreateCryptoPayoutRequestDto) {
    if (!input.acknowledged) throw new BadRequestException("You must acknowledge the payout terms")
    const key = input.idempotencyKey.trim()
    if (!key) throw new BadRequestException("Idempotency key is required")
    await this.fraud.assertRewardAllowed(userId)
    const config = await this.getConfig()
    this.assertEnabled(config)
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { scope_key: { scope: `crypto-payout-request:${userId}`, key } } })
    if (existing?.status === "COMPLETED" && existing.responseJson) return existing.responseJson
    const requestHash = createHash("sha256").update(`${userId}:${input.quoteId}:${key}`).digest("hex")
    const addressCheck = await this.prisma.cryptoPayoutQuote.findFirst({ where: { id: input.quoteId, userId }, select: { destinationAddressHash: true, currencyCode: true, networkCode: true, expiresAt: true, consumedAt: true, gldAmount: true } })
    if (!addressCheck) throw new NotFoundException("Crypto reward quote not found")
    const checkedAsset = getCryptoRewardAsset(addressCheck.currencyCode)
    if (!checkedAsset || checkedAsset.networkCode !== addressCheck.networkCode) throw new ConflictException("The crypto reward asset is no longer supported")
    this.assertDestinationAddress(input.destinationAddress, checkedAsset.addressKind, checkedAsset.networkLabel)
    if (addressCheck.destinationAddressHash !== this.hashAddress(input.destinationAddress)) throw new ConflictException("The payout address does not match the quote")
    if (addressCheck.consumedAt || addressCheck.expiresAt <= new Date()) throw new ConflictException("Crypto reward quote is no longer available")
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`crypto-payout:${userId}`}))`
      const idem = await tx.idempotencyKey.upsert({ where: { scope_key: { scope: `crypto-payout-request:${userId}`, key } }, create: { userId, scope: `crypto-payout-request:${userId}`, key, requestHash, status: "PROCESSING" }, update: {} })
      if (idem.requestHash !== requestHash) throw new ConflictException("Idempotency key was already used for another request")
      if (idem.status === "COMPLETED" && idem.responseJson) return idem.responseJson
      const quote = await tx.cryptoPayoutQuote.findUnique({ where: { id: input.quoteId } })
      if (!quote || quote.userId !== userId || quote.consumedAt || quote.expiresAt <= new Date()) throw new ConflictException("Crypto reward quote is no longer available")
      await this.assertRequestLimits(userId, quote.gldAmount, config, tx)
      const request = await tx.cryptoPayoutRequest.create({ data: { id: randomUUID(), userId, status: CryptoPayoutRequestStatus.PENDING_ADMIN_APPROVAL, requestKey: createHash("sha256").update(`${userId}:${key}`).digest("hex"), idempotencyKeyId: idem.id, currencyCode: quote.currencyCode, networkCode: quote.networkCode, destinationAddressCiphertext: this.encryptAddress(input.destinationAddress), destinationAddressHash: quote.destinationAddressHash, destinationAddressMasked: quote.destinationAddressMasked, addressValidatedAt: new Date(), addressValidationProvider: "NOWPayments", addressValidationCode: "VALID", gldRequested: quote.gldAmount, gldHeld: quote.gldAmount, gldRatePerStablecoinSnapshot: quote.gldRatePerStablecoin, gldRateVersion: quote.gldRateVersion, platformFeeBpsSnapshot: quote.platformFeeBps, platformFeeCrypto: quote.platformFeeCrypto, providerFeeCrypto: quote.providerFeeCrypto, providerFeeCurrency: quote.providerFeeCurrency, grossCryptoAmount: quote.grossCryptoAmount, netCryptoAmount: quote.netCryptoAmount, quoteExpiresAt: quote.expiresAt, quoteSnapshot: quote.quoteSnapshot as Prisma.InputJsonValue, providerName: "NOWPayments", providerEnvironment: getCryptoRewardsConfig().providerEnvironment, holdExpiresAt: new Date(Date.now() + config.holdExpiryHours * 3600000), hold: { create: { userId, amount: quote.gldAmount, expiresAt: new Date(Date.now() + config.holdExpiryHours * 3600000) } } } })
      await this.debitWallet.runWithinTransaction({ userId, currencyCode: "GLD", amount: quote.gldAmount, amountDecimal: quote.gldAmount.toString(), sourceId: request.id, sourceType: WalletTransactionSourceType.CRYPTO_PAYOUT, metadata: { requestId: request.id, purpose: "CRYPTO_REWARD_HOLD" } }, tx)
      await tx.cryptoPayoutQuote.update({ where: { id: quote.id }, data: { consumedAt: new Date() } })
      const response = this.serializeRequest(request)
      await tx.idempotencyKey.update({ where: { id: idem.id }, data: { status: "COMPLETED", responseJson: response as unknown as Prisma.InputJsonValue, completedAt: new Date() } })
      await writePlayerAudit(tx, { userId, actorType: PlayerAuditActorType.PLAYER, action: "CRYPTO_PAYOUT_REQUESTED", entityType: "CryptoPayoutRequest", entityId: request.id, summary: `Requested ${request.netCryptoAmount.toString()} ${request.currencyCode} crypto reward`, metadata: { requestId: request.id, gldHeld: request.gldHeld.toString(), currencyCode: request.currencyCode } })
      return response
    })
    await this.fraud.observe(userId, { type: "PAID_REWARD_REVIEW", sourceType: "CRYPTO_PAYOUT", sourceId: typeof result === "object" && result ? String((result as any).id) : input.quoteId })
    return result
  }

  async listPlayerRequests(userId: string) { const rows = await this.prisma.cryptoPayoutRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }); return rows.map((row) => this.serializeRequest(row)) }
  async getPlayerRequest(userId: string, id: string) { const row = await this.prisma.cryptoPayoutRequest.findFirst({ where: { id, userId } }); if (!row) throw new NotFoundException("Crypto payout request not found"); return this.serializeRequest(row) }

  async cancel(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.cryptoPayoutRequest.findFirst({ where: { id, userId }, include: { hold: true } })
      if (!request) throw new NotFoundException("Crypto payout request not found")
      if (request.status !== CryptoPayoutRequestStatus.PENDING_ADMIN_APPROVAL || !request.hold || request.hold.status !== CryptoPayoutHoldStatus.HELD) throw new ConflictException("Only pending crypto payout requests can be cancelled")
      await this.releaseHold(tx, request, "PLAYER_CANCELLED")
      return this.serializeRequest(await tx.cryptoPayoutRequest.findUniqueOrThrow({ where: { id } }))
    })
  }

  async listAdminRequests(status?: CryptoPayoutRequestStatus) {
    if (status && !(Object.values(CryptoPayoutRequestStatus) as string[]).includes(status)) throw new BadRequestException("Invalid crypto payout status")
    const rows = await this.prisma.cryptoPayoutRequest.findMany({ where: status ? { status } : {}, include: { user: { select: { id: true, username: true, email: true, status: true, profile: { select: { displayName: true } } } }, hold: true }, orderBy: { createdAt: "asc" }, take: 200 })
    return rows.map((row) => ({ ...this.serializeRequest(row), adminDecision: row.adminDecision, adminNote: row.adminNote, providerUniqueExternalId: row.providerUniqueExternalId, providerBatchWithdrawalId: row.providerBatchWithdrawalId, providerPayoutId: row.providerPayoutId, providerStatusRaw: row.providerStatusRaw, submissionAttempts: row.submissionAttempts, pollAttempts: row.pollAttempts, user: row.user, hold: row.hold ? { status: row.hold.status, amount: row.hold.amount.toString(), released: row.hold.released.toString(), expiresAt: row.hold.expiresAt } : null }))
  }

  async decideAdmin(id: string, adminId: string, dto: CryptoAdminDecisionDto) {
    if (dto.decision === "APPROVE") {
      const row = await this.prisma.cryptoPayoutRequest.findUnique({ where: { id }, include: { hold: true, user: { select: { status: true } } } })
      if (!row) throw new NotFoundException("Crypto payout request not found")
      const config = await this.getConfig(); this.assertEnabled(config)
      if (row.status !== CryptoPayoutRequestStatus.PENDING_ADMIN_APPROVAL || !row.hold || row.hold.status !== CryptoPayoutHoldStatus.HELD) throw new ConflictException("Crypto payout request is no longer pending")
      if (row.holdExpiresAt <= new Date()) throw new ConflictException("Crypto payout hold has expired")
      if (row.user.status !== "ACTIVE") throw new ConflictException("The player account is not active")
      const validation = await this.provider.validatePayoutAddress(this.decryptAddress(row.destinationAddressCiphertext), row.currencyCode as CryptoRewardCurrency)
      if (this.providerBoolean(validation) === false) throw new ConflictException("Payout address is no longer valid")
      const currentFee = this.extractDecimal(await this.provider.getPayoutFeeEstimate(row.currencyCode as CryptoRewardCurrency, row.grossCryptoAmount.toFixed(9)), ["fee", "estimated_fee", "fee_amount", "amount"], "0")
      const feeBase = row.providerFeeCrypto as Prisma.Decimal
      const feeDriftBps = feeBase.gt(0) ? currentFee.sub(feeBase).abs().mul(10000).div(feeBase) : currentFee.gt(0) ? new Prisma.Decimal(10000) : new Prisma.Decimal(0)
      if (feeDriftBps.gt(config.maxQuoteDriftBps)) throw new ConflictException("The NOWPayments fee changed; request a new quote")
      const providerBalance = await this.provider.getPayoutBalance()
      this.assertProviderReserve(providerBalance, row.currencyCode as CryptoRewardCurrency, row.grossCryptoAmount, config.minProviderReserveUsd ?? new Prisma.Decimal(0))
    }
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.cryptoPayoutRequest.findUnique({ where: { id }, include: { hold: true } })
      if (!row) throw new NotFoundException("Crypto payout request not found")
      if (row.status !== CryptoPayoutRequestStatus.PENDING_ADMIN_APPROVAL || !row.hold || row.hold.status !== CryptoPayoutHoldStatus.HELD) throw new ConflictException("Crypto payout request is no longer pending")
      if (dto.decision === "REJECT") await this.releaseHold(tx, row, "ADMIN_REJECTED")
      const updated = await tx.cryptoPayoutRequest.update({ where: { id }, data: dto.decision === "APPROVE" ? { status: CryptoPayoutRequestStatus.APPROVED, adminDecision: "APPROVED", adminId, adminNote: dto.adminNote?.trim(), approvedAt: new Date() } : { status: CryptoPayoutRequestStatus.REJECTED, adminDecision: "REJECTED", adminId, adminNote: dto.adminNote?.trim(), rejectedAt: new Date() } })
      await writeAdminAudit(tx, { actorId: adminId, action: `CRYPTO_PAYOUT_${dto.decision}`, entityType: "CryptoPayoutRequest", entityId: id, reason: dto.adminNote, metadata: { userId: row.userId, currencyCode: row.currencyCode, gldAmount: row.gldRequested.toString() } })
      await writePlayerAudit(tx, { userId: row.userId, actorType: PlayerAuditActorType.ADMIN, action: `CRYPTO_PAYOUT_${dto.decision}`, entityType: "CryptoPayoutRequest", entityId: id, summary: `Crypto payout request ${dto.decision.toLowerCase()} by administrator`, metadata: { requestId: id } })
      return this.serializeRequest(updated)
    })
  }

  /** Claim an approved request before making the external POST. The claim is durable across process restarts. */
  async submitApproved(id: string, adminId: string) {
    const callbackUrl = getCryptoRewardsConfig().ipnCallbackUrl
    if (!callbackUrl) throw new ServiceUnavailableException("NOWPAYMENTS_IPN_PUBLIC_URL or CRYPTO_REWARDS_IPN_CALLBACK_URL is not configured")
    const claim = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "CryptoPayoutRequest" WHERE "id" = ${id} FOR UPDATE`
      const row = await tx.cryptoPayoutRequest.findUnique({ where: { id }, include: { hold: true } })
      if (!row) throw new NotFoundException("Crypto payout request not found")
      if (row.providerPayoutId || row.providerBatchWithdrawalId) return { alreadySubmitted: true, row: this.serializeRequest(row) }
      if (row.status !== CryptoPayoutRequestStatus.APPROVED || !row.hold || row.hold.status !== CryptoPayoutHoldStatus.HELD) throw new ConflictException("Only an approved, held request can be submitted")
      if (row.holdExpiresAt <= new Date()) throw new ConflictException("Crypto payout hold has expired")
      const externalId = row.providerUniqueExternalId || `smarts-${row.id}`
      const updated = await tx.cryptoPayoutRequest.update({ where: { id }, data: { status: CryptoPayoutRequestStatus.SUBMITTING, providerUniqueExternalId: externalId, submissionAttempts: { increment: 1 }, nextPollAt: new Date(), adminId, submittedAt: null } })
      return { alreadySubmitted: false, row: updated, externalId }
    })
    if (claim.alreadySubmitted) return claim.row
    try {
      const address = await this.loadDestination(id)
      const response = await this.provider.createPayout({ ipnCallbackUrl: callbackUrl, withdrawals: [{ address, currency: claim.row.currencyCode as CryptoRewardCurrency, amount: claim.row.grossCryptoAmount.toFixed(9), unique_external_id: claim.externalId, payout_description: `SMARTS crypto reward ${id}` }] })
      const created = await this.storeProviderCreation(id, response)
      const providerConfig = getCryptoRewardsConfig()
      if (providerConfig.requirePayoutVerification && providerConfig.autoVerifyPayouts && providerConfig.payoutTotpSecret) return this.autoVerifyProviderPayout(id)
      return created
    } catch (error) {
      // Keep SUBMITTING with the external id. Reconciliation will search the provider
      // before any human is allowed to attempt another action.
      await this.prisma.cryptoPayoutRequest.update({ where: { id }, data: { nextPollAt: new Date() } }).catch(() => undefined)
      throw error
    }
  }

  async verifyProviderPayout(id: string, verificationCode: string) {
    const row = await this.prisma.cryptoPayoutRequest.findUnique({ where: { id } })
    if (!row) throw new NotFoundException("Crypto payout request not found")
    if (row.status !== CryptoPayoutRequestStatus.AWAITING_PROVIDER_VERIFICATION || !row.providerBatchWithdrawalId) throw new ConflictException("This payout is not awaiting provider verification")
    const response = await this.provider.verifyPayout(row.providerBatchWithdrawalId, verificationCode)
    const updated = await this.prisma.cryptoPayoutRequest.update({ where: { id }, data: { status: CryptoPayoutRequestStatus.PROCESSING, providerVerificationAt: new Date(), nextPollAt: new Date(), providerStatusSnapshot: this.safeJson(response) } })
    return this.serializeRequest(updated)
  }

  private async autoVerifyProviderPayout(id: string) {
    const row = await this.prisma.cryptoPayoutRequest.findUnique({ where: { id } })
    if (!row) throw new NotFoundException("Crypto payout request not found")
    if (row.status !== CryptoPayoutRequestStatus.AWAITING_PROVIDER_VERIFICATION || !row.providerBatchWithdrawalId) return this.serializeRequest(row)
    const response = await this.provider.verifyPayout(row.providerBatchWithdrawalId, this.provider.generatePayoutTotp())
    const updated = await this.prisma.cryptoPayoutRequest.update({ where: { id }, data: { status: CryptoPayoutRequestStatus.PROCESSING, providerVerificationAt: new Date(), nextPollAt: new Date(), providerStatusSnapshot: this.safeJson(response) } })
    return this.serializeRequest(updated)
  }

  async handleProviderIpn(rawBody: string, signature: string | undefined) {
    const payload = this.provider.verifyAndNormalizeIpn(rawBody, signature)
    return this.applyProviderStatus(payload, "IPN")
  }

  async runReconciliation() {
    const expired = await this.expireHeldRequests()
    const now = new Date()
    const rows = await this.prisma.cryptoPayoutRequest.findMany({ where: { status: { in: [CryptoPayoutRequestStatus.SUBMITTING, CryptoPayoutRequestStatus.CREATED, CryptoPayoutRequestStatus.AWAITING_PROVIDER_VERIFICATION, CryptoPayoutRequestStatus.PROCESSING, CryptoPayoutRequestStatus.SENDING, CryptoPayoutRequestStatus.RECONCILIATION_REQUIRED] }, OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }] }, orderBy: { createdAt: "asc" }, take: 25 })
    let processed = 0
    for (const row of rows) {
      try {
        const claimed = await this.prisma.cryptoPayoutRequest.updateMany({ where: { id: row.id, status: row.status, pollAttempts: row.pollAttempts, OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }] }, data: { nextPollAt: new Date(Date.now() + getCryptoRewardsConfig().pollMaxBackoffMs) } })
        if (claimed.count !== 1) continue
        const providerConfig = getCryptoRewardsConfig()
        if (row.status === CryptoPayoutRequestStatus.AWAITING_PROVIDER_VERIFICATION && providerConfig.requirePayoutVerification && providerConfig.autoVerifyPayouts && providerConfig.payoutTotpSecret && row.providerBatchWithdrawalId) {
          const verification = await this.provider.verifyPayout(row.providerBatchWithdrawalId, this.provider.generatePayoutTotp())
          await this.prisma.cryptoPayoutRequest.update({ where: { id: row.id }, data: { status: CryptoPayoutRequestStatus.PROCESSING, providerVerificationAt: new Date(), nextPollAt: new Date(), providerStatusSnapshot: this.safeJson(verification) } })
          processed += 1
          continue
        }
        let response: unknown
        if (row.providerPayoutId) response = await this.provider.getPayoutStatus(row.providerPayoutId)
        else {
          const listed = await this.provider.listPayouts({ limit: 100, page: 1 })
          response = this.findListedProviderPayout(listed, row.providerUniqueExternalId || `smarts-${row.id}`)
          if (!response) continue
        }
        const result = await this.applyProviderStatus(response, "POLL", row.id)
        if (result && !(result as any).ignored) processed += 1
      } catch (error) {
        await this.prisma.cryptoPayoutRequest.update({ where: { id: row.id }, data: { pollAttempts: { increment: 1 }, nextPollAt: new Date(Date.now() + this.pollBackoff(row.pollAttempts + 1)) } }).catch(() => undefined)
      }
    }
    return { skipped: false, processed, expired }
  }

  async runSubmissionQueue() {
    const rows = await this.prisma.cryptoPayoutRequest.findMany({ where: { status: CryptoPayoutRequestStatus.APPROVED, providerPayoutId: null, providerBatchWithdrawalId: null }, orderBy: { approvedAt: "asc" }, take: 10, select: { id: true, adminId: true } })
    let submitted = 0
    for (const row of rows) {
      if (!row.adminId) continue
      try { await this.submitApproved(row.id, row.adminId); submitted += 1 } catch { /* the next worker tick or an admin action retries/reconciles it */ }
    }
    return { submitted }
  }

  async markReconciliation(id: string, adminId: string, note?: string) {
    const row = await this.prisma.cryptoPayoutRequest.update({ where: { id }, data: { status: CryptoPayoutRequestStatus.RECONCILIATION_REQUIRED, nextPollAt: new Date(), adminId, adminNote: note?.trim() } })
    await this.prisma.$transaction((tx) => writeAdminAudit(tx, { actorId: adminId, action: "CRYPTO_PAYOUT_MARKED_RECONCILIATION", entityType: "CryptoPayoutRequest", entityId: id, reason: note, metadata: { providerPayoutId: row.providerPayoutId, providerBatchWithdrawalId: row.providerBatchWithdrawalId } }))
    return this.serializeRequest(row)
  }

  private async loadDestination(id: string) { const row = await this.prisma.cryptoPayoutRequest.findUnique({ where: { id }, select: { destinationAddressCiphertext: true } }); if (!row) throw new NotFoundException("Crypto payout request not found"); return this.decryptAddress(row.destinationAddressCiphertext) }

  private async storeProviderCreation(id: string, response: unknown) {
    const body = response as any
    const first = Array.isArray(body) ? body[0] : body?.withdrawals?.[0] || body?.payouts?.[0] || body
    const batchId = this.stringValue(body, ["batch_withdrawal_id", "batchWithdrawalId"]) || this.stringValue(first, ["batch_withdrawal_id", "batchWithdrawalId"])
    const payoutId = this.stringValue(first, ["id", "payout_id", "payoutId"]) || this.stringValue(body, ["payout_id", "payoutId"])
    if (!batchId && !payoutId) throw new ServiceUnavailableException("NOWPayments returned no payout identifier")
    const requiresVerification = getCryptoRewardsConfig().requirePayoutVerification
    const status = requiresVerification ? CryptoPayoutRequestStatus.AWAITING_PROVIDER_VERIFICATION : CryptoPayoutRequestStatus.CREATED
    const updated = await this.prisma.cryptoPayoutRequest.update({ where: { id }, data: { status, providerBatchWithdrawalId: batchId, providerPayoutId: payoutId, providerVerificationRequired: requiresVerification, providerStatus: this.normalizedProviderStatus(first?.status || body?.status), providerStatusRaw: this.stringValue(first, ["status"]), providerStatusSnapshot: this.safeJson(response), providerCreatedAt: this.dateValue(first?.created_at || body?.created_at), submittedAt: new Date(), nextPollAt: new Date() } })
    return this.serializeRequest(updated)
  }

  private async applyProviderStatus(payload: unknown, source: "IPN" | "POLL", expectedRequestId?: string) {
    const rowData = this.findProviderRow(payload)
    if (!rowData) return { ignored: true, reason: "NO_MATCHING_PROVIDER_ID" }
    const request = await this.prisma.cryptoPayoutRequest.findFirst({ where: { OR: [{ id: expectedRequestId || "00000000-0000-0000-0000-000000000000" }, { providerPayoutId: rowData.payoutId || undefined }, { providerBatchWithdrawalId: rowData.batchId || undefined }, { providerUniqueExternalId: rowData.externalId || undefined }] } })
    if (!request) return { ignored: true, reason: "NO_MATCHING_REQUEST" }
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT "id" FROM "CryptoPayoutRequest" WHERE "id" = ${request.id} FOR UPDATE`
      const locked = await tx.cryptoPayoutRequest.findUniqueOrThrow({ where: { id: request.id }, include: { hold: true } })
      if (locked.providerPayoutId && rowData.payoutId && locked.providerPayoutId !== rowData.payoutId) throw new ConflictException("Provider payout identifier mismatch")
      if (rowData.currency && rowData.currency.toUpperCase() !== locked.currencyCode.toUpperCase()) throw new ConflictException("Provider currency mismatch")
      if (this.isFinalLocalStatus(locked.status) && locked.status !== CryptoPayoutRequestStatus.RECONCILIATION_REQUIRED) return { ignored: true, reason: "FINAL_ALREADY_APPLIED", requestId: locked.id }
      const providerStatus = this.normalizedProviderStatus(rowData.status)
      if (this.providerRank(providerStatus) < this.providerRank(locked.providerStatus || "")) return { ignored: true, reason: "OLDER_PROVIDER_STATUS", requestId: locked.id }
      if (rowData.address && this.hashAddress(rowData.address) !== locked.destinationAddressHash) throw new ConflictException("Provider payout address mismatch")
      if (rowData.amount) {
        const providerAmount = new Prisma.Decimal(rowData.amount)
        if (providerAmount.sub(locked.grossCryptoAmount).abs().gt(new Prisma.Decimal("0.000001"))) throw new ConflictException("Provider payout amount mismatch")
      }
      const common = { providerPayoutId: rowData.payoutId || locked.providerPayoutId, providerBatchWithdrawalId: rowData.batchId || locked.providerBatchWithdrawalId, providerStatus, providerStatusRaw: rowData.status, transactionHash: rowData.hash || locked.transactionHash, providerUpdatedAt: this.dateValue(rowData.updatedAt) || new Date(), providerLastEventAt: new Date(), providerStatusSnapshot: this.safeJson(payload), nextPollAt: providerStatus === "FINISHED" || providerStatus === "REJECTED" ? null : new Date(Date.now() + this.pollBackoff(locked.pollAttempts + 1)), pollAttempts: { increment: 1 } }
      if (providerStatus === "FINISHED") { await this.consumeHold(tx, locked, common); await this.emitStatusEvent(tx, locked, "COMPLETED", source); return { applied: true, status: "COMPLETED", requestId: locked.id, source } }
      if (providerStatus === "REJECTED") { await this.releaseHold(tx, locked, "PROVIDER_REJECTED", CryptoPayoutRequestStatus.REFUNDED); await tx.cryptoPayoutRequest.update({ where: { id: locked.id }, data: common }); await this.emitStatusEvent(tx, locked, "REFUNDED", source); return { applied: true, status: "REFUNDED", requestId: locked.id, source } }
      const localStatus = providerStatus === "SENDING" ? CryptoPayoutRequestStatus.SENDING : providerStatus === "PROCESSING" ? CryptoPayoutRequestStatus.PROCESSING : providerStatus === "WAITING" || providerStatus === "CREATING" ? (locked.status === CryptoPayoutRequestStatus.AWAITING_PROVIDER_VERIFICATION ? CryptoPayoutRequestStatus.AWAITING_PROVIDER_VERIFICATION : CryptoPayoutRequestStatus.PROCESSING) : providerStatus === "FAILED" ? CryptoPayoutRequestStatus.RECONCILIATION_REQUIRED : locked.status
      const updated = await tx.cryptoPayoutRequest.update({ where: { id: locked.id }, data: { ...common, status: localStatus } })
      await this.emitStatusEvent(tx, locked, localStatus, source)
      return { applied: true, status: updated.status, requestId: updated.id, source }
    })
  }

  private findListedProviderPayout(value: unknown, externalId: string) { const body: any = value as any; const list = Array.isArray(body) ? body : Array.isArray(body?.payouts) ? body.payouts : Array.isArray(body?.data) ? body.data : body ? [body] : []; return list.find((item: any) => this.stringValue(item, ["unique_external_id", "uniqueExternalId"]) === externalId) || null }
  private findProviderRow(value: unknown): { payoutId?: string; batchId?: string; externalId?: string; currency?: string; status?: string; hash?: string; address?: string; amount?: string; updatedAt?: unknown } | null {
    const body: any = Array.isArray(value) ? value[0] : value
    if (!body || typeof body !== "object") return null
    const first: any = body.withdrawals?.[0] || body.payouts?.[0] || body
    return { payoutId: this.stringValue(first, ["id", "payout_id", "payoutId", "payment_id"]) || this.stringValue(body, ["payout_id", "payoutId", "payment_id"]), batchId: this.stringValue(first, ["batch_withdrawal_id", "batchWithdrawalId"]) || this.stringValue(body, ["batch_withdrawal_id", "batchWithdrawalId"]), externalId: this.stringValue(first, ["unique_external_id", "uniqueExternalId"]) || this.stringValue(body, ["unique_external_id", "uniqueExternalId"]), currency: this.stringValue(first, ["currency", "pay_currency", "outcome_currency"]), status: this.stringValue(first, ["status", "payment_status"]), hash: this.stringValue(first, ["hash", "tx_hash", "transaction_hash"]), address: this.stringValue(first, ["address", "pay_address"]), amount: this.stringValue(first, ["amount", "pay_amount", "outcome_amount"]), updatedAt: first.updated_at || body.updated_at }
  }

  private normalizedProviderStatus(value: unknown) { return String(value || "").trim().toUpperCase() }
  private providerRank(status: string) { return ({ "": 0, CREATING: 1, WAITING: 2, PROCESSING: 3, FAILED: 3, SENDING: 4, REJECTED: 5, FINISHED: 6 } as Record<string, number>)[status] ?? 0 }
  private stringValue(value: any, keys: string[]) { for (const key of keys) if (value?.[key] !== undefined && value?.[key] !== null && String(value[key]).trim()) return String(value[key]).trim(); return undefined }
  private dateValue(value: unknown) { if (!value) return undefined; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? undefined : date }
  private isFinalLocalStatus(status: CryptoPayoutRequestStatus) { return ([CryptoPayoutRequestStatus.COMPLETED, CryptoPayoutRequestStatus.REFUNDED, CryptoPayoutRequestStatus.REJECTED, CryptoPayoutRequestStatus.EXPIRED] as CryptoPayoutRequestStatus[]).includes(status) }
  private pollBackoff(attempt: number) { const config = getCryptoRewardsConfig(); return Math.min(config.pollMaxBackoffMs, config.pollIntervalMs * Math.max(1, 2 ** Math.min(attempt, 5))) }
  private async consumeHold(tx: Prisma.TransactionClient, row: any, providerFields: Record<string, unknown>) { if (row.hold?.status === CryptoPayoutHoldStatus.HELD) await tx.cryptoPayoutHold.update({ where: { id: row.hold.id }, data: { status: CryptoPayoutHoldStatus.CONSUMED, consumedAt: new Date() } }); await tx.cryptoPayoutRequest.update({ where: { id: row.id }, data: { ...providerFields, status: CryptoPayoutRequestStatus.COMPLETED, gldCharged: row.gldHeld, completedAt: new Date() } }) }
  private emitStatusEvent(tx: Prisma.TransactionClient, row: any, status: string, source: string) { return tx.outboxEvent.create({ data: { eventType: "crypto-payout.status-changed", aggregateType: "CryptoPayoutRequest", aggregateId: row.id, payload: { requestId: row.id, userId: row.userId, status, currencyCode: row.currencyCode, source } as Prisma.InputJsonValue } }) }

  private async expireHeldRequests() { const rows = await this.prisma.cryptoPayoutRequest.findMany({ where: { status: { in: [CryptoPayoutRequestStatus.PENDING_ADMIN_APPROVAL, CryptoPayoutRequestStatus.APPROVED] }, holdExpiresAt: { lt: new Date() } }, include: { hold: true }, take: 50 }); let expired = 0; for (const row of rows) { try { await this.prisma.$transaction(async (tx) => { const locked = await tx.cryptoPayoutRequest.findUnique({ where: { id: row.id }, include: { hold: true } }); if (!locked || locked.status === CryptoPayoutRequestStatus.SUBMITTING || !locked.hold || locked.hold.status !== CryptoPayoutHoldStatus.HELD) return; await this.releaseHold(tx, locked, "HOLD_EXPIRED", CryptoPayoutRequestStatus.EXPIRED); }); expired += 1 } catch { /* another worker/admin owns the row */ } } return expired }

  async getAdminConfig() { const config = await this.getConfig(); return this.serializeConfig(config, true) }
  async getAdminProviderHealth() {
    const config = getCryptoRewardsConfig()
    const configured = Boolean(config.providerEnabled && config.apiKey && config.ipnSecret && process.env.NOWPAYMENTS_ACCOUNT_EMAIL?.trim() && process.env.NOWPAYMENTS_ACCOUNT_PASSWORD?.trim())
    if (!configured) return { configured: false, healthy: false, environment: config.providerEnvironment, status: null, balance: null, checks: { status: { ok: false, error: "Credentials are not fully configured" }, balance: { ok: false, error: "Credentials are not fully configured" } }, error: "NOWPayments credentials are not fully configured" }

    const [statusCheck, balanceCheck] = await Promise.all([
      this.provider.getApiStatus().then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: this.providerHealthError(error) })),
      this.provider.getPayoutBalance().then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error: this.providerHealthError(error) })),
    ])
    const errors = [
      !statusCheck.ok ? `status: ${statusCheck.error}` : null,
      !balanceCheck.ok ? `balance: ${balanceCheck.error}` : null,
    ].filter((value): value is string => Boolean(value))
    return {
      configured: true,
      healthy: errors.length === 0,
      environment: config.providerEnvironment,
      status: statusCheck.ok ? this.safeJson(statusCheck.value) : null,
      balance: balanceCheck.ok ? this.safeJson(balanceCheck.value) : null,
      checks: {
        status: statusCheck.ok ? { ok: true } : { ok: false, error: statusCheck.error },
        balance: balanceCheck.ok ? { ok: true } : { ok: false, error: balanceCheck.error },
      },
      ...(errors.length ? { error: `NOWPayments health check failed (${errors.join("; ")})` } : {}),
    }
  }
  async updateAdminConfig(adminId: string, dto: UpdateCryptoRewardConfigDto) {
    const current = await this.getConfig()
    const data: any = { ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }) }
    if (dto.usdtSolGldRate !== undefined) data.usdtSolGldPerUnit = new Prisma.Decimal(dto.usdtSolGldRate)
    if (dto.usdcSolGldRate !== undefined) data.usdcSolGldPerUnit = new Prisma.Decimal(dto.usdcSolGldRate)
    if (dto.platformFeeBps !== undefined) data.platformFeeBps = dto.platformFeeBps
    if (dto.quoteTtlSeconds !== undefined) data.quoteTtlSeconds = dto.quoteTtlSeconds
    if (dto.maxQuoteDriftBps !== undefined) data.maxQuoteDriftBps = dto.maxQuoteDriftBps
    if (dto.minGld !== undefined) data.minGld = BigInt(dto.minGld)
    if (dto.maxGld !== undefined) data.maxGldPerRequest = BigInt(dto.maxGld)
    if (dto.dailyGldLimit !== undefined) data.dailyGldLimit = BigInt(dto.dailyGldLimit)
    if (dto.maxPendingRequestsPerPlayer !== undefined) data.maxPendingPerUser = dto.maxPendingRequestsPerPlayer
    if (dto.holdExpirySeconds !== undefined) data.holdExpiryHours = Math.ceil(dto.holdExpirySeconds / 3600)
    if (dto.minProviderReserveUsd !== undefined) data.minProviderReserveUsd = new Prisma.Decimal(dto.minProviderReserveUsd)
    if (dto.requireAdminApproval !== undefined) data.requireAdminApproval = dto.requireAdminApproval
    if (dto.usdtSolGldRate !== undefined || dto.usdcSolGldRate !== undefined || dto.assetRates !== undefined) {
      const rates = { ...this.assetRateMap(current), ...(dto.assetRates || {}) }
      if (dto.usdtSolGldRate !== undefined) rates.USDTSOL = dto.usdtSolGldRate
      if (dto.usdcSolGldRate !== undefined) rates.USDCSOL = dto.usdcSolGldRate
      data.assetRates = this.cleanAssetRates(rates)
      data.rateVersion = `admin-${Date.now()}`
    }
    const updated = await this.prisma.cryptoRewardConfig.update({ where: { id: current.id }, data })
    const oldValues = this.serializeConfig(current, true)
    const newValues = this.serializeConfig(updated, true)
    await this.prisma.$transaction((tx) => writeAdminAudit(tx, { actorId: adminId, action: "CRYPTO_REWARD_CONFIG_UPDATED", entityType: "CryptoRewardConfig", entityId: updated.id, reason: dto.changeReason?.trim() || undefined, metadata: { changedFields: Object.keys(data), oldValues, newValues } }))
    return this.serializeConfig(updated, true)
  }

  private async getConfig() { const env = getCryptoRewardsConfig(); return this.prisma.cryptoRewardConfig.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default", enabled: env.enabled, networkCode: env.networkCode, usdtSolGldPerUnit: env.defaultUsdtSolGldPerUnit, usdcSolGldPerUnit: env.defaultUsdcSolGldPerUnit, assetRates: { ...env.assetRates, ...(env.defaultUsdtSolGldPerUnit !== "0" ? { USDTSOL: env.defaultUsdtSolGldPerUnit } : {}), ...(env.defaultUsdcSolGldPerUnit !== "0" ? { USDCSOL: env.defaultUsdcSolGldPerUnit } : {}) }, quoteTtlSeconds: env.quoteTtlSeconds, maxQuoteDriftBps: env.maxQuoteDriftBps, minGld: BigInt(env.minGld), maxGldPerRequest: BigInt(env.maxGldPerRequest), dailyGldLimit: BigInt(env.dailyGldLimit), maxPendingPerUser: env.maxPendingPerUser, holdExpiryHours: env.holdExpiryHours, platformFeeBps: env.platformFeeBps, minProviderReserveUsd: new Prisma.Decimal(env.minProviderReserveUsd), requireAdminApproval: env.requireAdminApproval }, update: {} }) }
  private assertEnabled(config: any) { if (!config.enabled || !getCryptoRewardsConfig().providerEnabled) throw new ServiceUnavailableException("Crypto rewards are not available") }
  private assertCurrency(currency: string, network: string) { const asset = getCryptoRewardAsset(currency); if (!asset || asset.networkCode !== network) throw new BadRequestException("The selected asset and network do not match"); return asset }
  private assertDestinationAddress(address: string, kind: string, networkLabel: string) {
    const value = address.trim()
    if (!value || value.length > 128) throw new BadRequestException(`Enter a valid ${networkLabel} address`)
    if (kind === "SOLANA" && ([...value].some((char) => !BASE58.includes(char)) || this.base58Bytes(value) !== 32)) throw new BadRequestException("Enter a valid Solana address")
    if (kind === "EVM" && !/^0x[a-fA-F0-9]{40}$/.test(value)) throw new BadRequestException(`Enter a valid ${networkLabel} address`)
    if (kind === "TRON" && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value)) throw new BadRequestException("Enter a valid TRON address")
  }
  private base58Bytes(value: string) { let number = 0n; for (const char of value) number = number * 58n + BigInt(BASE58.indexOf(char)); const significantBytes = number === 0n ? 0 : Math.ceil(number.toString(16).length / 2); let leadingZeroBytes = 0; for (const char of value) { if (char !== "1") break; leadingZeroBytes++ } return significantBytes + leadingZeroBytes }
  private parseGld(value: string) { if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new BadRequestException("GLD amount must be positive"); return new Prisma.Decimal(value) }
  private assertLimits(amount: Prisma.Decimal, config: any) { if (amount.lt(config.minGld) || amount.gt(config.maxGldPerRequest)) throw new BadRequestException("GLD amount is outside the configured limits") }
  private async assertRequestLimits(userId: string, amount: Prisma.Decimal | bigint, config: any, tx?: Prisma.TransactionClient) { const db: any = tx ?? this.prisma; const count = await db.cryptoPayoutRequest.count({ where: { userId, status: { in: ACTIVE_REQUEST_STATUSES } } }); if (count >= config.maxPendingPerUser) throw new ConflictException("You already have the maximum number of pending crypto rewards"); const start = new Date(); start.setUTCHours(0, 0, 0, 0); const daily = await db.cryptoPayoutRequest.aggregate({ where: { userId, requestedAt: { gte: start }, status: { not: CryptoPayoutRequestStatus.REJECTED } }, _sum: { gldRequested: true } }); if ((daily._sum.gldRequested ?? 0n) + BigInt(amount.toString()) > config.dailyGldLimit) throw new BadRequestException("Your daily crypto reward limit has been reached") }
  private async assertGldBalance(userId: string, amount: Prisma.Decimal) { const balance = await this.prisma.walletBalance.findFirst({ where: { wallet: { userId }, currency: { code: "GLD" } } }); if (!balance || balance.exactAmount.lt(amount)) throw new BadRequestException("Insufficient GLD balance") }
  private rateFor(config: any, currency: CryptoRewardCurrency) { const rates = this.assetRateMap(config); const value = rates[currency] ?? (currency === "USDTSOL" ? config.usdtSolGldPerUnit?.toString() : currency === "USDCSOL" ? config.usdcSolGldPerUnit?.toString() : "0"); return new Prisma.Decimal(value || "0") }
  private providerBoolean(value: any) { if (typeof value?.valid === "boolean") return value.valid; if (typeof value?.is_valid === "boolean") return value.is_valid; return true }
  private providerHealthError(error: unknown) {
    if (error instanceof NowPaymentsHttpError) {
      const body = error.responseBody as any
      const providerMessage = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : undefined
      return `${error.path} returned HTTP ${error.statusCode}${providerMessage ? `: ${providerMessage.slice(0, 180)}` : ""}`
    }
    const cause = (error as { cause?: unknown })?.cause
    const causeMessage = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : undefined
    return `${error instanceof Error ? error.message : "Unknown provider error"}${causeMessage ? `: ${causeMessage.slice(0, 180)}` : ""}`
  }
  private assertProviderReserve(value: unknown, currency: CryptoRewardCurrency, amount: Prisma.Decimal, reserve: Prisma.Decimal) {
    if (reserve.lte(0)) return
    const body: any = value as any
    const entries = Array.isArray(body) ? body : Array.isArray(body?.balances) ? body.balances : Array.isArray(body?.data) ? body.data : []
    const entry = entries.find((item: any) => String(item?.currency ?? item?.code ?? item?.ticker ?? "").toUpperCase() === currency)
    const available = entry?.amount ?? entry?.balance ?? entry?.available ?? entry?.available_balance
    if (!/^\d+(?:\.\d+)?$/.test(String(available ?? ""))) throw new ConflictException("NOWPayments balance could not be verified against the configured reserve")
    if (new Prisma.Decimal(String(available)).lt(amount.add(reserve))) throw new ConflictException("NOWPayments balance is below the payout plus configured reserve")
  }
  private extractDecimal(value: any, keys: string[], fallback: string) { for (const key of keys) { const candidate = value?.[key] ?? value?.data?.[key]; if (candidate !== undefined && /^\d+(?:\.\d+)?$/.test(String(candidate))) return new Prisma.Decimal(String(candidate)) }; return new Prisma.Decimal(fallback) }
  private serializeQuote(row: any) { return { id: row.id, currencyCode: row.currencyCode, networkCode: row.networkCode, destinationAddressMasked: row.destinationAddressMasked, gldAmount: row.gldAmount.toString(), gldRatePerStablecoin: row.gldRatePerStablecoin.toString(), grossCryptoAmount: row.grossCryptoAmount.toString(), platformFeeCrypto: row.platformFeeCrypto.toString(), providerFeeCrypto: row.providerFeeCrypto.toString(), netCryptoAmount: row.netCryptoAmount.toString(), minimumPayoutAmount: row.minimumPayoutAmount.toString(), expiresAt: row.expiresAt } }
  private serializeRequest(row: any) { return { id: row.id, status: row.status, statusReason: row.status === CryptoPayoutRequestStatus.REJECTED ? "ADMIN_REJECTED" : row.status === CryptoPayoutRequestStatus.REFUNDED ? "PROVIDER_REJECTED" : row.status === CryptoPayoutRequestStatus.EXPIRED ? "HOLD_EXPIRED" : null, currencyCode: row.currencyCode, networkCode: row.networkCode, destinationAddressMasked: row.destinationAddressMasked, gldRequested: row.gldRequested.toString(), gldHeld: row.gldHeld.toString(), gldReleased: row.gldReleased.toString(), grossCryptoAmount: row.grossCryptoAmount.toString(), platformFeeCrypto: row.platformFeeCrypto.toString(), providerFeeCrypto: row.providerFeeCrypto.toString(), netCryptoAmount: row.netCryptoAmount.toString(), providerStatus: row.providerStatus, transactionHash: row.transactionHash, providerEnvironment: row.providerEnvironment, addressValidatedAt: row.addressValidatedAt, quoteExpiresAt: row.quoteExpiresAt, holdExpiresAt: row.holdExpiresAt, requestedAt: row.requestedAt, approvedAt: row.approvedAt, rejectedAt: row.rejectedAt, completedAt: row.completedAt } }
  private assetRateMap(row: any): Record<string, string> { const raw = row?.assetRates; return raw && typeof raw === "object" && !Array.isArray(raw) ? Object.fromEntries(Object.entries(raw).map(([key, value]) => [key.toUpperCase(), String(value)])) : {} }
  private cleanAssetRates(value: Record<string, unknown>) { return Object.fromEntries(Object.entries(value).filter(([code, rate]) => isCryptoRewardCurrency(code) && typeof rate === "string" && /^\d+(?:\.\d{1,6})?$/.test(rate) && Number(rate) > 0)) }
  private assetViews(row: any) { const rates = this.assetRateMap(row); return CRYPTO_REWARD_ASSETS.map((asset) => ({ ...asset, rate: rates[asset.code] || (asset.code === "USDTSOL" ? row.usdtSolGldPerUnit.toString() : asset.code === "USDCSOL" ? row.usdcSolGldPerUnit.toString() : "0"), rateConfigured: new Prisma.Decimal(rates[asset.code] || (asset.code === "USDTSOL" ? row.usdtSolGldPerUnit.toString() : asset.code === "USDCSOL" ? row.usdcSolGldPerUnit.toString() : "0")).gt(0) })) }
  private serializeConfig(row: any, admin = false) { const provider = getCryptoRewardsConfig(); return { enabled: row.enabled, networkCode: row.networkCode, currencies: CRYPTO_REWARD_CURRENCIES, assets: this.assetViews(row), rateVersion: admin ? row.rateVersion : undefined, ...(admin ? { assetRates: this.assetRateMap(row), usdtSolGldPerUnit: row.usdtSolGldPerUnit.toString(), usdcSolGldPerUnit: row.usdcSolGldPerUnit.toString(), platformFeeBps: row.platformFeeBps, quoteTtlSeconds: row.quoteTtlSeconds, maxQuoteDriftBps: row.maxQuoteDriftBps, minGld: row.minGld.toString(), maxGldPerRequest: row.maxGldPerRequest.toString(), dailyGldLimit: row.dailyGldLimit.toString(), maxPendingPerUser: row.maxPendingPerUser, holdExpiryHours: row.holdExpiryHours, minProviderReserveUsd: row.minProviderReserveUsd?.toString() ?? "0", requireAdminApproval: row.requireAdminApproval, updatedAt: row.updatedAt?.toISOString?.() ?? null, providerEnabled: provider.providerEnabled, providerEnvironment: provider.providerEnvironment, providerBaseUrl: provider.providerBaseUrl, supportedCurrencies: provider.supportedCurrencies, providerConfigured: Boolean(provider.providerEnabled && provider.apiKey && provider.ipnSecret && process.env.NOWPAYMENTS_ACCOUNT_EMAIL?.trim() && process.env.NOWPAYMENTS_ACCOUNT_PASSWORD?.trim() && provider.ipnCallbackUrl), callbackConfigured: Boolean(provider.ipnCallbackUrl), requirePayoutVerification: provider.requirePayoutVerification, payoutTotpConfigured: Boolean(provider.payoutTotpSecret), payoutVerificationMode: !provider.requirePayoutVerification ? "DISABLED" : provider.autoVerifyPayouts && provider.payoutTotpSecret ? "AUTO_TOTP" : "MANUAL_2FA" } : {}) } }
  private hashAddress(value: string) { return createHash("sha256").update(value.trim()).digest("hex") }
  private mask(value: string) { const v = value.trim(); return `${v.slice(0, 4)}…${v.slice(-4)}` }
  private key() { return createHash("sha256").update(process.env.CRYPTO_REWARDS_ADDRESS_ENCRYPTION_KEY || getAuthConfig().accessSecret).digest() }
  private encryptAddress(value: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}` }
  private decryptAddress(value: string) { const [iv, tag, data] = value.split("."); const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8") }
  private safeJson(value: unknown) { return JSON.parse(JSON.stringify(value, (_, item) => item instanceof Prisma.Decimal ? item.toString() : item)) as Prisma.InputJsonValue }
  private async releaseHold(tx: Prisma.TransactionClient, row: any, reason: string, finalStatus: CryptoPayoutRequestStatus = CryptoPayoutRequestStatus.REJECTED) { const amount = BigInt(row.hold.amount) - BigInt(row.hold.released); if (amount > 0n) await this.creditWallet.runWithinTransaction({ userId: row.userId, currencyCode: "GLD", amount, amountDecimal: amount.toString(), sourceId: `${row.id}:release`, sourceType: WalletTransactionSourceType.REFUND, rewardGrantKey: `CRYPTO_PAYOUT_RELEASE:${row.id}`, metadata: { requestId: row.id, reason } }, tx); await tx.cryptoPayoutHold.update({ where: { id: row.hold.id }, data: { status: CryptoPayoutHoldStatus.RELEASED, released: row.hold.amount, releasedAt: new Date() } }); await tx.cryptoPayoutRequest.update({ where: { id: row.id }, data: { status: finalStatus, gldReleased: row.hold.amount, rejectedAt: new Date(), adminDecision: reason } }) }
}
