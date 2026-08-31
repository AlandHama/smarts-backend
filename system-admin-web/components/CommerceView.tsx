"use client";

import { useEffect, useState, type FormEvent } from "react";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import Inventory2RoundedIcon from "@mui/icons-material/Inventory2Rounded";
import ShoppingBagRoundedIcon from "@mui/icons-material/ShoppingBagRounded";
import StorefrontRoundedIcon from "@mui/icons-material/StorefrontRounded";
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
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { api } from "../lib/api";
import { UserSelector, type SelectableUser } from "./UserSelector";
import type {
  CommerceAsset,
  CommerceCatalog,
  CommerceCatalogItem,
  CommerceInventoryItem,
  CommercePurchase,
  CurrencyDefinition,
  ProgressionDefinition,
} from "../lib/types";

const field = (form: HTMLFormElement, name: string) =>
  String(
    (form.elements.namedItem(name) as HTMLInputElement)?.value ?? "",
  ).trim();
const stableKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
const isPositiveInteger = (value: string) =>
  /^\d+$/.test(value) && value.replace(/^0+/, "").length > 0;
const json = (value: string, label: string) => {
  try {
    return value.trim() ? JSON.parse(value) : undefined;
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
};

function AssetDialog({
  asset,
  assets,
  onClose,
  onSaved,
}: {
  asset?: CommerceAsset;
  assets: CommerceAsset[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <Dialog open fullWidth maxWidth="md" onClose={onClose}>
      <DialogTitle>
        {asset ? "Edit asset definition" : "Create asset definition"}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Assets are owned by players. Use STACKABLE for consumables and UNIQUE
          for individual instances.
        </Typography>
      </DialogTitle>
      <form
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          try {
            const form = event.currentTarget;
            setError("");
            const key = stableKey(field(form, "key"));
            const duplicate = assets.find(
              (candidate) =>
                candidate.id !== asset?.id && candidate.key === key,
            );
            if (duplicate) {
              throw new Error(
                `An asset with the key "${key}" already exists. Choose a different stable key or edit "${duplicate.name}".`,
              );
            }
            const payload = {
              key,
              name: field(form, "name"),
              assetType: field(form, "assetType"),
              ownershipPolicy: field(form, "ownershipPolicy"),
              description: field(form, "description") || undefined,
              imageUrl: field(form, "imageUrl") || undefined,
              imageAlt: field(form, "imageAlt") || undefined,
              imageUrls: field(form, "imageUrls")
                ? json(field(form, "imageUrls"), "Image URLs")
                : undefined,
            };
            await api(
              asset ? `/commerce/assets/${asset.id}` : "/commerce/assets",
              {
                method: asset ? "PATCH" : "POST",
                body: JSON.stringify(payload),
              },
            );
            onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to save asset");
          }
        }}
      >
        <DialogContent>
          <Stack spacing={2}>
            {error && <Typography color="error.main">{error}</Typography>}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  name="key"
                  label="Stable asset key"
                  defaultValue={asset?.key ?? ""}
                  placeholder="avatar:gold-crown"
                  helperText="Spaces are converted to hyphens, for example Steam Gift → steam-gift."
                  fullWidth
                  required
                  disabled={Boolean(asset)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  name="name"
                  label="Display name"
                  defaultValue={asset?.name ?? ""}
                  fullWidth
                  required
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Select
                  name="assetType"
                  defaultValue={asset?.assetType ?? "COSMETIC"}
                  fullWidth
                >
                  <MenuItem value="COSMETIC">Cosmetic</MenuItem>
                  <MenuItem value="CONSUMABLE">Consumable</MenuItem>
                  <MenuItem value="CHARACTER">Character</MenuItem>
                  <MenuItem value="SKIN">Skin</MenuItem>
                  <MenuItem value="BOOSTER">Booster</MenuItem>
                  <MenuItem value="BUNDLE">Bundle</MenuItem>
                  <MenuItem value="OTHER">Other</MenuItem>
                </Select>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Select
                  name="ownershipPolicy"
                  defaultValue={asset?.ownershipPolicy ?? "STACKABLE"}
                  fullWidth
                >
                  <MenuItem value="STACKABLE">Stackable</MenuItem>
                  <MenuItem value="UNIQUE">Unique instances</MenuItem>
                </Select>
              </Grid>
              <Grid size={12}>
                <TextField
                  name="description"
                  label="Description"
                  defaultValue={asset?.description ?? ""}
                  multiline
                  minRows={2}
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField
                  name="imageUrl"
                  label="Primary image URL"
                  defaultValue={asset?.imageUrl ?? ""}
                  placeholder="https://cdn.example.com/item.png"
                  fullWidth
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  name="imageAlt"
                  label="Image alt text"
                  defaultValue={asset?.imageAlt ?? ""}
                  fullWidth
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  name="imageUrls"
                  label="Additional image URLs (JSON array)"
                  defaultValue={
                    asset?.imageUrls ? JSON.stringify(asset.imageUrls) : ""
                  }
                  placeholder='["https://cdn.example.com/front.png"]'
                  fullWidth
                />
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            {asset ? "Save asset" : "Create asset"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function CatalogDialog({
  catalog,
  onClose,
  onSaved,
}: {
  catalog?: CommerceCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>{catalog ? "Edit catalog" : "Create catalog"}</DialogTitle>
      <form
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = event.currentTarget;
          try {
            setError("");
            const payload = {
              key: stableKey(field(form, "key")),
              name: field(form, "name"),
              description: field(form, "description") || undefined,
              active: true,
            };
            await api(
              catalog
                ? `/commerce/catalogs/${catalog.id}`
                : "/commerce/catalogs",
              {
                method: catalog ? "PATCH" : "POST",
                body: JSON.stringify(payload),
              },
            );
            onSaved();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to save catalog");
          }
        }}
      >
        <DialogContent>
          <Stack spacing={2}>
            {error && <Typography color="error.main">{error}</Typography>}
            <TextField
              name="key"
              label="Catalog key"
              defaultValue={catalog?.key ?? ""}
              placeholder="main"
              fullWidth
              required
              disabled={Boolean(catalog)}
            />
            <TextField
              name="name"
              label="Catalog name"
              defaultValue={catalog?.name ?? ""}
              fullWidth
              required
            />
            <TextField
              name="description"
              label="Description"
              defaultValue={catalog?.description ?? ""}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            Save catalog
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

type CatalogPriceForm = {
  currencyCode: string;
  amount: string;
  active: boolean;
};

type CatalogRewardForm = {
  rewardType: string;
  assetKey: string;
  variationKey: string;
  currencyCode: string;
  progressionKey: string;
  targetKey: string;
  amount: string;
  quantity: string;
};

const emptyReward = (rewardType = "ASSET"): CatalogRewardForm => ({
  rewardType,
  assetKey: "",
  variationKey: "",
  currencyCode: "",
  progressionKey: "",
  targetKey: "",
  amount: "",
  quantity: "1",
});

function ItemDialog({
  item,
  catalogs,
  assets,
  currencies,
  progressions,
  onClose,
  onSaved,
}: {
  item?: CommerceCatalogItem;
  catalogs: CommerceCatalog[];
  assets: CommerceAsset[];
  currencies: CurrencyDefinition[];
  progressions: ProgressionDefinition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  const defaultPrices: CatalogPriceForm[] =
    item?.prices.map((price) => ({
      currencyCode: price.currency.code,
      amount: price.amount,
      active: price.active,
    })) ??
    (currencies[0]
      ? [{ currencyCode: currencies[0].code, amount: "100", active: true }]
      : []);
  const defaultRewards: CatalogRewardForm[] =
    item?.rewards.map((reward) => ({
      rewardType: reward.rewardType,
      assetKey: reward.assetDefinition?.key ?? "",
      variationKey: reward.assetVariation?.key ?? "",
      currencyCode: reward.currency?.code ?? "",
      progressionKey: reward.progressionDefinition?.key ?? "",
      targetKey: reward.targetKey ?? "",
      amount: reward.amount ?? "",
      quantity: String(reward.quantity ?? 1),
    })) ?? [];
  const [prices, setPrices] = useState<CatalogPriceForm[]>(defaultPrices);
  const [rewards, setRewards] =
    useState<CatalogRewardForm[]>(defaultRewards);
  const updateReward = (index: number, patch: Partial<CatalogRewardForm>) => {
    setRewards((current) =>
      current.map((reward, currentIndex) =>
        currentIndex === index ? { ...reward, ...patch } : reward,
      ),
    );
  };
  return (
    <Dialog open fullWidth maxWidth="lg" onClose={onClose}>
      <DialogTitle>
        {item ? "Edit catalog item" : "Create catalog item"}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          The server snapshots this price and reward bundle at purchase time.
          Never trust price data from the mobile client.
        </Typography>
      </DialogTitle>
      <form
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = event.currentTarget;
          try {
            setError("");
            if (!prices.length)
              throw new Error("At least one price is required");
            const normalizedPrices = prices.map((price) => {
              const amount = price.amount.trim();
              if (
                !price.currencyCode ||
                !isPositiveInteger(amount)
              ) {
                throw new Error(
                  "Each price needs a currency and a positive integer amount in minor units.",
                );
              }
              return {
                currencyCode: price.currencyCode,
                amount,
                active: price.active,
              };
            });
            const normalizedRewards = rewards.map((reward, index) => {
              const payload: Record<string, unknown> = {
                rewardType: reward.rewardType,
                quantity: Number(reward.quantity || "1"),
                sortOrder: index,
              };
              if (!Number.isInteger(payload.quantity) || Number(payload.quantity) < 1) {
                throw new Error("Reward quantities must be positive whole numbers.");
              }
              if (reward.rewardType === "ASSET") {
                if (!reward.assetKey) throw new Error("Select an asset for every asset reward.");
                payload.assetKey = reward.assetKey;
                if (reward.variationKey) payload.variationKey = reward.variationKey;
              } else if (reward.rewardType === "CURRENCY") {
                if (!reward.currencyCode) throw new Error("Select a currency for every currency reward.");
                if (!isPositiveInteger(reward.amount)) {
                  throw new Error("Currency rewards need a positive integer amount.");
                }
                payload.currencyCode = reward.currencyCode;
                payload.amount = reward.amount;
              } else if (reward.rewardType === "PROGRESSION_POINTS") {
                if (!reward.progressionKey) throw new Error("Select a progression for every points reward.");
                if (!isPositiveInteger(reward.amount)) {
                  throw new Error("Progression rewards need a positive integer amount.");
                }
                payload.progressionKey = reward.progressionKey;
                payload.amount = reward.amount;
              } else if (reward.rewardType === "PROGRESSION_RESET") {
                if (!reward.progressionKey) throw new Error("Select a progression for every reset reward.");
                payload.progressionKey = reward.progressionKey;
              } else if (reward.rewardType === "ENTITLEMENT") {
                if (!reward.targetKey.trim()) throw new Error("Enter an entitlement key.");
                payload.targetKey = stableKey(reward.targetKey);
                if (reward.assetKey) payload.assetKey = reward.assetKey;
              }
              return payload;
            });
            const payload = {
              ...(item ? {} : { catalogId: field(form, "catalogId") }),
              key: stableKey(field(form, "key")),
              name: field(form, "name"),
              assetKey: field(form, "assetKey") || undefined,
              description: field(form, "description") || undefined,
              imageUrl: field(form, "imageUrl") || undefined,
              imageAlt: field(form, "imageAlt") || undefined,
              prices: normalizedPrices,
              rewards: normalizedRewards,
              active: true,
              purchasable: true,
            };
            await api(item ? `/commerce/items/${item.id}` : "/commerce/items", {
              method: item ? "PATCH" : "POST",
              body: JSON.stringify(payload),
            });
            onSaved();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Unable to save catalog item",
            );
          }
        }}
      >
        <DialogContent>
          <Stack spacing={2}>
            {error && <Typography color="error.main">{error}</Typography>}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  name="key"
                  label="Stable item key"
                  defaultValue={item?.key ?? ""}
                  placeholder="gold-crown-bundle"
                  helperText="Spaces are converted to hyphens, for example Gold Crown → gold-crown."
                  fullWidth
                  required
                  disabled={Boolean(item)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  name="name"
                  label="Store name"
                  defaultValue={item?.name ?? ""}
                  fullWidth
                  required
                />
              </Grid>
              {!item && (
                <Grid size={12}>
                  <Select
                    name="catalogId"
                    defaultValue={catalogs[0]?.id ?? ""}
                    fullWidth
                    required
                  >
                    {catalogs.map((catalog) => (
                      <MenuItem key={catalog.id} value={catalog.id}>
                        {catalog.name} · {catalog.key}
                      </MenuItem>
                    ))}
                  </Select>
                </Grid>
              )}
              <Grid size={{ xs: 12, sm: 6 }}>
                <Select
                  name="assetKey"
                  defaultValue={item?.assetDefinition?.key ?? ""}
                  fullWidth
                  displayEmpty
                >
                  <MenuItem value="">
                    No primary asset (bundle/reward only)
                  </MenuItem>
                  {assets.map((asset) => (
                    <MenuItem key={asset.id} value={asset.key}>
                      {asset.name} · {asset.key}
                    </MenuItem>
                  ))}
                </Select>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  name="imageUrl"
                  label="Catalog image URL"
                  defaultValue={item?.imageUrl ?? ""}
                  fullWidth
                />
              </Grid>
              <Grid size={12}>
                <TextField
                  name="description"
                  label="Store description"
                  defaultValue={item?.description ?? ""}
                  multiline
                  minRows={2}
                  fullWidth
                />
              </Grid>
              <Grid size={12}>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ sm: "center" }}
                    spacing={1}
                  >
                    <Box>
                      <Typography fontWeight={800}>Prices</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Add one or more currencies. Amounts use integer minor units.
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      startIcon={<AddRoundedIcon />}
                      onClick={() =>
                        setPrices((current) => [
                          ...current,
                          {
                            currencyCode: currencies[0]?.code ?? "",
                            amount: "",
                            active: true,
                          },
                        ])
                      }
                    >
                      Add price
                    </Button>
                  </Stack>
                  {prices.map((price, index) => (
                    <Card key={`price-${index}`} variant="outlined" sx={{ p: 1.5 }}>
                      <Grid container spacing={1.5} alignItems="center">
                        <Grid size={{ xs: 12, sm: 5 }}>
                          <Select
                            value={price.currencyCode}
                            onChange={(event) =>
                              setPrices((current) =>
                                current.map((entry, currentIndex) =>
                                  currentIndex === index
                                    ? { ...entry, currencyCode: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            fullWidth
                            size="small"
                            displayEmpty
                          >
                            <MenuItem value="" disabled>Select currency</MenuItem>
                            {currencies.map((currency) => (
                              <MenuItem key={currency.id} value={currency.code}>
                                {currency.name} · {currency.code}
                              </MenuItem>
                            ))}
                          </Select>
                        </Grid>
                        <Grid size={{ xs: 12, sm: 4 }}>
                          <TextField
                            label="Amount (minor units)"
                            value={price.amount}
                            onChange={(event) =>
                              setPrices((current) =>
                                current.map((entry, currentIndex) =>
                                  currentIndex === index
                                    ? { ...entry, amount: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            type="number"
                            inputProps={{ min: 1, step: 1 }}
                            fullWidth
                            size="small"
                          />
                        </Grid>
                        <Grid size={{ xs: 9, sm: 2 }}>
                          <Select
                            value={price.active ? "active" : "inactive"}
                            onChange={(event) =>
                              setPrices((current) =>
                                current.map((entry, currentIndex) =>
                                  currentIndex === index
                                    ? { ...entry, active: event.target.value === "active" }
                                    : entry,
                                ),
                              )
                            }
                            fullWidth
                            size="small"
                          >
                            <MenuItem value="active">Active</MenuItem>
                            <MenuItem value="inactive">Inactive</MenuItem>
                          </Select>
                        </Grid>
                        <Grid size={{ xs: 3, sm: 1 }}>
                          <Button
                            color="error"
                            onClick={() => setPrices((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                            aria-label="Remove price"
                            fullWidth
                          >
                            <DeleteOutlineRoundedIcon />
                          </Button>
                        </Grid>
                      </Grid>
                    </Card>
                  ))}
                </Stack>
              </Grid>
              <Grid size={12}>
                <Stack spacing={1.5}>
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    justifyContent="space-between"
                    alignItems={{ sm: "center" }}
                    spacing={1}
                  >
                    <Box>
                      <Typography fontWeight={800}>Rewards</Typography>
                      <Typography variant="caption" color="text.secondary">
                        Configure the server-granted bundle without editing JSON.
                      </Typography>
                    </Box>
                    <Button
                      size="small"
                      startIcon={<AddRoundedIcon />}
                      onClick={() => setRewards((current) => [...current, emptyReward()])}
                    >
                      Add reward
                    </Button>
                  </Stack>
                  {rewards.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No rewards configured. Add one if this listing grants a bonus.
                    </Typography>
                  )}
                  {rewards.map((reward, index) => {
                    const selectedAsset = assets.find((asset) => asset.key === reward.assetKey);
                    return (
                      <Card key={`reward-${index}`} variant="outlined" sx={{ p: 1.5 }}>
                        <Grid container spacing={1.5} alignItems="center">
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Select
                              value={reward.rewardType}
                              onChange={(event) => updateReward(index, { ...emptyReward(event.target.value) })}
                              fullWidth
                              size="small"
                            >
                              <MenuItem value="ASSET">Asset</MenuItem>
                              <MenuItem value="CURRENCY">Currency</MenuItem>
                              <MenuItem value="PROGRESSION_POINTS">Progression points</MenuItem>
                              <MenuItem value="PROGRESSION_RESET">Progression reset</MenuItem>
                              <MenuItem value="ENTITLEMENT">Entitlement</MenuItem>
                            </Select>
                          </Grid>
                          {(reward.rewardType === "ASSET" || reward.rewardType === "ENTITLEMENT") && (
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <Select
                                value={reward.assetKey}
                                onChange={(event) => updateReward(index, { assetKey: event.target.value, variationKey: "" })}
                                fullWidth
                                size="small"
                                displayEmpty
                              >
                                <MenuItem value="">
                                  {reward.rewardType === "ASSET" ? "Select asset" : "Optional linked asset"}
                                </MenuItem>
                                {assets.map((asset) => (
                                  <MenuItem key={asset.id} value={asset.key}>
                                    {asset.name} · {asset.key}
                                  </MenuItem>
                                ))}
                              </Select>
                            </Grid>
                          )}
                          {reward.rewardType === "ASSET" && selectedAsset?.variations?.length ? (
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <Select
                                value={reward.variationKey}
                                onChange={(event) => updateReward(index, { variationKey: event.target.value })}
                                fullWidth
                                size="small"
                                displayEmpty
                              >
                                <MenuItem value="">Base asset</MenuItem>
                                {selectedAsset.variations.map((variation) => (
                                  <MenuItem key={variation.id} value={variation.key}>
                                    {variation.name || variation.key}
                                  </MenuItem>
                                ))}
                              </Select>
                            </Grid>
                          ) : null}
                          {reward.rewardType === "CURRENCY" && (
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <Select
                                value={reward.currencyCode}
                                onChange={(event) => updateReward(index, { currencyCode: event.target.value })}
                                fullWidth
                                size="small"
                                displayEmpty
                              >
                                <MenuItem value="" disabled>Select currency</MenuItem>
                                {currencies.map((currency) => (
                                  <MenuItem key={currency.id} value={currency.code}>
                                    {currency.name} · {currency.code}
                                  </MenuItem>
                                ))}
                              </Select>
                            </Grid>
                          )}
                          {(reward.rewardType === "PROGRESSION_POINTS" || reward.rewardType === "PROGRESSION_RESET") && (
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <Select
                                value={reward.progressionKey}
                                onChange={(event) => updateReward(index, { progressionKey: event.target.value })}
                                fullWidth
                                size="small"
                                displayEmpty
                              >
                                <MenuItem value="" disabled>Select progression</MenuItem>
                                {progressions.map((progression) => (
                                  <MenuItem key={progression.id} value={progression.key}>
                                    {progression.name} · {progression.key}
                                  </MenuItem>
                                ))}
                              </Select>
                            </Grid>
                          )}
                          {reward.rewardType === "ENTITLEMENT" && (
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label="Entitlement key"
                                value={reward.targetKey}
                                onChange={(event) => updateReward(index, { targetKey: event.target.value })}
                                fullWidth
                                size="small"
                              />
                            </Grid>
                          )}
                          {(reward.rewardType === "CURRENCY" || reward.rewardType === "PROGRESSION_POINTS") && (
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label={reward.rewardType === "CURRENCY" ? "Amount" : "Points"}
                                value={reward.amount}
                                onChange={(event) => updateReward(index, { amount: event.target.value })}
                                type="number"
                                inputProps={{ min: 1, step: 1 }}
                                fullWidth
                                size="small"
                              />
                            </Grid>
                          )}
                          {reward.rewardType === "ASSET" && (
                            <Grid size={{ xs: 12, sm: 4 }}>
                              <TextField
                                label="Quantity"
                                value={reward.quantity}
                                onChange={(event) => updateReward(index, { quantity: event.target.value })}
                                type="number"
                                inputProps={{ min: 1, step: 1 }}
                                fullWidth
                                size="small"
                              />
                            </Grid>
                          )}
                          <Grid size={{ xs: 12, sm: 1 }}>
                            <Button
                              color="error"
                              onClick={() => setRewards((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                              aria-label="Remove reward"
                              fullWidth
                            >
                              <DeleteOutlineRoundedIcon />
                            </Button>
                          </Grid>
                        </Grid>
                      </Card>
                    );
                  })}
                </Stack>
              </Grid>
            </Grid>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            {item ? "Save item" : "Create item"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function InventoryDialog({
  assets,
  action,
  initial,
  onClose,
  onSaved,
}: {
  assets: CommerceAsset[];
  action: "grant" | "revoke";
  initial?: {
    userId?: string;
    assetKey?: string;
    variationKey?: string;
    quantity?: number;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState("");
  const [selectedUser, setSelectedUser] = useState<SelectableUser | null>(null);
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose}>
      <DialogTitle>
        {action === "grant" ? "Grant inventory item" : "Revoke inventory item"}
      </DialogTitle>
      <form
        onSubmit={async (event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = event.currentTarget;
          try {
            setError("");
            if (!selectedUser)
              throw new Error("Select a player before continuing");
            const userId = selectedUser.id;
            await api(`/users/${userId}/commerce/inventory/${action}`, {
              method: "POST",
              body: JSON.stringify({
                assetKey: field(form, "assetKey"),
                variationKey: field(form, "variationKey") || undefined,
                quantity: Number(field(form, "quantity")),
                sourceId: field(form, "sourceId"),
                reason: field(form, "reason"),
                source: "ADMIN",
              }),
            });
            onSaved();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : `Unable to ${action} inventory`,
            );
          }
        }}
      >
        <DialogContent>
          <Stack spacing={2}>
            {error && <Typography color="error.main">{error}</Typography>}
            <UserSelector
              value={selectedUser}
              onChange={setSelectedUser}
              initialUserId={initial?.userId}
              required
              label="Player"
            />
            <Select
              name="assetKey"
              defaultValue={initial?.assetKey ?? assets[0]?.key ?? ""}
              fullWidth
              required
            >
              {assets.map((asset) => (
                <MenuItem key={asset.id} value={asset.key}>
                  {asset.name} · {asset.key}
                </MenuItem>
              ))}
            </Select>
            <TextField
              name="variationKey"
              label="Variation key (optional)"
              defaultValue={initial?.variationKey ?? ""}
              fullWidth
            />
            <TextField
              name="quantity"
              label="Quantity"
              type="number"
              defaultValue={initial?.quantity ?? 1}
              fullWidth
              required
            />
            <TextField
              name="sourceId"
              label="Source ID"
              placeholder="support-ticket-123"
              fullWidth
              required
            />
            <TextField
              name="reason"
              label="Reason"
              multiline
              minRows={2}
              fullWidth
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            color={action === "grant" ? "primary" : "warning"}
            variant="contained"
          >
            {action === "grant" ? "Grant item" : "Revoke item"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export function CommerceView() {
  const [tab, setTab] = useState(0);
  const [catalogs, setCatalogs] = useState<CommerceCatalog[]>([]);
  const [assets, setAssets] = useState<CommerceAsset[]>([]);
  const [inventory, setInventory] = useState<CommerceInventoryItem[]>([]);
  const [purchases, setPurchases] = useState<CommercePurchase[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyDefinition[]>([]);
  const [progressions, setProgressions] = useState<ProgressionDefinition[]>([]);
  const [catalogDialog, setCatalogDialog] = useState<
    CommerceCatalog | null | false
  >(false);
  const [assetDialog, setAssetDialog] = useState<CommerceAsset | null | false>(
    false,
  );
  const [itemDialog, setItemDialog] = useState<
    CommerceCatalogItem | null | false
  >(false);
  const [inventoryDialog, setInventoryDialog] = useState<
    | {
        action: "grant" | "revoke";
        initial?: {
          userId?: string;
          assetKey?: string;
          variationKey?: string;
          quantity?: number;
        };
      }
    | false
  >(false);
  const [error, setError] = useState("");
  const load = async () => {
    try {
      setError("");
      const results = await Promise.allSettled([
        api<CommerceCatalog[]>("/commerce/catalogs"),
        api<CommerceAsset[]>("/commerce/assets"),
        api<{ items: CommerceInventoryItem[] }>(
          "/commerce/inventory?limit=100",
        ),
        api<CommercePurchase[]>("/commerce/purchases"),
        api<CurrencyDefinition[]>("/economy/currencies"),
        api<ProgressionDefinition[]>("/progressions?includeInactive=true"),
      ]);

      const errors: string[] = [];
      const [catalogResult, assetResult, inventoryResult, purchaseResult, currencyResult, progressionResult] = results;
      if (catalogResult.status === "fulfilled") setCatalogs(catalogResult.value);
      else errors.push(catalogResult.reason instanceof Error ? catalogResult.reason.message : "Unable to load catalogs");
      if (assetResult.status === "fulfilled") setAssets(assetResult.value);
      else errors.push(assetResult.reason instanceof Error ? assetResult.reason.message : "Unable to load assets");
      if (inventoryResult.status === "fulfilled") setInventory(inventoryResult.value.items);
      else errors.push(inventoryResult.reason instanceof Error ? inventoryResult.reason.message : "Unable to load inventory");
      if (purchaseResult.status === "fulfilled") setPurchases(purchaseResult.value);
      else errors.push(purchaseResult.reason instanceof Error ? purchaseResult.reason.message : "Unable to load purchases");
      if (currencyResult.status === "fulfilled") setCurrencies(currencyResult.value);
      else errors.push(currencyResult.reason instanceof Error ? currencyResult.reason.message : "Unable to load currencies");
      if (progressionResult.status === "fulfilled") setProgressions(progressionResult.value);
      else errors.push(progressionResult.reason instanceof Error ? progressionResult.reason.message : "Unable to load progressions");
      setError(errors.join(" · "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load commerce data");
    }
  };
  useEffect(() => {
    load();
  }, []);
  const items = catalogs.flatMap((catalog) =>
    catalog.items.map((item) => ({ ...item, catalogName: catalog.name })),
  );
  const closeAndReload = () => {
    setCatalogDialog(false);
    setAssetDialog(false);
    setItemDialog(false);
    setInventoryDialog(false);
    load();
  };
  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: "column", lg: "row" }}
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Typography variant="h4" fontWeight={850}>
            Commerce
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.7 }}>
            Manage image-ready catalog listings, server prices, reward bundles,
            inventory, and purchases.
          </Typography>
        </Box>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <Button
            variant="outlined"
            startIcon={<Inventory2RoundedIcon />}
            onClick={() => setInventoryDialog({ action: "grant" })}
          >
            Grant inventory
          </Button>
          <Button
            variant="outlined"
            startIcon={<AddRoundedIcon />}
            onClick={() => setAssetDialog(null)}
          >
            New asset
          </Button>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={() => setItemDialog(null)}
          >
            New catalog item
          </Button>
        </Stack>
      </Stack>
      {error && <Typography color="error.main">{error}</Typography>}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card sx={{ p: 2.5 }}>
            <StorefrontRoundedIcon color="primary" />
            <Typography variant="h4" fontWeight={850} sx={{ mt: 1 }}>
              {items.length}
            </Typography>
            <Typography color="text.secondary">Catalog listings</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card sx={{ p: 2.5 }}>
            <Inventory2RoundedIcon color="secondary" />
            <Typography variant="h4" fontWeight={850} sx={{ mt: 1 }}>
              {inventory.length}
            </Typography>
            <Typography color="text.secondary">Inventory rows</Typography>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <Card sx={{ p: 2.5 }}>
            <ShoppingBagRoundedIcon color="success" />
            <Typography variant="h4" fontWeight={850} sx={{ mt: 1 }}>
              {purchases.length}
            </Typography>
            <Typography color="text.secondary">Recent purchases</Typography>
          </Card>
        </Grid>
      </Grid>
      <Card>
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          variant="scrollable"
        >
          <Tab label={`Catalogs · ${catalogs.length}`} />
          <Tab label={`Assets · ${assets.length}`} />
          <Tab label={`Inventory · ${inventory.length}`} />
          <Tab label={`Purchases · ${purchases.length}`} />
        </Tabs>
        <Divider />
        {tab === 0 && (
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            <Stack direction="row" justifyContent="flex-end" sx={{ mb: 2 }}>
              <Button
                startIcon={<AddRoundedIcon />}
                onClick={() => setCatalogDialog(null)}
              >
                New catalog
              </Button>
            </Stack>
            <Grid container spacing={2}>
              {catalogs.map((catalog) => (
                <Grid key={catalog.id} size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ p: 2.5, height: "100%" }}>
                    <Stack direction="row" justifyContent="space-between">
                      <Box>
                        <Typography variant="h6" fontWeight={800}>
                          {catalog.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {catalog.key} · {catalog.items.length} listings
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        onClick={() => setCatalogDialog(catalog)}
                      >
                        Edit
                      </Button>
                    </Stack>
                    <Divider sx={{ my: 2 }} />
                    <Stack spacing={1.5}>
                      {catalog.items.map((item) => (
                        <Stack
                          key={item.id}
                          direction="row"
                          spacing={1.5}
                          alignItems="center"
                        >
                          <Box
                            sx={{
                              width: 46,
                              height: 46,
                              borderRadius: 2,
                              overflow: "hidden",
                              bgcolor: "rgba(139,125,255,.12)",
                              display: "grid",
                              placeItems: "center",
                              flexShrink: 0,
                            }}
                          >
                            {item.imageUrl ? (
                              <Box
                                component="img"
                                src={item.imageUrl}
                                alt={item.imageAlt || item.name}
                                sx={{
                                  width: "100%",
                                  height: "100%",
                                  objectFit: "cover",
                                }}
                              />
                            ) : (
                              <StorefrontRoundedIcon color="primary" />
                            )}
                          </Box>
                          <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Typography fontWeight={750} noWrap>
                              {item.name}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              noWrap
                              display="block"
                            >
                              {item.key}
                            </Typography>
                            <Stack
                              direction="row"
                              spacing={0.5}
                              flexWrap="wrap"
                            >
                              {item.prices.map((price) => (
                                <Chip
                                  key={price.id}
                                  size="small"
                                  label={`${price.amount} ${price.currency.code}`}
                                />
                              ))}
                              {item.rewards.slice(0, 2).map((reward) => (
                                <Chip
                                  key={reward.id}
                                  size="small"
                                  variant="outlined"
                                  label={`${reward.rewardType}${reward.quantity > 1 ? ` ×${reward.quantity}` : ""}`}
                                />
                              ))}
                            </Stack>
                          </Box>
                          <Button
                            size="small"
                            onClick={() => setItemDialog(item)}
                          >
                            Edit
                          </Button>
                        </Stack>
                      ))}
                    </Stack>
                  </Card>
                </Grid>
              ))}
              {!catalogs.length && (
                <Grid size={12}>
                  <Typography
                    color="text.secondary"
                    align="center"
                    sx={{ py: 5 }}
                  >
                    Create the first catalog, then add listings with images and
                    prices.
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Box>
        )}
        {tab === 1 && (
          <Box sx={{ p: { xs: 2, md: 3 } }}>
            <Grid container spacing={2}>
              {assets.map((asset) => (
                <Grid key={asset.id} size={{ xs: 12, sm: 6, lg: 4 }}>
                  <Card variant="outlined" sx={{ overflow: "hidden" }}>
                    {asset.imageUrl && (
                      <Box
                        component="img"
                        src={asset.imageUrl}
                        alt={asset.imageAlt || asset.name}
                        sx={{ width: "100%", height: 140, objectFit: "cover" }}
                      />
                    )}
                    <Box sx={{ p: 2 }}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography fontWeight={800}>{asset.name}</Typography>
                        <Button
                          size="small"
                          onClick={() => setAssetDialog(asset)}
                        >
                          Edit
                        </Button>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {asset.key}
                      </Typography>
                      <Stack direction="row" spacing={0.7} sx={{ mt: 1 }}>
                        <Chip size="small" label={asset.assetType} />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={asset.ownershipPolicy}
                        />
                      </Stack>
                    </Box>
                  </Card>
                </Grid>
              ))}
              {!assets.length && (
                <Grid size={12}>
                  <Typography
                    color="text.secondary"
                    align="center"
                    sx={{ py: 5 }}
                  >
                    No assets defined yet.
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Box>
        )}
        {tab === 2 && (
          <Box sx={{ p: { xs: 1, md: 3 }, overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Player</TableCell>
                  <TableCell>Asset</TableCell>
                  <TableCell>Quantity</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Granted</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {inventory.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Typography fontWeight={700}>
                        {row.user.profile?.displayName || row.user.username}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.user.username}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {row.assetDefinition.name}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        display="block"
                      >
                        {row.assetVariation?.name || row.assetDefinition.key}
                      </Typography>
                    </TableCell>
                    <TableCell>{row.quantity}</TableCell>
                    <TableCell>
                      <Chip size="small" label={row.acquisitionSource} />
                    </TableCell>
                    <TableCell>
                      {new Date(row.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="small"
                        color="warning"
                        onClick={() =>
                          setInventoryDialog({
                            action: "revoke",
                            initial: {
                              userId: row.userId,
                              assetKey: row.assetDefinition.key,
                              variationKey:
                                row.assetVariation?.key || undefined,
                              quantity: row.quantity,
                            },
                          })
                        }
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!inventory.length && (
              <Typography color="text.secondary" align="center" sx={{ py: 5 }}>
                No inventory has been granted yet.
              </Typography>
            )}
          </Box>
        )}
        {tab === 3 && (
          <Box sx={{ p: { xs: 1, md: 3 }, overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Player</TableCell>
                  <TableCell>Listing</TableCell>
                  <TableCell>Total</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Created</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {purchases.map((purchase) => (
                  <TableRow key={purchase.id}>
                    <TableCell>
                      <Typography fontWeight={700}>
                        {purchase.user.profile?.displayName ||
                          purchase.user.username}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {purchase.user.username}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {purchase.lines.map((line) => (
                        <Typography key={line.itemKeySnapshot} variant="body2">
                          {line.itemNameSnapshot} ×{line.quantity}
                        </Typography>
                      ))}
                    </TableCell>
                    <TableCell>
                      {purchase.totalAmount} {purchase.currency.code}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={
                          purchase.status === "COMPLETED"
                            ? "success"
                            : "warning"
                        }
                        label={purchase.status}
                      />
                    </TableCell>
                    <TableCell>
                      {new Date(purchase.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!purchases.length && (
              <Typography color="text.secondary" align="center" sx={{ py: 5 }}>
                No purchases have been completed yet.
              </Typography>
            )}
          </Box>
        )}
      </Card>
      {catalogDialog !== false && (
        <CatalogDialog
          catalog={catalogDialog || undefined}
          onClose={() => setCatalogDialog(false)}
          onSaved={closeAndReload}
        />
      )}
      {assetDialog !== false && (
        <AssetDialog
          asset={assetDialog || undefined}
          assets={assets}
          onClose={() => setAssetDialog(false)}
          onSaved={closeAndReload}
        />
      )}
      {itemDialog !== false && (
        <ItemDialog
          item={itemDialog || undefined}
          catalogs={catalogs}
          assets={assets}
          currencies={currencies}
          progressions={progressions}
          onClose={() => setItemDialog(false)}
          onSaved={closeAndReload}
        />
      )}
      {inventoryDialog !== false && (
        <InventoryDialog
          assets={assets}
          action={inventoryDialog.action}
          initial={inventoryDialog.initial}
          onClose={() => setInventoryDialog(false)}
          onSaved={closeAndReload}
        />
      )}
    </Stack>
  );
}
