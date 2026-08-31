'use client';

import { useEffect, useState, type FormEvent } from 'react';

import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { GameConfigRecord } from '../lib/types';
import { GameContentPanel } from './GameContentPanel';

const valueOf = (form: HTMLFormElement, name: string) => String((form.elements.namedItem(name) as HTMLInputElement)?.value ?? '').trim();
const numberFields = ['maxEloDelta', 'soloEloScoreDivisor', 'soloEloMaxDelta', 'scoreRewardDivisor', 'wrongAnswerPenaltyPercent', 'maxAnswerTimeSeconds', 'maxMatchDurationSeconds', 'maxQuestions'];
const moneyFields = ['winnerBaseReward', 'loserBaseReward', 'drawReward', 'scoreRewardCap', 'winnerRewardBonusMax', 'loserRewardBonusMax', 'multiplayerRewardReference'];

export function GameConfigView() {
  const [items, setItems] = useState<GameConfigRecord[]>([]);
  const [key, setKey] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = () => api<GameConfigRecord[]>('/game-config').then((rows) => { setItems(rows); if (!key && rows[0]) setKey(rows[0].key); }).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load game configuration'));
  useEffect(() => { load(); }, []);
  const current = items.find((item) => item.key === key);
  const config = current?.config;
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!current) return;
    const form = event.currentTarget;
    try {
      setError('');
      const points = JSON.parse(valueOf(form, 'correctAnswerPoints')) as Record<string, number>;
      const payload: Record<string, unknown> = { mainProgressionKey: valueOf(form, 'mainProgressionKey'), eloProgressionKey: valueOf(form, 'eloProgressionKey'), rewardCurrencyCode: valueOf(form, 'rewardCurrencyCode'), scoreMultiplierForXp: valueOf(form, 'scoreMultiplierForXp'), correctAnswerPoints: points, rankingEnabled: (form.elements.namedItem('rankingEnabled') as HTMLInputElement).value === 'true', rankingEloMultiplier: valueOf(form, 'rankingEloMultiplier'), rankingLevelMultiplier: valueOf(form, 'rankingLevelMultiplier'), rankingCoinMultiplier: valueOf(form, 'rankingCoinMultiplier'), settings: JSON.parse(valueOf(form, 'settings')) };
      numberFields.forEach((field) => { payload[field] = Number(valueOf(form, field)); });
      moneyFields.forEach((field) => { payload[field] = valueOf(form, field); });
      const saved = await api<GameConfigRecord>(`/game-config/${current.key}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setItems((rows) => rows.map((row) => row.key === saved.key ? saved : row));
      setMessage(`Saved ${current.name}; policy version ${saved.config?.version ?? '—'}`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save game configuration'); }
  };
  return <Stack spacing={3}><Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}><Box><Typography variant="h4" fontWeight={850}>Game configuration</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Server-owned scoring, timing, ELO, leaderboard, and reward policies. Every save creates a new policy version.</Typography></Box><Select size="small" value={key} onChange={(event) => { setKey(event.target.value); setMessage(''); setError(''); }} sx={{ minWidth: 230 }}>{items.map((item) => <MenuItem key={item.key} value={item.key}>{item.name}</MenuItem>)}</Select></Stack>{error && <Typography color="error.main">{error}</Typography>}{message && <Typography color="success.main">{message}</Typography>}{current && config && <><Card><form onSubmit={save}><Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Stack direction="row" spacing={1} alignItems="center"><TuneRoundedIcon color="primary" /><Typography variant="h6" fontWeight={800}>{current.name}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: .7 }}>Stable key: {current.key} · {current._count?.matches ?? 0} matches · {current._count?.content ?? 0} content items</Typography></Box><Chip label={`v${config.version}`} color="primary" variant="outlined" /></Stack><Divider /><Typography variant="subtitle2" fontWeight={800}>Authority references</Typography><Grid container spacing={2}><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" name="mainProgressionKey" label="Main progression" defaultValue={config.mainProgressionKey} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" name="eloProgressionKey" label="ELO progression" defaultValue={config.eloProgressionKey} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" name="rewardCurrencyCode" label="Reward currency" defaultValue={config.rewardCurrencyCode} /></Grid></Grid><Typography variant="subtitle2" fontWeight={800}>Scoring and timing</Typography><Grid container spacing={2}><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" name="scoreMultiplierForXp" label="XP score multiplier" defaultValue={config.scoreMultiplierForXp} /></Grid>{numberFields.map((field) => <Grid key={field} size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" type="number" name={field} label={field.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())} defaultValue={config[field as keyof typeof config] as number} /></Grid>)}</Grid><TextField fullWidth size="small" name="correctAnswerPoints" label="Correct points by difficulty (JSON)" defaultValue={JSON.stringify(config.correctAnswerPoints)} helperText="Example: {&quot;1&quot;:100,&quot;2&quot;:120,&quot;3&quot;:150}" /><Typography variant="subtitle2" fontWeight={800}>Currency rewards</Typography><Grid container spacing={2}>{moneyFields.map((field) => <Grid key={field} size={{ xs: 12, sm: 4 }}><TextField fullWidth size="small" name={field} label={field.replace(/[A-Z]/g, (letter) => ` ${letter}`).replace(/^./, (letter) => letter.toUpperCase())} defaultValue={config[field as keyof typeof config] as string} /></Grid>)}</Grid><Typography variant="subtitle2" fontWeight={800}>Ranking policy</Typography><Grid container spacing={2}><Grid size={{ xs: 12, sm: 3 }}><Select fullWidth size="small" name="rankingEnabled" defaultValue={String(config.rankingEnabled)}><MenuItem value="true">Enabled</MenuItem><MenuItem value="false">Disabled</MenuItem></Select></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField fullWidth size="small" name="rankingEloMultiplier" label="ELO multiplier" defaultValue={config.rankingEloMultiplier} /></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField fullWidth size="small" name="rankingLevelMultiplier" label="Level multiplier" defaultValue={config.rankingLevelMultiplier} /></Grid><Grid size={{ xs: 12, sm: 3 }}><TextField fullWidth size="small" name="rankingCoinMultiplier" label="Coin multiplier" defaultValue={config.rankingCoinMultiplier} /></Grid></Grid><TextField fullWidth multiline minRows={3} size="small" name="settings" label="Additional game settings (JSON)" defaultValue={JSON.stringify(config.settings ?? {}, null, 2)} helperText="Keep leaderboardKeys here to route settlement scores without code changes." /><Stack direction="row" justifyContent="flex-end"><Button type="submit" variant="contained" startIcon={<SaveRoundedIcon />}>Save policy version</Button></Stack></Stack></form></Card><GameContentPanel gameKey={current.key} /></>}</Stack>;
}
