"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import ForumRoundedIcon from "@mui/icons-material/ForumRounded";
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
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
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
  includeMessagePreview: boolean;
  friendChatOnly: boolean;
  allowLinks: boolean;
  maintenanceMessage: string | null;
  lastCleanupAt: string | null;
  lastCleanupDeleted: number;
};

export function ChatsView({ onOpenPlayer360 }: { onOpenPlayer360?: (userId: string) => void }) {
  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [draft, setDraft] = useState<Partial<ChatConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"configuration" | "conversations" | "reports">("configuration");

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
        includeMessagePreview: Boolean(draft.includeMessagePreview),
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

  const runRetention = async () => {
    setError("");
    try {
      const value = await api<ChatConfig>("/chats/retention/run", { method: "POST", body: "{}" });
      setConfig((current) => current ? { ...current, lastCleanupAt: value.lastCleanupAt, lastCleanupDeleted: value.lastCleanupDeleted } : current);
      setMessage("Chat retention cleanup completed");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to run retention cleanup"); }
  };

  if (loading) return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  if (!config) return <Alert severity="error">{error || "Chat configuration unavailable"}</Alert>;

  if (tab !== "configuration") return <ChatOperationsView tab={tab} onTabChange={setTab} onOpenPlayer360={onOpenPlayer360} />;

  return <Stack spacing={3}>
    <Stack direction="row" spacing={1.5} alignItems="center">
      <ForumRoundedIcon color="primary" sx={{ fontSize: 42 }} />
      <Box><Typography variant="h4" fontWeight={850}>Friend chats</Typography><Typography color="text.secondary">Control friend-only chat access, message safety, limits, and retention.</Typography></Box>
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
    {message && <Alert severity="success">{message}</Alert>}
    <Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab value="configuration" label="Configuration" /><Tab value="conversations" label="Conversations" /><Tab value="reports" label="Moderation & reports" /></Tabs>
    <Card component="form" onSubmit={save}>
      <Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}>
        <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}>
          <Box><Typography variant="h6" fontWeight={800}>Chat policy</Typography><Typography color="text.secondary">Control retention, safety limits, live features, durable inbox notifications, and moderation behavior.</Typography></Box>
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
          <FormControlLabel control={<Switch checked={Boolean(draft.includeMessagePreview)} onChange={set("includeMessagePreview")} />} label="Include chat preview in push" />
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" alignItems={{ sm: "center" }} spacing={1}>
          <Typography variant="body2" color="text.secondary">Last cleanup: {config.lastCleanupAt ? new Date(config.lastCleanupAt).toLocaleString() : "not run yet"} · {config.lastCleanupDeleted} messages removed</Typography>
          <Stack direction="row" spacing={1}><Button type="button" variant="outlined" onClick={() => void runRetention()}>Run cleanup</Button><Button type="submit" variant="contained" startIcon={<SaveRoundedIcon />} disabled={saving}>{saving ? "Saving…" : "Save chat policy"}</Button></Stack>
        </Stack>
      </Stack>
    </Card>
  </Stack>;
}

type AdminChatConversation = {
  id: string;
  status: string;
  archivedAt: string | null;
  participants: Array<{ id: string; username: string; name: string; avatarUrl?: string | null; lastOnline?: string | null }>;
  lastMessage: { id: string; body: string; createdAt: string; sender?: { name: string } | null } | null;
  messageCount: number;
  reportCount: number;
};

type AdminChatMessage = { id: string; conversationId: string; senderId: string; body: string; createdAt: string; state: string; reports?: Array<{ id: string; status: string; category: string }> };
type AdminChatReport = { id: string; category: string; reason: string | null; status: string; createdAt: string; reporter: { id: string; username: string; name: string }; conversation: { id: string }; message: { id: string; body: string; senderId: string; moderationState: string } | null };

function ChatOperationsView({ tab, onTabChange, onOpenPlayer360 }: { tab: "conversations" | "reports"; onTabChange: (value: "configuration" | "conversations" | "reports") => void; onOpenPlayer360?: (userId: string) => void }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [conversations, setConversations] = useState<AdminChatConversation[]>([]);
  const [selected, setSelected] = useState<AdminChatConversation | null>(null);
  const [messages, setMessages] = useState<AdminChatMessage[]>([]);
  const [reports, setReports] = useState<AdminChatReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadConversations = async () => {
    setLoading(true); setError("");
    try { const value = await api<{ conversations: AdminChatConversation[] }>(`/chats/conversations?search=${encodeURIComponent(search)}${status ? `&status=${status}` : ""}`); setConversations(value.conversations || []); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load conversations"); }
    finally { setLoading(false); }
  };
  const loadReports = async () => {
    setLoading(true); setError("");
    try { setReports(await api<AdminChatReport[]>("/chats/reports?status=OPEN")); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load reports"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    if (tab === "conversations") void loadConversations(); else void loadReports();
    const timer = window.setInterval(() => { if (tab === "conversations") void loadConversations(); else void loadReports(); }, 15000);
    return () => window.clearInterval(timer);
  }, [tab, status]);
  const openConversation = async (conversation: AdminChatConversation) => {
    setSelected(conversation); setError("");
    try { const value = await api<{ messages: AdminChatMessage[] }>(`/chats/conversations/${conversation.id}/messages`); setMessages(value.messages || []); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to load messages"); }
  };
  const moderate = async (path: string, body: object, success: string) => {
    try { await api(path, { method: "POST", body: JSON.stringify(body) }); setNotice(success); if (selected) await openConversation(selected); await loadReports(); }
    catch (e) { setError(e instanceof Error ? e.message : "Moderation action failed"); }
  };

  return <Stack spacing={3}>
    <Stack direction="row" spacing={1.5} alignItems="center"><ForumRoundedIcon color="primary" sx={{ fontSize: 42 }} /><Box><Typography variant="h4" fontWeight={850}>Friend chats</Typography><Typography color="text.secondary">Inspect live conversations, retain evidence, and resolve player reports.</Typography></Box></Stack>
    <Tabs value={tab} onChange={(_, value) => onTabChange(value)}><Tab value="configuration" label="Configuration" /><Tab value="conversations" label="Conversations" /><Tab value="reports" label="Moderation & reports" /></Tabs>
    {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success">{notice}</Alert>}
    {tab === "conversations" && <>
      <Card><Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ p: 2 }}><TextField size="small" fullWidth placeholder="Search username, display name, conversation or message ID" value={search} onChange={(event) => setSearch(event.target.value)} /><Select size="small" value={status} onChange={(event) => setStatus(event.target.value)} displayEmpty><MenuItem value="">All conversations</MenuItem><MenuItem value="ACTIVE">Active</MenuItem><MenuItem value="ARCHIVED">Archived</MenuItem><MenuItem value="REPORTED">Reported</MenuItem><MenuItem value="RESTRICTED">Restricted</MenuItem><MenuItem value="MUTED">Muted</MenuItem><MenuItem value="EXPIRING">Expiring soon</MenuItem></Select><Button variant="contained" onClick={loadConversations}>Search</Button></Stack></Card>
      <Stack spacing={1.5}>{loading ? <CircularProgress /> : conversations.map((conversation) => <Card key={conversation.id} onClick={() => void openConversation(conversation)} sx={{ cursor: "pointer", border: selected?.id === conversation.id ? "1px solid" : undefined, borderColor: "primary.main" }}><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1} sx={{ p: 2.5 }}><Box><Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={800}>{conversation.participants.map((player) => player.name || player.username).join(" · ") || conversation.id}</Typography><Chip size="small" label={conversation.status} color={conversation.status === "ACTIVE" ? "success" : "default"} /></Stack><Typography variant="caption" color="text.secondary">{conversation.messageCount} messages · {conversation.reportCount} reports · {conversation.lastMessage ? new Date(conversation.lastMessage.createdAt).toLocaleString() : "No messages"}</Typography><Typography sx={{ mt: 1 }} noWrap>{conversation.lastMessage?.body || "No messages yet"}</Typography></Box><Stack direction="row" spacing={.5} alignItems="center">{conversation.participants.map((player) => <Button key={player.id} size="small" onClick={(event) => { event.stopPropagation(); onOpenPlayer360?.(player.id); }}>{player.name || player.username}</Button>)}</Stack></Stack></Card>)}{!loading && !conversations.length && <Typography color="text.secondary">No conversations match this filter.</Typography>}</Stack>
      {selected && <Card><Stack spacing={2} sx={{ p: 2.5 }}><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ md: "center" }} spacing={1}><Box><Typography variant="h6" fontWeight={800}>Conversation messages</Typography><Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>{selected.id}</Typography></Box><Stack direction="row" spacing={1} flexWrap="wrap"><Button size="small" onClick={() => void api(`/chats/conversations/${selected.id}/status`, { method: "PATCH", body: JSON.stringify({ status: selected.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE", reason: "Updated from chat operations" }) }).then(() => { setNotice("Conversation status updated"); void loadConversations(); }).catch((e) => setError(e instanceof Error ? e.message : "Could not update status"))}>{selected.status === "ACTIVE" ? "Archive" : "Restore"}</Button>{selected.participants.map((player) => <Button key={player.id} size="small" color="warning" onClick={() => { const reason = window.prompt(`Restriction reason for ${player.name || player.username}`); if (reason) void moderate(`/chats/conversations/${selected.id}/restrict`, { userId: player.id, reason }, "Player restricted"); }}>Restrict {player.name || player.username}</Button>)}<Button size="small" onClick={() => setSelected(null)}>Close</Button></Stack></Stack><Divider />{messages.map((item) => <Box key={item.id} sx={{ p: 1.5, borderRadius: 2, bgcolor: "action.hover" }}><Stack direction="row" justifyContent="space-between"><Typography variant="caption" color="text.secondary">{item.senderId} · {new Date(item.createdAt).toLocaleString()}</Typography><Chip size="small" label={item.state} color={item.state === "REMOVED" ? "error" : item.state === "FLAGGED" ? "warning" : "default"} /></Stack><Typography sx={{ mt: .5, whiteSpace: "pre-wrap" }}>{item.body}</Typography><Stack direction="row" spacing={1} sx={{ mt: 1 }}><Button size="small" color="error" onClick={() => void moderate(`/chats/messages/${item.id}/remove`, { reason: "Removed after System Admin review" }, "Message removed")}>Remove</Button><Button size="small" onClick={() => void moderate(`/chats/messages/${item.id}/preserve`, { reason: "Preserved for moderation review" }, "Evidence preserved")}>Preserve evidence</Button></Stack></Box>)}{!messages.length && <Typography color="text.secondary">No messages.</Typography>}</Stack></Card>}
    </>}
    {tab === "reports" && <Card><Stack spacing={2} sx={{ p: 2.5 }}>{loading ? <CircularProgress /> : reports.map((report) => <Box key={report.id} sx={{ p: 2, borderRadius: 2, bgcolor: "action.hover" }}><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}><Box><Stack direction="row" spacing={1} alignItems="center"><Chip size="small" label={report.category} color="warning" /><Typography variant="caption" color="text.secondary">{new Date(report.createdAt).toLocaleString()}</Typography></Stack><Button size="small" onClick={() => onOpenPlayer360?.(report.reporter.id)}>{report.reporter.name || report.reporter.username}</Button><Typography sx={{ mt: 1 }} fontWeight={750}>{report.message?.body || "Message unavailable"}</Typography><Typography variant="body2" color="text.secondary">{report.reason || "No additional reason"}</Typography></Box><Stack direction="row" spacing={1}><Button size="small" color="error" disabled={!report.message} onClick={() => report.message && void moderate(`/chats/messages/${report.message.id}/remove`, { reason: `Report ${report.id} reviewed` }, "Reported message removed")}>Remove</Button><Button size="small" onClick={() => void api(`/chats/reports/${report.id}`, { method: "PATCH", body: JSON.stringify({ status: "RESOLVED", resolutionNote: "Reviewed by System Admin" }) }).then(() => { setNotice("Report resolved"); void loadReports(); }).catch((e) => setError(e instanceof Error ? e.message : "Could not resolve report"))}>Resolve</Button><Button size="small" onClick={() => void api(`/chats/reports/${report.id}`, { method: "PATCH", body: JSON.stringify({ status: "DISMISSED", resolutionNote: "Report dismissed after review" }) }).then(() => { setNotice("Report dismissed"); void loadReports(); }).catch((e) => setError(e instanceof Error ? e.message : "Could not dismiss report"))}>Dismiss</Button></Stack></Stack></Box>)}{!loading && !reports.length && <Typography color="text.secondary">No open reports.</Typography>}</Stack></Card>}
  </Stack>;
}
