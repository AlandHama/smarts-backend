'use client';

import { useState, type FormEvent, type ReactNode } from 'react';

import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { api, uploadFile } from '../lib/api';

export type StorageEntry = { id: string; key: string; value: string; visibility: string; valueType: string; version: number; updatedAt: string };

const valueOf = (form: HTMLFormElement, name: string) => String((form.elements.namedItem(name) as HTMLInputElement)?.value ?? '').trim();

export function PlayerStorageDialog({ userId, entry, onClose, onSaved }: { userId: string; entry?: StorageEntry; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState('');
  return <Dialog open fullWidth maxWidth="sm" onClose={onClose}><DialogTitle><Stack direction="row" justifyContent="space-between" alignItems="center"><BoxTitle>{entry ? 'Edit storage entry' : 'Add storage entry'}</BoxTitle><IconButton onClick={onClose}><CloseRoundedIcon /></IconButton></Stack><Typography variant="body2" color="text.secondary">Only approved player keys can be stored. Updates are versioned and transactional.</Typography></DialogTitle><DialogContent><form onSubmit={async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); try { setError(''); await api(`/users/${userId}/storage`, { method: 'POST', body: JSON.stringify({ payload: [{ key: valueOf(event.currentTarget, 'key'), value: valueOf(event.currentTarget, 'value'), isPublic: valueOf(event.currentTarget, 'visibility') === 'PUBLIC' }] }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save storage entry'); } }}><Stack spacing={2.2} sx={{ pt: 1 }}><TextField name="key" label="Storage key" defaultValue={entry?.key ?? ''} disabled={Boolean(entry)} required helperText="Examples: player_country, profile_url, player_games_played" /><TextField name="value" label="Value" defaultValue={entry?.value ?? ''} required multiline minRows={3} /><Select name="visibility" defaultValue={entry?.visibility ?? 'PRIVATE'} fullWidth><MenuItem value="PRIVATE">Private</MenuItem><MenuItem value="PUBLIC">Public</MenuItem></Select>{error && <Typography color="error.main">{error}</Typography>}<Button type="submit" variant="contained">{entry ? 'Save entry' : 'Add entry'}</Button></Stack></form></DialogContent></Dialog>;
}

function BoxTitle({ children }: { children: ReactNode }) { return <Typography variant="h6" fontWeight={800}>{children}</Typography>; }

export function PlayerFileUploadDialog({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [purpose, setPurpose] = useState('player-file');
  const [visibility, setVisibility] = useState<'PRIVATE' | 'PUBLIC'>('PRIVATE');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return <Dialog open fullWidth maxWidth="sm" onClose={onClose}><DialogTitle><Stack direction="row" justifyContent="space-between" alignItems="center"><BoxTitle>Upload player file</BoxTitle><IconButton onClick={onClose}><CloseRoundedIcon /></IconButton></Stack><Typography variant="body2" color="text.secondary">Files are placed in the player folder in S3 and tracked with an owned database reference.</Typography></DialogTitle><DialogContent><Stack spacing={2.2} sx={{ pt: 1 }}><Button component="label" variant="outlined" startIcon={<CloudUploadRoundedIcon />} sx={{ justifyContent: 'flex-start' }}>{file ? file.name : 'Choose image file'}<input hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Button><TextField label="Purpose / folder" value={purpose} onChange={(event) => setPurpose(event.target.value)} required helperText="For example: player-file or player-avatar" /><Select value={visibility} onChange={(event) => setVisibility(event.target.value as 'PRIVATE' | 'PUBLIC')} fullWidth><MenuItem value="PRIVATE">Private signed file</MenuItem><MenuItem value="PUBLIC">Public file</MenuItem></Select>{error && <Typography color="error.main">{error}</Typography>}<Button variant="contained" disabled={!file || saving} onClick={async () => { if (!file) return; try { setSaving(true); setError(''); await uploadFile(`/users/${userId}/files`, file, purpose, visibility); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to upload file'); } finally { setSaving(false); } }}>{saving ? 'Uploading…' : 'Upload file'}</Button></Stack></DialogContent></Dialog>;
}
