import type { SanctionRecord, SecurityReport } from '../types.ts';
import { formatArgentinaDateOnly, formatArgentinaDateTime, parseArgentinaDateTime } from './argentinaTime.ts';
import { chatIdentifierToBigInt } from './chatLogic.ts';

export const ADMIN_REMOVED_MESSAGE_TEXT =
  'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65';

export const MODERATOR_REMOVED_MESSAGE_TEXT =
  'Este mensaje fue retirado por el moderador del grupo.';

export const ADMIN_REMOVED_REVIEW_TEXT =
  'Esta reseña fue retirada por no cumplir con las condiciones de uso de CLUB65';

export const ADMIN_REMOVED_REVIEW_MEDIA_TEXT =
  'Este contenido multimedia fue retirado por no cumplir con las condiciones de uso de CLUB65';

export const RETIRED_REVIEW_MEDIA_MARKER = 'club65://retired-media';

const DAY_MS = 24 * 60 * 60 * 1000;

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  return UUID_REGEX.test(String(value).trim());
}

export function resolveAuthenticatedReportUuid(candidates: {
  authUserId?: unknown;
  sessionUserId?: unknown;
  profileSupabaseId?: unknown;
  profileId?: unknown;
  fallbackUserId?: unknown;
}): string {
  const ordered = [
    candidates.authUserId,
    candidates.sessionUserId,
    candidates.profileSupabaseId,
    candidates.profileId,
    candidates.fallbackUserId
  ];
  for (const cand of ordered) {
    const clean = cand !== undefined && cand !== null ? String(cand).trim() : '';
    if (clean && isValidUuid(clean)) {
      return clean;
    }
  }
  return '';
}

export function requireSupabaseSessionUserId(
  session: { user?: { id?: unknown } | null } | null | undefined,
  options?: { requireUuid?: boolean; errorMessage?: string }
): string {
  const rawId = session?.user?.id;
  const userId = rawId !== undefined && rawId !== null ? String(rawId).trim() : '';
  const requireUuid = options?.requireUuid ?? true;

  if (!userId || userId.toLowerCase().startsWith('usr_')) {
    const err: any = new Error(
      options?.errorMessage || 'Debés iniciar sesión con una cuenta autenticada para continuar.'
    );
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  if (requireUuid && !isValidUuid(userId)) {
    const err: any = new Error(
      options?.errorMessage ||
        'Tu sesión actual no cuenta con un identificador UUID válido de autenticación. Por favor cerrá sesión y volvé a iniciar sesión.'
    );
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  return userId;
}

export interface ResolvedReportActor {
  isAuthenticated: boolean;
  denuncianteUuid: string | null;
  legacyUserId: string | null;
  actorId: string;
  reporterUsername: string;
}

export function resolveReportActorFromSources(sources: {
  session?: { user?: { id?: unknown; email?: unknown; user_metadata?: Record<string, any> } | null } | null;
  authUser?: { id?: unknown; email?: unknown; user_metadata?: Record<string, any> } | null;
  dbUser?: { id?: unknown; usuario?: unknown; apodo?: unknown; email?: unknown; tipo?: unknown; rol?: unknown } | null;
}): ResolvedReportActor {
  const sessionId =
    sources.session?.user?.id !== undefined && sources.session?.user?.id !== null
      ? String(sources.session.user.id).trim()
      : '';
  const authUserId =
    sources.authUser?.id !== undefined && sources.authUser?.id !== null
      ? String(sources.authUser.id).trim()
      : '';
  const dbUserId =
    sources.dbUser?.id !== undefined && sources.dbUser?.id !== null
      ? String(sources.dbUser.id).trim()
      : '';

  const denuncianteUuid =
    [sessionId, authUserId, dbUserId].find((cand) => Boolean(cand) && isValidUuid(cand)) || null;

  const legacyUserId =
    !denuncianteUuid && dbUserId ? dbUserId : null;

  const actorId = denuncianteUuid || legacyUserId || '';
  const isAuthenticated = Boolean(actorId);

  const sessionMeta =
    sources.session?.user?.user_metadata ||
    sources.authUser?.user_metadata ||
    {};
  const rawEmail =
    sources.dbUser?.email ||
    sources.session?.user?.email ||
    sources.authUser?.email ||
    '';
  const emailLocalPart =
    typeof rawEmail === 'string' && rawEmail.includes('@')
      ? rawEmail.split('@')[0]
      : '';

  const reporterUsername =
    normalizeIdentifierToken(
      sources.dbUser?.usuario ||
        sources.dbUser?.apodo ||
        sessionMeta.usuario ||
        sessionMeta.apodo ||
        emailLocalPart
    ) || 'vecino';

  return {
    isAuthenticated,
    denuncianteUuid,
    legacyUserId,
    actorId,
    reporterUsername
  };
}

export function normalizeIdentifierToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/^@+/, '')
    .toLowerCase();
}

export function extractUserCandidateTokens(user: any): string[] {
  if (!user || typeof user !== 'object') return [];
  const rawValues = [
    user.id,
    user.supabaseId,
    user.usuario,
    user.username,
    user.apodo,
    user.nombre,
    user.email
  ];
  const tokens = new Set<string>();
  for (const val of rawValues) {
    if (!val) continue;
    const raw = String(val).trim().toLowerCase();
    const stripped = normalizeIdentifierToken(val);
    if (raw) tokens.add(raw);
    if (stripped) tokens.add(stripped);
  }
  return Array.from(tokens);
}

export function findMatchingUserRow<T extends Record<string, any>>(
  users: T[],
  identifier: string,
  optionalUserId?: string
): T | undefined {
  const list = (users || []).filter(u => u && u.estado_alta !== 'eliminado' && u.estadoAlta !== 'eliminado');
  const cleanId = String(optionalUserId || '').trim().toLowerCase();
  if (cleanId) {
    const byOptId = list.find(u => String(u.id || '').trim().toLowerCase() === cleanId);
    if (byOptId) return byOptId;
  }

  const target = normalizeIdentifierToken(identifier);
  const rawLower = String(identifier || '').trim().toLowerCase();
  if (!target && !rawLower) return undefined;

  // Priority 1: exact id, usuario, username, or email
  const exactIdentity = list.find(u => {
    const idTok = normalizeIdentifierToken(u.id);
    const userTok = normalizeIdentifierToken(u.usuario || u.username);
    const emailTok = String(u.email || '').trim().toLowerCase();
    return (
      (idTok && idTok === target) ||
      (userTok && userTok === target) ||
      (emailTok && (emailTok === rawLower || emailTok === target))
    );
  });
  if (exactIdentity) return exactIdentity;

  // Priority 2: exact apodo or nombre
  return list.find(u => {
    const apodoTok = normalizeIdentifierToken(u.apodo);
    const nombreTok = normalizeIdentifierToken(u.nombre);
    return (apodoTok && apodoTok === target) || (nombreTok && nombreTok === target);
  });
}

export function safeParseJsonText<T = any>(
  rawText: string | null | undefined,
  contentType?: string | null
): { isJson: boolean; data: T | null } {
  const trimmed = String(rawText ?? '').trim();
  if (!trimmed) return { isJson: false, data: null };
  if (trimmed.startsWith('<')) return { isJson: false, data: null };
  const ct = String(contentType ?? '').toLowerCase();
  if (ct && !ct.includes('json') && !trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { isJson: false, data: null };
  }
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return { isJson: false, data: null };
  }
  try {
    return { isJson: true, data: JSON.parse(trimmed) as T };
  } catch {
    return { isJson: false, data: null };
  }
}

export async function safeParseJson<T = any>(
  res: Response
): Promise<{ ok: boolean; status: number; isJson: boolean; data: T | null }> {
  try {
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();
    const parsed = safeParseJsonText<T>(text, contentType);
    return { ok: res.ok, status: res.status, isJson: parsed.isJson, data: parsed.data };
  } catch {
    return { ok: res.ok, status: res.status, isJson: false, data: null };
  }
}

function tryParseJsonEnvelope(raw: unknown, markerKey: string): Record<string, any> | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed[markerKey]) {
      return parsed;
    }
  } catch {}
  return null;
}

export function normalizeReportStatus(
  status?: string
): 'pendiente' | 'resuelto' | 'desestimado' {
  const low = String(status || '').trim().toLowerCase();
  if (low === 'desestimado' || low === 'dismiss' || low === 'dismissed') {
    return 'desestimado';
  }
  if (low === 'resuelto' || low === 'resolved' || low === 'ban_user' || low === 'delete_content') {
    return 'resuelto';
  }
  return 'pendiente';
}

export function isReportPending(rep: Pick<SecurityReport, 'status'>): boolean {
  const s = String(rep?.status || '').trim().toLowerCase();
  return !s || s === 'pendiente' || s === 'pending';
}

export function isReportResolved(rep: Pick<SecurityReport, 'status'>): boolean {
  const s = String(rep?.status || '').trim().toLowerCase();
  return s === 'resolved' || s === 'resuelto' || s === 'desestimado';
}

export function mapSupabaseReportRow(row: any): SecurityReport {
  const reporterMeta = tryParseJsonEnvelope(row?.comentario_denunciante, '__c65_report');
  const resolutionMeta = tryParseJsonEnvelope(row?.comentario_resolucion, '__c65_resolution');

  const status = normalizeReportStatus(row?.status ?? row?.estado);
  const rawType = (row?.type || reporterMeta?.type || (row?.resena_id ? 'review_text' : 'chat_message')) as SecurityReport['type'];
  const isReviewType = rawType === 'review_text' || rawType === 'review_media';

  let parsedReviewId: any = undefined;
  const rawReviewId = row?.review_id ?? row?.resena_id ?? reporterMeta?.reviewId;
  if (rawReviewId !== null && rawReviewId !== undefined && String(rawReviewId).trim() !== '') {
    const n = Number(rawReviewId);
    parsedReviewId = !isNaN(n) && n > 0 ? n : String(rawReviewId);
  } else if (isReviewType && (row?.message_id || row?.mensaje_id)) {
    parsedReviewId = String(row?.message_id || row?.mensaje_id);
  }

  let parsedActivityId: number | undefined = undefined;
  const rawActId = row?.activity_id ?? row?.actividad_id ?? reporterMeta?.activityId;
  if (rawActId !== null && rawActId !== undefined && String(rawActId).trim() !== '') {
    const n = Number(rawActId);
    if (!isNaN(n) && n > 0) parsedActivityId = n;
  }

  let parsedMediaUrls: string[] | undefined = undefined;
  const rawMediaUrls = row?.media_urls ?? reporterMeta?.mediaUrls;
  if (Array.isArray(rawMediaUrls)) {
    parsedMediaUrls = rawMediaUrls.filter(Boolean).map(String);
  } else if (typeof rawMediaUrls === 'string' && rawMediaUrls.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(rawMediaUrls);
      if (Array.isArray(arr)) parsedMediaUrls = arr.filter(Boolean).map(String);
    } catch {}
  }
  const fallbackMediaUrl = row?.media_url || row?.mediaUrl || reporterMeta?.mediaUrl;
  if ((!parsedMediaUrls || parsedMediaUrls.length === 0) && fallbackMediaUrl) {
    parsedMediaUrls = [String(fallbackMediaUrl)];
  }

  const reporterRaw = normalizeIdentifierToken(
    row?.reporter_user ||
      row?.reporterUser ||
      reporterMeta?.reporterUser ||
      row?.denunciante_id ||
      reporterMeta?.reporterUserId ||
      ''
  );
  const reportedRaw = normalizeIdentifierToken(
    row?.reported_user || row?.reportedUser || reporterMeta?.reportedUser || ''
  );

  const createdIso = row?.created_at || row?.createdAt || row?.creado_el || undefined;
  const displayTs =
    row?.timestamp ||
    reporterMeta?.timestamp ||
    (createdIso ? formatArgentinaDateTime(createdIso) : formatArgentinaDateTime());

  const rawAdminComment =
    row?.admin_comment ??
    row?.adminComment ??
    resolutionMeta?.adminComment ??
    (!resolutionMeta && row?.comentario_resolucion ? row.comentario_resolucion : undefined);

  const adminCommentRaw =
    rawAdminComment !== undefined && rawAdminComment !== null && String(rawAdminComment).trim() !== ''
      ? String(rawAdminComment).trim()
      : '-';

  const rawResNote = row?.resolution_note ?? row?.resolutionNote ?? resolutionMeta?.resolutionNote;
  const resolutionNoteRaw =
    rawResNote !== undefined && rawResNote !== null && String(rawResNote).trim() !== ''
      ? String(rawResNote).trim()
      : '';

  const resolutionAction =
    row?.resolution_action || row?.resolutionAction || resolutionMeta?.resolutionAction || undefined;
  const sanctionType =
    row?.sanction_type || row?.sanctionType || resolutionMeta?.sanctionType || undefined;
  const alsoDeletedContent = Boolean(
    row?.also_deleted_content ?? row?.alsoDeletedContent ?? resolutionMeta?.alsoDeletedContent
  );

  const rawComment = reporterMeta
    ? String(reporterMeta.comment || '')
    : row?.comment !== undefined && row?.comment !== null
    ? String(row.comment)
    : row?.comentario_denunciante !== undefined && row?.comentario_denunciante !== null
    ? String(row.comentario_denunciante)
    : '';

  const rawMsgId = row?.message_id ?? row?.mensaje_id ?? reporterMeta?.messageId;
  const rawChatId = row?.chat_id ?? reporterMeta?.chatId;

  return {
    id: String(row?.id || ''),
    type: rawType,
    chatId: rawChatId !== null && rawChatId !== undefined ? rawChatId : undefined,
    messageId: !isReviewType && rawMsgId ? String(rawMsgId) : undefined,
    messageText: row?.message_text || row?.messageText || reporterMeta?.messageText || undefined,
    mediaUrl: fallbackMediaUrl || (parsedMediaUrls && parsedMediaUrls[0]) || undefined,
    mediaUrls: parsedMediaUrls,
    reviewId: parsedReviewId,
    activityId: parsedActivityId,
    reportedUser:
      reportedRaw ||
      (row?.reported_user
        ? String(row.reported_user).trim()
        : reporterMeta?.reportedUser
        ? String(reporterMeta.reportedUser).trim()
        : undefined),
    reporterUser:
      reporterRaw ||
      (row?.reporter_user
        ? String(row.reporter_user).trim()
        : row?.denunciante_id
        ? String(row.denunciante_id).trim()
        : 'vecino'),
    reporterUsername: reporterRaw || undefined,
    reason: String(row?.reason || row?.motivo || 'Otro'),
    comment: rawComment,
    timestamp: displayTs,
    createdAt: createdIso || displayTs,
    status,
    resolutionNote: resolutionNoteRaw || '-',
    resolutionDetail: resolutionNoteRaw && resolutionNoteRaw !== '-' ? resolutionNoteRaw : undefined,
    resolutionAction,
    resolutionDecision:
      status === 'desestimado'
        ? 'desestimado'
        : status === 'resuelto'
        ? (resolutionAction || 'resuelto')
        : undefined,
    sanctionReason:
      row?.sanction_reason ||
      row?.sanctionReason ||
      resolutionMeta?.sanctionReason ||
      row?.reason ||
      row?.motivo ||
      undefined,
    sanctionType,
    alsoDeletedContent,
    adminComment: adminCommentRaw,
    resolvedBy:
      row?.resolved_by || resolutionMeta?.resolvedBy
        ? normalizeIdentifierToken(row?.resolved_by || resolutionMeta?.resolvedBy) ||
          String(row?.resolved_by || resolutionMeta?.resolvedBy)
        : undefined,
    resolvedAt: row?.resolved_at || resolutionMeta?.resolvedAt || undefined
  };
}

function generateSafeUuid(): string {
  if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function buildSupabaseReportInsertPayload(
  report: {
    id?: string;
    type: 'chat_message' | 'review_media' | 'review_text' | 'chat_general';
    chatId?: number | string;
    messageId?: string;
    messageText?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    reviewId?: number | string;
    activityId?: number | string;
    reportedUser?: string;
    reason: string;
    comment?: string;
  },
  reporterUser: string,
  nowDate: Date = new Date(),
  reporterUserId?: string,
  options?: {
    allowNullableDenuncianteUuid?: boolean;
    legacyReporterUserId?: string;
  }
): Record<string, any> {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const id = report.id && uuidRegex.test(String(report.id)) ? String(report.id) : generateSafeUuid();

  const cleanType = report.type || 'chat_message';

  let chatIdBigInt: number | null = null;
  if (report.chatId !== undefined && report.chatId !== null && String(report.chatId).trim() !== '') {
    chatIdBigInt = chatIdentifierToBigInt(report.chatId);
  }

  let activityIdBigInt: number | null = null;
  if (report.activityId !== undefined && report.activityId !== null && String(report.activityId).trim() !== '') {
    const actNum = Number(report.activityId);
    if (!isNaN(actNum) && actNum > 0) {
      activityIdBigInt = actNum;
    }
  }

  const mediaList = Array.isArray(report.mediaUrls)
    ? report.mediaUrls.filter(Boolean).map(String)
    : report.mediaUrl
    ? [String(report.mediaUrl)]
    : null;

  const cleanReported = report.reportedUser
    ? normalizeIdentifierToken(report.reportedUser) || String(report.reportedUser).trim()
    : null;
  const cleanReporter =
    normalizeIdentifierToken(reporterUser) || String(reporterUser || 'vecino').trim() || 'vecino';

  const cleanDenuncianteId =
    reporterUserId !== undefined && reporterUserId !== null
      ? String(reporterUserId).trim()
      : '';
  const cleanLegacyId =
    options?.legacyReporterUserId !== undefined && options?.legacyReporterUserId !== null
      ? String(options.legacyReporterUserId).trim()
      : !isValidUuid(cleanDenuncianteId)
      ? cleanDenuncianteId
      : '';

  let finalDenuncianteUuid: string | null = null;
  if (cleanDenuncianteId && isValidUuid(cleanDenuncianteId)) {
    finalDenuncianteUuid = cleanDenuncianteId;
  } else if (options?.allowNullableDenuncianteUuid && cleanLegacyId) {
    finalDenuncianteUuid = null;
  } else if (!cleanDenuncianteId) {
    const authErr: any = new Error('Debés iniciar sesión para poder enviar un reporte.');
    authErr.code = 'AUTH_REQUIRED';
    throw authErr;
  } else {
    const authErr: any = new Error(
      'Tu sesión actual no cuenta con un identificador UUID válido de autenticación. Por favor cerrá sesión y volvé a iniciar sesión para enviar el reporte.'
    );
    authErr.code = 'AUTH_REQUIRED';
    throw authErr;
  }

  const cleanMotivo = String(report.reason || '').trim();
  if (!cleanMotivo) {
    throw new Error('Seleccioná un motivo para enviar el reporte.');
  }

  const cleanMensajeId =
    report.messageId !== undefined && report.messageId !== null && String(report.messageId).trim() !== ''
      ? String(report.messageId).trim()
      : null;
  const cleanResenaId =
    report.reviewId !== undefined && report.reviewId !== null && String(report.reviewId).trim() !== ''
      ? String(report.reviewId).trim()
      : null;

  const reporterMeta: Record<string, any> = {
    __c65_report: 1,
    type: cleanType,
    chatId: chatIdBigInt ?? report.chatId ?? null,
    messageId: cleanMensajeId,
    messageText: report.messageText ? String(report.messageText) : null,
    mediaUrl: report.mediaUrl ? String(report.mediaUrl) : mediaList?.[0] || null,
    mediaUrls: mediaList,
    reviewId: cleanResenaId,
    activityId: activityIdBigInt ?? report.activityId ?? null,
    reportedUser: cleanReported,
    reporterUser: cleanReporter,
    ...(cleanLegacyId ? { reporterUserId: cleanLegacyId } : {}),
    comment: report.comment ? String(report.comment).trim() : '',
    timestamp: formatArgentinaDateTime(nowDate)
  };

  return {
    id,
    denunciante_id: finalDenuncianteUuid,
    mensaje_id: cleanMensajeId,
    resena_id: cleanResenaId,
    actividad_id: activityIdBigInt,
    motivo: cleanMotivo,
    comentario_denunciante: JSON.stringify(reporterMeta),
    estado: 'pendiente'
  };
}

export function buildSupabaseReportFallbackPayloads(
  primaryPayload: Record<string, any>,
  altDenuncianteIds: string[] = []
): Record<string, any>[] {
  const candidates: Record<string, any>[] = [];
  const validUuids = Array.from(
    new Set(
      [primaryPayload.denunciante_id, ...altDenuncianteIds]
        .map(v => (v !== undefined && v !== null ? String(v).trim() : ''))
        .filter(v => Boolean(v) && isValidUuid(v))
    )
  );
  const targetDenuncianteValues: Array<string | null> =
    validUuids.length > 0
      ? validUuids
      : primaryPayload.denunciante_id === null
      ? [null]
      : [];

  // 1. If there is an alternate authenticated UUID (e.g. Supabase Auth UUID vs public.users.id), try full payload with it
  for (const dId of validUuids.slice(1)) {
    candidates.push({
      ...primaryPayload,
      denunciante_id: dId
    });
  }

  // 2. Core columns preserving denunciante_id + mensaje_id (if optional resena_id / actividad_id failed FK or type)
  for (const dId of targetDenuncianteValues) {
    candidates.push({
      id: primaryPayload.id,
      denunciante_id: dId,
      mensaje_id: primaryPayload.mensaje_id ?? null,
      motivo: primaryPayload.motivo,
      comentario_denunciante: primaryPayload.comentario_denunciante,
      estado: primaryPayload.estado || 'pendiente'
    });
  }

  // 3. If mensaje_id itself failed FK/type constraint (e.g. optimistic message ID), preserve denunciante_id and set mensaje_id to null (still stored inside comentario_denunciante metadata)
  if (primaryPayload.mensaje_id !== null && primaryPayload.mensaje_id !== undefined) {
    for (const dId of targetDenuncianteValues) {
      candidates.push({
        id: primaryPayload.id,
        denunciante_id: dId,
        mensaje_id: null,
        motivo: primaryPayload.motivo,
        comentario_denunciante: primaryPayload.comentario_denunciante,
        estado: primaryPayload.estado || 'pendiente'
      });
    }
  }

  // 4. If DB id is auto-generated BIGINT/IDENTITY instead of UUID text, retry omitting id while keeping mandatory columns
  for (const dId of targetDenuncianteValues) {
    candidates.push({
      denunciante_id: dId,
      mensaje_id: primaryPayload.mensaje_id ?? null,
      motivo: primaryPayload.motivo,
      comentario_denunciante: primaryPayload.comentario_denunciante,
      estado: primaryPayload.estado || 'pendiente'
    });
    if (primaryPayload.mensaje_id !== null && primaryPayload.mensaje_id !== undefined) {
      candidates.push({
        denunciante_id: dId,
        mensaje_id: null,
        motivo: primaryPayload.motivo,
        comentario_denunciante: primaryPayload.comentario_denunciante,
        estado: primaryPayload.estado || 'pendiente'
      });
    }
  }

  return candidates;
}

export function buildSupabaseReportResolvePayload(params: {
  status: 'resuelto' | 'desestimado' | 'ban_user' | 'delete_content' | 'dismiss';
  resolutionNote?: string;
  action?: string;
  sanctionReason?: string;
  adminComment?: string;
  sanctionType?: 'temporal_7' | 'temporal_30' | 'permanente';
  alsoDeletedContent?: boolean;
  resolutionDetail?: string;
  resolvedBy?: string;
  nowDate?: Date;
}): Record<string, any> {
  const isDismiss =
    params.status === 'dismiss' ||
    params.status === 'desestimado' ||
    params.action === 'desestimar' ||
    params.action === 'dismiss';

  const normalizedStatus: 'resuelto' | 'desestimado' = isDismiss ? 'desestimado' : 'resuelto';

  let normalizedAction = params.action || '';
  if (isDismiss) {
    normalizedAction = 'dismiss';
  } else if (
    params.status === 'ban_user' ||
    normalizedAction === 'sancionar' ||
    normalizedAction === 'ban_user'
  ) {
    normalizedAction = 'ban_user';
  } else if (
    params.status === 'delete_content' ||
    normalizedAction === 'eliminar' ||
    normalizedAction === 'delete_content'
  ) {
    normalizedAction = 'delete_content';
  }

  const cleanComment =
    params.adminComment && params.adminComment.trim()
      ? params.adminComment.trim()
      : '-';

  const rawDetail =
    (params.resolutionDetail && params.resolutionDetail.trim()) ||
    (params.resolutionNote && params.resolutionNote.trim() && params.resolutionNote.trim() !== '-'
      ? params.resolutionNote.trim()
      : '') ||
    (isDismiss
      ? 'Caso desestimado al no evidenciar infracciones mayores a las normas comunitarias'
      : 'Reporte procesado con éxito.');

  const resolvedAt = formatArgentinaDateTime(params.nowDate || new Date());
  const cleanResolver = normalizeIdentifierToken(params.resolvedBy) || String(params.resolvedBy || 'administrador').trim();

  const resolutionMeta = {
    __c65_resolution: 1,
    resolutionAction: normalizedAction || (isDismiss ? 'dismiss' : 'delete_content'),
    resolutionNote: rawDetail,
    sanctionReason: params.sanctionReason ? String(params.sanctionReason).trim() : null,
    sanctionType: params.sanctionType || null,
    alsoDeletedContent: isDismiss
      ? false
      : Boolean(params.alsoDeletedContent || normalizedAction === 'delete_content'),
    adminComment: cleanComment,
    resolvedBy: cleanResolver,
    resolvedAt
  };

  return {
    estado: normalizedStatus,
    comentario_resolucion: JSON.stringify(resolutionMeta)
  };
}

export function computeSanctionLiftAndExpiry(
  type: 'temporal_7' | 'temporal_30' | 'permanente' = 'temporal_7',
  nowMs: number = Date.now()
): {
  type: 'temporal_7' | 'temporal_30' | 'permanente';
  date: string;
  liftDate: string;
  expiresAt?: string;
} {
  const normalizedType: 'temporal_7' | 'temporal_30' | 'permanente' =
    type === 'temporal_30' || type === 'permanente' ? type : 'temporal_7';
  const date = formatArgentinaDateOnly(nowMs);

  if (normalizedType === 'permanente') {
    return {
      type: 'permanente',
      date,
      liftDate: 'Sin fecha (Permanente)',
      expiresAt: undefined
    };
  }

  const days = normalizedType === 'temporal_30' ? 30 : 7;
  const expiresMs = nowMs + days * DAY_MS;
  return {
    type: normalizedType,
    date,
    liftDate: formatArgentinaDateOnly(expiresMs),
    expiresAt: new Date(expiresMs).toISOString()
  };
}

function resolveSanctionExpiresAtIso(row: any): string | undefined {
  const type = row?.type;
  if (type === 'permanente') return undefined;

  if (row?.expiresAt || row?.expires_at) {
    const explicitMs = new Date(row.expiresAt || row.expires_at).getTime();
    if (!isNaN(explicitMs)) return new Date(explicitMs).toISOString();
  }

  const days = type === 'temporal_30' ? 30 : 7;
  if (row?.created_at || row?.createdAt) {
    const createdMs = new Date(row.created_at || row.createdAt).getTime();
    if (!isNaN(createdMs)) {
      return new Date(createdMs + days * DAY_MS).toISOString();
    }
  }

  const liftRaw = row?.lift_date || row?.liftDate;
  if (liftRaw && typeof liftRaw === 'string' && !liftRaw.toLowerCase().includes('permanente')) {
    const liftStartMs = parseArgentinaDateTime(liftRaw);
    if (liftStartMs > 0) {
      // End of the lift date day (Argentina UTC-3)
      return new Date(liftStartMs + DAY_MS - 1).toISOString();
    }
  }

  return undefined;
}

export function mapSupabaseSanctionRow(row: any): SanctionRecord {
  const typeRaw = String(row?.type || 'temporal_7').trim();
  const type: SanctionRecord['type'] =
    typeRaw === 'permanente'
      ? 'permanente'
      : typeRaw === 'temporal_30'
      ? 'temporal_30'
      : 'temporal_7';

  const expiresAt = resolveSanctionExpiresAtIso({ ...row, type });
  const createdMs = row?.created_at ? new Date(row.created_at).getTime() : Date.now();
  const dateDisplay =
    row?.date ||
    (!isNaN(createdMs) ? formatArgentinaDateOnly(createdMs) : formatArgentinaDateOnly());

  const liftDateDisplay =
    row?.lift_date ||
    row?.liftDate ||
    (type === 'permanente'
      ? 'Sin fecha (Permanente)'
      : expiresAt
      ? formatArgentinaDateOnly(expiresAt)
      : formatArgentinaDateOnly(Date.now() + (type === 'temporal_30' ? 30 : 7) * DAY_MS));

  return {
    id: String(row?.id || ''),
    username: normalizeIdentifierToken(row?.username) || String(row?.username || '').trim(),
    reason: String(row?.reason || 'Incumplimiento de normas comunitarias'),
    comment: row?.comment && String(row.comment).trim() ? String(row.comment).trim() : '-',
    adminUsername: normalizeIdentifierToken(row?.admin_username || row?.adminUsername) || 'administrador',
    date: dateDisplay,
    type,
    liftDate: liftDateDisplay,
    expiresAt,
    reportId: row?.report_id || row?.reportId || undefined
  };
}

export function isSanctionCurrentlyActive(sanction: any, nowMs: number = Date.now()): boolean {
  if (!sanction) return false;
  const type = sanction.type || sanction.tipo;
  if (type === 'permanente') return true;
  const exp = sanction.expiresAt || sanction.fechaExpiracion || sanction.venceAt || sanction.expires_at;
  if (exp) {
    const expMs = new Date(exp).getTime();
    if (!isNaN(expMs)) return expMs > nowMs;
  }
  const liftRaw = sanction.liftDate || sanction.lift_date;
  if (liftRaw && typeof liftRaw === 'string' && !liftRaw.toLowerCase().includes('permanente')) {
    const liftStartMs = parseArgentinaDateTime(liftRaw);
    if (liftStartMs > 0) {
      return liftStartMs + DAY_MS > nowMs;
    }
  }
  return true;
}

export function findActiveSanctionForUser(
  sanctions: any[],
  userOrIdentifiers: any,
  bannedUsers: string[] = [],
  nowMs: number = Date.now()
): SanctionRecord | null {
  const userTokens = Array.isArray(userOrIdentifiers)
    ? userOrIdentifiers.map(normalizeIdentifierToken).filter(Boolean)
    : extractUserCandidateTokens(userOrIdentifiers);

  if (userTokens.length === 0) return null;

  for (const s of sanctions || []) {
    if (!s) continue;
    const sTokens = [
      s.userId,
      s.username,
      s.usuario,
      s.targetUser,
      s.identifier
    ]
      .map(normalizeIdentifierToken)
      .filter(Boolean);

    if (!sTokens.some(st => userTokens.includes(st))) continue;
    if (isSanctionCurrentlyActive(s, nowMs)) {
      return s;
    }
  }

  const normalizedBans = (bannedUsers || []).map(normalizeIdentifierToken).filter(Boolean);
  if (normalizedBans.some(b => userTokens.includes(b))) {
    return {
      id: 'ban_global',
      username: userTokens[0],
      reason: 'Suspensión aplicada por moderación',
      comment: '-',
      adminUsername: 'administrador',
      date: formatArgentinaDateOnly(nowMs),
      type: 'permanente',
      liftDate: 'Sin fecha (Permanente)'
    };
  }

  return null;
}

export function formatSuspendedLoginError(sanction: Partial<SanctionRecord> | null | undefined, nowMs: number = Date.now()): string {
  if (!sanction) {
    return 'Tu cuenta se encuentra suspendida por incumplimiento de las normas comunitarias de CLUB65.';
  }
  let duracion = 'por el plazo establecido';
  if (sanction.type === 'permanente') {
    duracion = 'de forma permanente';
  } else if (sanction.expiresAt) {
    const dias = Math.max(1, Math.ceil((new Date(sanction.expiresAt).getTime() - nowMs) / DAY_MS));
    duracion = `por ${dias} día(s)`;
  } else if (sanction.type === 'temporal_30') {
    duracion = 'por 30 días';
  } else if (sanction.type === 'temporal_7') {
    duracion = 'por 7 días';
  }
  const motivo = sanction.reason || 'Incumplimiento de las normas comunitarias';
  return `Acceso denegado: tu cuenta está suspendida ${duracion}. Motivo: ${motivo}.`;
}

export function removeMediaUrlFromReviewList(
  mediaUrls: string[] | null | undefined,
  targetMediaUrl: string
): string[] {
  const cleanTarget = String(targetMediaUrl || '').trim();
  if (!Array.isArray(mediaUrls) || !cleanTarget) return Array.isArray(mediaUrls) ? mediaUrls : [];
  return mediaUrls.filter(u => String(u || '').trim() !== cleanTarget);
}

export function isRetiredReviewMediaItem(url?: string | null): boolean {
  if (!url || typeof url !== 'string') return false;
  const clean = url.trim();
  return (
    clean === RETIRED_REVIEW_MEDIA_MARKER ||
    clean === '__CLUB65_RETIRED_MEDIA__' ||
    clean === ADMIN_REMOVED_REVIEW_MEDIA_TEXT
  );
}

export function isReviewRetired(review: any): boolean {
  if (!review || typeof review !== 'object') return false;
  if (
    Boolean(
      review.retiradoDeLaVista ||
        review.retirado_de_la_vista ||
        review.deletedByAdmin ||
        review.deleted_by_admin
    )
  ) {
    return true;
  }
  const rawText = String(review.texto ?? review.comentario ?? '').trim().toLowerCase();
  return rawText.includes('esta reseña fue retirada por no cumplir con las condiciones de uso de club65');
}

export function resolveReviewDisplay(review: any): {
  isRetired: boolean;
  text: string;
} {
  if (isReviewRetired(review)) {
    return {
      isRetired: true,
      text: ADMIN_REMOVED_REVIEW_TEXT
    };
  }
  return {
    isRetired: false,
    text: String(review?.texto ?? review?.comentario ?? '')
  };
}

export function replaceMediaUrlWithRetiredMarker(
  mediaUrls: string[] | null | undefined,
  targetMediaUrl: string
): string[] {
  const cleanTarget = String(targetMediaUrl || '').trim();
  if (!Array.isArray(mediaUrls)) {
    return cleanTarget ? [RETIRED_REVIEW_MEDIA_MARKER] : [];
  }
  if (!cleanTarget) return mediaUrls;
  let replaced = false;
  const next = mediaUrls.map(u => {
    if (String(u || '').trim() === cleanTarget) {
      replaced = true;
      return RETIRED_REVIEW_MEDIA_MARKER;
    }
    return u;
  });
  return replaced ? next : next;
}

export interface RemovedMessageDisplayState {
  isDeleted: boolean;
  deletedByAdmin: boolean;
  deletedByGroupModerator: boolean;
  text: string;
}

export function resolveRemovedMessageDisplay(row: any): RemovedMessageDisplayState {
  const rawText = String(row?.text ?? row?.texto ?? row?.content ?? row?.contenido ?? row?.mensaje ?? '');
  const rawLower = rawText.toLowerCase();

  const explicitDeleted = Boolean(
    row?.is_deleted || row?.isDeleted || row?.retirado || row?.eliminado
  );
  const hasAdminNoticeText = rawLower.includes('condiciones de uso');
  const hasModNoticeText = rawLower.includes('retirado por el moderador del grupo');
  const rawByAdmin = Boolean(row?.deleted_by_admin || row?.deletedByAdmin);
  const rawByMod = Boolean(row?.deleted_by_group_moderator || row?.deletedByGroupModerator);

  const isDeleted = Boolean(
    explicitDeleted || rawByAdmin || rawByMod || hasAdminNoticeText || hasModNoticeText
  );

  if (!isDeleted) {
    return {
      isDeleted: false,
      deletedByAdmin: false,
      deletedByGroupModerator: false,
      text: rawText
    };
  }

  // Prioridad: si fue retirado por administración (flag o texto explícito de condiciones de uso),
  // nunca degradarlo a mensaje retirado por moderador del grupo.
  if (rawByAdmin || hasAdminNoticeText) {
    return {
      isDeleted: true,
      deletedByAdmin: true,
      deletedByGroupModerator: false,
      text: ADMIN_REMOVED_MESSAGE_TEXT
    };
  }

  if (rawByMod || hasModNoticeText) {
    return {
      isDeleted: true,
      deletedByAdmin: false,
      deletedByGroupModerator: true,
      text: MODERATOR_REMOVED_MESSAGE_TEXT
    };
  }

  return {
    isDeleted: true,
    deletedByAdmin: true,
    deletedByGroupModerator: false,
    text: ADMIN_REMOVED_MESSAGE_TEXT
  };
}

