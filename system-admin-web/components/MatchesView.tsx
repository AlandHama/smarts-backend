'use client';

import { useEffect, useState } from 'react';

import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
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
import type { MatchSummary } from '../lib/types';

const date = (value?: string | null) => value ? new Date(value).toLocaleString() : '—';
const label = (participant: MatchSummary['participants'][number]) => participant.displayName || participant.user?.profile?.displayName || participant.user?.username || (participant.participantType === 'BOT' ? 'Bot' : 'Unknown player');
const statusColor = (status: string): 'success' | 'warning' | 'error' | 'info' | 'default' => status === 'SETTLED' || status === 'FINISHED' ? 'success' : status === 'REVIEW' || status === 'STARTED' ? 'warning' : status === 'CANCELLED' ? 'error' : 'default';

export function MatchesView({ onOpenMatch360 }: { onOpenMatch360: (matchId: string) => void }) {
  const [items, setItems] = useState<MatchSummary[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (search.trim()) params.set('search', search.trim());
    if (status) params.set('status', status);
    api<{ items: MatchSummary[] }>(`/matches?${params}`).then((body) => { setItems(body.items); setError(''); }).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load match history')).finally(() => setLoading(false));
  };
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [search, status]);

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}>
      <Box><Typography variant="h4" fontWeight={850}>Matches</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Inspect server-created games, participant results, authoritative events, and settlement outcomes.</Typography></Box>
      <Chip icon={<CalendarMonthRoundedIcon />} label={`${items.length} shown`} variant="outlined" />
    </Stack>
    {error && <Typography color="error.main">{error}</Typography>}
    <Card><Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} sx={{ p: 2.5 }}><TextField size="small" fullWidth placeholder="Search match, game, username, or email" value={search} onChange={(e) => setSearch(e.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} /><Select size="small" value={status} onChange={(e) => setStatus(e.target.value)} displayEmpty sx={{ minWidth: 180 }}><MenuItem value="">All match statuses</MenuItem><MenuItem value="CREATED">Created</MenuItem><MenuItem value="STARTED">Started</MenuItem><MenuItem value="FINISHED">Finished</MenuItem><MenuItem value="REVIEW">Review</MenuItem><MenuItem value="SETTLED">Settled</MenuItem><MenuItem value="CANCELLED">Cancelled</MenuItem></Select></Stack><Divider /><Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Match</TableCell><TableCell>Players</TableCell><TableCell>Mode</TableCell><TableCell>Status</TableCell><TableCell>Activity</TableCell><TableCell>Created</TableCell><TableCell align="right">Action</TableCell></TableRow></TableHead><TableBody>{loading ? <TableRow><TableCell colSpan={7} align="center" sx={{ py: 8 }}><CircularProgress size={26} /></TableCell></TableRow> : items.length === 0 ? <TableRow><TableCell colSpan={7} align="center" sx={{ py: 8 }}><Typography color="text.secondary">No matches match this filter.</Typography></TableCell></TableRow> : items.map((match) => <TableRow key={match.id} hover><TableCell><Typography fontWeight={750}>{match.gameDefinition.name}</Typography><Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>{match.id}</Typography><Typography variant="caption" display="block" color="text.secondary">{match.gameDefinition.key}</Typography></TableCell><TableCell><Stack spacing={.35}>{match.participants.map((participant) => <Stack direction="row" spacing={.7} alignItems="center" key={participant.id}><Typography variant="body2">{label(participant)}</Typography><Chip size="small" label={participant.result} color={participant.result === 'WIN' ? 'success' : participant.result === 'LOSS' || participant.result === 'FORFEIT' ? 'error' : 'default'} sx={{ height: 20 }} /></Stack>)}</Stack></TableCell><TableCell>{match.mode.replace('_', ' ')}</TableCell><TableCell><Chip size="small" label={match.status} color={statusColor(match.status)} /></TableCell><TableCell><Typography variant="body2">{match._count.events} events</Typography><Typography variant="caption" color="text.secondary">{match._count.assignments} assignments · {match._count.rounds} rounds</Typography></TableCell><TableCell sx={{ whiteSpace: 'nowrap' }}>{date(match.createdAt)}</TableCell><TableCell align="right"><Button size="small" variant="outlined" onClick={() => onOpenMatch360(match.id)}>Match 360</Button></TableCell></TableRow>)}</TableBody></Table></Box></Card>
  </Stack>;
}
