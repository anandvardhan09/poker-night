import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileStore } from '../src/store/fileStore';
import { RefillUnavailableError } from '../src/store/types';
import { DEFAULT_SETTINGS } from '../src/store/defaults';
import { computeStats } from '../src/stats';

const user = { id: 'u1', name: 'Ann', avatarUrl: null };

describe('daily refill', () => {
  it('tops up a low balance once per interval', async () => {
    const store = new FileStore(mkdtempSync(join(tmpdir(), 'pk-')));
    await store.upsertProfile(user);
    await expect(store.claimRefill('u1', 10_000, 1000)).rejects.toBeInstanceOf(RefillUnavailableError);
    await store.adjustBalance('u1', -9_500);
    const p = await store.claimRefill('u1', 10_000, 60_000);
    expect(p.chipBalance).toBe(10_000);
    expect(p.lastRefillAt).toBeGreaterThan(0);
    await store.adjustBalance('u1', -9_500);
    await expect(store.claimRefill('u1', 10_000, 60_000)).rejects.toBeInstanceOf(RefillUnavailableError);
  });
});

describe('stats and leaderboard', () => {
  it('aggregates per-player hand rows', async () => {
    const store = new FileStore(mkdtempSync(join(tmpdir(), 'pk-')));
    await store.upsertProfile(user);
    await store.createTable({ id: 't', name: 'T', hostId: 'u1', smallBlind: 5, bigBlind: 10, maxSeats: 2, settings: DEFAULT_SETTINGS });
    const player = (net: number, vpip: boolean, pfr: boolean, potWon: number) => ({
      userId: 'u1', name: 'Ann', seatNo: 0, startStack: 1000, net, cards: ['As', 'Kd'], shown: false, isBot: false,
      vpip, pfr, won: potWon > 0, potWon,
    });
    for (const [net, vpip, pfr, pot] of [[50, true, true, 100], [-10, false, false, 0], [-40, true, false, 0], [200, true, true, 400]] as const) {
      await store.addHandHistory({
        tableId: 't', handNo: 1, board: [], actions: [], winners: [],
        details: { board2: null, dealerSeat: 0, smallBlind: 5, bigBlind: 10, players: [player(net, vpip, pfr, pot)] },
      });
    }
    const stats = computeStats((await store.getProfile('u1'))!, await store.listPlayerHands('u1'));
    expect(stats).toMatchObject({ hands: 4, vpip: 75, pfr: 50, winRate: 50, handsWon: 2, net: 200, biggestPot: 400 });
    const board = await store.leaderboard(10);
    expect(board[0]).toMatchObject({ userId: 'u1', hands: 4, net: 200 });
  });
});
