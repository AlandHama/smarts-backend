'use client';

import { useEffect, useState } from 'react';

import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import { UserSelector, type SelectableUser } from './UserSelector';

type AdminUser = { id: string; username: string; email: string | null; displayName: string; avatarUrl: string | null };
type SocialResponse = { friendships: Array<{ id: string; user: AdminUser; friend: AdminUser; acceptedAt: string }>; requests: Array<{ id: string; status: string; requester: AdminUser; addressee: AdminUser; createdAt: string }>; presence: Array<{ user: AdminUser; online: boolean; lastSeenAt: string | null }>; pagination: { friendships: number; requests: number; presence: number } };
const label = (user: AdminUser) => `${user.displayName} · @${user.username}`;

export function FriendsView() {
  const [tab, setTab] = useState(0);
  const [selectedUser, setSelectedUser] = useState<SelectableUser | null>(null);
  const [search, setSearch] = useState('');
  const [online, setOnline] = useState('');
  const [data, setData] = useState<SocialResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (selectedUser?.id) params.set('userId', selectedUser.id);
    if (search.trim()) params.set('search', search.trim());
    if (online) params.set('online', online);
    api<SocialResponse>(`/friends?${params}`).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load friends')).finally(() => setLoading(false));
  };
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [selectedUser?.id, search, online]);

  const relationshipAction = async (kind: 'remove' | 'block', userId: string, friendId: string) => {
    if (!window.confirm(`${kind === 'remove' ? 'Remove this friendship' : 'Block this relationship'}?`)) return;
    try { await api(`/friends/${userId}/${friendId}${kind === 'block' ? '/block' : ''}`, { method: kind === 'remove' ? 'DELETE' : 'POST' }); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update relationship'); }
  };

  return <Stack spacing={3}><Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" spacing={2}><Box><Typography variant="h4" fontWeight={850}>Friends & presence</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Inspect relational friendships, pending requests, blocks, and server-derived online activity.</Typography></Box><Chip icon={<GroupRoundedIcon />} label={`${data?.pagination.friendships ?? 0} friendship rows`} variant="outlined" /></Stack>{error && <Typography color="error.main">{error}</Typography>}<Card><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2.5 }}><UserSelector value={selectedUser} onChange={setSelectedUser} label="Filter by player" /><TextField size="small" fullWidth placeholder="Search usernames, emails, or display names" value={search} onChange={(e) => setSearch(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} /><Select size="small" value={online} onChange={(e) => setOnline(e.target.value)} displayEmpty sx={{ minWidth: 150 }}><MenuItem value="">All presence</MenuItem><MenuItem value="true">Online</MenuItem><MenuItem value="false">Offline</MenuItem></Select></Stack><Divider /><Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab label={`Friendships · ${data?.pagination.friendships ?? 0}`} /><Tab label={`Requests · ${data?.pagination.requests ?? 0}`} /><Tab label={`Presence · ${data?.pagination.presence ?? 0}`} /></Tabs><Divider />{loading ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={28} /></Stack> : tab === 0 ? <Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Player A</TableCell><TableCell>Player B</TableCell><TableCell>Accepted</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>{!data?.friendships.length ? <TableRow><TableCell colSpan={4} align="center" sx={{ py: 8 }}><Typography color="text.secondary">No friendships match this filter.</Typography></TableCell></TableRow> : data.friendships.map((row) => <TableRow key={row.id} hover><TableCell><Typography fontWeight={700}>{label(row.user)}</Typography><Typography variant="caption" color="text.secondary">{row.user.email || 'No email'}</Typography></TableCell><TableCell><Typography fontWeight={700}>{label(row.friend)}</Typography><Typography variant="caption" color="text.secondary">{row.friend.email || 'No email'}</Typography></TableCell><TableCell>{new Date(row.acceptedAt).toLocaleString()}</TableCell><TableCell align="right"><Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => relationshipAction('remove', row.user.id, row.friend.id)}>Remove</Button><Button size="small" color="warning" startIcon={<BlockRoundedIcon />} onClick={() => relationshipAction('block', row.user.id, row.friend.id)}>Block</Button></TableCell></TableRow>)}</TableBody></Table></Box> : tab === 1 ? <Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Status</TableCell><TableCell>Requester</TableCell><TableCell>Recipient</TableCell><TableCell>Created</TableCell></TableRow></TableHead><TableBody>{!data?.requests.length ? <TableRow><TableCell colSpan={4} align="center" sx={{ py: 8 }}><Typography color="text.secondary">No requests match this filter.</Typography></TableCell></TableRow> : data.requests.map((row) => <TableRow key={row.id}><TableCell><Chip size="small" label={row.status} color={row.status === 'PENDING' ? 'warning' : 'default'} /></TableCell><TableCell>{label(row.requester)}</TableCell><TableCell>{label(row.addressee)}</TableCell><TableCell>{new Date(row.createdAt).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></Box> : <Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Player</TableCell><TableCell>Presence</TableCell><TableCell>Last seen</TableCell></TableRow></TableHead><TableBody>{!data?.presence.length ? <TableRow><TableCell colSpan={3} align="center" sx={{ py: 8 }}><Typography color="text.secondary">No presence records match this filter.</Typography></TableCell></TableRow> : data.presence.map((row) => <TableRow key={row.user.id}><TableCell><Typography fontWeight={700}>{label(row.user)}</Typography><Typography variant="caption" color="text.secondary">{row.user.email || 'No email'}</Typography></TableCell><TableCell><Chip size="small" label={row.online ? 'ONLINE' : 'OFFLINE'} color={row.online ? 'success' : 'default'} /></TableCell><TableCell>{row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : 'Never'}</TableCell></TableRow>)}</TableBody></Table></Box>}</Card></Stack>;
}
