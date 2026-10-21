import { ACTION_TIMEOUT_MS } from '@pk/shared';
import type { StoredSettings } from './types';

export const DEFAULT_SETTINGS: StoredSettings = {
  variant: 'holdem',
  mode: 'cash',
  isPrivate: false,
  passwordHash: null,
  turnSeconds: ACTION_TIMEOUT_MS / 1000,
  straddle: false,
  runItTwice: false,
  blindLevelMinutes: 0,
  sngBuyIn: 0,
  sngStartingStack: 0,
};

/** Tables saved before settings existed get the defaults. */
export function withDefaults(raw: Partial<StoredSettings> | null | undefined): StoredSettings {
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}
