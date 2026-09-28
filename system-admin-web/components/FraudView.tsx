"use client";

import { useEffect, useMemo, useState } from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";

type Risk = "NORMAL" | "LOW" | "SUSPICIOUS" | "HIGH" | "CRITICAL";
type ProfileStatus = "CLEAR" | "WATCH" | "RESTRICTED" | "SUSPENDED";

type Profile = {
  id: string;
  userId: string;
  score: number;
  riskLevel: Risk;
  status: ProfileStatus;
  lastSignalAt?: string | null;
  updatedAt: string;
  user?: { username?: string; email?: string; status?: string; profile?: { displayName?: string; avatarUrl?: string | null } };
};

type Rule = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  scoreDelta: number;
  threshold?: number | null;
  windowSeconds?: number | null;
  decayDays: number;
  autoOpenScore?: number | null;
};

type Detail = {
  profile: Profile;
  signals: Array<{ id: string; type: string; sourceType: string; scoreDelta: number; severity: Risk; status: string; occurredAt: string; metadata?: unknown; rule?: { name?: string; decayDays?: number } }>;
  cases: Array<{ id: string; status: string; reason: string; scoreAtOpen: number; openedAt: string; notes?: string | null; actions?: Array<{ action: string; reason: string; createdAt: string; actor?: { username?: string } }> }>;
  sessions: Array<{ id: string; platform?: string | null; osName?: string | null; osVersion?: string | null; deviceType?: string | null; deviceModel?: string | null; deviceManufacturer?: string | null; ipAddress?: string | null; lastActiveTimestamp?: string | null; sessionStatus?: string | null }>;
  relatedAccounts: Array<{ userId: string; user?: { username?: string; profile?: { displayName?: string } } }>;
};

const risks: Risk[] = ["NORMAL", "LOW", "SUSPICIOUS", "HIGH", "CRITICAL"];
const statuses: Array<ProfileStatus | ""> = ["", "CLEAR", "WATCH", "RESTRICTED", "SUSPENDED"];

function date(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function riskColor(risk: Risk): "default" | "success" | "info" | "warning" | "error" {
  if (risk === "CRITICAL" || risk === "HIGH") return "error";
  if (risk === "SUSPICIOUS") return "warning";
  if (risk === "LOW") return "info";
  return "success";
}

export function FraudView() {
  const [summary, setSummary] = useState<any>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [risk, setRisk] = useState<Risk | "">("");
  const [status, setStatus] = useState<ProfileStatus | "">("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Detail | null>(null);
  const [ruleDraft, setRuleDraft] = useState<Rule | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const query = new URLSearchParams();
      if (risk) query.set("riskLevel", risk);
      if (status) query.set("status", status);
      if (search.trim()) query.set("search", search.trim());
      const [nextSummary, nextProfiles, nextRules] = await Promise.all([
        api<any>("/fraud/summary"),
        api<{ items: Profile[] }>(`/fraud/profiles?${query.toString()}`),
        api<Rule[]>("/fraud/rules"),
      ]);
      setSummary(nextSummary);
      setProfiles(nextProfiles.items || []);
      setRules(nextRules || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load fraud data");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, [risk, status]);

  const openProfile = async (userId: string) => {
    setError(null);
    try { setSelected(await api<Detail>(`/fraud/profiles/${userId}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load player risk detail"); }
  };

  const performAction = async (action: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/fraud/profiles/${selected.profile.userId}/actions`, { method: "POST", body: JSON.stringify({ action, reason: `Reviewed in Fraud & Risk console: ${action}` }) });
      await openProfile(selected.profile.userId);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to update risk status"); }
    finally { setBusy(false); }
  };

  const saveRule = async () => {
    if (!ruleDraft) return;
    setBusy(true);
    try {
      await api(`/fraud/rules/${ruleDraft.id}`, { method: "PATCH", body: JSON.stringify({ enabled: ruleDraft.enabled, scoreDelta: Number(ruleDraft.scoreDelta), threshold: ruleDraft.threshold === null ? null : Number(ruleDraft.threshold), windowSeconds: ruleDraft.windowSeconds === null ? null : Number(ruleDraft.windowSeconds), decayDays: Number(ruleDraft.decayDays), autoOpenScore: ruleDraft.autoOpenScore === null ? null : Number(ruleDraft.autoOpenScore), reason: "Updated from Fraud & Risk console" }) });
      setRuleDraft(null);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save fraud rule"); }
    finally { setBusy(false); }
  };

  const counts = useMemo(() => summary?.byRiskLevel || {}, [summary]);

  return (
    <Box sx={{ maxWidth: 1500, mx: "auto", p: { xs: 2, md: 4 } }}>
      <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="overline" color="primary">TRUST & SAFETY</Typography>
          <Typography variant="h3" fontWeight={900}>Fraud & risk</Typography>
          <Typography color="text.secondary">Review evidence, tune deterministic signals, and control player risk without automatic bans.</Typography>
        </Box>
        <Button variant="contained" onClick={() => void load()} disabled={busy}>Refresh</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 3, flexWrap: "wrap" }}>
        {risks.map((item) => <Chip key={item} color={riskColor(item)} variant={risk === item ? "filled" : "outlined"} label={`${item}: ${counts[item] || 0}`} onClick={() => setRisk(risk === item ? "" : item)} />)}
        <Chip color="warning" variant="outlined" label={`Open cases: ${summary?.openCases || 0}`} />
        <Chip color="info" variant="outlined" label={`Signals/24h: ${summary?.signalsLast24Hours || 0}`} />
      </Stack>
      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ mb: 4 }}>
        <TextField fullWidth label="Search player" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} />
        <Select value={status} displayEmpty onChange={(e) => setStatus(e.target.value as ProfileStatus | "")} sx={{ minWidth: 180 }}>
          {statuses.map((item) => <MenuItem key={item || "all"} value={item}>{item || "All statuses"}</MenuItem>)}
        </Select>
        <Button variant="outlined" onClick={() => void load()}>Apply filters</Button>
      </Stack>

      <Typography variant="h5" fontWeight={800} sx={{ mb: 1.5 }}>Players requiring attention</Typography>
      <Stack spacing={1.25} sx={{ mb: 5 }}>
        {profiles.length === 0 && <Alert severity="info">No fraud profiles match these filters yet.</Alert>}
        {profiles.map((item) => <Button key={item.userId} onClick={() => void openProfile(item.userId)} sx={{ textTransform: "none", textAlign: "left", justifyContent: "flex-start", color: "text.primary", p: 2, border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} sx={{ width: "100%" }}>
            <Box sx={{ flex: 1 }}><Typography fontWeight={800}>{item.user?.profile?.displayName || item.user?.username || item.userId}</Typography><Typography variant="body2" color="text.secondary">{item.user?.email || "No email"} · Last signal {date(item.lastSignalAt)}</Typography></Box>
            <Chip size="small" color={riskColor(item.riskLevel)} label={`${item.riskLevel} · ${item.score}/100`} />
            <Chip size="small" variant="outlined" label={item.status} />
          </Stack>
        </Button>)}
      </Stack>

      <Typography variant="h5" fontWeight={800} sx={{ mb: 1.5 }}>Detection rules</Typography>
      <Stack spacing={1.25}>
        {rules.map((rule) => <Box key={rule.id} sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}><Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}><Box sx={{ flex: 1 }}><Typography fontWeight={800}>{rule.name}</Typography><Typography variant="body2" color="text.secondary">{rule.key} · {rule.description}</Typography></Box><Chip size="small" color={rule.enabled ? "success" : "default"} label={rule.enabled ? "Enabled" : "Disabled"} /><Typography variant="body2">+{rule.scoreDelta} score · {rule.threshold ?? "—"} events · {rule.decayDays}d decay</Typography><Button size="small" onClick={() => setRuleDraft({ ...rule })}>Edit</Button></Stack></Box>)}
      </Stack>

      <Dialog open={Boolean(selected)} onClose={() => setSelected(null)} fullWidth maxWidth="md">
        <DialogTitle>Player risk investigation</DialogTitle>
        <DialogContent dividers>{selected && <Stack spacing={2}>
          <Stack direction="row" spacing={1} alignItems="center"><Typography variant="h5" fontWeight={800}>{selected.profile.user?.profile?.displayName || selected.profile.user?.username || selected.profile.userId}</Typography><Chip color={riskColor(selected.profile.riskLevel)} label={`${selected.profile.riskLevel} · ${selected.profile.score}/100`} /><Chip variant="outlined" label={selected.profile.status} /></Stack>
          <Typography color="text.secondary">Account: {selected.profile.user?.email || selected.profile.userId}</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap"><Button size="small" variant="outlined" onClick={() => void performAction("MARK_SAFE")}>Mark safe</Button><Button size="small" variant="outlined" onClick={() => void performAction("WATCH")}>Watch</Button><Button size="small" variant="outlined" color="warning" onClick={() => void performAction("RESTRICT_REWARDS")}>Restrict rewards</Button><Button size="small" variant="outlined" color="error" onClick={() => void performAction("SUSPEND")}>Suspend</Button><Button size="small" variant="outlined" onClick={() => void performAction("REINSTATE")}>Reinstate</Button></Stack>
          <Divider /><Typography variant="h6" fontWeight={800}>Evidence timeline</Typography>
          {selected.signals.slice(0, 40).map((signal) => <Box key={signal.id} sx={{ p: 1.5, borderRadius: 1.5, bgcolor: "action.hover" }}><Stack direction="row" justifyContent="space-between" spacing={2}><Typography fontWeight={700}>{signal.rule?.name || signal.type}</Typography><Typography variant="caption" color="text.secondary">{date(signal.occurredAt)}</Typography></Stack><Typography variant="body2" color="text.secondary">{signal.sourceType} · +{signal.scoreDelta} · {signal.status}</Typography></Box>)}
          <Divider /><Typography variant="h6" fontWeight={800}>Cases & related accounts</Typography>
          {selected.cases.map((item) => <Typography key={item.id} variant="body2">{item.status} · score {item.scoreAtOpen} · {item.reason} · {date(item.openedAt)}</Typography>)}
          {selected.relatedAccounts.length > 0 && <Typography variant="body2">Related accounts: {selected.relatedAccounts.map((item) => item.user?.profile?.displayName || item.user?.username || item.userId).join(", ")}</Typography>}
          <Typography variant="h6" fontWeight={800}>Recent sessions</Typography>
          {selected.sessions.slice(0, 10).map((session) => <Typography key={session.id} variant="body2" color="text.secondary">{session.deviceManufacturer || ""} {session.deviceModel || session.deviceType || "device"} · {session.osName || "OS"} {session.osVersion || ""} · {session.platform || ""} · {date(session.lastActiveTimestamp)}</Typography>)}
        </Stack>}</DialogContent>
        <DialogActions><Button onClick={() => setSelected(null)}>Close</Button></DialogActions>
      </Dialog>

      <Dialog open={Boolean(ruleDraft)} onClose={() => setRuleDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>Edit detection rule</DialogTitle>
        <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{ruleDraft && <>
          <Typography fontWeight={800}>{ruleDraft.name}</Typography>
          <Select value={ruleDraft.enabled ? "true" : "false"} onChange={(e) => setRuleDraft({ ...ruleDraft, enabled: e.target.value === "true" })}><MenuItem value="true">Enabled</MenuItem><MenuItem value="false">Disabled</MenuItem></Select>
          <TextField type="number" label="Score delta" value={ruleDraft.scoreDelta} onChange={(e) => setRuleDraft({ ...ruleDraft, scoreDelta: Number(e.target.value) })} />
          <TextField type="number" label="Events threshold" value={ruleDraft.threshold ?? ""} onChange={(e) => setRuleDraft({ ...ruleDraft, threshold: e.target.value === "" ? null : Number(e.target.value) })} />
          <TextField type="number" label="Window seconds" value={ruleDraft.windowSeconds ?? ""} onChange={(e) => setRuleDraft({ ...ruleDraft, windowSeconds: e.target.value === "" ? null : Number(e.target.value) })} />
          <TextField type="number" label="Decay days" value={ruleDraft.decayDays} onChange={(e) => setRuleDraft({ ...ruleDraft, decayDays: Number(e.target.value) })} />
          <TextField type="number" label="Auto-open score" value={ruleDraft.autoOpenScore ?? ""} onChange={(e) => setRuleDraft({ ...ruleDraft, autoOpenScore: e.target.value === "" ? null : Number(e.target.value) })} />
        </>}</Stack></DialogContent>
        <DialogActions><Button onClick={() => setRuleDraft(null)}>Cancel</Button><Button variant="contained" onClick={() => void saveRule()} disabled={busy}>Save rule</Button></DialogActions>
      </Dialog>
    </Box>
  );
}
