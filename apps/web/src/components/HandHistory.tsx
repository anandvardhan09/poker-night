import { useCallback, useEffect, useState } from 'react';
import type { HandHistoryEntry, Street } from '@pk/shared';
import { chips } from '../lib/format';
import { PlayingCard } from './PlayingCard';

const STEPS: { street: Street | 'result'; label: string; board: number }[] = [
  { street: 'preflop', label: 'Preflop', board: 0 },
  { street: 'flop', label: 'Flop', board: 3 },
  { street: 'turn', label: 'Turn', board: 4 },
  { street: 'river', label: 'River', board: 5 },
  { street: 'result', label: 'Result', board: 5 },
];

const ACTION_LABEL: Record<string, string> = { fold: 'folds', check: 'checks', call: 'calls', raise: 'bets/raises' };

/** Previous hands at this table, each replayable street by street. */
export function HandHistory({
  load,
  myUserId,
  refreshKey,
}: {
  load: () => Promise<HandHistoryEntry[]>;
  myUserId: string | null;
  refreshKey: number;
}) {
  const [hands, setHands] = useState<HandHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const refresh = useCallback(() => {
    load()
      .then((h) => {
        setHands(h);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [load]);

  useEffect(refresh, [refresh, refreshKey]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!hands) return <p className="text-zinc-500">Loading…</p>;
  if (!hands.length) return <p className="text-zinc-500">No finished hands yet.</p>;

  return (
    <div className="space-y-1">
      {hands.map((h) => {
        const me = h.players.find((p) => p.userId === myUserId);
        return (
          <div key={h.handNo} className="rounded-lg bg-zinc-800/60">
            <button
              onClick={() => setOpen(open === h.handNo ? null : h.handNo)}
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
            >
              <span className="text-zinc-500">#{h.handNo}</span>
              <span className="flex-1 truncate text-zinc-200">
                {h.winners.map((w) => `${w.name} +${chips(w.amount)}`).join(', ')}
              </span>
              {me && (
                <span className={me.net > 0 ? 'text-emerald-400' : me.net < 0 ? 'text-red-400' : 'text-zinc-500'}>
                  {me.net > 0 ? '+' : ''}
                  {chips(me.net)}
                </span>
              )}
            </button>
            {open === h.handNo && <Replay hand={h} />}
          </div>
        );
      })}
    </div>
  );
}

function Replay({ hand }: { hand: HandHistoryEntry }) {
  // Hands that ended before the river (everyone folded) stop at the last street dealt.
  const maxBoard = hand.board.length;
  const steps = STEPS.filter((s) => s.street === 'result' || s.board <= maxBoard);
  const [step, setStep] = useState(0);
  const cur = steps[step];
  const idx = STEPS.findIndex((s) => s.street === cur.street);
  const shownStreets = new Set(STEPS.slice(0, idx + 1).map((s) => s.street));
  const names = new Map(hand.players.map((p) => [p.seatNo, p.name]));
  const boardCount = Math.min(cur.board, maxBoard);

  return (
    <div className="space-y-2 border-t border-white/5 p-2">
      <div className="text-xs text-zinc-500">
        Blinds {chips(hand.smallBlind)}/{chips(hand.bigBlind)} · Dealer {names.get(hand.dealerSeat) ?? `seat ${hand.dealerSeat + 1}`} ·{' '}
        {new Date(hand.createdAt).toLocaleTimeString()}
      </div>
      <div className="flex flex-wrap gap-2">
        {hand.players.map((p) => (
          <div key={p.userId} className="flex items-center gap-1 rounded bg-zinc-900 px-1.5 py-1">
            <span className="text-xs text-zinc-300">{p.name}</span>
            {p.cards ? p.cards.map((c) => <PlayingCard key={c} card={c} size="xs" />) : <span className="text-[10px] text-zinc-600">hidden</span>}
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        {Array.from({ length: 5 }, (_, i) =>
          i < boardCount ? <PlayingCard key={i} card={hand.board[i]} size="sm" /> : <div key={i} className="h-11 w-8 rounded-md border border-dashed border-white/10" />,
        )}
      </div>
      {hand.board2 && cur.street === 'result' && (
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase text-zinc-500">Board 2</span>
          {hand.board2.map((c, i) => (
            <PlayingCard key={i} card={c} size="sm" />
          ))}
        </div>
      )}
      <ul className="space-y-0.5 text-xs">
        {hand.actions
          .filter((a) => shownStreets.has(a.street))
          .map((a, i) => (
            <li key={i} className="text-zinc-300">
              <span className="text-zinc-500">{a.street}</span> {names.get(a.seatNo) ?? '?'} {ACTION_LABEL[a.action] ?? a.action}
              {a.amount ? ` ${chips(a.amount)}` : ''}
            </li>
          ))}
        {cur.street === 'result' &&
          hand.winners.map((w) => (
            <li key={w.seatNo} className="font-semibold text-emerald-300">
              {w.name} wins {chips(w.amount)}
              {w.handName ? ` with ${w.handName}` : ''}
            </li>
          ))}
      </ul>
      <div className="flex flex-wrap items-center gap-1">
        <button disabled={step === 0} onClick={() => setStep(step - 1)} className="rounded bg-zinc-900 px-2 py-0.5 text-xs disabled:opacity-30">
          ◀
        </button>
        {steps.map((s, i) => (
          <button
            key={s.street}
            onClick={() => setStep(i)}
            className={`rounded px-2 py-0.5 text-xs ${i === step ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-900 text-zinc-400'}`}
          >
            {s.label}
          </button>
        ))}
        <button
          disabled={step === steps.length - 1}
          onClick={() => setStep(step + 1)}
          className="rounded bg-zinc-900 px-2 py-0.5 text-xs disabled:opacity-30"
        >
          ▶
        </button>
      </div>
    </div>
  );
}
