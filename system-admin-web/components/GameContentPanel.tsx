'use client';

import { useEffect, useState, type FormEvent } from 'react';

import AddRoundedIcon from '@mui/icons-material/AddRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';

type ContentItem = { id: string; version: number; contentType: string; prompt: Record<string, unknown>; options: unknown[]; difficulty: number; category: string | null; active: boolean };
const valueOf = (form: HTMLFormElement, name: string) => String((form.elements.namedItem(name) as HTMLInputElement)?.value ?? '').trim();

export function GameContentPanel({ gameKey }: { gameKey: string }) {
  const [items, setItems] = useState<ContentItem[]>([]);
  const [error, setError] = useState('');
  const load = () => api<ContentItem[]>(`/game-config/${gameKey}/content`).then(setItems).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load content'));
  useEffect(() => { load(); }, [gameKey]);
  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api('/game-content', { method: 'POST', body: JSON.stringify({ gameKey, contentType: valueOf(form, 'contentType'), prompt: JSON.parse(valueOf(form, 'prompt')), options: JSON.parse(valueOf(form, 'options')), difficulty: Number(valueOf(form, 'difficulty')), answerIndex: Number(valueOf(form, 'answerIndex')), category: valueOf(form, 'category') || undefined }) });
      form.reset();
      load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to add content'); }
  };
  return <Card><Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 4 } }}><Box><Typography variant="h6" fontWeight={800}>Server content assignments</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .7 }}>Answer keys stay in PostgreSQL and are never returned to the mobile client.</Typography></Box>{error && <Typography color="error.main">{error}</Typography>}<form onSubmit={add}><Grid container spacing={1.5}><Grid size={{ xs: 12, sm: 3 }}><TextField fullWidth size="small" name="contentType" label="Type" defaultValue="multiple_choice" required /></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField fullWidth size="small" name="difficulty" label="Difficulty" type="number" defaultValue={1} required /></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField fullWidth size="small" name="answerIndex" label="Correct option index" type="number" defaultValue={0} required /></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField fullWidth size="small" name="category" label="Category" /></Grid><Grid size={{ xs: 12, md: 6 }}><TextField fullWidth size="small" name="prompt" label="Prompt JSON" placeholder='{"en":"Question"}' required /></Grid><Grid size={{ xs: 12, md: 6 }}><TextField fullWidth size="small" name="options" label="Options JSON array" placeholder='["A","B","C","D"]' required /></Grid></Grid><Button type="submit" variant="outlined" startIcon={<AddRoundedIcon />} sx={{ mt: 1 }}>Add content item</Button></form><Divider />{items.length ? <Box sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>Version</TableCell><TableCell>Type</TableCell><TableCell>Difficulty</TableCell><TableCell>Category</TableCell><TableCell>Status</TableCell></TableRow></TableHead><TableBody>{items.map((item) => <TableRow key={item.id}><TableCell>v{item.version}</TableCell><TableCell>{item.contentType}</TableCell><TableCell>{item.difficulty}</TableCell><TableCell>{item.category || '—'}</TableCell><TableCell><Chip size="small" color={item.active ? 'success' : 'warning'} label={item.active ? 'ACTIVE' : 'INACTIVE'} /></TableCell></TableRow>)}</TableBody></Table></Box> : <Typography color="text.secondary">No content configured for this game yet.</Typography>}</Stack></Card>;
}
