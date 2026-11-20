import {
  sanitizeProfileAvatar,
  sanitizeProfileBio,
  isActivityCancelledByOrganizer,
  isActivitySuspendedByAdmin,
  isProposalRejected,
  getProposalSortingTime
} from './chatLogic.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuidString(value: unknown): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

/**
 * Normaliza el ID de una actividad para consultas e inserciones en la columna `chats.actividad_id`.
 * Soporta tanto IDs numéricos (ej: Date.now() / bigint) como UUIDs.
 */
export function normalizeActivityIdForChat(activityId: unknown): number | string | null {
  if (activityId === null || activityId === undefined) return null;
  const raw = String(activityId).trim();
  if (!raw) return null;
  if (isUuidString(raw)) return raw;
  const num = Number(raw);
  if (!isNaN(num) && Number.isFinite(num) && num > 0 && /^\d+$/.test(raw)) {
    return num;
  }
  return null;
}

/**
 * Determina si una actividad debe tener un grupo de chat activo/sincronizado.
 * Las propuestas vecinales pendientes, con cambios solicitados, rechazadas,
 * dadas de baja o canceladas NO deben generar ni sincronizar chats grupales.
 */
export function isActivityChatEligible(act: any): boolean {
  if (!act) return false;
  const hasFechaBaja =
    act.fecha_baja !== undefined &&
    act.fecha_baja !== null &&
    String(act.fecha_baja).trim() !== '';
  if (hasFechaBaja) return false;

  const actStatus = String(act.proposal_status || act.proposalStatus || act.estado || '')
    .toLowerCase()
    .trim();

  if (
    actStatus === 'pendiente' ||
    actStatus === 'cambios_solicitados' ||
    actStatus === 'rechazada' ||
    actStatus === 'baja_forzada' ||
    actStatus === 'cancelada_organizador'
  ) {
    return false;
  }

  if (act.is_approved === false || act.isApproved === false) {
    return false;
  }

  return true;
}

/**
 * Determina si una actividad es una propuesta vecinal realmente pendiente de moderación
 * (excluye institucionales, aprobadas, rechazadas, suspendidas por admin y canceladas por el organizador).
 */
export function isPendingNeighborhoodProposal(act: any): boolean {
  if (!act) return false;
  if (
    act.isInstitutional ||
    act.is_institutional ||
    act.es_institucional ||
    act.organizerId === 'institucional'
  ) {
    return false;
  }

  const propStatus = String(act.proposalStatus || act.proposal_status || '').toLowerCase().trim();
  const estado = String(act.estado || '').toLowerCase().trim();

  if (act.isApproved === true || act.is_approved === true || propStatus === 'aprobada' || estado === 'aprobada') {
    return false;
  }

  if (isActivitySuspendedByAdmin(act) || isActivityCancelledByOrganizer(act) || isProposalRejected(act)) {
    return false;
  }

  return true;
}

/**
 * Filtra, ordena y particiona las propuestas vecinales pendientes entre "Por evaluar"
 * y "Modificaciones solicitadas", garantizando que pendingActivities.length siempre coincida
 * con la suma de ambas sub-pestañas del panel de administración.
 */
export function partitionPendingNeighborhoodProposals<T = any>(activities: T[]): {
  pendingActivities: T[];
  proposalsPorEvaluar: T[];
  proposalsModificacionesSolicitadas: T[];
} {
  const pendingActivities = (Array.isArray(activities) ? activities : [])
    .filter((act) => isPendingNeighborhoodProposal(act))
    .sort((a, b) => getProposalSortingTime(b as any) - getProposalSortingTime(a as any));

  const proposalsModificacionesSolicitadas: T[] = [];
  const proposalsPorEvaluar: T[] = [];

  for (const act of pendingActivities) {
    const propStatus = String((act as any)?.proposalStatus || (act as any)?.proposal_status || '')
      .toLowerCase()
      .trim();
    if (propStatus === 'cambios_solicitados') {
      proposalsModificacionesSolicitadas.push(act);
    } else {
      proposalsPorEvaluar.push(act);
    }
  }

  return {
    pendingActivities,
    proposalsPorEvaluar,
    proposalsModificacionesSolicitadas
  };
}

export function normalizeGroupTitleForMatch(str?: string | null): string {
  return String(str || '')
    .replace(/^grupo:\s*/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Comprueba si una fila de `chats` pertenece a la actividad indicada,
 * priorizando `actividad_id` (numérico o UUID) y cayendo a título solo si `actividad_id` es nulo.
 */
export function doesDbChatRowMatchActivity(
  chatRow: { actividad_id?: unknown; nombre?: string | null } | null | undefined,
  activityId: unknown,
  activityTitle?: string | null
): boolean {
  if (!chatRow) return false;
  const normActId = normalizeActivityIdForChat(activityId);
  const normChatActId = normalizeActivityIdForChat(chatRow.actividad_id);

  if (normActId !== null && normChatActId !== null) {
    return String(normChatActId) === String(normActId);
  }

  const cleanTarget = normalizeGroupTitleForMatch(activityTitle);
  const cleanChat = normalizeGroupTitleForMatch(chatRow.nombre);
  return Boolean(cleanTarget && cleanChat && cleanChat === cleanTarget);
}

/**
 * Limpia líneas heredadas de formato ("Lugar:", "Horario:", "Primer encuentro:") de una descripción.
 */
export function stripActivityMetaLines(text?: string | null): string {
  return String(text || '')
    .replace(/Primer encuentro:\s*[^\n]+\n?/gi, '')
    .replace(/Lugar:\s*[^\n]+\n?/gi, '')
    .replace(/Horario:\s*[^\n]+\n?/gi, '')
    .trim();
}

export const MAX_ACTIVITY_VIDEO_DURATION_SECONDS = 45;

export function validateActivityVideoDuration(durationSeconds: number): { valid: boolean; error?: string } {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return {
      valid: false,
      error: 'No se pudo determinar la duración del video seleccionado.'
    };
  }
  if (durationSeconds > MAX_ACTIVITY_VIDEO_DURATION_SECONDS) {
    return {
      valid: false,
      error: `El video dura ${Math.round(durationSeconds)} seg. El límite máximo permitido es de ${MAX_ACTIVITY_VIDEO_DURATION_SECONDS} segundos.`
    };
  }
  return { valid: true };
}

export function resolveActivityVideoUrl(activityOrRow: any, explicitVersions?: any[]): string {
  if (!activityOrRow || typeof activityOrRow !== 'object') return '';

  if (typeof activityOrRow.video_url === 'string' && activityOrRow.video_url.trim()) {
    return activityOrRow.video_url.trim();
  }
  if (typeof activityOrRow.videoUrl === 'string' && activityOrRow.videoUrl.trim()) {
    return activityOrRow.videoUrl.trim();
  }

  if (
    explicitVersions === undefined &&
    (('videoUrl' in activityOrRow && activityOrRow.videoUrl === '') ||
      ('video_url' in activityOrRow && activityOrRow.video_url === ''))
  ) {
    return '';
  }

  const rawVersions = explicitVersions !== undefined ? explicitVersions : activityOrRow.versions;
  let versions: any[] = [];
  if (Array.isArray(rawVersions)) {
    versions = rawVersions;
  } else if (typeof rawVersions === 'string' && rawVersions.trim()) {
    try {
      const parsed = JSON.parse(rawVersions);
      if (Array.isArray(parsed)) versions = parsed;
    } catch {
      versions = [];
    }
  }

  if (versions.length > 0) {
    const latest = versions[versions.length - 1];
    if (latest && typeof latest === 'object' && ('videoUrl' in latest || 'video_url' in latest)) {
      return String(latest.videoUrl ?? latest.video_url ?? '').trim();
    }
  }

  return '';
}

export function isMissingVideoUrlColumnError(error: any): boolean {
  if (!error) return false;
  const code = String(error?.code || '').toUpperCase();
  const msg = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  if (!msg.includes('video_url')) return false;
  return (
    code === 'PGRST204' ||
    code === '42703' ||
    /column|schema cache|does not exist|could not find/.test(msg)
  );
}

/**
 * Normaliza los campos de reenvío de una propuesta vecinal manteniendo sincronizadas
 * las columnas en inglés (`title`, `image`, `location`, ...) y español (`titulo`, `imagen_url`, `direccion`, ...).
 */
export function buildResubmitProposalFields(
  currentAct: any,
  data: Record<string, any>,
  nowFormatted: string
): {
  updatePayload: Record<string, any>;
  nextVersions: any[];
  cleanTitle: string;
  cleanImage: string;
  cleanVideoUrl: string;
} {
  let versions: any[] = [];
  if (currentAct?.versions) {
    versions = Array.isArray(currentAct.versions)
      ? [...currentAct.versions]
      : typeof currentAct.versions === 'string'
        ? (() => {
            try {
              const parsed = JSON.parse(currentAct.versions);
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })()
        : [];
  }

  const currentCleanDesc = stripActivityMetaLines(currentAct?.description || currentAct?.descripcion);
  const currentTitle = String(currentAct?.title || currentAct?.titulo || '').trim();
  const currentSchedule = String(currentAct?.schedule || currentAct?.horario_resumen || '').trim();
  const currentLocation = String(currentAct?.location || currentAct?.direccion || '').trim();
  const currentShortDesc = String(currentAct?.short_description || currentAct?.avance || '').trim();
  const currentImage = String(currentAct?.image || currentAct?.imagen_url || '').trim();
  const currentVideoUrl = resolveActivityVideoUrl(currentAct, versions);

  if (versions.length === 0 && currentAct) {
    versions = [
      {
        version: 1,
        date: currentAct.creado_el || currentAct.proposed_at || currentAct.created_at || nowFormatted,
        title: currentTitle,
        schedule: currentSchedule,
        location: currentLocation,
        lat: currentAct.lat,
        lng: currentAct.lng,
        capacity: currentAct.capacity !== undefined ? currentAct.capacity : 20,
        description: currentCleanDesc,
        shortDescription: currentShortDesc,
        image: currentImage,
        ...(currentVideoUrl ? { videoUrl: currentVideoUrl } : {}),
        isRecurrent: Boolean(currentAct.is_recurrent),
        note: 'Versión original de la propuesta',
        moderationNote: currentAct.feedback || currentAct.proposal_note || '',
        moderationDate: currentAct.changes_requested_at || nowFormatted
      }
    ];
  } else if (versions.length > 0 && currentAct) {
    if (!versions[0].moderationNote && (currentAct.feedback || currentAct.proposal_note)) {
      versions[0] = {
        ...versions[0],
        moderationNote: currentAct.feedback || currentAct.proposal_note,
        moderationDate: currentAct.changes_requested_at || nowFormatted
      };
    }
  }

  const resolvedTitle = String(
    data.title ?? data.nombre ?? currentTitle
  ).trim();
  const resolvedCategory = data.category ?? data.categoria ?? currentAct?.category ?? currentAct?.categoria;
  const resolvedSchedule = data.schedule ?? data.horario ?? currentSchedule;
  const resolvedLocation = String(
    data.location ?? data.direccion ?? data.ubicacion ?? currentLocation
  ).trim();
  const resolvedShortDesc = String(
    data.shortDescription ?? data.avance ?? currentShortDesc
  ).trim();
  const rawIncomingDesc = data.description ?? data.descripcion;
  const resolvedCleanDesc = rawIncomingDesc !== undefined
    ? stripActivityMetaLines(String(rawIncomingDesc))
    : currentCleanDesc;

  const rawCapacity = data.capacity !== undefined ? data.capacity : data.cupoMax;
  const resolvedCapacity = rawCapacity !== undefined
    ? Number(rawCapacity)
    : (data.tipoCupo === 'ilimitado' ? 999 : currentAct?.capacity);

  const rawIncomingImage = data.image ?? data.imagen ?? data.foto ?? data.imagen_url;
  const resolvedImage = rawIncomingImage !== undefined
    ? String(rawIncomingImage || '').trim()
    : currentImage;

  const rawIncomingVideo = data.videoUrl !== undefined ? data.videoUrl : data.video_url;
  const resolvedVideoUrl = rawIncomingVideo !== undefined
    ? String(rawIncomingVideo || '').trim()
    : currentVideoUrl;

  const resolvedLat = typeof data.lat === 'number' ? data.lat : currentAct?.lat;
  const resolvedLng = typeof data.lng === 'number' ? data.lng : currentAct?.lng;
  const resolvedIsRecurrent = data.isRecurrent !== undefined
    ? Boolean(data.isRecurrent)
    : Boolean(currentAct?.is_recurrent);

  const userNote = String(data.userFeedbackNote || 'Modificaciones enviadas por el organizador.').trim();

  const nextVerNum = versions.length + 1;
  versions.push({
    version: nextVerNum,
    date: nowFormatted,
    title: resolvedTitle,
    schedule: resolvedSchedule,
    location: resolvedLocation,
    lat: resolvedLat,
    lng: resolvedLng,
    capacity: resolvedCapacity,
    description: resolvedCleanDesc,
    shortDescription: resolvedShortDesc,
    image: resolvedImage,
    videoUrl: resolvedVideoUrl,
    isRecurrent: resolvedIsRecurrent,
    note: userNote
  });

  const startDate = data.startDate ?? data.fechaIni;
  const endDate = data.endDate ?? data.fechaFin;
  const startTime = data.startTime ?? data.horaIni;
  const endTime = data.endTime ?? data.horaFin;
  const frequency = data.frequency ?? data.frecuencia;

  const updatePayload: Record<string, any> = {
    is_approved: false,
    proposal_status: 'pendiente',
    estado: 'pendiente',
    rejection_reason: null,
    admin_comments: null,
    changes_submitted_at: nowFormatted,
    user_feedback_note: userNote,
    versions
  };

  if (resolvedTitle) {
    updatePayload.title = resolvedTitle;
    updatePayload.titulo = resolvedTitle;
  }
  if (resolvedCategory) {
    updatePayload.category = resolvedCategory;
    updatePayload.categoria = resolvedCategory;
  }
  if (resolvedSchedule) {
    updatePayload.schedule = resolvedSchedule;
    updatePayload.horario_resumen = resolvedSchedule;
  }
  if (resolvedLocation) {
    updatePayload.location = resolvedLocation;
    updatePayload.direccion = resolvedLocation;
  }
  if (typeof data.lat === 'number') {
    updatePayload.lat = data.lat;
    updatePayload.latitud = data.lat;
  }
  if (typeof data.lng === 'number') {
    updatePayload.lng = data.lng;
    updatePayload.longitud = data.lng;
  }
  if (resolvedCapacity !== undefined && !isNaN(Number(resolvedCapacity))) {
    updatePayload.capacity = Number(resolvedCapacity);
    updatePayload.cupo_maximo = Number(resolvedCapacity);
    updatePayload.tipo_cupo = Number(resolvedCapacity) >= 999 || Number(resolvedCapacity) === 0 ? 'ilimitado' : 'limitado';
  }
  if (resolvedShortDesc) {
    updatePayload.short_description = resolvedShortDesc;
    updatePayload.avance = resolvedShortDesc;
  }
  if (rawIncomingDesc !== undefined) {
    updatePayload.description = resolvedCleanDesc;
    updatePayload.descripcion = resolvedCleanDesc;
  }
  if (rawIncomingImage !== undefined) {
    updatePayload.image = resolvedImage || null;
    updatePayload.imagen_url = resolvedImage || null;
  }
  if (rawIncomingVideo !== undefined) {
    updatePayload.video_url = resolvedVideoUrl || null;
  }
  if (startDate !== undefined) {
    updatePayload.start_date = startDate || null;
    updatePayload.fecha_inicio = startDate || null;
  }
  if (endDate !== undefined) {
    updatePayload.end_date = endDate || null;
    updatePayload.fecha_fin = endDate || null;
  }
  if (startTime !== undefined) {
    updatePayload.start_time = startTime || null;
    updatePayload.hora_inicio = startTime || null;
  }
  if (endTime !== undefined) {
    updatePayload.end_time = endTime || null;
    updatePayload.hora_fin = endTime || null;
  }
  if (data.isRecurrent !== undefined) {
    updatePayload.is_recurrent = Boolean(data.isRecurrent);
    updatePayload.es_recurrente = Boolean(data.isRecurrent);
    if (!data.isRecurrent) {
      updatePayload.first_encounter_date = null;
      updatePayload.first_encounter_start_time = null;
      updatePayload.first_encounter_end_time = null;
      updatePayload.cerrar_inscripcion_al_iniciar_primer_encuentro = false;
      updatePayload.frecuencia_tipo = 'unico';
    }
  }
  if (resolvedIsRecurrent) {
    if (frequency) updatePayload.frecuencia_tipo = frequency;
    if (Array.isArray(data.diasSemana || data.dias_semana)) {
      updatePayload.dias_semana = data.diasSemana || data.dias_semana;
    }
    if (data.cantidadEventos !== undefined || data.cantidad_eventos !== undefined) {
      updatePayload.cantidad_eventos = Number(data.cantidadEventos ?? data.cantidad_eventos);
    }
    if (data.cerrarInscripcionAlIniciarPrimerEncuentro !== undefined) {
      updatePayload.cerrar_inscripcion_al_iniciar_primer_encuentro = Boolean(
        data.cerrarInscripcionAlIniciarPrimerEncuentro
      );
    }
    if (data.firstEncounterDate) updatePayload.first_encounter_date = data.firstEncounterDate;
    if (data.firstEncounterStartTime) updatePayload.first_encounter_start_time = data.firstEncounterStartTime;
    if (data.firstEncounterEndTime) updatePayload.first_encounter_end_time = data.firstEncounterEndTime;
  }

  return {
    updatePayload,
    nextVersions: versions,
    cleanTitle: resolvedTitle,
    cleanImage: resolvedImage,
    cleanVideoUrl: resolvedVideoUrl
  };
}

export interface RealOrganizerDisplay {
  organizerId: string;
  name: string;
  avatar: string | null;
  isInstitutional: boolean;
  bio: string;
  location: string;
}

function isTechnicalIdString(str?: string | null, organizerId?: string | null): boolean {
  if (!str) return true;
  const trimmed = str.trim();
  if (!trimmed) return true;
  if (UUID_REGEX.test(trimmed)) return true;
  if (/^usr_/i.test(trimmed)) return true;
  if (organizerId && trimmed === organizerId) return true;
  return false;
}

/**
 * Resuelve los datos visuales del organizador exclusivamente a partir de usuarios reales de Supabase.
 * Nunca inyecta perfiles de demostración ni datos hardcodeados.
 */
export function resolveRealOrganizerDisplay(
  act: any,
  currentUser: any,
  allUsersMap: Record<string, any> = {}
): RealOrganizerDisplay {
  if (!act) {
    return {
      organizerId: '',
      name: '',
      avatar: null,
      isInstitutional: false,
      bio: '',
      location: ''
    };
  }

  const orgIdCandidates = [
    act.organizerId,
    act.organizer_id,
    act.creador_id,
    act.organizador_id,
    act.userId,
    act.createdById
  ]
    .filter(Boolean)
    .map((c: any) => String(c).trim());

  const orgNameCandidates = [
    act.organizer,
    act.organizerNombre,
    act.creador
  ]
    .filter((c: any) => Boolean(c) && !isTechnicalIdString(String(c)))
    .map((c: any) => String(c).trim());

  const usersValues = Object.values(allUsersMap || {});

  const isMineById = Boolean(
    currentUser?.id &&
      orgIdCandidates.some((id) => id.toLowerCase() === String(currentUser.id).toLowerCase())
  );
  const isMineByName = Boolean(
    orgIdCandidates.length === 0 &&
      currentUser &&
      orgNameCandidates.some((c) => {
        const cl = c.toLowerCase();
        return (
          cl === String(currentUser.usuario || '').toLowerCase() ||
          cl === String(currentUser.apodo || '').toLowerCase() ||
          cl === String(currentUser.nombre || '').toLowerCase()
        );
      })
  );

  let matchedOrgUser: any = isMineById || isMineByName ? currentUser : null;

  if (!matchedOrgUser) {
    for (const idCand of orgIdCandidates) {
      const found =
        allUsersMap[idCand] ||
        allUsersMap[idCand.toLowerCase()] ||
        usersValues.find((u: any) => u?.id && String(u.id).toLowerCase() === idCand.toLowerCase());
      if (found) {
        matchedOrgUser = found;
        break;
      }
    }
  }

  if (!matchedOrgUser) {
    for (const nameCand of orgNameCandidates) {
      const low = nameCand.toLowerCase();
      const found =
        allUsersMap[low] ||
        usersValues.find(
          (u: any) =>
            u &&
            [u.usuario, u.apodo, u.nombre, u.email]
              .filter(Boolean)
              .some((t: any) => String(t).toLowerCase().trim() === low)
        );
      if (found) {
        matchedOrgUser = found;
        break;
      }
    }
  }

  const primaryOrgId = matchedOrgUser?.id
    ? String(matchedOrgUser.id)
    : (orgIdCandidates[0] || '');

  const isInstitutional = matchedOrgUser
    ? (matchedOrgUser.tipo === 'institucional' ||
       matchedOrgUser.rol === 'institucional' ||
       Boolean(act.isInstitutional || act.is_institutional))
    : Boolean(act.isInstitutional || act.is_institutional);

  const resolvedName =
    matchedOrgUser?.apodo ||
    matchedOrgUser?.usuario ||
    matchedOrgUser?.nombre ||
    orgNameCandidates.find((c) => !isTechnicalIdString(c, primaryOrgId)) ||
    (isInstitutional ? 'Institución' : 'Organizador');

  const rawAvatar = matchedOrgUser
    ? (matchedOrgUser.avatar ||
       matchedOrgUser.foto ||
       matchedOrgUser.image ||
       matchedOrgUser.photo_url ||
       matchedOrgUser.avatar_url ||
       null)
    : (act.organizerAvatar || null);

  return {
    organizerId: primaryOrgId,
    name: resolvedName,
    avatar: sanitizeProfileAvatar(rawAvatar),
    isInstitutional,
    bio: sanitizeProfileBio(matchedOrgUser?.bio) || sanitizeProfileBio(act.organizerBio) || '',
    location: String(matchedOrgUser?.localidad || act.organizerLocation || '').trim()
  };
}
