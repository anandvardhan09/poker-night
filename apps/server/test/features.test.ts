import { describe, expect, it } from 'vitest';
import {
  applyAction,
  chooseBotAction,
  clearFinishedHand,
  createGame,
  evaluateShowdown,
  legalActions,
  normalizeState,
  seatPlayer,
  setBlinds,
  setPreAction,
  showCards,
  startHand,
  totalChips,
  useTimeBank,
  type GameState,
} from '../src/engine';

function table(
  stacks: (number | null)[],
  opts: { variant?: 'holdem' | 'omaha'; straddle?: boolean; runItTwice?: boolean } = {},
): GameState {
  const s = createGame({ tableId: 't', smallBlind: 5, bigBlind: 10, maxSeats: Math.max(2, stacks.length), ...opts });
  stacks.forEach((stack, i) => {
    if (stack !== null) seatPlayer(s, i, { userId: `u${i}`, name: `P${i}`, avatarUrl: null }, stack);
  });
  return s;
}
const act = (s: GameState, type: 'fold' | 'check' | 'call' | 'raise', amount?: number) =>
  applyAction(s, s.toAct!, { type, amount });

describe('straddle', () => {
  it('UTG posts 2x BB and gets the last option preflop', () => {
    const s = table([1000, 1000, 1000, 1000], { straddle: true });
    s.seats[3]!.wantsStraddle = true;
    startHand(s);
    expect(s.seats[3]!.bet).toBe(20);
    expect(s.currentBet).toBe(20);
    expect(s.toAct).toBe(0);
    expect(legalActions(s, 0)!.minRaiseTo).toBe(40);
    act(s, 'call');
    act(s, 'call');
    act(s, 'call');
    expect(s.toAct).toBe(3);
    expect(legalActions(s, 3)!.check).toBe(true);
  });

  it('is ignored when the table does not allow it', () => {
    const s = table([1000, 1000, 1000, 1000]);
    s.seats[3]!.wantsStraddle = true;
    startHand(s);
    expect(s.seats[3]!.bet).toBe(0);
  });
});

describe('bomb pot', () => {
  it('everyone antes and the hand starts on the flop', () => {
    const s = table([1000, 1000, 1000]);
    s.bombPotNext = true;
    startHand(s);
    expect(s.street).toBe('flop');
    expect(s.board).toHaveLength(3);
    expect(s.seats.map((p) => p!.committed)).toEqual([20, 20, 20]);
    expect(s.toAct).toBe(1);
    expect(s.bombPotNext).toBe(false);
    expect(totalChips(s)).toBe(3000);
  });
});

describe('run it twice', () => {
  it('deals two boards and splits each pot between them when everyone opted in', () => {
    const s = table([1000, 1000], { runItTwice: true });
    s.seats.forEach((p) => (p!.ritOptIn = true));
    startHand(s);
    act(s, 'raise', 1000);
    act(s, 'call');
    expect(s.street).toBe('showdown');
    expect(s.result!.board2).toHaveLength(5);
    expect(s.result!.board).toHaveLength(5);
    expect(s.result!.board2).not.toEqual(s.result!.board);
    expect(s.seats[0]!.stack + s.seats[1]!.stack).toBe(2000);
  });

  it('runs once if anyone did not opt in', () => {
    const s = table([1000, 1000], { runItTwice: true });
    s.seats[0]!.ritOptIn = true;
    startHand(s);
    act(s, 'raise', 1000);
    act(s, 'call');
    expect(s.result!.board2).toBeNull();
  });

  it('a player who wins both boards gets the whole pot; a split gives half each', () => {
    const s = table([500, 500], { runItTwice: true });
    s.seats.forEach((p) => (p!.ritOptIn = true));
    startHand(s);
    // Rig: both all-in preflop. Board 1 favours seat 0, board 2 favours seat 1.
    s.seats[0]!.holeCards = ['As', 'Ad'];
    s.seats[1]!.holeCards = ['Ks', 'Kd'];
    const b1 = ['2c', '7h', '9d', '3s', '4h'];
    const b2 = ['Kc', '7c', '9c', '3d', '4d'];
    s.deck = ['x', ...b1.slice(0, 3), 'x', b1[3], 'x', b1[4], 'x', ...b2.slice(0, 3), 'x', b2[3], 'x', b2[4]].reverse();
    act(s, 'raise', 500);
    act(s, 'call');
    expect(s.result!.board2).toEqual(b2);
    expect(s.seats[0]!.stack).toBe(500);
    expect(s.seats[1]!.stack).toBe(500);
  });
});

describe('omaha', () => {
  it('deals four cards and caps raises at the pot', () => {
    const s = table([5000, 5000, 5000], { variant: 'omaha' });
    startHand(s);
    expect(s.seats[0]!.holeCards).toHaveLength(4);
    // Dealer facing 10: pot 15, call 10 → raise to 10 + 15 + 10 = 35.
    expect(legalActions(s, 0)!.maxRaiseTo).toBe(35);
  });

  it('must use exactly two hole cards', () => {
    // Board has four spades; a single spade in hand is not a flush in Omaha.
    const board = ['2s', '5s', '9s', 'Ks', '3d'];
    const r = evaluateShowdown(
      [
        { seatNo: 0, cards: ['As', 'Kd', 'Qh', 'Jc'] }, // one spade only
        { seatNo: 1, cards: ['9h', '9d', '4c', '7c'] }, // trips with 9s
      ],
      board,
      'omaha',
    );
    expect(r.winners).toEqual([1]);
    expect(r.evaluated[1].handName).toMatch(/Three of a Kind/);
  });
});

describe('pre-actions', () => {
  it('check/fold folds when facing a bet and auto-acts on turn', () => {
    const s = table([1000, 1000, 1000]);
    startHand(s); // dealer 0 acts first
    setPreAction(s, 1, 'check_fold');
    act(s, 'raise', 40);
    expect(s.seats[1]!.folded).toBe(true);
    expect(s.toAct).toBe(2);
  });

  it('call any calls automatically', () => {
    const s = table([1000, 1000, 1000]);
    startHand(s);
    setPreAction(s, 1, 'call_any');
    setPreAction(s, 2, 'call_any');
    act(s, 'raise', 40);
    expect(s.street).toBe('flop');
    expect(s.seats.map((p) => p!.committed)).toEqual([40, 40, 40]);
  });

  it('check only is dropped when there is a bet', () => {
    const s = table([1000, 1000, 1000]);
    startHand(s);
    act(s, 'call');
    act(s, 'call');
    act(s, 'check'); // to flop; seat 1 first
    setPreAction(s, 2, 'check');
    act(s, 'raise', 50);
    expect(s.toAct).toBe(2);
    expect(s.seats[2]!.preAction).toBeNull();
  });
});

describe('time bank, showing cards, blinds', () => {
  it('extends the deadline and drains the bank', () => {
    const s = table([1000, 1000]);
    startHand(s, undefined, 0);
    const d = s.actionDeadline!;
    const added = useTimeBank(s, s.toAct!);
    expect(added).toBe(30_000);
    expect(s.actionDeadline).toBe(d + 30_000);
    useTimeBank(s, s.toAct!);
    expect(() => useTimeBank(s, s.toAct!)).toThrow();
  });

  it('lets the uncontested winner show cards', () => {
    const s = table([1000, 1000]);
    startHand(s);
    act(s, 'raise', 30);
    act(s, 'fold');
    const winner = s.result!.winners[0].seatNo;
    showCards(s, winner);
    expect(s.result!.revealed[0].seatNo).toBe(winner);
    expect(() => showCards(s, winner)).toThrow();
  });

  it('blind changes during a hand apply from the next hand', () => {
    const s = table([1000, 1000]);
    startHand(s);
    setBlinds(s, 10, 20);
    expect(s.bigBlind).toBe(10);
    act(s, 'fold');
    clearFinishedHand(s);
    startHand(s);
    expect(s.bigBlind).toBe(20);
  });

  it('old snapshots load with defaults', () => {
    const s = table([1000, 1000]) as any;
    delete s.variant;
    delete s.seats[0].timeBankMs;
    normalizeState(s);
    expect(s.variant).toBe('holdem');
    expect(s.seats[0].timeBankMs).toBeGreaterThan(0);
  });
});

describe('bots and chip conservation', () => {
  it('bots always pick a legal action and chips are conserved across variants', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const variant of ['holdem', 'omaha'] as const) {
      const s = table([800, 1500, 300, 2000, 60], { variant, straddle: true, runItTwice: true });
      s.seats.forEach((p) => {
        p!.ritOptIn = true;
        p!.wantsStraddle = true;
      });
      const total = totalChips(s);
      for (let hand = 0; hand < 300; hand++) {
        if (s.seats.filter((p) => p && p.stack > 0).length < 2) break;
        if (hand % 7 === 0) s.bombPotNext = true;
        startHand(s, (m) => Math.floor(rand() * m));
        let guard = 0;
        while (s.toAct !== null && guard++ < 200) applyAction(s, s.toAct, chooseBotAction(s, s.toAct, rand));
        expect(s.street).toBe('showdown');
        expect(totalChips(s)).toBe(total);
        clearFinishedHand(s);
      }
    }
  });
});
