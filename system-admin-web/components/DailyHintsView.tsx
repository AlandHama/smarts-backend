"use client";

import { useEffect, useState, type FormEvent } from "react";
import LightbulbRoundedIcon from "@mui/icons-material/LightbulbRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "../lib/api";

type Copy = { title: string; body: string };
type Hint = { id: string; active: boolean; translations: Record<string, Copy>; _count?: { views: number; selections: number } };

const languages = [
  ["en", "English"],
  ["ar", "Arabic"],
  ["ku", "Kurdish"],
  ["tr", "Turkish"],
] as const;

const emptyTranslations = (): Record<string, Copy> => Object.fromEntries(languages.map(([key]) => [key, { title: "", body: "" }])) as Record<string, Copy>;

export function DailyHintsView() {
  const [hints, setHints] = useState<Hint[]>([]);
  const [editing, setEditing] = useState<Hint | null>(null);
  const [active, setActive] = useState(true);
  const [translations, setTranslations] = useState<Record<string, Copy>>(emptyTranslations());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try { setHints(await api<Hint[]>("/daily-hints?limit=120")); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load daily hints"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const resetForm = () => {
    setEditing(null); setActive(true); setTranslations(emptyTranslations());
  };
  const edit = (hint: Hint) => {
    setEditing(hint); setActive(hint.active);
    setTranslations({ ...emptyTranslations(), ...hint.translations });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const body = JSON.stringify({ active, translations });
      if (editing) await api(`/daily-hints/${editing.id}`, { method: "PATCH", body });
      else await api("/daily-hints", { method: "POST", body });
      setMessage(editing ? "Daily hint updated" : "Daily hint created"); resetForm(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save daily hint"); }
    finally { setSaving(false); }
  };
  const archive = async (hint: Hint) => {
    try { await api(`/daily-hints/${hint.id}`, { method: "DELETE" }); setMessage("Daily hint archived"); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to archive daily hint"); }
  };

  if (loading && !hints.length) return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  return <Stack spacing={3}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center"><LightbulbRoundedIcon color="primary" sx={{ fontSize: 42 }} /><Box><Typography variant="h4" fontWeight={850}>Daily hints</Typography><Typography color="text.secondary">Build a multilingual hint pool. The server randomly selects one active hint per UTC day, then keeps that choice consistent for all players.</Typography></Box></Stack>
      <Button onClick={() => void load()} startIcon={<RefreshRoundedIcon />}>Refresh</Button>
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
    <Card component="form" onSubmit={save}><Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 4 } }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h6" fontWeight={800}>{editing ? "Edit hint" : "Add a hint to the pool"}</Typography><Typography variant="body2" color="text.secondary">English is the fallback. Add Arabic, Kurdish, and Turkish copy to localize the mobile dialog and push notification.</Typography></Box><Stack direction="row" alignItems="center" spacing={1}><Typography variant="body2">Active</Typography><Switch checked={active} onChange={(e) => setActive(e.target.checked)} /></Stack></Stack>
      <Grid container spacing={2}>{languages.map(([key, label]) => <Grid item xs={12} md={6} key={key}><Card variant="outlined" sx={{ p: 2 }}><Stack spacing={1.5}><Stack direction="row" justifyContent="space-between"><Typography fontWeight={800}>{label}</Typography><Chip size="small" label={key.toUpperCase()} /></Stack><TextField label="Title" value={translations[key]?.title ?? ""} onChange={(e) => setTranslations((old) => ({ ...old, [key]: { ...(old[key] ?? { body: "" }), title: e.target.value } }))} fullWidth /><TextField label="Hint text" value={translations[key]?.body ?? ""} onChange={(e) => setTranslations((old) => ({ ...old, [key]: { ...(old[key] ?? { title: "" }), body: e.target.value } }))} multiline minRows={3} fullWidth /></Stack></Card></Grid>)}</Grid>
      <Stack direction="row" justifyContent="flex-end" spacing={1.5}><Button onClick={resetForm} disabled={!editing}>Clear</Button><Button type="submit" variant="contained" startIcon={editing ? <SaveRoundedIcon /> : <AddRoundedIcon />} disabled={saving}>{editing ? "Save changes" : "Create hint"}</Button></Stack>
    </Stack></Card>
    <Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction="row" justifyContent="space-between"><Box><Typography variant="h6" fontWeight={800}>Hint pool</Typography><Typography variant="body2" color="text.secondary">Only active hints are eligible. One is randomly selected per UTC day and reused for the whole day.</Typography></Box><Typography color="text.secondary">{hints.length} hints</Typography></Stack><Divider />{hints.length === 0 ? <Typography color="text.secondary">No daily hints created yet.</Typography> : <Stack spacing={1}>{hints.map((hint) => <Stack key={hint.id} direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2 }}><Chip size="small" label={hint.active ? "ACTIVE" : "ARCHIVED"} color={hint.active ? "success" : "default"} /><Typography color="text.secondary" sx={{ flex: 1 }}>{hint.translations?.en?.title || "Untitled hint"} · {hint._count?.views ?? 0} views · {hint._count?.selections ?? 0} days selected</Typography><Button size="small" startIcon={<EditRoundedIcon />} onClick={() => edit(hint)}>Edit</Button>{hint.active && <Button size="small" color="warning" onClick={() => void archive(hint)}>Archive</Button>}</Stack>)}</Stack>}</Stack></Card>
  </Stack>;
}
