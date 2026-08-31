export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BANNED';

export interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  status: UserStatus;
  isSystemAdmin: boolean;
  createdAt: string;
  lastOnline: string | null;
  _count?: { sessions: number };
  profile: { displayName: string; avatarUrl: string | null; countryCode: string | null; bio?: string | null; level: number; xp: string; elo: number } | null;
  stats: { gamesPlayed: number; wins: number; losses: number; draws: number; currentWinStreak: number; highestWinStreak: number; highestElo: number; totalScore: string } | null;
  wallet?: WalletSummary;
  progressions?: PlayerProgression[];
  sessions?: SessionSummary[];
}

export interface WalletSummary {
  id: string;
  status: string;
  balances: WalletBalance[];
  transactions?: WalletLedgerEntry[];
}

export interface WalletBalance {
  id?: string;
  amount: string;
  currency: { code: string; name: string; kind?: string };
}

export interface WalletLedgerEntry {
  id: string;
  direction: 'CREDIT' | 'DEBIT' | 'REVERSAL';
  amount: string;
  balanceBefore: string;
  balanceAfter: string;
  sourceType: string;
  sourceId: string;
  grantKey: string | null;
  createdAt: string;
  currency: { code: string; name: string };
}

export interface PlayerProgression {
  id: string;
  points: string;
  step: number;
  previousThreshold: string;
  nextThreshold: string | null;
  progression: { key: string; name: string; kind: string; active: boolean };
}

export interface SessionSummary {
  id: string;
  sessionStatus: string;
  expiresAt: string;
  isMobileSession: boolean;
  deviceName: string | null;
  deviceInfo: string | null;
  ipAddress: string | null;
  location: string | null;
  lastActiveTimestamp: string;
}

export interface RewardDefinition {
  id: string;
  rewardType: string;
  amount: string | null;
  targetKey: string | null;
  targetProgression: { key: string; name: string } | null;
  currency: { code: string; name: string } | null;
}

export interface ProgressionTier {
  id: string;
  step: number;
  pointsThreshold: string;
  name: string | null;
  rewards: RewardDefinition[];
}

export interface ProgressionDefinition {
  id: string;
  key: string;
  name: string;
  kind: string;
  active: boolean;
  allowNegative: boolean;
  resetPolicy: string;
  tiers: ProgressionTier[];
}

export interface CurrencyDefinition {
  id: string;
  code: string;
  name: string;
  kind: string;
  precision: number;
  active: boolean;
  _count?: { balances: number; transactions: number };
}

export interface LeaderboardSeason {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'SCHEDULED' | 'ACTIVE' | 'CLOSED';
  resetAt?: string | null;
}

export interface LeaderboardDefinition {
  id: string;
  key: string;
  name: string;
  memberType: 'PLAYER' | 'COUNTRY' | 'GENERIC';
  period: 'ALL_TIME' | 'WEEKLY' | 'MONTHLY' | 'SEASONAL';
  direction: 'ASCENDING' | 'DESCENDING';
  writePolicy: 'SERVER_ONLY' | 'AUTHENTICATED_COMMAND';
  active: boolean;
  seasons?: LeaderboardSeason[];
  _count?: { seasons: number; entries: number };
}

export interface LeaderboardEntry {
  id: string;
  memberKey: string;
  playerId: string | null;
  score: string;
  rank: string | number;
  player: { username: string; displayName: string | null; avatarUrl: string | null; countryCode: string | null } | null;
}

export interface GameConfigRecord {
  id: string;
  key: string;
  name: string;
  active: boolean;
  config: {
    id: string;
    version: number;
    active: boolean;
    mainProgressionKey: string;
    eloProgressionKey: string;
    rewardCurrencyCode: string;
    scoreMultiplierForXp: string;
    maxEloDelta: number;
    soloEloScoreDivisor: number;
    soloEloMaxDelta: number;
    winnerBaseReward: string;
    loserBaseReward: string;
    drawReward: string;
    scoreRewardDivisor: number;
    scoreRewardCap: string;
    winnerRewardBonusMax: string;
    loserRewardBonusMax: string;
    multiplayerRewardReference: string;
    correctAnswerPoints: Record<string, number>;
    wrongAnswerPenaltyPercent: number;
    maxAnswerTimeSeconds: number;
    maxMatchDurationSeconds: number;
    maxQuestions: number;
    rankingEnabled: boolean;
    rankingEloMultiplier: string;
    rankingLevelMultiplier: string;
    rankingCoinMultiplier: string;
    settings: Record<string, unknown> | null;
  } | null;
  _count?: { matches: number; content: number };
}

export interface TopPlayer {
  rank: number;
  playerId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  countryCode: string | null;
  points?: string;
  amount?: string;
  score?: string;
  step?: number;
  progression?: { key: string; name: string };
  currency?: { code: string; name: string };
}

export interface OverviewMetrics { totalUsers: number; activeUsers: number; bannedUsers: number; activeAdmins: number; activeSessions: number; }

export interface CommerceAsset { id: string; key: string; name: string; description: string | null; assetType: string; ownershipPolicy: string; imageUrl: string | null; imageAlt: string | null; imageUrls?: string[] | null; active: boolean; variations?: Array<{ id: string; key: string; name: string | null }> }
export interface CommerceCatalogItem { id: string; catalogId: string; key: string; name: string; description: string | null; assetDefinitionId: string | null; assetDefinition?: { id: string; key: string; name: string; imageUrl: string | null } | null; imageUrl: string | null; imageAlt: string | null; imageUrls?: string[] | null; purchasable: boolean; active: boolean; prices: Array<{ id: string; amount: string; active: boolean; currency: { code: string; name: string; precision?: number } }>; rewards: Array<{ id: string; rewardType: string; amount: string | null; quantity: number; targetKey: string | null; assetDefinition: { key: string; name: string; imageUrl: string | null } | null; assetVariation: { key: string; name: string | null; imageUrl?: string | null } | null; currency: { code: string; name: string } | null; progressionDefinition: { key: string; name: string } | null }> }
export interface CommerceCatalog { id: string; key: string; name: string; description: string | null; active: boolean; items: CommerceCatalogItem[] }
export interface CommerceInventoryItem { id: string; instanceId: string; userId: string; quantity: number; acquisitionSource: string; sourceId: string; createdAt: string; user: { username: string; email: string | null; profile: { displayName: string } | null }; assetDefinition: { key: string; name: string; imageUrl: string | null; ownershipPolicy: string }; assetVariation: { key: string; name: string | null } | null }
export interface CommercePurchase { id: string; status: string; totalAmount: string; createdAt: string; completedAt: string | null; user: { username: string; email: string | null; profile: { displayName: string } | null }; currency: { code: string; name: string }; lines: Array<{ itemKeySnapshot: string; itemNameSnapshot: string; quantity: number; totalAmount: string }> }

export interface Player360Data {
  user: AdminUser;
  inventory: Array<{
    id: string;
    instanceId: string;
    quantity: number;
    acquisitionSource: string;
    sourceId: string;
    rentalExpiresAt: string | null;
    createdAt: string;
    updatedAt: string;
    assetDefinition: { id: string; key: string; name: string; assetType: string; ownershipPolicy: string; imageUrl: string | null };
    assetVariation: { id: string; key: string; name: string | null; imageUrl: string | null } | null;
  }>;
  entitlements: Array<{
    id: string;
    entitlementKey: string;
    status: string;
    sourceType: string;
    sourceId: string;
    expiresAt: string | null;
    createdAt: string;
    assetDefinition: { key: string; name: string; imageUrl: string | null } | null;
  }>;
  purchases: Array<{
    id: string;
    status: string;
    totalAmount: string;
    createdAt: string;
    completedAt: string | null;
    currency: { code: string; name: string };
    lines: Array<{ id: string; itemKeySnapshot: string; itemNameSnapshot: string; quantity: number; unitAmount: string; totalAmount: string; createdAt: string; catalogItem: { key: string; name: string; imageUrl: string | null } | null }>;
  }>;
  leaderboardEntries: Array<{ id: string; memberKey: string; score: string; createdAt: string; updatedAt: string; leaderboard: { key: string; name: string; period: string; direction: string }; season: { id: string; status: string; startsAt: string; endsAt: string } }>;
  leaderboardScoreEvents: Array<{ id: string; delta: string; scoreBefore: string; scoreAfter: string; sourceType: string; sourceId: string; createdAt: string; leaderboard: { key: string; name: string }; season: { id: string; status: string } }>;
  progressionEvents: Array<{ id: string; delta: string; balanceBefore: string; balanceAfter: string; sourceType: string; sourceId: string; createdAt: string; progression: { key: string; name: string; kind: string } }>;
  rewardGrants: Array<{ id: string; sourceType: string; sourceId: string; rewardType: string; grantKey: string; amount: string | null; targetKey: string | null; status: string; createdAt: string; currency: { code: string; name: string } | null; progressionDefinition: { key: string; name: string } | null }>;
  gameStats: Array<{ id: string; gamesPlayed: number; wins: number; losses: number; draws: number; forfeits: number; totalCorrect: number; totalQuestions: number; totalTimeMs: string; totalScore: string; bestScore: string; lastPlayedAt: string | null; gameDefinition: { key: string; name: string } }>;
  matches: Array<{ id: string; finalScore: number | null; answeredCount: number; result: string; submittedAt: string | null; createdAt: string; match: { id: string; mode: string; status: string; startedAt: string | null; endedAt: string | null; settledAt: string | null; createdAt: string; gameDefinition: { key: string; name: string } } }>;
}

export interface AdminSession {
  id: string;
  sessionStatus: 'ACTIVE' | 'TERMINATED';
  effectiveStatus: 'ACTIVE' | 'EXPIRED' | 'TERMINATED';
  isMobileSession: boolean;
  clientVersion: string | null;
  deviceName: string | null;
  deviceInfo: string | null;
  ipAddress: string | null;
  location: string | null;
  loginTimestamp: string;
  lastActiveTimestamp: string;
  expiresAt: string;
  user: { id: string; username: string; email: string | null; isSystemAdmin: boolean; profile: { displayName: string } | null };
}
