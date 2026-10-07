import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { chips } from '../lib/format';
import { useSocket } from '../lib/socket';
import { Avatar } from './Avatar';

export function Header({ children }: { children?: ReactNode }) {
  const { profile, connected, error } = useSocket();
  const { signOut } = useAuth();
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-zinc-900/70 px-4 py-2 backdrop-blur">
      <Link to="/" className="text-lg font-bold tracking-tight">
        ♠ Poker Night
      </Link>
      <div className="flex flex-1 flex-wrap items-center gap-3">{children}</div>
      {!connected && (
        <span className="rounded bg-amber-500/20 px-2 py-1 text-xs text-amber-300">
          {error ?? 'Connecting…'}
        </span>
      )}
      {profile && (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-sm font-semibold text-amber-300">
            {chips(profile.chipBalance)} chips
          </span>
          <Avatar name={profile.displayName} url={profile.avatarUrl} size={28} />
          <span className="hidden text-sm sm:inline">{profile.displayName}</span>
        </div>
      )}
      <button onClick={() => void signOut()} className="text-xs text-zinc-400 hover:text-zinc-200">
        Sign out
      </button>
    </header>
  );
}
