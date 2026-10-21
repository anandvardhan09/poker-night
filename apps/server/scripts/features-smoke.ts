/**
 * End-to-end check of the newer table features against a running dev server:
 *   npm run dev -w @pk/server   (in another terminal)
 *   npx tsx scripts/features-smoke.ts
 */
import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, ServerToClientEvents, TableState } from '@pk/shared';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const URL = process.env.SERVER_URL ?? 'http://localhost:3001';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = Date.now().toString(36);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok  -', msg);
}

interface Client {
  s: S;
  id: string;
  latest: () => TableState | null;
  events: { reactions: number; invites: number; closed: number };
}

function connect(name: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const s: S = io(URL, { auth: { devName: name }, transports: ['websocket'], forceNew: true });
    let state: TableState | null = null;
    const events = { reactions: 0, invites: 0, closed: 0 };
    s.on('table:state', (st) => (state = st));
    s.on('table:reaction', () => events.reactions++);
    s.on('friend:invite', () => events.invites++);
    s.on('table:closed', () => events.closed++);
    s.on('connect', async () => {
      const lobby = await call<any>((ack) => s.emit('lobby:list', ack));
      resolve({ s, id: lobby.profile.id, latest: () => state, events });
    });
    s.on('connect_error', reject);
  });
}

function call<T>(fn: (ack: (r: AckResult<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => fn((r) => (r.ok ? resolve(r.data) : reject(new Error(r.error)))));
}
const rpc = <T = null>(c: Client, ev: string, payload?: unknown) =>
  call<T>((ack) => (payload === undefined ? (c.s.emit as any)(ev, ack) : (c.s.emit as any)(ev, payload, ack)));

async function waitFor(pred: () => boolean, ms = 15_000, label = 'condition') {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

async function main() {
  const host = await connect(`Host ${run}`);
  const guest = await connect(`Guest ${run}`);
  const third = await connect(`Third ${run}`);

  // ---- private + password table, kicks persist ----
  const { tableId } = await rpc<{ tableId: string }>(host, 'table:create', {
    name: 'Private test',
    smallBlind: 5,
    bigBlind: 10,
    maxSeats: 2,
    isPrivate: true,
    password: 'secret',
    straddle: true,
    runItTwice: true,
    turnSeconds: 15,
  });
  const lobby = await rpc<any>(guest, 'lobby:list');
  assert(!lobby.tables.some((t: any) => t.id === tableId), 'private table hidden from other players in the lobby');
  await rpc(host, 'table:join', { tableId });
  await rpc(guest, 'table:join', { tableId }).then(
    () => assert(false, 'password required'),
    (e) => assert(e.message === 'PASSWORD_REQUIRED', 'joining asks for the password'),
  );
  await rpc(guest, 'table:join', { tableId, password: 'nope' }).catch((e) =>
    assert(e.message === 'Wrong password', 'wrong password rejected'),
  );
  await rpc(guest, 'table:join', { tableId, password: 'secret' });
  assert(host.latest()!.actionTimeoutMs === 15_000, 'custom turn timer applied');
  assert(host.latest()!.spectators.some((x) => x.userId === guest.id), 'guest listed as a spectator');

  // ---- waitlist: table of 2, host + bot seated, guest waits ----
  await rpc(host, 'table:sit', { tableId, seatNo: 0, buyIn: 1000 });
  await rpc(host, 'table:host', { tableId, op: { type: 'addBot', seatNo: 1 } });
  assert(host.latest()!.seats[1]?.isBot, 'host added a bot');
  await rpc(guest, 'table:waitlist', { tableId, join: true });
  assert(host.latest()!.waitlist.length === 1, 'guest joined the waitlist');
  await waitFor(() => (host.latest()?.handNo ?? 0) >= 1, 10_000, 'first hand with bot');
  assert(true, 'hand dealt between host and bot');

  // ---- reactions ----
  guest.s.emit('table:react', { tableId, emoji: '🔥' });
  await waitFor(() => host.events.reactions > 0, 3000, 'reaction');
  assert(true, 'reaction broadcast');

  // ---- remove bot → guest seated from waitlist ----
  await rpc(host, 'table:host', { tableId, op: { type: 'removeBot', seatNo: 1 } });
  await waitFor(() => guest.latest()?.mySeat !== null && guest.latest()?.mySeat !== undefined, 20_000, 'waitlist seating');
  assert(guest.latest()!.waitlist.length === 0, 'waitlisted guest took the free seat');

  // ---- play a hand: pre-actions + time bank ----
  await waitFor(() => host.latest()!.toAct !== null, 15_000, 'a turn');
  let st = host.latest()!;
  const actor = st.toAct === st.mySeat ? host : guest;
  const other = actor === host ? guest : host;
  const bankBefore = actor.latest()!.actionDeadline!;
  await rpc(actor, 'table:timeBank', { tableId });
  await waitFor(() => actor.latest()!.actionDeadline! > bankBefore, 3000, 'time bank');
  assert(true, 'time bank extended the turn');
  await rpc(other, 'table:preAction', { tableId, preAction: 'check_fold' });
  assert(other.latest()!.seats[other.latest()!.mySeat!]!.preAction === 'check_fold', 'pre-action stored (owner only)');
  assert(actor.latest()!.seats[other.latest()!.mySeat!]!.preAction === null, 'pre-action hidden from others');
  await rpc(actor, 'table:action', { tableId, action: { type: 'raise', amount: 40 } });
  await waitFor(() => host.latest()!.street === 'showdown', 5000, 'pre-action fold');
  assert(host.latest()!.result!.winners[0].userId === actor.id, 'check/fold pre-action folded to the raise');
  const winnerState = actor.latest()!;
  assert(winnerState.canShowCards, 'uncontested winner can show cards');
  await rpc(actor, 'table:showCards', { tableId });
  await waitFor(() => other.latest()!.result?.revealed.length === 1, 3000, 'shown cards');
  assert(true, 'shown cards visible to the other player');

  // ---- history + stats ----
  await sleep(300);
  const hist = await rpc<any[]>(guest, 'table:history', { tableId, limit: 10 });
  assert(hist.length >= 1, `hand history returned ${hist.length} hands`);
  const botHand = hist.find((h) => h.players.some((p: any) => p.userId.startsWith('bot:')));
  assert(!botHand || botHand.players.every((p: any) => p.cards === null || p.userId === guest.id), 'other players\' hidden cards are masked');
  const stats = await rpc<any>(host, 'stats:get', {});
  assert(stats.hands >= 2 && typeof stats.vpip === 'number', `stats computed (${stats.hands} hands, VPIP ${stats.vpip}%)`);

  // ---- host controls ----
  await rpc(host, 'table:host', { tableId, op: { type: 'pause', paused: true } });
  assert(host.latest()!.paused, 'game paused');
  await rpc(host, 'table:host', { tableId, op: { type: 'blinds', smallBlind: 10, bigBlind: 20 } });
  await rpc(host, 'table:host', { tableId, op: { type: 'settings', patch: { turnSeconds: 20, blindLevelMinutes: 10 } } });
  await rpc(host, 'table:host', { tableId, op: { type: 'bombPot' } });
  assert(host.latest()!.bombPotNext, 'bomb pot queued');
  await rpc(guest, 'table:host', { tableId, op: { type: 'pause', paused: false } }).catch((e) =>
    assert(/host/.test(e.message), 'non-host cannot use host controls'),
  );

  // ---- kicked users stay kicked ----
  await rpc(third, 'table:join', { tableId, password: 'secret' });
  await rpc(host, 'table:kick', { tableId, targetUserId: third.id });
  await rpc(third, 'table:join', { tableId, password: 'secret' }).catch((e) =>
    assert(/kicked/.test(e.message), 'kicked user cannot rejoin'),
  );

  // ---- friends + invite ----
  await rpc(host, 'friends:add', { userId: guest.id });
  const friends = await rpc<any[]>(guest, 'friends:list');
  assert(friends.some((f) => f.userId === host.id && f.online), 'friendship is mutual and shows online');
  await rpc(guest, 'friends:invite', { userId: host.id, tableId });
  await waitFor(() => host.events.invites > 0, 3000, 'invite');
  assert(true, 'friend invite delivered');
  const board = await rpc<any[]>(host, 'leaderboard:get', { scope: 'friends' });
  assert(board.length === 2, 'friends leaderboard has both players');

  // ---- close table: session results ----
  await waitFor(() => host.latest()!.street === 'waiting' || host.latest()!.street === 'showdown', 10_000, 'idle');
  await rpc(host, 'table:host', { tableId, op: { type: 'close' } });
  await waitFor(() => guest.events.closed > 0, 3000, 'table closed');
  const net = (await rpc<any>(host, 'lobby:list')).tables.some((t: any) => t.id === tableId);
  assert(!net, 'closed table leaves the lobby');

  // ---- Sit & Go with bots ----
  const sng = await rpc<{ tableId: string }>(host, 'table:create', {
    name: 'SNG',
    smallBlind: 50,
    bigBlind: 100,
    maxSeats: 3,
    mode: 'sng',
    sngBuyIn: 500,
    sngStartingStack: 1000,
    blindLevelMinutes: 1,
    turnSeconds: 10,
  });
  await rpc(host, 'table:join', { tableId: sng.tableId });
  const balBefore = (await rpc<any>(host, 'lobby:list')).profile.chipBalance;
  await rpc(host, 'table:sit', { tableId: sng.tableId, seatNo: 0, buyIn: 0 });
  const balAfter = (await rpc<any>(host, 'lobby:list')).profile.chipBalance;
  assert(balBefore - balAfter === 500, 'tournament buy-in charged');
  await rpc(host, 'table:sitOut', { tableId: sng.tableId, sittingOut: false });
  await rpc(host, 'table:host', { tableId: sng.tableId, op: { type: 'addBot', seatNo: 1 } });
  await rpc(host, 'table:host', { tableId: sng.tableId, op: { type: 'addBot', seatNo: 2 } });
  assert(host.latest()!.tournament?.status === 'running', 'tournament starts when full');
  // Host plays all-in every hand to finish quickly.
  const end = Date.now() + 120_000;
  while (host.latest()!.tournament?.status !== 'finished' && Date.now() < end) {
    st = host.latest()!;
    if (st.legal && st.toAct === st.mySeat) {
      const a = st.legal.maxRaiseTo !== null ? { type: 'raise', amount: st.legal.maxRaiseTo } : st.legal.call ? { type: 'call' } : { type: 'check' };
      await rpc(host, 'table:action', { tableId: sng.tableId, action: a }).catch(() => undefined);
    }
    await sleep(100);
  }
  const t = host.latest()!.tournament!;
  assert(t.status === 'finished', `tournament finished; winner ${t.results[0]?.name}`);
  assert(t.results.map((r) => r.place).join(',') === '1,2,3', 'all three places recorded');
  assert(t.results[0].prize === 500, 'winner takes the 500 prize pool (3 entrants, 1 paid; bots pay no buy-in)');

  // ---- refill ----
  await rpc(third, 'me:refill').then(
    () => assert(false, 'refill should be refused with a full balance'),
    (e) => assert(/not available/.test(e.message), 'refill refused while balance is at or above 10,000'),
  );

  console.log('\nAll feature checks passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
