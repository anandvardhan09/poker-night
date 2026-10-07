import { useEffect, useState } from 'react';

let sharedCtx: AudioContext | null = null;

function audioContext(): AudioContext {
  sharedCtx ??= new AudioContext();
  if (sharedCtx.state === 'suspended') {
    const resume = () => void sharedCtx?.resume();
    window.addEventListener('pointerdown', resume, { once: true });
    void sharedCtx.resume().catch(() => undefined);
  }
  return sharedCtx;
}

const THRESHOLD = 0.035;

/** True while the stream's audio level is above a speaking threshold. */
export function useSpeaking(stream: MediaStream | null, enabled = true): boolean {
  const [speaking, setSpeaking] = useState(false);
  const audioTrack = stream?.getAudioTracks()[0] ?? null;

  useEffect(() => {
    if (!stream || !audioTrack || !enabled) {
      setSpeaking(false);
      return;
    }
    const ctx = audioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let last = false;
    let quietTicks = 0;
    const id = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) {
        const x = (v - 128) / 128;
        sum += x * x;
      }
      const loud = Math.sqrt(sum / buf.length) > THRESHOLD && audioTrack.enabled;
      quietTicks = loud ? 0 : quietTicks + 1;
      const next = loud || (last && quietTicks < 3);
      if (next !== last) {
        last = next;
        setSpeaking(next);
      }
    }, 120);
    return () => {
      clearInterval(id);
      source.disconnect();
    };
  }, [stream, audioTrack, enabled]);

  return speaking;
}
