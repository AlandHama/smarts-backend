'use client';

import { useEffect, useState } from 'react';

import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import WifiTetheringRoundedIcon from '@mui/icons-material/WifiTetheringRounded';
import MonetizationOnRoundedIcon from '@mui/icons-material/MonetizationOnRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid2';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { OverviewMetrics } from '../lib/types';

const metrics = [
  { key: 'totalUsers', label: 'Total players', icon: <GroupRoundedIcon />, color: '#8b7dff' },
  { key: 'activeUsers', label: 'Active players', icon: <InsightsRoundedIcon />, color: '#45d5a2' },
  { key: 'onlinePlayers', label: 'Online now', icon: <WifiTetheringRoundedIcon />, color: '#52c7f5' },
  { key: 'bannedUsers', label: 'Banned accounts', icon: <SecurityRoundedIcon />, color: '#ff7180' },
  { key: 'activeSessions', label: 'Live sessions', icon: <MonetizationOnRoundedIcon />, color: '#52c7f5' },
] as const;

export function OverviewView({ onNavigate }: { onNavigate: (view: 'players' | 'progressions' | 'economy' | 'leaderboards' | 'game-config') => void }) {
  const [data, setData] = useState<OverviewMetrics | null>(null);
  useEffect(() => {
    const load = () => { void api<OverviewMetrics>('/overview').then(setData).catch(() => undefined); };
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return <Stack spacing={4}><Box><Typography variant="h4" fontWeight={850}>Good to see you.</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Monitor the new server-owned SMARTS platform from here.</Typography></Box><Grid container spacing={2}>{metrics.map((metric) => <Grid key={metric.key} size={{ xs: 12, sm: 6, lg: 3, xl: 2.4 }}><Card sx={{ p: 2.5, height: '100%' }}><Stack direction="row" justifyContent="space-between" alignItems="flex-start"><Box sx={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 2.5, bgcolor: `${metric.color}20`, color: metric.color }}>{metric.icon}</Box><Typography variant="caption" color="text.secondary">LIVE</Typography></Stack>{data ? <Typography variant="h3" sx={{ mt: 2 }}>{data[metric.key]}</Typography> : <Skeleton width={90} height={50} />}<Typography color="text.secondary">{metric.label}</Typography></Card></Grid>)}</Grid><Card sx={{ p: { xs: 2.5, md: 4 } }}><Grid container spacing={4} alignItems="center"><Grid size={{ xs: 12, md: 7 }}><Typography variant="h5" fontWeight={800}>Operate with confidence</Typography><Typography color="text.secondary" sx={{ mt: 1.2, maxWidth: 650, lineHeight: 1.7 }}>Every match settlement, wallet mutation, progression award, and leaderboard score is processed inside a transaction, protected with row locks, and recorded as an immutable event. Use the workspace shortcuts to inspect or change server-owned data.</Typography></Grid><Grid size={{ xs: 12, md: 5 }}><Stack spacing={1.2}><Button variant="outlined" endIcon={<ArrowForwardRoundedIcon />} onClick={() => onNavigate('players')} sx={{ justifyContent: 'space-between' }}>Manage players</Button><Button variant="outlined" endIcon={<ArrowForwardRoundedIcon />} onClick={() => onNavigate('progressions')} sx={{ justifyContent: 'space-between' }}>Configure progressions</Button><Button variant="outlined" endIcon={<ArrowForwardRoundedIcon />} onClick={() => onNavigate('economy')} sx={{ justifyContent: 'space-between' }}>Inspect economy</Button><Button variant="outlined" endIcon={<ArrowForwardRoundedIcon />} onClick={() => onNavigate('leaderboards')} sx={{ justifyContent: 'space-between' }}>Open leaderboards</Button><Button variant="outlined" endIcon={<ArrowForwardRoundedIcon />} onClick={() => onNavigate('game-config')} sx={{ justifyContent: 'space-between' }}>Edit game policies</Button></Stack></Grid></Grid></Card></Stack>;
}
