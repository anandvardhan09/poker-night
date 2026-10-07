import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { FileStore } from './fileStore';
import { SupabaseStore } from './supabaseStore';
import type { Store } from './types';

export * from './types';

export const supabaseAdmin: SupabaseClient | null = config.supabase
  ? createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

export function createStore(): Store {
  return supabaseAdmin ? new SupabaseStore(supabaseAdmin) : new FileStore(config.dataDir);
}
