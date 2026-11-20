export interface ChatItem {
  id: number | string;
  title: string;
  subtitle: string;
  type: 'grupal' | 'privado';
  activityId?: number | null;
  organizerId?: string;
  allowedRoles?: string[];
  participants?: string[];
  participantIds?: string[];
  creatorId?: string;
  messages?: any[];
}

export interface UserSession {
  id: string;
  username?: string;
  usuario?: string;
  rol: 'visitante' | 'personal' | 'institucional' | 'moderador' | string;
  tipo?: 'visitante' | 'personal' | 'institucional' | 'moderador' | string;
  apodo: string;
}

const ADMIN_ROLE_VALUES = new Set(['moderador', 'admin', 'administrador']);

/**
 * Returns true if the given user object represents an administrator/moderator profile.
 * Checks both `tipo` and `rol` case-insensitively.
 */
export function isAdministratorUser(user: any): boolean {
  if (!user || typeof user !== 'object') return false;
  const tipo = String(user.tipo ?? '').trim().toLowerCase();
  const rol = String(user.rol ?? user.role ?? '').trim().toLowerCase();
  return ADMIN_ROLE_VALUES.has(tipo) || ADMIN_ROLE_VALUES.has(rol);
}

/**
 * Resolves a string token (userId, username, apodo, nombre, email) or contact/user object
 * against `allUsersMap` to determine whether it belongs to an administrator profile.
 */
export function isUserAdminByReference(
  candidate: any,
  allUsersMap?: Record<string, any> | null
): boolean {
  if (!candidate) return false;
  if (typeof candidate === 'object') {
    if (isAdministratorUser(candidate)) return true;
    const candidateTokens = [
      candidate.userId,
      candidate.user_id,
      candidate.supabaseId,
      candidate.id,
      candidate.usuario,
      candidate.username,
      candidate.apodo,
      candidate.nombre,
      candidate.email
    ]
      .filter(Boolean)
      .map((t: any) => String(t).trim().toLowerCase());
    if (candidateTokens.length === 0 || !allUsersMap) return false;
    for (const tok of candidateTokens) {
      if (allUsersMap[tok] && isAdministratorUser(allUsersMap[tok])) return true;
    }
    const allUsers = Object.values(allUsersMap);
    return allUsers.some((u: any) => {
      if (!isAdministratorUser(u)) return false;
      const uToks = [u.id, u.supabaseId, u.usuario, u.username, u.apodo, u.nombre, u.email]
        .filter(Boolean)
        .map((t: any) => String(t).trim().toLowerCase());
      return candidateTokens.some((ct) => uToks.includes(ct));
    });
  }

  const low = String(candidate).trim().toLowerCase();
  if (!low || !allUsersMap) return false;
  if (allUsersMap[low] && isAdministratorUser(allUsersMap[low])) return true;

  const allUsers = Object.values(allUsersMap);
  return allUsers.some((u: any) => {
    if (!isAdministratorUser(u)) return false;
    return [u.id, u.supabaseId, u.usuario, u.username, u.apodo, u.nombre, u.email]
      .filter(Boolean)
      .some((t: any) => String(t).trim().toLowerCase() === low);
  });
}

/**
 * Filter chats visible to a specific user role and ID.
 * Personal users see chats for activities they are enrolled in, organized, or direct chats where they are participants.
 * Institutional users see chats for their workshops.
 * Administrators/moderators NEVER participate in group chats; they only see their private 1-to-1 chats.
 */
export function filterChatsForUser(chats: ChatItem[], user: UserSession | null): ChatItem[] {
  const userRol = user?.rol;
  if (!user || userRol === 'visitante') return [];

  return chats.filter(chat => {
    if (isAdministratorUser(user)) {
      if (chat.type !== 'privado') return false;
      const myToks = [user.id, user.username, user.usuario, user.apodo]
        .filter(Boolean)
        .map(t => String(t).trim().toLowerCase());
      const parts = [
        ...(Array.isArray(chat.participants) ? chat.participants : []),
        ...(Array.isArray(chat.participantIds) ? chat.participantIds : [])
      ]
        .filter(Boolean)
        .map(p => String(p).trim().toLowerCase());
      return parts.some(p => myToks.includes(p)) || (chat.creatorId ? myToks.includes(String(chat.creatorId).trim().toLowerCase()) : false);
    }

    if (userRol === 'institucional') {
      return (
        chat.organizerId === 'institucional' ||
        chat.organizerId === user.id ||
        (chat.allowedRoles?.includes('institucional') ?? false)
      );
    }

    // Personal user
    if (chat.organizerId === 'personal' || chat.organizerId === user.id) return true;
    if (chat.allowedRoles?.includes('personal')) return true;
    if (chat.participants && (chat.participants.includes(user.id) || chat.participants.includes(user.apodo))) return true;

    return false;
  });
}

/**
 * Validates registration data
 */
export function validateRegistration(data: {
  username?: string;
  nombre?: string;
  clave?: string;
  email?: string;
  tipo?: string;
}): { valid: boolean; error?: string } {
  if (!data.username || data.username.trim().length < 3) {
    return { valid: false, error: 'El nombre de usuario debe tener al menos 3 caracteres.' };
  }
  if (!data.nombre || data.nombre.trim().length < 2) {
    return { valid: false, error: 'Por favor ingresá tu nombre o apodo.' };
  }
  if (!data.clave || data.clave.length < 3) {
    return { valid: false, error: 'La contraseña debe tener al menos 3 caracteres.' };
  }
  if (!data.email || !data.email.includes('@')) {
    return { valid: false, error: 'Ingresá un correo electrónico válido.' };
  }
  return { valid: true };
}

export const MOTIVOS_REPORTE_LIST = [
  'Spam',
  'Odio, abuso, o acoso',
  'Discurso violento',
  'Comportamientos ilegales',
  'Suplantación de identidad',
  'Suicidio o Autolesiones',
  'Terrorismo o extremismo',
  'Integridad cívica',
  'Contenido sexual'
];

export function isReportMotiveValid(motive: string): boolean {
  return MOTIVOS_REPORTE_LIST.includes(motive);
}

export function getBlockedMessageForProfile(
  targetUserApodo: string,
  didOtherBlockMe: boolean,
  didIBlockUser: boolean
): string | null {
  if (didOtherBlockMe) {
    return `${targetUserApodo} te ha bloqueado`;
  }
  if (didIBlockUser) {
    return `Has bloqueado a ${targetUserApodo}. Desbloquealo para ver su información.`;
  }
  return null;
}

export function getBlockedMessageForActivity(
  didOtherBlockMe: boolean,
  didIBlockUser: boolean
): string | null {
  if (didOtherBlockMe) {
    return 'El organizador te ha bloqueado';
  }
  if (didIBlockUser) {
    return 'Desbloqueá al organizador para ver ubicación';
  }
  return null;
}

export function getBlockedMessageForReviews(
  didOtherBlockMe: boolean,
  didIBlockUser: boolean
): string | null {
  if (didOtherBlockMe) {
    return 'Reseñas no disponibles (el organizador te ha bloqueado)';
  }
  if (didIBlockUser) {
    return 'Reseñas no disponibles (desbloquea al organizador para ver reseñas)';
  }
  return null;
}

/**
 * Checks if the current user has the security permission to unblock the target.
 * If the other user blocked me, I CANNOT unblock them (serious security violation).
 * Only the user who initiated the block can unblock.
 */
export function canUserUnblock(
  didOtherBlockMe: boolean,
  didIBlockUser: boolean
): boolean {
  if (didOtherBlockMe) return false;
  return Boolean(didIBlockUser);
}

/**
 * Checks if a user is allowed to remove a participant in group moderation.
 * Users cannot remove themselves from group moderation (they must use "Salir del grupo").
 */
export function canRemoveParticipantFromGroup(
  currentUsername: string,
  currentApodo: string,
  participantName: string
): boolean {
  const p = (participantName || '').trim().toLowerCase();
  const u = (currentUsername || '').trim().toLowerCase();
  const a = (currentApodo || '').trim().toLowerCase();
  if (p === u || p === a) return false;
  return true;
}

/**
 * Calculates exact canvas draw coordinates matching the CSS object-fit: contain preview.
 */
export function calculateCropCoords(
  viewW: number,
  viewH: number,
  canvasW: number,
  canvasH: number,
  imgW: number,
  imgH: number,
  posX: number,
  posY: number,
  zoom: number
) {
  const scale = canvasW / viewW;
  const imgRatio = imgW / imgH;
  const containerRatio = viewW / viewH;

  let baseW = viewW;
  let baseH = viewH;
  if (imgRatio > containerRatio) {
    baseW = viewW;
    baseH = viewW / imgRatio;
  } else {
    baseH = viewH;
    baseW = viewH * imgRatio;
  }

  const centerX = (viewW / 2 + posX) * scale;
  const centerY = (viewH / 2 + posY) * scale;
  const drawW = baseW * zoom * scale;
  const drawH = baseH * zoom * scale;

  return {
    drawX: centerX - drawW / 2,
    drawY: centerY - drawH / 2,
    drawW,
    drawH
  };
}

/**
 * Formats the exact measure taken for a security resolution.
 */
export function formatResolutionMeasure(rep: {
  resolutionAction?: string;
  status?: string;
  resolutionDecision?: string;
  sanctionType?: 'temporal_7' | 'temporal_30' | 'permanente' | string;
  alsoDeletedContent?: boolean;
  reportedUser?: string;
  resolutionDetail?: string;
}): string {
  if (rep.resolutionDecision === 'desestimado' || rep.status === 'desestimado') {
    return 'Caso desestimado al no evidenciar infracciones mayores a las normas comunitarias';
  }
  if (rep.resolutionDetail) {
    return rep.resolutionDetail;
  }
  const userStr = rep.reportedUser ? `@${rep.reportedUser}` : 'usuario';
  if (rep.resolutionAction === 'ban_user' || rep.resolutionAction === 'sancionar') {
    let sancDesc = 'Suspensión preventiva';
    if (rep.sanctionType === 'temporal_7') sancDesc = 'Suspensión temporal por 7 días';
    else if (rep.sanctionType === 'temporal_30') sancDesc = 'Suspensión temporal por 30 días';
    else if (rep.sanctionType === 'permanente') sancDesc = 'Veto permanente de la plataforma';

    const deletePart = rep.alsoDeletedContent ? ' y retiro de contenido reportado' : '';
    return `${sancDesc} a ${userStr}${deletePart}`;
  }
  if (rep.resolutionAction === 'delete_content' || rep.resolutionAction === 'eliminar') {
    return 'Retiro del contenido reportado de la plataforma';
  }
  return 'Resolución con medidas de moderación aplicadas';
}

/**
 * Returns "-" if text is empty/whitespace or already "-", never inventing text.
 */
export function cleanCommentOrDash(text?: string | null): string {
  if (!text) return '-';
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : '-';
}

/**
 * Parses Argentina date/time string "DD/MM/YYYY, HH:MM hs" into a timestamp.
 */
export function parseArgentinaDateTime(str?: string | null): number {
  if (!str) return 0;
  const match = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*(\d{1,2}):(\d{1,2}))?/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const hour = match[4] ? Number(match[4]) : 0;
    const minute = match[5] ? Number(match[5]) : 0;
    return new Date(Date.UTC(year, month, day, hour + 3, minute)).getTime();
  }
  const t = Date.parse(str);
  return isNaN(t) ? 0 : t;
}

/**
 * Calculates effective sorting time for proposal activities.
 * If the organizer submitted feedback, the activity jumps to the top based on changesSubmittedAt.
 * Any newer proposed activities sort above it chronologically.
 */
export function getProposalSortingTime(act: {
  id: number;
  proposedAt?: string;
  changesSubmittedAt?: string;
  proposedTimestamp?: number;
  changesSubmittedTimestamp?: number;
}): number {
  const tSubmitted = act.changesSubmittedTimestamp || parseArgentinaDateTime(act.changesSubmittedAt);
  const tProposed = act.proposedTimestamp || parseArgentinaDateTime(act.proposedAt) || (act.id > 1000000 ? act.id : 0);
  return Math.max(tSubmitted, tProposed);
}

/**
 * Group participant role: either "Moderador" or "Participante".
 * The label "Moderador" replaces "Participante".
 */
export function getParticipantRoleLabel(isModerator: boolean, isSelf: boolean = false): string {
  if (isModerator) {
    return isSelf ? 'Moderador (Tú)' : 'Moderador';
  }
  return isSelf ? 'Participante (Tú)' : 'Participante';
}

/**
 * Standardizes any date string (YYYY-MM-DD or DD/MM/YYYY) into ISO YYYY-MM-DD format.
 */
export function parseDateToYMD(rawDate?: string | null): string | null {
  if (!rawDate) return null;
  const str = String(rawDate).trim();
  const ymdMatch = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }
  const dmyMatch = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }
  return null;
}

/**
 * Extracts all valid dates (in YYYY-MM-DD format) from a block of text or schedule string.
 */
export function extractDatesFromText(text?: string | null): string[] {
  if (!text) return [];
  const str = String(text);
  const dates: string[] = [];
  const dmyMatches = Array.from(str.matchAll(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/g));
  for (const m of dmyMatches) {
    dates.push(`${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  const ymdMatches = Array.from(str.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g));
  for (const m of ymdMatches) {
    dates.push(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
  }
  return dates;
}

/**
 * Extracts start and end times (HH:mm) from a schedule or description text.
 */
export function extractTimesFromSchedule(schedule?: string | null): { startTime?: string; endTime?: string } {
  if (!schedule) return {};
  const str = String(schedule);
  const timeMatches = Array.from(str.matchAll(/(\d{1,2}):(\d{2})/g));
  if (timeMatches.length >= 2) {
    return {
      startTime: `${timeMatches[0][1].padStart(2, '0')}:${timeMatches[0][2]}`,
      endTime: `${timeMatches[timeMatches.length - 1][1].padStart(2, '0')}:${timeMatches[timeMatches.length - 1][2]}`
    };
  } else if (timeMatches.length === 1) {
    const t = `${timeMatches[0][1].padStart(2, '0')}:${timeMatches[0][2]}`;
    return { startTime: t, endTime: t };
  }
  return {};
}

function shiftYmdDays(ymd: string, days: number): string {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().split('T')[0];
}

/**
 * Checks whether an activity has completed and should no longer be displayed in Cartelera.
 * For one-time activities, compares their end date and end time against current Argentina time (UTC-3).
 * For recurring activities, checks if their explicit final date has passed.
 */
export function isActivityPast(act: any, referenceDate?: Date): boolean {
  if (!act) return false;
  const isRecurrent = Boolean(act.isRecurrent || act.is_recurrent || act.es_recurrente || act.frecuencia === 'recurrente');
  const refTime = referenceDate ? referenceDate.getTime() : Date.now();

  const normalizeHora = (raw?: string | null): string => {
    const match = String(raw || '').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return '23:59:59';
    return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
  };

  if (isRecurrent) {
    const sched = String(act.schedule || act.horario || '');
    const desc = String(act.descripcion || act.description || '');
    const startDateStr = parseDateToYMD(act.firstEncounterDate || act.first_encounter_date || act.startDate || act.start_date || act.fechaPrimerEncuentro || act.fechaIni);
    const explicitEndDate = parseDateToYMD(act.endDate || act.end_date || act.fechaFin || act.fecha_fin);
    const hasExplicitEncounterCount = Boolean(
      (Number(act.cantidadEventos || act.cantidad_eventos || act.totalEncuentros || 0) > 0) ||
      /(\d+)\s*encuentros/i.test(`${sched} ${desc}`)
    );

    if (!hasExplicitEncounterCount && explicitEndDate && (!startDateStr || explicitEndDate > startDateStr)) {
      const times = extractTimesFromSchedule(`${sched} ${desc}`);
      const normHora = normalizeHora(act.endTime || act.end_time || act.horaFin || act.hora_fin || times.endTime || '23:59:59');
      const endLimit = new Date(`${explicitEndDate}T${normHora}-03:00`).getTime();
      if (!isNaN(endLimit)) {
        return refTime >= endLimit;
      }
    }

    try {
      const sessions = getActivitySessions(act);
      if (sessions.length > 0) {
        const lastSession = sessions[sessions.length - 1];
        const extraDays = Math.floor(lastSession.endMinutes / 1440);
        const normEndMin = lastSession.endMinutes % 1440;
        const effectiveEndDate = extraDays > 0 ? shiftYmdDays(lastSession.date, extraDays) : lastSession.date;
        const endHour = Math.floor(normEndMin / 60);
        const endMinute = normEndMin % 60;
        const horaStr = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:00`;
        const lastSessionEnd = new Date(`${effectiveEndDate}T${horaStr}-03:00`).getTime();
        if (!isNaN(lastSessionEnd)) {
          return refTime >= lastSessionEnd;
        }
      }
    } catch (_) {}

    if (explicitEndDate && (!startDateStr || explicitEndDate > startDateStr)) {
      const times = extractTimesFromSchedule(`${sched} ${desc}`);
      const normHora = normalizeHora(act.endTime || act.end_time || act.horaFin || act.hora_fin || times.endTime || '23:59:59');
      const endLimit = new Date(`${explicitEndDate}T${normHora}-03:00`).getTime();
      if (!isNaN(endLimit) && refTime >= endLimit) return true;
    }

    return false;
  }

  try {
    const sched = String(act.schedule || act.horario || '');
    const desc = String(act.descripcion || act.description || '');
    const allText = `${sched} ${desc}`;
    const schedDates = extractDatesFromText(sched);
    const extractedDates = schedDates.length > 0 ? schedDates : extractDatesFromText(allText);

    const startYmd = parseDateToYMD(act.startDate || act.start_date || act.fechaIni || act.fecha_inicio || act.fechaRealizacion || act.fecha_realizacion || act.date || act.fecha) || extractedDates[0] || null;
    const explicitEndYmd = parseDateToYMD(act.endDate || act.end_date || act.fechaFin || act.fecha_fin);

    let endYmd: string | null = null;
    if (explicitEndYmd) {
      endYmd = explicitEndYmd;
    } else if (extractedDates.length > 0) {
      endYmd = [...extractedDates].sort().pop() || null;
    } else if (startYmd) {
      endYmd = startYmd;
    }

    if (!endYmd) return false;

    const times = extractTimesFromSchedule(sched || allText);
    const rawStartHora = act.startTime || act.start_time || act.horaIni || act.hora_inicio || times.startTime;
    const rawEndHora = act.endTime || act.end_time || act.horaFin || act.hora_fin || times.endTime;
    const rawHora = rawEndHora || rawStartHora || '23:59';
    const horaStr = normalizeHora(rawHora);

    if ((!explicitEndYmd || (startYmd && endYmd === startYmd)) && rawStartHora && rawEndHora) {
      const startHoraStr = normalizeHora(rawStartHora);
      if (horaStr <= startHoraStr) {
        endYmd = shiftYmdDays(endYmd, 1);
      }
    }

    const limit = new Date(`${endYmd}T${horaStr}-03:00`).getTime();
    if (!isNaN(limit)) {
      return refTime >= limit;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Checks whether the first encounter of an activity has started.
 * Normalizes dates (YYYY-MM-DD or DD/MM/YYYY) and extracts encounter start time.
 */
export function hasFirstEncounterStarted(act: any, referenceDate?: Date): boolean {
  if (!act) return false;
  const rawDate = act.firstEncounterDate || act.first_encounter_date || act.firstMeetingDate || act.fechaPrimerEncuentro;
  const desc = String(act.descripcion || act.description || '');
  const sched = String(act.schedule || act.horario || '');
  const matchDescDate = desc.match(/Primer encuentro:\s*([^\n]+)/i);
  const dateStr = parseDateToYMD(rawDate || (matchDescDate ? matchDescDate[1] : null)) || extractDatesFromText(`${sched} ${desc}`)[0];
  if (!dateStr) return false;

  const times = extractTimesFromSchedule(`${sched} ${desc}`);
  const time = act.firstEncounterStartTime || act.first_encounter_start_time || act.horaIni || act.hora_inicio || times.startTime || '00:00';
  const normTime = time.length === 5 ? `${time}:00` : time;
  const start = new Date(`${dateStr}T${normTime}-03:00`).getTime();
  if (isNaN(start)) return false;
  const refTime = referenceDate ? referenceDate.getTime() : Date.now();
  return refTime >= start;
}

/**
 * Checks whether the first encounter of an activity has ended.
 * Reviews and closed inscriptions rely on this check.
 */
export function hasFirstEncounterEnded(act: any, referenceDate?: Date): boolean {
  if (!act) return false;
  const isRecurrent = Boolean(act.isRecurrent || act.is_recurrent || act.es_recurrente || act.frecuencia === 'recurrente');
  if (!isRecurrent) {
    return isActivityPast(act, referenceDate);
  }

  const rawDate = act.firstEncounterDate || act.first_encounter_date || act.firstMeetingDate || act.fechaPrimerEncuentro;
  const desc = String(act.descripcion || act.description || '');
  const sched = String(act.schedule || act.horario || '');
  const matchDescDate = desc.match(/Primer encuentro:\s*([^\n]+)/i);
  const dateStr = parseDateToYMD(rawDate || (matchDescDate ? matchDescDate[1] : null)) || extractDatesFromText(`${sched} ${desc}`)[0];
  if (!dateStr) return false;

  const times = extractTimesFromSchedule(`${sched} ${desc}`);
  const startTimeRaw = act.firstEncounterStartTime || act.first_encounter_start_time || act.startTime || act.start_time || act.horaIni || act.hora_inicio || times.startTime;
  const time = act.firstEncounterEndTime || act.first_encounter_end_time || act.endTime || act.end_time || act.horaFin || act.hora_fin || times.endTime || '23:59';
  const normTime = time.length === 5 ? `${time}:00` : time;
  let effectiveEndDateStr = dateStr;
  if (startTimeRaw) {
    const normStart = startTimeRaw.length === 5 ? `${startTimeRaw}:00` : startTimeRaw;
    if (normTime <= normStart) {
      effectiveEndDateStr = shiftYmdDays(dateStr, 1);
    }
  }
  const end = new Date(`${effectiveEndDateStr}T${normTime}-03:00`).getTime();
  if (isNaN(end)) return false;
  const refTime = referenceDate ? referenceDate.getTime() : Date.now();
  return refTime >= end;
}

/**
 * Checks whether an activity has already taken place (se realizó) and is eligible for participant reviews.
 * - One-time activity: must have completed its session (isActivityPast).
 * - Recurring activity: must have completed at least its first encounter (hasFirstEncounterEnded) or be fully finished (isActivityPast).
 */
export function isActivityEligibleForReview(act: any, referenceDate?: Date): boolean {
  if (!act) return false;
  const isRecurrent = Boolean(act.isRecurrent || act.is_recurrent || act.es_recurrente || act.frecuencia === 'recurrente');
  if (isRecurrent) {
    return hasFirstEncounterEnded(act, referenceDate) || isActivityPast(act, referenceDate);
  }
  return isActivityPast(act, referenceDate);
}

/**
 * Resolves the status badge label for an activity in the "Actividades realizadas (reseñas)" section.
 * For recurring activities that still have upcoming encounters, returns 'ACTIVIDAD EN CURSO'.
 * Once the final encounter of the series completes (or for completed one-time activities), returns 'ACTIVIDAD FINALIZADA'.
 */
export function getActivityRealizadaStatusLabel(act: any, referenceDate?: Date): 'ACTIVIDAD EN CURSO' | 'ACTIVIDAD FINALIZADA' {
  if (!act) return 'ACTIVIDAD FINALIZADA';
  const isRecurrent = Boolean(
    act.isRecurrent ||
    act.is_recurrent ||
    act.es_recurrente ||
    act.frequency === 'recurrente' ||
    act.frecuencia === 'recurrente'
  );
  if (isRecurrent && !isActivityPast(act, referenceDate)) {
    return 'ACTIVIDAD EN CURSO';
  }
  return 'ACTIVIDAD FINALIZADA';
}

/**
 * Calculates sorting timestamp for cards in "Mis Actividades".
 * When an activity is cancelled/suspended by admin (baja_forzada), or changes requested,
 * or accepted/rejected, or newly created, it moves to the FIRST position.
 * If a new activity/proposal is added, that newest card becomes first, and the previous one second.
 */
export function getMyActivitiesSortingTime(act: {
  id: number;
  proposedAt?: string;
  changesSubmittedAt?: string;
  changesRequestedAt?: string;
  bajaDate?: string;
  cancelDate?: string;
  approvedAt?: string;
  rejectedAt?: string;
  proposedTimestamp?: number;
  changesSubmittedTimestamp?: number;
  changesRequestedTimestamp?: number;
  bajaTimestamp?: number;
  approvedTimestamp?: number;
  rejectedTimestamp?: number;
}): number {
  const tBaja = act.bajaTimestamp || (act.bajaDate ? parseArgentinaDateTime(act.bajaDate) : 0);
  const tChangesReq = act.changesRequestedTimestamp || (act.changesRequestedAt ? parseArgentinaDateTime(act.changesRequestedAt) : 0);
  const tChangesSub = act.changesSubmittedTimestamp || (act.changesSubmittedAt ? parseArgentinaDateTime(act.changesSubmittedAt) : 0);
  const tApproved = act.approvedTimestamp || (act.approvedAt ? parseArgentinaDateTime(act.approvedAt) : 0);
  const tRejected = act.rejectedTimestamp || (act.rejectedAt ? parseArgentinaDateTime(act.rejectedAt) : 0);
  const tProposed = act.proposedTimestamp || (act.proposedAt ? parseArgentinaDateTime(act.proposedAt) : (act.id > 1000000 ? act.id : 0));
  const tCancel = act.cancelDate ? parseArgentinaDateTime(act.cancelDate) : 0;
  return Math.max(tBaja, tChangesReq, tChangesSub, tApproved, tRejected, tProposed, tCancel);
}

export function buildChatUserTokens(user?: any): string[] {
  if (!user) return [];
  const uAny = user as any;
  const raw = [
    user.id,
    user.usuario,
    user.apodo,
    user.nombre,
    uAny.username,
    uAny.name,
    uAny.institucion,
    uAny.nombreInstitucion,
    uAny.nombreCompleto,
    uAny.supabaseId,
    user.email
  ];
  return Array.from(
    new Set(
      raw
        .filter(Boolean)
        .map((t: any) => String(t).trim().toLowerCase())
        .filter((s: string) => s !== '' && s !== 'undefined' && s !== 'null' && s !== 'local' && s !== 'anon' && !isDummyOrSystemParticipant(s))
    )
  );
}

function getStrictUserIds(user?: any): string[] {
  if (!user) return [];
  const uAny = user as any;
  return Array.from(
    new Set(
      [user.id, uAny.supabaseId]
        .filter(Boolean)
        .map((t: any) => String(t).trim().toLowerCase())
        .filter((s: string) => s !== '' && s !== 'undefined' && s !== 'null')
    )
  );
}

function getMessageTimestampMs(m: any): number {
  if (!m) return 0;
  if (typeof m.timestamp === 'number' && !isNaN(m.timestamp) && m.timestamp > 0) {
    return m.timestamp;
  }
  if (m.createdAt) {
    const t = new Date(m.createdAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (m.created_at) {
    const t = new Date(m.created_at).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (typeof m.id === 'string' && m.id.startsWith('msg_')) {
    const parts = m.id.split('_');
    const num = parseInt(parts[1], 10);
    if (!isNaN(num) && num > 1600000000000) return num;
  }
  return 0;
}

function toTimestampMs(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  const t = new Date(val).getTime();
  return isNaN(t) ? (Number(val) || 0) : t;
}

function findMatchingRemovedNotice(
  chatId?: number | string | null,
  activityId?: number | string | null,
  user?: { notifications?: any[] } | null
): any | null {
  if (!user || !Array.isArray(user.notifications) || user.notifications.length === 0) {
    return null;
  }
  const sChatId = chatId ? String(chatId).trim() : '';
  const sBig = sChatId ? String(chatIdentifierToBigInt(sChatId)) : '';
  const sActId = activityId ? String(activityId).trim() : '';

  let best: any = null;
  let bestTs = -1;
  for (const n of user.notifications) {
    if (!n || n.type !== 'chat_removed_notice') continue;
    const nChatId = n.chatId ? String(n.chatId).trim() : '';
    const nBig = nChatId ? String(chatIdentifierToBigInt(nChatId)) : '';
    const nActId = n.activityId ? String(n.activityId).trim() : '';

    const matches =
      (sChatId && (nChatId === sChatId || (sBig && (nChatId === sBig || nBig === sBig)))) ||
      (sActId && (nActId === sActId || nChatId === sActId));

    if (!matches) continue;
    const ts = toTimestampMs(n.removedAt || n.leftAt || n.createdAt);
    if (!best || ts >= bestTs) {
      best = n;
      bestTs = ts;
    }
  }
  return best;
}

function analyzeUserChatMembershipTimeline(messages: any[], userTokens: string[], strictUserIds: string[] = []): {
  latestState: 'none' | 'left' | 'removed' | 'vetoed' | 'added';
  latestExitMs: number;
  latestAddedMs: number;
  latestSnapshot: string[] | null;
} {
  if (!Array.isArray(messages) || messages.length === 0 || userTokens.length === 0) {
    return { latestState: 'none', latestExitMs: 0, latestAddedMs: 0, latestSnapshot: null };
  }

  const sorted = [...messages].sort((a, b) => getMessageTimestampMs(a) - getMessageTimestampMs(b));
  let latestState: 'none' | 'left' | 'removed' | 'vetoed' | 'added' = 'none';
  let latestExitMs = 0;
  let latestAddedMs = 0;
  let latestSnapshot: string[] | null = null;

  for (const m of sorted) {
    if (!m) continue;
    if (m.role === 'sistema' || m.senderId === 'sistema') {
      const rt = m.replyTo || m.reply_to;
      const rtObj = typeof rt === 'string' ? (() => { try { return JSON.parse(rt); } catch { return {}; } })() : (rt || {});
      const pName = String(rtObj?.participant || '').trim().toLowerCase();
      const pId = String(rtObj?.participantId || rtObj?.userId || '').trim().toLowerCase();
      if (pId && strictUserIds.length > 0 && !strictUserIds.includes(pId)) {
        continue;
      }
      const tokens = Array.isArray(rtObj?.participantTokens) ? rtObj.participantTokens.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : [];
      const text = String(m.text || '').trim();

      let extractedSubject = '';
      const matchRem = text.match(/^(.+?)\s+fue retirad[oa] del grupo/i);
      const matchLeft = text.match(/^(.+?)\s+(?:salió|abandonó)\s+del grupo/i);
      const matchAdd = text.match(/^(.+?)\s+fue agregad[oa] al grupo/i) ||
        text.match(/^¡Bienvenido a\s+[^,]+,\s*(.+?)[!.]?$/i) ||
        text.match(/^¡?(.+?)\s+se unió a la actividad/i);

      if (matchRem) extractedSubject = matchRem[1].trim().toLowerCase();
      else if (matchLeft) extractedSubject = matchLeft[1].trim().toLowerCase();
      else if (matchAdd) extractedSubject = matchAdd[1].trim().toLowerCase();

      const isTarget =
        (pName && userTokens.includes(pName)) ||
        (pId && userTokens.includes(pId)) ||
        tokens.some((t: string) => userTokens.includes(t)) ||
        (extractedSubject && userTokens.includes(extractedSubject));

      if (!isTarget) continue;

      const msgTs = getMessageTimestampMs(m);
      const isVetoReason = rtObj?.reason === 'vetoed' || /porque fue vetad[oa] de la actividad/i.test(text);
      if (rtObj?.event === 'user_left' || matchLeft) {
        latestState = 'left';
        latestExitMs = Math.max(latestExitMs, msgTs);
        if (Array.isArray(rtObj?.participantsSnapshot) && rtObj.participantsSnapshot.length > 0) {
          latestSnapshot = rtObj.participantsSnapshot;
        }
      } else if ((rtObj?.event === 'participant_removed' || matchRem) && isVetoReason) {
        latestState = 'vetoed';
        latestExitMs = Math.max(latestExitMs, msgTs);
        if (Array.isArray(rtObj?.participantsSnapshot) && rtObj.participantsSnapshot.length > 0) {
          latestSnapshot = rtObj.participantsSnapshot;
        }
      } else if (rtObj?.event === 'participant_removed' || matchRem) {
        latestState = 'removed';
        latestExitMs = Math.max(latestExitMs, msgTs);
        if (Array.isArray(rtObj?.participantsSnapshot) && rtObj.participantsSnapshot.length > 0) {
          latestSnapshot = rtObj.participantsSnapshot;
        }
      } else if (rtObj?.event === 'participant_added' || matchAdd) {
        latestState = 'added';
        latestAddedMs = Math.max(latestAddedMs, msgTs);
        latestSnapshot = null;
      }
    }
  }

  return { latestState, latestExitMs, latestAddedMs, latestSnapshot };
}

/**
 * Returns the departure/removal cutoff timestamp (epoch ms) if the user is currently
 * out of the group chat (left voluntarily, removed by moderator, or vetoed).
 * Returns 0 if the user is still an active participant (or was re-added after leaving).
 */
export function getUserChatDepartureTimestamp(
  chatOrId?: any,
  user?: { usuario?: string; apodo?: string; id?: string; nombre?: string; notifications?: any[] } | null,
  messagesArg?: any[]
): number {
  if (!chatOrId || !user) return 0;

  const isObj = typeof chatOrId === 'object' && chatOrId !== null;
  if (isObj && chatOrId.type === 'privado') return 0;

  const chatId = isObj ? chatOrId.id : chatOrId;
  const activityId = isObj ? (chatOrId.activityId || chatOrId.actividad_id) : undefined;
  const messages = Array.isArray(messagesArg) ? messagesArg : (isObj && Array.isArray(chatOrId.messages) ? chatOrId.messages : []);

  const userTokens = buildChatUserTokens(user);
  if (userTokens.length === 0) return 0;
  const strictUserIds = getStrictUserIds(user);

  const timeline = analyzeUserChatMembershipTimeline(messages, userTokens, strictUserIds);
  const notice = findMatchingRemovedNotice(chatId, activityId, user);
  const noticeTs = notice ? toTimestampMs(notice.removedAt || notice.leftAt || notice.createdAt) : 0;
  const propTs = isObj ? toTimestampMs(chatOrId.removedAtForUser || chatOrId.leftAtForUser || chatOrId.removedAt || chatOrId.leftAt) : 0;
  const msgTs = (timeline.latestState === 'left' || timeline.latestState === 'removed' || timeline.latestState === 'vetoed')
    ? timeline.latestExitMs
    : 0;

  if (timeline.latestState === 'added' && timeline.latestAddedMs >= Math.max(noticeTs, propTs)) {
    return 0;
  }
  if (timeline.latestAddedMs > 0 && timeline.latestAddedMs >= Math.max(noticeTs, propTs, msgTs)) {
    return 0;
  }

  return Math.max(msgTs, noticeTs, propTs);
}

function getSnapshotParticipantsForUser(chat: any, user: any): string[] {
  if (!chat || !user) return [];
  const userTokens = buildChatUserTokens(user);
  if (userTokens.length === 0) return [];
  const strictUserIds = getStrictUserIds(user);

  const snapshotMap = chat.participantsSnapshotOnRemoval || chat.participants_snapshot_on_removal;
  if (snapshotMap && typeof snapshotMap === 'object') {
    for (const token of userTokens) {
      if (Array.isArray(snapshotMap[token]) && snapshotMap[token].length > 0) {
        return snapshotMap[token];
      }
    }
  }

  const notice = findMatchingRemovedNotice(chat.id, chat.activityId || chat.actividad_id, user);
  if (notice && Array.isArray(notice.participantsSnapshot) && notice.participantsSnapshot.length > 0) {
    return notice.participantsSnapshot;
  }

  if (Array.isArray(chat.messages) && chat.messages.length > 0) {
    const timeline = analyzeUserChatMembershipTimeline(chat.messages, userTokens, strictUserIds);
    if (timeline.latestState !== 'added' && Array.isArray(timeline.latestSnapshot) && timeline.latestSnapshot.length > 0) {
      return timeline.latestSnapshot;
    }

    const sorted = [...chat.messages].sort((a, b) => getMessageTimestampMs(b) - getMessageTimestampMs(a));
    for (const m of sorted) {
      let rt = m?.replyTo || m?.reply_to;
      if (typeof rt === 'string') {
        try { rt = JSON.parse(rt); } catch { rt = null; }
      }
      if (rt && typeof rt === 'object' && Array.isArray(rt.participantsSnapshot) && rt.participantsSnapshot.length > 0) {
        const pTokens = Array.isArray(rt.participantTokens) ? rt.participantTokens.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : [];
        const pName = String(rt.participant || '').trim().toLowerCase();
        const pId = String(rt.participantId || rt.userId || '').trim().toLowerCase();
        if (pId && strictUserIds.length > 0 && !strictUserIds.includes(pId)) {
          continue;
        }
        if ((pName && userTokens.includes(pName)) || (pId && userTokens.includes(pId)) || pTokens.some((t: string) => userTokens.includes(t))) {
          return rt.participantsSnapshot;
        }
      }
    }
  }

  return [];
}

function doesParticipantTokenListTargetUser(
  list: any[],
  userTokens: string[],
  strictUserIds: string[]
): boolean {
  const cleaned = list
    .filter(Boolean)
    .map((p: any) => String(p).trim().toLowerCase())
    .filter(Boolean);
  if (cleaned.length === 0) return false;

  const isExplicitAccountId = (s: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
    /^usr_/i.test(s) ||
    /^user_/i.test(s);

  const explicitIds = cleaned.filter(isExplicitAccountId);
  if (explicitIds.length > 0 && strictUserIds.length > 0) {
    return strictUserIds.some(id => explicitIds.includes(id));
  }

  return cleaned.some(p => userTokens.includes(p));
}

/**
 * Checks whether the user left the chat group voluntarily.
 */
export function isUserLeftVoluntarilyFromChat(
  chat?: { id?: number | string; activityId?: number | string | null; type?: string; leftVoluntarilyParticipants?: string[]; left_voluntarily_participants?: string[]; leftVoluntarily?: boolean; messages?: any[] } | null,
  user?: { usuario?: string; apodo?: string; id?: string; nombre?: string; notifications?: any[] } | null
): boolean {
  if (!chat || chat.type !== 'grupal' || !user) return false;

  const userTokens = buildChatUserTokens(user);
  if (userTokens.length === 0) return false;
  const strictUserIds = getStrictUserIds(user);

  // Check messages history chronologically if available
  const timeline = analyzeUserChatMembershipTimeline(Array.isArray(chat.messages) ? chat.messages : [], userTokens, strictUserIds);
  const notice = findMatchingRemovedNotice(chat.id, chat.activityId, user);
  const noticeTs = notice ? toTimestampMs(notice.removedAt || notice.leftAt || notice.createdAt) : 0;
  const propTs = toTimestampMs((chat as any).leftAtForUser || (chat as any).removedAtForUser);

  if (timeline.latestState === 'added' && timeline.latestAddedMs >= Math.max(noticeTs, propTs)) return false;
  if (timeline.latestState === 'left' && timeline.latestExitMs >= noticeTs) return true;
  if ((timeline.latestState === 'removed' || timeline.latestState === 'vetoed') && timeline.latestExitMs >= noticeTs) return false;

  if (notice && notice.reason === 'left' && (timeline.latestAddedMs === 0 || noticeTs > timeline.latestAddedMs)) {
    return true;
  }

  const leftList = [
    ...(chat?.leftVoluntarilyParticipants || []),
    ...((chat as any)?.left_voluntarily_participants || [])
  ];

  if (doesParticipantTokenListTargetUser(leftList, userTokens, strictUserIds)) {
    return true;
  }

  if (leftList.length === 0 && (chat as any).leftVoluntarily === true) {
    return true;
  }

  // Comprobar persistencia en localStorage SOLO por identificadores únicos de esta cuenta (NUNCA 'local' ni apodos compartibles)
  try {
    if (typeof localStorage !== 'undefined') {
      const uTokens = Array.from(new Set([user.id, user.usuario].filter(Boolean).map(t => String(t).trim())));
      for (const tok of uTokens) {
        const storedJson = localStorage.getItem(`left_chats_${tok}`);
        if (storedJson) {
          const ids: string[] = JSON.parse(storedJson);
          const cId = String(chat.id || '');
          const aId = chat.activityId ? String(chat.activityId) : '';
          if ((cId && ids.includes(cId)) || (aId && ids.includes(aId))) {
            return true;
          }
        }
      }
    }
  } catch {}

  return false;
}

/**
 * Checks whether the current user was removed from a group chat by a moderator or left voluntarily.
 */
export function isUserRemovedFromChat(
  chat?: { id?: number | string; activityId?: number | string | null; type?: string; removedParticipants?: string[]; removed_participants?: string[]; leftVoluntarilyParticipants?: string[]; left_voluntarily_participants?: string[]; removedByUser?: boolean; leftVoluntarily?: boolean; messages?: any[] } | null,
  user?: { usuario?: string; apodo?: string; id?: string; nombre?: string; notifications?: any[] } | null
): boolean {
  if (!chat || chat.type !== 'grupal' || !user) return false;

  const userTokens = buildChatUserTokens(user);
  if (userTokens.length === 0) return false;
  const strictUserIds = getStrictUserIds(user);

  // Check messages history chronologically if available to see what the latest state transition was:
  const timeline = analyzeUserChatMembershipTimeline(Array.isArray(chat.messages) ? chat.messages : [], userTokens, strictUserIds);
  const notice = findMatchingRemovedNotice(chat.id, chat.activityId, user);
  const noticeTs = notice ? toTimestampMs(notice.removedAt || notice.leftAt || notice.createdAt) : 0;
  const propTs = toTimestampMs((chat as any).removedAtForUser || (chat as any).leftAtForUser);

  if (timeline.latestState === 'added' && timeline.latestAddedMs >= Math.max(noticeTs, propTs)) return false;
  if (timeline.latestState === 'removed' || timeline.latestState === 'left' || timeline.latestState === 'vetoed') return true;

  if (notice && (timeline.latestAddedMs === 0 || noticeTs > timeline.latestAddedMs)) {
    return true;
  }

  if (isUserLeftVoluntarilyFromChat(chat, user)) {
    return true;
  }

  const remList = [
    ...(chat?.removedParticipants || []),
    ...((chat as any)?.removed_participants || [])
  ];
  if (doesParticipantTokenListTargetUser(remList, userTokens, strictUserIds)) {
    return true;
  }

  if (remList.length === 0 && ((chat as any).removedByUser === true || (chat as any).leftVoluntarily === true || (chat as any).vetoedByUser === true)) {
    return true;
  }

  return false;
}

/**
 * Identifies non-human system bots or hardcoded placeholder strings
 * that must never be presented as community participants.
 */
export function isDummyOrSystemParticipant(participantName?: string | null): boolean {
  if (!participantName) return true;
  const p = String(participantName).trim().toLowerCase();
  if (!p) return true;
  if (
    p === 'sistema club65' ||
    p === 'sistema' ||
    p === 'system' ||
    p === 'sistema club 65' ||
    p === 'bot'
  ) {
    return true;
  }
  if (
    p === 'organizador' ||
    p === 'organizador/a' ||
    p === 'organizador/a del grupo' ||
    p === 'organizadores'
  ) {
    return true;
  }
  return false;
}

/**
 * Filters out hardcoded, system bots, or blank participant entries.
 */
export function filterRealParticipants<T = string>(list?: T[]): T[] {
  if (!Array.isArray(list)) return [];
  return list.filter(item => {
    if (!item) return false;
    const name = typeof item === 'string' ? item : (item as any)?.nombre || (item as any)?.usuario || (item as any)?.apodo || (item as any)?.id;
    return Boolean(name) && !isDummyOrSystemParticipant(name) && !isTechnicalIdentifier(name);
  });
}

/**
 * Returns the list of participants visible to a user.
 * For active participants, the list updates in real time with any subsequent removals.
 * For a removed or departed user, it returns the snapshot of participants who were in the group
 * at the moment they stopped being a participant.
 * Never includes system bots or hardcoded placeholders.
 */
export function getVisibleParticipantsForUser(
  chat?: {
    id?: number | string;
    activityId?: number | string | null;
    participants?: string[];
    removedParticipants?: string[];
    removed_participants?: string[];
    vetoedParticipants?: string[];
    vetoed_participants?: string[];
    leftVoluntarilyParticipants?: string[];
    left_voluntarily_participants?: string[];
    participantsSnapshotOnRemoval?: Record<string, string[]>;
    participants_snapshot_on_removal?: Record<string, string[]>;
    messages?: any[];
    type?: string;
  } | null,
  user?: { usuario?: string; apodo?: string; id?: string; nombre?: string; notifications?: any[] } | null
): string[] {
  if (!chat) return [];

  const rawList = (() => {
    if (!user || chat.type !== 'grupal') return chat.participants || [];

    const isRemoved = Boolean(
      isUserRemovedFromChat(chat as any, user) ||
      isUserLeftVoluntarilyFromChat(chat as any, user) ||
      isUserVetoedFromChat(chat as any, user)
    );

    if (isRemoved) {
      const snapshot = getSnapshotParticipantsForUser(chat, user);
      if (snapshot.length > 0) {
        return snapshot;
      }
    }

    return chat.participants || [];
  })();

  return filterRealParticipants(rawList);
}

/**
/**
 * Gets the timestamp when a chat was cleared/deleted by a specific user.
 * Returns 0 if never cleared.
 */
export function getUserChatClearedTimestamp(
  chatId?: number | string | null,
  user?: { id?: string; usuario?: string; apodo?: string; notifications?: any[] } | null
): number {
  if (!chatId || !user) return 0;
  const sChatId = String(chatId);
  const sBig = String(chatIdentifierToBigInt(sChatId));

  const toTime = (val: any): number => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const t = new Date(val).getTime();
    return isNaN(t) ? (Number(val) || 0) : t;
  };

  let maxCleared = 0;

  // 1. Desde user.notifications de Supabase
  if (Array.isArray(user.notifications)) {
    for (const n of user.notifications) {
      if (n && n.type === 'chat_cleared' && (String(n.chatId) === sChatId || String(n.chatId) === sBig)) {
        maxCleared = Math.max(maxCleared, toTime(n.clearedAt));
      }
    }
  }

  // 2. Desde localStorage específico del usuario (NUNCA global)
  if (typeof localStorage !== 'undefined') {
    const uTokens = [user.id, user.usuario, user.apodo].filter(Boolean) as string[];
    for (const tok of uTokens) {
      try {
        const raw = localStorage.getItem(`club65_chat_cleared_${tok}`);
        if (raw) {
          const map = JSON.parse(raw);
          if (map[sChatId]) maxCleared = Math.max(maxCleared, toTime(map[sChatId]));
          if (map[sBig]) maxCleared = Math.max(maxCleared, toTime(map[sBig]));
        }
      } catch {}
    }
  }

  return maxCleared;
}

/**
 * Checks if a chat was deleted by the user for their account only.
 * If new messages arrived after the user cleared the chat, the chat is NO LONGER considered deleted.
 */
export function isChatDeletedForUser(
  chat?: {
    id?: number | string;
    activityId?: number | string | null;
    deletedForUserIds?: string[];
    deleted_for_user_ids?: string[];
    messages?: any[];
    lastMessageTime?: string | number;
    updatedAt?: string | number;
    updated_at?: string | number;
  } | null,
  user?: { usuario?: string; apodo?: string; id?: string; notifications?: any[] } | null
): boolean {
  if (!chat || !user) return false;
  const userTokens: string[] = [];
  if (user.usuario) userTokens.push(user.usuario.trim().toLowerCase());
  if (user.apodo) userTokens.push(user.apodo.trim().toLowerCase());
  if (user.id) userTokens.push(user.id.trim().toLowerCase());

  const delList = [
    ...(chat.deletedForUserIds || []),
    ...((chat as any).deleted_for_user_ids || [])
  ];

  const inExplicitDelList = delList.some(u => u && userTokens.includes(String(u).trim().toLowerCase()));

  const cId = String(chat.id || '');
  const aId = chat.activityId ? String(chat.activityId) : '';
  const clearedAtCid = getUserChatClearedTimestamp(cId, user);
  const clearedAtAid = aId ? getUserChatClearedTimestamp(aId, user) : 0;
  const clearedAt = Math.max(clearedAtCid, clearedAtAid);

  // Comprobar persistencia legacy en localStorage por usuario (NUNCA 'local' para evitar contaminar otras cuentas)
  let inLegacyDeleted = false;
  try {
    if (typeof localStorage !== 'undefined') {
      const uTokens = [user.id, user.usuario, user.apodo].filter(Boolean) as string[];
      for (const tok of uTokens) {
        const storedJson = localStorage.getItem(`deleted_chats_${tok}`);
        if (storedJson) {
          const ids: string[] = JSON.parse(storedJson);
          if ((cId && ids.includes(cId)) || (aId && ids.includes(aId))) {
            inLegacyDeleted = true;
            break;
          }
        }
      }
    }
  } catch {}

  const wasCleared = clearedAt > 0 || inExplicitDelList || inLegacyDeleted;
  if (!wasCleared) return false;

  // Si el usuario fue eliminado, vetado o salió del grupo y luego borró el chat,
  // los mensajes posteriores de otros miembros no deben reabrir la conversación para él.
  if (
    isUserRemovedFromChat(chat as any, user) ||
    isUserVetoedFromChat(chat as any, user) ||
    isUserLeftVoluntarilyFromChat(chat as any, user)
  ) {
    if (inExplicitDelList || inLegacyDeleted) return true;
    const departureAt = getUserChatDepartureTimestamp(chat, user);
    if (clearedAt > 0 && (departureAt === 0 || clearedAt >= departureAt)) {
      return true;
    }
  }

  // Si fue borrado/vaciado, verificar si existen mensajes posteriores a la fecha de borrado
  if (clearedAt > 0 && Array.isArray(chat.messages) && chat.messages.length > 0) {
    const hasNewerMessage = chat.messages.some((m: any) => {
      const mTime = getMessageTimestampMs(m);
      return mTime > clearedAt;
    });
    // Si hay un mensaje nuevo enviado con posterioridad al borrado, el chat vuelve a mostrarse en recientes
    if (hasNewerMessage) return false;
  }

  return true;
}

/**
 * Filtra los mensajes de un chat para el usuario actual:
 * 1) Oculta cualquier mensaje previo al momento en que el usuario borró la conversación.
 * 2) Si el usuario dejó o fue retirado del grupo, oculta cualquier mensaje posterior a su salida/retiro.
 */
export function filterChatMessagesForUser(
  messages: any[],
  chatId?: number | string | null,
  user?: { id?: string; usuario?: string; apodo?: string; nombre?: string; notifications?: any[] } | null,
  chat?: any
): any[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  if ((!chatId && !chat) || !user) return messages;

  const effectiveChatId = chatId ?? chat?.id;
  const clearedAt = effectiveChatId ? getUserChatClearedTimestamp(effectiveChatId, user) : 0;
  const departureAt = getUserChatDepartureTimestamp(
    chat || { id: effectiveChatId, type: 'grupal', messages },
    user,
    messages
  );

  if ((!clearedAt || clearedAt <= 0) && (!departureAt || departureAt <= 0)) {
    return messages;
  }

  const userTokens = buildChatUserTokens(user);
  const strictUserIds = getStrictUserIds(user);
  const isOwnExitNotice = (m: any): boolean => {
    if (!m || (m.role !== 'sistema' && m.senderId !== 'sistema')) return false;
    let rt = m.replyTo || m.reply_to;
    if (typeof rt === 'string') {
      try { rt = JSON.parse(rt); } catch { rt = null; }
    }
    const text = String(m.text || '').trim();
    const isExitKind =
      rt?.event === 'user_left' ||
      rt?.event === 'participant_removed' ||
      /^(.+?)\s+(?:salió|abandonó)\s+del grupo/i.test(text) ||
      /^(.+?)\s+fue retirad[oa] del grupo/i.test(text);
    if (!isExitKind) return false;
    const pName = String(rt?.participant || '').trim().toLowerCase();
    const pId = String(rt?.participantId || rt?.userId || '').trim().toLowerCase();
    if (pId && strictUserIds.length > 0 && !strictUserIds.includes(pId)) {
      return false;
    }
    const tokens = Array.isArray(rt?.participantTokens) ? rt.participantTokens.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : [];
    return (pName !== '' && userTokens.includes(pName)) || (pId !== '' && userTokens.includes(pId)) || tokens.some((t: string) => userTokens.includes(t));
  };

  return messages.filter((m: any) => {
    const mTime = getMessageTimestampMs(m);
    if (clearedAt > 0 && !(mTime > clearedAt)) {
      return false;
    }
    if (departureAt > 0 && mTime > departureAt) {
      if (isOwnExitNotice(m) && mTime <= departureAt + 5000) {
        return true;
      }
      return false;
    }
    return true;
  });
}

/**
 * Checks whether the user was vetoed from the group chat (associated with an activity veto).
 */
export function isUserVetoedFromChat(
  chat?: { id?: number | string; activityId?: number | string | null; type?: string; vetoedParticipants?: string[]; vetoed_participants?: string[]; vetoedByUser?: boolean; messages?: any[] } | null,
  user?: { usuario?: string; apodo?: string; id?: string; nombre?: string; notifications?: any[] } | null
): boolean {
  if (!chat || chat.type !== 'grupal' || !user) return false;

  const userTokens = buildChatUserTokens(user);
  if (userTokens.length === 0) return false;
  const strictUserIds = getStrictUserIds(user);

  const timeline = analyzeUserChatMembershipTimeline(Array.isArray(chat.messages) ? chat.messages : [], userTokens, strictUserIds);
  const notice = findMatchingRemovedNotice(chat.id, chat.activityId, user);
  const noticeTs = notice ? toTimestampMs(notice.removedAt || notice.leftAt || notice.createdAt) : 0;
  const propTs = toTimestampMs((chat as any).removedAtForUser);

  if (timeline.latestState === 'added' && timeline.latestAddedMs >= Math.max(noticeTs, propTs)) return false;
  if (timeline.latestState === 'vetoed' && timeline.latestExitMs >= noticeTs) return true;

  if (notice && notice.reason === 'vetoed' && (timeline.latestAddedMs === 0 || noticeTs > timeline.latestAddedMs)) {
    return true;
  }

  const vList = [
    ...(chat?.vetoedParticipants || []),
    ...((chat as any)?.vetoed_participants || [])
  ];
  if (doesParticipantTokenListTargetUser(vList, userTokens, strictUserIds)) {
    return true;
  }
  if (vList.length === 0 && chat.vetoedByUser === true) {
    return true;
  }
  return false;
}

/**
 * Checks whether the user has been vetted from an activity by its organizer.
 */
export function isUserVettedFromActivity(
  act?: { vettedUsers?: string[]; vetted_users?: string[] } | null,
  user?: { usuario?: string; apodo?: string; id?: string; nombre?: string; email?: string } | null
): boolean {
  const vettedList = [
    ...(Array.isArray(act?.vettedUsers) ? act!.vettedUsers : []),
    ...(Array.isArray((act as any)?.vetted_users) ? (act as any).vetted_users : [])
  ];
  if (!act || vettedList.length === 0 || !user) return false;
  const userTokens: string[] = [];
  if (user.usuario) userTokens.push(user.usuario.trim().toLowerCase());
  if (user.apodo) userTokens.push(user.apodo.trim().toLowerCase());
  if (user.id) userTokens.push(user.id.trim().toLowerCase());
  if (user.nombre) userTokens.push(user.nombre.trim().toLowerCase());
  if (user.email) userTokens.push(user.email.trim().toLowerCase());
  return vettedList.some(v => v && userTokens.includes(String(v).trim().toLowerCase()));
}

/**
 * Validates if a user can pre-enroll in an activity.
 * Disallows if:
 * 1. User is not logged in.
/**
 * Determines whether a user is enrolled as a participant in an activity.
 * Compares against all tokens for the user (id, usuario, apodo, nombre, email)
 * and excludes the activity if the user is the organizer.
 */
export function isUserEnrolledInActivity(act: any, user: any): boolean {
  if (!user || !act) return false;

  const userTokens = [
    user.id,
    user.usuario,
    user.apodo,
    user.nombre,
    user.username,
    user.email
  ].filter(Boolean).map((t: any) => String(t).replace(/[!¡]/g, '').trim().toLowerCase());

  if (userTokens.length === 0) return false;

  // Si la actividad fue organizada por el propio usuario, no cuenta como participante/preinscripto
  const orgTokens = [
    act.userId,
    act.organizerId,
    act.organizer_id,
    act.createdById,
    act.creador_id,
    act.creadorId,
    act.organizer,
    act.createdBy,
    act.organizerName,
    act.creador
  ].filter(Boolean).map((t: any) => String(t).replace(/[!¡]/g, '').trim().toLowerCase());

  if (userTokens.some(ut => orgTokens.includes(ut))) {
    return false;
  }

  // Comprobar todas las listas posibles de participantes / inscriptos
  const candidateLists = [
    act.enrolledUsernames,
    act.enrolled_usernames,
    act.inscriptos,
    act.participants,
    act.enrolled_users
  ];

  for (const list of candidateLists) {
    if (Array.isArray(list) && list.length > 0) {
      const found = list.some((item: any) => {
        if (typeof item === 'string' || typeof item === 'number') {
          const str = String(item).replace(/[!¡]/g, '').trim().toLowerCase();
          return userTokens.includes(str);
        }
        if (typeof item === 'object' && item !== null) {
          const itemTokens = [item.id, item.apodo, item.usuario, item.nombre, item.username, item.email]
            .filter(Boolean)
            .map((t: any) => String(t).replace(/[!¡]/g, '').trim().toLowerCase());
          return userTokens.some(ut => itemTokens.includes(ut));
        }
        return false;
      });
      if (found) return true;
    }
  }

  // Respaldo por ID si el objeto usuario contiene arrays de inscripciones
  if (Array.isArray(user.misInscripciones) && user.misInscripciones.some((id: any) => String(id) === String(act.id))) return true;
  if (Array.isArray(user.enrolledActivityIds) && user.enrolledActivityIds.some((id: any) => String(id) === String(act.id))) return true;

  return false;
}

export interface ActivitySession {
  date: string; // YYYY-MM-DD
  startMinutes: number; // 0..1440
  endMinutes: number; // 0..1440
  timeLabel: string;
}

const DIAS_SEMANA_MAP: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  miércoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  sábado: 6
};

/**
 * Extracts concrete session occurrences (date in YYYY-MM-DD, startMinutes, endMinutes)
 * for any activity (one-time or recurring).
 */
export function getActivitySessions(act: any): ActivitySession[] {
  if (!act) return [];
  const sessions: ActivitySession[] = [];
  const sched = String(act.schedule || act.horario || '');
  const desc = String(act.descripcion || act.description || '');
  const allText = `${sched} ${desc}`;
  const isRecurrent = Boolean(act.isRecurrent || act.is_recurrent || act.es_recurrente || act.frecuencia === 'recurrente');

  let startMinutes: number | null = null;
  let endMinutes: number | null = null;

  const rawStartTime = act.startTime || act.start_time || act.horaIni || act.hora_inicio || act.firstEncounterStartTime || act.first_encounter_start_time;
  const rawEndTime = act.endTime || act.end_time || act.horaFin || act.hora_fin || act.firstEncounterEndTime || act.first_encounter_end_time;

  if (rawStartTime) {
    const m = String(rawStartTime).match(/(\d{1,2}):(\d{2})/);
    if (m) startMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }
  if (rawEndTime) {
    const m = String(rawEndTime).match(/(\d{1,2}):(\d{2})/);
    if (m) endMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  if (startMinutes === null || endMinutes === null) {
    const extracted = extractTimesFromSchedule(allText);
    if (startMinutes === null && extracted.startTime) {
      const m = extracted.startTime.match(/(\d{1,2}):(\d{2})/);
      if (m) startMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
    if (endMinutes === null && extracted.endTime) {
      const m = extracted.endTime.match(/(\d{1,2}):(\d{2})/);
      if (m) endMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    }
  }

  let crossesMidnight = false;
  if (startMinutes === null && endMinutes === null) {
    startMinutes = 600;
    endMinutes = 720;
  } else if (startMinutes !== null && endMinutes === null) {
    endMinutes = startMinutes + 60;
  } else if (startMinutes === null && endMinutes !== null) {
    startMinutes = Math.max(0, endMinutes - 60);
  } else if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
    crossesMidnight = true;
    endMinutes = 1440 + endMinutes;
  }

  const formatMin = (mins: number) => {
    const norm = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(norm / 60).toString().padStart(2, '0');
    const m = (norm % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };
  const timeLabel = `${formatMin(startMinutes!)} a ${formatMin(endMinutes!)} hs`;

  if (!isRecurrent) {
    const extractedDates = extractDatesFromText(allText);
    const startDateStr = parseDateToYMD(act.startDate || act.start_date || act.fechaIni || act.fecha_inicio || act.fechaRealizacion || act.fecha_realizacion || act.date || act.fecha) || extractedDates[0];
    const endDateStr = parseDateToYMD(act.endDate || act.end_date || act.fechaFin || act.fecha_fin) || (extractedDates.length > 1 ? extractedDates[extractedDates.length - 1] : startDateStr);

    if (startDateStr) {
      const isSingleOvernight = crossesMidnight && endDateStr === shiftYmdDays(startDateStr, 1);
      if (endDateStr && endDateStr !== startDateStr && !isSingleOvernight) {
        const startD = new Date(`${startDateStr}T00:00:00Z`);
        const endD = new Date(`${endDateStr}T00:00:00Z`);
        if (!isNaN(startD.getTime()) && !isNaN(endD.getTime()) && startD <= endD) {
          const cur = new Date(startD);
          let count = 0;
          while (cur <= endD && count < 60) {
            const ymd = cur.toISOString().split('T')[0];
            sessions.push({ date: ymd, startMinutes: startMinutes!, endMinutes: endMinutes!, timeLabel });
            cur.setUTCDate(cur.getUTCDate() + 1);
            count++;
          }
        } else {
          sessions.push({ date: startDateStr, startMinutes: startMinutes!, endMinutes: endMinutes!, timeLabel });
        }
      } else {
        sessions.push({ date: startDateStr, startMinutes: startMinutes!, endMinutes: endMinutes!, timeLabel });
      }
    } else if (extractedDates.length > 0) {
      for (const d of extractedDates) {
        sessions.push({ date: d, startMinutes: startMinutes!, endMinutes: endMinutes!, timeLabel });
      }
    }
  } else {
    const daysSet = new Set<number>();
    const diasArray = act.diasSemana || act.dias_semana || act.daysOfWeek || act.days_of_week;
    if (Array.isArray(diasArray) && diasArray.length > 0) {
      for (const d of diasArray) {
        const key = String(d).toLowerCase().trim();
        if (DIAS_SEMANA_MAP[key] !== undefined) daysSet.add(DIAS_SEMANA_MAP[key]);
      }
    }

    if (daysSet.size === 0) {
      const lower = allText.toLowerCase();
      for (const [dayName, dayNum] of Object.entries(DIAS_SEMANA_MAP)) {
        const regex = new RegExp(`\\b${dayName}\\b`, 'i');
        if (regex.test(lower)) {
          daysSet.add(dayNum);
        }
      }
    }

    const extractedDates = extractDatesFromText(allText);
    let startDateStr = parseDateToYMD(act.firstEncounterDate || act.first_encounter_date || act.startDate || act.start_date || act.fechaPrimerEncuentro || act.fechaIni) || extractedDates[0];
    if (!startDateStr) {
      startDateStr = '2026-11-06';
    }

    let maxEncounters = Number(act.cantidadEventos || act.cantidad_eventos || act.totalEncuentros || 0);
    if (!maxEncounters || isNaN(maxEncounters)) {
      const matchEnc = allText.match(/(\d+)\s*encuentros/i);
      if (matchEnc && matchEnc[1]) {
        maxEncounters = parseInt(matchEnc[1], 10);
      } else {
        maxEncounters = 12;
      }
    }
    maxEncounters = Math.max(1, maxEncounters);

    const freq = String(act.frequency || act.frecuencia || act.frecuenciaRecurrente || '').toLowerCase().trim();
    const isMensual = freq === 'mensual' || /\b(mensual|día\s*\d+\s*de\s*cada\s*mes)\b/i.test(allText);
    const isQuincenal = freq === 'quincenal' || /\b(quincenal|cada\s*2\s*semanas)\b/i.test(allText);

    if (isMensual) {
      let targetDayOfMonth = Number(act.diaMes || act.dia_mes || act.diaMesRecurrente || 0);
      if (!targetDayOfMonth) {
        const matchDiaMes = allText.match(/día\s*(\d{1,2})/i);
        if (matchDiaMes) targetDayOfMonth = parseInt(matchDiaMes[1], 10);
        else {
          const [, , dStr] = startDateStr.split('-');
          targetDayOfMonth = parseInt(dStr, 10);
        }
      }
      targetDayOfMonth = Math.min(31, Math.max(1, targetDayOfMonth));

      const [sY, sM] = startDateStr.split('-').map(Number);
      let curYear = sY;
      let curMonth = sM;
      let added = 0;
      let iterations = 0;

      while (added < maxEncounters && iterations < 120) {
        const daysInMonth = new Date(Date.UTC(curYear, curMonth, 0)).getUTCDate();
        const day = Math.min(targetDayOfMonth, daysInMonth);
        const ymd = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

        if (ymd >= startDateStr) {
          sessions.push({ date: ymd, startMinutes: startMinutes!, endMinutes: endMinutes!, timeLabel });
          added++;
        }
        curMonth++;
        if (curMonth > 12) {
          curMonth = 1;
          curYear++;
        }
        iterations++;
      }
    } else if (isQuincenal) {
      if (daysSet.size === 0) {
        const [sY, sM, sD] = startDateStr.split('-').map(Number);
        const startDayOfWeek = new Date(Date.UTC(sY, sM - 1, sD)).getUTCDay();
        daysSet.add(isNaN(startDayOfWeek) ? 1 : startDayOfWeek);
      }

      const [sY, sM, sD] = startDateStr.split('-').map(Number);
      const startEpochDays = Math.floor(Date.UTC(sY, sM - 1, sD) / 86400000);
      const startUtcDay = new Date(Date.UTC(sY, sM - 1, sD)).getUTCDay();
      const daysSinceMonday = (startUtcDay + 6) % 7;
      const baseMondayEpoch = startEpochDays - daysSinceMonday;

      const cur = new Date(Date.UTC(sY, sM - 1, sD));
      let added = 0;
      let iterations = 0;

      while (added < maxEncounters && iterations < 730) {
        const dayOfWeek = cur.getUTCDay();
        const curEpochDays = Math.floor(cur.getTime() / 86400000);
        const weekDiff = Math.floor((curEpochDays - baseMondayEpoch) / 7);
        const isBiweeklyActiveWeek = (weekDiff % 2 === 0);

        if (isBiweeklyActiveWeek && daysSet.has(dayOfWeek)) {
          const ymd = cur.toISOString().split('T')[0];
          sessions.push({ date: ymd, startMinutes: startMinutes!, endMinutes: endMinutes!, timeLabel });
          added++;
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
        iterations++;
      }
    } else {
      // Semanal (default)
      if (daysSet.size === 0) {
        const [sY, sM, sD] = startDateStr.split('-').map(Number);
        const startDayOfWeek = new Date(Date.UTC(sY, sM - 1, sD)).getUTCDay();
        daysSet.add(isNaN(startDayOfWeek) ? 1 : startDayOfWeek);
      }

      const [sY, sM, sD] = startDateStr.split('-').map(Number);
      const cur = new Date(Date.UTC(sY, sM - 1, sD));
      let added = 0;
      let iterations = 0;

      while (added < maxEncounters && iterations < 730) {
        const dayOfWeek = cur.getUTCDay();
        if (daysSet.has(dayOfWeek)) {
          const ymd = cur.toISOString().split('T')[0];
          sessions.push({ date: ymd, startMinutes: startMinutes!, endMinutes: endMinutes!, timeLabel });
          added++;
        }
        cur.setUTCDate(cur.getUTCDate() + 1);
        iterations++;
      }
    }
  }

  return sessions;
}

/**
 * Checks if two activities have an overlapping day and time slot.
 * Returns detailed conflict information if an overlap exists.
 */
export function checkActivitiesCollision(
  actA: any,
  actB: any
): { hasCollision: boolean; reason?: string; date?: string; timeA?: string; timeB?: string } {
  if (!actA || !actB) return { hasCollision: false };
  if (String(actA.id) === String(actB.id)) return { hasCollision: false };

  const isCancelled = (a: any) =>
    Boolean(a.proposalStatus === 'baja_forzada' || a.proposalStatus === 'cancelada_organizador' || a.canceladaPorOrganizador || a.baja_forzada);
  if (isCancelled(actA) || isCancelled(actB)) {
    return { hasCollision: false };
  }

  const expandSessionSegments = (sessions: ActivitySession[]): ActivitySession[] => {
    const segs: ActivitySession[] = [];
    for (const s of sessions) {
      if (s.endMinutes > 1440) {
        segs.push({ date: s.date, startMinutes: s.startMinutes, endMinutes: 1440, timeLabel: s.timeLabel });
        const overflow = s.endMinutes - 1440;
        if (overflow > 0) {
          segs.push({ date: shiftYmdDays(s.date, 1), startMinutes: 0, endMinutes: overflow, timeLabel: s.timeLabel });
        }
      } else {
        segs.push(s);
      }
    }
    return segs;
  };

  const sessionsA = expandSessionSegments(getActivitySessions(actA));
  const sessionsB = expandSessionSegments(getActivitySessions(actB));

  for (const sA of sessionsA) {
    for (const sB of sessionsB) {
      if (sA.date === sB.date) {
        // Intersección de intervalos: startA < endB && endA > startB
        if (sA.startMinutes < sB.endMinutes && sA.endMinutes > sB.startMinutes) {
          const overlapMinutes = Math.min(sA.endMinutes, sB.endMinutes) - Math.max(sA.startMinutes, sB.startMinutes);
          const nameB = actB.title || actB.titulo || actB.nombre || 'otra actividad';
          const [y, m, d] = sA.date.split('-');
          const fechaVisual = `${d}/${m}/${y}`;
          return {
            hasCollision: true,
            date: sA.date,
            timeA: sA.timeLabel,
            timeB: sB.timeLabel,
            reason: `Superposición de horario: Se superpone con "${nameB}" el día ${fechaVisual} (coinciden ${overlapMinutes} min: ${sA.timeLabel} vs ${sB.timeLabel}). No es posible inscribirse a dos actividades en el mismo momento.`
          };
        }
      }
    }
  }

  return { hasCollision: false };
}

/**
 * Checks if a user is allowed to enroll in an activity.
 * Blocks enrollment if:
 * 1. User is not logged in.
 * 2. User was vetted from the activity.
 * 3. Activity has already completed/ended (isActivityPast).
 * 4. Recurring activity is marked to close inscriptions upon start/end and the first encounter has started or ended.
 * 5. Schedule overlaps with any activity the user is already enrolled in (even if only 15 minutes).
 */
export function canUserEnrollActivity(
  act: any,
  user?: { usuario?: string; apodo?: string; id?: string; nombre?: string; email?: string } | null,
  referenceDateOrEnrolled?: Date | any[],
  userEnrolledActivitiesParam?: any[]
): { allowed: boolean; canEnroll: boolean; reason?: string } {
  const refDate = referenceDateOrEnrolled instanceof Date ? referenceDateOrEnrolled : undefined;
  const enrolledList = Array.isArray(referenceDateOrEnrolled)
    ? referenceDateOrEnrolled
    : (Array.isArray(userEnrolledActivitiesParam) ? userEnrolledActivitiesParam : []);

  if (!user) return { allowed: false, canEnroll: false, reason: 'Debés iniciar sesión para inscribirte.' };
  if (isUserVettedFromActivity(act, user)) {
    return { allowed: false, canEnroll: false, reason: 'No podés inscribirte porque fuiste vetado de esta actividad.' };
  }
  const isRecurrent = Boolean(act.isRecurrent || act.is_recurrent || act.es_recurrente || act.frecuencia === 'recurrente');
  const shouldClose = Boolean(
    act.cerrarInscripcionAlIniciarPrimerEncuentro ||
    act.cerrar_inscripcion_al_iniciar_primer_encuentro
  );
  if (isRecurrent && shouldClose && (hasFirstEncounterStarted(act, refDate) || hasFirstEncounterEnded(act, refDate))) {
    return { allowed: false, canEnroll: false, reason: 'Inscripciones cerradas (el primer encuentro ya se realizó)' };
  }
  if (isActivityPast(act, refDate)) {
    return { allowed: false, canEnroll: false, reason: 'Esta actividad ya ha finalizado.' };
  }

  // 5. Verificación de superposición horaria (incluso si coinciden solo 15 minutos)
  if (enrolledList.length > 0) {
    for (const enrolledAct of enrolledList) {
      if (String(enrolledAct.id) === String(act.id)) continue;
      const collision = checkActivitiesCollision(act, enrolledAct);
      if (collision.hasCollision) {
        return {
          allowed: false,
          canEnroll: false,
          reason: collision.reason || `Superposición de horario con la actividad "${enrolledAct.title || enrolledAct.titulo}" a la que ya estás inscripto.`
        };
      }
    }
  }

  return { allowed: true, canEnroll: true };
}

/**
 * Checks if a user is allowed to create or propose a new activity without schedule conflicts.
 * Blocks creation if the new activity overlaps (even if only 15 minutes) with any activity
 * the user is already enrolled in or already organizing.
 */
export function canUserCreateActivity(
  candidateActivity: any,
  currentUser: any,
  existingActivities: any[]
): { allowed: boolean; reason?: string; conflictingActivity?: any } {
  if (!currentUser) {
    return { allowed: false, reason: 'Debés iniciar sesión para proponer o crear una actividad.' };
  }
  if (!candidateActivity) {
    return { allowed: false, reason: 'Datos de la actividad no válidos.' };
  }
  if (!Array.isArray(existingActivities) || existingActivities.length === 0) {
    return { allowed: true };
  }

  const uAny = currentUser as any;
  const myTokens = [
    currentUser.id,
    currentUser.usuario,
    currentUser.apodo,
    currentUser.nombre,
    uAny?.email
  ].filter(Boolean).map((t: any) => String(t).replace(/[!¡]/g, '').trim().toLowerCase());

  const candId = candidateActivity.id ? String(candidateActivity.id) : null;

  for (const act of existingActivities) {
    if (!act) continue;
    // Ignorar si se compara contra la misma actividad (ej. al editar propuesta existente)
    if (candId && String(act.id) === candId) continue;
    if (act.proposalStatus === 'rechazada' || act.proposal_status === 'rechazada') continue;

    // Verificar si el usuario está inscripto en la actividad existente
    const isEnrolled = isUserEnrolledInActivity(act, currentUser);

    // Verificar si el usuario es organizador de la actividad existente
    const actOrgTokens = [
      act.organizerId,
      act.organizer_id,
      act.userId,
      act.creador_id,
      act.organizer,
      act.creador,
      act.createdBy
    ].filter(Boolean).map((t: any) => String(t).replace(/[!¡]/g, '').trim().toLowerCase());
    const isOrganizer = myTokens.some(tok => actOrgTokens.includes(tok));

    if (isEnrolled || isOrganizer) {
      const collision = checkActivitiesCollision(candidateActivity, act);
      if (collision.hasCollision) {
        const relation = isEnrolled ? 'a la que ya estás inscripto/a' : 'que ya organizás';
        const actName = act.title || act.titulo || 'otra actividad';
        return {
          allowed: false,
          conflictingActivity: act,
          reason: collision.reason || `Coincide en fecha y horario con "${actName}" ${relation}. No es posible coordinar ni asistir a dos actividades al mismo tiempo.`
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Returns true if an activity is cancelled, suspended, or rejected.
 */
export function isActCancelled(a: any): boolean {
  if (!a) return false;
  const hasFechaBaja =
    (a.fecha_baja !== undefined && a.fecha_baja !== null && String(a.fecha_baja).trim() !== '') ||
    (a.bajaDate !== undefined && a.bajaDate !== null && String(a.bajaDate).trim() !== '');
  return Boolean(
    a.proposalStatus === 'baja_forzada' ||
    a.proposal_status === 'baja_forzada' ||
    a.estado === 'baja_forzada' ||
    a.proposalStatus === 'cancelada_organizador' ||
    a.proposal_status === 'cancelada_organizador' ||
    a.estado === 'cancelada_organizador' ||
    a.canceladaPorOrganizador ||
    a.cancelada_por_organizador ||
    a.bajaForzada ||
    a.baja_forzada ||
    hasFechaBaja ||
    a.proposalStatus === 'rechazada' ||
    a.proposal_status === 'rechazada' ||
    a.estado === 'rechazada'
  );
}

/**
 * Checks if a candidate activity name collides with an activity currently published in Cartelera.
 * While an activity is actively published in Cartelera (approved, not cancelled, not past/finished),
 * no other activity can have the exact same name (case-insensitive, trimmed).
 * Once an activity leaves Cartelera (finished, cancelled, or rejected), new activities can use that name.
 */
export function checkActivityNameCollision(
  candidateTitle: string | null | undefined,
  candidateId: string | number | null | undefined,
  existingActivities: any[]
): { hasCollision: boolean; reason?: string; collidingActivity?: any } {
  if (!candidateTitle || typeof candidateTitle !== 'string') {
    return { hasCollision: false };
  }
  const cleanCandidate = candidateTitle.trim().toLowerCase();
  if (!cleanCandidate) {
    return { hasCollision: false };
  }

  const candIdStr = candidateId ? String(candidateId) : null;

  for (const act of (existingActivities || [])) {
    if (!act) continue;
    // Si se está editando una propuesta existente, no colisiona consigo misma
    if (candIdStr && String(act.id) === candIdStr) continue;

    // Solo actividades que actualmente estén publicadas en Cartelera
    if (!isActivityApproved(act)) continue;
    if (isActCancelled(act)) continue;
    if (isActivityPast(act)) continue;

    const actTitle = String(act.title || act.titulo || '').trim().toLowerCase();
    if (actTitle === cleanCandidate) {
      const displayName = String(act.title || act.titulo || candidateTitle).trim();
      return {
        hasCollision: true,
        collidingActivity: act,
        reason: `Ya existe una actividad publicada en Cartelera con el nombre "${displayName}". Mientras esté en cartelera ninguna otra actividad puede llamarse igual.`
      };
    }
  }

  return { hasCollision: false };
}

/**
 * Builds the map of calendar days for a given month and year.
 * Excludes cancelled activities completely and vetted activities.
 */
export function getAgendaCalendarDays(
  activities: any[],
  currentUser: { usuario?: string; apodo?: string; id?: string } | null,
  year: number,
  month: number // 0-indexed (0 = Enero, 10 = Noviembre)
): Record<number, string> {
  const map: Record<number, string> = {};
  if (!currentUser || !Array.isArray(activities)) return map;

  const isCancelled = (a: any) =>
    Boolean(a.proposalStatus === 'baja_forzada' || a.proposalStatus === 'cancelada_organizador' || a.canceladaPorOrganizador || a.baja_forzada);

  const activeActs = activities.filter(a => !isCancelled(a) && !isUserVettedFromActivity(a, currentUser));

  activeActs.forEach(act => {
    let matchedSessions = false;
    try {
      const sessions = getActivitySessions(act);
      if (Array.isArray(sessions) && sessions.length > 0) {
        sessions.forEach(sess => {
          if (!sess.date) return;
          const [sYear, sMonth, sDay] = sess.date.split('-').map(Number);
          if (sYear === year && sMonth === month + 1 && !isNaN(sDay) && sDay > 0) {
            matchedSessions = true;
            const actTitle = act.title || act.titulo || 'Actividad';
            const label = sess.timeLabel ? `${actTitle} (${sess.timeLabel})` : actTitle;
            if (map[sDay]) {
              if (!map[sDay].includes(actTitle)) {
                map[sDay] = `${map[sDay]} • ${label}`;
              }
            } else {
              map[sDay] = label;
            }
          }
        });
      }
    } catch (_) {}

    // Fallback si no se generaron sesiones específicas
    if (!matchedSessions) {
      const dateStr = act.fechaRealizacion || act.fecha_realizacion || act.firstEncounterDate || act.first_encounter_date || act.startDate || act.date || act.fecha;
      if (dateStr) {
        const m = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        const mDmy = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        let actYear = 0;
        let actMonth = 0;
        let d = 0;

        if (m) {
          actYear = Number(m[1]);
          actMonth = Number(m[2]);
          d = Number(m[3]);
        } else if (mDmy) {
          d = Number(mDmy[1]);
          actMonth = Number(mDmy[2]);
          actYear = Number(mDmy[3]);
        }

        if (actYear === year && actMonth === month + 1 && d > 0) {
          const actTitle = act.title || act.titulo || 'Actividad';
          const timePart = act.schedule ? (act.schedule.split(' ').pop() || '') : '';
          const label = timePart ? `${actTitle} (${timePart})` : actTitle;
          if (map[d]) {
            if (!map[d].includes(actTitle)) {
              map[d] = `${map[d]} • ${label}`;
            }
          } else {
            map[d] = label;
          }
        }
      }
    }
  });

  return map;
}

/**
 * Detects if a string is a technical identifier (UUID, c_179..., usr_..., org_..., chat_..., etc.)
 * rather than a friendly human name or apodo.
 */
export function isTechnicalIdentifier(str?: string | null): boolean {
  if (!str) return false;
  const s = String(str).trim();
  if (!s) return false;
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ||
    /^c_\d+/i.test(s) ||
    /^c\d+$/i.test(s) ||
    /^priv_\d+/i.test(s) ||
    /^msg_\d+/i.test(s) ||
    /^chat_\d+/i.test(s) ||
    /^contact_\d+/i.test(s) ||
    /^usr_\d+/i.test(s) ||
    /^user_\d+/i.test(s) ||
    /^org_\d+/i.test(s) ||
    /^part_\d+/i.test(s) ||
    /^u_\d+/i.test(s)
  );
}

/**
 * Resolves the display title for a private chat from the current user's perspective,
 * guaranteeing that technical IDs (such as c_1793946544401) never appear as the title.
 */
export function getPrivateChatResolvedTitle(
  chat: {
    title?: string;
    name?: string;
    type?: string;
    destinatario?: string;
    participants?: (string | { id?: string; usuario?: string; apodo?: string; nombre?: string })[];
    participantIds?: string[];
    creatorName?: string;
    messages?: { text?: string; sender?: string; senderId?: string }[];
  },
  currentUser?: { id?: string; usuario?: string; apodo?: string; nombre?: string; institucion?: string; name?: string } | null,
  allUsersMap?: Record<string, any>,
  contactsList?: { id?: string; nombre?: string; usuario?: string }[]
): string {
  if (!chat) return 'Chat Privado';

  const myTokens: string[] = currentUser ? [
    currentUser.id,
    currentUser.usuario,
    currentUser.apodo,
    currentUser.nombre,
    currentUser.institucion,
    currentUser.name
  ].filter(Boolean).map(t => String(t).toLowerCase().trim()) : [];

  const resolveReadable = (val: any): string | null => {
    if (!val) return null;
    const raw = typeof val === 'object'
      ? (val.apodo || val.nombre || val.usuario || val.institucion || '')
      : String(val);
    const clean = String(raw || '').trim();
    if (!clean) return null;

    const low = clean.toLowerCase();
    if (low === 'usuario' || low === 'vecino' || low === 'sistema club65' || low === 'sistema' || low === 'organizador') {
      return null;
    }

    if (low.includes('club65')) {
      return 'CLUB65';
    }

    if (allUsersMap) {
      const match = allUsersMap[clean] || allUsersMap[low];
      if (match) {
        return match.apodo || match.nombre || match.usuario || match.institucion || null;
      }
      for (const k of Object.keys(allUsersMap)) {
        const u = allUsersMap[k];
        if (
          [u?.id, u?.usuario, u?.nombre, u?.apodo, u?.institucion]
            .filter(Boolean)
            .some((v: any) => String(v).toLowerCase().trim() === low)
        ) {
          return u.apodo || u.nombre || u.usuario || u.institucion || null;
        }
      }
    }

    if (Array.isArray(contactsList)) {
      const c = contactsList.find(item =>
        [item?.id, item?.nombre, item?.usuario]
          .filter(Boolean)
          .some(v => String(v).toLowerCase().trim() === low)
      );
      if (c && c.nombre && !isTechnicalIdentifier(c.nombre)) {
        return c.nombre;
      }
    }

    if (isTechnicalIdentifier(clean)) {
      return null;
    }

    return clean;
  };

  // 1. Si chat.title es un nombre legible no técnico y no es el usuario actual
  if (chat.title && !isTechnicalIdentifier(chat.title)) {
    const tClean = chat.title.trim();
    if (!myTokens.includes(tClean.toLowerCase())) {
      const resolved = resolveReadable(tClean);
      if (resolved && !myTokens.includes(resolved.toLowerCase())) {
        return resolved;
      }
      return tClean;
    }
  }

  // 2. Si chat.name es un nombre legible
  if (chat.name && !isTechnicalIdentifier(chat.name)) {
    const nClean = chat.name.trim();
    if (!myTokens.includes(nClean.toLowerCase())) {
      const resolved = resolveReadable(nClean);
      if (resolved && !myTokens.includes(resolved.toLowerCase())) {
        return resolved;
      }
      return nClean;
    }
  }

  // 3. Destinatario explícito
  if (chat.destinatario && !isTechnicalIdentifier(chat.destinatario)) {
    const dClean = chat.destinatario.trim();
    if (!myTokens.includes(dClean.toLowerCase())) {
      return dClean;
    }
  }

  // 4. Buscar entre los participantes uno que no sea el usuario actual
  const participants = Array.isArray(chat.participants) ? chat.participants : [];
  for (const p of participants) {
    const pStr = typeof p === 'object' ? (p.apodo || p.nombre || p.usuario || p.id) : String(p || '');
    const pClean = String(pStr).toLowerCase().trim();
    if (pClean && !myTokens.includes(pClean)) {
      const resolved = resolveReadable(p);
      if (resolved && !myTokens.includes(resolved.toLowerCase()) && !isTechnicalIdentifier(resolved)) {
        return resolved;
      }
    }
  }

  // 5. Extraer desde el mensaje de inicio del sistema: "Se inició un chat privado con {Nombre}."
  if (Array.isArray(chat.messages)) {
    for (const m of chat.messages) {
      const txt = String(m?.text || '');
      const match = txt.match(/Se inició un chat privado con\s+([^.]+)/i);
      if (match && match[1]) {
        const candidate = match[1].trim();
        if (candidate && !isTechnicalIdentifier(candidate) && !myTokens.includes(candidate.toLowerCase())) {
          return candidate;
        }
      }
    }

    // Revisar remitentes que no sean el usuario ni sistema
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i];
      const sName = m.sender;
      if (sName && !myTokens.includes(sName.toLowerCase()) && sName.toLowerCase() !== 'sistema club65') {
        const resolved = resolveReadable(sName);
        if (resolved && !isTechnicalIdentifier(resolved)) return resolved;
      }
    }
  }

  // 6. CreatorName si es de la otra persona
  if (chat.creatorName && !isTechnicalIdentifier(chat.creatorName)) {
    const cClean = chat.creatorName.trim();
    if (!myTokens.includes(cClean.toLowerCase())) {
      return cClean;
    }
  }

  // 7. Si chat.title existe aunque sea igual a candidateTitle
  if (chat.title && !isTechnicalIdentifier(chat.title)) {
    return chat.title;
  }

  return 'Contacto';
}

/**
 * Detects if a contact/user is an old hardcoded mock profile that must never be displayed.
 */
export function isHardcodedOrMockProfile(c: any): boolean {
  if (!c) return false;
  const id = String(c.id || '').trim().toLowerCase();
  const nombre = String(c.nombre || c.name || c.usuario || c.apodo || '').trim().toLowerCase();
  const detalle = String(c.detalle || '').trim().toLowerCase();
  const bio = String(c.bio || '').trim().toLowerCase();

  // Known legacy mock IDs
  if (['c1', 'c2', 'c3', 'c4', 'contact_1793153276770', 'contact_1793155017602', 'contact_1793155023047', '1793849767571', 'usr_test_123'].includes(id)) {
    return true;
  }

  // Known legacy mock contact names
  const mockNames = [
    'marta sánchez', 'marta sanchez',
    'graciela pérez', 'graciela perez',
    'roberto gómez', 'roberto gomez',
    'institución comunitaria', 'institucion comunitaria',
    'carola márquez', 'carola marquez',
    'tita',
    'test user'
  ];
  if (mockNames.includes(nombre)) {
    return true;
  }

  // Known mock bio/details from legacy html seed
  if (
    detalle.includes('caseros • asiste a movilidad') ||
    detalle.includes('tres de febrero • institucion') ||
    detalle.includes('ciudadela • amante del tejido') ||
    detalle.includes('santos lugares • aficionada')
  ) {
    return true;
  }
  if (
    bio.includes('jubilado metalúrgico') ||
    bio.includes('jubilado metalurgico') ||
    bio.includes('amante del tejido') ||
    bio.includes('aficionada a la jardinería')
  ) {
    return true;
  }

  return false;
}

/**
 * Maps any chat identifier (UUID string, number, or prefix string like chat_...)
 * deterministically to a valid positive BIGINT (<= 9007199254740991 safe integer)
 * for storage in PostgreSQL / Supabase `messages.chat_id` column.
 */
export function chatIdentifierToBigInt(chatId: string | number | null | undefined): number {
  if (chatId === null || chatId === undefined) return 1;
  if (typeof chatId === 'number' && !isNaN(chatId)) return Math.abs(Math.floor(chatId)) || 1;
  const s = String(chatId).trim();
  const num = Number(s);
  if (!isNaN(num) && num > 0 && Number.isSafeInteger(num)) return num;

  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) % 9007199254740991;
  }
  return Math.abs(hash) || 1;
}

/**
 * Cleans the creation/system welcome message of a group chat
 * so that any technical identifiers (usr_..., user_..., c_..., UUIDs)
 * accidentally included in historical records or creation payloads
 * are completely omitted from the human-facing banner text.
 */
export function cleanSystemCreationMessage(text?: string | null): string {
  if (!text) return '';
  const s = String(text).trim();
  if (!s) return '';

  // Match: Se inició el grupo "..." con {lista de participantes}.
  const grupoMatch = s.match(/^(Se inició el grupo\s+["“][^"”]+["”]\s+con\s+)(.+?)(\.?)$/i);
  if (grupoMatch) {
    const prefix = grupoMatch[1];
    const rawParts = grupoMatch[2];
    const suffix = grupoMatch[3] || '.';
    const parts = rawParts.split(/,\s*|\s+y\s+/).map(p => p.trim()).filter(Boolean);
    const cleanParts = parts.filter(p => !isTechnicalIdentifier(p) && !isDummyOrSystemParticipant(p));
    if (cleanParts.length === 0) return `${prefix.trim()}.`;
    return `${prefix}${cleanParts.join(', ')}${suffix}`;
  }

  return s.replace(/,\s*(?:usr|user|org|c|contact)_[a-zA-Z0-9_-]+/gi, '')
          .replace(/(?:usr|user|org|c|contact)_[a-zA-Z0-9_-]+,\s*/gi, '')
          .replace(/\b(?:usr|user|org|c|contact)_[a-zA-Z0-9_-]+\b/gi, '')
          .replace(/\s{2,}/g, ' ')
          .replace(/,\s*\./g, '.')
          .trim();
}

/**
 * Formats a system notice message for display.
 * For groups associated with an activity, replaces:
 * "{apodo} fue agregado al grupo por el moderador del grupo."
 * with:
 * "¡Bienvenido a {nombre de la actividad/grupo}, {Apodo}!"
 */
export function formatActivitySystemNotice(
  text?: string | null,
  chat?: { id?: any; name?: string; title?: string; activityId?: any; activityTitle?: string; type?: string } | null,
  activity?: { id?: any; title?: string } | null,
  replyTo?: any
): string {
  if (!text && !replyTo) return '';
  const rawText = String(text || '').trim();

  const isActivityGroup = Boolean(
    chat?.activityId ||
    activity?.id ||
    activity?.title ||
    (chat?.type === 'grupal' && (chat?.activityId || (chat as any)?.isActivityChat))
  );

  const isAdd = Boolean(
    replyTo?.event === 'participant_added' ||
    /fue agregad[oa] al grupo/i.test(rawText) ||
    /¡Bienvenido a/i.test(rawText) ||
    /se unió a la actividad/i.test(rawText)
  );

  if (isActivityGroup && isAdd) {
    // Extract participant apodo
    let apodo = String(replyTo?.participant || '').trim();
    if (!apodo) {
      const mAdd = rawText.match(/^(.+?)\s+fue agregad[oa] al grupo/i);
      if (mAdd && mAdd[1]) apodo = mAdd[1].trim();
    }
    if (!apodo) {
      const mWel = rawText.match(/^¡Bienvenido a\s+[^,]+,\s*(.+?)[!.]?$/i);
      if (mWel && mWel[1]) apodo = mWel[1].trim();
    }
    if (!apodo) {
      const mJoin = rawText.match(/^¡?(.+?)\s+se unió a la actividad/i);
      if (mJoin && mJoin[1]) apodo = mJoin[1].trim();
    }
    if (!apodo) apodo = 'Vecino';
    if (apodo.includes('@')) apodo = apodo.split('@')[0];

    // Determine activity/group title
    const rawTitle = activity?.title || chat?.activityTitle || chat?.name || chat?.title || 'la actividad';
    const cleanTitle = rawTitle.replace(/^Grupo:\s*/i, '').trim();

    return `¡Bienvenido a ${cleanTitle}, ${apodo}!`;
  }

  return cleanSystemCreationMessage(rawText);
}

/**
 * Computes epoch timestamp (ms) of the most recent activity in a chat
 * (latest message timestamp, chat updated_at, created_at, or id timestamp).
 */
export function getChatLastActivityTime(chat: any): number {
  if (!chat) return 0;

  let maxMsgTime = 0;

  // 1. Scan all messages for the latest valid timestamp
  if (Array.isArray(chat.messages) && chat.messages.length > 0) {
    for (const m of chat.messages) {
      if (!m) continue;
      if (typeof m.timestamp === 'number' && m.timestamp > 0) {
        if (m.timestamp > maxMsgTime) maxMsgTime = m.timestamp;
      }
      if (m.createdAt) {
        const t = new Date(m.createdAt).getTime();
        if (!isNaN(t) && t > maxMsgTime) maxMsgTime = t;
      }
      if (m.created_at) {
        const t = new Date(m.created_at).getTime();
        if (!isNaN(t) && t > maxMsgTime) maxMsgTime = t;
      }
      if (typeof m.id === 'string' && m.id.startsWith('msg_')) {
        const parts = m.id.split('_');
        const num = parseInt(parts[1], 10);
        if (!isNaN(num) && num > 1000000000000 && num > maxMsgTime) {
          maxMsgTime = num;
        }
      }
    }
  }

  if (maxMsgTime > 0) {
    return maxMsgTime;
  }

  // 2. Chat timestamp fields
  if (chat.updated_at) {
    const t = new Date(chat.updated_at).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (chat.updatedAt) {
    const t = new Date(chat.updatedAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (chat.createdAt) {
    const t = new Date(chat.createdAt).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (chat.created_at || chat.creado_el) {
    const t = new Date(chat.created_at || chat.creado_el).getTime();
    if (!isNaN(t) && t > 0) return t;
  }
  if (typeof chat.id === 'number' && chat.id > 1000000000000) {
    return chat.id;
  }

  return 0;
}

/**
/**
 * Evaluates whether an activity is officially approved and active on the platform.
 * Institutional activities are always approved.
 * Neighbor proposals are only approved if their proposalStatus is 'aprobada' or isApproved is true,
 * and they are not pending, rejected, or awaiting requested changes.
 */
export function isActivityApproved(act: any): boolean {
  if (!act) return false;
  // Institutional activities are always approved
  if (act.isInstitutional || act.is_institutional || act.es_institucional || act.organizerId === 'institucional') {
    return true;
  }
  // Explicit proposal statuses
  const status = String(act.proposalStatus || act.proposal_status || act.estado || '').toLowerCase().trim();
  if (status === 'aprobada') return true;
  if (status === 'pendiente' || status === 'rechazada' || status === 'cambios_solicitados') return false;

  // Boolean flags
  if (act.isApproved === true || act.is_approved === true || act.aprobada === true) return true;
  if (act.isApproved === false || act.is_approved === false || act.aprobada === false) return false;

  // Default for non-institutional neighbor proposals without explicit approval
  return false;
}

/**
 * Filters and validates recent chats visible to the given user session:
 * 1. Excludes chats deleted for this user (isChatDeletedForUser).
 * 2. For private chats ('privado'):
 *    - MUST have direct participation (user is creator, participant, or sender in messages).
 *    - NEVER leaks private chats between other users (even if participants is empty in DB).
 *    - NEVER displays a degenerate chat with oneself (where the other party resolves to oneself).
 * 3. For group chats ('grupal'):
 *    - Visible if user created it, is participant, is enrolled in the activity, or sent a message in it.
 *    - Excludes vetoed groups (isUserVetoedFromChat).
 *    - STRICTLY EXCLUDES group chats of neighbor activities that have NOT yet been approved by CLUB65 admin.
 * 4. Sorts all visible chats by most recent activity timestamp descending (getChatLastActivityTime).
 */
export function filterAndSortRecentChats(
  chats: any[],
  currentUser: any,
  activities: any[] = []
): any[] {
  if (!currentUser) return [];

  const uAny = currentUser as any;
  const myTokens: string[] = [
    currentUser.id,
    currentUser.usuario,
    currentUser.apodo,
    currentUser.nombre,
    uAny?.institucion,
    uAny?.nombreInstitucion,
    uAny?.nombreCompleto
  ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

  if (myTokens.length === 0) return [];

  const visible = (chats || []).filter(c => {
    if (!c) return false;
    if (isChatDeletedForUser(c, currentUser)) return false;

    // Filtrar chats técnicos, corruptos o generados accidentalmente con nombres extraños (ej: 'de', '?', 'Grupo <UUID>', 'Test Chat')
    const titleLow = String(c.title || c.name || '').toLowerCase().trim();
    if (
      !titleLow ||
      titleLow === '?' ||
      titleLow === 'de' ||
      /^(test\s*chat|chat\s*test|test\s*probe|probe)/i.test(titleLow) ||
      titleLow.includes('test chat') ||
      titleLow.includes('chat test actividad') ||
      /^grupo\s+[0-9a-f]{8}-[0-9a-f]{4}/i.test(titleLow)
    ) {
      return false;
    }

    // Normalizar participantes tolerando strings, objetos y apodos
    const parts: string[] = (c.participants || c.participantIds || [])
      .map((p: any) => {
        if (!p) return '';
        if (typeof p === 'string') return p.toLowerCase().trim();
        return String(p.apodo || p.usuario || p.nombre || p.id || '').toLowerCase().trim();
      })
      .filter(Boolean);

    const creatorTokens: string[] = [
      c.creatorId,
      c.creatorName,
      c.createdBy
    ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

    const isCreator = creatorTokens.some(ct => myTokens.includes(ct));
    const isParticipant = parts.some(p => myTokens.includes(p));

    const sentMessageInChat = Array.isArray(c.messages) && c.messages.some((m: any) => {
      const sId = String(m?.senderId || m?.sender_id || '').toLowerCase().trim();
      const sName = String(m?.sender || m?.autor || '').toLowerCase().trim();
      return (sId && myTokens.includes(sId)) || (sName && myTokens.includes(sName));
    });

    // 1. CHATS PRIVADOS DIRECTOS
    if (c.type === 'privado') {
      const titleClean = String(c.title || c.name || '').toLowerCase().trim();
      const destClean = String(c.destinatario || '').toLowerCase().trim();
      const titleParts = titleClean.split(/[&,y\/-]/).map(s => s.trim()).filter(Boolean);
      const isTargetRecipient = (titleClean && myTokens.includes(titleClean)) ||
        (destClean && myTokens.includes(destClean)) ||
        titleParts.some(tp => myTokens.includes(tp)) ||
        myTokens.some(tok => tok.length > 2 && (titleClean.includes(tok) || destClean.includes(tok)));

      const isMentionedInPrivateNotice = Array.isArray(c.messages) && c.messages.some((m: any) => {
        const txt = String(m?.text || '').toLowerCase();
        return myTokens.some(tok => tok.length > 2 && txt.includes(tok));
      });

      // Regla de seguridad: Solo visible si el usuario actual está directamente involucrado
      const isDirectlyInvolved = isCreator || isParticipant || sentMessageInChat || isTargetRecipient || isMentionedInPrivateNotice;
      if (!isDirectlyInvolved) {
        return false; // NO mostrar chats privados de terceros aunque participants esté vacío en la BD
      }

      // Regla anti-auto-chat: No mostrar chats privados consigo mismo
      const resolvedTitle = getPrivateChatResolvedTitle(c, currentUser);
      if (myTokens.includes(resolvedTitle.toLowerCase().trim())) {
        const otherParticipants = parts.filter(p => !myTokens.includes(p));
        const otherSenders = (c.messages || []).filter((m: any) => {
          const sName = String(m?.sender || '').toLowerCase().trim();
          const sId = String(m?.senderId || m?.sender_id || '').toLowerCase().trim();
          return (sName && !myTokens.includes(sName)) || (sId && !myTokens.includes(sId));
        });
        if (otherParticipants.length === 0 && otherSenders.length === 0) {
          return false;
        }
      }

      return true;
    }

    // 2. CHATS GRUPALES
    // REGLA ESTRICTA: Los usuarios con perfil administrador NO pueden formar parte de ningún grupo.
    if (isAdministratorUser(currentUser)) {
      return false;
    }

    // Vincular actividad asociada al chat si existe (soportando prefijos como 'Grupo: ')
    const cleanActTitle = (str?: string) => String(str || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
    const cClean = cleanActTitle(c.title || c.name);
    const relAct = (activities || []).find((a: any) => {
      const aClean = cleanActTitle(a.title || a.titulo);
      return (
        (c.activityId && (String(a.id) === String(c.activityId) || Number(a.id) === Number(c.activityId))) ||
        (c.id && (String(a.id) === String(c.id) || Number(a.id) === Number(c.id))) ||
        (aClean && cClean && aClean === cClean)
      );
    });

    // REGLA CRÍTICA: Si el chat está asociado a una actividad (propuesta vecinal), SOLO debe aparecer si fue APROBADA y NO cancelada
    if (relAct && (!isActivityApproved(relAct) || isActCancelled(relAct))) {
      return false;
    }
    if (c.activityId) {
      const actById = (activities || []).find((a: any) => String(a.id) === String(c.activityId) || Number(a.id) === Number(c.activityId));
      if (actById && (!isActivityApproved(actById) || isActCancelled(actById))) {
        return false;
      }
    }

    const allOrgTokens = [
      ...creatorTokens,
      c.organizer,
      c.organizerId,
      c.creatorName,
      c.creatorId,
      relAct?.organizer,
      relAct?.organizerId,
      relAct?.organizerName,
      relAct?.organizador,
      relAct?.organizador_id,
      relAct?.creador,
      relAct?.creador_id,
      relAct?.userId,
      ...(Array.isArray(c.adminUsernames) ? c.adminUsernames : [])
    ]
      .filter(Boolean)
      .map((t: any) => String(t).toLowerCase().trim());

    const isGroupOrg = allOrgTokens.some(ct => myTokens.includes(ct));
    const isAuthorizedLeader = isGroupOrg;

    const hasLeftVoluntarily = isUserLeftVoluntarilyFromChat(c, currentUser);
    const hasBeenRemoved = isUserRemovedFromChat(c, currentUser) || isUserVetoedFromChat(c, currentUser);
    const wasParticipant = hasLeftVoluntarily || hasBeenRemoved;

    const hasExplicitEnrollmentList =
      Array.isArray(relAct?.enrolledUsernames) ||
      Array.isArray(relAct?.inscriptos) ||
      Array.isArray((relAct as any)?.enrolled_usernames);

    const actEnrolled = Array.isArray(relAct?.enrolledUsernames)
      ? relAct.enrolledUsernames
      : Array.isArray(relAct?.inscriptos)
        ? relAct.inscriptos
        : (Array.isArray((relAct as any)?.enrolled_usernames) ? (relAct as any).enrolled_usernames : []);

    const isEnrolledInChatActivity = actEnrolled.some((u: any) => {
      const val = typeof u === 'object' ? (u.usuario || u.apodo || u.nombre || u.id) : String(u || '');
      return myTokens.includes(String(val).toLowerCase().trim());
    });

    if (relAct) {
      if (hasExplicitEnrollmentList) {
        return isAuthorizedLeader || isEnrolledInChatActivity || wasParticipant;
      }
      return isAuthorizedLeader || isParticipant || isEnrolledInChatActivity || sentMessageInChat || wasParticipant;
    }

    // Grupos libres / vecinales: verificar también si el usuario fue invitado o figura en los mensajes de bienvenida del sistema
    const isMentionedInMessages = Array.isArray(c.messages) && c.messages.some((m: any) => {
      const rtParts = m?.replyTo?.participants || m?.reply_to?.participants;
      if (Array.isArray(rtParts) && rtParts.some((p: any) => myTokens.includes(String(p).toLowerCase().trim()))) {
        return true;
      }
      const txt = String(m?.text || '').toLowerCase();
      return myTokens.some(tok => tok.length > 2 && txt.includes(tok));
    });

    // Regla anti-auto-grupo: no mostrar grupos libres donde el único participante es el propio usuario sin interacción de terceros
    const nonSelfParts = parts.filter(p => !myTokens.includes(p));
    const hasOtherSenders = Array.isArray(c.messages) && c.messages.some((m: any) => {
      const sId = String(m?.senderId || m?.sender_id || '').toLowerCase().trim();
      const sName = String(m?.sender || m?.autor || '').toLowerCase().trim();
      return (sId && !myTokens.includes(sId)) || (sName && !myTokens.includes(sName));
    });
    if (!wasParticipant && nonSelfParts.length === 0 && !hasOtherSenders && parts.length > 0) {
      return false;
    }

    return isAuthorizedLeader || isParticipant || sentMessageInChat || wasParticipant || isMentionedInMessages || parts.length === 0;
  });

  // Deduplicar antes de ordenar para evitar que dos chats del mismo grupo aparezcan duplicados
  const dedupedVisible = deduplicateChats(visible);
  return dedupedVisible.sort((a, b) => getChatLastActivityTime(b) - getChatLastActivityTime(a));
}

export type SupabaseChatType = 'grupo_actividad' | 'grupo_libre' | 'privado';

/**
 * Normaliza y mapea el tipo de chat al enum 'chat_type' de Supabase ('grupo_actividad', 'grupo_libre', 'privado')
 * evitando el error: invalid input value for enum chat_type: "grupal"
 */
export function mapToSupabaseChatType(
  type?: string | null,
  options?: { isActivity?: boolean; activityId?: string | number | null }
): SupabaseChatType {
  const isAct = Boolean(options?.isActivity || options?.activityId);
  if (!type) {
    return isAct ? 'grupo_actividad' : 'grupo_libre';
  }
  const clean = String(type).toLowerCase().trim();
  if (clean === 'privado' || clean === 'private' || clean === 'direct' || clean === 'directo') {
    return 'privado';
  }
  if (clean === 'grupo_actividad' || isAct || clean.includes('actividad')) {
    return 'grupo_actividad';
  }
  if (clean === 'grupo_libre' || clean === 'grupal' || clean === 'group' || clean === 'grupo') {
    return isAct ? 'grupo_actividad' : 'grupo_libre';
  }
  return isAct ? 'grupo_actividad' : 'grupo_libre';
}

/**
 * Convierte el tipo de chat recibido de Supabase ('grupo_actividad', 'grupo_libre', 'privado')
 * al tipo esperado por la interfaz del frontend ('grupal' | 'privado')
 */
export function mapFromSupabaseChatType(tipo?: string | null): 'grupal' | 'privado' {
  if (!tipo) return 'grupal';
  const clean = String(tipo).toLowerCase().trim();
  if (clean === 'privado' || clean === 'private' || clean === 'direct' || clean === 'directo') {
    return 'privado';
  }
  return 'grupal';
}

/**
 * Detects if two messages represent the same message (e.g. optimistic UI message vs server/realtime message).
 */
export function isDuplicateMessage(m1: any, m2: any): boolean {
  if (!m1 || !m2) return false;
  if (m1.id && m2.id && String(m1.id) === String(m2.id)) return true;

  const isRetiredMsg = (m: any) => {
    const txt = String(m?.text || m?.texto || '').toLowerCase();
    return Boolean(
      m?.isDeleted ||
      m?.retirado ||
      m?.eliminado ||
      m?.deletedByAdmin ||
      m?.deletedByGroupModerator ||
      m?.is_deleted ||
      m?.deleted_by_admin ||
      m?.deleted_by_group_moderator ||
      txt.includes('este mensaje fue retirado')
    );
  };

  if (m1.id && m2.id && String(m1.id) !== String(m2.id) && (isRetiredMsg(m1) || isRetiredMsg(m2))) {
    return false;
  }

  const t1 = String(m1.text || '').trim();
  const t2 = String(m2.text || '').trim();
  if (!t1 || t1 !== t2) return false;

  const isSys1 = m1.senderId === 'sistema' || m1.role === 'sistema' || String(m1.sender || '').toLowerCase().includes('sistema club65') || String(m1.id || '').startsWith('sys_') || String(m1.id || '').startsWith('msg_init_') || String(m1.id || '').startsWith('m_init_');
  const isSys2 = m2.senderId === 'sistema' || m2.role === 'sistema' || String(m2.sender || '').toLowerCase().includes('sistema club65') || String(m2.id || '').startsWith('sys_') || String(m2.id || '').startsWith('msg_init_') || String(m2.id || '').startsWith('m_init_');

  if (isSys1 || isSys2) {
    const time1 = m1.timestamp || (m1.createdAt ? new Date(m1.createdAt).getTime() : (m1.created_at ? new Date(m1.created_at).getTime() : 0));
    const time2 = m2.timestamp || (m2.createdAt ? new Date(m2.createdAt).getTime() : (m2.created_at ? new Date(m2.created_at).getTime() : 0));

    // If both have explicit timestamps, treat as duplicate if within 60 seconds
    if (time1 > 0 && time2 > 0) {
      return Math.abs(time1 - time2) < 60000;
    }

    // If reply_to/replyTo events indicate the same moderation event (e.g., participant_added)
    const rt1 = typeof m1.replyTo === 'object' ? m1.replyTo : (typeof m1.reply_to === 'object' ? m1.reply_to : null);
    const rt2 = typeof m2.replyTo === 'object' ? m2.replyTo : (typeof m2.reply_to === 'object' ? m2.reply_to : null);
    if (rt1?.event && rt2?.event && rt1.event === rt2.event) {
      const p1 = String(rt1.participant || '').toLowerCase().trim();
      const p2 = String(rt2.participant || '').toLowerCase().trim();
      if (!p1 || !p2 || p1 === p2) return true;
    }

    // Default for identical system text when timestamps are absent or generic ('Ahora', 'Recién')
    return true;
  }

  const id1 = String(m1.senderId || m1.userId || '').trim().toLowerCase();
  const id2 = String(m2.senderId || m2.userId || '').trim().toLowerCase();
  const sameSenderId = Boolean(id1 && id2 && id1 === id2);

  const name1 = String(m1.sender || m1.autor || m1.author || '').trim().toLowerCase();
  const name2 = String(m2.sender || m2.autor || m2.author || '').trim().toLowerCase();
  const sameSenderName = Boolean(name1 && name2 && (name1 === name2 || name1.includes(name2) || name2.includes(name1)));

  // If text matches and sender matches by ID, Name, or context:
  if (sameSenderId || sameSenderName || (!id1 && !id2 && !name1 && !name2)) {
    const time1 = m1.timestamp || (m1.createdAt ? new Date(m1.createdAt).getTime() : (m1.created_at ? new Date(m1.created_at).getTime() : 0));
    const time2 = m2.timestamp || (m2.createdAt ? new Date(m2.createdAt).getTime() : (m2.created_at ? new Date(m2.created_at).getTime() : 0));

    // If both timestamps are present, check if within 60 seconds
    if (time1 > 0 && time2 > 0) {
      return Math.abs(time1 - time2) < 60000;
    }

    // If times match as strings or indicate recent post
    if (m1.time && m2.time) {
      if (
        m1.time === m2.time ||
        m1.time === 'Ahora' || m2.time === 'Ahora' ||
        m1.time === 'Recién' || m2.time === 'Recién'
      ) {
        return true;
      }
    }
    return true;
  }

  return false;
}

/**
 * Deduplicates an array of messages, preserving order and upgrading optimistic messages with server metadata.
 */
export function deduplicateMessages(messages: any[]): any[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const result: any[] = [];

  const isSyntheticWelcome = (m: any) => {
    if (!m) return false;
    const id = String(m.id || '');
    const text = String(m.text || '').toLowerCase();
    return (id.startsWith('m_init_') || (m.senderId === 'sistema' && text.includes('bienvenidos')));
  };

  const hasRealUserMessages = messages.some(m => m && m.senderId !== 'sistema' && m.sender !== 'Sistema CLUB65');

  for (const msg of messages) {
    if (!msg) continue;
    // If chat already has real messages, do not re-insert synthetic welcome banners that have no explicit DB timestamp
    if (hasRealUserMessages && isSyntheticWelcome(msg) && !msg.createdAt && !msg.created_at) {
      continue;
    }
    const existingIndex = result.findIndex(m => isDuplicateMessage(m, msg));
    const parseReply = (obj: any) => {
      let r = obj?.replyTo || obj?.reply_to;
      if (typeof r === 'string') {
        try { r = JSON.parse(r); } catch {}
      }
      if (r && typeof r === 'object' && !r.is_group_init && Boolean(r.text || r.sender || r.id)) {
        return {
          id: String(r.id || ''),
          sender: String(r.sender || ''),
          text: String(r.text || '')
        };
      }
      return undefined;
    };

    if (existingIndex === -1) {
      const parsedR = parseReply(msg);
      result.push(parsedR ? { ...msg, replyTo: parsedR } : msg);
    } else {
      // Reconcile: merge data, prefer more authoritative ID and server timestamps while strictly preserving replyTo & deletion state
      const existing = result[existingIndex];
      const parsedR = parseReply(msg) || parseReply(existing);
      const mergedIsDeleted = Boolean(
        existing.isDeleted || existing.retirado || existing.eliminado || existing.is_deleted ||
        msg.isDeleted || msg.retirado || msg.eliminado || msg.is_deleted
      );
      const eitherDeletedByAdmin = Boolean(
        existing.deletedByAdmin || existing.deleted_by_admin ||
        msg.deletedByAdmin || msg.deleted_by_admin ||
        String(existing.text || '').toLowerCase().includes('condiciones de uso') ||
        String(msg.text || '').toLowerCase().includes('condiciones de uso')
      );
      const mergedDeletedByMod = mergedIsDeleted && !eitherDeletedByAdmin && Boolean(
        existing.deletedByGroupModerator || existing.deleted_by_group_moderator ||
        msg.deletedByGroupModerator || msg.deleted_by_group_moderator
      );
      result[existingIndex] = {
        ...existing,
        ...msg,
        id: msg.id || existing.id,
        ...(mergedIsDeleted ? {
          isDeleted: true,
          retirado: true,
          isPinned: false,
          deletedByAdmin: eitherDeletedByAdmin,
          deletedByGroupModerator: mergedDeletedByMod,
          text: eitherDeletedByAdmin
            ? 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65'
            : (mergedDeletedByMod ? 'Este mensaje fue retirado por el moderador del grupo.' : (msg.text || existing.text))
        } : {}),
        replyTo: parsedR || existing.replyTo || undefined
      };
    }
  }

  // Ensure any initial welcome banner stays at the very beginning (top), never after user messages
  const welcomes: any[] = [];
  const regular: any[] = [];
  for (const m of result) {
    if (isSyntheticWelcome(m)) {
      welcomes.push(m);
    } else {
      regular.push(m);
    }
  }

  // Sort regular messages chronologically
  regular.sort((a, b) => {
    const tA = a.timestamp || (a.createdAt ? new Date(a.createdAt).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0));
    const tB = b.timestamp || (b.createdAt ? new Date(b.createdAt).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0));
    return tA - tB;
  });

  // Second pass: remove adjacent consecutive duplicate system notices
  const cleanRegular: any[] = [];
  for (let i = 0; i < regular.length; i++) {
    const cur = regular[i];
    const isCurSys = cur.senderId === 'sistema' || cur.role === 'sistema' || String(cur.sender || '').toLowerCase().includes('sistema club65') || String(cur.id || '').startsWith('sys_') || String(cur.id || '').startsWith('msg_init_') || String(cur.id || '').startsWith('m_init_');
    if (isCurSys && cleanRegular.length > 0) {
      const prev = cleanRegular[cleanRegular.length - 1];
      const isPrevSys = prev.senderId === 'sistema' || prev.role === 'sistema' || String(prev.sender || '').toLowerCase().includes('sistema club65') || String(prev.id || '').startsWith('sys_') || String(prev.id || '').startsWith('msg_init_') || String(prev.id || '').startsWith('m_init_');
      if (isPrevSys && String(cur.text || '').trim() === String(prev.text || '').trim()) {
        continue; // skip duplicate adjacent system notification
      }
    }
    cleanRegular.push(cur);
  }

  if (cleanRegular.length > 0) {
    // If there are real messages, keep at most 1 welcome banner at the very beginning, never at the bottom
    return [...(welcomes.slice(0, 1)), ...cleanRegular];
  }

  return cleanRegular.length > 0 ? cleanRegular : welcomes;
}

export const cleanGroupTitle = (str?: string) => String(str || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();

/**
 * Deduplicates an array of chats, consolidating duplicate entries for the same group or activity.
 */
export function deduplicateChats(chats: any[]): any[] {
  if (!Array.isArray(chats) || chats.length === 0) return [];
  const result: any[] = [];
  const seenIds = new Set<string>();

  for (const chat of chats) {
    if (!chat) continue;
    const cId = String(chat.id);
    if (seenIds.has(cId)) continue;

    const isAct = Boolean(chat.activityId);
    const chatTitleClean = cleanGroupTitle(chat.title || chat.name);
    const isGroup = chat.type === 'grupal' || chat.tipo === 'grupo_actividad' || chat.tipo === 'grupo_libre' || isAct;

    const existingIndex = result.findIndex(existing => {
      if (String(existing.id) === cId) return true;

      // 1. Match by activityId if both have it
      if (existing.activityId && chat.activityId && String(existing.activityId) === String(chat.activityId)) {
        return true;
      }

      // 2. Match if one chat's id is equal to the other's activityId (e.g. synthetic local chat using act.id)
      if (existing.activityId && String(existing.activityId) === cId) return true;
      if (chat.activityId && String(chat.activityId) === String(existing.id)) return true;

      // 3. Match group chats by normalized title (ignoring 'Grupo: ' prefix)
      const existingIsGroup = existing.type === 'grupal' || existing.tipo === 'grupo_actividad' || existing.tipo === 'grupo_libre' || Boolean(existing.activityId);
      if (isGroup && existingIsGroup) {
        const existingTitleClean = cleanGroupTitle(existing.title || existing.name);
        if (existingTitleClean && chatTitleClean && existingTitleClean === chatTitleClean) {
          const creator1 = String(existing.creatorId || existing.creatorName || '').trim().toLowerCase();
          const creator2 = String(chat.creatorId || chat.creatorName || '').trim().toLowerCase();
          // If neither has creator or one/both match or it's an activity group
          if (!creator1 || !creator2 || creator1 === creator2 || isAct || existing.activityId) {
            return true;
          }
        }
      }

      // 4. Match private chats between the same participants
      if (existing.type === 'privado' && chat.type === 'privado') {
        const p1 = (existing.participantIds || []).map(String).sort().join(',');
        const p2 = (chat.participantIds || []).map(String).sort().join(',');
        if (p1 && p2 && p1 === p2) return true;
      }

      return false;
    });

    if (existingIndex === -1) {
      const msgs = deduplicateMessages(chat.messages || []);
      const pinnedFromMsgs = getPinnedMessageFromList(msgs, chat.pinnedMessageId);
      const resolvedPinnedId = pinnedFromMsgs
        ? String(pinnedFromMsgs.id)
        : (chat.pinnedMessageId && !msgs.some((m: any) => String(m?.id) === String(chat.pinnedMessageId))
            ? String(chat.pinnedMessageId)
            : undefined);
      result.push({ ...chat, pinnedMessageId: resolvedPinnedId, messages: msgs });
      seenIds.add(cId);
    } else {
      // Merge with existing
      const existing = result[existingIndex];
      // Prefer UUID over numeric id
      const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id).trim());
      const chosenId = isValidUUID(String(chat.id)) ? chat.id : existing.id;
      const chosenActivityId = chat.activityId || existing.activityId || undefined;
      const mergedMsgs = deduplicateMessages([...(existing.messages || []), ...(chat.messages || [])]);
      const lastMsg = mergedMsgs[mergedMsgs.length - 1];

      const pinnedFromMerged = getPinnedMessageFromList(mergedMsgs);
      const candidatePinnedId = chat.pinnedMessageId !== undefined ? chat.pinnedMessageId : existing.pinnedMessageId;
      let resolvedPinnedId: string | undefined = pinnedFromMerged ? String(pinnedFromMerged.id) : undefined;
      if (!resolvedPinnedId && candidatePinnedId) {
        const matchedInMsgs = mergedMsgs.find((m: any) => String(m?.id) === String(candidatePinnedId));
        if (!matchedInMsgs) {
          resolvedPinnedId = String(candidatePinnedId);
        }
      }

      // Standardize title without adding a "Grupo: " prefix
      const rawTitle = chat.title || existing.title || chat.name || existing.name || '';
      const titleWithoutPrefix = [chat.title, existing.title, chat.name, existing.name].find(
        t => Boolean(String(t || '').trim()) && !/^grupo:\s*/i.test(String(t || '').trim())
      );
      const displayTitle = titleWithoutPrefix
        ? String(titleWithoutPrefix).trim()
        : (chosenActivityId || chat.type === 'grupal' || existing.type === 'grupal'
          ? rawTitle.replace(/^grupo:\s*/i, '').trim() || rawTitle
          : rawTitle);

      result[existingIndex] = {
        ...existing,
        ...chat,
        id: chosenId,
        title: displayTitle,
        name: displayTitle,
        activityId: chosenActivityId,
        pinnedMessageId: resolvedPinnedId,
        messages: mergedMsgs,
        participants: Array.from(new Set([...(existing.participants || []), ...(chat.participants || [])])),
        participantIds: Array.from(new Set([...(existing.participantIds || []), ...(chat.participantIds || [])])),
        adminUsernames: Array.from(new Set([...(existing.adminUsernames || []), ...(chat.adminUsernames || [])])),
        lastMessage: lastMsg?.text || chat.lastMessage || existing.lastMessage,
        lastMessageTime: lastMsg?.time || chat.lastMessageTime || existing.lastMessageTime
      };
      seenIds.add(cId);
      seenIds.add(String(chosenId));
    }
  }

  return result;
}

/**
 * Resolves the active non-deleted pinned message from a list of messages and optional pinnedMessageId.
 */
export function getPinnedMessageFromList(messages?: any[], pinnedMessageId?: string | null): any | null {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const isValidPinned = (m: any) =>
    Boolean(m) &&
    !m.isDeleted &&
    !m.retirado &&
    !m.deletedByAdmin &&
    !m.deletedByGroupModerator;

  const byFlag = messages.find(m => isValidPinned(m) && Boolean(m.isPinned ?? m.is_pinned));
  if (byFlag) return byFlag;

  if (pinnedMessageId) {
    const byId = messages.find(m => isValidPinned(m) && String(m.id) === String(pinnedMessageId));
    if (byId) return byId;
  }

  return null;
}

/**
 * Resolves a human-friendly display name for a message sender,
 * completely preventing technical identifiers (usr_..., UUIDs, c_...) from showing to users.
 */
export function resolveSenderDisplayName(
  senderRaw?: string | null,
  senderId?: string | null,
  usersMap?: Record<string, any>,
  defaultFallback = 'Vecino'
): string {
  const sRaw = String(senderRaw || '').trim();
  const sId = String(senderId || '').trim();

  // 1. Try to find user in usersMap by id, raw sender, or lowercase
  if (usersMap) {
    const candidateKeys = [sId, sRaw, sId.toLowerCase(), sRaw.toLowerCase()].filter(Boolean);
    for (const key of candidateKeys) {
      if (usersMap[key]) {
        const u = usersMap[key];
        const resolved = u.apodo || u.usuario || u.nombre || u.nombreCompleto;
        if (resolved && !isTechnicalIdentifier(resolved) && !resolved.startsWith('usr_')) {
          return resolved;
        }
      }
    }

    // Also search object values if direct key lookup missed
    const lowerId = sId.toLowerCase();
    const lowerRaw = sRaw.toLowerCase();
    const foundUser = Object.values(usersMap).find((u: any) => {
      if (!u) return false;
      const uId = String(u.id || '').toLowerCase();
      const uUsuario = String(u.usuario || '').toLowerCase();
      const uApodo = String(u.apodo || '').toLowerCase();
      return (lowerId && (uId === lowerId || uUsuario === lowerId || uApodo === lowerId)) ||
             (lowerRaw && (uId === lowerRaw || uUsuario === lowerRaw || uApodo === lowerRaw));
    });

    if (foundUser) {
      const resolved = foundUser.apodo || foundUser.usuario || foundUser.nombre;
      if (resolved && !isTechnicalIdentifier(resolved) && !resolved.startsWith('usr_')) {
        return resolved;
      }
    }
  }

  // 2. If senderRaw is a technical identifier or starts with usr_ / c_ / uuid, NEVER return it
  if (!sRaw || isTechnicalIdentifier(sRaw) || sRaw.startsWith('usr_') || sRaw.startsWith('c_') || sRaw.startsWith('user_')) {
    return defaultFallback;
  }

  return sRaw;
}

/**
 * Evaluates whether an explicit participant has active designated group moderator rights.
 * Deterministic chronological rule:
 * An active designated admin must have a designation event (make_admin) that occurred strictly
 * AFTER their last removal/exit (participant_removed, user_left) and strictly AFTER their last addition (participant_added).
 * If a moderator is removed and later re-added, they rejoin as a regular member (NOT moderator).
 */
export function isParticipantActiveDesignatedAdmin(
  chat: any,
  candTokens: string[],
  allUsersMap: Record<string, any> = {}
): boolean {
  if (!chat || !candTokens || candTokens.length === 0) return false;

  const normTokens = new Set<string>();
  candTokens.forEach(t => {
    if (t) {
      const s = String(t).toLowerCase().trim();
      if (s && !isDummyOrSystemParticipant(s)) {
        normTokens.add(s);
      }
    }
  });

  // Expand with allUsersMap
  for (const t of Array.from(normTokens)) {
    const u = allUsersMap[t] || Object.values(allUsersMap).find((x: any) =>
      x && (
        (x.id && String(x.id).toLowerCase().trim() === t) ||
        (x.usuario && String(x.usuario).toLowerCase().trim() === t) ||
        (x.apodo && String(x.apodo).toLowerCase().trim() === t) ||
        (x.nombre && String(x.nombre).toLowerCase().trim() === t)
      )
    );
    if (u) {
      [u.id, u.usuario, u.apodo, u.nombre, (u as any).supabaseId].filter(Boolean).forEach((x: any) => {
        const s = String(x).toLowerCase().trim();
        if (s && !isDummyOrSystemParticipant(s)) normTokens.add(s);
      });
    }
  }

  const tokenList = Array.from(normTokens);
  if (tokenList.length === 0) return false;

  let tMakeAdmin = 0;
  let tRemoved = 0;
  let tAdded = 0;

  // Check initial adminUsernames list (baseline designation at t=1)
  const initialAdmins = [
    ...(Array.isArray(chat.adminUsernames) ? chat.adminUsernames : []),
    ...(Array.isArray(chat.admin_usernames) ? chat.admin_usernames : []),
    ...(Array.isArray(chat.moderators) ? chat.moderators : []),
    ...(Array.isArray(chat.moderadores) ? chat.moderadores : [])
  ].map((a: any) => String(a || '').toLowerCase().trim());

  if (initialAdmins.some(a => normTokens.has(a))) {
    tMakeAdmin = 1;
  }

  // Check removedParticipants and leftVoluntarilyParticipants
  const removedList = [
    ...(chat.removedParticipants || []),
    ...(chat.removed_participants || []),
    ...(chat.leftVoluntarilyParticipants || []),
    ...(chat.left_voluntarily_participants || [])
  ].map((r: any) => String(r || '').toLowerCase().trim());

  if (removedList.some(r => normTokens.has(r))) {
    tRemoved = Math.max(tRemoved, 2);
  }

  const msgs = Array.isArray(chat.messages) ? chat.messages : [];
  msgs.forEach((m: any, idx: number) => {
    if (!m) return;
    const msgTime = (m.timestamp || (m.createdAt ? new Date(m.createdAt).getTime() : (m.created_at ? new Date(m.created_at).getTime() : 0))) || (idx + 10);

    let rt = m.replyTo || m.reply_to;
    if (typeof rt === 'string') {
      try { rt = JSON.parse(rt); } catch {}
    }

    const eventTokens = new Set<string>();
    if (rt && typeof rt === 'object') {
      [rt.participant, rt.participantId, rt.userId, ...(Array.isArray(rt.participantTokens) ? rt.participantTokens : [])]
        .filter(Boolean)
        .forEach((x: any) => eventTokens.add(String(x).toLowerCase().trim()));
    }

    const textClean = String(m.text || '').toLowerCase().trim();
    const matchesUser = tokenList.some(tok => {
      if (eventTokens.has(tok)) return true;
      if (tok.length > 2 && textClean.includes(tok)) return true;
      return false;
    });

    if (rt && typeof rt === 'object' && rt.is_group_init && Array.isArray(rt.adminUsernames)) {
      if (rt.adminUsernames.some((a: string) => normTokens.has(String(a).toLowerCase().trim()))) {
        tMakeAdmin = Math.max(tMakeAdmin, msgTime);
      }
    }

    if (matchesUser) {
      const isMakeAdmin = rt?.action === 'make_admin' || /fue designado\/a moderador\/a/i.test(textClean);
      if (isMakeAdmin) {
        tMakeAdmin = Math.max(tMakeAdmin, msgTime);
      }

      const isRemoval = rt?.event === 'participant_removed' || rt?.event === 'user_left' ||
        /fue retirad[oa] del grupo/i.test(textClean) || /(?:salió|abandonó)\s+del grupo/i.test(textClean);
      if (isRemoval) {
        tRemoved = Math.max(tRemoved, msgTime);
      }

      const isAdd = rt?.event === 'participant_added' ||
        /fue agregad[oa] al grupo/i.test(textClean) ||
        /¡Bienvenido a/i.test(textClean) ||
        /se unió a la actividad/i.test(textClean);
      if (isAdd) {
        tAdded = Math.max(tAdded, msgTime);
      }
    }
  });

  return tMakeAdmin > 0 && tMakeAdmin > tRemoved && tMakeAdmin > tAdded;
}

/**
 * Determines whether a user has group moderator privileges for a specific chat.
 * Checks global administrators, chat creator, linked activity organizer, and designated adminUsernames.
 * A designated moderator who was removed or left and later added back returns as a regular participant (NOT moderator).
 */
export function isUserGroupModerator(
  chat: any,
  user: any,
  activities?: any[]
): boolean {
  if (!chat || !user) return false;

  // Global platform administrators
  const userTipo = String(user.tipo || user.rol || '').toLowerCase().trim();
  if (userTipo === 'moderador' || userTipo === 'admin' || userTipo === 'administrador') {
    return true;
  }

  // Tokens of the user being tested
  const uAny = user as any;
  const userTokens = [
    user.id,
    user.usuario,
    user.apodo,
    user.nombre,
    uAny.username,
    uAny.name,
    uAny.institucion,
    uAny.supabaseId
  ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

  if (userTokens.length === 0) return false;

  // If user has left or was removed from this group, they have NO moderator rights in it
  if (isUserRemovedFromChat(chat, user) || isUserLeftVoluntarilyFromChat(chat, user)) {
    return false;
  }

  // Chat creator or organizer
  const chatCreatorTokens = [
    chat.creatorId,
    chat.creador_id,
    chat.organizerId,
    chat.organizador_id,
    chat.creatorName,
    chat.organizer,
    chat.creador,
    chat.createdBy
  ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

  if (Array.isArray(chat.messages)) {
    for (const m of chat.messages) {
      let rt = m?.replyTo || m?.reply_to;
      if (typeof rt === 'string') {
        try { rt = JSON.parse(rt); } catch {}
      }
      if (rt && typeof rt === 'object') {
        if (rt.creatorId) chatCreatorTokens.push(String(rt.creatorId).toLowerCase().trim());
        if (rt.creatorName) chatCreatorTokens.push(String(rt.creatorName).toLowerCase().trim());
        if (rt.creator) chatCreatorTokens.push(String(rt.creator).toLowerCase().trim());
      }
    }
  }

  if (chatCreatorTokens.some(ct => userTokens.includes(ct))) {
    return true;
  }

  // Linked activity creator / organizer
  const actId = chat.activityId || chat.actividad_id;
  if (actId && Array.isArray(activities) && activities.length > 0) {
    const actIdStr = String(actId);
    const act = activities.find((a: any) => 
      String(a.id) === actIdStr || 
      (a.title && chat.title && a.title.trim().toLowerCase() === chat.title.trim().toLowerCase())
    );
    if (act) {
      const actOrgTokens = [
        act.organizerId,
        act.organizer_id,
        act.creador_id,
        act.userId,
        act.organizer,
        act.organizador,
        act.creador,
        act.organizerNombre,
        act.organizerName
      ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

      if (actOrgTokens.some(ot => userTokens.includes(ot))) {
        return true;
      }
    }
  }

  // Check active designated admin with strict chronological timeline
  if (isParticipantActiveDesignatedAdmin(chat, userTokens)) {
    return true;
  }

  // Local storage fallback for group creator
  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('club65_custom_chats');
      if (stored) {
        const list = JSON.parse(stored);
        const matchLocal = list.find((c: any) => String(c.id) === String(chat.id) || (chat.title && c.title === chat.title));
        if (matchLocal) {
          const localTokens = [matchLocal.creatorId, matchLocal.creatorName, matchLocal.createdBy].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());
          if (localTokens.some((tok: string) => userTokens.includes(tok))) return true;
        }
      }
    }
  } catch (_) {}

  return false;
}


export const isUserChatModerator = isUserGroupModerator;

/**
 * Determina rigurosamente si un contacto, candidato o participante corresponde
 * al usuario logueado actualmente (uno mismo), verificando tokens dinámicos:
 * ID, usuario, apodo, nombre completo, institución, email, o prefijo en ID de contacto.
 */
export function isSelfUserOrContact(candidate: any, currentUser: any): boolean {
  if (!candidate || !currentUser) return false;

  const uAny = currentUser as any;
  const rawTokens = [
    currentUser.id,
    currentUser.usuario,
    currentUser.apodo,
    currentUser.nombre,
    uAny?.institucion,
    uAny?.nombreInstitucion,
    uAny?.nombreCompleto,
    currentUser.email
  ];

  const myTokens: string[] = rawTokens
    .filter(Boolean)
    .map(t => String(t).replace(/^[!¡@]/, '').trim().toLowerCase())
    .filter(t => t.length > 0);

  if (myTokens.length === 0) return false;

  // Si candidate es string o número (ej: nombre, apodo o identificador)
  if (typeof candidate === 'string' || typeof candidate === 'number') {
    const s = String(candidate).replace(/^[!¡@]/, '').trim().toLowerCase();
    if (!s) return false;
    if (myTokens.includes(s)) return true;
    if (currentUser.id && s.includes(String(currentUser.id).toLowerCase().trim())) {
      return true;
    }
    return false;
  }

  // Si candidate es un objeto (Contact, User, Participant)
  if (typeof candidate === 'object') {
    const candTokens = [
      candidate.id,
      candidate.userId,
      candidate.user_id,
      candidate.nombre,
      candidate.name,
      candidate.usuario,
      candidate.username,
      candidate.apodo,
      candidate.institucion,
      candidate.email
    ]
      .filter(Boolean)
      .map(t => String(t).replace(/^[!¡@]/, '').trim().toLowerCase())
      .filter(t => t.length > 0);

    for (const ct of candTokens) {
      if (myTokens.includes(ct)) return true;
      if (currentUser.id && ct.includes(String(currentUser.id).toLowerCase().trim())) {
        return true;
      }
    }

    // Verificar si el ID del contacto contiene el ID del usuario actual
    const cId = String(candidate.id || '').toLowerCase().trim();
    const myId = String(currentUser.id || '').toLowerCase().trim();
    if (myId && cId.includes(myId)) {
      return true;
    }
  }

  return false;
}

/**
 * Filtra rigurosamente la lista de contactos para excluir siempre al propio usuario,
 * perfiles de prueba/mock, bots y credenciales técnicas.
 */
export function filterContactsForUser<T = any>(contacts: T[], currentUser: any): T[] {
  if (!Array.isArray(contacts)) return [];
  return contacts.filter(c => {
    if (!c) return false;
    if (isHardcodedOrMockProfile(c)) return false;
    if (isSelfUserOrContact(c, currentUser)) return false;
    const name = typeof c === 'string' ? c : (c as any).nombre || (c as any).name || '';
    if (isTechnicalIdentifier(name) || isDummyOrSystemParticipant(name)) return false;
    return true;
  });
}

/**
 * Valida los datos para la creación de un nuevo grupo vecinal:
 * 1. Nombre de grupo obligatorio y no vacío.
 * 2. Debe seleccionarse al menos un participante real diferente al usuario actual.
 * 3. Se descartan bots, identificadores técnicos y el propio usuario creador.
 */
export function validateGroupCreation(
  groupName: string,
  selectedParticipants: string[],
  currentUser: any,
  allUsersMap?: Record<string, any> | null
): { valid: boolean; error?: string; cleanParticipants: string[] } {
  if (isAdministratorUser(currentUser)) {
    return {
      valid: false,
      error: 'Los usuarios administradores no pueden crear ni formar parte de ningún grupo.',
      cleanParticipants: []
    };
  }

  const cleanName = (groupName || '').trim();
  if (!cleanName) {
    return {
      valid: false,
      error: 'Por favor escribí un nombre para el grupo.',
      cleanParticipants: []
    };
  }

  const hasInvitedAdmin = (selectedParticipants || []).some(
    (p) => typeof p === 'string' && p.trim() && isUserAdminByReference(p.trim(), allUsersMap)
  );
  if (hasInvitedAdmin) {
    return {
      valid: false,
      error: 'Los usuarios administradores no pueden formar parte de ningún grupo.',
      cleanParticipants: []
    };
  }

  const cleanInvited = (selectedParticipants || []).filter(p => {
    if (!p || typeof p !== 'string') return false;
    const norm = p.trim();
    if (!norm) return false;
    if (isTechnicalIdentifier(norm) || isDummyOrSystemParticipant(norm)) return false;
    if (isSelfUserOrContact(norm, currentUser)) return false;
    if (isUserAdminByReference(norm, allUsersMap)) return false;
    return true;
  });

  const uniqueInvited = Array.from(new Set(cleanInvited));

  if (uniqueInvited.length === 0) {
    return {
      valid: false,
      error: 'Para crear un grupo debés invitar al menos a otro contacto.',
      cleanParticipants: []
    };
  }

  return {
    valid: true,
    cleanParticipants: uniqueInvited
  };
}

export interface ResolvedChatParticipant {
  canonicalId: string;
  displayName: string;
  username?: string;
  userId?: string;
  isAdmin: boolean;
  isSelf: boolean;
  foto?: string;
  avatar?: string;
}

/**
 * Resolves all real participants of a group chat, activity group, or conversation.
 * Handles deduplication canonically across user IDs, usernames, and nicknames so that
 * assigning a participant as moderator NEVER duplicates their row in moderation or participant lists.
 * Also recovers participants whose reference in storage is a user ID or message sender.
 */
export function getResolvedChatParticipants(
  chat: any,
  currentUser: any,
  allUsersMap: Record<string, any> = {},
  relatedActivity?: any,
  contacts: any[] = []
): ResolvedChatParticipant[] {
  if (!chat) return [];

  const uAny = currentUser as any;
  const myTokens = [
    currentUser?.id,
    currentUser?.usuario,
    currentUser?.nombre,
    currentUser?.apodo,
    currentUser?.email,
    uAny?.institucion,
    uAny?.nombreInstitucion,
    uAny?.nombreCompleto
  ]
    .filter(Boolean)
    .map((t: any) => String(t).toLowerCase().trim());

  const myDisplayName = uAny?.institucion || currentUser?.apodo || currentUser?.nombre || currentUser?.usuario || 'Vos';

  // Tokens of admins / organizers for this chat
  const adminTokensSet = new Set<string>();
  const addAdminToken = (t?: any) => {
    if (!t) return;
    const s = String(typeof t === 'object' ? (t.usuario || t.apodo || t.id || '') : t).trim().toLowerCase();
    if (s && !isDummyOrSystemParticipant(s)) {
      adminTokensSet.add(s);
    }
  };

  (chat.adminUsernames || []).forEach(addAdminToken);
  (chat.admin_usernames || []).forEach(addAdminToken);
  addAdminToken(chat.creatorId);
  addAdminToken(chat.creator_id);
  addAdminToken(chat.creatorName);
  addAdminToken(chat.creator_name);
  addAdminToken(chat.organizerId);
  addAdminToken(chat.organizer);
  if (relatedActivity) {
    addAdminToken(relatedActivity.organizerId);
    addAdminToken(relatedActivity.organizer);
    addAdminToken(relatedActivity.createdBy);
  }

  const isSelfGlobalMod = currentUser?.tipo === 'moderador';
  const isSelfOrganizer = myTokens.some(tok => adminTokensSet.has(tok));

  const isCurrentUserOut = Boolean(
    chat.type === 'grupal' &&
    currentUser &&
    (isUserRemovedFromChat(chat, currentUser) ||
      isUserLeftVoluntarilyFromChat(chat, currentUser) ||
      isUserVetoedFromChat(chat, currentUser))
  );

  if (isCurrentUserOut) {
    const frozenSnapshot = getSnapshotParticipantsForUser(chat, currentUser);
    if (frozenSnapshot.length > 0) {
      const departureAt = getUserChatDepartureTimestamp(chat, currentUser);
      const allChatMsgs = Array.isArray(chat.messages) ? chat.messages : [];

      const snapshotAdminTokens = new Set<string>();
      const addTokenToSet = (targetSet: Set<string>, t?: any) => {
        if (!t) return;
        const s = String(typeof t === 'object' ? (t.usuario || t.apodo || t.id || '') : t).trim().toLowerCase();
        if (s && !isDummyOrSystemParticipant(s)) {
          targetSet.add(s);
          const matchedU = allUsersMap[s] ||
            Object.values(allUsersMap).find((u: any) =>
              u && (
                (u.id && String(u.id).toLowerCase().trim() === s) ||
                (u.usuario && String(u.usuario).toLowerCase().trim() === s) ||
                (u.apodo && String(u.apodo).toLowerCase().trim() === s) ||
                (u.nombre && String(u.nombre).toLowerCase().trim() === s) ||
                (u.email && String(u.email).toLowerCase().trim() === s)
              )
            );
          if (matchedU) {
            [matchedU.id, matchedU.usuario, matchedU.apodo, matchedU.nombre, matchedU.email]
              .filter(Boolean)
              .forEach((x: any) => {
                const xs = String(x).trim().toLowerCase();
                if (xs && !isDummyOrSystemParticipant(xs)) targetSet.add(xs);
              });
          }
        }
      };

      // Always include permanent creator / organizer tokens
      [
        chat.creatorId,
        chat.creator_id,
        chat.creatorName,
        chat.creator_name,
        chat.organizerId,
        chat.organizer,
        relatedActivity?.organizerId,
        relatedActivity?.organizer,
        relatedActivity?.createdBy
      ].forEach(t => addTokenToSet(snapshotAdminTokens, t));

      const preDepartureMakeAdminTokens = new Set<string>();
      const postDepartureMakeAdminTokens = new Set<string>();

      for (const m of allChatMsgs) {
        let rt = m?.replyTo || m?.reply_to;
        if (typeof rt === 'string') {
          try { rt = JSON.parse(rt); } catch { rt = null; }
        }
        const ts = getMessageTimestampMs(m);
        const isPostDeparture = Boolean(departureAt && ts > 0 && ts > departureAt);
        const textClean = String(m?.text || '').toLowerCase().trim();
        const isMakeAdmin = Boolean(
          (rt && typeof rt === 'object' && rt.action === 'make_admin') ||
          /fue designado\/a moderador\/a/i.test(textClean)
        );

        if (rt && typeof rt === 'object') {
          if (!isPostDeparture) {
            if (Array.isArray(rt.adminUsernames)) {
              rt.adminUsernames.forEach((a: any) => addTokenToSet(preDepartureMakeAdminTokens, a));
            }
            if (rt.creatorId) addTokenToSet(snapshotAdminTokens, rt.creatorId);
            if (rt.creatorName) addTokenToSet(snapshotAdminTokens, rt.creatorName);
          }
          if (isMakeAdmin) {
            const dest = isPostDeparture ? postDepartureMakeAdminTokens : preDepartureMakeAdminTokens;
            addTokenToSet(dest, rt.participant);
            addTokenToSet(dest, rt.participantId);
            if (Array.isArray(rt.participantTokens)) {
              rt.participantTokens.forEach((pt: any) => addTokenToSet(dest, pt));
            }
          }
        } else if (isMakeAdmin) {
          const match = String(m?.text || '').replace(/^Sistema CLUB65:\s*/i, '').match(/^(.+?)\s+fue designado\/a moderador\/a/i);
          if (match?.[1]) {
            addTokenToSet(isPostDeparture ? postDepartureMakeAdminTokens : preDepartureMakeAdminTokens, match[1]);
          }
        }
      }

      preDepartureMakeAdminTokens.forEach(t => snapshotAdminTokens.add(t));

      // Include static adminUsernames only when NOT known to have been promoted strictly after departure
      for (const rawAdmin of [...(chat.adminUsernames || []), ...(chat.admin_usernames || [])]) {
        const probe = new Set<string>();
        addTokenToSet(probe, rawAdmin);
        const hasPostOnlyPromotion =
          departureAt > 0 &&
          Array.from(probe).some(t => postDepartureMakeAdminTokens.has(t)) &&
          !Array.from(probe).some(t => preDepartureMakeAdminTokens.has(t));
        if (!hasPostOnlyPromotion) {
          probe.forEach(t => snapshotAdminTokens.add(t));
        }
      }

      const seenSnapKeys = new Set<string>();
      const seenSnapNames = new Set<string>();
      const frozenResolved: ResolvedChatParticipant[] = [];

      for (const cand of frozenSnapshot) {
        if (!cand) continue;
        const norm = String(typeof cand === 'object' ? ((cand as any).usuario || (cand as any).apodo || (cand as any).nombre || (cand as any).id || '') : cand).trim();
        if (!norm) continue;
        const low = norm.toLowerCase();
        if (isDummyOrSystemParticipant(low)) continue;

        const isMe = isSelfUserOrContact(cand, currentUser) || isSelfUserOrContact(norm, currentUser) || myTokens.includes(low);
        let canonicalKey = '';
        let displayName = '';
        let username: string | undefined = undefined;
        let userId: string | undefined = undefined;
        let foto: string | undefined = undefined;
        let matchedUserObj: any = null;

        if (isMe) {
          canonicalKey = '__CURRENT_USER__';
          displayName = myDisplayName;
          username = currentUser?.usuario;
          userId = currentUser?.id;
          foto = currentUser?.avatar || currentUser?.foto;
        } else {
          matchedUserObj = allUsersMap[low] ||
            Object.values(allUsersMap).find((u: any) =>
              u && (
                (u.id && String(u.id).toLowerCase().trim() === low) ||
                (u.usuario && String(u.usuario).toLowerCase().trim() === low) ||
                (u.apodo && String(u.apodo).toLowerCase().trim() === low) ||
                (u.nombre && String(u.nombre).toLowerCase().trim() === low) ||
                (u.email && String(u.email).toLowerCase().trim() === low)
              )
            );

          if (matchedUserObj) {
            canonicalKey = String(matchedUserObj.id || matchedUserObj.usuario || low).toLowerCase();
            displayName = matchedUserObj.apodo || matchedUserObj.nombre || matchedUserObj.usuario || norm;
            username = matchedUserObj.usuario;
            userId = matchedUserObj.id;
            foto = matchedUserObj.avatar || matchedUserObj.foto || matchedUserObj.image || matchedUserObj.photo_url || matchedUserObj.avatar_url;
          } else {
            const matchedContact = contacts.find((c: any) =>
              c && (
                (c.id && String(c.id).toLowerCase().trim() === low) ||
                (c.nombre && String(c.nombre).toLowerCase().trim() === low)
              )
            );
            if (matchedContact) {
              canonicalKey = String(matchedContact.id || matchedContact.nombre || low).toLowerCase();
              displayName = matchedContact.nombre || norm;
              foto = matchedContact.foto || (matchedContact.avatar && (String(matchedContact.avatar).startsWith('data:') || String(matchedContact.avatar).startsWith('http') || String(matchedContact.avatar).startsWith('/')) ? matchedContact.avatar : undefined);
            } else {
              canonicalKey = low;
              displayName = norm;
            }
          }
        }

        const isGroupChatForSnap = chat.type !== 'privado';
        if (isGroupChatForSnap) {
          if (
            (isMe && isAdministratorUser(currentUser)) ||
            isAdministratorUser(matchedUserObj) ||
            isUserAdminByReference(cand, allUsersMap)
          ) {
            continue;
          }
        }

        const dispLow = displayName.toLowerCase().trim();
        if (seenSnapKeys.has(canonicalKey) || seenSnapNames.has(dispLow)) continue;
        seenSnapKeys.add(canonicalKey);
        seenSnapKeys.add(low);
        seenSnapNames.add(dispLow);

        const candTokens = [
          low,
          norm.toLowerCase(),
          dispLow,
          username?.toLowerCase(),
          userId?.toLowerCase(),
          matchedUserObj?.usuario?.toLowerCase(),
          matchedUserObj?.apodo?.toLowerCase(),
          matchedUserObj?.nombre?.toLowerCase(),
          canonicalKey,
          ...(isMe ? myTokens : [])
        ].filter(Boolean) as string[];

        const isAdmin = isMe
          ? Boolean(candTokens.some(t => snapshotAdminTokens.has(t)))
          : Boolean(candTokens.some(t => snapshotAdminTokens.has(t)));

        frozenResolved.push({
          canonicalId: canonicalKey,
          displayName,
          username,
          userId,
          isAdmin,
          isSelf: isMe,
          foto,
          avatar: displayName.slice(0, 2).toUpperCase()
        });
      }

      return frozenResolved.sort((a, b) => {
        if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      });
    }
  }

  // Collect candidate participant entries
  const rawCandidatePool: any[] = [];

  // Creator / Organizer
  if (chat.creatorName) rawCandidatePool.push(chat.creatorName);
  if (chat.creatorId) rawCandidatePool.push(chat.creatorId);
  if (chat.organizer) rawCandidatePool.push(chat.organizer);
  if (chat.organizerId) rawCandidatePool.push(chat.organizerId);
  if (relatedActivity?.organizer) rawCandidatePool.push(relatedActivity.organizer);
  if (relatedActivity?.organizerId) rawCandidatePool.push(relatedActivity.organizerId);

  // Stored participants
  if (Array.isArray(chat.participants)) {
    rawCandidatePool.push(...chat.participants);
  }
  if (Array.isArray(chat.participantIds)) {
    rawCandidatePool.push(...chat.participantIds);
  }
  if (Array.isArray(chat.participant_ids)) {
    rawCandidatePool.push(...chat.participant_ids);
  }

  // Activity enrollment list
  if (Array.isArray(relatedActivity?.enrolledUsernames)) {
    rawCandidatePool.push(...relatedActivity.enrolledUsernames);
  }
  if (Array.isArray(relatedActivity?.inscriptos)) {
    rawCandidatePool.push(...relatedActivity.inscriptos);
  }

  // Designated adminUsernames
  if (Array.isArray(chat.adminUsernames)) {
    rawCandidatePool.push(...chat.adminUsernames);
  }

  // Senders of real messages in the chat
  if (Array.isArray(chat.messages)) {
    chat.messages.forEach((m: any) => {
      const s = String(m?.sender || '').trim();
      const sId = String(m?.senderId || m?.sender_id || '').trim();
      const isSys = m?.role === 'sistema' || s.toLowerCase() === 'sistema club65' || sId === 'sistema';
      if (!isSys) {
        if (s && !isDummyOrSystemParticipant(s)) rawCandidatePool.push(s);
        if (sId && !isDummyOrSystemParticipant(sId)) rawCandidatePool.push(sId);
      }
    });
  }

  // Always ensure self is in the candidate pool if they are an active participant/creator
  if (currentUser) {
    rawCandidatePool.push(myDisplayName);
  }

  const removedTokensSet = new Set<string>();
  const addRemovedToken = (t?: any) => {
    if (!t) return;
    const s = String(typeof t === 'object' ? (t.usuario || t.apodo || t.id || '') : t).trim().toLowerCase();
    if (s && !isDummyOrSystemParticipant(s)) {
      removedTokensSet.add(s);
    }
  };
  (chat.removedParticipants || []).forEach(addRemovedToken);
  (chat.removed_participants || []).forEach(addRemovedToken);
  (chat.vetoedParticipants || []).forEach(addRemovedToken);
  (chat.leftVoluntarilyParticipants || []).forEach(addRemovedToken);
  (chat.left_voluntarily_participants || []).forEach(addRemovedToken);

  if (currentUser && (isUserRemovedFromChat(chat, currentUser) || isUserLeftVoluntarilyFromChat(chat, currentUser))) {
    myTokens.forEach(t => {
      removedTokensSet.add(t);
      adminTokensSet.delete(t);
    });
  }

  // Scan chat messages chronologically for participant removal/addition notices and metadata
  const sortedChatMsgs = [...(Array.isArray(chat.messages) ? chat.messages : [])].sort((a, b) => {
    const tA = a.timestamp || (a.createdAt ? new Date(a.createdAt).getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0));
    const tB = b.timestamp || (b.createdAt ? new Date(b.createdAt).getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0));
    return tA - tB;
  });

  sortedChatMsgs.forEach((m: any) => {
    let rt = m.replyTo || m.reply_to;
    if (typeof rt === 'string') {
      try { rt = JSON.parse(rt); } catch {}
    }

    if (rt && typeof rt === 'object') {
      if (Array.isArray(rt.participants)) {
        rawCandidatePool.push(...rt.participants);
      }
      if (Array.isArray(rt.adminUsernames)) {
        rt.adminUsernames.forEach(addAdminToken);
      }
      if (rt.creatorId) {
        addAdminToken(rt.creatorId);
        rawCandidatePool.push(rt.creatorId);
      }
      if (rt.creatorName) {
        addAdminToken(rt.creatorName);
        rawCandidatePool.push(rt.creatorName);
      }
      if (rt.action === 'make_admin' && (rt.participant || rt.participantId)) {
        addAdminToken(rt.participant);
        addAdminToken(rt.participantId);
      }
    }

    const isSys = m?.role === 'sistema' || m?.senderId === 'sistema';
    if (isSys && m?.text) {
      const isRem = (rt && rt.event === 'participant_removed') || /fue retirad[oa] del grupo/i.test(m.text);
      if (isRem) {
        const matchRem = m.text.match(/^(.+?)\s+fue retirad[oa] del grupo/i);
        const remName = String(rt?.participant || matchRem?.[1] || '').trim();
        if (remName && !isDummyOrSystemParticipant(remName)) {
          const remTokens = [remName.toLowerCase(), rt?.participantId?.toLowerCase(), ...(rt?.participantTokens || []).map((x: any) => String(x).toLowerCase())].filter(Boolean);
          const uObj = allUsersMap[remName.toLowerCase()] || Object.values(allUsersMap).find(u =>
            (u.usuario && u.usuario.toLowerCase() === remName.toLowerCase()) ||
            (u.apodo && u.apodo.toLowerCase() === remName.toLowerCase()) ||
            (u.id && String(u.id).toLowerCase() === remName.toLowerCase())
          );
          if (uObj) {
            if (uObj.id) remTokens.push(String(uObj.id).toLowerCase());
            if (uObj.usuario) remTokens.push(String(uObj.usuario).toLowerCase());
            if (uObj.apodo) remTokens.push(String(uObj.apodo).toLowerCase());
            if (uObj.nombre) remTokens.push(String(uObj.nombre).toLowerCase());
          }
          remTokens.forEach(t => {
            removedTokensSet.add(t);
            adminTokensSet.delete(t);
          });
        }
      }

      const isLeft = (rt && rt.event === 'user_left') || /(?:salió|abandonó)\s+del grupo/i.test(m.text);
      if (isLeft) {
        const matchLeft = m.text.match(/^(.+?)\s+(?:salió|abandonó)\s+del grupo/i);
        const leftName = String(rt?.participant || matchLeft?.[1] || '').trim();
        if (leftName && !isDummyOrSystemParticipant(leftName)) {
          const leftTokens = [
            leftName.toLowerCase(),
            rt?.userId?.toLowerCase(),
            rt?.participantId?.toLowerCase(),
            ...(rt?.participantTokens || []).map((x: any) => String(x).toLowerCase())
          ].filter(Boolean);
          const uObj = allUsersMap[leftName.toLowerCase()] || Object.values(allUsersMap).find(u =>
            (u.usuario && u.usuario.toLowerCase() === leftName.toLowerCase()) ||
            (u.apodo && u.apodo.toLowerCase() === leftName.toLowerCase()) ||
            (u.id && String(u.id).toLowerCase() === leftName.toLowerCase())
          );
          if (uObj) {
            if (uObj.id) leftTokens.push(String(uObj.id).toLowerCase());
            if (uObj.usuario) leftTokens.push(String(uObj.usuario).toLowerCase());
            if (uObj.apodo) leftTokens.push(String(uObj.apodo).toLowerCase());
            if (uObj.nombre) leftTokens.push(String(uObj.nombre).toLowerCase());
          }
          leftTokens.forEach(t => {
            removedTokensSet.add(t);
            adminTokensSet.delete(t);
          });
        }
      }

      const isAdd = (rt && rt.event === 'participant_added') ||
        /fue agregad[oa] al grupo/i.test(m.text) ||
        /¡Bienvenido a/i.test(m.text) ||
        /se unió a la actividad/i.test(m.text);
      if (isAdd) {
        const matchAdd = m.text.match(/^(.+?)\s+fue agregad[oa] al grupo/i) ||
          m.text.match(/^¡Bienvenido a\s+[^,]+,\s*(.+?)[!.]?$/i) ||
          m.text.match(/^¡?(.+?)\s+se unió a la actividad/i);
        const candidateName = String(rt?.participant || matchAdd?.[1] || '').trim();
        if (candidateName && !isDummyOrSystemParticipant(candidateName)) {
          const addTokens = [candidateName.toLowerCase(), rt?.participantId?.toLowerCase(), ...(rt?.participantTokens || []).map((x: any) => String(x).toLowerCase())].filter(Boolean);
          const uObj = allUsersMap[candidateName.toLowerCase()] || Object.values(allUsersMap).find(u =>
            (u.usuario && u.usuario.toLowerCase() === candidateName.toLowerCase()) ||
            (u.apodo && u.apodo.toLowerCase() === candidateName.toLowerCase()) ||
            (u.id && String(u.id).toLowerCase() === candidateName.toLowerCase())
          );
          if (uObj) {
            if (uObj.id) addTokens.push(String(uObj.id).toLowerCase());
            if (uObj.usuario) addTokens.push(String(uObj.usuario).toLowerCase());
            if (uObj.apodo) addTokens.push(String(uObj.apodo).toLowerCase());
            if (uObj.nombre) addTokens.push(String(uObj.nombre).toLowerCase());
          }
          addTokens.forEach(t => {
            removedTokensSet.delete(t);
            // Re-added user is a regular participant, NOT moderator
            adminTokensSet.delete(t);
          });
          rawCandidatePool.push(candidateName);
        }
      }
    }
  });

  const seenCanonicalKeys = new Set<string>();
  const seenDisplayNames = new Set<string>();
  const resolvedList: ResolvedChatParticipant[] = [];

  for (const cand of rawCandidatePool) {
    if (!cand) continue;
    const rawVal = typeof cand === 'object'
      ? (cand.usuario || cand.apodo || cand.nombre || cand.id || '')
      : String(cand || '');
    const norm = String(rawVal).trim();
    if (!norm) continue;
    const low = norm.toLowerCase();
    if (isDummyOrSystemParticipant(low)) continue;

    const isMe = isSelfUserOrContact(cand, currentUser) || isSelfUserOrContact(norm, currentUser) || myTokens.includes(low);

    let canonicalKey = '';
    let displayName = '';
    let username: string | undefined = undefined;
    let userId: string | undefined = undefined;
    let foto: string | undefined = undefined;
    let matchedUserObj: any = null;

    if (isMe) {
      canonicalKey = '__CURRENT_USER__';
      displayName = myDisplayName;
      username = currentUser?.usuario;
      userId = currentUser?.id;
      foto = currentUser?.avatar || currentUser?.foto;
    } else {
      // Lookup in allUsersMap
      matchedUserObj = allUsersMap[low] ||
        Object.values(allUsersMap).find((u: any) =>
          u && (
            (u.id && String(u.id).toLowerCase().trim() === low) ||
            (u.usuario && String(u.usuario).toLowerCase().trim() === low) ||
            (u.apodo && String(u.apodo).toLowerCase().trim() === low) ||
            (u.nombre && String(u.nombre).toLowerCase().trim() === low) ||
            (u.email && String(u.email).toLowerCase().trim() === low)
          )
        );

      if (matchedUserObj) {
        canonicalKey = String(matchedUserObj.id || matchedUserObj.usuario || low).toLowerCase();
        displayName = matchedUserObj.apodo || matchedUserObj.nombre || matchedUserObj.usuario || norm;
        username = matchedUserObj.usuario;
        userId = matchedUserObj.id;
        foto = matchedUserObj.avatar || matchedUserObj.foto || matchedUserObj.image || matchedUserObj.photo_url || matchedUserObj.avatar_url;
      } else {
        // Lookup in contacts
        const matchedContact = contacts.find((c: any) =>
          c && (
            (c.id && String(c.id).toLowerCase().trim() === low) ||
            (c.nombre && String(c.nombre).toLowerCase().trim() === low)
          )
        );
        if (matchedContact) {
          canonicalKey = String(matchedContact.id || matchedContact.nombre || low).toLowerCase();
          displayName = matchedContact.nombre || norm;
          foto = matchedContact.foto || (matchedContact.avatar && (String(matchedContact.avatar).startsWith('data:') || String(matchedContact.avatar).startsWith('http') || String(matchedContact.avatar).startsWith('/')) ? matchedContact.avatar : undefined);
        } else {
          canonicalKey = low;
          displayName = norm;
        }
      }
    }

    const isGroupChatResolved = chat.type !== 'privado';
    if (isGroupChatResolved) {
      if (
        (isMe && isAdministratorUser(currentUser)) ||
        isAdministratorUser(matchedUserObj) ||
        isUserAdminByReference(cand, allUsersMap)
      ) {
        continue;
      }
    }

    const dispLow = displayName.toLowerCase().trim();

    const allCandTokens = [
      low,
      norm.toLowerCase(),
      dispLow,
      username?.toLowerCase(),
      userId?.toLowerCase(),
      matchedUserObj?.usuario?.toLowerCase(),
      matchedUserObj?.apodo?.toLowerCase(),
      matchedUserObj?.nombre?.toLowerCase(),
      canonicalKey,
      ...(isMe ? myTokens : [])
    ].filter(Boolean) as string[];

    // If this participant has left or was removed, do not include them in active participants
    if (allCandTokens.some(tok => removedTokensSet.has(tok))) {
      continue;
    }

    // Check if this canonical user or display name was already resolved
    if (seenCanonicalKeys.has(canonicalKey) || seenDisplayNames.has(dispLow)) {
      // If candidate carries admin credentials, upgrade the existing record
      const existing = resolvedList.find(r => r.canonicalId === canonicalKey || r.displayName.toLowerCase().trim() === dispLow);
      if (existing && !existing.isAdmin) {
        const isCandidateAdmin = Boolean(
          (isMe && isSelfOrganizer) ||
          isParticipantActiveDesignatedAdmin(chat, allCandTokens, allUsersMap)
        );
        if (isCandidateAdmin) {
          existing.isAdmin = true;
        }
      }
      continue;
    }

    // Mark all aliases and tokens as seen so NO other candidate representation can duplicate this user
    seenCanonicalKeys.add(canonicalKey);
    seenCanonicalKeys.add(low);
    seenDisplayNames.add(dispLow);
    if (matchedUserObj) {
      if (matchedUserObj.id) seenCanonicalKeys.add(String(matchedUserObj.id).toLowerCase());
      if (matchedUserObj.usuario) seenCanonicalKeys.add(String(matchedUserObj.usuario).toLowerCase());
      if (matchedUserObj.apodo) seenCanonicalKeys.add(String(matchedUserObj.apodo).toLowerCase());
      if (matchedUserObj.nombre) seenCanonicalKeys.add(String(matchedUserObj.nombre).toLowerCase());
    }

    const candTokens = [low, norm, username, userId, matchedUserObj?.usuario, matchedUserObj?.apodo].filter(Boolean).map(t => String(t).toLowerCase().trim());
    const isActOrChatCreator = candTokens.some(t => [
      chat.creatorId,
      chat.creador_id,
      chat.creatorName,
      chat.organizer,
      chat.organizerId,
      relatedActivity?.organizer,
      relatedActivity?.organizerId,
      relatedActivity?.createdBy
    ].filter(Boolean).map((x: any) => String(x).toLowerCase().trim()).includes(t));

    const isDesignatedAdmin = isParticipantActiveDesignatedAdmin(chat, allCandTokens, allUsersMap);

    const isAdmin = isMe 
      ? Boolean(isSelfOrganizer || isDesignatedAdmin)
      : Boolean(isActOrChatCreator || isDesignatedAdmin);

    resolvedList.push({
      canonicalId: canonicalKey,
      displayName,
      username,
      userId,
      isAdmin,
      isSelf: isMe,
      foto,
      avatar: displayName.slice(0, 2).toUpperCase()
    });
  }

  // Sort: admins/moderators first, then alphabetically
  return resolvedList.sort((a, b) => {
    if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

/**
 * Checks if a review was authored by a specific user (by ID, username, apodo, email, or token).
 */
export function isUserReview(review: any, user: any): boolean {
  if (!review || !user) return false;
  const userTokens = [
    user.id,
    user.usuario,
    user.username,
    user.apodo,
    user.nombre,
    user.email
  ].filter(Boolean).map(t => String(t).replace(/[!¡]/g, '').trim().toLowerCase());

  if (userTokens.length === 0) return false;

  const rAutorTokens = [
    review.autor,
    review.autor_nombre,
    review.autor_id,
    review.usuarioId,
    review.autorId,
    review.userId,
    review.user_id,
    review.author_id,
    review.autorEmail,
    review.email
  ].filter(Boolean).map(t => String(t).replace(/[!¡]/g, '').trim().toLowerCase());

  return userTokens.some(ut => rAutorTokens.includes(ut));
}

/**
 * Calculates the average star rating for a collection of reviews.
 * Returns formatted average string (e.g. "4.8" or "0.0") and numeric average.
 */
export function calculateReviewsAverage(reviewsList: any[]): { average: number; formatted: string; count: number } {
  if (!Array.isArray(reviewsList) || reviewsList.length === 0) {
    return { average: 0, formatted: '0.0', count: 0 };
  }
  const activeReviews = reviewsList.filter(r => {
    if (!r) return false;
    const rawReviewText = String(r.texto ?? r.comentario ?? '').trim();
    if (
      r.retiradoDeLaVista === true ||
      r.retirado_de_la_vista === true ||
      r.deletedByAdmin === true ||
      r.isDeleted === true ||
      r.is_deleted === true ||
      rawReviewText === 'Esta reseña fue retirada por no cumplir con las condiciones de uso de CLUB65'
    ) {
      return false;
    }
    return true;
  });
  if (activeReviews.length === 0) {
    return { average: 0, formatted: '0.0', count: 0 };
  }
  const count = activeReviews.length;
  const sum = activeReviews.reduce((acc, r) => {
    const val = Number(r.estrellas) || Number(r.calificacion) || 5;
    return acc + val;
  }, 0);
  const average = sum / count;
  return {
    average,
    formatted: average.toFixed(1),
    count
  };
}

/**
 * Filters all reviews belonging to a specific activity either by activity ID or activity title.
 */
export function filterReviewsForActivity(reviewsList: any[], activityId?: number | string | null, activityTitle?: string | null): any[] {
  if (!Array.isArray(reviewsList)) return [];
  const targetId = activityId !== null && activityId !== undefined && String(activityId).trim() !== '' ? String(activityId).trim() : null;
  const targetTitle = activityTitle ? activityTitle.trim().toLowerCase() : null;

  return reviewsList.filter(r => {
    if (!r) return false;
    const rId = r.actividadId ?? r.activityId ?? r.actividad_id;
    const rTitle = (r.actividad ?? r.title ?? r.actividadTitle ?? r.actividad_titulo ?? '').trim().toLowerCase();

    if (targetId && rId !== undefined && rId !== null && String(rId).trim() === targetId) {
      return true;
    }
    if (targetTitle && rTitle && rTitle === targetTitle) {
      return true;
    }
    return false;
  });
}

/**
 * Returns a valid, non-mock profile avatar URL.
 * If the avatar is null, empty, or a stock placeholder/unsplash URL, returns null.
 */
export function sanitizeProfileAvatar(avatar?: string | null): string | null {
  if (!avatar || typeof avatar !== 'string') return null;
  const clean = avatar.trim();
  if (!clean) return null;
  if (
    clean.includes('images.unsplash.com') ||
    clean.includes('via.placeholder.com') ||
    clean.includes('placeholder.com')
  ) {
    return null;
  }
  return clean;
}

/**
 * Returns a valid user bio.
 * If the bio is a mock fallback string or empty, returns null.
 */
export function sanitizeProfileBio(bio?: string | null): string | null {
  if (!bio || typeof bio !== 'string') return null;
  const clean = bio.trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (
    lower === 'vecino activo de tres de febrero.' ||
    lower === 'vecino activo de tres de febrero' ||
    lower === 'miembro de la comunidad de club65.' ||
    lower === 'miembro activo de la comunidad de club65.' ||
    lower === 'organizador activo de actividades en club65.' ||
    lower === 'miembro de la comunidad'
  ) {
    return null;
  }
  return clean;
}

/**
 * Returns reviews written by OTHER users for activities organized by the given profile user.
 * Filters out:
 * 1. Reviews for activities not organized by this profile user.
 * 2. Reviews written by the profile user themselves (a user reviewing their own activity).
 */
export function getReviewsOfUserActivities(reviews: any[], profileUser: any, activities: any[]): any[] {
  if (!Array.isArray(reviews) || !profileUser || !Array.isArray(activities)) return [];

  const profileTokens = [
    profileUser.id,
    profileUser.userId,
    profileUser.user_id,
    profileUser.usuario,
    profileUser.username,
    profileUser.apodo,
    profileUser.nombre,
    profileUser.email
  ].filter(Boolean).map(t => String(t).replace(/[!¡]/g, '').trim().toLowerCase());

  if (profileTokens.length === 0) return [];

  // Find activities organized/conducted by this profile user
  const organizedActs = activities.filter(act => {
    if (!act) return false;
    const actOrgTokens = [
      act.organizerId,
      act.organizer_id,
      act.userId,
      act.user_id,
      act.createdById,
      act.createdBy,
      act.creador_id,
      act.organizer,
      act.organizerName,
      act.organizer_nombre
    ].filter(Boolean).map(t => String(t).replace(/[!¡]/g, '').trim().toLowerCase());

    return profileTokens.some(pt => actOrgTokens.includes(pt));
  });

  if (organizedActs.length === 0) return [];

  const organizedActIds = new Set(
    organizedActs.map(a => String(a.id || a.activityId || '')).filter(id => id.length > 0)
  );
  const organizedActTitles = new Set(
    organizedActs.map(a => String(a.title || a.nombre || a.titulo || '').trim().toLowerCase()).filter(t => t.length > 0)
  );

  return reviews.filter(r => {
    if (!r) return false;

    // Exclude reviews retired by dashboard moderation from the organizer's profile summary
    const rawReviewText = String(r.texto ?? r.comentario ?? '').trim();
    if (
      r.retiradoDeLaVista === true ||
      r.retirado_de_la_vista === true ||
      r.deletedByAdmin === true ||
      r.isDeleted === true ||
      r.is_deleted === true ||
      rawReviewText === 'Esta reseña fue retirada por no cumplir con las condiciones de uso de CLUB65'
    ) {
      return false;
    }

    // Check if the review corresponds to one of the activities organized by this profile
    const rActId = String(r.actividadId ?? r.actividad_id ?? r.activityId ?? '');
    const rActTitle = String(r.actividad ?? r.actividad_titulo ?? r.activityTitle ?? '').trim().toLowerCase();

    const matchesActivity = (rActId && organizedActIds.has(rActId)) ||
      (rActTitle && organizedActTitles.has(rActTitle));

    if (!matchesActivity) return false;

    // Must NOT be written by the profile user themselves!
    if (isUserReview(r, profileUser)) return false;

    return true;
  });
}

/**
 * Determina si un mensaje o cartel/aviso proviene de otro usuario o del sistema como novedad para el usuario actual.
 * - Mensajes de otros usuarios: TRUE
 * - Mensajes enviados por el usuario actual: FALSE
 * - Mensajes eliminados o retirados: FALSE
 * - Carteles/avisos del sistema:
 *   - Si fueron originados por el usuario actual (ej: "Juan agregó a Pedro" siendo el usuario actual Juan): FALSE
 *   - Si es el cartel de bienvenida del grupo creado por el propio usuario actual: FALSE
 *   - Si es un cartel/noticia para el usuario actual (ej: "Fuiste agregado", aviso del coordinador, bienvenida a nuevo miembro): TRUE
 */
export function isMessageFromOtherUser(msg: any, user: any, chat?: any): boolean {
  if (!msg || !user) return false;

  // Mensajes eliminados o retirados nunca son novedades pendientes
  if (
    msg.isDeleted ||
    msg.eliminado ||
    msg.retirado ||
    (typeof msg.text === 'string' && msg.text.includes('retirado del grupo'))
  ) {
    return false;
  }

  const uAny = user as any;
  const myTokens: string[] = [
    user.id,
    user.usuario,
    user.apodo,
    user.nombre,
    user.email,
    uAny?.institucion,
    uAny?.nombreInstitucion,
    uAny?.nombreCompleto,
    uAny?.username,
    uAny?.name,
    uAny?.supabaseId
  ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

  if (myTokens.length === 0) return false;

  const mAny = msg as any;
  const replyObj = typeof msg.replyTo === 'object' ? msg.replyTo : (typeof msg.reply_to === 'object' ? msg.reply_to : null);

  // Identificar si es un cartelito o mensaje del sistema
  const isSys = Boolean(
    msg.isSystem ||
    msg.role === 'sistema' ||
    msg.senderId === 'sistema' ||
    msg.senderId === 'system' ||
    (msg.sender && isDummyOrSystemParticipant(msg.sender)) ||
    (msg.sender && String(msg.sender).toLowerCase().includes('sistema club65')) ||
    (msg.senderId && String(msg.senderId).toLowerCase().includes('sistema'))
  );

  if (isSys) {
    // Si el usuario es el creador/organizador del chat y es el mensaje de inicialización del grupo, no es novedad para el organizador
    if (chat && (
      (chat.organizerId && myTokens.includes(String(chat.organizerId).toLowerCase())) ||
      (chat.creatorId && myTokens.includes(String(chat.creatorId).toLowerCase())) ||
      (chat.organizer && myTokens.includes(String(chat.organizer).toLowerCase())) ||
      (chat.createdById && myTokens.includes(String(chat.createdById).toLowerCase()))
    )) {
      if (replyObj?.is_group_init || (typeof msg.text === 'string' && (msg.text.includes('Bienvenidos al grupo') || msg.text.includes('Se inició un chat')))) {
        return false;
      }
    }

    // Si el cartel registra un actor que coincide con el usuario actual, no es novedad para el actor
    const actorTokens: string[] = [
      mAny?.actor,
      mAny?.actorId,
      mAny?.actor_id,
      mAny?.userId,
      mAny?.user_id,
      replyObj?.actor,
      replyObj?.actorId
    ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

    if (actorTokens.some(at => myTokens.includes(at))) {
      return false;
    }

    // Para cualquier otro participante, el cartel/aviso SÍ es una novedad sin leer
    return true;
  }

  // Mensajes regulares entre usuarios
  const senderTokens: string[] = [
    msg.senderId,
    msg.sender_id,
    msg.sender,
    msg.autor,
    msg.author,
    msg.usuario,
    mAny?.userId,
    mAny?.user_id
  ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

  if (senderTokens.length === 0) return false;
  return !senderTokens.some(st => myTokens.includes(st));
}

/**
 * Calcula el número exacto de mensajes y carteles sin leer en un chat para un usuario.
 * Si el usuario está viendo actualmente este chat (isCurrentlyActiveChat === true), retorna 0.
 */
export function getChatUnreadCount(
  chat: any,
  user: any,
  lastReads: Record<string, number> = {},
  isCurrentlyActiveChat: boolean = false
): number {
  if (!chat || !user || !Array.isArray(chat.messages) || chat.messages.length === 0) {
    return 0;
  }

  if (isCurrentlyActiveChat) {
    return 0;
  }

  const chatIdKey = String(chat.id);
  const actIdKey = chat.activityId ? String(chat.activityId) : '';
  const sChatIdBig = String(chatIdentifierToBigInt(chat.id));
  const sActIdBig = chat.activityId ? String(chatIdentifierToBigInt(chat.activityId)) : '';

  const lastReadTime = Math.max(
    lastReads[chatIdKey] || 0,
    actIdKey ? (lastReads[actIdKey] || 0) : 0,
    lastReads[sChatIdBig] || 0,
    sActIdBig ? (lastReads[sActIdBig] || 0) : 0
  );

  let unreadCount = 0;
  const dedupedMsgs = deduplicateMessages(chat.messages);
  const departureAt = getUserChatDepartureTimestamp(chat, user);

  for (const m of dedupedMsgs) {
    if (!isMessageFromOtherUser(m, user, chat)) continue;

    if (
      m.isDeleted ||
      m.retirado ||
      m.eliminado ||
      (typeof m.text === 'string' && m.text.includes('retirado del grupo'))
    ) {
      continue;
    }

    let msgTime = m.timestamp;
    if (!msgTime && m.createdAt) {
      msgTime = new Date(m.createdAt).getTime();
    }
    if (!msgTime && m.created_at) {
      msgTime = new Date(m.created_at).getTime();
    }
    if (!msgTime && typeof m.id === 'string' && m.id.startsWith('msg_')) {
      const parsed = parseInt(m.id.replace('msg_', ''), 10);
      if (!isNaN(parsed) && parsed > 1600000000000) {
        msgTime = parsed;
      }
    }
    if (!msgTime) {
      msgTime = 0;
    }

    if (departureAt > 0 && msgTime > departureAt) {
      continue;
    }

    // Si el chat nunca fue leído (lastReadTime === 0), todo mensaje/cartel no propio cuenta
    // Si el chat ya fue leído, cuenta solo si el mensaje llegó con posterioridad a esa lectura
    if (lastReadTime === 0) {
      unreadCount++;
    } else if (msgTime > lastReadTime) {
      unreadCount++;
    }
  }

  return unreadCount;
}

/**
 * Detects whether an activity is recurrent.
 */
export function isActivityRecurrent(act: any): boolean {
  if (!act) return false;
  return Boolean(
    act.isRecurrent ||
    act.is_recurrent ||
    act.es_recurrente ||
    act.frequency === 'recurrente' ||
    act.frecuencia === 'recurrente'
  );
}

/**
 * Determines the specific recurrence periodicity ('semanal', 'quincenal', 'mensual', or 'unico').
 */
export function getActivityRecurrenceType(act: any): 'semanal' | 'quincenal' | 'mensual' | 'unico' {
  if (!isActivityRecurrent(act)) return 'unico';
  const allText = `${act.schedule || ''} ${act.horario || ''} ${act.frequency || ''} ${act.frecuencia || ''} ${act.frecuenciaRecurrente || ''} ${act.description || ''} ${act.descripcion || ''}`.toLowerCase();
  const freq = String(act.frequency || act.frecuencia || act.frecuenciaRecurrente || '').toLowerCase().trim();

  if (freq === 'mensual' || /\b(mensual|mensuales|día\s*\d+\s*de\s*cada\s*mes|cada\s*mes)\b/i.test(allText)) {
    return 'mensual';
  }
  if (freq === 'quincenal' || /\b(quincenal|quincenales|cada\s*2\s*semanas|cada\s*dos\s*semanas)\b/i.test(allText)) {
    return 'quincenal';
  }
  return 'semanal';
}

/**
 * Evaluates the "Frecuencia del encuentro" filter:
 * - 'todas': match all
 * - 'unico': single encounter
 * - 'semanal': recurrent weekly
 * - 'quincenal': recurrent biweekly
 * - 'mensual': recurrent monthly
 */
export function matchActivityFrequency(act: any, frequency: string): boolean {
  if (!frequency || frequency === 'todas') return true;
  const isRec = isActivityRecurrent(act);
  if (frequency === 'unico') {
    return !isRec;
  }
  if (!isRec) return false;
  const type = getActivityRecurrenceType(act);
  return type === frequency;
}

/**
 * Evaluates the "Iniciativa" filter:
 * - 'todas': match all
 * - 'verificadas': verified institutional activities (act.isInstitutional)
 * - 'vecinales': neighbor community initiatives (!act.isInstitutional)
 */
export function matchActivityInitiative(act: any, initiative: string): boolean {
  if (!initiative || initiative === 'todas') return true;
  const isInst = Boolean(act?.isInstitutional || act?.esInstitucion || act?.is_institutional);
  if (initiative === 'verificadas') {
    return isInst;
  }
  if (initiative === 'vecinales') {
    return !isInst;
  }
  return true;
}

/**
 * Resolves the start date (or first meeting date) of an activity in YYYY-MM-DD format.
 */
export function getActivityStartDateYMD(act: any): string | null {
  if (!act) return null;
  const rawDate =
    act.firstMeetingDate ||
    act.firstEncounterDate ||
    act.first_encounter_date ||
    act.fechaPrimerEncuentro ||
    act.startDate ||
    act.start_date ||
    act.fechaIni ||
    act.fecha_inicio ||
    act.fechaRealizacion ||
    act.fecha ||
    act.date;

  const parsed = parseDateToYMD(rawDate);
  if (parsed) return parsed;

  const allText = `${act.schedule || act.horario || ''} ${act.description || act.descripcion || ''}`;
  const extracted = extractDatesFromText(allText);
  if (extracted.length > 0) return extracted[0];

  return null;
}

/**
 * Evaluates the "Temporalidad / Fecha" filter:
 * - 'cualquiera': match all
 * - 'este_mes': activity starts/meets in the current month in Argentina time
 * - 'proximo_mes': activity starts/meets in the next calendar month in Argentina time
 */
export function matchActivityTiming(act: any, timing: string, referenceDate?: Date): boolean {
  if (!timing || timing === 'cualquiera') return true;

  const ymd = getActivityStartDateYMD(act);
  if (!ymd) return false;

  const [actYear, actMonth] = ymd.split('-').map(Number);
  if (!actYear || !actMonth) return false;

  // Resolve current year & month in Argentina timezone (UTC-3)
  const targetDate = referenceDate || new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit'
  });
  const parts = formatter.format(targetDate).split('-');
  const curYear = parseInt(parts[0], 10);
  const curMonth = parseInt(parts[1], 10);

  if (timing === 'este_mes') {
    return actYear === curYear && actMonth === curMonth;
  }

  if (timing === 'proximo_mes') {
    const nextMonth = curMonth === 12 ? 1 : curMonth + 1;
    const nextYear = curMonth === 12 ? curYear + 1 : curYear;
    return actYear === nextYear && actMonth === nextMonth;
  }

  return true;
}

/**
 * Evaluates the "Cupo disponible" filter:
 * - 'cualquiera': match all
 * - 'libre': free / no limit (capacity 0 or >= 999)
 * - 'chico': small group (up to 20 spots: 1..20)
 * - 'mediano': medium group (21..50 spots)
 * - 'grande': large group (more than 50 spots: > 50 and < 999)
 */
export function matchActivityCapacity(act: any, capacityRange: string): boolean {
  if (!capacityRange || capacityRange === 'cualquiera') return true;
  const rawCap = act?.capacity ?? act?.cupo ?? act?.capacidad;
  const cap = Number(rawCap ?? 0);

  if (capacityRange === 'libre') {
    return cap === 0 || cap >= 999;
  }
  if (capacityRange === 'chico') {
    return cap > 0 && cap <= 20;
  }
  if (capacityRange === 'mediano') {
    return cap >= 21 && cap <= 50;
  }
  if (capacityRange === 'grande') {
    return cap > 50 && cap < 999;
  }

  return true;
}

/**
 * Extracts distinct localities and neighborhoods dynamically strictly from activities
 * currently available in Cartelera (approved, not cancelled, not past/expired, and not vetted for currentUser).
 * Parses comma-separated geocoder strings, removes duplicates and generic noise,
 * and sorts alphabetically in Spanish.
 */
export function extractDynamicLocations(
  activities: any[],
  options: { currentUser?: any; refDate?: Date } = {}
): string[] {
  if (!Array.isArray(activities)) return [];
  const availableInCartelera = filterCarteleraActivities(activities, {
    currentUser: options.currentUser,
    refDate: options.refDate
  });
  const locationSet = new Set<string>();

  for (const act of availableInCartelera) {
    if (!act) continue;

    const rawLoc = String(act.location || act.direccion || act.ubicacion || act.localidad || '').trim();
    if (!rawLoc) continue;

    const parts = rawLoc.split(',').map(p => p.trim()).filter(Boolean);

    if (parts.length === 1) {
      if (parts[0].length >= 3 && !/^\d+$/.test(parts[0])) {
        locationSet.add(parts[0]);
      }
    } else {
      for (const part of parts) {
        if (part.length < 3) continue;
        if (/^\d+$/.test(part)) continue;
        if (/^[A-Z]?\d{4,5}[A-Z]{0,3}$/i.test(part)) continue;
        if (/^(?:argentina|república argentina)$/i.test(part)) continue;
        // Ignore street number segments like "Av. Rivadavia 1234" or "Calle 45"
        if (/^(?:av\.?|avenida|calle|pasaje|ruta|diagonal|boulevard|bvd\.?|bv\.?)\s+/i.test(part) && /\d+/.test(part)) {
          continue;
        }
        locationSet.add(part);
      }
    }
  }

  const uniqueNormalized = new Map<string, string>();
  for (const loc of locationSet) {
    const key = loc.toLowerCase();
    if (!uniqueNormalized.has(key)) {
      uniqueNormalized.set(key, loc);
    }
  }

  return Array.from(uniqueNormalized.values()).sort((a, b) =>
    a.localeCompare(b, 'es', { sensitivity: 'base' })
  );
}

/**
 * Evaluates the "Ubicación" filter against an activity's location string.
 */
export function matchActivityLocation(act: any, locationZone: string): boolean {
  if (!locationZone || locationZone === 'todas') return true;
  const target = locationZone.toLowerCase().trim();
  const rawLoc = String(act?.location || act?.direccion || act?.ubicacion || act?.localidad || '').toLowerCase();
  return rawLoc.includes(target);
}

export interface CarteleraFilterOptions {
  category?: string;
  searchQuery?: string;
  frequency?: string;
  initiative?: string;
  timing?: string;
  capacity?: string;
  location?: string;
  currentUser?: any;
  refDate?: Date;
}

/**
 * Primary pure filter function for Cartelera ("explorar" view).
 * Integrates the category pills, search bar, and all 5 advanced filter criteria.
 */
export function filterCarteleraActivities(
  activities: any[],
  options: CarteleraFilterOptions = {}
): any[] {
  if (!Array.isArray(activities)) return [];
  const {
    category = 'todas',
    searchQuery = '',
    frequency = 'todas',
    initiative = 'todas',
    timing = 'cualquiera',
    capacity = 'cualquiera',
    location = 'todas',
    currentUser,
    refDate
  } = options;

  const q = (searchQuery || '').toLowerCase().trim();

  return activities.filter(act => {
    if (!isActivityApproved(act)) return false;
    if (isActCancelled(act)) return false;
    if (isActivityPast(act, refDate)) return false;
    if (currentUser && isUserVettedFromActivity(act, currentUser)) return false;

    // Categoría
    if (category && category !== 'todas') {
      const actCat = String(act.category || act.categoria || '').toLowerCase().trim();
      if (actCat !== category.toLowerCase().trim()) return false;
    }

    // Buscador
    if (q) {
      const titleMatch = String(act.title || act.titulo || '').toLowerCase().includes(q);
      const locMatch = String(act.location || act.direccion || '').toLowerCase().includes(q);
      const descMatch = String(act.description || act.descripcion || '').toLowerCase().includes(q);
      if (!titleMatch && !locMatch && !descMatch) return false;
    }

    // Los 5 filtros
    if (!matchActivityFrequency(act, frequency)) return false;
    if (!matchActivityInitiative(act, initiative)) return false;
    if (!matchActivityTiming(act, timing, refDate)) return false;
    if (!matchActivityCapacity(act, capacity)) return false;
    if (!matchActivityLocation(act, location)) return false;

    return true;
  });
}

/**
 * Checks strict ownership of an activity by a given user (personal or institutional).
 * Never treats `isInstitutional` alone or generic role placeholders ('institucional', 'personal')
 * as ownership by any user of that type.
 */
export function isActivityOwnedByUser(act: any, user: any): boolean {
  if (!act || !user) return false;

  const genericPlaceholders = new Set(['institucional', 'personal', 'moderador', 'admin']);
  const userId = String(user.id || '').trim().toLowerCase();

  const actIds = [
    act.organizerId,
    act.organizador_id,
    act.organizer_id,
    act.creador_id,
    act.userId,
    act.createdById
  ]
    .map(v => String(v || '').trim().toLowerCase())
    .filter(v => v.length > 0 && !genericPlaceholders.has(v));

  if (actIds.length > 0) {
    if (!userId) return false;
    return actIds.includes(userId);
  }

  const normalizeToken = (val: any) =>
    String(val || '').replace(/[!¡]/g, '').trim().toLowerCase();

  const userNameTokens = [
    user.usuario,
    user.apodo,
    user.nombre,
    user.name,
    user.institucion
  ]
    .map(normalizeToken)
    .filter(t => t.length > 0 && !genericPlaceholders.has(t));

  if (userNameTokens.length === 0) return false;

  const actOrgTokens = [
    act.organizer,
    act.organizerName,
    act.organizerNombre,
    act.organizador,
    act.createdBy,
    act.creador
  ]
    .map(normalizeToken)
    .filter(t => t.length > 0 && !genericPlaceholders.has(t));

  return actOrgTokens.some(tok => userNameTokens.includes(tok));
}

/**
 * Returns true if the activity was suspended / force-cancelled by CLUB65 administration.
 */
export function isActivityCancelledByOrganizer(act: any): boolean {
  if (!act) return false;
  const propStatus = String(act.proposalStatus || act.proposal_status || '').toLowerCase().trim();
  const estado = String(act.estado || '').toLowerCase().trim();
  if (
    propStatus === 'cancelada_organizador' ||
    estado === 'cancelada_organizador' ||
    act.canceladaPorOrganizador ||
    act.cancelada_por_organizador
  ) {
    return true;
  }
  // If estado is 'baja_forzada' and proposalStatus isn't explicitly 'baja_forzada',
  // check if the executor (admin_baja_id) is the activity's own organizer.
  if (propStatus !== 'baja_forzada') {
    const execId = String(act.admin_baja_id || act.bajaAdmin || '').toLowerCase().trim();
    const orgIds = [act.organizerId, act.organizador_id, act.creador_id, act.userId]
      .filter(Boolean)
      .map((v: any) => String(v).toLowerCase().trim());
    if (execId && orgIds.includes(execId)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the activity was suspended / force-cancelled by CLUB65 administration.
 */
export function isActivitySuspendedByAdmin(act: any): boolean {
  if (!act) return false;
  if (isActivityCancelledByOrganizer(act)) return false;
  const propStatus = String(act.proposalStatus || act.proposal_status || '').toLowerCase().trim();
  const estado = String(act.estado || '').toLowerCase().trim();
  const hasFechaBaja = Boolean(act.fecha_baja && String(act.fecha_baja).trim() !== '');
  return Boolean(
    propStatus === 'baja_forzada' ||
    estado === 'baja_forzada' ||
    hasFechaBaja ||
    act.baja_forzada ||
    act.bajaForzada
  );
}

/**
 * Resolves the exact suspension/cancellation reason provided by the admin or organizer.
 */
export function getSuspensionReasonText(act: any, bajasList: any[] = []): string {
  const bajaRecord = (bajasList || []).find(
    (b: any) => b && act && String(b.activityId ?? b.activity_id) === String(act.id)
  );
  const fromBaja = String(bajaRecord?.reason || '').trim();
  const fromAct = String(
    act?.bajaReason || act?.motivo_baja || act?.feedback_admin || act?.proposalNote || act?.feedback || ''
  ).trim();

  if (fromAct && fromAct !== '-') return fromAct;
  if (fromBaja && fromBaja !== '-') return fromBaja;
  return fromAct || fromBaja || '-';
}

export const AUTO_EXPIRED_PROPOSAL_REASON =
  'La propuesta fue desestimada automáticamente porque ya pasó la fecha y el horario de inicio.';

/**
 * Returns true if the proposal was rejected (manually by admin or auto-dismissed on expiration).
 * Excludes admin forced suspensions (baja_forzada) and organizer cancellations (cancelada_organizador).
 */
export function isProposalRejected(act: any): boolean {
  if (!act) return false;
  if (isActivitySuspendedByAdmin(act) || isActivityCancelledByOrganizer(act)) return false;
  const propStatus = String(act.proposalStatus || act.proposal_status || '').toLowerCase().trim();
  const estado = String(act.estado || '').toLowerCase().trim();
  return propStatus === 'rechazada' || estado === 'rechazada';
}

/**
 * Returns true if the activity's scheduled start date and start time (in Argentina UTC-3)
 * have already passed relative to referenceDate (or Date.now()).
 */
export function hasProposalStartPassed(act: any, referenceDate?: Date): boolean {
  if (!act) return false;
  try {
    const freqLower = String(act.frequency || act.frecuencia || act.frecuencia_tipo || '').toLowerCase().trim();
    const isRecurrent = Boolean(
      act.isRecurrent ||
      act.is_recurrent ||
      act.es_recurrente ||
      freqLower === 'recurrente' ||
      freqLower === 'semanal' ||
      freqLower === 'quincenal' ||
      freqLower === 'mensual'
    );

    const sched = String(act.schedule || act.horario || act.horario_resumen || '');
    const desc = String(act.descripcion || act.description || '');
    const allText = `${sched} ${desc}`;
    const extractedDates = extractDatesFromText(allText);
    const times = extractTimesFromSchedule(allText);

    let startYmd: string | null = null;
    let rawTime = '';

    if (isRecurrent) {
      const matchDescDate = desc.match(/Primer encuentro:\s*([^\n]+)/i);
      startYmd =
        parseDateToYMD(
          act.firstEncounterDate ||
          act.first_encounter_date ||
          act.firstMeetingDate ||
          act.fechaPrimerEncuentro ||
          (matchDescDate ? matchDescDate[1] : null) ||
          act.startDate ||
          act.start_date ||
          act.fechaIni ||
          act.fecha_inicio
        ) ||
        extractedDates[0] ||
        null;

      rawTime = String(
        act.firstEncounterStartTime ||
        act.first_encounter_start_time ||
        act.startTime ||
        act.start_time ||
        act.horaIni ||
        act.hora_inicio ||
        times.startTime ||
        ''
      ).trim();
    } else {
      startYmd =
        parseDateToYMD(
          act.startDate ||
          act.start_date ||
          act.fechaIni ||
          act.fecha_inicio ||
          act.fechaRealizacion ||
          act.fecha_realizacion ||
          act.date ||
          act.fecha
        ) ||
        extractedDates[0] ||
        null;

      rawTime = String(
        act.startTime ||
        act.start_time ||
        act.horaIni ||
        act.hora_inicio ||
        times.startTime ||
        ''
      ).trim();
    }

    if (!startYmd) return false;

    let normTime = '00:00:00';
    if (rawTime) {
      const tm = rawTime.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (tm) {
        normTime = `${tm[1].padStart(2, '0')}:${tm[2]}:${(tm[3] || '00').padStart(2, '0')}`;
      }
    }

    const startMs = new Date(`${startYmd}T${normTime}-03:00`).getTime();
    if (isNaN(startMs)) return false;

    const refTime = referenceDate ? referenceDate.getTime() : Date.now();
    return refTime >= startMs;
  } catch {
    return false;
  }
}

/**
 * Returns true if a non-institutional pending proposal (pendiente or cambios_solicitados)
 * has already passed its start date and time and must be automatically dismissed/rejected.
 */
export function isPendingProposalExpired(act: any, referenceDate?: Date): boolean {
  if (!act) return false;
  if (
    act.isInstitutional ||
    act.is_institutional ||
    act.es_institucional ||
    act.organizerId === 'institucional'
  ) {
    return false;
  }
  if (isActivityApproved(act)) return false;
  if (isActivitySuspendedByAdmin(act) || isActivityCancelledByOrganizer(act) || isProposalRejected(act)) {
    return false;
  }
  return hasProposalStartPassed(act, referenceDate);
}

/**
 * Resolves the human-readable rejection reason for a rejected proposal.
 */
export function getRejectedProposalReason(act: any): string {
  if (!act) return '';
  const candidate = String(
    act.rejectionReason ||
    act.rejection_reason ||
    act.feedback ||
    act.feedback_admin ||
    act.proposalNote ||
    act.proposal_note ||
    ''
  ).trim();
  if (candidate && candidate !== '-') return candidate;
  if (isPendingProposalExpired(act)) return AUTO_EXPIRED_PROPOSAL_REASON;
  return '';
}

/**
 * Returns true if the organizer should see an alert dot on the "Mis Actividades" tab
 * for any of their activities suspended by CLUB65 administration (baja_forzada)
 * that they haven't dismissed by leaving the tab.
 */
export function hasMisActividadesSuspensionAlert(
  activities: any[],
  currentUser: any,
  seenSuspendedIds: Array<number | string>
): boolean {
  if (!currentUser || !Array.isArray(activities)) return false;
  const seenSet = new Set((seenSuspendedIds || []).map(id => String(id)));
  return activities.some(a =>
    isActivityOwnedByUser(a, currentUser) &&
    isActivitySuspendedByAdmin(a) &&
    !seenSet.has(String(a.id))
  );
}

/**
 * Returns true if the organizer should see an alert dot on the "Mis Actividades" tab
 * for any of their proposals with requested changes not yet viewed/submitted.
 */
export function hasMisActividadesChangesAlert(
  activities: any[],
  currentUser: any,
  seenChangesIds: Array<number | string>
): boolean {
  if (!currentUser || !Array.isArray(activities)) return false;
  const seenSet = new Set((seenChangesIds || []).map(id => String(id)));
  return activities.some(a =>
    isActivityOwnedByUser(a, currentUser) &&
    (a.proposalStatus === 'cambios_solicitados' || a.proposal_status === 'cambios_solicitados') &&
    !a.changesSubmittedAt &&
    !a.changes_submitted_at &&
    !seenSet.has(String(a.id))
  );
}

/**
 * Returns true if the organizer should see an alert dot on the "Mis Actividades" tab
 * for any of their proposals rejected (manually or auto-dismissed on expiration)
 * that they haven't seen/dismissed yet — mirroring Mi Agenda's cancellation alert dot.
 */
export function hasMisActividadesRejectedAlert(
  activities: any[],
  currentUser: any,
  seenRejectedIds: Array<number | string>,
  dismissedRejectedIds: Array<number | string> = []
): boolean {
  if (!currentUser || !Array.isArray(activities)) return false;
  const seenSet = new Set((seenRejectedIds || []).map(id => String(id)));
  const dismissedSet = new Set((dismissedRejectedIds || []).map(id => String(id)));
  return activities.some(a => {
    if (!a) return false;
    const actIdStr = String(a.id);
    if (seenSet.has(actIdStr) || dismissedSet.has(actIdStr)) return false;
    return isActivityOwnedByUser(a, currentUser) && isProposalRejected(a);
  });
}

/**
 * Filters personal user's proposals/activities in "Mis Actividades".
 * Rejected proposals remain visible (even after being seen/tab left) until the user
 * explicitly dismisses them via the X button, matching Mi Agenda cancellation cards.
 */
export function filterPersonalMisActividades(
  activities: any[],
  currentUser: any,
  dismissedRejectedIds: Array<number | string> = []
): any[] {
  if (!currentUser || !Array.isArray(activities)) return [];
  const dismissedSet = new Set((dismissedRejectedIds || []).map(id => String(id)));
  return activities.filter(act => {
    if (!act) return false;
    if (!isActivityOwnedByUser(act, currentUser)) return false;
    if (isProposalRejected(act) && dismissedSet.has(String(act.id))) return false;
    return true;
  });
}

/**
 * Returns true if an enrolled (or vetoed) user should see an alert dot on the "Mi Agenda" tab
 * for activities cancelled by admin (baja_forzada) OR by organizer (cancelada_organizador),
 * or where the user was vetoed, and not yet seen/dismissed.
 */
export function hasAgendaCancellationAlert(
  activities: any[],
  currentUser: any,
  seenCancelledAgendaIds: Array<number | string>,
  dismissedCancelledAgendaIds: Array<number | string> = []
): boolean {
  if (!currentUser || !Array.isArray(activities)) return false;
  const seenSet = new Set((seenCancelledAgendaIds || []).map(id => String(id)));
  const dismissedSet = new Set((dismissedCancelledAgendaIds || []).map(id => String(id)));
  const userAgendaIds = new Set(
    (Array.isArray(currentUser?.agenda) ? currentUser.agenda : []).map((id: any) => String(id))
  );

  return activities.some(a => {
    if (!a) return false;
    const actIdStr = String(a.id);
    if (seenSet.has(actIdStr) || dismissedSet.has(actIdStr)) return false;
    if (isUserVettedFromActivity(a, currentUser)) return true;

    const isCancelled = isActivitySuspendedByAdmin(a) || isActivityCancelledByOrganizer(a);
    if (!isCancelled) return false;

    return isUserEnrolledInActivity(a, currentUser) || userAgendaIds.has(actIdStr);
  });
}

/**
 * Filters activities shown in the user's "Mi Agenda" view.
 * - Enrolled users continue to see activities cancelled by admin OR by organizer
 *   until they explicitly dismiss them (X button).
 * - Organizers do NOT get spurious cancelled cards in Mi Agenda for their own cancelled activities
 *   (they see admin suspensions in "Mis Actividades").
 */
export function filterAgendaActivities(
  activities: any[],
  currentUser: any,
  dismissedCancelledAgendaIds: Array<number | string> = []
): any[] {
  if (!currentUser || !Array.isArray(activities)) return [];
  const dismissedSet = new Set((dismissedCancelledAgendaIds || []).map(id => String(id)));
  const userAgendaIds = new Set(
    (Array.isArray(currentUser?.agenda) ? currentUser.agenda : []).map((id: any) => String(id))
  );

  return activities.filter(act => {
    if (!act) return false;
    const actIdStr = String(act.id);
    if (dismissedSet.has(actIdStr)) return false;

    if (isUserVettedFromActivity(act, currentUser)) {
      return true;
    }

    const isCancelled = isActivitySuspendedByAdmin(act) || isActivityCancelledByOrganizer(act);
    const isEnrolled = isUserEnrolledInActivity(act, currentUser) || userAgendaIds.has(actIdStr);
    const isOrganizer = isActivityOwnedByUser(act, currentUser);

    if (isCancelled) {
      return isEnrolled;
    }

    if (!isActivityApproved(act)) return false;
    if (!isEnrolled && !isOrganizer) return false;
    if (isActivityPast(act)) return false;

    return true;
  });
}

/**
 * Normalizes an activity title (removing any "Grupo: " prefix) and builds
 * the exact italicized recent-messages notification text for participants.
 */
export function buildCancelledGroupNoticeMessage(activityTitle: string | undefined | null): string {
  const cleanTitle = String(activityTitle || '').replace(/^grupo:\s*/i, '').trim();
  const displayName = cleanTitle || 'de la actividad';
  return `Ya no formas parte del grupo ${displayName} porque la actividad fue cancelada.`;
}

/**
 * Extracts non-dismissed cancelled group notices from a user's Supabase notifications array.
 */
export function extractCancelledGroupNoticesFromNotifications(
  notifications: any[],
  dismissedIds: string[] = []
): Array<{
  id: string;
  activityId: number | string;
  activityTitle: string;
  message: string;
  date: string;
  participants: string[];
}> {
  if (!Array.isArray(notifications)) return [];
  const dismissedSet = new Set((dismissedIds || []).map(id => String(id)));
  const seenKey = new Set<string>();
  const result: Array<{
    id: string;
    activityId: number | string;
    activityTitle: string;
    message: string;
    date: string;
    participants: string[];
  }> = [];

  for (const n of notifications) {
    if (!n || n.type !== 'cancelled_group_notice' || n.dismissed) continue;
    const noticeId = String(n.id || '');
    if (!noticeId || dismissedSet.has(noticeId)) continue;

    const actId = n.activityId ?? n.activity_id ?? '';
    const rawTitle = String(n.activityTitle || n.activity_title || '').replace(/^grupo:\s*/i, '').trim();
    const dedupKey = actId !== '' ? `act_${String(actId)}` : `id_${noticeId}`;
    if (seenKey.has(dedupKey)) continue;
    seenKey.add(dedupKey);

    result.push({
      id: noticeId,
      activityId: typeof actId === 'number' ? actId : (!isNaN(Number(actId)) && String(actId).trim() !== '' ? Number(actId) : String(actId)),
      activityTitle: rawTitle || 'Actividad',
      message: buildCancelledGroupNoticeMessage(rawTitle),
      date: String(n.date || n.createdAt || ''),
      participants: Array.isArray(n.participants) ? n.participants : []
    });
  }

  return result;
}

/**
 * Removes a dismissed cancelled group notice from a notifications array.
 */
export function removeCancelledGroupNoticeFromNotifications(notifications: any[], noticeId: string): any[] {
  if (!Array.isArray(notifications)) return [];
  const target = String(noticeId || '').trim();
  if (!target) return [...notifications];
  return notifications.filter((n: any) => !(n && n.type === 'cancelled_group_notice' && String(n.id) === target));
}

/**
 * Returns true if a group chat belongs to the given cancelled activity (by ID or normalized title).
 */
export function doesChatMatchActivity(
  chat: any,
  activityId: number | string,
  activityTitle?: string
): boolean {
  if (!chat) return false;
  const isGroup = chat.type === 'grupal' || chat.tipo === 'grupo_actividad' || Boolean(chat.activityId || chat.actividad_id);
  if (!isGroup && chat.type === 'privado') return false;

  const actIdStr = String(activityId ?? '').trim();
  if (actIdStr) {
    if (chat.activityId !== undefined && chat.activityId !== null && String(chat.activityId) === actIdStr) return true;
    if (chat.actividad_id !== undefined && chat.actividad_id !== null && String(chat.actividad_id) === actIdStr) return true;
    if (chat.id !== undefined && chat.id !== null && String(chat.id) === actIdStr) return true;
  }

  const cleanTarget = String(activityTitle || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
  if (cleanTarget) {
    const cleanChat = String(chat.title || chat.name || chat.nombre || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
    if (cleanChat && cleanChat === cleanTarget) return true;
  }

  return false;
}

/**
 * Filters out any group chat associated with a cancelled activity.
 */
export function filterChatsAfterActivityCancellation(
  chats: any[],
  activityId: number | string,
  activityTitle?: string
): any[] {
  if (!Array.isArray(chats)) return [];
  return chats.filter(c => !doesChatMatchActivity(c, activityId, activityTitle));
}

/**
 * Formats the instant toast notification for an incoming chat message.
 * Uses "en chat privado" for 1-on-1 private chats to avoid repeating the sender's name,
 * and keeps 'en "<nombre del chat>"' for group chats.
 */
export function formatIncomingMessageToast(
  chat: any,
  senderRaw?: string | null,
  messageText?: string | null,
  senderId?: string | null,
  usersMap?: Record<string, any>
): string {
  const sender = resolveSenderDisplayName(senderRaw, senderId, usersMap, 'Vecino');
  const rawText = String(messageText || '');
  const preview = rawText.length > 60 ? `${rawText.slice(0, 60)}...` : rawText;
  const isPrivate = chat?.type === 'privado' || chat?.tipo === 'privado';

  if (isPrivate) {
    return preview
      ? `💬 Nuevo mensaje de ${sender} en chat privado: ${preview}`
      : `💬 Nuevo mensaje de ${sender} en chat privado`;
  }

  const chatTitle = String(chat?.title || chat?.name || chat?.nombre || 'Chat').trim() || 'Chat';
  return preview
    ? `💬 Nuevo mensaje de ${sender} en "${chatTitle}": ${preview}`
    : `💬 Nuevo mensaje de ${sender} en "${chatTitle}"`;
}

/**
 * Determines whether a message options dropdown should open upwards instead of downwards
 * so that menus on the last or bottom-most messages are never clipped by the scroll container.
 */
export function shouldOpenMessageMenuUpwards(params: {
  triggerBottom: number;
  triggerTop: number;
  containerBottom: number;
  containerTop: number;
  isLastMessage?: boolean;
  estimatedMenuHeight?: number;
}): boolean {
  const menuH = params.estimatedMenuHeight ?? 210;
  const spaceBelow = params.containerBottom - params.triggerBottom;
  const spaceAbove = params.triggerTop - params.containerTop;
  if (spaceBelow < menuH && spaceAbove > spaceBelow) {
    return true;
  }
  if (params.isLastMessage && spaceAbove >= menuH && spaceBelow < menuH + 24) {
    return true;
  }
  return false;
}

/**
 * Filters activities eligible for the "Baja Forzada de Actividades de la Cartelera" section:
 * exclusively activities currently published and active in Cartelera
 * (officially approved, not cancelled/suspended/rejected, and whose final date/encounter has not passed).
 */
export function filterActivitiesForBajaSection(
  activities: any[],
  referenceDate?: Date
): any[] {
  if (!Array.isArray(activities)) return [];
  return filterCarteleraActivities(activities, { refDate: referenceDate });
}

/**
 * Resolves the administrator display string for a record in
 * "Dashboard -> Gestión de Sanciones -> Bajas de Actividades".
 * If the activity was cancelled by its organizer rather than an administrator, returns "-".
 */
export function resolveBajaAdminDisplay(baja: any, activities: any[] = []): string {
  if (!baja) return '-';
  if (baja.cancelledByOrganizer || baja.canceladaPorOrganizador) {
    return '-';
  }

  const targetActId = baja.activityId ?? baja.activity_id;
  const matchedAct = Array.isArray(activities)
    ? activities.find(
        (a: any) => a && targetActId !== undefined && targetActId !== null && String(a.id) === String(targetActId)
      )
    : undefined;

  if (matchedAct && isActivityCancelledByOrganizer(matchedAct)) {
    return '-';
  }

  const rawAdmin = String(baja.adminUsername ?? baja.admin_username ?? '')
    .replace(/^@+/, '')
    .trim();

  if (!rawAdmin || rawAdmin === '-') {
    return '-';
  }

  return rawAdmin;
}

/**
 * Finds an activity in a list matching targetId regardless of string vs number ID types
 * (e.g. Supabase chats.actividad_id as string vs mapped Activity.id as number).
 */
export function resolveActivityById<T extends { id?: number | string }>(
  activities: T[] | null | undefined,
  targetId: number | string | null | undefined
): T | undefined {
  if (!Array.isArray(activities) || targetId === null || targetId === undefined) {
    return undefined;
  }
  const targetStr = String(targetId).trim();
  if (!targetStr) return undefined;
  return activities.find((a) => a && a.id !== null && a.id !== undefined && String(a.id).trim() === targetStr);
}

/**
 * Resolves the Activity associated with a group chat (supports string/number activityId,
 * actividad_id, and legacy title matching strictly for activity-associated chats).
 */
export function resolveActivityForChat<T extends { id?: number | string; title?: string; titulo?: string }>(
  chat: any,
  activities: T[] | null | undefined
): T | undefined {
  if (!chat || !Array.isArray(activities) || activities.length === 0) {
    return undefined;
  }

  const rawActId = chat.activityId ?? chat.actividad_id;
  if (rawActId !== undefined && rawActId !== null && String(rawActId).trim() !== '') {
    const byId = resolveActivityById(activities, rawActId);
    if (byId) return byId;
  }

  const isActivityChat = Boolean(
    (rawActId !== undefined && rawActId !== null && String(rawActId).trim() !== '') ||
    chat.tipo === 'grupo_actividad' ||
    String(chat.subtitle || '').toLowerCase().startsWith('canal de la actividad:')
  );

  if (!isActivityChat) {
    return undefined;
  }

  const cleanChatTitle = cleanGroupTitle(chat.title || chat.name || chat.nombre);
  if (!cleanChatTitle) {
    return undefined;
  }

  return activities.find((a) => a && cleanGroupTitle(a.title || a.titulo) === cleanChatTitle);
}

/**
 * Builds the attendance sheet (Nómina de Participantes) rows with each participant's
 * emergency contact resolved from the Supabase users map (matching id, usuario, apodo, or nombre).
 */
export function buildAttendanceNomina(
  enrolledNames: string[],
  usersMap: Record<string, any> | null | undefined
): Array<{ nombre: string; contacto: string }> {
  const contactosMap: Record<string, string> = {};
  if (usersMap && typeof usersMap === 'object') {
    Object.values(usersMap).forEach((u: any) => {
      if (!u || typeof u !== 'object') return;
      const num = String(u.contactoEmergencia || u.contacto_emergencia || '').trim();
      ['id', 'usuario', 'apodo', 'nombre'].forEach((k) => {
        if (u[k]) {
          contactosMap[String(u[k]).trim().toLowerCase()] = num;
        }
      });
    });
  }

  return (Array.isArray(enrolledNames) ? enrolledNames : []).map((n) => {
    const cleanName = String(n || '').trim();
    const key = cleanName.toLowerCase();
    return {
      nombre: cleanName,
      contacto: contactosMap[key] || '-'
    };
  });
}

