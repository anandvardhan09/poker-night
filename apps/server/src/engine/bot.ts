import type { Card, PlayerAction } from '@pk/shared';
import { handRank } from './evaluate';
import { legalActions, players, type GameState } from './game';

const RANK = '23456789TJQKA';
const value = (c: Card) => RANK.indexOf(c[0]) + 2;

/** 0..1 preflop strength from the best two cards (pairs, high cards, suited, connected). */
function preflopStrength(hole: Card[]): number {
  let best = 0;
  for (let i = 0; i < hole.length; i++) {
    for (let j = i + 1; j < hole.length; j++) {
      const [a, b] = [value(hole[i]), value(hole[j])].sort((x, y) => y - x);
      let score = (a + b) / 28; // 0.18 (2-3) .. 1 (A-A by sum)
      if (a === b) score += 0.35 + a / 60;
      if (hole[i][1] === hole[j][1]) score += 0.06;
      if (a - b === 1) score += 0.04;
      if (a >= 11 && b >= 10) score += 0.08;
      best = Math.max(best, score);
    }
  }
  return Math.min(1, best * (hole.length > 2 ? 0.9 : 1));
}

/** 0..1 postflop strength from the made hand. */
function postflopStrength(s: GameState, hole: Card[]): number {
  const rank = handRank(hole, s.board, s.variant); // 1 high card .. 9 straight flush
  return Math.min(1, rank / 5);
}

/**
 * A simple rule-based player: plays strong hands aggressively, calls cheap bets with medium
 * hands and folds weak ones, with a little randomness so it isn't fully predictable.
 */
export function chooseBotAction(s: GameState, seatNo: number, rand: () => number = Math.random): PlayerAction {
  const legal = legalActions(s, seatNo);
  const p = s.seats[seatNo]!;
  if (!legal) return { type: 'fold' };
  const strength =
    (s.board.length === 0 ? preflopStrength(p.holeCards) : postflopStrength(s, p.holeCards)) + (rand() - 0.5) * 0.15;
  const pot = players(s).reduce((sum, o) => sum + o.committed, 0);
  const toCall = legal.call ?? 0;
  const potOdds = toCall / Math.max(1, pot + toCall);

  const raiseTo = (fraction: number): PlayerAction | null => {
    if (legal.minRaiseTo === null || legal.maxRaiseTo === null) return null;
    const target = Math.round(s.currentBet + (pot + toCall) * fraction);
    return { type: 'raise', amount: Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, target)) };
  };

  if (strength > 0.8) return raiseTo(rand() < 0.5 ? 0.75 : 1) ?? (legal.check ? { type: 'check' } : { type: 'call' });
  if (strength > 0.6) {
    if (legal.check) return (rand() < 0.4 && raiseTo(0.5)) || { type: 'check' };
    return potOdds < 0.4 ? { type: 'call' } : { type: 'fold' };
  }
  if (strength > 0.4) {
    if (legal.check) return { type: 'check' };
    return potOdds < 0.2 ? { type: 'call' } : { type: 'fold' };
  }
  if (legal.check) return rand() < 0.08 && raiseTo(0.5) ? raiseTo(0.5)! : { type: 'check' };
  return { type: 'fold' };
}
