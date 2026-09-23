/**
 * Service-role Supabase access (bypasses RLS).
 * SERVER-ONLY. Do not import this module from Client Components or any
 * file under app/** that is marked "use client".
 */

import { createClient } from '@supabase/supabase-js';
import { getServerConfig } from '../config/env.js';

export function createServiceRoleSupabaseClient(env = process.env, options) {
  if (typeof window !== 'undefined') {
    throw new Error('createServiceRoleSupabaseClient must not run in the browser');
  }

  const config = getServerConfig(env, options);
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error('Service-role client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Next.js patches global fetch and may cache PostgREST GETs by URL.
    // A once-empty prompt_documents response would then stick forever for
    // that select string — breaking getPromptDocument while other selects work.
    global: {
      fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
    },
  });
}
