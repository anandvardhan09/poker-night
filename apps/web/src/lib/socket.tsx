import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AckResult, ClientToServerEvents, LobbyData, Profile, ServerToClientEvents } from '@pk/shared';
import { useAuth } from './auth';
import { SERVER_URL } from './config';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface SocketContextValue {
  socket: AppSocket | null;
  connected: boolean;
  error: string | null;
  profile: Profile | null;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
  error: null,
  profile: null,
});

/** Emits an event with an ack callback and resolves with its data (or rejects with its error). */
export function rpc<T>(socket: AppSocket, event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not respond')), 15_000);
    const emit = socket.emit as unknown as (ev: string, ...a: unknown[]) => void;
    emit.call(socket, event, ...args, (res: AckResult<T>) => {
      clearTimeout(timer);
      if (res.ok) resolve(res.data);
      else reject(new Error(res.error));
    });
  });
}

export function SocketProvider({ children }: { children: ReactNode }) {
  const { status, handshake, signOut } = useAuth();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (status !== 'signedIn') return;
    const s: AppSocket = io(SERVER_URL, {
      auth: (cb) => cb({ ...handshake() }),
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 5_000,
    });
    s.on('connect', () => {
      setConnected(true);
      setError(null);
      rpc<LobbyData>(s, 'lobby:list')
        .then((d) => setProfile(d.profile))
        .catch(() => undefined);
    });
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', (e) => {
      setError(e.message === 'xhr poll error' || e.message === 'websocket error' ? 'Server is waking up…' : e.message);
      if (e.message === 'Invalid session' || e.message === 'Not signed in') void signOut();
    });
    s.on('me:profile', setProfile);
    setSocket(s);
    // Render's free tier sleeps after 15 idle minutes; an HTTP ping keeps it awake while anyone is playing.
    const keepAlive = setInterval(() => void fetch(`${SERVER_URL}/health`).catch(() => undefined), 4 * 60_000);
    return () => {
      clearInterval(keepAlive);
      s.disconnect();
      setSocket(null);
      setConnected(false);
      setProfile(null);
    };
  }, [status, handshake, signOut]);

  return (
    <SocketContext.Provider value={{ socket, connected, error, profile }}>{children}</SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
