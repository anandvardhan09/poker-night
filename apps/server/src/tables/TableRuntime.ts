import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import {
  BLIND_LEVEL_MULTIPLIERS,
  CHAT_HISTORY_LIMIT,
  DEFAULT_BUY_IN_BB,
  MAX_BUY_IN_BB,
  MAX_TURN_SECONDS,
  MAX_VIDEO_SPECTATORS,
  MIN_BUY_IN_BB,
  MIN_TURN_SECONDS,
  NEXT_HAND_DELAY_MS,
  REACTION_COOLDOWN_MS,
  REACTION_EMOJIS,
  sngPayouts,
  type BlindLevelInfo,
  type ChatMessage,
  type ClientToServerEvents,
  type EditableSettings,
  type HandHistoryEntry,
  type HostOp,
  type PlayerAction,
  type PreAction,
  type RtcSignalOut,
  type ServerToClientEvents,
  type SessionEntry,
  type Spectator,
  type TableSettings,
  type TableState,
  type TournamentInfo,
} from '@pk/shared';
import {
  GameError,
  addLog,
  applyAction,
  canStartHand,
  chooseBotAction,
  clearFinishedHand,
  findSeat,
  forceFold,
  handleTimeout,
  isBetting,
  players,
  removePlayer,
  seatPlayer,
  seatStatus,
  setBlinds,
  setPreAction,
  showCards,
  startHand,
  toPublicState,
  useTimeBank,
  type GameState,
} from '../engine';
import type { AuthUser, RecordedPlayer, SeatRow, Store, TableRow } from '../store';

export type IO = Server<ClientToServerEvents, ServerToClientEvents>;

const BETWEEN_HANDS_DELAY_MS = 2_000;
const BOT_NAMES = ['Ada', 'Turing', 'Lovelace', 'Hopper', 'Babbage', 'Knuth', 'Ritchie', 'Liskov', 'Dijkstra'];

export const hashPassword = (pw: string) => createHash('sha256').update(`pk:${pw}`).digest('hex');
export const isBotId = (userId: string) => userId.startsWith('bot:');

/**
 * Live state for one table. All mutations go through `run()` so actions, timers and
 * persistence are applied strictly in order.
 */
export class TableRuntime {
  readonly room: string;
  private members = new Map<string, string>(); // socketId -> userId
  private names = new Map<string, { name: string; avatarUrl: string | null }>();
  private media = new Map<string, { camOn: boolean; micOn: boolean }>();
  private epochs = new Map<string, number>();
  /** Spectators who receive video, in join order. */
  private videoSpectators: string[] = [];
  private lastReaction = new Map<string, number>();
  private chat: ChatMessage[] = [];
  private turnTimer: NodeJS.Timeout | null = null;
  private nextHandTimer: NodeJS.Timeout | null = null;
  private levelTimer: NodeJS.Timeout | null = null;
  private nextHandAt: number | null = null;
  private pendingCredits: { userId: string; amount: number }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  closed = false;

  constructor(
    private io: IO,
    private store: Store,
    public meta: TableRow,
    public state: GameState,
    private notifyProfile: (userId: string) => void,
    private onClosed: (tableId: string) => void,
  ) {
    this.room = `table:${meta.id}`;
  }

  run<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.queue.then(() => {
      if (this.closed) throw new GameError('This table has closed');
      return fn();
    });
    this.queue = p.catch(() => undefined);
    return p;
  }

  private get x() {
    return this.state.extras;
  }

  private get isSng() {
    return this.meta.settings.mode === 'sng';
  }

  /** Called once after loading from a snapshot (e.g. after a server restart). */
  restore(now = Date.now()) {
    return this.run(async () => {
      for (const p of this.state.seats) if (p && !p.isBot) p.connected = false;
      if (this.state.toAct !== null) this.state.actionDeadline = now + this.state.actionTimeoutMs;
      await this.afterChange(true);
    });
  }

  // ---------- membership ----------

  hasMember(socketId: string) {
    return this.members.has(socketId);
  }

  isMemberUser(userId: string) {
    for (const u of this.members.values()) if (u === userId) return true;
    return false;
  }

  seatedCount() {
    return this.state.seats.filter(Boolean).length;
  }

  spectatorCount() {
    const seated = new Set(players(this.state).map((p) => p.userId));
    return new Set([...this.members.values()].filter((u) => !seated.has(u))).size;
  }

  join(socketId: string, user: AuthUser, password?: string) {
    return this.run(async () => {
      if (this.x.kicked.includes(user.id)) throw new GameError('You were kicked from this table');
      const seat = findSeat(this.state, user.id);
      const hash = this.meta.settings.passwordHash;
      if (hash && seat === null && user.id !== this.meta.hostId && !this.isMemberUser(user.id)) {
        if (!password) throw new GameError('PASSWORD_REQUIRED');
        if (hashPassword(password) !== hash) throw new GameError('Wrong password');
      }
      this.members.set(socketId, user.id);
      this.names.set(user.id, { name: user.name, avatarUrl: user.avatarUrl });
      this.io.in(socketId).socketsJoin(this.room);
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
      } else {
        this.addVideoSpectator(user.id);
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
      this.dropVideoSpectator(userId);
      this.x.waitlist = this.x.waitlist.filter((w) => w.userId !== userId);
      const seat = findSeat(this.state, userId);
      if (seat !== null) {
        const p = this.state.seats[seat]!;
        p.connected = false;
        addLog(this.state, `${p.name} disconnected`);
      }
      await this.afterChange(seat !== null);
    });
  }

  private addVideoSpectator(userId: string) {
    if (this.videoSpectators.includes(userId)) return;
    if (this.videoSpectators.length >= MAX_VIDEO_SPECTATORS) return;
    this.videoSpectators.push(userId);
    this.epochs.set(userId, Date.now());
  }

  private dropVideoSpectator(userId: string) {
    if (!this.videoSpectators.includes(userId)) return;
    this.videoSpectators = this.videoSpectators.filter((u) => u !== userId);
    if (findSeat(this.state, userId) === null) this.epochs.delete(userId);
    // Give the free video slot to the next spectator waiting for one.
    const seated = new Set(players(this.state).map((p) => p.userId));
    for (const u of new Set(this.members.values())) {
      if (this.videoSpectators.length >= MAX_VIDEO_SPECTATORS) break;
      if (!seated.has(u) && !this.videoSpectators.includes(u)) this.addVideoSpectator(u);
    }
  }

  kick(user: AuthUser, targetUserId: string) {
    return this.run(async () => {
      this.requireHost(user);
      if (targetUserId === user.id) throw new GameError('Cannot kick yourself');

      const s = this.state;
      const seat = findSeat(s, targetUserId);
      const isMember = this.isMemberUser(targetUserId);
      if (seat === null && !isMember) throw new GameError('Player not found at this table');

      if (!this.x.kicked.includes(targetUserId)) this.x.kicked.push(targetUserId);
      this.x.waitlist = this.x.waitlist.filter((w) => w.userId !== targetUserId);

      if (seat !== null) {
        const p = s.seats[seat]!;
        if (isBetting(s) && p.inHand) {
          p.leaveAfterHand = true;
          if (!p.folded && !p.allIn) forceFold(s, seat);
        } else {
          await this.unseat(seat);
        }
        addLog(s, `${p.name} was kicked by the host`);
      } else {
        addLog(s, `A spectator was kicked by the host`);
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
      this.dropVideoSpectator(targetUserId);
      this.epochs.delete(targetUserId);

      await this.afterChange(true);
    });
  }

  // ---------- player commands ----------

  sit(user: AuthUser, seatNo: number, buyIn: number) {
    return this.run(async () => {
      if (!this.isMemberUser(user.id)) throw new GameError('Join the table first');
      await this.seatUser(user, seatNo, buyIn);
      await this.afterChange(true);
    });
  }

  private async seatUser(user: AuthUser, seatNo: number, buyIn: number) {
    const s = this.state;
    if (findSeat(s, user.id) !== null) throw new GameError('You are already seated');
    if (!Number.isInteger(seatNo) || seatNo < 0 || seatNo >= s.maxSeats) throw new GameError('Invalid seat');
    if (s.seats[seatNo]) throw new GameError('Seat is taken');
    const t = this.x.tournament;
    let stack: number;
    let cost: number;
    if (this.isSng) {
      if (t && t.status !== 'registering') throw new GameError('The tournament has already started');
      cost = this.meta.settings.sngBuyIn;
      stack = this.meta.settings.sngStartingStack;
    } else {
      const profile = await this.store.getProfile(user.id);
      const balance = profile?.chipBalance ?? 0;
      const min = Math.max(Math.min(MIN_BUY_IN_BB * s.bigBlind, balance), s.bigBlind);
      const max = MAX_BUY_IN_BB * s.bigBlind;
      if (!Number.isInteger(buyIn) || buyIn < min || buyIn > max) {
        throw new GameError(`Buy-in must be between ${min} and ${max}`);
      }
      cost = stack = buyIn;
    }
    if (cost > 0) await this.store.adjustBalance(user.id, -cost);
    seatPlayer(s, seatNo, { userId: user.id, name: user.name, avatarUrl: user.avatarUrl }, stack);
    this.ledger(user.id, user.name).buyIn += cost;
    if (this.isSng) {
      this.tournament().entrants.push({ userId: user.id, name: user.name, isBot: false });
      this.tournament().prizePool += cost;
    }
    this.x.waitlist = this.x.waitlist.filter((w) => w.userId !== user.id);
    this.dropVideoSpectator(user.id);
    this.epochs.set(user.id, Date.now());
    this.notifyProfile(user.id);
    if (this.isSng && this.seatedCount() === s.maxSeats) this.startTournament();
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
        await this.unseat(seat);
      }
      await this.afterChange(true);
    });
  }

  /** Removes a player between hands. Tournaments refund during registration and place players once running. */
  private async unseat(seatNo: number) {
    const s = this.state;
    const p = s.seats[seatNo]!;
    const t = this.x.tournament;
    if (!this.isSng) return this.removeSeat(seatNo);
    if (!t || t.status === 'registering') {
      const t2 = this.tournament();
      t2.entrants = t2.entrants.filter((e) => e.userId !== p.userId);
      s.seats[seatNo] = null;
      this.epochs.delete(p.userId);
      addLog(s, `${p.name} unregisters`);
      if (!p.isBot && this.meta.settings.sngBuyIn > 0) {
        t2.prizePool -= this.meta.settings.sngBuyIn;
        this.ledger(p.userId, p.name).cashOut += this.meta.settings.sngBuyIn;
        this.pendingCredits.push({ userId: p.userId, amount: this.meta.settings.sngBuyIn });
      }
      if (this.isMemberUser(p.userId)) this.addVideoSpectator(p.userId);
      return;
    }
    if (t.status === 'running') {
      p.leaveAfterHand = true;
      addLog(s, `${p.name} leaves the tournament`);
      await this.settleTournament();
    }
  }

  rebuy(user: AuthUser, amount: number) {
    return this.run(async () => {
      if (this.isSng) throw new GameError('No rebuys in a tournament');
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
      this.ledger(user.id, user.name).buyIn += amount;
      addLog(s, `${p.name} adds ${amount} chips`);
      this.notifyProfile(user.id);
      await this.afterChange(true);
    });
  }

  setSittingOut(user: AuthUser, sittingOut: boolean) {
    return this.run(async () => {
      const p = this.mySeat(user);
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

  setPreAction(user: AuthUser, preAction: PreAction | null) {
    return this.run(async () => {
      const p = this.mySeat(user);
      setPreAction(this.state, p.seatNo, preAction);
      this.broadcast();
    });
  }

  useTimeBank(user: AuthUser) {
    return this.run(async () => {
      const p = this.mySeat(user);
      useTimeBank(this.state, p.seatNo);
      await this.afterChange(false);
    });
  }

  showCards(user: AuthUser) {
    return this.run(async () => {
      const p = this.mySeat(user);
      showCards(this.state, p.seatNo);
      await this.afterChange(false);
    });
  }

  setPrefs(user: AuthUser, prefs: { wantsStraddle?: boolean; ritOptIn?: boolean }) {
    return this.run(async () => {
      const p = this.mySeat(user);
      if (prefs.wantsStraddle !== undefined) p.wantsStraddle = !!prefs.wantsStraddle;
      if (prefs.ritOptIn !== undefined) p.ritOptIn = !!prefs.ritOptIn;
      await this.afterChange(false);
    });
  }

  setWaitlist(user: AuthUser, join: boolean) {
    return this.run(async () => {
      if (!this.isMemberUser(user.id)) throw new GameError('Join the table first');
      this.x.waitlist = this.x.waitlist.filter((w) => w.userId !== user.id);
      if (join) {
        if (this.isSng) throw new GameError('Tournaments have no waitlist');
        if (findSeat(this.state, user.id) !== null) throw new GameError('You are already seated');
        this.x.waitlist.push({ userId: user.id, name: user.name });
      }
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

  react(user: AuthUser, emoji: string) {
    if (!this.isMemberUser(user.id) || !(REACTION_EMOJIS as readonly string[]).includes(emoji)) return;
    const now = Date.now();
    if (now - (this.lastReaction.get(user.id) ?? 0) < REACTION_COOLDOWN_MS) return;
    this.lastReaction.set(user.id, now);
    this.io.to(this.room).emit('table:reaction', { tableId: this.meta.id, userId: user.id, emoji, ts: now });
  }

  setMedia(user: AuthUser, camOn: boolean, micOn: boolean) {
    if (!this.isMemberUser(user.id)) return;
    this.media.set(user.id, { camOn: !!camOn, micOn: !!micOn });
    this.broadcast();
  }

  private canVideo(userId: string) {
    return findSeat(this.state, userId) !== null || this.videoSpectators.includes(userId);
  }

  relaySignal(user: AuthUser, p: RtcSignalOut) {
    if (!this.isMemberUser(user.id) || !this.isMemberUser(p.to)) return;
    if (!this.canVideo(user.id) || !this.canVideo(p.to)) return;
    // At least one side must be seated: spectators only connect to players.
    if (findSeat(this.state, user.id) === null && findSeat(this.state, p.to) === null) return;
    this.io.to(`user:${p.to}`).emit('rtc:signal', {
      tableId: this.meta.id,
      from: user.id,
      toEpoch: p.toEpoch,
      fromEpoch: p.fromEpoch,
      data: p.data,
    });
  }

  async history(user: AuthUser, limit: number): Promise<HandHistoryEntry[]> {
    if (!this.isMemberUser(user.id)) throw new GameError('Join the table first');
    const rows = await this.store.listHandHistory(this.meta.id, Math.min(50, Math.max(1, limit)));
    return rows.map((r) => ({
      handNo: r.handNo,
      createdAt: r.createdAt,
      dealerSeat: r.details.dealerSeat,
      smallBlind: r.details.smallBlind,
      bigBlind: r.details.bigBlind,
      board: r.board,
      board2: r.details.board2,
      actions: r.actions,
      winners: r.winners,
      players: r.details.players.map((p) => ({
        userId: p.userId,
        name: p.name,
        seatNo: p.seatNo,
        startStack: p.startStack,
        net: p.net,
        cards: p.userId === user.id || p.shown ? p.cards : null,
      })),
    }));
  }

  // ---------- host commands ----------

  host(user: AuthUser, op: HostOp) {
    return this.run(async () => {
      this.requireHost(user);
      const s = this.state;
      switch (op?.type) {
        case 'pause': {
          const paused = !!op.paused;
          if (paused === this.x.paused) break;
          this.x.paused = paused;
          if (paused) this.x.pausedAt = Date.now();
          else if (this.x.pausedAt !== null) {
            // Blind levels don't advance while paused.
            if (this.x.levelStartedAt !== null) this.x.levelStartedAt += Date.now() - this.x.pausedAt;
            this.x.pausedAt = null;
          }
          addLog(s, paused ? 'The host paused the game' : 'The host resumed the game');
          break;
        }
        case 'blinds': {
          const sb = Math.floor(Number(op.smallBlind));
          const bb = Math.floor(Number(op.bigBlind));
          if (!(sb > 0) || !(bb >= sb) || bb > 100_000) throw new GameError('Invalid blinds');
          setBlinds(s, sb, bb);
          this.x.baseSmallBlind = sb;
          this.x.baseBigBlind = bb;
          this.x.blindLevel = 0;
          if (this.x.levelStartedAt !== null) this.x.levelStartedAt = Date.now();
          await this.store.updateTable(this.meta.id, { smallBlind: sb, bigBlind: bb });
          break;
        }
        case 'settings':
          await this.applySettings(op.patch ?? {});
          break;
        case 'bombPot':
          if (this.isSng) throw new GameError('No bomb pots in a tournament');
          s.bombPotNext = true;
          addLog(s, 'Next hand is a bomb pot 💣');
          break;
        case 'addBot':
          this.addBot(Math.floor(Number(op.seatNo)));
          break;
        case 'removeBot': {
          const p = s.seats[Math.floor(Number(op.seatNo))];
          if (!p?.isBot) throw new GameError('No bot in that seat');
          if (this.isSng && this.x.tournament?.status === 'running') throw new GameError('Bots stay until they bust');
          if (isBetting(s) && p.inHand) {
            p.leaveAfterHand = true;
            if (!p.folded && !p.allIn) forceFold(s, p.seatNo);
          } else await this.unseat(p.seatNo);
          break;
        }
        case 'startTournament':
          if (!this.isSng) throw new GameError('This is not a tournament table');
          if (this.tournament().status !== 'registering') throw new GameError('The tournament has already started');
          if (this.seatedCount() < 2) throw new GameError('Need at least two players');
          this.startTournament();
          break;
        case 'close':
          return this.close();
        default:
          throw new GameError('Unknown host command');
      }
      await this.afterChange(true);
    });
  }

  private async applySettings(patch: Partial<EditableSettings>) {
    const s = this.state;
    const next = { ...this.meta.settings };
    if (patch.turnSeconds !== undefined) {
      const t = Math.floor(Number(patch.turnSeconds));
      if (!(t >= MIN_TURN_SECONDS && t <= MAX_TURN_SECONDS)) {
        throw new GameError(`Turn timer must be ${MIN_TURN_SECONDS}-${MAX_TURN_SECONDS} seconds`);
      }
      next.turnSeconds = t;
      s.actionTimeoutMs = t * 1000;
    }
    if (patch.straddle !== undefined) next.straddle = s.straddleAllowed = !!patch.straddle;
    if (patch.runItTwice !== undefined) next.runItTwice = s.ritAllowed = !!patch.runItTwice;
    if (patch.isPrivate !== undefined) next.isPrivate = !!patch.isPrivate;
    if (patch.blindLevelMinutes !== undefined) {
      const m = Math.floor(Number(patch.blindLevelMinutes));
      if (!(m >= 0 && m <= 60)) throw new GameError('Blind levels must be 0-60 minutes');
      if (this.isSng && m === 0) throw new GameError('Tournaments need rising blinds');
      next.blindLevelMinutes = m;
      if (m === 0) this.x.levelStartedAt = null;
      else if (this.x.levelStartedAt === null && s.handNo > 0) this.x.levelStartedAt = Date.now();
    }
    this.meta.settings = next;
    await this.store.updateTable(this.meta.id, { settings: next });
    addLog(s, 'The host changed the table settings');
  }

  private addBot(seatNo: number) {
    const s = this.state;
    if (!Number.isInteger(seatNo) || seatNo < 0 || seatNo >= s.maxSeats) throw new GameError('Invalid seat');
    if (s.seats[seatNo]) throw new GameError('Seat is taken');
    if (this.isSng && this.tournament().status !== 'registering') {
      throw new GameError('The tournament has already started');
    }
    const used = new Set(players(s).map((p) => p.name));
    const name = `Bot ${BOT_NAMES.find((n) => !used.has(`Bot ${n}`)) ?? seatNo + 1}`;
    const userId = `bot:${randomUUID()}`;
    const stack = this.isSng ? this.meta.settings.sngStartingStack : DEFAULT_BUY_IN_BB * s.bigBlind;
    seatPlayer(s, seatNo, { userId, name, avatarUrl: null, isBot: true }, stack);
    if (this.isSng) {
      this.tournament().entrants.push({ userId, name, isBot: true });
      if (this.seatedCount() === s.maxSeats) this.startTournament();
    }
  }

  /** Ends the table: pays everyone out, saves it as closed and tells everyone the results. */
  private async close() {
    const s = this.state;
    if (isBetting(s)) throw new GameError('Wait for the hand to finish (pause the game first)');
    const t = this.x.tournament;
    if (this.isSng && t && t.status !== 'finished') {
      // Tournament cancelled: refund buy-ins and remove chips without paying them out.
      for (const e of t.entrants) {
        if (!e.isBot && this.meta.settings.sngBuyIn > 0) {
          this.pendingCredits.push({ userId: e.userId, amount: this.meta.settings.sngBuyIn });
          this.ledger(e.userId, e.name).cashOut += this.meta.settings.sngBuyIn;
        }
      }
      for (const p of players(s)) s.seats[p.seatNo] = null;
    } else {
      clearFinishedHand(s);
      for (const p of players(s)) this.removeSeat(p.seatNo);
    }
    addLog(s, 'The host closed the table');
    const session = this.sessionEntries();
    await this.persist(true);
    await this.store.updateTable(this.meta.id, { status: 'closed' });
    await this.payCredits();
    this.io.to(this.room).emit('table:closed', { tableId: this.meta.id, session });
    this.closed = true;
    this.dispose();
    this.onClosed(this.meta.id);
  }

  // ---------- tournaments ----------

  private tournament() {
    this.x.tournament ??= { status: 'registering', entrants: [], prizePool: 0, results: [] };
    return this.x.tournament;
  }

  private startTournament() {
    const t = this.tournament();
    if (t.status !== 'registering') return;
    t.status = 'running';
    this.x.blindLevel = 0;
    this.x.levelStartedAt = Date.now();
    setBlinds(this.state, this.x.baseSmallBlind, this.x.baseBigBlind);
    addLog(this.state, `Tournament started with ${t.entrants.length} players. Prize pool ${t.prizePool}`);
  }

  /** Places busted players and pays out once one player is left. */
  private async settleTournament() {
    const t = this.x.tournament;
    if (!this.isSng || t?.status !== 'running') return;
    const s = this.state;
    const alive = players(s).filter((p) => p.stack > 0 && !p.leaveAfterHand);
    const busted = players(s)
      .filter((p) => p.stack <= 0 || p.leaveAfterHand)
      .sort((a, b) => b.handStartStack - a.handStartStack);
    busted.forEach((p, i) => {
      t.results.push({ userId: p.userId, name: p.name, place: alive.length + 1 + i, prize: 0 });
      addLog(s, `${p.name} finishes in place ${alive.length + 1 + i}`);
      s.seats[p.seatNo] = null;
      this.epochs.delete(p.userId);
    });
    if (alive.length > 1) return;

    if (alive[0]) {
      const w = alive[0];
      t.results.push({ userId: w.userId, name: w.name, place: 1, prize: 0 });
      s.seats[w.seatNo] = null;
    }
    t.status = 'finished';
    const payouts = sngPayouts(t.entrants.length);
    let paid = 0;
    t.results.sort((a, b) => a.place - b.place);
    payouts.forEach((pct, i) => {
      const r = t.results[i];
      if (!r) return;
      r.prize = Math.floor((t.prizePool * pct) / 100);
      paid += r.prize;
    });
    if (t.results[0]) t.results[0].prize += t.prizePool - paid;
    for (const r of t.results) {
      if (r.prize > 0 && !isBotId(r.userId)) {
        this.pendingCredits.push({ userId: r.userId, amount: r.prize });
        this.ledger(r.userId, r.name).cashOut += r.prize;
      }
    }
    addLog(s, `Tournament over. ${t.results[0]?.name ?? 'Nobody'} wins!`);
  }

  // ---------- internals ----------

  private requireHost(user: AuthUser) {
    if (user.id !== this.meta.hostId) throw new GameError('Only the host can do that');
  }

  private mySeat(user: AuthUser) {
    const seat = findSeat(this.state, user.id);
    if (seat === null) throw new GameError('You are not seated');
    return this.state.seats[seat]!;
  }

  private ledger(userId: string, name: string) {
    const e = (this.x.ledger[userId] ??= { name, buyIn: 0, cashOut: 0 });
    e.name = name;
    return e;
  }

  private removeSeat(seatNo: number) {
    const p = this.state.seats[seatNo]!;
    const stack = removePlayer(this.state, seatNo);
    this.media.delete(p.userId);
    this.epochs.delete(p.userId);
    if (p.isBot) return;
    this.ledger(p.userId, p.name).cashOut += stack;
    if (stack > 0) this.pendingCredits.push({ userId: p.userId, amount: stack });
    else this.notifyProfile(p.userId);
    if (this.isMemberUser(p.userId)) this.addVideoSpectator(p.userId);
  }

  /** Seats waitlisted players in free seats with a default buy-in. */
  private async fillFromWaitlist() {
    const s = this.state;
    while (this.x.waitlist.length && !this.isSng) {
      const free = s.seats.findIndex((p) => !p);
      if (free === -1) return;
      const w = this.x.waitlist.shift()!;
      if (!this.isMemberUser(w.userId)) continue;
      const profile = await this.store.getProfile(w.userId);
      const balance = profile?.chipBalance ?? 0;
      const buyIn = Math.min(DEFAULT_BUY_IN_BB * s.bigBlind, balance);
      const info = this.names.get(w.userId);
      try {
        await this.seatUser({ id: w.userId, name: info?.name ?? w.name, avatarUrl: info?.avatarUrl ?? null }, free, buyIn);
        addLog(s, `${w.name} takes a seat from the waitlist`);
      } catch (e) {
        addLog(s, `${w.name} couldn't take the open seat (${(e as Error).message})`);
      }
    }
  }

  private recordPlayers(): RecordedPlayer[] {
    const s = this.state;
    const r = s.result!;
    const shown = new Set(r.revealed.map((x) => x.seatNo));
    const won = new Map(r.winners.map((w) => [w.seatNo, w.amount]));
    return players(s)
      .filter((p) => p.inHand)
      .map((p) => {
        const pre = s.handActions.filter((a) => a.userId === p.userId && a.street === 'preflop');
        return {
          userId: p.userId,
          name: p.name,
          seatNo: p.seatNo,
          startStack: p.handStartStack,
          net: p.stack - p.handStartStack,
          cards: p.holeCards.slice(),
          shown: shown.has(p.seatNo),
          isBot: p.isBot,
          vpip: pre.some((a) => a.action === 'call' || a.action === 'raise'),
          pfr: pre.some((a) => a.action === 'raise'),
          won: (won.get(p.seatNo) ?? 0) > 0,
          potWon: won.get(p.seatNo) ?? 0,
        };
      });
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
          details: {
            board2: s.result.board2 ?? null,
            dealerSeat: s.dealerSeat,
            smallBlind: s.smallBlind,
            bigBlind: s.bigBlind,
            players: this.recordPlayers(),
          },
        })
        .catch((e) => console.error('hand history failed', e));
    }
    if (!this.isSng) {
      s.seats.forEach((p, i) => {
        if (p?.leaveAfterHand) this.removeSeat(i);
      });
    }
  }

  /** Raises the blinds when the current level's time is up. Applied between hands. */
  private advanceBlindLevel(now = Date.now()) {
    const mins = this.meta.settings.blindLevelMinutes;
    if (!mins || this.x.levelStartedAt === null || this.x.paused) return;
    if (now < this.x.levelStartedAt + mins * 60_000) return;
    const max = BLIND_LEVEL_MULTIPLIERS.length - 1;
    this.x.blindLevel = Math.min(max, this.x.blindLevel + 1);
    this.x.levelStartedAt = now;
    const [sb, bb] = this.levelBlinds(this.x.blindLevel);
    setBlinds(this.state, sb, bb);
  }

  private levelBlinds(level: number): [number, number] {
    const m = BLIND_LEVEL_MULTIPLIERS[Math.min(level, BLIND_LEVEL_MULTIPLIERS.length - 1)];
    const sb = Math.max(1, Math.round(this.x.baseSmallBlind * m));
    const bb = Math.max(sb, Math.round(this.x.baseBigBlind * m));
    return [sb, bb];
  }

  private canDeal() {
    if (this.x.paused || this.closed) return false;
    if (this.isSng && this.x.tournament?.status !== 'running') return false;
    return canStartHand(this.state);
  }

  private async afterChange(seatsChanged: boolean) {
    if (this.state.street === 'showdown' && !this.state.handSettled) {
      await this.settleHand();
      seatsChanged = true;
    }
    if (!isBetting(this.state) && this.x.waitlist.length && this.state.seats.some((p) => !p)) {
      await this.fillFromWaitlist();
      seatsChanged = true;
    }
    await this.persist(seatsChanged);
    await this.payCredits();
    this.scheduleTimers();
    this.broadcast();
  }

  /** Credit chips only after the snapshot without the player is saved, so a crash can't duplicate chips. */
  private async payCredits() {
    const credits = this.pendingCredits.splice(0);
    for (const c of credits) {
      try {
        await this.store.adjustBalance(c.userId, c.amount);
      } catch (e) {
        console.error(`failed to credit ${c.amount} to ${c.userId}`, e);
      }
      this.notifyProfile(c.userId);
    }
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
    return players(this.state)
      .filter((p) => !p.isBot)
      .map((p) => ({
        tableId: this.meta.id,
        seatNo: p.seatNo,
        userId: p.userId,
        stack: p.stack,
        status: seatStatus(p),
      }));
  }

  private scheduleTimers(now = Date.now()) {
    const s = this.state;
    if (this.closed) return;
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    if (s.toAct !== null && s.actionDeadline !== null) {
      const handNo = s.handNo;
      const seat = s.toAct;
      const bot = s.seats[seat]?.isBot;
      const delay = bot ? 700 + Math.random() * 1500 : Math.max(0, s.actionDeadline - now);
      this.turnTimer = setTimeout(
        () =>
          this.run(async () => {
            if (this.state.handNo !== handNo || this.state.toAct !== seat) return;
            if (bot) applyAction(this.state, seat, chooseBotAction(this.state, seat));
            else handleTimeout(this.state);
            await this.afterChange(false);
          }).catch((e) => console.error('turn timer failed', e)),
        delay,
      );
    }

    // Wake up when the blind level changes so everyone sees the new level.
    if (this.levelTimer) clearTimeout(this.levelTimer);
    this.levelTimer = null;
    const lv = this.blindInfo();
    if (lv.nextLevelAt !== null) {
      this.levelTimer = setTimeout(() => this.broadcast(), Math.max(1000, lv.nextLevelAt - now + 50));
    }

    if (isBetting(s) || this.nextHandTimer) return;
    if (s.street === 'waiting' && !this.canDeal()) return;
    const delay = s.street === 'showdown' ? NEXT_HAND_DELAY_MS : BETWEEN_HANDS_DELAY_MS;
    this.nextHandAt = this.canDeal() ? now + delay : null;
    this.nextHandTimer = setTimeout(
      () =>
        this.run(async () => {
          this.nextHandTimer = null;
          this.nextHandAt = null;
          // Tournament busts are placed after the result has been on screen.
          if (this.state.street === 'showdown') await this.settleTournament();
          clearFinishedHand(this.state);
          if (this.canDeal()) {
            if (this.meta.settings.blindLevelMinutes && this.x.levelStartedAt === null) {
              this.x.levelStartedAt = Date.now();
            }
            this.advanceBlindLevel();
            startHand(this.state);
          }
          await this.afterChange(this.isSng);
        }).catch((e) => console.error('next hand failed', e)),
      delay,
    );
  }

  private blindInfo(): BlindLevelInfo {
    const mins = this.meta.settings.blindLevelMinutes;
    if (!mins || this.x.levelStartedAt === null) {
      return { level: this.x.blindLevel, nextLevelAt: null, nextSmallBlind: null, nextBigBlind: null };
    }
    const atMax = this.x.blindLevel >= BLIND_LEVEL_MULTIPLIERS.length - 1;
    const pausedFor = this.x.paused && this.x.pausedAt !== null ? Date.now() - this.x.pausedAt : 0;
    const [sb, bb] = this.levelBlinds(this.x.blindLevel + 1);
    return {
      level: this.x.blindLevel,
      nextLevelAt: atMax ? null : this.x.levelStartedAt + mins * 60_000 + pausedFor,
      nextSmallBlind: atMax ? null : sb,
      nextBigBlind: atMax ? null : bb,
    };
  }

  private sessionEntries(): SessionEntry[] {
    return Object.entries(this.x.ledger)
      .map(([userId, e]) => {
        const seat = findSeat(this.state, userId);
        const onTable = seat !== null && !this.isSng ? this.state.seats[seat]!.stack : 0;
        return {
          userId,
          name: e.name,
          buyIn: e.buyIn,
          cashOut: e.cashOut,
          onTable,
          net: e.cashOut + onTable - e.buyIn,
        };
      })
      .sort((a, b) => b.net - a.net);
  }

  publicSettings(): TableSettings {
    const { passwordHash, ...rest } = this.meta.settings;
    return { ...rest, hasPassword: !!passwordHash };
  }

  private tournamentInfo(): TournamentInfo | null {
    if (!this.isSng) return null;
    const t = this.tournament();
    return {
      status: t.status,
      entrants: t.entrants.length,
      prizePool: t.prizePool,
      payouts: sngPayouts(Math.max(2, t.entrants.length)),
      results: t.results.slice().sort((a, b) => a.place - b.place),
    };
  }

  private spectators(): Spectator[] {
    const seated = new Set(players(this.state).map((p) => p.userId));
    const out: Spectator[] = [];
    for (const u of new Set(this.members.values())) {
      if (seated.has(u)) continue;
      const n = this.names.get(u);
      out.push({
        userId: u,
        name: n?.name ?? 'Spectator',
        avatarUrl: n?.avatarUrl ?? null,
        rtcEpoch: this.videoSpectators.includes(u) ? this.epochs.get(u) ?? 0 : 0,
      });
    }
    return out;
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
      {
        settings: this.publicSettings(),
        paused: this.x.paused,
        nextHandAt: this.nextHandAt,
        blinds: this.blindInfo(),
        tournament: this.tournamentInfo(),
        spectators: this.spectators(),
        waitlist: this.x.waitlist.slice(),
        session: this.sessionEntries(),
      },
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
    if (this.levelTimer) clearTimeout(this.levelTimer);
  }
}
