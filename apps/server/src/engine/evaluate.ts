import pokersolver from 'pokersolver';
import type { Card, Variant } from '@pk/shared';

const { Hand } = pokersolver;
type SolvedHand = InstanceType<typeof Hand>;

export interface Evaluated {
  seatNo: number;
  handName: string;
}

function combos<T>(items: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (items.length < k) return [];
  const [first, ...rest] = items;
  return [...combos(rest, k - 1).map((c) => [first, ...c]), ...combos(rest, k)];
}

/**
 * Best hand for one player. Hold'em uses any five of hole + board; Omaha must use exactly two
 * hole cards and three board cards.
 */
export function bestHand(hole: Card[], board: Card[], variant: Variant = 'holdem'): SolvedHand | null {
  if (variant === 'omaha') {
    if (board.length < 3) return null;
    const candidates: SolvedHand[] = [];
    for (const h of combos(hole, 2)) for (const b of combos(board, 3)) candidates.push(Hand.solve([...h, ...b]));
    return Hand.winners(candidates)[0] ?? null;
  }
  return Hand.solve([...hole, ...board]);
}

export function describeHand(hole: Card[], board: Card[], variant: Variant = 'holdem'): string {
  return bestHand(hole, board, variant)?.descr ?? '';
}

/** Returns the evaluated hand for each contender and the seat numbers that win. */
export function evaluateShowdown(
  contenders: { seatNo: number; cards: Card[] }[],
  board: Card[],
  variant: Variant = 'holdem',
): { evaluated: Evaluated[]; winners: number[] } {
  const hands = contenders.map((c) => bestHand(c.cards, board, variant)!);
  const winning = new Set(Hand.winners(hands));
  return {
    evaluated: contenders.map((c, i) => ({ seatNo: c.seatNo, handName: hands[i].descr })),
    winners: contenders.filter((_, i) => winning.has(hands[i])).map((c) => c.seatNo),
  };
}

/** Rough 0..1 strength used by bots: pokersolver rank (1 high card .. 9 straight flush). */
export function handRank(hole: Card[], board: Card[], variant: Variant = 'holdem'): number {
  const h = bestHand(hole, board, variant);
  return h ? h.rank : 0;
}
