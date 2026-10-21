import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sounds } from '../lib/sound';
import { useSocket } from '../lib/socket';

interface Invite {
  fromName: string;
  tableId: string;
  tableName: string;
  key: number;
}

/** Shows table invitations from friends, wherever the player is in the app. */
export function InviteToast() {
  const { socket } = useSocket();
  const navigate = useNavigate();
  const [invites, setInvites] = useState<Invite[]>([]);

  useEffect(() => {
    if (!socket) return;
    const onInvite = (p: { fromName: string; tableId: string; tableName: string }) => {
      sounds.pop();
      const key = Date.now() + Math.random();
      setInvites((list) => [...list.slice(-2), { ...p, key }]);
      setTimeout(() => setInvites((list) => list.filter((i) => i.key !== key)), 20_000);
    };
    socket.on('friend:invite', onInvite);
    return () => {
      socket.off('friend:invite', onInvite);
    };
  }, [socket]);

  if (!invites.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[60] space-y-2">
      {invites.map((i) => (
        <div key={i.key} className="w-72 rounded-xl border border-amber-400/40 bg-zinc-900 p-3 shadow-xl">
          <p className="text-sm">
            <b>{i.fromName}</b> invited you to <b>{i.tableName}</b>
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => setInvites((l) => l.filter((x) => x.key !== i.key))}
              className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800"
            >
              Dismiss
            </button>
            <button
              onClick={() => {
                setInvites((l) => l.filter((x) => x.key !== i.key));
                navigate(`/table/${i.tableId}`);
              }}
              className="rounded bg-amber-500 px-3 py-1 text-xs font-semibold text-zinc-950 hover:bg-amber-400"
            >
              Join
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
