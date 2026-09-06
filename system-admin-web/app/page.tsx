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
import { RewardPoliciesView } from '../components/RewardPoliciesView';
import { PaidRewardsView } from '../components/PaidRewardsView';
import { StorageView } from '../components/StorageView';
import { FriendsView } from '../components/FriendsView';
import { OperationsView } from '../components/OperationsView';
import { PlayerAuditsView } from '../components/PlayerAuditsView';
import { MatchesView } from '../components/MatchesView';
import { Match360View } from '../components/Match360View';
import { api, clearSession, hasSession, login } from '../lib/api';
import { adminTheme } from '../lib/theme';

const viewPaths: Record<Exclude<AdminView, 'player360' | 'match360'>, string> = {
  overview: '/', operations: '/operations/', players: '/players/', sessions: '/sessions/', friends: '/friends/', 'player-audits': '/player-audits/', matches: '/matches/', progressions: '/progressions/', economy: '/economy/', commerce: '/commerce/', 'paid-rewards': '/paid-rewards/', leaderboards: '/leaderboards/', 'game-config': '/game-config/', 'reward-policies': '/reward-policies/', storage: '/storage/', feedback: '/feedback/',
};

function routeState() {
  if (typeof window === 'undefined') return { view: 'overview' as AdminView, id: null as string | null };
  const relative = window.location.pathname.replace(/^\/system-admin\/?/, '').split('/').filter(Boolean);
  if (relative[0] === 'players' && relative[1]) return { view: 'player360' as AdminView, id: relative[1] };
  if (relative[0] === 'matches' && relative[1]) return { view: 'match360' as AdminView, id: relative[1] };
  const view = (Object.entries(viewPaths).find(([, path]) => path.replaceAll('/', '') === relative.join(''))?.[0] || 'overview') as AdminView;
  return { view, id: null };
}

export default function AdminPage() {
  const [admin, setAdmin] = useState<any>(null);
  const [view, setView] = useState<AdminView>('overview');
  const [player360Id, setPlayer360Id] = useState<string | null>(null);
  const [match360Id, setMatch360Id] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const initial = routeState();
    setView(initial.view);
    setPlayer360Id(initial.view === 'player360' ? initial.id : null);
    setMatch360Id(initial.view === 'match360' ? initial.id : null);
    const onPopState = () => {
      const next = routeState();
      setView(next.view);
      setPlayer360Id(next.view === 'player360' ? next.id : null);
      setMatch360Id(next.view === 'match360' ? next.id : null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!hasSession()) { setChecking(false); return; }
    api<any>('/overview').then(() => setAdmin({ username: 'Administrator' })).catch(() => clearSession()).finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    if (!admin) return;
    const heartbeat = () => { void api('/presence/heartbeat').catch(() => undefined); };
    heartbeat();
    const timer = window.setInterval(heartbeat, 2 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [admin]);

  const signIn = async (identifier: string, password: string) => {
    const response = await login(identifier, password);
    setAdmin(response.user);
  };
  const go = (nextView: AdminView, id?: string | null, replace = false) => {
    const path = nextView === 'player360' && id ? `/system-admin/players/${id}/` : nextView === 'match360' && id ? `/system-admin/matches/${id}/` : `/system-admin${viewPaths[nextView as Exclude<AdminView, 'player360' | 'match360'>] || '/'}`;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setView(nextView);
    setPlayer360Id(nextView === 'player360' ? id || null : null);
    setMatch360Id(nextView === 'match360' ? id || null : null);
  };
  const signOut = () => { clearSession(); setAdmin(null); go('overview', null, true); };
  const openPlayer360 = (userId: string) => go('player360', userId);
  const openMatch360 = (matchId: string) => go('match360', matchId);
  const backToPlayers = () => go('players', null, true);
  const backToMatches = () => go('matches', null, true);

  return <ThemeProvider theme={adminTheme}><CssBaseline />{checking ? null : !admin ? <LoginView onLogin={signIn} /> : <AdminShell view={view} onViewChange={(nextView) => go(nextView)} onLogout={signOut} adminName={admin.username || admin.email || 'Administrator'}>
    {view === 'overview' && <OverviewView onNavigate={go} />}
    {view === 'operations' && <OperationsView />}
    {view === 'players' && <UsersView onOpenPlayer360={openPlayer360} />}
    {view === 'player360' && player360Id && <Player360View userId={player360Id} onBack={backToPlayers} onOpenMatch360={openMatch360} />}
    {view === 'matches' && <MatchesView onOpenMatch360={openMatch360} />}
    {view === 'match360' && match360Id && <Match360View matchId={match360Id} onBack={backToMatches} />}
    {view === 'sessions' && <SessionsView />}
    {view === 'friends' && <FriendsView />}
    {view === 'player-audits' && <PlayerAuditsView onOpenPlayer360={openPlayer360} />}
    {view === 'progressions' && <><ProgressionsView /><ProgressionTopPlayersPanel /></>}
    {view === 'economy' && <><EconomyView /><CurrencyTopPlayersPanel /></>}
    {view === 'commerce' && <CommerceView />}
    {view === 'paid-rewards' && <PaidRewardsView onOpenPlayer360={openPlayer360} />}
    {view === 'storage' && <StorageView />}
    {view === 'leaderboards' && <><LeaderboardView /><SeasonManagerPanel /></>}
    {view === 'game-config' && <GameConfigView />}
    {view === 'reward-policies' && <RewardPoliciesView onOpenPlayer360={openPlayer360} />}
    {view === 'feedback' && <FeedbackView />}
  </AdminShell>}</ThemeProvider>;
}
