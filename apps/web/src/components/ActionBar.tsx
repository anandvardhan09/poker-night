import { useEffect, useState } from 'react';
import type { PlayerAction, TableState } from '@pk/shared';
import { chips } from '../lib/format';

export function ActionBar({
  state,
  onAct,
  busy,
}: {
  state: TableState;
  onAct: (a: PlayerAction) => void;
  busy: boolean;
}) {
  const legal = state.legal!;
  const me = state.seats[state.mySeat!]!;
  const min = legal.minRaiseTo ?? 0;
  const max = legal.maxRaiseTo ?? 0;
  const [raiseTo, setRaiseTo] = useState(min);

  useEffect(() => setRaiseTo(min), [min, state.toAct, state.street]);

  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v)));
  const toCall = legal.call ?? 0;
  // Pot-sized raise: call, then raise by the size of the pot after calling.
  const potRaise = (fraction: number) => state.currentBet + (state.potTotal + toCall) * fraction;
  const isBet = state.currentBet === 0;
  const canRaise = legal.minRaiseTo !== null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button disabled={busy} onClick={() => onAct({ type: 'fold' })} className="btn bg-zinc-700 hover:bg-zinc-600">
        Fold
      </button>
      {legal.check ? (
        <button disabled={busy} onClick={() => onAct({ type: 'check' })} className="btn bg-sky-600 hover:bg-sky-500">
          Check
        </button>
      ) : (
        <button disabled={busy} onClick={() => onAct({ type: 'call' })} className="btn bg-sky-600 hover:bg-sky-500">
          {toCall >= me.stack ? 'All-in' : 'Call'} {chips(toCall)}
        </button>
      )}
      {canRaise && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-zinc-900/90 p-2 ring-1 ring-white/10">
          <div className="flex gap-1">
            {[
              ['Min', min],
              ['½ Pot', potRaise(0.5)],
              ['Pot', potRaise(1)],
              ['All-in', max],
            ].map(([label, v]) => (
              <button
                key={label as string}
                onClick={() => setRaiseTo(clamp(v as number))}
                className="rounded-md bg-zinc-800 px-2 py-1 text-xs hover:bg-zinc-700"
              >
                {label}
              </button>
            ))}
          </div>
          <input
            type="range"
            min={min}
            max={max}
            step={Math.max(1, Math.floor(state.bigBlind / 2))}
            value={raiseTo}
            onChange={(e) => setRaiseTo(clamp(Number(e.target.value)))}
            className="w-36"
          />
          <input
            type="number"
            min={min}
            max={max}
            value={raiseTo}
            onChange={(e) => setRaiseTo(Number(e.target.value))}
            onBlur={() => setRaiseTo(clamp(raiseTo))}
            className="w-24 rounded-md bg-zinc-800 px-2 py-1 text-right"
          />
          <button
            disabled={busy}
            onClick={() => onAct({ type: 'raise', amount: clamp(raiseTo) })}
            className="btn bg-amber-500 text-zinc-950 hover:bg-amber-400"
          >
            {clamp(raiseTo) === max ? 'All-in' : isBet ? 'Bet' : 'Raise to'} {chips(clamp(raiseTo))}
          </button>
        </div>
      )}
    </div>
  );
}
