/** Small synthesized sound effects (no audio files), with a remembered mute switch. */

type Tone = { freq: number; dur: number; type?: OscillatorType; gain?: number; delay?: number; slide?: number };

let ctx: AudioContext | null = null;
const MUTE_KEY = 'pk:muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

let muted = readMuted();
const listeners = new Set<(m: boolean) => void>();

export const isMuted = () => muted;

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    // Storage can be unavailable (private mode); the switch still works for this visit.
  }
  listeners.forEach((l) => l(m));
}

export function onMutedChange(fn: (m: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function play(tones: Tone[]) {
  if (muted) return;
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  for (const t of tones) {
    const osc = a.createOscillator();
    const g = a.createGain();
    const start = now + (t.delay ?? 0);
    osc.type = t.type ?? 'sine';
    osc.frequency.setValueAtTime(t.freq, start);
    if (t.slide) osc.frequency.exponentialRampToValueAtTime(t.slide, start + t.dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(t.gain ?? 0.15, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    osc.connect(g).connect(a.destination);
    osc.start(start);
    osc.stop(start + t.dur + 0.02);
  }
}

export const sounds = {
  turn: () =>
    play([
      { freq: 660, dur: 0.15, type: 'triangle', gain: 0.2 },
      { freq: 990, dur: 0.22, type: 'triangle', gain: 0.2, delay: 0.13 },
    ]),
  chips: () =>
    play([
      { freq: 2400, dur: 0.05, type: 'square', gain: 0.05 },
      { freq: 2000, dur: 0.05, type: 'square', gain: 0.05, delay: 0.05 },
      { freq: 2600, dur: 0.05, type: 'square', gain: 0.04, delay: 0.1 },
    ]),
  card: () => play([{ freq: 1200, dur: 0.06, type: 'sawtooth', gain: 0.04, slide: 400 }]),
  check: () => play([{ freq: 300, dur: 0.07, type: 'square', gain: 0.06 }, { freq: 300, dur: 0.07, type: 'square', gain: 0.06, delay: 0.1 }]),
  fold: () => play([{ freq: 500, dur: 0.12, type: 'sine', gain: 0.06, slide: 200 }]),
  win: () =>
    play([
      { freq: 523, dur: 0.14, type: 'triangle', gain: 0.18 },
      { freq: 659, dur: 0.14, type: 'triangle', gain: 0.18, delay: 0.12 },
      { freq: 784, dur: 0.3, type: 'triangle', gain: 0.18, delay: 0.24 },
    ]),
  pop: () => play([{ freq: 880, dur: 0.08, type: 'sine', gain: 0.08, slide: 1400 }]),
};

// ---------- tab title alert ----------

let flashTimer: ReturnType<typeof setInterval> | null = null;
let baseTitle = typeof document !== 'undefined' ? document.title : '';

/** Flashes the tab title until the page is focused again. */
export function flashTitle(message: string) {
  if (typeof document === 'undefined' || !document.hidden || flashTimer) return;
  baseTitle = document.title;
  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? message : baseTitle;
  }, 900);
  const stop = () => {
    if (flashTimer) clearInterval(flashTimer);
    flashTimer = null;
    document.title = baseTitle;
    document.removeEventListener('visibilitychange', stop);
  };
  document.addEventListener('visibilitychange', stop);
}
