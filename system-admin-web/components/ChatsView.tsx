"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "../lib/api";

type ChatConfig = {
  id: string;
  enabled: boolean;
  retentionDays: number;
  maxMessageLength: number;
  maxMessagesPerMinute: number;
  maxMessagesPerDay: number;
  typingEnabled: boolean;
  readReceiptsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  friendChatOnly: boolean;
  allowLinks: boolean;
  maintenanceMessage: string | null;
  lastCleanupAt: string | null;
  lastCleanupDeleted: number;
};

export function ChatsView() {
  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [draft, setDraft] = useState<Partial<ChatConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const value = await api<ChatConfig>("/chats/configuration");
      setConfig(value);
      setDraft(value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load chat configuration");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const set = (key: keyof ChatConfig) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const body = {
        enabled: Boolean(draft.enabled),
        retentionDays: Number(draft.retentionDays),
        maxMessageLength: Number(draft.maxMessageLength),
        maxMessagesPerMinute: Number(draft.maxMessagesPerMinute),
        maxMessagesPerDay: Number(draft.maxMessagesPerDay),
        typingEnabled: Boolean(draft.typingEnabled),
        readReceiptsEnabled: Boolean(draft.readReceiptsEnabled),
        pushNotificationsEnabled: Boolean(draft.pushNotificationsEnabled),
        friendChatOnly: Boolean(draft.friendChatOnly),
        allowLinks: Boolean(draft.allowLinks),
        maintenanceMessage: draft.maintenanceMessage || null,
      };
      const value = await api<ChatConfig>("/chats/configuration", { method: "PATCH", body: JSON.stringify(body) });
      setConfig(value);
      setDraft(value);
      setMessage("Friend chat configuration saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save chat configuration");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  if (!config) return <Alert severity="error">{error || "Chat configuration unavailable"}</Alert>;

  return <Stack spacing={3}>
    <Stack direction="row" spacing={1.5} alignItems="center">
      <ForumRoundedIcon color="primary" sx={{ fontSize: 42 }} />
      <Box><Typography variant="h4" fontWeight={850}>Friend chats</Typography><Typography color="text.secondary">Control friend-only chat access, message safety, limits, and retention.</Typography></Box>
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
    {message && <Alert severity="success">{message}</Alert>}
    <Card component="form" onSubmit={save}>
      <Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
          <Box><Typography variant="h6" fontWeight={800}>Chat policy</Typography><Typography color="text.secondary">Phase 1 uses reliable HTTP history and sends. Realtime sockets and push delivery are scheduled for later phases.</Typography></Box>
          <FormControlLabel control={<Switch checked={Boolean(draft.enabled)} onChange={set("enabled")} />} label="Enabled" />
        </Stack>
        <Grid container spacing={2}>
          <Grid item xs={12} md={4}><TextField label="Retention days" type="number" value={draft.retentionDays ?? ""} onChange={set("retentionDays")} inputProps={{ min: 1, max: 365 }} helperText="Expired messages are deleted by the backend." fullWidth /></Grid>
          <Grid item xs={12} md={4}><TextField label="Maximum message length" type="number" value={draft.maxMessageLength ?? ""} onChange={set("maxMessageLength")} inputProps={{ min: 1, max: 5000 }} fullWidth /></Grid>
          <Grid item xs={12} md={4}><TextField label="Messages per minute" type="number" value={draft.maxMessagesPerMinute ?? ""} onChange={set("maxMessagesPerMinute")} inputProps={{ min: 1, max: 10000 }} fullWidth /></Grid>
          <Grid item xs={12} md={4}><TextField label="Messages per day" type="number" value={draft.maxMessagesPerDay ?? ""} onChange={set("maxMessagesPerDay")} inputProps={{ min: 1, max: 100000 }} fullWidth /></Grid>
          <Grid item xs={12} md={8}><TextField label="Maintenance message" value={draft.maintenanceMessage ?? ""} onChange={set("maintenanceMessage")} inputProps={{ maxLength: 300 }} helperText="Shown when chat is disabled." fullWidth /></Grid>
        </Grid>
        <Stack direction={{ xs: "column", md: "row" }} spacing={2} flexWrap="wrap">
          <FormControlLabel control={<Switch checked={Boolean(draft.friendChatOnly)} onChange={set("friendChatOnly")} />} label="Accepted friends only" />
          <FormControlLabel control={<Switch checked={Boolean(draft.allowLinks)} onChange={set("allowLinks")} />} label="Allow links" />
          <FormControlLabel control={<Switch checked={Boolean(draft.typingEnabled)} onChange={set("typingEnabled")} />} label="Typing indicators (Phase 2)" />
          <FormControlLabel control={<Switch checked={Boolean(draft.readReceiptsEnabled)} onChange={set("readReceiptsEnabled")} />} label="Read receipts (Phase 2)" />
          <FormControlLabel control={<Switch checked={Boolean(draft.pushNotificationsEnabled)} onChange={set("pushNotificationsEnabled")} />} label="Push notifications (Phase 3)" />
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
          <Typography variant="body2" color="text.secondary">Last cleanup: {config.lastCleanupAt ? new Date(config.lastCleanupAt).toLocaleString() : "not run yet"} · {config.lastCleanupDeleted} messages removed</Typography>
          <Button type="submit" variant="contained" startIcon={<SaveRoundedIcon />} disabled={saving}>{saving ? "Saving…" : "Save chat policy"}</Button>
        </Stack>
      </Stack>
    </Card>
  </Stack>;
}
