import { useState } from 'react';
import type { SessionEntry } from '@pk/shared';
import { chips } from '../lib/format';
import { Modal } from './Modal';

const signed = (n: number) => `${n > 0 ? '+' : ''}${chips(n)}`;

function summaryText(tableName: string, entries: SessionEntry[]) {
  const date = new Date().toLocaleDateString();
  return [
    `♠ Poker Night: ${tableName} (${date})`,
    ...entries.map((e, i) => `${i + 1}. ${e.name}: ${signed(e.net)}`),
  ].join('\n');
}

/** Draws the results as a PNG people can share in a group chat. */
function downloadImage(tableName: string, entries: SessionEntry[]) {
  const w = 720;
  const rowH = 52;
  const h = 150 + entries.length * rowH + 40;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#14583a');
  bg.addColorStop(1, '#0d3d28');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fcd34d';
  g.font = 'bold 34px system-ui, sans-serif';
  g.fillText('♠ Poker Night', 40, 64);
  g.fillStyle = '#d1fae5';
  g.font = '22px system-ui, sans-serif';
  g.fillText(`${tableName} · ${new Date().toLocaleDateString()}`, 40, 104);
  entries.forEach((e, i) => {
    const y = 150 + i * rowH;
    g.fillStyle = i % 2 ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.28)';
    g.fillRect(28, y, w - 56, rowH - 6);
    g.fillStyle = '#ffffff';
    g.font = 'bold 22px system-ui, sans-serif';
    g.fillText(`${i + 1}. ${e.name}`.slice(0, 32), 44, y + 32);
    g.textAlign = 'right';
    g.fillStyle = e.net > 0 ? '#6ee7b7' : e.net < 0 ? '#fca5a5' : '#d4d4d8';
    g.fillText(signed(e.net), w - 44, y + 32);
    g.textAlign = 'left';
  });
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = `poker-night-${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
}

export function SessionResults({
  tableName,
  entries,
  final,
  onClose,
}: {
  tableName: string;
  entries: SessionEntry[];
  final?: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(summaryText(tableName, entries)).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal title={final ? 'Final results' : 'Session results'} onClose={onClose}>
      {final && <p className="mb-3 text-sm text-zinc-400">The host closed the table. Everyone has been cashed out.</p>}
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">Nobody has bought in yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500">
            <tr>
              <th className="py-1 text-left">Player</th>
              <th className="text-right">Bought in</th>
              <th className="text-right">{final ? 'Cashed out' : 'Now'}</th>
              <th className="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.userId} className="border-t border-white/5">
                <td className="py-1.5">{e.name}</td>
                <td className="text-right text-zinc-400">{chips(e.buyIn)}</td>
                <td className="text-right text-zinc-400">{chips(e.cashOut + e.onTable)}</td>
                <td className={`text-right font-semibold ${e.net > 0 ? 'text-emerald-400' : e.net < 0 ? 'text-red-400' : 'text-zinc-400'}`}>
                  {signed(e.net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {entries.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button onClick={copy} className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700">
            {copied ? 'Copied!' : 'Copy summary'}
          </button>
          <button
            onClick={() => downloadImage(tableName, entries)}
            className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400"
          >
            Download image
          </button>
        </div>
      )}
    </Modal>
  );
}
