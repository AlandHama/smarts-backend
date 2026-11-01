'use client';

import { useEffect, useState } from 'react';

import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import MoreHorizRoundedIcon from '@mui/icons-material/MoreHorizRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { AdminUser, WalletLedgerEntry } from '../lib/types';
import { PlayerDetailsDialog } from './PlayerDetailsDialog';

type AppConfiguration = {
  productionVersion: string;
  developmentVersion: string;
  playStoreUrl: string;
  signupEnabled: boolean;
};

function statusColor(status: AdminUser['status']): 'success' | 'warning' | 'error' { return status === 'ACTIVE' ? 'success' : status === 'BANNED' ? 'error' : 'warning'; }

export function UsersView({ onOpenPlayer360 }: { onOpenPlayer360?: (userId: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [registrationRole, setRegistrationRole] = useState<'PLAYER' | 'ADMIN'>('PLAYER');
  const [loading, setLoading] = useState(true);
  const [accessConfig, setAccessConfig] = useState<AppConfiguration | null>(null);
  const [accessConfigLoading, setAccessConfigLoading] = useState(true);
  const [accessConfigSaving, setAccessConfigSaving] = useState(false);
  const [error, setError] = useState('');
  const load = () => { setLoading(true); const params = new URLSearchParams({ limit: '100' }); if (search.trim()) params.set('search', search.trim()); if (status) params.set('status', status); api<{ items: AdminUser[] }>(`/users?${params}`).then((body) => setUsers(body.items)).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load players')).finally(() => setLoading(false)); };
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [search, status]);
  useEffect(() => {
    api<AppConfiguration>('/app-config')
      .then(setAccessConfig)
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load player access controls'))
      .finally(() => setAccessConfigLoading(false));
  }, []);
  const updateStatus = async (user: AdminUser) => { const next = user.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE'; if (!window.confirm(`${next === 'BANNED' ? 'Ban' : 'Activate'} ${user.username}?`)) return; await api(`/users/${user.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: next }) }); load(); };
  const deleteUser = async (user: AdminUser) => { if (!window.confirm(`Permanently delete ${user.username}?`)) return; await api(`/users/${user.id}`, { method: 'DELETE' }); load(); };
  const updateSignupAccess = async (enabled: boolean) => {
    if (!accessConfig) return;
    try {
      setAccessConfigSaving(true);
      const saved = await api<AppConfiguration>('/app-config', {
        method: 'PUT',
        body: JSON.stringify({ ...accessConfig, signupEnabled: enabled }),
      });
      setAccessConfig(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update signup access');
    } finally {
      setAccessConfigSaving(false);
    }
  };
  const openRegistration = (role: 'PLAYER' | 'ADMIN') => { setRegistrationRole(role); setSelected({} as AdminUser); };
  return <Stack spacing={3}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}><Box><Typography variant="h4" fontWeight={850}>Players</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Inspect profiles, progression, sessions, and the immutable wallet ledger.</Typography></Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Button variant="outlined" startIcon={<AddRoundedIcon />} onClick={() => openRegistration('ADMIN')}>Register administrator</Button><Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openRegistration('PLAYER')}>Register player</Button></Stack></Stack>{error && <Typography color="error.main">{error}</Typography>}<Card><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'center' }} spacing={2} sx={{ p: 2.5 }}><Box><Typography variant="h6" fontWeight={800}>Player access</Typography><Typography variant="body2" color="text.secondary">Allow or pause new player account creation from the mobile app. Existing players can still sign in.</Typography></Box><FormControlLabel control={<Switch checked={accessConfig?.signupEnabled ?? true} onChange={(event) => void updateSignupAccess(event.target.checked)} disabled={accessConfigLoading || accessConfigSaving} color="success" />} label={accessConfig?.signupEnabled === false ? 'Signups disabled' : 'Signups enabled'} /></Stack></Card><Card><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2.5 }}><TextField size="small" placeholder="Search username, email, display name" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ flex: 1 }} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} /><Select size="small" value={status} onChange={(e) => setStatus(e.target.value)} displayEmpty sx={{ minWidth: 150 }}><MenuItem value="">All statuses</MenuItem><MenuItem value="ACTIVE">Active</MenuItem><MenuItem value="INACTIVE">Inactive</MenuItem><MenuItem value="BANNED">Banned</MenuItem></Select></Stack><Divider /><Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Player</TableCell><TableCell>Status</TableCell><TableCell>Progress</TableCell><TableCell>Sessions</TableCell><TableCell>Created</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>{loading ? <TableRow><TableCell colSpan={6} align="center" sx={{ py: 8 }}><CircularProgress size={26} /></TableCell></TableRow> : users.length === 0 ? <TableRow><TableCell colSpan={6} align="center" sx={{ py: 8 }}><Typography color="text.secondary">No players match this filter.</Typography></TableCell></TableRow> : users.map((user) => <TableRow key={user.id} hover><TableCell><Stack direction="row" spacing={1.5} alignItems="center"><Box sx={{ width: 38, height: 38, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: 'rgba(82,199,245,.14)', color: 'secondary.light', fontWeight: 800 }}>{(user.profile?.displayName || user.username).slice(0, 1).toUpperCase()}</Box><Box><Typography fontWeight={700}>{user.profile?.displayName || user.username}{user.isSystemAdmin && <Chip size="small" label="ADMIN" sx={{ ml: 1, height: 20 }} />}</Typography><Typography variant="caption" color="text.secondary">{user.email || user.username}</Typography></Box></Stack></TableCell><TableCell><Chip size="small" color={statusColor(user.status)} label={user.status} /></TableCell><TableCell><Typography variant="body2">Lv {user.profile?.level ?? 1}</Typography><Typography variant="caption" color="text.secondary">{user.profile?.xp ?? '0'} XP · {user.profile?.elo ?? 1000} ELO</Typography></TableCell><TableCell>{user._count?.sessions ?? 0}</TableCell><TableCell><Typography variant="body2" color="text.secondary">{new Date(user.createdAt).toLocaleDateString()}</Typography></TableCell><TableCell align="right"><Stack direction="row" justifyContent="flex-end" spacing={.5}><Button size="small" variant="outlined" startIcon={<VisibilityRoundedIcon />} onClick={() => onOpenPlayer360 ? onOpenPlayer360(user.id) : setSelected(user)}>Player 360</Button><Button size="small" color={user.status === 'ACTIVE' ? 'error' : 'success'} onClick={() => updateStatus(user)}>{user.status === 'ACTIVE' ? 'Ban' : 'Activate'}</Button><Button size="small" color="error" onClick={() => deleteUser(user)}><DeleteOutlineRoundedIcon fontSize="small" /></Button><MoreHorizRoundedIcon sx={{ display: { xs: 'none', lg: 'block' }, color: 'text.secondary', alignSelf: 'center' }} /></Stack></TableCell></TableRow>)}</TableBody></Table></Box></Card>{selected && <PlayerDetailsDialog user={selected} registrationRole={registrationRole} onClose={() => setSelected(null)} onSaved={() => { load(); }} onRegistered={() => { setSelected(null); load(); }} />}</Stack>;
}
