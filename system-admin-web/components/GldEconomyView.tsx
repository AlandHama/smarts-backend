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
    reason: string | null;
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
  };
};

type GldSimulation = {
  formattedUsd: string;
  priceUsdMicros: string;
  minPriceUsdMicros: string;
  maxPriceUsdMicros: string;
};

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
  const load = async () => {
    setLoading(true);
    try {
      setError("");
      setData(await api<GldData>("/gld"));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load GLD economy",
      );
    } finally {
      setLoading(false);
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
  const chartRows = useMemo(
    () => [...(data?.revenueSnapshots ?? [])].reverse().slice(-14),
    [data],
  );
  const maxRevenue = Math.max(
    ...chartRows.map((row) => Number(bigintValue(row.grossAdRevenueUsdMicros))),
    1,
  );
  const policyRows: Array<[string, unknown]> = data
    ? [
        ["Ad daily cap", data.config.adDailyGldCap],
        ["Max validated ads", data.config.adMaxValidatedAds],
        ["Max reward / claim", data.config.adMaxRewardPerClaim],
        ["Gift burn", data.config.giftBurnBps],
        ["Paid reward margin", data.config.paidRewardSafetyMarginBps],
        ["Paid reward daily limit", data.config.paidRewardDailyRequestLimit],
      ]
    : [];
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
              </Card>
            </Grid>
          </Grid>
          <Card sx={{ p: { xs: 2, md: 3 } }}>
            <Typography variant="h6" fontWeight={800}>
              GLD policy settings
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Effective server policy values. Change deployment variables for
              pricing and allocation policy; emergency switches above are
              persisted immediately.
            </Typography>
            <Grid container spacing={2} sx={{ mt: 1 }}>
              {policyRows.map(([label, value]) => (
                <Grid key={label} size={{ xs: 6, sm: 4 }}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography fontWeight={800}>
                    {String(value ?? "—")}
                  </Typography>
                </Grid>
              ))}
            </Grid>
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
