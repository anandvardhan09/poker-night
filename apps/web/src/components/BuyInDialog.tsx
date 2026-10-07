import { useState } from 'react';
import { DEFAULT_BUY_IN_BB, MAX_BUY_IN_BB, MIN_BUY_IN_BB } from '@pk/shared';
import { chips } from '../lib/format';

export function BuyInDialog({
  title,
  bigBlind,
  balance,
  currentStack = 0,
  onConfirm,
  onCancel,
  error,
}: {
  title: string;
  bigBlind: number;
  balance: number;
  currentStack?: number;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
  error: string | null;
}) {
  const tableMax = MAX_BUY_IN_BB * bigBlind - currentStack;
  const max = Math.max(0, Math.min(tableMax, balance));
  const min = currentStack > 0 ? Math.min(1, max) : Math.min(Math.max(MIN_BUY_IN_BB * bigBlind, bigBlind), max);
  const [amount, setAmount] = useState(() => Math.min(max, Math.max(min, DEFAULT_BUY_IN_BB * bigBlind - currentStack)));
  const tooPoor = max < Math.max(bigBlind, 1) || max < min;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-zinc-400">Your balance: {chips(balance)} chips</p>
        {tooPoor ? (
          <p className="text-sm text-red-400">You don't have enough chips for this table.</p>
        ) : (
          <>
            <input
              type="range"
              min={min}
              max={max}
              step={bigBlind}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">{chips(min)}</span>
              <input
                type="number"
                value={amount}
                min={min}
                max={max}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-28 rounded-md bg-zinc-800 px-2 py-1 text-center font-semibold"
              />
              <span className="text-zinc-500">{chips(max)}</span>
            </div>
          </>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            disabled={tooPoor}
            onClick={() => onConfirm(Math.min(max, Math.max(min, Math.floor(amount))))}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
