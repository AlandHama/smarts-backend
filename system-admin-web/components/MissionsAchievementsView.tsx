"use client";

import { useEffect, useState } from "react";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";

type Mission = { id: string; key: string; title: string; description: string; icon: string; category: string; eventType: string; target: number; period: "DAILY" | "WEEKLY"; rewardGld: string; rewardXp: string; enabled: boolean; sortOrder: number };
type Tier = { id: string; tier: number; title: string; target: number; rewardGld: string; rewardXp: string };
type Achievement = { id: string; key: string; title: string; description: string; icon: string; category: string; eventType: string; enabled: boolean; tiers: Tier[] };
const events = ["MATCH_PLAYED", "MATCH_WON", "CORRECT_ANSWER", "PERFECT_MATCH", "RANKED_MATCH_PLAYED", "RANKED_MATCH_WON", "FRIEND_ADDED", "GIFT_SENT", "REWARDED_AD_VERIFIED"];
const blankMission = { key: "", title: "", description: "", icon: "target", category: "daily", eventType: "MATCH_PLAYED", target: "1", period: "DAILY", rewardGld: "0", rewardXp: "0", filters: "", startsAt: "", endsAt: "", enabled: true, sortOrder: "0" };
const blankAchievement = { key: "", title: "", description: "", icon: "trophy", category: "general", eventType: "MATCH_PLAYED", filters: "", enabled: true, sortOrder: "0" };
const blankTier = { tier: "1", title: "Bronze", target: "1", rewardGld: "0", rewardXp: "0" };

export function MissionsAchievementsView() {
  const [tab, setTab] = useState(0);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [dialog, setDialog] = useState<"mission" | "achievement" | "tier" | null>(null);
  const [editingMission, setEditingMission] = useState<Mission | null>(null);
  const [editingAchievement, setEditingAchievement] = useState<Achievement | null>(null);
  const [editingTier, setEditingTier] = useState<Tier | null>(null);
  const [tierParent, setTierParent] = useState<Achievement | null>(null);
  const [missionForm, setMissionForm] = useState<any>(blankMission);
  const [achievementForm, setAchievementForm] = useState<any>(blankAchievement);
  const [tierForm, setTierForm] = useState<any>(blankTier);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setError("");
      const [missionRows, achievementRows] = await Promise.all([api<Mission[]>("/missions?includeInactive=true"), api<Achievement[]>("/achievements?includeInactive=true")]);
      setMissions(missionRows);
      setAchievements(achievementRows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load missions and achievements"); }
  };
  useEffect(() => { void load(); }, []);
  const openMission = (mission?: Mission) => { setEditingMission(mission ?? null); setMissionForm(mission ? { ...mission, target: String(mission.target), sortOrder: String(mission.sortOrder) } : { ...blankMission }); setDialog("mission"); };
  const openAchievement = (achievement?: Achievement) => { setEditingAchievement(achievement ?? null); setAchievementForm(achievement ? { ...achievement, sortOrder: "0" } : { ...blankAchievement }); setDialog("achievement"); };
  const saveMission = async () => { try { setSaving(true); const payload = { ...missionForm, target: Number(missionForm.target), sortOrder: Number(missionForm.sortOrder), filters: missionForm.filters?.trim() || undefined, startsAt: missionForm.startsAt?.trim() || undefined, endsAt: missionForm.endsAt?.trim() || undefined }; await api(editingMission ? `/missions/${editingMission.id}` : "/missions", { method: editingMission ? "PATCH" : "POST", body: JSON.stringify(payload) }); setDialog(null); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save mission"); } finally { setSaving(false); } };
  const saveAchievement = async () => { try { setSaving(true); const payload = { ...achievementForm, sortOrder: Number(achievementForm.sortOrder), filters: achievementForm.filters?.trim() || undefined }; await api(editingAchievement ? `/achievements/${editingAchievement.id}` : "/achievements", { method: editingAchievement ? "PATCH" : "POST", body: JSON.stringify(payload) }); setDialog(null); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save achievement"); } finally { setSaving(false); } };
  const saveTier = async () => { if (!tierParent) return; try { setSaving(true); await api(editingTier ? `/achievement-tiers/${editingTier.id}` : `/achievements/${tierParent.id}/tiers`, { method: editingTier ? "PATCH" : "POST", body: JSON.stringify({ ...tierForm, tier: Number(tierForm.tier), target: Number(tierForm.target) }) }); setDialog(null); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save tier"); } finally { setSaving(false); } };
  const remove = async (path: string) => { if (!window.confirm("Delete this configuration? Existing player history remains safe.")) return; try { await api(path, { method: "DELETE" }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete"); } };
  const field = (label: string, key: string, form: any, setForm: (value: any) => void, props: any = {}) => <TextField label={label} value={form[key] ?? ""} onChange={(event) => setForm({ ...form, [key]: event.target.value })} fullWidth {...props} />;

  return <Stack spacing={3}>
    <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={2}>
      <BoxTitle />
      <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => tab === 0 ? openMission() : openAchievement()}>{tab === 0 ? "Add mission" : "Add achievement"}</Button>
    </Stack>
    <Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab label={`Missions (${missions.length})`} /><Tab label={`Achievements (${achievements.length})`} /></Tabs>
    {error && <Typography color="error.main">{error}</Typography>}
    {tab === 0 ? <Stack spacing={1.5}>{missions.map((mission) => <Card key={mission.id}><CardContent><Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems={{ md: "center" }}><Typography sx={{ fontSize: 32, width: 52, textAlign: "center" }}>{mission.icon === "target" ? "🎯" : "✨"}</Typography><Stack sx={{ flex: 1 }}><Stack direction="row" spacing={1} alignItems="center"><Typography variant="h6" fontWeight={800}>{mission.title}</Typography><Chip size="small" label={mission.enabled ? "Enabled" : "Disabled"} color={mission.enabled ? "success" : "default"} /></Stack><Typography variant="body2" color="text.secondary">{mission.key} · {mission.eventType} · {mission.period.toLowerCase()}</Typography><Typography variant="body2" sx={{ mt: .5 }}>{mission.description}</Typography></Stack><Stack alignItems={{ md: "flex-end" }}><Typography fontWeight={800}>{mission.target} progress · {mission.rewardGld} GLD + {mission.rewardXp} XP</Typography><Stack direction="row" spacing={1}><Button size="small" onClick={() => openMission(mission)}>Edit</Button><Button size="small" color="error" onClick={() => void remove(`/missions/${mission.id}`)}>Delete</Button></Stack></Stack></Stack></CardContent></Card>)}</Stack> : <Stack spacing={1.5}>{achievements.map((achievement) => <Card key={achievement.id}><CardContent><Stack direction={{ xs: "column", md: "row" }} spacing={2}><Typography sx={{ fontSize: 32, width: 52, textAlign: "center" }}>🏆</Typography><Stack sx={{ flex: 1 }}><Stack direction="row" spacing={1} alignItems="center"><Typography variant="h6" fontWeight={800}>{achievement.title}</Typography><Chip size="small" label={achievement.enabled ? "Enabled" : "Disabled"} color={achievement.enabled ? "success" : "default"} /></Stack><Typography variant="body2" color="text.secondary">{achievement.key} · {achievement.eventType} · {achievement.description}</Typography><Divider sx={{ my: 1.5 }} />{achievement.tiers.map((tier) => <Stack key={tier.id} direction="row" alignItems="center" spacing={1} sx={{ py: .35 }}><Chip size="small" label={`Tier ${tier.tier}`} /><Typography sx={{ flex: 1 }}>{tier.title} · {tier.target} events</Typography><Typography variant="caption" color="text.secondary">{tier.rewardGld} GLD · {tier.rewardXp} XP</Typography><Button size="small" onClick={() => { setTierParent(achievement); setEditingTier(tier); setTierForm({ ...tier, tier: String(tier.tier), target: String(tier.target) }); setDialog("tier"); }}>Edit</Button><Button size="small" color="error" onClick={() => void remove(`/achievement-tiers/${tier.id}`)}>Delete</Button></Stack>)}<Button size="small" startIcon={<AddRoundedIcon />} sx={{ mt: 1 }} onClick={() => { setTierParent(achievement); setEditingTier(null); setTierForm({ ...blankTier }); setDialog("tier"); }}>Add tier</Button></Stack><Stack direction="row" spacing={1}><Button size="small" onClick={() => openAchievement(achievement)}>Edit</Button><Button size="small" color="error" onClick={() => void remove(`/achievements/${achievement.id}`)}>Delete</Button></Stack></Stack></CardContent></Card>)}</Stack>}
    <Dialog open={dialog === "mission"} onClose={() => setDialog(null)} fullWidth maxWidth="sm"><DialogTitle>{editingMission ? "Edit mission" : "Add mission"}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{field("Stable key", "key", missionForm, setMissionForm, { disabled: Boolean(editingMission) })}{field("Title", "title", missionForm, setMissionForm)}{field("Description", "description", missionForm, setMissionForm)}<Stack direction="row" spacing={2}>{field("Event", "eventType", missionForm, setMissionForm, { select: true, SelectProps: { native: true }, children: events.map((event) => <option key={event}>{event}</option>) })}{field("Period", "period", missionForm, setMissionForm, { select: true, SelectProps: { native: true }, children: ["DAILY", "WEEKLY"].map((value) => <option key={value}>{value}</option>) })}</Stack><Stack direction="row" spacing={2}>{field("Target", "target", missionForm, setMissionForm, { type: "number" })}{field("Sort order", "sortOrder", missionForm, setMissionForm, { type: "number" })}</Stack><Stack direction="row" spacing={2}>{field("Reward GLD", "rewardGld", missionForm, setMissionForm, { type: "number", inputProps: { step: "0.000001", min: 0 } })}{field("Reward XP", "rewardXp", missionForm, setMissionForm, { type: "number", inputProps: { min: 0 } })}</Stack><Stack direction="row" alignItems="center"><Switch checked={Boolean(missionForm.enabled)} onChange={(event) => setMissionForm({ ...missionForm, enabled: event.target.checked })} /><Typography>Enabled for players</Typography></Stack></Stack></DialogContent><DialogActions><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="contained" onClick={() => void saveMission()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></DialogActions></Dialog>
    <Dialog open={dialog === "achievement"} onClose={() => setDialog(null)} fullWidth maxWidth="sm"><DialogTitle>{editingAchievement ? "Edit achievement" : "Add achievement"}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{field("Stable key", "key", achievementForm, setAchievementForm, { disabled: Boolean(editingAchievement) })}{field("Title", "title", achievementForm, setAchievementForm)}{field("Description", "description", achievementForm, setAchievementForm)}<Stack direction="row" spacing={2}>{field("Event", "eventType", achievementForm, setAchievementForm, { select: true, SelectProps: { native: true }, children: events.map((event) => <option key={event}>{event}</option>)})}{field("Category", "category", achievementForm, setAchievementForm)}</Stack><Stack direction="row" alignItems="center"><Switch checked={Boolean(achievementForm.enabled)} onChange={(event) => setAchievementForm({ ...achievementForm, enabled: event.target.checked })} /><Typography>Enabled for players</Typography></Stack></Stack></DialogContent><DialogActions><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="contained" onClick={() => void saveAchievement()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></DialogActions></Dialog>
    <Dialog open={dialog === "tier"} onClose={() => setDialog(null)} fullWidth maxWidth="sm"><DialogTitle>{editingTier ? "Edit achievement tier" : "Add achievement tier"}</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{field("Tier number", "tier", tierForm, setTierForm, { type: "number" })}{field("Tier title", "title", tierForm, setTierForm)}{field("Target events", "target", tierForm, setTierForm, { type: "number" })}<Stack direction="row" spacing={2}>{field("Reward GLD", "rewardGld", tierForm, setTierForm, { type: "number", inputProps: { step: "0.000001", min: 0 } })}{field("Reward XP", "rewardXp", tierForm, setTierForm, { type: "number", inputProps: { min: 0 } })}</Stack></Stack></DialogContent><DialogActions><Button onClick={() => setDialog(null)}>Cancel</Button><Button variant="contained" onClick={() => void saveTier()} disabled={saving}>{saving ? "Saving…" : "Save"}</Button></DialogActions></Dialog>
  </Stack>;
}

function BoxTitle() { return <Stack direction="row" spacing={1.5} alignItems="center"><AutoAwesomeRoundedIcon color="primary" sx={{ fontSize: 42 }} /><div><Typography variant="h4" fontWeight={850}>Missions & achievements</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Configure server-authoritative progression events, rotating missions, permanent achievement families, tiers, filters, and rewards.</Typography></div></Stack>; }
