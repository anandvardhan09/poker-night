/** Two-character card code: rank (2-9, T, J, Q, K, A) + suit (s, h, d, c), e.g. "As", "Td". */
export type Card = string;

export type Street = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export type SeatStatus = 'active' | 'sitting_out' | 'disconnected';

export type PlayerActionType = 'fold' | 'check' | 'call' | 'raise';

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
}

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  chipBalance: number;
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
