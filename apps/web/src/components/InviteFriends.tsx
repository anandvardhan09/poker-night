import { useEffect, useState } from 'react';
import type { FriendInfo } from '@pk/shared';
import { rpc, useSocket } from '../lib/socket';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

export function InviteFriends({ tableId, onClose }: { tableId: string; onClose: () => void }) {
  const { socket } = useSocket();
  const [friends, setFriends] = useState<FriendInfo[] | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (socket) rpc<FriendInfo[]>(socket, 'friends:list').then(setFriends, (e: Error) => setError(e.message));
  }, [socket]);

  const invite = async (userId: string) => {
    if (!socket) return;
    try {
      await rpc(socket, 'friends:invite', { userId, tableId });
      setSent((s) => new Set(s).add(userId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Invite friends" onClose={onClose}>
      {!friends ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : friends.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No friends yet. Click a player at a table and choose <b>Add friend</b>, or copy the invite link.
        </p>
      ) : (
        <ul className="space-y-2">
          {friends.map((f) => (
            <li key={f.userId} className="flex items-center gap-3">
              <Avatar name={f.name} url={f.avatarUrl} size={32} />
              <div className="flex-1">
                <div className="text-sm">{f.name}</div>
                <div className={`text-xs ${f.online ? 'text-emerald-400' : 'text-zinc-500'}`}>{f.online ? '● Online' : 'Offline'}</div>
              </div>
              <button
                disabled={!f.online || sent.has(f.userId)}
                onClick={() => invite(f.userId)}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
              >
                {sent.has(f.userId) ? 'Invited' : 'Invite'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </Modal>
  );
}
