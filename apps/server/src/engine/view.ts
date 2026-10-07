import type { PublicSeat, SeatStatus, TableState } from '@pk/shared';
import { findSeat, isBetting, legalActions, type EnginePlayer, type GameState } from './game';
import { computePots } from './pots';

export interface TableMeta {
  id: string;
  name: string;
  hostId: string;
}

export interface SeatExtras {
  camOn: boolean;
  micOn: boolean;
  rtcEpoch: number;
}

export function seatStatus(p: EnginePlayer): SeatStatus {
  if (p.sittingOut) return 'sitting_out';
  if (!p.connected) return 'disconnected';
  return 'active';
}

export function toPublicState(
  s: GameState,
  meta: TableMeta,
  viewerId: string | null,
  extras: (userId: string) => SeatExtras,
  nextHandAt: number | null,
  now = Date.now(),
): TableState {
  const mySeat = viewerId ? findSeat(s, viewerId) : null;
  const revealed = new Map(s.result?.revealed.map((r) => [r.seatNo, r.cards]) ?? []);

  const seats = s.seats.map((p): PublicSeat | null => {
    if (!p) return null;
    const own = p.userId === viewerId;
    const hasCards = p.inHand && !p.folded && p.holeCards.length > 0;
    const x = extras(p.userId);
    return {
      seatNo: p.seatNo,
      userId: p.userId,
      name: p.name,
      avatarUrl: p.avatarUrl,
      stack: p.stack,
      bet: p.bet,
      folded: p.folded,
      allIn: p.allIn,
      inHand: p.inHand,
      status: seatStatus(p),
      connected: p.connected,
      cards: revealed.get(p.seatNo) ?? (own && p.holeCards.length ? p.holeCards : null),
      hasCards,
      lastAction: p.lastAction,
      camOn: x.camOn,
      micOn: x.micOn,
      rtcEpoch: x.rtcEpoch,
    };
  });

  const inHand = s.seats.filter((p): p is EnginePlayer => !!p && p.inHand);
  const collected = inHand.map((p) => ({
    seatNo: p.seatNo,
    committed: isBetting(s) ? p.committed - p.bet : p.committed,
    folded: p.folded,
  }));

  return {
    id: meta.id,
    name: meta.name,
    hostId: meta.hostId,
    smallBlind: s.smallBlind,
    bigBlind: s.bigBlind,
    maxSeats: s.maxSeats,
    seats,
    street: s.street,
    board: s.board,
    pots: s.street === 'showdown' ? [] : computePots(collected),
    potTotal: inHand.reduce((sum, p) => sum + p.committed, 0),
    currentBet: s.currentBet,
    dealerSeat: s.dealerSeat,
    toAct: s.toAct,
    actionDeadline: s.actionDeadline,
    nextHandAt,
    handNo: s.handNo,
    result: s.result,
    log: s.log.slice(-30),
    mySeat,
    legal: mySeat !== null ? legalActions(s, mySeat) : null,
    serverTime: now,
  };
}
