import { randomInt } from 'node:crypto';
import type { Card } from '@pk/shared';

export type Rng = (maxExclusive: number) => number;

export const secureRng: Rng = (max) => randomInt(max);

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c'];

export function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

export function shuffle(deck: Card[], rng: Rng = secureRng): Card[] {
  const d = deck.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
