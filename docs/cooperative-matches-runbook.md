# Cooperative matches operations runbook

## Rollout

Use the System Admin **Cooperative matches** policy page and enable flags in this order:

1. `cooperativePartyEnabled`
2. `cooperativeRandomEnabled` with `cooperativeBotFillEnabled` off
3. Bot fill after queue and score metrics are stable
4. `cooperativeRankedEnabled` for a small eligible cohort, with `cooperativeRewardsEnabled` on only after ledger checks pass

Keep `cooperativeRankedEnabled` off during a migration or settlement incident. Existing committed matches continue through the recovery worker; do not manually edit wallet balances.

## Health checks

- `GET /system-admin/api/cooperative/overview` for queue, live-match, and unreconciled debit counts.
- `GET /system-admin/api/cooperative/metrics?from=...&to=...` for random/ranked, settled, abandonment, and ledger totals.
- `GET /system-admin/api/cooperative/alerts` for active operational warnings.
- `GET /system-admin/api/cooperative/export?from=...&to=...&mode=RANKED` for an auditable history export.

## Settlement incident

1. Disable `cooperativeRankedEnabled` if failures or unreconciled operations are increasing.
2. Inspect the match in **Ranked operations & reconciliation** and verify the wallet transaction by its idempotency key.
3. Allow the settlement recovery worker to retry up to `settlementRetryLimit` times.
4. Use the audited `POST /system-admin/api/cooperative/settlements/:matchId/retry` action only after confirming the wallet ledger state.
5. Re-enable ranked queue only when failed attempts and open ledger operations return to zero.

All ranked entry debits, refunds, and payouts are idempotent. Never issue a manual GLD credit without recording the incident and preserving the original cooperative match id.

## Disconnects and confirmations

Found matches expire after `confirmationTimeoutSeconds` without all human confirmations. Started matches apply `disconnectGraceSeconds`; after that window the worker records a forfeit and finishes the match when no human participant remains pending.

## Load and socket checks

Before a wider rollout, exercise concurrent party creation, queue heartbeats, match confirmation, and reconnecting `subscribe_match` clients. Watch queue age, match-found acceptance, socket fan-out latency, worker error rate, and settlement failures. Keep the queue and matchmaker advisory-lock protected when running multiple Railway replicas.
