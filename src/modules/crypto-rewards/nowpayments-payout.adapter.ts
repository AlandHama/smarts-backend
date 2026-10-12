import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common"
import { createHmac, timingSafeEqual } from "node:crypto"

import { getCryptoRewardsConfig, CryptoRewardCurrency } from "./crypto-rewards.config"

export type PayoutWithdrawal = {
  address: string
  currency: CryptoRewardCurrency
  amount: string
  unique_external_id?: string
  payout_description?: string
}

export type CryptoPayoutProvider = {
  getApiStatus(): Promise<unknown>
  getSupportedCurrencies(): Promise<unknown>
  getPayoutBalance(): Promise<unknown>
  validatePayoutAddress(address: string, currency: CryptoRewardCurrency): Promise<unknown>
  getMinimumPayoutAmount(currency: CryptoRewardCurrency): Promise<unknown>
  getPayoutFeeEstimate(currency: CryptoRewardCurrency, amount: string): Promise<unknown>
  createPayout(input: { withdrawals: PayoutWithdrawal[]; ipnCallbackUrl?: string }): Promise<unknown>
  verifyPayout(batchWithdrawalId: string, verificationCode: string): Promise<unknown>
  getPayoutStatus(payoutId: string): Promise<unknown>
  listPayouts(filters?: Record<string, string | number>): Promise<unknown>
  verifyAndNormalizeIpn(rawBody: string, signature: string | undefined): Record<string, unknown>
}

export class NowPaymentsHttpError extends Error {
  constructor(public readonly statusCode: number, public readonly responseBody: unknown, public readonly path: string) {
    super(`NOWPayments ${path} failed with HTTP ${statusCode}`)
  }
}

@Injectable()
export class NowPaymentsPayoutAdapter implements CryptoPayoutProvider {
  private readonly logger = new Logger(NowPaymentsPayoutAdapter.name)
  private jwtToken?: string
  private jwtExpiresAt = 0

  async getApiStatus() { return this.request("/status", { method: "GET" }) }

  async getSupportedCurrencies() { return this.request("/full-currencies", { method: "GET" }) }

  async getPayoutBalance() { return this.request("/balance", { method: "GET" }) }

  async validatePayoutAddress(address: string, currency: CryptoRewardCurrency) {
    return this.request("/payout/validate-address", { method: "POST", body: { address, currency } })
  }

  async getMinimumPayoutAmount(currency: CryptoRewardCurrency) {
    return this.request(`/payout-withdrawal/min-amount/${encodeURIComponent(currency)}`, { method: "GET" })
  }

  async getPayoutFeeEstimate(currency: CryptoRewardCurrency, amount: string) {
    return this.request(`/payout/fee?currency=${encodeURIComponent(currency)}&amount=${encodeURIComponent(amount)}`, { method: "GET" })
  }

  async createPayout(input: { withdrawals: PayoutWithdrawal[]; ipnCallbackUrl?: string }) {
    return this.request("/payout", {
      method: "POST",
      body: {
        ...(input.ipnCallbackUrl ? { ipn_callback_url: input.ipnCallbackUrl } : {}),
        withdrawals: input.withdrawals,
      },
      requiresJwt: true,
      retrySafe: false,
    })
  }

  async verifyPayout(batchWithdrawalId: string, verificationCode: string) {
    return this.request(`/payout/${encodeURIComponent(batchWithdrawalId)}/verify`, {
      method: "POST",
      body: { verification_code: verificationCode },
      requiresJwt: true,
      retrySafe: false,
    })
  }

  async getPayoutStatus(payoutId: string) {
    return this.request(`/payout/${encodeURIComponent(payoutId)}`, { method: "GET", requiresJwt: true })
  }

  async listPayouts(filters?: Record<string, string | number>) {
    const query = filters
      ? `?${new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]))}`
      : ""
    return this.request(`/payout${query}`, { method: "GET", requiresJwt: true })
  }

  verifyAndNormalizeIpn(rawBody: string, signature: string | undefined) {
    const config = getCryptoRewardsConfig()
    if (!config.ipnSecret) throw new ServiceUnavailableException("NOWPayments IPN secret is not configured")
    if (!signature) throw new UnauthorizedException("NOWPayments IPN signature is missing")
    const payload = JSON.parse(rawBody) as Record<string, unknown>
    const sorted = JSON.stringify(this.sortObject(payload))
    const expected = createHmac("sha512", config.ipnSecret).update(sorted).digest("hex")
    const received = signature.trim().toLowerCase()
    const matches = received.length === expected.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received))
    if (!matches) throw new UnauthorizedException("NOWPayments IPN signature is invalid")
    return payload
  }

  private async request(path: string, options: { method: "GET" | "POST"; body?: Record<string, unknown>; requiresJwt?: boolean; retrySafe?: boolean }, retry = 0): Promise<unknown> {
    const config = getCryptoRewardsConfig()
    if (!config.providerEnabled) throw new ServiceUnavailableException("NOWPayments integration is disabled")
    if (!config.apiKey) throw new ServiceUnavailableException("NOWPayments API key is not configured")

    const headers: Record<string, string> = { "x-api-key": config.apiKey, Accept: "application/json" }
    if (options.body) headers["Content-Type"] = "application/json"
    if (options.requiresJwt) headers.Authorization = `Bearer ${await this.getJwtToken(config)}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    try {
      const response = await fetch(`${config.providerBaseUrl.replace(/\/$/, "")}${path}`, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })
      const text = await response.text()
      let body: unknown = null
      try { body = text ? JSON.parse(text) : null } catch { body = { message: text.slice(0, 500) } }
      if (response.status === 401 && options.requiresJwt && retry === 0) {
        this.jwtToken = undefined
        this.jwtExpiresAt = 0
        return this.request(path, options, 1)
      }
      if (!response.ok) throw new NowPaymentsHttpError(response.status, body, path)
      return body
    } catch (error) {
      if (error instanceof NowPaymentsHttpError) throw error
      if (retry < config.maxRetries && options.retrySafe !== false && options.method === "GET") {
        await new Promise((resolve) => setTimeout(resolve, 150 * (retry + 1)))
        return this.request(path, options, retry + 1)
      }
      const reason = error instanceof Error ? error.message : "unknown error"
      this.logger.warn(`NOWPayments request failed for ${path}: ${reason}`)
      const unavailable = new ServiceUnavailableException(`NOWPayments request failed for ${path}`)
      ;(unavailable as ServiceUnavailableException & { cause?: unknown }).cause = error
      throw unavailable
    } finally {
      clearTimeout(timeout)
    }
  }

  private async getJwtToken(config: ReturnType<typeof getCryptoRewardsConfig>) {
    if (this.jwtToken && Date.now() < this.jwtExpiresAt) return this.jwtToken
    const email = process.env.NOWPAYMENTS_ACCOUNT_EMAIL?.trim()
    const password = process.env.NOWPAYMENTS_ACCOUNT_PASSWORD?.trim()
    if (!email || !password) throw new ServiceUnavailableException("NOWPayments payout credentials are not configured")
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    try {
      const response = await fetch(`${config.providerBaseUrl.replace(/\/$/, "")}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": config.apiKey, Accept: "application/json" },
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      })
      if (!response.ok) throw new ServiceUnavailableException("NOWPayments payout authentication failed")
      const body = await response.json() as Record<string, unknown>
      const token = String(body.token ?? body.jwt ?? body.access_token ?? "")
      if (!token) throw new ServiceUnavailableException("NOWPayments payout authentication returned no token")
      this.jwtToken = token
      this.jwtExpiresAt = Date.now() + 4 * 60 * 1000
      return token
    } finally {
      clearTimeout(timeout)
    }
  }

  private sortObject(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.sortObject(item))
    if (!value || typeof value !== "object") return value
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = this.sortObject((value as Record<string, unknown>)[key])
      return result
    }, {})
  }
}
