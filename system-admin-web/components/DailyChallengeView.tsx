"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import PsychologyRoundedIcon from "@mui/icons-material/PsychologyRounded";
import PublishRoundedIcon from "@mui/icons-material/PublishRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "../lib/api";

type Configuration = { enabled: boolean; gameKey: string; timezone: string; questionsPerDay: number; durationSeconds: number; maxAttempts: number; pointsPerCorrect: number };
type Challenge = { id: string; dateKey: string; status: string; questionCount: number; durationSeconds: number; pointsPerCorrect: number; gameDefinition?: { key: string; name: string }; _count?: { questions: number; attempts: number } };
type Detail = Challenge & { title: string; subtitle: string; questions: Array<{ position: number; prompt: string; options: unknown; answerIndex: number; difficulty: number; category?: string | null }>; };

export function DailyChallengeView() {
  const [config, setConfig] = useState<Configuration | null>(null);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [dateKey, setDateKey] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [policy, rows] = await Promise.all([api<Configuration>("/daily-challenge/configuration"), api<Challenge[]>("/daily-challenge/challenges?limit=30")]);
      setConfig(policy); setChallenges(rows);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load daily challenge"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!config) return; setSaving(true); setError(""); setMessage("");
    const form = event.currentTarget;
    try {
      const value = await api<Configuration>("/daily-challenge/configuration", { method: "PATCH", body: JSON.stringify({
        enabled: (form.elements.namedItem("enabled") as HTMLInputElement).checked,
        gameKey: (form.elements.namedItem("gameKey") as HTMLInputElement).value,
        timezone: (form.elements.namedItem("timezone") as HTMLInputElement).value,
        questionsPerDay: Number((form.elements.namedItem("questionsPerDay") as HTMLInputElement).value),
        durationSeconds: Number((form.elements.namedItem("durationSeconds") as HTMLInputElement).value),
        maxAttempts: Number((form.elements.namedItem("maxAttempts") as HTMLInputElement).value),
        pointsPerCorrect: Number((form.elements.namedItem("pointsPerCorrect") as HTMLInputElement).value),
      }) });
      setConfig(value); setMessage("Daily challenge policy saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save policy"); }
    finally { setSaving(false); }
  };

  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(""); setMessage("");
    const form = event.currentTarget;
    try { await api("/daily-challenge/challenges/generate", { method: "POST", body: JSON.stringify({ dateKey, gameKey: (form.elements.namedItem("generateGameKey") as HTMLInputElement).value, publish: (form.elements.namedItem("publish") as HTMLInputElement).checked }) }); setMessage(`Challenge ${dateKey} generated`); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to generate challenge"); }
  };
  const open = async (key: string) => { setError(""); try { setDetail(await api<Detail>(`/daily-challenge/challenges/${key}`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load challenge"); } };
  const publish = async (key: string) => { setError(""); try { await api(`/daily-challenge/challenges/${key}/publish`, { method: "POST" }); setMessage(`Challenge ${key} published`); await load(); if (detail?.dateKey === key) await open(key); } catch (e) { setError(e instanceof Error ? e.message : "Unable to publish challenge"); } };

  if (loading && !config) return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  return <Stack spacing={3}>
    <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}><Stack direction="row" spacing={1.5} alignItems="center"><PsychologyRoundedIcon color="primary" sx={{ fontSize: 42 }} /><Box><Typography variant="h4" fontWeight={850}>Daily challenge</Typography><Typography color="text.secondary">One server-owned challenge for every player, every day.</Typography></Box></Stack><Button onClick={() => void load()} startIcon={<RefreshRoundedIcon />}>Refresh</Button></Stack>
    {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
    {config && <Card component="form" onSubmit={save}><Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h6" fontWeight={800}>Challenge policy</Typography><Typography variant="body2" color="text.secondary">The backend freezes the question set and enforces one attempt per player.</Typography></Box><FormControlLabel control={<Switch name="enabled" defaultChecked={config.enabled} />} label="Enabled" /></Stack><Grid container spacing={2}><Grid item xs={12} md={3}><TextField name="gameKey" label="Game key" defaultValue={config.gameKey} fullWidth /></Grid><Grid item xs={12} md={3}><TextField name="timezone" label="Timezone" defaultValue={config.timezone} fullWidth /></Grid><Grid item xs={12} md={3}><TextField name="questionsPerDay" label="Questions" type="number" defaultValue={config.questionsPerDay} inputProps={{ min: 1, max: 100 }} fullWidth /></Grid><Grid item xs={12} md={3}><TextField name="durationSeconds" label="Time limit (seconds)" type="number" defaultValue={config.durationSeconds} inputProps={{ min: 10, max: 3600 }} fullWidth /></Grid><Grid item xs={12} md={4}><TextField name="maxAttempts" label="Attempts per day" type="number" defaultValue={config.maxAttempts} inputProps={{ min: 1, max: 1 }} fullWidth /></Grid><Grid item xs={12} md={4}><TextField name="pointsPerCorrect" label="Points per correct answer" type="number" defaultValue={config.pointsPerCorrect} inputProps={{ min: 1, max: 100 }} fullWidth /></Grid></Grid><Button type="submit" variant="contained" startIcon={<SaveRoundedIcon />} disabled={saving} sx={{ alignSelf: "flex-end" }}>Save policy</Button></Stack></Card>}
    <Card component="form" onSubmit={generate}><Stack spacing={2} sx={{ p: { xs: 2.5, md: 4 } }}><Typography variant="h6" fontWeight={800}>Prepare a daily challenge</Typography><Typography variant="body2" color="text.secondary">Questions are selected deterministically from active server content, so every player receives the same set.</Typography><Stack direction={{ xs: "column", md: "row" }} spacing={1.5}><TextField label="Date" type="date" value={dateKey} onChange={(event: ChangeEvent<HTMLInputElement>) => setDateKey(event.target.value)} InputLabelProps={{ shrink: true }} /><TextField name="generateGameKey" label="Game key" defaultValue={config?.gameKey || "trivia"} /><FormControlLabel control={<Switch name="publish" defaultChecked />} label="Publish immediately" /><Button type="submit" variant="contained" startIcon={<PublishRoundedIcon />}>Generate</Button></Stack></Stack></Card>
    <Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction="row" justifyContent="space-between"><Box><Typography variant="h6" fontWeight={800}>Challenge calendar</Typography><Typography variant="body2" color="text.secondary">Review frozen questions, attempts, and publication state.</Typography></Box><Typography color="text.secondary">{challenges.length} days</Typography></Stack><Divider />{challenges.length === 0 ? <Typography color="text.secondary">No challenges generated yet.</Typography> : <Stack spacing={1}>{challenges.map((row) => <Stack key={row.id} direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }} sx={{ p: 1.5, border: "1px solid", borderColor: "divider", borderRadius: 2 }}><Typography fontWeight={800} sx={{ minWidth: 120 }}>{row.dateKey}</Typography><Chip label={row.status} color={row.status === "PUBLISHED" ? "success" : "default"} size="small" /><Typography color="text.secondary" sx={{ flex: 1 }}>{row.gameDefinition?.name || row.gameDefinition?.key || "Game"} · {row.questionCount} questions · {row._count?.attempts ?? 0} attempts</Typography><Button size="small" onClick={() => void open(row.dateKey)}>View questions</Button>{row.status !== "PUBLISHED" && <Button size="small" variant="outlined" onClick={() => void publish(row.dateKey)}>Publish</Button>}</Stack>)}</Stack>}</Stack></Card>
    {detail && <Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h6" fontWeight={800}>{detail.dateKey} questions</Typography><Typography color="text.secondary">{detail.title} · {detail.pointsPerCorrect} point{detail.pointsPerCorrect === 1 ? "" : "s"} each</Typography></Box><Button onClick={() => setDetail(null)}>Close</Button></Stack><Divider />{detail.questions.map((question) => { const options = Array.isArray(question.options) ? question.options : []; return <Box key={question.position} sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}><Typography fontWeight={750}>{question.position + 1}. {question.prompt}</Typography><Stack spacing={0.5} sx={{ mt: 1 }}>{options.map((option, index) => <Typography key={index} variant="body2" color={index === question.answerIndex ? "success.main" : "text.secondary"}>{index === question.answerIndex ? "✓ " : "○ "}{typeof option === "string" ? option : JSON.stringify(option)}</Typography>)}</Stack></Box>; })}</Stack></Card>}
  </Stack>;
}
