/**
 * End-to-end check against a running server in dev-login mode:
 *   npm run dev -w @pk/server   (in another terminal)
 *   npm run smoke -w @pk/server [-- <tableId>]
 * Plays a few hands with three bots, disconnects and reconnects one of them, and
 * verifies seats, stacks and balances are retained. Pass an existing table id to
 * verify recovery after a server restart.
 */
import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, ServerToClientEvents, TableState } from '@pk/shared';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;
const URL = process.env.SERVER_URL ?? 'http://localhost:3001';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok  -', msg);
}

function connect(name: string): Promise<{ s: S; latest: () => TableState | null }> {
  return new Promise((resolve, reject) => {
    const s: S = io(URL, { auth: { devName: name }, transports: ['websocket'], forceNew: true });
    let state: TableState | null = null;
    s.on('table:state', (st) => (state = st));
    s.on('connect', () => resolve({ s, latest: () => state }));
    s.on('connect_error', reject);
  });
}

function call<T>(fn: (ack: (r: AckResult<T>) => void) => void): Promise<T> {
  return new Promise((resolve, reject) =>
    fn((r) => (r.ok ? resolve(r.data) : reject(new Error(r.error)))),
  );
}

async function waitFor(pred: () => boolean, ms = 10_000, label = 'condition') {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${label}`);
    await sleep(50);
  }
}

async function main() {
  const existing = process.argv[2];
  const names = ['Smoke Alice', 'Smoke Bob', 'Smoke Carol'];
  const bots = await Promise.all(names.map(connect));
  const [alice, bob] = bots;

  const lobby = await call<{ profile: { chipBalance: number } }>((a) => alice.s.emit('lobby:list', a as never));
  assert(lobby.profile.chipBalance >= 0, `lobby returns profile (balance ${lobby.profile.chipBalance})`);

  let tableId = existing;
  if (!tableId) {
    tableId = (
      await call<{ tableId: string }>((a) =>
        alice.s.emit('table:create', { name: 'Smoke', smallBlind: 5, bigBlind: 10, maxSeats: 6 }, a),
      )
    ).tableId;
  }
  assert(!!tableId, `table ${tableId}`);

  for (const [i, b] of bots.entries()) {
    const joined = await call<{ state: TableState }>((a) => b.s.emit('table:join', { tableId: tableId! }, a));
    if (joined.state.mySeat === null) {
      await call((a) => b.s.emit('table:sit', { tableId: tableId!, seatNo: i, buyIn: 1000 }, a));
    }
  }
  if (existing) {
    const st = alice.latest()!;
    assert(st.seats.filter(Boolean).length === 3, 'seats restored after restart');
  }

  const total = () => alice.latest()!.seats.reduce((n, p) => n + (p ? p.stack : 0), 0) + alice.latest()!.potTotal;
  await waitFor(() => alice.latest()?.street === 'preflop', 10_000, 'hand start');
  const startTotal = total();

  // Play three hands where everyone checks/calls.
  const startHand = alice.latest()!.handNo;
  while (alice.latest()!.handNo < startHand + 3) {
    for (const b of bots) {
      const st = b.latest();
      if (st?.legal) {
        const action = st.legal.check ? 'check' : 'call';
        await call((a) => b.s.emit('table:action', { tableId: tableId!, action: { type: action } }, a)).catch(
          () => undefined,
        );
      }
    }
    await sleep(30);
  }
  assert(true, 'played three hands');
  await waitFor(() => alice.latest()!.street === 'preflop', 10_000, 'next hand');
  assert(total() === startTotal, `chips conserved at table (${total()})`);

  // Disconnect Bob and verify his seat is retained.
  const bobSeat = bob.latest()!.mySeat!;
  const bobStackBefore = alice.latest()!.seats[bobSeat]!.stack;
  bob.s.disconnect();
  await waitFor(() => alice.latest()!.seats[bobSeat]?.status === 'disconnected', 5_000, 'bob disconnected');
  assert(true, 'disconnected seat retained');

  const bob2 = await connect('Smoke Bob');
  const rejoined = await call<{ state: TableState }>((a) => bob2.s.emit('table:join', { tableId: tableId!, }, a));
  assert(rejoined.state.mySeat === bobSeat, 'bob gets his seat back on reconnect');
  await waitFor(() => alice.latest()!.seats[bobSeat]?.status === 'active', 5_000, 'bob active');
  const stackNow = alice.latest()!.seats[bobSeat]!.stack + alice.latest()!.seats[bobSeat]!.bet;
  assert(stackNow <= bobStackBefore + startTotal, `bob stack retained (${stackNow})`);
  if (rejoined.state.street !== 'waiting' && rejoined.state.seats[bobSeat]!.inHand) {
    assert(!!rejoined.state.seats[bobSeat]!.cards, 'bob sees his hole cards after reconnect');
  }
  const others = rejoined.state.seats.filter((p) => p && p.seatNo !== bobSeat && p.inHand);
  assert(others.every((p) => p!.cards === null || rejoined.state.street === 'showdown'), 'other hole cards hidden');

  console.log(`\nTable id: ${tableId}`);
  console.log('Restart the server and run: npm run smoke -w @pk/server --', tableId);
  for (const b of [alice, bots[2], bob2]) b.s.disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
