"use client";

import { useEffect, useMemo, useState } from "react";

import AdsClickRoundedIcon from "@mui/icons-material/AdsClickRounded";
import AssessmentRoundedIcon from "@mui/icons-material/AssessmentRounded";
import AttachMoneyRoundedIcon from "@mui/icons-material/AttachMoneyRounded";
import AutorenewRoundedIcon from "@mui/icons-material/AutorenewRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import CloudOffRoundedIcon from "@mui/icons-material/CloudOffRounded";
import InsightsRoundedIcon from "@mui/icons-material/InsightsRounded";
import VisibilityRoundedIcon from "@mui/icons-material/VisibilityRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid2";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";
import type { AdMobAnalytics, AdMobBreakdownRow } from "../lib/types";

const integer = new Intl.NumberFormat("en-US");
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 4,
  }).format(value || 0);
const count = (value: number) => integer.format(Math.round(value || 0));
const percent = (value: number) => `${Number(value || 0).toFixed(2)}%`;

export function AdMobView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdMobAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const currency = data?.connection?.currencyCode || "USD";

  const load = (preservedError = "") => {
    setLoading(true);
    if (!preservedError) setError("");
    void api<AdMobAnalytics>(`/admob?days=${days}`)
      .then(setData)
      .catch((reason) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load AdMob analytics",
        ),
      )
      .finally(() => {
        if (preservedError) setError(preservedError);
        setLoading(false);
      });
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackStatus = params.get("admob");
    const callbackMessage = params.get("message");
    const callbackError =
      callbackStatus === "error"
        ? callbackMessage || "AdMob authorization failed"
        : "";
    if (callbackStatus)
      window.history.replaceState({}, "", "/system-admin/admob/");
    load(callbackError);
    // The backend refreshes AdMob hourly. Refreshing this view every minute
    // keeps the admin console current after a manual or scheduled sync.
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [days]);

  const connect = async () => {
    try {
      const result = await api<{ authorizationUrl: string }>("/admob/connect");
      window.location.assign(result.authorizationUrl);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to start AdMob authorization",
      );
    }
  };

  const sync = async () => {
    setSyncing(true);
    setError("");
    try {
      await api(`/admob/sync?days=${Math.max(days, 30)}`, { method: "POST" });
      load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to synchronize AdMob",
      );
    } finally {
      setSyncing(false);
    }
  };

  const disconnect = async () => {
    if (
      !window.confirm(
        "Disconnect the AdMob reporting account? Stored report history will remain available.",
      )
    )
      return;
    try {
      await api("/admob", { method: "DELETE" });
      load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to disconnect AdMob",
      );
    }
  };

  return (
    <Stack spacing={3.5}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" color="primary" label="AdMob reporting" />
            <Chip
              size="small"
              variant="outlined"
              label="Google-authorized · server-side"
            />
            {data?.connected && (
              <Chip
                size="small"
                color={data.syncHealthy ? "success" : "warning"}
                icon={
                  data.syncHealthy ? <CheckCircleRoundedIcon /> : undefined
                }
                label={data.syncHealthy ? "Connected" : "Sync needs attention"}
              />
            )}
          </Stack>
          <Typography variant="h4" fontWeight={850} sx={{ mt: 1.3 }}>
            AdMob analytics
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.7, maxWidth: 900 }}>
            Track the performance and estimated earnings of every SMARTS ad
            placement from the AdMob network report.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Select
            size="small"
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
            sx={{ minWidth: 145 }}
          >
            <MenuItem value={7}>Last 7 days</MenuItem>
            <MenuItem value={30}>Last 30 days</MenuItem>
            <MenuItem value={90}>Last 90 days</MenuItem>
            <MenuItem value={365}>Last 12 months</MenuItem>
          </Select>
          {data?.connected && (
            <Button
              variant="outlined"
              startIcon={
                syncing ? (
                  <CircularProgress size={16} />
                ) : (
                  <AutorenewRoundedIcon />
                )
              }
              onClick={() => void sync()}
              disabled={syncing}
            >
              {syncing ? "Syncing" : "Sync now"}
            </Button>
          )}
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {loading && !data ? (
        <Card sx={{ minHeight: 260, display: "grid", placeItems: "center" }}>
          <CircularProgress />
        </Card>
      ) : !data?.connected ? (
        <ConnectionCard
          status={data?.connection?.status}
          onConnect={() => void connect()}
        />
      ) : (
        <>
          <ConnectionBanner
            data={data}
            onReconnect={() => void connect()}
            onDisconnect={() => void disconnect()}
          />
          <Grid container spacing={1.5}>
            {[
              [
                "Ad requests",
                count(data.kpis.adRequests),
                "Requests sent to AdMob",
                <AssessmentRoundedIcon />,
                "#8b7dff",
              ],
              [
                "Matched requests",
                count(data.kpis.matchedRequests),
                `${percent(data.kpis.matchRate)} match rate`,
                <InsightsRoundedIcon />,
                "#52c7f5",
              ],
              [
                "Impressions",
                count(data.kpis.impressions),
                `${percent(data.kpis.showRate)} show rate`,
                <VisibilityRoundedIcon />,
                "#45d5a2",
              ],
              [
                "Clicks",
                count(data.kpis.clicks),
                `${percent(data.kpis.impressionCtr)} impression CTR`,
                <AdsClickRoundedIcon />,
                "#f4c95d",
              ],
              [
                "Estimated earnings",
                money(data.kpis.estimatedEarnings, currency),
                `${currency} · AdMob report`,
                <AttachMoneyRoundedIcon />,
                "#c58cff",
              ],
              [
                "Impression RPM",
                money(data.kpis.impressionRpm, currency),
                "Estimated earnings per 1,000 impressions",
                <AttachMoneyRoundedIcon />,
                "#45d5a2",
              ],
              [
                "Verified rewards",
                count(data.kpis.grantedRewardClaims),
                `${count(data.kpis.rewardClaims)} server ad claims`,
                <CheckCircleRoundedIcon />,
                "#52c7f5",
              ],
            ].map(([label, value, caption, icon, color]) => (
              <Grid key={String(label)} size={{ xs: 12, sm: 6, md: 4, lg: 2 }}>
                <Metric
                  label={String(label)}
                  value={String(value)}
                  caption={String(caption)}
                  icon={icon as React.ReactNode}
                  color={String(color)}
                />
              </Grid>
            ))}
          </Grid>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, lg: 8 }}>
              <ReportCard
                title="Daily AdMob performance"
                subtitle={`Network report totals · ${data.period.days} days · ${currency}`}
              >
                <DailyChart data={data} currency={currency} />
              </ReportCard>
            </Grid>
            <Grid size={{ xs: 12, lg: 4 }}>
              <ReportCard
                title="Revenue summary"
                subtitle="Estimated earnings from the synchronized report."
              >
                <Stack spacing={1.5}>
                  {[
                    [
                      "Estimated earnings",
                      money(data.kpis.estimatedEarnings, currency),
                    ],
                    ["Impressions", count(data.kpis.impressions)],
                    ["Clicks", count(data.kpis.clicks)],
                    ["CTR", percent(data.kpis.impressionCtr)],
                    ["Match rate", percent(data.kpis.matchRate)],
                    ["Show rate", percent(data.kpis.showRate)],
                    [
                      "Verified rewards",
                      `${count(data.kpis.grantedRewardClaims)} / ${count(data.kpis.rewardClaims)}`,
                    ],
                  ].map(([label, value]) => (
                    <Stack
                      key={label}
                      direction="row"
                      justifyContent="space-between"
                    >
                      <Typography color="text.secondary">{label}</Typography>
                      <Typography fontWeight={850}>{value}</Typography>
                    </Stack>
                  ))}
                </Stack>
              </ReportCard>
            </Grid>
          </Grid>
          <Grid container spacing={2}>
            <Breakdown
              title="Applications"
              rows={data.apps}
              currency={currency}
            />
            <Breakdown
              title="Ad formats"
              rows={data.formats}
              currency={currency}
            />
            <Breakdown
              title="Countries"
              rows={data.countries}
              currency={currency}
            />
            <Breakdown
              title="Ad units"
              rows={data.adUnits}
              currency={currency}
            />
          </Grid>
        </>
      )}
    </Stack>
  );
}

function ConnectionCard({
  status,
  onConnect,
}: {
  status?: string;
  onConnect: () => void;
}) {
  return (
    <Card>
      <CardContent sx={{ py: { xs: 5, md: 8 }, textAlign: "center" }}>
        <CloudOffRoundedIcon sx={{ fontSize: 58, color: "text.secondary" }} />
        <Typography variant="h5" fontWeight={850} sx={{ mt: 1.5 }}>
          Connect your AdMob account
        </Typography>
        <Typography
          color="text.secondary"
          sx={{ maxWidth: 600, mx: "auto", mt: 1 }}
        >
          Authorize the Google account that owns your AdMob publisher account.
          SMARTS will import read-only performance and earnings reports into
          Railway.
        </Typography>
        {status && status !== "DISCONNECTED" && (
          <Alert
            severity="warning"
            sx={{ maxWidth: 650, mx: "auto", mt: 2, textAlign: "left" }}
          >
            The previous AdMob connection is {status.toLowerCase()}. Reconnect
            to resume reporting.
          </Alert>
        )}
        <Button
          variant="contained"
          size="large"
          onClick={onConnect}
          sx={{ mt: 3 }}
        >
          Connect AdMob with Google
        </Button>
        <Typography
          variant="caption"
          display="block"
          color="text.secondary"
          sx={{ mt: 2 }}
        >
          Read-only AdMob reporting scopes are used. Tokens stay on the NestJS
          server.
        </Typography>
      </CardContent>
    </Card>
  );
}

function ConnectionBanner({
  data,
  onReconnect,
  onDisconnect,
}: {
  data: AdMobAnalytics;
  onReconnect: () => void;
  onDisconnect: () => void;
}) {
  const connection = data.connection!;
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction={{ xs: "column", md: "row" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 42,
                height: 42,
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                bgcolor: "rgba(69,213,162,.15)",
                color: "success.main",
              }}
            >
              <CheckCircleRoundedIcon />
            </Box>
            <Box>
              <Typography fontWeight={850}>
                {connection.googleAccountEmail || "Google AdMob account"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {connection.publisherId} · {connection.currencyCode || "USD"} ·{" "}
                {connection.reportingTimezone || "account timezone"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Last sync:{" "}
                {connection.lastSyncAt
                  ? new Date(connection.lastSyncAt).toLocaleString()
                  : "Not synchronized yet"}
              </Typography>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button size="small" onClick={onReconnect}>
              Reconnect
            </Button>
            <Button size="small" color="error" onClick={onDisconnect}>
              Disconnect
            </Button>
          </Stack>
        </Stack>
        {connection.lastSyncError && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Last synchronization issue: {connection.lastSyncError}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
  caption,
  icon,
  color,
}: {
  label: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <Card sx={{ p: 2, height: "100%" }}>
      <Box
        sx={{
          width: 38,
          height: 38,
          display: "grid",
          placeItems: "center",
          borderRadius: 2.5,
          bgcolor: `${color}22`,
          color,
        }}
      >
        {icon}
      </Box>
      <Typography variant="h5" fontWeight={850} sx={{ mt: 1.5 }}>
        {value}
      </Typography>
      <Typography fontWeight={750}>{label}</Typography>
      <Typography variant="caption" color="text.secondary">
        {caption}
      </Typography>
    </Card>
  );
}

function ReportCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" fontWeight={850}>
          {title}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ mt: 0.4, mb: 2.2 }}
        >
          {subtitle}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

function DailyChart({
  data,
  currency,
}: {
  data: AdMobAnalytics;
  currency: string;
}) {
  if (!data.trends.length)
    return (
      <Typography color="text.secondary" sx={{ py: 6, textAlign: "center" }}>
        No AdMob report rows have been synchronized for this period.
      </Typography>
    );
  const width = 900;
  const height = 260;
  const left = 46;
  const right = 18;
  const top = 18;
  const bottom = 34;
  const maxImpressions = Math.max(
    ...data.trends.map((row) => row.impressions),
    1,
  );
  const maxRevenue = Math.max(
    ...data.trends.map((row) => row.estimatedEarnings),
    0.000001,
  );
  const x = (index: number) =>
    left +
    (index / Math.max(data.trends.length - 1, 1)) * (width - left - right);
  const yCount = (value: number) =>
    height - bottom - (value / maxImpressions) * (height - top - bottom);
  const yRevenue = (value: number) =>
    height - bottom - (value / maxRevenue) * (height - top - bottom);
  const label = (value: string) =>
    new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  return (
    <Stack spacing={1.2}>
      <Box sx={{ width: "100%", overflow: "hidden" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          role="img"
          aria-label="AdMob impressions and estimated revenue by day"
        >
          <line
            x1={left}
            x2={width - right}
            y1={height - bottom}
            y2={height - bottom}
            stroke="rgba(148,163,184,.25)"
          />
          <polyline
            fill="none"
            stroke="#45d5a2"
            strokeWidth="3"
            points={data.trends
              .map((row, index) => `${x(index)},${yCount(row.impressions)}`)
              .join(" ")}
          />
          <polyline
            fill="none"
            stroke="#c58cff"
            strokeWidth="3"
            points={data.trends
              .map(
                (row, index) =>
                  `${x(index)},${yRevenue(row.estimatedEarnings)}`,
              )
              .join(" ")}
          />
          {data.trends.map((row, index) =>
            index === 0 ||
            index === data.trends.length - 1 ||
            index === Math.floor(data.trends.length / 2) ? (
              <text
                key={row.date}
                x={x(index)}
                y={height - 8}
                textAnchor={
                  index === 0
                    ? "start"
                    : index === data.trends.length - 1
                      ? "end"
                      : "middle"
                }
                fill="#91a0b8"
                fontSize="11"
              >
                {label(row.date)}
              </text>
            ) : null,
          )}
        </svg>
      </Box>
      <Stack direction="row" spacing={2}>
        <Stack direction="row" spacing={0.7} alignItems="center">
          <Box
            sx={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              bgcolor: "#45d5a2",
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Impressions (max {count(maxImpressions)})
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.7} alignItems="center">
          <Box
            sx={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              bgcolor: "#c58cff",
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Revenue (max {money(maxRevenue, currency)})
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}

function Breakdown({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: AdMobBreakdownRow[];
  currency: string;
}) {
  const total = useMemo(
    () => rows.reduce((sum, row) => sum + row.estimatedEarnings, 0),
    [rows],
  );
  return (
    <Grid size={{ xs: 12, lg: 6 }}>
      <ReportCard
        title={title}
        subtitle={`${rows.length} report dimensions · ${money(total, currency)} estimated earnings`}
      >
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>
                  {title === "Countries"
                    ? "Country"
                    : title === "Ad units"
                      ? "Ad unit"
                      : title.slice(0, -1)}
                </TableCell>
                <TableCell align="right">Impressions</TableCell>
                <TableCell align="right">Clicks</TableCell>
                <TableCell align="right">Earnings</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length ? (
                rows.slice(0, 15).map((row) => (
                  <TableRow key={row.key} hover>
                    <TableCell>
                      <Typography fontWeight={750}>{row.label}</Typography>
                      {row.key !== row.label && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ wordBreak: "break-all" }}
                        >
                          {row.key}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {count(row.impressions)}
                    </TableCell>
                    <TableCell align="right">{count(row.clicks)}</TableCell>
                    <TableCell align="right">
                      {money(row.estimatedEarnings, currency)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    <Typography color="text.secondary" sx={{ py: 3 }}>
                      No data
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <Divider sx={{ mt: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Showing up to 15 dimensions. Use AdMob for the complete raw report
          export.
        </Typography>
      </ReportCard>
    </Grid>
  );
}
