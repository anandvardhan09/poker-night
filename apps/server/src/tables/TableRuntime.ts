import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  CHAT_HISTORY_LIMIT,
  MAX_BUY_IN_BB,
  MIN_BUY_IN_BB,
  NEXT_HAND_DELAY_MS,
  type ChatMessage,
  type ClientToServerEvents,
  type PlayerAction,
  type RtcSignalOut,
  type ServerToClientEvents,
  type TableState,
} from '@pk/shared';
import {
  GameError,
  addLog,
  applyAction,
  canStartHand,
  clearFinishedHand,
  findSeat,
  forceFold,
  handleTimeout,
  isBetting,
  removePlayer,
  seatPlayer,
  seatStatus,
  startHand,
  toPublicState,
  type GameState,
} from '../engine';
import type { AuthUser, SeatRow, Store, TableRow } from '../store';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const BETWEEN_HANDS_DELAY_MS = 2_000;

/**
 * Live state for one table. All mutations go through `run()` so actions, timers and
 * persistence are applied strictly in order.
 */
export class TableRuntime {
  readonly room: string;
  private members = new Map<string, string>(); // socketId -> userId
  private media = new Map<string, { camOn: boolean; micOn: boolean }>();
  private epochs = new Map<string, number>();
  private chat: ChatMessage[] = [];
  private turnTimer: NodeJS.Timeout | null = null;
  private nextHandTimer: NodeJS.Timeout | null = null;
  private nextHandAt: number | null = null;
  private pendingCredits: { userId: string; amount: number }[] = [];
  private kickedUsers = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private io: IO,
    private store: Store,
    public meta: TableRow,
    public state: GameState,
    private notifyProfile: (userId: string) => void,
  ) {
    this.room = `table:${meta.id}`;
  }

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Called once after loading from a snapshot (e.g. after a server restart). */
  restore(now = Date.now()) {
    return this.run(async () => {
      for (const p of this.state.seats) if (p) p.connected = false;
      if (this.state.toAct !== null) this.state.actionDeadline = now + this.state.actionTimeoutMs;
      await this.afterChange(true);
    });
  }

  // ---------- membership ----------

  hasMember(socketId: string) {
    return this.members.has(socketId);
  }

  private isMemberUser(userId: string) {
    for (const u of this.members.values()) if (u === userId) return true;
    return false;
  }

  seatedCount() {
    return this.state.seats.filter(Boolean).length;
  }

  join(socketId: string, user: AuthUser) {
    return this.run(async () => {
      if (this.kickedUsers.has(user.id)) {
        throw new GameError('You were kicked from this table');
      }
      this.members.set(socketId, user.id);
      this.io.in(socketId).socketsJoin(this.room);
      const seat = findSeat(this.state, user.id);
      if (seat !== null) {
        const p = this.state.seats[seat]!;
        p.name = user.name;
        p.avatarUrl = user.avatarUrl;
        if (!p.connected) addLog(this.state, `${p.name} reconnected`);
        p.connected = true;
        p.missedHands = 0;
        if (p.autoSatOut) {
          p.sittingOut = false;
          p.autoSatOut = false;
        }
        this.epochs.set(user.id, Date.now());
      }
      await this.afterChange(seat !== null);
      return { state: this.view(user.id), chat: this.chat };
    });
  }

  leave(socketId: string) {
    return this.run(async () => {
      const userId = this.members.get(socketId);
      if (!userId) return;
      this.members.delete(socketId);
      this.io.in(socketId).socketsLeave(this.room);
      if (this.isMemberUser(userId)) return;
      this.media.delete(userId);
      const seat = findSeat(this.state, userId);
      if (seat !== null) {
        const p = this.state.seats[seat]!;
        p.connected = false;
        addLog(this.state, `${p.name} disconnected`);
      }
      await this.afterChange(seat !== null);
    });
  }

  kick(user: AuthUser, targetUserId: string) {
    return this.run(async () => {
      if (user.id !== this.meta.hostId) throw new GameError('Only the room leader can kick players');
      if (targetUserId === user.id) throw new GameError('Cannot kick yourself');

      const s = this.state;
      const seat = findSeat(s, targetUserId);
      const isMember = this.isMemberUser(targetUserId);

      if (seat === null && !isMember) {
        throw new GameError('Player not found at this table');
      }

      this.kickedUsers.add(targetUserId);

      let playerName = 'Player';
      if (seat !== null) {
        const p = s.seats[seat]!;
        playerName = p.name;
        if (isBetting(s) && p.inHand) {
          p.leaveAfterHand = true;
          if (!p.folded && !p.allIn) forceFold(s, seat);
          addLog(s, `${playerName} was kicked by host`);
        } else {
          this.removeSeat(seat);
          addLog(s, `${playerName} was kicked by host`);
        }
      } else {
        addLog(s, `A player was kicked by host`);
      }

      this.io.to(`user:${targetUserId}`).emit('table:kicked', {
        tableId: this.meta.id,
        reason: 'You were kicked from this table by the host',
      });

      for (const [socketId, userId] of this.members) {
        if (userId === targetUserId) {
          this.members.delete(socketId);
          this.io.in(socketId).socketsLeave(this.room);
        }
      }

      this.media.delete(targetUserId);
      this.epochs.delete(targetUserId);

      await this.afterChange(seat !== null);
    });
  }

  // ---------- player commands ----------

  sit(user: AuthUser, seatNo: number, buyIn: number) {
    return this.run(async () => {
      const s = this.state;
      if (!this.isMemberUser(user.id)) throw new GameError('Join the table first');
      if (findSeat(s, user.id) !== null) throw new GameError('You are already seated');
      if (!Number.isInteger(seatNo) || seatNo < 0 || seatNo >= s.maxSeats) throw new GameError('Invalid seat');
      if (s.seats[seatNo]) throw new GameError('Seat is taken');
      const profile = await this.store.getProfile(user.id);
      const balance = profile?.chipBalance ?? 0;
      const min = Math.min(MIN_BUY_IN_BB * s.bigBlind, balance);
      const max = MAX_BUY_IN_BB * s.bigBlind;
      if (!Number.isInteger(buyIn) || buyIn < Math.max(min, s.bigBlind) || buyIn > max) {
        throw new GameError(`Buy-in must be between ${Math.max(min, s.bigBlind)} and ${max}`);
      }
      await this.store.adjustBalance(user.id, -buyIn);
      seatPlayer(s, seatNo, { userId: user.id, name: user.name, avatarUrl: user.avatarUrl }, buyIn);
      this.epochs.set(user.id, Date.now());
      this.notifyProfile(user.id);
      await this.afterChange(true);
    });
  }

  stand(user: AuthUser) {
    return this.run(async () => {
      const s = this.state;
      const seat = findSeat(s, user.id);
      if (seat === null) throw new GameError('You are not seated');
      const p = s.seats[seat]!;
      if (isBetting(s) && p.inHand) {
        p.leaveAfterHand = true;
        if (!p.folded && !p.allIn) forceFold(s, seat);
        addLog(s, `${p.name} will leave after this hand`);
      } else {
        this.removeSeat(seat);
      }
      await this.afterChange(true);
    });
  }

  rebuy(user: AuthUser, amount: number) {
    return this.run(async () => {
      const s = this.state;
      const seat = findSeat(s, user.id);
      if (seat === null) throw new GameError('You are not seated');
      const p = s.seats[seat]!;
      if (isBetting(s) && p.inHand) throw new GameError('Wait until the hand is over');
      const max = MAX_BUY_IN_BB * s.bigBlind - p.stack;
      if (!Number.isInteger(amount) || amount <= 0 || amount > max) {
        throw new GameError(`You can add between 1 and ${Math.max(0, max)} chips`);
      }
      await this.store.adjustBalance(user.id, -amount);
      p.stack += amount;
      addLog(s, `${p.name} adds ${amount} chips`);
      this.notifyProfile(user.id);
      await this.afterChange(true);
    });
  }

  setSittingOut(user: AuthUser, sittingOut: boolean) {
    return this.run(async () => {
      const seat = findSeat(this.state, user.id);
      if (seat === null) throw new GameError('You are not seated');
      const p = this.state.seats[seat]!;
      p.sittingOut = sittingOut;
      p.autoSatOut = false;
      addLog(this.state, `${p.name} ${sittingOut ? 'sits out' : 'is back'}`);
      await this.afterChange(true);
    });
  }

  act(user: AuthUser, action: PlayerAction) {
    return this.run(async () => {
      const seat = findSeat(this.state, user.id);
      if (seat === null) throw new GameError('You are not seated');
      applyAction(this.state, seat, action);
      await this.afterChange(false);
    });
  }

  sendChat(user: AuthUser, text: string) {
    const clean = text.trim().slice(0, 300);
    if (!clean || !this.isMemberUser(user.id)) return;
    const msg: ChatMessage = { id: randomUUID(), userId: user.id, name: user.name, text: clean, ts: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY_LIMIT) this.chat.shift();
    this.io.to(this.room).emit('chat:message', { ...msg, tableId: this.meta.id });
  }

  setMedia(user: AuthUser, camOn: boolean, micOn: boolean) {
    if (!this.isMemberUser(user.id)) return;
    this.media.set(user.id, { camOn: !!camOn, micOn: !!micOn });
    this.broadcast();
  }

  relaySignal(user: AuthUser, p: RtcSignalOut) {
    if (!this.isMemberUser(user.id) || !this.isMemberUser(p.to)) return;
    if (findSeat(this.state, user.id) === null || findSeat(this.state, p.to) === null) return;
    this.io.to(`user:${p.to}`).emit('rtc:signal', {
      tableId: this.meta.id,
      from: user.id,
      toEpoch: p.toEpoch,
      fromEpoch: p.fromEpoch,
      data: p.data,
    });
  }

  // ---------- internals ----------

  private removeSeat(seatNo: number) {
    const p = this.state.seats[seatNo]!;
    const stack = removePlayer(this.state, seatNo);
    this.media.delete(p.userId);
    this.epochs.delete(p.userId);
    if (stack > 0) this.pendingCredits.push({ userId: p.userId, amount: stack });
    else this.notifyProfile(p.userId);
  }

  private async settleHand() {
    const s = this.state;
    s.handSettled = true;
    if (s.result) {
      this.store
        .addHandHistory({
          tableId: this.meta.id,
          handNo: s.result.handNo,
          board: s.result.board,
          actions: s.handActions,
          winners: s.result.winners,
        })
        .catch((e) => console.error('hand history failed', e));
    }
    s.seats.forEach((p, i) => {
      if (p?.leaveAfterHand) this.removeSeat(i);
    });
  }

  private async afterChange(seatsChanged: boolean) {
    if (this.state.street === 'showdown' && !this.state.handSettled) {
      await this.settleHand();
      seatsChanged = true;
    }
    await this.persist(seatsChanged);

    // Credit chips only after the snapshot without the player is saved, so a crash can't duplicate chips.
    const credits = this.pendingCredits.splice(0);
    for (const c of credits) {
      try {
        await this.store.adjustBalance(c.userId, c.amount);
      } catch (e) {
        console.error(`failed to credit ${c.amount} to ${c.userId}`, e);
      }
      this.notifyProfile(c.userId);
    }

    this.scheduleTimers();
    this.broadcast();
  }

  private async persist(seatsChanged: boolean) {
    try {
      await this.store.saveSnapshot(this.meta.id, this.state);
      if (seatsChanged) await this.store.saveSeats(this.meta.id, this.seatRows());
    } catch (e) {
      console.error(`persist failed for table ${this.meta.id}`, e);
    }
  }

  private seatRows(): SeatRow[] {
    return this.state.seats
      .filter((p) => !!p)
      .map((p) => ({
        tableId: this.meta.id,
        seatNo: p!.seatNo,
        userId: p!.userId,
        stack: p!.stack,
        status: seatStatus(p!),
      }));
  }

  private scheduleTimers(now = Date.now()) {
    const s = this.state;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    if (s.toAct !== null && s.actionDeadline !== null) {
      const handNo = s.handNo;
      const seat = s.toAct;
      this.turnTimer = setTimeout(
        () =>
          this.run(async () => {
            if (this.state.handNo !== handNo || this.state.toAct !== seat) return;
            handleTimeout(this.state);
            await this.afterChange(false);
          }).catch((e) => console.error('timeout failed', e)),
        Math.max(0, s.actionDeadline - now),
      );
    }

    if (isBetting(s) || this.nextHandTimer) return;
    if (s.street === 'waiting' && !canStartHand(s)) return;
    const delay = s.street === 'showdown' ? NEXT_HAND_DELAY_MS : BETWEEN_HANDS_DELAY_MS;
    this.nextHandAt = canStartHand(s) ? now + delay : null;
    this.nextHandTimer = setTimeout(
      () =>
        this.run(async () => {
          this.nextHandTimer = null;
          this.nextHandAt = null;
          clearFinishedHand(this.state);
          if (canStartHand(this.state)) startHand(this.state);
          await this.afterChange(false);
        }).catch((e) => console.error('next hand failed', e)),
      delay,
    );
  }

  view(userId: string | null): TableState {
    return toPublicState(
      this.state,
      this.meta,
      userId,
      (u) => ({
        camOn: this.media.get(u)?.camOn ?? false,
        micOn: this.media.get(u)?.micOn ?? false,
        rtcEpoch: this.epochs.get(u) ?? 0,
      }),
      this.nextHandAt,
    );
  }

  broadcast() {
    for (const [socketId, userId] of this.members) {
      this.io.to(socketId).emit('table:state', this.view(userId));
    }
  }

  dispose() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    if (this.nextHandTimer) clearTimeout(this.nextHandTimer);
  }
}
