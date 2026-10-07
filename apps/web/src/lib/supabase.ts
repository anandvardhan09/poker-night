import { createClient } from '@supabase/supabase-js';
import { DEV_LOGIN, SUPABASE_ANON_KEY, SUPABASE_URL } from './config';

export const supabase = DEV_LOGIN
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
