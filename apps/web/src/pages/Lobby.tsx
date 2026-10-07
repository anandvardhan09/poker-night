import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LobbyData, TableSummary } from '@pk/shared';
import { Header } from '../components/Header';
import { chips } from '../lib/format';
import { rpc, useSocket } from '../lib/socket';

export function Lobby() {
  const { socket, connected } = useSocket();
  const navigate = useNavigate();
  const [tables, setTables] = useState<TableSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', smallBlind: 5, bigBlind: 10, maxSeats: 6 });
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    if (!socket || !connected) return;
    rpc<LobbyData>(socket, 'lobby:list')
      .then((d) => setTables(d.tables))
      .catch((e) => setError(e.message));
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
      const { tableId } = await rpc<{ tableId: string }>(socket, 'table:create', form);
      navigate(`/table/${tableId}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const mine = tables.filter((t) => t.mine);
  const others = tables.filter((t) => !t.mine);

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="mx-auto grid w-full max-w-5xl gap-6 p-6 md:grid-cols-[1fr_320px]">
        <section className="space-y-6">
          {mine.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-emerald-400">
                Your seats
              </h2>
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
        </section>

        <form onSubmit={create} className="h-fit space-y-4 rounded-2xl border border-white/10 bg-zinc-900 p-5">
          <h2 className="text-lg font-semibold">Create a table</h2>
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Friday night"
              maxLength={40}
              className="input"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Small blind">
              <input
                type="number"
                min={1}
                value={form.smallBlind}
                onChange={(e) => {
                  const sb = Number(e.target.value);
                  setForm({ ...form, smallBlind: sb, bigBlind: Math.max(form.bigBlind, sb) });
                }}
                className="input"
              />
            </Field>
            <Field label="Big blind">
              <input
                type="number"
                min={form.smallBlind}
                value={form.bigBlind}
                onChange={(e) => setForm({ ...form, bigBlind: Number(e.target.value) })}
                className="input"
              />
            </Field>
          </div>
          <Field label={`Seats: ${form.maxSeats}`}>
            <input
              type="range"
              min={2}
              max={9}
              value={form.maxSeats}
              onChange={(e) => setForm({ ...form, maxSeats: Number(e.target.value) })}
              className="w-full"
            />
          </Field>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            disabled={creating || !connected}
            className="w-full rounded-lg bg-amber-500 py-2.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {creating ? 'Creating…' : 'Create table'}
          </button>
        </form>
      </main>
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
            <div className="font-semibold">{t.name}</div>
            <div className="text-sm text-zinc-400">
              Blinds {chips(t.smallBlind)}/{chips(t.bigBlind)} · {t.seated}/{t.maxSeats} seated
            </div>
          </div>
          <button
            onClick={() => onOpen(t.id)}
            className="rounded-lg bg-zinc-800 px-4 py-2 text-sm font-semibold hover:bg-zinc-700"
          >
            {highlight ? 'Return' : 'Open'}
          </button>
        </li>
      ))}
    </ul>
  );
}
