'use client';

import { useEffect, useState } from 'react';

import AddRoundedIcon from '@mui/icons-material/AddRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import { UserSelector, type SelectableUser } from './UserSelector';
import { PlayerFileUploadDialog, PlayerStorageDialog, type StorageEntry } from './PlayerStorageDialogs';

type StorageUser = { id: string; username: string; email: string | null; profile: { displayName: string } | null };
type StorageFile = { id: string; originalName: string; contentType: string; byteSize: string; purpose: string; visibility: string; status: string; createdAt: string; user: StorageUser | null };
type StorageResponse = { storageItems: Array<StorageEntry & { user: StorageUser }>; files: StorageFile[]; pagination: { storageTotal: number; fileTotal: number } };
const userLabel = (user: StorageUser | null) => user ? `${user.profile?.displayName || user.username} · ${user.email || user.username}` : 'System upload';

export function StorageView() {
  const [tab, setTab] = useState(0);
  const [selectedUser, setSelectedUser] = useState<SelectableUser | null>(null);
  const [search, setSearch] = useState('');
  const [data, setData] = useState<StorageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [storageDialog, setStorageDialog] = useState<{ open: boolean; entry?: StorageEntry }>({ open: false });
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '100' });
    if (selectedUser?.id) params.set('userId', selectedUser.id);
    if (search.trim()) params.set('search', search.trim());
    api<StorageResponse>(`/storage?${params}`).then((body) => { setData(body); setError(''); }).catch((e) => setError(e instanceof Error ? e.message : 'Unable to load storage')).finally(() => setLoading(false));
  };
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [selectedUser?.id, search]);

  const removeEntry = async (entry: StorageEntry) => {
    const user = data?.storageItems.find((item) => item.id === entry.id)?.user;
    if (!user || !window.confirm(`Delete ${entry.key} for ${userLabel(user)}?`)) return;
    try { await api(`/users/${user.id}/storage/${encodeURIComponent(entry.key)}`, { method: 'DELETE' }); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete storage entry'); }
  };
  const removeFile = async (file: StorageFile) => {
    if (!window.confirm(`Delete ${file.originalName}?`)) return;
    try { await api(file.user ? `/users/${file.user.id}/files/${file.id}` : `/files/${file.id}`, { method: 'DELETE' }); load(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to delete file'); }
  };
  const openFile = async (file: StorageFile) => {
    try { const body = await api<{ url: string }>(file.user ? `/users/${file.user.id}/files/${file.id}/url` : `/files/${file.id}/url`); window.open(body.url, '_blank', 'noopener,noreferrer'); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to open file'); }
  };

  return <Stack spacing={3}>
    <Stack direction={{ xs: 'column', lg: 'row' }} justifyContent="space-between" spacing={2}><Box><Typography variant="h4" fontWeight={850}>Storage & files</Typography><Typography color="text.secondary" sx={{ mt: .7 }}>Manage allowlisted player storage and S3-backed files with a player filter.</Typography></Box><Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}><Button variant="outlined" startIcon={<AddRoundedIcon />} disabled={!selectedUser} onClick={() => setStorageDialog({ open: true })}>Add storage entry</Button><Button variant="contained" startIcon={<CloudUploadRoundedIcon />} disabled={!selectedUser} onClick={() => setUploadOpen(true)}>Upload player file</Button></Stack></Stack>
    {error && <Typography color="error.main">{error}</Typography>}
    <Card><Stack spacing={2} sx={{ p: 2.5 }}><UserSelector value={selectedUser} onChange={setSelectedUser} label="Filter by player" /><TextField size="small" fullWidth placeholder="Search users, keys, values, file names, or purposes" value={search} onChange={(event) => setSearch(event.target.value)} InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }} /></Stack><Divider /><Tabs value={tab} onChange={(_, value) => setTab(value)}><Tab icon={<FolderRoundedIcon fontSize="small" />} iconPosition="start" label={`Storage entries · ${data?.pagination.storageTotal ?? 0}`} /><Tab icon={<DescriptionRoundedIcon fontSize="small" />} iconPosition="start" label={`Files · ${data?.pagination.fileTotal ?? 0}`} /></Tabs><Divider />{loading ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress size={28} /></Stack> : tab === 0 ? <Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Player</TableCell><TableCell>Key</TableCell><TableCell>Value</TableCell><TableCell>Visibility</TableCell><TableCell>Updated</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>{!data?.storageItems.length ? <TableRow><TableCell colSpan={6} align="center" sx={{ py: 8 }}><Typography color="text.secondary">No storage entries match this filter.</Typography></TableCell></TableRow> : data.storageItems.map((entry) => <TableRow key={entry.id} hover><TableCell><Typography fontWeight={700}>{userLabel(entry.user)}</Typography><Typography variant="caption" color="text.secondary">{entry.user.username}</Typography></TableCell><TableCell><Typography fontWeight={700}>{entry.key}</Typography><Typography variant="caption" color="text.secondary">{entry.valueType} · v{entry.version}</Typography></TableCell><TableCell sx={{ maxWidth: 280 }}><Typography noWrap>{entry.value}</Typography></TableCell><TableCell><Chip size="small" label={entry.visibility} color={entry.visibility === 'PUBLIC' ? 'info' : 'default'} /></TableCell><TableCell>{new Date(entry.updatedAt).toLocaleString()}</TableCell><TableCell align="right"><Button size="small" onClick={() => setStorageDialog({ open: true, entry })}>Edit</Button><Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => removeEntry(entry)}>Delete</Button></TableCell></TableRow>)}</TableBody></Table></Box> : <Box sx={{ overflowX: 'auto' }}><Table><TableHead><TableRow><TableCell>Player</TableCell><TableCell>File</TableCell><TableCell>Purpose</TableCell><TableCell>Access</TableCell><TableCell>Uploaded</TableCell><TableCell align="right">Actions</TableCell></TableRow></TableHead><TableBody>{!data?.files.length ? <TableRow><TableCell colSpan={6} align="center" sx={{ py: 8 }}><Typography color="text.secondary">No files match this filter.</Typography></TableCell></TableRow> : data.files.map((file) => <TableRow key={file.id} hover><TableCell>{userLabel(file.user)}</TableCell><TableCell><Typography fontWeight={700}>{file.originalName}</Typography><Typography variant="caption" color="text.secondary">{file.contentType} · {file.byteSize} bytes</Typography></TableCell><TableCell>{file.purpose}</TableCell><TableCell><Chip size="small" label={file.status === 'ACTIVE' ? file.visibility : file.status} color={file.status === 'ACTIVE' ? 'success' : 'default'} /></TableCell><TableCell>{new Date(file.createdAt).toLocaleString()}</TableCell><TableCell align="right"><Button size="small" onClick={() => openFile(file)}>Open</Button><Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} onClick={() => removeFile(file)}>Delete</Button></TableCell></TableRow>)}</TableBody></Table></Box>}</Card>
    {storageDialog.open && selectedUser && <PlayerStorageDialog userId={selectedUser.id} entry={storageDialog.entry} onClose={() => setStorageDialog({ open: false })} onSaved={() => { setStorageDialog({ open: false }); load(); }} />}
    {uploadOpen && selectedUser && <PlayerFileUploadDialog userId={selectedUser.id} onClose={() => setUploadOpen(false)} onSaved={() => { setUploadOpen(false); load(); }} />}
  </Stack>;
}
