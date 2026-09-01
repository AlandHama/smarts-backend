'use client';

import { useEffect, useState } from 'react';

import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';

type Feedback = { id: string; entity: string; description: string; status: string; adminNote: string | null; createdAt: string; category: { name: string; key: string }; user: { username: string; email: string | null; profile: { displayName: string } | null } };

const statusColor = (status: string) => status === 'RESOLVED' ? 'success' : status === 'DISMISSED' ? 'default' : status === 'IN_REVIEW' ? 'warning' : 'info';

export function FeedbackView() {
  const [items, setItems] = useState<Feedback[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const load = () => api<{ items: Feedback[] }>('/feedback').then((result) => setItems(result.items)).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load feedback'));
  useEffect(() => { void load(); }, []);
  const update = async (id: string, nextStatus: string) => { try { setError(''); await api(`/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update feedback'); } };
  const filtered = status ? items.filter((item) => item.status === status) : items;
  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2}>
      <Box><Typography variant="h4" fontWeight={850}>Feedback inbox</Typography><Typography color="text.secondary">Review player reports and product feedback from one queue.</Typography></Box>
      <Select size="small" value={status} onChange={(event) => setStatus(event.target.value)} displayEmpty sx={{ minWidth: 180 }}><MenuItem value="">All statuses</MenuItem><MenuItem value="OPEN">Open</MenuItem><MenuItem value="IN_REVIEW">In review</MenuItem><MenuItem value="RESOLVED">Resolved</MenuItem><MenuItem value="DISMISSED">Dismissed</MenuItem></Select>
    </Stack>
    {error && <Typography color="error.main">{error}</Typography>}
    <Stack spacing={1.5}>{filtered.length ? filtered.map((item) => <Card key={item.id} variant="outlined" sx={{ p: 2.5 }}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}><Stack direction="row" spacing={1.5} alignItems="flex-start"><Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'rgba(72,196,221,.15)', color: 'secondary.main', display: 'grid', placeItems: 'center' }}><ForumRoundedIcon fontSize="small" /></Box><Box><Typography fontWeight={800}>{item.category.name}</Typography><Typography variant="body2" color="text.secondary">{item.user.profile?.displayName || item.user.username} · {item.user.email || 'no email'} · {new Date(item.createdAt).toLocaleString()}</Typography></Box></Stack><Select size="small" value={item.status} onChange={(event) => void update(item.id, event.target.value)} sx={{ minWidth: 145 }}><MenuItem value="OPEN">Open</MenuItem><MenuItem value="IN_REVIEW">In review</MenuItem><MenuItem value="RESOLVED">Resolved</MenuItem><MenuItem value="DISMISSED">Dismissed</MenuItem></Select></Stack><Stack direction="row" spacing={1} sx={{ mt: 2 }}><Chip size="small" label={item.entity} color="secondary" variant="outlined" /><Chip size="small" label={item.status.replace('_', ' ')} color={statusColor(item.status) as any} /></Stack><Typography sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>{item.description}</Typography>{item.adminNote && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Admin note: {item.adminNote}</Typography>}</Card>) : <Card variant="outlined" sx={{ p: 6, textAlign: 'center' }}><Typography color="text.secondary">No feedback matches this filter.</Typography></Card>}</Stack>
  </Stack>;
}
