"use client";

import { useEffect, useState } from "react";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";

type SocialGift = {
  id: string;
  key: string;
  name: string;
  icon: string | null;
  description: string | null;
  imageUrl: string | null;
  priceGld: string;
  recipientRewardPercent: number;
  active: boolean;
  sortOrder: number;
};

const emptyGift = {
  key: "",
  name: "",
  icon: "🎁",
  description: "",
  imageUrl: "",
  priceGld: "5",
  recipientRewardPercent: "50",
  sortOrder: "0",
  active: true,
};

export function SocialGiftsView() {
  const [gifts, setGifts] = useState<SocialGift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<SocialGift | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyGift);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      setGifts(await api<SocialGift[]>("/social-gifts"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load social gifts");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const open = (gift?: SocialGift) => {
    setDialogOpen(true);
    setEditing(gift ?? null);
    setForm(gift ? {
      key: gift.key,
      name: gift.name,
      icon: gift.icon ?? "",
      description: gift.description ?? "",
      imageUrl: gift.imageUrl ?? "",
      priceGld: gift.priceGld,
      recipientRewardPercent: String(gift.recipientRewardPercent),
      sortOrder: String(gift.sortOrder),
      active: gift.active,
    } : { ...emptyGift });
    setMessage("");
    setError("");
  };

  const update = (key: keyof typeof emptyGift, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = async () => {
    try {
      setSaving(true);
      setError("");
      await api<SocialGift>(editing ? `/social-gifts/${editing.id}` : "/social-gifts", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          priceGld: form.priceGld.trim(),
          recipientRewardPercent: Number(form.recipientRewardPercent),
          sortOrder: Number(form.sortOrder),
        }),
      });
      setEditing(null);
      setDialogOpen(false);
      setMessage("Social gift saved.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save social gift");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Stack direction={{ xs: "column", sm: "row" }} justifyContent="space-between" spacing={2}>
        <div>
          <Typography variant="h4" fontWeight={850}>Social gifts</Typography>
          <Typography color="text.secondary" sx={{ mt: .7 }}>
            Configure the independent Rose, Diamond, Crown and other player-to-player gifts.
            The sender pays the price; the configured percentage is credited to the receiver and the remainder is burned.
          </Typography>
        </div>
        <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => open()}>Add gift</Button>
      </Stack>
      {error && <Typography color="error.main">{error}</Typography>}
      {message && <Typography color="success.main">{message}</Typography>}
      <Stack spacing={1.5}>
        {!loading && gifts.length === 0 && <Card><CardContent><Typography color="text.secondary">No social gifts configured yet.</Typography></CardContent></Card>}
        {gifts.map((gift) => (
          <Card key={gift.id}>
            <CardContent>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
                <Typography sx={{ fontSize: 38, width: 54, textAlign: "center" }}>{gift.icon || "🎁"}</Typography>
                <Stack sx={{ flex: 1 }} spacing={.4}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6" fontWeight={800}>{gift.name}</Typography>
                    <Chip size="small" label={gift.active ? "Active" : "Inactive"} color={gift.active ? "success" : "default"} />
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{gift.key} · {gift.description || "No description"}</Typography>
                </Stack>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography fontWeight={800}>{gift.priceGld} GLD</Typography>
                  <Typography color="success.main">Receiver {gift.recipientRewardPercent}%</Typography>
                  <Button onClick={() => open(gift)}>Edit</Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Stack>
      <Dialog open={dialogOpen} onClose={() => { setDialogOpen(false); setEditing(null); }} fullWidth maxWidth="sm">
        <DialogTitle>{editing ? "Edit social gift" : "Add social gift"}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={2}>
              <TextField label="Icon / emoji" value={form.icon} onChange={(e) => update("icon", e.target.value)} sx={{ width: 150 }} />
              <TextField label="Name" value={form.name} onChange={(e) => update("name", e.target.value)} fullWidth required />
            </Stack>
            <TextField label="Stable key" value={form.key} onChange={(e) => update("key", e.target.value)} disabled={Boolean(editing)} helperText="Example: rose or diamond" required />
            <Stack direction="row" spacing={2}>
              <TextField label="Sender price (GLD)" value={form.priceGld} onChange={(e) => update("priceGld", e.target.value)} type="number" inputProps={{ min: 0.000001, step: 0.000001 }} helperText="Supports up to 6 decimal places, e.g. 0.001" fullWidth required />
              <TextField label="Receiver reward (%)" value={form.recipientRewardPercent} onChange={(e) => update("recipientRewardPercent", e.target.value)} type="number" inputProps={{ min: 0, max: 100, step: 1 }} fullWidth required />
            </Stack>
            <TextField label="Description" value={form.description} onChange={(e) => update("description", e.target.value)} multiline minRows={2} />
            <TextField label="Image URL (optional)" value={form.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} helperText="If blank, the emoji is shown in mobile." />
            <Stack direction="row" alignItems="center"><Switch checked={form.active} onChange={(e) => update("active", e.target.checked)} /><Typography>Available to players</Typography></Stack>
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => { setDialogOpen(false); setEditing(null); }}>Cancel</Button><Button variant="contained" onClick={() => void save()} disabled={saving || !form.name || !form.key}>{saving ? "Saving…" : "Save"}</Button></DialogActions>
      </Dialog>
    </Stack>
  );
}
