export const STARTING_CHIPS = 10_000;
export const ACTION_TIMEOUT_MS = 30_000;
export const NEXT_HAND_DELAY_MS = 5_000;
export const MAX_MISSED_HANDS = 2;
export const MIN_SEATS = 2;
export const MAX_SEATS = 9;
export const MIN_BUY_IN_BB = 20;
export const MAX_BUY_IN_BB = 200;
export const DEFAULT_BUY_IN_BB = 100;
export const CHAT_HISTORY_LIMIT = 50;
export const LOG_LIMIT = 60;

// ---- Time bank ----
export const TIME_BANK_MAX_MS = 60_000;
export const TIME_BANK_PER_HAND_MS = 5_000;
export const TIME_BANK_CHUNK_MS = 30_000;

// ---- Table options ----
export const MIN_TURN_SECONDS = 10;
export const MAX_TURN_SECONDS = 120;
export const MAX_VIDEO_SPECTATORS = 4;
export const REACTION_EMOJIS = ['👍', '😂', '😮', '😡', '🔥', '🎉', '😭', '🤔', '💰', '🙈'] as const;
export const REACTION_COOLDOWN_MS = 1_000;

/** Blind multipliers per level when rising blinds are on. */
export const BLIND_LEVEL_MULTIPLIERS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 100];

// ---- Sit & Go ----
/** Payout percentages by number of entrants. */
export function sngPayouts(entrants: number): number[] {
  if (entrants <= 4) return [100];
  if (entrants <= 6) return [65, 35];
  return [50, 30, 20];
}

// ---- Daily refill ----
export const REFILL_INTERVAL_MS = 24 * 60 * 60 * 1000;
