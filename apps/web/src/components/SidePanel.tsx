import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage, LogEntry } from '@pk/shared';

export function SidePanel({
  chat,
  log,
  onSend,
  myUserId,
  isHost,
  onKick,
}: {
  chat: ChatMessage[];
  log: LogEntry[];
  onSend: (text: string) => void;
  myUserId: string | null;
  isHost?: boolean;
  onKick?: (userId: string, name: string) => void;
}) {
  const [tab, setTab] = useState<'chat' | 'log'>('chat');
  const [text, setText] = useState('');
  const [unread, setUnread] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.length, log.length, tab]);

  useEffect(() => {
    if (tab !== 'chat' && chat.length) setUnread((u) => u + 1);
  }, [chat.length]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(text);
    setText('');
  };

  return (
    <aside className="flex h-full min-h-64 flex-col rounded-2xl border border-white/10 bg-zinc-900/80">
      <div className="flex border-b border-white/10 text-sm">
        {(['chat', 'log'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === 'chat') setUnread(0);
            }}
            className={`flex-1 py-2 capitalize ${tab === t ? 'border-b-2 border-amber-400 text-white' : 'text-zinc-400'}`}
          >
            {t === 'log' ? 'Hand log' : 'Chat'}
            {t === 'chat' && unread > 0 && (
              <span className="ml-1 rounded-full bg-amber-500 px-1.5 text-[10px] text-zinc-950">{unread}</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1 space-y-1 overflow-y-auto p-3 text-sm">
        {tab === 'chat'
          ? chat.map((m) => (
              <div key={m.id} className="group flex items-baseline justify-between gap-1">
                <div>
                  <span className={`font-semibold ${m.userId === myUserId ? 'text-indigo-300' : 'text-amber-300'}`}>
                    {m.name}:
                  </span>{' '}
                  <span className="break-words text-zinc-200">{m.text}</span>
                </div>
                {isHost && m.userId !== myUserId && onKick && (
                  <button
                    type="button"
                    onClick={() => onKick(m.userId, m.name)}
                    className="shrink-0 text-[10px] text-red-400/70 hover:text-red-300 hover:underline"
                    title={`Kick ${m.name}`}
                  >
                    Kick
                  </button>
                )}
              </div>
            ))
          : log.map((l, i) => (
              <div key={`${l.ts}-${i}`} className={l.text.startsWith('---') ? 'pt-2 text-zinc-500' : 'text-zinc-300'}>
                {l.text}
              </div>
            ))}
        <div ref={endRef} />
      </div>
      {tab === 'chat' && (
        <form onSubmit={submit} className="flex gap-2 border-t border-white/10 p-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            placeholder="Say something…"
            className="flex-1 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm outline-none"
          />
          <button className="rounded-lg bg-zinc-700 px-3 text-sm hover:bg-zinc-600">Send</button>
        </form>
      )}
    </aside>
  );
}
