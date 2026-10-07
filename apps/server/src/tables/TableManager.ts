import { randomUUID } from 'node:crypto';
import { MAX_SEATS, MIN_SEATS, type CreateTableInput, type TableSummary } from '@pk/shared';
import { GameError, createGame } from '../engine';
import type { AuthUser, Store } from '../store';
import { TableRuntime, type IO } from './TableRuntime';

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
    const state =
      snapshot ??
      createGame({ tableId: id, smallBlind: row.smallBlind, bigBlind: row.bigBlind, maxSeats: row.maxSeats });
    const rt = new TableRuntime(this.io, this.store, row, state, this.notifyProfile);
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
    const row = await this.store.createTable({
      id: randomUUID(),
      name,
      hostId: user.id,
      smallBlind,
      bigBlind,
      maxSeats,
    });
    return row.id;
  }

  async summaries(userId: string): Promise<TableSummary[]> {
    const [rows, seats] = await Promise.all([this.store.listTables(), this.store.listSeats()]);
    return rows.map((r) => {
      const live = this.tables.get(r.id);
      const tableSeats = seats.filter((s) => s.tableId === r.id);
      return {
        id: r.id,
        name: r.name,
        hostId: r.hostId,
        smallBlind: r.smallBlind,
        bigBlind: r.bigBlind,
        maxSeats: r.maxSeats,
        seated: live ? live.seatedCount() : tableSeats.length,
        mine: live
          ? live.state.seats.some((p) => p?.userId === userId)
          : tableSeats.some((s) => s.userId === userId),
      };
    });
  }
}
