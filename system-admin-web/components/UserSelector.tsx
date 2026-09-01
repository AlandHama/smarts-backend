"use client";

import { useEffect, useState } from "react";

import Autocomplete from "@mui/material/Autocomplete";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";

import { api } from "../lib/api";

export interface SelectableUser {
  id: string;
  username: string;
  email: string | null;
  status?: string;
  isSystemAdmin?: boolean;
  profile?: { displayName: string } | null;
}

export function UserSelector({
  value,
  onChange,
  initialUserId,
  label = "Select player",
  required = false,
  disabled = false,
}: {
  value: SelectableUser | null;
  onChange: (user: SelectableUser | null) => void;
  initialUserId?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  const [options, setOptions] = useState<SelectableUser[]>(
    value ? [value] : [],
  );
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!initialUserId || value) return;
    api<SelectableUser>(`/users/${initialUserId}`)
      .then((user) => {
        setOptions((current) => [user, ...current]);
        onChange(user);
      })
      .catch(() => undefined);
  }, [initialUserId, value, onChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!query.trim()) return;
      setLoading(true);
      api<{ items: SelectableUser[] }>(
        `/users?search=${encodeURIComponent(query.trim())}&limit=20`,
      )
        .then((body) => setOptions(body.items))
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  return (
    <Autocomplete
      fullWidth
      disabled={disabled}
      options={options}
      value={value}
      loading={loading}
      onChange={(_, next) => onChange(next)}
      onInputChange={(_, next) => setQuery(next)}
      isOptionEqualToValue={(option, selected) => option.id === selected.id}
      getOptionLabel={(user) => user.profile?.displayName || user.username}
      filterOptions={(items) => items}
      noOptionsText={
        query.trim() ? "No matching users" : "Type a username, name, or email"
      }
      renderOption={(props, user) => (
        <li {...props} key={user.id}>
          <span>
            <strong>{user.profile?.displayName || user.username}</strong>
            <br />
            <small>
              {user.username}
              {user.email ? ` · ${user.email}` : ""}
              {user.isSystemAdmin ? " · ADMIN" : ""}
            </small>
          </span>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required && !value}
          placeholder="Search username, name, or email"
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? (
                  <CircularProgress color="inherit" size={18} />
                ) : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}
