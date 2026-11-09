"use client";

import { useEffect, useState } from "react";

import Avatar from "@mui/material/Avatar";
import type { SxProps, Theme } from "@mui/material/styles";

type PlayerAvatarProps = {
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  size?: number;
  sx?: SxProps<Theme>;
};

const initialsFor = (name?: string | null, username?: string | null) => {
  const value = (name || username || "Player").trim();
  const parts = value.split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0][0]}${parts[1][0]}`
    : value.slice(0, 2)
  ).toUpperCase();
};

export function PlayerAvatar({
  name,
  username,
  avatarUrl,
  size = 38,
  sx,
}: PlayerAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [avatarUrl]);

  return (
    <Avatar
      src={avatarUrl && !imageFailed ? avatarUrl : undefined}
      alt={name || username || "Player"}
      imgProps={{
        onError: () => setImageFailed(true),
      }}
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        bgcolor: "rgba(82,199,245,.14)",
        color: "secondary.light",
        fontWeight: 800,
        fontSize: Math.max(12, Math.round(size * 0.36)),
        ...sx,
      }}
    >
      {initialsFor(name, username)}
    </Avatar>
  );
}
