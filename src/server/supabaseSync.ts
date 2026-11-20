import { SupabaseClient } from '@supabase/supabase-js';
import { db } from './db.ts';
import {
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_KEY,
  SUPABASE_PROJECT_ID,
  normalizeSupabaseUrl,
  normalizeSupabaseKey,
  createSafeClient
} from '../supabaseClient.ts';

const RAW_SERVER_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const RAW_SERVER_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_URL = normalizeSupabaseUrl(RAW_SERVER_URL);
export const SUPABASE_ANON_KEY = normalizeSupabaseKey(RAW_SERVER_KEY);

export const serverSupabase: SupabaseClient = createSafeClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function getSupabaseHealth() {
  try {
    const requiredTables = ['activities', 'chats', 'messages', 'reviews', 'contacts', 'users', 'reports', 'sanctions', 'bajas'];
    const status: Record<string, boolean> = {};
    let missingCount = 0;

    for (const t of requiredTables) {
      const { error } = await serverSupabase.from(t).select('id').limit(1);
      if (error && (error.code === 'PGRST205' || error.message?.includes('not find the table'))) {
        status[t] = false;
        missingCount++;
      } else {
        status[t] = true;
      }
    }

    return {
      connected: true,
      url: SUPABASE_URL,
      projectId: 'xklmlvhgmepepkiptzqg',
      tablesReady: missingCount === 0,
      tables: status,
      missingCount
    };
  } catch (err: any) {
    return {
      connected: false,
      url: SUPABASE_URL,
      projectId: 'xklmlvhgmepepkiptzqg',
      tablesReady: false,
      error: err.message || 'Error de conexión'
    };
  }
}

/**
 * Verificación y sincronización. No se insertan datos simulados o mock.
 * La aplicación opera exclusivamente con datos reales creados por los usuarios en Supabase.
 */
export async function syncSeedToSupabase() {
  return true;
}

