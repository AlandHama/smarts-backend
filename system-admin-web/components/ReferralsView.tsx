"use client";

import { useEffect, useState } from "react";

import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import GroupRoundedIcon from "@mui/icons-material/GroupRounded";
import PaidRoundedIcon from "@mui/icons-material/PaidRounded";
import ShareRoundedIcon from "@mui/icons-material/ShareRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";

type ReferralState = {
  config: {
    enabled: boolean;
    maxInvitesPerUser: number;
    rewardBps: number;
    maxRewardPerReferral: string;
    minQualifyingAds: number;
  };
  stats: {
    total: number;
    active: number;
    qualified: number;
    capped: number;
    rewardCount: number;
    totalRewardedGld: string;
  };
  referrals: Array<{
    id: string;
    status: string;
    referredAdCount: number;
    totalRewardedGld: string;
    rewardCount: number;
    createdAt: string;
    referrer: { name: string; username: string; email: string | null };
    referred: { name: string; username: string; email: string | null };
  }>;
};

export function ReferralsView() {
  const [data, setData] = useState<ReferralState | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [maxInvites, setMaxInvites] = useState("25");
  const [rewardPercent, setRewardPercent] = useState("10");
  const [maxReward, setMaxReward] = useState("1000");
  const [minAds, setMinAds] = useState("1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api<ReferralState>("/referrals");
      setData(next);
      setEnabled(next.config.enabled);
      setMaxInvites(String(next.config.maxInvitesPerUser));
      setRewardPercent(String(next.config.rewardBps / 100));
      setMaxReward(next.config.maxRewardPerReferral);
      setMinAds(String(next.config.minQualifyingAds));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load referrals");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const save = async () => {
    const maxInviteValue = Number(maxInvites);
    const percentValue = Number(rewardPercent);
    const maxRewardValue = maxReward.trim();
    const minAdValue = Number(minAds);
    if (!Number.isInteger(maxInviteValue) || maxInviteValue < 0 || maxInviteValue > 10000) {
      setError("Maximum invites must be a whole number from 0 to 10,000");
      return;
    }
    if (!Number.isFinite(percentValue) || percentValue < 0 || percentValue > 50) {
      setError("Referral share must be between 0% and 50%");
      return;
    }
    if (!/^\d+$/.test(maxRewardValue)) {
      setError("Maximum referral reward must be a non-negative whole GLD amount");
      return;
    }
    if (!Number.isInteger(minAdValue) || minAdValue < 1 || minAdValue > 100) {
      setError("Qualifying ads must be a whole number from 1 to 100");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api("/referrals/config", {
        method: "PATCH",
        body: JSON.stringify({ enabled, maxInvitesPerUser: maxInviteValue, rewardBps: Math.round(percentValue * 100), maxRewardPerReferral: maxRewardValue, minQualifyingAds: minAdValue }),
      });
      setMessage("Referral policy updated.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update referral policy");
    } finally {
      setSaving(false);
    }
  };

  return <Stack spacing={3}>
    <Stack direction={{ xs: "column", lg: "row" }} justifyContent="space-between" spacing={2}>
      <Box>
        <Typography variant="overline" color="primary.light">SERVER-OWNED ACQUISITION</Typography>
        <Typography variant="h4" fontWeight={850}>Referral system</Typography>
        <Typography color="text.secondary" sx={{ mt: .7 }}>Manage player attribution and reward referrals from the existing GLD ad-emission budget.</Typography>
      </Box>
      <Button variant="outlined" startIcon={<ShareRoundedIcon />} onClick={() => void load()} disabled={loading}>Refresh</Button>
    </Stack>
    {error && <Typography color="error.main">{error}</Typography>}
    {message && <Typography color="success.main">{message}</Typography>}
    {loading && !data ? <Stack alignItems="center" sx={{ py: 8 }}><CircularProgress /></Stack> : data && <>
      <Grid container spacing={2}>
        {[
          { icon: GroupRoundedIcon, value: data.stats.total, label: "Total referrals" },
          { icon: CheckCircleRoundedIcon, value: data.stats.qualified, label: "Qualified referrals" },
          { icon: PaidRoundedIcon, value: data.stats.rewardCount, label: "Rewards granted" },
          { icon: PaidRoundedIcon, value: data.stats.totalRewardedGld, label: "GLD paid to referrers" },
        ].map(({ icon: Icon, value, label }) => <Grid item key={label} xs={12} sm={6} lg={3}><Card sx={{ p: 2.5 }}><Stack direction="row" spacing={1.5} alignItems="center"><Box sx={{ width: 40, height: 40, borderRadius: 2, display: "grid", placeItems: "center", bgcolor: "rgba(139,125,255,.18)", color: "primary.light" }}><Icon /></Box><Box><Typography variant="h5" fontWeight={850}>{String(value)}</Typography><Typography variant="body2" color="text.secondary">{label}</Typography></Box></Stack></Card></Grid>)}
      </Grid>
      <Grid container spacing={2}>
        <Grid item xs={12} lg={5}><Card><Stack spacing={2.5} sx={{ p: { xs: 2.5, md: 3.5 } }}><Box><Typography variant="h6" fontWeight={800}>Referral policy</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .6 }}>The referrer receives a share of the referred player’s gross verified ad reward. The player reward and referral share together never exceed the original emission.</Typography></Box><Divider /><FormControlLabel control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />} label={enabled ? "Referral program enabled" : "Referral program paused"} /><TextField label="Maximum referrals per player" type="number" value={maxInvites} onChange={(event) => setMaxInvites(event.target.value)} inputProps={{ min: 0, max: 10000, step: 1 }} /><TextField label="Referrer share (%)" type="number" value={rewardPercent} onChange={(event) => setRewardPercent(event.target.value)} helperText="Maximum 50%; deducted from the referred ad reward allocation." inputProps={{ min: 0, max: 50, step: .1 }} /><TextField label="Maximum reward per referral (GLD)" value={maxReward} onChange={(event) => setMaxReward(event.target.value)} inputProps={{ inputMode: "numeric", pattern: "[0-9]*" }} /><TextField label="Verified ads before reward" type="number" value={minAds} onChange={(event) => setMinAds(event.target.value)} inputProps={{ min: 1, max: 100, step: 1 }} /><Button variant="contained" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : "Save referral policy"}</Button></Stack></Card></Grid>
        <Grid item xs={12} lg={7}><Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 3.5 } }}><Box><Typography variant="h6" fontWeight={800}>Program health</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .6 }}>Attribution is lifetime, capped by policy, and tied to verified ad claims for reconciliation.</Typography></Box><Divider /><Stack direction={{ xs: "column", sm: "row" }} spacing={1}><Chip label={`${data.stats.active} active`} color="info" variant="outlined" /><Chip label={`${data.stats.qualified} qualified`} color="success" variant="outlined" /><Chip label={`${data.stats.capped} capped`} color="warning" variant="outlined" /><Chip label={`${data.config.rewardBps / 100}% funded share`} variant="outlined" /></Stack><Typography variant="body2" color="text.secondary">A referral does not require a friendship. Each new account can apply one code, and each code has a server-enforced invite limit.</Typography></Stack></Card></Grid>
      </Grid>
      <Card><Stack spacing={2} sx={{ p: { xs: 2.5, md: 3.5 } }}><Box><Typography variant="h6" fontWeight={800}>Recent referral activity</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: .6 }}>Player attribution, verified ad activity, and GLD allocated to referrers.</Typography></Box><Divider /><TableContainer><Table size="small"><TableHead><TableRow><TableCell>Referrer</TableCell><TableCell>Referred player</TableCell><TableCell>Status</TableCell><TableCell>Ads</TableCell><TableCell>Rewarded GLD</TableCell><TableCell>Created</TableCell></TableRow></TableHead><TableBody>{data.referrals.length === 0 ? <TableRow><TableCell colSpan={6} align="center" sx={{ py: 6 }}><Typography color="text.secondary">No referrals have been attributed yet.</Typography></TableCell></TableRow> : data.referrals.map((item) => <TableRow key={item.id} hover><TableCell><Typography fontWeight={700}>{item.referrer.name}</Typography><Typography variant="caption" color="text.secondary">{item.referrer.email || item.referrer.username}</Typography></TableCell><TableCell><Typography fontWeight={700}>{item.referred.name}</Typography><Typography variant="caption" color="text.secondary">{item.referred.email || item.referred.username}</Typography></TableCell><TableCell><Chip size="small" label={item.status} color={item.status === "CAPPED" ? "warning" : item.status === "QUALIFIED" ? "success" : "default"} /></TableCell><TableCell>{item.referredAdCount}</TableCell><TableCell>{item.totalRewardedGld}</TableCell><TableCell>{new Date(item.createdAt).toLocaleString()}</TableCell></TableRow>)}</TableBody></Table></TableContainer></Stack></Card>
    </>}
  </Stack>;
}
