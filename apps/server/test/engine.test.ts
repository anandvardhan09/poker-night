import { describe, expect, it } from 'vitest';
import {
  applyAction,
  canStartHand,
  clearFinishedHand,
  computePots,
  createGame,
  forceFold,
  handleTimeout,
  legalActions,
  seatPlayer,
  startHand,
  totalChips,
  type GameState,
} from '../src/engine';

function table(stacks: (number | null)[], opts: { sb?: number; bb?: number } = {}): GameState {
  const s = createGame({
    tableId: 't1',
    smallBlind: opts.sb ?? 5,
    bigBlind: opts.bb ?? 10,
    maxSeats: Math.max(stacks.length, 2),
  });
  stacks.forEach((stack, i) => {
    if (stack !== null) seatPlayer(s, i, { userId: `u${i}`, name: `P${i}`, avatarUrl: null }, stack);
  });
  return s;
}

/** Overrides dealt hole cards and the order of upcoming community cards. */
function rig(s: GameState, hole: Record<number, string[]>, board: string[]) {
  for (const [seat, cards] of Object.entries(hole)) s.seats[Number(seat)]!.holeCards = cards;
  const [f1, f2, f3, t, r] = board;
  s.deck = ['x', f1, f2, f3, 'x', t, 'x', r].reverse();
}

const act = (s: GameState, type: 'fold' | 'check' | 'call' | 'raise', amount?: number) =>
  applyAction(s, s.toAct!, { type, amount });

describe('blinds and turn order', () => {
  it('heads-up: dealer posts small blind and acts first preflop, last postflop', () => {
    const s = table([1000, 1000]);
    startHand(s);
    const dealer = s.dealerSeat;
    const other = 1 - dealer;
    expect(s.seats[dealer]!.bet).toBe(5);
    expect(s.seats[other]!.bet).toBe(10);
    expect(s.toAct).toBe(dealer);
    act(s, 'call');
    expect(s.toAct).toBe(other);
    act(s, 'check');
    expect(s.street).toBe('flop');
    expect(s.toAct).toBe(other);
  });

  it('three-handed: SB and BB follow the dealer, dealer acts first preflop', () => {
    const s = table([1000, 1000, 1000]);
    startHand(s);
    expect(s.dealerSeat).toBe(0);
    expect(s.seats[1]!.bet).toBe(5);
    expect(s.seats[2]!.bet).toBe(10);
    expect(s.toAct).toBe(0);
  });

  it('dealer button moves to the next player each hand', () => {
    const s = table([1000, null, 1000, 1000]);
    startHand(s);
    expect(s.dealerSeat).toBe(0);
    act(s, 'fold');
    act(s, 'fold');
    clearFinishedHand(s);
    startHand(s);
    expect(s.dealerSeat).toBe(2);
  });

  it('big blind gets the option to raise when limped to', () => {
    const s = table([1000, 1000, 1000]);
    startHand(s);
    act(s, 'call');
    act(s, 'call');
    expect(s.toAct).toBe(2);
    const legal = legalActions(s, 2)!;
    expect(legal.check).toBe(true);
    expect(legal.minRaiseTo).toBe(20);
  });
});

describe('betting rules', () => {
  it('enforces the minimum raise', () => {
    const s = table([1000, 1000, 1000]);
    startHand(s);
    expect(() => act(s, 'raise', 15)).toThrow();
    act(s, 'raise', 30);
    expect(legalActions(s, s.toAct!)!.minRaiseTo).toBe(50);
  });

  it('returns an uncalled bet and awards the pot when everyone folds', () => {
    const s = table([1000, 1000, 1000]);
    startHand(s);
    act(s, 'raise', 100);
    act(s, 'fold');
    act(s, 'fold');
    expect(s.street).toBe('showdown');
    expect(s.result!.winners[0]).toMatchObject({ seatNo: 0, amount: 25 });
    expect(s.seats[0]!.stack).toBe(1015);
    expect(totalChips(s)).toBe(3000);
  });

  it('timeout checks when free and folds when facing a bet', () => {
    const s = table([1000, 1000]);
    startHand(s);
    handleTimeout(s);
    expect(s.street).toBe('showdown');
    clearFinishedHand(s);
    startHand(s);
    act(s, 'call');
    handleTimeout(s);
    expect(s.street).toBe('flop');
  });

  it('standing up mid-hand folds the player out of turn', () => {
    const s = table([1000, 1000, 1000]);
    startHand(s);
    forceFold(s, 1);
    expect(s.seats[1]!.folded).toBe(true);
    expect(s.toAct).toBe(0);
    act(s, 'fold');
    expect(s.street).toBe('showdown');
    expect(s.result!.winners[0].seatNo).toBe(2);
  });
});

describe('showdown and pots', () => {
  it('builds main and side pots for multiple all-ins', () => {
    const s = table([100, 300, 500]);
    startHand(s);
    rig(s, { 0: ['As', 'Ah'], 1: ['Ks', 'Kh'], 2: ['Qs', 'Qh'] }, ['2c', '7d', '9h', '3s', '4d']);
    act(s, 'raise', 100); // seat 0 all-in
    act(s, 'raise', 300); // seat 1 all-in
    act(s, 'call'); // seat 2 calls 300
    expect(s.street).toBe('showdown');
    const won = Object.fromEntries(s.result!.winners.map((w) => [w.seatNo, w.amount]));
    expect(won).toEqual({ 0: 300, 1: 400 });
    expect(s.seats.map((p) => p!.stack)).toEqual([300, 400, 200]);
    expect(s.result!.revealed).toHaveLength(3);
  });

  it('splits the pot when hands tie, odd chip to the first seat after the dealer', () => {
    const s = table([1000, 1000, 1000], { sb: 5, bb: 10 });
    startHand(s);
    rig(s, { 0: ['2c', '3d'], 1: ['4h', '5h'], 2: ['2d', '3c'] }, ['Ts', 'Js', 'Qs', 'Ks', 'As']);
    act(s, 'call'); // dealer (seat 0)
    act(s, 'fold'); // SB (seat 1) leaves 5 in the pot
    act(s, 'check'); // BB (seat 2)
    for (let i = 0; i < 3; i++) {
      act(s, 'check');
      act(s, 'check');
    }
    const won = Object.fromEntries(s.result!.winners.map((w) => [w.seatNo, w.amount]));
    expect(won).toEqual({ 2: 13, 0: 12 });
  });

  it('splits a pot evenly between tied players', () => {
    const s = table([1000, 1000], { sb: 5, bb: 10 });
    startHand(s);
    rig(s, { 0: ['2c', '3d'], 1: ['2d', '3c'] }, ['Ts', 'Js', 'Qs', 'Ks', 'As']);
    act(s, 'call');
    act(s, 'check');
    for (let i = 0; i < 3; i++) {
      act(s, 'check');
      act(s, 'check');
    }
    expect(s.street).toBe('showdown');
    expect(s.result!.winners.map((w) => w.amount)).toEqual([10, 10]);
    expect(s.seats.map((p) => p!.stack)).toEqual([1000, 1000]);
  });

  it('computePots handles folded contributions', () => {
    const pots = computePots([
      { seatNo: 0, committed: 50, folded: false },
      { seatNo: 1, committed: 200, folded: true },
      { seatNo: 2, committed: 200, folded: false },
      { seatNo: 3, committed: 120, folded: false },
    ]);
    expect(pots).toEqual([
      { amount: 200, eligibleSeats: [0, 2, 3] },
      { amount: 210, eligibleSeats: [2, 3] },
      { amount: 160, eligibleSeats: [2] },
    ]);
  });
});

describe('simulation', () => {
  it('never creates or destroys chips over many random hands', () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % max;
    };
    const s = table([500, 1200, 80, 3000, 950, 40]);
    const total = totalChips(s);
    let hands = 0;
    while (hands < 400 && canStartHand(s)) {
      startHand(s, rand);
      let guard = 0;
      while (s.toAct !== null && guard++ < 200) {
        const legal = legalActions(s, s.toAct)!;
        const roll = rand(10);
        if (roll < 2) act(s, 'fold');
        else if (roll < 7) act(s, legal.check ? 'check' : 'call');
        else if (legal.minRaiseTo !== null) {
          const span = legal.maxRaiseTo! - legal.minRaiseTo;
          act(s, 'raise', legal.minRaiseTo + rand(span + 1));
        } else act(s, legal.check ? 'check' : 'call');
        expect(totalChips(s)).toBe(total);
      }
      expect(s.street).toBe('showdown');
      clearFinishedHand(s);
      for (const p of s.seats) expect(p!.stack).toBeGreaterThanOrEqual(0);
      expect(totalChips(s)).toBe(total);
      hands++;
    }
    expect(hands).toBeGreaterThan(5);
  });
});
