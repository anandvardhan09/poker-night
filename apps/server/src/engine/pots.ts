import type { Pot } from '@pk/shared';

export interface Contribution {
  seatNo: number;
  committed: number;
  folded: boolean;
}

/**
 * Splits committed chips into a main pot and side pots. Each pot level is set by
 * the commitment of a live (non-folded) player; folded chips fill lower levels first.
 */
export function computePots(contribs: Contribution[]): Pot[] {
  const levels = [
    ...new Set(contribs.filter((c) => !c.folded && c.committed > 0).map((c) => c.committed)),
  ].sort((a, b) => a - b);

  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.committed, level) - prev);
    const eligibleSeats = contribs
      .filter((c) => !c.folded && c.committed >= level)
      .map((c) => c.seatNo)
      .sort((a, b) => a - b);
    const last = pots[pots.length - 1];
    if (last && sameSeats(last.eligibleSeats, eligibleSeats)) last.amount += amount;
    else if (amount > 0) pots.push({ amount, eligibleSeats });
    prev = level;
  }

  const leftover = contribs.reduce((sum, c) => sum + Math.max(0, c.committed - prev), 0);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else {
      const live = contribs.filter((c) => !c.folded).map((c) => c.seatNo);
      pots.push({ amount: leftover, eligibleSeats: live });
    }
  }
  return pots;
}

function sameSeats(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
