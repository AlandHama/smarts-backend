"use client";

import { useEffect, useMemo, useState } from "react";
import { api, downloadFile } from "../lib/api";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Alert from "@mui/material/Alert";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import DownloadRoundedIcon from "@mui/icons-material/DownloadRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";

const reports = [
  ["engagement", "Engagement"], ["gameplay", "Gameplay & matchmaking"], ["progression", "Progression & retention"],
  ["economy", "Economy & monetization"], ["social", "Social & communications"], ["support", "Support operations"],
  ["risk", "Fraud, risk & moderation"], ["platform", "Platform health"],
] as const;

const money = new Set(["credits", "debits", "amount", "volume", "xp"]);
const fmt = (value: unknown, key?: string) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return String(value ?? "—");
  return `${n.toLocaleString(undefined, { maximumFractionDigits: money.has(key || "") ? 2 : 0 })}${money.has(key || "") ? " GLD" : ""}`;
};

export function AnalyticsReportsView() {
  const [tab, setTab] = useState(0);
  const [days, setDays] = useState("30");
  const [resolution, setResolution] = useState("auto");
  const [country, setCountry] = useState("");
  const [platform, setPlatform] = useState("");
  const [report, setReport] = useState<any>(null);
  const [quality, setQuality] = useState<any[]>([]);
  const [saved, setSaved] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<{ rules: any[]; events: any[] }>({ rules: [], events: [] });
  const [playerSearch, setPlayerSearch] = useState("");
  const [players, setPlayers] = useState<any[]>([]);
  const [savedName, setSavedName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const key = reports[tab][0];
  const query = useMemo(() => new URLSearchParams({ days, resolution, ...(country ? { country } : {}), ...(platform ? { platform } : {}) }).toString(), [days, resolution, country, platform]);

  const load = async () => {
    setLoading(true); setMessage(null);
    try { setReport(await api<any>(`/analytics/reports/${key}?${query}`)); setQuality(await api<any[]>("/analytics/data-quality")); const [savedRows, scheduleRows, alertRows] = await Promise.all([api<any[]>("/analytics/saved-reports"), api<any[]>("/analytics/scheduled-reports"), api<{ rules: any[]; events: any[] }>("/analytics/alerts")]); setSaved(savedRows); setSchedules(scheduleRows); setAlerts(alertRows); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load report"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [key, query]);

  const searchPlayers = async () => {
    try { const body = await api<any>(`/analytics/player-explorer?search=${encodeURIComponent(playerSearch)}`); setPlayers(body.rows || []); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to search players"); }
  };
  const save = async () => {
    if (!savedName.trim()) return;
    try { await api("/analytics/saved-reports", { method: "POST", body: JSON.stringify({ name: savedName, reportKey: key, visibility: "PRIVATE", configuration: { days, resolution, country, platform } }) }); setSavedName(""); setMessage("Report saved"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save report"); }
  };
  const queueJson = async () => {
    try { await api("/analytics/exports", { method: "POST", body: JSON.stringify({ reportKey: key, format: "JSON", query: { days, resolution, country, platform } }) }); setMessage("JSON export prepared"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to prepare export"); }
  };
  const acknowledge = async (id: string) => { await api(`/analytics/alerts/events/${id}/acknowledge`, { method: "POST" }); setAlerts((current) => ({ ...current, events: current.events.map((event) => event.id === id ? { ...event, status: "ACKNOWLEDGED" } : event) })); };

  return <Stack spacing={3}>
    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
      <Box><Stack direction="row" spacing={1} alignItems="center"><Chip label="Server-owned data" color="primary" size="small" /><Chip label={report?.freshness || "loading"} size="small" color={report?.freshness === "fresh" ? "success" : "warning"} /></Stack><Typography variant="h3" fontWeight={900} sx={{ mt: 1 }}>Analytics & reports</Typography><Typography color="text.secondary">Feature-level reporting, drill-downs, operations, and trustworthy source timestamps.</Typography></Box>
      <Stack direction="row" spacing={1} alignItems="center"><Button startIcon={<DownloadRoundedIcon />} onClick={() => downloadFile(`/analytics/export.csv?${query}`)}>CSV overview</Button><Button onClick={() => void queueJson()}>Queue JSON</Button><Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => void load()}>Refresh</Button></Stack>
    </Stack>
    <Paper sx={{ p: 1, overflowX: "auto" }}><Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable"><Tab label="Engagement" /><Tab label="Gameplay" /><Tab label="Progression" /><Tab label="Economy" /><Tab label="Social" /><Tab label="Support" /><Tab label="Risk" /><Tab label="Platform" /></Tabs></Paper>
    <Paper sx={{ p: 2 }}><Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}><TextField select label="Range" value={days} onChange={(e) => setDays(e.target.value)} sx={{ minWidth: 150 }}><MenuItem value="7">Last 7 days</MenuItem><MenuItem value="30">Last 30 days</MenuItem><MenuItem value="90">Last 90 days</MenuItem><MenuItem value="365">Last year</MenuItem></TextField><TextField select label="Resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} sx={{ minWidth: 150 }}><MenuItem value="auto">Automatic</MenuItem><MenuItem value="day">Daily</MenuItem><MenuItem value="week">Weekly</MenuItem><MenuItem value="month">Monthly</MenuItem></TextField><TextField label="Country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="US" /><TextField label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="android" /><Box sx={{ flex: 1 }} /><TextField label="Save as" value={savedName} onChange={(e) => setSavedName(e.target.value)} placeholder="Weekly health" /><Button startIcon={<SaveRoundedIcon />} onClick={() => void save()} disabled={!savedName.trim()}>Save</Button></Stack></Paper>
    {message && <Alert severity="info" onClose={() => setMessage(null)}>{message}</Alert>}
    {loading && <Alert severity="info">Refreshing server-owned report…</Alert>}
    {report && <>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2,1fr)", lg: "repeat(4,1fr)" }, gap: 2 }}>{(report.kpis || []).map((item: any) => <Paper key={item.key} sx={{ p: 2.5, background: "linear-gradient(135deg, rgba(139,125,255,.18), rgba(25,35,57,.9))" }}><Typography color="text.secondary" variant="body2">{item.label}</Typography><Typography variant="h4" fontWeight={900} sx={{ mt: 1 }}>{fmt(item.value, item.key)}</Typography><Typography variant="caption" color={item.change >= 0 ? "success.main" : "error.main"}>{item.change >= 0 ? "↑" : "↓"} {fmt(Math.abs(item.change))} vs first bucket</Typography></Paper>)}</Box>
      <Paper sx={{ p: 2.5 }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h6" fontWeight={800}>Trend</Typography><Typography variant="body2" color="text.secondary">{new Date(report.range.from).toLocaleDateString()} — {new Date(report.range.to).toLocaleDateString()} · {report.range.timezone}</Typography></Box><Chip label={`Definition v${report.definitionVersion}`} size="small" /></Stack><Box sx={{ display: "grid", gridTemplateColumns: `repeat(${Math.max((report.trend || []).length, 1)}, minmax(20px, 1fr))`, gap: .5, alignItems: "end", height: 180, mt: 3, overflow: "hidden" }}>{(report.trend || []).map((row: any, i: number) => { const nums = Object.entries(row).filter(([k]) => k !== "bucket").map(([, v]) => Number(v) || 0); const height = Math.min(100, Math.max(8, (Math.max(...nums, 1) / Math.max(...(report.trend || []).flatMap((r: any) => Object.entries(r).filter(([k]) => k !== "bucket").map(([, v]) => Number(v) || 0)), 1)) * 100)); return <Box key={i} title={new Date(row.bucket).toLocaleDateString()} sx={{ height: `${height}%`, bgcolor: "primary.main", borderRadius: "6px 6px 2px 2px", opacity: .55 + i / Math.max((report.trend || []).length * 2, 2) }} />; })}</Box></Paper>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr" }, gap: 2 }}><Paper sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Breakdowns</Typography><Divider sx={{ my: 1.5 }} />{(report.breakdowns || []).slice(0, 12).map((row: any, index: number) => <Stack key={index} direction="row" justifyContent="space-between" sx={{ py: 1 }}><Typography>{row.dimension || row.source || "—"}</Typography><Typography color="primary.light">{fmt(row.value ?? row.amount ?? row.matches ?? row.players, "value")}</Typography></Stack>)}</Paper><Paper sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Operational status</Typography><Divider sx={{ my: 1.5 }} />{quality.slice(0, 8).map((item: any) => <Stack key={item.key} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 1 }}><Typography>{item.name}</Typography><Chip label={item.status} size="small" color={item.status === "PASS" ? "success" : "warning"} /></Stack>)}</Paper></Box>
      <Paper sx={{ p: 2.5, overflowX: "auto" }}><Typography variant="h6" fontWeight={800}>Drill-down</Typography><Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>Authoritative rows, capped for interactive use. Large exports run separately.</Typography><Box component="table" sx={{ width: "100%", borderCollapse: "collapse", "& td": { py: 1, pr: 2, borderBottom: "1px solid rgba(148,163,184,.12)", whiteSpace: "nowrap" } }}>{(report.tables || []).slice(0, 30).map((row: any, index: number) => <Box component="tr" key={index}>{Object.entries(row).slice(0, 6).map(([name, value]) => <Box component="td" key={name}><Typography variant="body2">{name === "createdAt" || name === "day" ? new Date(String(value)).toLocaleString() : fmt(value, name)}</Typography></Box>)}</Box>)}</Box></Paper>
    </>}
    <Paper sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Player explorer</Typography><Typography variant="body2" color="text.secondary">Restricted player-level lookup. Every lookup is audited.</Typography><Stack direction="row" spacing={1} sx={{ mt: 2 }}><TextField fullWidth label="Username, email, or player ID" value={playerSearch} onChange={(e) => setPlayerSearch(e.target.value)} /><Button variant="contained" startIcon={<SearchRoundedIcon />} onClick={() => void searchPlayers()}>Search</Button></Stack>{players.length > 0 && <Box sx={{ mt: 2, overflowX: "auto" }}><Box component="table" sx={{ width: "100%", "& td": { p: 1, borderBottom: "1px solid rgba(148,163,184,.12)" } }}><Box component="tbody">{players.map((player) => <Box component="tr" key={player.id}>{[player.username, player.status, player.countryCode || "—", `Lv ${player.level || 0}`, `ELO ${player.elo || 0}`, player.risk_level || "NORMAL"].map((value, i) => <Box component="td" key={i}><Typography variant="body2">{value}</Typography></Box>)}</Box>)}</Box></Box></Box>}</Paper>
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "1fr 1fr 1fr" }, gap: 2 }}><Paper sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Saved reports</Typography>{saved.length ? saved.slice(0, 8).map((item) => <Stack key={item.id} direction="row" justifyContent="space-between" sx={{ py: 1 }}><Typography>{item.name}</Typography><Chip label={item.visibility} size="small" /></Stack>) : <Typography color="text.secondary" sx={{ mt: 1 }}>Save a filtered report to reuse it.</Typography>}</Paper><Paper sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Scheduled delivery</Typography>{schedules.length ? schedules.slice(0, 8).map((item) => <Stack key={item.id} direction="row" justifyContent="space-between" sx={{ py: 1 }}><Typography>{item.frequency} · {item.sendAt}</Typography><Chip label={item.enabled ? "ON" : "OFF"} color={item.enabled ? "success" : "default"} size="small" /></Stack>) : <Typography color="text.secondary" sx={{ mt: 1 }}>Schedules run through the background export worker.</Typography>}</Paper><Paper sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Alerts</Typography>{alerts.events.length ? alerts.events.slice(0, 6).map((item) => <Stack key={item.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 1 }}><Box><Typography variant="body2">{item.message}</Typography><Typography variant="caption" color="text.secondary">{item.status}</Typography></Box>{item.status === "OPEN" && <Button size="small" onClick={() => void acknowledge(item.id)}>Acknowledge</Button>}</Stack>) : <Typography color="text.secondary" sx={{ mt: 1 }}>No alert events in the current window.</Typography>}</Paper></Box>
  </Stack>;
}
