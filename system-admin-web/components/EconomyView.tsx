'use client';

import { useEffect, useState, type FormEvent } from 'react';

import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import Grid from '@mui/material/Grid2';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import type { CurrencyDefinition } from '../lib/types';

const valueOf = (form: HTMLFormElement, name: string) => String((form.elements.namedItem(name) as HTMLInputElement)?.value ?? '').trim();

function CurrencyDialog({ item, onClose, onSaved }: { item: CurrencyDefinition | null; onClose: () => void; onSaved: () => void }) {
  const create = !item;
  const [error, setError] = useState('');
  return <Dialog open maxWidth="sm" fullWidth onClose={onClose}>
    <DialogTitle>{create ? 'Create currency' : `Edit ${item.code}`}</DialogTitle>
    <form onSubmit={async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        setError('');
        const payload = { code: valueOf(form, 'code').toUpperCase(), name: valueOf(form, 'name'), kind: valueOf(form, 'kind'), precision: Number(valueOf(form, 'precision')), active: (form.elements.namedItem('active') as HTMLInputElement).checked };
        await api(create ? '/economy/currencies' : `/economy/currencies/${item.id}`, { method: create ? 'POST' : 'PATCH', body: JSON.stringify(payload) });
        onSaved();
      } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save currency'); }
    }}>
      <DialogContent><Stack spacing={2}>{error && <Typography color="error.main">{error}</Typography>}<Grid container spacing={2}><Grid size={{ xs: 12, sm: 6 }}><TextField name="code" label="Code" placeholder="MCN" defaultValue={item?.code ?? ''} required fullWidth size="small" disabled={!create} /></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField name="name" label="Display name" defaultValue={item?.name ?? ''} required fullWidth size="small" /></Grid><Grid size={{ xs: 12, sm: 6 }}><Select name="kind" defaultValue={item?.kind ?? 'SOFT'} fullWidth size="small"><MenuItem value="SOFT">Soft currency</MenuItem><MenuItem value="HARD">Hard currency</MenuItem><MenuItem value="PREMIUM">Premium currency</MenuItem><MenuItem value="EVENT">Event currency</MenuItem></Select></Grid><Grid size={{ xs: 12, sm: 6 }}><TextField name="precision" label="Decimal precision" type="number" inputProps={{ min: 0, max: 6 }} defaultValue={item?.precision ?? 0} required fullWidth size="small" /></Grid></Grid><FormControlLabel control={<Checkbox name="active" defaultChecked={item?.active ?? true} />} label="Available to players" /></Stack></DialogContent>
      <DialogActions><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="contained">{create ? 'Create currency' : 'Save changes'}</Button></DialogActions>
    </form>
  </Dialog>;
}

export function EconomyView() {
  const [currencies, setCurrencies] = useState<CurrencyDefinition[]>([]);
  const [selected, setSelected] = useState<CurrencyDefinition | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState('');
  const load = () => api<CurrencyDefinition[]>('/economy/currencies').then(setCurrencies).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load currencies'));
  useEffect(() => { load(); }, []);
  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2}><Box><Typography variant="h4" fontWeight={850}>Economy</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Currencies are definitions; balances change only through the transactional wallet ledger.</Typography></Box><Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => { setSelected(null); setDialogOpen(true); }}>Create currency</Button></Stack>
    {error && <Typography color="error.main">{error}</Typography>}
    <Grid container spacing={2}>{currencies.map((currency) => <Grid key={currency.id} size={{ xs: 12, sm: 6, lg: 4 }}><Card sx={{ p: 2.5, height: '100%' }}><Stack direction="row" justifyContent="space-between" alignItems="flex-start"><Box sx={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: 2.5, bgcolor: 'rgba(82,199,245,.14)', color: 'secondary.light' }}><AccountBalanceWalletRoundedIcon /></Box><Chip size="small" color={currency.active ? 'success' : 'warning'} label={currency.active ? 'ACTIVE' : 'INACTIVE'} /></Stack><Typography variant="h5" fontWeight={850} sx={{ mt: 2 }}>{currency.code}</Typography><Typography color="text.secondary">{currency.name} · {currency.kind}</Typography><Divider sx={{ my: 2 }} /><Stack direction="row" justifyContent="space-between"><Box><Typography variant="caption" color="text.secondary">Wallet balances</Typography><Typography fontWeight={750}>{currency._count?.balances ?? 0}</Typography></Box><Box><Typography variant="caption" color="text.secondary">Ledger entries</Typography><Typography fontWeight={750}>{currency._count?.transactions ?? 0}</Typography></Box><Button size="small" startIcon={<EditRoundedIcon />} onClick={() => { setSelected(currency); setDialogOpen(true); }}>Edit</Button></Stack></Card></Grid>)}</Grid>
    <Card><Box sx={{ p: { xs: 2.5, md: 3 } }}><Typography variant="h6" fontWeight={800}>Economy controls</Typography><Typography color="text.secondary" sx={{ mt: 1, maxWidth: 820, lineHeight: 1.7 }}>Use the player wallet panel to grant or debit a balance with a unique source ID. Every operation is idempotent, row-locked, and recorded with before-and-after balances. Corrections should be made with a reversal, never by editing ledger history.</Typography></Box></Card>
    {dialogOpen && <CurrencyDialog item={selected} onClose={() => setDialogOpen(false)} onSaved={() => { setDialogOpen(false); load(); }} />}
  </Stack>;
}
