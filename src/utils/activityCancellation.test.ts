import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isActivitySuspendedByAdmin,
  isActivityCancelledByOrganizer,
  getSuspensionReasonText,
  hasMisActividadesSuspensionAlert,
  hasAgendaCancellationAlert,
  filterAgendaActivities,
  filterAndSortRecentChats,
  filterCarteleraActivities,
  isActCancelled,
  buildCancelledGroupNoticeMessage,
  extractCancelledGroupNoticesFromNotifications,
  removeCancelledGroupNoticeFromNotifications,
  filterChatsAfterActivityCancellation,
  filterActivitiesForBajaSection,
  resolveBajaAdminDisplay
} from './chatLogic';
import { supabase } from '../supabaseClient';
import { api, invalidateApiCaches } from '../api';

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

function createSupabaseMock(handlers: {
  onQuery: (log: QueryLog) => Promise<{ data: any; error: any }> | { data: any; error: any };
}) {
  const logs: QueryLog[] = [];

  const mockFrom = (table: string) => {
    const state: QueryLog = { table, op: 'select', filters: [] };

    const builder: any = {
      select(_cols?: string) {
        return builder;
      },
      insert(payload: any) {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      upsert(payload: any) {
        state.op = 'upsert';
        state.payload = payload;
        return builder;
      },
      update(payload: any) {
        state.op = 'update';
        state.payload = payload;
        return builder;
      },
      delete() {
        state.op = 'delete';
        return builder;
      },
      eq(col: string, val: any) {
        state.filters.push({ method: 'eq', col, val });
        return builder;
      },
      neq(col: string, val: any) {
        state.filters.push({ method: 'neq', col, val });
        return builder;
      },
      in(col: string, val: any) {
        state.filters.push({ method: 'in', col, val });
        return builder;
      },
      or(expr: string) {
        state.filters.push({ method: 'or', col: 'or', val: expr });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        logs.push(state);
        return Promise.resolve(handlers.onQuery(state));
      },
      single() {
        logs.push(state);
        return Promise.resolve(handlers.onQuery(state));
      },
      then(resolveFn: any, rejectFn: any) {
        logs.push(state);
        return Promise.resolve(handlers.onQuery(state)).then(resolveFn, rejectFn);
      }
    };

    return builder;
  };

  return { mockFrom, logs };
}

test('isActivitySuspendedByAdmin and isActivityCancelledByOrganizer detect cancellation states accurately', () => {
  const adminSusp = { id: 1, proposalStatus: 'baja_forzada', isApproved: false };
  const orgCanc = { id: 2, proposalStatus: 'cancelada_organizador', isApproved: false };
  const active = { id: 3, proposalStatus: 'aprobada', isApproved: true };
  const pending = { id: 4, proposalStatus: 'pendiente', isApproved: false };

  assert.equal(isActivitySuspendedByAdmin(adminSusp), true);
  assert.equal(isActivityCancelledByOrganizer(adminSusp), false);
  assert.equal(isActCancelled(adminSusp), true);

  assert.equal(isActivitySuspendedByAdmin(orgCanc), false);
  assert.equal(isActivityCancelledByOrganizer(orgCanc), true);
  assert.equal(isActCancelled(orgCanc), true);

  assert.equal(isActivitySuspendedByAdmin(active), false);
  assert.equal(isActivityCancelledByOrganizer(active), false);
  assert.equal(isActCancelled(active), false);

  assert.equal(isActivitySuspendedByAdmin(pending), false);
  assert.equal(isActivityCancelledByOrganizer(pending), false);
});

test('getSuspensionReasonText returns exact reason from activity or bajasList', () => {
  const actWithReason = { id: 101, bajaReason: 'Falta de habilitación del espacio' };
  assert.equal(getSuspensionReasonText(actWithReason, []), 'Falta de habilitación del espacio');

  const actWithDash = { id: 102, bajaReason: '-' };
  const bajas = [{ activityId: 102, reason: 'Motivo registrado en tabla bajas' }];
  assert.equal(getSuspensionReasonText(actWithDash, bajas), 'Motivo registrado en tabla bajas');

  const actWithoutReason = { id: 103, motivo_baja: 'Suspensión preventiva por obras' };
  assert.equal(getSuspensionReasonText(actWithoutReason, []), 'Suspensión preventiva por obras');
});

test('hasMisActividadesSuspensionAlert triggers dot only for owner of admin-suspended activity until seen', () => {
  const personalOwner = { id: 'usr_org', usuario: 'maria', apodo: 'María', tipo: 'personal' };
  const instOwner = { id: 'usr_inst', usuario: 'clubsol', apodo: 'Club Sol', tipo: 'institucional' };
  const otherUser = { id: 'usr_other', usuario: 'pepe', apodo: 'Pepe', tipo: 'personal' };

  const activities = [
    { id: 10, organizerId: 'usr_org', proposalStatus: 'baja_forzada', isApproved: false },
    { id: 11, organizerId: 'usr_inst', isInstitutional: true, proposalStatus: 'baja_forzada', isApproved: false },
    { id: 12, organizerId: 'usr_org', proposalStatus: 'cancelada_organizador', isApproved: false },
    { id: 13, organizerId: 'usr_org', proposalStatus: 'aprobada', isApproved: true }
  ];

  // Unseen alert dot appears for both personal and institutional owners
  assert.equal(hasMisActividadesSuspensionAlert(activities, personalOwner, []), true);
  assert.equal(hasMisActividadesSuspensionAlert(activities, instOwner, []), true);
  assert.equal(hasMisActividadesSuspensionAlert(activities, otherUser, []), false);

  // Leaving "Mis actividades" marks 10/11 as seen -> dot disappears
  assert.equal(hasMisActividadesSuspensionAlert(activities, personalOwner, [10]), false);
  assert.equal(hasMisActividadesSuspensionAlert(activities, instOwner, [11]), false);

  // Organizer self-cancellation does NOT trigger suspension alert dot in Mis actividades
  assert.equal(hasMisActividadesSuspensionAlert([activities[2]], personalOwner, []), false);
});

test('hasAgendaCancellationAlert and filterAgendaActivities handle both admin suspension and organizer cancellation for enrolled users', () => {
  const organizer = { id: 'usr_org', usuario: 'org1', apodo: 'Org Uno', tipo: 'personal' };
  const enrolledUser = { id: 'usr_vec', usuario: 'juan', apodo: 'Juancho', tipo: 'personal', agenda: [21] };
  const nonEnrolledUser = { id: 'usr_ext', usuario: 'lucia', apodo: 'Lucia', tipo: 'personal' };

  const adminSuspendedAct = {
    id: 20,
    title: 'Taller Suspendido',
    organizerId: 'usr_org',
    isApproved: false,
    proposalStatus: 'baja_forzada',
    enrolledUsernames: ['Juancho'],
    schedule: '2099-05-01 10:00'
  };

  const orgCancelledInstAct = {
    id: 21,
    title: 'Coro Cancelado',
    organizerId: 'usr_inst',
    isInstitutional: true,
    isApproved: false,
    proposalStatus: 'cancelada_organizador',
    enrolledUsernames: ['usr_vec'],
    schedule: '2099-05-02 15:00'
  };

  const unapprovedPendingAct = {
    id: 22,
    title: 'Propuesta Pendiente',
    organizerId: 'usr_org',
    isApproved: false,
    proposalStatus: 'pendiente',
    enrolledUsernames: ['Juancho'],
    schedule: '2099-05-03 10:00'
  };

  // Both admin-suspended and organizer-cancelled activities trigger Mi Agenda dot for enrolled user
  assert.equal(hasAgendaCancellationAlert([adminSuspendedAct], enrolledUser, []), true);
  assert.equal(hasAgendaCancellationAlert([orgCancelledInstAct], enrolledUser, []), true);

  // Leaving Mi Agenda marks them seen -> dot disappears, while card stays in Mi Agenda until dismissed
  assert.equal(hasAgendaCancellationAlert([adminSuspendedAct, orgCancelledInstAct], enrolledUser, [20, 21]), false);
  const agendaCardsAfterSeen = filterAgendaActivities([adminSuspendedAct, orgCancelledInstAct, unapprovedPendingAct], enrolledUser, []);
  assert.deepEqual(agendaCardsAfterSeen.map(a => a.id), [20, 21]);

  // Dismissing (X) removes the card from Mi Agenda
  const agendaCardsAfterDismiss = filterAgendaActivities([adminSuspendedAct, orgCancelledInstAct], enrolledUser, [20]);
  assert.deepEqual(agendaCardsAfterDismiss.map(a => a.id), [21]);

  // Non-enrolled users and non-enrolled organizers do not get alerts or cancelled cards in Mi Agenda
  assert.equal(hasAgendaCancellationAlert([adminSuspendedAct, orgCancelledInstAct], nonEnrolledUser, []), false);
  assert.deepEqual(filterAgendaActivities([adminSuspendedAct], organizer, []), []);
});

test('filterAndSortRecentChats excludes chats linked to cancelled activities', () => {
  const user = { id: 'usr_vec', usuario: 'juan', apodo: 'Juancho', tipo: 'personal' };
  const activities = [
    { id: 30, title: 'Yoga', isApproved: false, proposalStatus: 'baja_forzada', organizerId: 'usr_org', enrolledUsernames: ['Juancho'] },
    { id: 31, title: 'Ajedrez', isApproved: false, proposalStatus: 'cancelada_organizador', organizerId: 'usr_org', enrolledUsernames: ['Juancho'] },
    { id: 32, title: 'Lectura', isApproved: true, proposalStatus: 'aprobada', organizerId: 'usr_org', enrolledUsernames: ['Juancho'] }
  ];
  const chats = [
    { id: 'c1', type: 'grupal', activityId: 30, title: 'Grupo: Yoga', participants: ['Juancho'], messages: [] },
    { id: 'c2', type: 'grupal', activityId: 31, title: 'Grupo: Ajedrez', participants: ['Juancho'], messages: [] },
    { id: 'c3', type: 'grupal', activityId: 32, title: 'Grupo: Lectura', participants: ['Juancho'], messages: [] }
  ];

  const visible = filterAndSortRecentChats(chats, user, activities);
  assert.deepEqual(visible.map(c => c.id), ['c3']);
});

test('isActCancelled and filterCarteleraActivities exclude any activity with estado==="baja_forzada" or fecha_baja!==null', () => {
  const byEstadoOnly = { id: 40, title: 'Estado Baja', isApproved: true, estado: 'baja_forzada', fecha_baja: null, schedule: '2099-06-01 10:00' };
  const byFechaOnly = { id: 41, title: 'Fecha Baja', isApproved: true, estado: 'aprobada', fecha_baja: '2026-11-13T18:00:00.000Z', schedule: '2099-06-02 10:00' };
  const activeAct = { id: 42, title: 'Vigente', isApproved: true, estado: 'aprobada', proposalStatus: 'aprobada', fecha_baja: null, schedule: '2099-06-03 10:00' };

  assert.equal(isActCancelled(byEstadoOnly), true);
  assert.equal(isActCancelled(byFechaOnly), true);
  assert.equal(isActCancelled(activeAct), false);

  const cartelera = filterCarteleraActivities([byEstadoOnly, byFechaOnly, activeAct]);
  assert.deepEqual(cartelera.map(a => a.id), [42]);
});

test('api.darDeBajaActividad, api.forceCancelActivity & api.deleteActivity persist unified schema to Supabase activities and bajas', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalAuth = { ...supabase.auth };
  const originalFetch = globalThis.fetch;

  const sessionAdminUuid = '00000000-0000-4000-8000-000000000055';
  const sessionOrgUuid = '00000000-0000-4000-8000-000000000056';
  let currentAuthUserId = sessionAdminUuid;

  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: currentAuthUserId } } }
  });

  const { mockFrom, logs } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users' && q.op === 'select') {
        if (currentAuthUserId === sessionOrgUuid) {
          return { data: { id: sessionOrgUuid, usuario: 'ana_org', apodo: 'Ana', tipo: 'personal', rol: 'personal' }, error: null };
        }
        return { data: { id: sessionAdminUuid, usuario: 'admin_club', apodo: 'Admin Club', tipo: 'moderador', rol: 'moderador' }, error: null };
      }
      if (q.table === 'activities' && q.op === 'select') {
        return { data: { id: 55, title: 'Caminata', organizer: 'Ana', enrolled_usernames: ['Beto'] }, error: null };
      }
      if (q.table === 'activities' && q.op === 'update') {
        return { data: { id: 55, title: 'Caminata', proposal_status: 'baja_forzada', estado: 'baja_forzada' }, error: null };
      }
      if (q.table === 'bajas') {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // 1. Admin force cancel
    currentAuthUserId = sessionAdminUuid;
    const res = await api.forceCancelActivity(55, 'Alerta meteorológica', 'admin_club');
    assert.equal(res.proposalStatus, 'baja_forzada');
    assert.equal(res.isApproved, false);
    assert.equal(res.bajaReason, 'Alerta meteorológica');

    const actUpdate = logs.find(l => l.table === 'activities' && l.op === 'update');
    assert.ok(actUpdate, 'Expected Supabase activities update');
    assert.equal(actUpdate!.payload.proposal_status, 'baja_forzada');
    assert.equal(actUpdate!.payload.estado, 'baja_forzada');
    assert.equal(actUpdate!.payload.motivo_baja, 'Alerta meteorológica');
    assert.equal(actUpdate!.payload.feedback_admin, 'Alerta meteorológica');
    assert.match(String(actUpdate!.payload.fecha_baja), /^\d{4}-\d{2}-\d{2}T/, 'fecha_baja must be ISO-8601 for Postgres timestamptz');
    assert.equal('baja_forzada' in actUpdate!.payload, false, 'Must NOT send nonexistent baja_forzada column to Supabase');

    const bajaInsert = logs.find(l => l.table === 'bajas' && l.op === 'insert');
    assert.ok(bajaInsert, 'Expected Supabase bajas insert');
    assert.equal(bajaInsert!.payload.activity_id, 55);
    assert.equal(bajaInsert!.payload.reason, 'Alerta meteorológica');

    // 2. Organizer cancellation via darDeBajaActividad with default reason
    logs.length = 0;
    currentAuthUserId = sessionOrgUuid;
    const orgRes = await api.darDeBajaActividad(56, undefined, { id: sessionOrgUuid, usuario: 'ana_org', apodo: 'Ana', tipo: 'personal' });
    assert.equal(orgRes.isApproved, false);
    assert.equal(orgRes.estado, 'baja_forzada');
    assert.equal(orgRes.motivo_baja, 'Cancelada por el organizador');

    const orgUpdate = logs.find(l => l.table === 'activities' && l.op === 'update');
    assert.ok(orgUpdate, 'Expected Supabase activities update for organizer cancel');
    assert.equal(orgUpdate!.payload.is_approved, false);
    assert.equal(orgUpdate!.payload.estado, 'baja_forzada');
    assert.equal(orgUpdate!.payload.proposal_status, 'cancelada_organizador');
    assert.equal(orgUpdate!.payload.motivo_baja, 'Cancelada por el organizador');
    assert.equal(orgUpdate!.payload.feedback_admin, 'Cancelada por el organizador');
    assert.equal(orgUpdate!.payload.admin_baja_id, sessionOrgUuid);
    assert.match(String(orgUpdate!.payload.fecha_baja), /^\d{4}-\d{2}-\d{2}T/);

    const orgBajaInsert = logs.find(l => l.table === 'bajas' && l.op === 'insert');
    assert.ok(orgBajaInsert, 'Expected Supabase bajas insert on organizer cancellation');
    assert.equal(orgBajaInsert!.payload.activity_id, 56);
    assert.equal(orgBajaInsert!.payload.reason, 'Cancelada por el organizador');
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    Object.assign(supabase.auth, originalAuth);
    globalThis.fetch = originalFetch;
  }
});

test('api.getActivities preserves baja_forzada and cancelada_organizador even on institutional activities', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalFetch = globalThis.fetch;

  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'activities') {
        return {
          data: [
            {
              id: 71,
              title: 'Taller Inst Suspendido',
              organizer_id: 'usr_inst_1',
              is_institutional: true,
              is_approved: false,
              proposal_status: 'baja_forzada',
              estado: 'baja_forzada',
              motivo_baja: 'Edificio en refacción',
              fecha_baja: '13/11/2026 10:00 hs',
              admin_baja_id: 'mod1'
            },
            {
              id: 72,
              title: 'Taller Inst Cancelado Por Org',
              organizer_id: 'institucional',
              is_institutional: true,
              is_approved: false,
              proposal_status: 'cancelada_organizador',
              estado: 'cancelada_organizador'
            }
          ],
          error: null
        };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    const acts = await api.getActivities();
    const susp = acts.find(a => a.id === 71);
    const canc = acts.find(a => a.id === 72);

    assert.ok(susp);
    assert.equal(susp!.isApproved, false);
    assert.equal(susp!.proposalStatus, 'baja_forzada');
    assert.equal(susp!.baja_forzada, true);
    assert.equal(susp!.bajaReason, 'Edificio en refacción');

    assert.ok(canc);
    assert.equal(canc!.isApproved, false);
    assert.equal(canc!.proposalStatus, 'cancelada_organizador');
    assert.equal(canc!.canceladaPorOrganizador, true);
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    globalThis.fetch = originalFetch;
  }
});

test('api.getUserActivityAlertsState and api.markUserActivityAlertInSupabase persist seen & dismissed markers in Supabase users.notifications', async () => {
  const storage = installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);

  let dbNotifs: any[] = [];
  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users' && q.op === 'select') {
        return { data: { notifications: dbNotifs }, error: null };
      }
      if (q.table === 'users' && q.op === 'update') {
        dbNotifs = q.payload.notifications;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    await api.markUserActivityAlertInSupabase('usr_1', 'seen_suspended_act', [101]);
    await api.markUserActivityAlertInSupabase('usr_1', 'seen_agenda_cancelled', [202]);
    await api.markUserActivityAlertInSupabase('usr_1', 'dismissed_agenda_cancelled', [202]);

    // Simulate logging in on a brand-new device (empty localStorage + empty API memory cache)
    storage.clear();
    invalidateApiCaches();

    const loaded = await api.getUserActivityAlertsState('usr_1');
    assert.deepEqual(loaded.seenSuspendedIds, [101]);
    assert.deepEqual(loaded.seenAgendaCancelledIds, [202]);
    assert.deepEqual(loaded.dismissedAgendaCancelledIds, [202]);
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
  }
});

test('buildCancelledGroupNoticeMessage, extract/remove notices, and filterChatsAfterActivityCancellation work accurately', () => {
  assert.equal(
    buildCancelledGroupNoticeMessage('Grupo: Taller de Pintura'),
    'Ya no formas parte del grupo Taller de Pintura porque la actividad fue cancelada.'
  );
  assert.equal(
    buildCancelledGroupNoticeMessage('Caminata Matinal'),
    'Ya no formas parte del grupo Caminata Matinal porque la actividad fue cancelada.'
  );

  const notifs = [
    { id: 'cr_1', type: 'chat_read', chatId: 'c1', readAt: 1000 },
    {
      id: 'cnotif_88_1',
      type: 'cancelled_group_notice',
      activityId: 88,
      activityTitle: 'Grupo: Yoga al Sol',
      message: 'old wording',
      date: '13/11/2026',
      participants: ['usr_vec']
    }
  ];

  const extracted = extractCancelledGroupNoticesFromNotifications(notifs);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].id, 'cnotif_88_1');
  assert.equal(extracted[0].activityTitle, 'Yoga al Sol');
  assert.equal(
    extracted[0].message,
    'Ya no formas parte del grupo Yoga al Sol porque la actividad fue cancelada.'
  );

  const remaining = removeCancelledGroupNoticeFromNotifications(notifs, 'cnotif_88_1');
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].type, 'chat_read');
  assert.deepEqual(extractCancelledGroupNoticesFromNotifications(remaining), []);

  const chats = [
    { id: 'uuid-1', type: 'grupal', activityId: 88, title: 'Grupo: Yoga al Sol' },
    { id: 'uuid-2', type: 'grupal', activityId: 99, title: 'Grupo: Lectura' },
    { id: 'uuid-3', type: 'privado', title: 'Ana' }
  ];
  const afterCancel = filterChatsAfterActivityCancellation(chats, 88, 'Yoga al Sol');
  assert.deepEqual(afterCancel.map(c => c.id), ['uuid-2', 'uuid-3']);
});

test('api.darDeBajaActividad deletes associated group from Supabase chats/chat_participants and persists/dismisses notice in users.notifications', async () => {
  const storage = installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalAuth = { ...supabase.auth };
  const originalFetch = globalThis.fetch;
  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });

  const adminUuid = '00000000-0000-4000-8000-000000000771';
  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: adminUuid } } }
  });

  let dbChats = [
    { id: 'chat-uuid-777', nombre: 'Grupo: Taller Teatro', tipo: 'grupo_actividad', actividad_id: 777, creador_id: 'usr_org' }
  ];
  let dbChatParts = [
    { id: 'cp-1', chat_id: 'chat-uuid-777', user_id: 'usr_org' },
    { id: 'cp-2', chat_id: 'chat-uuid-777', user_id: 'usr_part1' }
  ];
  const dbUsers: Record<string, any> = {
    usr_org: { id: 'usr_org', usuario: 'org_teatro', apodo: 'Org Teatro', nombre: 'Org Teatro', notifications: [] },
    usr_part1: { id: 'usr_part1', usuario: 'vecino1', apodo: 'Vecino Uno', nombre: 'Vecino Uno', notifications: [] },
    [adminUuid]: { id: adminUuid, usuario: 'admin1', apodo: 'Admin', nombre: 'Admin', tipo: 'moderador', rol: 'moderador', notifications: [] }
  };

  const { mockFrom, logs } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'activities' && q.op === 'select') {
        return {
          data: {
            id: 777,
            title: 'Taller Teatro',
            organizer: 'Org Teatro',
            organizer_id: 'usr_org',
            enrolled_usernames: ['Vecino Uno']
          },
          error: null
        };
      }
      if (q.table === 'activities' && q.op === 'update') {
        return { data: { id: 777, title: 'Taller Teatro', estado: 'baja_forzada' }, error: null };
      }
      if (q.table === 'chats' && q.op === 'select') {
        return { data: dbChats, error: null };
      }
      if (q.table === 'chats' && q.op === 'delete') {
        const inFilter = q.filters.find(f => f.method === 'in' && f.col === 'id');
        if (inFilter) {
          dbChats = dbChats.filter(c => !inFilter.val.includes(String(c.id)));
        }
        return { data: [], error: null };
      }
      if (q.table === 'chat_participants' && q.op === 'select') {
        const inFilter = q.filters.find(f => f.method === 'in' && f.col === 'chat_id');
        const rows = inFilter ? dbChatParts.filter(p => inFilter.val.includes(String(p.chat_id))) : dbChatParts;
        return { data: rows, error: null };
      }
      if (q.table === 'chat_participants' && q.op === 'delete') {
        const inFilter = q.filters.find(f => f.method === 'in' && f.col === 'chat_id');
        if (inFilter) {
          dbChatParts = dbChatParts.filter(p => !inFilter.val.includes(String(p.chat_id)));
        }
        return { data: [], error: null };
      }
      if (q.table === 'users' && q.op === 'select') {
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        if (eqId) {
          return { data: dbUsers[eqId.val] || null, error: null };
        }
        return { data: Object.values(dbUsers), error: null };
      }
      if (q.table === 'users' && q.op === 'update') {
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        if (eqId && dbUsers[eqId.val]) {
          dbUsers[eqId.val].notifications = q.payload.notifications;
        }
        return { data: null, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    await api.darDeBajaActividad(777, 'Suspensión administrativa', {
      id: adminUuid,
      usuario: 'admin1',
      apodo: 'Admin',
      tipo: 'moderador'
    });

    assert.equal(dbChats.length, 0, 'Associated group chat must be deleted from Supabase chats');
    assert.equal(dbChatParts.length, 0, 'Associated chat_participants must be deleted from Supabase');
    assert.ok(logs.some(l => l.table === 'chats' && l.op === 'delete'));
    assert.ok(logs.some(l => l.table === 'chat_participants' && l.op === 'delete'));

    // Participant and organizer received the notice; uninvolved admin did not
    assert.equal(dbUsers[adminUuid].notifications.length, 0);
    assert.equal(dbUsers.usr_part1.notifications.length, 1);
    assert.equal(dbUsers.usr_org.notifications.length, 1);
    assert.equal(
      dbUsers.usr_part1.notifications[0].message,
      'Ya no formas parte del grupo Taller Teatro porque la actividad fue cancelada.'
    );

    // Simulate participant loading on another device (empty cache/storage)
    storage.clear();
    invalidateApiCaches();
    const notices = await api.getCancelledGroupNotices(dbUsers.usr_part1, true);
    assert.equal(notices.length, 1);
    assert.equal(
      notices[0].message,
      'Ya no formas parte del grupo Taller Teatro porque la actividad fue cancelada.'
    );

    // Dismissing via X removes it permanently from Supabase users.notifications
    await api.dismissCancelledGroupNotice(notices[0].id, 'usr_part1');
    storage.clear();
    invalidateApiCaches();
    const afterDismiss = await api.getCancelledGroupNotices(dbUsers.usr_part1, true);
    assert.deepEqual(afterDismiss, []);
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    Object.assign(supabase.auth, originalAuth);
    globalThis.fetch = originalFetch;
  }
});

test('filterActivitiesForBajaSection displays only active Cartelera activities and excludes past, unapproved, and cancelled activities', () => {
  const refNow = new Date('2026-11-14T19:45:00-03:00');

  const activities = [
    {
      id: 1,
      title: 'Finalizada ayer',
      isApproved: true,
      proposalStatus: 'aprobada',
      estado: 'aprobada',
      isRecurrent: false,
      schedule: '12/11/2026 a las 10:30 h hasta las 11:30 h',
      startDate: '2026-11-12',
      endDate: '2026-11-12',
      endTime: '11:30',
      fecha_baja: null
    },
    {
      id: 2,
      title: 'Vigente futura',
      isApproved: true,
      proposalStatus: 'aprobada',
      estado: 'aprobada',
      isRecurrent: false,
      schedule: '22/11/2026 a las 10:30 h hasta las 19:00 h',
      startDate: '2026-11-22',
      endDate: '2026-11-22',
      endTime: '19:00',
      fecha_baja: null
    },
    {
      id: 3,
      title: 'Varios días (aún vigente hasta último día)',
      isApproved: true,
      proposalStatus: 'aprobada',
      estado: 'aprobada',
      isRecurrent: false,
      schedule: '10/11/2026 a las 10:00 h hasta 18/11/2026 a las 18:00 h',
      startDate: '2026-11-10',
      endDate: '2026-11-18',
      endTime: '18:00',
      fecha_baja: null
    },
    {
      id: 4,
      title: 'Varios días ya finalizada',
      isApproved: true,
      proposalStatus: 'aprobada',
      estado: 'aprobada',
      isRecurrent: false,
      schedule: '05/11/2026 a las 10:00 h hasta 13/11/2026 a las 18:00 h',
      startDate: '2026-11-05',
      endDate: '2026-11-13',
      endTime: '18:00',
      fecha_baja: null
    },
    {
      id: 5,
      title: 'Recurrente 2 encuentros ya finalizada',
      isApproved: true,
      proposalStatus: 'aprobada',
      estado: 'aprobada',
      isRecurrent: true,
      firstEncounterDate: '2026-11-10',
      schedule: 'Semanal (Martes, Miércoles) • 11:30 a 13:30 h • 2 encuentros',
      cantidadEventos: 2,
      diasSemana: ['Martes', 'Miércoles'],
      horaIni: '11:30',
      horaFin: '13:30'
    },
    {
      id: 6,
      title: 'Recurrente vigente (primer encuentro pasó, quedan encuentros)',
      isApproved: true,
      proposalStatus: 'aprobada',
      estado: 'aprobada',
      isRecurrent: true,
      firstEncounterDate: '2026-11-06',
      schedule: 'Semanal (Lunes, Jueves, Miércoles, Viernes, Sábado, Domingo, Martes) • 21:43 a 21:47 h • 12 encuentros',
      cantidadEventos: 12,
      horaIni: '21:43',
      horaFin: '21:47'
    },
    {
      id: 7,
      title: 'Propuesta pendiente futura',
      isApproved: false,
      proposalStatus: 'pendiente',
      estado: 'pendiente',
      isRecurrent: false,
      schedule: '25/11/2026 a las 10:00 h hasta las 12:00 h',
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      endTime: '12:00'
    },
    {
      id: 8,
      title: 'Ya dada de baja futura',
      isApproved: false,
      proposalStatus: 'baja_forzada',
      estado: 'baja_forzada',
      isRecurrent: false,
      schedule: '28/11/2026 a las 10:00 h hasta las 12:00 h',
      startDate: '2026-11-28',
      endDate: '2026-11-28',
      endTime: '12:00',
      fecha_baja: '2026-11-14T12:00:00.000Z'
    },
    {
      id: 9,
      title: 'Institucional rechazada/cancelada por org',
      isInstitutional: true,
      isApproved: false,
      proposalStatus: 'cancelada_organizador',
      estado: 'baja_forzada',
      isRecurrent: false,
      schedule: '29/11/2026 a las 10:00 h hasta las 12:00 h',
      startDate: '2026-11-29',
      endDate: '2026-11-29',
      endTime: '12:00',
      fecha_baja: '2026-11-14T15:00:00.000Z'
    }
  ];

  const eligible = filterActivitiesForBajaSection(activities, refNow);
  assert.deepEqual(eligible.map(a => a.id), [2, 3, 6]);
});

test('resolveBajaAdminDisplay returns "-" when cancelled by organizer and admin username when cancelled by admin', () => {
  const activities = [
    {
      id: 10,
      title: 'Taller de Tejido',
      organizer: 'Neri',
      organizerId: 'usr_neri',
      proposalStatus: 'cancelada_organizador',
      estado: 'baja_forzada',
      canceladaPorOrganizador: true,
      admin_baja_id: 'usr_neri'
    },
    {
      id: 11,
      title: 'Caminata Norte',
      organizer: 'Marito',
      organizerId: 'usr_marito',
      proposalStatus: 'baja_forzada',
      estado: 'baja_forzada',
      baja_forzada: true,
      admin_baja_id: 'usr_admin'
    },
    {
      id: 12,
      title: 'Clase Propia de Admin',
      organizer: 'admin_club65',
      organizerId: 'usr_admin',
      proposalStatus: 'baja_forzada',
      estado: 'baja_forzada',
      baja_forzada: true,
      admin_baja_id: 'usr_admin'
    }
  ];

  // Legacy organizer-cancelled baja row that had the organizer name stored in adminUsername
  assert.equal(
    resolveBajaAdminDisplay(
      { id: 'b1', activityId: 10, organizer: 'Neri', adminUsername: 'Neri' },
      activities
    ),
    '-'
  );

  // Explicit "-" persisted
  assert.equal(
    resolveBajaAdminDisplay(
      { id: 'b2', activityId: 999, organizer: 'Neri', adminUsername: '-' },
      activities
    ),
    '-'
  );

  // Admin forced cancellation preserves admin username
  assert.equal(
    resolveBajaAdminDisplay(
      { id: 'b3', activityId: 11, organizer: 'Marito', adminUsername: 'admin_club65' },
      activities
    ),
    'admin_club65'
  );

  // Admin forced cancellation on admin's own activity still preserves admin username
  assert.equal(
    resolveBajaAdminDisplay(
      { id: 'b4', activityId: 12, organizer: 'admin_club65', adminUsername: '@admin_club65' },
      activities
    ),
    'admin_club65'
  );
});


