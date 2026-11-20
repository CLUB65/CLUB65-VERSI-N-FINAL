import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAdminPromotionIdentifier,
  findPromotableUserCandidate,
  buildSupabaseAdminPromotionPayload,
  applyAdminPromotionToLocalUser,
  canViewerBlockOrPrivateChat
} from './adminPromotion.ts';
import { supabase } from '../supabaseClient.ts';
import { api, invalidateApiCaches, setStoredUserId } from '../api.ts';

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear()
  };
  return store;
}

interface QueryLog {
  table: string;
  op: 'select' | 'insert' | 'upsert' | 'update' | 'delete';
  payload?: any;
  filters: Array<{ method: string; col: string; val: any }>;
}

function createUsersTableSupabaseMock(dbUsers: Record<string, any>) {
  const logs: QueryLog[] = [];

  const mockFrom = (table: string) => {
    const state: QueryLog = { table, op: 'select', filters: [] };

    const execute = async (expectSingle = false) => {
      logs.push({
        table: state.table,
        op: state.op,
        payload: state.payload,
        filters: [...state.filters]
      });

      if (table !== 'users') {
        return { data: expectSingle ? null : [], error: null };
      }

      if (state.op === 'select') {
        let rows = Object.values(dbUsers);
        for (const f of state.filters) {
          if (f.method === 'eq') {
            rows = rows.filter((r) => String(r[f.col] ?? '') === String(f.val));
          } else if (f.method === 'neq') {
            rows = rows.filter((r) => String(r[f.col] ?? '') !== String(f.val));
          } else if (f.method === 'ilike') {
            const pattern = String(f.val || '').toLowerCase();
            rows = rows.filter((r) => {
              const val = String(r[f.col] ?? '').toLowerCase();
              // Simulate PostgreSQL ILIKE '_' wildcard so tests catch wildcard false-positives
              const regex = new RegExp(
                '^' +
                  pattern
                    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                    .replace(/_/g, '.')
                    .replace(/%/g, '.*') +
                  '$'
              );
              return regex.test(val);
            });
          } else if (f.method === 'or') {
            // Simple email/usuario OR parser used by api.login fallback
            const parts = String(f.val).split(',');
            rows = rows.filter((r) =>
              parts.some((part) => {
                const m = part.match(/^([^.]+)\.ilike\.(.+)$/);
                if (!m) return false;
                return String(r[m[1]] ?? '').toLowerCase() === m[2].toLowerCase();
              })
            );
          }
        }
        return { data: expectSingle ? rows[0] || null : rows, error: null };
      }

      if (state.op === 'update') {
        const eqId = state.filters.find((f) => f.method === 'eq' && f.col === 'id');
        if (!eqId || !dbUsers[eqId.val]) {
          return { data: null, error: { message: 'User not found' } };
        }
        dbUsers[eqId.val] = {
          ...dbUsers[eqId.val],
          ...state.payload
        };
        return { data: dbUsers[eqId.val], error: null };
      }

      return { data: null, error: null };
    };

    const builder: any = {
      select: () => builder,
      insert: (p: any) => {
        state.op = 'insert';
        state.payload = p;
        return builder;
      },
      upsert: (p: any) => {
        state.op = 'upsert';
        state.payload = p;
        return builder;
      },
      update: (p: any) => {
        state.op = 'update';
        state.payload = p;
        return builder;
      },
      delete: () => {
        state.op = 'delete';
        return builder;
      },
      eq: (col: string, val: any) => {
        state.filters.push({ method: 'eq', col, val });
        return builder;
      },
      neq: (col: string, val: any) => {
        state.filters.push({ method: 'neq', col, val });
        return builder;
      },
      ilike: (col: string, val: any) => {
        state.filters.push({ method: 'ilike', col, val });
        return builder;
      },
      or: (expr: string) => {
        state.filters.push({ method: 'or', col: 'or', val: expr });
        return builder;
      },
      limit: () => builder,
      single: () => execute(true),
      maybeSingle: () => execute(true),
      then: (resolve: any, reject: any) => execute(false).then(resolve, reject)
    };

    return builder;
  };

  return { mockFrom, logs };
}

test('adminPromotion helpers match exact username/email case-insensitively without wildcard bleed and exclude eliminated accounts', () => {
  assert.equal(normalizeAdminPromotionIdentifier('  @Maria_Gomez  '), 'Maria_Gomez');
  assert.equal(normalizeAdminPromotionIdentifier('  correo@club65.org '), 'correo@club65.org');

  const rows = [
    { id: 'u1', usuario: 'juanXperez', email: 'juanx@mail.com', apodo: 'Juan X', estado_alta: 'aprobada' },
    { id: 'u2', usuario: 'juan_perez', email: 'juan.perez@mail.com', apodo: 'Juan Perez', estado_alta: 'aprobada' },
    { id: 'u3', usuario: 'cuenta_baja', email: 'baja@mail.com', apodo: 'Eliminada', estado_alta: 'eliminado' }
  ];

  // Must pick exact underscore match u2, not ILIKE wildcard match u1
  const byUser = findPromotableUserCandidate(rows, '@juan_perez');
  assert.equal(byUser?.id, 'u2');

  const byEmail = findPromotableUserCandidate(rows, 'JUANX@MAIL.COM');
  assert.equal(byEmail?.id, 'u1');

  const eliminated = findPromotableUserCandidate(rows, 'baja@mail.com');
  assert.equal(eliminated, null);
});

test('applyAdminPromotionToLocalUser strips institutional/personal fields and enforces exclusive moderador role', () => {
  const instUser = {
    id: 'usr_inst_1',
    usuario: 'centro_sur',
    apodo: 'Centro Sur',
    tipo: 'institucional' as const,
    rol: 'institucional',
    isVerified: false,
    estadoAlta: 'pendiente' as const,
    esInstitucion: true,
    entidadTipo: 'Centro de Jubilados',
    cuit: '30-11223344-5',
    legalRepresentative: 'Presidente',
    contactoInstitucional: '11-5555-0000',
    documento_cuit_url: 'https://example.com/cuit.pdf',
    contactoEmergencia: '11-2222-3333'
  };

  const promoted = applyAdminPromotionToLocalUser(instUser);
  assert.equal(promoted.tipo, 'moderador');
  assert.equal(promoted.rol, 'moderador');
  assert.equal(promoted.isVerified, true);
  assert.equal(promoted.estadoAlta, 'aprobada');
  assert.equal(promoted.esInstitucion, false);
  assert.equal(promoted.cuit, undefined);
  assert.equal(promoted.entidadTipo, undefined);
  assert.equal(promoted.contactoInstitucional, undefined);
  assert.equal(promoted.contactoEmergencia, undefined);
});

test('api.promoteToAdmin converts personal user by username in Supabase and persists across logout/login', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalAuth = { ...supabase.auth };
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) });

  const adminUuid = '00000000-0000-4000-8000-000000000001';
  const personalUuid = '00000000-0000-4000-8000-000000000002';

  let currentAuthSessionUser: any = { id: adminUuid, email: 'admin@club65.com' };
  const dbUsers: Record<string, any> = {
    [adminUuid]: {
      id: adminUuid,
      usuario: 'admin_principal',
      email: 'admin@club65.com',
      clave: 'secret',
      apodo: 'Admin Principal',
      tipo: 'moderador',
      rol: 'moderador',
      is_verified: true,
      estado_alta: 'aprobada',
      notifications: []
    },
    [personalUuid]: {
      id: personalUuid,
      usuario: 'maria_gomez',
      email: 'maria@club65.com',
      clave: 'clave123',
      apodo: 'María Gómez',
      bio: 'Me gusta caminar',
      tipo: 'personal',
      rol: 'personal',
      is_verified: false,
      estado_alta: 'aprobada',
      contacto_emergencia: '11-9999-8888',
      notifications: []
    }
  };

  const { mockFrom } = createUsersTableSupabaseMock(dbUsers);
  (supabase as any).from = mockFrom;
  (supabase.auth as any).getSession = async () => ({
    data: { session: currentAuthSessionUser ? { user: currentAuthSessionUser } : null }
  });
  (supabase.auth as any).signOut = async () => {
    currentAuthSessionUser = null;
  };
  (supabase.auth as any).signInWithPassword = async ({ email, password }: any) => {
    const match = Object.values(dbUsers).find(
      (u) => u.email.toLowerCase() === String(email).toLowerCase() && u.clave === password
    );
    if (!match) return { data: { user: null }, error: { message: 'Invalid login credentials' } };
    // Even if Auth user_metadata still says 'personal', login must use public.users!
    currentAuthSessionUser = {
      id: match.id,
      email: match.email,
      user_metadata: { tipo: 'personal', rol: 'personal' }
    };
    return { data: { user: currentAuthSessionUser }, error: null };
  };

  try {
    const promoted = await api.promoteToAdmin('@maria_gomez');

    assert.equal(promoted.id, personalUuid);
    assert.equal(promoted.tipo, 'moderador');
    assert.equal(promoted.rol, 'moderador');
    assert.equal(promoted.isVerified, true);
    assert.equal(dbUsers[personalUuid].tipo, 'moderador');
    assert.equal(dbUsers[personalUuid].rol, 'moderador');
    assert.equal(dbUsers[personalUuid].is_verified, true);
    assert.equal(dbUsers[personalUuid].estado_alta, 'aprobada');
    assert.equal(dbUsers[personalUuid].contacto_emergencia, null);
    assert.equal(dbUsers[personalUuid].notifications.length, 1);

    // Log out and log back in as the newly promoted user (by username and by email)
    await api.logout();
    const loggedInByEmail = await api.login('maria@club65.com', 'clave123');
    assert.equal(loggedInByEmail.id, personalUuid);
    assert.equal(loggedInByEmail.tipo, 'moderador');
    assert.equal(loggedInByEmail.rol, 'moderador');
    assert.equal(loggedInByEmail.isVerified, true);

    const restored = await api.getMe(true);
    assert.equal(restored?.tipo, 'moderador');
    assert.equal(restored?.rol, 'moderador');
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    Object.assign(supabase.auth, originalAuth);
    globalThis.fetch = originalFetch;
  }
});

test('api.promoteToAdmin converts institutional account by email, strips institutional role/fields, removes from getInstitutions, and rejects unauthorized callers', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalAuth = { ...supabase.auth };
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({ ok: true, json: async () => ({}) });

  const adminUuid = '00000000-0000-4000-8000-000000000011';
  const instUuid = '00000000-0000-4000-8000-000000000012';
  const vecinoUuid = '00000000-0000-4000-8000-000000000013';

  let currentAuthSessionUser: any = null;
  const dbUsers: Record<string, any> = {
    [adminUuid]: {
      id: adminUuid,
      usuario: 'admin_principal',
      email: 'admin@club65.com',
      clave: 'secret',
      apodo: 'Admin Principal',
      tipo: 'moderador',
      rol: 'moderador',
      is_verified: true,
      estado_alta: 'aprobada',
      notifications: []
    },
    [instUuid]: {
      id: instUuid,
      usuario: 'club_barrio',
      email: 'contacto@clubbarrio.org',
      clave: 'instpass',
      apodo: 'Club del Barrio',
      bio: 'Institución local',
      tipo: 'institucional',
      rol: 'institucional',
      is_verified: false,
      estado_alta: 'pendiente',
      entidad_tipo: 'Asociación Civil / Club Social',
      cuit: '30-77889900-1',
      legal_representative: '{"presidente":"Juan"}',
      contacto_institucional: '11-4444-5555',
      documento_cuit_url: 'https://storage/cuit.pdf',
      documento_personeria_url: 'https://storage/pers.pdf',
      notifications: []
    },
    [vecinoUuid]: {
      id: vecinoUuid,
      usuario: 'vecino_comun',
      email: 'vecino@club65.com',
      clave: '123',
      apodo: 'Vecino',
      tipo: 'personal',
      rol: 'personal',
      estado_alta: 'aprobada',
      notifications: []
    }
  };

  const { mockFrom } = createUsersTableSupabaseMock(dbUsers);
  (supabase as any).from = mockFrom;
  (supabase.auth as any).getSession = async () => ({
    data: { session: currentAuthSessionUser ? { user: currentAuthSessionUser } : null }
  });
  (supabase.auth as any).signOut = async () => {
    currentAuthSessionUser = null;
  };
  (supabase.auth as any).signInWithPassword = async () => ({
    data: { user: null },
    error: { message: 'Invalid login credentials' }
  });

  try {
    // Non-admin caller with real Auth session must be rejected
    currentAuthSessionUser = { id: vecinoUuid, email: 'vecino@club65.com' };
    await assert.rejects(
      () => api.promoteToAdmin('contacto@clubbarrio.org'),
      /Solo los administradores oficiales/
    );

    // Admin promotes institutional user by email using Supabase Auth session UUID
    currentAuthSessionUser = { id: adminUuid, email: 'admin@club65.com' };
    const promoted = await api.promoteToAdmin('CONTACTO@CLUBBARRIO.ORG');

    assert.equal(promoted.id, instUuid);
    assert.equal(promoted.tipo, 'moderador');
    assert.equal(promoted.rol, 'moderador');
    assert.equal(promoted.isVerified, true);
    assert.equal(promoted.estadoAlta, 'aprobada');
    assert.equal(dbUsers[instUuid].tipo, 'moderador');
    assert.equal(dbUsers[instUuid].rol, 'moderador');
    assert.equal(dbUsers[instUuid].entidad_tipo, null);
    assert.equal(dbUsers[instUuid].cuit, null);
    assert.equal(dbUsers[instUuid].legal_representative, null);
    assert.equal(dbUsers[instUuid].contacto_institucional, null);
    assert.equal(dbUsers[instUuid].documento_cuit_url, null);
    assert.equal(dbUsers[instUuid].documento_personeria_url, null);

    // Must no longer appear in institutional queries
    const institutions = await api.getInstitutions();
    assert.equal(institutions.some((i) => i.id === instUuid), false);

    // Non-existent account fails cleanly
    await assert.rejects(
      () => api.promoteToAdmin('usuario_inexistente@club65.com'),
      /No se encontró ninguna cuenta activa/
    );

    // Formerly pending institution can now log in directly as exclusive moderador
    await api.logout();
    const loggedIn = await api.login('club_barrio', 'instpass');
    assert.equal(loggedIn.id, instUuid);
    assert.equal(loggedIn.tipo, 'moderador');
    assert.equal(loggedIn.rol, 'moderador');
    assert.equal(loggedIn.isVerified, true);
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    Object.assign(supabase.auth, originalAuth);
    globalThis.fetch = originalFetch;
  }
});

test('canViewerBlockOrPrivateChat hides block and private chat only for admin/moderator profiles', () => {
  assert.equal(canViewerBlockOrPrivateChat(null), false);
  assert.equal(canViewerBlockOrPrivateChat({ id: 'a1', tipo: 'moderador', rol: 'moderador' }), false);
  assert.equal(canViewerBlockOrPrivateChat({ id: 'a2', tipo: 'admin', rol: 'admin' }), false);
  assert.equal(canViewerBlockOrPrivateChat({ id: 'a3', rol: 'administrador' }), false);

  assert.equal(canViewerBlockOrPrivateChat({ id: 'p1', tipo: 'personal', rol: 'personal' }), true);
  assert.equal(canViewerBlockOrPrivateChat({ id: 'i1', tipo: 'institucional', rol: 'institucional' }), true);
});

