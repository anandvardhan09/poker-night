import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEV_LOGIN } from './config';
import { supabase } from './supabase';

const DEV_NAME_KEY = 'pk.devName';

export interface HandshakePayload {
  token?: string;
  devName?: string;
}

interface AuthContextValue {
  status: 'loading' | 'signedOut' | 'signedIn';
  devMode: boolean;
  signInWithGoogle: () => Promise<void>;
  signInDev: (name: string) => void;
  signOut: () => Promise<void>;
  /** Latest credentials for the socket handshake (re-read on every reconnect). */
  handshake: () => HandshakePayload;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const token = useRef<string | null>(null);
  const devName = useRef<string | null>(DEV_LOGIN ? localStorage.getItem(DEV_NAME_KEY) : null);

  useEffect(() => {
    if (!supabase) {
      setStatus(devName.current ? 'signedIn' : 'signedOut');
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      token.current = data.session?.access_token ?? null;
      setStatus(data.session ? 'signedIn' : 'signedOut');
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      token.current = session?.access_token ?? null;
      setStatus(session ? 'signedIn' : 'signedOut');
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.href },
    });
  }, []);

  const signInDev = useCallback((name: string) => {
    const clean = name.trim().slice(0, 24);
    if (!clean) return;
    localStorage.setItem(DEV_NAME_KEY, clean);
    devName.current = clean;
    setStatus('signedIn');
  }, []);

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
    localStorage.removeItem(DEV_NAME_KEY);
    devName.current = null;
    token.current = null;
    setStatus('signedOut');
  }, []);

  const handshake = useCallback(
    (): HandshakePayload => (DEV_LOGIN ? { devName: devName.current ?? '' } : { token: token.current ?? '' }),
    [],
  );

  const value = useMemo(
    () => ({ status, devMode: DEV_LOGIN, signInWithGoogle, signInDev, signOut, handshake }),
    [status, signInWithGoogle, signInDev, signOut, handshake],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
