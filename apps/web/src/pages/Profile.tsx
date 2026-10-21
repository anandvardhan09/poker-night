import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { REFILL_INTERVAL_MS, STARTING_CHIPS, type FriendInfo, type PlayerStats } from '@pk/shared';
import { Avatar } from '../components/Avatar';
import { Header } from '../components/Header';
import { StatGrid } from '../components/PlayerCard';
import { chips } from '../lib/format';
import { rpc, useSocket } from '../lib/socket';

export function Profile() {
  const { id } = useParams();
  const { socket, connected, profile } = useSocket();
  const userId = id ?? profile?.id ?? null;
  const isMe = !!profile && userId === profile.id;
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !connected || !userId) return;
    setStats(null);
    rpc<PlayerStats>(socket, 'stats:get', { userId }).then(setStats, (e: Error) => setError(e.message));
    rpc<FriendInfo[]>(socket, 'friends:list').then(setFriends, () => undefined);
  }, [socket, connected, userId]);

  const isFriend = friends.some((f) => f.userId === userId);
  const toggleFriend = async () => {
    if (!socket || !userId) return;
    await rpc(socket, isFriend ? 'friends:remove' : 'friends:add', { userId }).catch((e: Error) => setError(e.message));
    rpc<FriendInfo[]>(socket, 'friends:list').then(setFriends, () => undefined);
  };

  const nextRefill =
    isMe && profile?.lastRefillAt ? profile.lastRefillAt + REFILL_INTERVAL_MS - Date.now() : 0;

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
        {error && <p className="text-red-400">{error}</p>}
        {!stats ? (
          <p className="text-zinc-500">Loading…</p>
        ) : (
          <>
            <div className="flex items-center gap-4">
              <Avatar name={stats.name} url={stats.avatarUrl} size={64} />
              <div className="flex-1">
                <h1 className="text-2xl font-bold">{stats.name}</h1>
                {isMe && profile && <p className="text-zinc-400">Balance: {chips(profile.chipBalance)} chips</p>}
              </div>
              {!isMe && (
                <button onClick={toggleFriend} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700">
                  {isFriend ? 'Remove friend' : '➕ Add friend'}
                </button>
              )}
            </div>
            <StatGrid stats={stats} />
            <p className="text-xs text-zinc-500">
              VPIP is how often a player puts money in preflop by choice; PFR is how often they raise preflop. Posting
              blinds doesn't count as voluntary.
            </p>
            {isMe && (
              <div className="rounded-xl border border-white/10 bg-zinc-900 p-4 text-sm text-zinc-300">
                🎁 <b>Daily top-up:</b> once every 24 hours, if your balance is below {chips(STARTING_CHIPS)}, you can top it back
                up from the header.{' '}
                {nextRefill > 0 && (
                  <span className="text-zinc-500">Next one in about {Math.ceil(nextRefill / 3_600_000)} h.</span>
                )}
              </div>
            )}
            {isMe && friends.length > 0 && (
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Friends</h2>
                <div className="flex flex-wrap gap-2">
                  {friends.map((f) => (
                    <Link key={f.userId} to={`/profile/${f.userId}`} className="flex items-center gap-2 rounded-full bg-zinc-800 py-1 pl-1 pr-3 text-sm hover:bg-zinc-700">
                      <Avatar name={f.name} url={f.avatarUrl} size={24} />
                      {f.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
