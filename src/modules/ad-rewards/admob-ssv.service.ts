import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { createPublicKey, createVerify, KeyObject } from "node:crypto";

import { PrismaService } from "../../prisma.service";
import {
  ClaimAdRewardTransaction,
  TrustedAdProviderVerification,
} from "./transactions/claim-ad-reward-transaction";

const ADMOB_VERIFICATION_KEYS_URL =
  "https://www.gstatic.com/admob/reward/verifier-keys.json";
const KEY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AdMobVerificationKey = { keyId: number; pem?: string; base64?: string };
type AdMobVerificationKeyResponse = { keys?: AdMobVerificationKey[] };

@Injectable()
export class AdMobSsvService {
  private readonly logger = new Logger(AdMobSsvService.name);
  private cachedKeys?: { expiresAt: number; keys: Map<number, KeyObject> };

  constructor(
    private readonly prisma: PrismaService,
    private readonly claimTransaction: ClaimAdRewardTransaction,
  ) {}

  async handleCallback(originalUrl: string) {
    const callback = this.parseCallbackUrl(originalUrl);
    await this.verifyGoogleSignature(
      callback.signedQuery,
      callback.signature,
      callback.keyId,
    );

    const customData = callback.params.get("custom_data");
    const transactionId = callback.params.get("transaction_id");
    if (!customData || !transactionId)
      throw new BadRequestException("AdMob SSV callback is missing claim data");
    if (transactionId.length > 255)
      throw new BadRequestException("AdMob SSV transaction ID is invalid");

    const separator = customData.indexOf(":");
    if (
      separator <= 0 ||
      separator === customData.length - 1 ||
      customData.indexOf(":", separator + 1) !== -1
    ) {
      throw new BadRequestException("AdMob SSV custom data is invalid");
    }
    const claimId = customData.slice(0, separator);
    const claimToken = customData.slice(separator + 1);
    if (!UUID_PATTERN.test(claimId))
      throw new BadRequestException("AdMob SSV claim ID is invalid");

    const claim = await this.prisma.adRewardClaim.findUnique({
      where: { id: claimId },
      select: { id: true, provider: true, adFormat: true },
    });
    if (!claim || claim.provider !== "admob")
      throw new BadRequestException("AdMob reward claim not found");

    const trustedVerification: TrustedAdProviderVerification = {
      source: "ADMOB_SSV",
      payload: {
        adNetwork: callback.params.get("ad_network"),
        adUnit: callback.params.get("ad_unit"),
        rewardAmount: callback.params.get("reward_amount"),
        rewardItem: callback.params.get("reward_item"),
        timestamp: callback.params.get("timestamp"),
        transactionId,
        userId: callback.params.get("user_id"),
      },
    };

    const result = await this.claimTransaction.run({
      dto: {
        claimId: claim.id,
        providerEventId: transactionId,
        adFormat: claim.adFormat,
        claimToken,
      },
      trustedVerification,
    });

    return { accepted: true, claimId: claim.id, status: result.status };
  }

  private parseCallbackUrl(originalUrl: string) {
    const queryStart = originalUrl.indexOf("?");
    if (queryStart < 0)
      throw new BadRequestException("AdMob SSV callback query is missing");
    const rawQuery = originalUrl.slice(queryStart + 1);
    const parts = rawQuery.split("&");
    const signatureIndex = parts.findIndex((part) =>
      part.startsWith("signature="),
    );
    const keyIdIndex = parts.findIndex((part) => part.startsWith("key_id="));
    if (signatureIndex < 0)
      throw new UnauthorizedException("AdMob SSV signature is missing");
    if (keyIdIndex !== signatureIndex + 1 || keyIdIndex !== parts.length - 1)
      throw new UnauthorizedException(
        "AdMob SSV signature ordering is invalid",
      );

    const signature = this.decodeBase64Url(
      parts[signatureIndex].slice("signature=".length),
    );
    const keyId = Number.parseInt(
      parts[keyIdIndex].slice("key_id=".length),
      10,
    );
    if (!Number.isSafeInteger(keyId) || keyId <= 0)
      throw new UnauthorizedException("AdMob SSV key ID is invalid");
    return {
      signedQuery: parts.slice(0, signatureIndex).join("&"),
      signature,
      keyId,
      params: new URLSearchParams(rawQuery),
    };
  }

  private async verifyGoogleSignature(
    signedQuery: string,
    signature: Buffer,
    keyId: number,
  ) {
    const key = await this.getVerificationKey(keyId);
    const verifier = createVerify("sha256");
    verifier.update(signedQuery, "utf8");
    verifier.end();
    if (!verifier.verify(key, signature))
      throw new UnauthorizedException("Invalid AdMob SSV signature");
  }

  private async getVerificationKey(keyId: number) {
    if (
      !this.cachedKeys ||
      this.cachedKeys.expiresAt <= Date.now() ||
      !this.cachedKeys.keys.has(keyId)
    )
      await this.refreshVerificationKeys();
    const key = this.cachedKeys?.keys.get(keyId);
    if (!key)
      throw new UnauthorizedException("AdMob SSV signing key is not trusted");
    return key;
  }

  private async refreshVerificationKeys() {
    const response = await fetch(ADMOB_VERIFICATION_KEYS_URL);
    if (!response.ok)
      throw new UnauthorizedException(
        "Unable to load AdMob SSV verification keys",
      );
    const body = (await response.json()) as AdMobVerificationKeyResponse;
    const keys = new Map<number, KeyObject>();
    for (const entry of body.keys ?? []) {
      if (!Number.isSafeInteger(entry.keyId)) continue;
      try {
        const key = entry.pem
          ? createPublicKey(entry.pem)
          : entry.base64
            ? createPublicKey({
                key: Buffer.from(entry.base64, "base64"),
                format: "der",
                type: "spki",
              })
            : undefined;
        if (key) keys.set(entry.keyId, key);
      } catch (error) {
        this.logger.warn(
          `Ignoring invalid AdMob SSV verification key ${entry.keyId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (!keys.size)
      throw new UnauthorizedException(
        "AdMob returned no usable SSV verification keys",
      );
    this.cachedKeys = { expiresAt: Date.now() + KEY_CACHE_TTL_MS, keys };
  }

  private decodeBase64Url(value: string) {
    const normalized = value
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Buffer.from(normalized, "base64");
  }
}
