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
import { SessionsView } from '../components/SessionsView';
import { CommerceView } from '../components/CommerceView';
import { Player360View } from '../components/Player360View';
import { FeedbackView } from '../components/FeedbackView';
import { StorageView } from '../components/StorageView';
import { api, clearSession, hasSession, login } from '../lib/api';
import { adminTheme } from '../lib/theme';

export default function AdminPage() {
  const [admin, setAdmin] = useState<any>(null);
  const [view, setView] = useState<AdminView>('overview');
  const [player360Id, setPlayer360Id] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!hasSession()) { setChecking(false); return; }
    api<any>('/overview').then(() => setAdmin({ username: 'Administrator' })).catch(() => clearSession()).finally(() => setChecking(false));
  }, []);

  const signIn = async (identifier: string, password: string) => {
    const response = await login(identifier, password);
    setAdmin(response.user);
  };
  const signOut = () => { clearSession(); setAdmin(null); setView('overview'); setPlayer360Id(null); };
  const openPlayer360 = (userId: string) => { setPlayer360Id(userId); setView('player360'); };
  const backToPlayers = () => { setPlayer360Id(null); setView('players'); };

  return <ThemeProvider theme={adminTheme}><CssBaseline />{checking ? null : !admin ? <LoginView onLogin={signIn} /> : <AdminShell view={view} onViewChange={(nextView) => { if (nextView !== 'player360') setPlayer360Id(null); setView(nextView); }} onLogout={signOut} adminName={admin.username || admin.email || 'Administrator'}>{view === 'overview' && <OverviewView onNavigate={setView} />}{view === 'players' && <UsersView onOpenPlayer360={openPlayer360} />}{view === 'player360' && player360Id && <Player360View userId={player360Id} onBack={backToPlayers} />}{view === 'sessions' && <SessionsView />}{view === 'progressions' && <><ProgressionsView /><ProgressionTopPlayersPanel /></>}{view === 'economy' && <><EconomyView /><CurrencyTopPlayersPanel /></>}{view === 'commerce' && <CommerceView />}{view === 'storage' && <StorageView />}{view === 'leaderboards' && <><LeaderboardView /><SeasonManagerPanel /></>}{view === 'game-config' && <GameConfigView />}{view === 'feedback' && <FeedbackView />}</AdminShell>}</ThemeProvider>;
}
