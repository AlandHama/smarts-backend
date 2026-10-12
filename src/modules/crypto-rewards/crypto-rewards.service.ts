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
import { CRYPTO_REWARD_CURRENCIES, CryptoRewardCurrency, getCryptoRewardsConfig, isCryptoRewardCurrency } from "./crypto-rewards.config"
import { NowPaymentsPayoutAdapter } from "./nowpayments-payout.adapter"

const SOLANA = "SOLANA"
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
    return { enabled: config.enabled, networkCode: config.networkCode, currencies: CRYPTO_REWARD_CURRENCIES, quoteTtlSeconds: config.quoteTtlSeconds, minGld: config.minGld.toString(), maxGldPerRequest: config.maxGldPerRequest.toString(), requireAdminApproval: config.requireAdminApproval }
  }

  async validateAddress(userId: string, input: { currencyCode: CryptoRewardCurrency; networkCode: string; destinationAddress: string }) {
    this.assertCurrency(input.currencyCode, input.networkCode)
    this.assertSolanaAddress(input.destinationAddress)
    const config = await this.getConfig()
    if (!config.enabled || !getCryptoRewardsConfig().providerEnabled) throw new ServiceUnavailableException("Crypto rewards are not available")
    const result = await this.provider.validatePayoutAddress(input.destinationAddress.trim(), input.currencyCode)
    const valid = this.providerBoolean(result)
    if (valid === false) throw new BadRequestException("The payout address was rejected by NOWPayments")
    return { valid: true, provider: "NOWPayments", providerValidated: true, currencyCode: input.currencyCode, networkCode: SOLANA, destinationAddressMasked: this.mask(input.destinationAddress) }
  }

  async quote(userId: string, input: CryptoRewardQuoteDto) {
    await this.fraud.assertRewardAllowed(userId)
    this.assertCurrency(input.currencyCode, input.networkCode)
    this.assertSolanaAddress(input.destinationAddress)
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
    const quote = await this.prisma.cryptoPayoutQuote.create({ data: { userId, currencyCode: input.currencyCode, networkCode: SOLANA, destinationAddressHash: this.hashAddress(input.destinationAddress), destinationAddressMasked: this.mask(input.destinationAddress), gldAmount: BigInt(gld.toString()), gldRatePerStablecoin: rate, gldRateVersion: config.rateVersion, platformFeeBps: config.platformFeeBps, platformFeeCrypto: platformFee, providerFeeCrypto: providerFee, providerFeeCurrency: input.currencyCode, grossCryptoAmount: gross, netCryptoAmount: net, minimumPayoutAmount: minimum, quoteSnapshot: snapshot, expiresAt } })
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
    this.assertSolanaAddress(input.destinationAddress)
    const addressCheck = await this.prisma.cryptoPayoutQuote.findFirst({ where: { id: input.quoteId, userId }, select: { destinationAddressHash: true, currencyCode: true, networkCode: true, expiresAt: true, consumedAt: true, gldAmount: true } })
    if (!addressCheck) throw new NotFoundException("Crypto reward quote not found")
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
    const rows = await this.prisma.cryptoPayoutRequest.findMany({ where: status ? { status } : {}, include: { user: { select: { id: true, email: true, status: true, profile: { select: { displayName: true } } } }, hold: true }, orderBy: { createdAt: "asc" }, take: 200 })
    return rows.map((row) => ({ ...this.serializeRequest(row), user: row.user, hold: row.hold ? { status: row.hold.status, amount: row.hold.amount.toString(), released: row.hold.released.toString(), expiresAt: row.hold.expiresAt } : null }))
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

  async getAdminConfig() { const config = await this.getConfig(); return this.serializeConfig(config, true) }
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
    if (dto.requireAdminApproval !== undefined) data.requireAdminApproval = dto.requireAdminApproval
    if (dto.usdtSolGldRate !== undefined || dto.usdcSolGldRate !== undefined) data.rateVersion = `admin-${Date.now()}`
    const updated = await this.prisma.cryptoRewardConfig.update({ where: { id: current.id }, data })
    await this.prisma.$transaction((tx) => writeAdminAudit(tx, { actorId: adminId, action: "CRYPTO_REWARD_CONFIG_UPDATED", entityType: "CryptoRewardConfig", entityId: updated.id, metadata: { changedFields: Object.keys(data) } }))
    return this.serializeConfig(updated, true)
  }

  private async getConfig() { const env = getCryptoRewardsConfig(); return this.prisma.cryptoRewardConfig.upsert({ where: { singletonKey: "default" }, create: { singletonKey: "default", enabled: env.enabled, networkCode: SOLANA, usdtSolGldPerUnit: env.defaultUsdtSolGldPerUnit, usdcSolGldPerUnit: env.defaultUsdcSolGldPerUnit, quoteTtlSeconds: env.quoteTtlSeconds, maxQuoteDriftBps: env.maxQuoteDriftBps, minGld: BigInt(env.minGld), maxGldPerRequest: BigInt(env.maxGldPerRequest), dailyGldLimit: BigInt(env.dailyGldLimit), maxPendingPerUser: env.maxPendingPerUser, holdExpiryHours: env.holdExpiryHours, platformFeeBps: env.platformFeeBps, requireAdminApproval: env.requireAdminApproval }, update: {} }) }
  private assertEnabled(config: any) { if (!config.enabled || !getCryptoRewardsConfig().providerEnabled) throw new ServiceUnavailableException("Crypto rewards are not available") }
  private assertCurrency(currency: string, network: string) { if (!isCryptoRewardCurrency(currency) || network !== SOLANA) throw new BadRequestException("Only USDTSOL and USDCSOL on Solana are supported") }
  private assertSolanaAddress(address: string) { const value = address.trim(); if (!value || [...value].some((char) => !BASE58.includes(char)) || this.base58Bytes(value) !== 32) throw new BadRequestException("Enter a valid Solana address") }
  private base58Bytes(value: string) { let number = 0n; for (const char of value) number = number * 58n + BigInt(BASE58.indexOf(char)); const significantBytes = number === 0n ? 0 : Math.ceil(number.toString(16).length / 2); let leadingZeroBytes = 0; for (const char of value) { if (char !== "1") break; leadingZeroBytes++ } return significantBytes + leadingZeroBytes }
  private parseGld(value: string) { if (!/^\d+$/.test(value) || BigInt(value) <= 0n) throw new BadRequestException("GLD amount must be positive"); return new Prisma.Decimal(value) }
  private assertLimits(amount: Prisma.Decimal, config: any) { if (amount.lt(config.minGld) || amount.gt(config.maxGldPerRequest)) throw new BadRequestException("GLD amount is outside the configured limits") }
  private async assertRequestLimits(userId: string, amount: Prisma.Decimal | bigint, config: any, tx?: Prisma.TransactionClient) { const db: any = tx ?? this.prisma; const count = await db.cryptoPayoutRequest.count({ where: { userId, status: { in: ACTIVE_REQUEST_STATUSES } } }); if (count >= config.maxPendingPerUser) throw new ConflictException("You already have the maximum number of pending crypto rewards"); const start = new Date(); start.setUTCHours(0, 0, 0, 0); const daily = await db.cryptoPayoutRequest.aggregate({ where: { userId, requestedAt: { gte: start }, status: { not: CryptoPayoutRequestStatus.REJECTED } }, _sum: { gldRequested: true } }); if ((daily._sum.gldRequested ?? 0n) + BigInt(amount.toString()) > config.dailyGldLimit) throw new BadRequestException("Your daily crypto reward limit has been reached") }
  private async assertGldBalance(userId: string, amount: Prisma.Decimal) { const balance = await this.prisma.walletBalance.findFirst({ where: { wallet: { userId }, currency: { code: "GLD" } } }); if (!balance || balance.exactAmount.lt(amount)) throw new BadRequestException("Insufficient GLD balance") }
  private rateFor(config: any, currency: CryptoRewardCurrency) { return currency === "USDTSOL" ? config.usdtSolGldPerUnit : config.usdcSolGldPerUnit }
  private providerBoolean(value: any) { if (typeof value?.valid === "boolean") return value.valid; if (typeof value?.is_valid === "boolean") return value.is_valid; return true }
  private extractDecimal(value: any, keys: string[], fallback: string) { for (const key of keys) { const candidate = value?.[key] ?? value?.data?.[key]; if (candidate !== undefined && /^\d+(?:\.\d+)?$/.test(String(candidate))) return new Prisma.Decimal(String(candidate)) }; return new Prisma.Decimal(fallback) }
  private serializeQuote(row: any) { return { id: row.id, currencyCode: row.currencyCode, networkCode: row.networkCode, destinationAddressMasked: row.destinationAddressMasked, gldAmount: row.gldAmount.toString(), gldRatePerStablecoin: row.gldRatePerStablecoin.toString(), grossCryptoAmount: row.grossCryptoAmount.toString(), platformFeeCrypto: row.platformFeeCrypto.toString(), providerFeeCrypto: row.providerFeeCrypto.toString(), netCryptoAmount: row.netCryptoAmount.toString(), minimumPayoutAmount: row.minimumPayoutAmount.toString(), expiresAt: row.expiresAt } }
  private serializeRequest(row: any) { return { id: row.id, status: row.status, currencyCode: row.currencyCode, networkCode: row.networkCode, destinationAddressMasked: row.destinationAddressMasked, gldRequested: row.gldRequested.toString(), gldHeld: row.gldHeld.toString(), gldReleased: row.gldReleased.toString(), grossCryptoAmount: row.grossCryptoAmount.toString(), platformFeeCrypto: row.platformFeeCrypto.toString(), providerFeeCrypto: row.providerFeeCrypto.toString(), netCryptoAmount: row.netCryptoAmount.toString(), providerStatus: row.providerStatus, transactionHash: row.transactionHash, quoteExpiresAt: row.quoteExpiresAt, holdExpiresAt: row.holdExpiresAt, requestedAt: row.requestedAt, approvedAt: row.approvedAt, rejectedAt: row.rejectedAt, completedAt: row.completedAt } }
  private serializeConfig(row: any, admin = false) { return { enabled: row.enabled, networkCode: row.networkCode, currencies: CRYPTO_REWARD_CURRENCIES, rateVersion: admin ? row.rateVersion : undefined, ...(admin ? { usdtSolGldPerUnit: row.usdtSolGldPerUnit.toString(), usdcSolGldPerUnit: row.usdcSolGldPerUnit.toString(), platformFeeBps: row.platformFeeBps, quoteTtlSeconds: row.quoteTtlSeconds, maxQuoteDriftBps: row.maxQuoteDriftBps, minGld: row.minGld.toString(), maxGldPerRequest: row.maxGldPerRequest.toString(), dailyGldLimit: row.dailyGldLimit.toString(), maxPendingPerUser: row.maxPendingPerUser, holdExpiryHours: row.holdExpiryHours, requireAdminApproval: row.requireAdminApproval } : {}) } }
  private hashAddress(value: string) { return createHash("sha256").update(value.trim()).digest("hex") }
  private mask(value: string) { const v = value.trim(); return `${v.slice(0, 4)}…${v.slice(-4)}` }
  private key() { return createHash("sha256").update(process.env.CRYPTO_REWARDS_ADDRESS_ENCRYPTION_KEY || getAuthConfig().accessSecret).digest() }
  private encryptAddress(value: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}` }
  private decryptAddress(value: string) { const [iv, tag, data] = value.split("."); const decipher = createDecipheriv("aes-256-gcm", this.key(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8") }
  private safeJson(value: unknown) { return JSON.parse(JSON.stringify(value, (_, item) => item instanceof Prisma.Decimal ? item.toString() : item)) as Prisma.InputJsonValue }
  private async releaseHold(tx: Prisma.TransactionClient, row: any, reason: string) { const amount = BigInt(row.hold.amount) - BigInt(row.hold.released); if (amount > 0n) await this.creditWallet.runWithinTransaction({ userId: row.userId, currencyCode: "GLD", amount, amountDecimal: amount.toString(), sourceId: `${row.id}:release`, sourceType: WalletTransactionSourceType.REFUND, rewardGrantKey: `CRYPTO_PAYOUT_RELEASE:${row.id}`, metadata: { requestId: row.id, reason } }, tx); await tx.cryptoPayoutHold.update({ where: { id: row.hold.id }, data: { status: CryptoPayoutHoldStatus.RELEASED, released: row.hold.amount, releasedAt: new Date() } }); await tx.cryptoPayoutRequest.update({ where: { id: row.id }, data: { status: CryptoPayoutRequestStatus.REJECTED, gldReleased: row.hold.amount, rejectedAt: new Date(), adminDecision: reason } }) }
}
