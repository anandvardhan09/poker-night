import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MAX_TURN_SECONDS,
  MIN_TURN_SECONDS,
  type CreateTableInput,
  type FriendInfo,
  type LobbyData,
  type TableSummary,
} from '@pk/shared';
import { Avatar } from '../components/Avatar';
import { Header } from '../components/Header';
import { Toggle } from '../components/Modal';
import { chips } from '../lib/format';
import { rpc, useSocket } from '../lib/socket';

type Form = Required<Omit<CreateTableInput, 'password'>> & { password: string };

const INITIAL: Form = {
  name: '',
  smallBlind: 5,
  bigBlind: 10,
  maxSeats: 6,
  variant: 'holdem',
  mode: 'cash',
  isPrivate: false,
  password: '',
  turnSeconds: 30,
  straddle: false,
  runItTwice: true,
  blindLevelMinutes: 0,
  sngBuyIn: 1000,
  sngStartingStack: 1500,
};

export function Lobby() {
  const { socket, connected } = useSocket();
  const navigate = useNavigate();
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [friends, setFriends] = useState<FriendInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(INITIAL);
  const [advanced, setAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const refresh = useCallback(() => {
    if (!socket || !connected) return;
    rpc<LobbyData>(socket, 'lobby:list')
      .then((d) => setTables(d.tables))
      .catch((e) => setError(e.message));
    rpc<FriendInfo[]>(socket, 'friends:list').then(setFriends, () => undefined);
  }, [socket, connected]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [refresh]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!socket) return;
    setCreating(true);
    setError(null);
    try {
      const payload: CreateTableInput = { ...form };
      if (form.mode === 'cash') {
        delete payload.sngBuyIn;
        delete payload.sngStartingStack;
      }
      const { tableId } = await rpc<{ tableId: string }>(socket, 'table:create', payload);
      navigate(`/table/${tableId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const mine = tables.filter((t) => t.mine);
  const others = tables.filter((t) => !t.mine);
  const sng = form.mode === 'sng';

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto grid w-full max-w-6xl gap-6 p-6 md:grid-cols-[1fr_340px]">
        <section className="space-y-6">
          {mine.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-400">Your seats</h2>
              <TableList tables={mine} onOpen={(id) => navigate(`/table/${id}`)} highlight />
            </div>
          )}
          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Tables</h2>
            {others.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-8 text-center text-zinc-500">
                No tables yet. Create one and share the link with your friends.
              </p>
            ) : (
              <TableList tables={others} onOpen={(id) => navigate(`/table/${id}`)} />
            )}
          </div>
          <FriendsPanel friends={friends} onJoin={(id) => navigate(`/table/${id}`)} />
        </section>

        <form onSubmit={create} className="h-fit space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-5">
          <h2 className="text-lg font-semibold">Create a table</h2>
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Friday night"
              maxLength={40}
              className="input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Segmented
              value={form.variant}
              options={[
                ['holdem', "Hold'em"],
                ['omaha', 'Omaha (PLO)'],
              ]}
              onChange={(v) => set({ variant: v as Form['variant'] })}
            />
            <Segmented
              value={form.mode}
              options={[
                ['cash', 'Cash game'],
                ['sng', 'Sit & Go'],
              ]}
              onChange={(v) =>
                set({
                  mode: v as Form['mode'],
                  blindLevelMinutes: v === 'sng' ? Math.max(form.blindLevelMinutes, 5) : 0,
                  sngStartingStack: Math.max(form.sngStartingStack, 150 * form.bigBlind),
                })
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Small blind">
              <input
                type="number"
                min={1}
                value={form.smallBlind}
                onChange={(e) => {
                  const sb = Number(e.target.value);
                  set({ smallBlind: sb, bigBlind: Math.max(form.bigBlind, sb) });
                }}
                className="input"
              />
            </Field>
            <Field label="Big blind">
              <input
                type="number"
                min={form.smallBlind}
                value={form.bigBlind}
                onChange={(e) => set({ bigBlind: Number(e.target.value) })}
                className="input"
              />
            </Field>
          </div>
          {sng && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Buy-in (from balance)">
                <input type="number" min={0} value={form.sngBuyIn} onChange={(e) => set({ sngBuyIn: Number(e.target.value) })} className="input" />
              </Field>
              <Field label="Starting stack">
                <input
                  type="number"
                  min={10 * form.bigBlind}
                  value={form.sngStartingStack}
                  onChange={(e) => set({ sngStartingStack: Number(e.target.value) })}
                  className="input"
                />
              </Field>
            </div>
          )}
          <Field label={`Seats: ${form.maxSeats}`}>
            <input
              type="range"
              min={2}
              max={9}
              value={form.maxSeats}
              onChange={(e) => set({ maxSeats: Number(e.target.value) })}
              className="w-full"
            />
          </Field>

          <button type="button" onClick={() => setAdvanced(!advanced)} className="text-sm text-amber-300 hover:underline">
            {advanced ? '▾' : '▸'} More options
          </button>
          {advanced && (
            <div className="space-y-3 rounded-xl bg-zinc-950/50 p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Turn timer (${MIN_TURN_SECONDS}-${MAX_TURN_SECONDS}s)`}>
                  <input
                    type="number"
                    min={MIN_TURN_SECONDS}
                    max={MAX_TURN_SECONDS}
                    value={form.turnSeconds}
                    onChange={(e) => set({ turnSeconds: Number(e.target.value) })}
                    className="input"
                  />
                </Field>
                <Field label="Raise blinds every (min)">
                  <input
                    type="number"
                    min={sng ? 1 : 0}
                    max={60}
                    value={form.blindLevelMinutes}
                    onChange={(e) => set({ blindLevelMinutes: Number(e.target.value) })}
                    className="input"
                  />
                </Field>
              </div>
              <Toggle label="Private table" hint="Hidden from the lobby" checked={form.isPrivate} onChange={(v) => set({ isPrivate: v })} />
              <Field label="Password (optional)">
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => set({ password: e.target.value })}
                  maxLength={64}
                  className="input"
                  autoComplete="new-password"
                />
              </Field>
              {!sng && (
                <Toggle
                  label="Allow straddle"
                  hint="UTG may post 2× the big blind"
                  checked={form.straddle}
                  onChange={(v) => set({ straddle: v })}
                />
              )}
              <Toggle
                label="Allow run it twice"
                hint="All-in players can agree to deal the rest twice"
                checked={form.runItTwice}
                onChange={(v) => set({ runItTwice: v })}
              />
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            disabled={creating || !connected}
            className="w-full rounded-lg bg-amber-500 py-2.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {creating ? 'Creating…' : sng ? 'Create tournament' : 'Create table'}
          </button>
        </form>
      </main>
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-lg bg-zinc-800 p-0.5 text-xs">
      {options.map(([v, label]) => (
        <button
          type="button"
          key={v}
          onClick={() => onChange(v)}
          className={`flex-1 rounded-md px-2 py-1.5 font-semibold ${value === v ? 'bg-amber-500 text-zinc-950' : 'text-zinc-400 hover:text-white'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function FriendsPanel({ friends, onJoin }: { friends: FriendInfo[]; onJoin: (tableId: string) => void }) {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Friends</h2>
      {friends.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 p-4 text-sm text-zinc-500">
          Click a player's name at a table and choose <b>Add friend</b>. Friends show up here with the tables they're at.
        </p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-xl border border-white/10 bg-zinc-900">
          {friends.map((f) => (
            <li key={f.userId} className="flex items-center gap-3 p-3">
              <div className="relative">
                <Avatar name={f.name} url={f.avatarUrl} size={32} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 ${
                    f.online ? 'bg-emerald-400' : 'bg-zinc-600'
                  }`}
                />
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold">{f.name}</div>
                <div className="text-xs text-zinc-500">
                  {f.online ? (f.tables.length ? `At ${f.tables.map((t) => t.name).join(', ')}` : 'Online') : 'Offline'}
                </div>
              </div>
              {f.tables[0] && (
                <button onClick={() => onJoin(f.tables[0].id)} className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
                  Join
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TableList({
  tables,
  onOpen,
  highlight,
}: {
  tables: TableSummary[];
  onOpen: (id: string) => void;
  highlight?: boolean;
}) {
  return (
    <ul className="space-y-2">
      {tables.map((t) => (
        <li
          key={t.id}
          className={`flex items-center gap-4 rounded-xl border p-4 ${
            highlight ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/10 bg-zinc-900'
          }`}
        >
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              {t.name}
              {t.hasPassword && <span title="Password">🔒</span>}
              {t.isPrivate && <span className="rounded bg-zinc-700 px-1.5 text-[10px] uppercase">Private</span>}
              <span className="rounded bg-zinc-800 px-1.5 text-[10px] uppercase text-zinc-300">
                {t.variant === 'omaha' ? 'PLO' : "Hold'em"}
              </span>
              {t.mode === 'sng' && (
                <span className="rounded bg-fuchsia-500/20 px-1.5 text-[10px] uppercase text-fuchsia-200">
                  Sit &amp; Go{t.tournamentStatus ? ` · ${t.tournamentStatus}` : ''}
                </span>
              )}
            </div>
            <div className="text-sm text-zinc-400">
              Blinds {chips(t.smallBlind)}/{chips(t.bigBlind)} · {t.seated}/{t.maxSeats} seated
              {t.spectators > 0 && ` · ${t.spectators} watching`}
            </div>
          </div>
          <button onClick={() => onOpen(t.id)} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold hover:bg-zinc-700">
            {highlight ? 'Return' : t.seated >= t.maxSeats ? 'Watch' : 'Open'}
          </button>
        </li>
      ))}
    </ul>
  );
}
