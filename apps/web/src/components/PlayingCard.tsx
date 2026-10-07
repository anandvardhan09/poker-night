const SUITS: Record<string, { symbol: string; red: boolean }> = {
  s: { symbol: '♠', red: false },
  h: { symbol: '♥', red: true },
  d: { symbol: '♦', red: true },
  c: { symbol: '♣', red: false },
};

const SIZES = {
  sm: 'h-11 w-8 text-sm',
  md: 'h-16 w-11 text-lg',
  lg: 'h-20 w-14 text-2xl',
};

export function PlayingCard({
  card,
  size = 'md',
  dim,
  highlight,
}: {
  card?: string | null;
  size?: keyof typeof SIZES;
  dim?: boolean;
  highlight?: boolean;
}) {
  const base = `${SIZES[size]} shrink-0 rounded-md shadow-md select-none transition`;
  if (!card) return <div className={`${base} card-back border border-white/30`} />;
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = SUITS[card[1]!]!;
  return (
    <div
      className={`${base} flex flex-col items-center justify-center bg-white font-bold leading-none ${
        suit.red ? 'text-red-600' : 'text-zinc-900'
      } ${dim ? 'opacity-40' : ''} ${highlight ? 'ring-2 ring-amber-400' : ''}`}
    >
      <span>{rank}</span>
      <span>{suit.symbol}</span>
    </div>
  );
}

export function CardSlot({ size = 'md' }: { size?: keyof typeof SIZES }) {
  return <div className={`${SIZES[size]} rounded-md border border-dashed border-white/15`} />;
}
