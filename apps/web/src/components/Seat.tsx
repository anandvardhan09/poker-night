import type { PublicSeat } from '@pk/shared';
import { chips } from '../lib/format';
import { VideoTile } from '../rtc/VideoTile';
import { useSpeaking } from '../rtc/useAudioLevel';
import { Avatar } from './Avatar';
import { PlayingCard } from './PlayingCard';

export interface SeatProps {
  seat: PublicSeat;
  isMe: boolean;
  toAct: boolean;
  /** 0..1 fraction of the action timer remaining, when this seat is to act. */
  timeLeft: number | null;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  winner: boolean;
  handName: string | null;
  isHost?: boolean;
  canKick?: boolean;
  onKick?: () => void;
}

export function Seat({
  seat,
  isMe,
  toAct,
  timeLeft,
  stream,
  camOn,
  micOn,
  winner,
  handName,
  isHost,
  canKick,
  onKick,
}: SeatProps) {
  const speaking = useSpeaking(stream, micOn);
  const showVideo = !!stream && camOn && stream.getVideoTracks().length > 0;
  const offline = !seat.connected;
  const out = seat.folded || seat.status === 'sitting_out' || offline;

  return (
    <div className="relative flex w-36 flex-col items-center">
      <div
        className={`relative h-[6.25rem] w-36 overflow-hidden rounded-xl bg-zinc-800 shadow-lg ring-2 transition ${
          toAct ? 'ring-amber-400' : winner ? 'ring-emerald-400' : 'ring-white/10'
        } ${speaking ? 'speaking' : ''} ${out && !toAct ? 'opacity-60' : ''}`}
      >
        {stream && <VideoTile stream={stream} muted={isMe} mirrored={isMe} hidden={!showVideo} />}
        {!showVideo && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-zinc-700 to-zinc-900">
            <Avatar name={seat.name} url={seat.avatarUrl} size={52} />
          </div>
        )}
        {seat.connected && !micOn && (
          <span className="absolute right-1 top-1 z-10 rounded bg-black/60 px-1 text-[10px]" title="Muted">
            🔇
          </span>
        )}
        {(offline || seat.status === 'sitting_out') && (
          <span className="absolute left-1 top-1 z-10 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-300">
            {offline ? 'Offline' : 'Sitting out'}
          </span>
        )}
        {timeLeft !== null && (
          <div className="absolute inset-x-0 bottom-0 z-10 h-1.5 bg-black/50">
            <div
              className={`h-full transition-[width] duration-200 ${timeLeft < 0.25 ? 'bg-red-500' : 'bg-amber-400'}`}
              style={{ width: `${Math.max(0, timeLeft) * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="z-10 -mt-5 flex h-11 gap-0.5">
        {seat.cards
          ? seat.cards.map((c) => <PlayingCard key={c} card={c} size="sm" dim={seat.folded} />)
          : seat.hasCards && (
              <>
                <PlayingCard size="sm" />
                <PlayingCard size="sm" />
              </>
            )}
      </div>

      <div
        className={`z-10 -mt-1 min-w-32 max-w-36 rounded-lg px-3 py-1 text-center ring-1 ${
          isMe ? 'bg-indigo-950/95 ring-indigo-400/40' : 'bg-zinc-900/95 ring-white/10'
        }`}
      >
        <div className="flex items-center justify-center gap-1">
          {isHost && <span title="Room Leader" className="text-xs">👑</span>}
          <div className="truncate text-xs font-semibold">{seat.name}</div>
        </div>
        <div className="text-sm font-bold text-amber-300">{seat.allIn ? 'ALL IN' : chips(seat.stack)}</div>
        {canKick && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onKick?.();
            }}
            className="mt-1 w-full rounded bg-red-600/80 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow hover:bg-red-500 transition"
          >
            Kick
          </button>
        )}
      </div>

      {(handName || seat.lastAction) && (
        <div
          className={`absolute -bottom-6 z-10 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            handName ? 'bg-emerald-500 text-emerald-950' : 'bg-zinc-700 text-zinc-100'
          }`}
        >
          {handName ?? seat.lastAction}
        </div>
      )}
    </div>
  );
}
