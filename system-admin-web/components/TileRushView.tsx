"use client";

import { useEffect, useState } from "react";
import RouteRoundedIcon from "@mui/icons-material/RouteRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
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
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "../lib/api";

type TileRushData = { definition: any; activeVersion: number | null; policy: any; versions: any[] };
type TileRushOperations = { recentMatches: any[]; [key: string]: any };
type TileRushAnalytics = { range: any; totals: any; dimensions?: { chainBuckets?: Record<string, number> }; series: Array<{ date: string; matches: number; accepted: number; rejected: number; specials: number; combos: number; settled: number }> };

const numberFields = [
  ["boardSize", "Board size", 5, 9], ["tileTypes", "Tile types", 3, 8], ["durationSeconds", "Duration seconds", 30, 180],
  ["minimumChain", "Minimum chain", 3, 5], ["comboWindowMs", "Combo window (ms)", 250, 10000], ["maxComboBonus", "Max combo bonus", 0, .2],
  ["finalRushSeconds", "Final rush seconds", 0, 30], ["finalRushMultiplier", "Final rush multiplier", .5, 2], ["special5Threshold", "Blast threshold", 3, 81],
  ["special7Threshold", "Lightning threshold", 3, 81], ["prismThreshold", "Prism threshold", 3, 81], ["loopMinimumLength", "Loop minimum length", 4, 81],
  ["scoreCap", "Score cap", 1000, 10000000], ["maxActionsPerSecond", "Max actions / second", 1, 20],
];

export function TileRushView() {
  const [tab, setTab] = useState(0);
  const [data, setData] = useState<TileRushData | null>(null);
  const [operations, setOperations] = useState<TileRushOperations | null>(null);
  const [analytics, setAnalytics] = useState<TileRushAnalytics | null>(null);
  const [policy, setPolicy] = useState<any>({});
  const [mode, setMode] = useState("ALL");
  const [from, setFrom] = useState(() => isoDate(-30));
  const [to, setTo] = useState(() => isoDate(0));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [replay, setReplay] = useState<any>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const query = new URLSearchParams({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z`, ...(mode === "ALL" ? {} : { mode }) }).toString();
      const [value, ops, report] = await Promise.all([
        api<TileRushData>("/tile-rush/policy"),
        api<TileRushOperations>("/tile-rush/operations"),
        api<TileRushAnalytics>(`/tile-rush/analytics?${query}`),
      ]);
      setData(value); setOperations(ops); setAnalytics(report); setPolicy(value.policy);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load Tile Rush operations"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [from, to, mode]);

  const set = (key: string, value: any) => setPolicy((current: any) => ({ ...current, [key]: value }));
  const setNested = (group: string, key: string, value: any) => setPolicy((current: any) => ({ ...current, [group]: { ...(current[group] || {}), [key]: value } }));
  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const value = await api<any>("/tile-rush/policy", { method: "PATCH", body: JSON.stringify({ policy, reason: "Updated Tile Rush production policy" }) });
      setMessage(`Policy v${value.version} activated for new matches.`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save Tile Rush policy"); }
    finally { setSaving(false); }
  };
  const rollback = async (version: number) => { try { await api(`/tile-rush/policy/rollback/${version}`, { method: "POST" }); setMessage(`Created a new policy version from v${version}.`); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to rollback policy"); } };
  const inspect = async (id: string) => { try { setReplay(await api(`/tile-rush/matches/${id}/replay`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load replay"); } };
  const retry = async (id: string) => { try { await api(`/tile-rush/operations/${id}/retry-settlement`, { method: "POST" }); setMessage("Settlement retry submitted."); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to retry settlement"); } };
  const flag = async (id: string) => { try { await api(`/tile-rush/operations/${id}/review`, { method: "POST", body: JSON.stringify({ reason: "Flagged from Tile Rush operations" }) }); setMessage("Match flagged for review."); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to flag match"); } };

  if (loading && !data) return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  if (!data) return <Alert severity="error">{error || "Tile Rush configuration unavailable"}</Alert>;
  const bot = policy.bot || {};
  const scoring = policy.scoring || {};
  return <Stack spacing={3}>
    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center"><RouteRoundedIcon color="primary" sx={{ fontSize: 44 }} /><Box><Typography variant="overline" color="text.secondary">GAME OPERATIONS · AUTHORITATIVE</Typography><Typography variant="h3" fontWeight={900}>Tile Rush</Typography><Typography color="text.secondary">Balance policy, match health, replay evidence, fraud signals, and settlement recovery.</Typography></Box></Stack>
      <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => void load()}>Refresh</Button>
    </Stack>
    {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}{message && <Alert severity="success" onClose={() => setMessage("")}>{message}</Alert>}
    <Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab label="Policy" /><Tab label="Operations" /><Tab label="Analytics" /><Tab label="Replay & risk" /></Tabs>
    {tab === 0 && <PolicyPanel policy={policy} set={set} setNested={setNested} bot={bot} scoring={scoring} save={save} saving={saving} versions={data.versions} rollback={rollback} />}
    {tab === 1 && <OperationsPanel operations={operations} inspect={inspect} retry={retry} flag={flag} />}
    {tab === 2 && <AnalyticsPanel analytics={analytics} mode={mode} setMode={setMode} from={from} setFrom={setFrom} to={to} setTo={setTo} />}
    {tab === 3 && <ReplayPanel replay={replay} inspect={inspect} recent={operations?.recentMatches || []} />}
  </Stack>;
}

function PolicyPanel({ policy, set, setNested, bot, scoring, save, saving, versions, rollback }: any) {
  return <Stack spacing={2.5}>
    <Card><CardContent><Stack spacing={2.5}><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between"><Box><Typography variant="h5" fontWeight={900}>Versioned authoritative policy</Typography><Typography color="text.secondary">Every save creates an immutable version. Active matches keep their captured settings.</Typography></Box><Stack direction="row"><FormControlLabel control={<Switch checked={Boolean(policy.enabled)} onChange={(e) => set("enabled", e.target.checked)} />} label="Enabled" /><FormControlLabel control={<Switch checked={Boolean(policy.casualEnabled)} onChange={(e) => set("casualEnabled", e.target.checked)} />} label="Casual" /><FormControlLabel control={<Switch checked={Boolean(policy.rankedEnabled)} onChange={(e) => set("rankedEnabled", e.target.checked)} />} label="Ranked" /></Stack></Stack><Grid container spacing={2}>{numberFields.map(([key, label, min, max]) => <Grid item xs={6} md={3} key={key}><TextField fullWidth label={label} type="number" value={policy[key] ?? ""} inputProps={{ min, max, step: typeof min === "number" && min < 1 ? .01 : 1 }} onChange={(e) => set(key, Number(e.target.value))} /></Grid>)}<Grid item xs={12} md={3}><TextField fullWidth label="Visible name" value={policy.visibleName || "Tile Rush"} onChange={(e) => set("visibleName", e.target.value)} /></Grid><Grid item xs={12} md={3}><TextField fullWidth label="Rules version" value={policy.rulesVersion || "tile-rush.v1"} onChange={(e) => set("rulesVersion", e.target.value)} /></Grid><Grid item xs={12} md={6}><TextField fullWidth label="Description" value={policy.description || ""} onChange={(e) => set("description", e.target.value)} /></Grid></Grid><Stack direction={{ xs: "column", md: "row" }} spacing={2}><FormControlLabel control={<Switch checked={Boolean(policy.loopsEnabled)} onChange={(e) => set("loopsEnabled", e.target.checked)} />} label="Loops / Color Crush" /><FormControlLabel control={<Switch checked={Boolean(policy.rankedBotFallback)} onChange={(e) => set("rankedBotFallback", e.target.checked)} />} label="Allow ranked bot fallback" /></Stack></Stack></CardContent></Card>
    <Card><CardContent><Stack spacing={2}><Typography variant="h5" fontWeight={900}>Bot balancing</Typography><Typography color="text.secondary">Bots use the same authoritative path engine. Keep ranked fallback disabled unless explicitly approved.</Typography><Grid container spacing={2}><Grid item xs={6} md={3}><TextField fullWidth label="Reaction delay (ms)" type="number" value={bot.reactionDelayMs ?? ""} onChange={(e) => setNested("bot", "reactionDelayMs", Number(e.target.value))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Jitter (ms)" type="number" value={bot.jitterMs ?? ""} onChange={(e) => setNested("bot", "jitterMs", Number(e.target.value))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Skill 0–1" type="number" value={bot.skill ?? ""} inputProps={{ min: 0, max: 1, step: .01 }} onChange={(e) => setNested("bot", "skill", Number(e.target.value))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Max actions" type="number" value={bot.maxActions ?? ""} onChange={(e) => setNested("bot", "maxActions", Number(e.target.value))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Error rate" type="number" value={bot.errorRate ?? ""} inputProps={{ min: 0, max: .8, step: .01 }} onChange={(e) => setNested("bot", "errorRate", Number(e.target.value))} /></Grid></Grid></Stack></CardContent></Card>
    <Card><CardContent><Stack spacing={2}><Typography variant="h5" fontWeight={900}>Scoring and refill</Typography><Grid container spacing={2}><Grid item xs={12} md={4}><TextField fullWidth label="Cascade multipliers (JSON)" value={JSON.stringify(scoring.cascadeMultipliers || [])} onChange={(e) => { try { setNested("scoring", "cascadeMultipliers", JSON.parse(e.target.value)); } catch { /* validation runs on save */ } }} /></Grid><Grid item xs={12} md={4}><TextField fullWidth label="Chain table (JSON)" value={JSON.stringify(scoring.chainTable || {})} onChange={(e) => { try { setNested("scoring", "chainTable", JSON.parse(e.target.value)); } catch { /* validation runs on save */ } }} /></Grid><Grid item xs={12} md={4}><TextField fullWidth label="Special bonuses (JSON)" value={JSON.stringify(scoring.specialBonuses || {})} onChange={(e) => { try { setNested("scoring", "specialBonuses", JSON.parse(e.target.value)); } catch { /* validation runs on save */ } }} /></Grid><Grid item xs={12} md={4}><TextField fullWidth label="Refill cascade limit" type="number" value={scoring.refillCascadeLimit ?? ""} onChange={(e) => setNested("scoring", "refillCascadeLimit", Number(e.target.value))} /></Grid></Grid><Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={() => void save()} disabled={saving} sx={{ alignSelf: "flex-end" }}>{saving ? "Saving…" : "Save new policy version"}</Button></Stack></CardContent></Card>
    <Card><CardContent><Typography variant="h5" fontWeight={900}>Policy history</Typography><Stack spacing={1} sx={{ mt: 2 }}>{versions.map((version: any) => <Stack key={version.version} direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}><Box><Typography fontWeight={750}>Version {version.version} {version.active ? "· ACTIVE" : ""}</Typography><Typography variant="caption" color="text.secondary">{version.createdAt ? new Date(version.createdAt).toLocaleString() : ""}</Typography></Box>{!version.active && <Button size="small" startIcon={<ReplayRoundedIcon />} onClick={() => void rollback(version.version)}>Rollback as new version</Button>}</Stack>)}</Stack></CardContent></Card>
  </Stack>;
}

function OperationsPanel({ operations, inspect, retry, flag }: any) {
  if (!operations) return <CircularProgress />;
  const cards = [["Active", operations.activeMatches], ["Searching", operations.searchingMatches], ["Finished", operations.finishedMatches], ["Review", operations.reviewMatches], ["Cancelled", operations.cancelledMatches], ["Settled", operations.settledMatches], ["Unsettled", operations.unfinishedUnsettled], ["Bots", operations.botParticipants], ["Hash mismatches", operations.boardHashMismatches], ["Avg chain", operations.averageChain], ["Best chain", operations.bestChain], ["Color Crush", operations.specialCounts?.TILE_RUSH_COLOR_CRUSH || 0], ["Special effects", operations.specialCounts?.TILE_RUSH_SPECIAL_CREATED || 0]];
  return <Stack spacing={2.5}><Grid container spacing={2}>{cards.map(([name, value]) => <Grid item xs={6} md={2.4} key={String(name)}><Card sx={{ p: 2.5 }}><Typography variant="overline" color="text.secondary">{name}</Typography><Typography variant="h4" fontWeight={900}>{value ?? "—"}</Typography></Card></Grid>)}</Grid><Card><CardContent><Typography variant="h5" fontWeight={900}>Action health</Typography><Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ mt: 2 }}><Metric label="Accepted actions" value={operations.acceptedActions} /><Metric label="Rejected actions" value={operations.rejectedActions} /><Metric label="Max combo" value={operations.maxCombo} /><Metric label="Settlement retry failures" value={operations.settlementRetryFailures} /><Box><Typography variant="body2" color="text.secondary">Rejection reasons</Typography>{Object.entries(operations.rejectionReasons || {}).map(([key, value]) => <Chip key={key} size="small" label={`${key}: ${value}`} sx={{ mr: .5, mt: .5 }} />)}</Box><Box><Typography variant="body2" color="text.secondary">Bot skill distribution</Typography>{Object.entries(operations.botSkillDistribution || {}).map(([key, value]) => <Chip key={key} size="small" label={`${key}: ${value}`} sx={{ mr: .5, mt: .5 }} />)}</Box></Stack></CardContent></Card><Card><CardContent><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h5" fontWeight={900}>Recent matches</Typography><Typography color="text.secondary">Inspect state hashes and retry or flag lifecycle problems.</Typography></Box></Stack><Stack spacing={1} sx={{ mt: 2 }}>{(operations.recentMatches || []).map((match: any) => <Stack key={match.id} direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}><Typography fontFamily="monospace" sx={{ minWidth: 105 }}>{match.id.slice(0, 8)}…</Typography><Chip size="small" label={match.mode} /><Typography sx={{ flex: 1 }}>{match.status} · policy v{match.gameConfig?.version ?? "—"} · {match.participants?.map((participant: any) => `${participant.finalScore ?? "0"} ${participant.result ?? "PENDING"}`).join(" vs ")} · {match.settlement ? "SETTLED" : "UNSETTLED"}</Typography><Button size="small" startIcon={<SearchRoundedIcon />} onClick={() => void inspect(match.id)}>Inspect</Button>{!match.settlement && ["FINISHED", "REVIEW"].includes(match.status) && <Button size="small" onClick={() => void retry(match.id)}>Retry settlement</Button>}{match.status !== "SETTLED" && <Button size="small" color="warning" onClick={() => void flag(match.id)}>Flag review</Button>}</Stack>)}</Stack></CardContent></Card></Stack>;
}

function AnalyticsPanel({ analytics, mode, setMode, from, setFrom, to, setTo }: any) {
  if (!analytics) return <CircularProgress />;
  const max = Math.max(1, ...analytics.series.map((item: any) => Math.max(item.matches, item.accepted, item.settled)));
  return <Stack spacing={2.5}><Paper sx={{ p: 2.5 }}><Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}><TextField type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} /><TextField type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} /><Select value={mode} onChange={(e) => setMode(e.target.value)}><MenuItem value="ALL">All modes</MenuItem><MenuItem value="CASUAL">Casual</MenuItem><MenuItem value="RANKED">Ranked</MenuItem><MenuItem value="BOT">Bot</MenuItem></Select><Chip label={`${analytics.range.from.slice(0, 10)} → ${analytics.range.to.slice(0, 10)}`} color="primary" /></Stack></Paper><Grid container spacing={2}>{[["Matches started", analytics.totals.matchesStarted], ["Settled", analytics.totals.matchesSettled], ["Settlement rate", `${analytics.totals.settlementRate}%`], ["Accepted actions", analytics.totals.acceptedActions], ["Rejection rate", `${analytics.totals.rejectionRate}%`], ["Average chain", analytics.totals.averageChain], ["Special rate", `${analytics.totals.specialRate}%`], ["Hash mismatches", analytics.totals.boardHashMismatches]].map(([label, value]) => <Grid item xs={6} md={3} key={String(label)}><Card sx={{ p: 2.5 }}><Typography color="text.secondary">{label}</Typography><Typography variant="h4" fontWeight={900}>{value}</Typography></Card></Grid>)}</Grid><Card><CardContent><Typography variant="h5" fontWeight={900}>Daily match and action trend</Typography><Box sx={{ display: "flex", gap: 1, alignItems: "end", height: 220, overflowX: "auto", mt: 3, pb: 3 }}>{analytics.series.map((item: TileRushAnalytics["series"][number]) => <Box key={item.date} sx={{ minWidth: 34, height: "100%", display: "flex", alignItems: "end", gap: .3 }} title={`${item.date}: ${item.matches} matches · ${item.accepted} accepted · ${item.rejected} rejected`}><Box sx={{ width: 8, height: `${Math.max(4, item.matches / max * 100)}%`, bgcolor: "primary.main", borderRadius: 1 }} /><Box sx={{ width: 8, height: `${Math.max(4, item.accepted / max * 100)}%`, bgcolor: "success.main", borderRadius: 1 }} /><Box sx={{ width: 8, height: `${Math.max(4, item.rejected / max * 100)}%`, bgcolor: "error.main", borderRadius: 1 }} /></Box>)}</Box><Stack direction="row" spacing={2}><Legend color="primary.main" label="Matches" /><Legend color="success.main" label="Accepted" /><Legend color="error.main" label="Rejected" /></Stack></CardContent></Card><Card><CardContent><Typography variant="h5" fontWeight={900}>Chain-length distribution</Typography><Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mt: 2 }}>{Object.entries(analytics.dimensions?.chainBuckets || {}).map(([label, value]) => <Box key={label} sx={{ flex: 1, p: 2, borderRadius: 2, bgcolor: "action.hover" }}><Typography color="text.secondary">{label} tiles</Typography><Typography variant="h4" fontWeight={900}>{String(value)}</Typography></Box>)}</Stack></CardContent></Card></Stack>;
}

function ReplayPanel({ replay, inspect, recent }: any) {
  return <Stack spacing={2.5}><Card><CardContent><Typography variant="h5" fontWeight={900}>Replay and hash inspection</Typography><Typography color="text.secondary">Select a recent match to inspect the captured policy, bounded replay, accepted events, and settlement. This is read-only evidence for review.</Typography><Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 2 }}>{recent.slice(0, 20).map((match: any) => <Button key={match.id} size="small" variant="outlined" onClick={() => void inspect(match.id)}>{match.id.slice(0, 8)}…</Button>)}</Stack></CardContent></Card>{replay && <Card><CardContent><Stack direction="row" justifyContent="space-between"><Typography variant="h5" fontWeight={900}>Match {replay.match?.id?.slice(0, 12)}…</Typography><Chip label={replay.match?.status || "UNKNOWN"} /></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Mode {replay.match?.mode} · Policy v{replay.match?.policyVersion} · {replay.events?.length || 0} persisted events · {replay.replay?.length || 0} replay entries</Typography><Box component="pre" sx={{ mt: 2, maxHeight: 520, overflow: "auto", p: 2, borderRadius: 2, bgcolor: "#0b1020", color: "#b9c7e8", fontSize: 12 }}>{JSON.stringify(replay, null, 2)}</Box></CardContent></Card>}</Stack>;
}

function Metric({ label, value }: { label: string; value: any }) { return <Box><Typography variant="body2" color="text.secondary">{label}</Typography><Typography variant="h6" fontWeight={900}>{value ?? "—"}</Typography></Box>; }
function Legend({ color, label }: { color: string; label: string }) { return <Stack direction="row" spacing={.5} alignItems="center"><Box sx={{ width: 10, height: 10, borderRadius: 1, bgcolor: color }} /><Typography variant="caption">{label}</Typography></Stack>; }
function isoDate(offset: number) { const date = new Date(Date.now() + offset * 86400000); return date.toISOString().slice(0, 10); }
