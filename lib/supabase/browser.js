/**
 * Browser-safe Supabase client (anon key only).
 * Never import service-role modules from Client Components.
 */

import { createClient } from '@supabase/supabase-js';
import { getPublicConfig } from '../config/env.js';

let browserClient;

export function createBrowserSupabaseClient(env = process.env) {
  const { supabaseUrl, supabaseAnonKey } = getPublicConfig(env);
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Browser Supabase client requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

export function getBrowserSupabaseClient() {
  if (!browserClient) {
    browserClient = createBrowserSupabaseClient();
  }
  return browserClient;
}
