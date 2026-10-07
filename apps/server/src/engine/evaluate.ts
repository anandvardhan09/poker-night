import pokersolver from 'pokersolver';
import type { Card } from '@pk/shared';

const { Hand } = pokersolver;

export interface Evaluated {
  seatNo: number;
  handName: string;
}

/** Returns the evaluated hand for each contender and the seat numbers that win. */
export function evaluateShowdown(
  contenders: { seatNo: number; cards: Card[] }[],
  board: Card[],
): { evaluated: Evaluated[]; winners: number[] } {
  const hands = contenders.map((c) => Hand.solve([...c.cards, ...board]));
  const winning = new Set(Hand.winners(hands));
  return {
    evaluated: contenders.map((c, i) => ({ seatNo: c.seatNo, handName: hands[i].descr })),
    winners: contenders.filter((_, i) => winning.has(hands[i])).map((c) => c.seatNo),
  };
}
