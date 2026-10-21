import { useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { REFILL_INTERVAL_MS, STARTING_CHIPS, type Profile } from '@pk/shared';
import { useAuth } from '../lib/auth';
import { chips } from '../lib/format';
import { rpc, useSocket } from '../lib/socket';
import { Avatar } from './Avatar';

const navClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm ${isActive ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'}`;

export function Header({ children }: { children?: ReactNode }) {
  const { socket, profile, connected, error } = useSocket();
  const { signOut } = useAuth();
  const [refillMsg, setRefillMsg] = useState<string | null>(null);

  const refillReady =
    !!profile &&
    profile.chipBalance < STARTING_CHIPS &&
    (profile.lastRefillAt === null || Date.now() - profile.lastRefillAt >= REFILL_INTERVAL_MS);

  const refill = async () => {
    if (!socket) return;
    try {
      await rpc<Profile>(socket, 'me:refill');
      setRefillMsg(`Topped up to ${chips(STARTING_CHIPS)}!`);
    } catch (e) {
      setRefillMsg((e as Error).message);
    }
    setTimeout(() => setRefillMsg(null), 3000);
  };

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-zinc-900/70 px-4 py-2 backdrop-blur">
      <Link to="/" className="text-lg font-bold tracking-tight">
        ♠ Poker Night
      </Link>
      <nav className="flex gap-3">
        <NavLink to="/" end className={navClass}>
          Lobby
        </NavLink>
        <NavLink to="/leaderboard" className={navClass}>
          Leaderboard
        </NavLink>
        <NavLink to="/profile" className={navClass}>
          My stats
        </NavLink>
      </nav>
      <div className="flex flex-1 flex-wrap items-center gap-3">{children}</div>
      {!connected && (
        <span className="rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">{error ?? 'Connecting…'}</span>
      )}
      {refillMsg && <span className="text-xs text-emerald-300">{refillMsg}</span>}
      {refillReady && (
        <button
          onClick={refill}
          className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold hover:bg-emerald-500"
          title={`Once a day, top your balance back up to ${chips(STARTING_CHIPS)}`}
        >
          🎁 Daily top-up
        </button>
      )}
      {profile && (
        <Link to="/profile" className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-300">
            {chips(profile.chipBalance)} chips
          </span>
          <Avatar name={profile.displayName} url={profile.avatarUrl} size={28} />
          <span className="hidden text-sm sm:inline">{profile.displayName}</span>
        </Link>
      )}
      <button onClick={() => void signOut()} className="text-xs text-zinc-400 hover:text-zinc-200">
        Sign out
      </button>
    </header>
  );
}
