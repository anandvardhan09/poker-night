import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardEntry } from '@pk/shared';
import { Avatar } from '../components/Avatar';
import { Header } from '../components/Header';
import { chips } from '../lib/format';
import { rpc, useSocket } from '../lib/socket';

export function Leaderboard() {
  const { socket, connected, profile } = useSocket();
  const [scope, setScope] = useState<'all' | 'friends'>('all');
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!socket || !connected) return;
    setRows(null);
    rpc<LeaderboardEntry[]>(socket, 'leaderboard:get', { scope }).then(setRows, (e: Error) => setError(e.message));
  }, [socket, connected, scope]);

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto w-full max-w-3xl space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Leaderboard</h1>
          <div className="flex rounded-lg bg-zinc-800 p-0.5 text-sm">
            {(['all', 'friends'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1 font-semibold ${scope === s ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400'}`}
              >
                {s === 'all' ? 'Everyone' : 'Friends'}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-red-400">{error}</p>}
        {!rows ? (
          <p className="text-zinc-500">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-zinc-500">
              <tr>
                <th className="w-10 py-2 text-left">#</th>
                <th className="text-left">Player</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Hands</th>
                <th className="text-right">Net won</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.userId} className={`border-t border-white/5 ${r.userId === profile?.id ? 'bg-indigo-500/10' : ''}`}>
                  <td className="py-2 text-zinc-500">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                  <td>
                    <Link to={`/profile/${r.userId}`} className="flex items-center gap-2 hover:underline">
                      <Avatar name={r.name} url={r.avatarUrl} size={24} />
                      {r.name}
                    </Link>
                  </td>
                  <td className="text-right font-semibold text-amber-300">{chips(r.chipBalance)}</td>
                  <td className="text-right text-zinc-400">{chips(r.hands)}</td>
                  <td className={`text-right ${r.net > 0 ? 'text-emerald-400' : r.net < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                    {r.net > 0 ? '+' : ''}
                    {chips(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
