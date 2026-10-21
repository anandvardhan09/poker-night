import { randomUUID } from 'node:crypto';
import {
  MAX_SEATS,
  MAX_TURN_SECONDS,
  MIN_SEATS,
  MIN_TURN_SECONDS,
  type CreateTableInput,
  type TableSummary,
} from '@pk/shared';
import { GameError, createGame, normalizeState } from '../engine';
import { DEFAULT_SETTINGS, type AuthUser, type StoredSettings, type Store } from '../store';
import { TableRuntime, hashPassword, type IO } from './TableRuntime';

export class TableManager {
  private tables = new Map<string, TableRuntime>();
  private loading = new Map<string, Promise<TableRuntime | null>>();

  constructor(
    private io: IO,
    private store: Store,
    private notifyProfile: (userId: string) => void,
  ) {}

  loaded(): TableRuntime[] {
    return [...this.tables.values()];
  }

  peek(id: string): TableRuntime | undefined {
    return this.tables.get(id);
  }

  /** Returns the live table, loading it from the database (and its last snapshot) if needed. */
  async get(id: string): Promise<TableRuntime | null> {
    const live = this.tables.get(id);
    if (live) return live;
    let pending = this.loading.get(id);
    if (!pending) {
      pending = this.load(id).finally(() => this.loading.delete(id));
      this.loading.set(id, pending);
    }
    return pending;
  }

  private async load(id: string): Promise<TableRuntime | null> {
    const row = await this.store.getTable(id);
    if (!row || row.status !== 'open') return null;
    const snapshot = await this.store.loadSnapshot(id);
    const st = row.settings;
    const state = snapshot
      ? normalizeState(snapshot)
      : createGame({
          tableId: id,
          smallBlind: row.smallBlind,
          bigBlind: row.bigBlind,
          maxSeats: row.maxSeats,
          actionTimeoutMs: st.turnSeconds * 1000,
          variant: st.variant,
          straddle: st.straddle,
          runItTwice: st.runItTwice,
        });
    const rt = new TableRuntime(this.io, this.store, row, state, this.notifyProfile, (tid) =>
      this.tables.delete(tid),
    );
    this.tables.set(id, rt);
    if (snapshot) await rt.restore();
    return rt;
  }

  async create(user: AuthUser, input: CreateTableInput): Promise<string> {
    const name = String(input.name ?? '').trim().slice(0, 40) || `${user.name}'s table`;
    const smallBlind = Math.floor(Number(input.smallBlind));
    const bigBlind = Math.floor(Number(input.bigBlind));
    const maxSeats = Math.floor(Number(input.maxSeats));
    if (!(smallBlind > 0) || !(bigBlind >= smallBlind) || bigBlind > 100_000) {
      throw new GameError('Invalid blinds');
    }
    if (!(maxSeats >= MIN_SEATS && maxSeats <= MAX_SEATS)) {
      throw new GameError(`Seats must be between ${MIN_SEATS} and ${MAX_SEATS}`);
    }
    const settings = parseSettings(input, bigBlind);
    const row = await this.store.createTable({
      id: randomUUID(),
      name,
      hostId: user.id,
      smallBlind,
      bigBlind,
      maxSeats,
      settings,
    });
    return row.id;
  }

  async summaries(userId: string): Promise<TableSummary[]> {
    const [rows, seats] = await Promise.all([this.store.listTables(), this.store.listSeats()]);
    return rows
      .map((r) => {
        const live = this.tables.get(r.id);
        const tableSeats = seats.filter((s) => s.tableId === r.id);
        const mine = live
          ? live.state.seats.some((p) => p?.userId === userId)
          : tableSeats.some((s) => s.userId === userId);
        return {
          id: r.id,
          name: r.name,
          hostId: r.hostId,
          smallBlind: live?.state.smallBlind ?? r.smallBlind,
          bigBlind: live?.state.bigBlind ?? r.bigBlind,
          maxSeats: r.maxSeats,
          seated: live ? live.seatedCount() : tableSeats.length,
          mine,
          variant: r.settings.variant,
          mode: r.settings.mode,
          hasPassword: !!r.settings.passwordHash,
          isPrivate: r.settings.isPrivate,
          tournamentStatus: live?.state.extras.tournament?.status ?? (r.settings.mode === 'sng' ? 'registering' : null),
          spectators: live?.spectatorCount() ?? 0,
        };
      })
      .filter((t) => !t.isPrivate || t.mine || t.hostId === userId);
  }
}

function parseSettings(input: CreateTableInput, bigBlind: number): StoredSettings {
  const variant = input.variant === 'omaha' ? 'omaha' : 'holdem';
  const mode = input.mode === 'sng' ? 'sng' : 'cash';
  const turnSeconds = Math.floor(Number(input.turnSeconds ?? DEFAULT_SETTINGS.turnSeconds));
  if (!(turnSeconds >= MIN_TURN_SECONDS && turnSeconds <= MAX_TURN_SECONDS)) {
    throw new GameError(`Turn timer must be ${MIN_TURN_SECONDS}-${MAX_TURN_SECONDS} seconds`);
  }
  let blindLevelMinutes = Math.floor(Number(input.blindLevelMinutes ?? 0));
  if (!(blindLevelMinutes >= 0 && blindLevelMinutes <= 60)) throw new GameError('Blind levels must be 0-60 minutes');
  let sngBuyIn = 0;
  let sngStartingStack = 0;
  if (mode === 'sng') {
    sngBuyIn = Math.floor(Number(input.sngBuyIn ?? 1000));
    sngStartingStack = Math.floor(Number(input.sngStartingStack ?? 150 * bigBlind));
    if (!(sngBuyIn >= 0 && sngBuyIn <= 1_000_000)) throw new GameError('Invalid tournament buy-in');
    if (!(sngStartingStack >= 10 * bigBlind && sngStartingStack <= 10_000_000)) {
      throw new GameError('Starting stack must be at least 10 big blinds');
    }
    if (!blindLevelMinutes) blindLevelMinutes = 5;
  }
  const password = String(input.password ?? '').trim();
  return {
    variant,
    mode,
    isPrivate: !!input.isPrivate,
    passwordHash: password ? hashPassword(password.slice(0, 64)) : null,
    turnSeconds,
    straddle: !!input.straddle,
    runItTwice: !!input.runItTwice,
    blindLevelMinutes,
    sngBuyIn,
    sngStartingStack,
  };
}
