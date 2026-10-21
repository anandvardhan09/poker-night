import { useState } from 'react';
import { MAX_TURN_SECONDS, MIN_TURN_SECONDS, type HostOp, type TableState } from '@pk/shared';
import { Modal, Toggle } from './Modal';

export function HostPanel({
  state,
  onOp,
  onClose,
}: {
  state: TableState;
  onOp: (op: HostOp) => Promise<void>;
  onClose: () => void;
}) {
  const st = state.settings;
  const [sb, setSb] = useState(state.smallBlind);
  const [bb, setBb] = useState(state.bigBlind);
  const [turn, setTurn] = useState(st.turnSeconds);
  const [levels, setLevels] = useState(st.blindLevelMinutes);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const sng = st.mode === 'sng';
  const tournamentLocked = sng && state.tournament?.status !== 'registering';
  const betting = ['preflop', 'flop', 'turn', 'river'].includes(state.street);
  const emptySeats = state.seats.map((s, i) => (s ? null : i)).filter((i): i is number => i !== null);
  const bots = state.seats.filter((s) => s?.isBot);

  const run = async (op: HostOp, done?: string) => {
    setError(null);
    setNote(null);
    try {
      await onOp(op);
      if (done) setNote(done);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal title="Host controls" onClose={onClose} wide>
      <div className="space-y-5 text-sm">
        <section className="flex flex-wrap gap-2">
          <button
            onClick={() => run({ type: 'pause', paused: !state.paused })}
            className={`rounded-lg px-4 py-2 font-semibold ${
              state.paused ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
            }`}
          >
            {state.paused ? '▶ Resume game' : '⏸ Pause after this hand'}
          </button>
          {!sng && (
            <button
              disabled={state.bombPotNext}
              onClick={() => run({ type: 'bombPot' }, 'Next hand is a bomb pot')}
              className="rounded-lg bg-zinc-800 px-4 py-2 hover:bg-zinc-700 disabled:opacity-50"
              title="Everyone antes 2 big blinds and the hand starts on the flop"
            >
              💣 {state.bombPotNext ? 'Bomb pot queued' : 'Bomb pot next hand'}
            </button>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-zinc-300">Blinds</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-xs text-zinc-500">Small</span>
              <input type="number" min={1} value={sb} onChange={(e) => setSb(Number(e.target.value))} className="input w-28" />
            </label>
            <label className="space-y-1">
              <span className="block text-xs text-zinc-500">Big</span>
              <input type="number" min={sb} value={bb} onChange={(e) => setBb(Number(e.target.value))} className="input w-28" />
            </label>
            <button
              onClick={() =>
                run({ type: 'blinds', smallBlind: sb, bigBlind: bb }, betting ? 'Applies from the next hand' : 'Blinds updated')
              }
              className="rounded-lg bg-zinc-800 px-4 py-2 hover:bg-zinc-700"
            >
              Apply
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-xs text-zinc-500">Raise blinds every (minutes, 0 = never)</span>
              <input
                type="number"
                min={sng ? 1 : 0}
                max={60}
                value={levels}
                onChange={(e) => setLevels(Number(e.target.value))}
                className="input w-28"
              />
            </label>
            <button
              onClick={() => run({ type: 'settings', patch: { blindLevelMinutes: levels } }, 'Blind schedule saved')}
              className="rounded-lg bg-zinc-800 px-4 py-2 hover:bg-zinc-700"
            >
              Save
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-zinc-300">Table rules</h3>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-xs text-zinc-500">
                Turn timer ({MIN_TURN_SECONDS}-{MAX_TURN_SECONDS}s)
              </span>
              <input
                type="number"
                min={MIN_TURN_SECONDS}
                max={MAX_TURN_SECONDS}
                value={turn}
                onChange={(e) => setTurn(Number(e.target.value))}
                className="input w-28"
              />
            </label>
            <button
              onClick={() => run({ type: 'settings', patch: { turnSeconds: turn } }, 'Turn timer saved')}
              className="rounded-lg bg-zinc-800 px-4 py-2 hover:bg-zinc-700"
            >
              Save
            </button>
          </div>
          <Toggle
            label="Allow straddle"
            hint="The player after the big blind may post 2× the big blind and act last preflop"
            checked={st.straddle}
            disabled={sng}
            onChange={(v) => run({ type: 'settings', patch: { straddle: v } })}
          />
          <Toggle
            label="Allow run it twice"
            hint="When players are all-in before the river and all agree, deal the rest twice and split each pot"
            checked={st.runItTwice}
            onChange={(v) => run({ type: 'settings', patch: { runItTwice: v } })}
          />
          <Toggle
            label="Private table"
            hint="Hidden from the lobby; players join with the link"
            checked={st.isPrivate}
            onChange={(v) => run({ type: 'settings', patch: { isPrivate: v } })}
          />
        </section>

        <section className="space-y-2">
          <h3 className="font-semibold text-zinc-300">Bots</h3>
          {tournamentLocked ? (
            <p className="text-xs text-zinc-500">Bots can only join before the tournament starts.</p>
          ) : emptySeats.length ? (
            <div className="flex flex-wrap gap-2">
              {emptySeats.map((i) => (
                <button key={i} onClick={() => run({ type: 'addBot', seatNo: i })} className="rounded-lg bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700">
                  🤖 Add to seat {i + 1}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No empty seats.</p>
          )}
          {bots.length > 0 && !tournamentLocked && (
            <div className="flex flex-wrap gap-2">
              {bots.map((b) => (
                <button
                  key={b!.userId}
                  onClick={() => run({ type: 'removeBot', seatNo: b!.seatNo })}
                  className="rounded-lg bg-zinc-800 px-3 py-1.5 text-red-300 hover:bg-zinc-700"
                >
                  Remove {b!.name}
                </button>
              ))}
            </div>
          )}
          <p className="text-xs text-zinc-500">Bot chips are play money created for the bot; they leave with the bot.</p>
        </section>

        <section className="space-y-2 border-t border-white/10 pt-4">
          {!confirmClose ? (
            <button onClick={() => setConfirmClose(true)} className="rounded-lg bg-red-700 px-4 py-2 font-semibold hover:bg-red-600">
              End session &amp; close table
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-300">
                Everyone is cashed out{sng && state.tournament?.status !== 'finished' ? ' and tournament buy-ins are refunded' : ''}.
              </span>
              <button onClick={() => run({ type: 'close' })} className="rounded-lg bg-red-600 px-4 py-2 font-semibold hover:bg-red-500">
                Close table
              </button>
              <button onClick={() => setConfirmClose(false)} className="rounded-lg px-3 py-2 text-zinc-400 hover:bg-zinc-800">
                Cancel
              </button>
            </div>
          )}
        </section>

        {error && <p className="text-red-400">{error}</p>}
        {note && <p className="text-emerald-300">{note}</p>}
      </div>
    </Modal>
  );
}
