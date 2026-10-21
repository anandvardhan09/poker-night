import type {
  ChatMessage,
  FriendInfo,
  HandHistoryEntry,
  IceServerConfig,
  LeaderboardEntry,
  PlayerAction,
  PlayerStats,
  PreAction,
  Profile,
  SessionEntry,
  TableMode,
  TableSettings,
  TableState,
  TableSummary,
  Variant,
} from './types';

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T> = (res: AckResult<T>) => void;

export interface CreateTableInput {
  name: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  variant?: Variant;
  mode?: TableMode;
  isPrivate?: boolean;
  /** Optional password; empty means none. */
  password?: string;
  turnSeconds?: number;
  straddle?: boolean;
  runItTwice?: boolean;
  blindLevelMinutes?: number;
  sngBuyIn?: number;
  sngStartingStack?: number;
}

/** Settings the host can change while the table is running. */
export type EditableSettings = Pick<
  TableSettings,
  'turnSeconds' | 'straddle' | 'runItTwice' | 'blindLevelMinutes' | 'isPrivate'
>;

export type HostOp =
  | { type: 'pause'; paused: boolean }
  | { type: 'blinds'; smallBlind: number; bigBlind: number }
  | { type: 'settings'; patch: Partial<EditableSettings> }
  | { type: 'bombPot' }
  | { type: 'addBot'; seatNo: number }
  | { type: 'removeBot'; seatNo: number }
  | { type: 'startTournament' }
  | { type: 'close' };

export interface Reaction {
  tableId: string;
  userId: string;
  emoji: string;
  ts: number;
}

export interface LobbyData {
  profile: Profile;
  tables: TableSummary[];
}

export interface JoinTableData {
  state: TableState;
  chat: ChatMessage[];
}

/** Opaque WebRTC payload: a session description, an ICE candidate, or a request for a fresh offer. */
export interface RtcSignalData {
  /** Id of the sender's RTCPeerConnection, so stale messages from replaced connections are ignored. */
  cid: string;
  /** Id of the receiver's connection as last known by the sender. */
  rcid?: string;
  hello?: boolean;
  description?: { type: string; sdp?: string };
  candidate?: { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null;
}

export interface RtcSignalOut {
  tableId: string;
  to: string;
  toEpoch: number;
  fromEpoch: number;
  data: RtcSignalData;
}

export interface RtcSignalIn {
  tableId: string;
  from: string;
  toEpoch: number;
  fromEpoch: number;
  data: RtcSignalData;
}

export interface ClientToServerEvents {
  'lobby:list': (ack: Ack<LobbyData>) => void;
  'table:create': (input: CreateTableInput, ack: Ack<{ tableId: string }>) => void;
  'table:join': (p: { tableId: string; password?: string }, ack: Ack<JoinTableData>) => void;
  'table:leave': (p: { tableId: string }) => void;
  'table:sit': (p: { tableId: string; seatNo: number; buyIn: number }, ack: Ack<null>) => void;
  'table:stand': (p: { tableId: string }, ack: Ack<null>) => void;
  'table:rebuy': (p: { tableId: string; amount: number }, ack: Ack<null>) => void;
  'table:sitOut': (p: { tableId: string; sittingOut: boolean }, ack: Ack<null>) => void;
  'table:action': (p: { tableId: string; action: PlayerAction }, ack: Ack<null>) => void;
  'chat:send': (p: { tableId: string; text: string }) => void;
  'rtc:config': (ack: Ack<{ iceServers: IceServerConfig[] }>) => void;
  'rtc:signal': (p: RtcSignalOut) => void;
  'rtc:media': (p: { tableId: string; camOn: boolean; micOn: boolean }) => void;
  'table:kick': (p: { tableId: string; targetUserId: string }, ack: Ack<null>) => void;
  'table:preAction': (p: { tableId: string; preAction: PreAction | null }, ack: Ack<null>) => void;
  'table:timeBank': (p: { tableId: string }, ack: Ack<null>) => void;
  'table:showCards': (p: { tableId: string }, ack: Ack<null>) => void;
  'table:prefs': (p: { tableId: string; wantsStraddle?: boolean; ritOptIn?: boolean }, ack: Ack<null>) => void;
  'table:react': (p: { tableId: string; emoji: string }) => void;
  'table:host': (p: { tableId: string; op: HostOp }, ack: Ack<null>) => void;
  'table:waitlist': (p: { tableId: string; join: boolean }, ack: Ack<null>) => void;
  'table:history': (p: { tableId: string; limit?: number }, ack: Ack<HandHistoryEntry[]>) => void;
  'me:refill': (ack: Ack<Profile>) => void;
  'stats:get': (p: { userId?: string }, ack: Ack<PlayerStats>) => void;
  'leaderboard:get': (p: { scope: 'all' | 'friends' }, ack: Ack<LeaderboardEntry[]>) => void;
  'friends:list': (ack: Ack<FriendInfo[]>) => void;
  'friends:add': (p: { userId: string }, ack: Ack<null>) => void;
  'friends:remove': (p: { userId: string }, ack: Ack<null>) => void;
  'friends:invite': (p: { userId: string; tableId: string }, ack: Ack<null>) => void;
}

export interface ServerToClientEvents {
  'table:state': (state: TableState) => void;
  'chat:message': (msg: ChatMessage & { tableId: string }) => void;
  'me:profile': (profile: Profile) => void;
  'rtc:signal': (p: RtcSignalIn) => void;
  'table:kicked': (p: { tableId: string; reason?: string }) => void;
  'error:message': (msg: string) => void;
  'table:reaction': (r: Reaction) => void;
  'table:closed': (p: { tableId: string; session: SessionEntry[] }) => void;
  'friend:invite': (p: { fromId: string; fromName: string; tableId: string; tableName: string }) => void;
}
