import type { SupabaseClient } from '@supabase/supabase-js';
import type { Profile } from '@pk/shared';
import type { GameState } from '../engine';
import {
  InsufficientChipsError,
  type AuthUser,
  type HandHistoryRow,
  type SeatRow,
  type Store,
  type TableRow,
} from './types';

interface ProfileRecord {
  id: string;
  display_name: string;
  avatar_url: string | null;
  chip_balance: number;
}

interface TableRecord {
  id: string;
  name: string;
  host_id: string;
  small_blind: number;
  big_blind: number;
  max_seats: number;
  status: 'open' | 'closed';
  created_at: string;
}

interface SeatRecord {
  table_id: string;
  seat_no: number;
  user_id: string;
  stack: number;
  status: SeatRow['status'];
}

const toProfile = (r: ProfileRecord): Profile => ({
  id: r.id,
  displayName: r.display_name,
  avatarUrl: r.avatar_url,
  chipBalance: Number(r.chip_balance),
});

const toTable = (r: TableRecord): TableRow => ({
  id: r.id,
  name: r.name,
  hostId: r.host_id,
  smallBlind: r.small_blind,
  bigBlind: r.big_blind,
  maxSeats: r.max_seats,
  status: r.status,
  createdAt: r.created_at,
});

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

function required<T>(res: { data: T | null; error: { message: string } | null }): T {
  const data = check(res);
  if (data === null) throw new Error('Row not found');
  return data;
}

export class SupabaseStore implements Store {
  constructor(private db: SupabaseClient) {}

  async upsertProfile(user: AuthUser): Promise<Profile> {
    // chip_balance is omitted so new rows get the column default and existing balances are untouched.
    const row = required(
      await this.db
        .from('profiles')
        .upsert(
          {
            id: user.id,
            display_name: user.name,
            avatar_url: user.avatarUrl,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
        .select()
        .single<ProfileRecord>(),
    );
    return toProfile(row);
  }

  async getProfile(id: string) {
    const row = check(await this.db.from('profiles').select().eq('id', id).maybeSingle<ProfileRecord>());
    return row ? toProfile(row) : null;
  }

  async adjustBalance(userId: string, delta: number) {
    const { data, error } = await this.db.rpc('adjust_chip_balance', { p_user: userId, p_delta: delta });
    if (error) {
      if (error.message.includes('INSUFFICIENT_CHIPS')) throw new InsufficientChipsError();
      throw new Error(error.message);
    }
    return Number(data);
  }

  async createTable(row: Omit<TableRow, 'createdAt' | 'status'>) {
    const rec = required(
      await this.db
        .from('tables')
        .insert({
          id: row.id,
          name: row.name,
          host_id: row.hostId,
          small_blind: row.smallBlind,
          big_blind: row.bigBlind,
          max_seats: row.maxSeats,
        })
        .select()
        .single<TableRecord>(),
    );
    return toTable(rec);
  }

  async getTable(id: string) {
    const rec = check(await this.db.from('tables').select().eq('id', id).maybeSingle<TableRecord>());
    return rec ? toTable(rec) : null;
  }

  async listTables() {
    const recs = check(
      await this.db
        .from('tables')
        .select()
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(100)
        .returns<TableRecord[]>(),
    );
    return (recs ?? []).map(toTable);
  }

  async saveSnapshot(tableId: string, state: GameState) {
    check(
      await this.db
        .from('table_snapshots')
        .upsert({ table_id: tableId, state, updated_at: new Date().toISOString() }),
    );
  }

  async loadSnapshot(tableId: string) {
    const rec = check(
      await this.db
        .from('table_snapshots')
        .select('state')
        .eq('table_id', tableId)
        .maybeSingle<{ state: GameState }>(),
    );
    return rec?.state ?? null;
  }

  async saveSeats(tableId: string, seats: SeatRow[]) {
    check(await this.db.from('table_seats').delete().eq('table_id', tableId));
    if (!seats.length) return;
    check(
      await this.db.from('table_seats').insert(
        seats.map((s) => ({
          table_id: tableId,
          seat_no: s.seatNo,
          user_id: s.userId,
          stack: s.stack,
          status: s.status,
        })),
      ),
    );
  }

  async listSeats() {
    const recs = check(await this.db.from('table_seats').select().returns<SeatRecord[]>());
    return (recs ?? []).map((r) => ({
      tableId: r.table_id,
      seatNo: r.seat_no,
      userId: r.user_id,
      stack: Number(r.stack),
      status: r.status,
    }));
  }

  async addHandHistory(row: HandHistoryRow) {
    check(
      await this.db.from('hand_history').insert({
        table_id: row.tableId,
        hand_no: row.handNo,
        board: row.board,
        actions: row.actions,
        winners: row.winners,
      }),
    );
  }
}
