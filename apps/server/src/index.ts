import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import {
  REFILL_INTERVAL_MS,
  STARTING_CHIPS,
  type Ack,
  type ClientToServerEvents,
  type FriendInfo,
  type ServerToClientEvents,
} from '@pk/shared';
import { authenticate, type HandshakeAuth } from './auth';
import { config } from './config';
import { GameError } from './engine';
import { computeStats } from './stats';
import { InsufficientChipsError, RefillUnavailableError, createStore, type AuthUser } from './store';
import { TableManager } from './tables/TableManager';

interface SocketData {
  user: AuthUser;
  tables: Set<string>;
}

const store = createStore();
const app = express();
app.use(cors({ origin: config.clientOrigins, credentials: true }));
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/', (_req, res) => res.type('text').send('Poker Night server'));

const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(server, {
  cors: { origin: config.clientOrigins, credentials: true },
  pingInterval: 10_000,
  pingTimeout: 8_000,
});

async function notifyProfile(userId: string) {
  try {
    const profile = await store.getProfile(userId);
    if (profile) io.to(`user:${userId}`).emit('me:profile', profile);
  } catch (e) {
    console.error('profile notify failed', e);
  }
}

const tables = new TableManager(io, store, notifyProfile);

/** Connected sockets per user, for friends' online status. */
const online = new Map<string, Set<string>>();

function friendTables(userId: string) {
  const ids = new Set<string>();
  for (const socketId of online.get(userId) ?? []) {
    const sock = io.sockets.sockets.get(socketId);
    for (const t of sock?.data.tables ?? []) ids.add(t);
  }
  return [...ids]
    .map((id) => tables.peek(id))
    .filter((rt) => rt && !rt.meta.settings.isPrivate && !rt.closed)
    .map((rt) => ({ id: rt!.meta.id, name: rt!.meta.name }));
}

function errorMessage(e: unknown): string {
  if (e instanceof GameError || e instanceof InsufficientChipsError || e instanceof RefillUnavailableError) {
    return e.message;
  }
  console.error(e);
  return 'Something went wrong';
}

/** Wraps a handler so thrown errors are returned through the ack instead of crashing. */
function handle<T>(ack: Ack<T> | undefined, fn: () => Promise<T>) {
  const reply: Ack<T> = typeof ack === 'function' ? ack : () => undefined;
  fn().then(
    (data) => reply({ ok: true, data }),
    (e) => reply({ ok: false, error: errorMessage(e) }),
  );
}

io.use(async (socket, next) => {
  try {
    const user = await authenticate((socket.handshake.auth ?? {}) as HandshakeAuth);
    await store.upsertProfile(user);
    socket.data.user = user;
    socket.data.tables = new Set();
    next();
  } catch (e) {
    next(new Error(e instanceof Error ? e.message : 'Unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.join(`user:${user.id}`);
  if (!online.has(user.id)) online.set(user.id, new Set());
  online.get(user.id)!.add(socket.id);

  const requireTable = async (tableId: string) => {
    const rt = await tables.get(String(tableId));
    if (!rt) throw new GameError('Table not found');
    return rt;
  };
  const joinedTable = async (tableId: string) => {
    const rt = await requireTable(tableId);
    if (!rt.hasMember(socket.id)) throw new GameError('Join the table first');
    return rt;
  };

  socket.on('lobby:list', (ack) =>
    handle(ack, async () => {
      const profile = await store.getProfile(user.id);
      return { profile: profile!, tables: await tables.summaries(user.id) };
    }),
  );

  socket.on('table:create', (input, ack) =>
    handle(ack, async () => ({ tableId: await tables.create(user, input ?? {}) })),
  );

  socket.on('table:join', ({ tableId, password }, ack) =>
    handle(ack, async () => {
      const rt = await requireTable(tableId);
      const data = await rt.join(socket.id, user, password ? String(password) : undefined);
      socket.data.tables.add(rt.meta.id);
      return data;
    }),
  );

  socket.on('table:leave', async ({ tableId }) => {
    const rt = await tables.get(String(tableId));
    if (!rt) return;
    socket.data.tables.delete(rt.meta.id);
    await rt.leave(socket.id).catch((e) => console.error(e));
  });

  socket.on('table:sit', ({ tableId, seatNo, buyIn }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).sit(user, Number(seatNo), Number(buyIn));
      return null;
    }),
  );

  socket.on('table:stand', ({ tableId }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).stand(user);
      return null;
    }),
  );

  socket.on('table:rebuy', ({ tableId, amount }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).rebuy(user, Number(amount));
      return null;
    }),
  );

  socket.on('table:sitOut', ({ tableId, sittingOut }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).setSittingOut(user, !!sittingOut);
      return null;
    }),
  );

  socket.on('table:action', ({ tableId, action }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).act(user, action);
      return null;
    }),
  );

  socket.on('table:kick', ({ tableId, targetUserId }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).kick(user, String(targetUserId));
      return null;
    }),
  );

  socket.on('table:preAction', ({ tableId, preAction }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).setPreAction(user, preAction ?? null);
      return null;
    }),
  );

  socket.on('table:timeBank', ({ tableId }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).useTimeBank(user);
      return null;
    }),
  );

  socket.on('table:showCards', ({ tableId }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).showCards(user);
      return null;
    }),
  );

  socket.on('table:prefs', ({ tableId, wantsStraddle, ritOptIn }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).setPrefs(user, { wantsStraddle, ritOptIn });
      return null;
    }),
  );

  socket.on('table:host', ({ tableId, op }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).host(user, op);
      return null;
    }),
  );

  socket.on('table:waitlist', ({ tableId, join }, ack) =>
    handle(ack, async () => {
      await (await joinedTable(tableId)).setWaitlist(user, !!join);
      return null;
    }),
  );

  socket.on('table:history', ({ tableId, limit }, ack) =>
    handle(ack, async () => (await joinedTable(tableId)).history(user, Number(limit ?? 20))),
  );

  socket.on('table:react', async ({ tableId, emoji }) => {
    const rt = await tables.get(String(tableId));
    if (rt?.hasMember(socket.id)) rt.react(user, String(emoji));
  });

  socket.on('me:refill', (ack) =>
    handle(ack, async () => {
      const profile = await store.claimRefill(user.id, STARTING_CHIPS, REFILL_INTERVAL_MS);
      void notifyProfile(user.id);
      return profile;
    }),
  );

  socket.on('stats:get', (p, ack) =>
    handle(ack, async () => {
      const id = String(p?.userId || user.id);
      const profile = await store.getProfile(id);
      if (!profile) throw new GameError('Player not found');
      return computeStats(profile, await store.listPlayerHands(id));
    }),
  );

  socket.on('leaderboard:get', (p, ack) =>
    handle(ack, async () => {
      if (p?.scope === 'friends') {
        const ids = [user.id, ...(await store.listFriends(user.id))];
        return store.leaderboard(50, ids);
      }
      return store.leaderboard(50);
    }),
  );

  socket.on('friends:list', (ack) =>
    handle(ack, async (): Promise<FriendInfo[]> => {
      const profiles = await store.getProfiles(await store.listFriends(user.id));
      return profiles
        .map((f) => ({
          userId: f.id,
          name: f.displayName,
          avatarUrl: f.avatarUrl,
          online: !!online.get(f.id)?.size,
          tables: friendTables(f.id),
        }))
        .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    }),
  );

  socket.on('friends:add', (p, ack) =>
    handle(ack, async () => {
      const id = String(p?.userId ?? '');
      if (!id || id === user.id || id.startsWith('bot:')) throw new GameError('You can\'t add that player');
      if (!(await store.getProfile(id))) throw new GameError('Player not found');
      await store.addFriend(user.id, id);
      return null;
    }),
  );

  socket.on('friends:remove', (p, ack) =>
    handle(ack, async () => {
      await store.removeFriend(user.id, String(p?.userId ?? ''));
      return null;
    }),
  );

  socket.on('friends:invite', (p, ack) =>
    handle(ack, async () => {
      const friendId = String(p?.userId ?? '');
      const friends = await store.listFriends(user.id);
      if (!friends.includes(friendId)) throw new GameError('You can only invite friends');
      const rt = await joinedTable(String(p?.tableId));
      io.to(`user:${friendId}`).emit('friend:invite', {
        fromId: user.id,
        fromName: user.name,
        tableId: rt.meta.id,
        tableName: rt.meta.name,
      });
      return null;
    }),
  );

  socket.on('chat:send', async ({ tableId, text }) => {
    const rt = await tables.get(String(tableId));
    if (rt?.hasMember(socket.id)) rt.sendChat(user, String(text ?? ''));
  });

  socket.on('rtc:config', (ack) => handle(ack, async () => ({ iceServers: config.iceServers })));

  socket.on('rtc:signal', async (p) => {
    const rt = await tables.get(String(p?.tableId));
    if (rt?.hasMember(socket.id)) rt.relaySignal(user, p);
  });

  socket.on('rtc:media', async ({ tableId, camOn, micOn }) => {
    const rt = await tables.get(String(tableId));
    if (rt?.hasMember(socket.id)) rt.setMedia(user, camOn, micOn);
  });

  socket.on('disconnect', () => {
    const mine = online.get(user.id);
    mine?.delete(socket.id);
    if (mine && !mine.size) online.delete(user.id);
    for (const id of socket.data.tables) {
      tables.get(id).then((rt) => rt?.leave(socket.id)).catch((e) => console.error(e));
    }
  });
});

server.listen(config.port, () => {
  console.log(
    `Poker server on :${config.port} (${config.supabase ? 'Supabase' : 'local file store, dev login'})`,
  );
});
