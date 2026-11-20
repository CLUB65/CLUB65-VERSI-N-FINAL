import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isActivityOwnedByUser, filterAndSortRecentChats } from './chatLogic';

test('isActivityOwnedByUser: strictly isolates institutional activities between distinct institutions', () => {
  const club65User = {
    id: 'usr_1793081503254_pcnbd',
    usuario: 'club65',
    apodo: 'CLUB65',
    tipo: 'institucional',
    estadoAlta: 'aprobada'
  };

  const newInstUser = {
    id: 'usr_1794553406213_5r6g2',
    usuario: 'harta_inst',
    apodo: 'Centro Comunitario Nuevo',
    tipo: 'institucional',
    estadoAlta: 'aprobada'
  };

  const club65Activity = {
    id: 14,
    title: 'Yoga Suave en Sede',
    isInstitutional: true,
    organizer: 'CLUB65',
    organizerId: 'usr_1793081503254_pcnbd',
    creador_id: 'usr_1793081503254_pcnbd'
  };

  const newInstActivity = {
    id: 99,
    title: 'Coro de Primavera',
    isInstitutional: true,
    organizer: 'Centro Comunitario Nuevo',
    organizerId: 'usr_1794553406213_5r6g2',
    creador_id: 'usr_1794553406213_5r6g2'
  };

  assert.equal(isActivityOwnedByUser(club65Activity, club65User), true);
  assert.equal(isActivityOwnedByUser(club65Activity, newInstUser), false);
  assert.equal(isActivityOwnedByUser(newInstActivity, newInstUser), true);
  assert.equal(isActivityOwnedByUser(newInstActivity, club65User), false);
});

test('isActivityOwnedByUser: never matches generic placeholders or falls back to name when real ID differs', () => {
  const instA = {
    id: 'usr_inst_a',
    usuario: 'instA',
    apodo: 'CLUB65',
    tipo: 'institucional'
  };

  // Even if apodo happens to match organizer text, a differing real ID must block ownership
  const actWithOtherId = {
    id: 20,
    isInstitutional: true,
    organizerId: 'usr_inst_other',
    organizer: 'CLUB65'
  };
  assert.equal(isActivityOwnedByUser(actWithOtherId, instA), false);

  // Generic placeholder 'institucional' must NEVER grant ownership to all institutional accounts
  const genericAct = {
    id: 21,
    isInstitutional: true,
    organizerId: 'institucional',
    organizer: 'Otro Centro'
  };
  assert.equal(isActivityOwnedByUser(genericAct, instA), false);

  // Legacy activity with placeholder ID and matching organizer name DOES match only that institution
  const legacyMatchingAct = {
    id: 22,
    isInstitutional: true,
    organizerId: 'institucional',
    organizer: 'CLUB65'
  };
  assert.equal(isActivityOwnedByUser(legacyMatchingAct, instA), true);
});

test('filterAndSortRecentChats: new institution does not see another institution activity chats', () => {
  const club65Activity = {
    id: 14,
    title: 'Yoga Suave',
    isInstitutional: true,
    isApproved: true,
    proposalStatus: 'aprobada',
    organizer: 'CLUB65',
    organizerId: 'usr_club65'
  };

  const club65Chat = {
    id: 'chat_14',
    activityId: 14,
    title: 'Grupo: Yoga Suave',
    type: 'grupal',
    creatorId: 'usr_club65',
    organizer: 'CLUB65',
    organizerId: 'usr_club65',
    participants: ['usr_club65', 'vecino_1'],
    messages: []
  };

  const club65User = {
    id: 'usr_club65',
    usuario: 'club65',
    apodo: 'CLUB65',
    tipo: 'institucional'
  };

  const otherInstUser = {
    id: 'usr_other_inst',
    usuario: 'centro_nuevo',
    apodo: 'Centro Nuevo',
    tipo: 'institucional'
  };

  const club65Chats = filterAndSortRecentChats([club65Chat], club65User, [club65Activity]);
  const otherInstChats = filterAndSortRecentChats([club65Chat], otherInstUser, [club65Activity]);

  assert.equal(club65Chats.length, 1);
  assert.equal(otherInstChats.length, 0);
});

test('institutional registration & approval gates are enforced across api.ts, AuthContext.tsx, App.tsx, and server.ts', () => {
  const apiSrc = readFileSync(resolve(process.cwd(), 'src/api.ts'), 'utf-8');
  const authCtxSrc = readFileSync(resolve(process.cwd(), 'src/context/AuthContext.tsx'), 'utf-8');
  const appSrc = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
  const serverSrc = readFileSync(resolve(process.cwd(), 'server.ts'), 'utf-8');

  // 1. api.ts getMe blocks unapproved institutional sessions
  assert.ok(
    apiSrc.includes("if (esInstitucional && estado !== 'aprobada')"),
    'api.ts must enforce estado === aprobada for institutional accounts'
  );

  // 2. api.ts register clears browser session for institutional signups and never auto-stores their ID
  assert.ok(
    apiSrc.includes('if (isInstitucionalReg)'),
    'api.ts register must branch explicitly for institutional registrations'
  );
  assert.ok(
    apiSrc.includes('clearBrowserSessionKeys()'),
    'api.ts must clear browser session keys on logout and pending institutional registration'
  );

  // 3. AuthContext.tsx never calls setCurrentUser with an unapproved institutional user
  assert.ok(
    authCtxSrc.includes("if (user.tipo === 'institucional' && user.estadoAlta !== 'aprobada')"),
    'AuthContext.register must keep currentUser null for pending institutional users'
  );

  // 4. App.tsx calls refreshData(null) and removes blind isInstitutional ownership checks
  assert.ok(
    appSrc.includes('await refreshData(null);'),
    'App.tsx handleRegister must pass null to refreshData after institutional signup'
  );
  assert.equal(
    appSrc.includes("currentUser?.tipo === 'institucional' && Boolean(a.isInstitutional)"),
    false,
    'App.tsx must not grant blind ownership to all institutional users via Boolean(a.isInstitutional)'
  );
  assert.equal(
    appSrc.includes("isInstMatch"),
    false,
    'App.tsx/chatLogic must not contain blind isInstMatch'
  );

  // 5. server.ts /api/auth/login blocks unapproved institutions
  assert.ok(
    serverSrc.includes("isInstUser && (user as any).estadoAlta !== 'aprobada'"),
    'server.ts login route must block unapproved institutional accounts'
  );
});
