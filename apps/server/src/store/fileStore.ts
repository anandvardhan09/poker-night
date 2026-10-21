import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { STARTING_CHIPS, type LeaderboardEntry, type Profile } from '@pk/shared';
import type { GameState } from '../engine';
import { withDefaults } from './defaults';
import {
  InsufficientChipsError,
  RefillUnavailableError,
  type AuthUser,
  type HandHistoryRow,
  type PlayerHandRow,
  type SeatRow,
  type Store,
  type StoredHand,
  type TableRow,
} from './types';

interface Data {
  profiles: Record<string, Profile>;
  tables: Record<string, TableRow>;
  seats: SeatRow[];
  snapshots: Record<string, GameState>;
  history: StoredHand[];
  friends: { userId: string; friendId: string }[];
}

const HISTORY_LIMIT = 5000;

/** Local development store persisted to a JSON file so restarts keep data. */
export class FileStore implements Store {
  private data: Data;
  private file: string;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'dev-db.json');
    const loaded: Partial<Data> = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {};
    this.data = {
      profiles: loaded.profiles ?? {},
      tables: loaded.tables ?? {},
      seats: loaded.seats ?? [],
      snapshots: loaded.snapshots ?? {},
      history: (loaded.history ?? []).filter((h) => h.details),
      friends: loaded.friends ?? [],
    };
    for (const p of Object.values(this.data.profiles)) p.lastRefillAt ??= null;
    for (const t of Object.values(this.data.tables)) t.settings = withDefaults(t.settings);
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
      : {
          id: user.id,
          displayName: user.name,
          avatarUrl: user.avatarUrl,
          chipBalance: STARTING_CHIPS,
          lastRefillAt: null,
        };
    this.data.profiles[user.id] = profile;
    await this.flush();
    return { ...profile };
  }

  async getProfile(id: string) {
    const p = this.data.profiles[id];
    return p ? { ...p } : null;
  }

  async getProfiles(ids: string[]) {
    return ids.map((id) => this.data.profiles[id]).filter(Boolean).map((p) => ({ ...p }));
  }

  async adjustBalance(userId: string, delta: number) {
    const p = this.data.profiles[userId];
    if (!p || p.chipBalance + delta < 0) throw new InsufficientChipsError();
    p.chipBalance += delta;
    await this.flush();
    return p.chipBalance;
  }

  async claimRefill(userId: string, amount: number, intervalMs: number) {
    const p = this.data.profiles[userId];
    const now = Date.now();
    if (!p || p.chipBalance >= amount || (p.lastRefillAt !== null && now - p.lastRefillAt < intervalMs)) {
      throw new RefillUnavailableError();
    }
    p.chipBalance = amount;
    p.lastRefillAt = now;
    await this.flush();
    return { ...p };
  }

  async createTable(row: Omit<TableRow, 'createdAt' | 'status'>) {
    const t: TableRow = { ...row, status: 'open', createdAt: new Date().toISOString() };
    this.data.tables[t.id] = t;
    await this.flush();
    return structuredClone(t);
  }

  async getTable(id: string) {
    const t = this.data.tables[id];
    return t ? structuredClone(t) : null;
  }

  async listTables() {
    return Object.values(this.data.tables)
      .filter((t) => t.status === 'open')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => structuredClone(t));
  }

  async updateTable(id: string, patch: Partial<Pick<TableRow, 'status' | 'settings' | 'smallBlind' | 'bigBlind'>>) {
    const t = this.data.tables[id];
    if (!t) return;
    Object.assign(t, structuredClone(patch));
    await this.flush();
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
    this.data.history.push({ ...structuredClone(row), createdAt: new Date().toISOString() });
    if (this.data.history.length > HISTORY_LIMIT) this.data.history.splice(0, this.data.history.length - HISTORY_LIMIT);
    await this.flush();
  }

  async listHandHistory(tableId: string, limit: number) {
    return this.data.history
      .filter((h) => h.tableId === tableId)
      .slice(-limit)
      .reverse()
      .map((h) => structuredClone(h));
  }

  async listPlayerHands(userId: string): Promise<PlayerHandRow[]> {
    const rows: PlayerHandRow[] = [];
    for (const h of this.data.history) {
      const p = h.details.players.find((x) => x.userId === userId);
      if (p) rows.push({ userId, net: p.net, vpip: p.vpip, pfr: p.pfr, won: p.won, potWon: p.potWon });
    }
    return rows;
  }

  async leaderboard(limit: number, userIds?: string[]): Promise<LeaderboardEntry[]> {
    const totals = new Map<string, { hands: number; net: number }>();
    for (const h of this.data.history) {
      for (const p of h.details.players) {
        if (p.isBot) continue;
        const t = totals.get(p.userId) ?? { hands: 0, net: 0 };
        t.hands += 1;
        t.net += p.net;
        totals.set(p.userId, t);
      }
    }
    return Object.values(this.data.profiles)
      .filter((p) => !userIds || userIds.includes(p.id))
      .map((p) => ({
        userId: p.id,
        name: p.displayName,
        avatarUrl: p.avatarUrl,
        chipBalance: p.chipBalance,
        hands: totals.get(p.id)?.hands ?? 0,
        net: totals.get(p.id)?.net ?? 0,
      }))
      .sort((a, b) => b.chipBalance - a.chipBalance)
      .slice(0, limit);
  }

  async listFriends(userId: string) {
    return this.data.friends.filter((f) => f.userId === userId).map((f) => f.friendId);
  }

  async addFriend(userId: string, friendId: string) {
    for (const [a, b] of [
      [userId, friendId],
      [friendId, userId],
    ]) {
      if (!this.data.friends.some((f) => f.userId === a && f.friendId === b)) {
        this.data.friends.push({ userId: a, friendId: b });
      }
    }
    await this.flush();
  }

  async removeFriend(userId: string, friendId: string) {
    this.data.friends = this.data.friends.filter(
      (f) => !(f.userId === userId && f.friendId === friendId) && !(f.userId === friendId && f.friendId === userId),
    );
    await this.flush();
  }
}
