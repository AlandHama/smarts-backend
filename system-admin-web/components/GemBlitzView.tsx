"use client";

import { useEffect, useState } from "react";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import ReplayRoundedIcon from "@mui/icons-material/ReplayRounded";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import { api } from "../lib/api";

export function GemBlitzView() {
  const [data, setData] = useState<any>(null);
  const [ops, setOps] = useState<any>(null);
  const [policy, setPolicy] = useState<any>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    try { const [value, operations] = await Promise.all([api<any>("/gem-blitz/policy"), api<any>("/gem-blitz/operations")]); setData(value); setOps(operations); setPolicy(value.policy); } catch (e) { setError(String(e)); }
  };
  useEffect(() => { void load(); }, []);
  const save = async () => { try { const value = await api<any>("/gem-blitz/policy", { method: "PATCH", body: JSON.stringify({ policy, reason: "Updated Gem Blitz policy" }) }); setMessage(`Policy v${value.version} activated for new matches.`); await load(); } catch (e) { setError(String(e)); } };
  const update = (key: string, value: any) => setPolicy((current: any) => ({ ...current, [key]: value }));
  if (!data) return <Typography sx={{ p: 4 }}>Loading Gem Blitz…</Typography>;
  return <Stack spacing={3} sx={{ p: { xs: 2, md: 5 }, maxWidth: 1250, mx: "auto" }}>
    <Stack direction="row" spacing={2} alignItems="center"><AutoAwesomeRoundedIcon color="primary" sx={{ fontSize: 42 }} /><BoxTitle /></Stack>
    {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
    <Grid container spacing={2}>{[["Active matches", ops?.activeMatches], ["Settled matches", ops?.settledMatches], ["Bot participants", ops?.botParticipants], ["Accepted moves", ops?.acceptedMoves], ["Rejected moves", ops?.rejectedMoves]].map(([label, value]) => <Grid item xs={6} md={2.4} key={String(label)}><Card><CardContent><Typography color="text.secondary" variant="overline">{label}</Typography><Typography variant="h4" fontWeight={900}>{value ?? "—"}</Typography></CardContent></Card></Grid>)}</Grid>
    <Card><CardContent><Stack spacing={3}><Typography variant="h5" fontWeight={900}>Authoritative policy</Typography><Typography color="text.secondary">Every save creates an immutable version. Active matches keep the policy captured when they started.</Typography><Stack direction={{ xs: "column", md: "row" }} spacing={2}><FormControlLabel control={<Switch checked={Boolean(policy.enabled)} onChange={(e) => update("enabled", e.target.checked)} />} label="Enabled" /><FormControlLabel control={<Switch checked={Boolean(policy.casualEnabled)} onChange={(e) => update("casualEnabled", e.target.checked)} />} label="Casual" /><FormControlLabel control={<Switch checked={Boolean(policy.rankedEnabled)} onChange={(e) => update("rankedEnabled", e.target.checked)} />} label="Ranked" /></Stack><Grid container spacing={2}><Grid item xs={6} md={3}><TextField fullWidth label="Board size" type="number" value={policy.boardSize ?? 7} onChange={(e) => update("boardSize", Number(e.target.value))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Duration seconds" type="number" value={policy.durationSeconds ?? 75} onChange={(e) => update("durationSeconds", Number(e.target.value))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Rules version" value={policy.rulesVersion ?? "gem-blitz.v1"} onChange={(e) => update("rulesVersion", e.target.value)} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Score cap" type="number" value={policy.scoring?.scoreCap ?? 250000} onChange={(e) => setPolicy((p: any) => ({ ...p, scoring: { ...p.scoring, scoreCap: Number(e.target.value) } }))} /></Grid></Grid><Stack direction="row" justifyContent="flex-end"><Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={save}>Save new policy version</Button></Stack></Stack></CardContent></Card>
    <Card><CardContent><Stack spacing={2}><Typography variant="h5" fontWeight={900}>Bot-fill policy</Typography><Grid container spacing={2}><Grid item xs={6} md={3}><TextField fullWidth label="Reaction delay (ms)" type="number" value={policy.bot?.reactionDelayMs ?? 1200} onChange={(e) => setPolicy((p: any) => ({ ...p, bot: { ...p.bot, reactionDelayMs: Number(e.target.value) } }))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Jitter (ms)" type="number" value={policy.bot?.jitterMs ?? 900} onChange={(e) => setPolicy((p: any) => ({ ...p, bot: { ...p.bot, jitterMs: Number(e.target.value) } }))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Skill 0–1" type="number" inputProps={{ min: 0, max: 1, step: 0.01 }} value={policy.bot?.skill ?? 0.62} onChange={(e) => setPolicy((p: any) => ({ ...p, bot: { ...p.bot, skill: Number(e.target.value) } }))} /></Grid><Grid item xs={6} md={3}><TextField fullWidth label="Maximum moves" type="number" value={policy.bot?.maxMoves ?? 55} onChange={(e) => setPolicy((p: any) => ({ ...p, bot: { ...p.bot, maxMoves: Number(e.target.value) } }))} /></Grid></Grid></Stack></CardContent></Card>
    <Card><CardContent><Stack spacing={1}><Typography variant="h5" fontWeight={900}>Policy history</Typography>{data.versions.map((version: any) => <Stack key={version.version} direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}><Typography>Version {version.version} {version.active ? "• ACTIVE" : ""}</Typography>{!version.active && <Button size="small" startIcon={<ReplayRoundedIcon />} onClick={async () => { await api(`/gem-blitz/policy/rollback/${version.version}`, { method: "POST" }); await load(); setMessage(`Rolled back from version ${version.version}.`); }}>Rollback</Button>}</Stack>)}</Stack></CardContent></Card>
    <Card><CardContent><Stack spacing={1}><Typography variant="h5" fontWeight={900}>Recent matches</Typography>{(ops?.recentMatches ?? []).map((match: any) => <Stack key={match.id} direction="row" justifyContent="space-between" sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}><Typography fontFamily="monospace">{match.id.slice(0, 8)}…</Typography><Typography>{match.mode}</Typography><Typography>{match.status} · policy v{match.gameConfig?.version ?? "—"}</Typography><Typography>{match.settlement ? "SETTLED" : "UNSETTLED"}</Typography></Stack>)}</Stack></CardContent></Card>
  </Stack>;
}
function BoxTitle() { return <div><Typography variant="overline" color="text.secondary">GAME OPERATIONS</Typography><Typography variant="h3" fontWeight={900}>Gem Blitz</Typography><Typography color="text.secondary">Authoritative match-3 progression, bots, policy versions, and settlement health.</Typography></div>; }
