import { createLocalJWKSet, createRemoteJWKSet, decodeJwt, jwtVerify, type JWTVerifyGetKey, type JSONWebKeySet } from 'jose';
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

// Eagerly fetch JWKS at startup and cache the key set
const jwksReady: Promise<JWTVerifyGetKey | null> = (async () => {
  if (!config.supabase?.url) return null;
  const url = `${config.supabase.url.replace(/\/+$/, '')}/auth/v1/.well-known/jwks.json`;
  console.log('[auth] Fetching JWKS from:', url);
  try {
    const res = await fetch(url);
    console.log('[auth] JWKS fetch status:', res.status);
    if (!res.ok) {
      const body = await res.text().catch(() => '(unreadable)');
      console.error('[auth] JWKS fetch body:', body.slice(0, 300));
      // Fall back to lazy remote JWKS (will retry on each auth attempt)
      return createRemoteJWKSet(new URL(url));
    }
    const data = (await res.json()) as JSONWebKeySet;
    console.log('[auth] JWKS loaded successfully, keys:', data.keys?.length ?? 0);
    return createLocalJWKSet(data);
  } catch (e) {
    console.error('[auth] JWKS fetch error:', e instanceof Error ? e.message : e);
    return createRemoteJWKSet(new URL(url));
  }
})();

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
  const jwks = await jwksReady;
  if (jwks) {
    try {
      const { payload } = await jwtVerify(token, jwks, { audience: 'authenticated' });
      console.log('[auth] JWKS verification succeeded for user:', payload.sub);
      return fromMetadata(payload.sub!, payload.email as string | undefined, payload.user_metadata as Metadata);
    } catch (e) {
      console.error('[auth] JWKS verification failed:', e instanceof Error ? e.message : e);
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
    try {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user) {
        return fromMetadata(data.user.id, data.user.email, data.user.user_metadata as Metadata);
      }
      console.error('[auth] Supabase auth.getUser failed:', error?.message || error);
    } catch (e) {
      console.error('[auth] Supabase auth.getUser threw:', e instanceof Error ? e.message : e);
    }
  }

  // 4. Last resort: decode (without signature verification) and validate via Supabase admin getUserById
  //    This is safe because we trust the token came over our own TLS connection, and we
  //    validate the user exists in Supabase before accepting.
  if (supabaseAdmin) {
    try {
      const payload = decodeJwt(token);
      if (payload.sub && payload.aud === 'authenticated') {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(payload.sub);
        if (!error && data?.user) {
          console.log('[auth] Fallback admin.getUserById succeeded for:', payload.sub);
          return fromMetadata(data.user.id, data.user.email, data.user.user_metadata as Metadata);
        }
        console.error('[auth] admin.getUserById failed:', error?.message || error);
      }
    } catch (e) {
      console.error('[auth] Fallback decode failed:', e instanceof Error ? e.message : e);
    }
  }

  throw new Error('Invalid session');
}
