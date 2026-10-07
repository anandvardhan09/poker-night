import type { Card, HandWinner, Profile, SeatStatus } from '@pk/shared';
import type { GameState, HandActionRecord } from '../engine';

export interface AuthUser {
  id: string;
  name: string;
  avatarUrl: string | null;
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
}

export interface SeatRow {
  tableId: string;
  seatNo: number;
  userId: string;
  stack: number;
  status: SeatStatus;
}

export interface HandHistoryRow {
  tableId: string;
  handNo: number;
  board: Card[];
  actions: HandActionRecord[];
  winners: HandWinner[];
}

export class InsufficientChipsError extends Error {
  constructor() {
    super('Not enough chips');
  }
}

export interface Store {
  /** Creates the profile with starting chips on first login; refreshes name/avatar otherwise. */
  upsertProfile(user: AuthUser): Promise<Profile>;
  getProfile(id: string): Promise<Profile | null>;
  /** Atomically adds `delta` (may be negative). Throws InsufficientChipsError if it would go below zero. */
  adjustBalance(userId: string, delta: number): Promise<number>;

  createTable(row: Omit<TableRow, 'createdAt' | 'status'>): Promise<TableRow>;
  getTable(id: string): Promise<TableRow | null>;
  listTables(): Promise<TableRow[]>;

  saveSnapshot(tableId: string, state: GameState): Promise<void>;
  loadSnapshot(tableId: string): Promise<GameState | null>;

  /** Replaces all seat rows for a table. */
  saveSeats(tableId: string, seats: SeatRow[]): Promise<void>;
  listSeats(): Promise<SeatRow[]>;

  addHandHistory(row: HandHistoryRow): Promise<void>;
}
