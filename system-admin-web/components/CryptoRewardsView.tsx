"use client";

import { useEffect, useMemo, useState } from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid2";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";

import { api } from "../lib/api";

type CryptoConfig = {
  enabled: boolean;
  networkCode: string;
  currencies: string[];
  rateVersion: string;
  usdtSolGldPerUnit: string;
  usdcSolGldPerUnit: string;
  platformFeeBps: number;
  quoteTtlSeconds: number;
  maxQuoteDriftBps: number;
  minGld: string;
  maxGldPerRequest: string;
  dailyGldLimit: string;
  maxPendingPerUser: number;
  holdExpiryHours: number;
  minProviderReserveUsd: string;
  requireAdminApproval: boolean;
  updatedAt?: string;
  providerEnabled: boolean;
  providerEnvironment: "sandbox" | "production" | string;
  providerBaseUrl: string;
  supportedCurrencies: string[];
  providerConfigured: boolean;
  callbackConfigured: boolean;
  requirePayoutVerification: boolean;
  payoutVerificationMode: string;
};

type CryptoRequest = {
  id: string;
  status: string;
  currencyCode: string;
  networkCode: string;
  destinationAddressMasked: string;
  addressValidatedAt?: string | null;
  gldRequested: string;
  gldHeld: string;
  gldReleased: string;
  grossCryptoAmount: string;
  platformFeeCrypto: string;
  providerFeeCrypto: string;
  netCryptoAmount: string;
  providerStatus?: string | null;
  providerStatusRaw?: string | null;
  providerEnvironment?: string | null;
  providerUniqueExternalId?: string | null;
  providerBatchWithdrawalId?: string | null;
  providerPayoutId?: string | null;
  transactionHash?: string | null;
  adminDecision?: string | null;
  adminNote?: string | null;
  quoteExpiresAt: string;
  holdExpiresAt: string;
  requestedAt: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  completedAt?: string | null;
  submissionAttempts?: number;
  pollAttempts?: number;
  user: {
    id: string;
    username?: string;
    email: string | null;
    status: string;
    profile: { displayName: string } | null;
  };
  hold: {
    status: string;
    amount: string;
    released: string;
    expiresAt: string;
  } | null;
};

type ProviderHealth = {
  configured: boolean;
  environment: string;
  status: unknown;
  balance: unknown;
  error?: string;
};

type ConfigForm = {
  enabled: boolean;
  usdtSolGldRate: string;
  usdcSolGldRate: string;
  platformFeeBps: string;
  quoteTtlSeconds: string;
  maxQuoteDriftBps: string;
  minGld: string;
  maxGld: string;
  dailyGldLimit: string;
  maxPendingRequestsPerPlayer: string;
  holdExpirySeconds: string;
  minProviderReserveUsd: string;
  requireAdminApproval: boolean;
  changeReason: string;
};

const statuses = [
  "",
  "PENDING_ADMIN_APPROVAL",
  "APPROVED",
  "SUBMITTING",
  "CREATED",
  "AWAITING_PROVIDER_VERIFICATION",
  "PROCESSING",
  "SENDING",
  "COMPLETED",
  "REJECTED",
  "REFUNDED",
  "FAILED_RETRYABLE",
  "RECONCILIATION_REQUIRED",
  "EXPIRED",
];

const emptyForm: ConfigForm = {
  enabled: false,
  usdtSolGldRate: "0",
  usdcSolGldRate: "0",
  platformFeeBps: "0",
  quoteTtlSeconds: "300",
  maxQuoteDriftBps: "500",
  minGld: "100",
  maxGld: "100000",
  dailyGldLimit: "200000",
  maxPendingRequestsPerPlayer: "1",
  holdExpirySeconds: "259200",
  minProviderReserveUsd: "0",
  requireAdminApproval: true,
  changeReason: "",
};

const humanize = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";

const chipColor = (value: string) => {
  if (["COMPLETED"].includes(value)) return "success" as const;
  if (["REJECTED", "REFUNDED", "EXPIRED"].includes(value)) return "error" as const;
  if (["FAILED_RETRYABLE", "RECONCILIATION_REQUIRED"].includes(value)) return "warning" as const;
  if (["PENDING_ADMIN_APPROVAL", "APPROVED"].includes(value)) return "info" as const;
  return "default" as const;
};

const playerName = (request: CryptoRequest) =>
  request.user.profile?.displayName || request.user.username || request.user.email || request.user.id;

export function CryptoRewardsView({
  onOpenPlayer360,
}: {
  onOpenPlayer360?: (userId: string) => void;
}) {
  const [config, setConfig] = useState<CryptoConfig | null>(null);
  const [form, setForm] = useState<ConfigForm>(emptyForm);
  const [requests, setRequests] = useState<CryptoRequest[]>([]);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setError("");
      const [nextConfig, nextRequests, health] = await Promise.all([
        api<CryptoConfig>("/crypto-rewards/config"),
        api<CryptoRequest[]>(`/crypto-rewards/requests${status ? `?status=${status}` : ""}`),
        api<ProviderHealth>("/crypto-rewards/provider-health").catch(() => null),
      ]);
      setConfig(nextConfig);
      setRequests(nextRequests);
      setProviderHealth(health);
      setForm({
        enabled: nextConfig.enabled,
        usdtSolGldRate: nextConfig.usdtSolGldPerUnit,
        usdcSolGldRate: nextConfig.usdcSolGldPerUnit,
        platformFeeBps: String(nextConfig.platformFeeBps),
        quoteTtlSeconds: String(nextConfig.quoteTtlSeconds),
        maxQuoteDriftBps: String(nextConfig.maxQuoteDriftBps),
        minGld: nextConfig.minGld,
        maxGld: nextConfig.maxGldPerRequest,
        dailyGldLimit: nextConfig.dailyGldLimit,
        maxPendingRequestsPerPlayer: String(nextConfig.maxPendingPerUser),
        holdExpirySeconds: String(nextConfig.holdExpiryHours * 3600),
        minProviderReserveUsd: nextConfig.minProviderReserveUsd || "0",
        requireAdminApproval: nextConfig.requireAdminApproval,
        changeReason: "",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load crypto rewards");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [status]);

  const update = <K extends keyof ConfigForm>(key: K, value: ConfigForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const saveConfig = async () => {
    setSaving(true);
    try {
      setError("");
      const saved = await api<CryptoConfig>("/crypto-rewards/config", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: form.enabled,
          usdtSolGldRate: form.usdtSolGldRate.trim(),
          usdcSolGldRate: form.usdcSolGldRate.trim(),
          platformFeeBps: Number(form.platformFeeBps),
          quoteTtlSeconds: Number(form.quoteTtlSeconds),
          maxQuoteDriftBps: Number(form.maxQuoteDriftBps),
          minGld: form.minGld.trim(),
          maxGld: form.maxGld.trim(),
          dailyGldLimit: form.dailyGldLimit.trim(),
          maxPendingRequestsPerPlayer: Number(form.maxPendingRequestsPerPlayer),
          holdExpirySeconds: Number(form.holdExpirySeconds),
          minProviderReserveUsd: form.minProviderReserveUsd.trim(),
          requireAdminApproval: form.requireAdminApproval,
          changeReason: form.changeReason.trim() || undefined,
        }),
      });
      setConfig(saved);
      setForm((current) => ({ ...current, changeReason: "" }));
      setMessage("Crypto reward configuration saved and audited.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save configuration");
    } finally {
      setSaving(false);
    }
  };

  const action = async (request: CryptoRequest, kind: "approve" | "reject" | "submit" | "verify" | "reconcile") => {
    let path = `/crypto-rewards/requests/${request.id}`;
    let init: RequestInit = { method: "PATCH" };
    if (kind === "approve" || kind === "reject") {
      const note = window.prompt(kind === "approve" ? "Optional approval note" : "Reason for rejection", request.adminNote || "") ?? "";
      if (kind === "reject" && !note.trim() && !window.confirm("Reject without a note?")) return;
      init.body = JSON.stringify({ decision: kind === "approve" ? "APPROVE" : "REJECT", adminNote: note.trim() || undefined });
    } else if (kind === "submit") {
      path += "/submit";
      init = { method: "POST" };
    } else if (kind === "verify") {
      const verificationCode = window.prompt("Enter the NOWPayments 2FA verification code")?.trim() || "";
      if (!/^\d{6,8}$/.test(verificationCode)) return;
      path += "/verify";
      init = { method: "POST", body: JSON.stringify({ verificationCode }) };
    } else {
      const note = window.prompt("Reconciliation note", request.adminNote || "") ?? "";
      path += "/reconciliation";
      init = { method: "POST", body: JSON.stringify({ note: note.trim() || undefined }) };
    }
    setWorking(request.id);
    try {
      setError("");
      await api(path, init);
      setMessage(kind === "approve" ? "Request approved." : kind === "reject" ? "Request rejected and GLD released." : kind === "submit" ? "Payout submitted to NOWPayments." : kind === "verify" ? "Payout verification submitted." : "Request marked for reconciliation.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Crypto reward action failed");
    } finally {
      setWorking("");
    }
  };

  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const request of requests) result[request.status] = (result[request.status] || 0) + 1;
    return result;
  }, [requests]);

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={2}>
        <Box>
          <Typography variant="h4" fontWeight={850}>Crypto rewards</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.7 }}>
            Configure GLD-backed USDT/USDC Solana payouts and review every provider submission.
          </Typography>
        </Box>
        <Button startIcon={<RefreshRoundedIcon />} variant="outlined" onClick={() => void load()} disabled={loading}>Refresh</Button>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success" onClose={() => setMessage("")}>{message}</Alert>}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 3 }}><Card><CardContent><Typography color="text.secondary">Feature</Typography><Typography variant="h6" fontWeight={850}>{config?.enabled ? "Enabled" : "Paused"}</Typography><Chip size="small" color={config?.enabled ? "success" : "default"} label={config?.enabled ? "Accepting requests" : "Not accepting new requests"} sx={{ mt: 1 }} /></CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 3 }}><Card><CardContent><Typography color="text.secondary">Provider</Typography><Typography variant="h6" fontWeight={850}>{config?.providerEnvironment === "production" ? "Live" : "Sandbox"}</Typography><Chip size="small" color={config?.providerConfigured ? "success" : "warning"} label={config?.providerConfigured ? "Configured" : "Configuration incomplete"} sx={{ mt: 1 }} /></CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 3 }}><Card><CardContent><Typography color="text.secondary">Requests shown</Typography><Typography variant="h4" fontWeight={900}>{requests.length}</Typography><Typography variant="caption" color="text.secondary">{counts.PENDING_ADMIN_APPROVAL || 0} awaiting approval</Typography></CardContent></Card></Grid>
        <Grid size={{ xs: 12, md: 3 }}><Card><CardContent><Typography color="text.secondary">Verification</Typography><Typography variant="h6" fontWeight={850}>{config?.requirePayoutVerification ? "Manual 2FA" : "Provider default"}</Typography><Typography variant="caption" color="text.secondary">Never expose provider credentials in the console</Typography></CardContent></Card></Grid>
      </Grid>

      <Card>
        <CardContent>
          <Stack spacing={2.5}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
              <Box><Typography variant="h6" fontWeight={850}>Crypto payout policy</Typography><Typography variant="body2" color="text.secondary">Rates and limits are stored server-side. Saving records old/new values and the administrator reason in the audit trail.</Typography></Box>
              <FormControlLabel control={<Switch checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} />} label="Feature enabled" />
            </Stack>
            <Divider />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth label="USDT-Solana GLD rate" value={form.usdtSolGldRate} onChange={(event) => update("usdtSolGldRate", event.target.value)} helperText="GLD per 1 USDTSOL" /></Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}><TextField fullWidth label="USDC-Solana GLD rate" value={form.usdcSolGldRate} onChange={(event) => update("usdcSolGldRate", event.target.value)} helperText="GLD per 1 USDCSOL" /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Platform fee (bps)" type="number" value={form.platformFeeBps} onChange={(event) => update("platformFeeBps", event.target.value)} inputProps={{ min: 0, max: 10000 }} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Quote lifetime (seconds)" type="number" value={form.quoteTtlSeconds} onChange={(event) => update("quoteTtlSeconds", event.target.value)} inputProps={{ min: 60, max: 86400 }} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Maximum fee drift (bps)" type="number" value={form.maxQuoteDriftBps} onChange={(event) => update("maxQuoteDriftBps", event.target.value)} inputProps={{ min: 0, max: 10000 }} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Minimum GLD/request" value={form.minGld} onChange={(event) => update("minGld", event.target.value)} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Maximum GLD/request" value={form.maxGld} onChange={(event) => update("maxGld", event.target.value)} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Daily GLD limit/player" value={form.dailyGldLimit} onChange={(event) => update("dailyGldLimit", event.target.value)} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Max pending/player" type="number" value={form.maxPendingRequestsPerPlayer} onChange={(event) => update("maxPendingRequestsPerPlayer", event.target.value)} inputProps={{ min: 1, max: 100 }} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Hold expiry (seconds)" type="number" value={form.holdExpirySeconds} onChange={(event) => update("holdExpirySeconds", event.target.value)} inputProps={{ min: 3600, max: 2592000 }} /></Grid>
              <Grid size={{ xs: 6, md: 3 }}><TextField fullWidth label="Minimum provider reserve (USD)" value={form.minProviderReserveUsd} onChange={(event) => update("minProviderReserveUsd", event.target.value)} /></Grid>
            </Grid>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={2}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <FormControlLabel control={<Switch checked={form.requireAdminApproval} onChange={(event) => update("requireAdminApproval", event.target.checked)} />} label="Require admin approval" />
                <Typography variant="body2" color="text.secondary" sx={{ alignSelf: "center" }}>Network: SOLANA · Assets: USDTSOL, USDCSOL</Typography>
              </Stack>
              <TextField size="small" label="Change reason (audit)" value={form.changeReason} onChange={(event) => update("changeReason", event.target.value)} sx={{ minWidth: { md: 300 } }} />
              <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={() => void saveConfig()} disabled={saving || !config}>{saving ? "Saving…" : "Save policy"}</Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography variant="h6" fontWeight={850}>NOWPayments connection</Typography>
            <Typography variant="body2" color="text.secondary">Credentials remain Railway environment variables. The callback is public and unauthenticated, but protected by the NOWPayments HMAC signature.</Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`Environment: ${config?.providerEnvironment || "—"}`} />
              <Chip label={`API: ${config?.providerEnabled ? "enabled" : "disabled"}`} color={config?.providerEnabled ? "success" : "default"} />
              <Chip label={`Callback: ${config?.callbackConfigured ? "configured" : "missing"}`} color={config?.callbackConfigured ? "success" : "warning"} />
              <Chip label={`Payout mode: ${config?.payoutVerificationMode || "—"}`} />
              <Chip label={`Base URL: ${config?.providerBaseUrl || "—"}`} variant="outlined" />
            </Stack>
            {providerHealth?.error && <Alert severity="warning">Provider health check: {providerHealth.error}</Alert>}
            {providerHealth && !providerHealth.error && <Typography variant="caption" color="text.secondary">The provider health and balance response is available to authorized administrators only and is never returned to mobile clients.</Typography>}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={2}>
              <Box><Typography variant="h6" fontWeight={850}>Payout review queue</Typography><Typography variant="body2" color="text.secondary">Addresses are masked. Approval revalidates the address, fee drift, player status, hold, and provider readiness.</Typography></Box>
              <Select size="small" value={status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 250 }}>
                {statuses.map((value) => <MenuItem key={value || "ALL"} value={value}>{value ? humanize(value) : "All requests"}</MenuItem>)}
              </Select>
            </Stack>
            <Divider />
            {loading ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={28} /></Stack> : <TableContainer sx={{ overflowX: "auto" }}><Table size="small" sx={{ minWidth: 1200 }}><TableHead><TableRow><TableCell>Player</TableCell><TableCell>Request</TableCell><TableCell>Destination</TableCell><TableCell>GLD</TableCell><TableCell>Payout</TableCell><TableCell>Status</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>
              {requests.map((request) => <TableRow key={request.id} hover>
                <TableCell><Button size="small" onClick={() => onOpenPlayer360?.(request.user.id)} sx={{ textTransform: "none", fontWeight: 800, p: 0 }}>{playerName(request)}</Button><Typography variant="caption" display="block" color="text.secondary">{request.user.email || request.user.id}</Typography><Chip size="small" variant="outlined" label={request.user.status} sx={{ mt: 0.5 }} /></TableCell>
                <TableCell><Typography variant="body2">{date(request.requestedAt)}</Typography><Typography variant="caption" color="text.secondary">{request.id.slice(0, 8)} · {request.providerEnvironment || "—"}</Typography></TableCell>
                <TableCell><Typography fontWeight={700}>{request.currencyCode}</Typography><Typography variant="caption" display="block" color="text.secondary">{request.networkCode} · {request.destinationAddressMasked}</Typography><Typography variant="caption" display="block" color="text.secondary">Validated {date(request.addressValidatedAt)}</Typography></TableCell>
                <TableCell><Typography fontWeight={750}>{request.gldRequested}</Typography><Typography variant="caption" display="block" color="text.secondary">Held {request.gldHeld}</Typography>{request.gldReleased !== "0" && <Typography variant="caption" display="block" color="success.main">Released {request.gldReleased}</Typography>}</TableCell>
                <TableCell><Typography fontWeight={750}>{request.netCryptoAmount} {request.currencyCode}</Typography><Typography variant="caption" display="block" color="text.secondary">Gross {request.grossCryptoAmount}</Typography><Typography variant="caption" display="block" color="text.secondary">Fees {request.platformFeeCrypto} + {request.providerFeeCrypto}</Typography>{request.transactionHash && <Typography variant="caption" display="block" color="success.main">Hash {request.transactionHash.slice(0, 12)}…</Typography>}</TableCell>
                <TableCell><Chip size="small" color={chipColor(request.status)} label={humanize(request.status)} />{request.providerStatus && <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>Provider: {request.providerStatus}</Typography>}{request.adminNote && <Typography variant="caption" display="block" color="text.secondary" sx={{ maxWidth: 180 }}>{request.adminNote}</Typography>}</TableCell>
                <TableCell align="right"><Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>{request.status === "PENDING_ADMIN_APPROVAL" && <><Button size="small" variant="contained" color="success" onClick={() => void action(request, "approve")} disabled={working === request.id}>Approve</Button><Button size="small" variant="outlined" color="error" onClick={() => void action(request, "reject")} disabled={working === request.id}>Reject</Button></>}{request.status === "APPROVED" && <Button size="small" variant="contained" onClick={() => void action(request, "submit")} disabled={working === request.id}>Submit</Button>}{request.status === "AWAITING_PROVIDER_VERIFICATION" && <Button size="small" variant="contained" onClick={() => void action(request, "verify")} disabled={working === request.id}>Verify</Button>}{request.status === "RECONCILIATION_REQUIRED" && <Button size="small" variant="outlined" onClick={() => void action(request, "reconcile")} disabled={working === request.id}>Reconcile</Button>}{working === request.id && <CircularProgress size={18} />}</Stack></TableCell>
              </TableRow>)}
              {!requests.length && <TableRow><TableCell colSpan={7} align="center" sx={{ py: 6 }}><Typography color="text.secondary">No crypto reward requests in this filter.</Typography></TableCell></TableRow>}
            </TableBody></Table></TableContainer>}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
