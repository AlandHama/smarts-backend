"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import LocalFireDepartmentRoundedIcon from "@mui/icons-material/LocalFireDepartmentRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "../lib/api";

type Milestone = { id: string; day: number; bonusPercent: number; title?: string | null; description?: string | null; enabled: boolean; sortOrder: number };
type Config = { id: string; enabled: boolean; qualifyingActivity: string; timezone: string; maxBonusPercent: number; milestones: Milestone[] };

const blank = { day: "", bonusPercent: "", title: "", description: "", enabled: true, sortOrder: "" };

export function StreaksView() {
  const [config, setConfig] = useState<Config | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Milestone>>({});
  const [newMilestone, setNewMilestone] = useState(blank);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const value = await api<Config>("/streaks/configuration");
      setConfig(value);
      setDrafts(Object.fromEntries(value.milestones.map((row) => [row.id, { ...row }])));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load streak policy"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const updateConfig = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!config) return;
    const form = event.currentTarget;
    setSaving(true); setError(""); setMessage("");
    try {
      const value = await api<Config>("/streaks/configuration", { method: "PATCH", body: JSON.stringify({
        enabled: (form.elements.namedItem("enabled") as HTMLInputElement).checked,
        qualifyingActivity: String((form.elements.namedItem("qualifyingActivity") as HTMLInputElement).value),
        timezone: String((form.elements.namedItem("timezone") as HTMLInputElement).value),
        maxBonusPercent: Number((form.elements.namedItem("maxBonusPercent") as HTMLInputElement).value),
      }) });
      setConfig(value); setDrafts(Object.fromEntries(value.milestones.map((row) => [row.id, { ...row }]))); setMessage("Streak policy saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save streak policy"); }
    finally { setSaving(false); }
  };

  const saveMilestone = async (row: Milestone) => {
    setError("");
    try { await api(`/streaks/milestones/${row.id}`, { method: "PATCH", body: JSON.stringify({ day: row.day, bonusPercent: row.bonusPercent, title: row.title || undefined, description: row.description || undefined, enabled: row.enabled, sortOrder: row.sortOrder }) }); setMessage("Milestone saved"); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to save milestone"); }
  };
  const addMilestone = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError("");
    try { await api("/streaks/milestones", { method: "POST", body: JSON.stringify({ day: Number(newMilestone.day), bonusPercent: Number(newMilestone.bonusPercent), title: newMilestone.title || undefined, description: newMilestone.description || undefined, enabled: newMilestone.enabled, sortOrder: Number(newMilestone.sortOrder || newMilestone.day) }) }); setNewMilestone(blank); setMessage("Milestone added"); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to add milestone"); }
  };
  const removeMilestone = async (id: string) => { if (!window.confirm("Delete this streak milestone?")) return; try { await api(`/streaks/milestones/${id}`, { method: "DELETE" }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete milestone"); } };

  if (loading) return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  if (!config) return <Alert severity="error">{error || "Streak policy unavailable"}</Alert>;
  const changeNew = (key: keyof typeof blank) => (event: ChangeEvent<HTMLInputElement>) => setNewMilestone((value) => ({ ...value, [key]: event.target.value }));
  return <Stack spacing={3}>
    <BoxHeader />
    {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
    <Card component="form" onSubmit={updateConfig}><Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 4 } }}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}><Box><Typography variant="h6" fontWeight={800}>Streak policy</Typography><Typography variant="body2" color="text.secondary">The backend records one qualifying activity per UTC day. A missed day resets the active ad bonus.</Typography></Box><FormControlLabel control={<Switch name="enabled" defaultChecked={config.enabled} />} label="Enabled" /></Stack>
      <Grid container spacing={2}><Grid item xs={12} md={4}><TextField name="qualifyingActivity" label="Qualifying activity" defaultValue={config.qualifyingActivity} helperText="Use MATCH_COMPLETED for server-settled matches" fullWidth /></Grid><Grid item xs={12} md={4}><TextField name="timezone" label="Policy timezone" defaultValue={config.timezone} helperText="UTC is recommended for all players" fullWidth /></Grid><Grid item xs={12} md={4}><TextField name="maxBonusPercent" label="Maximum ad bonus %" type="number" inputProps={{ min: 0, max: 100 }} defaultValue={config.maxBonusPercent} fullWidth /></Grid></Grid>
      <Button type="submit" variant="contained" startIcon={<SaveRoundedIcon />} disabled={saving} sx={{ alignSelf: "flex-end" }}>Save policy</Button>
    </Stack></Card>
    <Card><Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={1}><Box><Typography variant="h6" fontWeight={800}>Ad GLD bonus milestones</Typography><Typography variant="body2" color="text.secondary">Bonuses are additive with the player progression bonus and capped by the policy above.</Typography></Box><Typography color="text.secondary">{config.milestones.length} milestones</Typography></Stack><Divider />
      <Stack spacing={1.5}>{config.milestones.map((original) => { const row = drafts[original.id] || original; const set = (key: keyof Milestone) => (event: ChangeEvent<HTMLInputElement>) => setDrafts((value) => ({ ...value, [row.id]: { ...row, [key]: key === "day" || key === "bonusPercent" || key === "sortOrder" ? Number(event.target.value) : key === "enabled" ? event.target.checked : event.target.value } })); return <Stack key={row.id} direction={{ xs: "column", lg: "row" }} spacing={1} alignItems={{ lg: "center" }} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2.5 }}><TextField size="small" label="Day" type="number" value={row.day} onChange={set("day")} sx={{ width: { lg: 100 } }} /><TextField size="small" label="Bonus %" type="number" value={row.bonusPercent} onChange={set("bonusPercent")} sx={{ width: { lg: 120 } }} /><TextField size="small" label="Title" value={row.title || ""} onChange={set("title")} sx={{ minWidth: { lg: 180 }, flex: 1 }} /><TextField size="small" label="Description" value={row.description || ""} onChange={set("description")} sx={{ minWidth: { lg: 250 }, flex: 2 }} /><FormControlLabel control={<Switch checked={row.enabled} onChange={set("enabled")} />} label="Active" /><Button size="small" variant="outlined" onClick={() => void saveMilestone(row)}>Save</Button><IconButton color="error" onClick={() => void removeMilestone(row.id)}><DeleteOutlineRoundedIcon /></IconButton></Stack>; })}</Stack>
      <Divider /><Typography variant="subtitle1" fontWeight={800}>Add milestone</Typography><Stack component="form" onSubmit={addMilestone} direction={{ xs: "column", md: "row" }} spacing={1.5}><TextField size="small" label="Day" type="number" required value={newMilestone.day} onChange={changeNew("day")} /><TextField size="small" label="Bonus %" type="number" required value={newMilestone.bonusPercent} onChange={changeNew("bonusPercent")} /><TextField size="small" label="Title" value={newMilestone.title} onChange={changeNew("title")} sx={{ flex: 1 }} /><TextField size="small" label="Description" value={newMilestone.description} onChange={changeNew("description")} sx={{ flex: 2 }} /><Button type="submit" variant="contained" startIcon={<AddRoundedIcon />}>Add</Button></Stack>
    </Stack></Card>
  </Stack>;
}

function BoxHeader() { return <Stack direction="row" spacing={1.5} alignItems="center"><LocalFireDepartmentRoundedIcon color="primary" sx={{ fontSize: 38 }} /><Box><Typography variant="h4" fontWeight={850}>Daily streaks</Typography><Typography color="text.secondary">Configure return-player momentum and the server-authoritative ad GLD multiplier.</Typography></Box></Stack>; }
