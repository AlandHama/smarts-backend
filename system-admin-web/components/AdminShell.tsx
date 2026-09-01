'use client';

import { useState, type ReactNode } from 'react';

import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded';
import GroupRoundedIcon from '@mui/icons-material/GroupRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import MonetizationOnRoundedIcon from '@mui/icons-material/MonetizationOnRounded';
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded';
import LeaderboardRoundedIcon from '@mui/icons-material/LeaderboardRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import StorefrontRoundedIcon from '@mui/icons-material/StorefrontRounded';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';

export type AdminView = 'overview' | 'players' | 'player360' | 'sessions' | 'progressions' | 'economy' | 'commerce' | 'leaderboards' | 'game-config' | 'feedback';

const navigation = [
  { key: 'overview' as const, label: 'Overview', icon: <DashboardRoundedIcon /> },
  { key: 'players' as const, label: 'Players', icon: <GroupRoundedIcon /> },
  { key: 'sessions' as const, label: 'Sessions', icon: <DevicesRoundedIcon /> },
  { key: 'progressions' as const, label: 'Progressions', icon: <SettingsSuggestRoundedIcon /> },
  { key: 'economy' as const, label: 'Economy', icon: <MonetizationOnRoundedIcon /> },
  { key: 'commerce' as const, label: 'Commerce', icon: <StorefrontRoundedIcon /> },
  { key: 'leaderboards' as const, label: 'Leaderboards', icon: <LeaderboardRoundedIcon /> },
  { key: 'game-config' as const, label: 'Game config', icon: <TuneRoundedIcon /> },
  { key: 'feedback' as const, label: 'Feedback', icon: <ForumRoundedIcon /> },
];

export function AdminShell({ view, onViewChange, onLogout, adminName, children }: { view: AdminView; onViewChange: (view: AdminView) => void; onLogout: () => void; adminName: string; children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawer = <Box sx={{ width: 260, height: '100%', display: 'flex', flexDirection: 'column', p: 2 }}>
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 1, py: 1.5, mb: 3 }}>
      <Box sx={{ width: 40, height: 40, borderRadius: 2.5, display: 'grid', placeItems: 'center', bgcolor: 'primary.main', color: '#fff', fontWeight: 900, boxShadow: '0 8px 24px rgba(139,125,255,.35)' }}>S</Box>
      <Box><Typography fontWeight={800}>SMARTS</Typography><Typography variant="caption" color="text.secondary">Control Center</Typography></Box>
    </Stack>
    <Typography variant="overline" color="text.secondary" sx={{ px: 1.5, letterSpacing: '.12em' }}>Workspace</Typography>
    <List sx={{ mt: 1 }}>{navigation.map((item) => <ListItemButton key={item.key} selected={view === item.key} onClick={() => { onViewChange(item.key); setMobileOpen(false); }} sx={{ borderRadius: 2.5, mb: .5, py: 1.2, '&.Mui-selected': { bgcolor: 'rgba(139,125,255,.18)', color: 'primary.light', '& .MuiListItemIcon-root': { color: 'primary.light' } } }}><ListItemIcon sx={{ minWidth: 38, color: 'text.secondary' }}>{item.icon}</ListItemIcon><ListItemText primary={item.label} /></ListItemButton>)}</List>
    <Box sx={{ flex: 1 }} />
    <Button startIcon={<LogoutRoundedIcon />} onClick={onLogout} color="inherit" sx={{ justifyContent: 'flex-start', px: 1.5, color: 'text.secondary' }}>Sign out</Button>
  </Box>;
  const title = view === 'player360' ? 'Player 360' : navigation.find((item) => item.key === view)?.label ?? 'Overview';
  return <Box sx={{ minHeight: '100vh', display: 'flex', background: 'radial-gradient(circle at 75% -15%, rgba(72,82,159,.45), transparent 32%), #0b1020' }}>
    <Box component="nav" sx={{ display: { xs: 'none', md: 'block' }, width: 260, flexShrink: 0, borderRight: '1px solid rgba(148,163,184,.12)' }}><Box sx={{ position: 'fixed', width: 260, height: '100vh' }}>{drawer}</Box></Box>
    <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)} sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { bgcolor: 'background.paper' } }}>{drawer}</Drawer>
    <Box component="main" sx={{ minWidth: 0, flex: 1 }}>
      <Toolbar sx={{ minHeight: { xs: 68, md: 82 }, px: { xs: 2, md: 5 }, borderBottom: '1px solid rgba(148,163,184,.12)', bgcolor: 'rgba(11,16,32,.6)', backdropFilter: 'blur(16px)' }}>
        <IconButton onClick={() => setMobileOpen(true)} sx={{ display: { xs: 'inline-flex', md: 'none' }, mr: 1 }}><MenuRoundedIcon /></IconButton>
        <Box sx={{ flex: 1 }}><Typography variant="caption" color="text.secondary" sx={{ letterSpacing: '.12em' }}>SYSTEM ADMINISTRATION</Typography><Typography variant="h5" fontWeight={800}>{title}</Typography></Box>
        <Stack direction="row" spacing={1.5} alignItems="center"><Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}><Typography fontWeight={700}>{adminName}</Typography><Typography variant="caption" color="text.secondary">Administrator</Typography></Box><Box sx={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: '50%', bgcolor: 'rgba(139,125,255,.22)', color: 'primary.light', fontWeight: 800 }}>{adminName.slice(0, 1).toUpperCase()}</Box></Stack>
      </Toolbar>
      <Box sx={{ p: { xs: 2, md: 5 }, maxWidth: 1600, mx: 'auto' }}>{children}</Box>
    </Box>
  </Box>;
}
