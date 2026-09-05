'use client';

import { useEffect, useState } from 'react';

import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { PlayerAuditEvent } from '../lib/types';

type Response = { items: PlayerAuditEvent[]; pagination: { page: number; limit: number; total: number; pages: number } };
const date = (value: string) => new Date(value).toLocaleString();
const value = (item: unknown) => item === null || item === undefined || item === '' ? '—' : typeof item === 'object' ? JSON.stringify(item) : String(item);

function ChangeDetails({ changes }: { changes: PlayerAuditEvent['changes'] }) {
  if (!changes || !Object.keys(changes).length) return <Typography variant="caption" color="text.secondary">Legacy event: exact before/after values were not captured.</Typography>;
  return <Stack spacing={.35} sx={{ mt: .5 }}>{Object.entries(changes).map(([field, change]) => <Typography key={field} variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'normal' }}><Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>{field}</Box>: <Box component="span" sx={{ fontFamily: 'monospace' }}>{value(change.old)}</Box> <Box component="span" sx={{ color: 'primary.light', px: .5 }}>→</Box> <Box component="span" sx={{ fontFamily: 'monospace', color: 'secondary.light' }}>{value(change.new)}</Box></Typography>)}</Stack>;
}

export function PlayerAuditsView({ onOpenPlayer360 }: { onOpenPlayer360: (userId: string) => void }) {
  const [rows, setRows] = useState<PlayerAuditEvent[]>([]);
  const [pagination, setPagination] = useState<Response['pagination'] | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({ limit: '75' });
      if (search.trim()) params.set('search', search.trim());
      if (action.trim()) params.set('action', action.trim());
      if (entityType.trim()) params.set('entityType', entityType.trim());
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      const body = await api<Response>(`/player-audits?${params.toString()}`);
      setRows(body.items);
      setPagination(body.pagination);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load player audits');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [search, action, entityType, from, to]);

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'flex-end' }} spacing={2}>
      <Box><Typography variant="overline" color="text.secondary" sx={{ letterSpacing: '.14em' }}>PLAYER ACTIVITY</Typography><Typography variant="h4" fontWeight={850}>Player audits</Typography><Typography color="text.secondary">Append-only history of profile, gameplay, rewards, economy, commerce, storage, and social actions.</Typography></Box>
      <Chip icon={<HistoryRoundedIcon />} label={pagination ? `${pagination.total} events` : 'Loading'} color="primary" variant="outlined" />
    </Stack>
    <Card>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2.5 }}>
        <TextField fullWidth size="small" label="Search player or event" placeholder="Username, email, action, summary, UUID" value={search} onChange={(event) => setSearch(event.target.value)} />
        <TextField size="small" label="Action" placeholder="PROFILE_UPDATED" value={action} onChange={(event) => setAction(event.target.value)} />
        <TextField size="small" label="Entity" placeholder="Wallet, Match..." value={entityType} onChange={(event) => setEntityType(event.target.value)} />
        <TextField size="small" type="datetime-local" label="From" InputLabelProps={{ shrink: true }} value={from} onChange={(event) => setFrom(event.target.value)} />
        <TextField size="small" type="datetime-local" label="To" InputLabelProps={{ shrink: true }} value={to} onChange={(event) => setTo(event.target.value)} />
      </Stack>
      <Divider />
      {error && <Typography color="error.main" sx={{ p: 2 }}>{error}</Typography>}
      {loading ? <Stack alignItems="center" sx={{ p: 8 }}><CircularProgress /></Stack> : <Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Time</TableCell><TableCell>Player</TableCell><TableCell>Action</TableCell><TableCell>Entity</TableCell><TableCell>Details</TableCell><TableCell align="right">Open</TableCell></TableRow></TableHead><TableBody>{rows.map((row) => <TableRow key={row.id} hover><TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant="body2">{date(row.createdAt)}</Typography><Typography variant="caption" color="text.secondary">{row.actorType}</Typography></TableCell><TableCell><Button size="small" onClick={() => onOpenPlayer360(row.userId)} sx={{ textTransform: 'none', textAlign: 'left', justifyContent: 'flex-start' }}><Box><Typography fontWeight={750}>{row.user?.profile?.displayName || row.user?.username || row.userId}</Typography><Typography variant="caption" color="text.secondary">{row.user?.email || row.userId}</Typography></Box></Button></TableCell><TableCell><Chip size="small" label={row.action} color={row.actorType === 'ADMIN' ? 'warning' : row.actorType === 'PLAYER' ? 'secondary' : 'default'} /></TableCell><TableCell><Typography variant="body2">{row.entityType}</Typography>{row.entityId && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{row.entityId}</Typography>}</TableCell><TableCell sx={{ minWidth: 340 }}><Typography variant="body2">{row.summary}</Typography><ChangeDetails changes={row.changes} />{row.metadata && <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Context: {JSON.stringify(row.metadata)}</Typography>}</TableCell><TableCell align="right"><Button size="small" endIcon={<OpenInNewRoundedIcon fontSize="small" />} onClick={() => onOpenPlayer360(row.userId)}>Player 360</Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={6} align="center" sx={{ py: 7 }}><Typography color="text.secondary">No player activity matches these filters.</Typography></TableCell></TableRow>}</TableBody></Table></Box>}
      {pagination && pagination.pages > 1 && <Stack direction="row" justifyContent="space-between" sx={{ p: 2 }}><Typography variant="caption" color="text.secondary">Page {pagination.page} of {pagination.pages}</Typography><Typography variant="caption" color="text.secondary">Showing the newest 75 events</Typography></Stack>}
    </Card>
  </Stack>;
}
