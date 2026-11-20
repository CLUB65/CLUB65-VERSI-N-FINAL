import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterChatsForUser,
  validateRegistration,
  ChatItem,
  UserSession,
  getBlockedMessageForProfile,
  getBlockedMessageForActivity,
  getBlockedMessageForReviews,
  canUserUnblock,
  canRemoveParticipantFromGroup,
  isReportMotiveValid,
  cleanCommentOrDash,
  formatResolutionMeasure,
  getParticipantRoleLabel,
  getProposalSortingTime,
  isUserRemovedFromChat,
  getVisibleParticipantsForUser,
  isChatDeletedForUser,
  hasFirstEncounterStarted,
  hasFirstEncounterEnded,
  isActivityPast,
  parseDateToYMD,
  extractTimesFromSchedule,
  isUserVetoedFromChat,
  isUserVettedFromActivity,
  canUserEnrollActivity,
  getAgendaCalendarDays,
  getMyActivitiesSortingTime,
  isUserLeftVoluntarilyFromChat,
  isDummyOrSystemParticipant,
  filterRealParticipants,
  getPrivateChatResolvedTitle,
  isTechnicalIdentifier,
  isHardcodedOrMockProfile,
  getChatLastActivityTime,
  filterAndSortRecentChats,
  mapToSupabaseChatType,
  mapFromSupabaseChatType,
  chatIdentifierToBigInt,
  cleanSystemCreationMessage,
  isDuplicateMessage,
  deduplicateMessages,
  deduplicateChats,
  resolveSenderDisplayName,
  isUserGroupModerator,
  isSelfUserOrContact,
  filterContactsForUser,
  validateGroupCreation,
  getResolvedChatParticipants,
  isUserEnrolledInActivity,
  checkActivitiesCollision,
  getActivitySessions,
  isActivityEligibleForReview,
  canUserCreateActivity,
  checkActivityNameCollision,
  getActivityRealizadaStatusLabel,
  isActivityApproved,
  cleanGroupTitle,
  isMessageFromOtherUser,
  getChatUnreadCount,
  filterChatMessagesForUser,
  getUserChatClearedTimestamp,
  getUserChatDepartureTimestamp,
  isActivityRecurrent,
  getActivityRecurrenceType,
  matchActivityFrequency,
  matchActivityInitiative,
  getActivityStartDateYMD,
  matchActivityTiming,
  matchActivityCapacity,
  extractDynamicLocations,
  matchActivityLocation,
  filterCarteleraActivities,
  formatIncomingMessageToast,
  hasAgendaCancellationAlert,
  filterAgendaActivities,
  shouldOpenMessageMenuUpwards,
  getPinnedMessageFromList,
  resolveActivityById,
  resolveActivityForChat,
  buildAttendanceNomina,
  isAdministratorUser,
  isUserAdminByReference
} from './chatLogic';

test('validateRegistration requires valid data', () => {
  assert.equal(validateRegistration({}).valid, false);
  assert.equal(validateRegistration({ username: 'ab' }).valid, false);
  assert.equal(validateRegistration({ username: 'carola', nombre: 'Carola', clave: '12', email: 'test@mail.com' }).valid, false);
  assert.equal(validateRegistration({ username: 'carola', nombre: 'Carola', clave: '1234', email: 'notanemail' }).valid, false);
  assert.equal(validateRegistration({ username: 'carola', nombre: 'Carola Márquez', clave: '1234', email: 'carola@mail.com' }).valid, true);
});

test('filterChatsForUser filters chats based on role and participation', () => {
  const dummyChats: ChatItem[] = [
    { id: 1, title: 'Movilidad', subtitle: 'CEDEM', type: 'grupal', organizerId: 'institucional', allowedRoles: ['personal', 'institucional'] },
    { id: 10, title: 'Tejido', subtitle: 'Plaza', type: 'grupal', organizerId: 'personal', allowedRoles: ['personal'] },
    { id: 99, title: 'Admin Chat', subtitle: 'Seguridad', type: 'grupal', organizerId: 'moderador', allowedRoles: ['moderador'] },
    { id: 100, title: 'Carola', subtitle: 'Chat directo', type: 'privado', participants: ['moderador', 'personal'] },
  ];

  const visitante: UserSession = { id: 'vis', username: 'anon', rol: 'visitante', apodo: 'Visitante' };
  assert.equal(filterChatsForUser(dummyChats, visitante).length, 0);

  const personalUser: UserSession = { id: 'personal', username: 'carola', rol: 'personal', apodo: 'Carola' };
  const personalChats = filterChatsForUser(dummyChats, personalUser);
  assert.equal(personalChats.length, 3);
  assert.ok(personalChats.some(c => c.id === 1));
  assert.ok(personalChats.some(c => c.id === 10));
  assert.ok(personalChats.some(c => c.id === 100));

  const instUser: UserSession = { id: 'institucional', username: 'Municipio 3F', rol: 'institucional', apodo: 'Municipio 3F' };
  const instChats = filterChatsForUser(dummyChats, instUser);
  assert.equal(instChats.length, 1);
  assert.equal(instChats[0].id, 1);

  // Los usuarios administradores NUNCA pueden formar parte de grupos (solo ven sus chats privados 1 a 1)
  const adminUser: UserSession = { id: 'moderador', username: 'admin', rol: 'moderador', apodo: 'Admin' };
  const adminChats = filterChatsForUser(dummyChats, adminUser);
  assert.equal(adminChats.length, 1);
  assert.equal(adminChats[0].id, 100);
  assert.equal(adminChats[0].type, 'privado');
});

test('getBlockedMessageForProfile respects bidirectional blocking', () => {
  // If other user blocked me
  assert.equal(getBlockedMessageForProfile('Roberto Gómez', true, false), 'Roberto Gómez te ha bloqueado');
  // If I blocked the other user
  assert.equal(getBlockedMessageForProfile('Roberto Gómez', false, true), 'Has bloqueado a Roberto Gómez. Desbloquealo para ver su información.');
  // If neither blocked
  assert.equal(getBlockedMessageForProfile('Roberto Gómez', false, false), null);
});

test('getBlockedMessageForActivity shows correct messages for organizer blocking', () => {
  // If organizer blocked me
  assert.equal(getBlockedMessageForActivity(true, false), 'El organizador te ha bloqueado');
  // If I blocked the organizer
  assert.equal(getBlockedMessageForActivity(false, true), 'Desbloqueá al organizador para ver ubicación');
  // If neither blocked
  assert.equal(getBlockedMessageForActivity(false, false), null);
});

test('getBlockedMessageForReviews shows correct messages for reviews', () => {
  // If organizer blocked me
  assert.equal(getBlockedMessageForReviews(true, false), 'Reseñas no disponibles (el organizador te ha bloqueado)');
  // If I blocked the organizer
  assert.equal(getBlockedMessageForReviews(false, true), 'Reseñas no disponibles (desbloquea al organizador para ver reseñas)');
  // If neither blocked
  assert.equal(getBlockedMessageForReviews(false, false), null);
});

test('canUserUnblock enforces strict security policy', () => {
  // If other user blocked me, I cannot unblock
  assert.equal(canUserUnblock(true, false), false);
  // Even if both flags somehow true, other blocked me wins
  assert.equal(canUserUnblock(true, true), false);
  // If I blocked the user, I can unblock
  assert.equal(canUserUnblock(false, true), true);
  // If neither blocked, false
  assert.equal(canUserUnblock(false, false), false);
});

test('canRemoveParticipantFromGroup prevents self-removal from group moderation', () => {
  assert.equal(canRemoveParticipantFromGroup('carola', 'Carola Vecina Activa', 'carola'), false);
  assert.equal(canRemoveParticipantFromGroup('carola', 'Carola Vecina Activa', 'Carola Vecina Activa'), false);
  assert.equal(canRemoveParticipantFromGroup('carola', 'Carola Vecina Activa', 'Roberto Gómez'), true);
  assert.equal(canRemoveParticipantFromGroup('carola', 'Carola Vecina Activa', 'Marta Sánchez'), true);
});

test('isReportMotiveValid validates exact 9 report motives', () => {
  assert.equal(isReportMotiveValid('Spam'), true);
  assert.equal(isReportMotiveValid('Odio, abuso, o acoso'), true);
  assert.equal(isReportMotiveValid('Discurso violento'), true);
  assert.equal(isReportMotiveValid('Comportamientos ilegales'), true);
  assert.equal(isReportMotiveValid('Suplantación de identidad'), true);
  assert.equal(isReportMotiveValid('Suicidio o Autolesiones'), true);
  assert.equal(isReportMotiveValid('Terrorismo o extremismo'), true);
  assert.equal(isReportMotiveValid('Integridad cívica'), true);
  assert.equal(isReportMotiveValid('Contenido sexual'), true);
  assert.equal(isReportMotiveValid('Motivo inventado'), false);
});

test('cleanCommentOrDash returns "-" when empty or whitespace, never inventing', () => {
  assert.equal(cleanCommentOrDash(''), '-');
  assert.equal(cleanCommentOrDash('   '), '-');
  assert.equal(cleanCommentOrDash(undefined), '-');
  assert.equal(cleanCommentOrDash(null), '-');
  assert.equal(cleanCommentOrDash('Incumplimiento reiterado'), 'Incumplimiento reiterado');
});

test('formatResolutionMeasure describes specific measures taken', () => {
  assert.equal(
    formatResolutionMeasure({
      resolutionAction: 'ban_user',
      sanctionType: 'temporal_7',
      alsoDeletedContent: true,
      reportedUser: 'spammer'
    }),
    'Suspensión temporal por 7 días a @spammer y retiro de contenido reportado'
  );

  assert.equal(
    formatResolutionMeasure({
      resolutionAction: 'delete_content'
    }),
    'Retiro del contenido reportado de la plataforma'
  );

  assert.equal(
    formatResolutionMeasure({
      status: 'desestimado'
    }),
    'Caso desestimado al no evidenciar infracciones mayores a las normas comunitarias'
  );
});

test('getParticipantRoleLabel replaces Participante with Moderador', () => {
  assert.equal(getParticipantRoleLabel(true, false), 'Moderador');
  assert.equal(getParticipantRoleLabel(true, true), 'Moderador (Tú)');
  assert.equal(getParticipantRoleLabel(false, false), 'Participante');
  assert.equal(getParticipantRoleLabel(false, true), 'Participante (Tú)');
});

test('getProposalSortingTime correctly prioritizes resubmitted proposals then newer proposals', () => {
  // Activity A proposed at 10:00
  const actA = { id: 100, proposedAt: '25/10/2026, 10:00 hs' };
  // Activity B proposed at 10:10
  const actB = { id: 101, proposedAt: '25/10/2026, 10:10 hs' };
  assert.ok(getProposalSortingTime(actB) > getProposalSortingTime(actA));

  // Activity A resubmitted at 10:20 (after feedback) -> now A jumps above B
  const actAResubmitted = { ...actA, changesSubmittedAt: '25/10/2026, 10:20 hs' };
  assert.ok(getProposalSortingTime(actAResubmitted) > getProposalSortingTime(actB));

  // A brand new proposal C arrives at 10:30 -> C goes to the top (first), then A (second), then B (third)
  const actC = { id: 102, proposedAt: '25/10/2026, 10:30 hs' };
  assert.ok(getProposalSortingTime(actC) > getProposalSortingTime(actAResubmitted));
});

test('isUserRemovedFromChat detects when a user is in removedParticipants', () => {
  const chat = {
    type: 'grupal',
    participants: ['Carola Vecina Activa', 'Graciela Pérez'],
    removedParticipants: ['roberto', 'Roberto Gómez']
  };

  const userRoberto = { id: 'roberto_id', usuario: 'roberto', apodo: 'Roberto Gómez' };
  const userCarola = { id: 'personal', usuario: 'carola', apodo: 'Carola Vecina Activa' };

  assert.equal(isUserRemovedFromChat(chat, userRoberto), true);
  assert.equal(isUserRemovedFromChat(chat, userCarola), false);
  assert.equal(isUserRemovedFromChat({ type: 'privado' }, userRoberto), false);
});

test('getVisibleParticipantsForUser preserves removal snapshot for removed user while active users get live updates', () => {
  // Initial state: Carola (moderator), Roberto, Graciela
  const chatState1 = {
    type: 'grupal',
    participants: ['Carola Vecina Activa', 'Roberto Gómez', 'Graciela Pérez'],
    removedParticipants: [],
    participantsSnapshotOnRemoval: {}
  };

  const userCarola = { id: 'personal', usuario: 'carola', apodo: 'Carola Vecina Activa' };
  const userRoberto = { id: 'roberto_id', usuario: 'roberto', apodo: 'Roberto Gómez' };
  const userGraciela = { id: 'graciela_id', usuario: 'graciela', apodo: 'Graciela Pérez' };

  // All 3 see all 3 participants
  assert.deepEqual(getVisibleParticipantsForUser(chatState1, userRoberto), [
    'Carola Vecina Activa', 'Roberto Gómez', 'Graciela Pérez'
  ]);

  // Step 1: Moderator removes Roberto. Snapshot for Roberto is recorded!
  const chatState2 = {
    type: 'grupal',
    participants: ['Carola Vecina Activa', 'Graciela Pérez'],
    removedParticipants: ['roberto', 'Roberto Gómez'],
    participantsSnapshotOnRemoval: {
      roberto: ['Carola Vecina Activa', 'Roberto Gómez', 'Graciela Pérez'],
      'roberto gómez': ['Carola Vecina Activa', 'Roberto Gómez', 'Graciela Pérez']
    }
  };

  // Roberto sees the snapshot of who was there when he was removed:
  assert.deepEqual(getVisibleParticipantsForUser(chatState2, userRoberto), [
    'Carola Vecina Activa', 'Roberto Gómez', 'Graciela Pérez'
  ]);
  // Carola sees only the active participants:
  assert.deepEqual(getVisibleParticipantsForUser(chatState2, userCarola), [
    'Carola Vecina Activa', 'Graciela Pérez'
  ]);

  // Step 2: Moderator also removes Graciela later!
  const chatState3 = {
    type: 'grupal',
    participants: ['Carola Vecina Activa'],
    removedParticipants: ['roberto', 'Roberto Gómez', 'graciela', 'Graciela Pérez'],
    participantsSnapshotOnRemoval: {
      roberto: ['Carola Vecina Activa', 'Roberto Gómez', 'Graciela Pérez'],
      'roberto gómez': ['Carola Vecina Activa', 'Roberto Gómez', 'Graciela Pérez'],
      graciela: ['Carola Vecina Activa', 'Graciela Pérez'],
      'graciela pérez': ['Carola Vecina Activa', 'Graciela Pérez']
    }
  };

  // Active moderator Carola sees only herself now (list updated with deletions):
  assert.deepEqual(getVisibleParticipantsForUser(chatState3, userCarola), [
    'Carola Vecina Activa'
  ]);
  // Roberto STILL sees the 3 participants who were there when HE was removed:
  assert.deepEqual(getVisibleParticipantsForUser(chatState3, userRoberto), [
    'Carola Vecina Activa', 'Roberto Gómez', 'Graciela Pérez'
  ]);
  // Graciela sees the 2 participants who were there when SHE was removed:
  assert.deepEqual(getVisibleParticipantsForUser(chatState3, userGraciela), [
    'Carola Vecina Activa', 'Graciela Pérez'
  ]);
});

test('isChatDeletedForUser checks per-user deletion without affecting others', () => {
  const chat = {
    deletedForUserIds: ['personal', 'carola']
  };

  const userCarola = { id: 'personal', usuario: 'carola', apodo: 'Carola Vecina Activa' };
  const userRoberto = { id: 'roberto_id', usuario: 'roberto', apodo: 'Roberto Gómez' };

  assert.equal(isChatDeletedForUser(chat, userCarola), true);
  assert.equal(isChatDeletedForUser(chat, userRoberto), false);
  assert.equal(isChatDeletedForUser({}, userCarola), false);
});

test('hasFirstEncounterEnded determines review availability for recurring activities', () => {
  const establishedAct = { id: 'act_past_1', isRecurrent: true, firstEncounterDate: '2020-01-01', firstEncounterEndTime: '12:00' };
  assert.equal(hasFirstEncounterEnded(establishedAct), true);

  const futureRecurrentAct = {
    id: 123456,
    isRecurrent: true,
    firstEncounterDate: '2029-12-31',
    firstEncounterEndTime: '20:00'
  };
  assert.equal(hasFirstEncounterEnded(futureRecurrentAct), false);

  const pastRecurrentAct = {
    id: 123457,
    isRecurrent: true,
    firstEncounterDate: '2020-01-01',
    firstEncounterEndTime: '12:00'
  };
  assert.equal(hasFirstEncounterEnded(pastRecurrentAct), true);
});

test('isUserVetoedFromChat detects if user was vetoed from chat group', () => {
  const chat = {
    type: 'grupal',
    vetoedParticipants: ['roberto', 'Roberto Gómez']
  };
  const userRoberto = { id: 'r1', usuario: 'roberto', apodo: 'Roberto Gómez' };
  const userCarola = { id: 'c1', usuario: 'carola', apodo: 'Carola' };

  assert.equal(isUserVetoedFromChat(chat, userRoberto), true);
  assert.equal(isUserVetoedFromChat(chat, userCarola), false);
  assert.equal(isUserVetoedFromChat(null, userRoberto), false);
});

test('isUserVettedFromActivity and canUserEnrollActivity enforce rules', () => {
  const act = {
    id: 10,
    isRecurrent: true,
    firstEncounterDate: '2020-01-01',
    firstEncounterStartTime: '10:00',
    cerrarInscripcionAlIniciarPrimerEncuentro: true,
    vettedUsers: ['roberto']
  };
  const userRoberto = { id: 'r1', usuario: 'roberto', apodo: 'Roberto Gómez' };
  const userCarola = { id: 'c1', usuario: 'carola', apodo: 'Carola' };

  assert.equal(isUserVettedFromActivity(act, userRoberto), true);
  assert.equal(isUserVettedFromActivity(act, userCarola), false);

  // Roberto is vetted
  const resRob = canUserEnrollActivity(act, userRoberto);
  assert.equal(resRob.allowed, false);
  assert.ok(resRob.reason?.includes('vetado'));

  // Carola is not vetted, but act has started already and has cerrarInscripcionAlIniciarPrimerEncuentro
  const resCarola = canUserEnrollActivity(act, userCarola);
  assert.equal(resCarola.allowed, false);
  assert.ok(resCarola.reason?.includes('Inscripciones cerradas'));

  // Future recurring activity with cerrarInscripcion: false
  const futureAct = {
    id: 999123,
    isRecurrent: true,
    cerrarInscripcionAlIniciarPrimerEncuentro: false,
    firstEncounterDate: '2029-10-10',
    vettedUsers: []
  };
  assert.equal(canUserEnrollActivity(futureAct, userCarola).allowed, true);
});

test('getAgendaCalendarDays completely excludes cancelled activities', () => {
  const mockActivities = [
    { id: 1, title: 'Movilidad y elongación', schedule: '18:00 h', fechaRealizacion: '2026-10-06', proposalStatus: 'aprobada' },
    { id: 10, title: 'Tarde de Tejido, Cartas y Mate', schedule: '16.00 h', fechaRealizacion: '2026-10-14', proposalStatus: 'aprobada' },
    { id: 50, title: 'Taller Cancelado', schedule: '10:00 h', fechaRealizacion: '2026-10-24', proposalStatus: 'cancelada_organizador' }
  ];
  const user = { id: 'u1', usuario: 'carola', apodo: 'Carola' };

  const daysBefore = getAgendaCalendarDays(mockActivities, user, 2026, 9);
  assert.ok(daysBefore[6]); // Act 1
  assert.ok(daysBefore[14]); // Act 10
  assert.equal(daysBefore[24], undefined); // Act 50 was cancelled, NOT on calendar

  // Now simulate Act 1 is cancelled / baja_forzada
  const mockActivitiesWithBaja = [
    { id: 1, title: 'Movilidad y elongación', schedule: '18:00 h', fechaRealizacion: '2026-10-06', proposalStatus: 'baja_forzada', baja_forzada: true },
    { id: 10, title: 'Tarde de Tejido, Cartas y Mate', schedule: '16.00 h', fechaRealizacion: '2026-10-14', proposalStatus: 'aprobada' }
  ];
  const daysAfter = getAgendaCalendarDays(mockActivitiesWithBaja, user, 2026, 9);
  assert.equal(daysAfter[6], undefined); // Act 1 must NOT appear
  assert.ok(daysAfter[14]); // Act 10 still appears
});

test('isUserLeftVoluntarilyFromChat detects voluntary departure vs forced removal', () => {
  const chat = {
    id: 10,
    title: 'Grupo de Tejido',
    type: 'grupal' as const,
    subtitle: 'Canal',
    leftVoluntarilyParticipants: ['carola', 'carola márquez'],
    removedParticipants: ['roberto']
  };

  const userCarola = { id: 'c1', usuario: 'carola', apodo: 'Carola Márquez' };
  const userRoberto = { id: 'r1', usuario: 'roberto', apodo: 'Roberto Gómez' };
  const userMarta = { id: 'm1', usuario: 'marta', apodo: 'Marta' };

  assert.equal(isUserLeftVoluntarilyFromChat(chat, userCarola), true);
  assert.equal(isUserLeftVoluntarilyFromChat(chat, userRoberto), false);
  assert.equal(isUserLeftVoluntarilyFromChat(chat, userMarta), false);

  // Test snake_case support from Supabase
  const chatSupabase = {
    id: 11,
    type: 'grupal' as const,
    left_voluntarily_participants: ['carola'],
    removed_participants: ['roberto']
  };
  assert.equal(isUserLeftVoluntarilyFromChat(chatSupabase as any, userCarola), true);
  assert.equal(isUserRemovedFromChat(chatSupabase as any, userRoberto), true);

  // Test deleted_for_user_ids snake_case support
  const chatDeletedSb = {
    id: 12,
    deleted_for_user_ids: ['carola']
  };
  assert.equal(isChatDeletedForUser(chatDeletedSb as any, userCarola), true);
  assert.equal(isChatDeletedForUser(chatDeletedSb as any, userRoberto), false);

  // Test left_chats persistence via mock localStorage
  (globalThis as any).localStorage = {
    getItem(key: string) {
      if (key === 'left_chats_m1') return JSON.stringify(['99']);
      return null;
    }
  };
  const chatLeftLocal = { id: 99, type: 'grupal' as const };
  assert.equal(isUserLeftVoluntarilyFromChat(chatLeftLocal as any, userMarta), true);
  assert.equal(isUserLeftVoluntarilyFromChat(chatLeftLocal as any, userRoberto), false);
  delete (globalThis as any).localStorage;
});

test('getMyActivitiesSortingTime prioritizes admin cancellations, requested changes, accepted, and rejected proposals', () => {
  // Activity A initially proposed at t=100
  const actA = { id: 1, proposedTimestamp: 100 };
  // Activity B initially proposed at t=200
  const actB = { id: 2, proposedTimestamp: 200 };

  // Initially B is newer than A
  assert.ok(getMyActivitiesSortingTime(actB) > getMyActivitiesSortingTime(actA));

  // Admin cancels Activity A at t=300 -> Activity A jumps to the FIRST position!
  const actACancelled = { ...actA, bajaTimestamp: 300, bajaDate: '25/10/2026, 15:00 hs' };
  assert.ok(getMyActivitiesSortingTime(actACancelled) > getMyActivitiesSortingTime(actB));

  // A new activity C is added at t=400 -> C becomes FIRST, A becomes SECOND, B becomes THIRD
  const actC = { id: 3, proposedTimestamp: 400 };
  assert.ok(getMyActivitiesSortingTime(actC) > getMyActivitiesSortingTime(actACancelled));
  assert.ok(getMyActivitiesSortingTime(actACancelled) > getMyActivitiesSortingTime(actB));

  // Changes requested on Activity B at t=500 -> B becomes FIRST, C becomes SECOND, A becomes THIRD
  const actBChangesReq = { ...actB, changesRequestedTimestamp: 500 };
  assert.ok(getMyActivitiesSortingTime(actBChangesReq) > getMyActivitiesSortingTime(actC));
  assert.ok(getMyActivitiesSortingTime(actC) > getMyActivitiesSortingTime(actACancelled));

  // Proposal approved at t=600 -> jumps to FIRST
  const actCApproved = { ...actC, approvedTimestamp: 600 };
  assert.ok(getMyActivitiesSortingTime(actCApproved) > getMyActivitiesSortingTime(actBChangesReq));
});

test('isDummyOrSystemParticipant detects bots and hardcoded placeholder strings', () => {
  assert.equal(isDummyOrSystemParticipant('Sistema CLUB65'), true);
  assert.equal(isDummyOrSystemParticipant('sistema club65'), true);
  assert.equal(isDummyOrSystemParticipant('sistema'), true);
  assert.equal(isDummyOrSystemParticipant('Sistema'), true);
  assert.equal(isDummyOrSystemParticipant('Organizador'), true);
  assert.equal(isDummyOrSystemParticipant('organizador'), true);
  assert.equal(isDummyOrSystemParticipant('Organizador/a del grupo'), true);
  assert.equal(isDummyOrSystemParticipant('bot'), true);
  assert.equal(isDummyOrSystemParticipant(null), true);
  assert.equal(isDummyOrSystemParticipant(undefined), true);
  assert.equal(isDummyOrSystemParticipant('   '), true);

  // Real users must NOT be marked as dummy/system
  assert.equal(isDummyOrSystemParticipant('Marito'), false);
  assert.equal(isDummyOrSystemParticipant('Nerina'), false);
  assert.equal(isDummyOrSystemParticipant('Gustavo Mac'), false);
  assert.equal(isDummyOrSystemParticipant('Carola Vecina Activa'), false);
});

test('filterRealParticipants removes Sistema CLUB65 and Organizador from participant lists', () => {
  const dirty = ['Marito', 'Sistema CLUB65', 'Nerina', 'Organizador', '', null];
  const cleaned = filterRealParticipants(dirty);
  assert.deepEqual(cleaned, ['Marito', 'Nerina']);
});

test('getVisibleParticipantsForUser completely excludes Sistema CLUB65 and Organizador', () => {
  const dirtyChat = {
    type: 'grupal',
    participants: ['Marito', 'Sistema CLUB65', 'Nerina', 'Organizador'],
    removedParticipants: [],
    participantsSnapshotOnRemoval: {}
  };
  const userNerina = { id: 'usr_nerina', usuario: 'nerina', apodo: 'Nerina' };
  const visible = getVisibleParticipantsForUser(dirtyChat, userNerina);
  assert.deepEqual(visible, ['Marito', 'Nerina']);
});

test('isTechnicalIdentifier correctly detects technical IDs and protects human names', () => {
  assert.equal(isTechnicalIdentifier('c_1793946544401'), true);
  assert.equal(isTechnicalIdentifier('c1'), true);
  assert.equal(isTechnicalIdentifier('contact_1793153276770'), true);
  assert.equal(isTechnicalIdentifier('usr_1792968880322'), true);
  assert.equal(isTechnicalIdentifier('user_12345'), true);
  assert.equal(isTechnicalIdentifier('org_1793598624333'), true);
  assert.equal(isTechnicalIdentifier('part_3'), true);
  assert.equal(isTechnicalIdentifier('priv_45'), true);
  assert.equal(isTechnicalIdentifier('b554d3b9-a845-460e-ab1b-a437c55917f0'), true);

  // Human names and apodos must NEVER be detected as technical
  assert.equal(isTechnicalIdentifier('Nerina'), false);
  assert.equal(isTechnicalIdentifier('Marito'), false);
  assert.equal(isTechnicalIdentifier('Roberto Gómez'), false);
  assert.equal(isTechnicalIdentifier('CLUB65'), false);
  assert.equal(isTechnicalIdentifier('Graciela Pérez'), false);
});

test('getPrivateChatResolvedTitle resolves friendly name and prevents technical IDs', () => {
  const currentUser = { id: 'usr_nerina', apodo: 'Nerina', usuario: 'nerina' };

  // 1. Screenshot scenario: Chat with technical title and start message
  const chatScreenshot = {
    id: 'c_1793946544401',
    title: 'c_1793946544401',
    type: 'privado',
    participants: ['usr_nerina', 'c_1793946544401'],
    messages: [
      { sender: 'Sistema CLUB65', text: 'Se inició un chat privado con CLUB65.' }
    ]
  };
  assert.equal(getPrivateChatResolvedTitle(chatScreenshot, currentUser), 'CLUB65');

  // 2. Chat with scheduled contact
  const chatContact = {
    id: 'chat_123',
    title: 'c_1793946544401',
    type: 'privado',
    participants: ['usr_nerina', 'c_1793946544401'],
    messages: []
  };
  const contacts = [
    { id: 'c_1793946544401', nombre: 'Roberto Gómez', usuario: 'roberto' }
  ];
  assert.equal(getPrivateChatResolvedTitle(chatContact, currentUser, {}, contacts), 'Roberto Gómez');

  // 3. Bidirectional perspective: Nerina sees Marito, Marito sees Nerina
  const chatBetweenUsers = {
    id: 'b554d3b9-a845-460e-ab1b-a437c55917f0',
    title: 'Marito',
    type: 'privado',
    creatorName: 'Nerina',
    participants: ['Nerina', 'Marito', 'usr_nerina', 'usr_marito'],
    messages: [
      { sender: 'Sistema CLUB65', text: 'Se inició un chat privado con Marito.' }
    ]
  };
  const usersMap = {
    'usr_marito': { id: 'usr_marito', apodo: 'Marito', usuario: 'marito' },
    'usr_nerina': { id: 'usr_nerina', apodo: 'Nerina', usuario: 'nerina' }
  };

  // From Nerina's perspective:
  assert.equal(getPrivateChatResolvedTitle(chatBetweenUsers, currentUser, usersMap, []), 'Marito');

  // From Marito's perspective:
  const maritoUser = { id: 'usr_marito', apodo: 'Marito', usuario: 'marito' };
  assert.equal(getPrivateChatResolvedTitle(chatBetweenUsers, maritoUser, usersMap, []), 'Nerina');
});

test('isHardcodedOrMockProfile detects legacy seed profiles and protects real users', () => {
  // Legacy mock profiles
  assert.equal(isHardcodedOrMockProfile({ id: 'c1', nombre: 'Institución Comunitaria' }), true);
  assert.equal(isHardcodedOrMockProfile({ id: 'c2', nombre: 'Marta Sánchez' }), true);
  assert.equal(isHardcodedOrMockProfile({ id: 'c3', nombre: 'Graciela Pérez' }), true);
  assert.equal(isHardcodedOrMockProfile({ id: 'contact_1793153276770', nombre: 'Roberto Gómez' }), true);
  assert.equal(isHardcodedOrMockProfile({ nombre: 'Roberto Gómez', detalle: 'Caseros • Asiste a Movilidad' }), true);

  // Real user contacts
  assert.equal(isHardcodedOrMockProfile({ id: 'contact_1793948649951', nombre: 'Marito', detalle: 'Agendado' }), false);
  assert.equal(isHardcodedOrMockProfile({ id: 'contact_1793157108068', nombre: 'CLUB65', detalle: 'Comunidad' }), false);
  assert.equal(isHardcodedOrMockProfile({ id: 'usr_123', nombre: 'Nerina', detalle: 'Vecina' }), false);
});

test('getChatLastActivityTime computes correct epoch timestamp from messages or chat fields', () => {
  const chatWithMsgs = {
    id: 1,
    messages: [
      { id: 'msg_1', timestamp: 1000 },
      { id: 'msg_2', timestamp: 5000 }
    ]
  };
  assert.equal(getChatLastActivityTime(chatWithMsgs), 5000);

  const chatWithIso = {
    id: 2,
    messages: [
      { id: 'm1', createdAt: '2026-11-06T18:00:00.000Z' }
    ]
  };
  assert.equal(getChatLastActivityTime(chatWithIso), new Date('2026-11-06T18:00:00.000Z').getTime());

  const chatWithMsgId = {
    id: 3,
    messages: [
      { id: 'msg_1792992734494' }
    ]
  };
  assert.equal(getChatLastActivityTime(chatWithMsgId), 1792992734494);

  const emptyChatWithDate = {
    id: 4,
    created_at: '2026-11-06T12:00:00.000Z',
    messages: []
  };
  assert.equal(getChatLastActivityTime(emptyChatWithDate), new Date('2026-11-06T12:00:00.000Z').getTime());
});

test('filterAndSortRecentChats sorts the most recently active chat to the top', () => {
  const user = { id: 'usr_roberto', apodo: 'Roberto Pérez', usuario: 'rober' };
  const olderChat = {
    id: 'chat_1',
    title: 'Taller de Pintura',
    type: 'grupal',
    participants: ['Roberto Pérez', 'Nerina'],
    messages: [{ id: 'm1', text: 'Mensaje viejo', timestamp: 100000 }]
  };
  const newerChat = {
    id: 'chat_2',
    title: 'Caminatas Vecinales',
    type: 'grupal',
    participants: ['Roberto Pérez', 'Carlos'],
    messages: [{ id: 'm2', text: 'Mensaje recién enviado', timestamp: 200000 }]
  };

  // Initially chat_2 is newer
  const sorted = filterAndSortRecentChats([olderChat, newerChat], user);
  assert.equal(sorted[0].id, 'chat_2');
  assert.equal(sorted[1].id, 'chat_1');

  // When a new message is added to chat_1
  const updatedOlderChat = {
    ...olderChat,
    messages: [
      ...olderChat.messages,
      { id: 'm3', text: 'Nuevo mensaje en pintura!', timestamp: 300000 }
    ]
  };
  const reSorted = filterAndSortRecentChats([updatedOlderChat, newerChat], user);
  assert.equal(reSorted[0].id, 'chat_1'); // Now chat_1 is at the top!
  assert.equal(reSorted[1].id, 'chat_2');
});

test('filterAndSortRecentChats prevents other users private chats from leaking', () => {
  const currentUser = { id: 'usr_roberto', apodo: 'Roberto Pérez', usuario: 'rober' };

  // Supabase row of someone else's private chat with empty participants array
  const otherUsersChat = {
    id: 'priv_other',
    title: 'Marito',
    name: 'Marito',
    type: 'privado',
    creatorId: 'usr_someone_else',
    participants: [],
    messages: []
  };

  // My private chat with Nerina
  const myPrivateChat = {
    id: 'priv_mine',
    title: 'Nerina Macri',
    type: 'privado',
    creatorId: 'usr_roberto',
    participants: ['Roberto Pérez', 'Nerina Macri'],
    messages: [{ text: 'Hola Nerina' }]
  };

  const visible = filterAndSortRecentChats([otherUsersChat, myPrivateChat], currentUser);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'priv_mine');
  assert.ok(!visible.some(c => c.id === 'priv_other'));
});

test('filterAndSortRecentChats excludes degenerate chats with oneself', () => {
  const currentUser = { id: 'usr_roberto', apodo: 'Roberto Pérez', usuario: 'rober' };

  // A private chat mistakenly created with the user's own name as title and only participant
  const selfChat = {
    id: 'priv_self',
    title: 'Roberto Pérez',
    type: 'privado',
    creatorId: 'usr_roberto',
    participants: ['Roberto Pérez'],
    messages: [{ sender: 'Roberto Pérez', text: 'Hola a todos' }]
  };

  const visible = filterAndSortRecentChats([selfChat], currentUser);
  assert.equal(visible.length, 0);
});

test('filterAndSortRecentChats keeps group chats visible after user sends a message', () => {
  const currentUser = { id: 'usr_roberto', apodo: 'Roberto Pérez', usuario: 'rober' };

  const groupChat = {
    id: 'group_caminata',
    title: 'Compañeros de caminatas',
    type: 'grupal',
    creatorId: 'usr_roberto',
    participants: ['usr_roberto', 'Marta', 'Carlos'],
    messages: [
      { id: 'm1', sender: 'Roberto Pérez', text: 'Hola a todos en el grupo!', timestamp: Date.now() }
    ]
  };

  const visible = filterAndSortRecentChats([groupChat], currentUser);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].title, 'Compañeros de caminatas');
  assert.equal(visible[0].type, 'grupal');
});

test('mapToSupabaseChatType maps activity chats to grupo_actividad, free groups to grupo_libre, and private to privado', () => {
  // Activity chats must NEVER map to 'grupal' because Supabase Postgres enum chat_type rejects 'grupal'
  assert.equal(mapToSupabaseChatType('grupal', { isActivity: true }), 'grupo_actividad');
  assert.equal(mapToSupabaseChatType('grupal', { activityId: '1793931783797' }), 'grupo_actividad');
  assert.equal(mapToSupabaseChatType('grupo', { isActivity: true }), 'grupo_actividad');
  assert.equal(mapToSupabaseChatType('grupo_actividad', { isActivity: true }), 'grupo_actividad');
  assert.equal(mapToSupabaseChatType(null, { isActivity: true }), 'grupo_actividad');
  assert.equal(mapToSupabaseChatType(undefined, { activityId: 123 }), 'grupo_actividad');

  // Free/custom group chats (without activity)
  assert.equal(mapToSupabaseChatType('grupal'), 'grupo_libre');
  assert.equal(mapToSupabaseChatType('grupo'), 'grupo_libre');
  assert.equal(mapToSupabaseChatType('grupo_libre'), 'grupo_libre');
  assert.equal(mapToSupabaseChatType(null), 'grupo_libre');

  // Private chats
  assert.equal(mapToSupabaseChatType('privado'), 'privado');
  assert.equal(mapToSupabaseChatType('private'), 'privado');
  assert.equal(mapToSupabaseChatType('direct'), 'privado');
  assert.equal(mapToSupabaseChatType('directo'), 'privado');
});

test('mapFromSupabaseChatType converts database enum values to frontend chat types', () => {
  assert.equal(mapFromSupabaseChatType('grupo_actividad'), 'grupal');
  assert.equal(mapFromSupabaseChatType('grupo_libre'), 'grupal');
  assert.equal(mapFromSupabaseChatType('privado'), 'privado');
  assert.equal(mapFromSupabaseChatType(null), 'grupal');
  assert.equal(mapFromSupabaseChatType(undefined), 'grupal');
});

test('chatIdentifierToBigInt deterministically maps UUIDs, numbers, and strings to safe BIGINTs', () => {
  assert.equal(chatIdentifierToBigInt(1794008683478), 1794008683478);
  assert.equal(chatIdentifierToBigInt('1794008683478'), 1794008683478);
  const uuidBigInt1 = chatIdentifierToBigInt('b554d3b9-a845-460e-ab1b-a437c55917f0');
  const uuidBigInt2 = chatIdentifierToBigInt('b554d3b9-a845-460e-ab1b-a437c55917f0');
  assert.equal(uuidBigInt1, uuidBigInt2);
  assert.ok(uuidBigInt1 > 0);
  assert.ok(Number.isSafeInteger(uuidBigInt1));

  const strBigInt = chatIdentifierToBigInt('chat_1794012345');
  assert.ok(strBigInt > 0);
  assert.ok(Number.isSafeInteger(strBigInt));
});

test('cleanSystemCreationMessage removes technical identifiers (usr_...) from cartel notices', () => {
  const dirty1 = 'Se inició el grupo "Compañeros" con Nerina, usr_1792968880322.';
  assert.equal(cleanSystemCreationMessage(dirty1), 'Se inició el grupo "Compañeros" con Nerina.');
});

test('isDuplicateMessage and deduplicateMessages properly consolidate optimistic and server messages', () => {
  const optimisticMsg = {
    id: 'msg_1794012345000',
    sender: 'Gustavo Mac',
    text: 'Hola vecinos',
    timestamp: 1794012345000,
    time: '21:05 hs'
  };

  const serverMsg = {
    id: 'msg_1794012345100_abcde',
    sender: 'Gustavo Mac',
    text: 'Hola vecinos',
    timestamp: 1794012345100,
    time: '21:05 hs'
  };

  const differentMsg = {
    id: 'msg_1794012399000_xyz',
    sender: 'Gustavo Mac',
    text: 'Otro mensaje diferente',
    timestamp: 1794012399000,
    time: '21:06 hs'
  };

  assert.equal(isDuplicateMessage(optimisticMsg, serverMsg), true);
  assert.equal(isDuplicateMessage(optimisticMsg, differentMsg), false);

  const rawList = [optimisticMsg, serverMsg, differentMsg];
  const deduped = deduplicateMessages(rawList);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].text, 'Hola vecinos');
  assert.equal(deduped[1].text, 'Otro mensaje diferente');
});

test('deduplicateChats consolidates duplicate entries for the same group or activity', () => {
  const localChat = {
    id: 1794014479566,
    title: 'Grupo de Mate y Caminatas',
    type: 'grupal',
    creatorId: 'c1d312f2-bae5-4927-8920-5bc19d152bd1',
    creatorName: 'Gustavo Mac',
    messages: [
      { id: 'msg_1', sender: 'Gustavo Mac', text: 'Hola a todos', time: '10:00' }
    ]
  };

  const supabaseChat = {
    id: 'a45a42be-e499-4f4a-a7a9-6d3c3fe65179',
    title: 'Grupo de Mate y Caminatas',
    type: 'grupal',
    creatorId: 'c1d312f2-bae5-4927-8920-5bc19d152bd1',
    creatorName: 'Gustavo Mac',
    messages: [
      { id: 'msg_1', sender: 'Gustavo Mac', text: 'Hola a todos', time: '10:00' },
      { id: 'msg_2', sender: 'Marito', text: 'Hola Gustavo!', time: '10:01' }
    ]
  };

  const otherChat = {
    id: 'b554d3b9-a845-460e-ab1b-a437c55917f0',
    title: 'Marito',
    type: 'privado',
    messages: []
  };

  const chats = [localChat, supabaseChat, otherChat];
  const deduped = deduplicateChats(chats);
  assert.equal(deduped.length, 2);
  const consolidated = deduped.find(c => c.title === 'Grupo de Mate y Caminatas');
  assert.ok(consolidated);
  assert.equal(consolidated.id, 'a45a42be-e499-4f4a-a7a9-6d3c3fe65179'); // Prefers the UUID
  assert.equal(consolidated.messages.length, 2);
});

test('isActivityPast correctly identifies finished one-time activities from schedule', () => {
  const pastAct = {
    id: 1794008537834,
    title: 'PRUEBA RESEÑA',
    schedule: '06/11/2026 a las 21:00 h hasta las 21:30 h',
    isRecurrent: false
  };

  const futureAct = {
    id: 1793941271872,
    title: 'marito',
    schedule: '07/11/2026 a las 08:30 h hasta las 10:00 h',
    isRecurrent: false
  };

  // Evaluated at 2026-11-06T22:00:00-03:00 (after 21:30 hs)
  const afterFinishTime = new Date('2026-11-06T22:00:00-03:00');
  assert.equal(isActivityPast(pastAct, afterFinishTime), true);
  assert.equal(isActivityPast(futureAct, afterFinishTime), false);

  // Evaluated at 2026-11-06T20:30:00-03:00 (before 21:30 hs)
  const beforeFinishTime = new Date('2026-11-06T20:30:00-03:00');
  assert.equal(isActivityPast(pastAct, beforeFinishTime), false);
});

test('hasFirstEncounterStarted and Ended handle both YYYY-MM-DD and DD/MM/YYYY dates and hours', () => {
  const recurrentAct = {
    id: 1794008683478,
    title: 'PRUEBA RESEÑA 3',
    schedule: 'Semanal • 21:43 a 21:47 h • 12 encuentros',
    firstEncounterDate: '06/11/2026',
    firstEncounterStartTime: '21:43',
    firstEncounterEndTime: '21:47',
    isRecurrent: true,
    cerrarInscripcionAlIniciarPrimerEncuentro: true
  };

  const tBefore = new Date('2026-11-06T21:00:00-03:00');
  assert.equal(hasFirstEncounterStarted(recurrentAct, tBefore), false);
  assert.equal(hasFirstEncounterEnded(recurrentAct, tBefore), false);

  const tDuring = new Date('2026-11-06T21:45:00-03:00');
  assert.equal(hasFirstEncounterStarted(recurrentAct, tDuring), true);
  assert.equal(hasFirstEncounterEnded(recurrentAct, tDuring), false);

  const tAfter = new Date('2026-11-06T22:00:00-03:00');
  assert.equal(hasFirstEncounterStarted(recurrentAct, tAfter), true);
  assert.equal(hasFirstEncounterEnded(recurrentAct, tAfter), true);
});

test('canUserEnrollActivity blocks past activities and closed recurring encounters', () => {
  const user = { id: 'usr_test', usuario: 'testuser', apodo: 'Tester' };

  const finishedAct = {
    id: 1,
    title: 'Taller Pasado',
    schedule: '05/11/2026 a las 18:00 h hasta las 20:00 h',
    isRecurrent: false
  };

  const refNow = new Date('2026-11-06T22:00:00-03:00');
  const resPast = canUserEnrollActivity(finishedAct, user, refNow);
  assert.equal(resPast.allowed, false);
  assert.match(resPast.reason || '', /finalizado/i);

  const recurrentClosed = {
    id: 1794008683478,
    title: 'PRUEBA RESEÑA 3',
    schedule: 'Semanal • 21:43 a 21:47 h • 12 encuentros',
    firstEncounterDate: '2026-11-06',
    firstEncounterStartTime: '21:43',
    firstEncounterEndTime: '21:47',
    isRecurrent: true,
    cerrarInscripcionAlIniciarPrimerEncuentro: true
  };

  const resClosed = canUserEnrollActivity(recurrentClosed, user, refNow);
  assert.equal(resClosed.allowed, false);
  assert.match(resClosed.reason || '', /cerradas/i);

  const openRecurrent = {
    id: 3,
    title: 'Taller Futuro',
    schedule: 'Semanal • 10:00 a 12:00 h',
    firstEncounterDate: '10/11/2026',
    firstEncounterStartTime: '10:00',
    firstEncounterEndTime: '12:00',
    isRecurrent: true,
    cerrarInscripcionAlIniciarPrimerEncuentro: true
  };

  const resOpen = canUserEnrollActivity(openRecurrent, user, refNow);
  assert.equal(resOpen.allowed, true);
});

test('isDuplicateMessage reconciles messages with senderId or apodo even if display name differs slightly', () => {
  const optMsg = {
    id: 'msg_1794012345000',
    senderId: 'usr_123',
    sender: 'Juancito',
    text: 'Hola a todos',
    timestamp: 1794012345000,
    time: '21:05 hs'
  };

  const srvMsg = {
    id: 'msg_1794012345000',
    senderId: 'usr_123',
    sender: 'Juan Perez',
    text: 'Hola a todos',
    timestamp: 1794012345100,
    time: '21:05 hs'
  };

  assert.equal(isDuplicateMessage(optMsg, srvMsg), true);

  const deduped = deduplicateMessages([optMsg, srvMsg]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].text, 'Hola a todos');
});

test('filterAndSortRecentChats keeps custom group visible for creator and invited contact even if parts array was empty', () => {
  const creatorUser = { id: 'usr_c1', usuario: 'fede', apodo: 'Fede', nombre: 'Federico' };
  const invitedContact = { id: 'usr_m2', usuario: 'marito', apodo: 'Marito', nombre: 'Mario' };

  const customGroup = {
    id: 'grp_custom_walk',
    title: 'Compañeros de Caminata',
    type: 'grupal',
    creatorId: 'usr_c1',
    creatorName: 'Federico',
    participants: ['Federico', 'Marito'],
    messages: [
      {
        id: 'msg_init_1',
        senderId: 'sistema',
        sender: 'Sistema CLUB65',
        text: 'Se inició el grupo "Compañeros de Caminata" con Federico, Marito.',
        time: 'Ahora'
      }
    ]
  };

  const visibleForCreator = filterAndSortRecentChats([customGroup], creatorUser);
  assert.equal(visibleForCreator.length, 1);
  assert.equal(visibleForCreator[0].title, 'Compañeros de Caminata');

  const visibleForInvited = filterAndSortRecentChats([customGroup], invitedContact);
  assert.equal(visibleForInvited.length, 1);
  assert.equal(visibleForInvited[0].title, 'Compañeros de Caminata');

  // Even if participants array was temporarily empty during a Supabase sync:
  const syncedWithoutParts = {
    ...customGroup,
    participants: []
  };

  const visibleWhenSynced = filterAndSortRecentChats([syncedWithoutParts], invitedContact);
  assert.equal(visibleWhenSynced.length, 1);
  assert.equal(visibleWhenSynced[0].title, 'Compañeros de Caminata');
});

test('isHardcodedOrMockProfile flags Tita and Test User as mock profiles', () => {
  assert.equal(isHardcodedOrMockProfile({ id: '1793849767571', nombre: 'Tita' }), true);
  assert.equal(isHardcodedOrMockProfile({ id: 'usr_test_123', usuario: 'Test User' }), true);
  assert.equal(isHardcodedOrMockProfile({ id: 'any_id', apodo: 'tita' }), true);
  // Real users must NOT be flagged
  assert.equal(isHardcodedOrMockProfile({ id: 'usr_1793003176395_bi3dc', usuario: 'Nerina', apodo: 'Nerina' }), false);
  assert.equal(isHardcodedOrMockProfile({ id: 'usr_1793081503254_pcnbd', usuario: 'CLUB65', apodo: 'CLUB65' }), false);
  assert.equal(isHardcodedOrMockProfile({ id: '58d9efbd-c07c-418b-a29b-4ca670f6091d', usuario: 'marito', apodo: 'Marito' }), false);
});

test('resolveSenderDisplayName resolves human name from usersMap and prevents technical IDs', () => {
  const usersMap = {
    'usr_1793081503254_pcnbd': { id: 'usr_1793081503254_pcnbd', usuario: 'CLUB65', apodo: 'CLUB65' },
    'usr_1793003176395_bi3dc': { id: 'usr_1793003176395_bi3dc', usuario: 'Nerina', apodo: 'Nerina' }
  };

  // Resolves technical sender to real apodo
  assert.equal(resolveSenderDisplayName('usr_1793081503254_pcnbd', 'usr_1793081503254_pcnbd', usersMap), 'CLUB65');
  assert.equal(resolveSenderDisplayName('usr_1793003176395_bi3dc', 'usr_1793003176395_bi3dc', usersMap), 'Nerina');

  // Preserves already human names
  assert.equal(resolveSenderDisplayName('Marito', 'some_id', usersMap), 'Marito');
  assert.equal(resolveSenderDisplayName('Nerina', 'usr_1793003176395_bi3dc', usersMap), 'Nerina');

  // If technical ID is unknown, fallback to default (never raw technical ID)
  assert.equal(resolveSenderDisplayName('usr_unknown_12345', 'usr_unknown_12345', {}), 'Vecino');
  assert.equal(resolveSenderDisplayName('c1d312f2-bae5-4927-8920-5bc19d152bd1', 'c1d312f2-bae5-4927-8920-5bc19d152bd1', {}, 'Chat de Prueba'), 'Chat de Prueba');
});

test('isUserGroupModerator correctly verifies moderator rights for admins and designated participants', () => {
  const chat = {
    id: 101,
    title: 'Taller de Yoga',
    type: 'grupal',
    creatorId: 'usr_creator',
    creatorName: 'Carlos',
    adminUsernames: ['Carlos', 'Nerina', 'usr_1793003176395_bi3dc']
  };

  const designatedUser = { id: 'usr_1793003176395_bi3dc', usuario: 'nerina', apodo: 'Nerina' };
  const creatorUser = { id: 'usr_creator', usuario: 'carlos', apodo: 'Carlos' };
  const regularUser = { id: 'usr_regular', usuario: 'juan', apodo: 'Juan' };
  const globalAdmin = { id: 'usr_admin', usuario: 'moderador', tipo: 'moderador' };

  assert.equal(isUserGroupModerator(chat, designatedUser), true);
  assert.equal(isUserGroupModerator(chat, creatorUser), true);
  assert.equal(isUserGroupModerator(chat, globalAdmin), true);
  assert.equal(isUserGroupModerator(chat, regularUser), false);
});

test('deduplicateMessages keeps synthetic welcome banner at top and never appends it after user messages', () => {
  const realMsg1 = { id: 'msg_1', senderId: 'u1', sender: 'Juan', text: 'Hola a todos', createdAt: '2026-11-06T10:00:00Z' };
  const realMsg2 = { id: 'msg_2', senderId: 'u2', sender: 'Maria', text: 'Buenas tardes', createdAt: '2026-11-06T10:05:00Z' };
  const untimestampedWelcome = { id: 'm_init_101', senderId: 'sistema', sender: 'Sistema CLUB65', text: 'Bienvenidos al grupo de "Taller".' };

  // 1. Untimestamped synthetic welcome is omitted when real user messages already exist
  const result = deduplicateMessages([realMsg1, realMsg2, untimestampedWelcome]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'msg_1');
  assert.equal(result[1].id, 'msg_2');

  // 2. Official timestamped creation banner stays at index 0 (top)
  const timestampedWelcome = { id: 'm_init_101', senderId: 'sistema', sender: 'Sistema CLUB65', text: 'Bienvenidos al grupo de "Taller".', createdAt: '2026-11-06T09:00:00Z' };
  const resultWithTimestamp = deduplicateMessages([realMsg1, realMsg2, timestampedWelcome]);
  assert.equal(resultWithTimestamp.length, 3);
  assert.equal(resultWithTimestamp[0].id, 'm_init_101');
  assert.equal(resultWithTimestamp[1].id, 'msg_1');
  assert.equal(resultWithTimestamp[2].id, 'msg_2');
});

test('isSelfUserOrContact detects self correctly across tokens and contact IDs', () => {
  const userNeri = {
    id: 'usr_1793003176395_bi3dc',
    usuario: 'Nerina',
    apodo: 'Neri',
    nombre: 'Nerina Macri',
    email: 'macrinerina@yahoo.com.ar'
  };

  const userClub65 = {
    id: 'usr_1793081503254_pcnbd',
    usuario: 'CLUB65',
    apodo: 'CLUB65',
    institucion: 'CLUB65',
    email: 'fedevalen66@gmail.com'
  };

  // Self checks with string names
  assert.equal(isSelfUserOrContact('Nerina', userNeri), true);
  assert.equal(isSelfUserOrContact('Neri', userNeri), true);
  assert.equal(isSelfUserOrContact('nerina macri', userNeri), true);
  assert.equal(isSelfUserOrContact('usr_1793003176395_bi3dc', userNeri), true);
  assert.equal(isSelfUserOrContact('macrinerina@yahoo.com.ar', userNeri), true);

  assert.equal(isSelfUserOrContact('CLUB65', userClub65), true);
  assert.equal(isSelfUserOrContact('club65', userClub65), true);
  assert.equal(isSelfUserOrContact('usr_1793081503254_pcnbd', userClub65), true);

  // Contact objects
  assert.equal(isSelfUserOrContact({ id: 'c_1', nombre: 'Neri' }, userNeri), true);
  assert.equal(isSelfUserOrContact({ id: 'contact_usr_1793003176395_bi3dc_1794177858391', nombre: 'CLUB65' }, userNeri), true);
  assert.equal(isSelfUserOrContact({ id: 'c_2', nombre: 'CLUB65' }, userClub65), true);

  // Other users must return false
  assert.equal(isSelfUserOrContact('Marito', userNeri), false);
  assert.equal(isSelfUserOrContact({ id: 'contact_1794012615187', nombre: 'Marito' }, userNeri), false);
  assert.equal(isSelfUserOrContact('Gus', userClub65), false);
  assert.equal(isSelfUserOrContact({ id: 'c_gus', nombre: 'Gustavo' }, userClub65), false);
});

test('filterContactsForUser strictly excludes the current user and mock profiles', () => {
  const currentUser = {
    id: 'usr_1793081503254_pcnbd',
    usuario: 'CLUB65',
    apodo: 'CLUB65',
    nombre: 'CLUB65'
  };

  const rawContacts = [
    { id: 'c_self', nombre: 'CLUB65', detalle: 'Agendado' },
    { id: 'c_mock', nombre: 'Roberto Gómez', detalle: 'Carpintería' },
    { id: 'c_real1', nombre: 'Marito', detalle: 'Agendado' },
    { id: 'c_real2', nombre: 'Jazmín Canadé', detalle: 'Agendado' }
  ];

  const filtered = filterContactsForUser(rawContacts, currentUser);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].nombre, 'Marito');
  assert.equal(filtered[1].nombre, 'Jazmín Canadé');
  assert.ok(!filtered.some(c => c.nombre === 'CLUB65'));
  assert.ok(!filtered.some(c => c.nombre === 'Roberto Gómez'));
});

test('validateGroupCreation enforces a non-empty name and at least one other participant', () => {
  const currentUser = {
    id: 'usr_1793003176395_bi3dc',
    usuario: 'Nerina',
    apodo: 'Neri'
  };

  // 1. Missing or blank name
  assert.equal(validateGroupCreation('', ['Marito'], currentUser).valid, false);
  assert.equal(validateGroupCreation('   ', ['Marito'], currentUser).valid, false);

  // 2. Zero participants selected (empty list)
  const noParticipants = validateGroupCreation('Caminatas', [], currentUser);
  assert.equal(noParticipants.valid, false);
  assert.equal(noParticipants.error, 'Para crear un grupo debés invitar al menos a otro contacto.');

  // 3. User attempts to invite only themselves (should be rejected)
  const onlySelf = validateGroupCreation('Caminatas', ['Neri'], currentUser);
  assert.equal(onlySelf.valid, false);
  assert.equal(onlySelf.error, 'Para crear un grupo debés invitar al menos a otro contacto.');

  const onlySelfByUsername = validateGroupCreation('Caminatas', ['Nerina'], currentUser);
  assert.equal(onlySelfByUsername.valid, false);

  // 4. User invites self and another contact: self is discarded, other is accepted
  const selfAndOther = validateGroupCreation('Caminatas', ['Neri', 'Marito'], currentUser);
  assert.equal(selfAndOther.valid, true);
  assert.deepEqual(selfAndOther.cleanParticipants, ['Marito']);

  // 5. User invites multiple other contacts
  const multiValid = validateGroupCreation('Caminatas', ['Marito', 'Jazmín'], currentUser);
  assert.equal(multiValid.valid, true);
  assert.deepEqual(multiValid.cleanParticipants, ['Marito', 'Jazmín']);
});

test('filterAndSortRecentChats excludes orphaned free groups containing only oneself', () => {
  const currentUser = {
    id: 'usr_1793003176395_bi3dc',
    usuario: 'Nerina',
    apodo: 'Neri'
  };

  const selfOnlyGroup = {
    id: 'group_self',
    title: 'Mi Grupo Solo',
    type: 'grupal',
    creatorId: 'usr_1793003176395_bi3dc',
    creatorName: 'Nerina',
    participants: ['Nerina'],
    messages: [
      { id: 'm1', senderId: 'usr_1793003176395_bi3dc', sender: 'Nerina', text: 'Hola a mí misma', createdAt: '2026-11-08T12:00:00Z' }
    ]
  };

  const realGroup = {
    id: 'group_real',
    title: 'Grupo con Amigos',
    type: 'grupal',
    creatorId: 'usr_1793003176395_bi3dc',
    creatorName: 'Nerina',
    participants: ['Nerina', 'Marito'],
    messages: [
      { id: 'm2', senderId: 'usr_1793003176395_bi3dc', sender: 'Nerina', text: 'Hola Marito', createdAt: '2026-11-08T12:00:00Z' }
    ]
  };

  const visible = filterAndSortRecentChats([selfOnlyGroup, realGroup], currentUser);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'group_real');
});

test('getResolvedChatParticipants never duplicates a participant when designated as moderator', () => {
  const currentUser = {
    id: 'usr_1793003176395_bi3dc',
    usuario: 'Nerina',
    apodo: 'Neri',
    nombre: 'Nerina'
  };

  const allUsersMap = {
    'marito': { id: 'usr_1794012615187', usuario: 'marito123', apodo: 'Marito', nombre: 'Mario Gómez' },
    'usr_1794012615187': { id: 'usr_1794012615187', usuario: 'marito123', apodo: 'Marito', nombre: 'Mario Gómez' },
    'marito123': { id: 'usr_1794012615187', usuario: 'marito123', apodo: 'Marito', nombre: 'Mario Gómez' }
  };

  // Chat where Marito is a participant AND in adminUsernames by multiple alias tokens
  const chat = {
    id: 'c_test_1',
    creatorId: 'usr_1793003176395_bi3dc',
    creatorName: 'Nerina',
    participants: ['Marito', 'usr_1794012615187'],
    adminUsernames: ['Marito', 'marito123', 'usr_1794012615187'],
    messages: [
      { id: 'm1', sender: 'Marito', text: 'Hola a todos' },
      { id: 'm2', sender: 'Sistema CLUB65', senderId: 'sistema', text: 'Bienvenida', role: 'sistema' }
    ]
  };

  const resolved = getResolvedChatParticipants(chat, currentUser, allUsersMap);
  // Marito and Nerina (self) should appear EXACTLY once each
  const maritoEntries = resolved.filter(p => p.displayName === 'Marito');
  assert.equal(maritoEntries.length, 1, 'Marito must appear exactly once even with multiple admin tokens and participant aliases');
  assert.equal(maritoEntries[0].isAdmin, true, 'Marito must have isAdmin: true');

  const neriEntries = resolved.filter(p => p.isSelf);
  assert.equal(neriEntries.length, 1, 'Current user must appear exactly once');
  assert.equal(neriEntries[0].isAdmin, true, 'Creator must be admin');

  // Verify total participants is exactly 2 (no duplicates, no system bots)
  assert.equal(resolved.length, 2);
  assert.ok(!resolved.some(p => p.displayName.includes('Sistema')));
});

test('getResolvedChatParticipants recovers participants who sent messages or are referenced by technical user ID', () => {
  const currentUser = {
    id: 'usr_1793003176395_bi3dc',
    usuario: 'Nerina',
    apodo: 'Neri'
  };

  const allUsersMap = {
    'usr_carlos_99': { id: 'usr_carlos_99', usuario: 'carlitos', apodo: 'Carlos', nombre: 'Carlos V.' },
    'jazmin': { id: 'usr_jazmin_88', usuario: 'jazmin', apodo: 'Jazmín', nombre: 'Jazmín Canadé' }
  };

  // Chat where Carlos is referenced only by technical ID in participants,
  // and Jazmín is not in participants array at all but sent messages in the group
  const chat = {
    id: 'c_test_2',
    creatorId: 'usr_1793003176395_bi3dc',
    creatorName: 'Nerina',
    participants: ['usr_carlos_99'],
    messages: [
      { id: 'm1', sender: 'Jazmín', text: '¡Hola a todos!' }
    ]
  };

  const resolved = getResolvedChatParticipants(chat, currentUser, allUsersMap);

  // Carlos must be resolved to 'Carlos' rather than omitted
  const carlos = resolved.find(p => p.displayName === 'Carlos');
  assert.ok(carlos, 'Carlos must appear in participant list');
  assert.equal(carlos?.userId, 'usr_carlos_99');

  // Jazmín must appear because she participates in the conversation
  const jazmin = resolved.find(p => p.displayName === 'Jazmín');
  assert.ok(jazmin, 'Jazmín must appear because she sent messages in the group');

  // Total should be: Nerina (self), Carlos, Jazmín = 3
  assert.equal(resolved.length, 3);
});

test('pinned message identification resolves correct message and persists on chat', () => {
  const messages = [
    { id: 'msg_1', sender: 'Nerina', text: 'Primer mensaje', isPinned: false },
    { id: 'msg_2', sender: 'Marito', text: 'Aviso importante para el encuentro', isPinned: true },
    { id: 'msg_3', sender: 'Carlos', text: 'Entendido!', isPinned: false }
  ];

  const pinned = messages.find(m => m.isPinned);
  assert.ok(pinned);
  assert.equal(pinned?.id, 'msg_2');
  assert.equal(pinned?.text, 'Aviso importante para el encuentro');
});

test('deduplicateMessages preserves replyTo when merged with message without replyTo', () => {
  const initialMessages = [
    {
      id: 'msg_client_1',
      sender: 'Nerina',
      text: 'Respondiendo a tu pregunta',
      replyTo: {
        id: 'msg_orig_1',
        sender: 'Carlos',
        text: '¿A qué hora nos encontramos?'
      }
    }
  ];

  // Incoming sync update where replyTo might be undefined or missing
  const incomingMessages = [
    {
      id: 'msg_client_1',
      sender: 'Nerina',
      text: 'Respondiendo a tu pregunta',
      time: '14:30 hs'
    }
  ];

  const merged = deduplicateMessages([...initialMessages, ...incomingMessages]);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].replyTo, 'replyTo must be preserved after merge');
  assert.equal(merged[0].replyTo.sender, 'Carlos');
  assert.equal(merged[0].replyTo.text, '¿A qué hora nos encontramos?');
});

test('deduplicateMessages parses stringified reply_to from database and discards synthetic flags', () => {
  const messagesFromDb = [
    {
      id: 'msg_101',
      sender: 'Carlos',
      text: 'Totalmente de acuerdo',
      reply_to: JSON.stringify({
        id: 'msg_orig_2',
        sender: 'Graciela',
        text: 'Llevo el termo y mate'
      })
    },
    {
      id: 'msg_102',
      sender: 'Sistema CLUB65',
      text: 'Bienvenida',
      reply_to: { is_group_init: true }
    }
  ];

  const deduped = deduplicateMessages(messagesFromDb);
  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped[0].replyTo, {
    id: 'msg_orig_2',
    sender: 'Graciela',
    text: 'Llevo el termo y mate'
  });
  assert.equal(deduped[1].replyTo, undefined, 'is_group_init must not be treated as a user reply');
});

test('filterAndSortRecentChats lists chats with new incoming messages even if participants was empty', () => {
  const user = { id: 'usr_me', usuario: 'me_user', apodo: 'Mi Apodo' };
  const incomingChat = {
    id: 'chat_priv_123',
    type: 'privado',
    title: 'Mi Apodo & Roberto',
    participants: [],
    messages: [
      { id: 'm1', senderId: 'usr_roberto', sender: 'Roberto', text: '¡Hola! ¿Cómo estás?', createdAt: '2026-11-08T18:00:00Z' }
    ]
  };

  const list = filterAndSortRecentChats([incomingChat], user, []);
  assert.equal(list.length, 1, 'Incoming private chat must appear in recent chats list');
  assert.equal(list[0].id, 'chat_priv_123');
});

test('getResolvedChatParticipants excludes removed participants even if they sent previous messages', () => {
  const currentUser = { id: 'usr_mod', usuario: 'moderador_pepe', apodo: 'Pepe Mod' };
  const allUsersMap = {
    carlos: { id: 'usr_carlos', usuario: 'carlos', apodo: 'Carlos' }
  };
  const chat = {
    id: 'grp_test',
    type: 'grupal',
    creatorId: 'usr_mod',
    creatorName: 'Pepe Mod',
    participants: ['Pepe Mod'],
    removedParticipants: ['Carlos', 'carlos', 'usr_carlos'],
    messages: [
      { id: 'm1', senderId: 'usr_carlos', sender: 'Carlos', text: 'Hola a todos' }
    ]
  };

  const participants = getResolvedChatParticipants(chat, currentUser, allUsersMap);
  const foundCarlos = participants.find(p => p.displayName.toLowerCase() === 'carlos');
  assert.equal(foundCarlos, undefined, 'Carlos must not appear in participants list after removal');
  assert.equal(participants.length, 1);
  assert.equal(participants[0].displayName, 'Pepe Mod');
});

test('getResolvedChatParticipants extracts removed participant from system removal message even if removedParticipants array is missing', () => {
  const currentUser = { id: 'usr_mod', usuario: 'mod', apodo: 'Moderador' };
  const allUsersMap = {
    marta: { id: 'usr_marta', usuario: 'marta', apodo: 'Marta' }
  };
  const chat = {
    id: 'grp_test_sys',
    type: 'grupal',
    creatorId: 'usr_mod',
    creatorName: 'Moderador',
    participants: ['Moderador', 'Marta'],
    messages: [
      { id: 'm1', senderId: 'usr_marta', sender: 'Marta', text: 'Hola a todos' },
      { id: 'm2', senderId: 'sistema', sender: 'Sistema CLUB65', role: 'sistema', text: 'Marta fue retirado del grupo por el moderador del grupo.' }
    ]
  };

  const participants = getResolvedChatParticipants(chat, currentUser, allUsersMap);
  const foundMarta = participants.find(p => p.displayName.toLowerCase() === 'marta');
  assert.equal(foundMarta, undefined, 'Marta must be excluded because system message states she was removed');
  assert.equal(participants.length, 1);
  assert.equal(participants[0].displayName, 'Moderador');
});

test('getResolvedChatParticipants re-admits participant when subsequent system message shows they were added back', () => {
  const currentUser = { id: 'usr_mod', usuario: 'mod', apodo: 'Moderador' };
  const allUsersMap = {
    marta: { id: 'usr_marta', usuario: 'marta', apodo: 'Marta' }
  };
  const chat = {
    id: 'grp_test_readd',
    type: 'grupal',
    creatorId: 'usr_mod',
    creatorName: 'Moderador',
    participants: ['Moderador'],
    removedParticipants: ['marta'],
    messages: [
      { id: 'm1', senderId: 'usr_marta', sender: 'Marta', text: 'Hola a todos' },
      { id: 'm2', senderId: 'sistema', sender: 'Sistema CLUB65', role: 'sistema', text: 'Marta fue retirado del grupo por el moderador del grupo.' },
      { id: 'm3', senderId: 'sistema', sender: 'Sistema CLUB65', role: 'sistema', text: 'Marta fue agregado al grupo por el moderador del grupo.', replyTo: { event: 'participant_added', participant: 'Marta' } }
    ]
  };

  const participants = getResolvedChatParticipants(chat, currentUser, allUsersMap);
  const foundMarta = participants.find(p => p.displayName.toLowerCase() === 'marta');
  assert.notEqual(foundMarta, undefined, 'Marta must be present because she was re-added');
  assert.equal(foundMarta?.displayName, 'Marta');
  assert.equal(participants.length, 2);
});

test('isUserGroupModerator recognizes creator from msg_init in chat.messages even when chat.creatorId is undefined', () => {
  const neri = { id: 'usr_1793003176395_bi3dc', usuario: 'neri', apodo: 'Neri', tipo: 'personal' };
  const chatWithoutCreatorField = {
    id: '02e83fe5-0175-4556-b6dd-c03166ae351d',
    title: 'Maritos Crew',
    type: 'grupal',
    creatorId: undefined,
    creatorName: undefined,
    participants: ['Marito'],
    messages: [
      {
        id: 'msg_init_1794177897051',
        text: 'Se inició el grupo "Maritos Crew" con Neri, CLUB65, Marito.',
        replyTo: {
          title: 'Maritos Crew',
          creatorId: 'usr_1793003176395_bi3dc',
          creatorName: 'Neri',
          participants: ['Neri', 'CLUB65', 'Marito'],
          is_group_init: true,
          adminUsernames: ['Neri']
        }
      }
    ]
  };

  assert.equal(isUserGroupModerator(chatWithoutCreatorField, neri), true);
});

test('isUserGroupModerator recognizes moderator designated via make_admin in chat.messages', () => {
  const marito = { id: '58d9efbd-c07c-418b-a29b-4ca670f6091d', usuario: 'marito', apodo: 'Marito', tipo: 'personal' };
  const chat = {
    id: '02e83fe5-0175-4556-b6dd-c03166ae351d',
    title: 'Maritos Crew',
    type: 'grupal',
    creatorId: 'usr_other',
    messages: [
      {
        id: 'msg_adm_1794177908624_u4r5',
        text: 'Sistema CLUB65: Marito fue designado/a moderador/a del grupo.',
        replyTo: {
          action: 'make_admin',
          participant: 'Marito',
          participantId: '58d9efbd-c07c-418b-a29b-4ca670f6091d',
          adminUsernames: ['Neri', 'Marito']
        }
      }
    ]
  };

  assert.equal(isUserGroupModerator(chat, marito), true);
});

test('getResolvedChatParticipants recovers participant from participant_added notice even if chat.participants was empty', () => {
  const currentUser = { id: 'usr_mod', usuario: 'mod', apodo: 'Moderador' };
  const allUsersMap = {
    club65: { id: 'usr_club65', usuario: 'club65', apodo: 'CLUB65' }
  };
  const chat = {
    id: 'grp_empty_parts',
    type: 'grupal',
    creatorId: 'usr_mod',
    creatorName: 'Moderador',
    participants: [],
    messages: [
      {
        id: 'sys_add_123',
        senderId: 'sistema',
        role: 'sistema',
        text: 'CLUB65 fue agregado al grupo por el moderador del grupo.',
        replyTo: {
          event: 'participant_added',
          participant: 'CLUB65'
        }
      }
    ]
  };

  const participants = getResolvedChatParticipants(chat, currentUser, allUsersMap);
  const foundClub = participants.find(p => p.displayName.toLowerCase() === 'club65');
  assert.notEqual(foundClub, undefined, 'CLUB65 must be present in resolved list');
  assert.equal(foundClub?.displayName, 'CLUB65');
});

test('isUserRemovedFromChat and getResolvedChatParticipants accurately reflect re-addition over older removals with tokens', () => {
  const neri = { id: 'usr_neri', usuario: 'neri', apodo: 'Neri' };
  const club65 = { id: 'usr_1793081503254_pcnbd', usuario: 'club65', apodo: 'CLUB65' };
  const allUsersMap = {
    'usr_1793081503254_pcnbd': club65,
    'club65': club65
  };

  const chat = {
    id: '02e83fe5-0175-4556-b6dd-c03166ae351d',
    title: 'Maritos Crew',
    type: 'grupal',
    creatorId: 'usr_neri',
    creatorName: 'Neri',
    participants: ['Neri'],
    removedParticipants: ['club65', 'usr_1793081503254_pcnbd', 'CLUB65'],
    messages: [
      {
        id: 'msg_init',
        text: 'Se inició el grupo "Maritos Crew" con Neri, CLUB65.',
        timestamp: 1000,
        replyTo: { is_group_init: true, participants: ['Neri', 'CLUB65'] }
      },
      {
        id: 'sys_rem_1',
        senderId: 'sistema',
        role: 'sistema',
        text: 'CLUB65 fue retirado del grupo por el moderador del grupo.',
        timestamp: 2000,
        replyTo: { event: 'participant_removed', participant: 'CLUB65', participantTokens: ['club65', 'usr_1793081503254_pcnbd', 'CLUB65'] }
      },
      {
        id: 'sys_add_1',
        senderId: 'sistema',
        role: 'sistema',
        text: 'CLUB65 fue agregado al grupo por el moderador del grupo.',
        timestamp: 3000,
        replyTo: { event: 'participant_added', participant: 'CLUB65', participantId: 'usr_1793081503254_pcnbd', participantTokens: ['club65', 'usr_1793081503254_pcnbd', 'CLUB65'] }
      }
    ]
  };

  // 1. isUserRemovedFromChat must return false because addition happened after removal
  assert.equal(isUserRemovedFromChat(chat, club65), false);

  // 2. getResolvedChatParticipants must include CLUB65 and Neri
  const parts = getResolvedChatParticipants(chat, neri, allUsersMap);
  assert.ok(parts.some(p => p.displayName.toLowerCase() === 'club65'));
  assert.ok(parts.some(p => p.displayName.toLowerCase() === 'neri'));
  assert.equal(parts.length, 2);
});

test('deduplicateMessages consolidates repeated system notices with different random IDs into a single cartelito', () => {
  const m1 = {
    id: 'sys_add_1794197829852_dw07',
    senderId: 'sistema',
    sender: 'Sistema CLUB65',
    role: 'sistema',
    text: 'Neri fue agregado al grupo por el moderador del grupo.',
    created_at: '2026-11-09T04:17:09.852+00:00',
    reply_to: { event: 'participant_added', participant: 'Neri' }
  };
  const m2 = {
    id: 'sys_add_1794197830059_bbhw',
    senderId: 'sistema',
    sender: 'Sistema CLUB65',
    role: 'sistema',
    text: 'Neri fue agregado al grupo por el moderador del grupo.',
    created_at: '2026-11-09T04:17:10.060+00:00',
    reply_to: { event: 'participant_added', participant: 'Neri' }
  };
  const m3 = {
    id: 'sys_add_1794197830200_local',
    senderId: 'sistema',
    sender: 'Sistema CLUB65',
    role: 'sistema',
    text: 'Neri fue agregado al grupo por el moderador del grupo.',
    time: 'Ahora'
  };

  const deduped = deduplicateMessages([m1, m2, m3]);
  assert.equal(deduped.length, 1, 'Should keep only 1 cartelito');
  assert.equal(deduped[0].text, 'Neri fue agregado al grupo por el moderador del grupo.');
});

test('filterAndSortRecentChats excludes corrupted group names like "de", "?", or "Grupo <UUID>"', () => {
  const user = { id: 'usr_gus', usuario: 'gus', apodo: 'Gustavo Mac' };
  const goodGroup = { id: 'g1', title: 'Los mejores usuarios', type: 'grupal', participants: ['Gustavo Mac', 'Neri'], messages: [] };
  const deGroup = { id: 'g2', title: 'de', type: 'grupal', participants: ['Gustavo Mac'], messages: [] };
  const questionGroup = { id: 'g3', title: '?', type: 'grupal', participants: ['Gustavo Mac'], messages: [] };
  const uuidGroup = { id: 'g4', title: 'Grupo 276e118b-e436-422f-9f07-f2438638fa84', type: 'grupal', participants: ['Gustavo Mac'], messages: [] };

  const visible = filterAndSortRecentChats([goodGroup, deGroup, questionGroup, uuidGroup], user);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].title, 'Los mejores usuarios');
});

test('isUserEnrolledInActivity matches user by apodo, usuario, or id and excludes organizer', () => {
  const user = { id: 'usr_123', usuario: 'Nerina', apodo: 'Neri', nombre: 'Nerina Gomez' };

  // Enrolled with 'Nerina' (matches usuario even though apodo is 'Neri')
  const act1 = { id: 'act1', organizerId: 'usr_other', enrolled_usernames: ['Nerina', 'Juan'] };
  assert.equal(isUserEnrolledInActivity(act1, user), true);

  // Enrolled with 'Neri'
  const act2 = { id: 'act2', organizerId: 'usr_other', enrolled_usernames: ['Neri'] };
  assert.equal(isUserEnrolledInActivity(act2, user), true);

  // User is organizer -> not considered enrolled as participant
  const actOrg = { id: 'actOrg', organizerId: 'usr_123', enrolled_usernames: ['Nerina'] };
  assert.equal(isUserEnrolledInActivity(actOrg, user), false);

  // User not enrolled
  const act3 = { id: 'act3', organizerId: 'usr_other', enrolled_usernames: ['Carlos', 'Maria'] };
  assert.equal(isUserEnrolledInActivity(act3, user), false);
});

test('checkActivitiesCollision detects 15-minute and full schedule overlaps on the same day', () => {
  // Activity A: 06/11/2026 21:00 to 21:30
  const actA = {
    id: 'actA',
    title: 'PRUEBA RESEÑA',
    date: '06/11/2026',
    time: '21:00',
    schedule: '06/11/2026 a las 21:00 h hasta las 21:30 h'
  };

  // Activity B: identical 21:00 to 21:30
  const actB = {
    id: 'actB',
    title: 'PRUEBA RESEÑA 2',
    date: '06/11/2026',
    time: '21:00',
    schedule: '06/11/2026 a las 21:00 h hasta las 21:30 h'
  };

  const collisionExact = checkActivitiesCollision(actA, actB);
  assert.equal(collisionExact.hasCollision, true);
  assert.ok(collisionExact.reason?.includes('superpone'));

  // Activity C: 15 minute overlap (21:15 to 22:00 overlaps with 21:00 to 21:30)
  const actC = {
    id: 'actC',
    title: 'Yoga Nocturno',
    date: '06/11/2026',
    time: '21:15',
    schedule: '06/11/2026 a las 21:15 h hasta las 22:00 h'
  };
  const collisionPartial = checkActivitiesCollision(actA, actC);
  assert.equal(collisionPartial.hasCollision, true);

  // Activity D: contiguous back-to-back (21:30 to 22:30 does NOT overlap with 21:00 to 21:30)
  const actD = {
    id: 'actD',
    title: 'Caminata',
    date: '06/11/2026',
    time: '21:30',
    schedule: '06/11/2026 a las 21:30 h hasta las 22:30 h'
  };
  const collisionBackToBack = checkActivitiesCollision(actA, actD);
  assert.equal(collisionBackToBack.hasCollision, false);

  // Activity E: different date
  const actE = {
    id: 'actE',
    title: 'Pintura',
    date: '07/11/2026',
    time: '21:00',
    schedule: '07/11/2026 a las 21:00 h hasta las 21:30 h'
  };
  const collisionDiffDate = checkActivitiesCollision(actA, actE);
  assert.equal(collisionDiffDate.hasCollision, false);
});

test('canUserEnrollActivity blocks enrollment when user has another overlapping activity', () => {
  const futureDateObj = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const yyyy = futureDateObj.getUTCFullYear();
  const mm = String(futureDateObj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(futureDateObj.getUTCDate()).padStart(2, '0');
  const isoFuture = `${yyyy}-${mm}-${dd}`;
  const argFuture = `${dd}/${mm}/${yyyy}`;

  const user = { id: 'usr_neri', usuario: 'Nerina', apodo: 'Neri' };
  const existingEnrolled = [
    {
      id: 'act1',
      title: 'Taller de Memoria',
      date: isoFuture,
      time: '10:00',
      schedule: `${argFuture} a las 10:00 h hasta las 11:30 h`,
      organizerId: 'usr_other',
      enrolled_usernames: ['Nerina']
    }
  ];

  // Conflicting activity: same future date 11:00 to 12:00 (overlaps by 30 mins)
  const conflictingAct = {
    id: 'act2',
    title: 'Gimnasia Adaptada',
    date: isoFuture,
    time: '11:00',
    schedule: `${argFuture} a las 11:00 h hasta las 12:00 h`,
    organizerId: 'usr_other2',
    enrolled_usernames: []
  };

  const checkBlocked = canUserEnrollActivity(conflictingAct, user, existingEnrolled);
  assert.equal(checkBlocked.canEnroll, false);
  assert.ok(checkBlocked.reason?.includes('Superposición de horario'));
  assert.ok(checkBlocked.reason?.includes('Taller de Memoria'));

  // Non-conflicting activity: same future date 14:00 to 15:00
  const okAct = {
    id: 'act3',
    title: 'Ajedrez',
    date: isoFuture,
    time: '14:00',
    schedule: `${argFuture} a las 14:00 h hasta las 15:00 h`,
    organizerId: 'usr_other3',
    enrolled_usernames: []
  };

  const checkOk = canUserEnrollActivity(okAct, user, existingEnrolled);
  assert.equal(checkOk.canEnroll, true);
});

test('isUserEnrolledInActivity checks enrolled_usernames even if enrolledUsernames is an empty array', () => {
  const user = { id: 'usr_neri', usuario: 'Nerina', apodo: 'Neri' };
  const act = {
    id: '1794258492651',
    title: 'Actividad 2',
    enrolledUsernames: [],
    enrolled_usernames: ['Neri'],
    organizerId: 'usr_other'
  };

  assert.equal(isUserEnrolledInActivity(act, user), true);
});

test('isActivityPast marks recurring activity as past once all encounters have completed', () => {
  // 4 encounters in October 2026, starting 2026-10-01
  const finishedRecurrent = {
    id: 'rec_finished',
    title: 'Taller de Pintura de Octubre',
    isRecurrent: true,
    schedule: 'Semanal (Lunes, Jueves) • 10:00 a 11:30 h • 4 encuentros',
    firstEncounterDate: '2026-10-01'
  };

  const refNow = new Date('2026-11-09T18:00:00-03:00');
  assert.equal(isActivityPast(finishedRecurrent, refNow), true);

  // 12 encounters starting Nov 6, ending Nov 17
  const ongoingRecurrent = {
    id: '1794008683478',
    title: 'PRUEBA RESEÑA 3',
    isRecurrent: true,
    schedule: 'Semanal (Lunes, Jueves, Miércoles, Viernes, Sábado, Domingo, Martes) • 21:43 a 21:47 h • 12 encuentros',
    first_encounter_date: '2026-11-06'
  };

  assert.equal(isActivityPast(ongoingRecurrent, refNow), false);
});

test('isActivityEligibleForReview only enables reviews for activities that have already taken place', () => {
  const refNow = new Date('2026-11-09T18:00:00-03:00');

  // One-time past activity (06/11/2026 21:00-21:30) -> eligible
  const pastOneTime = {
    id: '1794008537834',
    title: 'PRUEBA RESEÑA',
    schedule: '06/11/2026 a las 21:00 h hasta las 21:30 h',
    isRecurrent: false
  };
  assert.equal(isActivityEligibleForReview(pastOneTime, refNow), true);

  // One-time future activity (10/11/2026 09:30-13:00) -> NOT eligible
  const futureOneTime = {
    id: '1794258492651',
    title: 'Actividad 2',
    schedule: '10/11/2026 a las 09:30 h hasta las 13:00 h',
    isRecurrent: false
  };
  assert.equal(isActivityEligibleForReview(futureOneTime, refNow), false);

  // Recurring activity whose first encounter has passed (06/11/2026) -> eligible
  const recurringStarted = {
    id: '1794008683478',
    title: 'PRUEBA RESEÑA 3',
    isRecurrent: true,
    schedule: 'Semanal • 21:43 a 21:47 h • 12 encuentros',
    firstEncounterDate: '2026-11-06',
    firstEncounterEndTime: '21:47'
  };
  assert.equal(isActivityEligibleForReview(recurringStarted, refNow), true);

  // Recurring activity whose first encounter has NOT yet occurred (15/11/2026) -> NOT eligible
  const recurringFuture = {
    id: 'rec_future',
    title: 'Taller Futuro',
    isRecurrent: true,
    schedule: 'Semanal (Lunes) • 10:00 a 11:00 h • 4 encuentros',
    firstEncounterDate: '2026-11-15',
    firstEncounterEndTime: '11:00'
  };
  assert.equal(isActivityEligibleForReview(recurringFuture, refNow), false);
});

test('getAgendaCalendarDays maps activities with schedule string to calendar days of current month', () => {
  const user = { id: 'u1', usuario: 'Nerina', apodo: 'Neri' };
  const acts = [
    {
      id: 1794258492651,
      title: 'Actividad 2',
      schedule: '10/11/2026 a las 09:30 h hasta las 13:00 h'
    },
    {
      id: 1793938569769,
      title: 'harta',
      isRecurrent: true,
      schedule: 'Lunes, Jueves (03:18 hs a 05:19 hs)',
      first_encounter_date: '2026-11-06'
    }
  ];

  // Month 10 = Noviembre (0-indexed)
  const calNov = getAgendaCalendarDays(acts, user, 2026, 10);
  assert.ok(calNov[10]);
  assert.match(calNov[10], /Actividad 2/);
  // Mondays and Thursdays in Nov 2026: 9, 12, 16, 19, 23, 26, 30
  assert.ok(calNov[9]);
  assert.match(calNov[9], /harta/);
  assert.ok(calNov[12]);
  assert.match(calNov[12], /harta/);
});

test('canUserCreateActivity blocks proposing an activity that overlaps with an enrolled activity (even by 15 mins)', () => {
  const user = { id: 'usr_neri', usuario: 'Nerina', apodo: 'Neri' };

  // Existing activity where user is enrolled: 10/11/2026 from 10:00 to 12:00
  const enrolledAct = {
    id: 1001,
    title: 'Taller de Memoria y Ajedrez',
    schedule: '10/11/2026 a las 10:00 h hasta las 12:00 h',
    startDate: '2026-11-10',
    startTime: '10:00',
    endTime: '12:00',
    enrolledUsernames: ['Neri', 'Carlos']
  };

  // Candidate A: 10/11/2026 from 11:45 to 13:00 (overlaps by 15 mins from 11:45 to 12:00)
  const candidateOverlap15 = {
    title: 'Yoga al aire libre',
    schedule: '10/11/2026 a las 11:45 h hasta las 13:00 h',
    startDate: '2026-11-10',
    startTime: '11:45',
    endTime: '13:00'
  };

  const resOverlap = canUserCreateActivity(candidateOverlap15, user, [enrolledAct]);
  assert.equal(resOverlap.allowed, false);
  assert.ok(resOverlap.reason);
  assert.match(resOverlap.reason, /Taller de Memoria y Ajedrez/);

  // Candidate B: 10/11/2026 from 12:00 to 13:00 (back to back, 0 mins overlap)
  const candidateBackToBack = {
    title: 'Almuerzo Comunitario',
    schedule: '10/11/2026 a las 12:00 h hasta las 13:00 h',
    startDate: '2026-11-10',
    startTime: '12:00',
    endTime: '13:00'
  };

  const resBackToBack = canUserCreateActivity(candidateBackToBack, user, [enrolledAct]);
  assert.equal(resBackToBack.allowed, true);

  // Candidate C: 11/11/2026 (different day)
  const candidateDifferentDay = {
    title: 'Paseo Botánico',
    schedule: '11/11/2026 a las 10:00 h hasta las 12:00 h',
    startDate: '2026-11-11',
    startTime: '10:00',
    endTime: '12:00'
  };

  const resDiffDay = canUserCreateActivity(candidateDifferentDay, user, [enrolledAct]);
  assert.equal(resDiffDay.allowed, true);
});

test('canUserCreateActivity blocks proposing an activity that overlaps with an activity the user already organizes', () => {
  const user = { id: 'usr_neri', usuario: 'Nerina', apodo: 'Neri' };

  // Existing activity organized by user
  const organizedAct = {
    id: 2001,
    title: 'Club de Lectura',
    organizerId: 'usr_neri',
    organizer: 'Neri',
    schedule: '15/11/2026 a las 15:00 h hasta las 17:00 h',
    startDate: '2026-11-15',
    startTime: '15:00',
    endTime: '17:00'
  };

  // Candidate overlapping from 16:30 to 18:00
  const candidateOverlap = {
    title: 'Taller de Cerámica',
    schedule: '15/11/2026 a las 16:30 h hasta las 18:00 h',
    startDate: '2026-11-15',
    startTime: '16:30',
    endTime: '18:00'
  };

  const res = canUserCreateActivity(candidateOverlap, user, [organizedAct]);
  assert.equal(res.allowed, false);
  assert.match(res.reason || '', /Club de Lectura/);
});

test('when a group moderator is removed and re-added, they return as a regular participant without moderator rights', () => {
  const creatorUser = { id: 'usr_organizer', usuario: 'organizer_user', apodo: 'Organizador' };
  const candidateUser = { id: 'usr_carlos', usuario: 'carlos_vecino', apodo: 'Carlos' };

  // Chat where Carlos was designated moderator, then removed, then re-added
  const chatWithReaddition: any = {
    id: 101,
    title: 'Caminatas Matutinas',
    type: 'grupal',
    creatorId: 'usr_organizer',
    creatorName: 'Organizador',
    participants: ['Organizador', 'Carlos'],
    adminUsernames: ['Organizador'],
    removedParticipants: [],
    leftVoluntarilyParticipants: [],
    messages: [
      {
        id: 'msg_1',
        role: 'sistema',
        senderId: 'sistema',
        created_at: '2026-11-01T10:00:00Z',
        text: 'Sistema CLUB65: Carlos fue designado/a moderador/a del grupo.',
        replyTo: { action: 'make_admin', participant: 'Carlos', participantId: 'usr_carlos' }
      },
      {
        id: 'msg_2',
        role: 'sistema',
        senderId: 'sistema',
        created_at: '2026-11-02T10:00:00Z',
        text: 'Carlos fue retirado del grupo por el moderador del grupo.',
        replyTo: { event: 'participant_removed', participant: 'Carlos', participantId: 'usr_carlos', participantTokens: ['carlos', 'carlos_vecino', 'usr_carlos'] }
      },
      {
        id: 'msg_3',
        role: 'sistema',
        senderId: 'sistema',
        created_at: '2026-11-03T10:00:00Z',
        text: 'Carlos fue agregado al grupo por el moderador del grupo.',
        replyTo: { event: 'participant_added', participant: 'Carlos', participantId: 'usr_carlos', participantTokens: ['carlos', 'carlos_vecino', 'usr_carlos'] }
      }
    ]
  };

  // Carlos should NOT have moderator rights upon rejoining!
  assert.equal(isUserGroupModerator(chatWithReaddition, candidateUser, []), false);

  // In resolved participants, Carlos should have isAdmin: false
  const resolved = getResolvedChatParticipants(
    chatWithReaddition,
    creatorUser,
    { usr_carlos: candidateUser, carlos: candidateUser },
    undefined,
    []
  );

  const carlosRecord = resolved.find(p => p.canonicalId === 'usr_carlos' || p.displayName.toLowerCase() === 'carlos');
  assert.ok(carlosRecord, 'Carlos should be present as active participant after being re-added');
  assert.equal(carlosRecord?.isAdmin, false, 'Carlos must NOT return as moderator');
});

test('when a user leaves a group, they are completely excluded from getResolvedChatParticipants for all users', () => {
  const organizer = { id: 'usr_org', usuario: 'organizer_user', apodo: 'Organizador' };
  const userWhoLeft = { id: 'usr_marta', usuario: 'marta_vecina', apodo: 'Marta' };

  const chatWithUserLeft: any = {
    id: 102,
    title: 'Taller de Pintura',
    type: 'grupal',
    creatorId: 'usr_org',
    creatorName: 'Organizador',
    participants: ['Organizador'],
    adminUsernames: ['Organizador'],
    removedParticipants: ['usr_marta', 'marta', 'marta_vecina'],
    leftVoluntarilyParticipants: ['usr_marta', 'marta', 'marta_vecina'],
    messages: [
      {
        id: 'msg_left',
        role: 'sistema',
        senderId: 'sistema',
        created_at: '2026-11-05T12:00:00Z',
        text: 'Marta salió del grupo.',
        replyTo: {
          event: 'user_left',
          participant: 'Marta',
          userId: 'usr_marta',
          participantTokens: ['Marta', 'marta', 'marta_vecina', 'usr_marta']
        }
      }
    ]
  };

  // From organizer perspective (checking participants modal / moderator panel)
  const resolvedForOrg = getResolvedChatParticipants(
    chatWithUserLeft,
    organizer,
    { usr_marta: userWhoLeft, usr_org: organizer },
    undefined,
    []
  );

  const martaForOrg = resolvedForOrg.find(p =>
    p.canonicalId === 'usr_marta' ||
    p.displayName.toLowerCase().trim() === 'marta' ||
    p.username === 'marta_vecina'
  );
  assert.equal(martaForOrg, undefined, 'Marta must NOT appear in the participant list or moderator panel for other members');

  // From user's own perspective
  const resolvedForMarta = getResolvedChatParticipants(
    chatWithUserLeft,
    userWhoLeft,
    { usr_marta: userWhoLeft, usr_org: organizer },
    undefined,
    []
  );
  const martaForSelf = resolvedForMarta.find(p =>
    p.canonicalId === 'usr_marta' ||
    p.canonicalId === '__CURRENT_USER__' ||
    p.displayName.toLowerCase().trim() === 'marta'
  );
  assert.equal(martaForSelf, undefined, 'User who left must not appear in active participants list');
});

test('when a user leaves a group, they lose messaging ability and moderator panel permissions', () => {
  const userWhoLeftModerator = { id: 'usr_mod_juan', usuario: 'juan_mod', apodo: 'Juan' };

  const chatLeft: any = {
    id: 103,
    title: 'Yoga en el Parque',
    type: 'grupal',
    creatorId: 'usr_another_creator',
    creatorName: 'Profesor Yoga',
    participants: ['Profesor Yoga'],
    adminUsernames: ['Profesor Yoga'],
    removedParticipants: ['usr_mod_juan', 'juan', 'juan_mod'],
    leftVoluntarilyParticipants: ['usr_mod_juan', 'juan', 'juan_mod'],
    messages: [
      {
        id: 'msg_mod',
        role: 'sistema',
        created_at: '2026-11-01T10:00:00Z',
        text: 'Sistema CLUB65: Juan fue designado/a moderador/a del grupo.',
        replyTo: { action: 'make_admin', participant: 'Juan', participantId: 'usr_mod_juan' }
      },
      {
        id: 'msg_left',
        role: 'sistema',
        created_at: '2026-11-06T15:00:00Z',
        text: 'Juan salió del grupo.',
        replyTo: {
          event: 'user_left',
          participant: 'Juan',
          userId: 'usr_mod_juan',
          participantTokens: ['Juan', 'juan', 'juan_mod', 'usr_mod_juan']
        }
      }
    ]
  };

  // isUserGroupModerator must return false
  assert.equal(isUserGroupModerator(chatLeft, userWhoLeftModerator, []), false, 'Ex-moderator who left must not have moderator rights');

  // isUserRemovedFromChat must return true
  assert.equal(isUserRemovedFromChat(chatLeft, userWhoLeftModerator), true, 'User who left is marked as removed/ex-participant');

  // isUserLeftVoluntarilyFromChat must return true
  assert.equal(isUserLeftVoluntarilyFromChat(chatLeft, userWhoLeftModerator), true, 'User who left voluntarily is marked accordingly');
});

test('user in adminUsernames who is removed and re-added loses moderator status', () => {
  const creatorUser = { id: 'usr_creator', usuario: 'creador', apodo: 'Creador' };
  const targetUser = { id: 'usr_marito', usuario: 'marito', apodo: 'Marito', tipo: 'personal' };

  // Chat where targetUser is initially in adminUsernames
  const chat: any = {
    id: 'chat_group_1',
    title: 'Amigos de la Plaza',
    type: 'grupal',
    creatorId: 'usr_creator',
    creatorName: 'Creador',
    participants: ['Creador', 'Marito'],
    adminUsernames: ['Creador', 'Marito', 'usr_marito'],
    messages: [
      {
        id: 'msg_1',
        role: 'sistema',
        senderId: 'sistema',
        timestamp: 1000,
        text: 'Marito fue retirado del grupo por el moderador del grupo.',
        replyTo: { event: 'participant_removed', participant: 'Marito', participantId: 'usr_marito' }
      },
      {
        id: 'msg_2',
        role: 'sistema',
        senderId: 'sistema',
        timestamp: 2000,
        text: 'Marito fue agregado al grupo por el moderador del grupo.',
        replyTo: { event: 'participant_added', participant: 'Marito', participantId: 'usr_marito' }
      }
    ]
  };

  // Target user should NOT be group moderator
  assert.equal(isUserGroupModerator(chat, targetUser), false, 'Removed and re-added user must not be moderator');

  // Resolved participants must mark target user as regular participant (isAdmin: false)
  const resolved = getResolvedChatParticipants(
    chat,
    creatorUser,
    { usr_marito: targetUser, marito: targetUser },
    undefined,
    []
  );

  const maritoPart = resolved.find(p => p.canonicalId === 'usr_marito' || p.displayName === 'Marito');
  assert.ok(maritoPart, 'Marito must be present in resolved participants');
  assert.equal(maritoPart?.isAdmin, false, 'Marito must NOT be admin in resolved participants');
});

test('filterAndSortRecentChats strictly hides activity chats before admin approval', () => {
  const currentUser = { id: 'usr_vecino', usuario: 'vecino', apodo: 'Vecino', tipo: 'personal' };

  const pendingActivity: any = {
    id: 501,
    title: 'Taller de Cerámica Vecinal',
    organizer: 'Vecino',
    organizerId: 'usr_vecino',
    proposalStatus: 'pendiente',
    isApproved: false,
    isInstitutional: false
  };

  const pendingChat: any = {
    id: 501,
    activityId: 501,
    title: 'Taller de Cerámica Vecinal',
    type: 'grupal',
    organizer: 'Vecino',
    organizerId: 'usr_vecino',
    participants: ['Vecino'],
    messages: []
  };

  // Chat for pending activity proposal MUST be hidden
  const visibleBeforeApproval = filterAndSortRecentChats([pendingChat], currentUser, [pendingActivity]);
  assert.equal(visibleBeforeApproval.length, 0, 'Unapproved activity chat must not appear');

  // Once approved by admin, chat appears automatically
  const approvedActivity: any = {
    ...pendingActivity,
    proposalStatus: 'aprobada',
    isApproved: true
  };

  const visibleAfterApproval = filterAndSortRecentChats([pendingChat], currentUser, [approvedActivity]);
  assert.equal(visibleAfterApproval.length, 1, 'Approved activity chat must appear automatically');
  assert.equal(visibleAfterApproval[0].id, 501);
});

test('institutional activities are automatically approved regardless of column variant', () => {
  const instAct1 = { id: 101, title: 'Taller PAMI', isInstitutional: true, proposalStatus: 'pendiente' };
  const instAct2 = { id: 102, title: 'Taller Municipio', is_institutional: true, proposal_status: 'pendiente' };
  const instAct3 = { id: 103, title: 'Taller Centro Jubilados', es_institucional: true };
  const instAct4 = { id: 104, title: 'Taller Oficial', organizerId: 'institucional' };
  const personalAct = { id: 105, title: 'Mateada vecinal', isInstitutional: false, proposalStatus: 'pendiente' };

  assert.equal(isActivityApproved(instAct1), true, 'isInstitutional true must be approved');
  assert.equal(isActivityApproved(instAct2), true, 'is_institutional true must be approved');
  assert.equal(isActivityApproved(instAct3), true, 'es_institucional true must be approved');
  assert.equal(isActivityApproved(instAct4), true, 'organizerId institucional must be approved');
  assert.equal(isActivityApproved(personalAct), false, 'Pending personal activity must NOT be approved');
});

test('activity draft storage keys are strictly account-scoped and prevent cross-account leaks', () => {
  function getDraftStorageKey(user: { id?: string | number; usuario?: string } | null | undefined): string | null {
    if (!user) return null;
    const identifier = String(user.id || user.usuario || '').trim();
    if (!identifier) return null;
    return `club65_borrador_evento_${identifier.toLowerCase()}`;
  }

  const userA = { id: 'usr_111', usuario: 'Mario' };
  const userB = { id: 'usr_222', usuario: 'Nerina' };
  const guest = null;

  const keyA = getDraftStorageKey(userA);
  const keyB = getDraftStorageKey(userB);
  const keyGuest = getDraftStorageKey(guest);

  assert.equal(keyA, 'club65_borrador_evento_usr_111');
  assert.equal(keyB, 'club65_borrador_evento_usr_222');
  assert.equal(keyGuest, null);
  assert.notEqual(keyA, keyB, 'Draft keys between different accounts must never collide');
});

test('recurrent activity with endDate equal to firstEncounterDate generates all 12 sessions', () => {
  const recurrentAct = {
    id: 101,
    title: 'Taller de Memoria y Estimulación',
    isRecurrent: true,
    firstEncounterDate: '2026-11-10',
    startDate: '2026-11-10',
    endDate: '2026-11-10', // previously set by bug
    fechaFin: '2026-11-10',
    schedule: 'Semanal (Martes) • 16:00 a 18:00 h • 12 encuentros',
    cantidadEventos: 12,
    diasSemana: ['Martes'],
    horaIni: '16:00',
    horaFin: '18:00'
  };

  const sessions = getActivitySessions(recurrentAct);
  assert.equal(sessions.length, 12, 'Must generate exactly 12 weekly sessions');
  assert.equal(sessions[0].date, '2026-11-10', 'First session must be 2026-11-10');
  assert.equal(sessions[11].date, '2027-01-26', '12th session must be 2027-01-26');

  // Check isActivityPast right after the first encounter ended (e.g. 2026-11-10 at 19:00 hs)
  const afterFirstEncounter = new Date('2026-11-10T19:00:00-03:00');
  assert.equal(hasFirstEncounterEnded(recurrentAct, afterFirstEncounter), true, 'First encounter has ended');
  assert.equal(isActivityPast(recurrentAct, afterFirstEncounter), false, 'Activity must NOT be marked past because 11 sessions remain');

  // Check calendar days for November 2026 (month 10, 0-indexed)
  const user = { id: 'usr_test', usuario: 'test' };
  const calendarMap = getAgendaCalendarDays([recurrentAct], user, 2026, 10);
  // In Nov 2026, Tuesdays after Nov 10 are: 10, 17, 24
  assert.ok(calendarMap[10], 'Nov 10 should be in calendar');
  assert.ok(calendarMap[17], 'Nov 17 should be in calendar');
  assert.ok(calendarMap[24], 'Nov 24 should be in calendar');

  // Only after the 12th encounter has ended (e.g. 2027-01-26 at 18:01 hs) should it be past
  const afterLastEncounter = new Date('2027-01-26T18:01:00-03:00');
  assert.equal(isActivityPast(recurrentAct, afterLastEncounter), true, 'Activity must be past once final encounter completes');
});

test('recurrent quincenal and mensual activities generate all requested encounters', () => {
  const quincenalAct = {
    id: 102,
    title: 'Encuentro Coral Quincenal',
    isRecurrent: true,
    frequency: 'quincenal',
    firstEncounterDate: '2026-11-12',
    schedule: 'Cada 2 semanas (Jueves) • 17:00 a 19:00 h • 4 encuentros',
    cantidadEventos: 4,
    diasSemana: ['Jueves'],
    horaIni: '17:00',
    horaFin: '19:00'
  };

  const quincenalSessions = getActivitySessions(quincenalAct);
  assert.equal(quincenalSessions.length, 4);
  assert.equal(quincenalSessions[0].date, '2026-11-12');
  assert.equal(quincenalSessions[1].date, '2026-11-26');
  assert.equal(quincenalSessions[2].date, '2026-12-10');
  assert.equal(quincenalSessions[3].date, '2026-12-24');

  const mensualAct = {
    id: 103,
    title: 'Club de Lectura Mensual',
    isRecurrent: true,
    frequency: 'mensual',
    diaMes: 15,
    firstEncounterDate: '2026-11-15',
    schedule: 'Mensual (día 15) • 18:00 a 20:00 h • 3 encuentros',
    cantidadEventos: 3,
    horaIni: '18:00',
    horaFin: '20:00'
  };

  const mensualSessions = getActivitySessions(mensualAct);
  assert.equal(mensualSessions.length, 3);
  assert.equal(mensualSessions[0].date, '2026-11-15');
  assert.equal(mensualSessions[1].date, '2026-12-15');
  assert.equal(mensualSessions[2].date, '2027-01-15');
});

test('getActivityRealizadaStatusLabel returns ACTIVIDAD EN CURSO while encounters remain, and ACTIVIDAD FINALIZADA once all end', () => {
  const recurrentAct = {
    id: 201,
    title: 'Taller de Ritmos Latinos',
    isRecurrent: true,
    firstEncounterDate: '2026-11-10',
    schedule: 'Semanal (Martes) • 18:00 a 20:00 h • 3 encuentros',
    cantidadEventos: 3,
    diasSemana: ['Martes'],
    horaIni: '18:00',
    horaFin: '20:00'
  };

  // 1. Before first encounter
  const beforeFirst = new Date('2026-11-10T17:00:00-03:00');
  assert.equal(getActivityRealizadaStatusLabel(recurrentAct, beforeFirst), 'ACTIVIDAD EN CURSO');

  // 2. Right after encounter 1 ends (encounter 2 and 3 remain)
  const afterFirst = new Date('2026-11-10T20:30:00-03:00');
  assert.equal(getActivityRealizadaStatusLabel(recurrentAct, afterFirst), 'ACTIVIDAD EN CURSO');

  // 3. Right after encounter 2 ends (encounter 3 remains)
  const afterSecond = new Date('2026-11-17T20:30:00-03:00');
  assert.equal(getActivityRealizadaStatusLabel(recurrentAct, afterSecond), 'ACTIVIDAD EN CURSO');

  // 4. Right after encounter 3 (final encounter) ends
  const afterFinal = new Date('2026-11-24T20:30:00-03:00');
  assert.equal(getActivityRealizadaStatusLabel(recurrentAct, afterFinal), 'ACTIVIDAD FINALIZADA');

  // 5. One-time activity
  const oneTimeAct = {
    id: 202,
    title: 'Charla de Salud Cardiovascular',
    isRecurrent: false,
    startDate: '2026-11-10',
    startTime: '10:00',
    endTime: '12:00'
  };
  const afterOneTime = new Date('2026-11-10T13:00:00-03:00');
  assert.equal(getActivityRealizadaStatusLabel(oneTimeAct, afterOneTime), 'ACTIVIDAD FINALIZADA');
});

test('filterAndSortRecentChats correctly matches activity chats with Grupo: prefix and makes it visible to organizer', () => {
  const organizerUser = {
    id: 'usr_org_club65',
    usuario: 'organizador_vecino',
    apodo: 'Organizador Vecino',
    tipo: 'personal'
  };

  const approvedActivity = {
    id: 1794279979947,
    title: 'Torneo de Truco y Mateada',
    isApproved: true,
    proposalStatus: 'aprobada',
    organizer: 'Organizador Vecino',
    organizer_id: 'usr_org_club65',
    creador_id: 'usr_org_club65',
    enrolled_usernames: []
  };

  // Chat row with UUID and 'Grupo: ' title prefix
  const groupChatWithPrefix = {
    id: 'e33fbf91-a128-48b2-b13c-443b74cae578',
    title: 'Grupo: Torneo de Truco y Mateada',
    type: 'grupal',
    participants: ['Organizador Vecino'],
    messages: []
  };

  const visible = filterAndSortRecentChats([groupChatWithPrefix], organizerUser, [approvedActivity]);
  assert.equal(visible.length, 1, 'Organizer must see the activity chat even with Grupo: prefix and empty enrolled list');
  assert.equal(visible[0].id, 'e33fbf91-a128-48b2-b13c-443b74cae578');
});

test('filterAndSortRecentChats makes activity chat visible to enrolled participant even if chat was synced with prefix', () => {
  const enrolledUser = {
    id: 'usr_vecino_mario',
    usuario: 'mario',
    apodo: 'Mario',
    tipo: 'personal'
  };

  const approvedActivity = {
    id: 1794279979947,
    title: 'Torneo de Truco y Mateada',
    isApproved: true,
    proposalStatus: 'aprobada',
    organizer: 'Aldu M',
    organizer_id: 'usr_aldu',
    creador_id: 'usr_aldu',
    enrolled_usernames: ['Mario']
  };

  const chat = {
    id: 'e33fbf91-a128-48b2-b13c-443b74cae578',
    title: 'Grupo: Torneo de Truco y Mateada',
    type: 'grupal',
    participants: ['Aldu M', 'Mario'],
    messages: []
  };

  const visible = filterAndSortRecentChats([chat], enrolledUser, [approvedActivity]);
  assert.equal(visible.length, 1, 'Enrolled user must see the activity group chat');
});

test('Chat isolation: User without participation has empty chat list ([]) and never sees foreign chats', () => {
  const newUser: UserSession = {
    id: 'usr_new_user_123',
    usuario: 'nuevousuario',
    apodo: 'Nuevo',
    rol: 'personal'
  };

  const foreignChat1: ChatItem = {
    id: 'a0000000-0000-0000-0000-000000000001',
    title: 'Chat Privado Ajeno',
    subtitle: '',
    type: 'privado',
    creatorId: 'usr_other_1',
    participants: ['Carlos', 'Ana'],
    participantIds: ['usr_other_1', 'usr_other_2'],
    messages: []
  };

  const foreignGroup: ChatItem = {
    id: 'b0000000-0000-0000-0000-000000000002',
    title: 'Grupo Ajeno de Yoga',
    subtitle: '',
    type: 'grupal',
    creatorId: 'usr_other_3',
    participants: ['Marta', 'Pedro'],
    participantIds: ['usr_other_3', 'usr_other_4'],
    messages: []
  };

  // filterChatsForUser must filter out everything the user does not participate in
  const visible = filterChatsForUser([foreignChat1, foreignGroup], newUser);
  assert.deepEqual(visible, [], 'New user must have strictly [] chats when not in chat_participants');
});

test('Chat isolation: User only sees chats where their user_id is in participants or participantIds', () => {
  const user: UserSession = {
    id: 'usr_target_999',
    usuario: 'target',
    apodo: 'Target User',
    rol: 'personal'
  };

  const myDirectChat: ChatItem = {
    id: 'c0000000-0000-0000-0000-000000000003',
    title: 'Target User / Amigo',
    subtitle: '',
    type: 'privado',
    creatorId: 'usr_target_999',
    participants: ['Target User', 'Amigo'],
    participantIds: ['usr_target_999', 'usr_friend_888'],
    messages: []
  };

  const foreignChat: ChatItem = {
    id: 'd0000000-0000-0000-0000-000000000004',
    title: 'Otro Chat',
    subtitle: '',
    type: 'privado',
    creatorId: 'usr_stranger_111',
    participants: ['Desconocido 1', 'Desconocido 2'],
    participantIds: ['usr_stranger_111', 'usr_stranger_222'],
    messages: []
  };

  const visible = filterChatsForUser([myDirectChat, foreignChat], user);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'c0000000-0000-0000-0000-000000000003');
});

test('Activity chat association: Creator automatically sees the activity chat', () => {
  const creatorUser: UserSession = {
    id: 'usr_organizer_555',
    usuario: 'organizador',
    apodo: 'Profe Carlos',
    rol: 'personal'
  };

  const activityChat: ChatItem = {
    id: 'e0000000-0000-0000-0000-000000000005',
    title: 'Grupo: Taller de Pintura y Acuarelas',
    subtitle: 'Canal de la actividad: Taller de Pintura',
    type: 'grupal',
    creatorId: 'usr_organizer_555',
    participants: ['Profe Carlos'],
    participantIds: ['usr_organizer_555'],
    messages: []
  };

  const visible = filterChatsForUser([activityChat], creatorUser);
  assert.equal(visible.length, 1, 'Creator must immediately see the activity chat');
  assert.equal(visible[0].id, 'e0000000-0000-0000-0000-000000000005');
});

test('Activity chat enrollment: Enrolled user becomes participant and sees activity chat', () => {
  const enrolledUser: UserSession = {
    id: 'usr_student_777',
    usuario: 'marta',
    apodo: 'Marta B',
    rol: 'personal'
  };

  const nonEnrolledUser: UserSession = {
    id: 'usr_stranger_888',
    usuario: 'pedro',
    apodo: 'Pedro C',
    rol: 'personal'
  };

  const activityChatWithParticipants: ChatItem = {
    id: 'f0000000-0000-0000-0000-000000000006',
    title: 'Grupo: Gimnasia Adaptada',
    subtitle: 'Canal de la actividad: Gimnasia',
    type: 'grupal',
    creatorId: 'usr_coach_111',
    participants: ['Coach', 'Marta B'],
    participantIds: ['usr_coach_111', 'usr_student_777'],
    messages: []
  };

  const visibleForMarta = filterChatsForUser([activityChatWithParticipants], enrolledUser);
  assert.equal(visibleForMarta.length, 1, 'Enrolled user must see the activity chat');

  const visibleForPedro = filterChatsForUser([activityChatWithParticipants], nonEnrolledUser);
  assert.equal(visibleForPedro.length, 0, 'Non-enrolled user must NOT see the activity chat');
});

test('cleanGroupTitle correctly normalizes group names', () => {
  assert.equal(cleanGroupTitle('Grupo: Pintura y Acuarela'), 'pintura y acuarela');
  assert.equal(cleanGroupTitle('grupo:   Tango Vecinal  '), 'tango vecinal');
  assert.equal(cleanGroupTitle('Taller de Huerta'), 'taller de huerta');
  assert.equal(cleanGroupTitle(''), '');
});

test('deduplicateChats consolidates duplicate group chats regardless of "Grupo:" prefix', () => {
  const duplicateGroupChats = [
    {
      id: 'uuid-1111-aaaa',
      activityId: '1794372820982',
      title: 'Taller de Cerámica',
      type: 'grupal',
      participants: ['Carola', 'Marta'],
      messages: [{ id: 'm1', text: 'Hola a todos', time: '10:00', createdAt: '2026-11-10T10:00:00Z' }]
    },
    {
      id: 'uuid-2222-bbbb',
      title: 'Grupo: Taller de Cerámica',
      type: 'grupal',
      participants: ['Carola', 'Juan'],
      messages: [{ id: 'm2', text: '¿A qué hora nos vemos?', time: '10:05', createdAt: '2026-11-10T10:05:00Z' }]
    }
  ];

  const deduplicated = deduplicateChats(duplicateGroupChats);
  assert.equal(deduplicated.length, 1, 'Duplicate group chats must be consolidated into one');
  assert.equal(deduplicated[0].title, 'Taller de Cerámica');
  assert.equal(deduplicated[0].activityId, '1794372820982');
  assert.ok(deduplicated[0].participants.includes('Carola'));
  assert.ok(deduplicated[0].participants.includes('Marta'));
  assert.ok(deduplicated[0].participants.includes('Juan'));
  assert.equal(deduplicated[0].messages.length, 2, 'Messages from both duplicate records must be merged');
});

test('deduplicateChats consolidates synthetic local activity chat with Supabase UUID chat', () => {
  const mixedChats = [
    {
      id: '1794372820982', // local timestamp ID created before sync
      activityId: '1794372820982',
      title: 'Tango en la Plaza',
      type: 'grupal',
      participants: ['Carola'],
      messages: []
    },
    {
      id: 'a0000000-0000-0000-0000-000000000099', // canonical Supabase UUID
      activityId: '1794372820982',
      title: 'Grupo: Tango en la Plaza',
      type: 'grupal',
      participants: ['Carola', 'Roberto'],
      messages: [{ id: 'm3', text: 'Bienvenidos', time: '11:00', createdAt: '2026-11-10T11:00:00Z' }]
    }
  ];

  const deduplicated = deduplicateChats(mixedChats);
  assert.equal(deduplicated.length, 1);
  assert.equal(deduplicated[0].id, 'a0000000-0000-0000-0000-000000000099', 'Should prefer the canonical Supabase UUID');
});

test('filterAndSortRecentChats guarantees zero duplicate group cards in output', () => {
  const user: UserSession = { id: 'u1', usuario: 'carola', apodo: 'Carola', rol: 'personal' };
  const activities: any[] = [
    { id: '999', title: 'Ajedrez', isApproved: true }
  ];
  const rawChats: any[] = [
    {
      id: 'g1',
      title: 'Ajedrez',
      type: 'grupal',
      activityId: '999',
      participants: ['Carola', 'Roberto'],
      lastMessage: 'Partida 1',
      lastMessageTime: '12:00',
      updatedAt: '2026-11-10T12:00:00Z'
    },
    {
      id: 'g2',
      title: 'Grupo: Ajedrez',
      type: 'grupal',
      activityId: '999',
      participants: ['Carola', 'Marta'],
      lastMessage: 'Partida 2',
      lastMessageTime: '12:05',
      updatedAt: '2026-11-10T12:05:00Z'
    }
  ];

  const recent = filterAndSortRecentChats(rawChats, user, activities);
  assert.equal(recent.length, 1, 'Should never display duplicate group cards in recent chats');
  assert.equal(recent[0].title, 'Ajedrez');
});

test('checkActivityNameCollision blocks duplicate name while activity is active in Cartelera', () => {
  const existingActivities = [
    {
      id: 101,
      title: 'Taller de Yoga al Aire Libre',
      isApproved: true,
      proposalStatus: 'aprobada',
      schedule: 'Sábado 10:00 hs'
    }
  ];

  // Exact match with different casing and spaces
  const collision = checkActivityNameCollision('  taller de yoga al aire libre  ', null, existingActivities);
  assert.equal(collision.hasCollision, true);
  assert.match(collision.reason || '', /Ya existe una actividad publicada en Cartelera/);

  // Different name
  const noCollision = checkActivityNameCollision('Taller de Pilates', null, existingActivities);
  assert.equal(noCollision.hasCollision, false);

  // Same activity being edited (same id) does not collide with itself
  const selfEdit = checkActivityNameCollision('Taller de Yoga al Aire Libre', 101, existingActivities);
  assert.equal(selfEdit.hasCollision, false);
});

test('checkActivityNameCollision allows reusing name when previous activity is no longer in Cartelera', () => {
  const existingActivities = [
    {
      id: 201,
      title: 'Taller de Pintura Óleo',
      isApproved: true,
      proposalStatus: 'aprobada',
      baja_forzada: true // Dada de baja
    },
    {
      id: 202,
      title: 'Clase de Salsa y Bachata',
      isApproved: true,
      proposalStatus: 'cancelada_organizador' // Cancelada
    },
    {
      id: 203,
      title: 'Taller de Cerámica',
      isApproved: false,
      proposalStatus: 'rechazada' // Rechazada
    },
    {
      id: 204,
      title: 'Torneo de Ajedrez Rápido',
      isApproved: true,
      proposalStatus: 'aprobada',
      schedule: '01/01/2020 a las 10:00 h', // Actividad pasada/finalizada
      endDate: '2020-01-01'
    }
  ];

  // Names of cancelled, rejected or past activities are allowed to be reused
  assert.equal(checkActivityNameCollision('Taller de Pintura Óleo', null, existingActivities).hasCollision, false);
  assert.equal(checkActivityNameCollision('Clase de Salsa y Bachata', null, existingActivities).hasCollision, false);
  assert.equal(checkActivityNameCollision('Taller de Cerámica', null, existingActivities).hasCollision, false);
  assert.equal(checkActivityNameCollision('Torneo de Ajedrez Rápido', null, existingActivities).hasCollision, false);
});

test('isMessageFromOtherUser identifies other users messages and system carteles correctly', () => {
  const me = { id: 'usr_me', usuario: 'juan_perez', apodo: 'Juan' };
  const other = { id: 'usr_other', usuario: 'maria', apodo: 'María' };

  // Own messages: never unread
  assert.equal(isMessageFromOtherUser({ senderId: 'usr_me', text: 'Hola a todos' }, me), false);
  assert.equal(isMessageFromOtherUser({ sender: 'Juan', text: 'Hola a todos' }, me), false);

  // Other user messages: unread
  assert.equal(isMessageFromOtherUser({ senderId: 'usr_other', sender: 'María', text: 'Hola Juan' }, me), true);

  // Deleted / retracted messages: never unread
  assert.equal(isMessageFromOtherUser({ senderId: 'usr_other', text: 'Mensaje retirado del grupo', retirado: true }, me), false);
  assert.equal(isMessageFromOtherUser({ senderId: 'usr_other', text: 'Mensaje retirado del grupo' }, me), false);

  // System cartel: if actor was other user or system, counts as unread cartel for me
  const cartelOther = {
    senderId: 'sistema',
    sender: 'Sistema CLUB65',
    role: 'sistema',
    text: 'María fue designada moderadora del grupo.',
    actor: 'María',
    actorId: 'usr_other'
  };
  assert.equal(isMessageFromOtherUser(cartelOther, me), true);

  // System cartel: if actor was me, does not count as unread for me
  const cartelMe = {
    senderId: 'sistema',
    sender: 'Sistema CLUB65',
    role: 'sistema',
    text: 'Juan agregó a Carlos al grupo.',
    actor: 'Juan',
    actorId: 'usr_me'
  };
  assert.equal(isMessageFromOtherUser(cartelMe, me), false);

  // Initial welcome cartel: for group creator, false; for participant, true
  const myChat = { id: 'chat_1', organizerId: 'usr_me', name: 'Mi Grupo' };
  const welcomeMsg = {
    senderId: 'sistema',
    sender: 'Sistema CLUB65',
    role: 'sistema',
    text: 'Bienvenidos al grupo de "Mi Grupo".',
    replyTo: { is_group_init: true }
  };
  assert.equal(isMessageFromOtherUser(welcomeMsg, me, myChat), false);
  assert.equal(isMessageFromOtherUser(welcomeMsg, other, myChat), true);
});

test('getChatUnreadCount accurately counts unread messages and carteles, and clears on read', () => {
  const me = { id: 'usr_me', usuario: 'juan', apodo: 'Juan' };
  const now = Date.now();

  const chat = {
    id: 'chat_test_100',
    name: 'Grupo de Caminatas',
    messages: [
      { id: 'm1', senderId: 'usr_me', text: 'Hola', timestamp: now - 3000 },
      { id: 'm2', senderId: 'usr_other', text: 'Buenas tardes', timestamp: now - 2000 },
      { id: 'm3', senderId: 'sistema', sender: 'Sistema CLUB65', role: 'sistema', text: 'Carlos se unió al grupo.', timestamp: now - 1000 }
    ]
  };

  // 1. User has never read this chat (lastReads has no entry) -> 2 unread items (1 message + 1 cartel)
  assert.equal(getChatUnreadCount(chat, me, {}), 2);

  // 2. User read before message m2 and m3 -> 2 unread items
  assert.equal(getChatUnreadCount(chat, me, { chat_test_100: now - 2500 }), 2);

  // 3. User read after m2 but before cartel m3 -> 1 unread cartel
  assert.equal(getChatUnreadCount(chat, me, { chat_test_100: now - 1500 }), 1);

  // 4. User opened and read the chat (marked as read at now) -> 0 unread
  assert.equal(getChatUnreadCount(chat, me, { chat_test_100: now }), 0);

  // 5. If user is currently looking at this active chat, unread count is always 0
  assert.equal(getChatUnreadCount(chat, me, {}, true), 0);
});

test('Chat deletion isolation: deleting chat on User A does NOT delete it for User B', () => {
  const userA = { id: 'usr_a', usuario: 'ana', apodo: 'Ana', notifications: [] };
  const userB = { id: 'usr_b', usuario: 'beto', apodo: 'Beto', notifications: [] };

  const directChat = {
    id: 'chat_privado_ab',
    type: 'privado',
    participants: ['Ana', 'Beto'],
    participantIds: ['usr_a', 'usr_b'],
    deletedForUserIds: ['usr_a'],
    messages: [
      { id: 'm1', senderId: 'usr_a', text: 'Hola Beto', timestamp: 1000 },
      { id: 'm2', senderId: 'usr_b', text: 'Hola Ana!', timestamp: 2000 }
    ]
  };

  // User A has deleted the chat -> hidden for User A
  assert.equal(isChatDeletedForUser(directChat, userA), true);

  // User B did NOT delete the chat -> visible for User B
  assert.equal(isChatDeletedForUser(directChat, userB), false);
});

test('filterChatMessagesForUser hides historical messages if clearedAt is present for user, but preserves for other user', () => {
  const tCleared = 2500;
  const userA = {
    id: 'usr_a',
    usuario: 'ana',
    apodo: 'Ana',
    notifications: [
      { type: 'chat_cleared', chatId: 'chat_ab', clearedAt: new Date(tCleared).toISOString() }
    ]
  };
  const userB = {
    id: 'usr_b',
    usuario: 'beto',
    apodo: 'Beto',
    notifications: []
  };

  const messages = [
    { id: 'm1', senderId: 'usr_a', text: 'Mensaje 1', timestamp: 1000 },
    { id: 'm2', senderId: 'usr_b', text: 'Mensaje 2', timestamp: 2000 },
    { id: 'm3', senderId: 'usr_a', text: 'Mensaje 3 después del borrado', timestamp: 3000 }
  ];

  // User A should only see message m3 (created after clearedAt)
  const msgsForA = filterChatMessagesForUser(messages, 'chat_ab', userA);
  assert.equal(msgsForA.length, 1);
  assert.equal(msgsForA[0].id, 'm3');

  // If chat has only old messages (e.g. before m3 was sent), User A sees 0 messages (empty chat)
  const oldMsgs = [messages[0], messages[1]];
  const emptyForA = filterChatMessagesForUser(oldMsgs, 'chat_ab', userA);
  assert.equal(emptyForA.length, 0);

  // User B (who did not clear the chat) sees all original messages
  const msgsForB = filterChatMessagesForUser(messages, 'chat_ab', userB);
  assert.equal(msgsForB.length, 3);
});

test('Reopening chat: isChatDeletedForUser returns false once a new message is sent after clearedAt', () => {
  const tCleared = 2000;
  const userA = {
    id: 'usr_a',
    usuario: 'ana',
    apodo: 'Ana',
    notifications: [
      { type: 'chat_cleared', chatId: 'chat_ab', clearedAt: new Date(tCleared).toISOString() }
    ]
  };

  const chatWithOnlyOldMessages = {
    id: 'chat_ab',
    type: 'privado',
    messages: [
      { id: 'm1', text: 'Viejo mensaje', timestamp: 1000 }
    ]
  };
  assert.equal(isChatDeletedForUser(chatWithOnlyOldMessages, userA), true);

  const chatWithNewMessage = {
    id: 'chat_ab',
    type: 'privado',
    messages: [
      { id: 'm1', text: 'Viejo mensaje', timestamp: 1000 },
      { id: 'm2', text: 'Nuevo mensaje después del borrado', timestamp: 3000 }
    ]
  };
  assert.equal(isChatDeletedForUser(chatWithNewMessage, userA), false);
});

test('matchActivityFrequency filters single and recurring frequencies accurately', () => {
  const actUnico = { id: 1, isRecurrent: false, title: 'Charla de Nutrición' };
  const actSemanal = { id: 2, isRecurrent: true, frequency: 'semanal', schedule: 'Todos los martes 10:00 hs' };
  const actQuincenal = { id: 3, isRecurrent: true, frequency: 'quincenal', schedule: 'Cada 2 semanas los jueves' };
  const actQuincenalByText = { id: 4, isRecurrent: true, schedule: 'Encuentros quincenales a las 15:00 hs' };
  const actMensual = { id: 5, isRecurrent: true, frequency: 'mensual', schedule: 'Primer sábado de cada mes' };

  // 'todas'
  assert.equal(matchActivityFrequency(actUnico, 'todas'), true);
  assert.equal(matchActivityFrequency(actSemanal, 'todas'), true);
  assert.equal(matchActivityFrequency(actQuincenal, 'todas'), true);
  assert.equal(matchActivityFrequency(actMensual, 'todas'), true);

  // 'unico'
  assert.equal(matchActivityFrequency(actUnico, 'unico'), true);
  assert.equal(matchActivityFrequency(actSemanal, 'unico'), false);
  assert.equal(matchActivityFrequency(actQuincenal, 'unico'), false);

  // 'semanal'
  assert.equal(matchActivityFrequency(actSemanal, 'semanal'), true);
  assert.equal(matchActivityFrequency(actUnico, 'semanal'), false);
  assert.equal(matchActivityFrequency(actQuincenal, 'semanal'), false);

  // 'quincenal'
  assert.equal(matchActivityFrequency(actQuincenal, 'quincenal'), true);
  assert.equal(matchActivityFrequency(actQuincenalByText, 'quincenal'), true);
  assert.equal(matchActivityFrequency(actSemanal, 'quincenal'), false);

  // 'mensual'
  assert.equal(matchActivityFrequency(actMensual, 'mensual'), true);
  assert.equal(matchActivityFrequency(actSemanal, 'mensual'), false);
});

test('matchActivityInitiative discriminates verified institutions and neighborhood initiatives', () => {
  const actInst = { id: 1, isInstitutional: true, title: 'Taller PAMI' };
  const actVecino = { id: 2, isInstitutional: false, title: 'Caminata de vecinos' };

  assert.equal(matchActivityInitiative(actInst, 'todas'), true);
  assert.equal(matchActivityInitiative(actVecino, 'todas'), true);

  assert.equal(matchActivityInitiative(actInst, 'verificadas'), true);
  assert.equal(matchActivityInitiative(actVecino, 'verificadas'), false);

  assert.equal(matchActivityInitiative(actVecino, 'vecinales'), true);
  assert.equal(matchActivityInitiative(actInst, 'vecinales'), false);
});

test('matchActivityTiming filters activities by current month and next month', () => {
  // Mock reference date: November 15, 2026 (Argentina time)
  const refDate = new Date('2026-11-15T15:00:00Z');

  const actThisMonth = { id: 1, startDate: '2026-11-20', title: 'Taller de Noviembre' };
  const actNextMonth = { id: 2, firstMeetingDate: '2026-12-05', title: 'Paseo de Diciembre' };
  const actFarMonth = { id: 3, fechaPrimerEncuentro: '2027-02-10', title: 'Verano 2027' };

  assert.equal(matchActivityTiming(actThisMonth, 'cualquiera', refDate), true);
  assert.equal(matchActivityTiming(actNextMonth, 'cualquiera', refDate), true);

  // 'este_mes'
  assert.equal(matchActivityTiming(actThisMonth, 'este_mes', refDate), true);
  assert.equal(matchActivityTiming(actNextMonth, 'este_mes', refDate), false);
  assert.equal(matchActivityTiming(actFarMonth, 'este_mes', refDate), false);

  // 'proximo_mes'
  assert.equal(matchActivityTiming(actThisMonth, 'proximo_mes', refDate), false);
  assert.equal(matchActivityTiming(actNextMonth, 'proximo_mes', refDate), true);
  assert.equal(matchActivityTiming(actFarMonth, 'proximo_mes', refDate), false);

  // Year rollover test: Dec 2026 -> Jan 2027
  const decRef = new Date('2026-12-10T15:00:00Z');
  const actJan = { id: 4, startDate: '2027-01-12' };
  assert.equal(matchActivityTiming(actNextMonth, 'este_mes', decRef), true);
  assert.equal(matchActivityTiming(actJan, 'proximo_mes', decRef), true);
});

test('matchActivityCapacity filters capacity ranges up to 150 spots and unlimited', () => {
  const actUnlimited0 = { id: 1, capacity: 0 };
  const actUnlimited999 = { id: 2, capacity: 999 };
  const actChico5 = { id: 3, capacity: 5 };
  const actChico20 = { id: 4, capacity: 20 };
  const actMediano35 = { id: 5, capacity: 35 };
  const actGrande80 = { id: 6, capacity: 80 };

  // 'cualquiera'
  assert.equal(matchActivityCapacity(actUnlimited0, 'cualquiera'), true);
  assert.equal(matchActivityCapacity(actChico5, 'cualquiera'), true);

  // 'libre' (capacity 0 or >= 999)
  assert.equal(matchActivityCapacity(actUnlimited0, 'libre'), true);
  assert.equal(matchActivityCapacity(actUnlimited999, 'libre'), true);
  assert.equal(matchActivityCapacity(actChico5, 'libre'), false);

  // 'chico' (1..20)
  assert.equal(matchActivityCapacity(actChico5, 'chico'), true);
  assert.equal(matchActivityCapacity(actChico20, 'chico'), true);
  assert.equal(matchActivityCapacity(actUnlimited0, 'chico'), false);
  assert.equal(matchActivityCapacity(actMediano35, 'chico'), false);

  // 'mediano' (21..50)
  assert.equal(matchActivityCapacity(actMediano35, 'mediano'), true);
  assert.equal(matchActivityCapacity(actChico20, 'mediano'), false);
  assert.equal(matchActivityCapacity(actGrande80, 'mediano'), false);

  // 'grande' (> 50 and < 999)
  assert.equal(matchActivityCapacity(actGrande80, 'grande'), true);
  assert.equal(matchActivityCapacity(actMediano35, 'grande'), false);
  assert.equal(matchActivityCapacity(actUnlimited999, 'grande'), false);
});

test('extractDynamicLocations parses geocoder strings, eliminates duplicates and sorts alphabetically', () => {
  const activities = [
    { id: 1, isInstitutional: true, location: 'Primo, Bionaz' },
    { id: 2, isInstitutional: true, location: 'Av. Corrientes 1500, San Nicolás, CABA, Argentina' },
    { id: 3, isInstitutional: true, location: 'Caballito, Ciudad Autónoma de Buenos Aires' },
    { id: 4, isInstitutional: true, location: 'Primo, Bionaz' }, // Duplicate
    { id: 5, isInstitutional: false, proposalStatus: 'rechazada', location: 'Tucumán' } // Rejected: ignored
  ];

  const locations = extractDynamicLocations(activities);

  // Should include clean zones
  assert.ok(locations.includes('Bionaz'));
  assert.ok(locations.includes('Primo'));
  assert.ok(locations.includes('San Nicolás'));
  assert.ok(locations.includes('Caballito'));
  assert.ok(locations.includes('CABA'));

  // Should NOT include street address with number or generic country
  assert.ok(!locations.includes('Av. Corrientes 1500'));
  assert.ok(!locations.includes('Argentina'));
  assert.ok(!locations.includes('Tucumán'), 'Rejected activity location must not be in active cartelera list');

  // Verify alphabetical sorting
  const sorted = [...locations].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
  assert.deepEqual(locations, sorted);
});

test('extractDynamicLocations only includes locations of activities currently available in Cartelera', () => {
  const refDate = new Date('2026-11-20T15:00:00-03:00');
  const viewer = { id: 'u-viewer', usuario: 'vecino1', apodo: 'Vecino 1' };

  const activities = [
    // Available right now in Cartelera
    {
      id: 1,
      title: 'Caminata Vigente',
      isInstitutional: true,
      isRecurrent: false,
      startDate: '2026-11-25',
      startTime: '10:00',
      endDate: '2026-11-25',
      endTime: '12:00',
      location: 'Caseros, Tres de Febrero'
    },
    // Past/expired activity (already ended -> NOT in Cartelera)
    {
      id: 2,
      title: 'Yoga Pasado',
      isInstitutional: true,
      isRecurrent: false,
      startDate: '2026-11-10',
      startTime: '09:00',
      endDate: '2026-11-10',
      endTime: '10:00',
      location: 'San Isidro, Buenos Aires'
    },
    // Pending neighborhood proposal (NOT in Cartelera)
    {
      id: 3,
      title: 'Ajedrez Pendiente',
      isInstitutional: false,
      isApproved: false,
      proposalStatus: 'pendiente',
      startDate: '2026-11-28',
      startTime: '16:00',
      location: 'Tigre'
    },
    // Cancelled by organizer (NOT in Cartelera)
    {
      id: 4,
      title: 'Baile Cancelado',
      isInstitutional: true,
      proposalStatus: 'cancelada_organizador',
      canceladaPorOrganizador: true,
      startDate: '2026-11-29',
      startTime: '18:00',
      location: 'Belgrano'
    },
    // Force-cancelled by admin (NOT in Cartelera)
    {
      id: 5,
      title: 'Coro Suspendido',
      isInstitutional: true,
      proposalStatus: 'baja_forzada',
      baja_forzada: true,
      startDate: '2026-11-29',
      startTime: '19:00',
      location: 'Palermo'
    },
    // Vetted for viewer (NOT available in Cartelera for this user)
    {
      id: 6,
      title: 'Taller Vetado',
      isInstitutional: true,
      startDate: '2026-11-26',
      startTime: '17:00',
      location: 'Olivos',
      vettedUsers: ['vecino1']
    }
  ];

  const locationsForViewer = extractDynamicLocations(activities, { currentUser: viewer, refDate });
  assert.deepEqual(locationsForViewer, ['Caseros', 'Tres de Febrero']);

  // Another user who is NOT vetted should see Olivos as well, but still NOT past/pending/cancelled
  const otherUser = { id: 'u-other', usuario: 'vecino2', apodo: 'Vecino 2' };
  const locationsForOther = extractDynamicLocations(activities, { currentUser: otherUser, refDate });
  assert.deepEqual(locationsForOther, ['Caseros', 'Olivos', 'Tres de Febrero']);
});

test('filterCarteleraActivities combines search bar with all 5 filter criteria', () => {
  const refDate = new Date('2026-11-10T12:00:00Z');
  const activities = [
    {
      id: 1,
      title: 'Taller de Folklore Semanal',
      category: 'cultura',
      isInstitutional: true,
      isRecurrent: true,
      frequency: 'semanal',
      schedule: 'Viernes 18:00 hs',
      startDate: '2026-11-20',
      capacity: 15,
      location: 'Caballito, CABA'
    },
    {
      id: 2,
      title: 'Caminata Barrial Única',
      category: 'salud',
      isInstitutional: false,
      proposalStatus: 'aprobada',
      isRecurrent: false,
      schedule: 'Sábado 10:00 hs',
      startDate: '2026-11-21',
      capacity: 30,
      location: 'Parque Centenario, Caballito'
    },
    {
      id: 3,
      title: 'Encuentro Tecnológico de Diciembre',
      category: 'tecnologia',
      isInstitutional: true,
      isRecurrent: false,
      schedule: '05/12/2026 15:00 hs',
      startDate: '2026-12-05',
      capacity: 60,
      location: 'San Nicolás, CABA'
    }
  ];

  // 1. No filters: returns all 3
  const all = filterCarteleraActivities(activities, { refDate });
  assert.equal(all.length, 3);

  // 2. Filter by frequency 'unico': returns items 2 and 3
  const unico = filterCarteleraActivities(activities, { frequency: 'unico', refDate });
  assert.equal(unico.length, 2);
  assert.deepEqual(unico.map(a => a.id), [2, 3]);

  // 3. Filter by initiative 'vecinales': returns item 2
  const vecinales = filterCarteleraActivities(activities, { initiative: 'vecinales', refDate });
  assert.equal(vecinales.length, 1);
  assert.equal(vecinales[0].id, 2);

  // 4. Filter by timing 'proximo_mes': returns item 3 (December)
  const proximoMes = filterCarteleraActivities(activities, { timing: 'proximo_mes', refDate });
  assert.equal(proximoMes.length, 1);
  assert.equal(proximoMes[0].id, 3);

  // 5. Filter by capacity 'chico' (<= 20): returns item 1 (capacity 15)
  const chico = filterCarteleraActivities(activities, { capacity: 'chico', refDate });
  assert.equal(chico.length, 1);
  assert.equal(chico[0].id, 1);

  // 6. Filter by location 'Caballito': returns items 1 and 2
  const caballito = filterCarteleraActivities(activities, { location: 'Caballito', refDate });
  assert.equal(caballito.length, 2);
  assert.deepEqual(caballito.map(a => a.id), [1, 2]);

  // 7. Combined: Caballito + chico (<= 20) + semanal: returns ONLY item 1
  const combined = filterCarteleraActivities(activities, {
    location: 'Caballito',
    capacity: 'chico',
    frequency: 'semanal',
    refDate
  });
  assert.equal(combined.length, 1);
  assert.equal(combined[0].id, 1);

  // 8. Search query combined with filters
  const searchMatch = filterCarteleraActivities(activities, {
    searchQuery: 'Folklore',
    location: 'Caballito',
    refDate
  });
  assert.equal(searchMatch.length, 1);
  assert.equal(searchMatch[0].id, 1);

  const searchMismatch = filterCarteleraActivities(activities, {
    searchQuery: 'Ajedrez',
    refDate
  });
  assert.equal(searchMismatch.length, 0);
});

test('formatIncomingMessageToast uses "en chat privado" for private chats and chat name for group chats', () => {
  const privateChat = { id: 'c_priv', title: 'María López', type: 'privado' };
  const privateByTipo = { id: 'c_priv2', nombre: 'Carlos', tipo: 'privado' };
  const groupChat = { id: 'c_grp', title: 'Grupo: Yoga en la Plaza', type: 'grupal' };

  assert.equal(
    formatIncomingMessageToast(privateChat, 'María López', 'Hola! Nos vemos hoy?'),
    '💬 Nuevo mensaje de María López en chat privado: Hola! Nos vemos hoy?'
  );
  assert.equal(
    formatIncomingMessageToast(privateByTipo, 'Carlos', ''),
    '💬 Nuevo mensaje de Carlos en chat privado'
  );
  assert.equal(
    formatIncomingMessageToast(groupChat, 'Ana', 'Traigan colchoneta'),
    '💬 Nuevo mensaje de Ana en "Grupo: Yoga en la Plaza": Traigan colchoneta'
  );

  // Resolves apodo from usersMap and truncates long previews to 60 chars + '...'
  const usersMap = {
    u_1: { id: 'u_1', usuario: 'marta65', apodo: 'Marta G.' }
  };
  const longText = 'A'.repeat(70);
  assert.equal(
    formatIncomingMessageToast(privateChat, 'usr_12345_abc', longText, 'u_1', usersMap),
    `💬 Nuevo mensaje de Marta G. en chat privado: ${'A'.repeat(60)}...`
  );
});

test('Organizer veto hides activity from Cartelera, blocks enrollment, triggers Mi Agenda notification, and keeps group chat read-only like moderator removal', () => {
  const userRoberto = { id: 'usr_rob', usuario: 'roberto', apodo: 'Roberto Gómez' };
  const userCarola = { id: 'usr_car', usuario: 'carola', apodo: 'Carola' };

  const vetoedActivity = {
    id: 501,
    title: 'Tarde de Ajedrez',
    category: 'Juegos',
    schedule: 'Viernes 17:00 h',
    location: 'Caseros',
    organizer: 'Carola',
    organizerId: 'usr_car',
    isApproved: true,
    proposalStatus: 'aprobada',
    fechaRealizacion: '2029-11-20',
    enrolledUsernames: [],
    vetted_users: ['roberto', 'Roberto Gómez', 'usr_rob']
  };

  // 1) Cartelera & re-enrollment
  assert.equal(isUserVettedFromActivity(vetoedActivity, userRoberto), true);
  assert.equal(filterCarteleraActivities([vetoedActivity], { currentUser: userRoberto }).length, 0);
  assert.equal(filterCarteleraActivities([vetoedActivity], { currentUser: userCarola }).length, 1);
  const enrollAttempt = canUserEnrollActivity(vetoedActivity, userRoberto);
  assert.equal(enrollAttempt.allowed, false);
  assert.ok(enrollAttempt.reason?.includes('vetado'));

  // 2) Mi Agenda notification alert + dismissible card, excluded from calendar grid
  assert.equal(hasAgendaCancellationAlert([vetoedActivity], userRoberto, [], []), true);
  assert.equal(filterAgendaActivities([vetoedActivity], userRoberto, []).length, 1);
  assert.equal(filterAgendaActivities([vetoedActivity], userRoberto, [501]).length, 0);
  assert.equal(hasAgendaCancellationAlert([vetoedActivity], userRoberto, [501], []), false);
  assert.deepEqual(getAgendaCalendarDays([vetoedActivity], userRoberto, 2029, 10), {});

  // 3) Mi Chat read-only removal when user WAS in group chat before veto
  const sysVetoMsg = {
    id: 'sys_veto_1',
    chatId: 'chat_501',
    senderId: 'sistema',
    sender: 'Sistema CLUB65',
    role: 'sistema',
    text: 'Roberto Gómez fue retirado del grupo porque fue vetado de la actividad.',
    createdAt: '2026-11-10T10:00:00.000Z',
    timestamp: 1000,
    reply_to: {
      event: 'participant_removed',
      reason: 'vetoed',
      participant: 'Roberto Gómez',
      participantId: 'usr_rob',
      participantTokens: ['roberto', 'roberto gómez', 'usr_rob'],
      participantsSnapshot: ['Carola', 'Roberto Gómez', 'Marta']
    }
  };

  const groupChatWhenVetoed = {
    id: 'chat_501',
    title: 'Grupo: Tarde de Ajedrez',
    name: 'Grupo: Tarde de Ajedrez',
    type: 'grupal' as const,
    activityId: 501,
    creatorId: 'usr_car',
    participants: ['Carola', 'Marta'],
    vetoedParticipants: ['usr_rob', 'roberto', 'Roberto Gómez'],
    removedParticipants: ['usr_rob', 'roberto', 'Roberto Gómez'],
    vetoedByUser: true,
    messages: [sysVetoMsg]
  };

  assert.equal(isUserVetoedFromChat(groupChatWhenVetoed, userRoberto), true);
  assert.equal(isUserRemovedFromChat(groupChatWhenVetoed, userRoberto), true);
  assert.equal(isUserVetoedFromChat(groupChatWhenVetoed, userCarola), false);

  // Vetoed user STILL sees the chat in Mi Chat (in read-only mode) until explicitly deleting it
  const recentForRoberto = filterAndSortRecentChats([groupChatWhenVetoed], userRoberto, [vetoedActivity]);
  assert.equal(recentForRoberto.length, 1);

  // Snapshot at removal preserved for vetoed user
  assert.deepEqual(getVisibleParticipantsForUser(groupChatWhenVetoed, userRoberto), [
    'Carola',
    'Roberto Gómez',
    'Marta'
  ]);
  // Active participants see live list without Roberto
  assert.deepEqual(getVisibleParticipantsForUser(groupChatWhenVetoed, userCarola), ['Carola', 'Marta']);

  // Once vetoed user deletes the chat ("Borrar chat"), subsequent active group messages do NOT resurrect it
  const robertoAfterDelete = {
    ...userRoberto,
    notifications: [{ type: 'chat_cleared', chatId: 'chat_501', clearedAt: 2000 }]
  };
  const chatWithLaterMessage = {
    ...groupChatWhenVetoed,
    messages: [
      sysVetoMsg,
      {
        id: 'm_later',
        senderId: 'usr_car',
        sender: 'Carola',
        text: 'Hola grupo!',
        timestamp: 3000
      }
    ]
  };
  assert.equal(isChatDeletedForUser(chatWithLaterMessage, robertoAfterDelete), true);
  assert.equal(filterAndSortRecentChats([chatWithLaterMessage], robertoAfterDelete, [vetoedActivity]).length, 0);
});

test('shouldOpenMessageMenuUpwards flips menu upwards for bottom/last messages and downwards when room exists below', () => {
  // Bottom-most / last message inside a 500px-tall container (top=200, bottom=700):
  // Trigger sits near bottom (top=630, bottom=655) -> only 45px below, 430px above -> open upwards!
  assert.equal(
    shouldOpenMessageMenuUpwards({
      triggerTop: 630,
      triggerBottom: 655,
      containerTop: 200,
      containerBottom: 700,
      isLastMessage: true
    }),
    true
  );

  // Near-bottom message even if not strictly the last -> open upwards when spaceBelow < 210 and spaceAbove > spaceBelow
  assert.equal(
    shouldOpenMessageMenuUpwards({
      triggerTop: 550,
      triggerBottom: 575,
      containerTop: 200,
      containerBottom: 700,
      isLastMessage: false
    }),
    true
  );

  // Only message at top of container (top=230, bottom=255) -> 445px below, 30px above -> open downwards!
  assert.equal(
    shouldOpenMessageMenuUpwards({
      triggerTop: 230,
      triggerBottom: 255,
      containerTop: 200,
      containerBottom: 700,
      isLastMessage: true
    }),
    false
  );
});

test('getPinnedMessageFromList resolves pinned message from isPinned flag or pinnedMessageId and ignores deleted messages', () => {
  const msgs = [
    { id: 'msg_1', sender: 'Neri', text: 'Bienvenidos', isPinned: false },
    { id: 'msg_2', sender: 'Neri', text: 'Punto de encuentro: puerta principal', isPinned: true }
  ];

  const found = getPinnedMessageFromList(msgs);
  assert.equal(found?.id, 'msg_2');

  // Falls back to pinnedMessageId when isPinned flag is omitted
  const msgsNoFlag = [
    { id: 'msg_1', sender: 'Neri', text: 'Bienvenidos' },
    { id: 'msg_2', sender: 'Neri', text: 'Punto de encuentro: puerta principal' }
  ];
  assert.equal(getPinnedMessageFromList(msgsNoFlag, 'msg_2')?.id, 'msg_2');

  // Deleted messages must never be returned as pinned
  const deletedPinned = [
    { id: 'msg_2', sender: 'Neri', text: 'Este mensaje fue retirado', isPinned: true, isDeleted: true }
  ];
  assert.equal(getPinnedMessageFromList(deletedPinned, 'msg_2'), null);
});

test('deduplicateChats and deduplicateMessages preserve pinnedMessageId after refresh and clear it on explicit unpin', () => {
  const syntheticChat = {
    id: 42,
    activityId: 42,
    title: 'Concierto',
    type: 'grupal',
    messages: [
      { id: 'msg_init_1', sender: 'Neri', text: 'Bienvenidos al grupo', isPinned: false, timestamp: 1000 }
    ]
  };

  // Fresh fetch from Supabase with UUID has isPinned: true -> pinnedMessageId must persist
  const freshFromDbPinned = {
    id: '29839d39-e9df-4fbf-a0ef-90e62c1a80a2',
    activityId: 42,
    title: 'Grupo: Concierto',
    type: 'grupal',
    pinnedMessageId: 'msg_init_1',
    messages: [
      { id: 'msg_init_1', sender: 'Neri', text: 'Bienvenidos al grupo', isPinned: true, timestamp: 1000 }
    ]
  };

  const mergedPinned = deduplicateChats([syntheticChat, freshFromDbPinned]);
  assert.equal(mergedPinned.length, 1);
  assert.equal(mergedPinned[0].pinnedMessageId, 'msg_init_1');

  // When refreshData reconciles optimistic pinned message with fresh DB state after unpin:
  const prevMsgs = [{ id: 'msg_init_1', sender: 'Neri', text: 'Bienvenidos al grupo', isPinned: true, timestamp: 1000 }];
  const freshMsgsUnpinned = [{ id: 'msg_init_1', sender: 'Neri', text: 'Bienvenidos al grupo', isPinned: false, timestamp: 1000 }];
  const reconciledMsgs = deduplicateMessages([...prevMsgs, ...freshMsgsUnpinned]);
  assert.equal(getPinnedMessageFromList(reconciledMsgs), null);

  // Also deduplicateChats consolidating unpinned Supabase record over pinned local record clears pinnedMessageId
  const localPinned = {
    id: 42,
    activityId: 42,
    title: 'Grupo: Concierto',
    type: 'grupal',
    pinnedMessageId: 'msg_init_1',
    messages: prevMsgs
  };
  const freshFromDbUnpinned = {
    id: '29839d39-e9df-4fbf-a0ef-90e62c1a80a2',
    activityId: 42,
    title: 'Grupo: Concierto',
    type: 'grupal',
    pinnedMessageId: undefined,
    messages: freshMsgsUnpinned
  };
  const mergedUnpinned = deduplicateChats([localPinned, freshFromDbUnpinned]);
  assert.equal(mergedUnpinned.length, 1);
  assert.equal(mergedUnpinned[0].pinnedMessageId, undefined);
});

test('only group moderators (creator, organizer, designated moderator, platform admin) can pin/unpin messages', () => {
  const groupChat = {
    id: 'chat_group_pin_auth',
    title: 'Grupo: Concierto',
    type: 'grupal',
    creatorId: 'usr_neri',
    participants: ['Neri', 'Marito', 'Carlos'],
    participantIds: ['usr_neri', 'usr_marito', 'usr_carlos'],
    messages: [
      {
        id: 'sys_admin_1',
        senderId: 'sistema',
        role: 'sistema',
        text: 'Marito fue designado/a moderador/a del grupo.',
        timestamp: 2000,
        replyTo: { action: 'make_admin', participant: 'Marito', participantId: 'usr_marito' }
      }
    ]
  };

  const creator = { id: 'usr_neri', usuario: 'neri', apodo: 'Neri', tipo: 'personal' };
  const designatedMod = { id: 'usr_marito', usuario: 'marito', apodo: 'Marito', tipo: 'personal' };
  const regularMember = { id: 'usr_carlos', usuario: 'carlos', apodo: 'Carlos', tipo: 'personal' };

  assert.equal(isUserGroupModerator(groupChat, creator), true);
  assert.equal(isUserGroupModerator(groupChat, designatedMod), true);
  assert.equal(isUserGroupModerator(groupChat, regularMember), false);
});

test('madrugada and overnight (midnight-crossing) single and recurring activities work coherently', () => {
  // 1. One-time activity during madrugada (00:30 to 03:00 on same date)
  const madrugadaSingle = {
    id: 901,
    title: 'Observación Astronómica',
    isRecurrent: false,
    startDate: '2026-11-21',
    endDate: '2026-11-21',
    startTime: '00:30',
    endTime: '03:00',
    schedule: '21/11/2026 a las 00:30 h hasta las 03:00 h'
  };
  const madSessions = getActivitySessions(madrugadaSingle);
  assert.equal(madSessions.length, 1);
  assert.equal(madSessions[0].date, '2026-11-21');
  assert.equal(madSessions[0].startMinutes, 30);
  assert.equal(madSessions[0].endMinutes, 180);
  assert.equal(isActivityPast(madrugadaSingle, new Date('2026-11-21T02:30:00-03:00')), false);
  assert.equal(isActivityPast(madrugadaSingle, new Date('2026-11-21T03:05:00-03:00')), true);

  // 2. One-time overnight activity crossing midnight (22:30 to 01:30 next day)
  const overnightSingle = {
    id: 902,
    title: 'Milonga Nocturna',
    isRecurrent: false,
    startDate: '2026-11-20',
    endDate: '2026-11-21',
    startTime: '22:30',
    endTime: '01:30',
    schedule: '20/11/2026 a las 22:30 h hasta 21/11/2026 a las 01:30 h'
  };
  const overSessions = getActivitySessions(overnightSingle);
  assert.equal(overSessions.length, 1, 'Single overnight event must count as 1 session spanning midnight');
  assert.equal(overSessions[0].date, '2026-11-20');
  assert.equal(overSessions[0].startMinutes, 22 * 60 + 30);
  assert.equal(overSessions[0].endMinutes, 1440 + 90);
  assert.equal(isActivityPast(overnightSingle, new Date('2026-11-21T00:45:00-03:00')), false);
  assert.equal(isActivityPast(overnightSingle, new Date('2026-11-21T01:35:00-03:00')), true);

  // Collision across midnight between overnightSingle (22:30->01:30) and madrugadaSingle (00:30->03:00)
  const collision = checkActivitiesCollision(overnightSingle, madrugadaSingle);
  assert.equal(collision.hasCollision, true, 'Must detect collision between 22:30-01:30 overnight and 00:30-03:00 madrugada');

  // 3. Recurring overnight activity (23:00 to 01:00 next day, 2 weekly encounters)
  const overnightRecurrent = {
    id: 903,
    title: 'Peña de los Viernes',
    isRecurrent: true,
    frequency: 'semanal',
    diasSemana: ['Viernes'],
    cantidadEventos: 2,
    firstEncounterDate: '2026-11-20',
    startDate: '2026-11-20',
    startTime: '23:00',
    endTime: '01:00',
    firstEncounterStartTime: '23:00',
    firstEncounterEndTime: '01:00',
    schedule: 'Semanal (Viernes) • 23:00 a 01:00 h • 2 encuentros'
  };
  const recOverSessions = getActivitySessions(overnightRecurrent);
  assert.equal(recOverSessions.length, 2);
  assert.equal(recOverSessions[0].endMinutes, 1440 + 60);
  assert.equal(hasFirstEncounterEnded(overnightRecurrent, new Date('2026-11-21T00:30:00-03:00')), false);
  assert.equal(hasFirstEncounterEnded(overnightRecurrent, new Date('2026-11-21T01:05:00-03:00')), true);
  assert.equal(isActivityPast(overnightRecurrent, new Date('2026-11-28T00:30:00-03:00')), false);
  assert.equal(isActivityPast(overnightRecurrent, new Date('2026-11-28T01:05:00-03:00')), true);
});

test('filterAndSortRecentChats hides activity group chat immediately when user cancels enrollment even after sending messages, preserves other participants, and restores on re-enrollment', () => {
  const ana = { id: 'usr_ana', usuario: 'ana', apodo: 'Ana', tipo: 'personal' };
  const beto = { id: 'usr_beto', usuario: 'beto', apodo: 'Beto', tipo: 'personal' };
  const org = { id: 'usr_org', usuario: 'organizador', apodo: 'Organizador', tipo: 'personal' };

  const groupChat = {
    id: 'chat-act-77',
    activityId: 77,
    title: 'Grupo: Caminata Saludable',
    name: 'Grupo: Caminata Saludable',
    type: 'grupal',
    creatorId: 'usr_org',
    creatorName: 'Organizador',
    // Even before local chat participants/messages sync, activity enrollment is authoritative
    participants: ['Organizador', 'Ana', 'Beto'],
    messages: [
      { id: 'm1', senderId: 'usr_ana', sender: 'Ana', text: '¡Nos vemos el sábado!', createdAt: '2026-11-15T10:00:00Z' },
      { id: 'm2', senderId: 'usr_beto', sender: 'Beto', text: '¡Llevo mate!', createdAt: '2026-11-15T10:05:00Z' }
    ]
  };

  // 1. Both Ana and Beto enrolled -> both see the group chat
  const actWithBoth = {
    id: 77,
    title: 'Caminata Saludable',
    organizerId: 'usr_org',
    isApproved: true,
    enrolledUsernames: ['Ana', 'Beto']
  };
  assert.equal(filterAndSortRecentChats([groupChat], ana, [actWithBoth]).length, 1);
  assert.equal(filterAndSortRecentChats([groupChat], beto, [actWithBoth]).length, 1);

  // 2. Ana cancels enrollment -> Ana no longer sees the group chat, even though she sent m1 and participants still has 'Ana'
  const actAfterAnaCancelled = {
    ...actWithBoth,
    enrolledUsernames: ['Beto']
  };
  assert.equal(filterAndSortRecentChats([groupChat], ana, [actAfterAnaCancelled]).length, 0, 'Unenrolled user must not see activity chat in recent chats');
  assert.equal(filterAndSortRecentChats([groupChat], beto, [actAfterAnaCancelled]).length, 1, 'Other enrolled participant must still see the group chat');
  assert.equal(filterAndSortRecentChats([groupChat], org, [actAfterAnaCancelled]).length, 1, 'Organizer must still see the group chat');

  // 3. Ana re-enrolls -> Ana regains access to the group chat
  const actReenrolled = {
    ...actWithBoth,
    enrolledUsernames: ['Beto', 'Ana']
  };
  const anaRestored = filterAndSortRecentChats([groupChat], ana, [actReenrolled]);
  assert.equal(anaRestored.length, 1, 'Re-enrolled user must regain access to the group chat');
  assert.equal(anaRestored[0].messages.length, 2, 'Prior conversation messages remain intact');
});

test('Ex-participant (voluntary leave or moderator removal) sees messages strictly up to departure, frozen participants snapshot, and stays visible in Recent Chats until deleted', () => {
  const ana = {
    id: 'usr_ana_ex',
    usuario: 'ana_ex',
    apodo: 'Ana',
    tipo: 'personal',
    notifications: [
      {
        id: 'notice_1',
        type: 'chat_removed_notice',
        reason: 'removed',
        chatId: 'chat-group-50',
        activityId: '50',
        participantsSnapshot: ['Laura', 'Ana', 'Beto'],
        removedAt: Date.parse('2026-11-16T12:00:00Z'),
        createdAt: '2026-11-16T12:00:00Z'
      }
    ]
  };
  const laura = { id: 'usr_laura_50', usuario: 'laura_50', apodo: 'Laura', tipo: 'personal' };
  const beto = { id: 'usr_beto_50', usuario: 'beto_50', apodo: 'Beto', tipo: 'personal' };
  const carlos = { id: 'usr_carlos_50', usuario: 'carlos_50', apodo: 'Carlos', tipo: 'personal' };

  const rawMsgs = [
    { id: 'm1', senderId: 'usr_laura_50', sender: 'Laura', text: 'Hola grupo', createdAt: '2026-11-16T10:00:00Z' },
    { id: 'm2', senderId: 'usr_ana_ex', sender: 'Ana', text: 'Hola!', createdAt: '2026-11-16T11:00:00Z' },
    { id: 'm2b_before', senderId: 'usr_laura_50', sender: 'Laura', text: 'Mensaje previo al retiro', createdAt: '2026-11-16T11:30:00Z' },
    {
      id: 'sys_rem_ana',
      senderId: 'sistema',
      role: 'sistema',
      text: 'Ana fue retirado del grupo por el moderador del grupo.',
      createdAt: '2026-11-16T12:00:00Z',
      replyTo: {
        event: 'participant_removed',
        participant: 'Ana',
        participantId: 'usr_ana_ex',
        participantTokens: ['ana', 'ana_ex', 'usr_ana_ex'],
        participantsSnapshot: ['Laura', 'Ana', 'Beto']
      }
    },
    // Later events AFTER Ana was removed:
    {
      id: 'sys_add_carlos',
      senderId: 'sistema',
      role: 'sistema',
      text: 'Carlos fue agregado al grupo.',
      createdAt: '2026-11-16T13:00:00Z',
      replyTo: { event: 'participant_added', participant: 'Carlos', participantId: 'usr_carlos_50' }
    },
    {
      id: 'sys_mod_beto',
      senderId: 'sistema',
      role: 'sistema',
      text: 'Sistema CLUB65: Beto fue designado/a moderador/a del grupo.',
      createdAt: '2026-11-16T13:05:00Z',
      replyTo: { action: 'make_admin', participant: 'Beto', participantId: 'usr_beto_50' }
    },
    { id: 'm3_after', senderId: 'usr_carlos_50', sender: 'Carlos', text: 'Mensaje secreto post-salida', createdAt: '2026-11-16T14:00:00Z' }
  ];

  const groupChatAfterLaterJoins: any = {
    id: 'chat-group-50',
    activityId: 50,
    title: 'Grupo: Club de Lectura',
    type: 'grupal',
    creatorId: 'usr_laura_50',
    creatorName: 'Laura',
    // Current live active members exclude Ana and include Carlos, and Beto is now admin:
    participants: ['Laura', 'Carlos'],
    adminUsernames: ['Laura', 'Beto'],
    removedParticipants: ['ana', 'ana_ex', 'usr_ana_ex'],
    participantsSnapshotOnRemoval: {
      usr_ana_ex: ['Laura', 'Ana', 'Beto']
    },
    removedAtForUser: Date.parse('2026-11-16T12:00:00Z'),
    messages: rawMsgs
  };

  // 1. Departure timestamp matches removal time
  assert.equal(
    getUserChatDepartureTimestamp(groupChatAfterLaterJoins, ana),
    Date.parse('2026-11-16T12:00:00Z')
  );
  assert.equal(isUserRemovedFromChat(groupChatAfterLaterJoins, ana), true);

  // 2. Post-removal messages and joins are strictly hidden for Ana
  const msgsForAna = filterChatMessagesForUser(rawMsgs, 'chat-group-50', ana, groupChatAfterLaterJoins);
  assert.equal(msgsForAna.length, 4);
  assert.equal(msgsForAna.some(m => m.id === 'm3_after'), false);
  assert.equal(msgsForAna.some(m => m.id === 'sys_add_carlos'), false);

  // 3. Unread counter must never count post-departure messages
  assert.equal(
    getChatUnreadCount(groupChatAfterLaterJoins, ana, { 'chat-group-50': Date.parse('2026-11-16T10:30:00Z') }),
    1,
    'Only pre-departure m2b_before counts; post-departure m3_after/sys_add_carlos do not'
  );

  // 4. Frozen participant snapshot reflects state at removal (Laura [mod], Ana, Beto [non-mod then]), NOT Carlos or post-removal mod promotion
  const usersMap = { usr_laura_50: laura, usr_ana_ex: ana, usr_beto_50: beto, usr_carlos_50: carlos };
  const resolvedForAna = getResolvedChatParticipants(groupChatAfterLaterJoins, ana, usersMap, undefined, []);
  const namesForAna = resolvedForAna.map(p => p.displayName).sort();
  assert.deepEqual(namesForAna, ['Ana', 'Beto', 'Laura']);
  assert.equal(resolvedForAna.find(p => p.displayName === 'Laura')?.isAdmin, true);
  assert.equal(resolvedForAna.find(p => p.displayName === 'Carlos'), undefined, 'Carlos joined after Ana exited, so must not appear in snapshot');
  assert.equal(resolvedForAna.find(p => p.displayName === 'Beto')?.isAdmin, false, 'Beto was promoted AFTER Ana exited, so must not be marked admin in Ana snapshot');

  // 5. Chat remains visible in Recent Chats even after unenrollment/removal
  const actWithoutAna = { id: 50, title: 'Club de Lectura', organizerId: 'usr_laura_50', isApproved: true, enrolledUsernames: ['Carlos'] };
  const recentForAna = filterAndSortRecentChats([groupChatAfterLaterJoins], ana, [actWithoutAna]);
  assert.equal(recentForAna.length, 1, 'Removed/left group chat must remain visible in Recent Chats');

  // 6. Only explicit deletion ("Borrar chat") after departure hides it
  assert.equal(isChatDeletedForUser(groupChatAfterLaterJoins, ana), false);
  const anaWhoDeletedChat = {
    ...ana,
    notifications: [
      ...ana.notifications,
      { type: 'chat_cleared', chatId: 'chat-group-50', clearedAt: '2026-11-16T15:00:00Z' }
    ]
  };
  assert.equal(isChatDeletedForUser(groupChatAfterLaterJoins, anaWhoDeletedChat), true);
});

test('another user leaving a group (or stale left_chats_local) never marks remaining participants as departed', () => {
  const prevStorage = (globalThis as any).localStorage;
  try {
    const store: Record<string, string> = {
      left_chats_local: JSON.stringify(['chat-montaner', '77']),
      left_chats_usr_gustavo_iso: JSON.stringify(['chat-montaner', '77'])
    };
    (globalThis as any).localStorage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = String(v); },
      removeItem: (k: string) => { delete store[k]; }
    };

    const gustavo = { id: 'usr_gustavo_iso', usuario: 'gustavomac', apodo: 'Gustavo Mac', notifications: [] };
    const neri = { id: 'usr_neri_iso', usuario: 'neri', apodo: 'Neri', notifications: [] };
    // Even if another user shares a display name with someone who left, strict ID mismatch prevents false positive
    const otherSameApodo = { id: 'usr_other_iso', usuario: 'otro_vecino', apodo: 'Gustavo Mac', notifications: [] };

    const chat: any = {
      id: 'chat-montaner',
      activityId: 77,
      title: 'Grupo: VAYAMOS JUNTOS AL CONCIERTO DE MONTANER',
      type: 'grupal',
      participants: ['Neri'],
      leftVoluntarilyParticipants: ['usr_gustavo_iso', 'gustavomac', 'gustavo mac'],
      removedParticipants: ['usr_gustavo_iso', 'gustavomac', 'gustavo mac'],
      messages: [
        {
          id: 'sys_join_gustavo',
          senderId: 'sistema',
          role: 'sistema',
          text: '¡Bienvenido a VAYAMOS JUNTOS AL CONCIERTO DE MONTANER, Gustavo Mac!',
          createdAt: '2026-11-18T12:00:00Z',
          replyTo: { event: 'participant_added', participant: 'Gustavo Mac', participantId: 'usr_gustavo_iso' }
        },
        {
          id: 'sys_left_gustavo',
          senderId: 'sistema',
          role: 'sistema',
          text: 'Gustavo Mac salió del grupo.',
          createdAt: '2026-11-18T13:07:00Z',
          replyTo: {
            event: 'user_left',
            participant: 'Gustavo Mac',
            userId: 'usr_gustavo_iso',
            participantTokens: ['usr_gustavo_iso', 'gustavomac', 'gustavo mac']
          }
        }
      ]
    };

    // Remaining member Neri must NOT be locked out or marked as left/removed
    assert.equal(isUserLeftVoluntarilyFromChat(chat, neri), false);
    assert.equal(isUserRemovedFromChat(chat, neri), false);
    assert.equal(isUserVetoedFromChat(chat, neri), false);
    assert.equal(getUserChatDepartureTimestamp(chat, neri), 0);

    // Same display name but different user ID must ALSO NOT be marked as left
    assert.equal(isUserLeftVoluntarilyFromChat(chat, otherSameApodo), false);
    assert.equal(isUserRemovedFromChat(chat, otherSameApodo), false);
    assert.equal(getUserChatDepartureTimestamp(chat, otherSameApodo), 0);

    // Departing user Gustavo Mac IS marked as left voluntarily
    assert.equal(isUserLeftVoluntarilyFromChat(chat, gustavo), true);
    assert.equal(isUserRemovedFromChat(chat, gustavo), true);
    assert.equal(getUserChatDepartureTimestamp(chat, gustavo), Date.parse('2026-11-18T13:07:00Z'));
  } finally {
    if (prevStorage === undefined) delete (globalThis as any).localStorage;
    else (globalThis as any).localStorage = prevStorage;
  }
});

test('isDuplicateMessage and deduplicateMessages never drop distinct retired messages from same sender within 60 seconds', () => {
  const adminRemovedMsg = {
    id: 'msg_1794966076798_i6neu',
    senderId: '58d9efbd-c07c-418b-a29b-4ca670f6091d',
    sender: 'Marito',
    text: 'Este mensaje fue retirado por el moderador del grupo.',
    isDeleted: true,
    deletedByAdmin: false,
    deletedByGroupModerator: true,
    timestamp: 1794966076798,
    createdAt: '2026-11-18T01:41:16.798+00:00'
  };

  const modRemovedMsg = {
    id: 'msg_1794966088445_1bnpq',
    senderId: '58d9efbd-c07c-418b-a29b-4ca670f6091d',
    sender: 'Marito',
    text: 'Este mensaje fue retirado por el moderador del grupo.',
    isDeleted: true,
    deletedByAdmin: false,
    deletedByGroupModerator: true,
    timestamp: 1794966088445,
    createdAt: '2026-11-18T01:41:28.445+00:00'
  };

  const adminRemovedMsg2 = {
    id: 'msg_1794966099000_x9999',
    senderId: '58d9efbd-c07c-418b-a29b-4ca670f6091d',
    sender: 'Marito',
    text: 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65',
    isDeleted: true,
    deletedByAdmin: true,
    deletedByGroupModerator: false,
    timestamp: 1794966099000,
    createdAt: '2026-11-18T01:41:39.000+00:00'
  };

  assert.equal(isDuplicateMessage(adminRemovedMsg, modRemovedMsg), false);
  const deduped = deduplicateMessages([adminRemovedMsg, modRemovedMsg, adminRemovedMsg2]);
  assert.equal(deduped.length, 3);
  assert.deepEqual(deduped.map(m => m.id), [
    'msg_1794966076798_i6neu',
    'msg_1794966088445_1bnpq',
    'msg_1794966099000_x9999'
  ]);
});

test('deduplicateMessages preserves admin deletion notice when merging optimistic deleted message with stale server message', () => {
  const optimisticDeleted = {
    id: 'msg_abc_1',
    senderId: 'u_1',
    sender: 'Marito',
    text: 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65',
    isDeleted: true,
    deletedByAdmin: true,
    deletedByGroupModerator: false,
    timestamp: 1794966076798
  };

  const staleOrDowngraded = {
    id: 'msg_abc_1',
    senderId: 'u_1',
    sender: 'Marito',
    text: 'Este mensaje fue retirado por el moderador del grupo.',
    isDeleted: true,
    deletedByAdmin: false,
    deletedByGroupModerator: true,
    timestamp: 1794966076798
  };

  const merged = deduplicateMessages([optimisticDeleted, staleOrDowngraded]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].isDeleted, true);
  assert.equal(merged[0].deletedByAdmin, true);
  assert.equal(merged[0].deletedByGroupModerator, false);
  assert.equal(
    merged[0].text,
    'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65'
  );
});

test('resolveActivityById matches numeric activity IDs against string chat activityIds', () => {
  const activities = [
    { id: 1794619532917, title: 'Caminata en el Parque' },
    { id: 42, title: 'Taller de Cerámica' }
  ];

  assert.equal(resolveActivityById(activities, '1794619532917')?.title, 'Caminata en el Parque');
  assert.equal(resolveActivityById(activities, 1794619532917)?.title, 'Caminata en el Parque');
  assert.equal(resolveActivityById(activities, '42')?.title, 'Taller de Cerámica');
  assert.equal(resolveActivityById(activities, null), undefined);
  assert.equal(resolveActivityById(activities, undefined), undefined);
  assert.equal(resolveActivityById(activities, '999999'), undefined);
});

test('resolveActivityForChat resolves activity chats with string/number IDs or legacy titles without matching free groups', () => {
  const activities = [
    { id: 1794619532917, title: 'Caminata en el Parque' },
    { id: 88, title: 'Taller de Tejido' }
  ];

  // 1. Activity chat with string activityId (common Supabase chats.actividad_id shape)
  const chatWithStringId = {
    id: 'uuid-chat-1',
    type: 'grupal',
    title: 'Caminata en el Parque',
    activityId: '1794619532917'
  };
  assert.equal(resolveActivityForChat(chatWithStringId, activities)?.id, 1794619532917);

  // 2. Activity chat with actividad_id field instead of activityId
  const chatWithSpanishCol = {
    id: 'uuid-chat-2',
    type: 'grupal',
    title: 'Taller de Tejido',
    actividad_id: '88'
  };
  assert.equal(resolveActivityForChat(chatWithSpanishCol, activities)?.id, 88);

  // 3. Legacy activity group without activityId but identified via subtitle or tipo
  const legacyActivityChat = {
    id: 'uuid-chat-3',
    type: 'grupal',
    title: 'Grupo: Taller de Tejido',
    subtitle: 'Canal de la actividad: Taller de Tejido'
  };
  assert.equal(resolveActivityForChat(legacyActivityChat, activities)?.id, 88);

  // 4. Free neighborhood group (grupo_libre) with matching title must NOT falsely resolve to an activity
  const freeGroupChat = {
    id: 'uuid-chat-4',
    type: 'grupal',
    title: 'Taller de Tejido',
    subtitle: 'Grupo vecinal'
  };
  assert.equal(resolveActivityForChat(freeGroupChat, activities), undefined);
});

test('buildAttendanceNomina resolves participant emergency contacts across apodo, usuario, and snake_case DB fields', () => {
  const usersMap = {
    u1: { id: 'u1', usuario: 'marta65', apodo: 'Marta', contactoEmergencia: '11-5555-1111' },
    u2: { id: 'u2', usuario: 'roberto_g', apodo: 'Roberto', contacto_emergencia: '11-4444-2222' },
    u3: { id: 'u3', usuario: 'lucia_v', apodo: 'Lucía', contactoEmergencia: '' }
  };

  const nomina = buildAttendanceNomina(['Marta', 'roberto_g', 'Lucía', 'SinDatos'], usersMap);
  assert.deepEqual(nomina, [
    { nombre: 'Marta', contacto: '11-5555-1111' },
    { nombre: 'roberto_g', contacto: '11-4444-2222' },
    { nombre: 'Lucía', contacto: '-' },
    { nombre: 'SinDatos', contacto: '-' }
  ]);
});

test('isAdministratorUser and isUserAdminByReference detect all administrator role variants', () => {
  assert.equal(isAdministratorUser({ id: 'u1', tipo: 'moderador' }), true);
  assert.equal(isAdministratorUser({ id: 'u2', rol: 'administrador' }), true);
  assert.equal(isAdministratorUser({ id: 'u3', tipo: 'Admin' }), true);
  assert.equal(isAdministratorUser({ id: 'u4', tipo: 'personal' }), false);
  assert.equal(isAdministratorUser({ id: 'u5', tipo: 'institucional' }), false);
  assert.equal(isAdministratorUser(null), false);

  const usersMap = {
    admin_1: { id: 'u_admin', usuario: 'admin_sofia', apodo: 'Sofía Admin', tipo: 'moderador' },
    vecino_1: { id: 'u_vecino', usuario: 'marta65', apodo: 'Marta', tipo: 'personal' }
  };

  assert.equal(isUserAdminByReference('Sofía Admin', usersMap), true);
  assert.equal(isUserAdminByReference('admin_sofia', usersMap), true);
  assert.equal(isUserAdminByReference({ nombre: 'Sofía Admin', userId: 'u_admin' }, usersMap), true);
  assert.equal(isUserAdminByReference('Marta', usersMap), false);
  assert.equal(isUserAdminByReference({ nombre: 'Marta', userId: 'u_vecino' }, usersMap), false);
});

test('filterAndSortRecentChats hides ALL group chats from administrators while keeping private 1-to-1 chats visible', () => {
  const adminUser = {
    id: 'usr_admin_1',
    usuario: 'admin_club',
    apodo: 'Admin CLUB65',
    tipo: 'moderador',
    rol: 'moderador'
  };

  const approvedActivity = {
    id: 501,
    title: 'Caminata Saludable',
    isApproved: true,
    proposalStatus: 'aprobada',
    organizer: 'Admin CLUB65',
    organizer_id: 'usr_admin_1',
    enrolled_usernames: ['Admin CLUB65', 'Marta']
  };

  const chats = [
    {
      id: 'chat-act-501',
      title: 'Caminata Saludable',
      type: 'grupal',
      activityId: 501,
      participants: ['Admin CLUB65', 'Marta'],
      messages: []
    },
    {
      id: 'chat-free-1',
      title: 'Vecinos del Barrio',
      type: 'grupal',
      creatorId: 'usr_admin_1',
      participants: ['Admin CLUB65', 'Marta'],
      messages: []
    },
    {
      id: 'chat-priv-1',
      title: 'Marta',
      type: 'privado',
      participants: ['Admin CLUB65', 'Marta'],
      messages: [{ id: 'm1', sender: 'Marta', text: 'Hola admin', createdAt: '2026-05-01T12:00:00Z' }]
    }
  ];

  const visible = filterAndSortRecentChats(chats, adminUser, [approvedActivity]);
  assert.equal(visible.length, 1, 'Admin must only see private 1-to-1 chats, never group chats');
  assert.equal(visible[0].id, 'chat-priv-1');
  assert.equal(visible[0].type, 'privado');
});

test('validateGroupCreation blocks administrators from creating groups or being invited to groups', () => {
  const adminUser = { id: 'u_admin', usuario: 'admin_sofia', apodo: 'Sofía Admin', tipo: 'moderador' };
  const regularUser = { id: 'u_vecino', usuario: 'marta65', apodo: 'Marta', tipo: 'personal' };
  const usersMap = {
    admin_sofia: adminUser,
    marta65: regularUser,
    roberto: { id: 'u_rob', usuario: 'roberto', apodo: 'Roberto', tipo: 'personal' }
  };

  const byAdmin = validateGroupCreation('Mateada', ['Marta'], adminUser, usersMap);
  assert.equal(byAdmin.valid, false);
  assert.match(byAdmin.error || '', /administradores no pueden/i);

  const invitingAdmin = validateGroupCreation('Mateada', ['Sofía Admin'], regularUser, usersMap);
  assert.equal(invitingAdmin.valid, false);
  assert.match(invitingAdmin.error || '', /administradores no pueden/i);

  const validGroup = validateGroupCreation('Mateada', ['Roberto'], regularUser, usersMap);
  assert.equal(validGroup.valid, true);
  assert.deepEqual(validGroup.cleanParticipants, ['Roberto']);
});

test('getResolvedChatParticipants excludes administrator users from group participant lists', () => {
  const currentUser = { id: 'u_marta', usuario: 'marta65', apodo: 'Marta', tipo: 'personal' };
  const usersMap = {
    u_marta: currentUser,
    u_roberto: { id: 'u_roberto', usuario: 'roberto', apodo: 'Roberto', tipo: 'personal' },
    u_admin: { id: 'u_admin', usuario: 'admin_sofia', apodo: 'Sofía Admin', tipo: 'moderador' }
  };

  const groupChat = {
    id: 'grp-1',
    type: 'grupal',
    title: 'Mateada',
    creatorId: 'u_marta',
    participants: ['Marta', 'Roberto', 'Sofía Admin'],
    participantIds: ['u_marta', 'u_roberto', 'u_admin']
  };

  const resolved = getResolvedChatParticipants(groupChat, currentUser, usersMap, [], undefined);
  const names = resolved.map(p => p.displayName);
  assert.ok(names.includes('Marta'));
  assert.ok(names.includes('Roberto'));
  assert.equal(names.includes('Sofía Admin'), false, 'Administrator must never appear in group participant lists');
});
