'use client';

import { useEffect, useState } from 'react';

import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import SystemUpdateAltRoundedIcon from '@mui/icons-material/SystemUpdateAltRounded';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';

type AppConfiguration = {
  productionVersion: string;
  developmentVersion: string;
  playStoreUrl: string;
};

const defaults: AppConfiguration = {
  productionVersion: '1.0.0',
  developmentVersion: '1.0.0',
  playStoreUrl: 'https://play.google.com/store/apps/details?id=com.pheonix.gaemverse',
};

export function AppConfigurationView() {
  const [config, setConfig] = useState<AppConfiguration>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<AppConfiguration>('/app-config')
      .then((value) => setConfig({ ...defaults, ...value }))
      .catch((e) => setError(e instanceof Error ? e.message : 'Unable to load app configuration'))
      .finally(() => setLoading(false));
  }, []);

  const update = (key: keyof AppConfiguration, value: string) =>
    setConfig((current) => ({ ...current, [key]: value }));

  const save = async () => {
    try {
      setSaving(true);
      setError('');
      const saved = await api<AppConfiguration>('/app-config', {
        method: 'PUT',
        body: JSON.stringify(config),
      });
      setConfig({ ...defaults, ...saved });
      setMessage('App update policy saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save app configuration');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" fontWeight={850}>App configuration</Typography>
        <Typography color="text.secondary" sx={{ mt: .7 }}>
          Control the minimum mobile version and the store destination used by the mandatory update screen.
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="success">{message}</Alert>}
      <Card>
        <Stack spacing={3} sx={{ p: { xs: 2.5, md: 4 } }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <SystemUpdateAltRoundedIcon color="primary" />
            <Box>
              <Typography variant="h6" fontWeight={800}>Version enforcement</Typography>
              <Typography variant="body2" color="text.secondary">
                Debug builds skip this check. Release builds use production; profile builds use development.
              </Typography>
            </Box>
          </Stack>
          <TextField label="Production minimum version" value={config.productionVersion} onChange={(e) => update('productionVersion', e.target.value)} helperText="Example: 1.0.50" disabled={loading || saving} />
          <TextField label="Development minimum version" value={config.developmentVersion} onChange={(e) => update('developmentVersion', e.target.value)} helperText="Used by profile/non-debug builds." disabled={loading || saving} />
          <TextField label="Play Store URL" value={config.playStoreUrl} onChange={(e) => update('playStoreUrl', e.target.value)} disabled={loading || saving} />
          <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={save} disabled={loading || saving} sx={{ alignSelf: 'flex-end' }}>
            {saving ? 'Saving…' : 'Save policy'}
          </Button>
        </Stack>
      </Card>
    </Stack>
  );
}
