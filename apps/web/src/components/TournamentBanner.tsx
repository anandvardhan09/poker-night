import type { TableState } from '@pk/shared';
import { chips } from '../lib/format';

export function TournamentBanner({
  state,
  isHost,
  onStart,
}: {
  state: TableState;
  isHost: boolean;
  onStart: () => void;
}) {
  const t = state.tournament;
  if (!t) return null;
  const seated = state.seats.filter(Boolean).length;
  return (
    <div className="mx-auto w-full max-w-[1100px] rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold text-fuchsia-200">🏆 Sit &amp; Go</span>
        <span className="text-zinc-300">
          {t.status === 'registering'
            ? `Registering · ${seated}/${state.maxSeats} seated`
            : t.status === 'running'
              ? `Running · ${seated} left of ${t.entrants}`
              : 'Finished'}
        </span>
        <span className="text-zinc-300">
          Prize pool <span className="font-semibold text-amber-300">{chips(t.prizePool)}</span>
        </span>
        <span className="text-zinc-400">Pays {t.payouts.map((p, i) => `${i + 1}: ${p}%`).join(' · ')}</span>
        {t.status === 'registering' && isHost && (
          <button
            disabled={seated < 2}
            onClick={onStart}
            className="ml-auto rounded-lg bg-fuchsia-500 px-3 py-1 font-semibold text-white hover:bg-fuchsia-400 disabled:opacity-40"
          >
            Start now
          </button>
        )}
        {t.status === 'registering' && !isHost && (
          <span className="ml-auto text-xs text-zinc-400">Starts when full or when the host starts it</span>
        )}
      </div>
      {t.results.length > 0 && (
        <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {t.results.map((r) => (
            <li key={r.userId} className={r.place === 1 ? 'font-semibold text-amber-300' : 'text-zinc-300'}>
              {r.place === 1 ? '🥇' : r.place === 2 ? '🥈' : r.place === 3 ? '🥉' : `#${r.place}`} {r.name}
              {r.prize > 0 && <span className="text-emerald-300"> +{chips(r.prize)}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
