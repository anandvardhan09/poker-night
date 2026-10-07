import { existsSync } from 'node:fs';
import type { IceServerConfig } from '@pk/shared';

if (existsSync('.env')) process.loadEnvFile('.env');

const env = process.env;
const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const supabaseConfigured = !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);

function iceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turn = list(env.TURN_URLS);
  if (turn.length) {
    servers.push({ urls: turn, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }
  return servers;
}

export const config = {
  port: Number(env.PORT ?? 3001),
  clientOrigins: list(env.CLIENT_ORIGIN ?? 'http://localhost:5173'),
  supabase: supabaseConfigured
    ? {
        url: env.SUPABASE_URL!,
        serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY!,
        jwtSecret: env.SUPABASE_JWT_SECRET || null,
      }
    : null,
  devLogin: !supabaseConfigured,
  dataDir: env.DATA_DIR ?? '.data',
  iceServers: iceServers(),
};
