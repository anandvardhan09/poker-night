import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import type { Ack, ClientToServerEvents, ServerToClientEvents } from '@pk/shared';
import { authenticate, type HandshakeAuth } from './auth';
import { config } from './config';
import { GameError } from './engine';
import { InsufficientChipsError, createStore, type AuthUser } from './store';
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

function errorMessage(e: unknown): string {
  if (e instanceof GameError || e instanceof InsufficientChipsError) return e.message;
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

  socket.on('table:join', ({ tableId }, ack) =>
    handle(ack, async () => {
      const rt = await requireTable(tableId);
      socket.data.tables.add(rt.meta.id);
      return rt.join(socket.id, user);
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
