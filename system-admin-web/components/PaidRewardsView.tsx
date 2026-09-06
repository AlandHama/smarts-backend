"use client";

import { useEffect, useState } from "react";

import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";

import { api } from "../lib/api";
import type { PaidRewardRequest } from "../lib/types";

export function PaidRewardsView({
  onOpenPlayer360,
}: {
  onOpenPlayer360?: (userId: string) => void;
}) {
  const [status, setStatus] = useState("PENDING");
  const [requests, setRequests] = useState<PaidRewardRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      setError("");
      setRequests(
        await api<PaidRewardRequest[]>(
          `/paid-rewards/requests?status=${status}`,
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load paid reward requests",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [status]);

  const decide = async (
    request: PaidRewardRequest,
    nextStatus: "FULFILLED" | "REFUSED",
  ) => {
    const note =
      window.prompt(
        nextStatus === "FULFILLED"
          ? "Optional approval note"
          : "Reason for refusing this request",
        request.adminNote || "",
      ) ?? "";
    if (
      nextStatus === "REFUSED" &&
      !note.trim() &&
      !window.confirm("Refuse this request without a note?")
    )
      return;
    try {
      setError("");
      await api(`/paid-rewards/requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: nextStatus,
          adminNote: note.trim() || undefined,
        }),
      });
      setMessage(
        nextStatus === "FULFILLED"
          ? "Request fulfilled and one redeem code assigned."
          : "Request refused.",
      );
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to update paid reward request",
      );
    }
  };

  const playerName = (request: PaidRewardRequest) =>
    request.user.profile?.displayName || request.user.username;
  const statusColor = (value: string) =>
    value === "FULFILLED"
      ? "success"
      : value === "REFUSED"
        ? "error"
        : "warning";

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        justifyContent="space-between"
        alignItems={{ sm: "center" }}
        spacing={2}
      >
        <div>
          <Typography variant="h4" fontWeight={850}>
            Paid rewards
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.7 }}>
            Review player requests for code-backed paid rewards. Approval claims
            exactly one unused code and grants the asset atomically.
          </Typography>
        </div>
        <Select
          size="small"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="PENDING">Pending</MenuItem>
          <MenuItem value="FULFILLED">Fulfilled</MenuItem>
          <MenuItem value="REFUSED">Refused</MenuItem>
          <MenuItem value="">All requests</MenuItem>
        </Select>
      </Stack>
      {error && <Typography color="error.main">{error}</Typography>}
      {message && <Typography color="success.main">{message}</Typography>}
      <Card>
        <Stack spacing={2} sx={{ p: { xs: 2, md: 3 } }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <div>
              <Typography variant="h6" fontWeight={800}>
                Reward requests
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Codes remain masked in the admin list and are delivered through
                the player account.
              </Typography>
            </div>
            <Chip label={`${requests.length} requests`} variant="outlined" />
          </Stack>
          <Divider />
          {loading ? (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Player</TableCell>
                    <TableCell>Asset</TableCell>
                    <TableCell>Request</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Code</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {requests.map((request) => (
                    <TableRow key={request.id} hover>
                      <TableCell>
                        <Button
                          size="small"
                          onClick={() => onOpenPlayer360?.(request.user.id)}
                          sx={{
                            textTransform: "none",
                            fontWeight: 800,
                            justifyContent: "flex-start",
                            p: 0,
                          }}
                        >
                          {playerName(request)}
                        </Button>
                        <Typography
                          variant="caption"
                          display="block"
                          color="text.secondary"
                        >
                          {request.user.email || `@${request.user.username}`}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography fontWeight={700}>
                          {request.asset.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {request.variation?.name || request.asset.key}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {new Date(request.requestedAt).toLocaleString()}
                        </Typography>
                        {request.message && (
                          <Typography variant="caption" color="text.secondary">
                            {request.message}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          color={statusColor(request.status)}
                          label={request.status}
                        />
                      </TableCell>
                      <TableCell>{request.redeemCode?.code || "—"}</TableCell>
                      <TableCell align="right">
                        {request.status === "PENDING" && (
                          <Stack
                            direction="row"
                            justifyContent="flex-end"
                            spacing={1}
                          >
                            <Button
                              size="small"
                              variant="contained"
                              color="success"
                              onClick={() => void decide(request, "FULFILLED")}
                            >
                              Accept
                            </Button>
                            <Button
                              size="small"
                              variant="outlined"
                              color="error"
                              onClick={() => void decide(request, "REFUSED")}
                            >
                              Refuse
                            </Button>
                          </Stack>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!requests.length && !loading && (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 6 }}>
                        <Typography color="text.secondary">
                          No requests in this status.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
