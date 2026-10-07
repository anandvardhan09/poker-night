export const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
/** Without Supabase the app uses name-only login against a local dev server. */
export const DEV_LOGIN = !(SUPABASE_URL && SUPABASE_ANON_KEY);
