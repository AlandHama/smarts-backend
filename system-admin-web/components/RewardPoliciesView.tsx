'use client';

import { useEffect, useState, type FormEvent } from 'react';

import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';

type PrivateConfig = { allowedProviders?: string[]; allowedAdFormats?: string[]; currencyCode?: string; dailyCap?: number; cooldownSeconds?: number; rewards?: Record<string, { amount?: string }> };
type Policy = { id: string; key: string; version: number; active: boolean; publicConfig: Record<string, unknown>; privateConfig: PrivateConfig; createdAt: string };
type Claim = { id: string; provider: string; adFormat: string; status: string; rewardAmount: string | null; countryCode: string | null; createdAt: string; user: { id: string; username: string; email: string | null; profile: { displayName: string } | null }; currency: { code: string } | null };

const emptyForm = { provider: 'admob', adFormat: 'rewarded', currencyCode: 'GLD', amount: '10', dailyCap: '20', cooldownSeconds: '30' };

export function RewardPoliciesView({ onOpenPlayer360 }: { onOpenPlayer360?: (userId: string) => void }) {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Policy | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    Promise.all([api<Policy[]>('/reward-policies'), api<Claim[]>('/ad-rewards/claims')]).then(([nextPolicies, nextClaims]) => { setPolicies(nextPolicies); setClaims(nextClaims); }).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load reward policies')).finally(() => setLoading(false));
  };
  useEffect(() => { void load(); }, []);

  const edit = (policy: Policy) => {
    const config = policy.privateConfig || {};
    const format = config.allowedAdFormats?.[0] || Object.keys(config.rewards || {})[0] || 'rewarded';
    setEditing(policy);
    setForm({ provider: config.allowedProviders?.[0] || 'admob', adFormat: format, currencyCode: config.currencyCode || 'GLD', amount: config.rewards?.[format]?.amount || '10', dailyCap: String(config.dailyCap ?? 20), cooldownSeconds: String(config.cooldownSeconds ?? 30) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setError(''); setMessage('');
      await api('/reward-policies', { method: 'POST', body: JSON.stringify({ key: 'ad-reward', publicConfig: { provider: form.provider, adFormats: [form.adFormat] }, privateConfig: { allowedProviders: [form.provider], allowedAdFormats: [form.adFormat], currencyCode: form.currencyCode.toUpperCase(), dailyCap: Number(form.dailyCap), cooldownSeconds: Number(form.cooldownSeconds), rewards: { [form.adFormat]: { amount: form.amount } } } }) });
      setEditing(null); setMessage('Ad reward policy published. New claims use the new version.'); setForm(emptyForm); load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to publish policy'); }
  };

  const deactivate = async (policy: Policy) => {
    if (!window.confirm(`Deactivate ${policy.key}? Its version history will be retained.`)) return;
    try { setError(''); await api(`/reward-policies/${encodeURIComponent(policy.key)}`, { method: 'DELETE' }); setMessage(`${policy.key} deactivated.`); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to deactivate policy'); }
  };

  const value = (name: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm((current) => ({ ...current, [name]: event.target.value }));
  const policyDetails = (policy: Policy) => { const config = policy.privateConfig || {}; const format = config.allowedAdFormats?.[0] || Object.keys(config.rewards || {})[0] || '—'; return { provider: config.allowedProviders?.[0] || '—', format, currency: config.currencyCode || '—', amount: config.rewards?.[format]?.amount || '—', cap: config.dailyCap ?? '—', cooldown: config.cooldownSeconds ?? '—' }; };
  const label = (claim: Claim) => claim.user.profile?.displayName || claim.user.username;

  return <Stack spacing={3}><Box><Typography variant="h4" fontWeight={850}>Reward policies</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Inspect every published policy version, edit by publishing a new immutable version, and deactivate policies without losing audit history.</Typography></Box>{error && <Typography color="error.main">{error}</Typography>}{message && <Typography color="success.main">{message}</Typography>}<Card><form onSubmit={publish}><Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}><Box><Stack direction="row" spacing={1} alignItems="center"><SecurityRoundedIcon color="primary" /><Typography variant="h6" fontWeight={800}>{editing ? `Edit ${editing.key} · publish new version` : 'Publish ad reward policy'}</Typography></Stack><Typography variant="body2" color="text.secondary" sx={{ mt: .7 }}>Amounts, caps, cooldowns, and regional rules remain server-side. Keep <code>AD_REWARD_WEBHOOK_SECRET</code> only in Railway.</Typography></Box>{editing && <Button size="small" onClick={() => { setEditing(null); setForm(emptyForm); }}>Cancel edit</Button>}</Stack><Grid container spacing={2}><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required size="small" label="Provider" value={form.provider} onChange={value('provider')} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required size="small" label="Ad format" value={form.adFormat} onChange={value('adFormat')} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required size="small" label="Reward currency" value={form.currencyCode} onChange={value('currencyCode')} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required size="small" label="Reward amount" value={form.amount} onChange={value('amount')} inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required type="number" size="small" label="Daily claim cap" value={form.dailyCap} onChange={value('dailyCap')} /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required type="number" size="small" label="Cooldown seconds" value={form.cooldownSeconds} onChange={value('cooldownSeconds')} /></Grid></Grid><Button type="submit" variant="contained" startIcon={<AddCircleOutlineRoundedIcon />} sx={{ alignSelf: 'flex-end' }}>{editing ? 'Publish edited version' : 'Publish version'}</Button></Stack></form></Card><Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}><Box><Typography variant="h6" fontWeight={800}>Published policy versions</Typography><Typography variant="body2" color="text.secondary">The active version is used for new server decisions. Previous versions remain auditable.</Typography></Box><Chip label={`${policies.length} versions`} variant="outlined" /></Stack><Divider />{loading ? <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={28} /></Stack> : <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Policy</TableCell><TableCell>Delivery</TableCell><TableCell>Reward</TableCell><TableCell>Limits</TableCell><TableCell>Published</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>{policies.length ? policies.map((policy) => { const details = policyDetails(policy); return <TableRow key={policy.id} hover><TableCell><Typography fontWeight={800}>{policy.key}</Typography><Typography variant="caption" color="text.secondary">Version {policy.version}</Typography></TableCell><TableCell><Typography fontWeight={700}>{details.provider}</Typography><Typography variant="caption" color="text.secondary">{details.format}</Typography></TableCell><TableCell><Typography fontWeight={800}>{details.amount} {details.currency}</Typography><Typography variant="caption" color="text.secondary">server-authoritative</Typography></TableCell><TableCell><Typography variant="body2">{details.cap} per day</Typography><Typography variant="caption" color="text.secondary">{details.cooldown}s cooldown</Typography></TableCell><TableCell><Typography variant="body2">{new Date(policy.createdAt).toLocaleString()}</Typography><Chip size="small" label={policy.active ? 'ACTIVE' : 'INACTIVE'} color={policy.active ? 'success' : 'default'} variant="outlined" sx={{ mt: .5 }} /></TableCell><TableCell align="right"><Stack direction="row" justifyContent="flex-end" spacing={.5}>{policy.key === 'ad-reward' && <Tooltip title="Edit by publishing a new version"><IconButton size="small" color="primary" onClick={() => edit(policy)}><EditRoundedIcon fontSize="small" /></IconButton></Tooltip>}{policy.active && <Tooltip title="Deactivate policy"><IconButton size="small" color="error" onClick={() => deactivate(policy)}><DeleteOutlineRoundedIcon fontSize="small" /></IconButton></Tooltip>}</Stack></TableCell></TableRow>; }) : <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6 }}><Typography color="text.secondary">No policies published.</Typography></TableCell></TableRow>}</TableBody></Table></TableContainer>}</Stack></Card><Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 4 } }}><Box><Typography variant="h6" fontWeight={800}>Recent ad claims</Typography><Typography variant="body2" color="text.secondary">Each row is linked to the player account that received or attempted the reward.</Typography></Box><Divider />{claims.length ? <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Player</TableCell><TableCell>Placement</TableCell><TableCell>Result</TableCell><TableCell>Reward</TableCell><TableCell>Country</TableCell><TableCell>Claimed</TableCell></TableRow></TableHead><TableBody>{claims.slice(0, 100).map((claim) => <TableRow key={claim.id} hover><TableCell><Button variant="text" size="small" color="primary" endIcon={<OpenInNewRoundedIcon fontSize="inherit" />} onClick={() => onOpenPlayer360?.(claim.user.id)} sx={{ justifyContent: 'flex-start', p: 0, textTransform: 'none', fontWeight: 800 }}>{label(claim)}</Button><Typography variant="caption" display="block" color="text.secondary" sx={{ pl: 1 }}>{claim.user.email || `@${claim.user.username}`}</Typography></TableCell><TableCell><Typography fontWeight={700}>{claim.provider}</Typography><Typography variant="caption" color="text.secondary">{claim.adFormat}</Typography></TableCell><TableCell><Chip size="small" label={claim.status} color={claim.status === 'GRANTED' ? 'success' : claim.status === 'REJECTED' ? 'error' : 'default'} /></TableCell><TableCell>{claim.rewardAmount ? `${claim.rewardAmount} ${claim.currency?.code || ''}` : '—'}</TableCell><TableCell>{claim.countryCode || '—'}</TableCell><TableCell>{new Date(claim.createdAt).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></TableContainer> : <Typography color="text.secondary">No ad claims yet.</Typography>}</Stack></Card></Stack>;
}
