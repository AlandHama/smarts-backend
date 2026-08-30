'use client';

import { useState } from 'react';

import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

export function LoginView({ onLogin }: { onLogin: (identifier: string, password: string) => Promise<void> }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3, background: 'radial-gradient(circle at 75% 15%, rgba(93,84,201,.5), transparent 36%), #0b1020' }}>
    <Box sx={{ width: 'min(1080px, 100%)', display: { xs: 'block', md: 'grid' }, gridTemplateColumns: '1fr 440px', gap: 5, alignItems: 'center' }}>
      <Box sx={{ display: { xs: 'none', md: 'block' }, px: 3 }}><Typography variant="overline" color="primary.light" sx={{ letterSpacing: '.2em' }}>SMARTS PLATFORM</Typography><Typography variant="h2" sx={{ mt: 2, lineHeight: 1.05, maxWidth: 620 }}>One calm place to run the player economy.</Typography><Typography variant="h6" color="text.secondary" fontWeight={400} sx={{ mt: 3, maxWidth: 520, lineHeight: 1.6 }}>Manage player access, progression policies, wallets, and auditable rewards from one protected workspace.</Typography><Stack direction="row" spacing={1} sx={{ mt: 5 }}><Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} /><Typography variant="body2" color="text.secondary">Server-authoritative · UUID secured · Railway hosted</Typography></Stack></Box>
      <Card sx={{ p: { xs: 3, sm: 5 }, borderRadius: 4, boxShadow: '0 30px 100px rgba(0,0,0,.35)' }}><Stack spacing={3}><Stack direction="row" spacing={1.5} alignItems="center"><Box sx={{ width: 48, height: 48, borderRadius: 3, display: 'grid', placeItems: 'center', color: '#fff', bgcolor: 'primary.main' }}><LockRoundedIcon /></Box><Box><Typography fontWeight={800}>SMARTS</Typography><Typography variant="caption" color="text.secondary">System administration</Typography></Box></Stack><Box><Typography variant="h4" fontWeight={800}>Welcome back</Typography><Typography color="text.secondary" sx={{ mt: 1 }}>Sign in to manage player access and game systems.</Typography></Box>{error && <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: 'rgba(255,113,128,.12)', border: '1px solid rgba(255,113,128,.35)', color: 'error.light' }}>{error}</Box>}<form onSubmit={async (event) => { event.preventDefault(); setLoading(true); setError(''); try { await onLogin(identifier, password); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign in'); } finally { setLoading(false); } }}><Stack spacing={2.5}><TextField label="Username or email" value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required fullWidth /><TextField label="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required fullWidth /><Button type="submit" size="large" variant="contained" endIcon={loading ? <CircularProgress size={18} color="inherit" /> : <ArrowForwardRoundedIcon />} disabled={loading} sx={{ py: 1.5 }}>Sign in to console</Button></Stack></form><Typography variant="caption" color="text.secondary" textAlign="center">Access is restricted to system administrators.</Typography></Stack></Card>
    </Box>
  </Box>;
}

