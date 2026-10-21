import type { PlayerStats, Profile } from '@pk/shared';
import type { PlayerHandRow } from './store';

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);

export function computeStats(profile: Profile, rows: PlayerHandRow[]): PlayerStats {
  const hands = rows.length;
  const won = rows.filter((r) => r.won).length;
  return {
    userId: profile.id,
    name: profile.displayName,
    avatarUrl: profile.avatarUrl,
    hands,
    vpip: pct(rows.filter((r) => r.vpip).length, hands),
    pfr: pct(rows.filter((r) => r.pfr).length, hands),
    winRate: pct(won, hands),
    handsWon: won,
    net: rows.reduce((sum, r) => sum + r.net, 0),
    biggestPot: rows.reduce((max, r) => Math.max(max, r.potWon), 0),
  };
}
