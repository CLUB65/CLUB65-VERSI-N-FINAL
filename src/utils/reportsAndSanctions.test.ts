import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  safeParseJsonText,
  isValidUuid,
  resolveAuthenticatedReportUuid,
  requireSupabaseSessionUserId,
  resolveReportActorFromSources,
  buildSupabaseReportInsertPayload,
  buildSupabaseReportFallbackPayloads,
  buildSupabaseReportResolvePayload,
  mapSupabaseReportRow,
  ADMIN_REMOVED_MESSAGE_TEXT,
  MODERATOR_REMOVED_MESSAGE_TEXT,
  ADMIN_REMOVED_REVIEW_TEXT,
  ADMIN_REMOVED_REVIEW_MEDIA_TEXT,
  RETIRED_REVIEW_MEDIA_MARKER,
  isReviewRetired,
  isRetiredReviewMediaItem,
  replaceMediaUrlWithRetiredMarker,
  resolveReviewDisplay,
  resolveRemovedMessageDisplay
} from './reportsAndSanctions.ts';
import { api, supabase, setStoredUserId, clearBrowserSessionKeys, invalidateApiCaches } from '../api.ts';

test('safeParseJsonText rejects HTML doctype responses without throwing SyntaxError', () => {
  const htmlRes = safeParseJsonText('<!doctype html><html><body>SPA</body></html>', 'text/html');
  assert.equal(htmlRes.isJson, false);
  assert.equal(htmlRes.data, null);

  const upperHtmlRes = safeParseJsonText('  <!DOCTYPE HTML><html></html>', 'text/html; charset=utf-8');
  assert.equal(upperHtmlRes.isJson, false);
  assert.equal(upperHtmlRes.data, null);

  const invalidJson = safeParseJsonText('{broken json', 'application/json');
  assert.equal(invalidJson.isJson, false);
  assert.equal(invalidJson.data, null);

  const validObj = safeParseJsonText('{"success":true,"items":[1,2]}', 'application/json');
  assert.equal(validObj.isJson, true);
  assert.deepEqual(validObj.data, { success: true, items: [1, 2] });
});

test('Supabase reports payload builders and mapper round-trip Spanish schema cleanly', () => {
  const insertPayload = buildSupabaseReportInsertPayload(
    {
      type: 'review_media',
      reviewId: '3b7116b3-2dbb-4354-b090-2b01bb0280c7',
      activityId: 1794008683478,
      reportedUser: '@vecino_ejemplo',
      mediaUrl: 'https://cdn.example.com/photo.jpg',
      reason: 'Contenido inapropiado',
      comment: 'Foto fuera de lugar'
    },
    'Nerina',
    new Date('2026-11-18T12:00:00Z'),
    '550e8400-e29b-41d4-a716-446655440000'
  );

  assert.match(insertPayload.id, /^[0-9a-f-]{36}$/i);
  assert.equal(insertPayload.motivo, 'Contenido inapropiado');
  assert.equal(insertPayload.estado, 'pendiente');
  assert.equal(insertPayload.actividad_id, 1794008683478);

  const resolvePayload = buildSupabaseReportResolvePayload({
    status: 'delete_content',
    action: 'eliminar',
    sanctionReason: 'Contenido inapropiado',
    adminComment: 'Foto retirada de la galería',
    alsoDeletedContent: true,
    resolutionDetail: 'Retiro del contenido reportado de la plataforma',
    resolvedBy: 'admin_club'
  });

  assert.equal(resolvePayload.estado, 'resuelto');

  const mapped = mapSupabaseReportRow({
    ...insertPayload,
    ...resolvePayload,
    creado_el: '2026-11-18T12:00:00Z'
  });

  assert.equal(mapped.type, 'review_media');
  assert.equal(mapped.reviewId, '3b7116b3-2dbb-4354-b090-2b01bb0280c7');
  assert.equal(mapped.activityId, 1794008683478);
  assert.equal(mapped.reportedUser, 'vecino_ejemplo');
  assert.equal(mapped.reporterUser, 'nerina');
  assert.equal(mapped.reason, 'Contenido inapropiado');
  assert.equal(mapped.comment, 'Foto fuera de lugar');
  assert.equal(mapped.status, 'resuelto');
  assert.equal(mapped.resolutionAction, 'delete_content');
  assert.equal(mapped.adminComment, 'Foto retirada de la galería');
  assert.equal(mapped.alsoDeletedContent, true);
  assert.equal(mapped.resolvedBy, 'admin_club');
});

test('buildSupabaseReportInsertPayload enforces authenticated denunciante_id, maps message report columns, and fallbacks never drop denunciante_id', () => {
  assert.throws(
    () =>
      buildSupabaseReportInsertPayload(
        {
          type: 'chat_message',
          chatId: 'chat_123',
          messageId: 'msg_999',
          reportedUser: 'vecino_b',
          reason: 'Suplantación de identidad',
          comment: 'Se hace pasar por otra persona'
        },
        'vecino_a',
        new Date('2026-11-18T12:00:00Z'),
        ''
      ),
    /iniciar sesión/i
  );

  const msgPayload = buildSupabaseReportInsertPayload(
    {
      type: 'chat_message',
      chatId: 'chat_123',
      messageId: 'msg_999',
      messageText: 'Texto ofensivo',
      reportedUser: 'vecino_b',
      reason: 'Contenido sexual',
      comment: 'Comentario explicativo'
    },
    'vecino_a',
    new Date('2026-11-18T12:00:00Z'),
    '660e8400-e29b-41d4-a716-446655440001'
  );

  assert.equal(msgPayload.denunciante_id, '660e8400-e29b-41d4-a716-446655440001');
  assert.equal(msgPayload.mensaje_id, 'msg_999');
  assert.equal(msgPayload.motivo, 'Contenido sexual');
  assert.equal(msgPayload.estado, 'pendiente');
  assert.equal(typeof msgPayload.comentario_denunciante, 'string');
  assert.ok(msgPayload.comentario_denunciante.includes('Comentario explicativo'));

  const fallbacks = buildSupabaseReportFallbackPayloads(msgPayload, [
    'usr_legacy_non_uuid',
    '770e8400-e29b-41d4-a716-446655440002'
  ]);
  assert.ok(fallbacks.length >= 4);
  for (const fb of fallbacks) {
    assert.ok(isValidUuid(fb.denunciante_id), 'Fallback payload must always keep a valid UUID denunciante_id');
    assert.equal(fb.motivo, 'Contenido sexual');
    assert.equal(fb.estado, 'pendiente');
    assert.equal(fb.comentario_denunciante, msgPayload.comentario_denunciante);
  }
  assert.equal(fallbacks[0].denunciante_id, '770e8400-e29b-41d4-a716-446655440002');
  assert.equal(fallbacks[0].mensaje_id, 'msg_999');
  assert.equal(fallbacks[1].denunciante_id, '660e8400-e29b-41d4-a716-446655440001');
  assert.equal(fallbacks[1].mensaje_id, 'msg_999');
});

test('resolveAuthenticatedReportUuid prioritizes real Supabase Auth UUID over custom usr_ text IDs and rejects non-UUIDs', () => {
  assert.equal(isValidUuid('usr_1794008683478_abc12'), false);
  assert.equal(isValidUuid('550e8400-e29b-41d4-a716-446655440000'), true);

  // Even when profileId is a legacy usr_... string, authUserId from supabase.auth.getUser() is selected
  assert.equal(
    resolveAuthenticatedReportUuid({
      authUserId: '550e8400-e29b-41d4-a716-446655440000',
      profileId: 'usr_1794008683478_abc12',
      fallbackUserId: 'usr_1794008683478_abc12'
    }),
    '550e8400-e29b-41d4-a716-446655440000'
  );

  // When only custom usr_... IDs exist and no Auth UUID exists, returns empty string
  assert.equal(
    resolveAuthenticatedReportUuid({
      authUserId: '',
      profileId: 'usr_1794008683478_abc12',
      fallbackUserId: 'usr_1794008683478_abc12'
    }),
    ''
  );

  // buildSupabaseReportInsertPayload blocks non-UUID usr_... IDs before hitting Supabase uuid column
  assert.throws(
    () =>
      buildSupabaseReportInsertPayload(
        {
          type: 'chat_message',
          chatId: 'chat_1',
          messageId: 'msg_1',
          reason: 'Spam'
        },
        'vecino',
        new Date('2026-11-18T12:00:00Z'),
        'usr_1794008683478_abc12'
      ),
    /UUID válido/i
  );
});

test('requireSupabaseSessionUserId exclusively returns session.user.id UUID and rejects null, custom usr_, or invalid IDs', () => {
  assert.equal(
    requireSupabaseSessionUserId({ user: { id: ' 550e8400-e29b-41d4-a716-446655440000 ' } }),
    '550e8400-e29b-41d4-a716-446655440000'
  );

  for (const invalidSession of [
    null,
    undefined,
    {},
    { user: null },
    { user: { id: '' } },
    { user: { id: 'usr_1794008683478_abc12' } },
    { user: { id: 'USR_999' } },
    { user: { id: 'not-a-uuid' } }
  ]) {
    assert.throws(
      () => requireSupabaseSessionUserId(invalidSession as any),
      (err: any) => err?.code === 'AUTH_REQUIRED'
    );
  }
});

test('resolveReportActorFromSources handles Supabase Auth UUIDs, direct public.users UUIDs, legacy usr_ IDs, and unauthenticated guests', () => {
  // 1. Auth session UUID wins over custom usr_ dbUser.id
  const fromSession = resolveReportActorFromSources({
    session: { user: { id: '550e8400-e29b-41d4-a716-446655440000', email: 'auth@club65.ar' } },
    dbUser: { id: 'usr_admin_club65', usuario: 'Administrador', apodo: 'Administrador' }
  });
  assert.equal(fromSession.isAuthenticated, true);
  assert.equal(fromSession.denuncianteUuid, '550e8400-e29b-41d4-a716-446655440000');
  assert.equal(fromSession.legacyUserId, null);
  assert.equal(fromSession.reporterUsername, 'administrador');

  // 2. When Auth session is null (e.g. mailer_autoconfirm=false directUser login), verified public.users UUID is used
  const fromDbUuid = resolveReportActorFromSources({
    session: null,
    authUser: null,
    dbUser: { id: '58d9efbd-c07c-418b-a29b-4ca670f6091d', usuario: 'marito', apodo: 'Marito' }
  });
  assert.equal(fromDbUuid.isAuthenticated, true);
  assert.equal(fromDbUuid.denuncianteUuid, '58d9efbd-c07c-418b-a29b-4ca670f6091d');
  assert.equal(fromDbUuid.legacyUserId, null);
  assert.equal(fromDbUuid.reporterUsername, 'marito');

  // 3. When Auth session is null and public.users row uses a legacy usr_... ID, user is STILL authenticated with legacyUserId
  const fromLegacy = resolveReportActorFromSources({
    session: null,
    authUser: null,
    dbUser: { id: 'usr_admin_club65', usuario: 'Administrador', apodo: 'Administrador', email: 'club65.info@gmail.com' }
  });
  assert.equal(fromLegacy.isAuthenticated, true);
  assert.equal(fromLegacy.denuncianteUuid, null);
  assert.equal(fromLegacy.legacyUserId, 'usr_admin_club65');
  assert.equal(fromLegacy.actorId, 'usr_admin_club65');
  assert.equal(fromLegacy.reporterUsername, 'administrador');

  // 4. Payload & fallbacks preserve denunciante_id: null + reporterUserId metadata when allowNullableDenuncianteUuid is enabled
  const legacyPayload = buildSupabaseReportInsertPayload(
    {
      type: 'chat_message',
      chatId: 'chat_1',
      messageId: 'msg_legacy_1',
      reportedUser: 'vecino_b',
      reason: 'Spam',
      comment: 'Mensaje spam'
    },
    fromLegacy.reporterUsername,
    new Date('2026-11-18T12:00:00Z'),
    '',
    {
      allowNullableDenuncianteUuid: true,
      legacyReporterUserId: fromLegacy.legacyUserId!
    }
  );
  assert.equal(legacyPayload.denunciante_id, null);
  const mappedLegacy = mapSupabaseReportRow({ ...legacyPayload, creado_el: '2026-11-18T12:00:00Z' });
  assert.equal(mappedLegacy.reporterUser, 'administrador');
  const legacyFallbacks = buildSupabaseReportFallbackPayloads(legacyPayload, []);
  assert.ok(legacyFallbacks.length >= 2);
  for (const fb of legacyFallbacks) {
    assert.equal(fb.denunciante_id, null);
    assert.equal(fb.motivo, 'Spam');
  }

  // 5. Truly unauthenticated visitor
  const guest = resolveReportActorFromSources({ session: null, authUser: null, dbUser: null });
  assert.equal(guest.isAuthenticated, false);
  assert.equal(guest.actorId, '');
});

test('api.createReport succeeds when Supabase Auth session is null but user is logged in via public.users, and blocks guests', async () => {
  const origGetSession = supabase.auth.getSession;
  const origGetUser = (supabase.auth as any).getUser;
  const origFrom = supabase.from;
  const origFetch = globalThis.fetch;
  const origLocalStorage = (globalThis as any).localStorage;

  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k)
  };

  try {
    invalidateApiCaches();
    clearBrowserSessionKeys();

    const dbUsersById: Record<string, any> = {
      '58d9efbd-c07c-418b-a29b-4ca670f6091d': {
        id: '58d9efbd-c07c-418b-a29b-4ca670f6091d',
        usuario: 'marito',
        apodo: 'Marito',
        email: 'marito@example.com',
        tipo: 'personal',
        rol: 'moderador',
        estado_alta: 'aprobada'
      },
      usr_admin_club65: {
        id: 'usr_admin_club65',
        usuario: 'Administrador',
        apodo: 'Administrador',
        email: 'club65.info@gmail.com',
        tipo: 'moderador',
        rol: 'moderador',
        estado_alta: 'aprobada'
      }
    };

    const insertedReports: any[] = [];

    (supabase.auth as any).getSession = async () => ({ data: { session: null }, error: null });
    (supabase.auth as any).getUser = async () => ({ data: { user: null }, error: null });
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: false }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      })) as any;

    (supabase as any).from = (table: string) => {
      if (table === 'users') {
        const filters: Record<string, any> = {};
        const builder: any = {
          select: () => builder,
          eq: (col: string, val: any) => {
            filters[col] = val;
            return builder;
          },
          ilike: (col: string, val: any) => {
            filters[`ilike_${col}`] = val;
            return builder;
          },
          neq: () => builder,
          limit: async () => {
            if (filters.ilike_email) {
              const found = Object.values(dbUsersById).filter(
                (u) => String(u.email || '').toLowerCase() === String(filters.ilike_email).toLowerCase()
              );
              return { data: found, error: null };
            }
            return { data: Object.values(dbUsersById), error: null };
          },
          maybeSingle: async () => ({
            data: filters.id ? dbUsersById[filters.id] || null : null,
            error: null
          })
        };
        return builder;
      }

      if (table === 'reports') {
        return {
          insert: (payload: any) => ({
            select: () => ({
              single: async () => {
                insertedReports.push(payload);
                return { data: { ...payload, creado_el: '2026-11-18T12:00:00Z' }, error: null };
              }
            })
          })
        };
      }

      throw new Error(`Unexpected table query: ${table}`);
    };

    // Case 1: Logged-in user with UUID in public.users even when session is null
    setStoredUserId('58d9efbd-c07c-418b-a29b-4ca670f6091d');
    const uuidRes = await api.createReport({
      type: 'chat_message',
      chatId: 'chat_1',
      messageId: 'msg_1',
      reportedUser: 'vecino_b',
      reason: 'Spam',
      comment: 'Prueba UUID con directUser'
    });
    assert.equal(uuidRes.success, true);
    assert.equal(insertedReports[0].denunciante_id, '58d9efbd-c07c-418b-a29b-4ca670f6091d');
    assert.equal(uuidRes.report.reporterUser, 'marito');

    // Case 2: Logged-in user with legacy usr_ ID in public.users (e.g. Administrador) when session is null
    invalidateApiCaches();
    clearBrowserSessionKeys();
    setStoredUserId('usr_admin_club65');
    const legacyRes = await api.createReport({
      type: 'review_text',
      reviewId: 12,
      activityId: 5,
      reportedUser: 'vecino_b',
      reason: 'Contenido inapropiado',
      comment: 'Prueba usr_admin_club65'
    });
    assert.equal(legacyRes.success, true);
    assert.equal(insertedReports[1].denunciante_id, null);
    assert.equal(legacyRes.report.reporterUser, 'administrador');

    // Case 3: Unauthenticated guest (no session, no stored user, no candidateUserId)
    invalidateApiCaches();
    clearBrowserSessionKeys();
    await assert.rejects(
      () =>
        api.createReport({
          type: 'chat_message',
          chatId: 'chat_1',
          messageId: 'msg_2',
          reason: 'Spam'
        }),
      (err: any) => err?.code === 'AUTH_REQUIRED'
    );
  } finally {
    clearBrowserSessionKeys();
    invalidateApiCaches();
    (supabase.auth as any).getSession = origGetSession;
    (supabase.auth as any).getUser = origGetUser;
    (supabase as any).from = origFrom;
    globalThis.fetch = origFetch;
    if (origLocalStorage === undefined) {
      delete (globalThis as any).localStorage;
    } else {
      (globalThis as any).localStorage = origLocalStorage;
    }
  }
});

test('report forms and moderation actions verify caller via resolveVerifiedSupabaseCaller / resolveLoggedInActorId without hardcoded IDs', () => {
  const apiSource = readFileSync(join(process.cwd(), 'src', 'api.ts'), 'utf8');
  const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

  const sliceBetween = (src: string, startMarker: string, endMarker: string) => {
    const startIdx = src.indexOf(startMarker);
    assert.notEqual(startIdx, -1, `Missing marker: ${startMarker}`);
    const endIdx = src.indexOf(endMarker, startIdx + startMarker.length);
    assert.notEqual(endIdx, -1, `Missing end marker after ${startMarker}: ${endMarker}`);
    return src.slice(startIdx, endIdx);
  };

  assert.ok(
    apiSource.includes('async function resolveVerifiedSupabaseCaller(') &&
      apiSource.includes('supabase.auth.getSession()'),
    'api.ts must define resolveVerifiedSupabaseCaller checking supabase.auth.getSession() and public.users'
  );

  const apiBlocks = [
    ['createReport', '  async createReport(', '  async resolveReport('],
    ['resolveReport', '  async resolveReport(', '  async darDeBajaActividad('],
    ['darDeBajaActividad', '  async darDeBajaActividad(', '  async forceCancelActivity('],
    ['approveInstitution', '  async approveInstitution(', '  async rejectInstitution('],
    ['rejectInstitution', '  async rejectInstitution(', '  async verifyInstitution('],
    ['verifyInstitution', '  async verifyInstitution(', '  async promoteToAdmin('],
    ['promoteToAdmin', '  async promoteToAdmin(', '  async getSanctions('],
    ['addSanction', '  async addSanction(', '  async removeSanction('],
    ['removeSanction', '  async removeSanction(', '  async getBannedUsers(']
  ] as const;

  for (const [name, startMarker, endMarker] of apiBlocks) {
    const block = sliceBetween(apiSource, startMarker, endMarker);
    assert.ok(
      block.includes('resolveVerifiedSupabaseCaller('),
      `api.${name} must authenticate caller via resolveVerifiedSupabaseCaller()`
    );
  }

  const helperBlock = sliceBetween(appSource, '  async function resolveLoggedInActorId(', '  async function openReportModal(');
  assert.ok(
    helperBlock.includes('supabase.auth.getSession()') &&
      helperBlock.includes('currentUser?.id') &&
      helperBlock.includes('api.getMe()'),
    'App.resolveLoggedInActorId must check supabase.auth.getSession() first and fall back to currentUser.id / api.getMe()'
  );

  const appBlocks = [
    ['openReportModal', '  async function openReportModal(', '  async function handleSubmitReport('],
    ['handleSubmitReport', '  async function handleSubmitReport(', '  async function handleDeleteChatMessage('],
    ['handleConfirmReportDecision', '  async function handleConfirmReportDecision(', '  async function handleLiftBan('],
    ['handleLiftBan', '  async function handleLiftBan(', '  async function handleLogin('],
    ['handleDarDeBajaActividad', '  async function handleDarDeBajaActividad(', 'function isUserChatModerator(']
  ] as const;

  for (const [name, startMarker, endMarker] of appBlocks) {
    const block = sliceBetween(appSource, startMarker, endMarker);
    assert.ok(
      block.includes('resolveLoggedInActorId()'),
      `App.${name} must resolve logged-in user via resolveLoggedInActorId()`
    );
  }
});

test('resolveRemovedMessageDisplay preserves exact CLUB65 admin terms-of-use notice and recovers legacy overwritten flags', () => {
  const adminRow = {
    id: 'msg_admin_1',
    is_deleted: true,
    deleted_by_admin: true,
    deleted_by_group_moderator: false,
    text: ADMIN_REMOVED_MESSAGE_TEXT
  };
  assert.deepEqual(resolveRemovedMessageDisplay(adminRow), {
    isDeleted: true,
    deletedByAdmin: true,
    deletedByGroupModerator: false,
    text: 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65'
  });

  // Historical row where backend previously overwrote deleted_by_admin=false & deleted_by_group_moderator=true
  const legacyOverwrittenRow = {
    id: 'msg_1794966076798_i6neu',
    is_deleted: true,
    deleted_by_admin: false,
    deleted_by_group_moderator: true,
    text: 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65'
  };
  assert.deepEqual(resolveRemovedMessageDisplay(legacyOverwrittenRow), {
    isDeleted: true,
    deletedByAdmin: true,
    deletedByGroupModerator: false,
    text: 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65'
  });

  // Regular group moderator removal stays attributed to group moderator
  const modRow = {
    id: 'msg_1794966088445_1bnpq',
    is_deleted: true,
    deleted_by_admin: false,
    deleted_by_group_moderator: true,
    text: MODERATOR_REMOVED_MESSAGE_TEXT
  };
  assert.deepEqual(resolveRemovedMessageDisplay(modRow), {
    isDeleted: true,
    deletedByAdmin: false,
    deletedByGroupModerator: true,
    text: MODERATOR_REMOVED_MESSAGE_TEXT
  });

  // Normal non-deleted message containing the word "retirado" is NOT falsely flagged as deleted
  const normalRow = {
    id: 'msg_normal_1',
    is_deleted: false,
    deleted_by_admin: false,
    deleted_by_group_moderator: false,
    text: 'Me he retirado temprano del taller hoy'
  };
  assert.deepEqual(resolveRemovedMessageDisplay(normalRow), {
    isDeleted: false,
    deletedByAdmin: false,
    deletedByGroupModerator: false,
    text: 'Me he retirado temprano del taller hoy'
  });
});

test('server.ts message delete endpoints honor deletedByAdmin instead of hardcoding deleted_by_admin: false', () => {
  const serverSource = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
  const postIdx = serverSource.indexOf("app.post('/api/chats/:id/messages/:msgId/delete'");
  const delIdx = serverSource.indexOf("app.delete('/api/chats/:id/messages/:msgId'");
  const nextIdx = serverSource.indexOf('// CANCELLED GROUP NOTICES');
  assert.ok(postIdx !== -1 && delIdx !== -1 && nextIdx !== -1);

  const deleteBlock = serverSource.slice(postIdx, nextIdx);
  assert.ok(deleteBlock.includes('req.body?.deletedByAdmin'));
  assert.ok(deleteBlock.includes('deleted_by_admin: isDeletedByAdminAction'));
  assert.ok(deleteBlock.includes('deleted_by_group_moderator: !isDeletedByAdminAction'));
  assert.equal(deleteBlock.includes('deleted_by_admin: false'), false);
});

test('isReviewRetired, resolveReviewDisplay, and replaceMediaUrlWithRetiredMarker preserve reviews and media slots with CLUB65 notices', () => {
  assert.equal(
    ADMIN_REMOVED_REVIEW_TEXT,
    'Esta reseña fue retirada por no cumplir con las condiciones de uso de CLUB65'
  );
  assert.equal(
    ADMIN_REMOVED_REVIEW_MEDIA_TEXT,
    'Este contenido multimedia fue retirado por no cumplir con las condiciones de uso de CLUB65'
  );

  // Supabase row marked retirado_de_la_vista = true
  const retiredDbRow = {
    id: 'rev-1',
    comentario: 'Texto original',
    retirado_de_la_vista: true
  };
  assert.equal(isReviewRetired(retiredDbRow), true);
  assert.deepEqual(resolveReviewDisplay(retiredDbRow), {
    isRetired: true,
    text: 'Esta reseña fue retirada por no cumplir con las condiciones de uso de CLUB65'
  });

  // Legacy row where only commentary was replaced
  const retiredTextRow = {
    id: 'rev-2',
    texto: ADMIN_REMOVED_REVIEW_TEXT,
    retirado_de_la_vista: false
  };
  assert.equal(isReviewRetired(retiredTextRow), true);

  // Normal review is not retired
  const normalRow = {
    id: 'rev-3',
    texto: 'Me retiré contento del encuentro, muy lindo todo.',
    retirado_de_la_vista: false
  };
  assert.equal(isReviewRetired(normalRow), false);
  assert.deepEqual(resolveReviewDisplay(normalRow), {
    isRetired: false,
    text: 'Me retiré contento del encuentro, muy lindo todo.'
  });

  // Replacing reported media replaces ONLY the target item with the retired marker, keeping order and sibling media
  const originalMedia = [
    'https://cdn.example.com/foto1.jpg',
    'https://cdn.example.com/foto_ofensiva.jpg',
    'https://cdn.example.com/video3.mp4'
  ];
  const updatedMedia = replaceMediaUrlWithRetiredMarker(
    originalMedia,
    'https://cdn.example.com/foto_ofensiva.jpg'
  );
  assert.equal(updatedMedia.length, 3);
  assert.equal(updatedMedia[0], 'https://cdn.example.com/foto1.jpg');
  assert.equal(updatedMedia[1], RETIRED_REVIEW_MEDIA_MARKER);
  assert.equal(updatedMedia[2], 'https://cdn.example.com/video3.mp4');
  assert.equal(isRetiredReviewMediaItem(updatedMedia[1]), true);
  assert.equal(isRetiredReviewMediaItem(updatedMedia[0]), false);
});

test('api.ts, db.ts, and App.tsx do not hard-delete reported reviews or media slots on admin retirement', () => {
  const apiSource = readFileSync(join(process.cwd(), 'src', 'api.ts'), 'utf8');
  const apiImportSection = apiSource.slice(0, apiSource.indexOf("from './utils/reportsAndSanctions.ts';"));
  assert.ok(apiImportSection.includes('isRetiredReviewMediaItem'));
  assert.ok(apiImportSection.includes('isReviewRetired'));
  assert.ok(apiImportSection.includes('replaceMediaUrlWithRetiredMarker'));

  const retireBlock = apiSource.slice(
    apiSource.indexOf('  async retireReviewByAdmin('),
    apiSource.indexOf('  async getContacts(')
  );
  assert.equal(retireBlock.includes(".from('reviews').delete()"), false);
  assert.equal(retireBlock.includes(".from('reviews')\n            .delete()"), false);
  assert.ok(retireBlock.includes('retirado_de_la_vista: true'));
  assert.ok(retireBlock.includes('ADMIN_REMOVED_REVIEW_TEXT'));
  assert.ok(retireBlock.includes('replaceMediaUrlWithRetiredMarker'));

  const dbSource = readFileSync(join(process.cwd(), 'src', 'server', 'db.ts'), 'utf8');
  const resolveBlock = dbSource.slice(
    dbSource.indexOf('    // Execute immediate action if requested'),
    dbSource.indexOf('  // INSTITUTION VALIDATION')
  );
  assert.equal(resolveBlock.includes('data.reviews = data.reviews.filter('), false);
  assert.ok(resolveBlock.includes('replaceMediaUrlWithRetiredMarker'));
  assert.ok(resolveBlock.includes('ADMIN_REMOVED_REVIEW_TEXT'));

  const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
  assert.ok(appSource.includes('ADMIN_REMOVED_REVIEW_TEXT'));
  assert.ok(appSource.includes('ADMIN_REMOVED_REVIEW_MEDIA_TEXT'));
  assert.ok(appSource.includes('isRetiredReviewMediaItem('));
  assert.ok(appSource.includes('isReviewRetired('));
});


