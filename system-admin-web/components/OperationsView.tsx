'use client';

import { useEffect, useState } from 'react';

import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { AdminOperations } from '../lib/types';

const date = (value: string) => new Date(value).toLocaleString();

export function OperationsView() {
  const [data, setData] = useState<AdminOperations | null>(null);
  const [error, setError] = useState('');
  const load = () => { void api<AdminOperations>('/operations').then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load operations')); };
  useEffect(() => { load(); const timer = window.setInterval(load, 15_000); return () => window.clearInterval(timer); }, []);
  if (error) return <Typography color="error.main">{error}</Typography>;
  if (!data) return <Typography color="text.secondary">Loading operational telemetry…</Typography>;
  const stats = [
    ['Queue', data.queue.searchingTickets, 'searching tickets'], ['Active matches', data.matches.active, 'in progress'], ['Review matches', data.matches.review, 'awaiting settlement'], ['Outbox failures', data.outbox.failed, 'failed events'], ['Pending jobs', data.outbox.pending + data.notifications.pending, 'outbox + notifications'], ['Failed purchases', data.commerce.failedPurchases, 'need inspection'], ['Rejected ad claims', data.rewards.rejectedClaims, 'verification rejected'], ['Open feedback', data.feedback.open, 'unresolved reports'], ['Wallet ledger events', data.ledger.walletTransactions, 'immutable entries'], ['Leaderboard events', data.ledger.leaderboardScoreEvents, 'score entries'], ['Inventory rows', data.commerce.inventoryRows, 'owned item rows'], ['Completed purchases', data.commerce.completedPurchases, 'successful purchases'],
  ];
  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}><Box><Typography variant="h4" fontWeight={850}>Operations</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Server health, queues, failure signals, immutable ledgers, and administrator actions.</Typography></Box><Chip icon={data.health.database === 'ok' ? <CheckCircleRoundedIcon /> : <ErrorRoundedIcon />} color={data.health.database === 'ok' ? 'success' : 'error'} label={`Database ${data.health.database}`} variant="outlined" /></Stack>
    <Grid container spacing={1.5}>{stats.map(([label, value, caption]) => <Grid key={label} size={{ xs: 6, sm: 4, lg: 3 }}><Card sx={{ p: 2 }}><Typography variant="h5" fontWeight={850}>{value}</Typography><Typography fontWeight={700}>{label}</Typography><Typography variant="caption" color="text.secondary">{caption}</Typography></Card></Grid>)}</Grid>
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 6 }}><Card><Box sx={{ p: 2.5 }}><Typography variant="h6" fontWeight={800}>Outbox health</Typography><Typography variant="body2" color="text.secondary">Events are durable until published; failures remain visible for retry or investigation.</Typography></Box><Divider />{data.recentOutbox.length ? data.recentOutbox.map((event) => <Stack key={event.id} direction="row" spacing={1.5} alignItems="center" sx={{ px: 2.5, py: 1.5 }}><Chip size="small" label={event.status} color={event.status === 'FAILED' ? 'error' : event.status === 'PUBLISHED' ? 'success' : 'warning'} /><Box sx={{ minWidth: 0, flex: 1 }}><Typography variant="body2" fontWeight={700} noWrap>{event.eventType}</Typography><Typography variant="caption" color="text.secondary">{event.aggregateType} · {date(event.createdAt)} · {event.attempts} attempts</Typography>{event.lastError && <Typography variant="caption" color="error.main" display="block" noWrap>{event.lastError}</Typography>}</Box></Stack>) : <Typography color="text.secondary" sx={{ p: 2.5 }}>No outbox events yet.</Typography>}</Card></Grid>
      <Grid size={{ xs: 12, lg: 6 }}><Card><Box sx={{ p: 2.5 }}><Stack direction="row" spacing={1} alignItems="center"><HistoryRoundedIcon color="primary" /><Typography variant="h6" fontWeight={800}>Recent administrator actions</Typography></Stack><Typography variant="body2" color="text.secondary">Privileged corrections are written inside their domain transaction.</Typography></Box><Divider />{data.recentAudit.length ? data.recentAudit.map((event) => <Box key={event.id} sx={{ px: 2.5, py: 1.5 }}><Stack direction="row" justifyContent="space-between" spacing={2}><Typography variant="body2" fontWeight={700}>{event.action.replaceAll('_', ' ')}</Typography><Typography variant="caption" color="text.secondary">{date(event.createdAt)}</Typography></Stack><Typography variant="caption" color="text.secondary">{event.actor.profile?.displayName || event.actor.username} · {event.entityType}{event.entityId ? ` · ${event.entityId}` : ''}</Typography><Typography variant="body2" sx={{ mt: .4 }}>{event.reason}</Typography></Box>) : <Typography color="text.secondary" sx={{ p: 2.5 }}>No administrator corrections recorded yet.</Typography>}</Card></Grid>
    </Grid>
  </Stack>;
}
