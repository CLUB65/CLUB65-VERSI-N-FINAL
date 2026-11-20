import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabase } from '../supabaseClient';
import * as chatService from './chatService';
import { api, invalidateApiCaches } from '../api';
import { chatIdentifierToBigInt, getResolvedChatParticipants } from '../utils/chatLogic';

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
  filters: Array<{ method: string; col: string; val: any }>;
  payload?: any;
}

function createSupabaseMock(handlers: {
  onQuery: (log: QueryLog) => Promise<{ data: any; error: any }> | { data: any; error: any };
}) {
  const logs: QueryLog[] = [];

  const mockFrom = (table: string) => {
    const state: QueryLog = { table, op: 'select', filters: [] };

    const builder: any = {
      select(_cols?: string) {
        if (state.op === 'select') state.op = 'select';
        return builder;
      },
      insert(payload: any) {
        state.op = 'insert';
        state.payload = payload;
        return builder;
      },
      upsert(payload: any, _opts?: any) {
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

test('getUserChats eliminates N+1 pattern: constant query count regardless of chat/activity count', async () => {
  installMemoryLocalStorage();
  const originalFrom = supabase.from.bind(supabase);

  const N = 15;
  const userId = 'usr_test_n1';
  const mockActivities = Array.from({ length: N }, (_, i) => ({
    id: i + 1,
    title: `Taller ${i + 1}`,
    organizer_id: userId,
    enrolled_usernames: ['TestUser']
  }));
  const mockParticipations = Array.from({ length: N }, (_, i) => ({
    chat_id: `chat-uuid-${i + 1}`,
    chats: {
      id: `chat-uuid-${i + 1}`,
      nombre: `Grupo: Taller ${i + 1}`,
      tipo: 'grupo_actividad',
      foto_grupo_url: null,
      creado_el: '2026-11-10T10:00:00.000Z',
      creador_id: userId,
      actividad_id: i + 1
    }
  }));
  const mockAllChatParts = Array.from({ length: N }, (_, i) => ({
    chat_id: `chat-uuid-${i + 1}`,
    user_id: userId,
    users: { id: userId, usuario: 'testuser', apodo: 'TestUser', avatar: '', tipo: 'personal' }
  }));
  const mockMessages = Array.from({ length: N }, (_, i) => ({
    id: `msg_${i + 1}`,
    chat_id: chatIdentifierToBigInt(`chat-uuid-${i + 1}`),
    sender_id: userId,
    sender: 'TestUser',
    avatar: '',
    role: 'Vecino',
    text: `Hola ${i + 1}`,
    time: '10:00',
    created_at: '2026-11-10T10:00:00.000Z',
    is_deleted: false,
    is_pinned: false
  }));

  const { mockFrom, logs } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'chat_participants') {
        const hasInFilter = q.filters.some(f => f.method === 'in' && f.col === 'chat_id');
        return { data: hasInFilter ? mockAllChatParts : mockParticipations, error: null };
      }
      if (q.table === 'activities') {
        return { data: mockActivities, error: null };
      }
      if (q.table === 'messages') {
        return { data: mockMessages, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    const chats = await chatService.getUserChats({ id: userId, usuario: 'testuser', apodo: 'TestUser' } as any);
    assert.equal(chats.length, N, 'Should return all N chats');

    // Total queries should be exactly 4 (chat_participants join, activities, chat_participants .in(), messages .in())
    assert.equal(logs.length, 4, `Expected 4 total queries for ${N} chats, got ${logs.length}`);

    const chatPartInQueries = logs.filter(l => l.table === 'chat_participants' && l.filters.some(f => f.method === 'in'));
    const chatPartEqChatIdQueries = logs.filter(l => l.table === 'chat_participants' && l.filters.some(f => f.method === 'eq' && f.col === 'chat_id'));
    assert.equal(chatPartInQueries.length, 1, 'Participants must be fetched in a single .in() query');
    assert.equal(chatPartEqChatIdQueries.length, 0, 'Must never query chat_participants with .eq(chat_id, id) in a loop');
  } finally {
    (supabase as any).from = originalFrom;
  }
});

test('getUserChats deduplicates concurrent in-flight requests for the same user', async () => {
  installMemoryLocalStorage();
  const originalFrom = supabase.from.bind(supabase);
  const userId = 'usr_concurrent';

  const { mockFrom, logs } = createSupabaseMock({
    onQuery: async (q) => {
      await new Promise(r => setTimeout(r, 15));
      if (q.table === 'chat_participants') {
        return {
          data: [
            {
              chat_id: 'c1',
              chats: { id: 'c1', nombre: 'Chat 1', tipo: 'grupo_libre', foto_grupo_url: null, creado_el: '2026-11-10T10:00:00.000Z', creador_id: userId }
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
    const [res1, res2] = await Promise.all([
      chatService.getUserChats({ id: userId }),
      chatService.getUserChats({ id: userId })
    ]);
    assert.equal(res1.length, 1);
    assert.equal(res2.length, 1);
    assert.equal(logs.length, 4, 'Concurrent calls for the same user must share a single 4-query batch');
  } finally {
    (supabase as any).from = originalFrom;
  }
});

test('createDirectChat checks existing private chats with a single .in() query instead of N+1 loop', async () => {
  installMemoryLocalStorage();
  const originalFrom = supabase.from.bind(supabase);
  const userId = 'usr_a';
  const otherId = 'usr_b';

  const myPrivateParticipations = Array.from({ length: 8 }, (_, i) => ({
    chat_id: `priv-${i + 1}`,
    chats: {
      id: `priv-${i + 1}`,
      nombre: `User ${i + 1}`,
      tipo: 'privado',
      foto_grupo_url: null,
      creado_el: '2026-11-10T10:00:00.000Z',
      creador_id: userId
    }
  }));

  const { mockFrom, logs } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users') {
        return { data: [], error: null };
      }
      if (q.table === 'chat_participants') {
        const hasIn = q.filters.some(f => f.method === 'in' && f.col === 'chat_id');
        if (hasIn) {
          return { data: [{ chat_id: 'priv-5', user_id: otherId }], error: null };
        }
        return { data: myPrivateParticipations, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    const found = await chatService.createDirectChat({
      currentUser: { id: userId, apodo: 'Ana' },
      otherUser: { id: otherId, apodo: 'Beto' }
    });
    assert.equal(found.id, 'priv-5');

    const perChatEqQueries = logs.filter(l => l.table === 'chat_participants' && l.filters.some(f => f.method === 'eq' && f.col === 'chat_id'));
    const batchInQueries = logs.filter(l => l.table === 'chat_participants' && l.filters.some(f => f.method === 'in' && f.col === 'chat_id'));
    assert.equal(perChatEqQueries.length, 0, 'createDirectChat must never query chat_participants per chat in a loop');
    assert.equal(batchInQueries.length, 1, 'createDirectChat must batch-check private chats with a single .in() query');
  } finally {
    (supabase as any).from = originalFrom;
  }
});

test('markChatAsReadInSupabase unifies multiple IDs and caches notifications so read+write run at most once', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const userId = 'usr_notif_test';

  let persistedNotifications: any[] = [
    { id: 'cr_old', type: 'chat_read', chatId: 'old_chat', readAt: 1000 }
  ];

  const { mockFrom, logs } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users' && q.op === 'select') {
        return { data: { notifications: persistedNotifications }, error: null };
      }
      if (q.table === 'users' && q.op === 'update') {
        return { data: null, error: null };
      }
      return { data: null, error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // 1. Initial load via getChatReadStatus populates cache with 1 GET
    await api.getChatReadStatus(userId);
    const readsAfterInit = logs.filter(l => l.table === 'users' && l.op === 'select').length;
    assert.equal(readsAfterInit, 1, 'Initial getChatReadStatus performs exactly 1 GET users?select=notifications');

    // 2. Marking read for both chat UUID and activityId performs 0 extra GETs and 1 single PATCH
    await api.markChatAsReadInSupabase(['chat-uuid-99', 99], userId);
    const totalGets = logs.filter(l => l.table === 'users' && l.op === 'select').length;
    const totalPatches = logs.filter(l => l.table === 'users' && l.op === 'update').length;
    assert.equal(totalGets, 1, 'markChatAsReadInSupabase reuses cached notifications (no duplicate GET)');
    assert.equal(totalPatches, 1, 'markChatAsReadInSupabase executes exactly 1 PATCH for both chatId and activityId');

    // 3. Even if cache was cold, calling markChatAsReadInSupabase executes 1 GET + 1 PATCH (never 2x)
    invalidateApiCaches();
    logs.length = 0;
    await api.markChatAsReadInSupabase(['chat-uuid-99', 99], userId);
    assert.equal(logs.filter(l => l.table === 'users' && l.op === 'select').length, 1);
    assert.equal(logs.filter(l => l.table === 'users' && l.op === 'update').length, 1);
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
  }
});

test('App.tsx and useChat.ts eliminate duplicate Realtime listeners and notification triggers', () => {
  const appFile = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
  const useChatFile = readFileSync(resolve(process.cwd(), 'src/hooks/useChat.ts'), 'utf-8');

  // 1. No duplicate active_chat_messages_ Realtime channel in App.tsx
  assert.equal(
    appFile.includes('active_chat_messages_'),
    false,
    'App.tsx must not register a duplicate active_chat_messages_ Realtime INSERT listener'
  );

  // 2. markChatAsRead useEffect must only depend on [currentView, activeChatId], not [currentView, activeChatId, chats]
  assert.equal(
    /markChatAsRead\(activeChatId\);\s*\}\s*\}, \[currentView, activeChatId, chats\]\)/.test(appFile),
    false,
    'markChatAsRead useEffect must not re-fire on every chats array update'
  );

  // 3. Local message IDs are tracked to skip Realtime echo in both App.tsx and useChat.ts
  assert.ok(appFile.includes('recentlySentMsgIdsRef'), 'App.tsx must track locally sent message IDs');
  assert.ok(useChatFile.includes('recentlySentMsgIdsRef'), 'useChat.ts must track locally sent message IDs');
});

test('api.vetoUser removes user from group chat only if they were already a group member, and leaves Mi Chat untouched if not', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalAuth = { ...supabase.auth };
  const originalFetch = globalThis.fetch;

  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: '550e8400-e29b-41d4-a716-446655440901' } } }
  });

  const targetUser = { id: 'usr_roberto', usuario: 'roberto', apodo: 'Roberto', avatar: '', tipo: 'personal', notifications: [] as any[] };
  const orgUser = { id: 'usr_org', usuario: 'carola', apodo: 'Carola', avatar: '', tipo: 'personal', notifications: [] as any[] };

  let activityRow = {
    id: '901',
    title: 'Clase de Yoga',
    titulo: 'Clase de Yoga',
    enrolled_usernames: ['Roberto'],
    enrolled_count: 1,
    vetted_users: [] as string[],
    is_approved: true,
    proposal_status: 'aprobada',
    creador_id: 'usr_org',
    organizer_id: 'usr_org'
  };
  let groupParticipants = [
    { chat_id: 'chat-901', user_id: 'usr_org', users: orgUser },
    { chat_id: 'chat-901', user_id: 'usr_roberto', users: targetUser }
  ];
  const insertedMessages: any[] = [];
  let deletedFromChatParts = 0;

  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users') {
        if (q.op === 'select') {
          return { data: [targetUser, orgUser], error: null };
        }
        if (q.op === 'update') {
          targetUser.notifications = q.payload?.notifications || targetUser.notifications;
          return { data: null, error: null };
        }
      }
      if (q.table === 'activities') {
        if (q.op === 'select') {
          const isSingle = q.filters.some(f => f.method === 'eq' && f.col === 'id');
          return { data: isSingle ? activityRow : [activityRow], error: null };
        }
        if (q.op === 'update') {
          activityRow = { ...activityRow, ...q.payload };
          return { data: activityRow, error: null };
        }
      }
      if (q.table === 'chats') {
        return {
          data: [{ id: 'chat-901', nombre: 'Grupo: Clase de Yoga', tipo: 'grupo_actividad', actividad_id: '901', foto_grupo_url: null, creado_el: '2026-11-01T10:00:00.000Z', creador_id: 'usr_org' }],
          error: null
        };
      }
      if (q.table === 'chat_participants') {
        if (q.op === 'select') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          if (eqUser) {
            return {
              data: groupParticipants
                .filter(p => p.user_id === eqUser.val)
                .map(p => ({
                  chat_id: p.chat_id,
                  chats: { id: 'chat-901', nombre: 'Grupo: Clase de Yoga', tipo: 'grupo_actividad', actividad_id: '901', foto_grupo_url: null, creado_el: '2026-11-01T10:00:00.000Z', creador_id: 'usr_org' }
                })),
              error: null
            };
          }
          return { data: groupParticipants, error: null };
        }
        if (q.op === 'delete') {
          deletedFromChatParts++;
          groupParticipants = groupParticipants.filter(p => p.user_id !== 'usr_roberto');
          return { data: null, error: null };
        }
      }
      if (q.table === 'messages') {
        if (q.op === 'insert') {
          insertedMessages.push(q.payload);
          return { data: q.payload, error: null };
        }
        return { data: insertedMessages, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // Case A: Roberto WAS in the group chat before veto
    await api.vetoUser(901, 'Roberto');
    assert.equal(activityRow.enrolled_usernames.length, 0);
    assert.ok(activityRow.vetted_users.includes('roberto'));
    assert.equal(deletedFromChatParts, 1, 'Roberto must be deleted from chat_participants');
    assert.equal(insertedMessages.length, 1, 'System veto message must be inserted into messages');
    assert.ok(insertedMessages[0].text.includes('porque fue vetado de la actividad'));
    assert.equal(
      targetUser.notifications.some((n: any) => n.type === 'chat_removed_notice' && n.reason === 'vetoed' && n.chatId === 'chat-901'),
      true,
      'chat_removed_notice must be saved so Roberto sees the read-only vetoed banner in Mi Chat'
    );

    const chatsForVetoedRoberto = await chatService.getUserChats(targetUser as any);
    assert.equal(chatsForVetoedRoberto.length, 1);
    assert.equal((chatsForVetoedRoberto[0] as any).vetoedByUser, true);

    // Case B: New user Ana was NOT in the group chat before veto
    const anaUser = { id: 'usr_ana', usuario: 'ana', apodo: 'Ana', avatar: '', tipo: 'personal', notifications: [] as any[] };
    // Reset message & delete counters, add Ana only to activity enrolled_usernames (NOT chat_participants)
    insertedMessages.length = 0;
    deletedFromChatParts = 0;
    activityRow.enrolled_usernames = ['Ana'];

    (supabase as any).from = createSupabaseMock({
      onQuery: (q) => {
        if (q.table === 'users') {
          if (q.op === 'select') return { data: [anaUser, orgUser], error: null };
          if (q.op === 'update') {
            anaUser.notifications = q.payload?.notifications || anaUser.notifications;
            return { data: null, error: null };
          }
        }
        if (q.table === 'activities') {
          if (q.op === 'select') {
            const isSingle = q.filters.some(f => f.method === 'eq' && f.col === 'id');
            return { data: isSingle ? activityRow : [activityRow], error: null };
          }
          if (q.op === 'update') {
            activityRow = { ...activityRow, ...q.payload };
            return { data: activityRow, error: null };
          }
        }
        if (q.table === 'chats') {
          return {
            data: [{ id: 'chat-901', nombre: 'Grupo: Clase de Yoga', tipo: 'grupo_actividad', actividad_id: '901', foto_grupo_url: null, creado_el: '2026-11-01T10:00:00.000Z', creador_id: 'usr_org' }],
            error: null
          };
        }
        if (q.table === 'chat_participants') {
          if (q.op === 'select') {
            const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
            if (eqUser) return { data: [], error: null };
            return { data: [{ chat_id: 'chat-901', user_id: 'usr_org', users: orgUser }], error: null };
          }
          if (q.op === 'delete') {
            deletedFromChatParts++;
            return { data: null, error: null };
          }
        }
        if (q.table === 'messages') {
          if (q.op === 'insert') {
            insertedMessages.push(q.payload);
            return { data: q.payload, error: null };
          }
          return { data: [], error: null };
        }
        return { data: [], error: null };
      }
    }).mockFrom;

    await api.vetoUser(901, 'Ana');
    assert.ok(activityRow.vetted_users.includes('ana'));
    assert.equal(deletedFromChatParts, 0, 'Must NOT delete from chat_participants if user was not in group');
    assert.equal(insertedMessages.length, 0, 'Must NOT insert any message into group chat if user was not in group');
    assert.equal(anaUser.notifications.length, 0, 'Must NOT add chat_removed_notice for user who was not in group');

    const chatsForAna = await chatService.getUserChats(anaUser as any);
    assert.equal(chatsForAna.length, 0, 'Mi Chat for Ana must remain unchanged');
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    Object.assign(supabase.auth, originalAuth);
    (globalThis as any).fetch = originalFetch;
  }
});

test('api.unenrollActivity removes only cancelling user from chat_participants, keeps chat/messages intact for others, persists across reload, and enrollActivity restores access', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalFetch = globalThis.fetch;

  const anaUser = { id: 'usr_ana_u', usuario: 'ana_u', apodo: 'Ana', avatar: '', tipo: 'personal', notifications: [] as any[] };
  const betoUser = { id: 'usr_beto_u', usuario: 'beto_u', apodo: 'Beto', avatar: '', tipo: 'personal', notifications: [] as any[] };
  const orgUser = { id: 'usr_org_u', usuario: 'org_u', apodo: 'Organizador', avatar: '', tipo: 'personal', notifications: [] as any[] };
  const usersById: Record<string, any> = {
    [anaUser.id]: anaUser,
    [betoUser.id]: betoUser,
    [orgUser.id]: orgUser
  };

  let activeStoredUser: any = anaUser;
  (globalThis as any).localStorage.setItem('club65_user', JSON.stringify(anaUser));
  (globalThis as any).localStorage.setItem('club65_current_user_id', anaUser.id);
  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });

  let activityRow: any = {
    id: '955',
    title: 'Coro Barrial',
    titulo: 'Coro Barrial',
    schedule: '2026-11-25 18:00 a 19:30 h',
    is_recurrent: false,
    enrolled_usernames: ['Ana', 'Beto'],
    enrolled_count: 2,
    vetted_users: [] as string[],
    is_approved: true,
    proposal_status: 'aprobada',
    creador_id: orgUser.id,
    organizer_id: orgUser.id
  };

  // Simulates a legacy chat row with actividad_id: null so title matching must also work
  let chatRows: any[] = [
    {
      id: 'chat-955',
      nombre: 'Grupo: Coro Barrial',
      tipo: 'grupo_actividad',
      actividad_id: null,
      foto_grupo_url: null,
      creado_el: '2026-11-01T10:00:00.000Z',
      creador_id: orgUser.id
    }
  ];

  let chatParticipants: any[] = [
    { chat_id: 'chat-955', user_id: orgUser.id, users: orgUser },
    { chat_id: 'chat-955', user_id: anaUser.id, users: anaUser },
    { chat_id: 'chat-955', user_id: betoUser.id, users: betoUser }
  ];

  const messages: any[] = [
    {
      id: 'msg_hist_1',
      chat_id: chatIdentifierToBigInt('chat-955'),
      sender_id: betoUser.id,
      sender: 'Beto',
      avatar: '',
      role: 'Vecino',
      text: '¡Buenas tardes grupo!',
      time: '10:00',
      created_at: '2026-11-10T10:00:00.000Z',
      is_deleted: false,
      is_pinned: false
    }
  ];

  let chatsDeletedCount = 0;
  let messagesDeletedCount = 0;

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users') {
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        if (eqId) return { data: usersById[String(eqId.val)] || activeStoredUser, error: null };
        return { data: Object.values(usersById), error: null };
      }
      if (q.table === 'activities') {
        if (q.op === 'select') {
          const isSingle = q.filters.some(f => f.method === 'eq' && f.col === 'id');
          return { data: isSingle ? activityRow : [activityRow], error: null };
        }
        if (q.op === 'update') {
          activityRow = { ...activityRow, ...q.payload };
          return { data: activityRow, error: null };
        }
      }
      if (q.table === 'chats') {
        if (q.op === 'delete') {
          chatsDeletedCount++;
          return { data: null, error: null };
        }
        return { data: chatRows, error: null };
      }
      if (q.table === 'chat_participants') {
        if (q.op === 'select') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          const eqChat = q.filters.find(f => f.method === 'eq' && f.col === 'chat_id');
          const inChat = q.filters.find(f => f.method === 'in' && f.col === 'chat_id');
          let filtered = chatParticipants;
          if (eqUser) filtered = filtered.filter(p => p.user_id === eqUser.val);
          if (eqChat) filtered = filtered.filter(p => p.chat_id === eqChat.val);
          if (inChat) filtered = filtered.filter(p => inChat.val.includes(p.chat_id));
          return {
            data: filtered.map(p => ({
              ...p,
              chats: chatRows.find(c => c.id === p.chat_id)
            })),
            error: null
          };
        }
        if (q.op === 'insert') {
          const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
          for (const r of rows) {
            if (!chatParticipants.some(p => p.chat_id === r.chat_id && p.user_id === r.user_id)) {
              chatParticipants.push({
                ...r,
                users: usersById[String(r.user_id)]
              });
            }
          }
          return { data: rows, error: null };
        }
        if (q.op === 'upsert') {
          const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
          for (const r of rows) {
            if (!chatParticipants.some(p => p.chat_id === r.chat_id && p.user_id === r.user_id)) {
              chatParticipants.push({ ...r, users: usersById[String(r.user_id)] });
            }
          }
          return { data: rows, error: null };
        }
        if (q.op === 'delete') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          const inChat = q.filters.find(f => f.method === 'in' && f.col === 'chat_id');
          chatParticipants = chatParticipants.filter(p => {
            const matchU = eqUser ? p.user_id === eqUser.val : true;
            const matchC = inChat ? inChat.val.includes(p.chat_id) : true;
            return !(matchU && matchC);
          });
          return { data: null, error: null };
        }
      }
      if (q.table === 'messages') {
        if (q.op === 'delete') {
          messagesDeletedCount++;
          return { data: null, error: null };
        }
        if (q.op === 'insert') {
          const row = Array.isArray(q.payload) ? q.payload[0] : q.payload;
          messages.push(row);
          return { data: row, error: null };
        }
        return { data: messages, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // Seed club65_custom_chats cache to ensure unenrollActivity cleans it too
    (globalThis as any).localStorage.setItem('club65_custom_chats', JSON.stringify([
      { id: 'chat-955', activityId: '955', title: 'Grupo: Coro Barrial', type: 'grupal', creatorId: orgUser.id, participants: ['Organizador', 'Ana', 'Beto'] }
    ]));

    // 1. Before unenrollment: both Ana and Beto get the chat
    assert.equal((await chatService.getUserChats(anaUser as any)).length, 1);
    assert.equal((await chatService.getUserChats(betoUser as any)).length, 1);

    // 2. Ana cancels enrollment
    await api.unenrollActivity('955');

    assert.equal(chatsDeletedCount, 0, 'Group chat row must NEVER be deleted');
    assert.equal(messagesDeletedCount, 0, 'Group chat messages must NEVER be deleted');
    assert.equal(activityRow.enrolled_usernames.includes('Ana'), false);
    assert.equal(chatParticipants.some(p => p.user_id === anaUser.id), false, 'Ana must be removed from chat_participants');
    assert.equal(chatParticipants.some(p => p.user_id === betoUser.id), true, 'Beto must stay in chat_participants');
    assert.equal(JSON.parse((globalThis as any).localStorage.getItem('club65_custom_chats') || '[]').length, 0);

    // Persists on fresh fetch / relogin for Ana, while Beto still sees chat + history
    const chatsForAnaAfter = await chatService.getUserChats(anaUser as any);
    assert.equal(chatsForAnaAfter.length, 0, 'Unenrolled Ana must not see the activity chat after reload');

    const chatsForBetoAfter = await chatService.getUserChats(betoUser as any);
    assert.equal(chatsForBetoAfter.length, 1, 'Other enrolled participant Beto must still see the group chat');
    assert.equal(chatsForBetoAfter[0].messages.length, 1, 'Chat history must remain intact for Beto');

    // 3. Ana re-enrolls -> regains access to the same group chat & history
    await api.enrollActivity('955');
    assert.equal(activityRow.enrolled_usernames.includes('Ana'), true);
    assert.equal(chatParticipants.some(p => p.user_id === anaUser.id), true, 'Ana must be re-added to chat_participants on re-enroll');

    const chatsForAnaReenrolled = await chatService.getUserChats(anaUser as any);
    assert.equal(chatsForAnaReenrolled.length, 1, 'Re-enrolled Ana must regain access to the group chat');
    assert.equal(chatsForAnaReenrolled[0].id, 'chat-955');
    assert.ok(chatsForAnaReenrolled[0].messages.some((m: any) => m.text === '¡Buenas tardes grupo!'));
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    (globalThis as any).fetch = originalFetch;
  }
});

test('api.leaveChat keeps user enrolled in activity, retains group chat in Recent Chats in read-only mode with frozen participants and cutoff messages, and blocks auto-rejoin & sendChatMessage', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalFetch = globalThis.fetch;

  const anaUser: any = { id: 'usr_ana_l', usuario: 'ana_l', apodo: 'Ana', avatar: '', tipo: 'personal', notifications: [] };
  const betoUser: any = { id: 'usr_beto_l', usuario: 'beto_l', apodo: 'Beto', avatar: '', tipo: 'personal', notifications: [] };
  const carlosUser: any = { id: 'usr_carlos_l', usuario: 'carlos_l', apodo: 'Carlos', avatar: '', tipo: 'personal', notifications: [] };
  const usersById: Record<string, any> = {
    [anaUser.id]: anaUser,
    [betoUser.id]: betoUser,
    [carlosUser.id]: carlosUser
  };

  (globalThis as any).localStorage.setItem('club65_user', JSON.stringify(anaUser));
  (globalThis as any).localStorage.setItem('club65_current_user_id', anaUser.id);
  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });

  let activityRow: any = {
    id: '988',
    title: 'Club de Ajedrez',
    titulo: 'Club de Ajedrez',
    schedule: '2026-11-28 17:00 a 19:00 h',
    is_recurrent: false,
    enrolled_usernames: ['Ana', 'Beto'],
    enrolled_count: 2,
    vetted_users: [] as string[],
    is_approved: true,
    proposal_status: 'aprobada',
    creador_id: betoUser.id,
    organizer_id: betoUser.id
  };

  const chatRow: any = {
    id: 'chat-988',
    nombre: 'Grupo: Club de Ajedrez',
    tipo: 'grupo_actividad',
    actividad_id: '988',
    foto_grupo_url: null,
    creado_el: '2026-11-01T10:00:00.000Z',
    creador_id: betoUser.id
  };

  let chatParticipants: any[] = [
    { chat_id: 'chat-988', user_id: betoUser.id, users: betoUser },
    { chat_id: 'chat-988', user_id: anaUser.id, users: anaUser }
  ];

  const baseMs = Date.now() - 60000;
  const messages: any[] = [
    {
      id: 'msg_before_leave',
      chat_id: chatIdentifierToBigInt('chat-988'),
      sender_id: betoUser.id,
      sender: 'Beto',
      avatar: '',
      role: 'Vecino',
      text: 'Nos vemos el sábado en el tablero',
      time: '10:00',
      created_at: new Date(baseMs).toISOString(),
      is_deleted: false,
      is_pinned: false
    }
  ];

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users') {
        if (q.op === 'update') {
          const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
          if (eqId && usersById[String(eqId.val)]) {
            usersById[String(eqId.val)].notifications = q.payload?.notifications || [];
          }
          return { data: null, error: null };
        }
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        if (eqId) return { data: usersById[String(eqId.val)] || anaUser, error: null };
        return { data: Object.values(usersById), error: null };
      }
      if (q.table === 'activities') {
        if (q.op === 'select') {
          const isSingle = q.filters.some(f => f.method === 'eq' && f.col === 'id');
          return { data: isSingle ? activityRow : [activityRow], error: null };
        }
        if (q.op === 'update') {
          activityRow = { ...activityRow, ...q.payload };
          return { data: activityRow, error: null };
        }
      }
      if (q.table === 'chats') {
        const isSingle = q.filters.some(f => f.method === 'eq' && f.col === 'id');
        return { data: isSingle ? chatRow : [chatRow], error: null };
      }
      if (q.table === 'chat_participants') {
        if (q.op === 'select') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          const eqChat = q.filters.find(f => f.method === 'eq' && f.col === 'chat_id');
          const inChat = q.filters.find(f => f.method === 'in' && f.col === 'chat_id');
          let filtered = chatParticipants;
          if (eqUser) filtered = filtered.filter(p => p.user_id === eqUser.val);
          if (eqChat) filtered = filtered.filter(p => p.chat_id === eqChat.val);
          if (inChat) filtered = filtered.filter(p => inChat.val.includes(p.chat_id));
          return {
            data: filtered.map(p => ({ ...p, chats: chatRow })),
            error: null
          };
        }
        if (q.op === 'insert' || q.op === 'upsert') {
          const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
          for (const r of rows) {
            if (!chatParticipants.some(p => p.chat_id === r.chat_id && p.user_id === r.user_id)) {
              chatParticipants.push({ ...r, users: usersById[String(r.user_id)] });
            }
          }
          return { data: rows, error: null };
        }
        if (q.op === 'delete') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          const eqChat = q.filters.find(f => f.method === 'eq' && f.col === 'chat_id');
          chatParticipants = chatParticipants.filter(p => {
            const mU = eqUser ? p.user_id === eqUser.val : true;
            const mC = eqChat ? p.chat_id === eqChat.val : true;
            return !(mU && mC);
          });
          return { data: null, error: null };
        }
      }
      if (q.table === 'messages') {
        if (q.op === 'insert') {
          const row = Array.isArray(q.payload) ? q.payload[0] : q.payload;
          messages.push(row);
          return { data: row, error: null };
        }
        return { data: messages, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // 1. Ana leaves the group voluntarily
    await api.leaveChat('chat-988', '988', anaUser);

    // 2. Activity inscription MUST stay intact!
    assert.equal(activityRow.enrolled_usernames.includes('Ana'), true, 'Leaving group must NOT unenroll user from activity');
    assert.equal(activityRow.enrolled_count, 2);

    // 3. Ana is deleted from chat_participants, and notice with snapshot is saved in notifications
    assert.equal(chatParticipants.some(p => p.user_id === anaUser.id), false);
    const leftNotice = anaUser.notifications.find((n: any) => n.type === 'chat_removed_notice' && n.chatId === 'chat-988');
    assert.ok(leftNotice, 'chat_removed_notice must be persisted in Supabase notifications');
    assert.equal(leftNotice.reason, 'left');
    assert.deepEqual(leftNotice.participantsSnapshot.sort(), ['Ana', 'Beto']);

    // 4. Subsequent activity joins/messages happen AFTER Ana left
    chatParticipants.push({ chat_id: 'chat-988', user_id: carlosUser.id, users: carlosUser });
    messages.push({
      id: 'msg_after_leave',
      chat_id: chatIdentifierToBigInt('chat-988'),
      sender_id: carlosUser.id,
      sender: 'Carlos',
      avatar: '',
      role: 'Vecino',
      text: 'Mensaje enviado después de que Ana salió',
      time: '12:00',
      created_at: new Date(Date.now() + 60000).toISOString(),
      is_deleted: false,
      is_pinned: true
    });

    // 5. Simulate fresh device reload (empty localStorage) -> getUserChats retains chat, does NOT auto-rejoin Ana, freezes snapshot & cuts off messages
    (globalThis as any).localStorage.clear();
    const chatsForAna = await chatService.getUserChats(anaUser);
    assert.equal(chatParticipants.some(p => p.user_id === anaUser.id), false, 'getUserChats Step 2 must NEVER auto-rejoin left user even while enrolled in activity');
    assert.equal(chatsForAna.length, 1, 'Left group chat must still appear in Recent Chats');
    assert.equal((chatsForAna[0] as any).leftVoluntarily, true);
    assert.deepEqual((chatsForAna[0] as any).participantsSnapshotOnRemoval?.usr_ana_l?.sort(), ['Ana', 'Beto']);
    assert.equal(chatsForAna[0].messages.some((m: any) => m.id === 'msg_after_leave'), false, 'Post-departure messages must not be visible');
    assert.equal(chatsForAna[0].pinnedMessageId, undefined, 'Post-departure pinned message must not leak');

    // 6. Sending a message as ex-participant must be rejected at service layer
    await assert.rejects(
      () => chatService.sendChatMessage({ selectedChatId: 'chat-988', text: 'Intento escribir', currentUser: anaUser, chatType: 'grupal' }),
      /Ya no formás parte de este grupo/
    );
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    (globalThis as any).fetch = originalFetch;
  }
});

test('api.removeChatParticipant preserves removed user Recent Chat with frozen participants and cutoff messages across devices', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalAuth = { ...supabase.auth };
  const originalFetch = globalThis.fetch;

  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: '550e8400-e29b-41d4-a716-446655440777' } } }
  });

  const orgUser: any = { id: 'usr_org_r', usuario: 'marta_r', apodo: 'Marta', avatar: '', tipo: 'personal', notifications: [] };
  const removedUser: any = { id: 'usr_rem_r', usuario: 'pedro_r', apodo: 'Pedro', avatar: '', tipo: 'personal', notifications: [] };
  const extraUser: any = { id: 'usr_extra_r', usuario: 'lucia_r', apodo: 'Lucía', avatar: '', tipo: 'personal', notifications: [] };
  const usersById: Record<string, any> = {
    [orgUser.id]: orgUser,
    [removedUser.id]: removedUser,
    [extraUser.id]: extraUser
  };

  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });

  const chatRow: any = {
    id: 'chat-777',
    nombre: 'Grupo: Mateada Vecinal',
    tipo: 'grupo_libre',
    actividad_id: null,
    foto_grupo_url: null,
    creado_el: '2026-11-01T10:00:00.000Z',
    creador_id: orgUser.id
  };

  let chatParticipants: any[] = [
    { chat_id: 'chat-777', user_id: orgUser.id, users: orgUser },
    { chat_id: 'chat-777', user_id: removedUser.id, users: removedUser }
  ];

  const messages: any[] = [
    {
      id: 'm_pre_rem',
      chat_id: chatIdentifierToBigInt('chat-777'),
      sender_id: orgUser.id,
      sender: 'Marta',
      avatar: '',
      role: 'Vecino',
      text: 'Bienvenidos al grupo libre',
      time: '09:00',
      created_at: new Date(Date.now() - 30000).toISOString(),
      is_deleted: false,
      is_pinned: false
    }
  ];

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users') {
        if (q.op === 'update') {
          const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
          if (eqId && usersById[String(eqId.val)]) {
            usersById[String(eqId.val)].notifications = q.payload?.notifications || [];
          }
          return { data: null, error: null };
        }
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        if (eqId) return { data: usersById[String(eqId.val)] || null, error: null };
        const hasOr = q.filters.some(f => f.method === 'or');
        if (hasOr) return { data: removedUser, error: null };
        return { data: Object.values(usersById), error: null };
      }
      if (q.table === 'chats') {
        const isSingle = q.filters.some(f => f.method === 'eq' && f.col === 'id');
        return { data: isSingle ? chatRow : [chatRow], error: null };
      }
      if (q.table === 'chat_participants') {
        if (q.op === 'select') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          const eqChat = q.filters.find(f => f.method === 'eq' && f.col === 'chat_id');
          const inChat = q.filters.find(f => f.method === 'in' && f.col === 'chat_id');
          let filtered = chatParticipants;
          if (eqUser) filtered = filtered.filter(p => p.user_id === eqUser.val);
          if (eqChat) filtered = filtered.filter(p => p.chat_id === eqChat.val);
          if (inChat) filtered = filtered.filter(p => inChat.val.includes(p.chat_id));
          return {
            data: filtered.map(p => ({ ...p, chats: chatRow })),
            error: null
          };
        }
        if (q.op === 'delete') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          const eqChat = q.filters.find(f => f.method === 'eq' && f.col === 'chat_id');
          chatParticipants = chatParticipants.filter(p => {
            const mU = eqUser ? p.user_id === eqUser.val : true;
            const mC = eqChat ? p.chat_id === eqChat.val : true;
            return !(mU && mC);
          });
          return { data: null, error: null };
        }
      }
      if (q.table === 'messages') {
        if (q.op === 'insert') {
          const row = Array.isArray(q.payload) ? q.payload[0] : q.payload;
          messages.push(row);
          return { data: row, error: null };
        }
        return { data: messages, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    await api.removeChatParticipant('chat-777', 'Pedro');

    // Add Lucía & a post-removal message afterwards
    chatParticipants.push({ chat_id: 'chat-777', user_id: extraUser.id, users: extraUser });
    messages.push({
      id: 'm_post_rem',
      chat_id: chatIdentifierToBigInt('chat-777'),
      sender_id: extraUser.id,
      sender: 'Lucía',
      avatar: '',
      role: 'Vecino',
      text: 'Esto Pedro no debe verlo',
      time: '15:00',
      created_at: new Date(Date.now() + 60000).toISOString(),
      is_deleted: false,
      is_pinned: false
    });

    // Clear localStorage (new device simulation) and fetch chats for removed Pedro
    (globalThis as any).localStorage.clear();
    const pedroChats = await chatService.getUserChats(removedUser);
    assert.equal(pedroChats.length, 1, 'Removed user must still see the group in Recent Chats across devices');
    assert.equal((pedroChats[0] as any).removedByUser, true);
    assert.deepEqual((pedroChats[0] as any).participantsSnapshotOnRemoval?.usr_rem_r?.sort(), ['Marta', 'Pedro']);
    assert.equal(pedroChats[0].messages.some((m: any) => m.id === 'm_post_rem'), false, 'Post-removal message must not appear');
    assert.ok(pedroChats[0].messages.some((m: any) => m.id === 'm_pre_rem'), 'Pre-removal history remains visible');

    // Moderator re-adds Pedro -> access restored
    chatParticipants.push({ chat_id: 'chat-777', user_id: removedUser.id, users: removedUser });
    // Note: in mock we simulate addChatParticipant behavior
    removedUser.notifications = [];
    messages.push({
      id: 'sys_readd',
      chat_id: chatIdentifierToBigInt('chat-777'),
      sender_id: 'sistema',
      role: 'sistema',
      text: 'Pedro fue agregado al grupo por el moderador del grupo.',
      created_at: new Date(Date.now() + 90000).toISOString(),
      reply_to: { event: 'participant_added', participant: 'Pedro', participantId: removedUser.id, participantTokens: ['pedro', 'pedro_r', 'usr_rem_r'] }
    });
    const pedroReaddedChats = await chatService.getUserChats(removedUser);
    assert.equal((pedroReaddedChats[0] as any).removedByUser, undefined);
    assert.equal(pedroReaddedChats[0].messages.some((m: any) => m.id === 'm_post_rem'), true);
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    Object.assign(supabase.auth, originalAuth);
    (globalThis as any).fetch = originalFetch;
  }
});

test('api.leaveChat by one user keeps remaining group members active and able to message on the same browser', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalFetch = globalThis.fetch;

  const neriUser: any = { id: 'usr_neri_iso', usuario: 'neri', apodo: 'Neri', avatar: '', tipo: 'personal', notifications: [] };
  const gustavoUser: any = { id: 'usr_gustavo_iso', usuario: 'gustavomac', apodo: 'Gustavo Mac', avatar: '', tipo: 'personal', notifications: [] };
  const usersById: Record<string, any> = {
    [neriUser.id]: neriUser,
    [gustavoUser.id]: gustavoUser
  };

  (globalThis as any).fetch = async () => ({ ok: false, json: async () => ({}) });

  const actRow = {
    id: 777,
    title: 'VAYAMOS JUNTOS AL CONCIERTO DE MONTANER',
    titulo: 'VAYAMOS JUNTOS AL CONCIERTO DE MONTANER',
    creador_id: neriUser.id,
    organizer_id: neriUser.id,
    enrolled_usernames: ['Neri', 'Gustavo Mac'],
    vetted_users: [],
    proposal_status: 'aprobada',
    estado: 'aprobada',
    is_approved: true
  };
  const chatRow: any = {
    id: 'chat-montaner-777',
    nombre: 'Grupo: VAYAMOS JUNTOS AL CONCIERTO DE MONTANER',
    tipo: 'grupo_actividad',
    actividad_id: '777',
    foto_grupo_url: null,
    creado_el: '2026-11-18T09:00:00.000Z',
    creador_id: neriUser.id
  };

  let chatParticipants: any[] = [
    { chat_id: 'chat-montaner-777', user_id: neriUser.id, users: neriUser },
    { chat_id: 'chat-montaner-777', user_id: gustavoUser.id, users: gustavoUser }
  ];
  const messages: any[] = [];

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'activities') return { data: [actRow], error: null };
      if (q.table === 'users') {
        if (q.op === 'update') {
          const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
          if (eqId && usersById[String(eqId.val)]) {
            usersById[String(eqId.val)].notifications = q.payload?.notifications || [];
          }
          return { data: null, error: null };
        }
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        if (eqId) return { data: usersById[String(eqId.val)] || null, error: null };
        return { data: Object.values(usersById), error: null };
      }
      if (q.table === 'chats') {
        const isSingle = q.filters.some(f => f.method === 'eq' && f.col === 'id');
        const hydratedChat = {
          ...chatRow,
          chat_participants: chatParticipants.map(p => ({ user_id: p.user_id }))
        };
        return { data: isSingle ? hydratedChat : [hydratedChat], error: null };
      }
      if (q.table === 'chat_participants') {
        if (q.op === 'select') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          const eqChat = q.filters.find(f => f.method === 'eq' && f.col === 'chat_id');
          const inChat = q.filters.find(f => f.method === 'in' && f.col === 'chat_id');
          let filtered = chatParticipants;
          if (eqUser) filtered = filtered.filter(p => p.user_id === eqUser.val);
          if (eqChat) filtered = filtered.filter(p => p.chat_id === eqChat.val);
          if (inChat) filtered = filtered.filter(p => inChat.val.includes(p.chat_id));
          return { data: filtered.map(p => ({ ...p, chats: chatRow })), error: null };
        }
        if (q.op === 'delete') {
          const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
          const eqChat = q.filters.find(f => f.method === 'eq' && f.col === 'chat_id');
          chatParticipants = chatParticipants.filter(p => {
            const mU = eqUser ? p.user_id === eqUser.val : true;
            const mC = eqChat ? p.chat_id === eqChat.val : true;
            return !(mU && mC);
          });
          return { data: null, error: null };
        }
      }
      if (q.table === 'messages') {
        if (q.op === 'insert') {
          const row = Array.isArray(q.payload) ? q.payload[0] : q.payload;
          messages.push(row);
          return { data: row, error: null };
        }
        return { data: messages, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // 1. Gustavo Mac logs in on this browser and leaves the group
    (globalThis as any).localStorage.setItem('club65_user', JSON.stringify(gustavoUser));
    await api.leaveChat('chat-montaner-777', 777, gustavoUser);

    assert.equal(
      (globalThis as any).localStorage.getItem('left_chats_local'),
      null,
      'Must never write shared left_chats_local key that affects other users on the same browser'
    );

    // 2. Neri logs in on the SAME browser
    (globalThis as any).localStorage.setItem('club65_user', JSON.stringify(neriUser));
    const chatsForNeri = await chatService.getUserChats(neriUser);
    assert.equal(chatsForNeri.length, 1);
    assert.equal((chatsForNeri[0] as any).leftVoluntarily, undefined);
    assert.equal((chatsForNeri[0] as any).removedByUser, undefined);

    // Neri can still send messages in the group
    const sent = await chatService.sendChatMessage({
      selectedChatId: 'chat-montaner-777',
      text: '¡Nos vemos en el recital!',
      currentUser: neriUser,
      chatType: 'grupal'
    });
    assert.equal(sent.text, '¡Nos vemos en el recital!');

    // 3. Gustavo Mac himself still sees the chat in read-only departed mode
    const chatsForGustavo = await chatService.getUserChats(gustavoUser);
    assert.equal(chatsForGustavo.length, 1);
    assert.equal((chatsForGustavo[0] as any).leftVoluntarily, true);
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    (globalThis as any).fetch = originalFetch;
  }
});

test('api.makeChatAdmin persists directly in Supabase without throwing "Chat no encontrado." and hydrates isAdmin immediately', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  const originalAuth = { ...supabase.auth };
  const originalFetch = globalThis.fetch;

  const creatorUser: any = { id: '11111111-1111-4111-8111-111111111111', usuario: 'neri', apodo: 'Neri', avatar: '', tipo: 'personal', notifications: [] };
  const memberUser: any = { id: '22222222-2222-4222-8222-222222222222', usuario: 'marito', apodo: 'Marito', avatar: '', tipo: 'personal', notifications: [] };
  const chatUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: creatorUser.id } } }
  });

  // Simular que Express devuelve 404 'Chat no encontrado.' (chat solo en Supabase)
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 404,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({ error: 'Chat no encontrado.' }),
    json: async () => ({ error: 'Chat no encontrado.' })
  });

  const chatRow = {
    id: chatUuid,
    nombre: 'Grupo: Caminata Serrana',
    tipo: 'grupo_actividad',
    actividad_id: '905',
    foto_grupo_url: null,
    creado_el: '2026-11-18T08:00:00.000Z',
    creador_id: creatorUser.id
  };
  const chatParticipants = [
    { chat_id: chatUuid, user_id: creatorUser.id, users: creatorUser },
    { chat_id: chatUuid, user_id: memberUser.id, users: memberUser }
  ];
  const messages: any[] = [];

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'activities') return { data: [], error: null };
      if (q.table === 'users') {
        return { data: memberUser, error: null };
      }
      if (q.table === 'chats') {
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        const eqAct = q.filters.find(f => f.method === 'eq' && f.col === 'actividad_id');
        if (eqId && eqId.val === chatUuid) return { data: chatRow, error: null };
        if (eqAct && String(eqAct.val) === '905') return { data: chatRow, error: null };
        return { data: null, error: null };
      }
      if (q.table === 'chat_participants') {
        return { data: chatParticipants.map(p => ({ ...p, chats: chatRow })), error: null };
      }
      if (q.table === 'messages') {
        if (q.op === 'insert') {
          const row = Array.isArray(q.payload) ? q.payload[0] : q.payload;
          messages.push(row);
          return { data: row, error: null };
        }
        return { data: messages, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // 1. Invocar makeChatAdmin usando primero el activityId numérico ('905') para comprobar resolución a UUID real
    const resChat: any = await api.makeChatAdmin(905, 'Marito', { activityId: 905 });
    assert.equal(resChat.id, chatUuid, 'Debe resolver el UUID real del chat en Supabase');
    assert.ok(Array.isArray(resChat.adminUsernames) && resChat.adminUsernames.includes('Marito'));
    assert.equal(messages.length, 1, 'Debe insertar el mensaje de sistema make_admin en Supabase');
    assert.equal(messages[0].reply_to?.action, 'make_admin');

    // 2. Recargar chats desde Supabase y verificar que isAdmin se hidrate automáticamente
    const loadedChats = await chatService.getUserChats(creatorUser);
    assert.equal(loadedChats.length, 1);
    assert.ok(
      Array.isArray(loadedChats[0].adminUsernames) && loadedChats[0].adminUsernames.includes('Marito'),
      'getUserChats debe hidratar adminUsernames con el nuevo moderador'
    );

    const resolved = getResolvedChatParticipants(
      loadedChats[0],
      creatorUser,
      { [creatorUser.id]: creatorUser, [memberUser.id]: memberUser, marito: memberUser },
      null,
      []
    );
    const maritoPart = resolved.find(p => p.displayName === 'Marito');
    assert.ok(maritoPart, 'Marito debe aparecer en la lista de participantes resueltos');
    assert.equal(maritoPart?.isAdmin, true, 'Marito debe mostrar insignia de Moderador del grupo de inmediato');
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
    Object.assign(supabase.auth, originalAuth);
    (globalThis as any).fetch = originalFetch;
  }
});

test('api.makeChatAdmin validates missing/invalid chat_id before hitting Supabase', async () => {
  const originalFrom = supabase.from.bind(supabase);
  const originalAuth = { ...supabase.auth };
  const originalConsoleError = console.error;
  let supabaseCalled = false;
  let loggedError = false;

  (supabase.auth as any).getSession = async () => ({
    data: { session: { user: { id: '11111111-1111-4111-8111-111111111111' } } }
  });
  (supabase as any).from = () => {
    supabaseCalled = true;
    return originalFrom('chats');
  };
  console.error = (...args: any[]) => {
    if (String(args[0] || '').includes('[makeChatAdmin]')) {
      loggedError = true;
    }
  };

  try {
    await assert.rejects(
      () => api.makeChatAdmin('', 'Marito'),
      /No se pudo identificar el chat seleccionado/
    );
    assert.equal(supabaseCalled, false, 'No debe consultar Supabase si chat_id es inválido');
    assert.equal(loggedError, true, 'Debe registrar claramente el error en consola');
  } finally {
    (supabase as any).from = originalFrom;
    Object.assign(supabase.auth, originalAuth);
    console.error = originalConsoleError;
  }
});

test('createGroupChat and getUserChats never prepend "Grupo:" to manual or activity group names', async () => {
  installMemoryLocalStorage();
  const originalFrom = supabase.from.bind(supabase);

  const creator = { id: 'usr_creator_ng', usuario: 'carola', apodo: 'Carola', avatar: '', tipo: 'personal' };
  const member = { id: 'usr_member_ng', usuario: 'roberto', apodo: 'Roberto', avatar: '', tipo: 'personal' };
  const insertedChats: any[] = [];
  const chatParts: any[] = [];

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'chats') {
        if (q.op === 'insert') {
          if (Array.isArray(q.payload)) {
            const rows = q.payload.map((item: any) => {
              const row = {
                id: `chat-new-${insertedChats.length + 1}`,
                creado_el: '2026-11-19T12:00:00.000Z',
                ...item
              };
              insertedChats.push(row);
              return row;
            });
            return { data: rows, error: null };
          }
          const row = {
            id: `chat-new-${insertedChats.length + 1}`,
            creado_el: '2026-11-19T12:00:00.000Z',
            ...q.payload
          };
          insertedChats.push(row);
          return { data: row, error: null };
        }
        const tipoFilter = q.filters.find(f => f.method === 'eq' && f.col === 'tipo');
        return {
          data: tipoFilter ? insertedChats.filter(c => c.tipo === tipoFilter.val) : insertedChats,
          error: null
        };
      }
      if (q.table === 'chat_participants') {
        if (q.op === 'insert' || q.op === 'upsert') {
          const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
          for (const r of rows) {
            chatParts.push({
              ...r,
              users: r.user_id === creator.id ? creator : member
            });
          }
          return { data: rows, error: null };
        }
        if (q.op === 'select') {
          const hasIn = q.filters.some(f => f.method === 'in' && f.col === 'chat_id');
          if (hasIn) {
            return { data: chatParts, error: null };
          }
          return {
            data: chatParts
              .filter(p => p.user_id === creator.id)
              .map(p => ({
                chat_id: p.chat_id,
                chats: insertedChats.find(c => c.id === p.chat_id)
              })),
            error: null
          };
        }
      }
      if (q.table === 'activities') {
        return {
          data: [
            {
              id: 505,
              title: 'Caminata en el Parque',
              is_approved: true,
              proposal_status: 'aprobada',
              organizer_id: creator.id,
              enrolled_usernames: ['Carola']
            }
          ],
          error: null
        };
      }
      if (q.table === 'messages') {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // 1. Manual group creation with normal name
    const manualChat1 = await chatService.createGroupChat({
      nombre: 'Mateada Vecinal',
      currentUser: creator as any,
      memberUserIds: [member.id]
    });
    assert.equal(insertedChats[0].nombre, 'Mateada Vecinal');
    assert.equal(manualChat1.title, 'Mateada Vecinal');
    assert.equal(manualChat1.title.startsWith('Grupo:'), false);

    // 2. Manual group creation if input starts with "Grupo: " -> strips prefix
    const manualChat2 = await chatService.createGroupChat({
      nombre: 'Grupo: Club de Lectura',
      currentUser: creator as any,
      memberUserIds: [member.id]
    });
    assert.equal(insertedChats[1].nombre, 'Club de Lectura');
    assert.equal(manualChat2.title, 'Club de Lectura');

    // 3. getUserChats loads manual groups without adding "Grupo:" and auto-creates missing activity group without "Grupo:"
    const loadedChats = await chatService.getUserChats(creator as any);
    const loadedManual1 = loadedChats.find(c => c.id === manualChat1.id);
    const loadedManual2 = loadedChats.find(c => c.id === manualChat2.id);
    const autoCreatedActivityChat = insertedChats.find(c => String(c.actividad_id) === '505');
    const loadedActivityChat = loadedChats.find(c => String(c.activityId) === '505');

    assert.equal(loadedManual1?.title, 'Mateada Vecinal');
    assert.equal(loadedManual2?.title, 'Club de Lectura');
    assert.equal(autoCreatedActivityChat?.nombre, 'Caminata en el Parque');
    assert.equal(loadedActivityChat?.title, 'Caminata en el Parque');
    assert.equal(loadedChats.some(c => /^grupo:/i.test(String(c.title || ''))), false);
  } finally {
    (supabase as any).from = originalFrom;
  }
});

test('createActivityChat and enrollUserInActivityChat insert activity group names without "Grupo:" prefix', async () => {
  installMemoryLocalStorage();
  const originalFrom = supabase.from.bind(supabase);

  const user = { id: 'usr_act_ng', usuario: 'ana', apodo: 'Ana', avatar: '', tipo: 'personal' };
  const insertedChats: any[] = [];

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'chats') {
        if (q.op === 'select') {
          return { data: [], error: null };
        }
        if (q.op === 'insert') {
          const row = {
            id: `chat-act-${insertedChats.length + 1}`,
            creado_el: '2026-11-19T12:00:00.000Z',
            ...(Array.isArray(q.payload) ? q.payload[0] : q.payload)
          };
          insertedChats.push(row);
          return { data: row, error: null };
        }
      }
      if (q.table === 'chat_participants') {
        if (q.op === 'insert' || q.op === 'upsert') {
          return { data: q.payload, error: null };
        }
        return { data: [], error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    const createdByActivity = await chatService.createActivityChat({
      activity: { id: 701, title: 'Taller de Tejido' },
      currentUser: user as any
    });
    assert.equal(insertedChats[0].nombre, 'Taller de Tejido');
    assert.equal(createdByActivity.title, 'Taller de Tejido');

    await chatService.enrollUserInActivityChat({
      activityId: 702,
      activityTitle: 'Grupo: Yoga en la Plaza',
      currentUser: user as any
    });
    assert.equal(insertedChats[1].nombre, 'Yoga en la Plaza');
  } finally {
    (supabase as any).from = originalFrom;
  }
});

test('api.getActivityById fetches activity detail from Supabase when chat activity is not in local cache', async () => {
  installMemoryLocalStorage();
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);

  const mockRow = {
    id: '1794619532917',
    title: 'Caminata Histórica',
    category: 'naturaleza',
    schedule: '2026-12-05 10:00 a 12:00 h',
    location: 'Plaza Arenales, Villa Devoto',
    organizer: 'Carola',
    organizer_id: 'usr_org_1',
    is_approved: true,
    proposal_status: 'aprobada',
    capacity: 25,
    enrolled_count: 4,
    enrolled_usernames: ['Carola'],
    vetted_users: [],
    short_description: 'Recorrido vecinal',
    description: 'Recorrido vecinal guiado por el barrio'
  };

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users') {
        return { data: [], error: null };
      }
      if (q.table === 'activities' && q.op === 'select') {
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        if (eqId && String(eqId.val) === '1794619532917') {
          return { data: mockRow, error: null };
        }
        return { data: null, error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    const fetched = await api.getActivityById('1794619532917');
    assert.ok(fetched, 'Should return mapped activity from Supabase');
    assert.equal(fetched?.id, 1794619532917);
    assert.equal(fetched?.title, 'Caminata Histórica');
    assert.equal(fetched?.location, 'Plaza Arenales, Villa Devoto');
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
  }
});

test('chatService blocks administrators from creating groups, joining groups, or being added to groups', async () => {
  installMemoryLocalStorage();
  const originalFrom = supabase.from.bind(supabase);

  const insertedChats: any[] = [];
  const insertedParticipants: any[] = [];

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'users' && q.op === 'select') {
        const eqId = q.filters.find(f => f.method === 'eq' && f.col === 'id');
        if (eqId && String(eqId.val) === 'usr_admin_1') {
          return { data: { id: 'usr_admin_1', tipo: 'moderador', rol: 'moderador' }, error: null };
        }
        const inIds = q.filters.find(f => f.method === 'in' && f.col === 'id');
        if (inIds && Array.isArray(inIds.val)) {
          const rows = [];
          if (inIds.val.includes('usr_admin_1')) {
            rows.push({ id: 'usr_admin_1', tipo: 'moderador', rol: 'moderador' });
          }
          if (inIds.val.includes('usr_vecino_1')) {
            rows.push({ id: 'usr_vecino_1', tipo: 'personal', rol: 'personal' });
          }
          return { data: rows, error: null };
        }
        return { data: null, error: null };
      }
      if (q.table === 'chats' && q.op === 'insert') {
        insertedChats.push(q.payload);
        return { data: { id: 'chat-new', ...(Array.isArray(q.payload) ? q.payload[0] : q.payload) }, error: null };
      }
      if (q.table === 'chat_participants' && q.op === 'insert') {
        insertedParticipants.push(q.payload);
        return { data: [], error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // 1. Admin cannot create a group
    await assert.rejects(
      () =>
        chatService.createGroupChat({
          nombre: 'Grupo Admin',
          currentUser: { id: 'usr_admin_1', apodo: 'Admin', tipo: 'moderador' } as any,
          memberUserIds: ['usr_vecino_1']
        }),
      /administradores no pueden/i
    );

    // 2. Regular user cannot invite an admin when creating a group
    await assert.rejects(
      () =>
        chatService.createGroupChat({
          nombre: 'Grupo con Admin',
          currentUser: { id: 'usr_vecino_1', apodo: 'Marta', tipo: 'personal' } as any,
          memberUserIds: ['usr_admin_1']
        }),
      /administradores no pueden/i
    );

    // 3. Cannot add an admin to an existing group
    await assert.rejects(
      () => chatService.addParticipantToGroup('chat-group-1', 'usr_admin_1'),
      /administradores no pueden/i
    );

    // 4. enrollUserInActivityChat skips admins completely
    await chatService.enrollUserInActivityChat({
      activityId: 99,
      activityTitle: 'Taller de Pintura',
      currentUser: { id: 'usr_admin_1', apodo: 'Admin', tipo: 'moderador' }
    });

    assert.equal(insertedChats.length, 0, 'No group chat rows should be inserted for rejected admin actions');
    assert.equal(insertedParticipants.length, 0, 'No chat_participants rows should ever be inserted for an admin');
  } finally {
    (supabase as any).from = originalFrom;
  }
});

test('chatService.getUserChats excludes groups for admins, cleans stale admin group memberships, and hides admins from other users groups', async () => {
  installMemoryLocalStorage();
  const originalFrom = supabase.from.bind(supabase);

  const deletedParticipantFilters: Array<Array<{ method: string; col: string; val: any }>> = [];

  const { mockFrom } = createSupabaseMock({
    onQuery: (q) => {
      if (q.table === 'chat_participants' && q.op === 'delete') {
        deletedParticipantFilters.push(q.filters);
        return { data: [], error: null };
      }
      if (q.table === 'chat_participants' && q.op === 'select') {
        const eqUser = q.filters.find(f => f.method === 'eq' && f.col === 'user_id');
        if (eqUser && eqUser.val === 'usr_admin_1') {
          return {
            data: [
              {
                chat_id: 'chat-group-stale',
                chats: { id: 'chat-group-stale', nombre: 'Mateada', tipo: 'grupo_libre', foto_grupo_url: null, creado_el: '2026-05-01T10:00:00Z', creador_id: 'usr_vecino_1' }
              },
              {
                chat_id: 'chat-priv-1',
                chats: { id: 'chat-priv-1', nombre: 'Marta', tipo: 'privado', foto_grupo_url: null, creado_el: '2026-05-01T10:00:00Z', creador_id: 'usr_admin_1' }
              }
            ],
            error: null
          };
        }
        if (eqUser && eqUser.val === 'usr_vecino_1') {
          return {
            data: [
              {
                chat_id: 'chat-group-stale',
                chats: { id: 'chat-group-stale', nombre: 'Mateada', tipo: 'grupo_libre', foto_grupo_url: null, creado_el: '2026-05-01T10:00:00Z', creador_id: 'usr_vecino_1' }
              }
            ],
            error: null
          };
        }
        const inChats = q.filters.find(f => f.method === 'in' && f.col === 'chat_id');
        if (inChats && Array.isArray(inChats.val)) {
          const rows: any[] = [];
          if (inChats.val.includes('chat-priv-1')) {
            rows.push(
              { chat_id: 'chat-priv-1', user_id: 'usr_admin_1', users: { id: 'usr_admin_1', usuario: 'admin', apodo: 'Admin', tipo: 'moderador', rol: 'moderador' } },
              { chat_id: 'chat-priv-1', user_id: 'usr_vecino_1', users: { id: 'usr_vecino_1', usuario: 'marta', apodo: 'Marta', tipo: 'personal', rol: 'personal' } }
            );
          }
          if (inChats.val.includes('chat-group-stale')) {
            rows.push(
              { chat_id: 'chat-group-stale', user_id: 'usr_admin_1', users: { id: 'usr_admin_1', usuario: 'admin', apodo: 'Admin', tipo: 'moderador', rol: 'moderador' } },
              { chat_id: 'chat-group-stale', user_id: 'usr_vecino_1', users: { id: 'usr_vecino_1', usuario: 'marta', apodo: 'Marta', tipo: 'personal', rol: 'personal' } },
              { chat_id: 'chat-group-stale', user_id: 'usr_vecino_2', users: { id: 'usr_vecino_2', usuario: 'carlos', apodo: 'Carlos', tipo: 'personal', rol: 'personal' } }
            );
          }
          return { data: rows, error: null };
        }
      }
      if (q.table === 'activities' && q.op === 'select') {
        return { data: [], error: null };
      }
      if (q.table === 'messages' && q.op === 'select') {
        return { data: [], error: null };
      }
      return { data: [], error: null };
    }
  });

  (supabase as any).from = mockFrom;
  try {
    // 1. Admin only gets private chats and stale group membership is deleted in Supabase
    const adminChats = await chatService.getUserChats({ id: 'usr_admin_1', apodo: 'Admin', tipo: 'moderador' } as any);
    assert.equal(adminChats.length, 1);
    assert.equal(adminChats[0].id, 'chat-priv-1');
    assert.equal(adminChats[0].type, 'privado');
    assert.equal(deletedParticipantFilters.length, 1, 'Stale group membership must be deleted from chat_participants');
    assert.deepEqual(
      deletedParticipantFilters[0].find(f => f.method === 'in' && f.col === 'chat_id')?.val,
      ['chat-group-stale']
    );

    // 2. Regular user in that group does NOT see the admin in participants or participantIds
    const vecinoChats = await chatService.getUserChats({ id: 'usr_vecino_1', apodo: 'Marta', tipo: 'personal' } as any);
    assert.equal(vecinoChats.length, 1);
    assert.equal(vecinoChats[0].participants?.includes('Admin'), false);
    assert.equal(vecinoChats[0].participantIds?.includes('usr_admin_1'), false);
    assert.ok(vecinoChats[0].participants?.includes('Marta'));
    assert.ok(vecinoChats[0].participants?.includes('Carlos'));
  } finally {
    (supabase as any).from = originalFrom;
  }
});





