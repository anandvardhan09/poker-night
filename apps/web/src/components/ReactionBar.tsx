import { REACTION_EMOJIS } from '@pk/shared';

export function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {REACTION_EMOJIS.map((e) => (
        <button
          key={e}
          onClick={() => onReact(e)}
          className="rounded-lg px-1.5 py-0.5 text-xl transition hover:scale-125 hover:bg-zinc-800"
          title={`React ${e}`}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
