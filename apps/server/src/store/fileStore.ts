import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { STARTING_CHIPS, type Profile } from '@pk/shared';
import type { GameState } from '../engine';
import {
  InsufficientChipsError,
  type AuthUser,
  type HandHistoryRow,
  type SeatRow,
  type Store,
  type TableRow,
} from './types';

interface Data {
  profiles: Record<string, Profile>;
  tables: Record<string, TableRow>;
  seats: SeatRow[];
  snapshots: Record<string, GameState>;
  history: (HandHistoryRow & { createdAt: string })[];
}

/** Local development store persisted to a JSON file so restarts keep data. */
export class FileStore implements Store {
  private data: Data;
  private file: string;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'dev-db.json');
    this.data = existsSync(this.file)
      ? JSON.parse(readFileSync(this.file, 'utf8'))
      : { profiles: {}, tables: {}, seats: [], snapshots: {}, history: [] };
  }

  private flush(): Promise<void> {
    this.dirty = true;
    this.writing = this.writing.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      const tmp = this.file + '.tmp';
      await writeFile(tmp, JSON.stringify(this.data));
      await rename(tmp, this.file);
    });
    return this.writing;
  }

  async upsertProfile(user: AuthUser): Promise<Profile> {
    const existing = this.data.profiles[user.id];
    const profile: Profile = existing
      ? { ...existing, displayName: user.name, avatarUrl: user.avatarUrl }
      : { id: user.id, displayName: user.name, avatarUrl: user.avatarUrl, chipBalance: STARTING_CHIPS };
    this.data.profiles[user.id] = profile;
    await this.flush();
    return { ...profile };
  }

  async getProfile(id: string) {
    const p = this.data.profiles[id];
    return p ? { ...p } : null;
  }

  async adjustBalance(userId: string, delta: number) {
    const p = this.data.profiles[userId];
    if (!p || p.chipBalance + delta < 0) throw new InsufficientChipsError();
    p.chipBalance += delta;
    await this.flush();
    return p.chipBalance;
  }

  async createTable(row: Omit<TableRow, 'createdAt' | 'status'>) {
    const t: TableRow = { ...row, status: 'open', createdAt: new Date().toISOString() };
    this.data.tables[t.id] = t;
    await this.flush();
    return { ...t };
  }

  async getTable(id: string) {
    const t = this.data.tables[id];
    return t ? { ...t } : null;
  }

  async listTables() {
    return Object.values(this.data.tables)
      .filter((t) => t.status === 'open')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveSnapshot(tableId: string, state: GameState) {
    this.data.snapshots[tableId] = structuredClone(state);
    await this.flush();
  }

  async loadSnapshot(tableId: string) {
    const s = this.data.snapshots[tableId];
    return s ? structuredClone(s) : null;
  }

  async saveSeats(tableId: string, seats: SeatRow[]) {
    this.data.seats = this.data.seats.filter((s) => s.tableId !== tableId).concat(seats);
    await this.flush();
  }

  async listSeats() {
    return this.data.seats.map((s) => ({ ...s }));
  }

  async addHandHistory(row: HandHistoryRow) {
    this.data.history.push({ ...row, createdAt: new Date().toISOString() });
    if (this.data.history.length > 1000) this.data.history.splice(0, this.data.history.length - 1000);
    await this.flush();
  }
}
