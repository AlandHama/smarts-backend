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
  isMobileSession: boolean;
  deviceName: string | null;
  deviceInfo: string | null;
  ipAddress: string | null;
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
