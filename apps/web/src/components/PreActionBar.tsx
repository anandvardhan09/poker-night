import type { PreAction, TableState } from '@pk/shared';

const OPTIONS: { value: PreAction; label: string }[] = [
  { value: 'check_fold', label: 'Check / Fold' },
  { value: 'check', label: 'Check' },
  { value: 'call_any', label: 'Call any' },
];

/** Lets a player queue their next action while someone else is deciding. */
export function PreActionBar({
  state,
  onChange,
}: {
  state: TableState;
  onChange: (p: PreAction | null) => void;
}) {
  const me = state.mySeat !== null ? state.seats[state.mySeat] : null;
  const betting = ['preflop', 'flop', 'turn', 'river'].includes(state.street);
  if (!me || !betting || !me.inHand || me.folded || me.allIn || state.toAct === state.mySeat) return null;
  const current = me.preAction;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
      <span className="text-xs uppercase tracking-wide text-zinc-500">Act in advance</span>
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(current === o.value ? null : o.value)}
          className={`rounded-lg px-3 py-1.5 font-semibold ring-1 transition ${
            current === o.value
              ? 'bg-sky-600 text-white ring-sky-400'
              : 'bg-zinc-800 text-zinc-300 ring-white/10 hover:bg-zinc-700'
          }`}
        >
          {current === o.value ? '✓ ' : ''}
          {o.label}
        </button>
      ))}
    </div>
  );
}
