import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_SUPABASE_URL = 'https://xklmlvhgmepepkiptzqg.supabase.co';
export const DEFAULT_SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrbG1sdmhnbWVwZXBraXB0enFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5Nzc5OTUsImV4cCI6MjEwODU1Mzk5NX0.I0Jei-EbPcN_skvmCZQfZIFYakC48-04rm89A4xX_t4';
export const SUPABASE_PROJECT_ID = 'xklmlvhgmepepkiptzqg';

/**
 * Normaliza y valida de forma estricta cualquier URL de Supabase para asegurar
 * que empiece con http:// o https:// y sea un origin válido.
 * Si es inválida, placeholder o vacía, retorna el fallback por defecto.
 */
export function normalizeSupabaseUrl(input?: string | null): string {
  if (!input || typeof input !== 'string') return DEFAULT_SUPABASE_URL;
  let clean = input.trim().replace(/^['"]|['"]$/g, '');
  if (!clean || clean === 'undefined' || clean === 'null') return DEFAULT_SUPABASE_URL;

  // Filtrar placeholders habituales
  if (
    clean.includes('your-project') ||
    clean.includes('your-supabase') ||
    clean.includes('MY_SUPABASE') ||
    clean.includes('example.com')
  ) {
    return DEFAULT_SUPABASE_URL;
  }

  // Prepend https:// si vino como dominio sin protocolo
  if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
    if (clean.includes('.')) {
      clean = `https://${clean}`;
    } else {
      return DEFAULT_SUPABASE_URL;
    }
  }

  // Quitar sufijos de endpoint REST y barras
  clean = clean.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

  try {
    const parsed = new URL(clean);
    if (!parsed.protocol.startsWith('http')) {
      return DEFAULT_SUPABASE_URL;
    }
    return parsed.origin;
  } catch {
    return DEFAULT_SUPABASE_URL;
  }
}

export function normalizeSupabaseKey(key?: string | null): string {
  if (!key || typeof key !== 'string') return DEFAULT_SUPABASE_KEY;
  const clean = key.trim().replace(/^['"]|['"]$/g, '');
  if (
    !clean ||
    clean === 'undefined' ||
    clean === 'null' ||
    clean.includes('your-supabase-anon-key') ||
    clean.includes('your-anon-key') ||
    clean.length < 20
  ) {
    return DEFAULT_SUPABASE_KEY;
  }
  return clean;
}

function getEnvVar(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name];
  }
  try {
    const metaEnv = (import.meta as any)?.env;
    if (metaEnv && metaEnv[name]) {
      return metaEnv[name];
    }
  } catch {
    // ignore
  }
  return undefined;
}

const rawUrl = getEnvVar('VITE_SUPABASE_URL') || getEnvVar('SUPABASE_URL');
const rawKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || getEnvVar('SUPABASE_ANON_KEY');

export const SUPABASE_URL = normalizeSupabaseUrl(rawUrl);
export const SUPABASE_ANON_KEY = normalizeSupabaseKey(rawKey);

/**
 * Crea un cliente Supabase protegido contra excepciones fatales para evitar que el
 * proceso del servidor Node o la aplicación mueran por URLs no válidas.
 */
export function createSafeClient(url: string, key: string, options?: any): SupabaseClient {
  const safeUrl = normalizeSupabaseUrl(url);
  const safeKey = normalizeSupabaseKey(key);

  try {
    return createClient(safeUrl, safeKey, options);
  } catch (err) {
    console.warn('Advertencia al iniciar cliente Supabase con parámetros provistos:', err);
    try {
      return createClient(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY, options);
    } catch (fallbackErr) {
      console.error('Error al inicializar cliente Supabase predeterminado:', fallbackErr);
      return {
        from: () => ({
          select: () => ({ limit: async () => ({ data: [], error: { message: 'Supabase offline' } }) }),
          insert: async () => ({ error: { message: 'Supabase offline' } }),
          update: async () => ({ error: { message: 'Supabase offline' } }),
          delete: async () => ({ error: { message: 'Supabase offline' } }),
        }),
        auth: {
          getSession: async () => ({ data: { session: null }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        }
      } as unknown as SupabaseClient;
    }
  }
}

/**
 * Cliente oficial de Supabase configurado y listo para autenticación,
 * cartelera de actividades, mensajes en tiempo real, contactos y moderación.
 */
export const supabase = createSafeClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: typeof window !== 'undefined',
    autoRefreshToken: typeof window !== 'undefined',
    detectSessionInUrl: typeof window !== 'undefined'
  }
});

/**
 * Verifica si la conexión con Supabase está activa y si las tablas están listas.
 */
export async function checkSupabaseStatus(): Promise<{
  connected: boolean;
  tablesReady: boolean;
  missingTables: string[];
  error?: string;
}> {
  try {
    const requiredTables = ['activities', 'chats', 'reviews', 'contacts'];
    const missing: string[] = [];

    for (const t of requiredTables) {
      const { error } = await supabase.from(t).select('id').limit(1);
      if (error && (error.code === 'PGRST205' || error.message?.includes('not find the table'))) {
        missing.push(t);
      }
    }

    return {
      connected: true,
      tablesReady: missing.length === 0,
      missingTables: missing
    };
  } catch (err: any) {
    return {
      connected: false,
      tablesReady: false,
      missingTables: [],
      error: err.message || 'Error de conexión con Supabase'
    };
  }
}
