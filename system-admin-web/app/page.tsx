'use client';

import { useEffect, useState } from 'react';

import CssBaseline from '@mui/material/CssBaseline';
import ThemeProvider from '@mui/material/styles/ThemeProvider';

import { AdminShell, type AdminView } from '../components/AdminShell';
import { CurrencyTopPlayersPanel, EconomyView } from '../components/EconomyView';
import { LoginView } from '../components/LoginView';
import { OverviewView } from '../components/OverviewView';
import { ProgressionTopPlayersPanel, ProgressionsView } from '../components/ProgressionsView';
import { LeaderboardView, SeasonManagerPanel } from '../components/LeaderboardView';
import { GameConfigView } from '../components/GameConfigView';
import { UsersView } from '../components/UsersView';
import { api, clearSession, hasSession, login } from '../lib/api';
import { adminTheme } from '../lib/theme';

export default function AdminPage() {
  const [admin, setAdmin] = useState<any>(null);
  const [view, setView] = useState<AdminView>('overview');
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!hasSession()) { setChecking(false); return; }
    api<any>('/overview').then(() => setAdmin({ username: 'Administrator' })).catch(() => clearSession()).finally(() => setChecking(false));
  }, []);

  const signIn = async (identifier: string, password: string) => {
    const response = await login(identifier, password);
    setAdmin(response.user);
  };
  const signOut = () => { clearSession(); setAdmin(null); setView('overview'); };

  return <ThemeProvider theme={adminTheme}><CssBaseline />{checking ? null : !admin ? <LoginView onLogin={signIn} /> : <AdminShell view={view} onViewChange={setView} onLogout={signOut} adminName={admin.username || admin.email || 'Administrator'}>{view === 'overview' && <OverviewView onNavigate={setView} />}{view === 'players' && <UsersView />}{view === 'progressions' && <><ProgressionsView /><ProgressionTopPlayersPanel /></>}{view === 'economy' && <><EconomyView /><CurrencyTopPlayersPanel /></>}{view === 'leaderboards' && <><LeaderboardView /><SeasonManagerPanel /></>}{view === 'game-config' && <GameConfigView />}</AdminShell>}</ThemeProvider>;
}
