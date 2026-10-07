import {
  ACTION_TIMEOUT_MS,
  LOG_LIMIT,
  MAX_MISSED_HANDS,
  type Card,
  type HandResult,
  type HandWinner,
  type LegalActions,
  type LogEntry,
  type PlayerAction,
  type RevealedHand,
  type Street,
} from '@pk/shared';
import { newDeck, secureRng, shuffle, type Rng } from './deck';
import { evaluateShowdown } from './evaluate';
import { computePots } from './pots';

export interface EnginePlayer {
  userId: string;
  name: string;
  avatarUrl: string | null;
  seatNo: number;
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in over the whole hand. */
  committed: number;
  holeCards: Card[];
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  lastAction: string | null;
  connected: boolean;
  sittingOut: boolean;
  /** Set when the server sat the player out for missing hands while disconnected. */
  autoSatOut: boolean;
  missedHands: number;
  leaveAfterHand: boolean;
}

export interface HandActionRecord {
  street: Street;
  seatNo: number;
  userId: string;
  action: string;
  amount: number;
  ts: number;
}

export interface GameState {
  tableId: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  seats: (EnginePlayer | null)[];
  street: Street;
  deck: Card[];
  board: Card[];
  dealerSeat: number;
  toAct: number | null;
  currentBet: number;
  /** Size of the last full raise on this street; the minimum legal raise increment. */
  minRaise: number;
  handNo: number;
  actionDeadline: number | null;
  actionTimeoutMs: number;
  result: HandResult | null;
  /** True once the server has paid out leavers and recorded history for the finished hand. */
  handSettled: boolean;
  log: LogEntry[];
  handActions: HandActionRecord[];
}

export class GameError extends Error {}

export interface GameOptions {
  tableId: string;
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  actionTimeoutMs?: number;
}

export function createGame(o: GameOptions): GameState {
  return {
    tableId: o.tableId,
    smallBlind: o.smallBlind,
    bigBlind: o.bigBlind,
    maxSeats: o.maxSeats,
    seats: Array.from({ length: o.maxSeats }, () => null),
    street: 'waiting',
    deck: [],
    board: [],
    dealerSeat: -1,
    toAct: null,
    currentBet: 0,
    minRaise: o.bigBlind,
    handNo: 0,
    actionDeadline: null,
    actionTimeoutMs: o.actionTimeoutMs ?? ACTION_TIMEOUT_MS,
    result: null,
    handSettled: true,
    log: [],
    handActions: [],
  };
}

// ---------- seating ----------

export function seatPlayer(
  s: GameState,
  seatNo: number,
  info: { userId: string; name: string; avatarUrl: string | null },
  stack: number,
): EnginePlayer {
  if (seatNo < 0 || seatNo >= s.maxSeats) throw new GameError('Invalid seat');
  if (s.seats[seatNo]) throw new GameError('Seat is taken');
  if (findSeat(s, info.userId) !== null) throw new GameError('Already seated at this table');
  const p: EnginePlayer = {
    ...info,
    seatNo,
    stack,
    bet: 0,
    committed: 0,
    holeCards: [],
    inHand: false,
    folded: false,
    allIn: false,
    acted: false,
    lastAction: null,
    connected: true,
    sittingOut: false,
    autoSatOut: false,
    missedHands: 0,
    leaveAfterHand: false,
  };
  s.seats[seatNo] = p;
  addLog(s, `${p.name} sits down with ${stack}`);
  return p;
}

/** Removes a player who is not in a live hand. Returns their remaining stack. */
export function removePlayer(s: GameState, seatNo: number): number {
  const p = s.seats[seatNo];
  if (!p) return 0;
  if (isLive(p) && isBetting(s)) throw new GameError('Player is still in the hand');
  s.seats[seatNo] = null;
  addLog(s, `${p.name} leaves the table`);
  return p.stack;
}

export function findSeat(s: GameState, userId: string): number | null {
  const i = s.seats.findIndex((p) => p?.userId === userId);
  return i === -1 ? null : i;
}

// ---------- predicates ----------

const isLive = (p: EnginePlayer | null): p is EnginePlayer => !!p && p.inHand && !p.folded;
const canAct = (p: EnginePlayer | null): p is EnginePlayer => isLive(p) && !p.allIn;
const eligibleForHand = (p: EnginePlayer | null): p is EnginePlayer =>
  !!p && !p.sittingOut && !p.leaveAfterHand && p.stack > 0;

export const isBetting = (s: GameState) =>
  s.street === 'preflop' || s.street === 'flop' || s.street === 'turn' || s.street === 'river';

export function canStartHand(s: GameState): boolean {
  if (isBetting(s)) return false;
  return s.seats.filter(eligibleForHand).length >= 2;
}

function nextSeat(s: GameState, from: number, pred: (p: EnginePlayer | null) => boolean): number | null {
  for (let i = 1; i <= s.maxSeats; i++) {
    const idx = (from + i + s.maxSeats) % s.maxSeats;
    if (pred(s.seats[idx])) return idx;
  }
  return null;
}

function players(s: GameState): EnginePlayer[] {
  return s.seats.filter((p): p is EnginePlayer => !!p);
}

// ---------- hand flow ----------

export function startHand(s: GameState, rng: Rng = secureRng, now = Date.now()): void {
  if (!canStartHand(s)) throw new GameError('Need at least two players to start');

  for (const p of players(s)) {
    if (!p.connected && p.missedHands >= MAX_MISSED_HANDS && !p.sittingOut) {
      p.sittingOut = true;
      p.autoSatOut = true;
      addLog(s, `${p.name} is sitting out (disconnected)`);
    }
  }
  if (!canStartHand(s)) return resetToWaiting(s);

  for (const p of players(s)) {
    p.bet = 0;
    p.committed = 0;
    p.holeCards = [];
    p.folded = false;
    p.allIn = false;
    p.acted = false;
    p.lastAction = null;
    p.inHand = eligibleForHand(p);
  }

  s.handNo += 1;
  s.board = [];
  s.result = null;
  s.handSettled = false;
  s.handActions = [];
  s.deck = shuffle(newDeck(), rng);

  const inHand = (p: EnginePlayer | null) => !!p && p.inHand;
  const dealer = nextSeat(s, s.dealerSeat < 0 ? s.maxSeats - 1 : s.dealerSeat, inHand)!;
  s.dealerSeat = dealer;
  const headsUp = players(s).filter((p) => p.inHand).length === 2;
  const sb = headsUp ? dealer : nextSeat(s, dealer, inHand)!;
  const bb = nextSeat(s, sb, inHand)!;

  addLog(s, `--- Hand #${s.handNo} ---`);
  post(s, s.seats[sb]!, s.smallBlind, 'SB');
  post(s, s.seats[bb]!, s.bigBlind, 'BB');
  s.currentBet = Math.max(s.seats[sb]!.bet, s.seats[bb]!.bet);
  s.minRaise = s.bigBlind;

  for (let round = 0; round < 2; round++) {
    let seat = sb;
    do {
      s.seats[seat]!.holeCards.push(s.deck.pop()!);
      seat = nextSeat(s, seat, inHand)!;
    } while (seat !== sb);
  }

  s.street = 'preflop';
  s.toAct = null;
  moveOn(s, bb, now);
}

function post(s: GameState, p: EnginePlayer, amount: number, label: string) {
  const amt = Math.min(amount, p.stack);
  putChips(p, amt);
  p.lastAction = label;
  addLog(s, `${p.name} posts ${label} ${amt}`);
}

function putChips(p: EnginePlayer, amt: number) {
  p.stack -= amt;
  p.bet += amt;
  p.committed += amt;
  if (p.stack === 0) p.allIn = true;
}

export function legalActions(s: GameState, seatNo: number): LegalActions | null {
  if (!isBetting(s) || s.toAct !== seatNo) return null;
  const p = s.seats[seatNo];
  if (!canAct(p)) return null;
  const toCall = Math.min(s.currentBet - p.bet, p.stack);
  const maxRaiseTo = p.bet + p.stack;
  const othersCanAct = s.seats.some((o) => o !== p && canAct(o));
  const canRaise = maxRaiseTo > s.currentBet && othersCanAct;
  const minRaiseTo = Math.min(maxRaiseTo, s.currentBet === 0 ? s.bigBlind : s.currentBet + s.minRaise);
  return {
    fold: true,
    check: toCall <= 0,
    call: toCall > 0 ? toCall : null,
    minRaiseTo: canRaise ? minRaiseTo : null,
    maxRaiseTo: canRaise ? maxRaiseTo : null,
  };
}

export function applyAction(s: GameState, seatNo: number, action: PlayerAction, now = Date.now()): void {
  const legal = legalActions(s, seatNo);
  if (!legal) throw new GameError("It's not your turn");
  const p = s.seats[seatNo]!;
  let amount = 0;
  let label: string;

  switch (action.type) {
    case 'fold':
      p.folded = true;
      label = 'Fold';
      break;
    case 'check':
      if (!legal.check) throw new GameError('Cannot check, there is a bet to call');
      label = 'Check';
      break;
    case 'call':
      if (legal.call === null) throw new GameError('Nothing to call');
      amount = legal.call;
      putChips(p, amount);
      label = p.allIn ? 'All-in' : 'Call';
      break;
    case 'raise': {
      if (legal.minRaiseTo === null || legal.maxRaiseTo === null) throw new GameError('Cannot raise');
      const to = Math.floor(Number(action.amount));
      if (!Number.isFinite(to) || to < legal.minRaiseTo || to > legal.maxRaiseTo) {
        throw new GameError(`Raise must be between ${legal.minRaiseTo} and ${legal.maxRaiseTo}`);
      }
      const wasBet = s.currentBet === 0;
      const increment = to - s.currentBet;
      amount = to - p.bet;
      putChips(p, amount);
      if (increment >= s.minRaise) {
        s.minRaise = increment;
        for (const o of players(s)) if (o !== p) o.acted = false;
      }
      s.currentBet = to;
      label = p.allIn ? 'All-in' : wasBet ? 'Bet' : 'Raise';
      break;
    }
    default:
      throw new GameError('Unknown action');
  }

  p.acted = true;
  p.lastAction = label;
  if (p.connected) p.missedHands = 0;
  s.handActions.push({ street: s.street, seatNo, userId: p.userId, action: action.type, amount, ts: now });
  addLog(s, `${p.name}: ${label}${amount ? ` ${action.type === 'raise' ? 'to ' + s.currentBet : amount}` : ''}`);
  moveOn(s, seatNo, now);
}

/** Auto-acts for the player whose timer ran out: check if free, otherwise fold. */
export function handleTimeout(s: GameState, now = Date.now()): void {
  if (s.toAct === null) return;
  const p = s.seats[s.toAct]!;
  const legal = legalActions(s, s.toAct);
  if (!legal) return;
  if (!p.connected) p.missedHands += 1;
  addLog(s, `${p.name} timed out`);
  applyAction(s, s.toAct, { type: legal.check ? 'check' : 'fold' }, now);
}

/** Folds a player regardless of turn order (used when they stand up mid-hand). */
export function forceFold(s: GameState, seatNo: number, now = Date.now()): void {
  const p = s.seats[seatNo];
  if (!isLive(p) || !isBetting(s)) return;
  if (s.toAct === seatNo) return applyAction(s, seatNo, { type: 'fold' }, now);
  p.folded = true;
  p.lastAction = 'Fold';
  addLog(s, `${p.name}: Fold`);
  if (players(s).filter(isLive).length === 1) moveOn(s, s.toAct ?? seatNo, now);
}

function findNextToAct(s: GameState, from: number): number | null {
  return nextSeat(s, from, (p) => canAct(p) && (!p.acted || p.bet < s.currentBet));
}

function moveOn(s: GameState, from: number, now: number): void {
  const live = players(s).filter(isLive);
  if (live.length === 1) return finishUncontested(s, live[0]);

  const next = findNextToAct(s, from);
  if (next !== null) {
    s.toAct = next;
    s.actionDeadline = now + s.actionTimeoutMs;
    return;
  }

  returnUncalledBet(s);
  for (const p of players(s)) {
    p.bet = 0;
    p.acted = false;
    if (p.inHand && !p.folded && !p.allIn) p.lastAction = null;
  }
  s.currentBet = 0;
  s.minRaise = s.bigBlind;
  s.toAct = null;
  s.actionDeadline = null;

  if (s.street === 'river') return showdown(s);
  dealNextStreet(s);

  if (players(s).filter(canAct).length < 2) {
    while (s.board.length < 5) dealNextStreet(s);
    return showdown(s);
  }
  moveOn(s, s.dealerSeat, now);
}

function dealNextStreet(s: GameState) {
  s.deck.pop(); // burn
  if (s.board.length === 0) {
    s.board.push(s.deck.pop()!, s.deck.pop()!, s.deck.pop()!);
    s.street = 'flop';
  } else {
    s.board.push(s.deck.pop()!);
    s.street = s.board.length === 4 ? 'turn' : 'river';
  }
  addLog(s, `${s.street[0].toUpperCase()}${s.street.slice(1)}: ${s.board.join(' ')}`);
}

function returnUncalledBet(s: GameState) {
  const bettors = players(s)
    .filter((p) => p.inHand && p.bet > 0)
    .sort((a, b) => b.bet - a.bet);
  if (!bettors.length) return;
  const top = bettors[0];
  const second = bettors[1]?.bet ?? 0;
  const excess = top.bet - second;
  if (excess > 0) {
    top.stack += excess;
    top.bet -= excess;
    top.committed -= excess;
    if (top.stack > 0) top.allIn = false;
    addLog(s, `Uncalled ${excess} returned to ${top.name}`);
  }
}

function finishUncontested(s: GameState, winner: EnginePlayer) {
  returnUncalledBet(s);
  const total = players(s).reduce((sum, p) => sum + p.committed, 0);
  winner.stack += total;
  addLog(s, `${winner.name} wins ${total}`);
  endHand(s, {
    handNo: s.handNo,
    showdown: false,
    winners: [{ seatNo: winner.seatNo, userId: winner.userId, name: winner.name, amount: total, handName: null }],
    revealed: [],
    board: s.board.slice(),
  });
}

function showdown(s: GameState) {
  const all = players(s).filter((p) => p.inHand);
  const pots = computePots(all.map((p) => ({ seatNo: p.seatNo, committed: p.committed, folded: p.folded })));
  const live = all.filter((p) => !p.folded);
  const { evaluated } = evaluateShowdown(
    live.map((p) => ({ seatNo: p.seatNo, cards: p.holeCards })),
    s.board,
  );
  const handNames = new Map(evaluated.map((e) => [e.seatNo, e.handName]));
  const won = new Map<number, number>();

  for (const pot of pots) {
    const contenders = live.filter((p) => pot.eligibleSeats.includes(p.seatNo));
    const winners =
      contenders.length === 1
        ? [contenders[0].seatNo]
        : evaluateShowdown(
            contenders.map((p) => ({ seatNo: p.seatNo, cards: p.holeCards })),
            s.board,
          ).winners;
    const ordered = orderFromDealer(s, winners);
    const share = Math.floor(pot.amount / ordered.length);
    let remainder = pot.amount - share * ordered.length;
    for (const seatNo of ordered) {
      const amt = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      won.set(seatNo, (won.get(seatNo) ?? 0) + amt);
    }
  }

  const winners: HandWinner[] = [];
  for (const [seatNo, amount] of won) {
    const p = s.seats[seatNo]!;
    p.stack += amount;
    winners.push({ seatNo, userId: p.userId, name: p.name, amount, handName: handNames.get(seatNo) ?? null });
    addLog(s, `${p.name} wins ${amount} with ${handNames.get(seatNo)}`);
  }
  const revealed: RevealedHand[] = live.map((p) => ({
    seatNo: p.seatNo,
    cards: p.holeCards.slice(),
    handName: handNames.get(p.seatNo)!,
  }));
  endHand(s, { handNo: s.handNo, showdown: true, winners, revealed, board: s.board.slice() });
}

function orderFromDealer(s: GameState, seats: number[]): number[] {
  return seats
    .slice()
    .sort(
      (a, b) =>
        ((a - s.dealerSeat - 1 + s.maxSeats) % s.maxSeats) - ((b - s.dealerSeat - 1 + s.maxSeats) % s.maxSeats),
    );
}

function endHand(s: GameState, result: HandResult) {
  for (const p of players(s)) {
    p.bet = 0;
    p.allIn = false;
  }
  s.street = 'showdown';
  s.toAct = null;
  s.actionDeadline = null;
  s.currentBet = 0;
  s.result = result;
}

function resetToWaiting(s: GameState) {
  s.street = 'waiting';
  s.toAct = null;
  s.actionDeadline = null;
  s.board = [];
  s.currentBet = 0;
}

/** After the result has been shown and settled, return the table to a resting state. */
export function clearFinishedHand(s: GameState): void {
  if (s.street !== 'showdown') return;
  for (const p of players(s)) {
    p.inHand = false;
    p.holeCards = [];
    p.committed = 0;
    p.folded = false;
    p.lastAction = null;
  }
  s.result = null;
  resetToWaiting(s);
}

export function addLog(s: GameState, text: string, now = Date.now()) {
  s.log.push({ ts: now, text });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

export function totalChips(s: GameState): number {
  return players(s).reduce((sum, p) => sum + p.stack + (isBetting(s) ? p.committed : 0), 0);
}
