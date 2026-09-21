"use client";

import { useEffect, useMemo, useState } from "react";
import AccountBalanceRoundedIcon from "@mui/icons-material/AccountBalanceRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SyncRoundedIcon from "@mui/icons-material/SyncRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid2";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "../lib/api";

type GldData = {
  state: {
    displayedValueUsdMicros: string;
    targetValueUsdMicros: string;
    treasuryReserveUsdMicros: string;
    circulatingSupply: string;
    reserveRatioBps: number;
    dailyEmissionBudget: string;
    dailyEmissionUsed: string;
    health: string;
  };
  config: Record<string, unknown>;
  controls: {
    emissionsPaused: boolean;
    catalogSinksPaused: boolean;
    giftsPaused: boolean;
    paidRewardsPaused: boolean;
    gldTransferFeeBps: number;
    reason: string | null;
    adDailyGldCap: string | null;
    adMaxValidatedAds: number | null;
    adMaxRewardPerClaim: string | null;
    admobReserveAllocationBps: number | null;
    giftBurnBps: number | null;
    paidRewardSafetyMarginBps: number | null;
    paidRewardDailyRequestLimit: number | null;
  };
  revenueSnapshots: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    grossAdRevenueUsdMicros: string;
    reserveAddedUsdMicros: string;
    rewardBackingUsdMicros: string;
    recognitionStatus: string;
  }>;
  manualBackings: Array<{
    id: string;
    amountUsdMicros: string;
    reason: string;
    createdAt: string;
    createdBy: { username: string; email: string | null };
  }>;
  metrics: {
    emissionDay: {
      emittedAmount: string;
      burnedAmount: string;
      adRewardAmount: string;
    } | null;
    burns: { total: string; count: number; today: string; todayCount: number };
    revenue: {
      grossAdRevenueUsdMicros: string;
      rewardBackingUsdMicros: string;
      reserveAddedUsdMicros: string;
      snapshots: number;
    };
    manualBacking: { totalUsdMicros: string; count: number };
    paidRewardCosts: { totalUsdMicros: string; count: number };
  };
};

type GldSimulation = {
  formattedUsd: string;
  priceUsdMicros: string;
  minPriceUsdMicros: string;
  maxPriceUsdMicros: string;
};

type GldAdRewardPolicy = {
  id: string;
  adFormat: string;
  eventType: string;
  regionCode: string;
  rewardAmount: string;
  enabled: boolean;
};

const GLD_AD_REWARD_REGIONS = [
  "DEFAULT",
  "US",
  "CA",
  "GB",
  "DE",
  "FR",
  "IQ",
  "TR",
  "AE",
  "SA",
  "IN",
  "PK",
  "EU",
  "ASIA",
  "AFRICA",
  "NORTH_AMERICA",
  "SOUTH_AMERICA",
  "OCEANIA",
];

const bigintValue = (value: unknown) => {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return BigInt(0);
  }
};
const numberValue = (value: unknown) => bigintValue(value).toLocaleString();
const usdValue = (value: unknown) => {
  const amount = bigintValue(value);
  const micros = BigInt(1000000);
  return `$${(amount / micros).toLocaleString()}.${(amount % micros).toString().padStart(6, "0").padEnd(10, "0")}`;
};
const controlLabel = (key: string) =>
  key.replace("Paused", "").replace(/([A-Z])/g, " $1");

const usdToMicros = (value: string) => {
  const match = value.trim().match(/^(\d+)(?:\.(\d{0,6}))?$/);
  if (!match)
    throw new Error("Enter a valid USD amount with up to 6 decimal places");
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0") || "0");
  return (whole * BigInt(1000000) + fraction).toString();
};

export function GldEconomyView() {
  const [data, setData] = useState<GldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [simulationReserve, setSimulationReserve] = useState("1");
  const [simulationSupply, setSimulationSupply] = useState("100000");
  const [simulation, setSimulation] = useState<GldSimulation | null>(null);
  const [simulationError, setSimulationError] = useState("");
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [backingAmount, setBackingAmount] = useState("");
  const [backingReason, setBackingReason] = useState("");
  const [backingError, setBackingError] = useState("");
  const [backingLoading, setBackingLoading] = useState(false);
  const [transferFeePercent, setTransferFeePercent] = useState("0");
  const [transferFeeLoading, setTransferFeeLoading] = useState(false);
  const [policy, setPolicy] = useState({
    adDailyGldCap: "25",
    adMaxValidatedAds: "20",
    adMaxRewardPerClaim: "10",
    giftBurnBps: "10000",
    paidRewardSafetyMarginBps: "12000",
    paidRewardDailyRequestLimit: "3",
    admobReserveAllocationPercent: "20",
  });
  const [policySaving, setPolicySaving] = useState(false);
  const [adRewardPolicies, setAdRewardPolicies] = useState<GldAdRewardPolicy[]>(
    [],
  );
  const [adRewardForm, setAdRewardForm] = useState({
    adFormat: "banner",
    eventType: "impression",
    regionCode: "DEFAULT",
    rewardAmount: "1",
    enabled: true,
  });
  const [adRewardSaving, setAdRewardSaving] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      setError("");
      const next = await api<GldData>("/gld");
      setData(next);
      const adPolicies = await api<GldAdRewardPolicy[]>(
        "/gld/ad-reward-policies",
      );
      setAdRewardPolicies(adPolicies);
      setTransferFeePercent(
        ((next.controls.gldTransferFeeBps ?? 0) / 100).toString(),
      );
      setPolicy({
        adDailyGldCap: String(
          next.controls.adDailyGldCap ?? next.config.adDailyGldCap ?? "25",
        ),
        adMaxValidatedAds: String(
          next.controls.adMaxValidatedAds ??
            next.config.adMaxValidatedAds ??
            "20",
        ),
        adMaxRewardPerClaim: String(
          next.controls.adMaxRewardPerClaim ??
            next.config.adMaxRewardPerClaim ??
            "10",
        ),
        giftBurnBps: String(
          next.controls.giftBurnBps ?? next.config.giftBurnBps ?? "10000",
        ),
        paidRewardSafetyMarginBps: String(
          next.controls.paidRewardSafetyMarginBps ??
            next.config.paidRewardSafetyMarginBps ??
            "12000",
        ),
        paidRewardDailyRequestLimit: String(
          next.controls.paidRewardDailyRequestLimit ??
            next.config.paidRewardDailyRequestLimit ??
            "3",
        ),
        admobReserveAllocationPercent: (
          Number(
            next.controls.admobReserveAllocationBps ??
              Number(next.config.reserveAllocationBps ?? 2000),
          ) / 100
        ).toString(),
      });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load GLD economy",
      );
    } finally {
      setLoading(false);
    }
  };
  const saveAdRewardPolicy = async () => {
    if (!/^\d+(?:\.\d{1,6})?$/.test(adRewardForm.rewardAmount.trim())) {
      setError("Ad reward amount must be a non-negative number with up to 6 decimals.");
      return;
    }
    setAdRewardSaving(true);
    try {
      const saved = await api<GldAdRewardPolicy>("/gld/ad-reward-policies", {
        method: "PUT",
        body: JSON.stringify({
          ...adRewardForm,
          rewardAmount: adRewardForm.rewardAmount.trim(),
          regionCode: adRewardForm.regionCode.trim().toUpperCase(),
        }),
      });
      setAdRewardPolicies((current) =>
        [
          ...current.filter(
            (item) =>
              item.id !== saved.id &&
              !(
                item.adFormat === saved.adFormat &&
                item.eventType === saved.eventType &&
                item.regionCode === saved.regionCode
              ),
          ),
          saved,
        ].sort((a, b) =>
          `${a.adFormat}${a.eventType}${a.regionCode}`.localeCompare(
            `${b.adFormat}${b.eventType}${b.regionCode}`,
          ),
        ),
      );
      setMessage("Ad reward amount saved.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save ad reward amount",
      );
    } finally {
      setAdRewardSaving(false);
    }
  };
  const deleteAdRewardPolicy = async (policy: GldAdRewardPolicy) => {
    if (
      !window.confirm(
        `Delete ${policy.adFormat} ${policy.eventType} for ${policy.regionCode}?`,
      )
    )
      return;
    try {
      await api(`/gld/ad-reward-policies/${policy.id}`, { method: "DELETE" });
      setAdRewardPolicies((current) =>
        current.filter((item) => item.id !== policy.id),
      );
      setMessage("Ad reward policy deleted.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to delete ad reward policy",
      );
    }
  };
  const editAdRewardPolicy = (policy: GldAdRewardPolicy) =>
    setAdRewardForm({
      adFormat: policy.adFormat,
      eventType: policy.eventType,
      regionCode: policy.regionCode,
      rewardAmount: policy.rewardAmount,
      enabled: policy.enabled,
    });
  const savePolicy = async () => {
    const whole = (value: string) => /^\d+$/.test(value.trim());
    if (
      !whole(policy.adDailyGldCap) ||
      !whole(policy.adMaxRewardPerClaim) ||
      !whole(policy.adMaxValidatedAds) ||
      !whole(policy.giftBurnBps) ||
      !whole(policy.paidRewardSafetyMarginBps) ||
      !whole(policy.paidRewardDailyRequestLimit) ||
      !/^\d+(?:\.\d{1,2})?$/.test(policy.admobReserveAllocationPercent.trim())
    ) {
      setError("GLD policy values must be non-negative numbers.");
      return;
    }
    const numbers = [
      policy.adMaxValidatedAds,
      policy.giftBurnBps,
      policy.paidRewardSafetyMarginBps,
      policy.paidRewardDailyRequestLimit,
    ].map(Number);
    const reserveAllocationPercent = Number(
      policy.admobReserveAllocationPercent,
    );
    if (
      numbers[0] < 1 ||
      numbers[0] > 1000 ||
      numbers[1] > 10000 ||
      numbers[2] < 10001 ||
      numbers[2] > 100000 ||
      numbers[3] < 1 ||
      numbers[3] > 1000 ||
      reserveAllocationPercent < 0 ||
      reserveAllocationPercent > 100
    ) {
      setError(
        "Check the GLD policy limits: ads, burn BPS, margin BPS, and daily requests.",
      );
      return;
    }
    setPolicySaving(true);
    try {
      const controls = await api<GldData["controls"]>("/gld/controls", {
        method: "PATCH",
        body: JSON.stringify({
          adDailyGldCap: policy.adDailyGldCap.trim(),
          adMaxValidatedAds: numbers[0],
          adMaxRewardPerClaim: policy.adMaxRewardPerClaim.trim(),
          giftBurnBps: numbers[1],
          paidRewardSafetyMarginBps: numbers[2],
          paidRewardDailyRequestLimit: numbers[3],
          admobReserveAllocationBps: Math.round(reserveAllocationPercent * 100),
        }),
      });
      setData((current) => (current ? { ...current, controls } : current));
      setMessage("GLD policy settings updated.");
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update GLD policy settings",
      );
    } finally {
      setPolicySaving(false);
    }
  };
  const saveTransferFee = async () => {
    const percent = Number(transferFeePercent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setError("Player transfer fee must be between 0 and 100 percent.");
      return;
    }
    setTransferFeeLoading(true);
    try {
      const controls = await api<GldData["controls"]>("/gld/controls", {
        method: "PATCH",
        body: JSON.stringify({ gldTransferFeeBps: Math.round(percent * 100) }),
      });
      setData((current) => (current ? { ...current, controls } : current));
      setMessage("GLD transfer fee updated.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update GLD transfer fee",
      );
    } finally {
      setTransferFeeLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const run = async (label: string, path: string) => {
    setWorking(label);
    setMessage("");
    try {
      await api(path, { method: "POST" });
      setMessage(`${label} completed.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${label} failed`);
    } finally {
      setWorking("");
    }
  };
  const setControl = async (key: keyof GldData["controls"], value: boolean) => {
    if (!data) return;
    try {
      const controls = await api<GldData["controls"]>("/gld/controls", {
        method: "PATCH",
        body: JSON.stringify({ [key]: value }),
      });
      setData({ ...data, controls });
      setMessage("GLD emergency controls updated.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update GLD controls",
      );
    }
  };
  const simulate = async () => {
    setSimulationLoading(true);
    setSimulationError("");
    try {
      const result = await api<GldSimulation>("/gld/simulate", {
        method: "POST",
        body: JSON.stringify({
          reserveUsdMicros: usdToMicros(simulationReserve),
          circulatingSupply: simulationSupply.trim(),
        }),
      });
      setSimulation(result);
    } catch (reason) {
      setSimulation(null);
      setSimulationError(
        reason instanceof Error
          ? reason.message
          : "Unable to simulate GLD value",
      );
    } finally {
      setSimulationLoading(false);
    }
  };
  const addBacking = async () => {
    setBackingLoading(true);
    setBackingError("");
    try {
      await api("/gld/backing", {
        method: "POST",
        body: JSON.stringify({
          amountUsd: backingAmount,
          reason: backingReason,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setBackingAmount("");
      setBackingReason("");
      setMessage("Manual reserve backing added and GLD recalculated.");
      await load();
    } catch (reason) {
      setBackingError(
        reason instanceof Error
          ? reason.message
          : "Unable to add manual backing",
      );
    } finally {
      setBackingLoading(false);
    }
  };
  const chartRows = useMemo(
    () => [...(data?.revenueSnapshots ?? [])].reverse().slice(-14),
    [data],
  );
  const maxRevenue = Math.max(
    ...chartRows.map((row) => Number(bigintValue(row.grossAdRevenueUsdMicros))),
    1,
  );
  if (loading && !data)
    return (
      <Stack alignItems="center" sx={{ py: 10 }}>
        <RefreshRoundedIcon />
        <Typography sx={{ mt: 1 }}>Loading GLD economy…</Typography>
      </Stack>
    );
  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Typography variant="overline" color="secondary.light">
            SERVER-OWNED ECONOMY
          </Typography>
          <Typography variant="h4" fontWeight={850}>
            GLD economy controls
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.7 }}>
            Monitor reserve-backed GLD, import mature AdMob revenue, and operate
            audited emergency controls.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Button
            startIcon={<RefreshRoundedIcon />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            startIcon={<SyncRoundedIcon />}
            onClick={() =>
              void run("Revenue import", "/gld/revenue/materialize")
            }
            disabled={Boolean(working)}
          >
            Import revenue
          </Button>
          <Button
            startIcon={<AutorenewRoundedIcon />}
            variant="contained"
            onClick={() => void run("Recalculation", "/gld/recalculate")}
            disabled={Boolean(working)}
          >
            Recalculate
          </Button>
          <Button
            startIcon={<AccountBalanceRoundedIcon />}
            onClick={() => void run("Reconciliation", "/gld/reconcile")}
            disabled={Boolean(working)}
          >
            Reconcile
          </Button>
        </Stack>
      </Stack>
      {error && <Typography color="error.main">{error}</Typography>}
      {message && <Typography color="success.main">{message}</Typography>}
      {data && (
        <>
          <Grid container spacing={2}>
            {[
              ["1 GLD value", usdValue(data.state.displayedValueUsdMicros)],
              ["Reserve", usdValue(data.state.treasuryReserveUsdMicros)],
              [
                "Manual backing",
                usdValue(data.metrics.manualBacking.totalUsdMicros),
              ],
              ["Circulating supply", numberValue(data.state.circulatingSupply)],
              [
                "Reserve ratio",
                `${(data.state.reserveRatioBps / 100).toFixed(2)}%`,
              ],
              [
                "Today emitted",
                numberValue(data.metrics.emissionDay?.emittedAmount),
              ],
              ["Today burned", numberValue(data.metrics.burns.today)],
              [
                "Paid reward costs",
                usdValue(data.metrics.paidRewardCosts.totalUsdMicros),
              ],
            ].map(([label, value]) => (
              <Grid key={label} size={{ xs: 12, sm: 6, lg: 4 }}>
                <Card sx={{ p: 2.5, height: "100%" }}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="h5" fontWeight={850} sx={{ mt: 1 }}>
                    {value}
                  </Typography>
                </Card>
              </Grid>
            ))}
          </Grid>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 7 }}>
              <Card sx={{ p: { xs: 2, md: 3 }, height: "100%" }}>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Box>
                    <Typography variant="h6" fontWeight={800}>
                      GLD market health
                    </Typography>
                    <Typography color="text.secondary">
                      Current value, reserve backing, and emission budget.
                    </Typography>
                  </Box>
                  <Chip
                    color={
                      data.state.health === "CRITICAL"
                        ? "error"
                        : data.state.health === "RESTRICTED"
                          ? "warning"
                          : "success"
                    }
                    label={data.state.health.replaceAll("_", " ")}
                  />
                </Stack>
                <Divider sx={{ my: 2 }} />
                <Grid container spacing={2}>
                  {[
                    ["Target value", usdValue(data.state.targetValueUsdMicros)],
                    [
                      "Daily budget",
                      numberValue(data.state.dailyEmissionBudget),
                    ],
                    ["Budget used", numberValue(data.state.dailyEmissionUsed)],
                    [
                      "Burn events",
                      `${data.metrics.burns.count} (${numberValue(data.metrics.burns.total)} GLD)`,
                    ],
                    [
                      "Paid reward costs",
                      usdValue(data.metrics.paidRewardCosts.totalUsdMicros),
                    ],
                  ].map(([label, value]) => (
                    <Grid key={label} size={{ xs: 6 }}>
                      <Typography variant="caption" color="text.secondary">
                        {label}
                      </Typography>
                      <Typography fontWeight={800}>{value}</Typography>
                    </Grid>
                  ))}
                </Grid>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, lg: 5 }}>
              <Card sx={{ p: { xs: 2, md: 3 }, height: "100%" }}>
                <Typography variant="h6" fontWeight={800}>
                  Emergency controls
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1 }}
                >
                  These switches are enforced in server transactions and every
                  change is audited.
                </Typography>
                {(
                  [
                    "emissionsPaused",
                    "catalogSinksPaused",
                    "giftsPaused",
                    "paidRewardsPaused",
                  ] as const
                ).map((key) => (
                  <FormControlLabel
                    key={key}
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      ml: 0,
                    }}
                    label={controlLabel(key)}
                    labelPlacement="start"
                    control={
                      <Switch
                        checked={data.controls[key]}
                        onChange={(event) =>
                          void setControl(key, event.target.checked)
                        }
                      />
                    }
                  />
                ))}
                {data.controls.reason && (
                  <Typography variant="caption" color="text.secondary">
                    Reason: {data.controls.reason}
                  </Typography>
                )}
                <Divider sx={{ my: 1.5 }} />
                <Typography variant="body2" fontWeight={700}>
                  Player GLD transfer fee
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                  <TextField
                    size="small"
                    label="Fee (%)"
                    type="number"
                    value={transferFeePercent}
                    onChange={(event) =>
                      setTransferFeePercent(event.target.value)
                    }
                    inputProps={{ min: 0, max: 100, step: 0.01 }}
                  />
                  <Button
                    variant="outlined"
                    onClick={() => void saveTransferFee()}
                    disabled={transferFeeLoading}
                  >
                    {transferFeeLoading ? "Saving…" : "Save"}
                  </Button>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  The fee is added to the sender’s debit; the recipient receives
                  exactly the entered amount.
                </Typography>
              </Card>
            </Grid>
          </Grid>
          <Card sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h6" fontWeight={800}>
              Additional reserve backing
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Add external reserve backing to the live GLD treasury. Every entry
              is permanent, attributed to your admin account, and included in
              the next price calculation.
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Amount (USD)"
                  value={backingAmount}
                  onChange={(event) => setBackingAmount(event.target.value)}
                  helperText="Up to 6 decimal places"
                  inputProps={{ inputMode: "decimal" }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Reason / source"
                  value={backingReason}
                  onChange={(event) => setBackingReason(event.target.value)}
                  inputProps={{ maxLength: 500 }}
                />
              </Grid>
              <Grid
                size={{ xs: 12, sm: 3 }}
                sx={{ display: "flex", alignItems: "flex-start" }}
              >
                <Button
                  fullWidth
                  variant="contained"
                  onClick={() => void addBacking()}
                  disabled={
                    backingLoading || !backingAmount || !backingReason.trim()
                  }
                >
                  {backingLoading ? "Adding…" : "Add backing"}
                </Button>
              </Grid>
            </Grid>
            {backingError && (
              <Typography color="error.main" sx={{ mt: 1.5 }}>
                {backingError}
              </Typography>
            )}
            {data.manualBackings.length > 0 && (
              <Stack spacing={0.8} sx={{ mt: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Recent manual backing entries
                </Typography>
                {data.manualBackings.slice(0, 5).map((entry) => (
                  <Stack
                    key={entry.id}
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    spacing={0.5}
                  >
                    <Typography variant="body2">
                      {usdValue(entry.amountUsdMicros)} · {entry.reason}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {entry.createdBy.username} ·{" "}
                      {new Date(entry.createdAt).toLocaleString()}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Card>
          <Card sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h6" fontWeight={800}>
              GLD policy settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              These values are persisted on Railway and enforced by the server.
              BPS values use 100 basis points per 1%. AdMob reserve allocation
              is the share of recognized, eligible AdMob profit added to the
              USD reserve.
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {(
                [
                  ["Ad daily cap (GLD)", "adDailyGldCap"],
                  ["Max validated ads", "adMaxValidatedAds"],
                  ["Max reward / claim (GLD)", "adMaxRewardPerClaim"],
                  ["Gift burn (BPS)", "giftBurnBps"],
                  ["Paid reward margin (BPS)", "paidRewardSafetyMarginBps"],
                  ["Paid reward daily limit", "paidRewardDailyRequestLimit"],
                  [
                    "AdMob reserve allocation (%)",
                    "admobReserveAllocationPercent",
                  ],
                ] as const
              ).map(([label, key]) => (
                <Grid key={key} size={{ xs: 12, sm: 6, lg: 4 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label={label}
                    type="number"
                    value={policy[key]}
                    onChange={(event) =>
                      setPolicy((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    inputProps={{
                      min: 0,
                      step: key === "admobReserveAllocationPercent" ? 0.01 : 1,
                    }}
                  />
                </Grid>
              ))}
            </Grid>
            <Button
              sx={{ mt: 2 }}
              variant="contained"
              onClick={() => void savePolicy()}
              disabled={policySaving}
            >
              {policySaving ? "Saving…" : "Save GLD policy"}
            </Button>
          </Card>
          <Card sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h6" fontWeight={800}>
              GLD price simulation
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Test the reserve-backed target price without changing live GLD
              state, wallets, or treasury records.
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Reserve (USD)"
                  value={simulationReserve}
                  onChange={(event) => setSimulationReserve(event.target.value)}
                  helperText="Up to 6 decimal places"
                  inputProps={{ inputMode: "decimal" }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 5 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Circulating supply (GLD)"
                  value={simulationSupply}
                  onChange={(event) => setSimulationSupply(event.target.value)}
                  inputProps={{ inputMode: "numeric" }}
                />
              </Grid>
              <Grid
                size={{ xs: 12, sm: 2 }}
                sx={{ display: "flex", alignItems: "flex-start" }}
              >
                <Button
                  fullWidth
                  variant="outlined"
                  onClick={() => void simulate()}
                  disabled={simulationLoading}
                >
                  {simulationLoading ? "Testing…" : "Simulate"}
                </Button>
              </Grid>
            </Grid>
            {simulationError && (
              <Typography color="error.main" sx={{ mt: 1.5 }}>
                {simulationError}
              </Typography>
            )}
            {simulation && (
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={{ xs: 1, sm: 3 }}
                sx={{ mt: 2 }}
              >
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Simulated price
                  </Typography>
                  <Typography variant="h5" fontWeight={850}>
                    {simulation.formattedUsd}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Configured floor
                  </Typography>
                  <Typography fontWeight={800}>
                    {usdValue(simulation.minPriceUsdMicros)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Configured ceiling
                  </Typography>
                  <Typography fontWeight={800}>
                    {usdValue(simulation.maxPriceUsdMicros)}
                  </Typography>
                </Box>
              </Stack>
            )}
          </Card>
          <Card sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h6" fontWeight={800}>
              Ad reward amounts by placement and region
            </Typography>
            <Typography variant="body2" color="text.secondary">
              These are automatic client-event rewards. The player’s profile
              country is matched first, then DEFAULT. A claim can only be
              granted once, even if an ad callback is repeated.
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Ad placement"
                  value={adRewardForm.adFormat}
                  onChange={(event) =>
                    setAdRewardForm((current) => ({
                      ...current,
                      adFormat: event.target.value,
                    }))
                  }
                >
                  {[
                    "banner",
                    "native",
                    "interstitial",
                    "rewarded",
                    "rewarded_interstitial",
                  ].map((value) => (
                    <MenuItem key={value} value={value}>
                      {value}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="SDK event"
                  value={adRewardForm.eventType}
                  onChange={(event) =>
                    setAdRewardForm((current) => ({
                      ...current,
                      eventType: event.target.value,
                    }))
                  }
                >
                  {["impression", "click", "rewarded"].map((value) => (
                    <MenuItem key={value} value={value}>
                      {value}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Country / continent"
                  value={adRewardForm.regionCode}
                  onChange={(event) =>
                    setAdRewardForm((current) => ({
                      ...current,
                      regionCode: event.target.value,
                    }))
                  }
                  helperText="Choose a country or continent fallback"
                >
                  {GLD_AD_REWARD_REGIONS.map((region) => (
                    <MenuItem key={region} value={region}>
                      {region}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Reward (GLD)"
                  type="number"
                  value={adRewardForm.rewardAmount}
                  onChange={(event) =>
                    setAdRewardForm((current) => ({
                      ...current,
                      rewardAmount: event.target.value,
                    }))
                  }
                  inputProps={{ min: 0, step: 0.000001, inputMode: "decimal" }}
                  helperText="Supports up to 6 decimal places"
                />
              </Grid>
            </Grid>
            <Button
              sx={{ mt: 2 }}
              variant="contained"
              onClick={() => void saveAdRewardPolicy()}
              disabled={adRewardSaving}
            >
              {adRewardSaving ? "Saving…" : "Save ad reward"}
            </Button>
            <FormControlLabel
              sx={{ ml: 2 }}
              control={
                <Switch
                  checked={adRewardForm.enabled}
                  onChange={(event) =>
                    setAdRewardForm((current) => ({
                      ...current,
                      enabled: event.target.checked,
                    }))
                  }
                />
              }
              label="Enabled"
            />
            <Divider sx={{ my: 2 }} />
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Placement</TableCell>
                  <TableCell>Event</TableCell>
                  <TableCell>Country / continent</TableCell>
                  <TableCell align="right">GLD</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {adRewardPolicies.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>{row.adFormat}</TableCell>
                    <TableCell>{row.eventType}</TableCell>
                    <TableCell>{row.regionCode}</TableCell>
                    <TableCell align="right">{row.rewardAmount}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={row.enabled ? "ACTIVE" : "OFF"}
                        color={row.enabled ? "success" : "default"}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() => editAdRewardPolicy(row)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => void deleteAdRewardPolicy(row)}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Card sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h6" fontWeight={800}>
              AdMob revenue backing
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Matured AdMob report rows imported into the treasury before
              recalculation.
            </Typography>
            <Box
              sx={{
                display: "flex",
                alignItems: "end",
                gap: 0.7,
                height: 150,
                mt: 3,
              }}
            >
              {chartRows.map((row) => (
                <Box
                  key={row.id}
                  sx={{
                    flex: 1,
                    minWidth: 8,
                    height: `${Math.max(5, (Number(bigintValue(row.grossAdRevenueUsdMicros)) / maxRevenue) * 100)}%`,
                    bgcolor: "secondary.main",
                    borderRadius: "6px 6px 0 0",
                  }}
                  title={`${new Date(row.periodEnd).toLocaleDateString()}: ${usdValue(row.grossAdRevenueUsdMicros)}`}
                />
              ))}
            </Box>
            <Divider sx={{ mt: 1 }} />
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Period</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Gross</TableCell>
                  <TableCell align="right">Reserve</TableCell>
                  <TableCell align="right">Player backing</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.revenueSnapshots.slice(0, 10).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {new Date(row.periodStart).toLocaleDateString()} –{" "}
                      {new Date(row.periodEnd).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Chip size="small" label={row.recognitionStatus} />
                    </TableCell>
                    <TableCell align="right">
                      {usdValue(row.grossAdRevenueUsdMicros)}
                    </TableCell>
                    <TableCell align="right">
                      {usdValue(row.reserveAddedUsdMicros)}
                    </TableCell>
                    <TableCell align="right">
                      {usdValue(row.rewardBackingUsdMicros)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </Stack>
  );
}
