'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import AccessTimeRoundedIcon from '@mui/icons-material/AccessTimeRounded';
import AutoGraphRoundedIcon from '@mui/icons-material/AutoGraphRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import LeaderboardRoundedIcon from '@mui/icons-material/LeaderboardRounded';
import MonetizationOnRoundedIcon from '@mui/icons-material/MonetizationOnRounded';
import PlayCircleRoundedIcon from '@mui/icons-material/PlayCircleRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { GameAnalyticsRow, SystemAdminAnalytics } from '../lib/types';

const number = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmt = (value: number) => number.format(Math.round(value || 0));
const fmtCompact = (value: number) => compact.format(Math.round(value || 0));
const percent = (value: number) => `${Number(value || 0).toFixed(value % 1 ? 1 : 0)}%`;

type Series = { key: string; label: string; color: string };

const engagementSeries: Series[] = [
  { key: 'dau', label: 'Daily active users', color: '#8b7dff' },
  { key: 'newPlayers', label: 'New players', color: '#45d5a2' },
  { key: 'matchesSettled', label: 'Settled matches', color: '#52c7f5' },
];

const gameplaySeries: Series[] = [
  { key: 'answers', label: 'Accepted answers', color: '#c58cff' },
  { key: 'correctAnswers', label: 'Correct answers', color: '#f4c95d' },
];

const playTimeSeries: Series[] = [
  { key: 'playHours', label: 'Active play hours', color: '#45d5a2' },
  { key: 'matchPlayHours', label: 'Match hours', color: '#f4c95d' },
];

export function OverviewView() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<SystemAdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api<SystemAdminAnalytics>(`/analytics?days=${days}`)
      .then((result) => { if (alive) setData(result); })
      .catch((reason) => { if (alive) setError(reason instanceof Error ? reason.message : 'Unable to load analytics'); })
      .finally(() => { if (alive) setLoading(false); });
    const timer = window.setInterval(() => {
      void api<SystemAdminAnalytics>(`/analytics?days=${days}`).then((result) => { if (alive) setData(result); }).catch(() => undefined);
    }, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [days]);

  const kpis = data?.kpis;
  const trends = data?.trends ?? [];
  const generatedLabel = data?.period.to ? new Date(data.period.to).toLocaleString() : '—';

  return <Stack spacing={3.5}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'flex-start' }} spacing={2}>
      <Box>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip size="small" color="primary" label="Game analytics" />
          <Chip size="small" variant="outlined" label="Server-owned data · UTC" />
          {data && <Chip size="small" variant="outlined" color="success" label={`Updated ${generatedLabel}`} />}
        </Stack>
        <Typography variant="h4" fontWeight={850} sx={{ mt: 1.3 }}>SMARTS analytics & reports</Typography>
        <Typography color="text.secondary" sx={{ mt: .7, maxWidth: 900 }}>Understand acquisition, engagement, retention, gameplay quality, progression, economy, and platform health from the Railway source of truth.</Typography>
      </Box>
      <Select size="small" value={days} onChange={(event) => setDays(Number(event.target.value))} sx={{ minWidth: 150, alignSelf: { xs: 'flex-start', md: 'auto' } }}>
        <MenuItem value={7}>Last 7 days</MenuItem>
        <MenuItem value={30}>Last 30 days</MenuItem>
        <MenuItem value={90}>Last 90 days</MenuItem>
        <MenuItem value={365}>Last 12 months</MenuItem>
      </Select>
    </Stack>

    {error && <Card sx={{ p: 2, borderColor: 'error.main' }}><Typography color="error.main">{error}</Typography></Card>}

    <Grid container spacing={1.5}>{[
      ['DAU today', kpis?.dau, 'Latest UTC day', <GroupsRoundedIcon />, '#8b7dff'],
      ['Average DAU', kpis?.averageDau, `Across ${days} days`, <AutoGraphRoundedIcon />, '#52c7f5'],
      ['Active players', kpis?.periodActiveUsers, 'Unique players in range', <TrendingUpRoundedIcon />, '#45d5a2'],
      ['New players', kpis?.newPlayers, 'Registrations in range', <GroupsRoundedIcon />, '#f4c95d'],
      ['Matches settled', kpis?.matchesSettled, `${percent(kpis?.completionRate ?? 0)} completion`, <PlayCircleRoundedIcon />, '#c58cff'],
      ['Answer accuracy', kpis?.accuracy, `${fmt(kpis?.acceptedAnswers ?? 0)} accepted answers`, <CheckCircleRoundedIcon />, '#45d5a2'],
      ['XP awarded', kpis?.xpAwarded, 'Progression movement', <EmojiEventsRoundedIcon />, '#f4c95d'],
      ['Purchase value', kpis?.purchaseValue, `${fmt(kpis?.completedPurchases ?? 0)} completed purchases`, <MonetizationOnRoundedIcon />, '#52c7f5'],
      ['Hours played', kpis?.totalPlayHours, 'Estimated active player time', <AccessTimeRoundedIcon />, '#45d5a2'],
      ['Daily play average', kpis?.averageDailyPlayHours, 'Hours per selected day', <TrendingUpRoundedIcon />, '#c58cff'],
      ['Average session', kpis?.averageSessionMinutes, 'Minutes per player session', <AccessTimeRoundedIcon />, '#f4c95d'],
    ].map(([label, value, caption, icon, color]) => <Grid key={String(label)} size={{ xs: 12, sm: 6, md: 3 }}><MetricCard label={String(label)} value={loading && !data ? null : typeof value === 'number' ? formatMetric(String(label), value) : '0'} caption={String(caption)} icon={icon as ReactNode} color={String(color)} /></Grid>)}</Grid>

    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 8 }}><ReportCard title="Play-time trend" subtitle="Estimated active player hours and verified match time by UTC day."><TrendChart points={trends} series={playTimeSeries} valueFormatter={(value) => `${value.toFixed(1)}h`} /></ReportCard></Grid>
      <Grid size={{ xs: 12, lg: 4 }}><PlayTimeReport data={data} loading={loading} /></Grid>
    </Grid>

    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 8 }}><ReportCard title="Engagement and growth" subtitle="Daily active users, new registrations, and completed matches."><TrendChart points={trends} series={engagementSeries} /></ReportCard></Grid>
      <Grid size={{ xs: 12, lg: 4 }}><RetentionCard data={data} loading={loading} /></Grid>
    </Grid>

    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 7 }}><ReportCard title="Gameplay quality" subtitle="Accepted server events and verified answer correctness."><TrendChart points={trends} series={gameplaySeries} /></ReportCard></Grid>
      <Grid size={{ xs: 12, lg: 5 }}><GameBreakdown games={data?.games ?? []} loading={loading} /></Grid>
    </Grid>

    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 6 }}><ProgressionReport data={data} loading={loading} /></Grid>
      <Grid size={{ xs: 12, lg: 6 }}><EconomyReport data={data} loading={loading} /></Grid>
    </Grid>

    <Grid container spacing={2}>
      <Grid size={{ xs: 12, lg: 5 }}><GameplayReport data={data} loading={loading} /></Grid>
      <Grid size={{ xs: 12, lg: 7 }}><AudienceReport data={data} loading={loading} /></Grid>
    </Grid>

    <Grid container spacing={2}>
      <Grid size={{ xs: 12 }}><HealthReport data={data} loading={loading} /></Grid>
    </Grid>
  </Stack>;
}

function MetricCard({ label, value, caption, icon, color }: { label: string; value: string | null; caption: string; icon: ReactNode; color: string }) {
  return <Card sx={{ p: 2.2, height: '100%' }}><Stack direction="row" justifyContent="space-between" alignItems="flex-start"><Box sx={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 2.5, bgcolor: `${color}22`, color }}>{icon}</Box><Typography variant="caption" color="text.secondary">REPORT</Typography></Stack>{value === null ? <Skeleton width={100} height={48} sx={{ mt: 1.3 }} /> : <Typography variant="h4" sx={{ mt: 1.3, fontWeight: 850 }}>{value}</Typography>}<Typography fontWeight={700}>{label}</Typography><Typography variant="caption" color="text.secondary">{caption}</Typography></Card>;
}

function formatMetric(label: string, value: number) {
  if (label === 'Answer accuracy') return percent(value);
  if (label === 'Hours played') return `${value.toFixed(2)}h`;
  if (label === 'Daily play average') return `${value.toFixed(2)}h`;
  if (label === 'Average session') return `${value.toFixed(1)}m`;
  return fmtCompact(value);
}

function ReportCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <Card><CardHeader title={title} subheader={subtitle} titleTypographyProps={{ fontWeight: 800 }} subheaderTypographyProps={{ sx: { mt: .5 } }} /><CardContent sx={{ pt: 0 }}>{children}</CardContent></Card>;
}

function TrendChart({ points, series, valueFormatter = (value) => fmtCompact(value) }: { points: SystemAdminAnalytics['trends']; series: Series[]; valueFormatter?: (value: number) => string }) {
  const height = 250;
  const width = 900;
  const padding = { top: 18, right: 16, bottom: 28, left: 38 };
  const values = series.flatMap((item) => points.map((point) => Number(point[item.key as keyof typeof point]) || 0));
  const max = Math.max(...values, 1);
  const x = (index: number) => padding.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * (width - padding.left - padding.right));
  const y = (value: number) => height - padding.bottom - (value / max) * (height - padding.top - padding.bottom);
  if (!points.length) return <EmptyState text="No events have been recorded for this period." />;
  return <Stack spacing={1.5}><Box sx={{ width: '100%', overflow: 'hidden' }}><svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Analytics trend chart">
    {[0, .25, .5, .75, 1].map((ratio) => <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={y(max * ratio)} y2={y(max * ratio)} stroke="rgba(148,163,184,.16)" strokeDasharray="4 5" /><text x={padding.left - 8} y={y(max * ratio) + 4} textAnchor="end" fill="#91a0b8" fontSize="11">{valueFormatter(max * ratio)}</text></g>)}
    {series.map((item) => <polyline key={item.key} fill="none" stroke={item.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={points.map((point, index) => `${x(index)},${y(Number(point[item.key as keyof typeof point]) || 0)}`).join(' ')} />)}
    {points.map((point, index) => index === 0 || index === points.length - 1 || index === Math.floor(points.length / 2) ? <text key={point.date} x={x(index)} y={height - 6} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fill="#91a0b8" fontSize="11">{date(point.date)}</text> : null)}
  </svg></Box><Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>{series.map((item) => <Stack key={item.key} direction="row" spacing={.7} alignItems="center"><Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: item.color }} /><Typography variant="caption" color="text.secondary">{item.label}</Typography></Stack>)}</Stack></Stack>;
}

function PlayTimeReport({ data, loading }: { data: SystemAdminAnalytics | null; loading: boolean }) {
  const rows = data ? [
    ['Total active time', `${data.playTime.totalHours.toFixed(2)}h`],
    ['Average per selected day', `${data.playTime.averageDailyHours.toFixed(2)}h`],
    ['Active player-days', fmt(data.playTime.activeDays)],
    ['Tracked sessions', fmt(data.playTime.sessions)],
    ['Players with session activity', fmt(data.playTime.players)],
    ['Longest session', formatDuration(data.playTime.longestSessionMinutes * 60)],
    ['Verified match time', `${data.playTime.matchPlayHours.toFixed(2)}h`],
  ] as const : [];
  return <ReportCard title="Time spent" subtitle="Session activity is capped at 12 hours per session; match time is shown separately."><Stack spacing={1.15}>{loading && !data ? <Skeleton variant="rectangular" height={245} /> : rows.map(([label, value]) => <Stack key={label} direction="row" justifyContent="space-between" sx={{ py: .45 }}><Typography color="text.secondary">{label}</Typography><Typography fontWeight={850}>{value}</Typography></Stack>)}</Stack></ReportCard>;
}

function RetentionCard({ data, loading }: { data: SystemAdminAnalytics | null; loading: boolean }) {
  const rows = data ? [['D1', data.retention.day1], ['D7', data.retention.day7], ['D30', data.retention.day30]] as const : [];
  return <ReportCard title="Player retention" subtitle="Cohort return rate from server activity."><Stack spacing={2.2}>{loading && !data ? <Skeleton variant="rectangular" height={185} /> : rows.length ? rows.map(([label, item]) => <Box key={label}><Stack direction="row" justifyContent="space-between" sx={{ mb: .6 }}><Typography fontWeight={750}>{label} retention</Typography><Typography fontWeight={800} color="primary.light">{percent(item.rate)}</Typography></Stack><Box sx={{ height: 10, borderRadius: 5, bgcolor: 'rgba(148,163,184,.16)', overflow: 'hidden' }}><Box sx={{ width: `${Math.min(item.rate, 100)}%`, height: '100%', bgcolor: label === 'D1' ? 'primary.main' : label === 'D7' ? 'secondary.main' : 'success.main', borderRadius: 5 }} /></Box><Typography variant="caption" color="text.secondary">{fmt(item.retained)} returned of {fmt(item.eligible)} eligible players</Typography></Box>) : <EmptyState text="Retention needs at least one mature cohort." />}</Stack></ReportCard>;
}

function GameBreakdown({ games, loading }: { games: GameAnalyticsRow[]; loading: boolean }) {
  const max = Math.max(...games.map((game) => game.matches), 1);
  return <ReportCard title="Game performance" subtitle="Which game modes attract play and produce quality answers."><Stack spacing={1.7}>{loading && !games.length ? <Skeleton variant="rectangular" height={210} /> : games.length ? games.map((game) => <Box key={game.key}><Stack direction="row" justifyContent="space-between" spacing={2}><Typography fontWeight={750}>{game.name}</Typography><Typography variant="body2" color="text.secondary">{fmt(game.matches)} matches · {percent(game.accuracy)} accuracy</Typography></Stack><Box sx={{ mt: .7, height: 9, borderRadius: 5, bgcolor: 'rgba(148,163,184,.16)' }}><Box sx={{ width: `${(game.matches / max) * 100}%`, height: '100%', borderRadius: 5, background: 'linear-gradient(90deg, #8b7dff, #52c7f5)' }} /></Box><Stack direction="row" spacing={1.5} sx={{ mt: .4 }}><Typography variant="caption" color="text.secondary">{fmt(game.settled)} settled</Typography><Typography variant="caption" color="text.secondary">{fmt(game.review)} review</Typography><Typography variant="caption" color="text.secondary">Avg score {fmt(game.averageScore)}</Typography></Stack></Box>) : <EmptyState text="No game activity yet." />}</Stack></ReportCard>;
}

function ProgressionReport({ data, loading }: { data: SystemAdminAnalytics | null; loading: boolean }) {
  return <ReportCard title="Progression health" subtitle="Current progression reach and XP movement during the selected period."><Stack spacing={1.6}>{loading && !data ? <Skeleton variant="rectangular" height={180} /> : data?.progression.length ? data.progression.map((item) => <Stack key={item.key} direction="row" spacing={1.5} alignItems="center"><Box sx={{ width: 38, height: 38, display: 'grid', placeItems: 'center', borderRadius: 2, color: 'warning.main', bgcolor: 'rgba(244,201,93,.14)' }}><LeaderboardRoundedIcon fontSize="small" /></Box><Box sx={{ minWidth: 0, flex: 1 }}><Typography fontWeight={750}>{item.name}</Typography><Typography variant="caption" color="text.secondary">{fmt(item.players)} players · average {fmt(item.averagePoints)} points · top level {fmt(item.highestStep)}</Typography></Box><Chip size="small" color="success" variant="outlined" label={`+${fmt(item.periodDelta)} XP`} /></Stack>) : <EmptyState text="No progression records yet." />}</Stack></ReportCard>;
}

function EconomyReport({ data, loading }: { data: SystemAdminAnalytics | null; loading: boolean }) {
  const rows = data ? [['Credits issued', fmt(data.kpis.walletCredits), 'success'], ['Currency spent', fmt(data.kpis.walletDebits), 'warning'], ['Ad claims', fmt(data.economy.adClaims), 'info'], ['Granted ad claims', fmt(data.kpis.grantedAdClaims), 'info'], ['Paid reward requests', fmt(data.economy.paidRewardRequests), 'primary'], ['Fulfilled paid rewards', fmt(data.kpis.fulfilledPaidRewards), 'primary']] as const : [];
  return <ReportCard title="Economy and monetization" subtitle="Ledger-backed currency flow, ads, purchases, and paid reward fulfillment."><Stack spacing={1.2}>{loading && !data ? <Skeleton variant="rectangular" height={180} /> : rows.map(([label, value, color]) => <Stack key={label} direction="row" justifyContent="space-between" alignItems="center" sx={{ py: .65 }}><Stack direction="row" spacing={1} alignItems="center"><MonetizationOnRoundedIcon fontSize="small" color={color as 'success' | 'warning' | 'info' | 'primary'} /><Typography>{label}</Typography></Stack><Typography fontWeight={850}>{value}</Typography></Stack>)}{data && <Divider />}{data && <Stack direction="row" justifyContent="space-between" sx={{ pt: .5 }}><Typography color="text.secondary">Rejected ad claims</Typography><Typography color="error.main" fontWeight={800}>{fmt(data.economy.rejectedAdClaims)}</Typography></Stack>}{!data && !loading && <EmptyState text="No economy records yet." />}</Stack></ReportCard>;
}

function GameplayReport({ data, loading }: { data: SystemAdminAnalytics | null; loading: boolean }) {
  const rows = data ? [
    ['Average match duration', formatDuration(data.gameplay.averageMatchDurationSeconds)],
    ['Bot matches', fmt(data.gameplay.botMatches)],
    ['Draws', fmt(data.gameplay.drawMatches)],
    ['Review matches', fmt(data.gameplay.reviewMatches)],
    ['Cancelled matches', fmt(data.gameplay.cancelledMatches)],
    ['Average answer time', formatDuration(data.kpis.averageAnswerTimeMs / 1000)],
  ] as const : [];
  return <ReportCard title="Gameplay report" subtitle="Match pacing, bot coverage, and server review signals."><Stack spacing={1.15}>{loading && !data ? <Skeleton variant="rectangular" height={220} /> : rows.map(([label, value]) => <Stack key={label} direction="row" justifyContent="space-between" sx={{ py: .55 }}><Typography color="text.secondary">{label}</Typography><Typography fontWeight={850}>{value}</Typography></Stack>)}</Stack></ReportCard>;
}

function AudienceReport({ data, loading }: { data: SystemAdminAnalytics | null; loading: boolean }) {
  return <ReportCard title="Audience mix" subtitle="Active players by country and authenticated client type."><Stack spacing={2}>{loading && !data ? <Skeleton variant="rectangular" height={200} /> : <><Box><Typography variant="caption" color="text.secondary">Top active countries</Typography><Stack spacing={.8} sx={{ mt: 1 }}>{(data?.countries ?? []).slice(0, 5).map((item) => <Stack key={item.countryCode} direction="row" justifyContent="space-between"><Typography fontWeight={700}>{item.countryCode}</Typography><Typography color="text.secondary">{fmt(item.activeUsers)} active · {fmt(item.newPlayers)} new</Typography></Stack>)}</Stack></Box><Divider /><Box><Typography variant="caption" color="text.secondary">Session clients</Typography><Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>{(data?.devices ?? []).map((item) => <Chip key={item.type} size="small" variant="outlined" label={`${item.type} · ${fmt(item.users)} players`} />)}</Stack></Box></>}</Stack></ReportCard>;
}

function HealthReport({ data, loading }: { data: SystemAdminAnalytics | null; loading: boolean }) {
  const values = data ? [['Online now', data.health.onlinePlayers], ['Searching tickets', data.health.searchingTickets], ['Active matches', data.health.activeMatches], ['Failed outbox', data.health.failedOutbox], ['Open feedback', data.health.openFeedback]] as const : [];
  return <ReportCard title="Live game health" subtitle="Operational signals that explain whether players can play successfully."><Stack direction="row" flexWrap="wrap" useFlexGap spacing={1.2}>{loading && !data ? <Skeleton variant="rectangular" height={90} width="100%" /> : values.map(([label, value]) => <Card key={label} variant="outlined" sx={{ p: 1.6, flex: '1 1 150px', bgcolor: 'rgba(7,12,26,.22)' }}><Stack direction="row" spacing={1} alignItems="center"><AccessTimeRoundedIcon fontSize="small" color={label === 'Failed outbox' && value > 0 ? 'error' : 'success'} /><Typography variant="h6" fontWeight={850}>{fmt(value)}</Typography></Stack><Typography variant="caption" color="text.secondary">{label}</Typography></Card>)}</Stack><Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}><CheckCircleRoundedIcon color="success" fontSize="small" /><Typography variant="caption" color="text.secondary">Metrics are calculated from sessions, accepted events, settlements, ledgers, and durable admin records.</Typography></Stack></ReportCard>;
}

function EmptyState({ text }: { text: string }) { return <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>{text}</Typography>; }

function formatDuration(seconds: number) {
  if (!seconds || seconds < 0) return '—';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
