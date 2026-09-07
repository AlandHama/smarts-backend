"use client";

import { useEffect, useState } from "react";

import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import CalendarMonthRoundedIcon from "@mui/icons-material/CalendarMonthRounded";
import CheckCircleRoundedIcon from "@mui/icons-material/CheckCircleRounded";
import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import QueryBuilderRoundedIcon from "@mui/icons-material/QueryBuilderRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Grid from "@mui/material/Grid2";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";
import type { Match360Data } from "../lib/types";

const date = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
const json = (value: unknown) =>
  value === null || value === undefined
    ? "—"
    : typeof value === "string"
      ? value
      : JSON.stringify(value);
const prompt = (value: unknown) =>
  value && typeof value === "object" && "en" in value
    ? String((value as { en?: unknown }).en ?? "")
    : json(value);
const playerLabel = (
  player?: { username: string; profile: { displayName: string } | null } | null,
) => player?.profile?.displayName || player?.username || "Bot";
const statusColor = (
  status: string,
): "success" | "warning" | "error" | "default" =>
  status === "SETTLED" || status === "FINISHED"
    ? "success"
    : status === "REVIEW" || status === "STARTED"
      ? "warning"
      : status === "CANCELLED"
        ? "error"
        : "default";
const duration = (start?: string | null, end?: string | null) => {
  if (!start || !end) return "In progress";
  const seconds = Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000),
  );
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const averageTime = (total: number, count: number) =>
  count ? `${Math.round(total / count)} ms avg` : "—";

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card sx={{ overflow: "hidden" }}>
      <Stack direction="row" spacing={1.5} sx={{ p: { xs: 2.5, md: 3 } }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            borderRadius: 2,
            bgcolor: "rgba(139,125,255,.13)",
            color: "primary.light",
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="h6" fontWeight={800}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </Box>
      </Stack>
      <Divider />
      {children}
    </Card>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card
      sx={{
        p: 2.5,
        height: "100%",
        background:
          "linear-gradient(145deg, rgba(31,43,69,.95), rgba(24,31,52,.95))",
      }}
    >
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ letterSpacing: ".08em" }}
      >
        {label}
      </Typography>
      <Typography variant="h4" fontWeight={850} sx={{ mt: 0.5 }}>
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {detail}
      </Typography>
    </Card>
  );
}

export function Match360View({
  matchId,
  onBack,
}: {
  matchId: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<Match360Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    let disposed = false;
    const load = () =>
      void api<Match360Data>(`/matches/${matchId}/360`)
        .then((next) => {
          if (!disposed) setData(next);
        })
        .catch((e) => {
          if (!disposed)
            setError(
              e instanceof Error ? e.message : "Unable to load Match 360",
            );
        });
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [matchId]);

  if (!data && !error)
    return (
      <Stack
        alignItems="center"
        justifyContent="center"
        sx={{ minHeight: 420 }}
      >
        <CircularProgress />
      </Stack>
    );
  if (!data)
    return (
      <Stack spacing={2}>
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}>
          Back to matches
        </Button>
        <Typography color="error.main">{error || "Match not found"}</Typography>
      </Stack>
    );

  const acceptedAnswers = data.events.filter(
    (event) => event.eventType === "ANSWER" && event.accepted,
  );
  const answeredAssignments = data.assignments.filter(
    (assignment) => assignment.answeredAt,
  );
  const matchDuration = duration(data.startedAt, data.endedAt);

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        justifyContent="space-between"
        alignItems={{ lg: "center" }}
        spacing={2}
      >
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Button startIcon={<ArrowBackRoundedIcon />} onClick={onBack}>
            Back to matches
          </Button>
          <Box>
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ letterSpacing: ".14em" }}
            >
              MATCH 360
            </Typography>
            <Typography variant="h4" fontWeight={850}>
              {data.gameDefinition.name}
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ fontFamily: "monospace", fontSize: 12 }}
            >
              {data.id}
            </Typography>
          </Box>
        </Stack>
        <Chip
          size="medium"
          label={data.status}
          color={statusColor(data.status)}
        />
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Metric
            label="MODE"
            value={data.mode.replace("_", " ")}
            detail={data.gameDefinition.key}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Metric
            label="PLAYERS"
            value={data.participants.length}
            detail={`${data.participants.filter((p) => p.participantType === "PLAYER").length} human · ${data.participants.filter((p) => p.participantType === "BOT").length} bot`}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Metric
            label="ANSWERS"
            value={acceptedAnswers.length}
            detail={`${data.events.filter((event) => event.accepted).length} accepted events`}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <Metric
            label="MATCH TIME"
            value={matchDuration}
            detail={`Started ${date(data.startedAt)}`}
          />
        </Grid>
      </Grid>

      <Section
        icon={<CheckCircleRoundedIcon />}
        title="Players and final results"
        description="Server-derived score, answer quality, timing, and settlement result for every participant."
      >
        <Box sx={{ overflowX: "auto" }}>
          <Table sx={{ minWidth: 820 }}>
            <TableHead>
              <TableRow>
                <TableCell>Player</TableCell>
                <TableCell>Score</TableCell>
                <TableCell>Answers</TableCell>
                <TableCell>Accuracy</TableCell>
                <TableCell>Time</TableCell>
                <TableCell>Result</TableCell>
                <TableCell>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.participants.map((participant) => {
                const stats = participant.answerStats;
                const total = stats.correct + stats.wrong;
                const accuracy = total
                  ? `${Math.round((stats.correct / total) * 100)}%`
                  : "—";
                return (
                  <TableRow key={participant.id} hover>
                    <TableCell>
                      <Typography fontWeight={750}>
                        {participant.displayName ||
                          participant.user?.profile?.displayName ||
                          participant.user?.username ||
                          "Bot"}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {participant.user?.username ||
                          participant.participantType}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography fontWeight={800}>
                        {participant.finalScore ?? 0}
                      </Typography>
                    </TableCell>
                    <TableCell>{participant.answeredCount}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.6} alignItems="center">
                        <Chip
                          size="small"
                          color="success"
                          label={`${stats.correct} right`}
                        />
                        <Chip
                          size="small"
                          color={stats.wrong ? "error" : "default"}
                          label={`${stats.wrong} wrong`}
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {accuracy}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {averageTime(stats.totalTimeMs, total)}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={participant.result}
                        color={
                          participant.result === "WIN"
                            ? "success"
                            : participant.result === "LOSS" ||
                                participant.result === "FORFEIT"
                              ? "error"
                              : "default"
                        }
                      />
                    </TableCell>
                    <TableCell>{date(participant.submittedAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Section>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Section
            icon={<TimelineRoundedIcon />}
            title="Authoritative event timeline"
            description="Accepted answer actions show correctness, points, and server-recorded time taken. Rejected actions remain visible for diagnosis."
          >
            <Box sx={{ overflowX: "auto", maxHeight: 680 }}>
              <Table size="small" sx={{ minWidth: 760 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Received</TableCell>
                    <TableCell>Player</TableCell>
                    <TableCell>Question</TableCell>
                    <TableCell>Outcome</TableCell>
                    <TableCell>Time</TableCell>
                    <TableCell>Points</TableCell>
                    <TableCell>Sequence</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.events.map((event) => {
                    const details = event.answerDetails;
                    return (
                      <TableRow key={event.id} hover>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {date(event.serverReceivedAt)}
                        </TableCell>
                        <TableCell>
                          {playerLabel(event.participant.user)}
                        </TableCell>
                        <TableCell>
                          {details?.questionNumber ? (
                            `Question ${details.questionNumber}`
                          ) : (
                            <Typography fontWeight={700}>
                              {event.eventType}
                            </Typography>
                          )}
                          <Typography
                            variant="caption"
                            display="block"
                            color="text.secondary"
                          >
                            {event.participant.participantType}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {event.accepted ? (
                            details?.correct === true ? (
                              <Chip
                                size="small"
                                icon={<CheckCircleRoundedIcon />}
                                label="RIGHT"
                                color="success"
                              />
                            ) : details?.correct === false ? (
                              <Chip
                                size="small"
                                icon={<ErrorOutlineRoundedIcon />}
                                label="WRONG"
                                color="error"
                              />
                            ) : (
                              <Chip
                                size="small"
                                label="ACCEPTED"
                                color="success"
                              />
                            )
                          ) : (
                            <Chip
                              size="small"
                              icon={<ErrorOutlineRoundedIcon />}
                              label={event.rejectionReason || "REJECTED"}
                              color="error"
                            />
                          )}
                        </TableCell>
                        <TableCell>
                          {details?.timeTakenMs != null
                            ? `${details.timeTakenMs} ms`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          {details?.pointsEarned != null
                            ? details.pointsEarned
                            : "—"}
                        </TableCell>
                        <TableCell>{event.sequence}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
            {!data.events.length && (
              <Typography color="text.secondary" sx={{ p: 3 }}>
                No gameplay events were recorded.
              </Typography>
            )}
          </Section>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Section
            icon={<CalendarMonthRoundedIcon />}
            title="Rounds and assignments"
            description="Server-issued questions with answer state and timing. Answer keys remain private."
          >
            <Stack spacing={1.5} sx={{ p: 2.5 }}>
              {data.rounds.map((round) => (
                <Card key={round.id} variant="outlined" sx={{ p: 1.75 }}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography fontWeight={750}>
                      Round {round.roundIndex}
                    </Typography>
                    <Chip size="small" label={round.status} />
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {round.gameDefinition.name} · started{" "}
                    {date(round.startedAt)} · ended {date(round.endedAt)}
                  </Typography>
                </Card>
              ))}
              <Divider />
              {data.assignments.slice(0, 100).map((assignment) => {
                const details = assignment.answerDetails;
                return (
                  <Card
                    key={assignment.id}
                    variant="outlined"
                    sx={{
                      p: 1.75,
                      bgcolor: details ? "rgba(55,205,154,.04)" : undefined,
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Box>
                        <Typography fontWeight={700}>
                          {playerLabel(assignment.participant.user)} · Question{" "}
                          {assignment.position + 1}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {assignment.contentItem.category || "Uncategorized"} ·
                          difficulty {assignment.contentItem.difficulty}
                        </Typography>
                      </Box>
                      {details?.correct === true ? (
                        <Chip size="small" label="RIGHT" color="success" />
                      ) : details?.correct === false ? (
                        <Chip size="small" label="WRONG" color="error" />
                      ) : (
                        <Chip
                          size="small"
                          label={
                            assignment.answeredAt ? "ANSWERED" : "UNANSWERED"
                          }
                        />
                      )}
                    </Stack>
                    <Typography variant="body2" sx={{ mt: 1 }}>
                      {prompt(assignment.contentItem.prompt)}
                    </Typography>
                    <Stack
                      direction="row"
                      spacing={1.5}
                      sx={{ mt: 1 }}
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <Typography variant="caption" color="text.secondary">
                        Served {date(assignment.servedAt)}
                      </Typography>
                      {assignment.answeredAt && (
                        <Typography variant="caption" color="text.secondary">
                          Answered {date(assignment.answeredAt)}
                        </Typography>
                      )}
                      {details?.timeTakenMs != null && (
                        <Typography variant="caption" color="text.secondary">
                          <QueryBuilderRoundedIcon
                            sx={{ fontSize: 14, verticalAlign: "middle" }}
                          />{" "}
                          {details.timeTakenMs} ms
                        </Typography>
                      )}
                      {details?.pointsEarned != null && (
                        <Typography variant="caption" color="text.secondary">
                          {details.pointsEarned} points
                        </Typography>
                      )}
                    </Stack>
                  </Card>
                );
              })}
              {data.assignments.length > 100 && (
                <Typography variant="caption" color="text.secondary">
                  Showing the first 100 of {data.assignments.length}{" "}
                  assignments.
                </Typography>
              )}
              {!answeredAssignments.length && (
                <Typography color="text.secondary">
                  No assignments have been answered.
                </Typography>
              )}
            </Stack>
          </Section>
        </Grid>
      </Grid>

      <Section
        icon={<CalendarMonthRoundedIcon />}
        title="Settlement and server context"
        description="Immutable policy snapshot, lifecycle timestamps, and the recorded settlement decision."
      >
        <Box sx={{ p: { xs: 2.5, md: 3 } }}>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Typography variant="subtitle2" fontWeight={800}>
                Lifecycle
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Created {date(data.createdAt)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Updated {date(data.updatedAt)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Settled {date(data.settledAt)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Config v{data.gameConfig.version} ·{" "}
                {data.gameConfig.rewardCurrencyCode} ·{" "}
                {data.gameConfig.maxQuestions} assignments
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <Typography variant="subtitle2" fontWeight={800}>
                Settlement
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  mt: 1,
                }}
              >
                {json(data.settlement?.settlementJson || data.metadata)}
              </Typography>
            </Grid>
          </Grid>
        </Box>
      </Section>
      <Button
        startIcon={<ArrowBackRoundedIcon />}
        onClick={onBack}
        sx={{ alignSelf: "flex-start" }}
      >
        Back to matches
      </Button>
    </Stack>
  );
}
