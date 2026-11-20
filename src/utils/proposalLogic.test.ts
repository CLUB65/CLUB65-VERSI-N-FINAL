import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isUuidString,
  normalizeActivityIdForChat,
  isActivityChatEligible,
  doesDbChatRowMatchActivity,
  stripActivityMetaLines,
  buildResubmitProposalFields,
  resolveRealOrganizerDisplay,
  isPendingNeighborhoodProposal,
  partitionPendingNeighborhoodProposals,
  MAX_ACTIVITY_VIDEO_DURATION_SECONDS,
  validateActivityVideoDuration,
  resolveActivityVideoUrl,
  isMissingVideoUrlColumnError
} from './proposalLogic';
import {
  isProposalRejected,
  getRejectedProposalReason,
  hasMisActividadesRejectedAlert,
  filterPersonalMisActividades
} from './chatLogic';

test('normalizeActivityIdForChat supports both numeric activity IDs and UUIDs', () => {
  assert.equal(isUuidString('b554d3b9-a845-460e-ab1b-a437c55917f0'), true);
  assert.equal(isUuidString('1794619532917'), false);

  assert.equal(normalizeActivityIdForChat(1794619532917), 1794619532917);
  assert.equal(normalizeActivityIdForChat('1794619532917'), 1794619532917);
  assert.equal(
    normalizeActivityIdForChat('b554d3b9-a845-460e-ab1b-a437c55917f0'),
    'b554d3b9-a845-460e-ab1b-a437c55917f0'
  );
  assert.equal(normalizeActivityIdForChat(0), null);
  assert.equal(normalizeActivityIdForChat(-5), null);
  assert.equal(normalizeActivityIdForChat(''), null);
  assert.equal(normalizeActivityIdForChat(null), null);
});

test('isActivityChatEligible excludes unapproved, rejected, and cancelled proposals', () => {
  assert.equal(isActivityChatEligible({ id: 1, proposal_status: 'pendiente', is_approved: false }), false);
  assert.equal(isActivityChatEligible({ id: 2, proposal_status: 'cambios_solicitados', is_approved: false }), false);
  assert.equal(isActivityChatEligible({ id: 3, estado: 'pendiente' }), false);
  assert.equal(isActivityChatEligible({ id: 4, proposal_status: 'rechazada' }), false);
  assert.equal(isActivityChatEligible({ id: 5, proposal_status: 'baja_forzada' }), false);
  assert.equal(isActivityChatEligible({ id: 6, proposal_status: 'cancelada_organizador' }), false);
  assert.equal(isActivityChatEligible({ id: 7, fecha_baja: '2026-11-10T10:00:00Z', proposal_status: 'aprobada' }), false);
  assert.equal(isActivityChatEligible({ id: 8, is_approved: false }), false);

  assert.equal(isActivityChatEligible({ id: 9, proposal_status: 'aprobada', is_approved: true }), true);
  // Minimal mock without status fields stays eligible for backwards compatibility
  assert.equal(isActivityChatEligible({ id: 10, title: 'Taller' }), true);
});

test('doesDbChatRowMatchActivity prioritizes numeric/UUID actividad_id and prevents cross-activity collisions', () => {
  const rowNumeric = { id: 'c1', nombre: 'Grupo: Anterior', actividad_id: 1794619532917 };
  assert.equal(doesDbChatRowMatchActivity(rowNumeric, 1794619532917, 'Nombre Renombrado'), true);
  assert.equal(doesDbChatRowMatchActivity(rowNumeric, '1794619532917', 'Nombre Renombrado'), true);
  assert.equal(doesDbChatRowMatchActivity(rowNumeric, 999999999, 'Anterior'), false);

  const rowLegacyNullId = { id: 'c2', nombre: 'Grupo: Taller de Tejido', actividad_id: null };
  assert.equal(doesDbChatRowMatchActivity(rowLegacyNullId, 123, 'Taller de Tejido'), true);
  assert.equal(doesDbChatRowMatchActivity(rowLegacyNullId, 123, 'Otro Taller'), false);
});

test('stripActivityMetaLines removes appended metadata lines cleanly', () => {
  const dirty =
    'Traer mate y algo para compartir.\nPrimer encuentro: 20/11/2026\n\nLugar: Plaza Plate\nHorario: 16:00 h';
  assert.equal(stripActivityMetaLines(dirty), 'Traer mate y algo para compartir.');
});

test('buildResubmitProposalFields keeps English and Spanish DB columns synchronized on resubmit', () => {
  const currentAct = {
    id: 1794619532917,
    title: 'VAYAMOS JUNTOS AL CONCIERTO DE MONTANER',
    titulo: 'VAYAMOS JUNTOS AL CONCIERTO DE MONTANER',
    schedule: '25/11/2026 a las 20:00 h',
    location: 'Movistar Arena',
    lat: -34.5945,
    lng: -58.4478,
    capacity: 20,
    description: 'Vamos todos.\n\nLugar: Movistar Arena\nHorario: 25/11/2026',
    short_description: 'Concierto inolvidable',
    image: '',
    is_recurrent: false,
    feedback: 'Agregá la fecha exacta',
    changes_requested_at: '14/11/2026, 10:00 hs',
    creado_el: '14/11/2026, 09:30 hs',
    versions: []
  };

  const incoming = {
    title: 'Concierto de Montaner en Villa Crespo',
    category: 'musica',
    schedule: '28/11/2026 a las 20:30 h hasta las 23:00 h',
    direccion: 'Humboldt 450, CABA',
    lat: -34.5944,
    lng: -58.4477,
    tipoCupo: 'limitado',
    cupoMax: 15,
    descripcion: 'Nos encontramos 15 minutos antes en la entrada.\n\nLugar: Viejo',
    shortDescription: 'Noche de música en grupo',
    imagen: 'https://xklmlvhgmepepkiptzqg.supabase.co/storage/v1/object/public/actividades/cartelera/foto.jpg',
    isRecurrent: false,
    userFeedbackNote: 'Fecha y horario agregados'
  };

  const { updatePayload, nextVersions, cleanTitle, cleanImage } = buildResubmitProposalFields(
    currentAct,
    incoming,
    '14/11/2026, 11:00 hs'
  );

  assert.equal(cleanTitle, 'Concierto de Montaner en Villa Crespo');
  assert.equal(updatePayload.title, cleanTitle);
  assert.equal(updatePayload.titulo, cleanTitle);
  assert.equal(updatePayload.location, 'Humboldt 450, CABA');
  assert.equal(updatePayload.direccion, 'Humboldt 450, CABA');
  assert.equal(updatePayload.description, 'Nos encontramos 15 minutos antes en la entrada.');
  assert.equal(updatePayload.descripcion, 'Nos encontramos 15 minutos antes en la entrada.');
  assert.equal(updatePayload.short_description, 'Noche de música en grupo');
  assert.equal(updatePayload.avance, 'Noche de música en grupo');
  assert.equal(updatePayload.capacity, 15);
  assert.equal(updatePayload.cupo_maximo, 15);
  assert.equal(updatePayload.tipo_cupo, 'limitado');
  assert.equal(cleanImage, incoming.imagen);
  assert.equal(updatePayload.image, incoming.imagen);
  assert.equal(updatePayload.imagen_url, incoming.imagen);
  assert.equal(updatePayload.is_approved, false);
  assert.equal(updatePayload.proposal_status, 'pendiente');
  assert.equal(updatePayload.estado, 'pendiente');
  assert.equal(nextVersions.length, 2);
  assert.equal(nextVersions[0].moderationNote, 'Agregá la fecha exacta');
  assert.equal(nextVersions[1].title, cleanTitle);
  assert.equal(nextVersions[1].image, incoming.imagen);
});

test('resolveRealOrganizerDisplay resolves only real Supabase user data with zero demo profiles', () => {
  const realUsersMap = {
    'usr_1': {
      id: 'usr_1',
      usuario: 'nerina',
      apodo: 'Neri',
      avatar: 'https://cdn.example.com/neri.jpg',
      bio: 'Vecina de Caseros',
      localidad: 'Caseros',
      tipo: 'personal'
    },
    'inst_1': {
      id: 'inst_1',
      usuario: 'club65',
      apodo: 'CLUB65',
      avatar: 'https://cdn.example.com/club65.jpg',
      bio: 'Espacio comunitario oficial',
      localidad: 'Santos Lugares',
      tipo: 'institucional'
    }
  };

  const personalAct = {
    id: 101,
    organizerId: 'usr_1',
    organizer: 'usr_1',
    isInstitutional: false
  };
  const personalDisplay = resolveRealOrganizerDisplay(personalAct, null, realUsersMap);
  assert.equal(personalDisplay.organizerId, 'usr_1');
  assert.equal(personalDisplay.name, 'Neri');
  assert.equal(personalDisplay.avatar, 'https://cdn.example.com/neri.jpg');
  assert.equal(personalDisplay.isInstitutional, false);
  assert.equal(personalDisplay.location, 'Caseros');

  const instAct = {
    id: 1,
    title: 'Movilidad',
    organizerId: 'inst_1',
    organizer: 'CLUB65',
    isInstitutional: true
  };
  const instDisplay = resolveRealOrganizerDisplay(instAct, null, realUsersMap);
  assert.equal(instDisplay.organizerId, 'inst_1');
  assert.equal(instDisplay.name, 'CLUB65');
  assert.equal(instDisplay.avatar, 'https://cdn.example.com/club65.jpg');
  assert.equal(instDisplay.isInstitutional, true);
  assert.equal(instDisplay.location, 'Santos Lugares');
  assert.notEqual(instDisplay.name, 'Universidad Abierta de Tres de Febrero');
});

test('partitionPendingNeighborhoodProposals excludes organizer-cancelled and terminal states and stays consistent with sub-tabs', () => {
  const sampleActivities = [
    // Exact DB case that caused badge (1) with empty tabs: organizer-cancelled activity
    {
      id: 1794631605797,
      title: '4',
      isInstitutional: false,
      isApproved: false,
      proposalStatus: 'cancelada_organizador',
      estado: 'baja_forzada',
      canceladaPorOrganizador: true,
      fecha_baja: '2026-11-14T11:57:33.634+00:00'
    },
    {
      id: 1794966600178,
      title: '26',
      isInstitutional: false,
      isApproved: false,
      proposalStatus: 'rechazada',
      estado: 'rechazada'
    },
    {
      id: 10,
      title: 'Suspendida Admin',
      isInstitutional: false,
      isApproved: false,
      proposalStatus: 'baja_forzada',
      baja_forzada: true
    },
    {
      id: 11,
      title: 'Aprobada Vecinal',
      isInstitutional: false,
      isApproved: true,
      proposalStatus: 'aprobada'
    },
    {
      id: 12,
      title: 'Taller Institucional',
      isInstitutional: true,
      isApproved: true,
      proposalStatus: 'aprobada'
    },
    {
      id: 13,
      title: 'Propuesta Nueva',
      isInstitutional: false,
      isApproved: false,
      proposalStatus: 'pendiente',
      proposedAt: '17/11/2026, 10:00 hs'
    },
    {
      id: 14,
      title: 'Propuesta Sin Status Explícito',
      isInstitutional: false,
      isApproved: false
    },
    {
      id: 15,
      title: 'Propuesta Con Cambios Solicitados',
      isInstitutional: false,
      isApproved: false,
      proposalStatus: 'cambios_solicitados',
      changesRequestedAt: '17/11/2026, 09:00 hs'
    }
  ];

  assert.equal(isPendingNeighborhoodProposal(sampleActivities[0]), false);
  assert.equal(isPendingNeighborhoodProposal(sampleActivities[1]), false);
  assert.equal(isPendingNeighborhoodProposal(sampleActivities[2]), false);
  assert.equal(isPendingNeighborhoodProposal(sampleActivities[3]), false);
  assert.equal(isPendingNeighborhoodProposal(sampleActivities[4]), false);
  assert.equal(isPendingNeighborhoodProposal(sampleActivities[5]), true);
  assert.equal(isPendingNeighborhoodProposal(sampleActivities[6]), true);
  assert.equal(isPendingNeighborhoodProposal(sampleActivities[7]), true);

  const { pendingActivities, proposalsPorEvaluar, proposalsModificacionesSolicitadas } =
    partitionPendingNeighborhoodProposals(sampleActivities);

  assert.equal(pendingActivities.length, 3);
  assert.equal(proposalsPorEvaluar.length, 2);
  assert.equal(proposalsModificacionesSolicitadas.length, 1);
  assert.equal(
    pendingActivities.length,
    proposalsPorEvaluar.length + proposalsModificacionesSolicitadas.length
  );
  assert.deepEqual(
    proposalsPorEvaluar.map((a) => a.id).sort(),
    [13, 14]
  );
  assert.deepEqual(
    proposalsModificacionesSolicitadas.map((a) => a.id),
    [15]
  );
});

test('rejected/auto-expired proposals expose rejection status, reason, alert dot, and dismiss filtering', () => {
  const user = { id: 'usr_1793003176395_bi3dc', usuario: 'Nerina', apodo: 'Neri', tipo: 'personal' };
  const autoExpiredProposal = {
    id: 1794966600178,
    title: '26',
    organizerId: 'usr_1793003176395_bi3dc',
    isInstitutional: false,
    isApproved: false,
    proposalStatus: 'rechazada',
    estado: 'rechazada',
    rejectionReason: 'La propuesta fue desestimada automáticamente porque ya pasó la fecha y el horario de inicio.'
  };

  assert.equal(isProposalRejected(autoExpiredProposal), true);
  assert.equal(isPendingNeighborhoodProposal(autoExpiredProposal), false);
  assert.equal(
    getRejectedProposalReason(autoExpiredProposal),
    'La propuesta fue desestimada automáticamente porque ya pasó la fecha y el horario de inicio.'
  );
  assert.equal(hasMisActividadesRejectedAlert([autoExpiredProposal], user, [], []), true);
  assert.equal(hasMisActividadesRejectedAlert([autoExpiredProposal], user, [1794966600178], []), false);

  const visibleBeforeDismiss = filterPersonalMisActividades([autoExpiredProposal], user, []);
  assert.equal(visibleBeforeDismiss.length, 1);

  const visibleAfterDismiss = filterPersonalMisActividades([autoExpiredProposal], user, [1794966600178]);
  assert.equal(visibleAfterDismiss.length, 0);
});

test('validateActivityVideoDuration enforces 45-second max limit cleanly', () => {
  assert.equal(MAX_ACTIVITY_VIDEO_DURATION_SECONDS, 45);
  assert.deepEqual(validateActivityVideoDuration(12.4), { valid: true });
  assert.deepEqual(validateActivityVideoDuration(45), { valid: true });

  const overLimit = validateActivityVideoDuration(45.2);
  assert.equal(overLimit.valid, false);
  assert.match(overLimit.error || '', /45 segundos/);

  const longVideo = validateActivityVideoDuration(62);
  assert.equal(longVideo.valid, false);
  assert.match(longVideo.error || '', /62 seg/);

  assert.equal(validateActivityVideoDuration(0).valid, false);
  assert.equal(validateActivityVideoDuration(-5).valid, false);
  assert.equal(validateActivityVideoDuration(Number.NaN).valid, false);
});

test('resolveActivityVideoUrl resolves from column or latest version and respects removals/omissions', () => {
  const videoA = 'https://example.supabase.co/storage/v1/object/public/actividades/videos/intro.mp4';
  const videoB = 'https://example.supabase.co/storage/v1/object/public/reviews-media/actividades-videos/v2.mp4';

  // No video uploaded -> empty string (section hidden in details)
  assert.equal(resolveActivityVideoUrl({ id: 1, title: 'Sin video', versions: [{ version: 1, title: 'Sin video' }] }), '');
  assert.equal(resolveActivityVideoUrl(null), '');

  // Top-level Supabase video_url or mapped videoUrl
  assert.equal(resolveActivityVideoUrl({ id: 2, video_url: videoA }), videoA);
  assert.equal(resolveActivityVideoUrl({ id: 3, videoUrl: videoB }), videoB);

  // Stored inside versions JSONB (when video_url column does not exist in Supabase)
  assert.equal(
    resolveActivityVideoUrl({
      id: 4,
      versions: [{ version: 1, title: 'Con video', videoUrl: videoA }]
    }),
    videoA
  );
  assert.equal(
    resolveActivityVideoUrl({
      id: 5,
      versions: JSON.stringify([{ version: 1, videoUrl: videoA }])
    }),
    videoA
  );

  // Removed on latest version -> must NOT leak v1 video
  assert.equal(
    resolveActivityVideoUrl({
      id: 6,
      versions: [
        { version: 1, videoUrl: videoA },
        { version: 2, videoUrl: '' }
      ]
    }),
    ''
  );

  // Version preview object explicitly setting videoUrl: '' must NOT leak baseAct.versions
  assert.equal(
    resolveActivityVideoUrl({
      id: -101,
      videoUrl: '',
      video_url: '',
      versions: [{ version: 1, videoUrl: videoA }]
    }),
    ''
  );
});

test('isMissingVideoUrlColumnError detects PostgREST and Postgres missing column errors only', () => {
  assert.equal(
    isMissingVideoUrlColumnError({
      code: 'PGRST204',
      message: "Could not find the 'video_url' column of 'activities' in the schema cache"
    }),
    true
  );
  assert.equal(
    isMissingVideoUrlColumnError({
      code: '42703',
      message: 'column activities.video_url does not exist'
    }),
    true
  );
  assert.equal(
    isMissingVideoUrlColumnError({
      code: '42501',
      message: 'new row violates row-level security policy for table activities'
    }),
    false
  );
  assert.equal(isMissingVideoUrlColumnError(null), false);
});

test('buildResubmitProposalFields preserves, updates, and clears optional videoUrl in versions and payload', () => {
  const videoV1 = 'https://example.supabase.co/storage/v1/object/public/actividades/videos/v1.mp4';
  const videoV2 = 'https://example.supabase.co/storage/v1/object/public/actividades/videos/v2.mp4';

  const baseAct = {
    id: 500,
    title: 'Taller de Fotografía',
    schedule: '10/12/2026 a las 17:00 h',
    location: 'Plaza Plate',
    capacity: 20,
    description: 'Traer celular o cámara.',
    short_description: 'Aprendemos fotografía',
    image: '',
    is_recurrent: false,
    versions: [{ version: 1, title: 'Taller de Fotografía', videoUrl: videoV1 }]
  };

  // 1. Omitting videoUrl preserves v1 video
  const preserved = buildResubmitProposalFields(baseAct, { title: 'Taller de Fotografía Digital' }, '18/11/2026, 10:00 hs');
  assert.equal(preserved.cleanVideoUrl, videoV1);
  assert.equal(preserved.nextVersions[1].videoUrl, videoV1);
  assert.equal('video_url' in preserved.updatePayload, false);

  // 2. Updating videoUrl stores new URL in versions and updatePayload
  const updated = buildResubmitProposalFields(baseAct, { videoUrl: videoV2 }, '18/11/2026, 11:00 hs');
  assert.equal(updated.cleanVideoUrl, videoV2);
  assert.equal(updated.nextVersions[1].videoUrl, videoV2);
  assert.equal(updated.updatePayload.video_url, videoV2);

  // 3. Clearing videoUrl sets empty string in latest version and null in updatePayload
  const cleared = buildResubmitProposalFields(baseAct, { videoUrl: '' }, '18/11/2026, 12:00 hs');
  assert.equal(cleared.cleanVideoUrl, '');
  assert.equal(cleared.nextVersions[1].videoUrl, '');
  assert.equal(cleared.updatePayload.video_url, null);
  assert.equal(resolveActivityVideoUrl({ id: 500, versions: cleared.nextVersions }), '');
});


