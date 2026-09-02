'use client';

import { useEffect, useState, type FormEvent } from 'react';

import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';

type Policy = { id: string; key: string; version: number; active: boolean; publicConfig: Record<string, unknown>; createdAt: string };
type Claim = { id: string; provider: string; adFormat: string; status: string; rewardAmount: string | null; countryCode: string | null; createdAt: string; user: { username: string; email: string | null; profile: { displayName: string } | null }; currency: { code: string } | null };

export function RewardPoliciesView() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const load = () => Promise.all([api<Policy[]>('/reward-policies'), api<Claim[]>('/ad-rewards/claims')]).then(([nextPolicies, nextClaims]) => { setPolicies(nextPolicies); setClaims(nextClaims); }).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load reward policies'));
  useEffect(() => { void load(); }, []);
  const publish = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = (name: string) => String((form.elements.namedItem(name) as HTMLInputElement)?.value ?? '').trim();
    try {
      setError(''); setMessage('');
      await api('/reward-policies', { method: 'POST', body: JSON.stringify({ key: 'ad-reward', publicConfig: { provider: value('provider'), adFormats: [value('adFormat')] }, privateConfig: { allowedProviders: [value('provider')], allowedAdFormats: [value('adFormat')], currencyCode: value('currencyCode').toUpperCase(), dailyCap: Number(value('dailyCap')), cooldownSeconds: Number(value('cooldownSeconds')), rewards: { [value('adFormat')]: { amount: value('amount') } } } }) });
      setMessage('Ad reward policy published. New claims use the new version.'); await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to publish policy'); }
  };
  return <Stack spacing={3}><Box><Typography variant="h4" fontWeight={850}>Reward policies</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Publish server-owned ad rewards and inspect verification claims. Amounts and caps never come from the mobile client.</Typography></Box>{error && <Typography color="error.main">{error}</Typography>}{message && <Typography color="success.main">{message}</Typography>}<Card><form onSubmit={publish}><Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 4 } }}><Stack direction="row" spacing={1} alignItems="center"><SecurityRoundedIcon color="primary" /><Typography variant="h6" fontWeight={800}>Publish ad reward policy</Typography></Stack><Typography variant="body2" color="text.secondary">Publishing creates an immutable version. Keep the webhook secret in Railway as <code>AD_REWARD_WEBHOOK_SECRET</code>; it is never stored in this form.</Typography><Grid container spacing={2}><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required size="small" name="provider" label="Provider" defaultValue="admob" /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required size="small" name="adFormat" label="Ad format" defaultValue="rewarded" /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required size="small" name="currencyCode" label="Reward currency" defaultValue="GLD" /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required size="small" name="amount" label="Reward amount" inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }} defaultValue="10" /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required type="number" size="small" name="dailyCap" label="Daily claim cap" defaultValue="20" /></Grid><Grid size={{ xs: 12, sm: 4 }}><TextField fullWidth required type="number" size="small" name="cooldownSeconds" label="Cooldown seconds" defaultValue="30" /></Grid></Grid><Button type="submit" variant="contained" startIcon={<AddCircleOutlineRoundedIcon />} sx={{ alignSelf: 'flex-end' }}>Publish version</Button></Stack></form></Card><Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 4 } }}><Typography variant="h6" fontWeight={800}>Published versions</Typography><Divider />{policies.length ? policies.map((policy) => <Stack key={policy.id} direction="row" justifyContent="space-between" alignItems="center"><Box><Typography fontWeight={750}>{policy.key}</Typography><Typography variant="caption" color="text.secondary">Published {new Date(policy.createdAt).toLocaleString()}</Typography></Box><Chip label={`v${policy.version}${policy.active ? ' · ACTIVE' : ''}`} color={policy.active ? 'success' : 'default'} variant="outlined" /></Stack>) : <Typography color="text.secondary">No policies published.</Typography>}</Stack></Card><Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 4 } }}><Typography variant="h6" fontWeight={800}>Recent ad claims</Typography><Divider />{claims.length ? claims.slice(0, 20).map((claim) => <Stack key={claim.id} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}><Box><Typography fontWeight={700}>{claim.user.profile?.displayName || claim.user.username}</Typography><Typography variant="caption" color="text.secondary">{claim.provider} · {claim.adFormat} · {new Date(claim.createdAt).toLocaleString()}</Typography></Box><Stack direction="row" spacing={1}><Chip size="small" label={claim.status} color={claim.status === 'GRANTED' ? 'success' : claim.status === 'REJECTED' ? 'error' : 'default'} /><Typography sx={{ pt: .5 }}>{claim.rewardAmount ? `${claim.rewardAmount} ${claim.currency?.code || ''}` : '—'}</Typography></Stack></Stack>) : <Typography color="text.secondary">No ad claims yet.</Typography>}</Stack></Card></Stack>;
}
