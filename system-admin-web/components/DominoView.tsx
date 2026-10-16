"use client";

import { useEffect, useState } from "react";
import CasinoRoundedIcon from "@mui/icons-material/CasinoRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "../lib/api";

const numeric = [
  ["targetScore", "Target score"],
  ["maxRounds", "Maximum rounds"],
  ["roundDurationSeconds", "Round timer (seconds)"],
  ["matchDurationSeconds", "Match timer (seconds)"],
  ["botFallbackDelaySeconds", "Bot fallback delay"],
  ["maxActionsPerSecond", "Actions / second"],
  ["maxDrawActionsPerTurn", "Draws / turn"],
  ["replayRetentionDays", "Replay retention (days)"],
];

export function DominoView() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState<any>(null);
  const [ops, setOps] = useState<any>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [policy, setPolicy] = useState<any>({});
  const [replay, setReplay] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [p, o, a] = await Promise.all([
        api<any>("/domino/policy"),
        api<any>("/domino/operations"),
        api<any>("/domino/analytics"),
      ]);
      setData(p);
      setPolicy(p.policy || {});
      setOps(o);
      setAnalytics(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load Domino operations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  const set = (key: string, value: any) => setPolicy((current: any) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const result = await api<any>("/domino/policy", {
        method: "PATCH",
        body: JSON.stringify({ policy, reason: "Updated Domino policy from system admin" }),
      });
      setMessage(`Domino policy v${result.version} is active for new matches.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save Domino policy");
    } finally {
      setSaving(false);
    }
  };
  const rollback = async (version: number) => {
    try {
      await api(`/domino/policy/rollback/${version}`, { method: "POST" });
      setMessage(`Policy v${version} restored as a new version.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to rollback policy");
    }
  };
  const inspect = async (id: string) => {
    try {
      setReplay(await api(`/domino/matches/${id}/replay`));
      setTab(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load replay");
    }
  };
  const retry = async (id: string) => {
    try {
      await api(`/domino/operations/${id}/retry-settlement`, { method: "POST" });
      setMessage("Settlement retry submitted safely.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to retry settlement");
    }
  };
  const finalize = async (id: string) => {
    try {
      await api(`/domino/operations/${id}/finalize-settlement`, { method: "POST" });
      setMessage("Settlement finalization submitted safely.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to finalize settlement");
    }
  };

  if (loading && !data) return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  if (!data) return <Alert severity="error">{error || "Domino is unavailable"}</Alert>;

  const metric = (label: string, value: any) => (
    <Grid item xs={6} md={3} key={label}>
      <Card sx={{ height: "100%" }}><CardContent><Typography color="text.secondary">{label}</Typography><Typography variant="h4" fontWeight={900}>{String(value ?? "—")}</Typography></CardContent></Card>
    </Grid>
  );

  return <Stack spacing={3}>
    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center"><CasinoRoundedIcon color="primary" sx={{ fontSize: 48 }} /><Box><Typography variant="overline" color="text.secondary">GAME OPERATIONS · SERVER AUTHORITATIVE</Typography><Typography variant="h3" fontWeight={900}>Domino Duel</Typography><Typography color="text.secondary">Four seats, hidden hands, bot fill, replay evidence, and safe settlement operations.</Typography></Box></Stack>
      <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => void load()}>Refresh</Button>
    </Stack>
    {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}
    {message && <Alert severity="success" onClose={() => setMessage("")}>{message}</Alert>}
    <Card><CardContent><Stack direction="row" flexWrap="wrap" spacing={1}><Chip label={policy.enabled ? "Enabled" : "Kill switch active"} color={policy.enabled ? "success" : "error"} /><Chip label={`Policy v${data.activeVersion ?? "—"}`} /><Chip label={`${policy.seatCount || 4} seats`} /><Chip label={`${policy.handSize || 5}-tile hands`} /><Chip label={policy.rankedEnabled ? "Ranked enabled" : "Ranked disabled"} color={policy.rankedEnabled ? "success" : "warning"} /></Stack></CardContent></Card>
    <Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab label="Policy editor" /><Tab label="Operations" /><Tab label="Analytics" /><Tab label="Replay" /></Tabs>
    {tab === 0 && <Stack spacing={2}>
      <Card><CardContent><Stack spacing={2}><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between"><Box><Typography variant="h5" fontWeight={900}>Versioned match policy</Typography><Typography color="text.secondary">Published changes apply to new matches. Active matches keep their captured policy version.</Typography></Box><Stack direction="row" flexWrap="wrap"><FormControlLabel control={<Switch checked={Boolean(policy.enabled)} onChange={(e) => set("enabled", e.target.checked)} />} label="Enabled" /><FormControlLabel control={<Switch checked={Boolean(policy.casualEnabled)} onChange={(e) => set("casualEnabled", e.target.checked)} />} label="Casual" /><FormControlLabel control={<Switch checked={Boolean(policy.rankedEnabled)} onChange={(e) => set("rankedEnabled", e.target.checked)} />} label="Ranked" /><FormControlLabel control={<Switch checked={Boolean(policy.practiceEnabled)} onChange={(e) => set("practiceEnabled", e.target.checked)} />} label="Practice" /><FormControlLabel control={<Switch checked={Boolean(policy.botFillEnabled)} onChange={(e) => set("botFillEnabled", e.target.checked)} />} label="Bot fill" /></Stack></Stack><Grid container spacing={2} sx={{ mt: .5 }}>{numeric.map(([key, label]) => <Grid item xs={6} md={3} key={key}><TextField fullWidth type="number" label={label} value={policy[key] ?? ""} onChange={(e) => set(key, Number(e.target.value))} /></Grid>)}<Grid item xs={12} md={4}><TextField fullWidth label="Visible name" value={policy.visibleName || ""} onChange={(e) => set("visibleName", e.target.value)} /></Grid><Grid item xs={12} md={4}><TextField fullWidth label="Bot difficulty" value={policy.botDifficulty || "NORMAL"} onChange={(e) => set("botDifficulty", e.target.value.toUpperCase())} /></Grid><Grid item xs={12} md={4}><TextField fullWidth label="Rules version" value={policy.rulesVersion || "domino.v1"} onChange={(e) => set("rulesVersion", e.target.value)} /></Grid></Grid><Button sx={{ alignSelf: "flex-end" }} variant="contained" startIcon={<SaveRoundedIcon />} disabled={saving} onClick={() => void save()}>{saving ? "Publishing…" : "Validate & publish"}</Button></Stack></CardContent></Card>
      <Card><CardContent><Typography variant="h5" fontWeight={900}>Policy history and rollback</Typography><Stack spacing={1} sx={{ mt: 2 }}>{(data.versions || []).map((version: any) => <Stack key={version.version} direction="row" justifyContent="space-between" sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}><Typography fontWeight={750}>Version {version.version} {version.active ? "· ACTIVE" : ""}</Typography>{!version.active && <Button size="small" onClick={() => void rollback(version.version)}>Rollback as new version</Button>}</Stack>)}</Stack></CardContent></Card>
    </Stack>}
    {tab === 1 && <Stack spacing={2}><Grid container spacing={2}>{metric("Active matches", ops.activeMatches)}{metric("Waiting", ops.waitingMatches)}{metric("Finished", ops.finishedMatches)}{metric("Unsettled", ops.unsettledMatches)}{metric("Bot seats", ops.botParticipants)}{metric("Accepted actions", ops.acceptedActions)}{metric("Rejected actions", ops.rejectedActions)}{metric("Rejection rate", `${ops.rejectionRate}%`)}{metric("Domino storage", `${ops.storage?.reduce((sum: number, row: any) => sum + Number(row.bytes || 0), 0) || 0} bytes`)}</Grid><Card><CardContent><Typography variant="h5" fontWeight={900}>Active and recent matches</Typography><Typography color="text.secondary" sx={{ mb: 2 }}>Replay exports never expose private hands or the boneyard.</Typography><Stack spacing={1}>{(ops.recentMatches || []).map((match: any) => <Stack key={match.id} direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }} sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 2 }}><Typography fontFamily="monospace">{match.id.slice(0, 12)}…</Typography><Chip size="small" label={match.status} /><Typography sx={{ flex: 1 }}>{match.mode} · {match.participants?.length || 0} seats · chain {match.dominoMatch?.chainHash?.slice(0, 8) || "—"}…</Typography><Button size="small" startIcon={<SearchRoundedIcon />} onClick={() => void inspect(match.id)}>Replay</Button>{!match.settlement && ["FINISHED", "REVIEW"].includes(match.status) && <><Button size="small" onClick={() => void retry(match.id)}>Retry</Button><Button size="small" color="success" onClick={() => void finalize(match.id)}>Finalize</Button></>}</Stack>)}</Stack></CardContent></Card></Stack>}
    {tab === 2 && <Stack spacing={2}><Grid container spacing={2}>{metric("Matches", analytics.totals?.matchesStarted)}{metric("Settled", analytics.totals?.matchesSettled)}{metric("Accepted", analytics.totals?.acceptedActions)}{metric("Rejected", analytics.totals?.rejectedActions)}{metric("Bot fill", `${analytics.totals?.botFillRate || 0}%`)}</Grid><Card><CardContent><Typography variant="h5" fontWeight={900}>Queue, bot, action, completion and settlement analytics</Typography><Box component="pre" sx={{ mt: 2, maxHeight: 440, overflow: "auto", p: 2, bgcolor: "#0b1020", color: "#b9c7e8" }}>{JSON.stringify({ actionTypes: analytics.actionTypes, series: analytics.series }, null, 2)}</Box></CardContent></Card></Stack>}
    {tab === 3 && <Card><CardContent><Typography variant="h5" fontWeight={900}>Replay and incident evidence</Typography><Typography color="text.secondary">Safe replay includes public chain/actions and settlement evidence; private hands and boneyard contents are intentionally removed.</Typography>{replay ? <Box component="pre" sx={{ mt: 2, maxHeight: 650, overflow: "auto", p: 2, bgcolor: "#0b1020", color: "#b9c7e8" }}>{JSON.stringify(replay, null, 2)}</Box> : <Typography sx={{ mt: 2 }} color="text.secondary">Choose Replay from Operations.</Typography>}</CardContent></Card>}
  </Stack>;
}
