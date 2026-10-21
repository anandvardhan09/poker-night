import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FriendInfo, PlayerStats } from '@pk/shared';
import { chips } from '../lib/format';
import { rpc, useSocket } from '../lib/socket';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

export function StatGrid({ stats }: { stats: PlayerStats }) {
  const items: [string, string, string?][] = [
    ['Hands', chips(stats.hands)],
    ['VPIP', `${stats.vpip}%`, 'How often money goes in voluntarily preflop'],
    ['PFR', `${stats.pfr}%`, 'How often they raise preflop'],
    ['Win rate', `${stats.winRate}%`, 'Share of hands won'],
    ['Net', `${stats.net > 0 ? '+' : ''}${chips(stats.net)}`],
    ['Biggest pot', chips(stats.biggestPot)],
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(([label, value, hint]) => (
        <div key={label} className="rounded-lg bg-zinc-800 p-2 text-center" title={hint}>
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
          <div
            className={`text-lg font-bold ${
              label === 'Net' ? (stats.net > 0 ? 'text-emerald-400' : stats.net < 0 ? 'text-red-400' : '') : 'text-zinc-100'
            }`}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Quick look at another player: stats, add as friend, and kick for the host. */
export function PlayerCard({
  userId,
  name,
  avatarUrl,
  isBot,
  canKick,
  onKick,
  onClose,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isBot: boolean;
  canKick: boolean;
  onKick: () => void;
  onClose: () => void;
}) {
  const { socket, profile } = useSocket();
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [isFriend, setIsFriend] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const isMe = profile?.id === userId;

  useEffect(() => {
    if (!socket || isBot) return;
    rpc<PlayerStats>(socket, 'stats:get', { userId }).then(setStats, () => undefined);
    rpc<FriendInfo[]>(socket, 'friends:list').then((f) => setIsFriend(f.some((x) => x.userId === userId)), () => undefined);
  }, [socket, userId, isBot]);

  const toggleFriend = async () => {
    if (!socket) return;
    try {
      await rpc(socket, isFriend ? 'friends:remove' : 'friends:add', { userId });
      setIsFriend(!isFriend);
      setMsg(isFriend ? 'Removed from friends' : 'Added as a friend');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <Modal title={name} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={name} url={avatarUrl} size={48} />
          <div className="text-sm text-zinc-400">{isBot ? '🤖 Computer player' : isMe ? 'This is you' : 'Player'}</div>
        </div>
        {!isBot && (stats ? <StatGrid stats={stats} /> : <p className="text-sm text-zinc-500">Loading stats…</p>)}
        <div className="flex flex-wrap gap-2">
          {!isBot && !isMe && isFriend !== null && (
            <button onClick={toggleFriend} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">
              {isFriend ? 'Remove friend' : '➕ Add friend'}
            </button>
          )}
          {!isBot && (
            <Link to={`/profile/${userId}`} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">
              Full profile
            </Link>
          )}
          {canKick && !isMe && (
            <button onClick={onKick} className="rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold hover:bg-red-600">
              Kick from table
            </button>
          )}
        </div>
        {msg && <p className="text-sm text-emerald-300">{msg}</p>}
      </div>
    </Modal>
  );
}
