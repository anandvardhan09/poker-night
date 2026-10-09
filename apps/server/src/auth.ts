import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from './config';
import { supabaseAdmin, type AuthUser } from './store';

export interface HandshakeAuth {
  token?: string;
  devName?: string;
}

interface Metadata {
  full_name?: string;
  name?: string;
  avatar_url?: string;
  picture?: string;
}

function fromMetadata(id: string, email: string | undefined, meta: Metadata | undefined): AuthUser {
  const name = meta?.full_name || meta?.name || email?.split('@')[0] || 'Player';
  return { id, name: name.slice(0, 40), avatarUrl: meta?.avatar_url || meta?.picture || null };
}

const jwtKey = config.supabase?.jwtSecret ? new TextEncoder().encode(config.supabase.jwtSecret) : null;
const jwksUrl = config.supabase?.url
  ? `${config.supabase.url.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`
  : null;
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;
if (jwksUrl) console.log('[auth] JWKS URL:', jwksUrl);

/** Resolves the socket handshake payload to a user, or throws. */
export async function authenticate(auth: HandshakeAuth): Promise<AuthUser> {
  if (config.devLogin) {
    const name = (auth.devName ?? '').trim().slice(0, 24);
    if (!name) throw new Error('Name required');
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player';
    return { id: `dev-${slug}`, name, avatarUrl: null };
  }

  const token = auth.token;
  if (!token) throw new Error('Not signed in');

  // 1. Try modern JWKS verification (ES256/RS256 used by modern Supabase projects)
  if (jwks) {
    try {
      const { payload } = await jwtVerify(token, jwks, { audience: 'authenticated' });
      console.log('[auth] JWKS verification succeeded for user:', payload.sub);
      return fromMetadata(payload.sub!, payload.email as string | undefined, payload.user_metadata as Metadata);
    } catch (e) {
      console.error('[auth] JWKS verification failed:', e instanceof Error ? e.message : e);
      // Fall through to legacy secret or API
    }
  }

  // 2. Try legacy HS256 secret verification
  if (jwtKey) {
    try {
      const { payload } = await jwtVerify(token, jwtKey, { audience: 'authenticated' });
      return fromMetadata(payload.sub!, payload.email as string | undefined, payload.user_metadata as Metadata);
    } catch {
      // Fall through to Supabase API verification
    }
  }

  // 3. Fall through to Supabase API verification
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && data?.user) {
      return fromMetadata(data.user.id, data.user.email, data.user.user_metadata as Metadata);
    }
    console.error('Supabase auth.getUser failed:', error?.message || error);
  }

  throw new Error('Invalid session');
}
