"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "../lib/api";

type Config = Record<string, any>;
type Category = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  active: boolean;
  defaultPriority: string;
};
type Agent = {
  id: string;
  level: string;
  status: string;
  revokedAt?: string | null;
  user: { id: string; username: string; email?: string | null };
  maxConcurrentLiveChats?: number;
  _count?: { assignedTickets: number };
};
type Message = {
  id: string;
  body: string;
  senderKind: string;
  createdAt: string;
};
type Ticket = {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  priority: string;
  updatedAt: string;
  player?: { username: string };
  assignedAgent?: { username?: string } | null;
  messages?: Message[];
};
type LiveChat = {
  id: string;
  sessionNumber: string;
  status: string;
  quotedPriceGld?: string;
  chargedAmountGld?: string;
  currencyCode: string;
  player?: { username?: string };
  assignedAgent?: { username?: string } | null;
  refund?: { amountGld: string; reason: string } | null;
  messages?: Message[];
};
type Audit = {
  id: string;
  action: string;
  createdAt: string;
  actor?: { username: string } | null;
  ticket?: { ticketNumber: string } | null;
};

export function SupportCenterView() {
  const [tab, setTab] = useState("configuration");
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Config>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [liveChats, setLiveChats] = useState<LiveChat[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [selectedLiveChat, setSelectedLiveChat] = useState<LiveChat | null>(
    null,
  );
  const [userId, setUserId] = useState("");
  const [reply, setReply] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState({
    key: "",
    name: "",
    description: "",
  });
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [c, cats, a, t, l, au] = await Promise.all([
        api<Config>("/support/configuration"),
        api<Category[]>("/support/categories"),
        api<Agent[]>("/support/agents"),
        api<Ticket[]>("/support/tickets?limit=100"),
        api<LiveChat[]>("/support/live-chats?limit=100"),
        api<Audit[]>("/support/audit?limit=100"),
      ]);
      setConfig(c);
      setDraft(c);
      setCategories(cats);
      setAgents(a);
      setTickets(t);
      setLiveChats(l);
      setAudit(au);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load support center",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const set = (key: string) => (event: ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({
      ...current,
      [key]:
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value,
    }));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const numeric = [
        "ticketRetentionDays",
        "messageRetentionDays",
        "maxOpenTicketsPerPlayer",
        "maxMessageLength",
        "firstResponseSlaMinutes",
        "playerReplyTimeoutHours",
        "liveChatSessionMinutes",
        "liveChatGraceMinutes",
        "maxLiveChatQueueSize",
        "autoCloseInactiveMinutes",
      ];
      const body = {
        ...draft,
        ...Object.fromEntries(numeric.map((key) => [key, Number(draft[key])])),
        liveChatPriceGld: String(draft.liveChatPriceGld ?? "2"),
      };
      const value = await api<Config>("/support/configuration", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setConfig(value);
      setDraft(value);
      setMessage("Support policy saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save policy");
    } finally {
      setSaving(false);
    }
  };
  const grant = async () => {
    if (!userId.trim()) return;
    try {
      await api("/support/agents", {
        method: "POST",
        body: JSON.stringify({ userId: userId.trim() }),
      });
      setUserId("");
      setMessage("Support-agent access granted");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to grant agent");
    }
  };
  const updateAgent = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/support/agents/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update agent");
    }
  };
  const revokeAgent = async (id: string) => {
    try {
      await api(`/support/agents/${id}/revoke`, { method: "POST", body: "{}" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to revoke agent");
    }
  };
  const openTicket = async (ticket: Ticket) => {
    try {
      setSelectedTicket(await api<Ticket>(`/support/tickets/${ticket.id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open ticket");
    }
  };
  const updateTicketStatus = async (status: string) => {
    if (!selectedTicket) return;
    try {
      setSelectedTicket(
        await api<Ticket>(`/support/tickets/${selectedTicket.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status }),
        }),
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update ticket");
    }
  };
  const openLiveChat = async (chat: LiveChat) => {
    try {
      setSelectedLiveChat(
        await api<LiveChat>(`/support/live-chats/${chat.id}`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to open live chat");
    }
  };
  const replyTicket = async () => {
    if (!selectedTicket || !reply.trim()) return;
    try {
      setSelectedTicket(
        await api<Ticket>(`/support/tickets/${selectedTicket.id}/messages`, {
          method: "POST",
          body: JSON.stringify({
            clientMessageId: `admin-${Date.now()}`,
            body: reply.trim(),
          }),
        }),
      );
      setReply("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to reply");
    }
  };
  const refund = async () => {
    if (!selectedLiveChat) return;
    const reason =
      window.prompt("Refund reason", "Admin approved live-chat refund") ||
      "Admin approved live-chat refund";
    try {
      setSelectedLiveChat(
        await api<LiveChat>(
          `/support/live-chats/${selectedLiveChat.id}/refund`,
          { method: "POST", body: JSON.stringify({ reason }) },
        ),
      );
      setMessage("Live-chat refund issued");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to refund");
    }
  };
  const sweep = async () => {
    try {
      const result = await api<{ refunded: number }>(
        "/support/live-chats/refund-sweep",
        { method: "POST", body: "{}" },
      );
      setMessage(`${result.refunded} queued chats refunded`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to run sweep");
    }
  };
  const createCategory = async () => {
    if (!categoryDraft.key || !categoryDraft.name) return;
    try {
      await api("/support/categories", {
        method: "POST",
        body: JSON.stringify(categoryDraft),
      });
      setCategoryDraft({ key: "", name: "", description: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create category");
    }
  };
  const toggleCategory = async (category: Category) => {
    try {
      await api(`/support/categories/${category.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !category.active }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update category");
    }
  };
  if (loading)
    return (
      <Stack alignItems="center" sx={{ py: 10 }}>
        <CircularProgress />
      </Stack>
    );
  if (!config)
    return (
      <Alert severity="error">{error || "Configuration unavailable"}</Alert>
    );
  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <SupportAgentRoundedIcon color="primary" sx={{ fontSize: 44 }} />
        <Box>
          <Typography variant="h4" fontWeight={850}>
            Support center
          </Typography>
          <Typography color="text.secondary">
            Tickets, paid live support, agent access, monitoring, and refunds.
          </Typography>
        </Box>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        variant="scrollable"
      >
        <Tab value="configuration" label="Configuration" />
        <Tab value="tickets" label={`Tickets (${tickets.length})`} />
        <Tab value="live-chats" label={`Live chats (${liveChats.length})`} />
        <Tab value="agents" label={`Agents (${agents.length})`} />
        <Tab value="categories" label={`Categories (${categories.length})`} />
        <Tab value="audit" label="Audit" />
      </Tabs>
      {tab === "configuration" && (
        <Card component="form" onSubmit={save}>
          <Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}>
            <Typography variant="h6" fontWeight={800}>
              Support policy
            </Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(draft.enabled)}
                    onChange={set("enabled")}
                  />
                }
                label="Support enabled"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(draft.pushNotificationsEnabled)}
                    onChange={set("pushNotificationsEnabled")}
                  />
                }
                label="Push notifications"
              />
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                fullWidth
                label="Ticket retention days"
                type="number"
                value={draft.ticketRetentionDays ?? ""}
                onChange={set("ticketRetentionDays")}
              />
              <TextField
                fullWidth
                label="Message retention days"
                type="number"
                value={draft.messageRetentionDays ?? ""}
                onChange={set("messageRetentionDays")}
              />
              <TextField
                fullWidth
                label="Max open tickets/player"
                type="number"
                value={draft.maxOpenTicketsPerPlayer ?? ""}
                onChange={set("maxOpenTicketsPerPlayer")}
              />
            </Stack>
            <TextField
              label="Maintenance message"
              value={draft.maintenanceMessage ?? ""}
              onChange={set("maintenanceMessage")}
              fullWidth
            />
            <Divider />
            <Typography variant="h6" fontWeight={800}>
              Live-chat billing and queue
            </Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(draft.liveChatEnabled)}
                    onChange={set("liveChatEnabled")}
                  />
                }
                label="Live chat enabled"
              />
              <TextField
                label="Price"
                value={draft.liveChatPriceGld ?? "2"}
                onChange={set("liveChatPriceGld")}
              />
              <TextField
                label="Currency"
                value={draft.liveChatCurrencyCode ?? "GLD"}
                onChange={set("liveChatCurrencyCode")}
              />
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
              <TextField
                fullWidth
                label="Session minutes"
                type="number"
                value={draft.liveChatSessionMinutes ?? "30"}
                onChange={set("liveChatSessionMinutes")}
              />
              <TextField
                fullWidth
                label="Grace minutes"
                type="number"
                value={draft.liveChatGraceMinutes ?? "10"}
                onChange={set("liveChatGraceMinutes")}
              />
              <TextField
                fullWidth
                label="Max queue"
                type="number"
                value={draft.maxLiveChatQueueSize ?? "25"}
                onChange={set("maxLiveChatQueueSize")}
              />
              <TextField
                fullWidth
                label="Auto-close inactive minutes"
                type="number"
                value={draft.autoCloseInactiveMinutes ?? "15"}
                onChange={set("autoCloseInactiveMinutes")}
              />
            </Stack>
            <Stack direction={{ xs: "column", md: "row" }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(draft.refundOnNoAgentConnection)}
                    onChange={set("refundOnNoAgentConnection")}
                  />
                }
                label="Refund if no agent connects"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(draft.refundOnSystemFailure)}
                    onChange={set("refundOnSystemFailure")}
                  />
                }
                label="Refund on system failure"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(draft.refundOnAgentCancellation)}
                    onChange={set("refundOnAgentCancellation")}
                  />
                }
                label="Refund player cancellation"
              />
            </Stack>
            <Button
              type="submit"
              variant="contained"
              startIcon={<SaveRoundedIcon />}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save support policy"}
            </Button>
          </Stack>
        </Card>
      )}
      {tab === "live-chats" && (
        <Stack spacing={1.5}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="h6" fontWeight={800}>
              Live-chat operations
            </Typography>
            <Button variant="outlined" onClick={() => void sweep()}>
              Refund expired queue
            </Button>
          </Stack>
          {liveChats.length === 0 && (
            <Alert severity="info">No live chats yet.</Alert>
          )}
          {liveChats.map((chat) => (
            <Card
              key={chat.id}
              sx={{ p: 2.5, cursor: "pointer" }}
              onClick={() => void openLiveChat(chat)}
            >
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
              >
                <Box>
                  <Typography fontWeight={800}>{chat.sessionNumber}</Typography>
                  <Typography color="text.secondary">
                    {chat.player?.username || "player"} ·{" "}
                    {chat.assignedAgent?.username || "unassigned"}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Chip label={chat.status} />
                  <Typography>
                    {chat.chargedAmountGld || chat.quotedPriceGld}{" "}
                    {chat.currencyCode}
                  </Typography>
                </Stack>
              </Stack>
            </Card>
          ))}
          {selectedLiveChat && (
            <Card sx={{ p: 3 }}>
              <Stack direction="row" justifyContent="space-between">
                <Box>
                  <Typography variant="h6">
                    {selectedLiveChat.sessionNumber}
                  </Typography>
                  <Typography color="text.secondary">
                    {selectedLiveChat.status} ·{" "}
                    {selectedLiveChat.player?.username || "player"}
                  </Typography>
                </Box>
                <Stack direction="row">
                  <Button
                    color="warning"
                    onClick={() => void refund()}
                    disabled={Boolean(selectedLiveChat.refund)}
                  >
                    Refund
                  </Button>
                  <Button onClick={() => setSelectedLiveChat(null)}>
                    Close
                  </Button>
                </Stack>
              </Stack>
              <Divider sx={{ my: 2 }} />
              {(selectedLiveChat.messages || []).map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    mb: 1.5,
                    p: 1.5,
                    bgcolor: "rgba(148,163,184,.08)",
                    borderRadius: 2,
                  }}
                >
                  <Typography variant="caption">{item.senderKind}</Typography>
                  <Typography>{item.body}</Typography>
                </Box>
              ))}
            </Card>
          )}
        </Stack>
      )}
      {tab === "tickets" && (
        <Stack spacing={1.5}>
          {tickets.map((ticket) => (
            <Card
              key={ticket.id}
              sx={{ p: 2.5, cursor: "pointer" }}
              onClick={() => void openTicket(ticket)}
            >
              <Typography fontWeight={800}>
                {ticket.ticketNumber} · {ticket.subject}
              </Typography>
              <Typography color="text.secondary">
                {ticket.player?.username || "player"} · {ticket.status} ·{" "}
                {ticket.assignedAgent?.username || "Unassigned"}
              </Typography>
            </Card>
          ))}
          {selectedTicket && (
            <Card sx={{ p: 3 }}>
              <Typography variant="h6">
                {selectedTicket.ticketNumber} · {selectedTicket.subject}
              </Typography>
              <Divider sx={{ my: 2 }} />
              {(selectedTicket.messages || []).map((item) => (
                <Box
                  key={item.id}
                  sx={{
                    mb: 1.5,
                    p: 1.5,
                    bgcolor: "rgba(148,163,184,.08)",
                    borderRadius: 2,
                  }}
                >
                  <Typography variant="caption">{item.senderKind}</Typography>
                  <Typography>{item.body}</Typography>
                </Box>
              ))}
              <Stack direction="row" spacing={1}>
                <TextField
                  fullWidth
                  label="Reply"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                />
                <Button variant="contained" onClick={() => void replyTicket()}>
                  Reply
                </Button>
                <Select
                  size="small"
                  value={selectedTicket.status}
                  onChange={(event) =>
                    void updateTicketStatus(String(event.target.value))
                  }
                >
                  <MenuItem value="TRIAGED">Triaged</MenuItem>
                  <MenuItem value="WAITING_FOR_PLAYER">
                    Waiting for player
                  </MenuItem>
                  <MenuItem value="RESOLVED">Resolved</MenuItem>
                  <MenuItem value="CLOSED">Closed</MenuItem>
                  <MenuItem value="REOPENED">Reopen</MenuItem>
                </Select>
              </Stack>
            </Card>
          )}
        </Stack>
      )}
      {tab === "agents" && (
        <Stack spacing={2}>
          <Card sx={{ p: 2.5 }}>
            <Typography variant="h6">Grant support-agent access</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
              <TextField
                fullWidth
                label="Player UUID"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
              />
              <Button variant="contained" onClick={() => void grant()}>
                Grant
              </Button>
            </Stack>
          </Card>
          {agents.map((agent) => (
            <Card key={agent.id} sx={{ p: 2.5 }}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                justifyContent="space-between"
              >
                <Box>
                  <Typography fontWeight={800}>
                    {agent.user.username}
                  </Typography>
                  <Typography color="text.secondary">
                    {agent.user.email || agent.user.id} ·{" "}
                    {agent._count?.assignedTickets ?? 0} assigned tickets
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Select
                    size="small"
                    value={agent.level}
                    onChange={(event) =>
                      void updateAgent(agent.id, { level: event.target.value })
                    }
                  >
                    <MenuItem value="AGENT">Agent</MenuItem>
                    <MenuItem value="SENIOR">Senior</MenuItem>
                    <MenuItem value="SUPERVISOR">Supervisor</MenuItem>
                  </Select>
                  <Select
                    size="small"
                    value={agent.status}
                    onChange={(event) =>
                      void updateAgent(agent.id, { status: event.target.value })
                    }
                  >
                    <MenuItem value="OFFLINE">Offline</MenuItem>
                    <MenuItem value="AVAILABLE">Available</MenuItem>
                    <MenuItem value="BUSY">Busy</MenuItem>
                    <MenuItem value="SUSPENDED">Suspended</MenuItem>
                  </Select>
                  <TextField
                    size="small"
                    type="number"
                    label="Live chats"
                    value={agent.maxConcurrentLiveChats ?? 2}
                    onChange={(event) =>
                      void updateAgent(agent.id, {
                        maxConcurrentLiveChats: Number(event.target.value),
                      })
                    }
                    sx={{ width: 110 }}
                  />
                  <Button
                    color="error"
                    onClick={() => void revokeAgent(agent.id)}
                    disabled={Boolean(agent.revokedAt)}
                  >
                    Revoke
                  </Button>
                </Stack>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
      {tab === "categories" && (
        <Stack spacing={1.5}>
          <Card sx={{ p: 2.5 }}>
            <Typography variant="h6">Add category</Typography>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              sx={{ mt: 2 }}
            >
              <TextField
                label="Key"
                value={categoryDraft.key}
                onChange={(event) =>
                  setCategoryDraft({
                    ...categoryDraft,
                    key: event.target.value,
                  })
                }
              />
              <TextField
                label="Name"
                value={categoryDraft.name}
                onChange={(event) =>
                  setCategoryDraft({
                    ...categoryDraft,
                    name: event.target.value,
                  })
                }
              />
              <TextField
                fullWidth
                label="Description"
                value={categoryDraft.description}
                onChange={(event) =>
                  setCategoryDraft({
                    ...categoryDraft,
                    description: event.target.value,
                  })
                }
              />
              <Button variant="contained" onClick={() => void createCategory()}>
                Add
              </Button>
            </Stack>
          </Card>
          {categories.map((category) => (
            <Card key={category.id} sx={{ p: 2.5 }}>
              <Stack direction="row" justifyContent="space-between">
                <Box>
                  <Typography fontWeight={800}>{category.name}</Typography>
                  <Typography color="text.secondary">
                    {category.description || category.key}
                  </Typography>
                </Box>
                <Button onClick={() => void toggleCategory(category)}>
                  {category.active ? "Disable" : "Enable"}
                </Button>
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
      {tab === "audit" && (
        <Stack spacing={1.5}>
          {audit.map((event) => (
            <Card key={event.id} sx={{ p: 2 }}>
              <Typography fontWeight={800}>{event.action}</Typography>
              <Typography color="text.secondary">
                {event.actor?.username || "System"} ·{" "}
                {event.ticket?.ticketNumber || "Global"} ·{" "}
                {new Date(event.createdAt).toLocaleString()}
              </Typography>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
