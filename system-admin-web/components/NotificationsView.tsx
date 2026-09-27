"use client";

import { useEffect, useState } from "react";

import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";

type Broadcast = {
  id: string;
  title: string;
  body: string;
  recipientCount: number;
  pushSentCount: number;
  pushFailedCount: number;
  createdAt: string;
  createdBy: { username: string; email: string | null };
};

type PushStatus = { configured: boolean; activeDevices: number };

export function NotificationsView() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [route, setRoute] = useState("");
  const [items, setItems] = useState<Broadcast[]>([]);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [nextItems, nextStatus] = await Promise.all([
        api<Broadcast[]>("/notifications/broadcasts"),
        api<PushStatus>("/notifications/status"),
      ]);
      setItems(nextItems);
      setStatus(nextStatus);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unable to load notifications", error: true });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const send = async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await api("/notifications/broadcast", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), body: body.trim(), route: route.trim() || undefined }),
      });
      setTitle("");
      setBody("");
      setRoute("");
      setMessage({ text: "The message was added to every active player's inbox and sent to registered devices." });
      await load();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unable to send notification", error: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={2}>
        <Box>
          <Typography variant="overline" color="primary.light">PLAYER COMMUNICATION</Typography>
          <Typography variant="h4" fontWeight={900}>Notifications</Typography>
          <Typography color="text.secondary">Compose a global message or review recent delivery history.</Typography>
        </Box>
        {status && <Chip icon={<CampaignRoundedIcon />} label={status.configured ? `FCM connected · ${status.activeDevices} devices` : "FCM not configured"} color={status.configured ? "success" : "warning"} variant="outlined" />}
      </Stack>

      {message && <Alert severity={message.error ? "error" : "success"}>{message.text}</Alert>}

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6" fontWeight={850}>Send global message</Typography>
            <Typography variant="body2" color="text.secondary">Every active player receives an unread inbox item. Registered mobile devices also receive an FCM push.</Typography>
            <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} inputProps={{ maxLength: 160 }} fullWidth />
            <TextField label="Message" value={body} onChange={(event) => setBody(event.target.value)} inputProps={{ maxLength: 4000 }} minRows={4} multiline fullWidth />
            <TextField label="Optional mobile route" placeholder="/wallet" value={route} onChange={(event) => setRoute(event.target.value)} inputProps={{ maxLength: 200 }} helperText="The app can use this later to open a destination when the push is tapped." fullWidth />
            <Box>
              <Button variant="contained" startIcon={saving ? <CircularProgress size={17} color="inherit" /> : <SendRoundedIcon />} disabled={saving || !title.trim() || !body.trim()} onClick={() => void send()}>Send to all active players</Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Stack spacing={1.5}>
        <Typography variant="h5" fontWeight={850}>Recent broadcasts</Typography>
        {loading ? <CircularProgress size={24} /> : items.length === 0 ? <Card variant="outlined"><CardContent><Typography color="text.secondary">No global messages have been sent yet.</Typography></CardContent></Card> : items.map((item) => (
          <Card key={item.id} variant="outlined">
            <CardContent>
              <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                <Box><Typography fontWeight={850}>{item.title}</Typography><Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>{item.body}</Typography></Box>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`${item.recipientCount} inboxes`} />
                  <Chip size="small" label={`${item.pushSentCount} pushes`} color="success" variant="outlined" />
                  {item.pushFailedCount > 0 && <Chip size="small" label={`${item.pushFailedCount} failed`} color="error" variant="outlined" />}
                </Stack>
              </Stack>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{new Date(item.createdAt).toLocaleString()} · {item.createdBy.username}</Typography>
            </CardContent>
          </Card>
        ))}
      </Stack>
    </Stack>
  );
}
