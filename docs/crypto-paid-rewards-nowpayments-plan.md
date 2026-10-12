# SMARTS Crypto Paid Rewards with NOWPayments

## Status and scope

Implementation specification only. This document does not implement the feature or change backend/mobile code.

Target repositories:

- Backend: `/home/aland/Documents/GitHub/nestjs-railway-starter`
- Flutter mobile app: `/home/aland/Documents/GitHub/smarts/smarts`

The feature adds a **Crypto** tab to the existing rewards experience. A player chooses a GLD amount, selects `USDT` or `USDC` on the Solana network, validates a destination address, sees the server-calculated payout quote, and submits a request for system-admin approval. After approval, the backend sends the payout through NOWPayments and tracks it until a final provider status is reached.

This plan intentionally keeps crypto payouts separate from the existing redeem-code paid reward flow. The current `PaidRewardRequest` and its `FULFILLED`/`REFUSED` lifecycle are designed for inventory/redeem-code rewards; they must not be overloaded with an asynchronous external crypto payout lifecycle.

## Important product and provider decisions

### The payout direction

This is an outbound payout from the SMARTS treasury/NOWPayments balance to a player wallet:

```text
Player GLD wallet
        │
        │ GLD is held/debited after a valid request
        ▼
SMARTS crypto payout request
        │
        │ system administrator approves
        ▼
NOWPayments Mass Payouts API
        │
        ▼
USDT-Solana or USDC-Solana
        │
        ▼
Player's Solana destination address
```

Do not use `create_payment`, `create_invoice`, or a NOWPayments deposit address for this feature. Those APIs are for collecting money from a payer. SMARTS needs the payout/mass-payout endpoints.

NOWPayments currently documents mass payouts as suitable for rewards and advertises zero service fee for payouts, but the actual provider/network fee must be requested immediately before sending. The backend must never hard-code a Solana gas amount or assume the provider fee is zero. See the current [NOWPayments pricing](https://nowpayments.io/pricing/) and [Mass Payouts documentation](https://nowpayments.io/mass-payouts/).

### Supported assets and network

Version 1 supports exactly:

| Player choice | NOWPayments currency code | Network | Destination format |
|---|---|---|---|
| USDT | `USDTSOL` | Solana mainnet | Solana address |
| USDC | `USDCSOL` | Solana mainnet | Solana address |

The public supported-coins page currently lists both [Tether on Solana](https://nowpayments.io/supported-coins) and [USD Coin on Solana](https://nowpayments.io/supported-coins). Availability, minimum withdrawal amount, balance, and payout fees remain account/provider state and must be checked dynamically.

The mobile UI should display `USDT on Solana` and `USDC on Solana`, not merely `USDT` or `USDC`, to prevent a player from sending funds to the wrong network.

### GLD accounting policy

The user-facing amount is the total GLD the player wants to spend. The backend calculates the net stablecoin payout after fees.

System administration configures a fixed-point conversion rate for each supported asset, initially:

```text
1 USDTSOL = N GLD
1 USDCSOL = N GLD
```

The default policy should allow the same rate for both stablecoins but store two explicit asset records so an administrator can change them independently later. The rate is snapshotted into every request and is never reconstructed from the current rate after submission.

The quote must show, separately:

- GLD selected by the player;
- stablecoin gross equivalent using the locked admin rate;
- platform fee, if enabled;
- NOWPayments estimated payout/network fee;
- net stablecoin amount expected to reach the player;
- current provider minimum payout;
- available NOWPayments balance/currency health, without exposing treasury secrets;
- quote expiry and a non-guaranteed processing-time estimate.

Recommended initial calculation:

```text
grossCrypto = gldSpend / configuredGldPerStablecoin
platformFeeCrypto = grossCrypto * configuredPlatformFeeBps
providerFeeCrypto = NOWPayments fee estimate for the selected currency/amount
netCrypto = grossCrypto - platformFeeCrypto - providerFeeCrypto
```

The final rounding mode, decimal precision, and fee payer must be defined in one backend pricing service. Use decimal/fixed-point arithmetic, never JavaScript floating-point arithmetic. Reject a quote if `netCrypto` is below the current provider minimum or below SMARTS's configured safety minimum.

If a provider fee is returned in a different currency or as a batch-level fee, preserve the provider response and normalize it into the quote before showing it. Do not silently treat an unavailable fee estimate as zero.

### GLD hold policy

GLD must be protected from being spent twice while an administrator reviews a request. At request creation, atomically place the requested GLD into a crypto-payout hold or debit it into a dedicated pending-payout ledger entry. The player UI must show the amount as held and the available balance must exclude it.

- Approval consumes the hold as the final GLD debit.
- Refusal, expiry, cancellation, or a provider-confirmed final failure releases the hold exactly once.
- A provider timeout or non-final `failed` state must not automatically refund and retry, because NOWPayments may resume processing.
- A payout request must never cause two provider payouts for the same request.

If the current wallet ledger cannot represent holds, add a dedicated hold/reservation model and make all GLD spend checks subtract active holds. Do not rely only on a `gldHeldAmount` field that other wallet transactions cannot see.

## Existing SMARTS integration points

The implementation should reuse:

- Prisma `Wallet`, `WalletBalance`, and `WalletTransaction` as the GLD financial source of truth;
- `DebitWalletTransaction`, credit/reversal transactions, and idempotency helpers;
- `FraudService` reward eligibility checks;
- GLD policy/configuration and treasury health controls;
- system-admin authentication, audit records, outbox notifications, and admin routes;
- the existing commerce/rewards API client and `RewardsProvider` in Flutter;
- the current `RewardsScreen`, which already uses tabs for Rewards, Cosmetics, and Inventory;
- the existing Railway HTTP service/repository/dependency-injection patterns.

Existing `PaidRewardRequest` remains available for gift-card/redeem-code rewards. The crypto flow should use a new `CryptoPayoutRequest` aggregate and a crypto-specific service/adapter.

## NOWPayments account and provider setup

Complete these steps in the NOWPayments account before implementation testing.

### 1. Create the merchant/provider account

1. Create or select the SMARTS business account.
2. Complete the provider's account, business, KYC/AML, and supported-territory requirements.
3. Activate the custody/balance capability required for the chosen payout API, or configure the approved source balance according to NOWPayments' current account model.
4. Fund the payout balance with both `USDTSOL` and `USDCSOL` for sandbox and controlled production tests.
5. Record the provider account ID and environment separately for sandbox and production.

Do not place a large treasury in the provider before small controlled payouts, reconciliation, support, and final-failure/refund handling have been proven.

### 2. Create credentials and secure them

Generate the NOWPayments API key and IPN secret. Mass payout operations may additionally require an authenticated provider JWT, depending on the current account/API flow. The backend adapter must follow the current API documentation/official SDK for obtaining and refreshing that short-lived JWT.

Store secrets only in Railway secret variables or an equivalent secret manager:

- API key;
- IPN secret key;
- provider account email/service-account credential if the payout JWT flow requires it;
- optional payout 2FA/TOTP secret only if fully automatic verification is deliberately approved;
- any provider-specific custody credentials.

Never put any of these values in Flutter, the mobile config endpoint, source control, logs, analytics, audit metadata, or error messages.

### 3. Configure payout security

Configure the strongest controls supported by the provider:

- API/IP restrictions;
- provider payout address controls or whitelist, if compatible with player-supplied destination addresses;
- two-factor authentication for payouts;
- dedicated payout account/balance rather than the highest-value treasury balance;
- provider notifications and support contacts;
- separate sandbox and production credentials.

Railway outbound IP addresses may not be stable under every deployment arrangement. If NOWPayments requires IP allowlisting, verify Railway's actual egress behavior and use a stable egress/NAT solution where necessary. Do not assume the application container's public address is permanent.

For automatic post-approval verification, choose one explicit policy:

1. **Preferred initial policy:** approval creates the provider payout and moves the request to `AWAITING_PROVIDER_VERIFICATION` if NOWPayments requires a human 2FA code. An authorized operator completes verification from the protected admin operation.
2. **Controlled automation:** store a dedicated provider TOTP secret in a vault/Railway secret, restrict its use to the payout worker, monitor it, rotate it, and document the operational recovery path.

The implementation must not assume that creating a payout means the payout has been sent. It must handle the provider's verification requirement and distinguish batch creation from verification and blockchain completion.

### 4. Configure IPN/webhooks

Configure a public HTTPS callback such as:

```text
POST /webhooks/nowpayments/payouts
```

The endpoint must be reachable from NOWPayments and must accept payout status callbacks. Localhost cannot be used for provider callbacks; use a deployed test endpoint or a secure tunnel for development.

The attached API material states that NOWPayments sends the `x-nowpayments-sig` header and signs a recursively key-sorted JSON body with HMAC-SHA512. The implementation must:

1. capture the raw request body and signature header;
2. parse JSON only after enforcing request-size and content-type limits;
3. recursively sort object keys exactly as required by the provider;
4. serialize with the provider-compatible JSON rules;
5. calculate HMAC-SHA512 using the IPN secret;
6. compare signatures in constant time;
7. reject invalid signatures without changing any request;
8. deduplicate callbacks by provider event/request identity and status transition;
9. acknowledge valid callbacks quickly and process state changes through an idempotent worker.

Do not trust a callback because it contains a familiar payout ID. Signature verification is mandatory.

## Configuration contract

Use the existing backend configuration module and Railway environment management. Proposed names:

```text
NOWPAYMENTS_ENABLED=false
NOWPAYMENTS_ENVIRONMENT=sandbox
NOWPAYMENTS_API_BASE_URL=https://api-sandbox.nowpayments.io/v1
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_ACCOUNT_EMAIL=
NOWPAYMENTS_ACCOUNT_PASSWORD=
NOWPAYMENTS_IPN_SECRET=
NOWPAYMENTS_PAYOUT_2FA_TOTP_SECRET=
NOWPAYMENTS_AUTO_VERIFY_PAYOUTS=false
NOWPAYMENTS_REQUEST_TIMEOUT_MS=10000
NOWPAYMENTS_MAX_RETRIES=2
NOWPAYMENTS_IPN_PUBLIC_URL=
NOWPAYMENTS_SUPPORTED_CURRENCIES=USDTSOL,USDCSOL
NOWPAYMENTS_MAX_PAYOUT_AMOUNT_USD=
NOWPAYMENTS_MIN_BALANCE_BUFFER_USD=

CRYPTO_REWARDS_ENABLED=false
CRYPTO_REWARDS_NETWORK=SOLANA
CRYPTO_REWARDS_PLATFORM_FEE_BPS=0
CRYPTO_REWARDS_QUOTE_TTL_SECONDS=300
CRYPTO_REWARDS_MAX_QUOTE_DRIFT_BPS=500
CRYPTO_REWARDS_MIN_GLD=
CRYPTO_REWARDS_MAX_GLD_PER_REQUEST=
CRYPTO_REWARDS_DAILY_GLD_LIMIT=
CRYPTO_REWARDS_MAX_PENDING_PER_USER=1
CRYPTO_REWARDS_HOLD_EXPIRY_HOURS=72
CRYPTO_REWARDS_MIN_PROCESSING_RESERVE_USD=
CRYPTO_REWARDS_REQUIRE_ADMIN_APPROVAL=true
CRYPTO_REWARDS_ALLOWED_COUNTRIES=
CRYPTO_REWARDS_BLOCKED_COUNTRIES=
```

Requirements:

- `NOWPAYMENTS_ENABLED` and `CRYPTO_REWARDS_ENABLED` are independent kill switches.
- Sandbox and production use separate credentials and callback URLs.
- The backend fails closed when a required secret, base URL, supported currency, IPN URL, or GLD rate is missing.
- The mobile app receives only non-secret feature/configuration data: enabled state, supported currency display names, network, limits, and quote precision.
- The provider account password and TOTP secret must not be loaded into request DTOs or serialized configuration objects.

## Data model proposal

### `CryptoPayoutRequest`

Add a dedicated aggregate, with exact naming adapted to the project's Prisma conventions:

```text
id
userId
status
requestKey / idempotencyKeyId
currencyCode                 // USDTSOL or USDCSOL
networkCode                  // SOLANA
destinationAddressCiphertext
destinationAddressHash       // lookup/fingerprint, not reversible
destinationAddressMasked
addressValidatedAt
addressValidationProvider
addressValidationCode

gldRequested
gldHeld
gldReleased
gldCharged
gldRatePerStablecoinSnapshot
gldRateVersion
platformFeeBpsSnapshot
platformFeeCrypto
providerFeeCrypto
providerFeeCurrency
grossCryptoAmount
netCryptoAmount
quoteExpiresAt
quoteSnapshot

providerName                 // NOWPayments
providerEnvironment
providerUniqueExternalId
providerBatchWithdrawalId
providerPayoutId
providerStatus
providerStatusRaw
providerErrorCode
providerErrorMessageRedacted
transactionHash
providerCreatedAt
providerUpdatedAt

adminDecision
adminId
adminNote
requestedAt
approvedAt
rejectedAt
submittedAt
completedAt
failedAt
holdExpiresAt
createdAt
updatedAt
```

Recommended constraints and indexes:

- unique `requestKey`/idempotency scope per player;
- unique `providerUniqueExternalId`;
- unique nullable `providerPayoutId`;
- unique nullable `providerBatchWithdrawalId`;
- index `(userId, createdAt)`;
- index `(status, createdAt)`;
- index `(providerStatus, updatedAt)`;
- index `(destinationAddressHash, currencyCode)` only if support/reconciliation needs it.

Do not store a destination address in plaintext unless the privacy/security review explicitly accepts it. If the provider requires it later, decrypt only inside the payout adapter. Do not store full provider response bodies indefinitely; keep a redacted status snapshot and provider IDs.

### GLD holds and ledger entries

Use a dedicated `CryptoPayoutHold` or equivalent ledger reservation with:

- `requestId` unique;
- `userId`, currency code `GLD`, amount;
- `status`: `HELD`, `CONSUMED`, `RELEASED`, `EXPIRED`;
- the wallet transaction IDs for hold/debit/reversal;
- created/released/consumed timestamps;
- idempotency keys.

The hold must be visible to balance/available-balance calculations and must be released only through an idempotent transaction. Every GLD movement must remain in the wallet ledger; a request-row number alone is not a financial record.

### Status state machine

Use stable internal statuses instead of exposing provider strings directly:

```text
QUOTED
PENDING_ADMIN_APPROVAL
REJECTED
EXPIRED
ADDRESS_INVALID
APPROVED
SUBMITTING
AWAITING_PROVIDER_VERIFICATION
CREATED
WAITING
PROCESSING
SENDING
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
REFUND_PENDING
REFUNDED
RECONCILIATION_REQUIRED
```

Provider statuses should be normalized as follows:

| NOWPayments status | SMARTS status | Final? |
|---|---|---:|
| `creating` | `SUBMITTING` or `CREATED` | No |
| `waiting` | `WAITING` | No |
| `processing` | `PROCESSING` | No |
| `sending` | `SENDING` | No |
| `finished` | `COMPLETED` | Yes |
| `failed` | `FAILED_RETRYABLE` or `RECONCILIATION_REQUIRED` | Usually no |
| `rejected` | `FAILED_FINAL` | Yes |

The provider documentation states that `finished` and `rejected` are final, while `failed` may be resumed. Never create a replacement payout while the original payout is non-final.

## Backend implementation plan

### Phase 1 — Provider adapter

Create a dedicated `NowPaymentsPayoutAdapter` behind an interface such as `CryptoPayoutProvider`.

The adapter must expose typed operations for:

```text
getApiStatus()
getSupportedCurrencies()
getPayoutBalance()
validatePayoutAddress(address, currency)
getMinimumPayoutAmount(currency)
getPayoutFeeEstimate(currency, amount)
createPayout(batch, idempotency/external ID)
verifyPayout(batchWithdrawalId, verificationCode)
getPayoutStatus(payoutId)
listPayouts(filters)
verifyAndNormalizeIpn(rawBody, signature)
```

Use the provider's current API docs/official SDK to confirm request and response field names immediately before coding. The current documented/SDK endpoint mapping is:

```text
GET  /v1/status
GET  /v1/full-currencies
GET  /v1/balance
POST /v1/payout/validate-address
GET  /v1/payout/fee
GET  /v1/payout-withdrawal/min-amount/{coin}
POST /v1/payout
POST /v1/payout/{batch-withdrawal-id}/verify
GET  /v1/payout/{payout-id}
GET  /v1/payout
```

The payout creation request should contain one withdrawal for V1 and a deterministic provider-side external ID tied to the SMARTS request. The adapter should support batching later, but V1 must not batch unrelated players unless reconciliation is designed for individual child payouts.

Payout creation requires careful handling of provider authentication:

- send the API key in the required header;
- obtain/cache the short-lived Bearer JWT if the current payout endpoints require it;
- refresh once after an authentication expiry response;
- never retry a payout creation blindly after a network timeout;
- use the stored external ID and provider lookup to determine whether the request was created before attempting recovery.

### Phase 2 — Quote and address validation

Add a quote service that performs all calculations server-side.

Quote sequence:

1. Confirm feature flags, player status, fraud eligibility, GLD balance, active holds, per-player limits, and system payout health.
2. Validate currency is exactly `USDTSOL` or `USDCSOL` and network is exactly `SOLANA`.
3. Validate the address locally as a canonical Solana base58 public key. This is only a fast input check, not final provider validation.
4. Call NOWPayments address validation for the selected currency.
5. Fetch the current minimum payout amount.
6. Fetch the current payout fee estimate for the computed amount.
7. Fetch or verify the provider balance and configured reserve buffer.
8. Calculate gross amount, platform fee, provider fee, net amount, rounding, and total GLD hold.
9. Reject if the resulting net amount is below the dynamic minimum or if provider balance cannot cover the payout plus fee.
10. Return a quote with a short expiry and a quote ID; never accept client-submitted fee values or crypto amounts as authoritative.

The quote must identify fee uncertainty clearly. A fee estimate is not a guarantee, and the final provider quote may change before admin approval. The UI must show a `refresh quote` path rather than presenting stale fee data as final.

### Phase 3 — Player request and GLD hold

Add authenticated endpoints:

```text
GET  /crypto-rewards/config
POST /crypto-rewards/addresses/validate
POST /crypto-rewards/quote
POST /crypto-rewards/requests
GET  /crypto-rewards/requests
GET  /crypto-rewards/requests/:requestId
POST /crypto-rewards/requests/:requestId/cancel
```

Request body should contain only:

```json
{
  "currencyCode": "USDCSOL",
  "networkCode": "SOLANA",
  "destinationAddress": "<solana-address>",
  "gldAmount": "1000",
  "quoteId": "<server-quote-id>",
  "idempotencyKey": "<unique-client-key>",
  "acknowledged": true
}
```

The backend must:

1. verify the quote belongs to the player, is unexpired, and matches address/currency/network/GLD amount;
2. revalidate the destination address and all player eligibility rules;
3. lock the player's GLD balance/hold row and prevent concurrent spend races;
4. create the crypto request and hold exactly once under the idempotency key;
5. write a player audit event without storing the full address;
6. notify the player that the request is pending administrator approval;
7. return the request and masked destination address.

The cancellation endpoint is available only while the request has not been approved/submitted. After provider submission, cancellation is not promised.

### Phase 4 — System-admin review and approval

Add a Crypto section or tab in the existing system-admin Rewards area. It should show:

- request ID and created time;
- player ID/display name and account risk/status;
- GLD requested and held;
- admin rate/version snapshot;
- currency/network;
- masked destination address and address validation time;
- gross amount, platform fee, provider fee estimate, and net payout;
- quote expiry and any provider drift;
- current NOWPayments balance/health summary;
- prior crypto requests, limits, blocks, and suspicious activity flags;
- provider status, payout IDs, transaction hash, and redacted error reason.

Admin actions:

```text
approve
reject/refund
mark for manual reconciliation
retry only when the provider status is final and the retry policy allows it
```

Approval must be idempotent and protected by row locking. It must re-check:

- the player is still active and eligible;
- the hold still exists and has not expired;
- the address is still valid;
- the quote/rate/fee drift is inside policy;
- the provider asset is available;
- the provider balance and reserve buffer are sufficient;
- no provider payout already exists for this request.

If the fee or minimum changed materially, move the request to `RECONCILIATION_REQUIRED` or `REQUOTE_REQUIRED` rather than sending a materially different amount silently.

### Phase 5 — Provider submission

After approval, call the adapter outside the database transaction, using a persisted `providerUniqueExternalId` before the network call. This prevents a process restart from generating a new identity for the same payout.

Safe sequence:

1. Transaction: lock request, confirm `APPROVED`, generate/store external ID, move to `SUBMITTING`.
2. Provider call: validate address/minimum/fee and create the single-withdrawal payout.
3. Transaction: store batch ID, payout ID, provider response fields, and move to `CREATED`/`AWAITING_PROVIDER_VERIFICATION`.
4. If verification is required, complete only through the configured secure policy and store verification result.
5. If the network call times out, do not create a new payout. Reconcile by external ID/provider list/status before retrying.
6. Emit an outbox event for status notifications and operational metrics.

The provider's payout API may use a batch withdrawal ID for verification and a child payout ID for individual status. Store both and never confuse them.

### Phase 6 — IPN, polling, and reconciliation

Use signed IPN callbacks as the primary status signal and scheduled provider polling as a repair mechanism.

IPN handler:

1. Verify HMAC-SHA512 signature before parsing business state.
2. Map provider payout/batch IDs to one SMARTS request.
3. Reject mismatched currency, address fingerprint, amount, or external ID.
4. Ignore duplicate or older status transitions.
5. Persist the redacted callback/status snapshot.
6. Update the state machine idempotently.
7. On `finished`, store the transaction hash and consume the GLD hold exactly once.
8. On `rejected`, release/refund the hold exactly once and notify the player.
9. On `failed`, keep the request non-final until provider/support reconciliation determines whether it will resume.

The reconciliation worker should find requests in non-final states, poll with bounded backoff, alert on stale payouts, and compare the provider list with SMARTS records. It must not auto-create a second payout for an ambiguous original request.

### Phase 7 — Refunds and failure handling

Define these outcomes explicitly:

- address invalid before approval: no payout, release hold, player may create a corrected request;
- admin rejects: release hold and notify player;
- provider rejects before sending: release hold after verified final status;
- provider timeout: keep hold and reconcile, do not duplicate;
- provider `failed`: follow provider/manual recovery policy; do not assume final;
- provider `finished`: mark completed, keep GLD consumed, store hash;
- SMARTS callback outage: provider polling repairs state;
- SMARTS database outage after provider success: reconciliation must find the provider payout and complete the local record.

Every release/refund needs an idempotency key such as `crypto-payout-refund:{requestId}` and an audit record. A payout that has reached `finished` must never be refunded automatically because the blockchain transfer is irreversible.

## Backend API contract

### Public/authenticated config

```json
{
  "enabled": true,
  "network": "SOLANA",
  "currencies": [
    { "code": "USDTSOL", "symbol": "USDT", "network": "Solana" },
    { "code": "USDCSOL", "symbol": "USDC", "network": "Solana" }
  ],
  "minGld": "100",
  "maxGldPerRequest": "100000",
  "dailyGldLimit": "200000",
  "requiresAdminApproval": true
}
```

Do not return API keys, provider balance details, internal fee secrets, or provider credentials.

### Quote response

```json
{
  "quoteId": "quote_...",
  "currencyCode": "USDCSOL",
  "networkCode": "SOLANA",
  "gldAmount": "1000",
  "gldRatePerStablecoin": "100",
  "grossCryptoAmount": "10.000000",
  "platformFeeCrypto": "0.000000",
  "providerFeeCrypto": "0.010000",
  "providerFeeCurrency": "USDCSOL",
  "netCryptoAmount": "9.990000",
  "minimumPayoutAmount": "1.000000",
  "estimatedProcessingTimeText": "Usually seconds to minutes; not guaranteed",
  "expiresAt": "2026-10-12T12:05:00.000Z",
  "address": { "valid": true, "network": "SOLANA" }
}
```

Numbers are strings. The backend remains authoritative for all arithmetic.

### Player request response

```json
{
  "id": "uuid",
  "status": "PENDING_ADMIN_APPROVAL",
  "currencyCode": "USDCSOL",
  "networkCode": "SOLANA",
  "destinationAddressMasked": "7G...xQ",
  "gldRequested": "1000",
  "gldHeld": "1000",
  "netCryptoAmount": "9.990000",
  "providerFeeCrypto": "0.010000",
  "requestedAt": "2026-10-12T12:00:00.000Z",
  "holdExpiresAt": "2026-10-15T12:00:00.000Z"
}
```

### Player status codes

Expose stable SMARTS statuses and localize them in Flutter. Do not expose raw provider errors as user-facing text.

```text
PENDING_ADMIN_APPROVAL
APPROVED
AWAITING_PROVIDER_VERIFICATION
PROCESSING
SENDING
COMPLETED
REJECTED
REFUNDED
FAILED_RETRYABLE
RECONCILIATION_REQUIRED
EXPIRED
```

## Flutter mobile implementation plan

### Phase 1 — Rewards tab integration

Extend the existing `RewardsScreen` tab set with a fourth tab:

```text
Rewards | Cosmetics | Inventory | Crypto
```

Keep the current store/inventory behavior unchanged. The Crypto tab should use existing balance and loading patterns, not call NOWPayments directly.

The Crypto tab contains:

1. Available GLD balance and amount currently held by pending crypto requests.
2. Currency selector: USDT / USDC.
3. Fixed network display: Solana.
4. Solana address field with paste support, clear action, and validation result.
5. GLD amount field and slider capped by server-provided limits and available balance.
6. Quote breakdown with gross amount, every fee, net amount, minimum, expiry, and timing disclaimer.
7. Confirmation explaining that blockchain transfers are irreversible and the player is responsible for the destination address.
8. Pending/admin-review state.
9. Request history with status, masked address, amount, fee snapshot, and transaction hash link when available.

The app must not show a fake “sent” state after submitting a request. It should show administrator review, provider processing, completion, rejection, and refund states separately.

### Phase 2 — Mobile architecture

Add layers following current SMARTS conventions:

- `CryptoRewardRepository` interface;
- `RailwayCryptoRewardService` for authenticated API calls;
- typed config, quote, request, status, and history models;
- `CryptoRewardsProvider` or an extension of the existing `RewardsProvider`;
- dependency-injection registration and test doubles;
- localized status/error strings.

Suggested client methods:

```text
getCryptoRewardConfig()
validateSolanaAddress(address, currencyCode)
getCryptoRewardQuote(currencyCode, address, gldAmount)
createCryptoRewardRequest(quoteId, address, gldAmount, idempotencyKey)
listCryptoRewardRequests()
getCryptoRewardRequest(requestId)
cancelCryptoRewardRequest(requestId)
```

The mobile client must send a GLD amount and quote ID, not a provider fee or crypto amount. It must refresh the quote before confirmation if the quote expires.

### Phase 3 — Address UX and safety

Before enabling submit:

- require a syntactically valid Solana address;
- require successful backend/NOWPayments validation for the selected token;
- show the network and asset in the confirmation text;
- show the first/last characters of the address and a copy action;
- require explicit acknowledgement;
- never silently change `USDTSOL` to `USDCSOL` or another network;
- do not store a wallet address in local analytics or crash logs;
- clear sensitive address input from transient UI state after request completion where practical.

Address validation means “accepted by the configured provider for this payout currency”; it is not a guarantee that the player controls the destination or that a token account will remain able to receive funds later.

### Phase 4 — Notifications and refresh

After request creation:

- refresh the GLD wallet/balance provider so the hold is visible;
- refresh crypto request history;
- subscribe to the existing notification/event refresh pattern if available;
- support manual refresh and polling while the detail screen is open;
- avoid frequent background polling from every rewards rebuild.

When completed, show the provider transaction hash and an external Solana explorer link only after validating/allowlisting the hash format. When rejected or refunded, show the reason category and restored GLD amount.

## System-admin configuration and UI

Add a Crypto Rewards section to the existing system-admin Rewards area.

### Configuration fields

- feature enabled/paused;
- supported currencies, initially USDT-Solana and USDC-Solana;
- GLD-per-stablecoin rate for each asset;
- rate version/effective time and change reason;
- platform fee basis points;
- minimum and maximum GLD per request;
- daily/per-player limits;
- quote lifetime and maximum fee drift;
- pending hold expiry;
- minimum treasury/provider reserve;
- approval requirement;
- allowed/blocked regions and account eligibility;
- sandbox/live environment indicator;
- payout verification mode;
- emergency disable and reconciliation mode.

Every rate, fee, limit, enable/disable, and approval change must write an admin audit event with old/new values and reason.

### Admin queue actions

The queue should support filters for pending, processing, completed, rejected, failed, and reconciliation-required requests. Approval and rejection must use the existing system-admin guard and audit conventions, and sensitive addresses must be masked by default.

For high-value payouts, add an optional two-person approval threshold. The provider payout should not be submitted until both required decisions are recorded.

## Security, fraud, privacy, and compliance

- Never trust GLD balance, rate, fee, crypto amount, minimum, or address validation from Flutter.
- Never call NOWPayments directly from the mobile app.
- Never expose provider credentials or IPN secrets.
- Encrypt destination addresses at rest; hash/fingerprint for lookup and deduplication.
- Redact addresses and transaction details from analytics and normal logs.
- Apply `FraudService` checks, account-age/activity rules, rate limits, velocity limits, device/IP signals, and suspicious-request review.
- Block duplicate active requests and replayed idempotency keys.
- Use constant-time IPN signature comparison and request-size limits.
- Restrict payout-worker permissions to only the needed provider secrets and database operations.
- Require a final provider status before releasing a hold or retrying.
- Do not auto-refund a completed blockchain payout.
- Use exact decimal arithmetic and record every rate/fee snapshot.
- Define retention and deletion rules for wallet addresses, provider IDs, audit logs, and transaction hashes.
- Complete a legal/compliance review for crypto rewards, KYC/AML, sanctions, age restrictions, tax reporting, money-transmission exposure, gambling/reward regulation, and supported countries before production.
- Update Terms of Service, privacy policy, crypto payout risk disclosure, and support procedures.

## Testing plan

### Backend unit tests

- GLD/stablecoin fixed-point conversions and rounding;
- platform/provider fee calculations;
- minimum payout rejection;
- quote expiry and fee drift;
- address validation success/failure and currency mismatch;
- insufficient available GLD after active holds;
- duplicate request/idempotency behavior;
- concurrent requests cannot overspend GLD;
- admin approve/reject row locking;
- duplicate approval cannot create two payouts;
- wrong provider currency/address/amount is rejected;
- invalid IPN signature is rejected;
- valid duplicate IPN is harmless;
- older status cannot overwrite newer status;
- `failed` does not trigger premature refund;
- `finished` consumes the hold exactly once;
- `rejected` releases the hold exactly once;
- network timeout does not create a blind duplicate;
- reconciliation repairs local state after provider success/database failure;
- provider credential/token values never reach logs or audit metadata.

### Provider sandbox tests

Use the NOWPayments sandbox where the selected payout endpoints and assets are available. Verify:

1. API status and supported currency checks.
2. `USDTSOL` and `USDCSOL` balance/availability.
3. dynamic minimum amount for both assets.
4. payout fee estimate for several amounts.
5. Solana address validation for valid, invalid, wrong-network, and token-incompatible inputs.
6. one payout creation with a deterministic external ID.
7. payout verification/2FA path.
8. IPN signature verification and repeated callbacks.
9. waiting → processing → sending → finished state transitions.
10. rejection/failure/reconciliation behavior.

The exact sandbox support must be confirmed from the current provider account; never assume that a production asset or payout feature behaves identically in sandbox.

### Flutter tests

- crypto tab renders with feature disabled/enabled;
- slider and text field remain synchronized;
- amounts are formatted without floating-point drift;
- USDT/USDC and Solana labels are unambiguous;
- invalid address blocks submit;
- changing currency revalidates the address and quote;
- expired quote requires refresh;
- confirmation displays all fees and net amount;
- idempotent retry does not create duplicate requests;
- pending/processing/completed/rejected/refunded states render correctly;
- completed state displays transaction hash safely;
- wallet balance refreshes after hold/refund/completion;
- provider/API errors are localized and do not expose raw credentials or payloads.

## Rollout sequence

### Stage 0 — Legal, provider, and treasury readiness

- Confirm crypto-reward legality and supported countries.
- Complete NOWPayments account/KYC/AML requirements.
- Configure sandbox account, API credentials, IPN, 2FA, and payout security.
- Confirm exact current `USDTSOL`/`USDCSOL` support, minimums, fees, and address validation behavior.
- Publish terms, privacy, refund, address-risk, and crypto disclosure text.

### Stage 1 — Backend dark launch

- Deploy schema/configuration with both feature flags disabled.
- Run provider health/minimum/fee/address checks without creating payouts.
- Test quote, hold, rejection, expiry, and reconciliation paths with mocked provider responses.

### Stage 2 — Sandbox end-to-end

- Enable the feature only for internal SMARTS accounts.
- Use small sandbox balances and test addresses.
- Verify admin approval, provider verification, callbacks, polling, refund, and transaction-hash display.

### Stage 3 — Controlled production pilot

- Fund only a small production payout balance.
- Start with a low per-player and global daily limit.
- Require manual admin approval for every request.
- Run controlled `USDTSOL` and `USDCSOL` payouts across the supported amount range.
- Record quoted fee, actual deducted fee, received amount, time, provider status, and hash.

### Stage 4 — Gradual availability

- Increase limits only after reconciliation and support metrics are healthy.
- Keep independent kill switches for new requests and provider submission.
- Retain manual approval until duplicate, fraud, provider-failure, and refund rates are understood.
- Review provider/API changes before every integration upgrade.

## Definition of done

- Crypto tab is available in the existing rewards screen without breaking current tabs.
- Players can choose USDT-Solana or USDC-Solana and no other network.
- Solana destination addresses are validated locally and by NOWPayments.
- Server-generated quotes show GLD conversion, platform fee, provider/network fee, net payout, minimum, and timing disclaimer.
- GLD is held atomically and cannot be spent twice while a request is pending.
- System administrators can approve/reject, inspect, and reconcile crypto payout requests.
- Approval creates at most one provider payout for a request.
- NOWPayments payout verification, status polling, and signed IPN callbacks work.
- Provider statuses are normalized and shown safely to the player.
- Completed payouts store a transaction hash and consume GLD once.
- Final rejected/refunded payouts release GLD once.
- Ambiguous/non-final provider failures do not trigger duplicate payouts or premature refunds.
- Secrets, addresses, raw provider payloads, and IPN signatures are not leaked.
- Sandbox and small controlled production tests pass for both stablecoins.
- Legal/compliance, provider account, privacy, terms, support, and incident procedures are complete.

## Provider references

- [NOWPayments API documentation supplied for this plan](https://documenter.getpostman.com/view/7907941/2s93JusNJt)
- [NOWPayments development API](https://nowpayments.io/api)
- [NOWPayments Mass Payouts](https://nowpayments.io/mass-payouts/)
- [NOWPayments pricing](https://nowpayments.io/pricing/)
- [NOWPayments supported coins](https://nowpayments.io/supported-coins)
- [NOWPayments help and fee/minimum guidance](https://nowpayments.io/help)
- [NOWPayments official Node SDK payout endpoint mapping](https://github.com/NowPaymentsIO/nowpayments-sdk-nodejs)
- [NOWPayments service status](https://nowpayments.io/status-page)

Provider endpoints, supported assets, minimums, authentication requirements, fee behavior, and account controls can change. Before implementation, re-check the live documentation and the SMARTS NOWPayments account, then update this plan's endpoint/configuration contract if the provider dashboard or official SDK differs.
