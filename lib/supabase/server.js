/**
 * Server Supabase client using the anon key (respects RLS).
 * For privileged operations that bypass RLS, use ./admin.js instead.
 */

import { createClient } from '@supabase/supabase-js';
import { getPublicConfig } from '../config/env.js';

export function createServerSupabaseClient(env = process.env) {
  if (typeof window !== 'undefined') {
    throw new Error('createServerSupabaseClient must not run in the browser');
  }
  const { supabaseUrl, supabaseAnonKey } = getPublicConfig(env);
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Server Supabase client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
    },
  });
}
