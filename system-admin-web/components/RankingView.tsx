"use client";

import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Switch from "@mui/material/Switch";
import { api } from "../lib/api";

type Tier = {
  id: string;
  key: string;
  name: string;
  stakeAmountGld: string;
  entryFeeGld: string;
  enabled: boolean;
  sortOrder: number;
};
type HistoryRow = {
  id: string;
  status: string;
  stakeAmountGld: string;
  entryFeeGld: string;
  payoutAmountGld: string;
  createdAt: string;
  settledAt?: string | null;
  config: { name: string };
  winner?: {
    username: string;
    profile?: { displayName?: string | null } | null;
  } | null;
  match: {
    id: string;
    status: string;
    gameDefinition: { name: string };
    participants: Array<{
      result: string;
      finalScore?: number | null;
      user?: {
        username: string;
        profile?: { displayName?: string | null } | null;
      } | null;
    }>;
  };
};

export function RankingView() {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    stakeAmountGld: "5",
    entryFeeGld: "1",
    sortOrder: "0",
  });

  const load = async () => {
    try {
      setError("");
      const [nextTiers, nextHistory] = await Promise.all([
        api<Tier[]>("/ranking/configs"),
        api<HistoryRow[]>("/ranking/history?limit=100"),
      ]);
      setTiers(nextTiers);
      setHistory(nextHistory);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load ranking matches",
      );
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const update = async (tier: Tier, patch: Partial<Tier>) => {
    setSaving(tier.id);
    try {
      const next = await api<Tier>(`/ranking/configs/${tier.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...patch,
          stakeAmountGld:
            patch.stakeAmountGld === undefined
              ? undefined
              : Number(patch.stakeAmountGld),
          entryFeeGld:
            patch.entryFeeGld === undefined
              ? undefined
              : Number(patch.entryFeeGld),
        }),
      });
      setTiers((items) =>
        items.map((item) => (item.id === tier.id ? next : item)),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to save ranking tier",
      );
    } finally {
      setSaving(null);
    }
  };
  const create = async () => {
    setSaving("new");
    try {
      const next = await api<Tier>("/ranking/configs", {
        method: "POST",
        body: JSON.stringify({
          name: draft.name,
          stakeAmountGld: Number(draft.stakeAmountGld),
          entryFeeGld: Number(draft.entryFeeGld),
          sortOrder: Number(draft.sortOrder) || 0,
          enabled: true,
        }),
      });
      setTiers((items) => [...items, next]);
      setDraft({
        name: "",
        stakeAmountGld: "5",
        entryFeeGld: "1",
        sortOrder: "0",
      });
      setShowCreate(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to create ranking arena",
      );
    } finally {
      setSaving(null);
    }
  };
  const label = (player?: HistoryRow["winner"]) =>
    player?.profile?.displayName || player?.username || "—";
  return (
    <Box sx={{ p: { xs: 2, md: 5 }, maxWidth: 1500, mx: "auto" }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ md: "center" }}
        gap={2}
        sx={{ mb: 4 }}
      >
        <Box>
          <Typography variant="overline" color="primary">
            SERVER-OWNED COMPETITION
          </Typography>
          <Typography variant="h3" fontWeight={900}>
            Ranking matches
          </Typography>
          <Typography color="text.secondary">
            Configure GLD entry tiers and review every paid competitive match.
          </Typography>
        </Box>
        <Stack direction="row" gap={1}>
          <Button variant="outlined" onClick={() => void load()}>
            Refresh
          </Button>
          <Button
            variant="contained"
            onClick={() => setShowCreate((value) => !value)}
          >
            {showCreate ? "Close" : "Add arena"}
          </Button>
        </Stack>
      </Stack>
      {error && <Chip color="error" label={error} sx={{ mb: 3 }} />}
      {showCreate && (
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Stack gap={2}>
              <Typography variant="h6" fontWeight={800}>
                Create ranking arena
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add as many entry tiers as the economy needs. Disable an arena
                without deleting its history.
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <TextField
                    fullWidth
                    label="Arena name"
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    fullWidth
                    label="Stake (GLD)"
                    type="number"
                    value={draft.stakeAmountGld}
                    onChange={(event) =>
                      setDraft({ ...draft, stakeAmountGld: event.target.value })
                    }
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    fullWidth
                    label="Fee (GLD)"
                    type="number"
                    value={draft.entryFeeGld}
                    onChange={(event) =>
                      setDraft({ ...draft, entryFeeGld: event.target.value })
                    }
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <TextField
                    fullWidth
                    label="Sort order"
                    type="number"
                    value={draft.sortOrder}
                    onChange={(event) =>
                      setDraft({ ...draft, sortOrder: event.target.value })
                    }
                  />
                </Grid>
                <Grid item xs={12} md={2}>
                  <Button
                    fullWidth
                    sx={{ height: "100%" }}
                    variant="contained"
                    disabled={!draft.name.trim() || saving === "new"}
                    onClick={() => void create()}
                  >
                    Create
                  </Button>
                </Grid>
              </Grid>
            </Stack>
          </CardContent>
        </Card>
      )}
      <Typography variant="h5" fontWeight={800} sx={{ mb: 2 }}>
        Entry tiers
      </Typography>
      <Grid container spacing={2} sx={{ mb: 5 }}>
        {tiers.map((tier) => (
          <Grid item xs={12} md={4} key={tier.id}>
            <Card>
              <CardContent>
                <Stack gap={2}>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <Typography variant="h6" fontWeight={800}>
                      {tier.name}
                    </Typography>
                    <Switch
                      checked={tier.enabled}
                      disabled={saving === tier.id}
                      onChange={(event) =>
                        void update(tier, { enabled: event.target.checked })
                      }
                    />
                  </Stack>
                  <TextField
                    label="Stake per player (GLD)"
                    type="number"
                    value={tier.stakeAmountGld}
                    onChange={(event) =>
                      setTiers((items) =>
                        items.map((item) =>
                          item.id === tier.id
                            ? { ...item, stakeAmountGld: event.target.value }
                            : item,
                        ),
                      )
                    }
                    onBlur={() =>
                      void update(tier, { stakeAmountGld: tier.stakeAmountGld })
                    }
                  />
                  <TextField
                    label="Entry fee per player (GLD)"
                    type="number"
                    value={tier.entryFeeGld}
                    onChange={(event) =>
                      setTiers((items) =>
                        items.map((item) =>
                          item.id === tier.id
                            ? { ...item, entryFeeGld: event.target.value }
                            : item,
                        ),
                      )
                    }
                    onBlur={() =>
                      void update(tier, { entryFeeGld: tier.entryFeeGld })
                    }
                  />
                  <Typography variant="body2" color="text.secondary">
                    Winner payout:{" "}
                    {Math.max(
                      0,
                      Number(tier.stakeAmountGld) * 2 -
                        Number(tier.entryFeeGld) * 2,
                    )}{" "}
                    GLD
                  </Typography>
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
      <Typography variant="h5" fontWeight={800} sx={{ mb: 2 }}>
        Completed ranking matches
      </Typography>
      <Stack gap={1.5}>
        {history.length === 0 ? (
          <Card>
            <CardContent>
              <Typography color="text.secondary">
                No ranking matches have been played yet.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          history.map((row) => (
            <Card key={row.id}>
              <CardContent>
                <Stack
                  direction={{ xs: "column", md: "row" }}
                  gap={2}
                  alignItems={{ md: "center" }}
                  justifyContent="space-between"
                >
                  <Box>
                    <Typography fontWeight={800}>
                      {row.config.name} · {row.match.gameDefinition.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {row.match.participants
                        .map(
                          (item) =>
                            `${label(item.user as HistoryRow["winner"])} (${item.finalScore ?? 0})`,
                        )
                        .join(" vs ")}
                    </Typography>
                  </Box>
                  <Stack direction="row" gap={1} alignItems="center">
                    <Chip
                      size="small"
                      label={row.status}
                      color={row.status === "SETTLED" ? "success" : "default"}
                    />
                    <Typography variant="body2">
                      Winner: {label(row.winner)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Payout {row.payoutAmountGld} GLD
                    </Typography>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>
          ))
        )}
      </Stack>
    </Box>
  );
}
