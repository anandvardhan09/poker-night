import type {
  Card,
  HandPlayer,
  HandWinner,
  LeaderboardEntry,
  Profile,
  SeatStatus,
  TableMode,
  Variant,
} from '@pk/shared';
import type { GameState, HandActionRecord } from '../engine';

export interface AuthUser {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Table options as saved. The password is stored only as a hash. */
export interface StoredSettings {
  variant: Variant;
  mode: TableMode;
  isPrivate: boolean;
  passwordHash: string | null;
  turnSeconds: number;
  straddle: boolean;
  runItTwice: boolean;
  blindLevelMinutes: number;
  sngBuyIn: number;
  sngStartingStack: number;
}

export interface TableRow {
  id: string;
  name: string;
  hostId: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  status: 'open' | 'closed';
  createdAt: string;
  settings: StoredSettings;
}

export interface SeatRow {
  tableId: string;
  seatNo: number;
  userId: string;
  stack: number;
  status: SeatStatus;
}

export interface RecordedPlayer extends Omit<HandPlayer, 'cards'> {
  cards: Card[];
  /** Cards were shown at showdown, so anyone may see them. */
  shown: boolean;
  isBot: boolean;
  vpip: boolean;
  pfr: boolean;
  won: boolean;
  potWon: number;
}

export interface HandDetails {
  board2: Card[] | null;
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  players: RecordedPlayer[];
}

export interface HandHistoryRow {
  tableId: string;
  handNo: number;
  board: Card[];
  actions: HandActionRecord[];
  winners: HandWinner[];
  details: HandDetails;
}

export interface StoredHand extends HandHistoryRow {
  createdAt: string;
}

/** One player's summary of one hand, used for stats. */
export interface PlayerHandRow {
  userId: string;
  net: number;
  vpip: boolean;
  pfr: boolean;
  won: boolean;
  potWon: number;
}

export class InsufficientChipsError extends Error {
  constructor() {
    super('Not enough chips');
  }
}

export class RefillUnavailableError extends Error {
  constructor() {
    super('Your daily top-up is not available yet');
  }
}

export interface Store {
  /** Creates the profile with starting chips on first login; refreshes name/avatar otherwise. */
  upsertProfile(user: AuthUser): Promise<Profile>;
  getProfile(id: string): Promise<Profile | null>;
  getProfiles(ids: string[]): Promise<Profile[]>;
  /** Atomically adds `delta` (may be negative). Throws InsufficientChipsError if it would go below zero. */
  adjustBalance(userId: string, delta: number): Promise<number>;
  /** Tops the balance up to `amount` at most once per `intervalMs`. Throws RefillUnavailableError otherwise. */
  claimRefill(userId: string, amount: number, intervalMs: number): Promise<Profile>;

  createTable(row: Omit<TableRow, 'createdAt' | 'status'>): Promise<TableRow>;
  getTable(id: string): Promise<TableRow | null>;
  listTables(): Promise<TableRow[]>;
  updateTable(
    id: string,
    patch: Partial<Pick<TableRow, 'status' | 'settings' | 'smallBlind' | 'bigBlind'>>,
  ): Promise<void>;

  saveSnapshot(tableId: string, state: GameState): Promise<void>;
  loadSnapshot(tableId: string): Promise<GameState | null>;

  /** Replaces all seat rows for a table. */
  saveSeats(tableId: string, seats: SeatRow[]): Promise<void>;
  listSeats(): Promise<SeatRow[]>;

  addHandHistory(row: HandHistoryRow): Promise<void>;
  listHandHistory(tableId: string, limit: number): Promise<StoredHand[]>;
  listPlayerHands(userId: string): Promise<PlayerHandRow[]>;
  /** Top players by balance, optionally limited to some users. */
  leaderboard(limit: number, userIds?: string[]): Promise<LeaderboardEntry[]>;

  listFriends(userId: string): Promise<string[]>;
  addFriend(userId: string, friendId: string): Promise<void>;
  removeFriend(userId: string, friendId: string): Promise<void>;
}
