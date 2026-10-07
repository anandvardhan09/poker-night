import { useEffect, useRef, useState } from 'react';

/**
 * Renders a MediaStream. Stays mounted even when the camera is off so remote audio keeps playing;
 * pass `hidden` to keep it invisible.
 */
export function VideoTile({
  stream,
  muted,
  mirrored,
  hidden,
}: {
  stream: MediaStream;
  muted?: boolean;
  mirrored?: boolean;
  hidden?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.play().then(
      () => setBlocked(false),
      () => setBlocked(true),
    );
  }, [stream]);

  useEffect(() => {
    if (!blocked) return;
    const retry = () => {
      ref.current?.play().then(() => setBlocked(false), () => undefined);
    };
    window.addEventListener('pointerdown', retry, { once: true });
    return () => window.removeEventListener('pointerdown', retry);
  }, [blocked]);

  return (
    <>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={`absolute inset-0 h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''} ${
          hidden ? 'opacity-0' : ''
        }`}
      />
      {blocked && !muted && (
        <button
          onClick={() => ref.current?.play().then(() => setBlocked(false), () => undefined)}
          className="absolute inset-x-1 bottom-1 z-20 rounded bg-black/70 px-1 py-0.5 text-[10px] text-white"
        >
          Tap to hear
        </button>
      )}
    </>
  );
}
