'use client';

import { useEffect, useState } from 'react';

import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
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
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { AdminSession } from '../lib/types';

const formatDate = (value: string) => new Date(value).toLocaleString();
const statusColor = (status: AdminSession['effectiveStatus']): 'success' | 'warning' | 'error' | 'default' => status === 'ACTIVE' ? 'success' : status === 'EXPIRED' ? 'warning' : 'default';

export function SessionsView() {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    api<{ items: AdminSession[] }>(`/sessions?${params}`).then((body) => { setSessions(body.items); setError(''); }).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load sessions')).finally(() => setLoading(false));
  };

  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [search, status]);

  const terminate = async (session: AdminSession) => {
    if (!window.confirm(`Terminate this session for ${session.user.username}?`)) return;
    try { await api(`/sessions/${session.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to terminate session'); }
  };

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
      <Box><Typography variant="h4" fontWeight={850}>Sessions</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Track login history, devices, locations, expiry, and active access for every player and administrator.</Typography></Box>
      <Chip icon={<DevicesRoundedIcon />} label={`${sessions.length} shown`} variant="outlined" />
    </Stack>
    {error && <Typography color="error.main">{error}</Typography>}
    <Card><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2.5 }}><TextField size="small" placeholder="Search user, device, IP, or location" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ flex: 1 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} /><Select size="small" value={status} onChange={(e) => setStatus(e.target.value)} displayEmpty sx={{ minWidth: 160 }}><MenuItem value="">All sessions</MenuItem><MenuItem value="ACTIVE">Active</MenuItem><MenuItem value="EXPIRED">Expired</MenuItem><MenuItem value="TERMINATED">Terminated</MenuItem></Select></Stack><Divider /><Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>User</TableCell><TableCell>Status</TableCell><TableCell>Device</TableCell><TableCell>Network</TableCell><TableCell>Signed in</TableCell><TableCell>Last active</TableCell><TableCell>Expires</TableCell><TableCell align="right">Action</TableCell></TableRow></TableHead><TableBody>{loading ? <TableRow><TableCell colSpan={8} align="center" sx={{ py: 8 }}><CircularProgress size={26} /></TableCell></TableRow> : sessions.length === 0 ? <TableRow><TableCell colSpan={8} align="center" sx={{ py: 8 }}><Typography color="text.secondary">No sessions match this filter.</Typography></TableCell></TableRow> : sessions.map((session) => <TableRow key={session.id} hover><TableCell><Typography fontWeight={700}>{session.user.profile?.displayName || session.user.username}{session.user.isSystemAdmin && <Chip size="small" label="ADMIN" sx={{ ml: 1, height: 20 }} />}</Typography><Typography variant="caption" color="text.secondary">{session.user.email || session.user.username}</Typography></TableCell><TableCell><Chip size="small" color={statusColor(session.effectiveStatus)} label={session.effectiveStatus} /></TableCell><TableCell><Typography variant="body2">{session.deviceName || (session.isMobileSession ? 'Mobile app' : 'Web client')}</Typography><Typography variant="caption" color="text.secondary">{session.clientVersion || session.deviceInfo || 'Unknown client'}</Typography></TableCell><TableCell><Typography variant="body2">{session.ipAddress || '—'}</Typography><Typography variant="caption" color="text.secondary">{session.location || 'Unknown location'}</Typography></TableCell><TableCell><Typography variant="body2">{formatDate(session.loginTimestamp)}</Typography></TableCell><TableCell><Typography variant="body2">{formatDate(session.lastActiveTimestamp)}</Typography></TableCell><TableCell><Typography variant="body2">{formatDate(session.expiresAt)}</Typography></TableCell><TableCell align="right">{session.effectiveStatus === 'ACTIVE' ? <Button size="small" color="warning" startIcon={<LogoutRoundedIcon />} onClick={() => terminate(session)}>Terminate</Button> : <Typography variant="caption" color="text.secondary">History</Typography>}</TableCell></TableRow>)}</TableBody></Table></Box></Card>
  </Stack>;
}
