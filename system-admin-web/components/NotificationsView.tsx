"use client";

import { useEffect, useState } from "react";

import CampaignRoundedIcon from "@mui/icons-material/CampaignRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import DoneAllRoundedIcon from "@mui/icons-material/DoneAllRounded";
import ErrorRoundedIcon from "@mui/icons-material/ErrorRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewRoundedIcon from "@mui/icons-material/OpenInNewRounded";
import PaidRoundedIcon from "@mui/icons-material/PaidRounded";
import RefreshRoundedIcon from "@mui/icons-material/RefreshRounded";
import SendRoundedIcon from "@mui/icons-material/SendRounded";
import WarningAmberRoundedIcon from "@mui/icons-material/WarningAmberRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
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

type AdminAlert = {
  id: string;
  category: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  data: { route?: string } | null;
  readAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

type AdminFeed = {
  items: AdminAlert[];
  unreadCount: number;
  openCount: number;
  severityCounts: { info?: number; warning?: number; critical?: number };
  dailyProfit: {
    dateKey: string;
    grossAdRevenueUsdMicros: string;
    rewardBackingUsdMicros: string;
    reserveAddedUsdMicros: string;
    companyProfitUsdMicros: string;
    snapshotCount: number;
  };
  syncedAt: string;
};

type PushStatus = { configured: boolean; activeDevices: number };

function money(micros: string | number | undefined) {
  const value = Number(micros || 0) / 1_000_000;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function severityIcon(severity: AdminAlert["severity"]) {
  if (severity === "CRITICAL") return <ErrorRoundedIcon color="error" />;
  if (severity === "WARNING") return <WarningAmberRoundedIcon color="warning" />;
  return <InfoOutlinedIcon color="info" />;
}

export function NotificationsView() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [route, setRoute] = useState("");
  const [items, setItems] = useState<Broadcast[]>([]);
  const [adminFeed, setAdminFeed] = useState<AdminFeed | null>(null);
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const load = async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const [nextItems, nextStatus, nextAdminFeed] = await Promise.all([
        api<Broadcast[]>("/notifications/broadcasts"),
        api<PushStatus>("/notifications/status"),
        api<AdminFeed>("/notifications/admin?limit=100"),
      ]);
      setItems(nextItems);
      setStatus(nextStatus);
      setAdminFeed(nextAdminFeed);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unable to load notifications", error: true });
    } finally {
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(false), 60_000);
    return () => window.clearInterval(refresh);
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
      await load(false);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unable to send notification", error: true });
    } finally {
      setSaving(false);
    }
  };

  const markRead = async (id: string) => {
    await api(`/notifications/admin/${id}/read`, { method: "POST" });
    await load(false);
  };

  const resolve = async (id: string) => {
    await api(`/notifications/admin/${id}/resolve`, { method: "POST" });
    await load(false);
  };

  const markAllRead = async () => {
    await api("/notifications/admin/read-all", { method: "POST" });
    await load(false);
  };

  const openRoute = (routeValue?: string) => {
    if (!routeValue) return;
    window.history.pushState({}, "", `/system-admin${routeValue}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={2}>
        <Box>
          <Typography variant="overline" color="primary.light">OPERATIONS & PLAYER COMMUNICATION</Typography>
          <Typography variant="h4" fontWeight={900}>Notifications</Typography>
          <Typography color="text.secondary">Review system alerts, reward requests, risk signals, daily profit, and player broadcasts in one place.</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {status && <Chip icon={<CampaignRoundedIcon />} label={status.configured ? `FCM connected · ${status.activeDevices} devices` : "FCM not configured"} color={status.configured ? "success" : "warning"} variant="outlined" />}
          <IconButton onClick={() => void load()} aria-label="Refresh notifications"><RefreshRoundedIcon /></IconButton>
        </Stack>
      </Stack>

      {message && <Alert severity={message.error ? "error" : "success"}>{message.text}</Alert>}

      {adminFeed && <>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 1.5 }}>
          <Card><CardContent><Typography variant="overline" color="text.secondary">Open alerts</Typography><Typography variant="h4" fontWeight={900}>{adminFeed.openCount}</Typography><Typography variant="caption" color="text.secondary">{adminFeed.unreadCount} unread</Typography></CardContent></Card>
          <Card><CardContent><Typography variant="overline" color="error.main">Critical</Typography><Typography variant="h4" fontWeight={900}>{adminFeed.severityCounts.critical || 0}</Typography><Typography variant="caption" color="text.secondary">needs immediate review</Typography></CardContent></Card>
          <Card><CardContent><Typography variant="overline" color="warning.main">Warnings</Typography><Typography variant="h4" fontWeight={900}>{adminFeed.severityCounts.warning || 0}</Typography><Typography variant="caption" color="text.secondary">active operational risks</Typography></CardContent></Card>
          <Card sx={{ borderColor: "rgba(139,125,255,.45)" }}><CardContent><Stack direction="row" justifyContent="space-between" alignItems="flex-start"><Box><Typography variant="overline" color="primary.light">Today’s company profit</Typography><Typography variant="h4" fontWeight={900}>{money(adminFeed.dailyProfit.companyProfitUsdMicros)}</Typography><Typography variant="caption" color="text.secondary">{adminFeed.dailyProfit.dateKey} · {adminFeed.dailyProfit.snapshotCount} snapshots</Typography></Box><PaidRoundedIcon color="primary" /></Stack></CardContent></Card>
        </Box>

        <Card>
          <CardContent>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
              <Box><Typography variant="h6" fontWeight={850}>Daily economy snapshot</Typography><Typography variant="body2" color="text.secondary">Recognized revenue allocations recorded for today in UTC.</Typography></Box>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip size="small" label={`Gross ${money(adminFeed.dailyProfit.grossAdRevenueUsdMicros)}`} />
                <Chip size="small" label={`Player ${money(adminFeed.dailyProfit.rewardBackingUsdMicros)}`} color="success" variant="outlined" />
                <Chip size="small" label={`Reserve ${money(adminFeed.dailyProfit.reserveAddedUsdMicros)}`} color="info" variant="outlined" />
                <Chip size="small" label={`Company ${money(adminFeed.dailyProfit.companyProfitUsdMicros)}`} color="primary" variant="outlined" />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
              <Box><Typography variant="h6" fontWeight={850}>Admin alert feed</Typography><Typography variant="body2" color="text.secondary">Fraud, reward approvals, infrastructure health, failed operations, and review queues.</Typography></Box>
              <Button size="small" startIcon={<DoneAllRoundedIcon />} disabled={!adminFeed.unreadCount} onClick={() => void markAllRead()}>Mark all read</Button>
            </Stack>
            <Divider sx={{ my: 2 }} />
            {loading ? <CircularProgress size={24} /> : adminFeed.items.length === 0 ? <Typography color="text.secondary">No administrator alerts have been generated.</Typography> : <Stack spacing={1.25}>
              {adminFeed.items.map((item) => <Card key={item.id} variant="outlined" sx={{ opacity: item.resolvedAt ? 0.6 : 1, borderColor: item.resolvedAt ? undefined : item.severity === "CRITICAL" ? "rgba(244,67,54,.55)" : item.severity === "WARNING" ? "rgba(255,167,38,.5)" : undefined }}>
                <CardContent sx={{ py: "14px !important" }}>
                  <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "center" }}>
                    <Box sx={{ display: "flex", alignItems: "center" }}>{severityIcon(item.severity)}</Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap><Typography fontWeight={850}>{item.title}</Typography><Chip size="small" label={item.category.replaceAll("_", " ")} variant="outlined" /><Chip size="small" label={item.severity} color={item.severity === "CRITICAL" ? "error" : item.severity === "WARNING" ? "warning" : "info"} /></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{item.body}</Typography><Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.75 }}>{new Date(item.createdAt).toLocaleString()}{item.resolvedAt ? " · Resolved" : item.readAt ? " · Read" : " · Unread"}</Typography></Box>
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      {item.data?.route && <Button size="small" endIcon={<OpenInNewRoundedIcon />} onClick={() => openRoute(item.data?.route)}>Open</Button>}
                      {!item.readAt && !item.resolvedAt && <Button size="small" onClick={() => void markRead(item.id)}>Read</Button>}
                      {!item.resolvedAt && <Button size="small" color="success" startIcon={<CheckCircleRoundedIcon />} onClick={() => void resolve(item.id)}>Resolve</Button>}
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>)}
            </Stack>}
          </CardContent>
        </Card>
      </>}

      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography variant="h6" fontWeight={850}>Send global message</Typography>
            <Typography variant="body2" color="text.secondary">Every active player receives an unread inbox item. Registered mobile devices also receive an FCM push.</Typography>
            <TextField label="Title" value={title} onChange={(event) => setTitle(event.target.value)} inputProps={{ maxLength: 160 }} fullWidth />
            <TextField label="Message" value={body} onChange={(event) => setBody(event.target.value)} inputProps={{ maxLength: 4000 }} minRows={4} multiline fullWidth />
            <TextField label="Optional mobile route" placeholder="/wallet" value={route} onChange={(event) => setRoute(event.target.value)} inputProps={{ maxLength: 200 }} helperText="The app can use this later to open a destination when the push is tapped." fullWidth />
            <Box><Button variant="contained" startIcon={saving ? <CircularProgress size={17} color="inherit" /> : <SendRoundedIcon />} disabled={saving || !title.trim() || !body.trim()} onClick={() => void send()}>Send to all active players</Button></Box>
          </Stack>
        </CardContent>
      </Card>

      <Stack spacing={1.5}>
        <Typography variant="h5" fontWeight={850}>Recent broadcasts</Typography>
        {loading ? <CircularProgress size={24} /> : items.length === 0 ? <Card variant="outlined"><CardContent><Typography color="text.secondary">No global messages have been sent yet.</Typography></CardContent></Card> : items.map((item) => <Card key={item.id} variant="outlined"><CardContent><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}><Box><Typography fontWeight={850}>{item.title}</Typography><Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>{item.body}</Typography></Box><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap><Chip size="small" label={`${item.recipientCount} inboxes`} /><Chip size="small" label={`${item.pushSentCount} pushes`} color="success" variant="outlined" />{item.pushFailedCount > 0 && <Chip size="small" label={`${item.pushFailedCount} failed`} color="error" variant="outlined" />}</Stack></Stack><Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>{new Date(item.createdAt).toLocaleString()} · {item.createdBy.username}</Typography></CardContent></Card>)}
      </Stack>
    </Stack>
  );
}
