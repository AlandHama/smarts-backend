'use client';

import { useState } from 'react';

import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import GroupAddRoundedIcon from '@mui/icons-material/GroupAddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { api } from '../lib/api';
import { UserSelector, type SelectableUser } from './UserSelector';

type ExistingFriend = { id: string; name: string };

export function AdminFriendDialog({
  fixedUser,
  existingFriends = [],
  onClose,
  onSaved,
}: {
  fixedUser?: SelectableUser;
  existingFriends?: ExistingFriend[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [first, setFirst] = useState<SelectableUser | null>(fixedUser ?? null);
  const [second, setSecond] = useState<SelectableUser | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const makeFriends = async () => {
    if (!first || !second) {
      setError('Select both players.');
      return;
    }
    if (first.id === second.id) {
      setError('Select two different players.');
      return;
    }
    try {
      setSaving(true);
      setError('');
      await api(`/friends/${first.id}/${second.id}`, { method: 'POST' });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to make the players friends');
    } finally {
      setSaving(false);
    }
  };

  const removeFriend = async (friend: ExistingFriend) => {
    if (!fixedUser || !window.confirm(`Remove ${friend.name} from this player's friends?`)) return;
    try {
      setSaving(true);
      setError('');
      await api(`/friends/${fixedUser.id}/${friend.id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to remove the friendship');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open maxWidth="sm" fullWidth onClose={onClose}>
      <DialogTitle sx={{ pr: 7 }}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <GroupAddRoundedIcon color="primary" />
          <span>{fixedUser ? 'Manage friendships' : 'Make players friends'}</span>
        </Stack>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}>
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.2}>
          <Typography variant="body2" color="text.secondary">
            This creates an accepted relationship immediately and updates both players atomically.
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <UserSelector value={first} onChange={setFirst} label="First player" required disabled={Boolean(fixedUser)} />
          <UserSelector value={second} onChange={setSecond} label="Second player" required />
          {fixedUser && existingFriends.length > 0 && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">Current friends</Typography>
              {existingFriends.map((friend) => (
                <Stack key={friend.id} direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.5, py: 1, borderRadius: 1.5, bgcolor: 'action.hover' }}>
                  <Typography variant="body2">{friend.name}</Typography>
                  <Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} disabled={saving} onClick={() => void removeFriend(friend)}>
                    Unfriend
                  </Button>
                </Stack>
              ))}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={saving} onClick={() => void makeFriends()} startIcon={<GroupAddRoundedIcon />}>
          Make friends
        </Button>
      </DialogActions>
    </Dialog>
  );
}
