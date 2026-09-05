'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import CalendarTodayRoundedIcon from '@mui/icons-material/CalendarTodayRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import MilitaryTechRoundedIcon from '@mui/icons-material/MilitaryTechRounded';
import ShoppingBagRoundedIcon from '@mui/icons-material/ShoppingBagRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import FeedbackRoundedIcon from '@mui/icons-material/FeedbackRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { Player360Data } from '../lib/types';
import { PlayerDetailsDialog } from './PlayerDetailsDialog';
import { AdminFriendDialog } from './AdminFriendDialog';
import { PlayerFileUploadDialog, PlayerStorageDialog, type StorageEntry } from './PlayerStorageDialogs';

const date = (value?: string | null) => value ? new Date(value).toLocaleString() : '—';
const shortDate = (value?: string | null) => value ? new Date(value).toLocaleDateString() : '—';
const initials = (name: string) => name.trim().slice(0, 2).toUpperCase() || 'PL';
const effectiveSessionStatus = (session: { sessionStatus: string; expiresAt: string }) => session.sessionStatus === 'TERMINATED' ? 'TERMINATED' : new Date(session.expiresAt).getTime() > Date.now() ? 'ACTIVE' : 'EXPIRED';

function Section({ icon, title, description, children, action }: { icon: ReactNode; title: string; description: string; children: ReactNode; action?: ReactNode }) {
  return <Card sx={{ overflow: 'hidden' }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={1} sx={{ p: { xs: 2.5, md: 3 } }}><Stack direction="row" spacing={1.5} alignItems="flex-start"><Box sx={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 2, bgcolor: 'rgba(139,125,255,.13)', color: 'primary.light' }}>{icon}</Box><Box><Typography variant="h6" fontWeight={800}>{title}</Typography><Typography variant="body2" color="text.secondary">{description}</Typography></Box></Stack>{action}</Stack><Divider />{children}</Card>;
}

function Metric({ label, value, detail, color = 'primary.light' }: { label: string; value: string | number; detail?: string; color?: string }) {
  return <Card variant="outlined" sx={{ p: 2.25, height: '100%', bgcolor: 'rgba(148,163,184,.045)' }}><Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '.08em', textTransform: 'uppercase' }}>{label}</Typography><Typography variant="h4" fontWeight={850} sx={{ color, mt: .7 }}>{value}</Typography>{detail && <Typography variant="body2" color="text.secondary" sx={{ mt: .4 }}>{detail}</Typography>}</Card>;
}

export function Player360View({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [data, setData] = useState<Player360Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editingTab, setEditingTab] = useState(0);
  const [storageEntry, setStorageEntry] = useState<StorageEntry | undefined>(undefined);
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [friendsDialogOpen, setFriendsDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      setData(await api<Player360Data>(`/users/${userId}/360`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load Player 360');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [userId]);

  const leaderboardEntries = useMemo(() => data?.leaderboardEntries || [], [data]);
  const activeSessions = data?.user.sessions?.filter((session) => session.sessionStatus === 'ACTIVE' && new Date(session.expiresAt).getTime() > Date.now()).length || 0;
  const totalPurchased = data?.purchases.filter((purchase) => purchase.status === 'COMPLETED').length || 0;
  const displayName = data?.user.profile?.displayName || data?.user.username || 'Player';

  const toggleStatus = async () => {
    if (!data) return;
    const next = data.user.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE';
    if (!window.confirm(`${next === 'BANNED' ? 'Ban' : 'Activate'} ${data.user.username}?`)) return;
    try {
      setActionLoading(true);
      await api(`/users/${data.user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update account status');
    } finally {
      setActionLoading(false);
    }
  };
  const openEditor = (tab = 0) => { setEditingTab(tab); setEditing(true); };
  const deleteStorageEntry = async (key: string) => {
    if (!window.confirm(`Delete storage entry ${key}?`)) return;
    try { await api(`/users/${userId}/storage/${encodeURIComponent(key)}`, { method: 'DELETE' }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete storage entry'); }
  };
  const deleteFile = async (fileId: string, name: string) => {
    if (!window.confirm(`Delete ${name}?`)) return;
    try { await api(`/users/${userId}/files/${fileId}`, { method: 'DELETE' }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete file'); }
  };
  const openFile = async (fileId: string) => {
    try { const body = await api<{ url: string }>(`/users/${userId}/files/${fileId}/url`); window.open(body.url, '_blank', 'noopener,noreferrer'); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to open file'); }
  };

  if (loading && !data) return <Stack alignItems="center" justifyContent="center" sx={{ minHeight: 420 }}><CircularProgress /></Stack>;
  if (!data) return <Stack spacing={2}><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}>Back to players</Button><Typography color="error.main">{error || 'Player not found'}</Typography></Stack>;

  const { user } = data;
  const walletTransactions = user.wallet?.transactions || [];

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" alignItems={{ lg: 'center' }} spacing={2}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <IconButton onClick={onBack} sx={{ bgcolor: 'rgba(148,163,184,.09)' }}><ArrowBackRoundedIcon /></IconButton>
        <Box><Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '.14em' }}>PLAYER 360</Typography><Typography variant="h4" fontWeight={850}>Complete player workspace</Typography><Typography color="text.secondary">One operational view of identity, progression, economy, commerce, competition, and activity.</Typography></Box>
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Button variant="outlined" startIcon={<EditRoundedIcon />} onClick={() => openEditor()}>Edit profile</Button>
        <Button variant="outlined" startIcon={<AccountBalanceWalletRoundedIcon />} onClick={() => openEditor(2)}>Adjust wallet</Button>
        <Button variant="outlined" startIcon={<TrendingUpRoundedIcon />} onClick={() => openEditor(1)}>Adjust progression</Button>
        <Button variant="outlined" startIcon={<GroupRoundedIcon />} onClick={() => setFriendsDialogOpen(true)}>Manage friends</Button>
        <Button variant="outlined" color={user.status === 'ACTIVE' ? 'error' : 'success'} startIcon={user.status === 'ACTIVE' ? <LockRoundedIcon /> : <LockOpenRoundedIcon />} disabled={actionLoading} onClick={toggleStatus}>{user.status === 'ACTIVE' ? 'Ban account' : 'Activate account'}</Button>
      </Stack>
    </Stack>

    {error && <Typography color="error.main">{error}</Typography>}

    <Card sx={{ p: { xs: 2.5, md: 3.5 }, background: 'linear-gradient(135deg, rgba(75,64,151,.42), rgba(30,41,75,.62))', borderColor: 'rgba(139,125,255,.34)' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={3}>
        <Stack direction="row" spacing={2} alignItems="center">
          {user.profile?.avatarUrl ? <Box component="img" src={user.profile.avatarUrl} alt={displayName} sx={{ width: 76, height: 76, borderRadius: 3, objectFit: 'cover' }} /> : <Box sx={{ width: 76, height: 76, borderRadius: 3, display: 'grid', placeItems: 'center', bgcolor: 'rgba(82,199,245,.18)', color: 'secondary.light', fontSize: 25, fontWeight: 850 }}>{initials(displayName)}</Box>}
          <Box><Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap"><Typography variant="h4" fontWeight={850}>{displayName}</Typography><Chip size="small" color={user.status === 'ACTIVE' ? 'success' : user.status === 'BANNED' ? 'error' : 'warning'} label={user.status} /></Stack><Typography color="text.secondary" sx={{ mt: .4 }}>@{user.username} {user.isSystemAdmin && <Chip size="small" label="SYSTEM ADMIN" sx={{ ml: 1, height: 21 }} />}</Typography><Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ sm: 2 }} sx={{ mt: 1 }}><Typography variant="body2" color="text.secondary">{user.email || 'No email'}</Typography><Typography variant="body2" color="text.secondary">{user.profile?.countryCode || 'Country not set'}</Typography></Stack></Box>
        </Stack>
        <Stack spacing={.8} alignItems={{ md: 'flex-end' }}><Typography variant="caption" color="text.secondary">PLAYER UUID</Typography><Stack direction="row" spacing={.5} alignItems="center"><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{user.id}</Typography><IconButton size="small" onClick={() => void navigator.clipboard?.writeText(user.id)}><ContentCopyRoundedIcon fontSize="small" /></IconButton></Stack><Typography variant="caption" color="text.secondary">Joined {shortDate(user.createdAt)} · Last seen {date(user.lastOnline)}</Typography></Stack>
      </Stack>
    </Card>

    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="Level" value={`Lv ${user.profile?.level ?? 1}`} detail={`${user.profile?.xp ?? '0'} XP`} /></Grid>
      <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="ELO rating" value={user.profile?.elo ?? 1000} detail={`Highest ${user.stats?.highestElo ?? user.profile?.elo ?? 1000}`} color="secondary.light" /></Grid>
      <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="Games played" value={user.stats?.gamesPlayed ?? 0} detail={`${user.stats?.wins ?? 0} wins · ${user.stats?.losses ?? 0} losses`} color="#72e0af" /></Grid>
      <Grid size={{ xs: 12, sm: 6, lg: 3 }}><Metric label="Live sessions" value={activeSessions} detail={`${user._count?.sessions ?? 0} total sessions`} color="#f5c76d" /></Grid>
    </Grid>

    <Section icon={<GroupRoundedIcon />} title="Friends and presence" description="Accepted relationships, pending requests, and server-derived online state."><Box sx={{ p: { xs: 2, md: 3 } }}><Stack direction={{ xs: 'column', md: 'row' }} spacing={3}><Box sx={{ flex: 1 }}><Stack direction="row" spacing={1} alignItems="center"><Chip size="small" color={data.presence.online ? 'success' : 'default'} label={data.presence.online ? 'ONLINE' : 'OFFLINE'} /><Typography variant="body2" color="text.secondary">Last seen {date(data.presence.lastSeenAt)}</Typography></Stack><Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Friends · {data.friends.length}</Typography><Stack spacing={.8}>{data.friends.slice(0, 8).map((friend) => <Stack key={friend.id} direction="row" justifyContent="space-between"><Typography variant="body2">{friend.name} <Typography component="span" variant="caption" color="text.secondary">@{friend.username}</Typography></Typography><Chip size="small" label={friend.online ? 'Online' : 'Offline'} color={friend.online ? 'success' : 'default'} /></Stack>)}{!data.friends.length && <Typography color="text.secondary">No friends yet.</Typography>}</Stack></Box><Box sx={{ flex: 1 }}><Typography variant="subtitle2" sx={{ mb: 1 }}>Requests</Typography><Typography variant="body2" color="text.secondary">Incoming: {data.incomingRequests.length} · Outgoing: {data.outgoingRequests.length}</Typography><Stack spacing={.7} sx={{ mt: 1 }}>{data.incomingRequests.slice(0, 4).map((request) => <Typography key={request.id} variant="body2">Incoming from {request.name}</Typography>)}{data.outgoingRequests.slice(0, 4).map((request) => <Typography key={request.id} variant="body2">Pending to {request.name}</Typography>)}{!data.incomingRequests.length && !data.outgoingRequests.length && <Typography color="text.secondary">No pending requests.</Typography>}</Stack></Box></Stack></Box></Section>

    <Section icon={<HistoryRoundedIcon />} title="Player audit history" description="A chronological, append-only record of server-observed player activity and administrative changes."><Box sx={{ overflowX: 'auto', maxHeight: 430 }}><Table size="small"><TableHead><TableRow><TableCell>Recorded</TableCell><TableCell>Action</TableCell><TableCell>Entity</TableCell><TableCell>Summary</TableCell><TableCell>Actor</TableCell></TableRow></TableHead><TableBody>{data.playerAuditEvents.map((event) => <TableRow key={event.id}><TableCell sx={{ whiteSpace: 'nowrap' }}>{date(event.createdAt)}</TableCell><TableCell><Chip size="small" label={event.action} color={event.actorType === 'ADMIN' ? 'warning' : event.actorType === 'PLAYER' ? 'secondary' : 'default'} /></TableCell><TableCell>{event.entityType}{event.entityId && <Typography variant="caption" display="block" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{event.entityId}</Typography>}</TableCell><TableCell sx={{ minWidth: 260 }}>{event.summary}{event.metadata && <Typography variant="caption" display="block" color="text.secondary" sx={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{JSON.stringify(event.metadata)}</Typography>}</TableCell><TableCell>{event.actorType}</TableCell></TableRow>)}{!data.playerAuditEvents.length && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 5 }}><Typography color="text.secondary">No player activity has been recorded yet.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section>

    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 7 }}><Section icon={<ShieldRoundedIcon />} title="Identity and account" description="Account controls and core profile information."><Grid container spacing={2} sx={{ p: { xs: 2.5, md: 3 } }}><Grid size={{ xs: 12, sm: 6 }}><Typography variant="caption" color="text.secondary">USERNAME</Typography><Typography fontWeight={700}>{user.username}</Typography></Grid><Grid size={{ xs: 12, sm: 6 }}><Typography variant="caption" color="text.secondary">EMAIL</Typography><Typography fontWeight={700}>{user.email || 'Not configured'}</Typography></Grid><Grid size={{ xs: 12, sm: 6 }}><Typography variant="caption" color="text.secondary">NAME</Typography><Typography fontWeight={700}>{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Not configured'}</Typography></Grid><Grid size={{ xs: 12, sm: 6 }}><Typography variant="caption" color="text.secondary">COUNTRY</Typography><Typography fontWeight={700}>{user.profile?.countryCode || 'Not configured'}</Typography></Grid><Grid size={12}><Typography variant="caption" color="text.secondary">BIO</Typography><Typography color="text.secondary">{user.profile?.bio || 'No biography provided.'}</Typography></Grid></Grid></Section></Grid>
      <Grid size={{ xs: 12, lg: 5 }}><Section icon={<MilitaryTechRoundedIcon />} title="Performance snapshot" description="Lifetime player statistics from server-authoritative results."><Stack spacing={1.5} sx={{ p: { xs: 2.5, md: 3 } }}><Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Wins / losses / draws</Typography><Typography fontWeight={750}>{user.stats?.wins ?? 0} / {user.stats?.losses ?? 0} / {user.stats?.draws ?? 0}</Typography></Stack><Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Current win streak</Typography><Typography fontWeight={750}>{user.stats?.currentWinStreak ?? 0}</Typography></Stack><Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Highest win streak</Typography><Typography fontWeight={750}>{user.stats?.highestWinStreak ?? 0}</Typography></Stack><Stack direction="row" justifyContent="space-between"><Typography color="text.secondary">Total score</Typography><Typography fontWeight={750}>{user.stats?.totalScore ?? '0'}</Typography></Stack></Stack></Section></Grid>
    </Grid>

    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 6 }}><Section icon={<StorageRoundedIcon />} title="Private storage and files" description="Allowlisted player metadata and server-owned object references."><Box sx={{ p: { xs: 2, md: 3 } }}><Stack spacing={1.2}>{data.storageItems.map((item) => <Stack key={item.id} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(148,163,184,.06)' }}><Box><Typography fontWeight={750}>{item.key}</Typography><Typography variant="caption" color="text.secondary">{item.valueType} · {item.visibility} · v{item.version}</Typography></Box><Typography variant="caption" color="text.secondary">{date(item.updatedAt)}</Typography></Stack>)}{!data.storageItems.length && <Typography color="text.secondary">No storage entries.</Typography>}<Divider sx={{ my: 1 }} />{data.files.map((file) => <Stack key={file.id} direction="row" justifyContent="space-between"><Box><Typography variant="body2" fontWeight={700}>{file.originalName}</Typography><Typography variant="caption" color="text.secondary">{file.purpose} · {file.contentType} · {file.byteSize} bytes</Typography></Box><Chip size="small" label={file.status} color={file.status === 'ACTIVE' ? 'success' : 'default'} /></Stack>)}{!data.files.length && <Typography color="text.secondary">No uploaded files.</Typography>}</Stack></Box></Section></Grid>
      <Grid size={{ xs: 12, lg: 6 }}><Section icon={<FeedbackRoundedIcon />} title="Feedback and reports" description="Player-submitted feedback with moderation status and category context."><Box sx={{ p: { xs: 2, md: 3 } }}><Stack spacing={1.5}>{data.feedback.map((item) => <Box key={item.id} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(148,163,184,.06)' }}><Stack direction="row" justifyContent="space-between" spacing={1}><Typography fontWeight={750}>{item.category.name}</Typography><Chip size="small" label={item.status} color={item.status === 'RESOLVED' ? 'success' : 'warning'} /></Stack><Typography variant="body2" sx={{ mt: .7 }}>{item.description}</Typography><Typography variant="caption" color="text.secondary">{item.entity} · {date(item.createdAt)}</Typography></Box>)}{!data.feedback.length && <Typography color="text.secondary">No feedback submitted.</Typography>}</Stack></Box></Section></Grid>
    </Grid>

    <Section icon={<StorageRoundedIcon />} title="Storage operations" description="Player 360 is an operational workspace: edit allowlisted storage, upload files, and remove stale references." action={<Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Button size="small" startIcon={<CloudUploadRoundedIcon />} variant="outlined" onClick={() => setUploadOpen(true)}>Upload file</Button><Button size="small" variant="contained" onClick={() => { setStorageEntry(undefined); setStorageDialogOpen(true); }}>Add entry</Button></Stack>}><Box sx={{ p: { xs: 2, md: 3 } }}><Stack spacing={1.2}>{data.storageItems.map((item) => <Stack key={item.id} direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(148,163,184,.06)' }}><Box><Typography fontWeight={750}>{item.key}</Typography><Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>{item.value}</Typography><Typography variant="caption" color="text.secondary">{item.valueType} · {item.visibility} · v{item.version} · {date(item.updatedAt)}</Typography></Box><Stack direction="row" spacing={.5}><Button size="small" onClick={() => { setStorageEntry(item); setStorageDialogOpen(true); }}>Edit</Button><IconButton size="small" color="error" onClick={() => deleteStorageEntry(item.key)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Stack></Stack>)}{!data.storageItems.length && <Typography color="text.secondary">No storage entries.</Typography>}<Divider sx={{ my: 1 }} /><Typography variant="subtitle2" color="text.secondary">Uploaded files</Typography>{data.files.map((file) => <Stack key={file.id} direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} sx={{ p: 1.2, borderRadius: 2, bgcolor: 'rgba(148,163,184,.04)' }}><Box><Typography variant="body2" fontWeight={700}>{file.originalName}</Typography><Typography variant="caption" color="text.secondary">{file.purpose} · {file.contentType} · {file.byteSize} bytes · {file.visibility}</Typography></Box><Stack direction="row" spacing={.5}><Button size="small" onClick={() => openFile(file.id)}>Open</Button><IconButton size="small" color="error" onClick={() => deleteFile(file.id, file.originalName)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Stack></Stack>)}{!data.files.length && <Typography color="text.secondary">No uploaded files.</Typography>}</Stack></Box></Section>

    <Section icon={<TrendingUpRoundedIcon />} title="Progressions" description="Every progression balance, current step, threshold, and level-up state assigned to this player." action={<Button size="small" variant="outlined" onClick={() => openEditor(1)}>Adjust progression</Button>}><Box sx={{ p: { xs: 2, md: 3 } }}><Grid container spacing={2}>{(user.progressions || []).map((row) => <Grid key={row.id} size={{ xs: 12, sm: 6, lg: 4 }}><Card variant="outlined" sx={{ p: 2, height: '100%', bgcolor: 'rgba(139,125,255,.06)' }}><Stack direction="row" justifyContent="space-between" spacing={1}><Box><Typography fontWeight={800}>{row.progression.name}</Typography><Typography variant="caption" color="text.secondary">{row.progression.key} · {row.progression.kind}</Typography></Box><Chip size="small" color="primary" label={`Step ${row.step}`} /></Stack><Typography variant="h5" fontWeight={850} sx={{ mt: 2 }}>{row.points} <Typography component="span" color="text.secondary" variant="body2">points</Typography></Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .5 }}>Next threshold: {row.nextThreshold ?? 'MAX'}</Typography></Card></Grid>)}{!user.progressions?.length && <Grid size={12}><Typography color="text.secondary">No progression records yet.</Typography></Grid>}</Grid></Box></Section>

    <Section icon={<EmojiEventsRoundedIcon />} title="Leaderboard standings" description="Current authoritative entries and recent score activity for this player."><Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Leaderboard</TableCell><TableCell>Period</TableCell><TableCell>Score</TableCell><TableCell>Season</TableCell><TableCell>Updated</TableCell></TableRow></TableHead><TableBody>{leaderboardEntries.map((entry) => <TableRow key={entry.id}><TableCell><Typography fontWeight={750}>{entry.leaderboard.name}</Typography><Typography variant="caption" color="text.secondary">{entry.leaderboard.key}</Typography></TableCell><TableCell>{entry.leaderboard.period}</TableCell><TableCell><Typography fontWeight={800}>{entry.score}</Typography></TableCell><TableCell><Chip size="small" label={entry.season.status} color={entry.season.status === 'ACTIVE' ? 'success' : 'default'} /></TableCell><TableCell>{date(entry.updatedAt)}</TableCell></TableRow>)}{!leaderboardEntries.length && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Typography color="text.secondary">This player has no leaderboard entries yet.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section>

    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 6 }}><Section icon={<TrendingUpRoundedIcon />} title="Progression activity" description="Recent point changes and their authoritative sources."><Box sx={{ overflowX: 'auto', maxHeight: 340 }}><Table size="small"><TableHead><TableRow><TableCell>Progression</TableCell><TableCell>Change</TableCell><TableCell>Balance</TableCell><TableCell>Source</TableCell></TableRow></TableHead><TableBody>{data.progressionEvents.map((event) => <TableRow key={event.id}><TableCell><Typography fontWeight={700}>{event.progression.name}</Typography><Typography variant="caption" color="text.secondary">{event.progression.key}</Typography></TableCell><TableCell color={event.delta.startsWith('-') ? 'error' : 'success'}>{event.delta}</TableCell><TableCell>{event.balanceAfter}</TableCell><TableCell><Typography variant="body2">{event.sourceType}</Typography><Typography variant="caption" color="text.secondary">{event.sourceId}</Typography></TableCell></TableRow>)}{!data.progressionEvents.length && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No progression events.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section></Grid>
      <Grid size={{ xs: 12, lg: 6 }}><Section icon={<MilitaryTechRoundedIcon />} title="Reward grants" description="Rewards issued from matches, progression, purchases, and administration."><Box sx={{ overflowX: 'auto', maxHeight: 340 }}><Table size="small"><TableHead><TableRow><TableCell>Reward</TableCell><TableCell>Value</TableCell><TableCell>Status</TableCell><TableCell>Source</TableCell></TableRow></TableHead><TableBody>{data.rewardGrants.map((grant) => <TableRow key={grant.id}><TableCell><Typography fontWeight={700}>{grant.rewardType}</Typography><Typography variant="caption" color="text.secondary">{grant.targetKey || grant.grantKey}</Typography></TableCell><TableCell>{grant.amount || '—'}{grant.currency ? ` ${grant.currency.code}` : ''}{grant.progressionDefinition ? ` · ${grant.progressionDefinition.key}` : ''}</TableCell><TableCell><Chip size="small" label={grant.status} color={grant.status === 'GRANTED' ? 'success' : 'warning'} /></TableCell><TableCell><Typography variant="body2">{grant.sourceType}</Typography><Typography variant="caption" color="text.secondary">{grant.sourceId}</Typography></TableCell></TableRow>)}{!data.rewardGrants.length && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No reward grants.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section></Grid>
    </Grid>

    <Section icon={<EmojiEventsRoundedIcon />} title="Leaderboard score activity" description="The immutable score-event trail behind this player's leaderboard standings."><Box sx={{ overflowX: 'auto', maxHeight: 340 }}><Table size="small"><TableHead><TableRow><TableCell>Leaderboard</TableCell><TableCell>Delta</TableCell><TableCell>Score after</TableCell><TableCell>Source</TableCell><TableCell>Recorded</TableCell></TableRow></TableHead><TableBody>{data.leaderboardScoreEvents.map((event) => <TableRow key={event.id}><TableCell><Typography fontWeight={700}>{event.leaderboard.name}</Typography><Typography variant="caption" color="text.secondary">{event.leaderboard.key}</Typography></TableCell><TableCell color={event.delta.startsWith('-') ? 'error' : 'success'}>{event.delta}</TableCell><TableCell>{event.scoreAfter}</TableCell><TableCell>{event.sourceType}<Typography variant="caption" display="block" color="text.secondary">{event.sourceId}</Typography></TableCell><TableCell>{date(event.createdAt)}</TableCell></TableRow>)}{!data.leaderboardScoreEvents.length && <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No leaderboard score events.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section>

    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 5 }}><Section icon={<AccountBalanceWalletRoundedIcon />} title="Currency balances" description="Live wallet balances and reconciliation state."><Stack spacing={1} sx={{ p: { xs: 2, md: 3 } }}>{user.wallet?.balances?.length ? user.wallet.balances.map((balance) => <Stack key={balance.currency.code} direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(148,163,184,.06)' }}><Box><Typography fontWeight={800}>{balance.currency.name}</Typography><Typography variant="caption" color="text.secondary">{balance.currency.code} · {balance.currency.kind || 'virtual'}</Typography></Box><Typography variant="h6" fontWeight={850} color="secondary.light">{balance.amount}</Typography></Stack>) : <Typography color="text.secondary">No wallet balances.</Typography>}</Stack></Section></Grid>
      <Grid size={{ xs: 12, lg: 7 }}><Section icon={<LoginRoundedIcon />} title="Wallet ledger" description="Immutable credits, debits, reversals, and resulting balances."><Box sx={{ overflowX: 'auto', maxHeight: 360 }}><Table size="small"><TableHead><TableRow><TableCell>Entry</TableCell><TableCell>Amount</TableCell><TableCell>Balance after</TableCell><TableCell>Source</TableCell></TableRow></TableHead><TableBody>{walletTransactions.slice(0, 12).map((entry) => <TableRow key={entry.id}><TableCell><Chip size="small" label={entry.direction} color={entry.direction === 'CREDIT' ? 'success' : entry.direction === 'DEBIT' ? 'warning' : 'default'} /><Typography variant="caption" display="block" color="text.secondary">{date(entry.createdAt)}</Typography></TableCell><TableCell>{entry.amount} {entry.currency.code}</TableCell><TableCell>{entry.balanceAfter}</TableCell><TableCell><Typography variant="body2">{entry.sourceType}</Typography><Typography variant="caption" color="text.secondary">{entry.sourceId}</Typography></TableCell></TableRow>)}{!walletTransactions.length && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No wallet ledger entries.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section></Grid>
    </Grid>

    <Section icon={<Inventory2RoundedIcon />} title="Inventory and entitlements" description="Owned assets, variations, quantities, grants, and durable access rights."><Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Asset / entitlement</TableCell><TableCell>Type</TableCell><TableCell>Quantity</TableCell><TableCell>Status</TableCell><TableCell>Source</TableCell><TableCell>Created</TableCell></TableRow></TableHead><TableBody>{data.inventory.map((row) => <TableRow key={`inventory-${row.id}`}><TableCell><Stack direction="row" spacing={1} alignItems="center">{row.assetDefinition.imageUrl ? <Box component="img" src={row.assetDefinition.imageUrl} alt={row.assetDefinition.name} sx={{ width: 34, height: 34, borderRadius: 1.5, objectFit: 'cover' }} /> : <Box sx={{ width: 34, height: 34, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: 'rgba(82,199,245,.13)' }}><Inventory2RoundedIcon fontSize="small" /></Box>}<Box><Typography fontWeight={700}>{row.assetDefinition.name}</Typography><Typography variant="caption" color="text.secondary">{row.assetDefinition.key}{row.assetVariation ? ` · ${row.assetVariation.key}` : ''}</Typography></Box></Stack></TableCell><TableCell>{row.assetDefinition.assetType}</TableCell><TableCell>{row.quantity}</TableCell><TableCell><Chip size="small" label={row.assetDefinition.ownershipPolicy} /></TableCell><TableCell>{row.acquisitionSource}<Typography variant="caption" display="block" color="text.secondary">{row.sourceId}</Typography></TableCell><TableCell>{shortDate(row.createdAt)}</TableCell></TableRow>)}{data.entitlements.map((entry) => <TableRow key={`entitlement-${entry.id}`}><TableCell><Typography fontWeight={700}>{entry.entitlementKey}</Typography><Typography variant="caption" color="text.secondary">Entitlement {entry.assetDefinition ? `· ${entry.assetDefinition.name}` : ''}</Typography></TableCell><TableCell>ENTITLEMENT</TableCell><TableCell>—</TableCell><TableCell><Chip size="small" label={entry.status} color={entry.status === 'ACTIVE' ? 'success' : 'warning'} /></TableCell><TableCell>{entry.sourceType}<Typography variant="caption" display="block" color="text.secondary">{entry.sourceId}</Typography></TableCell><TableCell>{shortDate(entry.createdAt)}</TableCell></TableRow>)}{!data.inventory.length && !data.entitlements.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No assets or entitlements owned.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section>

    <Section icon={<ShoppingBagRoundedIcon />} title="Purchases" description={`${totalPurchased} completed purchase${totalPurchased === 1 ? '' : 's'} and their server snapshots.`}><Box sx={{ p: { xs: 2, md: 3 } }}><Stack spacing={1.5}>{data.purchases.map((purchase) => <Card key={purchase.id} variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}><Box><Stack direction="row" spacing={1} alignItems="center"><Typography fontWeight={800}>{purchase.lines.map((line) => line.itemNameSnapshot).join(', ') || 'Purchase'}</Typography><Chip size="small" label={purchase.status} color={purchase.status === 'COMPLETED' ? 'success' : 'warning'} /></Stack><Typography variant="caption" color="text.secondary">{date(purchase.createdAt)} · {purchase.id}</Typography></Box><Typography variant="h6" fontWeight={850}>{purchase.totalAmount} {purchase.currency.code}</Typography></Stack><Divider sx={{ my: 1.5 }} /><Stack spacing={.5}>{purchase.lines.map((line) => <Stack key={line.id} direction="row" justifyContent="space-between"><Typography variant="body2" color="text.secondary">{line.itemNameSnapshot} × {line.quantity}</Typography><Typography variant="body2">{line.totalAmount} {purchase.currency.code}</Typography></Stack>)}</Stack></Card>)}{!data.purchases.length && <Typography color="text.secondary">No purchases recorded.</Typography>}</Stack></Box></Section>

    <Grid container spacing={3}>
      <Grid size={{ xs: 12, lg: 5 }}><Section icon={<CheckCircleRoundedIcon />} title="Game statistics" description="Per-game server-side performance records."><Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>Game</TableCell><TableCell>Games</TableCell><TableCell>Win rate</TableCell><TableCell>Best score</TableCell></TableRow></TableHead><TableBody>{data.gameStats.map((stats) => <TableRow key={stats.id}><TableCell><Typography fontWeight={700}>{stats.gameDefinition.name}</Typography><Typography variant="caption" color="text.secondary">{stats.gameDefinition.key}</Typography></TableCell><TableCell>{stats.gamesPlayed}</TableCell><TableCell>{stats.gamesPlayed ? `${Math.round((stats.wins / stats.gamesPlayed) * 100)}%` : '—'}</TableCell><TableCell>{stats.bestScore}</TableCell></TableRow>)}{!data.gameStats.length && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No game statistics yet.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section></Grid>
      <Grid size={{ xs: 12, lg: 7 }}><Section icon={<CalendarTodayRoundedIcon />} title="Session history" description="Authentication sessions across mobile and administrator clients."><Box sx={{ overflowX: 'auto', maxHeight: 360 }}><Table size="small"><TableHead><TableRow><TableCell>Status</TableCell><TableCell>Client</TableCell><TableCell>Location / IP</TableCell><TableCell>Last active</TableCell></TableRow></TableHead><TableBody>{(user.sessions || []).map((session) => { const status = effectiveSessionStatus(session); return <TableRow key={session.id}><TableCell><Chip size="small" label={status} color={status === 'ACTIVE' ? 'success' : 'default'} /></TableCell><TableCell>{session.deviceName || (session.isMobileSession ? 'Mobile' : 'Web')}<Typography variant="caption" display="block" color="text.secondary">{session.deviceInfo || '—'}</Typography></TableCell><TableCell>{session.location || '—'}<Typography variant="caption" display="block" color="text.secondary">{session.ipAddress || '—'}</Typography></TableCell><TableCell>{date(session.lastActiveTimestamp)}</TableCell></TableRow>; })}{!user.sessions?.length && <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No sessions recorded.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section></Grid>
    </Grid>

    <Section icon={<CalendarTodayRoundedIcon />} title="Match history" description="Recent matches involving this player, including result and final score."><Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Game</TableCell><TableCell>Mode</TableCell><TableCell>Result</TableCell><TableCell>Score</TableCell><TableCell>Status</TableCell><TableCell>Played</TableCell></TableRow></TableHead><TableBody>{data.matches.map((match) => <TableRow key={match.id}><TableCell><Typography fontWeight={700}>{match.match.gameDefinition.name}</Typography><Typography variant="caption" color="text.secondary">{match.match.gameDefinition.key}</Typography></TableCell><TableCell>{match.match.mode}</TableCell><TableCell><Chip size="small" label={match.result} color={match.result === 'WIN' ? 'success' : match.result === 'LOSS' || match.result === 'FORFEIT' ? 'error' : 'default'} /></TableCell><TableCell>{match.finalScore ?? '—'}</TableCell><TableCell>{match.match.status}</TableCell><TableCell>{shortDate(match.createdAt)}</TableCell></TableRow>)}{!data.matches.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4 }}><Typography color="text.secondary">No match history yet.</Typography></TableCell></TableRow>}</TableBody></Table></Box></Section>

    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }} sx={{ pb: 2 }}><Typography variant="caption" color="text.secondary">Showing up to 200 recent records per activity stream. UUID: {user.id}</Typography><Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}>Back to players</Button></Stack>
    {storageDialogOpen && <PlayerStorageDialog userId={user.id} entry={storageEntry} onClose={() => setStorageDialogOpen(false)} onSaved={() => { setStorageDialogOpen(false); void load(); }} />}
    {uploadOpen && <PlayerFileUploadDialog userId={user.id} onClose={() => setUploadOpen(false)} onSaved={() => { setUploadOpen(false); void load(); }} />}
    {friendsDialogOpen && <AdminFriendDialog fixedUser={{ id: user.id, username: user.username, email: user.email, profile: user.profile ? { displayName: user.profile.displayName } : null }} existingFriends={data.friends.map((friend) => ({ id: friend.playerId, name: friend.name }))} onClose={() => setFriendsDialogOpen(false)} onSaved={() => { setFriendsDialogOpen(false); void load(); }} />}
    {editing && <PlayerDetailsDialog user={user} initialTab={editingTab} onClose={() => setEditing(false)} onSaved={load} onRegistered={() => undefined} />}
  </Stack>;
}
