"use client";

import { useEffect, useState } from "react";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import ReceiptLongRoundedIcon from "@mui/icons-material/ReceiptLongRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";

type Transaction = Record<string, any>;

export function TransactionsView() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Transaction[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async (search = query) => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ items: Transaction[] }>(
        `/transactions${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`,
      );
      setItems(result.items || []);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load transactions",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load("");
  }, []);

  const open = async (item: Transaction) => {
    try {
      setSelected(await api<Transaction>(`/transactions/${item.id}`));
    } catch {
      setSelected(item);
    }
  };

  return (
    <Box sx={{ maxWidth: 1380, mx: "auto", p: { xs: 2, md: 5 } }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        justifyContent="space-between"
        alignItems={{ md: "center" }}
        gap={2}
        mb={4}
      >
        <Box>
          <Typography variant="overline" color="primary.light">
            FINANCE CONTROL
          </Typography>
          <Typography variant="h3" fontWeight={900}>
            Transaction 360
          </Typography>
          <Typography color="text.secondary">
            Search every wallet ledger entry and inspect its complete server
            record.
          </Typography>
        </Box>
        <Button
          variant="outlined"
          onClick={() => void load()}
          startIcon={<ReceiptLongRoundedIcon />}
        >
          Refresh
        </Button>
      </Stack>
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
            <TextField
              fullWidth
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load();
              }}
              placeholder="Transaction ID, source, player, email, or reason"
              label="Search ledger"
            />
            <Button
              variant="contained"
              onClick={() => void load()}
              startIcon={<SearchRoundedIcon />}
              sx={{ minWidth: 140 }}
            >
              Search
            </Button>
          </Stack>
        </CardContent>
      </Card>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {[
                  "Transaction",
                  "Player",
                  "Description",
                  "Amount",
                  "Source",
                  "Created",
                ].map((label) => (
                  <TableCell key={label}>{label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {!loading && !items.length && (
                <TableRow>
                  <TableCell colSpan={6} align="center">
                    No transactions found.
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => {
                const debit = item.direction === "DEBIT";
                const user = item.user;
                const player =
                  user?.profile?.displayName ||
                  user?.username ||
                  user?.email ||
                  "Unknown player";
                const currency = item.currency?.code || "—";
                return (
                  <TableRow
                    hover
                    key={item.id}
                    onClick={() => void open(item)}
                    sx={{ cursor: "pointer" }}
                  >
                    <TableCell>
                      <Typography fontWeight={700}>
                        {item.title || "Wallet transaction"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.id}
                      </Typography>
                    </TableCell>
                    <TableCell>{player}</TableCell>
                    <TableCell>
                      {item.description || item.reason || item.sourceType}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={`${debit ? "−" : "+"}${item.amount} ${currency}`}
                        color={debit ? "error" : "success"}
                      />
                    </TableCell>
                    <TableCell>
                      {item.sourceType}
                      <br />
                      <Typography variant="caption" color="text.secondary">
                        {item.sourceId}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {new Date(item.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>{selected?.title || "Transaction details"}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {selected &&
              Object.entries(selected)
                .filter(([key]) => key !== "wallet")
                .map(([key, value]) => (
                  <Box key={key}>
                    <Typography variant="caption" color="text.secondary">
                      {key}
                    </Typography>
                    <Typography sx={{ wordBreak: "break-word" }}>
                      {typeof value === "object"
                        ? JSON.stringify(value, null, 2)
                        : String(value ?? "—")}
                    </Typography>
                  </Box>
                ))}
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  );
}
