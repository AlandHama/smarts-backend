# SMARTS Analytics & Reporting Plan

## 1. Purpose

Build a dedicated, server-authoritative **Analytics & Reports** area in System Administration that explains the health of every major SMARTS feature:

- acquisition and registration
- authentication, sessions, and device activity
- gameplay, challenges, matches, and matchmaking
- player engagement, retention, and progression
- missions, achievements, levels, ranks, and streaks
- GLD economy, ads, gifts, purchases, and wallet movement
- friends, groups, chat, notifications, images, and voice messages
- support tickets, live support, and agent performance
- fraud, risk, moderation, and player reports
- storage, jobs, sockets, API, and platform health

The page must provide trustworthy, filterable, drill-down reporting rather than only summary counters. All financial, reward, moderation, and fraud reports must use backend/PostgreSQL data as the source of truth.

This document is a design and implementation plan only. It does not implement the feature.

---

## 2. Product goals

### Primary goals

1. Give administrators a fast daily view of what is happening in SMARTS.
2. Make trends and anomalies visible without querying PostgreSQL manually.
3. Allow every headline metric to open a detailed report behind it.
4. Support date ranges, comparison periods, UTC/local display time, dimensions, filters, and exports.
5. Make the reports useful for product decisions, economy control, support operations, and fraud investigations.
6. Keep expensive aggregation work away from player-facing request paths.
7. Preserve auditability: every report must show its definition, source time, filters, and refresh status.

### Non-goals for the first release

- Replacing PostgreSQL, Prisma, or the existing System Admin authentication.
- Sending raw player data to an external analytics provider by default.
- Exposing answer keys, private fraud signals, or sensitive support content to unauthorized administrators.
- Building a general-purpose SQL editor for administrators.

---

## 3. Admin navigation and page structure

Add a separate navigation item:

```text
Analytics & reports
├── Overview
├── Engagement
├── Gameplay & matchmaking
├── Progression & retention
├── Economy & monetization
├── Social & communications
├── Support operations
├── Fraud, risk & moderation
├── Platform health
├── Player explorer
├── Saved reports
├── Scheduled reports
└── Audit log
```

The default landing page is **Overview**. Each section should be independently addressable by URL so an administrator can bookmark or share a filtered report.

### Overview layout

1. Header with page title, last successful refresh, source badge, and report actions.
2. Global date range picker.
3. Comparison selector:
   - previous equivalent period
   - previous calendar period
   - custom comparison range
   - no comparison
4. Filter bar:
   - country/region
   - platform and app version
   - game/mode
   - ranked/casual
   - new/returning players
   - account status
   - risk level
5. KPI card grid with trend and target/alert state.
6. Engagement and gameplay trend charts.
7. Economy health and GLD flow charts.
8. Feature adoption grid.
9. Alerts and anomalies feed.
10. Recent operational events and report freshness warnings.

The visual direction should match the existing System Admin design: dark navy panels, purple primary controls, clear green/yellow/red status colors, compact but readable charts, responsive desktop layout, and accessible contrast.

---

## 4. Global reporting behavior

### Date and time

- Store and aggregate event timestamps in UTC.
- Default reporting timezone: UTC.
- Allow administrators to choose a display timezone without changing the underlying range.
- Presets: Today, Yesterday, Last 7 days, Last 14 days, Last 30 days, Last 90 days, This month, Previous month, This quarter, Year to date, All time, Custom.
- Date ranges must be inclusive and show the exact UTC boundaries in a tooltip.
- Use the same range semantics across all tabs.

### Comparison

Every compatible chart and KPI should support comparison with an equivalent previous period. Display:

- absolute change
- percentage change
- direction arrow
- insufficient-data state when the comparison is not meaningful

### Resolution

Allow automatic resolution or explicit Daily, Weekly, and Monthly resolution. Prevent overly granular queries for long ranges.

### Loading and data states

Every report must support:

- skeleton loading
- empty state with explanation
- partial-data warning
- stale-data badge
- failed widget retry
- last updated timestamp
- no-permission state

One failed chart must not blank the entire page.

### Drill-down

Clicking a KPI, chart point, legend item, or table row opens a detailed report with inherited filters. A visible breadcrumb and “Clear inherited filters” action must be provided.

### Export

Support:

- PNG/SVG chart export
- CSV for tabular reports
- JSON for machine-readable report data
- PDF summary export for selected reports
- background export jobs for large ranges

Exports must include report name, date range, timezone, filters, generated time, and data freshness. Export permissions must be separate from view permissions.

---

## 5. Core KPI catalog

All KPI definitions must have a stable key, a human-readable definition, a source query/aggregation, an owner, and a freshness target.

### Acquisition and player lifecycle

- total registered players
- new registrations
- verified accounts
- activation rate
- first-match conversion
- first-day, day-7, and day-30 retention
- returning players
- dormant/reactivated players
- deleted, suspended, deactivated, and restricted accounts
- registrations by country, platform, app version, and referral source
- referral invites, accepted referrals, and referral GLD cost

### Authentication and session health

- successful logins
- failed logins by reason
- refresh-token requests and failures
- sessions created, expired, revoked, and replaced by another device
- concurrent-device conflicts
- average session duration
- active devices
- app opens and crash/reconnect indicators
- system-admin login success/failure and active admin sessions

### Engagement

- DAU, WAU, and MAU
- stickiness: DAU/MAU
- sessions per player
- average and median session duration
- active days per player
- matches per active player
- challenge attempts per active player
- daily streak starts, maintained streaks, broken streaks, and milestone reaches
- notification delivery, open, and action rates
- feature adoption and repeat usage

### Gameplay and matchmaking

- matches created, joined, started, completed, settled, cancelled, and abandoned
- casual versus ranked volume
- random-match pool entries and matchmaking success rate
- queue wait time: p50, p75, p95, and maximum
- match completion rate
- disconnects and reconnects
- rematches and friend-invited matches
- games selected and mode popularity
- question/challenge attempts
- correct-answer rate, skip rate, and average answer time
- score distribution and match margin distribution
- ELO/rank movement and tier transitions
- suspicious result or impossible-time indicators

### Progression, missions, and achievements

- XP awarded by source
- levels reached and level distribution
- progression tier distribution
- ad reward bonus by progression tier
- mission views, starts, completions, claims, and expiry
- mission completion by mission key and period
- achievement family progress
- achievement tier completions and claims
- unclaimed reward backlog
- GLD and XP rewards by source
- progression events rejected or deduplicated

### Economy and monetization

- GLD opening balance and closing balance
- total GLD minted, burned, transferred, gifted, spent, refunded, and reversed
- net GLD emission
- GLD velocity and player balance distribution
- rewarded ads requested, loaded, started, completed, verified, rejected, and paid
- base ad reward, progression bonus, streak bonus, economy multiplier, final reward
- average ad reward per player and per verified impression
- daily/player emission-limit hits
- social gift purchases and receiver rewards
- purchases, refunds, failed payments, and purchase value
- revenue by product, platform, country, and period
- wallet ledger reconciliation differences
- economy alerts and policy-limit breaches

### Social, chats, and notifications

- friend requests sent, accepted, declined, cancelled, and expired
- current friendships and active friendships
- online presence and presence update health
- one-to-one chats created and active
- groups created, members added/removed, and active groups
- messages sent, delivered, read, failed, deleted, and expired
- unread messages and average response time
- message type distribution: text, image, voice, gift, GLD transfer, game invite, system event
- voice-message count, duration, bytes uploaded, bytes downloaded, playback starts, and retention deletions
- chat wallpaper selection and usage
- mute settings and notification delivery/open rates
- socket connections, reconnects, typing events, and presence latency
- chat reports, blocked users, and moderation actions

### Support center

- tickets opened, assigned, first responded, resolved, closed, reopened, and expired
- ticket backlog and SLA breaches
- first-response and resolution-time percentiles
- tickets by category, priority, status, language, and platform
- live-chat sessions started, queued, accepted, abandoned, ended, and refunded
- live-chat wait time and agent response time
- GLD live-chat charges, refunds, and billing failures
- support-agent workload, availability, response quality, and resolution rate
- help-article views, searches, helpful votes, and deflection rate
- restricted-player support access and escalation activity

### Fraud, risk, and moderation

- risk events by type and severity
- players entering each risk band
- triggered rules and rule hit rate
- false-positive review rate
- blocked, challenged, quarantined, and approved activity
- suspicious ads, purchases, wallet transfers, gifts, matches, and chat behavior
- player reports opened, triaged, resolved, dismissed, and escalated
- moderation action counts and reversal rates
- duplicate-device/account clusters
- chargeback and refund risk
- average investigation time
- unresolved high-risk queue

### Platform and operational health

- API requests, latency, p50/p95/p99, and error rate
- errors by endpoint, status code, feature, and app version
- WebSocket connection count and event latency
- queue depth and job failures
- migration/deployment status
- push notification provider success/failure
- storage object count, bytes, upload failures, and deletion backlog
- database query latency and slow-report count
- scheduled report success/failure
- analytics event ingestion lag and dropped/invalid events

---

## 6. Report pages and charts

### 6.1 Engagement report

Charts:

- DAU/WAU/MAU area chart
- retention cohort heatmap
- new versus returning players stacked area chart
- session duration distribution
- sessions and matches per player histogram
- activity calendar heatmap
- active players by country/platform/app version

Tables:

- retention cohorts
- most engaged player segments
- dormant/reactivated segment summary
- feature adoption and repeat-use table

### 6.2 Gameplay & matchmaking report

Charts:

- matches created-to-settled funnel
- daily match volume by game and mode
- matchmaking wait-time percentile lines
- completion, abandonment, and disconnect rates
- answer accuracy and answer-time distributions
- ELO movement and rank-tier distribution
- game popularity treemap or ranked bar chart

Tables:

- mode performance comparison
- queue health by hour
- game/challenge difficulty outcomes
- match settlement exceptions

### 6.3 Progression & retention report

Charts:

- XP earned and level-up trend
- level distribution and progression funnel
- rank tier distribution and movement matrix
- mission/achievement completion funnel
- mission claim backlog
- streak length distribution
- streak milestone reach and break rate
- progression/ad-bonus relationship

Tables:

- highest and lowest completion missions
- achievement families by tier reach
- reward source breakdown
- players stalled at progression bands

### 6.4 Economy & monetization report

Charts:

- GLD inflow/outflow waterfall
- minted versus burned time series
- player balance percentile bands
- rewarded-ad funnel
- base reward versus final reward stacked area
- progression and streak bonus contribution
- purchase revenue trend
- social-gift flow diagram
- wallet ledger reconciliation trend

Tables:

- GLD source/destination breakdown
- top emission and burn sources
- emission-limit hits
- ad verification rejection reasons
- purchase/refund details
- economy policy breaches

### 6.5 Social & communications report

Charts:

- friendship funnel
- online presence by hour/day
- chat message volume by type
- delivery/read conversion funnel
- unread backlog trend
- response-time distribution
- voice-message duration and storage trend
- push notification funnel
- group-chat growth and activity

Tables:

- most active chat groups
- message failure reasons
- muted versus unmuted notification engagement
- media storage by feature and retention status

### 6.6 Support operations report

Charts:

- ticket volume and backlog trend
- SLA compliance gauge and trend
- ticket status funnel
- first response and resolution percentiles
- live-chat queue wait-time chart
- support-agent workload chart
- category and priority distribution
- help-article deflection funnel

Tables:

- tickets breaching SLA
- oldest unresolved cases
- agent performance
- refunds and live-chat billing exceptions

### 6.7 Fraud, risk & moderation report

Charts:

- risk event trend by severity
- rule hit-rate ranking
- risk funnel: detected → reviewed → actioned → cleared
- blocked GLD/ads/purchases over time
- report/moderation queue trend
- false-positive and reversal trend
- risk clusters by country/device/app version

Tables:

- high-risk players requiring review
- active investigations
- top triggered rules
- unresolved reports
- recent moderator actions and appeals

### 6.8 Platform health report

Charts:

- API availability and error-rate trend
- latency percentile trend
- WebSocket connections and reconnects
- notification delivery success
- background job success/failure
- storage growth and deletion backlog
- analytics ingestion lag

Tables:

- slow endpoints
- failed jobs
- failed notifications
- storage objects nearing policy limits
- stale or incomplete aggregation jobs

---

## 7. Data architecture

### Source of truth

Use backend PostgreSQL data and server-generated analytics events. Client-side events may supplement UX metrics but must not be trusted for wallet, reward, match settlement, fraud, moderation, or support billing reports.

### Event envelope

Every event should use a versioned envelope similar to:

```json
{
  "eventId": "uuid",
  "eventName": "match.settled",
  "eventVersion": 1,
  "occurredAt": "UTC timestamp",
  "receivedAt": "UTC timestamp",
  "playerId": "uuid or null",
  "sessionId": "uuid or null",
  "matchId": "uuid or null",
  "requestId": "uuid or null",
  "platform": "android|ios|web|admin|system",
  "appVersion": "string or null",
  "countryCode": "string or null",
  "properties": {},
  "privacyClass": "operational|sensitive|restricted"
}
```

Requirements:

- globally unique `eventId`
- idempotent ingestion
- event versioning
- server timestamp and source timestamp when useful
- no raw secrets, tokens, answer keys, or unnecessary message content
- explicit privacy classification
- correlation IDs for matching API, socket, job, and settlement activity

### Aggregation strategy

Use a hybrid model:

1. Existing transactional tables for exact drill-down and financial/audit reports.
2. Append-only analytics event table for cross-feature events.
3. Daily/hourly aggregate tables for fast dashboards.
4. Optional PostgreSQL materialized views for expensive reports.
5. Background workers to backfill, recompute, and repair aggregates.

Suggested aggregate families:

- `AnalyticsDailyPlayer`
- `AnalyticsDailyGameplay`
- `AnalyticsDailyEconomy`
- `AnalyticsDailySocial`
- `AnalyticsDailySupport`
- `AnalyticsDailyRisk`
- `AnalyticsHourlyPlatform`
- `AnalyticsCohortRetention`

All aggregates must include a source range, calculation version, generated timestamp, and completeness status.

### Freshness targets

- operational KPIs: under 5 minutes
- gameplay/economy overview: under 15 minutes
- retention cohorts: daily
- financial reconciliation: daily and on-demand
- large historical reports: background job with progress state

The UI must never imply real-time accuracy when a report is stale.

---

## 8. Backend API design

Use a dedicated analytics module. Do not place analytics query logic inside unrelated feature controllers.

Suggested endpoints:

```text
GET  /admin/analytics/overview
GET  /admin/analytics/engagement
GET  /admin/analytics/gameplay
GET  /admin/analytics/progression
GET  /admin/analytics/economy
GET  /admin/analytics/social
GET  /admin/analytics/support
GET  /admin/analytics/risk
GET  /admin/analytics/platform
GET  /admin/analytics/player-explorer
GET  /admin/analytics/metric-definitions
GET  /admin/analytics/alerts
GET  /admin/analytics/saved-reports
POST /admin/analytics/saved-reports
PATCH /admin/analytics/saved-reports/:id
DELETE /admin/analytics/saved-reports/:id
GET  /admin/analytics/scheduled-reports
POST /admin/analytics/scheduled-reports
PATCH /admin/analytics/scheduled-reports/:id
DELETE /admin/analytics/scheduled-reports/:id
POST /admin/analytics/exports
GET  /admin/analytics/exports/:id
GET  /admin/analytics/exports/:id/download
GET  /admin/analytics/audit
```

### Query contract

Common query parameters:

```text
from
to
comparisonFrom
comparisonTo
timezone
resolution
country
platform
appVersion
gameKey
mode
status
riskLevel
segment
cursor
limit
```

Responses should include:

```json
{
  "range": { "from": "...", "to": "...", "timezone": "UTC" },
  "comparison": { "from": "...", "to": "..." },
  "filters": {},
  "generatedAt": "...",
  "dataThrough": "...",
  "freshness": "fresh|stale|partial",
  "definitionVersion": 1,
  "metrics": [],
  "series": [],
  "breakdowns": [],
  "warnings": []
}
```

### Query safety

- Validate all filters through DTOs and allowlists.
- Never accept raw SQL from the browser.
- Cap range and row sizes for synchronous requests.
- Use cursor pagination for large tables.
- Add query timeout and cancellation support.
- Cache identical aggregate queries briefly.
- Require background exports for large ranges.
- Add indexes based on actual query plans.

---

## 9. Player explorer

Provide a restricted player-level investigation tool with:

- player search by ID, username, email hash, or external identifier according to permission
- account status, country, platform, app version, and risk status
- last activity and session history
- match, progression, mission, achievement, streak, wallet, purchase, ad, and support summaries
- chat metadata only by default; message content requires a separate permission and audit reason
- fraud/risk timeline
- admin actions and recent audit events
- links to relevant detailed reports

Sensitive values must be redacted unless the administrator has the required permission. Every access to player-level data must create an audit event.

---

## 10. Saved and scheduled reports

### Saved reports

Administrators can save:

- report type
- selected widgets
- date range preset or rolling range
- comparison setting
- filters and dimensions
- display timezone
- chart/table layout
- visibility: private, team, or all permitted admins

### Scheduled reports

Support daily, weekly, and monthly schedules with:

- recipient administrators or approved email destinations
- report format: PDF, CSV, or both
- timezone and send time
- selected saved report
- failure notification
- enable/disable state
- last run and next run

Scheduled reports must not send sensitive player-level data to unapproved external addresses.

---

## 11. Alerts and anomaly detection

Create a configurable alerts area for threshold and trend-based alerts.

Initial alert examples:

- API error rate above threshold
- matchmaking wait time above threshold
- match settlement failure spike
- unusual GLD emission or burn increase
- ad verification rejection spike
- purchase/refund or chargeback anomaly
- sudden streak/ad bonus reward increase
- chat message or report spike
- support SLA breach increase
- storage growth or deletion backlog
- notification delivery failure
- analytics ingestion lag
- fraud rule spike or high-risk cluster increase

Each alert needs:

- metric key
- condition and threshold
- evaluation interval
- minimum sample size
- severity
- cooldown
- recipients
- active period
- acknowledgement state
- audit history

Use baseline-aware alerts where possible, comparing the current interval with a rolling historical baseline rather than relying only on fixed thresholds.

---

## 12. Permissions and auditability

Suggested permissions:

```text
analytics.view
analytics.view_player_level
analytics.view_economy
analytics.view_support
analytics.view_risk
analytics.export
analytics.manage_saved_reports
analytics.manage_scheduled_reports
analytics.manage_alerts
analytics.view_sensitive_chat_content
analytics.view_financial_details
```

Rules:

- Default to aggregate-only access.
- Economy, fraud, moderation, support, and message content require explicit permissions.
- Exports inherit the most restrictive permission among included data.
- Every view of sensitive data, export, schedule change, alert change, and player lookup is audited.
- Audit records include admin ID, action, report, filters, time, result, and request ID.

---

## 13. Data quality and reconciliation

Analytics must include automated checks for:

- duplicate event IDs
- events arriving outside the allowed lateness window
- missing required dimensions
- negative or impossible durations
- aggregate totals not matching transactional totals
- GLD ledger versus aggregate mismatch
- match lifecycle events missing settlement
- message counts versus retained message rows
- storage bytes versus object metadata
- support ticket status transitions without a valid event
- report freshness and failed worker runs

Add a data-quality panel showing:

- latest check time
- passing/failing checks
- affected date range
- affected feature
- severity
- repair/backfill action

Financial and wallet reports should provide an explicit reconciliation status before being considered trusted.

---

## 14. Privacy, retention, and security

- Keep analytics events free of message body, voice bytes, image URLs, access tokens, and answer keys unless specifically required and protected.
- Hash or redact identifiers in aggregate tables where possible.
- Apply the existing support/chat/media retention policies to derived analytics data.
- Define a separate analytics retention period in System Admin, with longer retention for aggregated data and shorter retention for raw events.
- Enforce row-level permission checks on every admin endpoint.
- Protect exports with short-lived signed URLs and automatic expiry.
- Rate-limit player explorer and export endpoints.
- Never expose fraud rules or sensitive risk signals to ordinary players.
- Log all admin report access and export downloads.

---

## 15. System Admin UI details

### KPI card design

Each card should display:

- metric label
- current value
- change versus comparison period
- small sparkline
- target or threshold marker where applicable
- data-through time
- information tooltip with metric definition
- “Open report” action

### Chart interactions

- hover tooltips with exact values
- selectable legend series
- zoom for long ranges
- brush/select range where useful
- chart/table toggle
- download action
- drill-down action
- compare overlay
- accessible keyboard navigation and table alternative

### Visual status

- purple/blue for neutral activity
- green for healthy/growth/completed
- gold for economy/rewards
- cyan for communication/platform
- orange for warnings
- red for failures, fraud, and SLA breaches

Use color with labels/icons as well; never rely on color alone.

---

## 16. Implementation phases

### Phase 1 — Foundation and overview

- Add analytics module, permissions, DTOs, and query contracts.
- Add event envelope and ingestion infrastructure.
- Add daily/hourly aggregate tables and worker framework.
- Implement global date/filter handling.
- Implement Overview with core lifecycle, engagement, gameplay, economy, and platform KPIs.
- Add freshness, partial-data, and audit behavior.
- Add basic CSV export.

### Phase 2 — Feature reports

- Add Engagement, Gameplay, Progression, Economy, Social, Support, Risk, and Platform pages.
- Instrument missing server-authoritative events.
- Add drill-down tables and player explorer.
- Add retention cohorts, funnels, percentile charts, and breakdowns.
- Add wallet/economy reconciliation reports.

### Phase 3 — Advanced operations

- Add saved reports and scheduled delivery.
- Add PDF/JSON/background exports.
- Add configurable alerts and anomaly detection.
- Add data-quality and backfill tools.
- Add report sharing within admin permissions.
- Add comparison baselines and target tracking.

### Phase 4 — Optimization and governance

- Tune indexes and aggregate refresh schedules using production query data.
- Add materialized views or partitioning where needed.
- Add retention and privacy automation.
- Add report definition versioning and migration strategy.
- Add automated reconciliation and incident runbooks.
- Add tests for metric definitions and known historical fixtures.

---

## 17. Testing and acceptance criteria

### Backend

- Unit tests for metric definitions and time-range boundaries.
- Integration tests against PostgreSQL for each report category.
- Permission tests for aggregate, sensitive, export, fraud, support, and player-level access.
- Idempotency tests for duplicate events.
- Backfill and late-event tests.
- Reconciliation tests for wallet, matches, support, chat, and storage.
- Load tests for overview and large exports.

### System Admin

- All global filters apply consistently to every widget.
- Comparison values use the correct equivalent period.
- Charts and tables show the same totals.
- Drill-down preserves inherited filters.
- Empty, stale, partial, and error states are clear.
- Export output includes filters and timestamps.
- Responsive behavior works at supported desktop widths.
- Sensitive data is hidden without permission.

### Completion criteria

The feature is complete when an administrator can select a date range and answer, without direct database access:

1. How many players are active, new, retained, and returning?
2. Which games, modes, and challenges are being played successfully?
3. Where are players dropping out or waiting too long?
4. How are levels, ranks, missions, achievements, and streaks progressing?
5. How much GLD is entering, moving through, and leaving the economy?
6. How effective are ads, gifts, purchases, and rewards?
7. How healthy are chats, notifications, media, and voice messages?
8. How quickly and effectively is support responding?
9. Where are fraud, moderation, or safety risks increasing?
10. Is the API, socket layer, worker system, storage, and analytics pipeline healthy?

Every answer must provide the metric definition, exact range, filters, freshness, source status, and a drill-down path.

