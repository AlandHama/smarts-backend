"use client";

import { useEffect, useState, type FormEvent } from "react";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import LeaderboardRoundedIcon from "@mui/icons-material/LeaderboardRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid2";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";
import type { LeaderboardDefinition, LeaderboardEntry, LeaderboardReward } from "../lib/types";
import { UserSelector, type SelectableUser } from "./UserSelector";

const valueOf = (form: HTMLFormElement, name: string) =>
  String(
    (form.elements.namedItem(name) as HTMLInputElement)?.value ?? "",
  ).trim();

type RewardDraft = { rank: string; rewardType: "CURRENCY" | "ASSET" | "ENTITLEMENT" | "PROGRESSION_POINTS"; amount: string; currencyCode: string; assetKey: string; variationKey: string; quantity: string; targetKey: string; progressionKey: string };
const emptyReward = (): RewardDraft => ({ rank: "1", rewardType: "CURRENCY", amount: "", currencyCode: "GLD", assetKey: "", variationKey: "", quantity: "1", targetKey: "", progressionKey: "main" });
const draftsFromRewards = (rewards: LeaderboardReward[] = []) => rewards.map((reward) => ({ rank: String(reward.rank), rewardType: reward.rewardType as RewardDraft["rewardType"], amount: reward.amount ?? "", currencyCode: reward.currency?.code ?? "", assetKey: reward.assetDefinition?.key ?? "", variationKey: reward.assetVariation?.key ?? "", quantity: reward.rewardType === "ASSET" ? reward.amount ?? "1" : "1", targetKey: reward.targetKey ?? "", progressionKey: reward.progressionDefinition?.key ?? "" }));
const serializeRewards = (rewards: RewardDraft[]) => rewards.map((reward) => ({ rank: Number(reward.rank), rewardType: reward.rewardType, ...(reward.rewardType === "CURRENCY" ? { amount: reward.amount, currencyCode: reward.currencyCode } : {}), ...(reward.rewardType === "ASSET" ? { assetKey: reward.assetKey, variationKey: reward.variationKey || undefined, quantity: Number(reward.quantity || "1") } : {}), ...(reward.rewardType === "ENTITLEMENT" ? { targetKey: reward.targetKey, assetKey: reward.assetKey || undefined } : {}), ...(reward.rewardType === "PROGRESSION_POINTS" ? { progressionKey: reward.progressionKey, amount: reward.amount } : {}) }));

function RewardScheduleEditor({ rewards, onChange }: { rewards: RewardDraft[]; onChange: (next: RewardDraft[]) => void }) {
  const update = (index: number, patch: Partial<RewardDraft>) => onChange(rewards.map((reward, itemIndex) => itemIndex === index ? { ...reward, ...patch } : reward));
  return <Stack spacing={1.5}>
    <Stack direction="row" justifyContent="space-between" alignItems="center"><Box><Typography variant="subtitle2" fontWeight={800}>Leaderboard rewards</Typography><Typography variant="caption" color="text.secondary">Player boards pay every configured reward when their weekly or monthly season closes.</Typography></Box><Button size="small" startIcon={<AddRoundedIcon />} onClick={() => onChange([...rewards, emptyReward()])}>Add reward</Button></Stack>
    {rewards.map((reward, index) => <Card key={index} variant="outlined" sx={{ p: 1.5 }}><Grid container spacing={1.2} alignItems="center"><Grid size={{ xs: 6, sm: 2 }}><TextField size="small" fullWidth label="Rank" type="number" value={reward.rank} onChange={(event) => update(index, { rank: event.target.value })} /></Grid><Grid size={{ xs: 6, sm: 3 }}><Select size="small" fullWidth value={reward.rewardType} onChange={(event) => update(index, { rewardType: event.target.value as RewardDraft["rewardType"] })}><MenuItem value="CURRENCY">Currency</MenuItem><MenuItem value="ASSET">Asset</MenuItem><MenuItem value="ENTITLEMENT">Entitlement</MenuItem><MenuItem value="PROGRESSION_POINTS">Progression points</MenuItem></Select></Grid>{reward.rewardType === "CURRENCY" && <><Grid size={{ xs: 6, sm: 3 }}><TextField size="small" fullWidth label="Currency code" value={reward.currencyCode} onChange={(event) => update(index, { currencyCode: event.target.value })} /></Grid><Grid size={{ xs: 6, sm: 3 }}><TextField size="small" fullWidth label="Amount" value={reward.amount} onChange={(event) => update(index, { amount: event.target.value })} /></Grid></>}{reward.rewardType === "ASSET" && <><Grid size={{ xs: 6, sm: 3 }}><TextField size="small" fullWidth label="Asset key" value={reward.assetKey} onChange={(event) => update(index, { assetKey: event.target.value })} /></Grid><Grid size={{ xs: 6, sm: 2 }}><TextField size="small" fullWidth label="Quantity" type="number" value={reward.quantity} onChange={(event) => update(index, { quantity: event.target.value })} /></Grid><Grid size={{ xs: 6, sm: 2 }}><TextField size="small" fullWidth label="Variation" value={reward.variationKey} onChange={(event) => update(index, { variationKey: event.target.value })} /></Grid></>}{reward.rewardType === "ENTITLEMENT" && <Grid size={{ xs: 12, sm: 5 }}><TextField size="small" fullWidth label="Entitlement key" value={reward.targetKey} onChange={(event) => update(index, { targetKey: event.target.value })} /></Grid>}{reward.rewardType === "PROGRESSION_POINTS" && <><Grid size={{ xs: 6, sm: 3 }}><TextField size="small" fullWidth label="Progression key" value={reward.progressionKey} onChange={(event) => update(index, { progressionKey: event.target.value })} /></Grid><Grid size={{ xs: 6, sm: 3 }}><TextField size="small" fullWidth label="Points" value={reward.amount} onChange={(event) => update(index, { amount: event.target.value })} /></Grid></>}<Grid size={{ xs: 12, sm: 1 }}><Button color="error" onClick={() => onChange(rewards.filter((_, itemIndex) => itemIndex !== index))}><DeleteOutlineRoundedIcon /></Button></Grid></Grid></Card>)}
  </Stack>;
}

function CreateLeaderboardDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  const [rewards, setRewards] = useState<RewardDraft[]>([]);
  return (
    <Dialog open maxWidth="sm" fullWidth onClose={onClose}>
      <DialogTitle>Create leaderboard definition</DialogTitle>
      <form
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = event.currentTarget;
          try {
            await api("/leaderboards", {
              method: "POST",
              body: JSON.stringify({
                key: valueOf(form, "key").toLowerCase(),
                name: valueOf(form, "name"),
                memberType: valueOf(form, "memberType"),
                period: valueOf(form, "period"),
                direction: valueOf(form, "direction"),
                writePolicy: "SERVER_ONLY",
                active: true,
                rewards: serializeRewards(rewards),
              }),
            });
            onSaved();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Unable to create leaderboard",
            );
          }
        }}
      >
        <DialogContent>
          <Stack spacing={2}>
            {error && <Typography color="error.main">{error}</Typography>}
            <TextField
              name="key"
              label="Stable key"
              placeholder="players_weekly"
              required
              fullWidth
              size="small"
            />
            <TextField
              name="name"
              label="Display name"
              placeholder="Players · Weekly"
              required
              fullWidth
              size="small"
            />
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Select
                  name="memberType"
                  defaultValue="PLAYER"
                  fullWidth
                  size="small"
                >
                  <MenuItem value="PLAYER">Players</MenuItem>
                  <MenuItem value="COUNTRY">Countries</MenuItem>
                  <MenuItem value="GENERIC">Generic members</MenuItem>
                </Select>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Select
                  name="period"
                  defaultValue="WEEKLY"
                  fullWidth
                  size="small"
                >
                  <MenuItem value="ALL_TIME">All time</MenuItem>
                  <MenuItem value="WEEKLY">Weekly</MenuItem>
                  <MenuItem value="MONTHLY">Monthly</MenuItem>
                  <MenuItem value="SEASONAL">Seasonal</MenuItem>
                </Select>
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Select
                  name="direction"
                  defaultValue="DESCENDING"
                  fullWidth
                  size="small"
                >
                  <MenuItem value="DESCENDING">Highest score first</MenuItem>
                  <MenuItem value="ASCENDING">Lowest score first</MenuItem>
                </Select>
              </Grid>
            </Grid>
            <Divider />
            <RewardScheduleEditor rewards={rewards} onChange={setRewards} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function EditLeaderboardDialog({ board, onClose, onSaved }: { board: LeaderboardDefinition; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState("");
  const [rewards, setRewards] = useState<RewardDraft[]>(draftsFromRewards(board.rewards));
  return <Dialog open maxWidth="md" fullWidth onClose={onClose}><DialogTitle>Edit leaderboard</DialogTitle><form onSubmit={async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api(`/leaderboards/${board.id}`, { method: "PATCH", body: JSON.stringify({ name: valueOf(form, "name"), memberType: valueOf(form, "memberType"), period: valueOf(form, "period"), direction: valueOf(form, "direction"), active: valueOf(form, "active") === "true", rewards: serializeRewards(rewards) }) }); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to update leaderboard"); } }}><DialogContent><Stack spacing={2}>{error && <Typography color="error.main">{error}</Typography>}<TextField name="name" label="Display name" defaultValue={board.name} required fullWidth size="small" /><Grid container spacing={2}><Grid size={{ xs: 12, sm: 4 }}><Select name="memberType" defaultValue={board.memberType} fullWidth size="small"><MenuItem value="PLAYER">Players</MenuItem><MenuItem value="COUNTRY">Countries</MenuItem><MenuItem value="GENERIC">Generic members</MenuItem></Select></Grid><Grid size={{ xs: 12, sm: 4 }}><Select name="period" defaultValue={board.period} fullWidth size="small"><MenuItem value="ALL_TIME">All time</MenuItem><MenuItem value="WEEKLY">Weekly</MenuItem><MenuItem value="MONTHLY">Monthly</MenuItem><MenuItem value="SEASONAL">Seasonal</MenuItem></Select></Grid><Grid size={{ xs: 12, sm: 4 }}><Select name="direction" defaultValue={board.direction} fullWidth size="small"><MenuItem value="DESCENDING">Highest score first</MenuItem><MenuItem value="ASCENDING">Lowest score first</MenuItem></Select></Grid><Grid size={{ xs: 12 }}><Select name="active" defaultValue={String(board.active)} fullWidth size="small"><MenuItem value="true">Active</MenuItem><MenuItem value="false">Inactive</MenuItem></Select></Grid></Grid><Divider /><RewardScheduleEditor rewards={rewards} onChange={setRewards} /></Stack></DialogContent><DialogActions><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="contained">Save changes</Button></DialogActions></form></Dialog>;
}

export function LeaderboardView() {
  const [boards, setBoards] = useState<LeaderboardDefinition[]>([]);
  const [selected, setSelected] = useState<LeaderboardDefinition | null>(null);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [scorePlayer, setScorePlayer] = useState<SelectableUser | null>(null);
  const load = () =>
    api<LeaderboardDefinition[]>("/leaderboards?includeInactive=true")
      .then((items) => {
        setBoards(items);
        setSelected((current) => current ? items.find((item) => item.id === current.id) ?? items[0] ?? null : items[0] ?? null);
      })
      .catch((e) =>
        setError(
          e instanceof Error ? e.message : "Unable to load leaderboards",
        ),
      );
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (!selected) return;
    api<{ items: LeaderboardEntry[] }>(
      `/leaderboards/${selected.key}/top-players?limit=20`,
    )
      .then((body) => setEntries(body.items))
      .catch(() => setEntries([]));
  }, [selected]);
  const applyScore = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    try {
      setError("");
      if (selected.memberType === "PLAYER" && !scorePlayer)
        throw new Error("Select a player before applying the score");
      await api(`/leaderboards/${selected.key}/score`, {
        method: "POST",
        body: JSON.stringify({
          playerId:
            selected.memberType === "PLAYER" ? scorePlayer?.id : undefined,
          memberKey:
            selected.memberType !== "PLAYER"
              ? valueOf(form, "memberKey")
              : undefined,
          delta: valueOf(form, "delta"),
          sourceId: valueOf(form, "sourceId"),
          sourceType: "ADMIN",
        }),
      });
      form.reset();
      setScorePlayer(null);
      const body = await api<{ items: LeaderboardEntry[] }>(
        `/leaderboards/${selected.key}/top-players?limit=20`,
      );
      setEntries(body.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to apply score");
    }
  };
  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Typography variant="h4" fontWeight={850}>
            Leaderboards
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.7 }}>
            UTC seasons, server-owned score events, and deterministic ranks for
            SMARTS boards.
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddRoundedIcon />}
          onClick={() => setDialogOpen(true)}
        >
          Create leaderboard
        </Button>
      </Stack>
      {error && <Typography color="error.main">{error}</Typography>}
      <Grid container spacing={2}>
        {boards.map((board) => (
          <Grid key={board.id} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Card
              onClick={() => {
                setSelected(board);
                setScorePlayer(null);
              }}
              sx={{
                p: 2.2,
                height: "100%",
                cursor: "pointer",
                outline:
                  selected?.id === board.id ? "2px solid #8b7dff" : "none",
              }}
            >
              <Stack direction="row" justifyContent="space-between">
                <LeaderboardRoundedIcon color="primary" />
                <Chip
                  size="small"
                  color={board.active ? "success" : "warning"}
                  label={board.active ? "ACTIVE" : "OFF"}
                />
              </Stack>
              <Typography fontWeight={800} sx={{ mt: 2 }}>
                {board.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {board.key}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {board.memberType} · {board.period.toLowerCase()}
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>
      {selected && (
        <Card>
          <Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 3 } }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              spacing={2}
            >
              <Box>
                <Typography variant="h6" fontWeight={800}>
                  {selected.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selected.direction === "DESCENDING"
                    ? "Highest score wins"
                    : "Lowest score wins"}{" "}
                  · ties share rank and use update time/member key as display
                  order.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button size="small" variant="outlined" startIcon={<EditRoundedIcon />} onClick={() => setEditDialogOpen(true)}>Edit</Button>
                <Chip label={selected.memberType} variant="outlined" />
                <Chip label={selected.period} variant="outlined" />
              </Stack>
            </Stack>
            <Divider />
            <Typography variant="subtitle2" fontWeight={800}>Reward schedule</Typography>
            {selected.rewards?.length ? <Stack direction="row" flexWrap="wrap" gap={1}>{selected.rewards.map((reward, index) => <Chip key={reward.id ?? index} color="secondary" variant="outlined" label={`#${reward.rank} · ${reward.rewardType === "CURRENCY" ? `${reward.amount} ${reward.currency?.code ?? ""}` : reward.rewardType === "ASSET" ? `${reward.assetDefinition?.name ?? reward.targetKey} × ${reward.amount ?? 1}` : reward.targetKey}`} />)}</Stack> : <Typography variant="body2" color="text.secondary">No rewards configured. Add rewards to pay the top ranked players at season renewal.</Typography>}
            <Divider />
            <Typography variant="subtitle2" fontWeight={800}>
              Top players / members
            </Typography>
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Rank</TableCell>
                    <TableCell>Member</TableCell>
                    <TableCell>Score</TableCell>
                    <TableCell>Country</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.length ? (
                    entries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          <Chip
                            size="small"
                            color={
                              String(entry.rank) === "1" ? "primary" : "default"
                            }
                            label={`#${entry.rank}`}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography fontWeight={700}>
                            {entry.player?.displayName ||
                              entry.player?.username ||
                              entry.memberKey}
                          </Typography>
                          {entry.player?.username && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {entry.player.username}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{entry.score}</TableCell>
                        <TableCell>
                          {entry.player?.countryCode || entry.memberKey}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 5 }}>
                        <Typography color="text.secondary">
                          No scores in the active season yet.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
            <Divider />
            <Typography variant="subtitle2" fontWeight={800}>
              Administrative score correction
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Use a unique source ID. This still writes a normal idempotent
              score event and cannot modify history.
            </Typography>
            <form onSubmit={applyScore}>
              <Grid container spacing={1.5} sx={{ mt: 0.2 }}>
                {selected.memberType === "PLAYER" ? (
                  <Grid size={{ xs: 12, md: 4 }}>
                    <UserSelector
                      value={scorePlayer}
                      onChange={setScorePlayer}
                      required
                      label="Player"
                    />
                  </Grid>
                ) : (
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      name="memberKey"
                      label={
                        selected.memberType === "COUNTRY"
                          ? "Country code"
                          : "Member key"
                      }
                      required
                    />
                  </Grid>
                )}
                <Grid size={{ xs: 12, md: 2 }}>
                  <TextField
                    fullWidth
                    size="small"
                    name="delta"
                    label="Score delta"
                    placeholder="25 or -25"
                    required
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 4 }}>
                  <TextField
                    fullWidth
                    size="small"
                    name="sourceId"
                    label="Unique source ID"
                    required
                  />
                </Grid>
                <Grid size={{ xs: 12, md: 2 }}>
                  <Button
                    fullWidth
                    type="submit"
                    variant="contained"
                    startIcon={<PlayCircleOutlineRoundedIcon />}
                  >
                    Apply
                  </Button>
                </Grid>
              </Grid>
            </form>
          </Stack>
        </Card>
      )}
      {dialogOpen && (
        <CreateLeaderboardDialog
          onClose={() => setDialogOpen(false)}
          onSaved={() => {
            setDialogOpen(false);
            load();
          }}
        />
      )}
      {editDialogOpen && selected && <EditLeaderboardDialog board={selected} onClose={() => setEditDialogOpen(false)} onSaved={() => { setEditDialogOpen(false); load(); }} />}
    </Stack>
  );
}

export function SeasonManagerPanel() {
  const [boards, setBoards] = useState<LeaderboardDefinition[]>([]);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const load = () =>
    api<LeaderboardDefinition[]>("/leaderboards?includeInactive=true")
      .then((items) => {
        setBoards(items);
        if (!key && items[0]) setKey(items[0].key);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Unable to load seasons"),
      );
  useEffect(() => {
    load();
  }, []);
  const board = boards.find((item) => item.key === key);
  const active = board?.seasons?.find((season) => season.status === "ACTIVE");
  const schedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!board) return;
    const form = event.currentTarget;
    try {
      setError("");
      await api(`/leaderboards/${board.id}/seasons`, {
        method: "POST",
        body: JSON.stringify({
          startsAt: new Date(valueOf(form, "startsAt")).toISOString(),
          endsAt: new Date(valueOf(form, "endsAt")).toISOString(),
        }),
      });
      setMessage("Season scheduled");
      form.reset();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to schedule season");
    }
  };
  const close = async () => {
    if (
      !active ||
      !window.confirm(
        "Close the active season? Late score writes will be rejected.",
      )
    )
      return;
    try {
      await api(`/leaderboard-seasons/${active.id}/close`, { method: "POST" });
      setMessage("Season closed");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to close season");
    }
  };
  return (
    <Card>
      <Stack spacing={2} sx={{ p: { xs: 2.5, md: 3 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          justifyContent="space-between"
          spacing={2}
        >
          <Box>
            <Typography variant="h6" fontWeight={800}>
              Season controls
            </Typography>
            <Typography variant="body2" color="text.secondary">
              All boundaries are UTC. Closing a season preserves its entries and
              blocks late score writes.
            </Typography>
          </Box>
          <Select
            size="small"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            sx={{ minWidth: 210 }}
          >
            {boards.map((item) => (
              <MenuItem key={item.key} value={item.key}>
                {item.name}
              </MenuItem>
            ))}
          </Select>
        </Stack>
        {error && <Typography color="error.main">{error}</Typography>}
        {message && <Typography color="success.main">{message}</Typography>}
        <Divider />
        {active ? (
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems={{ sm: "center" }}
            spacing={2}
          >
            <Box>
              <Chip size="small" color="success" label="ACTIVE" />
              <Typography variant="body2" sx={{ mt: 1 }}>
                {new Date(active.startsAt).toUTCString()} →{" "}
                {new Date(active.endsAt).toUTCString()}
              </Typography>
            </Box>
            <Button color="warning" variant="outlined" onClick={close}>
              Close active season
            </Button>
          </Stack>
        ) : (
          <Typography color="text.secondary">
            No active season. Schedule one below.
          </Typography>
        )}
        <form onSubmit={schedule}>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField
                fullWidth
                size="small"
                name="startsAt"
                label="Starts (UTC)"
                type="datetime-local"
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 5 }}>
              <TextField
                fullWidth
                size="small"
                name="endsAt"
                label="Ends (UTC)"
                type="datetime-local"
                InputLabelProps={{ shrink: true }}
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <Button
                fullWidth
                type="submit"
                variant="outlined"
                sx={{ height: "100%" }}
              >
                Schedule
              </Button>
            </Grid>
          </Grid>
        </form>
      </Stack>
    </Card>
  );
}
