import { ACTION_TIMEOUT_MS, type TableState } from '@pk/shared';
import { chips } from '../lib/format';
import { CardSlot, PlayingCard } from './PlayingCard';
import { Seat } from './Seat';

interface Props {
  state: TableState;
  myUserId: string | null;
  streams: Map<string, MediaStream>;
  local: { stream: MediaStream | null; camOn: boolean; micOn: boolean };
  /** Server-clock "now", used for timers. */
  now: number;
  canSit: boolean;
  onSit: (seatNo: number) => void;
}

/** Position on an ellipse, in percent of the container. Visual index 0 is bottom-center. */
function position(visualIndex: number, count: number, rx: number, ry: number) {
  const angle = ((90 + (visualIndex * 360) / count) * Math.PI) / 180;
  return { left: `${50 + rx * Math.cos(angle)}%`, top: `${50 + ry * Math.sin(angle)}%` };
}

export function PokerTable({ state, myUserId, streams, local, now, canSit, onSit }: Props) {
  const n = state.maxSeats;
  const rotate = state.mySeat ?? 0;
  const visual = (seatNo: number) => (seatNo - rotate + n) % n;
  const winners = new Map(state.result?.winners.map((w) => [w.seatNo, w]) ?? []);
  const revealedNames = new Map(state.result?.revealed.map((r) => [r.seatNo, r.handName]) ?? []);
  const timeLeft =
    state.actionDeadline && state.toAct !== null
      ? Math.max(0, state.actionDeadline - now) / ACTION_TIMEOUT_MS
      : null;
  const nextIn = state.nextHandAt ? Math.max(0, Math.ceil((state.nextHandAt - now) / 1000)) : null;
  const collected = state.pots.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="relative mx-auto aspect-[16/10] w-full max-w-[1100px]">
      <div className="felt absolute inset-[11%_9%] rounded-[50%]" />

      {/* Board, pot and status */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        <div className="text-sm font-semibold text-emerald-100/80">
          {state.street === 'waiting' ? (
            state.seats.filter(Boolean).length < 2 ? (
              'Waiting for players…'
            ) : nextIn !== null ? (
              `Next hand in ${nextIn}s`
            ) : (
              'Waiting for players…'
            )
          ) : state.street === 'showdown' ? (
            nextIn !== null ? `Next hand in ${nextIn}s` : ''
          ) : (
            <span>
              Pot <span className="text-amber-300">{chips(state.potTotal)}</span>
              {state.pots.length > 1 && (
                <span className="ml-2 text-xs text-emerald-100/60">
                  ({state.pots.map((p) => chips(p.amount)).join(' + ')})
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {Array.from({ length: 5 }, (_, i) =>
            state.board[i] ? <PlayingCard key={i} card={state.board[i]} size="lg" /> : <CardSlot key={i} size="lg" />,
          )}
        </div>
        {state.result && (
          <div className="rounded-full bg-black/50 px-4 py-1.5 text-center text-sm font-semibold text-emerald-200">
            {state.result.winners
              .map((w) => `${w.name} wins ${chips(w.amount)}${w.handName ? ` · ${w.handName}` : ''}`)
              .join('  |  ')}
          </div>
        )}
        {!state.result && collected > 0 && state.street !== 'preflop' && (
          <Chips amount={collected} />
        )}
      </div>

      {/* Bets in front of players */}
      {state.seats.map((seat) =>
        seat && seat.bet > 0 ? (
          <div
            key={`bet-${seat.seatNo}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={position(visual(seat.seatNo), n, 27, 24)}
          >
            <Chips amount={seat.bet} />
          </div>
        ) : null,
      )}

      {/* Dealer button */}
      {state.dealerSeat >= 0 && state.seats[state.dealerSeat] && state.street !== 'waiting' && (
        <div
          className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs font-black text-zinc-900 shadow"
          style={position(visual(state.dealerSeat) + 0.35, n, 31, 30)}
        >
          D
        </div>
      )}

      {/* Seats */}
      {Array.from({ length: n }, (_, seatNo) => {
        const seat = state.seats[seatNo];
        const pos = position(visual(seatNo), n, 45, 43);
        return (
          <div key={seatNo} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={pos}>
            {seat ? (
              <Seat
                seat={seat}
                isMe={seat.userId === myUserId}
                toAct={state.toAct === seatNo}
                timeLeft={state.toAct === seatNo ? timeLeft : null}
                stream={seat.userId === myUserId ? local.stream : streams.get(seat.userId) ?? null}
                camOn={seat.userId === myUserId ? local.camOn : seat.camOn}
                micOn={seat.userId === myUserId ? local.micOn : seat.micOn}
                winner={winners.has(seatNo)}
                handName={state.result?.showdown ? revealedNames.get(seatNo) ?? null : null}
              />
            ) : (
              <button
                disabled={!canSit}
                onClick={() => onSit(seatNo)}
                className={`flex h-20 w-20 items-center justify-center rounded-full border-2 border-dashed text-sm font-semibold transition ${
                  canSit
                    ? 'border-amber-400/60 text-amber-300 hover:bg-amber-400/10'
                    : 'border-white/10 text-zinc-600'
                }`}
              >
                {canSit ? 'Sit here' : 'Empty'}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Chips({ amount }: { amount: number }) {
  return (
    <div className="flex items-center gap-1 rounded-full bg-black/60 py-0.5 pl-0.5 pr-2 text-xs font-bold text-amber-200 shadow">
      <span className="inline-block h-4 w-4 rounded-full border-2 border-dashed border-white bg-red-600" />
      {chips(amount)}
    </div>
  );
}
