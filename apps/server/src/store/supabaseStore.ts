import type { SupabaseClient } from '@supabase/supabase-js';
import type { LeaderboardEntry, Profile } from '@pk/shared';
import type { GameState } from '../engine';
import { withDefaults } from './defaults';
import {
  InsufficientChipsError,
  RefillUnavailableError,
  type AuthUser,
  type HandDetails,
  type HandHistoryRow,
  type PlayerHandRow,
  type SeatRow,
  type Store,
  type StoredHand,
  type StoredSettings,
  type TableRow,
} from './types';

interface ProfileRecord {
  id: string;
  display_name: string;
  avatar_url: string | null;
  chip_balance: number;
  last_refill_at: string | null;
}

interface HandRecord {
  table_id: string;
  hand_no: number;
  board: HandHistoryRow['board'];
  actions: HandHistoryRow['actions'];
  winners: HandHistoryRow['winners'];
  details: HandDetails;
  created_at: string;
}

interface PlayerHandRecord {
  user_id: string;
  net: number;
  vpip: boolean;
  pfr: boolean;
  won: boolean;
  pot_won: number;
}

interface LeaderboardRecord {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  chip_balance: number;
  hands: number;
  net: number;
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
  settings: Partial<StoredSettings> | null;
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
  lastRefillAt: r.last_refill_at ? Date.parse(r.last_refill_at) : null,
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
  settings: withDefaults(r.settings),
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
          settings: row.settings,
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

  async getProfiles(ids: string[]) {
    if (!ids.length) return [];
    const rows = check(await this.db.from('profiles').select().in('id', ids).returns<ProfileRecord[]>());
    return (rows ?? []).map(toProfile);
  }

  async claimRefill(userId: string, amount: number, intervalMs: number) {
    const { error } = await this.db.rpc('claim_daily_refill', {
      p_user: userId,
      p_amount: amount,
      p_interval_seconds: Math.round(intervalMs / 1000),
    });
    if (error) {
      if (error.message.includes('REFILL_NOT_AVAILABLE')) throw new RefillUnavailableError();
      throw new Error(error.message);
    }
    return (await this.getProfile(userId))!;
  }

  async updateTable(
    id: string,
    patch: Partial<Pick<TableRow, 'status' | 'settings' | 'smallBlind' | 'bigBlind'>>,
  ) {
    const rec: Record<string, unknown> = {};
    if (patch.status) rec.status = patch.status;
    if (patch.settings) rec.settings = patch.settings;
    if (patch.smallBlind) rec.small_blind = patch.smallBlind;
    if (patch.bigBlind) rec.big_blind = patch.bigBlind;
    check(await this.db.from('tables').update(rec).eq('id', id));
  }

  async addHandHistory(row: HandHistoryRow) {
    const rec = required(
      await this.db
        .from('hand_history')
        .insert({
          table_id: row.tableId,
          hand_no: row.handNo,
          board: row.board,
          actions: row.actions,
          winners: row.winners,
          details: row.details,
        })
        .select('id')
        .single<{ id: number }>(),
    );
    const humans = row.details.players.filter((p) => !p.isBot);
    if (!humans.length) return;
    check(
      await this.db.from('player_hands').insert(
        humans.map((p) => ({
          hand_id: rec.id,
          table_id: row.tableId,
          user_id: p.userId,
          net: p.net,
          vpip: p.vpip,
          pfr: p.pfr,
          won: p.won,
          pot_won: p.potWon,
        })),
      ),
    );
  }

  async listHandHistory(tableId: string, limit: number): Promise<StoredHand[]> {
    const recs = check(
      await this.db
        .from('hand_history')
        .select()
        .eq('table_id', tableId)
        .order('hand_no', { ascending: false })
        .limit(limit)
        .returns<HandRecord[]>(),
    );
    return (recs ?? [])
      .filter((r) => r.details && Array.isArray(r.details.players))
      .map((r) => ({
        tableId: r.table_id,
        handNo: r.hand_no,
        board: r.board,
        actions: r.actions,
        winners: r.winners,
        details: r.details,
        createdAt: r.created_at,
      }));
  }

  async listPlayerHands(userId: string): Promise<PlayerHandRow[]> {
    const recs = check(
      await this.db
        .from('player_hands')
        .select('user_id, net, vpip, pfr, won, pot_won')
        .eq('user_id', userId)
        .order('id', { ascending: false })
        .limit(10_000)
        .returns<PlayerHandRecord[]>(),
    );
    return (recs ?? []).map((r) => ({
      userId: r.user_id,
      net: Number(r.net),
      vpip: r.vpip,
      pfr: r.pfr,
      won: r.won,
      potWon: Number(r.pot_won),
    }));
  }

  async leaderboard(limit: number, userIds?: string[]): Promise<LeaderboardEntry[]> {
    const { data, error } = await this.db.rpc('leaderboard', { p_limit: limit, p_users: userIds ?? null });
    if (error) throw new Error(error.message);
    return ((data ?? []) as LeaderboardRecord[]).map((r) => ({
      userId: r.user_id,
      name: r.display_name,
      avatarUrl: r.avatar_url,
      chipBalance: Number(r.chip_balance),
      hands: Number(r.hands),
      net: Number(r.net),
    }));
  }

  async listFriends(userId: string) {
    const recs = check(
      await this.db.from('friendships').select('friend_id').eq('user_id', userId).returns<{ friend_id: string }[]>(),
    );
    return (recs ?? []).map((r) => r.friend_id);
  }

  async addFriend(userId: string, friendId: string) {
    check(
      await this.db.from('friendships').upsert(
        [
          { user_id: userId, friend_id: friendId },
          { user_id: friendId, friend_id: userId },
        ],
        { onConflict: 'user_id,friend_id', ignoreDuplicates: true },
      ),
    );
  }

  async removeFriend(userId: string, friendId: string) {
    check(
      await this.db
        .from('friendships')
        .delete()
        .or(`and(user_id.eq.${userId},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${userId})`),
    );
  }
}
