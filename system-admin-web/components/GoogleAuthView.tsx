'use client';

import { useEffect, useState } from 'react';

import LoginRoundedIcon from '@mui/icons-material/LoginRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid2';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';

type GoogleAuthConfig = {
  enabled: boolean;
  webClientId: string | null;
  androidClientId: string | null;
  iosClientId: string | null;
  desktopClientId: string | null;
  packageName: string | null;
};

const emptyConfig: GoogleAuthConfig = {
  enabled: false,
  webClientId: '',
  androidClientId: '',
  iosClientId: '',
  desktopClientId: '',
  packageName: 'com.pheonix.gaemverse',
};

export function GoogleAuthView() {
  const [config, setConfig] = useState<GoogleAuthConfig>(emptyConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<GoogleAuthConfig | null>('/google-auth')
      .then((value) => setConfig({ ...emptyConfig, ...(value || {}) }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load Google settings'))
      .finally(() => setLoading(false));
  }, []);

  const update = (key: keyof GoogleAuthConfig, value: string | boolean) =>
    setConfig((current) => ({ ...current, [key]: value }));

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      const saved = await api<GoogleAuthConfig>('/google-auth', {
        method: 'PATCH',
        body: JSON.stringify(config),
      });
      setConfig({ ...emptyConfig, ...saved });
      setMessage('Google Sign-In settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save Google settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" fontWeight={850}>Google Sign-In</Typography>
        <Typography color="text.secondary" sx={{ mt: .7 }}>
          Configure the OAuth client IDs accepted by Railway when the mobile app sends a Google ID token.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}
      <Card>
        <Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Stack direction="row" spacing={1.5} alignItems="center">
              <LoginRoundedIcon color="primary" />
              <Box>
                <Typography variant="h6" fontWeight={800}>Mobile Google authentication</Typography>
                <Typography variant="body2" color="text.secondary">Changes apply to new login attempts.</Typography>
              </Box>
            </Stack>
            <Switch checked={config.enabled} onChange={(event) => update('enabled', event.target.checked)} disabled={loading || saving} />
          </Stack>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth label="Web / server OAuth 2.0 Client ID" value={config.webClientId || ''} onChange={(event) => update('webClientId', event.target.value)} helperText="Preferred serverClientId for the Flutter Google SDK and accepted token audience." disabled={loading || saving} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="Android application Client ID" value={config.androidClientId || ''} onChange={(event) => update('androidClientId', event.target.value)} disabled={loading || saving} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="iOS application Client ID" value={config.iosClientId || ''} onChange={(event) => update('iosClientId', event.target.value)} disabled={loading || saving} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="Desktop application Client ID" value={config.desktopClientId || ''} onChange={(event) => update('desktopClientId', event.target.value)} disabled={loading || saving} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="Android package name" value={config.packageName || ''} onChange={(event) => update('packageName', event.target.value)} helperText="Current app package: com.pheonix.gaemverse" disabled={loading || saving} />
            </Grid>
          </Grid>
          <Alert severity="info">
            Enter client IDs only. Google client secrets and the Play Store service account from the old LootLocker screen must stay in provider/deployment secrets and are not used for ID-token login.
          </Alert>
          <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={save} disabled={loading || saving} sx={{ alignSelf: 'flex-end' }}>
            {saving ? 'Saving…' : 'Save settings'}
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}
