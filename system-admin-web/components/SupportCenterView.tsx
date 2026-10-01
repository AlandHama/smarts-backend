"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import SupportAgentRoundedIcon from "@mui/icons-material/SupportAgentRounded";
import ConfirmationNumberRoundedIcon from "@mui/icons-material/ConfirmationNumberRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { api } from "../lib/api";

type Config = { enabled: boolean; maintenanceMessage: string | null; ticketRetentionDays: number; messageRetentionDays: number; maxOpenTicketsPerPlayer: number; maxMessageLength: number; firstResponseSlaMinutes: number; playerReplyTimeoutHours: number; pushNotificationsEnabled: boolean; liveChatEnabled: boolean; liveChatPriceGld: string };
type Category = { id: string; key: string; name: string; description?: string | null; active: boolean; sortOrder: number; defaultPriority: string };
type Agent = { id: string; level: string; status: string; revokedAt?: string | null; user: { id: string; username: string; firstName?: string | null; lastName?: string | null; email?: string | null }; _count?: { assignedTickets: number } };
type TicketMessage = { id: string; body: string; senderKind: string; createdAt: string };
type Ticket = { id: string; ticketNumber: string; subject: string; status: string; priority: string; updatedAt: string; category?: { name: string }; player?: { username: string }; assignedAgent?: { username?: string } | null; messages?: TicketMessage[] };
type Audit = { id: string; action: string; createdAt: string; actor?: { username: string } | null; ticket?: { ticketNumber: string; subject: string } | null };

export function SupportCenterView() {
  const [tab, setTab] = useState("configuration");
  const [config, setConfig] = useState<Config | null>(null);
  const [draft, setDraft] = useState<Partial<Config>>({});
  const [categories, setCategories] = useState<Category[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [userId, setUserId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [reply, setReply] = useState("");
  const [categoryDraft, setCategoryDraft] = useState({ key: "", name: "", description: "" });

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [nextConfig, nextCategories, nextAgents, nextTickets, nextAudit] = await Promise.all([
        api<Config>("/support/configuration"),
        api<Category[]>("/support/categories"),
        api<Agent[]>("/support/agents"),
        api<Ticket[]>("/support/tickets?limit=100"),
        api<Audit[]>("/support/audit?limit=100"),
      ]);
      setConfig(nextConfig); setDraft(nextConfig); setCategories(nextCategories); setAgents(nextAgents); setTickets(nextTickets); setAudit(nextAudit);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load support center"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  const set = (key: keyof Config) => (event: ChangeEvent<HTMLInputElement>) => setDraft((current) => ({ ...current, [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value }));
  const save = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try {
      const value = await api<Config>("/support/configuration", { method: "PATCH", body: JSON.stringify({ ...draft, ticketRetentionDays: Number(draft.ticketRetentionDays), messageRetentionDays: Number(draft.messageRetentionDays), maxOpenTicketsPerPlayer: Number(draft.maxOpenTicketsPerPlayer), maxMessageLength: Number(draft.maxMessageLength), firstResponseSlaMinutes: Number(draft.firstResponseSlaMinutes), playerReplyTimeoutHours: Number(draft.playerReplyTimeoutHours), liveChatPriceGld: String(draft.liveChatPriceGld ?? "2") }) });
      setConfig(value); setDraft(value); setMessage("Support policy saved");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save support policy"); }
    finally { setSaving(false); }
  };
  const grant = async () => {
    if (!userId.trim()) return;
    try { await api("/support/agents", { method: "POST", body: JSON.stringify({ userId: userId.trim() }) }); setUserId(""); setMessage("Support-agent access granted"); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to grant agent access"); }
  };
  const revoke = async (id: string) => { try { await api(`/support/agents/${id}/revoke`, { method: "POST", body: "{}" }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to revoke agent"); } };
  const updateAgent = async (id: string, body: Record<string, unknown>) => { try { await api(`/support/agents/${id}`, { method: "PATCH", body: JSON.stringify(body) }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update agent"); } };
  const openTicket = async (ticket: Ticket) => { try { setSelectedTicket(await api<Ticket>(`/support/tickets/${ticket.id}`)); } catch (e) { setError(e instanceof Error ? e.message : "Unable to open ticket"); } };
  const updateTicket = async (status: string) => { if (!selectedTicket) return; try { setSelectedTicket(await api<Ticket>(`/support/tickets/${selectedTicket.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) })); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update ticket"); } };
  const sendReply = async () => { if (!selectedTicket || !reply.trim()) return; try { setSelectedTicket(await api<Ticket>(`/support/tickets/${selectedTicket.id}/messages`, { method: "POST", body: JSON.stringify({ clientMessageId: `admin-${Date.now()}`, body: reply.trim() }) })); setReply(""); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to reply"); } };
  const createCategory = async () => { if (!categoryDraft.key.trim() || !categoryDraft.name.trim()) return; try { await api("/support/categories", { method: "POST", body: JSON.stringify(categoryDraft) }); setCategoryDraft({ key: "", name: "", description: "" }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to create category"); } };
  const toggleCategory = async (category: Category) => { try { await api(`/support/categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ active: !category.active }) }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update category"); } };

  if (loading) return <Stack alignItems="center" sx={{ py: 10 }}><CircularProgress /></Stack>;
  if (!config) return <Alert severity="error">{error || "Support configuration unavailable"}</Alert>;
  return <Stack spacing={3}>
    <Stack direction="row" spacing={1.5} alignItems="center"><SupportAgentRoundedIcon color="primary" sx={{ fontSize: 44 }} /><Box><Typography variant="h4" fontWeight={850}>Support center</Typography><Typography color="text.secondary">Free player tickets, support-agent access, categories, and the live-chat policy foundation.</Typography></Box></Stack>
    {error && <Alert severity="error" onClose={() => setError("")}>{error}</Alert>}{message && <Alert severity="success" onClose={() => setMessage("")}>{message}</Alert>}
    <Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab value="configuration" label="Configuration" /><Tab value="tickets" label={`Tickets (${tickets.length})`} /><Tab value="agents" label={`Agents (${agents.length})`} /><Tab value="categories" label={`Categories (${categories.length})`} /><Tab value="audit" label="Audit" /></Tabs>
    {tab === "configuration" && <Card component="form" onSubmit={save}><Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="h6" fontWeight={800}>Ticket policy</Typography><Typography color="text.secondary">Phase 1 tickets are free. Live-chat charging is disabled until Phase 2 is installed.</Typography></Box><FormControlLabel control={<Switch checked={Boolean(draft.enabled)} onChange={set("enabled")} />} label="Tickets enabled" /></Stack><Stack direction={{ xs: "column", md: "row" }} spacing={2}><TextField fullWidth label="Ticket retention days" type="number" value={draft.ticketRetentionDays ?? ""} onChange={set("ticketRetentionDays")} /><TextField fullWidth label="Message retention days" type="number" value={draft.messageRetentionDays ?? ""} onChange={set("messageRetentionDays")} /><TextField fullWidth label="Max open tickets/player" type="number" value={draft.maxOpenTicketsPerPlayer ?? ""} onChange={set("maxOpenTicketsPerPlayer")} /></Stack><Stack direction={{ xs: "column", md: "row" }} spacing={2}><TextField fullWidth label="Max message length" type="number" value={draft.maxMessageLength ?? ""} onChange={set("maxMessageLength")} /><TextField fullWidth label="First response SLA (minutes)" type="number" value={draft.firstResponseSlaMinutes ?? ""} onChange={set("firstResponseSlaMinutes")} /><TextField fullWidth label="Player reply timeout (hours)" type="number" value={draft.playerReplyTimeoutHours ?? ""} onChange={set("playerReplyTimeoutHours")} /></Stack><TextField label="Maintenance message" value={draft.maintenanceMessage ?? ""} onChange={set("maintenanceMessage")} fullWidth /><Stack direction={{ xs: "column", md: "row" }} spacing={2}><FormControlLabel control={<Switch checked={Boolean(draft.pushNotificationsEnabled)} onChange={set("pushNotificationsEnabled")} />} label="Push notifications" /><FormControlLabel control={<Switch checked={Boolean(draft.liveChatEnabled)} onChange={set("liveChatEnabled")} />} label="Live chat enabled (Phase 2)" /><TextField label="Live chat price (GLD)" value={draft.liveChatPriceGld ?? "2"} onChange={set("liveChatPriceGld")} /></Stack><Button type="submit" variant="contained" startIcon={<SaveRoundedIcon />} disabled={saving}>{saving ? "Saving…" : "Save support policy"}</Button></Stack></Card>}
    {tab === "tickets" && <Stack spacing={1.5}>{tickets.length === 0 && <Alert severity="info">No support tickets yet.</Alert>}{tickets.map((ticket) => <Card key={ticket.id} sx={{ p: 2.5, cursor: "pointer" }} onClick={() => void openTicket(ticket)}><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}><Box><Typography fontWeight={800}>{ticket.ticketNumber} · {ticket.subject}</Typography><Typography color="text.secondary">{ticket.player?.username || "player"} · {ticket.category?.name || "Other"} · updated {new Date(ticket.updatedAt).toLocaleString()}</Typography></Box><Stack direction="row" spacing={1}><Chip size="small" label={ticket.priority} color={ticket.priority === "URGENT" ? "error" : "default"} /><Chip size="small" label={ticket.status} color={ticket.status === "OPEN" ? "warning" : "default"} /><Typography variant="body2" color="text.secondary" sx={{ pt: .6 }}>{ticket.assignedAgent?.username || "Unassigned"}</Typography></Stack></Stack></Card>)}{selectedTicket && <Card sx={{ p: 3, mt: 2 }}><Stack direction="row" justifyContent="space-between"><Box><Typography variant="h6" fontWeight={800}>{selectedTicket.ticketNumber} · {selectedTicket.subject}</Typography><Typography color="text.secondary">{selectedTicket.player?.username || "player"}</Typography></Box><Button onClick={() => setSelectedTicket(null)}>Close</Button></Stack><Divider sx={{ my: 2 }} />{(selectedTicket.messages || []).map((item) => <Box key={item.id} sx={{ mb: 1.5, p: 1.5, bgcolor: item.senderKind === "AGENT" ? "rgba(139,125,255,.16)" : "rgba(148,163,184,.08)", borderRadius: 2 }}><Typography variant="caption" color="text.secondary">{item.senderKind} · {new Date(item.createdAt).toLocaleString()}</Typography><Typography>{item.body}</Typography></Box>)}<Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mt: 2 }}><TextField fullWidth multiline minRows={2} label="Reply as support" value={reply} onChange={(event) => setReply(event.target.value)} /><Button variant="contained" onClick={() => void sendReply()}>Reply</Button><Select value={selectedTicket.status} onChange={(event) => void updateTicket(String(event.target.value))}><MenuItem value="TRIAGED">Triaged</MenuItem><MenuItem value="WAITING_FOR_PLAYER">Waiting for player</MenuItem><MenuItem value="RESOLVED">Resolved</MenuItem><MenuItem value="CLOSED">Closed</MenuItem><MenuItem value="REOPENED">Reopen</MenuItem></Select></Stack></Card>}</Stack>}
    {tab === "agents" && <Stack spacing={2}><Card sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Grant support-agent access</Typography><Stack direction="row" spacing={1} sx={{ mt: 2 }}><TextField fullWidth label="Player UUID" value={userId} onChange={(event) => setUserId(event.target.value)} helperText="Grant only trusted players; access is enforced by the backend." /><Button variant="contained" onClick={() => void grant()}>Grant</Button></Stack></Card>{agents.map((agent) => <Card key={agent.id} sx={{ p: 2.5 }}><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1}><Box><Typography fontWeight={800}>{agent.user.username}</Typography><Typography color="text.secondary">{agent.user.email || agent.user.id} · {agent._count?.assignedTickets ?? 0} assigned records</Typography></Box><Stack direction="row" spacing={1} alignItems="center"><Select size="small" value={agent.level} onChange={(event) => void updateAgent(agent.id, { level: event.target.value })}><MenuItem value="AGENT">Agent</MenuItem><MenuItem value="SENIOR">Senior</MenuItem><MenuItem value="SUPERVISOR">Supervisor</MenuItem></Select><Select size="small" value={agent.status} onChange={(event) => void updateAgent(agent.id, { status: event.target.value })}><MenuItem value="OFFLINE">Offline</MenuItem><MenuItem value="AVAILABLE">Available</MenuItem><MenuItem value="BUSY">Busy</MenuItem><MenuItem value="SUSPENDED">Suspended</MenuItem></Select><Button color="error" onClick={() => void revoke(agent.id)} disabled={Boolean(agent.revokedAt)}>Revoke</Button></Stack></Stack></Card>)}</Stack>}
    {tab === "categories" && <Stack spacing={1.5}><Card sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Add category</Typography><Stack direction={{ xs: "column", md: "row" }} spacing={1} sx={{ mt: 2 }}><TextField label="Key" value={categoryDraft.key} onChange={(event) => setCategoryDraft({ ...categoryDraft, key: event.target.value })} /><TextField label="Name" value={categoryDraft.name} onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })} /><TextField fullWidth label="Description" value={categoryDraft.description} onChange={(event) => setCategoryDraft({ ...categoryDraft, description: event.target.value })} /><Button variant="contained" onClick={() => void createCategory()}>Add</Button></Stack></Card>{categories.map((category) => <Card key={category.id} sx={{ p: 2.5 }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography fontWeight={800}>{category.name} <Chip size="small" label={category.key} /></Typography><Typography color="text.secondary">{category.description || "No description"}</Typography></Box><Stack direction="row" spacing={1}><Chip size="small" label={category.defaultPriority} /><Chip size="small" label={category.active ? "Active" : "Disabled"} color={category.active ? "success" : "default"} /><Button size="small" onClick={() => void toggleCategory(category)}>{category.active ? "Disable" : "Enable"}</Button></Stack></Stack></Card>)}</Stack>}
    {tab === "audit" && <Stack spacing={1.5}>{audit.map((event) => <Card key={event.id} sx={{ p: 2 }}><Typography fontWeight={800}>{event.action}</Typography><Typography color="text.secondary">{event.actor?.username || "System"} · {event.ticket?.ticketNumber || "Global"} · {new Date(event.createdAt).toLocaleString()}</Typography></Card>)}</Stack>}
  </Stack>;
}
