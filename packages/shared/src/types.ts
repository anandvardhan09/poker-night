/** Two-character card code: rank (2-9, T, J, Q, K, A) + suit (s, h, d, c), e.g. "As", "Td". */
export type Card = string;

export type Street = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type SeatStatus = 'active' | 'sitting_out' | 'disconnected';

export type PlayerActionType = 'fold' | 'check' | 'call' | 'raise';

/** Hold'em is no-limit; Omaha is pot-limit with four hole cards. */
export type Variant = 'holdem' | 'omaha';
export type TableMode = 'cash' | 'sng';

/** An action chosen before your turn, applied automatically when it comes. */
export type PreAction = 'check_fold' | 'check' | 'call_any';

export interface TableSettings {
  variant: Variant;
  mode: TableMode;
  /** Hidden from the lobby; reachable by link only. */
  isPrivate: boolean;
  hasPassword: boolean;
  turnSeconds: number;
  straddle: boolean;
  runItTwice: boolean;
  /** Minutes per blind level; 0 = fixed blinds. */
  blindLevelMinutes: number;
  /** Sit & Go only. */
  sngBuyIn: number;
  sngStartingStack: number;
}

export interface BlindLevelInfo {
  level: number;
  nextLevelAt: number | null;
  nextSmallBlind: number | null;
  nextBigBlind: number | null;
}

export type TournamentStatus = 'registering' | 'running' | 'finished';

export interface TournamentPlace {
  userId: string;
  name: string;
  place: number;
  prize: number;
}

export interface TournamentInfo {
  status: TournamentStatus;
  entrants: number;
  prizePool: number;
  payouts: number[];
  results: TournamentPlace[];
}

export interface SessionEntry {
  userId: string;
  name: string;
  buyIn: number;
  cashOut: number;
  /** Chips currently on the table (0 if not seated). */
  onTable: number;
  net: number;
}

export interface Spectator {
  userId: string;
  name: string;
  avatarUrl: string | null;
  /** Non-zero when this spectator receives video. */
  rtcEpoch: number;
}

export interface WaitlistEntry {
  userId: string;
  name: string;
}

export interface PlayerAction {
  type: PlayerActionType;
  /** For `raise`: the total bet for this street the player is raising to. */
  amount?: number;
}

export interface PublicSeat {
  seatNo: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  folded: boolean;
  allIn: boolean;
  inHand: boolean;
  status: SeatStatus;
  connected: boolean;
  /** Visible only to the owner, or to everyone at showdown. */
  cards: Card[] | null;
  hasCards: boolean;
  lastAction: string | null;
  camOn: boolean;
  micOn: boolean;
  /** Changes every time the player (re)joins; used to reset WebRTC peers. */
  rtcEpoch: number;
  isBot: boolean;
  timeBankMs: number;
  /** Owner only. */
  preAction: PreAction | null;
  wantsStraddle: boolean;
  ritOptIn: boolean;
}

export interface Pot {
  amount: number;
  eligibleSeats: number[];
}

export interface HandWinner {
  seatNo: number;
  userId: string;
  name: string;
  amount: number;
  handName: string | null;
}

export interface RevealedHand {
  seatNo: number;
  cards: Card[];
  handName: string;
}

export interface HandResult {
  handNo: number;
  showdown: boolean;
  winners: HandWinner[];
  revealed: RevealedHand[];
  board: Card[];
  /** Set when the board was run twice. */
  board2?: Card[] | null;
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  /** Chips needed to call, or null if calling isn't an option. */
  call: number | null;
  /** Raise-to bounds, or null if raising isn't allowed. */
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
}

export interface LogEntry {
  ts: number;
  text: string;
}

export interface TableState {
  id: string;
  name: string;
  hostId: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  seats: (PublicSeat | null)[];
  street: Street;
  board: Card[];
  pots: Pot[];
  /** All chips committed this hand, including bets in front of players. */
  potTotal: number;
  currentBet: number;
  dealerSeat: number;
  toAct: number | null;
  actionDeadline: number | null;
  nextHandAt: number | null;
  handNo: number;
  result: HandResult | null;
  log: LogEntry[];
  mySeat: number | null;
  legal: LegalActions | null;
  serverTime: number;
  /** Second board while running it twice. */
  board2: Card[] | null;
  settings: TableSettings;
  paused: boolean;
  actionTimeoutMs: number;
  bombPotNext: boolean;
  blinds: BlindLevelInfo;
  tournament: TournamentInfo | null;
  spectators: Spectator[];
  waitlist: WaitlistEntry[];
  session: SessionEntry[];
  /** Whether the viewer may still show their cards for this finished hand. */
  canShowCards: boolean;
}

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  chipBalance: number;
  /** When the last daily refill was claimed (ms), or null. */
  lastRefillAt: number | null;
}

export interface HandPlayer {
  userId: string;
  name: string;
  seatNo: number;
  startStack: number;
  net: number;
  /** Hole cards; only included for the viewer or when shown. */
  cards: Card[] | null;
}

export interface HandAction {
  street: Street;
  seatNo: number;
  userId: string;
  action: string;
  amount: number;
  ts: number;
}

export interface HandHistoryEntry {
  handNo: number;
  createdAt: string;
  dealerSeat: number;
  smallBlind: number;
  bigBlind: number;
  board: Card[];
  board2: Card[] | null;
  actions: HandAction[];
  winners: HandWinner[];
  players: HandPlayer[];
}

export interface PlayerStats {
  userId: string;
  name: string;
  avatarUrl: string | null;
  hands: number;
  /** Percentages 0-100. */
  vpip: number;
  pfr: number;
  winRate: number;
  handsWon: number;
  net: number;
  biggestPot: number;
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  chipBalance: number;
  hands: number;
  net: number;
}

export interface FriendInfo {
  userId: string;
  name: string;
  avatarUrl: string | null;
  online: boolean;
  /** Tables the friend currently has open. */
  tables: { id: string; name: string }[];
}

export interface TableSummary {
  id: string;
  name: string;
  hostId: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  seated: number;
  /** Whether the current user holds a seat at this table. */
  mine: boolean;
  variant: Variant;
  mode: TableMode;
  hasPassword: boolean;
  isPrivate: boolean;
  tournamentStatus: TournamentStatus | null;
  spectators: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  name: string;
  text: string;
  ts: number;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}
