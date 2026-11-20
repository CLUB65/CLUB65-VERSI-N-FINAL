import { User, Activity, Chat, Review, Contact, ChatMessage, SecurityReport, SanctionRecord, SimulatedEmail, BajaRecord, CancelledGroupNotice } from './types.ts';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, checkSupabaseStatus } from './supabaseClient.ts';
import { formatArgentinaDateTime, formatArgentinaDateOnly, formatArgentinaTimeOnly, formatToArgentinaDate } from './utils/argentinaTime.ts';
import {
  isDummyOrSystemParticipant,
  filterRealParticipants,
  isTechnicalIdentifier,
  isHardcodedOrMockProfile,
  chatIdentifierToBigInt,
  getChatLastActivityTime,
  deduplicateMessages,
  deduplicateChats,
  parseDateToYMD,
  extractDatesFromText,
  extractTimesFromSchedule,
  isActivityPast,
  canUserEnrollActivity,
  hasFirstEncounterStarted,
  hasFirstEncounterEnded,
  filterContactsForUser,
  isSelfUserOrContact,
  validateGroupCreation,
  isUserEnrolledInActivity,
  checkActivitiesCollision,
  canUserCreateActivity,
  getActivitySessions,
  isActivityApproved,
  sanitizeProfileAvatar,
  sanitizeProfileBio,
  buildCancelledGroupNoticeMessage,
  extractCancelledGroupNoticesFromNotifications,
  removeCancelledGroupNoticeFromNotifications,
  AUTO_EXPIRED_PROPOSAL_REASON,
  hasProposalStartPassed,
  isPendingProposalExpired,
  isProposalRejected,
  isUserGroupModerator,
  isUserRemovedFromChat,
  isUserLeftVoluntarilyFromChat,
  resolveBajaAdminDisplay,
  isAdministratorUser
} from './utils/chatLogic.ts';
import { buildResubmitProposalFields, doesDbChatRowMatchActivity, resolveActivityVideoUrl, isMissingVideoUrlColumnError } from './utils/proposalLogic.ts';
import {
  normalizeAdminPromotionIdentifier,
  findPromotableUserCandidate,
  buildSupabaseAdminPromotionPayload,
  isOfficialAdminRow
} from './utils/adminPromotion.ts';
import {
  ADMIN_REMOVED_MESSAGE_TEXT,
  MODERATOR_REMOVED_MESSAGE_TEXT,
  normalizeIdentifierToken,
  extractUserCandidateTokens,
  findMatchingUserRow,
  mapSupabaseReportRow,
  isValidUuid,
  resolveAuthenticatedReportUuid,
  requireSupabaseSessionUserId,
  resolveReportActorFromSources,
  buildSupabaseReportInsertPayload,
  buildSupabaseReportFallbackPayloads,
  buildSupabaseReportResolvePayload,
  computeSanctionLiftAndExpiry,
  mapSupabaseSanctionRow,
  isSanctionCurrentlyActive,
  findActiveSanctionForUser,
  formatSuspendedLoginError,
  replaceMediaUrlWithRetiredMarker,
  isReviewRetired,
  isRetiredReviewMediaItem,
  ADMIN_REMOVED_REVIEW_TEXT,
  RETIRED_REVIEW_MEDIA_MARKER,
  resolveRemovedMessageDisplay,
  safeParseJson
} from './utils/reportsAndSanctions.ts';
import * as chatService from './services/chatService.ts';
import {
  generateRecoveryCodeAndExpiry,
  sendRecoveryCodeEmail,
  validateRecoveryCodeMatch
} from './services/emailService.ts';

export { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, checkSupabaseStatus };

async function fetchActiveSanctionFromSupabase(user: any): Promise<SanctionRecord | null> {
  if (!user || !supabase) return null;
  try {
    const { data, error } = await supabase
      .from('sanctions')
      .select('id, username, reason, comment, admin_username, date, type, lift_date, expires_at, report_id, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error || !Array.isArray(data)) return null;
    const mapped = data.map(mapSupabaseSanctionRow);
    return findActiveSanctionForUser(mapped, user);
  } catch {
    return null;
  }
}

async function resolveTargetUserTokensInSupabase(identifier: string, optionalUserId?: string): Promise<{
  canonicalUsername: string;
  matchedUser: any | null;
  tokens: string[];
}> {
  const cleanFallback = normalizeIdentifierToken(identifier) || String(identifier || '').trim();
  const baseTokens = new Set<string>();
  if (cleanFallback) baseTokens.add(cleanFallback);
  if (identifier && String(identifier).trim()) {
    baseTokens.add(String(identifier).trim().toLowerCase());
  }
  if (optionalUserId && String(optionalUserId).trim()) {
    baseTokens.add(String(optionalUserId).trim().toLowerCase());
  }

  if (!supabase || (!cleanFallback && !optionalUserId)) {
    return { canonicalUsername: cleanFallback, matchedUser: null, tokens: Array.from(baseTokens) };
  }

  try {
    const { data: usersRows } = await supabase
      .from('users')
      .select('id, usuario, apodo, email, tipo, rol, estado_alta, notifications')
      .neq('estado_alta', 'eliminado')
      .limit(50);

    if (Array.isArray(usersRows)) {
      const matched = findMatchingUserRow(usersRows, identifier, optionalUserId);
      if (matched) {
        const canonical = normalizeIdentifierToken(matched.usuario) || normalizeIdentifierToken(matched.apodo) || cleanFallback;
        const allToks = Array.from(new Set([...baseTokens, ...extractUserCandidateTokens(matched)]));
        return { canonicalUsername: canonical, matchedUser: matched, tokens: allToks };
      }
    }
  } catch (err) {
    console.warn('No se pudo resolver usuario objetivo en Supabase:', err);
  }

  return { canonicalUsername: cleanFallback, matchedUser: null, tokens: Array.from(baseTokens) };
}

async function appendUserNotificationInSupabase(identifier: string, text: string, optionalUserId?: string): Promise<void> {
  if (!supabase || (!identifier && !optionalUserId)) return;
  try {
    const { matchedUser } = await resolveTargetUserTokensInSupabase(identifier, optionalUserId);
    if (!matchedUser?.id) return;
    const existingNotifs = Array.isArray(matchedUser.notifications) ? matchedUser.notifications : [];
    const newNotif = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      text,
      time: formatArgentinaTimeOnly(new Date()),
      read: false
    };
    const nextNotifs = [newNotif, ...existingNotifs];
    cachedNotificationsByUser.set(String(matchedUser.id), nextNotifs);
    await supabase.from('users').update({ notifications: nextNotifs }).eq('id', matchedUser.id);
  } catch (err) {
    console.warn('Error enviando notificación in-app en Supabase:', err);
  }
}

const SESSION_KEY = 'club65_current_user_id';

export function getStoredUserId(): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(SESSION_KEY) : null;
  } catch {
    return null;
  }
}

export function setStoredUserId(id: string | null) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (id) {
      localStorage.setItem(SESSION_KEY, id);
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {}
}

export function clearBrowserSessionKeys() {
  setStoredUserId(null);
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem('club65_user_id');
    localStorage.removeItem('club65_user');
    localStorage.removeItem('user');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('club65_current_user_name');
    localStorage.removeItem('left_chats_local');
    localStorage.removeItem('deleted_chats_local');
  } catch (_) {}
}

async function resolveVerifiedSupabaseCaller(options?: {
  candidateUserId?: string;
  errorMessage?: string;
}): Promise<{
  session: any;
  authUser: any;
  dbUser: any;
  actor: ReturnType<typeof resolveReportActorFromSources>;
}> {
  const errMessage =
    options?.errorMessage ||
    'Debés iniciar sesión con una cuenta autenticada para continuar.';

  let session: any = null;
  let authUser: any = null;
  try {
    const res = await supabase.auth.getSession();
    session = res?.data?.session || null;
    authUser = session?.user || null;
  } catch {}

  if (!authUser && typeof supabase?.auth?.getUser === 'function') {
    try {
      const userRes = await supabase.auth.getUser();
      if (userRes?.data?.user) authUser = userRes.data.user;
    } catch {}
  }

  const storedId = getStoredUserId();
  const candidateIds = Array.from(
    new Set(
      [
        session?.user?.id,
        authUser?.id,
        storedId,
        options?.candidateUserId,
        cachedCurrentUser?.id
      ]
        .map(v => (v !== undefined && v !== null ? String(v).trim() : ''))
        .filter(Boolean)
    )
  );

  let dbUser: any = null;
  if (supabase) {
    for (const targetId of candidateIds) {
      try {
        const { data: row } = await supabase
          .from('users')
          .select('id, usuario, apodo, email, tipo, rol, estado_alta')
          .eq('id', targetId)
          .neq('estado_alta', 'eliminado')
          .maybeSingle();
        if (row) {
          dbUser = row;
          break;
        }
      } catch {}
    }

    if (!dbUser && (session?.user?.email || authUser?.email)) {
      try {
        const authEmail = String(session?.user?.email || authUser?.email).trim();
        const { data: byEmail } = await supabase
          .from('users')
          .select('id, usuario, apodo, email, tipo, rol, estado_alta')
          .ilike('email', authEmail)
          .neq('estado_alta', 'eliminado')
          .maybeSingle();
        if (byEmail) {
          dbUser = byEmail;
        }
      } catch {}
    }
  }

  if (dbUser) {
    const esInst = dbUser.tipo === 'institucional' || dbUser.rol === 'institucional';
    if (esInst && dbUser.estado_alta !== 'aprobada') {
      dbUser = null;
    }
  }

  const actor = resolveReportActorFromSources({
    session,
    authUser,
    dbUser
  });

  if (!actor.isAuthenticated) {
    const authErr: any = new Error(errMessage);
    authErr.code = 'AUTH_REQUIRED';
    throw authErr;
  }

  return { session, authUser, dbUser, actor };
}

// Centralized cache and in-flight request deduplication to stop excessive PostgREST egress
let usersInFlightPromise: Promise<Record<string, User>> | null = null;
let cachedUsersMap: Record<string, User> | null = null;
let lastUsersFetchTime = 0;

let activitiesInFlightPromise: Promise<Activity[]> | null = null;
let cachedActivitiesList: Activity[] | null = null;
let lastActivitiesFetchTime = 0;

let reviewsInFlightPromise: Promise<Review[]> | null = null;
let cachedReviewsList: Review[] | null = null;
let lastReviewsFetchTime = 0;

let institutionsInFlightPromise: Promise<User[]> | null = null;
let cachedInstitutionsList: User[] | null = null;
let lastInstitutionsFetchTime = 0;

let currentUserInFlightPromise: Promise<User | null> | null = null;
let cachedCurrentUser: User | null = null;
let lastCurrentUserFetchTime = 0;

const userAvatarCache = new Map<string, string>();
const userAvatarInFlight = new Map<string, Promise<string>>();

const cachedNotificationsByUser = new Map<string, any[]>();
const notificationsReadInFlight = new Map<string, Promise<any[]>>();
const markReadWriteInFlight = new Map<string, Promise<any>>();
const expiringProposalIdsInFlight = new Set<string>();

function parseRejectionMeta(raw: any): { rejectedAt?: string; rejectedTimestamp?: number } {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      return {
        rejectedAt: typeof parsed.rejectedAt === 'string' ? parsed.rejectedAt : undefined,
        rejectedTimestamp: typeof parsed.rejectedTimestamp === 'number' ? parsed.rejectedTimestamp : undefined
      };
    }
  } catch (_) {}
  return {};
}

export function invalidateApiCaches() {
  cachedCurrentUser = null;
  lastCurrentUserFetchTime = 0;
  currentUserInFlightPromise = null;
  cachedUsersMap = null;
  lastUsersFetchTime = 0;
  usersInFlightPromise = null;
  cachedActivitiesList = null;
  lastActivitiesFetchTime = 0;
  activitiesInFlightPromise = null;
  cachedReviewsList = null;
  lastReviewsFetchTime = 0;
  reviewsInFlightPromise = null;
  cachedInstitutionsList = null;
  lastInstitutionsFetchTime = 0;
  institutionsInFlightPromise = null;
  userAvatarCache.clear();
  userAvatarInFlight.clear();
  cachedNotificationsByUser.clear();
  notificationsReadInFlight.clear();
  markReadWriteInFlight.clear();
  expiringProposalIdsInFlight.clear();
}

export function resolveUserRole(row: any): 'moderador' | 'institucional' | 'personal' {
  if (!row) return 'personal';
  const candidates = [row.tipo, row.rol].filter(Boolean).map(s => String(s).toLowerCase().trim());
  if (candidates.some(c => c === 'moderador' || c === 'admin' || c === 'administrador')) {
    return 'moderador';
  }
  if (candidates.some(c => c === 'institucional')) {
    return 'institucional';
  }
  return 'personal';
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };

  // 1. Obtener id directo guardado
  let userId = getStoredUserId();
  let userRole = '';

  // 2. Si no está, buscarlo en los objetos de usuario cacheados
  if (!userId) {
    const cached = localStorage.getItem('club65_user') || localStorage.getItem('user');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        userId = parsed.id || parsed.usuario || parsed.apodo || parsed.supabaseId;
        userRole = parsed.tipo || parsed.rol || '';
      } catch (_) {}
    }
  } else {
    const cached = localStorage.getItem('club65_user') || localStorage.getItem('user');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.id === userId || parsed.usuario === userId) {
          userRole = parsed.tipo || parsed.rol || '';
        }
      } catch (_) {}
    }
  }

  // 3. Obtener el nombre o apodo humano para x-user-name
  let userDisplayName = '';
  const cachedUser = localStorage.getItem('club65_user') || localStorage.getItem('user');
  if (cachedUser) {
    try {
      const parsed = JSON.parse(cachedUser);
      userDisplayName = parsed.apodo || parsed.usuario || parsed.nombre || '';
    } catch (_) {}
  }
  if (!userDisplayName || isTechnicalIdentifier(userDisplayName)) {
    const storedName = localStorage.getItem('club65_current_user_name');
    if (storedName && !isTechnicalIdentifier(storedName)) {
      userDisplayName = storedName;
    }
  }

  // Si aún no hay userId, intentar leerlo del nombre de sesión
  if (!userId) {
    userId = localStorage.getItem('club65_current_user_name') || localStorage.getItem('currentUser');
  }

  if (userId) {
    const finalVal = String(userId).trim();
    headers['x-user-id'] = finalVal;
    headers['x-user-name'] = encodeURIComponent(userDisplayName && !isTechnicalIdentifier(userDisplayName) ? userDisplayName : finalVal);
  }
  if (userRole) {
    headers['x-user-role'] = String(userRole).trim();
  }

  return headers;
}

/**
 * Sube un archivo de soporte institucional (constancia CUIT o personería) a Supabase Storage
 * en el bucket 'documentos-institucionales'. Si el bucket no existiese, retorna el dataUrl
 * de forma segura como fallback sin interrumpir la operación.
 */
export async function uploadInstitutionalDocToStorage(
  fileData: { name: string; size: number; type: string; dataUrl?: string; file?: File },
  userFolder: string,
  docType: 'cuit' | 'personeria'
): Promise<string> {
  if (!fileData) return '';

  if (fileData.dataUrl?.startsWith('http://') || fileData.dataUrl?.startsWith('https://')) {
    return fileData.dataUrl;
  }

  try {
    const bucketName = 'documentos-institucionales';
    const cleanFolder = (userFolder || 'inst').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeExt = fileData.name.split('.').pop() || (fileData.type.includes('pdf') ? 'pdf' : 'png');
    const cleanFileName = fileData.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const storagePath = `${cleanFolder}/${docType}_${Date.now()}_${cleanFileName}.${safeExt}`;

    let fileBlob: Blob;
    if (fileData.file) {
      fileBlob = fileData.file;
    } else if (fileData.dataUrl?.startsWith('data:')) {
      const parts = fileData.dataUrl.split(',');
      const mime = parts[0].match(/:(.*?);/)?.[1] || fileData.type || 'application/octet-stream';
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      fileBlob = new Blob([u8arr], { type: mime });
    } else if (fileData.dataUrl?.startsWith('blob:')) {
      const resp = await fetch(fileData.dataUrl);
      fileBlob = await resp.blob();
    } else {
      fileBlob = new Blob([fileData.dataUrl || ''], { type: fileData.type || 'application/pdf' });
    }

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, fileBlob, {
        contentType: fileData.type || 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.warn(`[Storage] Advertencia al subir ${docType} al bucket '${bucketName}':`, uploadError.message);
      return fileData.dataUrl || '';
    }

    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(storagePath);

    return publicUrlData?.publicUrl || fileData.dataUrl || '';
  } catch (err) {
    console.warn(`[Storage] Error al subir ${docType} a Storage:`, err);
    return fileData.dataUrl || '';
  }
}

function mapSupabaseUser(row: any): User {
  const roleType = resolveUserRole(row);

  let instMeta: any = {};
  if (row.legal_representative && typeof row.legal_representative === 'string') {
    const trimmed = row.legal_representative.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        instMeta = JSON.parse(trimmed);
      } catch {}
    }
  }

  const pres = instMeta.presidente || instMeta.presidenteFuncionario || row.legal_representative || row.legalRepresentative || '';
  const man = instMeta.manager || instMeta.managerNombre || instMeta.gestor || instMeta.gestorNombre || row.managerNombre || row.gestorNombre || '';
  const mRol = instMeta.managerRol || instMeta.gestorRol || row.managerRol || row.gestorRol || '';
  const dirFis = instMeta.direccion || instMeta.direccionFisica || row.direccionFisica || '';
  const webRed = instMeta.sitioWeb || instMeta.sitioWebRedSocial || row.sitioWebRedSocial || '';
  const cCuitUrl = row.documento_cuit_url || row.documentoCuitUrl || instMeta.documento_cuit_url || instMeta.constanciaCuitUrl || row.constanciaCuitUrl || '';
  const cCuitNom = instMeta.constanciaCuitNombre || row.constanciaCuitNombre || (cCuitUrl ? 'Constancia_CUIT_ARCA.pdf' : '');
  const pDocUrl = row.documento_personeria_url || row.documentoPersoneriaUrl || instMeta.documento_personeria_url || instMeta.personeriaDocUrl || row.personeriaDocUrl || '';
  const pDocNom = instMeta.personeriaDocNombre || row.personeriaDocNombre || (pDocUrl ? 'Acreditacion_Personeria.pdf' : '');
  const rawAltaPor = instMeta.altaPor || instMeta.alta_por || row.alta_por || row.altaPor || '';
  const altaPorUsuario = (instMeta.altaPorUsuario || (rawAltaPor ? rawAltaPor.replace(/^@/, '').split(' ')[0].replace(/[()]/g, '') : '') || '').replace(/^@/, '');
  const altaPorVal = altaPorUsuario ? `@${altaPorUsuario}` : (rawAltaPor ? (rawAltaPor.startsWith('@') ? rawAltaPor : `@${rawAltaPor}`) : '');
  const altaPorApodo = instMeta.altaPorApodo || altaPorUsuario;
  const fechaAltaVal = instMeta.fechaAlta || instMeta.fecha_alta || row.fecha_alta || row.fechaAlta || '';
  const telContact = row.contacto_institucional || row.contactoInstitucional || '';
  const estadoAltaVal = row.estado_alta || row.estadoAlta || (roleType === 'institucional' ? 'pendiente' : 'aprobada');

  // Solo perfil Administrador (moderador) e Institucional verificado llevan tilde.
  // Los usuarios con perfil personal NO tienen tilde de verificación.
  const isVerifiedAccount = roleType === 'moderador' ? true : (roleType === 'institucional' ? Boolean(row.is_verified ?? row.isVerified ?? false) : false);

  return {
    id: String(row.id),
    usuario: row.usuario,
    email: row.email || undefined,
    clave: row.clave || undefined,
    apodo: row.apodo || row.usuario,
    avatar: sanitizeProfileAvatar(row.avatar || row.foto || row.photo_url || row.image || row.avatar_url) || '',
    bio: sanitizeProfileBio(row.bio) || '',
    contactoEmergencia: row.contacto_emergencia || row.contactoEmergencia || '',
    textSize: row.text_size || 'normal',
    contrast: Boolean(row.contrast),
    tipo: roleType,
    rol: roleType,
    localidad: dirFis ? `${row.localidad || ''} (${dirFis})`.trim() : (row.localidad || ''),
    direccionFisica: dirFis,
    sitioWebRedSocial: webRed,
    isVerified: isVerifiedAccount,
    estadoAlta: estadoAltaVal,
    estado_alta: estadoAltaVal,
    cuit: row.cuit,
    legalRepresentative: pres,
    responsableLegal: pres,
    presidenteFuncionario: pres,
    managerNombre: man,
    managerRol: mRol,
    gestorNombre: man,
    gestorRol: mRol,
    altaPor: altaPorVal,
    altaPorUsuario: altaPorUsuario,
    altaPorApodo: altaPorApodo,
    fechaAlta: fechaAltaVal,
    documento_cuit_url: cCuitUrl,
    documentoCuitUrl: cCuitUrl,
    documento_personeria_url: pDocUrl,
    documentoPersoneriaUrl: pDocUrl,
    constanciaCuitUrl: cCuitUrl,
    constanciaCuitNombre: cCuitNom,
    personeriaDocUrl: pDocUrl,
    personeriaDocNombre: pDocNom,
    documentoLegal: pDocNom || cCuitNom || row.documentoLegal || 'Documento_Legal.pdf',
    documentoDescargaUrl: pDocUrl || cCuitUrl || row.documentoDescargaUrl || '',
    contactoInstitucional: telContact,
    contacto_institucional: telContact,
    entidadTipo: row.entidad_tipo || row.entidadTipo || '',
    blockedUsers: Array.isArray(row.blocked_users) ? row.blocked_users : [],
    myBlockedUsers: Array.isArray(row.blocked_users) ? row.blocked_users : [],
    blockedByUsers: [],
    notifications: Array.isArray(row.notifications) ? row.notifications : [],
    createdAt: row.created_at
  };
}

export const api = {
  async getCurrentUser(): Promise<User | null> {
    return this.getMe();
  },
  async login(usuarioOrEmail: string, clave: string): Promise<User> {
    const raw = (usuarioOrEmail || '').trim();
    if (!raw || !clave) {
      throw new Error('Por favor ingresá tu usuario o correo electrónico y contraseña.');
    }

    const cleanHandle = raw.startsWith('@') ? raw.slice(1).trim() : raw;
    let emailToAuth = cleanHandle.toLowerCase();

    // If input is not an email, find corresponding email in public.users
    if (!emailToAuth.includes('@')) {
      const { data: userRow } = await supabase
        .from('users')
        .select('email')
        .ilike('usuario', cleanHandle)
        .neq('estado_alta', 'eliminado')
        .maybeSingle();

      if (userRow?.email) {
        emailToAuth = userRow.email;
      }
    }

    // Attempt real Supabase Auth with password
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: emailToAuth,
      password: clave
    });

    if (authData?.user) {
      // Auth succeeded! Fetch user profile from Supabase
      let { data: profile } = await supabase
        .from('users')
        .select('id, usuario, apodo, email, avatar, bio, tipo, rol, contacto_emergencia, text_size, contrast, localidad, is_verified, estado_alta, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, blocked_users, notifications, created_at')
        .eq('id', authData.user.id)
        .neq('estado_alta', 'eliminado')
        .maybeSingle();

      if (!profile && authData.user.email) {
        const { data: profileByEmail } = await supabase
          .from('users')
          .select('id, usuario, apodo, email, avatar, bio, tipo, rol, contacto_emergencia, text_size, contrast, localidad, is_verified, estado_alta, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, blocked_users, notifications, created_at')
          .ilike('email', authData.user.email)
          .neq('estado_alta', 'eliminado')
          .maybeSingle();

        if (profileByEmail) {
          profile = profileByEmail;
        }
      }

      if (profile) {
      const u = mapSupabaseUser(profile);
      if (Array.isArray(u.notifications)) {
        cachedNotificationsByUser.set(u.id, u.notifications);
      }

      // Bloquear acceso si es institucional y no está aprobada:
      const esInstitucional = u.tipo === 'institucional' || u.rol === 'institucional';
      const estado = u.estadoAlta || profile.estado_alta;

      if (esInstitucional && estado !== 'aprobada') {
        await supabase.auth.signOut().catch(() => {});
        throw new Error('Tu cuenta institucional se encuentra pendiente de validación por el equipo de moderación.');
      }

      const activeSanction = await fetchActiveSanctionFromSupabase(u);
      if (activeSanction) {
        await supabase.auth.signOut().catch(() => {});
        clearBrowserSessionKeys();
        invalidateApiCaches();
        throw new Error(formatSuspendedLoginError(activeSanction));
      }

      setStoredUserId(u.id);
      try {
        localStorage.setItem('club65_user', JSON.stringify(u));
        localStorage.setItem('currentUser', JSON.stringify(u));
      } catch (_) {}
      invalidateApiCaches();
      return u;
    }

      // Check if the row exists but was rejected / deleted
      const { data: deletedProfile } = await supabase
        .from('users')
        .select('id, estado_alta')
        .eq('id', authData.user.id)
        .eq('estado_alta', 'eliminado')
        .maybeSingle();

      if (deletedProfile) {
        await supabase.auth.signOut().catch(() => {});
        clearBrowserSessionKeys();
        throw new Error('Tu cuenta fue dada de baja o la solicitud institucional no fue aprobada.');
      }

      // If user row not yet in public.users, create it from auth metadata (never auto-login unapproved institutions)
      const meta = authData.user.user_metadata || {};
      const metaEsInst = meta.tipo === 'institucional' || meta.rol === 'institucional';
      const newProfile = {
        id: authData.user.id,
        usuario: meta.usuario || authData.user.email?.split('@')[0] || 'vecino',
        email: authData.user.email,
        apodo: meta.apodo || authData.user.email?.split('@')[0] || 'Vecino',
        avatar: meta.avatar || '',
        bio: meta.bio || '',
        text_size: 'normal',
        contrast: false,
        tipo: meta.tipo || 'personal',
        rol: meta.tipo || 'personal',
        localidad: meta.localidad || '',
        is_verified: meta.tipo === 'moderador',
        estado_alta: metaEsInst ? 'pendiente' : 'aprobada',
        contacto_institucional: null,
        documento_cuit_url: null,
        documento_personeria_url: null,
        blocked_users: [],
        notifications: []
      };
      await supabase.from('users').upsert(newProfile);

      if (metaEsInst) {
        await supabase.auth.signOut().catch(() => {});
        clearBrowserSessionKeys();
        invalidateApiCaches();
        throw new Error('Tu cuenta institucional se encuentra pendiente de validación por el equipo de moderación.');
      }

      const u = mapSupabaseUser(newProfile);
      setStoredUserId(u.id);
      try {
        localStorage.setItem('club65_user', JSON.stringify(u));
        localStorage.setItem('currentUser', JSON.stringify(u));
      } catch (_) {}
      invalidateApiCaches();
      return u;
    }

  // Direct credentials check in public.users table as fallback
  const { data: directUser } = await supabase
    .from('users')
    .select('id, usuario, apodo, email, avatar, bio, tipo, rol, contacto_emergencia, text_size, contrast, localidad, is_verified, estado_alta, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, blocked_users, created_at')
    .or(`email.ilike.${emailToAuth},usuario.ilike.${cleanHandle}`)
    .eq('clave', clave)
    .neq('estado_alta', 'eliminado')
    .maybeSingle();

  if (directUser) {
    const u = mapSupabaseUser(directUser);

    // Bloquear acceso a cuenta institucional no aprobada
    const esInstitucional = u.tipo === 'institucional' || u.rol === 'institucional';
    const estado = u.estadoAlta || directUser.estado_alta;
    if (esInstitucional && estado !== 'aprobada') {
      throw new Error('Tu cuenta institucional se encuentra pendiente de validación por el equipo de moderación.');
    }

    const activeSanction = await fetchActiveSanctionFromSupabase(u);
    if (activeSanction) {
      await supabase.auth.signOut().catch(() => {});
      clearBrowserSessionKeys();
      invalidateApiCaches();
      throw new Error(formatSuspendedLoginError(activeSanction));
    }

    setStoredUserId(u.id);
    try {
      localStorage.setItem('club65_user', JSON.stringify(u));
      localStorage.setItem('currentUser', JSON.stringify(u));
    } catch (_) {}
    invalidateApiCaches();
    return u;
    }
    throw new Error(
      authError?.message === 'Invalid login credentials'
        ? 'Datos incorrectos. Verificá tu usuario o correo electrónico y contraseña.'
        : (authError?.message || 'Error al iniciar sesión.')
    );
  },

  async logout(): Promise<void> {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    clearBrowserSessionKeys();
    invalidateApiCaches();
  },

  async forgotPassword(email: string): Promise<{ success: boolean; message: string; email: string; usuario: string; apodo: string }> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) {
      throw new Error('Por favor ingresá un correo electrónico.');
    }

    const { data: rows, error: findErr } = await supabase
      .from('users')
      .select('id, usuario, apodo, email, estado_alta')
      .ilike('email', cleanEmail)
      .neq('estado_alta', 'eliminado')
      .limit(1);

    if (findErr) {
      throw new Error('Error al consultar la cuenta en el sistema. Intentá nuevamente.');
    }

    const userRow = rows?.[0];
    if (!userRow) {
      throw new Error('No se encontró ninguna cuenta registrada con ese correo electrónico.');
    }

    const { codigo, codigoExpira } = generateRecoveryCodeAndExpiry();

    const { error: updateErr } = await supabase
      .from('users')
      .update({
        codigo_recuperacion: codigo,
        codigo_expira: codigoExpira
      })
      .eq('id', userRow.id);

    if (updateErr) {
      throw new Error('No se pudo guardar el código de recuperación. Intentá nuevamente.');
    }

    const targetEmail = userRow.email || cleanEmail;
    const targetName = userRow.apodo || userRow.usuario || 'Vecino/a';

    try {
      await sendRecoveryCodeEmail({
        toEmail: targetEmail,
        toName: targetName,
        codigo
      });
    } catch (err) {
      console.error('Error al enviar código por EmailJS:', err);
      throw new Error('No pudimos enviar el correo con el código de verificación. Intentá nuevamente.');
    }

    return {
      success: true,
      message: `Enviamos un código de 6 dígitos a ${targetEmail}. Tiene una validez de 1 hora.`,
      email: targetEmail,
      usuario: userRow.usuario,
      apodo: userRow.apodo
    };
  },

  async verifyResetCode(email: string, code: string): Promise<{ success: boolean; message: string; token: string; user: { usuario: string; apodo: string; email: string } }> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(code || '').trim();
    if (!cleanEmail || !cleanCode) {
      throw new Error('Ingresá tu correo electrónico y el código de 6 dígitos.');
    }

    const { data: rows, error: findErr } = await supabase
      .from('users')
      .select('id, usuario, apodo, email, codigo_recuperacion, codigo_expira, estado_alta')
      .ilike('email', cleanEmail)
      .neq('estado_alta', 'eliminado')
      .limit(1);

    if (findErr) {
      throw new Error('Error al validar el código. Intentá nuevamente.');
    }

    const userRow = rows?.[0];
    if (!userRow) {
      throw new Error('No se encontró ninguna cuenta asociada a ese correo electrónico.');
    }

    const validation = validateRecoveryCodeMatch(
      userRow.codigo_recuperacion,
      userRow.codigo_expira,
      cleanCode
    );

    if (!validation.valid) {
      throw new Error(validation.error || 'El código ingresado es incorrecto o venció.');
    }

    return {
      success: true,
      message: 'Código verificado con éxito. Ya podés crear tu nueva contraseña.',
      token: cleanCode,
      user: {
        usuario: userRow.usuario,
        apodo: userRow.apodo,
        email: userRow.email || cleanEmail
      }
    };
  },

  async resendResetCode(email: string): Promise<{ success: boolean; message: string; email: string }> {
    const res = await this.forgotPassword(email);
    return {
      success: true,
      message: `Reenviamos un nuevo código de 6 dígitos a ${res.email}.`,
      email: res.email
    };
  },

  async resetPassword(email: string, token: string, newPassword: string): Promise<{ success: boolean; message: string; user: { usuario: string; apodo: string } }> {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanCode = String(token || '').trim();
    const cleanPassword = String(newPassword || '').trim();

    if (!cleanEmail || !cleanPassword) {
      throw new Error('Correo electrónico y nueva contraseña requeridos.');
    }
    if (!cleanCode) {
      throw new Error('Debés validar el código de recuperación enviado a tu correo antes de cambiar tu contraseña.');
    }

    const { data: rows, error: findErr } = await supabase
      .from('users')
      .select('id, usuario, apodo, email, codigo_recuperacion, codigo_expira, estado_alta')
      .ilike('email', cleanEmail)
      .neq('estado_alta', 'eliminado')
      .limit(1);

    if (findErr) {
      throw new Error('Error al verificar la cuenta. Intentá nuevamente.');
    }

    const userRow = rows?.[0];
    if (!userRow) {
      throw new Error('No se encontró ninguna cuenta asociada a ese correo electrónico.');
    }

    const validation = validateRecoveryCodeMatch(
      userRow.codigo_recuperacion,
      userRow.codigo_expira,
      cleanCode
    );

    if (!validation.valid) {
      throw new Error(validation.error || 'El código de verificación ya no es válido o venció.');
    }

    const { error: updateErr } = await supabase
      .from('users')
      .update({
        clave: cleanPassword,
        codigo_recuperacion: null,
        codigo_expira: null
      })
      .eq('id', userRow.id)
      .eq('codigo_recuperacion', cleanCode);

    if (updateErr) {
      throw new Error('No se pudo actualizar la contraseña. Intentá nuevamente.');
    }

    return {
      success: true,
      message: 'Contraseña restablecida exitosamente. Ya podés iniciar sesión.',
      user: {
        usuario: userRow.usuario,
        apodo: userRow.apodo
      }
    };
  },

  async register(data: {
    usuario: string;
    clave: string;
    apodo: string;
    tipo: 'personal' | 'institucional';
    localidad: string;
    cuit?: string;
    entidadTipo?: string;
    contactoInstitucional?: string;
    direccionFisica?: string;
    sitioWebRedSocial?: string;
    presidenteFuncionario?: string;
    managerNombre?: string;
    managerRol?: string;
    gestorNombre?: string;
    gestorRol?: string;
    documento_cuit_url?: string;
    documentoCuitUrl?: string;
    documento_personeria_url?: string;
    documentoPersoneriaUrl?: string;
    constanciaCuitUrl?: string;
    constanciaCuitNombre?: string;
    personeriaDocUrl?: string;
    personeriaDocNombre?: string;
    email?: string;
    textSize?: 'normal' | 'grande' | 'gigante';
    contrast?: boolean;
  }): Promise<User> {
    const cleanUser = (data.usuario || '').trim();
    if (!cleanUser || !data.clave || !data.apodo) {
      throw new Error('Por favor completá los campos obligatorios para registrarte.');
    }

    const email = (data.email || `${cleanUser.toLowerCase().replace(/[^a-z0-9]/g, '')}@club65.ar`).trim().toLowerCase();

    // Verify username and email are not already taken in Supabase
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .ilike('usuario', cleanUser)
      .neq('estado_alta', 'eliminado')
      .maybeSingle();

    if (existingUser) {
      throw new Error(`El nombre de usuario "${cleanUser}" ya está en uso. Por favor elegí otro.`);
    }

    if (data.email && String(data.email).trim()) {
      const { data: existingEmail } = await supabase
        .from('users')
        .select('id')
        .ilike('email', email)
        .neq('estado_alta', 'eliminado')
        .maybeSingle();

      if (existingEmail) {
        throw new Error(`El correo electrónico "${email}" ya está registrado en otra cuenta.`);
      }
    }

    const isInstitucionalReg = data.tipo === 'institucional';

    // Only register Supabase Auth immediately for personal accounts;
    // institutional accounts stay pending admin approval with no active session.
    let authUserId: string | null = null;
    if (!isInstitucionalReg) {
      try {
        const { data: authData } = await supabase.auth.signUp({
          email,
          password: data.clave,
          options: {
            data: {
              apodo: data.apodo.trim(),
              usuario: cleanUser,
              tipo: data.tipo,
              rol: data.tipo,
              localidad: data.localidad
            }
          }
        });
        authUserId = authData?.user?.id || null;
      } catch {
        // Proceed with inserting into public.users
      }
    } else {
      try {
        await supabase.auth.signOut();
      } catch {}
    }

    const userId = authUserId || ('usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7));

    const finalManagerNom = data.managerNombre || data.gestorNombre || '';
    const finalManagerCargo = data.managerRol || data.gestorRol || '';

    const cuitDocUrl = data.documento_cuit_url || data.documentoCuitUrl || data.constanciaCuitUrl || '';
    const personeriaDocUrl = data.documento_personeria_url || data.documentoPersoneriaUrl || data.personeriaDocUrl || '';

    const institutionalMeta = isInstitucionalReg ? {
      presidente: data.presidenteFuncionario || data.apodo || '',
      manager: finalManagerNom,
      managerRol: finalManagerCargo,
      gestor: finalManagerNom,
      gestorRol: finalManagerCargo,
      direccion: data.direccionFisica || '',
      sitioWeb: data.sitioWebRedSocial || '',
      documento_cuit_url: cuitDocUrl,
      documento_personeria_url: personeriaDocUrl,
      constanciaCuitUrl: cuitDocUrl,
      constanciaCuitNombre: data.constanciaCuitNombre || '',
      personeriaDocUrl: personeriaDocUrl,
      personeriaDocNombre: data.personeriaDocNombre || ''
    } : null;

    const legalRepString = institutionalMeta
      ? JSON.stringify(institutionalMeta)
      : (data.presidenteFuncionario || data.apodo || null);

    const telContact = data.contactoInstitucional || null;

    const newRow = {
      id: userId,
      usuario: cleanUser,
      email,
      clave: data.clave,
      apodo: data.apodo.trim(),
      avatar: '',
      bio: '',
      text_size: data.textSize || 'normal',
      tipo: data.tipo,
      rol: data.tipo,
      estado_alta: isInstitucionalReg ? 'pendiente' : 'aprobada',
      contrast: Boolean(data.contrast),
      localidad: data.localidad || '',
      is_verified: false,
      entidad_tipo: data.entidadTipo || null,
      cuit: data.cuit || null,
      legal_representative: legalRepString,
      contacto_institucional: telContact,
      documento_cuit_url: cuitDocUrl || null,
      documento_personeria_url: personeriaDocUrl || null,
      blocked_users: [],
      notifications: []
    };

    const { error: insertError } = await supabase.from('users').insert(newRow);
    if (insertError) {
      console.error('Error inserting user to Supabase:', insertError);
      throw new Error(insertError.message || 'No se pudo registrar la cuenta en la base de datos.');
    }

    // Sincronizar también con backend Express
    try {
      await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          usuario: cleanUser,
          clave: data.clave,
          apodo: data.apodo.trim(),
          tipo: data.tipo,
          rol: data.tipo,
          localidad: data.localidad,
          cuit: data.cuit,
          entidadTipo: data.entidadTipo,
          contactoInstitucional: telContact,
          direccionFisica: data.direccionFisica,
          sitioWebRedSocial: data.sitioWebRedSocial,
          presidenteFuncionario: data.presidenteFuncionario,
          managerNombre: finalManagerNom,
          managerRol: finalManagerCargo,
          gestorNombre: finalManagerNom,
          gestorRol: finalManagerCargo,
          documento_cuit_url: cuitDocUrl,
          documento_personeria_url: personeriaDocUrl,
          constanciaCuitUrl: cuitDocUrl,
          constanciaCuitNombre: data.constanciaCuitNombre,
          personeriaDocUrl: personeriaDocUrl,
          personeriaDocNombre: data.personeriaDocNombre,
          email,
          textSize: data.textSize || 'normal',
          contrast: Boolean(data.contrast)
        })
      }).catch(() => {});
    } catch {}

    invalidateApiCaches();
    const u = mapSupabaseUser(newRow);

    if (isInstitucionalReg) {
      // Never auto-login or persist browser session for a pending institutional account
      try {
        await supabase.auth.signOut();
      } catch {}
      clearBrowserSessionKeys();
      return u;
    }

    setStoredUserId(u.id);
    return u;
  },

  async getMe(forceRefresh = false): Promise<User | null> {
    const now = Date.now();
    if (!forceRefresh && cachedCurrentUser && (now - lastCurrentUserFetchTime < 30000)) {
      return cachedCurrentUser;
    }
    if (currentUserInFlightPromise) {
      return currentUserInFlightPromise;
    }

    currentUserInFlightPromise = (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const storedId = getStoredUserId();
        const targetId = session?.user?.id || storedId;
        let profile: any = null;

        if (targetId) {
          const { data } = await supabase
            .from('users')
            .select('id, usuario, apodo, email, avatar, bio, tipo, rol, contacto_emergencia, text_size, contrast, localidad, is_verified, estado_alta, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, blocked_users, notifications, created_at')
            .eq('id', targetId)
            .neq('estado_alta', 'eliminado')
            .maybeSingle();

          if (data) profile = data;
        }

        if (!profile && session?.user?.email) {
          const { data: profileByEmail } = await supabase
            .from('users')
            .select('id, usuario, apodo, email, avatar, bio, tipo, rol, contacto_emergencia, text_size, contrast, localidad, is_verified, estado_alta, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, blocked_users, notifications, created_at')
            .eq('email', session.user.email)
            .neq('estado_alta', 'eliminado')
            .maybeSingle();

          if (profileByEmail) {
            setStoredUserId(profileByEmail.id);
            profile = profileByEmail;
          }
        }

        if (profile) {
          const u = mapSupabaseUser(profile);
          if (Array.isArray(u.notifications)) {
            cachedNotificationsByUser.set(u.id, u.notifications);
          }

          // Bloquear restauración de sesión si es cuenta institucional aún no aprobada
          const esInstitucional = u.tipo === 'institucional' || (u as any).rol === 'institucional';
          const estado = u.estadoAlta || profile.estado_alta;
          if (esInstitucional && estado !== 'aprobada') {
            try {
              await supabase.auth.signOut();
            } catch {}
            clearBrowserSessionKeys();
            cachedCurrentUser = null;
            lastCurrentUserFetchTime = Date.now();
            return null;
          }

          const activeSanction = await fetchActiveSanctionFromSupabase(u);
          if (activeSanction) {
            try {
              await supabase.auth.signOut();
            } catch {}
            clearBrowserSessionKeys();
            cachedCurrentUser = null;
            lastCurrentUserFetchTime = Date.now();
            return null;
          }

          try {
            const myTokens = [
              u.id,
              u.usuario,
              u.apodo,
              u.nombre
            ].filter(Boolean).map(t => String(t).toLowerCase().trim());

            let allUsersRows: any[] | null = null;
            if (cachedUsersMap && Object.keys(cachedUsersMap).length > 0) {
              const seenIds = new Set<string>();
              allUsersRows = [];
              for (const cu of Object.values(cachedUsersMap)) {
                if (cu && cu.id && !seenIds.has(String(cu.id))) {
                  seenIds.add(String(cu.id));
                  allUsersRows.push({
                    id: cu.id,
                    usuario: cu.usuario,
                    apodo: cu.apodo,
                    nombre: cu.nombre,
                    blocked_users: cu.myBlockedUsers || cu.blockedUsers || []
                  });
                }
              }
            } else {
              const { data: fetchedUsersRows } = await supabase
                .from('users')
                .select('id, usuario, apodo, blocked_users')
                .neq('estado_alta', 'eliminado')
                .limit(50);
              allUsersRows = Array.isArray(fetchedUsersRows) ? fetchedUsersRows : null;
            }

            if (Array.isArray(allUsersRows)) {
              const whoBlockedMe = new Set<string>();
              for (const other of allUsersRows) {
                if (other.id === u.id) continue;
                const otherBlocked = Array.isArray(other.blocked_users) ? other.blocked_users : [];
                const otherBlockedLower = otherBlocked.map((b: any) => String(b).toLowerCase().trim());
                const hasBlockedMe = myTokens.some(tok => otherBlockedLower.includes(tok));
                if (hasBlockedMe) {
                  if (other.id) whoBlockedMe.add(String(other.id).toLowerCase());
                  if (other.usuario) whoBlockedMe.add(String(other.usuario).toLowerCase());
                  if (other.apodo) whoBlockedMe.add(String(other.apodo).toLowerCase());
                  if ((other as any).nombre) whoBlockedMe.add(String((other as any).nombre).toLowerCase());
                }
              }
              u.blockedByUsers = Array.from(whoBlockedMe);
              u.blockedUsers = Array.from(new Set([...(u.myBlockedUsers || []), ...u.blockedByUsers]));
            }
          } catch (err) {
            console.warn('Error querying who blocked me:', err);
          }
          try {
            localStorage.setItem('club65_user', JSON.stringify(u));
            localStorage.setItem('currentUser', JSON.stringify(u));
          } catch (_) {}
          cachedCurrentUser = u;
          lastCurrentUserFetchTime = Date.now();
          return u;
        }
      } catch {
        // return null if no session
      }

      clearBrowserSessionKeys();
      cachedCurrentUser = null;
      lastCurrentUserFetchTime = Date.now();
      return null;
    })().finally(() => {
      currentUserInFlightPromise = null;
    });

    return currentUserInFlightPromise;
  },

  async getUserAvatarById(userId: string): Promise<string> {
    const cleanId = String(userId || '').trim();
    if (!cleanId) return '';
    if (userAvatarCache.has(cleanId)) {
      return userAvatarCache.get(cleanId) || '';
    }
    const existing = userAvatarInFlight.get(cleanId);
    if (existing) return existing;

    const req = (async () => {
      try {
        const { data } = await supabase
          .from('users')
          .select('id, avatar')
          .eq('id', cleanId)
          .limit(1)
          .maybeSingle();
        const safeAvatar = sanitizeProfileAvatar(data?.avatar) || '';
        userAvatarCache.set(cleanId, safeAvatar);
        return safeAvatar;
      } catch {
        return '';
      } finally {
        userAvatarInFlight.delete(cleanId);
      }
    })();

    userAvatarInFlight.set(cleanId, req);
    return req;
  },

  async getUserAvatarsByIds(userIds: string[]): Promise<Record<string, string>> {
    const uniqueIds = Array.from(
      new Set(
        (Array.isArray(userIds) ? userIds : [])
          .map(id => String(id || '').trim())
          .filter(Boolean)
      )
    );
    if (uniqueIds.length === 0) return {};

    const result: Record<string, string> = {};
    const pendingPromises: Promise<void>[] = [];
    const missingIds: string[] = [];

    for (const id of uniqueIds) {
      if (userAvatarCache.has(id)) {
        result[id] = userAvatarCache.get(id) || '';
      } else if (userAvatarInFlight.has(id)) {
        const existingPromise = userAvatarInFlight.get(id)!;
        pendingPromises.push(
          existingPromise.then((avatarUrl) => {
            result[id] = avatarUrl || '';
          })
        );
      } else {
        missingIds.push(id);
      }
    }

    if (missingIds.length > 0) {
      const CHUNK_SIZE = 40;
      for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
        const chunk = missingIds.slice(i, i + CHUNK_SIZE);
        const batchPromise = (async () => {
          const batchResult = new Map<string, string>();
          try {
            const { data, error } = await supabase
              .from('users')
              .select('id, avatar')
              .in('id', chunk);

            if (!error && Array.isArray(data)) {
              for (const row of data) {
                const rowId = String(row?.id || '').trim();
                if (!rowId) continue;
                const safeAvatar = sanitizeProfileAvatar(row?.avatar) || '';
                batchResult.set(rowId, safeAvatar);
                userAvatarCache.set(rowId, safeAvatar);
              }
            }
            // Cache empty string for IDs without avatar so they are not re-queried repeatedly
            for (const reqId of chunk) {
              if (!userAvatarCache.has(reqId)) {
                userAvatarCache.set(reqId, '');
              }
            }
            // Enrich cachedUsersMap if already loaded
            if (cachedUsersMap) {
              for (const key of Object.keys(cachedUsersMap)) {
                const u = cachedUsersMap[key];
                if (!u?.id) continue;
                const uid = String(u.id).trim();
                const foundAvatar = batchResult.get(uid);
                if (foundAvatar) {
                  cachedUsersMap[key] = { ...u, avatar: foundAvatar };
                }
              }
            }
          } catch {
            // ignore transient failures without poisoning cache
          }
          return batchResult;
        })();

        for (const reqId of chunk) {
          const singlePromise = batchPromise
            .then((batchResult) => batchResult.get(reqId) || userAvatarCache.get(reqId) || '')
            .finally(() => {
              userAvatarInFlight.delete(reqId);
            });
          userAvatarInFlight.set(reqId, singlePromise);
          pendingPromises.push(
            singlePromise.then((avatarUrl) => {
              result[reqId] = avatarUrl || '';
            })
          );
        }
      }
    }

    if (pendingPromises.length > 0) {
      await Promise.all(pendingPromises);
    }

    return result;
  },

  async getUserProfile(username: string): Promise<{ id: string; usuario: string; apodo: string; avatar: string; bio: string; tipo: string; localidad?: string } | null> {
    try {
      const clean = username.replace(/^@/, '').trim();
      const cleanLower = clean.toLowerCase();
      if (!cleanLower) return null;

      // 1. Consultar primero desde el mapa centralizado de usuarios (sin traer avatares masivos)
      const usersMap = await this.getUsers().catch(() => ({} as Record<string, User>));
      const matched = usersMap[cleanLower] || usersMap[clean];
      if (matched) {
        let resolvedAvatar = sanitizeProfileAvatar(matched.avatar) || '';
        if (!resolvedAvatar && matched.id) {
          resolvedAvatar = await this.getUserAvatarById(String(matched.id));
        }
        return {
          id: String(matched.id),
          usuario: matched.usuario,
          apodo: matched.apodo || matched.usuario,
          avatar: resolvedAvatar,
          bio: sanitizeProfileBio(matched.bio) || '',
          tipo: matched.tipo || 'personal',
          localidad: matched.localidad || ''
        };
      }

      // 1.b. Si no está en el mapa, consultar en Supabase con columnas específicas y límite 1
      const { data: userRow } = await supabase
        .from('users')
        .select('id, usuario, apodo, avatar, bio, tipo, rol, localidad')
        .or(`id.eq.${clean},usuario.ilike.${clean},apodo.ilike.${clean}`)
        .neq('estado_alta', 'eliminado')
        .limit(1)
        .maybeSingle();

      if (userRow) {
        const roleType = resolveUserRole(userRow);
        return {
          id: String(userRow.id),
          usuario: userRow.usuario,
          apodo: userRow.apodo || userRow.usuario,
          avatar: sanitizeProfileAvatar(userRow.avatar) || '',
          bio: sanitizeProfileBio(userRow.bio) || '',
          tipo: roleType,
          localidad: userRow.localidad
        };
      }

      // 2. Respaldo opcional en el backend Express si correspondiera
      const res = await fetch(`/api/users/profile/${encodeURIComponent(clean)}`, { headers: getHeaders() });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        const u = parsed.data;
        return {
          id: String(u.id),
          usuario: u.usuario,
          apodo: u.apodo || u.usuario,
          avatar: u.avatar || u.foto || '',
          bio: u.bio || '',
          tipo: u.tipo || 'personal',
          localidad: u.localidad
        };
      }
    } catch {
      // ignore
    }
    return null;
  },

async updateProfile(updates: Partial<User>): Promise<User> {
    const current = await this.getMe();
    if (!current) throw new Error('Debes iniciar sesión para editar tu perfil.');

    const payload: any = {};
    if (updates.apodo !== undefined) payload.apodo = updates.apodo;
    if (updates.bio !== undefined) payload.bio = updates.bio;
    if (updates.avatar !== undefined) payload.avatar = updates.avatar;
    if (updates.textSize !== undefined) payload.text_size = updates.textSize;
    if (updates.contrast !== undefined) payload.contrast = updates.contrast;
    if (updates.localidad !== undefined) payload.localidad = updates.localidad;
    if (updates.contactoEmergencia !== undefined) payload.contacto_emergencia = updates.contactoEmergencia;

    const { data, error } = await supabase
      .from('users')
      .update(payload)
      .eq('id', current.id)
      .select('id, usuario, apodo, avatar, bio, text_size, contrast, localidad, contacto_emergencia, tipo, rol, is_verified, estado_alta, contacto_institucional, documento_cuit_url, documento_personeria_url, blocked_users')
      .maybeSingle();

    if (error || !data) {
      throw new Error(error?.message || 'Error al actualizar el perfil en el sistema.');
    }

    const updatedUser = mapSupabaseUser(data);
    invalidateApiCaches();

    // Actualizar localStorage para mantener consistencia de sesión
    try {
      if (updatedUser.id) {
        setStoredUserId(updatedUser.id);
      }
      localStorage.setItem('club65_user', JSON.stringify(updatedUser));
    } catch (_) {}

    // Sincronizar en cascada con el servidor local (server.ts) pasando tokens completos
    try {
      const authHeaderToken = current.usuario || current.apodo || current.id;
      await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json',
          'x-user-id': String(authHeaderToken)
        },
        body: JSON.stringify({
          ...updates,
          previousApodo: current.apodo,
          previousUsuario: current.usuario,
          userId: current.id
        })
      });
    } catch (e) {
      console.warn('No se pudo sincronizar el perfil con server.ts:', e);
    }

    return updatedUser;
  },

  // USER BLOCKING
  async blockUser(targetIdentifier: string, optionalId?: string): Promise<void> {
    const rawTokens = [targetIdentifier, optionalId]
      .filter(Boolean)
      .map(t => String(t).trim());
    if (rawTokens.length === 0) return;

    // Resolver aliases y tokens del usuario objetivo en Supabase
    const allTokens = new Set<string>();
    rawTokens.forEach(t => {
      allTokens.add(t);
      allTokens.add(t.toLowerCase());
    });

    try {
      if (supabase) {
        const idToken = optionalId || (targetIdentifier.startsWith('usr_') || targetIdentifier.startsWith('u_') ? targetIdentifier : null);
        const targetRows: any[] = [];
        if (idToken) {
          const { data } = await supabase.from('users').select('id, usuario, apodo').eq('id', idToken).limit(1);
          if (Array.isArray(data) && data.length > 0) targetRows.push(...data);
        }
        if (targetRows.length === 0) {
          const { data: byApodo } = await supabase.from('users').select('id, usuario, apodo').ilike('apodo', targetIdentifier).limit(5);
          if (Array.isArray(byApodo) && byApodo.length > 0) targetRows.push(...byApodo);
          const { data: byUser } = await supabase.from('users').select('id, usuario, apodo').ilike('usuario', targetIdentifier).limit(5);
          if (Array.isArray(byUser) && byUser.length > 0) targetRows.push(...byUser);
        }
        if (targetRows.length > 0) {
          for (const tr of targetRows) {
            if (tr.id) { allTokens.add(tr.id); allTokens.add(tr.id.toLowerCase()); }
            if (tr.usuario) { allTokens.add(tr.usuario); allTokens.add(tr.usuario.toLowerCase()); }
            if (tr.apodo) { allTokens.add(tr.apodo); allTokens.add(tr.apodo.toLowerCase()); }
            if (tr.nombre) { allTokens.add(tr.nombre); allTokens.add(tr.nombre.toLowerCase()); }
          }
        }
      }
    } catch (findErr) {
      console.warn('Error resolviendo tokens del usuario a bloquear en Supabase:', findErr);
    }

    const tokensToBlock = Array.from(allTokens);

    // 1. Obtener usuario actual
    const current = await this.getCurrentUser().catch(() => null);
    const userId = current?.id || getStoredUserId();

    // 2. Persistir en la tabla users de Supabase (Base de datos real)
    if (userId) {
      try {
        const { data: userRow } = await supabase
          .from('users')
          .select('id, blocked_users')
          .eq('id', userId)
          .maybeSingle();

        if (userRow) {
          const currentList: string[] = Array.isArray(userRow.blocked_users) ? userRow.blocked_users : [];
          const nextList = Array.from(new Set([
            ...currentList,
            ...tokensToBlock
          ]));

          const { error: updateError } = await supabase
            .from('users')
            .update({ blocked_users: nextList })
            .eq('id', userRow.id);

          if (updateError) {
            console.error('Error al guardar bloqueo en Supabase:', updateError);
          }
        }
      } catch (sbErr) {
        console.warn('Error en persistencia de bloqueo en Supabase:', sbErr);
      }
    }

    // 3. Notificar al backend de Express para sincronización en memoria/cache
    try {
      const res = await fetch('/api/users/block', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ targetUsername: targetIdentifier, targetId: optionalId })
      });
      if (!res.ok) {
        console.warn('Respuesta no satisfactoria de /api/users/block:', res.status);
      }
    } catch (e) {
      console.warn('Error notificando a backend Express:', e);
    }

    // 4. Invalidar cachés para asegurar que getMe() y getUsers() retornen datos actualizados inmediatamente
    invalidateApiCaches();
  },

  async unblockUser(targetIdentifier: string, optionalId?: string): Promise<void> {
    const rawTokens = [targetIdentifier, optionalId]
      .filter(Boolean)
      .map(t => String(t).trim());
    if (rawTokens.length === 0) return;

    // Resolver aliases y tokens del usuario objetivo en Supabase
    const allTokens = new Set<string>();
    rawTokens.forEach(t => {
      allTokens.add(t.toLowerCase());
    });

    try {
      if (supabase) {
        const idToken = optionalId || (targetIdentifier.startsWith('usr_') || targetIdentifier.startsWith('u_') ? targetIdentifier : null);
        const targetRows: any[] = [];
        if (idToken) {
          const { data } = await supabase.from('users').select('id, usuario, apodo').eq('id', idToken).limit(1);
          if (Array.isArray(data) && data.length > 0) targetRows.push(...data);
        }
        if (targetRows.length === 0) {
          const { data: byApodo } = await supabase.from('users').select('id, usuario, apodo').ilike('apodo', targetIdentifier).limit(5);
          if (Array.isArray(byApodo) && byApodo.length > 0) targetRows.push(...byApodo);
          const { data: byUser } = await supabase.from('users').select('id, usuario, apodo').ilike('usuario', targetIdentifier).limit(5);
          if (Array.isArray(byUser) && byUser.length > 0) targetRows.push(...byUser);
        }
        if (targetRows.length > 0) {
          for (const tr of targetRows) {
            if (tr.id) allTokens.add(tr.id.toLowerCase());
            if (tr.usuario) allTokens.add(tr.usuario.toLowerCase());
            if (tr.apodo) allTokens.add(tr.apodo.toLowerCase());
            if (tr.nombre) allTokens.add(tr.nombre.toLowerCase());
          }
        }
      }
    } catch (findErr) {
      console.warn('Error resolviendo tokens del usuario a desbloquear en Supabase:', findErr);
    }

    // 1. Obtener usuario actual
    const current = await this.getCurrentUser().catch(() => null);
    const userId = current?.id || getStoredUserId();

    // 2. Actualizar en Supabase (Base de datos real)
    if (userId) {
      try {
        const { data: userRow } = await supabase
          .from('users')
          .select('id, blocked_users')
          .eq('id', userId)
          .maybeSingle();

        if (userRow) {
          const currentList: string[] = Array.isArray(userRow.blocked_users) ? userRow.blocked_users : [];
          const nextList = currentList.filter(item => !allTokens.has(String(item).toLowerCase().trim()));

          const { error: updateError } = await supabase
            .from('users')
            .update({ blocked_users: nextList })
            .eq('id', userRow.id);

          if (updateError) {
            console.error('Error al desbloquear en Supabase:', updateError);
          }
        }
      } catch (sbErr) {
        console.warn('Error en persistencia de desbloqueo en Supabase:', sbErr);
      }
    }

    // 3. Notificar al backend de Express
    try {
      const res = await fetch('/api/users/unblock', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ targetUsername: targetIdentifier, targetId: optionalId })
      });
      if (!res.ok) {
        console.warn('Respuesta no satisfactoria de /api/users/unblock:', res.status);
      }
    } catch (e) {
      console.warn('Error notificando a backend Express:', e);
    }

    // 4. Invalidar cachés para asegurar que getMe() y getUsers() retornen datos actualizados inmediatamente
    invalidateApiCaches();
  },

  async getUsers(forceRefresh = false): Promise<Record<string, User>> {
    const now = Date.now();
    if (!forceRefresh && cachedUsersMap && (now - lastUsersFetchTime < 120000)) {
      return cachedUsersMap;
    }
    if (usersInFlightPromise) {
      return usersInFlightPromise;
    }

    usersInFlightPromise = (async () => {
      const map: Record<string, User> = {};
      try {
        // Excluir avatar (posibles strings Base64 pesados) y documentos legales en listados masivos
        const { data, error } = await supabase
          .from('users')
          .select('id, usuario, apodo, email, bio, tipo, rol, contacto_emergencia, text_size, contrast, localidad, is_verified, estado_alta, entidad_tipo, cuit, legal_representative, contacto_institucional, blocked_users, created_at')
          .neq('estado_alta', 'eliminado')
          .limit(50);

        if (!error && Array.isArray(data)) {
          for (const row of data) {
            const u = mapSupabaseUser(row);
            if (u.id) {
              map[String(u.id)] = u;
              map[String(u.id).toLowerCase()] = u;
            }
            if (u.usuario) map[u.usuario.toLowerCase().trim()] = u;
            if (u.apodo) map[u.apodo.toLowerCase().trim()] = u;
            if (u.nombre) map[u.nombre.toLowerCase().trim()] = u;
          }
        }
      } catch (e) {
        console.warn('Error al cargar usuarios de Supabase:', e);
      }

      cachedUsersMap = map;
      lastUsersFetchTime = Date.now();
      return map;
    })().finally(() => {
      usersInFlightPromise = null;
    });

    return usersInFlightPromise;
  },

  async expirePendingProposals(activitiesList: Activity[]): Promise<Activity[]> {
    if (!Array.isArray(activitiesList) || activitiesList.length === 0) return [];
    const nowFormatted = formatArgentinaDateTime();
    const nowTs = Date.now();
    const expiredIdsToPersist: Array<{ idFilter: number | string; rawId: string }> = [];

    const nextList = activitiesList.map(act => {
      if (!isPendingProposalExpired(act)) return act;
      const rawId = String(act.id ?? '').trim();
      if (rawId && !expiringProposalIdsInFlight.has(rawId)) {
        const idFilter: number | string = !isNaN(Number(rawId)) && /^\d+$/.test(rawId) ? Number(rawId) : rawId;
        expiredIdsToPersist.push({ idFilter, rawId });
      }
      return {
        ...act,
        isApproved: false,
        proposalStatus: 'rechazada' as const,
        proposal_status: 'rechazada',
        estado: 'rechazada',
        rejectionReason: AUTO_EXPIRED_PROPOSAL_REASON,
        feedback: AUTO_EXPIRED_PROPOSAL_REASON,
        feedback_admin: AUTO_EXPIRED_PROPOSAL_REASON,
        proposalNote: AUTO_EXPIRED_PROPOSAL_REASON,
        rejectedAt: nowFormatted,
        rejectedTimestamp: nowTs
      };
    });

    if (expiredIdsToPersist.length > 0 && supabase) {
      const adminCommentsMeta = JSON.stringify({
        rejectedAt: nowFormatted,
        rejectedTimestamp: nowTs,
        autoExpired: true
      });
      await Promise.all(
        expiredIdsToPersist.map(async ({ idFilter, rawId }) => {
          expiringProposalIdsInFlight.add(rawId);
          try {
            const { error } = await supabase
              .from('activities')
              .update({
                is_approved: false,
                proposal_status: 'rechazada',
                estado: 'rechazada',
                rejection_reason: AUTO_EXPIRED_PROPOSAL_REASON,
                feedback: AUTO_EXPIRED_PROPOSAL_REASON,
                feedback_admin: AUTO_EXPIRED_PROPOSAL_REASON,
                proposal_note: AUTO_EXPIRED_PROPOSAL_REASON,
                admin_comments: adminCommentsMeta
              })
              .eq('id', idFilter);
            if (error) {
              console.warn('Error al desestimar propuesta vencida en Supabase:', error.message);
            }
          } catch (err) {
            console.warn('Excepción al desestimar propuesta vencida en Supabase:', err);
          } finally {
            expiringProposalIdsInFlight.delete(rawId);
          }
        })
      );
      if (cachedActivitiesList) {
        cachedActivitiesList = nextList;
        lastActivitiesFetchTime = Date.now();
      }
    }

    return nextList;
  },

  mapSupabaseActivityRow(row: any, usersMap: Record<string, User>): Activity {
          const creatorId = String(row.creador_id || row.organizer_id || row.organizador_id || row.user_id || '').trim();
          const isIdLike = (str?: string) =>
            !str ||
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim()) ||
            /^usr_/i.test(str.trim()) ||
            str === creatorId;

          const rawNick = row.organizer || row.organizer_nombre || row.creador || '';
          let userMatch = creatorId ? (usersMap[creatorId] || usersMap[creatorId.toLowerCase()] || null) : null;
          if (!userMatch && rawNick && !isIdLike(rawNick)) {
            userMatch = usersMap[String(rawNick).toLowerCase().trim()] || null;
          }

          const rawDesc = String(row.descripcion || row.description || '');
          let extractedLocation = '';
          let extractedSchedule = '';
          let extractedFirstDate = '';

          const matchLugar = rawDesc.match(/Lugar:\s*([^\n]+)/i);
          if (matchLugar && matchLugar[1]) {
            extractedLocation = matchLugar[1].trim();
          }

          const matchHorario = rawDesc.match(/Horario:\s*([^\n]+)/i);
          if (matchHorario && matchHorario[1]) {
            extractedSchedule = matchHorario[1].trim();
          }

          const matchPrimer = rawDesc.match(/Primer encuentro:\s*([^\n]+)/i);
          if (matchPrimer && matchPrimer[1]) {
            extractedFirstDate = matchPrimer[1].trim();
          }

          const finalLocation = row.location || row.direccion || row.ubicacion || extractedLocation || '';
          const finalSchedule = row.schedule || row.horario_resumen || extractedSchedule || '';

          // Determinar recurrencia respetando estrictamente el valor booleano de la base de datos
          let isRecurrentAct = false;
          if (row.is_recurrent !== undefined && row.is_recurrent !== null) {
            isRecurrentAct = Boolean(row.is_recurrent);
          } else if (row.es_recurrente !== undefined && row.es_recurrente !== null) {
            isRecurrentAct = Boolean(row.es_recurrente);
          } else if (row.frecuencia_tipo) {
            isRecurrentAct = row.frecuencia_tipo === 'recurrente';
          } else if (row.frequency) {
            isRecurrentAct = row.frequency === 'recurrente';
          } else if (row.frecuencia) {
            isRecurrentAct = row.frecuencia === 'recurrente';
          }
          const allActivityText = `${finalSchedule} ${rawDesc}`;
          const schedDates = extractDatesFromText(finalSchedule);
          const extractedDates = schedDates.length > 0 ? schedDates : extractDatesFromText(allActivityText);
          const sortedDates = [...extractedDates].sort();
          const extractedTimes = extractTimesFromSchedule(finalSchedule || allActivityText);

          const finalFirstDate = isRecurrentAct
            ? (parseDateToYMD(row.first_encounter_date || row.fecha_primer_encuentro || extractedFirstDate) || (sortedDates.length > 0 ? sortedDates[0] : ''))
            : '';

          const finalStartDate = parseDateToYMD(row.start_date || row.fecha_inicio || (sortedDates.length > 0 ? sortedDates[0] : null)) || (isRecurrentAct ? finalFirstDate : undefined);
          let finalEndDate = parseDateToYMD(row.end_date || row.fecha_fin || (sortedDates.length > 0 ? sortedDates[sortedDates.length - 1] : null)) || finalStartDate;

          if (isRecurrentAct && (!finalEndDate || finalEndDate <= (finalStartDate || ''))) {
            try {
              const tempSess = getActivitySessions({
                isRecurrent: true,
                schedule: finalSchedule,
                frequency: row.frecuencia_tipo || row.frequency || row.frecuencia,
                diasSemana: row.dias_semana || row.diasSemana,
                diaMes: row.dia_mes || row.diaMes,
                cantidadEventos: row.cantidad_eventos || row.cantidadEventos,
                firstEncounterDate: finalFirstDate,
                startDate: finalStartDate,
                startTime: row.start_time || row.hora_inicio || row.first_encounter_start_time || extractedTimes.startTime,
                endTime: row.end_time || row.hora_fin || row.first_encounter_end_time || extractedTimes.endTime
              });
              if (tempSess.length > 0) {
                finalEndDate = tempSess[tempSess.length - 1].date;
              }
            } catch (_) {}
          }

          const finalStartTime = row.start_time || row.hora_inicio || row.first_encounter_start_time || extractedTimes.startTime || undefined;
          const finalEndTime = row.end_time || row.hora_fin || row.first_encounter_end_time || extractedTimes.endTime || undefined;

          const cleanDesc = rawDesc
            .replace(/Primer encuentro:\s*[^\n]+\n?/gi, '')
            .replace(/Lugar:\s*[^\n]+\n?/gi, '')
            .replace(/Horario:\s*[^\n]+\n?/gi, '')
            .trim();

          const isInstitutionalAct = Boolean(
            row.is_institutional ||
            row.es_institucional ||
            creatorId === 'institucional' ||
            userMatch?.tipo === 'institucional' ||
            (userMatch as any)?.rol === 'institucional'
          );

          const resolvedApodo =
            userMatch?.apodo ||
            userMatch?.usuario ||
            (!isIdLike(rawNick) ? String(rawNick).trim() : '') ||
            (isInstitutionalAct ? 'Institución' : 'Organizador');

          const rawPropStatus = String(row.proposal_status || row.proposalStatus || '').toLowerCase().trim();
          const rawEstado = String(row.estado || '').toLowerCase().trim();
          const hasFechaBaja = Boolean(row.fecha_baja && String(row.fecha_baja).trim() !== '');
          const isCanceladaOrgRow = Boolean(
            rawPropStatus === 'cancelada_organizador' ||
            rawEstado === 'cancelada_organizador' ||
            row.cancelada_por_organizador ||
            row.canceladaPorOrganizador
          );
          const isBajaForzadaRow = Boolean(
            !isCanceladaOrgRow && (
              rawPropStatus === 'baja_forzada' ||
              rawEstado === 'baja_forzada' ||
              row.baja_forzada ||
              hasFechaBaja ||
              row.motivo_baja ||
              row.admin_baja_id
            )
          );

          const isApprovedAct = (isBajaForzadaRow || isCanceladaOrgRow)
            ? false
            : (isInstitutionalAct || (
                row.is_approved !== undefined && row.is_approved !== null
                  ? Boolean(row.is_approved)
                  : (row.estado === 'aprobada' || row.proposal_status === 'aprobada')
              ));

          const proposalStatusFinal = isCanceladaOrgRow
            ? 'cancelada_organizador'
            : isBajaForzadaRow
              ? 'baja_forzada'
              : (isInstitutionalAct
                  ? 'aprobada'
                  : (row.proposal_status || row.proposalStatus || row.estado || (isApprovedAct ? 'aprobada' : 'pendiente')));

          let parsedVersions = Array.isArray(row.versions)
            ? row.versions
            : (typeof row.versions === 'string' ? JSON.parse(row.versions) : []);

          const proposedAtFormatted = row.creado_el ? formatArgentinaDateTime(row.creado_el) : '';
          const resolvedTitle = String(row.title || row.titulo || 'Actividad sin título').trim();
          const resolvedImage = String(row.image || row.imagen_url || '').trim();
          const rawCap = row.capacity !== undefined && row.capacity !== null
            ? Number(row.capacity)
            : (row.cupo_maximo !== undefined && row.cupo_maximo !== null ? Number(row.cupo_maximo) : NaN);
          const resolvedCapacity = (row.tipo_cupo === 'ilimitado' || rawCap === 0 || rawCap >= 999)
            ? (rawCap >= 999 ? 999 : 0)
            : (!isNaN(rawCap) && rawCap > 0 ? rawCap : 20);

          if ((!parsedVersions || parsedVersions.length === 0) && (row.estado === 'cambios_solicitados' || row.proposal_status === 'cambios_solicitados' || row.proposal_status === 'pendiente')) {
            parsedVersions = [
              {
                version: 1,
                date: proposedAtFormatted,
                title: resolvedTitle,
                schedule: finalSchedule,
                location: finalLocation,
                lat: typeof row.lat === 'number' ? row.lat : (typeof row.latitud === 'number' ? row.latitud : -34.6068),
                lng: typeof row.lng === 'number' ? row.lng : (typeof row.longitud === 'number' ? row.longitud : -58.5647),
                capacity: resolvedCapacity,
                description: cleanDesc || row.short_description || row.avance || '',
                shortDescription: row.short_description || row.avance || '',
                image: resolvedImage,
                isRecurrent: isRecurrentAct,
                note: 'Versión original de la propuesta'
              }
            ];
          } else if (Array.isArray(parsedVersions)) {
            parsedVersions = parsedVersions.map((v: any) => ({
              ...v,
              isRecurrent: typeof v.isRecurrent === 'boolean' ? v.isRecurrent : isRecurrentAct
            }));
          }

          const resolvedVideoUrl = resolveActivityVideoUrl(row, Array.isArray(parsedVersions) ? parsedVersions : undefined);

          const rejMeta = parseRejectionMeta(row.admin_comments);
          const isRejectedRow = String(proposalStatusFinal || '').toLowerCase().trim() === 'rechazada' || isProposalRejected({ proposalStatus: proposalStatusFinal, estado: row.estado });
          const resolvedRejectionReason = isRejectedRow
            ? String(row.rejection_reason || row.feedback || row.feedback_admin || row.proposal_note || row.proposalNote || '').trim()
            : String(row.rejection_reason || '').trim();

          return {
            id: Number(row.id) || (typeof row.id === 'number' ? row.id : 0),
            title: resolvedTitle,
            category: row.categoria || row.category || 'General',
            schedule: finalSchedule,
            location: finalLocation,
            direccion: finalLocation,
            lat: typeof row.lat === 'number' ? row.lat : (typeof row.latitud === 'number' ? row.latitud : -34.6068),
            lng: typeof row.lng === 'number' ? row.lng : (typeof row.longitud === 'number' ? row.longitud : -58.5647),
            organizer: resolvedApodo,
            organizerNombre: resolvedApodo,
            organizerBio: userMatch?.bio || row.organizer_bio || '',
            organizerId: creatorId || row.organizer_id || (isInstitutionalAct ? 'institucional' : ''),
            organizerAvatar: userMatch?.avatar || undefined,
            organizerLocation: userMatch?.localidad || undefined,
            isInstitutional: isInstitutionalAct,
            isRecurrent: isRecurrentAct,
            cerrarInscripcionAlIniciarPrimerEncuentro: isRecurrentAct && Boolean(row.cerrar_inscripcion_al_iniciar_primer_encuentro ?? row.cerrarInscripcionAlIniciarPrimerEncuentro),
            firstEncounterDate: isRecurrentAct ? finalFirstDate : undefined,
            firstMeetingDate: isRecurrentAct ? finalFirstDate : undefined,
            fechaPrimerEncuentro: isRecurrentAct ? finalFirstDate : undefined,
            firstEncounterStartTime: isRecurrentAct ? (row.first_encounter_start_time || row.hora_inicio || extractedTimes.startTime) : undefined,
            firstEncounterEndTime: isRecurrentAct ? (row.first_encounter_end_time || row.hora_fin || extractedTimes.endTime) : undefined,
            diasSemana: row.dias_semana || row.diasSemana,
            dias_semana: row.dias_semana || row.diasSemana,
            diaMes: row.dia_mes || row.diaMes,
            dia_mes: row.dia_mes || row.diaMes,
            cantidadEventos: row.cantidad_eventos || row.cantidadEventos,
            cantidad_eventos: row.cantidad_eventos || row.cantidadEventos,
            frequency: row.frecuencia_tipo || row.frequency || row.frecuencia,
            frecuencia: row.frecuencia_tipo || row.frecuencia || row.frequency,
            startDate: finalStartDate,
            endDate: finalEndDate,
            startTime: finalStartTime,
            endTime: finalEndTime,
            fechaRealizacion: finalStartDate || finalFirstDate,
            fechaFin: finalEndDate,
            horaIni: finalStartTime,
            horaFin: finalEndTime,
            proposedAt: proposedAtFormatted,
            enrolled: Boolean(row.enrolled),
            capacity: resolvedCapacity,
            enrolledCount: Number(row.enrolled_count) || 0,
            shortDescription: row.short_description || row.avance || '',
            description: cleanDesc || row.short_description || row.avance || '',
            image: resolvedImage,
            videoUrl: resolvedVideoUrl || undefined,
            video_url: resolvedVideoUrl || undefined,
            isApproved: isApprovedAct,
            proposalStatus: proposalStatusFinal,
            proposal_status: proposalStatusFinal,
            estado: (isBajaForzadaRow || isCanceladaOrgRow)
              ? (row.estado || proposalStatusFinal)
              : (isInstitutionalAct ? 'aprobada' : (row.estado || proposalStatusFinal)),
            feedback: row.feedback || row.feedback_admin || row.proposal_note || row.proposalNote || '',
            feedback_admin: row.feedback_admin || '',
            proposalNote: row.proposal_note || row.proposalNote || row.feedback || row.feedback_admin || '',
            rejectionReason: resolvedRejectionReason || undefined,
            rejectedAt: rejMeta.rejectedAt || undefined,
            rejectedTimestamp: rejMeta.rejectedTimestamp || undefined,
            changesRequestedAt: row.changes_requested_at || row.changesRequestedAt || '',
            changes_requested_at: row.changes_requested_at || row.changesRequestedAt || '',
            changesRequestedByAdmin: row.changes_requested_by_admin || row.changesRequestedByAdmin || '',
            changesSubmittedAt: row.changes_submitted_at || row.changesSubmittedAt || null,
            userFeedbackNote: row.user_feedback_note || row.userFeedbackNote || '',
            baja_forzada: isBajaForzadaRow,
            canceladaPorOrganizador: isCanceladaOrgRow,
            fecha_baja: row.fecha_baja || null,
            bajaDate: row.fecha_baja
              ? (String(row.fecha_baja).includes('T') ? formatArgentinaDateTime(row.fecha_baja) : String(row.fecha_baja))
              : (row.baja_date || row.bajaDate || ''),
            motivo_baja: row.motivo_baja || '',
            bajaReason: row.motivo_baja || row.baja_reason || row.bajaReason || row.feedback_admin || ((isBajaForzadaRow || isCanceladaOrgRow) ? (row.proposal_note || row.feedback || '') : ''),
            admin_baja_id: row.admin_baja_id || '',
            bajaAdmin: row.admin_baja_id || row.baja_admin || row.bajaAdmin || '',
            vettedUsers: Array.isArray(row.vetted_users) ? row.vetted_users : (Array.isArray(row.vettedUsers) ? row.vettedUsers : []),
            enrolledUsernames: Array.isArray(row.enrolled_usernames) ? row.enrolled_usernames : (Array.isArray(row.enrolledUsernames) ? row.enrolledUsernames : []),
            versions: parsedVersions,
          } as Activity;
  },

  async getActivities(forceRefresh = false): Promise<Activity[]> {
    const now = Date.now();
    if (!forceRefresh && cachedActivitiesList && (now - lastActivitiesFetchTime < 15000)) {
      if (cachedActivitiesList.some(act => isPendingProposalExpired(act))) {
        return await this.expirePendingProposals(cachedActivitiesList);
      }
      return cachedActivitiesList;
    }
    if (activitiesInFlightPromise) {
      return activitiesInFlightPromise;
    }

    activitiesInFlightPromise = (async () => {
      try {
        // 1. Reutilizar mapa de usuarios centralizado y deduplicado en memoria (evita consultas redundantes)
        const usersMap = await this.getUsers().catch(() => ({} as Record<string, User>));

        // 2. Consultar actividades desde Supabase con columnas específicas y límite (coincidentes con la estructura real de la tabla)
        const { data, error } = await supabase
          .from('activities')
          .select('id, title, titulo, category, categoria, schedule, horario_resumen, location, direccion, lat, lng, latitud, longitud, organizer, organizer_bio, organizer_id, creador_id, organizador_id, user_id, creador, is_institutional, is_recurrent, es_recurrente, frecuencia_tipo, dias_semana, cantidad_eventos, tipo_cupo, cupo_maximo, cerrar_inscripcion_al_iniciar_primer_encuentro, first_encounter_date, first_encounter_start_time, first_encounter_end_time, start_date, start_time, end_date, end_time, fecha_inicio, hora_inicio, fecha_fin, hora_fin, capacity, enrolled, enrolled_count, short_description, avance, description, descripcion, image, imagen_url, is_approved, proposal_status, estado, proposal_note, feedback, feedback_admin, rejection_reason, admin_comments, vetted_users, enrolled_usernames, versions, changes_requested_at, changes_requested_by_admin, changes_submitted_at, user_feedback_note, admin_baja_id, fecha_baja, motivo_baja, creado_el')
          .order('id', { ascending: false })
          .limit(60);

        if (!error && Array.isArray(data) && data.length > 0) {
          const mappedList: Activity[] = data.map((row: any) => this.mapSupabaseActivityRow(row, usersMap));
          const finalList = await this.expirePendingProposals(mappedList);
          cachedActivitiesList = finalList;
          lastActivitiesFetchTime = Date.now();
          return finalList;
        }
      } catch (err) {
        console.error('Error al consultar actividades de Supabase:', err);
      }

      // Fallback a API local si Supabase no devolvió actividades
      try {
        const res = await fetch('/api/activities', { headers: getHeaders() });
        const parsed = await safeParseJson<Activity[]>(res);
        if (parsed.ok && parsed.isJson && Array.isArray(parsed.data)) {
          const finalLocal = await this.expirePendingProposals(parsed.data);
          cachedActivitiesList = finalLocal;
          lastActivitiesFetchTime = Date.now();
          return finalLocal;
        }
      } catch {}

      return [];
    })().finally(() => {
      activitiesInFlightPromise = null;
    });

    return activitiesInFlightPromise;
  },

  async getActivityById(activityId: number | string): Promise<Activity | null> {
    const targetStr = String(activityId ?? '').trim();
    if (!targetStr) return null;

    if (cachedActivitiesList) {
      const fromCache = cachedActivitiesList.find(a => String(a.id) === targetStr);
      if (fromCache) return fromCache;
    }

    try {
      const usersMap = await this.getUsers().catch(() => ({} as Record<string, User>));
      const { data, error } = await supabase
        .from('activities')
        .select('id, title, titulo, category, categoria, schedule, horario_resumen, location, direccion, lat, lng, latitud, longitud, organizer, organizer_bio, organizer_id, creador_id, organizador_id, user_id, creador, is_institutional, is_recurrent, es_recurrente, frecuencia_tipo, dias_semana, cantidad_eventos, tipo_cupo, cupo_maximo, cerrar_inscripcion_al_iniciar_primer_encuentro, first_encounter_date, first_encounter_start_time, first_encounter_end_time, start_date, start_time, end_date, end_time, fecha_inicio, hora_inicio, fecha_fin, hora_fin, capacity, enrolled, enrolled_count, short_description, avance, description, descripcion, image, imagen_url, is_approved, proposal_status, estado, proposal_note, feedback, feedback_admin, rejection_reason, admin_comments, vetted_users, enrolled_usernames, versions, changes_requested_at, changes_requested_by_admin, changes_submitted_at, user_feedback_note, admin_baja_id, fecha_baja, motivo_baja, creado_el')
        .eq('id', activityId)
        .maybeSingle();

      if (!error && data) {
        const mapped = this.mapSupabaseActivityRow(data, usersMap);
        const [finalAct] = await this.expirePendingProposals([mapped]);
        return finalAct || mapped;
      }
    } catch (err) {
      console.error('Error al consultar detalle de actividad en Supabase:', err);
    }

    const freshList = await this.getActivities(true).catch(() => [] as Activity[]);
    return freshList.find(a => String(a.id) === targetStr) || null;
  },

  async createActivity(activity: Partial<Activity>): Promise<Activity> {
    // Validar colisión de horario contra las actividades en las que participa el usuario
    const currentUser = await this.getMe().catch(() => null);
    if (currentUser) {
      const allActivities = await this.getActivities().catch(() => []);
      const collisionCheck = canUserCreateActivity(activity, currentUser, allActivities);
      if (!collisionCheck.allowed) {
        throw new Error(collisionCheck.reason || 'No podés crear una actividad que coincida en día y horario con otra a la que estás inscripto/a.');
      }
    }

    let created: Activity | null = null;

    // 1. Intentar persistir vía backend local si estuviera disponible
    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(activity)
      });
      const parsed = await safeParseJson<Activity>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        created = parsed.data;
      }
    } catch (_) {
      // Ignorar fallo de backend en entornos estáticos como Netlify
    }

    const isRecurrentInput = typeof activity.isRecurrent === 'boolean'
      ? activity.isRecurrent
      : ((activity as any)?.frecuencia === 'recurrente' || activity.frequency === 'recurrente');

    // 2. Fallback estático / en memoria
    if (!created) {
      created = {
        ...activity,
        id: Date.now(),
        title: activity.title || (activity as any).nombre || '',
        description: activity.description || (activity as any).descripcion || '',
        descripcion: activity.description || (activity as any).descripcion || '',
        category: activity.category || (activity as any).categoria || '',
        schedule: activity.schedule || (activity as any).horario || '',
        horario: activity.schedule || (activity as any).horario || '',
        location: activity.location || (activity as any).direccion || '',
        direccion: activity.location || (activity as any).direccion || '',
        lat: activity.lat,
        lng: activity.lng,
        isInstitutional: Boolean(activity.isInstitutional),
        isRecurrent: isRecurrentInput,
        organizerId: activity.organizerId || '',
        proposalStatus: activity.proposalStatus || (activity.isInstitutional ? 'aprobada' : 'pendiente'),
        isApproved: activity.isInstitutional || activity.proposalStatus === 'aprobada',
        firstMeetingDate: isRecurrentInput ? (activity.firstMeetingDate || (activity as any).fechaPrimerEncuentro || '') : '',
        fechaPrimerEncuentro: isRecurrentInput ? (activity.firstMeetingDate || (activity as any).fechaPrimerEncuentro || '') : '',
        firstEncounterDate: isRecurrentInput ? (activity.firstEncounterDate || activity.firstMeetingDate || (activity as any).fechaPrimerEncuentro || '') : '',
        enrolledUsernames: [],
        enrolledCount: 0
      } as Activity;
    } else {
      created.isRecurrent = isRecurrentInput;
      if (!isRecurrentInput) {
        created.firstMeetingDate = undefined;
        created.fechaPrimerEncuentro = undefined;
        created.firstEncounterDate = undefined;
      }
    }

    // 3. Persistir en Supabase sin columnas inexistentes (horario/ubicacion)
    try {
      if (supabase) {
        const finalOrganizerId = (activity.organizerId && activity.organizerId !== 'personal')
          ? String(activity.organizerId)
          : (created.organizerId && created.organizerId !== 'personal')
            ? String(created.organizerId)
            : (currentUser?.id ? String(currentUser.id) : (activity.isInstitutional ? 'institucional' : ''));

        const primerEncuentroTexto = (isRecurrentInput && (activity.firstMeetingDate || (activity as any).fechaPrimerEncuentro))
          ? `\nPrimer encuentro: ${formatToArgentinaDate(activity.firstMeetingDate || (activity as any).fechaPrimerEncuentro)}`
          : '';

        const descCompleta = (activity.description || created.description || '') +
          primerEncuentroTexto +
          (activity.location || created.location ? `\n\nLugar: ${activity.location || created.location}` : '') +
          (activity.schedule || created.schedule ? `\nHorario: ${activity.schedule || created.schedule}` : '');

        const locFinal = activity.location || (activity as any).direccion || created.location || created.direccion || '';
        const schedFinal = activity.schedule || (activity as any).horario || created.schedule || '';
        const firstDateFinal = isRecurrentInput
          ? (activity.firstMeetingDate || (activity as any).fechaPrimerEncuentro || created.firstMeetingDate || created.firstEncounterDate || null)
          : null;
        const isRecurrentVal = isRecurrentInput;
        const isInstitutionalVal = Boolean(activity.isInstitutional ?? created.isInstitutional ?? (finalOrganizerId === 'institucional'));
        const isApprovedVal = Boolean(activity.isApproved ?? created.isApproved ?? isInstitutionalVal ?? (created.proposalStatus === 'aprobada'));
        const resolvedCap = typeof activity.capacity === 'number' ? activity.capacity : (created.capacity ?? 20);
        const resolvedTipoCupo = (resolvedCap === 0 || resolvedCap >= 999) ? 'ilimitado' : 'limitado';
        const resolvedImg = activity.image || (activity as any).foto || (activity as any).imagen || created.image || '';
        const resolvedVideoUrl = String(activity.videoUrl || (activity as any).video_url || created.videoUrl || '').trim();

        const initialVersions = [
          {
            version: 1,
            date: formatArgentinaDateTime(),
            title: activity.title || created.title || 'Actividad sin título',
            schedule: schedFinal,
            location: locFinal,
            lat: typeof activity.lat === 'number' ? activity.lat : (typeof created.lat === 'number' ? created.lat : -34.6068),
            lng: typeof activity.lng === 'number' ? activity.lng : (typeof created.lng === 'number' ? created.lng : -58.5647),
            capacity: resolvedCap,
            description: activity.description || created.description || '',
            shortDescription: activity.shortDescription || (activity as any).avance || created.shortDescription || '',
            image: resolvedImg,
            ...(resolvedVideoUrl ? { videoUrl: resolvedVideoUrl } : {}),
            isRecurrent: isRecurrentVal,
            note: 'Versión original de la propuesta'
          }
        ];

        created.versions = initialVersions;
        created.image = resolvedImg;
        if (resolvedVideoUrl) {
          created.videoUrl = resolvedVideoUrl;
          (created as any).video_url = resolvedVideoUrl;
        }

        const finalTitle = activity.title || created.title || (activity as any).nombre || 'Actividad sin título';
        const finalOrganizerName = activity.organizer || created.organizer || (activity as any).organizerName || currentUser?.apodo || currentUser?.usuario || 'Organizador';
        const finalProposalStatus = isApprovedVal ? 'aprobada' : (activity.proposalStatus || created.proposalStatus || 'pendiente');

        const payloadSupabase: Record<string, any> = {
          id: String(created.id),
          title: finalTitle,
          titulo: finalTitle,
          descripcion: descCompleta,
          description: descCompleta,
          creador_id: finalOrganizerId,
          organizer_id: finalOrganizerId,
          organizador_id: finalOrganizerId,
          organizer: finalOrganizerName,
          organizer_bio: activity.organizerBio || created.organizerBio || '',
          categoria: activity.category || created.category || 'General',
          category: activity.category || created.category || 'General',
          location: locFinal,
          direccion: locFinal,
          schedule: schedFinal,
          horario_resumen: schedFinal,
          first_encounter_date: firstDateFinal,
          first_encounter_start_time: isRecurrentVal ? (activity.firstEncounterStartTime || (activity as any).horaIni || null) : null,
          first_encounter_end_time: isRecurrentVal ? (activity.firstEncounterEndTime || (activity as any).horaFin || null) : null,
          cerrar_inscripcion_al_iniciar_primer_encuentro: isRecurrentVal && Boolean(activity.cerrarInscripcionAlIniciarPrimerEncuentro || (activity as any).cerrar_inscripcion_al_iniciar_primer_encuentro),
          lat: typeof activity.lat === 'number' ? activity.lat : (typeof created.lat === 'number' ? created.lat : -34.6068),
          lng: typeof activity.lng === 'number' ? activity.lng : (typeof created.lng === 'number' ? created.lng : -58.5647),
          is_institutional: isInstitutionalVal,
          is_recurrent: isRecurrentVal,
          es_recurrente: isRecurrentVal,
          frecuencia_tipo: isRecurrentVal ? (activity.frequency || (activity as any).frecuencia || 'semanal') : 'unico',
          dias_semana: isRecurrentVal ? (activity.diasSemana || (activity as any).dias_semana || null) : null,
          cantidad_eventos: isRecurrentVal ? ((activity as any).cantidadEventos || (activity as any).cantidad_eventos || null) : null,
          is_approved: isApprovedVal,
          proposal_status: finalProposalStatus,
          estado: finalProposalStatus,
          short_description: activity.shortDescription || (activity as any).avance || created.shortDescription || '',
          avance: activity.shortDescription || (activity as any).avance || created.shortDescription || '',
          capacity: resolvedCap,
          cupo_maximo: resolvedCap,
          tipo_cupo: resolvedTipoCupo,
          image: resolvedImg || null,
          imagen_url: resolvedImg || null,
          ...(resolvedVideoUrl ? { video_url: resolvedVideoUrl } : {}),
          fecha_inicio: activity.startDate || (activity as any).fechaIni || null,
          start_date: activity.startDate || (activity as any).fechaIni || null,
          hora_inicio: activity.startTime || (activity as any).horaIni || null,
          start_time: activity.startTime || (activity as any).horaIni || null,
          fecha_fin: activity.endDate || (activity as any).fechaFin || null,
          end_date: activity.endDate || (activity as any).fechaFin || null,
          hora_fin: activity.endTime || (activity as any).horaFin || null,
          end_time: activity.endTime || (activity as any).horaFin || null,
          versions: initialVersions
        };

        let { error: sbError } = await supabase.from('activities').upsert([payloadSupabase]);
        if (sbError && isMissingVideoUrlColumnError(sbError) && 'video_url' in payloadSupabase) {
          const { video_url: _omitVideoUrl, ...fallbackPayload } = payloadSupabase;
          const retryRes = await supabase.from('activities').upsert([fallbackPayload]);
          sbError = retryRes.error;
        }
        if (sbError) {
          console.warn('Detalle error Supabase al guardar actividad:', sbError.message);
        }

        // Crear el chat de la actividad ÚNICAMENTE cuando la actividad está aprobada/publicada.
        // Las propuestas vecinales pendientes NO generan chat hasta ser aprobadas por moderación.
        if (isApprovedVal) {
          try {
            const userForChat = currentUser || {
              id: finalOrganizerId,
              apodo: finalOrganizerName,
              usuario: finalOrganizerName
            };
            if (userForChat && userForChat.id) {
              await chatService.createActivityChat({
                activity: { ...created, title: finalTitle, image: resolvedImg },
                currentUser: userForChat
              });
            }
          } catch (chatErr) {
            console.warn('Aviso vinculando chat de actividad en Supabase:', chatErr);
          }
        }
      }
    } catch (err: any) {
      console.warn('Persistencia Supabase diferida:', err?.message || err);
    }

    // Actualizar cache local en memoria inmediatamente para que el refresco sea instantáneo
    invalidateApiCaches();
    cachedActivitiesList = [created, ...(cachedActivitiesList || [])];
    lastActivitiesFetchTime = Date.now();

    return created;
  },
  async enrollActivity(id: number | string): Promise<Activity> {
    const currentUser = await this.getCurrentUser().catch(() => null);
    const userIdOrNick = currentUser?.id || currentUser?.apodo || currentUser?.usuario || getStoredUserId();

    // 1. Persistir inscripción en Supabase (tabla activities)
    let activityTitle = 'Actividad';
    if (supabase && currentUser) {
      const { data: dbAct, error: fetchErr } = await supabase
        .from('activities')
        .select('id, title, titulo, schedule, is_recurrent, cerrar_inscripcion_al_iniciar_primer_encuentro, first_encounter_date, first_encounter_start_time, first_encounter_end_time, enrolled_usernames, enrolled_count, vetted_users')
        .eq('id', String(id))
        .maybeSingle();

      if (fetchErr) {
        console.warn('Error consultando actividad en Supabase:', fetchErr.message);
      }

      if (dbAct) {
        const allActivities = await this.getActivities().catch(() => []);
        const myEnrolledActs = allActivities.filter((a: any) =>
          String(a.id) !== String(id) && isUserEnrolledInActivity(a, currentUser)
        );
        const check = canUserEnrollActivity(dbAct, currentUser, undefined, myEnrolledActs);
        if (!check.allowed) {
          throw new Error(check.reason || 'Inscripción no permitida para esta actividad.');
        }
        if (dbAct.title || dbAct.titulo) {
          activityTitle = dbAct.title || dbAct.titulo;
        }
      }

      const currentEnrolled: string[] = Array.isArray(dbAct?.enrolled_usernames) ? dbAct.enrolled_usernames : [];
      const canonicalName = (currentUser.apodo || currentUser.usuario || currentUser.nombre || 'Participante').trim();
      // Filtrar identificadores técnicos (usr_... o UUIDs) para que nunca figuren como inscriptos extra
      const filteredEnrolled = currentEnrolled.filter((u: string) =>
        Boolean(u) && !isTechnicalIdentifier(u) && !isDummyOrSystemParticipant(u)
      );
      const updatedList = Array.from(new Set([...filteredEnrolled, canonicalName]));

      const { error: enrollUpdateErr } = await supabase
        .from('activities')
        .update({
          enrolled_usernames: updatedList,
          enrolled_count: updatedList.length,
          enrolled: true
        })
        .eq('id', String(id));

      if (enrollUpdateErr) {
        throw new Error(enrollUpdateErr.message || 'No se pudo guardar la inscripción en el sistema.');
      }

      // 2. Limpiar bloqueos locales previos (si anteriormente salió del grupo o lo ocultó) y vincular chat_participants
      try {
        if (typeof localStorage !== 'undefined') {
          const cleanActTitle = String(activityTitle || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
          const tokCandidates = [currentUser.id, currentUser.usuario, currentUser.apodo, currentUser.nombre, 'local']
            .filter(Boolean)
            .map((t: any) => String(t).trim());
          const matchIds = new Set<string>([String(id)]);
          try {
            const storedChats = JSON.parse(localStorage.getItem('club65_custom_chats') || '[]');
            if (Array.isArray(storedChats)) {
              for (const sc of storedChats) {
                const scTitle = String(sc?.title || sc?.name || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
                if (
                  (sc?.activityId && String(sc.activityId) === String(id)) ||
                  String(sc?.id) === String(id) ||
                  (cleanActTitle && scTitle === cleanActTitle)
                ) {
                  if (sc?.id) matchIds.add(String(sc.id));
                }
              }
            }
          } catch (_) {}
          for (const tok of tokCandidates) {
            for (const key of [`left_chats_${tok}`, `deleted_chats_${tok}`]) {
              try {
                const arr: string[] = JSON.parse(localStorage.getItem(key) || '[]');
                if (Array.isArray(arr) && arr.length > 0) {
                  const filtered = arr.filter(x => !matchIds.has(String(x)));
                  if (filtered.length !== arr.length) {
                    localStorage.setItem(key, JSON.stringify(filtered));
                  }
                }
              } catch (_) {}
            }
          }
        }
      } catch (_) {}

      try {
        const curNotifs = Array.isArray((currentUser as any).notifications)
          ? (currentUser as any).notifications
          : await this.fetchUserNotificationsOnce(String(currentUser.id)).catch(() => []);
        const actStr = String(id);
        const cleanedNotifs = curNotifs.filter((n: any) => !(
          n &&
          n.type === 'chat_removed_notice' &&
          n.reason === 'left' &&
          (String(n.activityId || '') === actStr || String(n.chatId || '') === actStr)
        ));
        if (cleanedNotifs.length !== curNotifs.length) {
          await supabase.from('users').update({ notifications: cleanedNotifs }).eq('id', String(currentUser.id));
          cachedNotificationsByUser.set(String(currentUser.id), cleanedNotifs);
        }
      } catch (_) {}

      try {
        await chatService.enrollUserInActivityChat({
          activityId: id,
          activityTitle,
          activityImage: (dbAct as any)?.image || (dbAct as any)?.foto || null,
          currentUser
        });
      } catch (chatErr) {
        console.warn('Aviso vinculando participante a chat de actividad en Supabase:', chatErr);
      }
      invalidateApiCaches();
    }

    // 3. Notificar al backend local (server.ts) para mantener el estado en memoria
    let act: any = null;
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(String(id))}/enroll`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json',
          'x-user-id': String(userIdOrNick)
        }
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        act = parsed.data.activity;
      } else if (res.status === 400 || res.status === 403) {
        throw new Error(parsed.data?.error || 'No se pudo completar la inscripción.');
      }
    } catch (e: any) {
      if (e instanceof Error && e.message && !e.message.includes('Failed to fetch')) {
        throw e;
      }
      console.warn('Backend diferido en enroll:', e);
    }

    return act || ({ id: String(id), enrolled: true } as any);
  },

  async unenrollActivity(id: number | string): Promise<Activity> {
    const currentUser = await this.getCurrentUser().catch(() => null);
    const userIdOrNick = currentUser?.id || currentUser?.apodo || currentUser?.usuario || getStoredUserId();

    let resolvedTitle = '';
    const myTokens = currentUser
      ? [currentUser.id, currentUser.apodo, currentUser.usuario, currentUser.nombre]
          .filter(Boolean)
          .map((s: any) => String(s).toLowerCase().trim())
      : [];

    // 1. Remover directamente de Supabase
    if (supabase && currentUser) {
      try {
        const { data: dbAct } = await supabase
          .from('activities')
          .select('id, title, titulo, enrolled_usernames, enrolled_count')
          .eq('id', String(id))
          .maybeSingle();

        resolvedTitle = dbAct?.title || dbAct?.titulo || '';

        if (dbAct && Array.isArray(dbAct.enrolled_usernames)) {
          const updatedList = dbAct.enrolled_usernames.filter(
            (u: string) => !myTokens.includes(String(u).toLowerCase().trim())
          );

          await supabase
            .from('activities')
            .update({
              enrolled_usernames: updatedList,
              enrolled_count: Math.max(0, updatedList.length),
              enrolled: false
            })
            .eq('id', String(id));
        }

        // Desvincular siempre de chat_participants (sin eliminar el chat ni su historial)
        try {
          await chatService.unenrollUserFromActivityChat({
            activityId: id,
            activityTitle: resolvedTitle || undefined,
            userId: currentUser.id
          });
        } catch (unenrollErr) {
          console.warn('Aviso desinscribiendo de chat de actividad:', unenrollErr);
        }
      } catch (e) {
        console.warn('Error removiendo inscripción en Supabase:', e);
      }
      invalidateApiCaches();
    }

    // Limpiar caché local del chat de la actividad para este usuario (excepto si es creador/moderador)
    try {
      if (typeof localStorage !== 'undefined' && currentUser && currentUser.tipo !== 'moderador') {
        const stored = localStorage.getItem('club65_custom_chats');
        if (stored) {
          const list = JSON.parse(stored);
          if (Array.isArray(list)) {
            const cleanTargetTitle = resolvedTitle.replace(/^grupo:\s*/i, '').trim().toLowerCase();
            const filtered = list.filter((c: any) => {
              if (!c || c.type === 'privado') return true;
              const cTitleClean = String(c.title || c.name || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
              const matchesAct =
                (c.activityId && String(c.activityId) === String(id)) ||
                String(c.id) === String(id) ||
                (cleanTargetTitle && cTitleClean === cleanTargetTitle);
              if (!matchesAct) return true;
              const isCreator = [c.creatorId, c.creatorName, c.organizerId, c.organizer]
                .filter(Boolean)
                .some((t: any) => myTokens.includes(String(t).toLowerCase().trim()));
              return isCreator;
            });
            localStorage.setItem('club65_custom_chats', JSON.stringify(filtered));
          }
        }
      }
    } catch (_) {}

    // 2. Notificar al backend local
    let act: any = null;
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(String(id))}/unenroll`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Content-Type': 'application/json',
          'x-user-id': String(userIdOrNick)
        }
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        act = parsed.data.activity;
      }
    } catch (e) {
      console.warn('Backend diferido en unenroll:', e);
    }

    return act || ({ id: String(id), enrolled: false } as any);
  },

  async vetoUser(id: number | string, username: string): Promise<Activity> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión para vetar participantes.'
    });

    const targetName = String(username || '').trim();
    const targetLow = targetName.toLowerCase();
    const tokensToVeto = new Set<string>();
    if (targetLow) tokensToVeto.add(targetLow);

    let matchedUser: any = null;
    if (supabase && targetName) {
      try {
        const { data: allDbUsers } = await supabase
          .from('users')
          .select('id, usuario, apodo, avatar, tipo, notifications');
        if (Array.isArray(allDbUsers)) {
          matchedUser = allDbUsers.find((u: any) =>
            [u.id, u.usuario, u.apodo].filter(Boolean).some(t => String(t).trim().toLowerCase() === targetLow)
          ) || null;
        }
      } catch (uErr) {
        console.warn('Aviso buscando usuario para vetar en Supabase:', uErr);
      }
    }

    if (matchedUser) {
      if (matchedUser.id) tokensToVeto.add(String(matchedUser.id).trim().toLowerCase());
      if (matchedUser.usuario) tokensToVeto.add(String(matchedUser.usuario).trim().toLowerCase());
      if (matchedUser.apodo) tokensToVeto.add(String(matchedUser.apodo).trim().toLowerCase());
    }
    const displayTargetName = String(matchedUser?.apodo || matchedUser?.usuario || targetName).trim() || targetName;

    let updatedActTitle = '';
    if (supabase) {
      const { data: actRow, error: actFetchErr } = await supabase
        .from('activities')
        .select('id, title, titulo, enrolled_usernames, enrolled_count, vetted_users')
        .eq('id', String(id))
        .maybeSingle();

      if (actFetchErr) {
        throw new Error(actFetchErr.message || 'Error consultando actividad para vetar.');
      }

      if (actRow) {
        updatedActTitle = String(actRow.title || actRow.titulo || '').trim();
        const currentEnrolled: string[] = Array.isArray(actRow.enrolled_usernames) ? actRow.enrolled_usernames : [];
        const updatedEnrolled = currentEnrolled.filter(
          (u: string) => !tokensToVeto.has(String(u || '').trim().toLowerCase())
        );

        const currentVetted: string[] = Array.isArray(actRow.vetted_users) ? actRow.vetted_users : [];
        const vettedSeenLower = new Set(currentVetted.map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
        const nextVetted = [...currentVetted];
        const candidateVettedTokens = [
          matchedUser?.usuario,
          matchedUser?.apodo,
          matchedUser?.id,
          targetName
        ].filter(Boolean) as string[];
        for (const tok of candidateVettedTokens) {
          const cleanTok = String(tok).trim();
          const lowTok = cleanTok.toLowerCase();
          if (cleanTok && !vettedSeenLower.has(lowTok)) {
            vettedSeenLower.add(lowTok);
            nextVetted.push(cleanTok);
          }
        }

        const { error: actUpdateErr } = await supabase
          .from('activities')
          .update({
            enrolled_usernames: updatedEnrolled,
            enrolled_count: updatedEnrolled.length,
            vetted_users: nextVetted
          })
          .eq('id', String(actRow.id));

        if (actUpdateErr) {
          throw new Error(actUpdateErr.message || 'No se pudo vetar al usuario en la actividad.');
        }

        // Localizar chat grupal asociado a la actividad para comprobar si el usuario ya formaba parte del grupo
        if (matchedUser?.id) {
          try {
            const cleanGroupStr = (s?: string) => String(s || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
            const actTitleClean = cleanGroupStr(updatedActTitle);

            const { data: actChats } = await supabase
              .from('chats')
              .select('id, nombre, tipo, actividad_id')
              .eq('tipo', 'grupo_actividad');

            const groupChat = Array.isArray(actChats)
              ? actChats.find((c: any) =>
                  (c.actividad_id && String(c.actividad_id) === String(actRow.id)) ||
                  (actTitleClean && cleanGroupStr(c.nombre) === actTitleClean)
                )
              : null;

            if (groupChat?.id) {
              const { data: partRows } = await supabase
                .from('chat_participants')
                .select('user_id, users:user_id (id, usuario, apodo)')
                .eq('chat_id', groupChat.id);

              const wasParticipantInGroup = Array.isArray(partRows) && partRows.some(
                (r: any) => String(r.user_id) === String(matchedUser.id)
              );

              // ÚNICAMENTE si el usuario ya era miembro del grupo antes de ser vetado:
              // 1) Se lo elimina de chat_participants
              // 2) Se publica aviso del sistema en el grupo
              // 3) Se registra chat_removed_notice en sus notificaciones para mostrar el banner en Mi Chat
              // Si NO formaba parte del grupo, no cambia nada en Mi Chat ni en el grupo ni para el usuario vetado.
              if (wasParticipantInGroup) {
                const participantsSnapshot = (partRows || [])
                  .map((r: any) => {
                    const u = Array.isArray(r.users) ? r.users[0] : r.users;
                    return String(u?.apodo || u?.usuario || r.user_id || '').trim();
                  })
                  .filter((name: string) => Boolean(name) && !isDummyOrSystemParticipant(name));

                const exitNowMs = Date.now();
                const exitNowIso = new Date(exitNowMs).toISOString();

                const curNotifs = Array.isArray(matchedUser.notifications) ? matchedUser.notifications : [];
                const nextNotifs = [
                  ...curNotifs.filter((n: any) => !(n && n.type === 'chat_removed_notice' && String(n.chatId) === String(groupChat.id))),
                  {
                    id: `chat_removed_${groupChat.id}`,
                    type: 'chat_removed_notice',
                    reason: 'vetoed',
                    chatId: String(groupChat.id),
                    activityId: String(actRow.id),
                    participantsSnapshot,
                    removedAt: exitNowMs,
                    createdAt: exitNowIso
                  }
                ];
                await supabase.from('users').update({ notifications: nextNotifs }).eq('id', matchedUser.id);
                cachedNotificationsByUser.set(String(matchedUser.id), nextNotifs);

                const sysMsgId = `sys_veto_${exitNowMs}_${Math.random().toString(36).substring(2, 6)}`;
                const sChatId = chatIdentifierToBigInt(String(groupChat.id));
                await supabase.from('messages').insert({
                  id: sysMsgId,
                  chat_id: sChatId,
                  sender_id: 'sistema',
                  sender: 'Sistema CLUB65',
                  avatar: '🛡️',
                  role: 'sistema',
                  text: `${displayTargetName} fue retirado del grupo porque fue vetado de la actividad.`,
                  time: formatArgentinaTimeOnly(new Date(exitNowMs)),
                  created_at: exitNowIso,
                  reply_to: {
                    event: 'participant_removed',
                    reason: 'vetoed',
                    participant: displayTargetName,
                    participantId: matchedUser.id,
                    participantTokens: Array.from(tokensToVeto),
                    participantsSnapshot
                  }
                });

                await chatService.removeParticipantFromGroup(groupChat.id, matchedUser.id);
              }
            }
          } catch (chatVetoErr) {
            console.warn('Aviso sincronizando veto en grupo de chat:', chatVetoErr);
          }
        }
      }
    }

    // Sincronizar de forma no bloqueante con backend local si existe
    let backendAct: any = null;
    try {
      const res = await fetch(`/api/activities/${encodeURIComponent(String(id))}/veto`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ username })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        backendAct = parsed.data.activity;
      }
    } catch (_) {}

    cachedActivitiesList = null;
    lastActivitiesFetchTime = 0;
    const freshActs = await this.getActivities(true).catch(() => []);
    const matchedAct = freshActs.find(a => String(a.id) === String(id));
    if (matchedAct) return matchedAct;
    if (backendAct) return backendAct;
    throw new Error('Error al vetar al usuario.');
  },

  async deleteActivity(id: number | string, motivo?: string): Promise<void> {
    const { actor, dbUser } = await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión para cancelar una actividad.'
    });
    await this.darDeBajaActividad(
      id,
      motivo || 'Cancelada por el organizador',
      dbUser || { id: actor.actorId, usuario: actor.reporterUsername }
    );
  },

 async moderateActivity(id: number | string, action: 'approve' | 'reject' | 'request_changes', note?: string): Promise<void> {
    const { dbUser: moderatorRow } = await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión con una cuenta de moderación para moderar actividades.'
    });

    const rawId = String(id).trim();
    const idFilter: number | string = !isNaN(Number(rawId)) && /^\d+$/.test(rawId) ? Number(rawId) : rawId;

    // 1. Consultar estado y versiones actuales en Supabase (incluyendo columnas en español e inglés)
    const { data: rawCurrentAct, error: fetchErr } = await supabase
      .from('activities')
      .select('id, title, titulo, schedule, horario_resumen, location, direccion, lat, lng, latitud, longitud, capacity, cupo_maximo, tipo_cupo, description, descripcion, short_description, avance, image, imagen_url, is_recurrent, es_recurrente, start_date, start_time, end_date, end_time, fecha_inicio, hora_inicio, first_encounter_date, first_encounter_start_time, frecuencia_tipo, versions, proposal_status, estado, is_approved, is_institutional, creado_el, creador_id, organizer_id, organizador_id, organizer')
      .eq('id', idFilter)
      .single();
    const currentAct: any = rawCurrentAct;

    if (fetchErr) {
      console.error('Error al consultar actividad para moderar:', fetchErr);
    }

    const nowFormatted = formatArgentinaDateTime();

    // Si la propuesta pendiente ya superó su fecha y horario de inicio, se desestima automáticamente como rechazada
    if ((action === 'approve' || action === 'request_changes') && currentAct && isPendingProposalExpired(currentAct)) {
      await supabase
        .from('activities')
        .update({
          is_approved: false,
          proposal_status: 'rechazada',
          estado: 'rechazada',
          rejection_reason: AUTO_EXPIRED_PROPOSAL_REASON,
          feedback: AUTO_EXPIRED_PROPOSAL_REASON,
          feedback_admin: AUTO_EXPIRED_PROPOSAL_REASON,
          proposal_note: AUTO_EXPIRED_PROPOSAL_REASON,
          admin_comments: JSON.stringify({
            rejectedAt: nowFormatted,
            rejectedTimestamp: Date.now(),
            autoExpired: true
          })
        })
        .eq('id', idFilter);
      invalidateApiCaches();
      throw new Error('Esta propuesta ya superó su fecha y horario de inicio, por lo que fue desestimada automáticamente como propuesta rechazada.');
    }

    const normTitle = String(currentAct?.title || currentAct?.titulo || '').trim();
    const normImage = String(currentAct?.image || currentAct?.imagen_url || '').trim();
    const normSchedule = String(currentAct?.schedule || currentAct?.horario_resumen || '').trim();
    const normLocation = String(currentAct?.location || currentAct?.direccion || '').trim();
    const normDesc = String(currentAct?.description || currentAct?.descripcion || '').trim();
    const normShortDesc = String(currentAct?.short_description || currentAct?.avance || '').trim();
    const normCap = currentAct?.capacity !== undefined && currentAct?.capacity !== null
      ? Number(currentAct.capacity)
      : (currentAct?.cupo_maximo !== undefined && currentAct?.cupo_maximo !== null ? Number(currentAct.cupo_maximo) : 20);
    const normCreatedFmt = currentAct?.creado_el ? formatArgentinaDateTime(currentAct.creado_el) : '';

    let parsedVersions: any[] = [];
    if (currentAct?.versions) {
      parsedVersions = Array.isArray(currentAct.versions)
        ? currentAct.versions
        : (typeof currentAct.versions === 'string' ? JSON.parse(currentAct.versions) : []);
    }

    // 2. Definir valores según la acción
    let updates: any = {};

    if (action === 'approve') {
      updates = {
        is_approved: true,
        proposal_status: 'aprobada',
        estado: 'aprobada',
        feedback: note || null,
      };
      if (normTitle) {
        updates.title = normTitle;
        updates.titulo = normTitle;
      }
      if (normImage) {
        updates.image = normImage;
        updates.imagen_url = normImage;
      }
    } else if (action === 'request_changes') {
      if (parsedVersions.length === 0 && currentAct) {
        parsedVersions = [
          {
            version: 1,
            date: normCreatedFmt || nowFormatted,
            title: normTitle,
            schedule: normSchedule,
            location: normLocation,
            lat: currentAct.lat ?? currentAct.latitud,
            lng: currentAct.lng ?? currentAct.longitud,
            capacity: normCap,
            description: normDesc,
            shortDescription: normShortDesc,
            image: normImage,
            isRecurrent: Boolean(currentAct.is_recurrent ?? currentAct.es_recurrente),
            note: 'Versión original de la propuesta',
            moderationNote: note || '',
            moderationDate: nowFormatted
          }
        ];
      } else if (parsedVersions.length > 0) {
        const lastIdx = parsedVersions.length - 1;
        parsedVersions[lastIdx] = {
          ...parsedVersions[lastIdx],
          changesRequested: true,
          moderationNote: note || '',
          moderationDate: nowFormatted,
          feedback: note || ''
        };
      }

      updates = {
        is_approved: false,
        proposal_status: 'cambios_solicitados',
        estado: 'cambios_solicitados',
        feedback: note || '',
        proposal_note: note || '',
        changes_requested_at: nowFormatted,
        changes_requested_by_admin: moderatorRow?.apodo || moderatorRow?.usuario || 'Administrador CLUB65',
        changes_submitted_at: null,
        user_feedback_note: null,
        versions: parsedVersions
      };
    } else if (action === 'reject') {
      const cleanRejectNote = (note && String(note).trim()) ? String(note).trim() : '';
      updates = {
        is_approved: false,
        proposal_status: 'rechazada',
        estado: 'rechazada',
        feedback: cleanRejectNote,
        feedback_admin: cleanRejectNote,
        proposal_note: cleanRejectNote,
        rejection_reason: cleanRejectNote,
        admin_comments: JSON.stringify({
          rejectedAt: nowFormatted,
          rejectedTimestamp: Date.now()
        })
      };
    }

    // 3. Guardar directamente en Supabase
    const { error: updateErr } = await supabase
      .from('activities')
      .update(updates)
      .eq('id', idFilter);

    if (updateErr) {
      console.error('Error en moderación Supabase:', updateErr);
      throw new Error(updateErr.message || 'Error en moderación.');
    }

    // 4. Sincronizar con backend Express (best-effort) y asegurar chat si se aprueba
    try {
      await fetch(`/api/activities/${encodeURIComponent(String(idFilter))}/moderate`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ action, note })
      }).catch(() => {});

      if (action === 'approve' && currentAct) {
        const creatorId = String(currentAct.creador_id || currentAct.organizer_id || currentAct.organizador_id || '').trim();
        const usersMap = await this.getUsers().catch(() => ({} as Record<string, User>));
        const orgUser = creatorId ? (usersMap[creatorId] || usersMap[creatorId.toLowerCase()] || null) : null;
        const orgName = orgUser?.apodo || orgUser?.usuario || currentAct.organizer || 'Organizador';

        if (creatorId) {
          await chatService.createActivityChat({
            activity: {
              ...currentAct,
              id: currentAct.id,
              title: normTitle || 'Actividad',
              image: normImage || null,
              organizerId: creatorId
            },
            currentUser: orgUser || {
              id: creatorId,
              apodo: orgName,
              usuario: orgName
            }
          });
        }
      }
    } catch (chatCreateErr) {
      console.warn('Error sincronizando moderación/chat de actividad:', chatCreateErr);
    }

    invalidateApiCaches();
  },

async resubmitProposal(id: number | string, data: Partial<Activity> & { userFeedbackNote?: string; [key: string]: any }): Promise<Activity> {
    const rawId = String(id).trim();
    const idFilter: number | string = !isNaN(Number(rawId)) && /^\d+$/.test(rawId) ? Number(rawId) : rawId;

    try {
      // 1. Obtener la actividad actual de Supabase (todas las columnas relevantes en inglés y español)
      const { data: rawCurrentAct, error: fetchErr } = await supabase
        .from('activities')
        .select('id, title, titulo, description, descripcion, short_description, avance, image, imagen_url, category, categoria, location, direccion, schedule, horario_resumen, lat, lng, latitud, longitud, capacity, cupo_maximo, tipo_cupo, is_recurrent, es_recurrente, versions, proposal_status, estado, feedback, proposal_note, changes_requested_at, creado_el, creador_id, organizer_id, organizador_id, organizer')
        .eq('id', idFilter)
        .single();
      const currentAct: any = rawCurrentAct;

      if (fetchErr) {
        console.error('Error al obtener actividad en resubmit:', fetchErr);
      }

      const nowStr = formatArgentinaDateTime();
      const normalizedCurrentAct = currentAct
        ? {
            ...currentAct,
            creado_el: currentAct.creado_el ? formatArgentinaDateTime(currentAct.creado_el) : undefined
          }
        : currentAct;

      const { updatePayload, cleanTitle, cleanImage } = buildResubmitProposalFields(
        normalizedCurrentAct,
        data,
        nowStr
      );

      let { data: supaData, error: supaErr } = await supabase
        .from('activities')
        .update(updatePayload)
        .eq('id', idFilter)
        .select()
        .single();

      if (supaErr && isMissingVideoUrlColumnError(supaErr) && 'video_url' in updatePayload) {
        const { video_url: _omitVideoUrl, ...fallbackUpdate } = updatePayload;
        const retryRes = await supabase
          .from('activities')
          .update(fallbackUpdate)
          .eq('id', idFilter)
          .select()
          .single();
        supaData = retryRes.data;
        supaErr = retryRes.error;
      }

      if (!supaErr && supaData) {
        // Si ya existía algún chat asociado a esta actividad, mantener sincronizado su nombre/foto
        try {
          const { data: actChats } = await supabase
            .from('chats')
            .select('id, nombre, foto_grupo_url, actividad_id')
            .eq('tipo', 'grupo_actividad');

          const matchedChat = (Array.isArray(actChats) ? actChats : []).find((c: any) =>
            doesDbChatRowMatchActivity(c, idFilter, cleanTitle)
          );
          if (matchedChat?.id) {
            const chatPatch: Record<string, any> = {};
            if (cleanTitle && matchedChat.nombre !== cleanTitle) {
              chatPatch.nombre = cleanTitle;
            }
            if (cleanImage && matchedChat.foto_grupo_url !== cleanImage) {
              chatPatch.foto_grupo_url = cleanImage;
            }
            if (Object.keys(chatPatch).length > 0) {
              await supabase.from('chats').update(chatPatch).eq('id', matchedChat.id);
            }
          }
        } catch (chatSyncErr) {
          console.warn('Aviso actualizando chat tras resubmit:', chatSyncErr);
        }

        invalidateApiCaches();
        return supaData as Activity;
      }

      if (supaErr) {
        console.error('Error al actualizar actividad en Supabase:', supaErr);
      }
    } catch (err) {
      console.warn('Excepción en resubmitProposal:', err);
    }

    const res = await fetch(`/api/activities/${encodeURIComponent(rawId)}/resubmit`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data)
    });

    const parsed = await safeParseJson<any>(res);
    if (!res.ok) {
      throw new Error(parsed.data?.error || 'Error al reenviar modificaciones.');
    }
    if (!parsed.isJson || !parsed.data) {
      throw new Error('No se pudo confirmar la actualización de la propuesta en el servidor.');
    }

    invalidateApiCaches();
    return (parsed.data.activity || parsed.data) as Activity;
  },

  async getChats(userParam?: any): Promise<Chat[]> {
    let currentUser = userParam;
    if (!currentUser || !currentUser.id) {
      const currentRaw = localStorage.getItem('club65_user') || localStorage.getItem('currentUser') || '{}';
      try {
        const parsed = JSON.parse(currentRaw);
        if (parsed?.id) currentUser = parsed;
      } catch (_) {}
    }
    if (!currentUser || !currentUser.id) {
      return [];
    }
    try {
      if (!Array.isArray(currentUser.notifications)) {
        const notifs = cachedNotificationsByUser.get(String(currentUser.id))
          ?? await this.fetchUserNotificationsOnce(String(currentUser.id)).catch(() => []);
        currentUser = { ...currentUser, notifications: notifs };
      }
      return await chatService.getUserChats(currentUser);
    } catch (err) {
      console.warn('Error en api.getChats:', err);
      return [];
    }
  },

  async getChatMessages(selectedChatId: number | string, userParam?: any): Promise<ChatMessage[]> {
    let currentUser = userParam;
    if (!currentUser && typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('club65_user') || localStorage.getItem('currentUser') || '{}';
        currentUser = JSON.parse(raw);
      } catch (_) {}
    }
    return await chatService.getChatMessages(selectedChatId, currentUser);
  },

  async sendChatMessage(
    chatId: number | string, 
    text: string, 
    replyTo?: { id: string; sender: string; text: string },
    senderUser?: any,
    _chatMeta?: { title?: string; type?: 'grupal' | 'privado'; activityId?: any; participants?: any[] },
    _providedMsgId?: string
  ): Promise<ChatMessage> {
    const rawUser = localStorage.getItem('club65_user') || localStorage.getItem('currentUser') || '{}';
    let localUser: any = {};
    try { localUser = JSON.parse(rawUser); } catch (_) {}
    const me = senderUser || (localUser?.id ? localUser : null) || (await api.getMe().catch(() => null));

    if (!me?.id) {
      throw new Error('Usuario no autenticado para enviar mensaje.');
    }

    return await chatService.sendChatMessage({
      selectedChatId: chatId,
      text,
      currentUser: me,
      replyTo,
      providedMsgId: _providedMsgId,
      chatType: _chatMeta?.type
    });
  },


  async pinChatMessage(chatId: number | string, messageId: string | null): Promise<Chat> {
    const sChatId = String(chatId);
    const targetMsgId = messageId ? String(messageId) : null;
    const sChatBigInt = chatIdentifierToBigInt(sChatId);

    // 1. Verificar sesión y permisos exclusivos de moderador del grupo en Supabase
    let me: User | null = await this.getMe().catch(() => null);
    if (!me && typeof localStorage !== 'undefined') {
      try {
        const rawUser = localStorage.getItem('club65_user') || localStorage.getItem('currentUser') || '';
        if (rawUser) {
          const parsed = JSON.parse(rawUser);
          if (parsed?.id) me = parsed;
        }
      } catch (_) {}
    }

    if (!me?.id) {
      throw new Error('Debes iniciar sesión para fijar o desfijar mensajes.');
    }

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sChatId);
    const [chatRes, actsList] = await Promise.all([
      isUuid
        ? supabase
            .from('chats')
            .select('id, nombre, tipo, creador_id, actividad_id')
            .eq('id', sChatId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      this.getActivities().catch(() => [] as Activity[])
    ]);

    const chatRow: any = chatRes?.data || null;
    if (chatRow && chatRow.tipo === 'privado') {
      throw new Error('Solo se pueden fijar mensajes en chats grupales.');
    }

    const isGlobalAdmin = ['moderador', 'admin', 'administrador'].includes(
      String(me.tipo || me.rol || '').toLowerCase().trim()
    );

    if (!isGlobalAdmin) {
      const [partRes, chatMsgsRes] = await Promise.all([
        chatRow?.id
          ? supabase
              .from('chat_participants')
              .select('user_id')
              .eq('chat_id', chatRow.id)
              .eq('user_id', me.id)
              .limit(1)
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from('messages')
          .select('id, text, reply_to, created_at')
          .eq('chat_id', sChatBigInt)
          .order('created_at', { ascending: true })
          .limit(300)
      ]);

      if (chatRow?.id && (!Array.isArray(partRes?.data) || partRes.data.length === 0)) {
        throw new Error('Solo los moderadores activos del grupo pueden fijar o desfijar mensajes.');
      }

      const chatForModCheck: any = {
        id: chatRow?.id || sChatId,
        title: chatRow?.nombre || '',
        name: chatRow?.nombre || '',
        type: 'grupal',
        creatorId: chatRow?.creador_id || undefined,
        activityId: chatRow?.actividad_id ?? (!isUuid && !isNaN(Number(sChatId)) ? Number(sChatId) : undefined),
        messages: Array.isArray(chatMsgsRes?.data) ? chatMsgsRes.data : []
      };

      const allowed =
        !isUserRemovedFromChat(chatForModCheck, me) &&
        !isUserLeftVoluntarilyFromChat(chatForModCheck, me) &&
        isUserGroupModerator(chatForModCheck, me, actsList);

      if (!allowed) {
        throw new Error('Solo los moderadores del grupo pueden fijar o desfijar mensajes.');
      }
    }

    // 2. Sincronizar en Supabase tabla messages (is_pinned: boolean) con validación de error
    if (targetMsgId) {
      const { data: pinnedRows, error: pinErr } = await supabase
        .from('messages')
        .update({ is_pinned: true })
        .eq('id', targetMsgId)
        .eq('chat_id', sChatBigInt)
        .neq('is_deleted', true)
        .select('id');

      if (pinErr) {
        throw new Error(pinErr.message || 'No se pudo fijar el mensaje en Supabase.');
      }

      if (!pinnedRows || pinnedRows.length === 0) {
        const { data: fallbackPinned, error: fallbackPinErr } = await supabase
          .from('messages')
          .update({ is_pinned: true })
          .eq('id', targetMsgId)
          .neq('is_deleted', true)
          .select('id');

        if (fallbackPinErr) {
          throw new Error(fallbackPinErr.message || 'No se pudo fijar el mensaje en Supabase.');
        }
        if (!fallbackPinned || fallbackPinned.length === 0) {
          throw new Error('El mensaje seleccionado no está disponible para fijar.');
        }
      }

      const { error: unpinOthersErr } = await supabase
        .from('messages')
        .update({ is_pinned: false })
        .eq('chat_id', sChatBigInt)
        .eq('is_pinned', true)
        .neq('id', targetMsgId);

      if (unpinOthersErr) {
        console.warn('Aviso al desfijar mensajes anteriores en Supabase:', unpinOthersErr.message);
      }
    } else {
      const { error: unpinAllErr } = await supabase
        .from('messages')
        .update({ is_pinned: false })
        .eq('chat_id', sChatBigInt)
        .eq('is_pinned', true);

      if (unpinAllErr) {
        throw new Error(unpinAllErr.message || 'No se pudo desfijar el mensaje en Supabase.');
      }
    }

    // Limpiar cualquier clave heredada de localStorage para evitar desincronización entre dispositivos
    try {
      localStorage.removeItem('club65_pinned_messages');
    } catch {}

    // 3. Notificar al backend Express (best-effort)
    let updatedChat: any = null;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(sChatId)}/pin`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ messageId: targetMsgId })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        updatedChat = parsed.data.chat;
      }
    } catch (err: any) {
      console.warn('Aviso no bloqueante al notificar pin al servidor:', err?.message || err);
    }

    return updatedChat || ({ id: chatId, pinnedMessageId: targetMsgId || undefined } as any);
  },

  async deleteChatMessage(
    chatId: number | string,
    messageId: string,
    reasonText?: string,
    deletedByAdmin = false,
    fallbackMessageText?: string
  ): Promise<void> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión para retirar mensajes.'
    });

    const textMsg =
      reasonText ||
      (deletedByAdmin ? ADMIN_REMOVED_MESSAGE_TEXT : MODERATOR_REMOVED_MESSAGE_TEXT);

    // 1. Guardar en registro de mensajes retirados para inmunidad contra desfases
    try {
      const removedList = JSON.parse(localStorage.getItem('club65_removed_messages') || '[]');
      if (messageId && !removedList.includes(String(messageId))) {
        removedList.push(String(messageId));
      } else if (!messageId && fallbackMessageText && !removedList.includes(String(fallbackMessageText).trim())) {
        removedList.push(String(fallbackMessageText).trim());
      }
      localStorage.setItem('club65_removed_messages', JSON.stringify(removedList));
    } catch {}

    // Marcar el mensaje como retirado en localStorage si existe copia local
    try {
      const stored = localStorage.getItem('club65_custom_chats');
      if (stored) {
        const chatList = JSON.parse(stored);
        const updatedList = chatList.map((c: any) => {
          if (String(c.id) === String(chatId) && Array.isArray(c.messages)) {
            return {
              ...c,
              messages: c.messages.map((m: any) =>
                String(m.id) === String(messageId) ||
                (fallbackMessageText && String(m.text || '').trim() === String(fallbackMessageText).trim())
                  ? {
                      ...m,
                      isDeleted: true,
                      retirado: true,
                      deletedByAdmin: Boolean(deletedByAdmin),
                      deletedByGroupModerator: !deletedByAdmin,
                      text: textMsg
                    }
                  : m
              )
            };
          }
          return c;
        });
        localStorage.setItem('club65_custom_chats', JSON.stringify(updatedList));
      }
    } catch {
      // Ignorar fallback local
    }

    // 2. Actualizar estado de eliminación en Supabase
    try {
      const client = (typeof window !== 'undefined' && (window as any).supabase) || (supabase as any);
      if (client && typeof client.from === 'function') {
        const updatePayload = {
          is_deleted: true,
          is_pinned: false,
          deleted_by_admin: Boolean(deletedByAdmin),
          deleted_by_group_moderator: !deletedByAdmin,
          text: textMsg
        };

        let matchedAny = false;
        if (messageId && String(messageId).trim() !== '') {
          const { data: updatedRows, error: updErr } = await client
            .from('messages')
            .update(updatePayload)
            .eq('id', String(messageId).trim())
            .select('id');
          if (updErr) {
            console.warn('Aviso al actualizar mensaje en Supabase:', updErr);
          } else if (Array.isArray(updatedRows) && updatedRows.length > 0) {
            matchedAny = true;
          }
        }

        if (!matchedAny && chatId && fallbackMessageText && String(fallbackMessageText).trim() !== '') {
          const bigChatId = chatIdentifierToBigInt(chatId);
          await client
            .from('messages')
            .update(updatePayload)
            .eq('chat_id', bigChatId)
            .eq('text', String(fallbackMessageText).trim());
        }
      }
    } catch (e) {
      console.warn('Error conectando a Supabase para retirar mensaje:', e);
    }

    // 3. Notificar al backend en la ruta de borrado
    try {
      const safeChatId = encodeURIComponent(String(chatId || '0'));
      const safeMsgId = encodeURIComponent(String(messageId || '0'));

      let res = await fetch(`/api/chats/${safeChatId}/messages/${safeMsgId}/delete`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          reasonText: textMsg,
          deletedByAdmin: Boolean(deletedByAdmin),
          fallbackMessageText: fallbackMessageText || ''
        })
      });

      if (!res.ok) {
        // Fallback al verbo DELETE estándar preservando deletedByAdmin y reasonText
        res = await fetch(`/api/chats/${safeChatId}/messages/${safeMsgId}?deletedByAdmin=${deletedByAdmin ? 'true' : 'false'}`, {
          method: 'DELETE',
          headers: getHeaders(),
          body: JSON.stringify({
            reasonText: textMsg,
            deletedByAdmin: Boolean(deletedByAdmin),
            fallbackMessageText: fallbackMessageText || ''
          })
        });
      }

      if (!res.ok) {
        console.warn(`Aviso: el servidor respondió status ${res.status} al retirar mensaje.`);
      }
    } catch (err: any) {
      console.warn('Advertencia no bloqueante al notificar borrado al backend:', err?.message || err);
    }
  },

  async addChatParticipant(chatId: number | string, participant: string, activityId?: number | string, candidateTokens?: string[]): Promise<Chat> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión para agregar participantes.'
    });

    const strChatId = String(chatId);
    const targetName = participant.trim();
    const targetLow = targetName.toLowerCase();

    // Recolectar todos los tokens y credenciales del usuario (apodo, usuario, id, nombre)
    const tokensToClear = new Set<string>([targetLow]);
    if (Array.isArray(candidateTokens)) {
      candidateTokens.forEach(t => tokensToClear.add(String(t).toLowerCase().trim()));
    }

    const sysMsgId = `sys_add_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    let matchedUserId: string | undefined = undefined;
    let matchedUserDisplay = targetName;
    try {
      if (supabase) {
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, usuario, apodo, tipo, rol')
          .or(`id.eq.${targetName},usuario.eq.${targetName},apodo.eq.${targetName}`)
          .limit(1)
          .maybeSingle();
        if (dbUser) {
          if (isAdministratorUser(dbUser)) {
            throw new Error('Los usuarios administradores no pueden formar parte de ningún grupo.');
          }
          matchedUserId = dbUser.id;
          if (dbUser.id) tokensToClear.add(String(dbUser.id).toLowerCase().trim());
          if (dbUser.usuario) tokensToClear.add(String(dbUser.usuario).toLowerCase().trim());
          if (dbUser.apodo) tokensToClear.add(String(dbUser.apodo).toLowerCase().trim());
          matchedUserDisplay = dbUser.apodo || dbUser.usuario || targetName;
        }
      }
    } catch (adminErr: any) {
      if (adminErr?.message?.includes('administradores no pueden')) {
        throw adminErr;
      }
    }

    // 1. Sincronizar directamente con Supabase en tiempo real
    try {
      if (supabase) {
        // a. Si está asociado a una actividad, re-inscribir y remover veto en activities
        const actId = activityId || (!isNaN(Number(chatId)) ? Number(chatId) : null);
        if (actId) {
          try {
            const { data: actRow } = await supabase
              .from('activities')
              .select('id, title, enrolled_usernames, enrolled_count, vetted_users')
              .eq('id', actId)
              .maybeSingle();

            if (actRow) {
              const currentEnrolled: string[] = Array.isArray(actRow.enrolled_usernames) ? actRow.enrolled_usernames : [];
              const updatedEnrolled = currentEnrolled.some(u => tokensToClear.has(String(u).trim().toLowerCase()))
                ? currentEnrolled
                : [...currentEnrolled, matchedUserDisplay];
              const currentVetted: string[] = Array.isArray(actRow.vetted_users) ? actRow.vetted_users : [];
              const updatedVetted = currentVetted.filter(u => !tokensToClear.has(String(u).trim().toLowerCase()));

              await supabase.from('activities').update({
                enrolled_usernames: updatedEnrolled,
                enrolled_count: updatedEnrolled.length,
                vetted_users: updatedVetted
              }).eq('id', actId);
            }

            // b. Publicar aviso del sistema en tabla messages de Supabase con metadata de tokens
            const rawTitle = actRow?.title || 'la actividad';
            const cleanActTitle = String(rawTitle).replace(/^Grupo:\s*/i, '').trim();
            const welcomeText = `¡Bienvenido a ${cleanActTitle}, ${matchedUserDisplay}!`;

            const sChatId = chatIdentifierToBigInt(strChatId);
            await supabase.from('messages').insert({
              id: sysMsgId,
              chat_id: sChatId,
              sender_id: 'sistema',
              sender: 'Sistema CLUB65',
              avatar: '👋',
              role: 'sistema',
              text: welcomeText,
              time: formatArgentinaTimeOnly(new Date()),
              created_at: new Date().toISOString(),
              reply_to: {
                event: 'participant_added',
                participant: matchedUserDisplay,
                participantId: matchedUserId,
                participantTokens: Array.from(tokensToClear)
              }
            });
          } catch (e) {
            console.warn('Aviso insertando mensaje de incorporación en Supabase:', e);
          }
        } else {
          // Si no es actividad, mensaje estándar
          try {
            const sChatId = chatIdentifierToBigInt(strChatId);
            await supabase.from('messages').insert({
              id: sysMsgId,
              chat_id: sChatId,
              sender_id: 'sistema',
              sender: 'Sistema CLUB65',
              avatar: '👋',
              role: 'sistema',
              text: `${matchedUserDisplay} fue agregado al grupo por el moderador del grupo.`,
              time: formatArgentinaTimeOnly(new Date()),
              created_at: new Date().toISOString(),
              reply_to: {
                event: 'participant_added',
                participant: matchedUserDisplay,
                participantId: matchedUserId,
                participantTokens: Array.from(tokensToClear)
              }
            });
          } catch (e) {
            console.warn('Aviso insertando mensaje de incorporación en Supabase:', e);
          }
        }

        // c. Asegurar que el participante quede persistido en chat_participants de Supabase
        try {
          await chatService.addParticipantToGroup(strChatId, matchedUserId || targetName);
          if (matchedUserId) {
            const sBig = String(chatIdentifierToBigInt(strChatId));
            const actStr = activityId ? String(activityId) : '';
            const curNotifs = await this.fetchUserNotificationsOnce(String(matchedUserId), true).catch(() => []);
            const cleanedNotifs = curNotifs.filter(
              (n: any) => !(
                n &&
                n.type === 'chat_removed_notice' &&
                (String(n.chatId) === strChatId ||
                  String(n.chatId) === sBig ||
                  (actStr && String(n.activityId || '') === actStr))
              )
            );
            if (cleanedNotifs.length !== curNotifs.length) {
              await supabase.from('users').update({ notifications: cleanedNotifs }).eq('id', matchedUserId);
              cachedNotificationsByUser.set(String(matchedUserId), cleanedNotifs);
            }
          }
        } catch (partErr) {
          console.warn('Aviso vinculando a chat_participants en addChatParticipant:', partErr);
        }
      }
    } catch (sbErr) {
      console.warn('Error en sincronización directa de Supabase:', sbErr);
    }

    // 2. Persistir localmente en cache de chats limpiando exhaustivamente todos los tokens
    try {
      const stored = localStorage.getItem('club65_custom_chats');
      if (stored) {
        const chatList = JSON.parse(stored);
        const updated = chatList.map((c: any) => {
          if (String(c.id) === strChatId || (c.activityId && String(c.activityId) === strChatId)) {
            const curParts = Array.isArray(c.participants) ? c.participants : [];
            const curRem = Array.isArray(c.removedParticipants) ? c.removedParticipants : [];
            const curLeft = Array.isArray(c.leftVoluntarilyParticipants) ? c.leftVoluntarilyParticipants : [];
            const curVetted = Array.isArray(c.vetoedParticipants) ? c.vetoedParticipants : [];
            const curAdmins = Array.isArray(c.adminUsernames) ? c.adminUsernames : [];
            const updatedParts = curParts.some((p: any) => tokensToClear.has(String(p).trim().toLowerCase()))
              ? curParts
              : [...curParts, matchedUserDisplay];
            return {
              ...c,
              participants: updatedParts,
              adminUsernames: curAdmins.filter((a: any) => !tokensToClear.has(String(a).trim().toLowerCase())),
              removedParticipants: curRem.filter((p: any) => !tokensToClear.has(String(p).trim().toLowerCase())),
              leftVoluntarilyParticipants: curLeft.filter((p: any) => !tokensToClear.has(String(p).trim().toLowerCase())),
              vetoedParticipants: curVetted.filter((p: any) => !tokensToClear.has(String(p).trim().toLowerCase()))
            };
          }
          return c;
        });
        localStorage.setItem('club65_custom_chats', JSON.stringify(updated));
      }
    } catch (_) {}

    // 3. Notificar al backend Express
    let backendChat: any = null;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(strChatId)}/participants/add`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          participant: matchedUserDisplay,
          participantId: matchedUserId,
          participantTokens: Array.from(tokensToClear),
          clientMessageId: sysMsgId,
          alreadySyncedWithSupabase: true
        })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        backendChat = parsed.data.chat;
      }
    } catch (err: any) {
      console.warn('Aviso no bloqueante al notificar adición al backend:', err?.message || err);
    }

    return backendChat || ({ id: chatId, participants: [matchedUserDisplay] } as any);
  },

  async removeChatParticipant(chatId: number | string, participant: string, activityId?: number | string, candidateTokens?: string[]): Promise<Chat> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión para retirar participantes.'
    });

    const strChatId = String(chatId);
    const targetName = participant.trim();
    const targetLow = targetName.toLowerCase();

    const tokensToRemove = new Set<string>([targetLow]);
    if (Array.isArray(candidateTokens)) {
      candidateTokens.forEach(t => tokensToRemove.add(String(t).toLowerCase().trim()));
    }

    const sysMsgId = `sys_rem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    let matchedUserId: string | undefined = undefined;
    let matchedUserNotifs: any[] | null = null;
    try {
      if (supabase) {
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, usuario, apodo, notifications')
          .or(`id.eq.${targetName},usuario.eq.${targetName},apodo.eq.${targetName}`)
          .limit(1)
          .maybeSingle();
        if (dbUser) {
          matchedUserId = dbUser.id;
          matchedUserNotifs = Array.isArray((dbUser as any).notifications) ? (dbUser as any).notifications : [];
          if (dbUser.id) tokensToRemove.add(String(dbUser.id).toLowerCase().trim());
          if (dbUser.usuario) tokensToRemove.add(String(dbUser.usuario).toLowerCase().trim());
          if (dbUser.apodo) tokensToRemove.add(String(dbUser.apodo).toLowerCase().trim());
        }
      }
    } catch (_) {}

    const exitNowMs = Date.now();
    const exitNowIso = new Date(exitNowMs).toISOString();
    let participantsSnapshot: string[] = [];

    // 1. Sincronizar directamente con Supabase en tiempo real
    try {
      if (supabase) {
        // 0. Capturar snapshot de participantes ANTES de eliminar al usuario de chat_participants
        let resolvedChatId = strChatId;
        let resolvedActId = activityId ? String(activityId) : undefined;
        try {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(strChatId)) {
            const { data: chatByAct } = await supabase
              .from('chats')
              .select('id, actividad_id')
              .eq('actividad_id', strChatId)
              .limit(1)
              .maybeSingle();
            if (chatByAct?.id) {
              resolvedChatId = String(chatByAct.id);
              if (chatByAct.actividad_id) resolvedActId = String(chatByAct.actividad_id);
            }
          }
          const { data: partRows } = await supabase
            .from('chat_participants')
            .select('user_id, users:user_id (id, usuario, apodo)')
            .eq('chat_id', resolvedChatId);
          if (Array.isArray(partRows)) {
            participantsSnapshot = partRows
              .map((r: any) => {
                const u = Array.isArray(r.users) ? r.users[0] : r.users;
                return String(u?.apodo || u?.usuario || r.user_id || '').trim();
              })
              .filter((name: string) => Boolean(name) && !isDummyOrSystemParticipant(name));
          }
          if (targetName && !participantsSnapshot.some(p => tokensToRemove.has(p.toLowerCase().trim()))) {
            participantsSnapshot.push(targetName);
          }
        } catch (_) {}

        // a. Si está asociado a una actividad, desinscribir en la tabla activities
        const actId = activityId || (!isNaN(Number(chatId)) ? Number(chatId) : null);
        if (actId) {
          try {
            const { data: actRow } = await supabase
              .from('activities')
              .select('id, enrolled_usernames, enrolled_count, vetted_users')
              .eq('id', actId)
              .maybeSingle();

            if (actRow) {
              const currentEnrolled: string[] = Array.isArray(actRow.enrolled_usernames) ? actRow.enrolled_usernames : [];
              const updatedEnrolled = currentEnrolled.filter(u => !tokensToRemove.has(String(u).trim().toLowerCase()));
              const currentVetted: string[] = Array.isArray(actRow.vetted_users) ? actRow.vetted_users : [];
              const updatedVetted = currentVetted.includes(targetName) ? currentVetted : [...currentVetted, targetName];

              await supabase.from('activities').update({
                enrolled_usernames: updatedEnrolled,
                enrolled_count: updatedEnrolled.length,
                vetted_users: updatedVetted
              }).eq('id', actId);
            }
          } catch (e) {
            console.warn('Aviso actualizando enrolled_usernames en Supabase:', e);
          }
        }

        // b. Guardar chat_removed_notice en notifications del usuario retirado ANTES de eliminar chat_participants
        if (matchedUserId) {
          try {
            const baseNotifs = matchedUserNotifs ?? await this.fetchUserNotificationsOnce(String(matchedUserId), true).catch(() => []);
            const nextNotifs = [
              ...baseNotifs.filter((n: any) => !(n && n.type === 'chat_removed_notice' && String(n.chatId) === resolvedChatId)),
              {
                id: `chat_removed_${resolvedChatId}_${exitNowMs}`,
                type: 'chat_removed_notice',
                reason: 'removed',
                chatId: resolvedChatId,
                activityId: resolvedActId || (actId ? String(actId) : undefined),
                participantsSnapshot,
                removedAt: exitNowMs,
                createdAt: exitNowIso
              }
            ];
            await supabase.from('users').update({ notifications: nextNotifs }).eq('id', matchedUserId);
            cachedNotificationsByUser.set(String(matchedUserId), nextNotifs);
          } catch (nErr) {
            console.warn('Aviso guardando chat_removed_notice para usuario retirado:', nErr);
          }
        }

        // c. Publicar aviso del sistema en tabla messages de Supabase de forma duradera
        try {
          const sChatId = chatIdentifierToBigInt(resolvedChatId);
          await supabase.from('messages').insert({
            id: sysMsgId,
            chat_id: sChatId,
            sender_id: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: '🛡️',
            role: 'sistema',
            text: `${targetName} fue retirado del grupo por el moderador del grupo.`,
            time: formatArgentinaTimeOnly(new Date(exitNowMs)),
            created_at: exitNowIso,
            reply_to: {
              event: 'participant_removed',
              participant: targetName,
              participantId: matchedUserId,
              participantTokens: Array.from(tokensToRemove),
              participantsSnapshot
            }
          });
        } catch (e) {
          console.warn('Aviso insertando mensaje de moderación en Supabase:', e);
        }

        // d. Remover de chat_participants en Supabase al final para evitar race condition con Realtime
        try {
          await chatService.removeParticipantFromGroup(resolvedChatId, matchedUserId || targetName);
        } catch (partErr) {
          console.warn('Aviso removiendo de chat_participants en removeChatParticipant:', partErr);
        }
      }
    } catch (sbErr) {
      console.warn('Error en sincronización directa de Supabase:', sbErr);
    }

    // 2. Persistir localmente en cache de chats
    try {
      const stored = localStorage.getItem('club65_custom_chats');
      if (stored) {
        const chatList = JSON.parse(stored);
        const updated = chatList.map((c: any) => {
          if (String(c.id) === strChatId || (c.activityId && String(c.activityId) === strChatId)) {
            const curParts = Array.isArray(c.participants) ? c.participants : [];
            const curRem = Array.isArray(c.removedParticipants) ? c.removedParticipants : [];
            const curAdmins = Array.isArray(c.adminUsernames) ? c.adminUsernames : [];
            return {
              ...c,
              participants: curParts.filter((p: any) => !tokensToRemove.has(String(p).trim().toLowerCase())),
              adminUsernames: curAdmins.filter((a: any) => !tokensToRemove.has(String(a).trim().toLowerCase())),
              removedParticipants: Array.from(new Set([...curRem, ...Array.from(tokensToRemove)]))
            };
          }
          return c;
        });
        localStorage.setItem('club65_custom_chats', JSON.stringify(updated));
      }
    } catch (_) {}

    // 3. Notificar al backend Express
    let backendChat: any = null;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(strChatId)}/participants/remove`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          participant: targetName,
          participantId: matchedUserId,
          participantTokens: Array.from(tokensToRemove),
          clientMessageId: sysMsgId,
          alreadySyncedWithSupabase: true
        })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        backendChat = parsed.data.chat;
      } else if (!parsed.ok) {
        console.warn('Backend remove participant notice:', parsed.data || res.status);
      }
    } catch (netErr) {
      console.warn('Network notice communicating removal with backend:', netErr);
    }

    return backendChat || { id: chatId, removedParticipants: Array.from(tokensToRemove) } as any;
  },

  async updateChatPhoto(chatId: number | string, photoUrl: string): Promise<Chat> {
    const strId = String(chatId);

    // 1. Sincronizar directamente con Supabase en la tabla 'chats' (foto_grupo_url)
    try {
      if (supabase) {
        const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        if (isValidUUID(strId)) {
          const { error } = await supabase.from('chats').update({ foto_grupo_url: photoUrl }).eq('id', strId);
          if (error) console.warn('Aviso Supabase al actualizar foto_grupo_url por id:', error.message);
        } else {
          // Intentar por actividad_id si corresponde
          const { error } = await supabase.from('chats').update({ foto_grupo_url: photoUrl }).eq('actividad_id', strId);
          if (error) console.warn('Aviso Supabase al actualizar foto_grupo_url por actividad_id:', error.message);
        }
      }
    } catch (e) {
      console.warn('Error en supabase al actualizar foto:', e);
    }

    // 2. Notificar al backend Express
    let updatedChat: any = null;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(strId)}/photo`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ photo: photoUrl, photoUrl, avatar: photoUrl, image: photoUrl })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        updatedChat = parsed.data.chat;
      }
    } catch (e) {
      console.warn('Aviso backend al actualizar foto:', e);
    }

    // 3. Actualizar cache local 'club65_custom_chats'
    try {
      const stored = localStorage.getItem('club65_custom_chats');
      if (stored) {
        const list = JSON.parse(stored);
        const next = list.map((c: any) =>
          (String(c.id) === strId || (c.activityId && String(c.activityId) === strId))
            ? { ...c, avatar: photoUrl, image: photoUrl }
            : c
        );
        localStorage.setItem('club65_custom_chats', JSON.stringify(deduplicateChats(next)));
      }
    } catch (_) {}

    return updatedChat || ({ id: chatId, avatar: photoUrl, image: photoUrl } as any);
  },

  async makeChatAdmin(
    chatId: number | string,
    participant: string,
    options?: {
      activityId?: number | string;
      chatTitle?: string;
      participantTokens?: string[];
      clientMessageId?: string;
    }
  ): Promise<Chat> {
    const rawChatId = chatId !== undefined && chatId !== null ? String(chatId).trim() : '';
    if (!rawChatId || rawChatId === 'undefined' || rawChatId === 'null') {
      console.error('[makeChatAdmin] chat_id inválido o ausente al intentar designar moderador:', {
        chatId,
        participant,
        options
      });
      throw new Error('No se pudo identificar el chat seleccionado para designar moderador.');
    }

    const cleanParticipant = String(
      typeof participant === 'object' && participant !== null
        ? ((participant as any)?.apodo || (participant as any)?.usuario || (participant as any)?.nombre || (participant as any)?.id || '')
        : (participant || '')
    ).trim();

    if (!cleanParticipant) {
      console.error('[makeChatAdmin] Participante vacío o inválido:', { chatId: rawChatId, participant });
      throw new Error('No se pudo identificar al participante a designar como moderador.');
    }

    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión para designar moderadores.'
    });

    const adminTokenSet = new Set<string>([cleanParticipant]);
    if (Array.isArray(options?.participantTokens)) {
      options.participantTokens.forEach(t => {
        const cleanTok = String(t || '').trim();
        if (cleanTok) adminTokenSet.add(cleanTok);
      });
    }

    let matchedUserId: string | undefined = undefined;
    let displayName = cleanParticipant;

    // 1. Resolver tokens completos del participante en Supabase
    try {
      if (supabase) {
        const escaped = cleanParticipant.replace(/[,()]/g, ' ').trim();
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, usuario, apodo')
          .or(`id.eq.${escaped},usuario.eq.${escaped},apodo.eq.${escaped}`)
          .limit(1)
          .maybeSingle();
        if (dbUser) {
          if (dbUser.id) {
            matchedUserId = String(dbUser.id);
            adminTokenSet.add(String(dbUser.id).trim());
          }
          if (dbUser.usuario) adminTokenSet.add(String(dbUser.usuario).trim());
          if (dbUser.apodo) adminTokenSet.add(String(dbUser.apodo).trim());
          displayName = dbUser.apodo || dbUser.usuario || cleanParticipant;
        }
      }
    } catch (uErr) {
      console.warn('[makeChatAdmin] Aviso buscando participante en Supabase users:', uErr);
    }

    const allAdminTokens = Array.from(adminTokenSet);
    const isUUID = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    // 2. Resolver el chat_id real en Supabase y persistir la designación directamente en Supabase
    let resolvedChatId = rawChatId;
    let resolvedActivityId = options?.activityId !== undefined && options?.activityId !== null ? String(options.activityId) : undefined;
    let supabaseSynced = false;
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const sysMsgId = options?.clientMessageId || `msg_adm_${nowMs}_${Math.random().toString(36).substring(2, 6)}`;
    const sysMsgText = `Sistema CLUB65: ${displayName} fue designado/a moderador/a del grupo.`;
    let createdSysMsg: any = null;

    try {
      if (supabase) {
        let sbChatRow: any = null;

        if (isUUID(rawChatId)) {
          const { data } = await supabase
            .from('chats')
            .select('id, nombre, tipo, actividad_id, creador_id')
            .eq('id', rawChatId)
            .maybeSingle();
          if (data) sbChatRow = data;
        }

        const candidateActId = resolvedActivityId || (!isUUID(rawChatId) && !isNaN(Number(rawChatId)) ? rawChatId : undefined);
        if (!sbChatRow && candidateActId) {
          const { data } = await supabase
            .from('chats')
            .select('id, nombre, tipo, actividad_id, creador_id')
            .eq('actividad_id', String(candidateActId))
            .limit(1)
            .maybeSingle();
          if (data) sbChatRow = data;
        }

        if (!sbChatRow && options?.chatTitle) {
          const cleanTitle = String(options.chatTitle).replace(/^Grupo:\s*/i, '').trim();
          if (cleanTitle) {
            const { data } = await supabase
              .from('chats')
              .select('id, nombre, tipo, actividad_id, creador_id')
              .ilike('nombre', `%${cleanTitle}%`)
              .limit(1)
              .maybeSingle();
            if (data) sbChatRow = data;
          }
        }

        if (sbChatRow?.id) {
          resolvedChatId = String(sbChatRow.id);
          if (sbChatRow.actividad_id) {
            resolvedActivityId = String(sbChatRow.actividad_id);
          }
        } else if (!isUUID(rawChatId) && !candidateActId) {
          console.warn('[makeChatAdmin] No se encontró fila en Supabase chats para:', {
            rawChatId,
            activityId: options?.activityId,
            chatTitle: options?.chatTitle
          });
        }

        // Persistir evento duradero make_admin en tabla messages de Supabase
        if (sbChatRow?.id || isUUID(resolvedChatId)) {
          const sChatId = chatIdentifierToBigInt(resolvedChatId);
          const replyToMeta = {
            action: 'make_admin',
            adminUsernames: allAdminTokens,
            participant: displayName,
            participantId: matchedUserId || cleanParticipant,
            participantTokens: allAdminTokens
          };
          const timeFormatted = formatArgentinaTimeOnly(new Date(nowMs));
          const { error: insertErr } = await supabase.from('messages').insert({
            id: sysMsgId,
            chat_id: sChatId,
            sender_id: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: 'S',
            role: 'institucional',
            text: sysMsgText,
            time: timeFormatted,
            created_at: nowIso,
            reply_to: replyToMeta
          });

          if (!insertErr) {
            supabaseSynced = true;
            createdSysMsg = {
              id: sysMsgId,
              chatId: resolvedChatId,
              senderId: 'sistema',
              sender: 'Sistema CLUB65',
              avatar: 'S',
              role: 'institucional',
              text: sysMsgText,
              time: timeFormatted,
              createdAt: nowIso,
              timestamp: nowMs,
              replyTo: replyToMeta,
              reply_to: replyToMeta
            };
          } else {
            console.warn('[makeChatAdmin] Error insertando mensaje make_admin en Supabase:', insertErr.message);
          }
        }
      }
    } catch (sbErr) {
      console.warn('[makeChatAdmin] Excepción sincronizando moderador en Supabase:', sbErr);
    }

    // 3. Notificar al backend Express (sin fallar si Supabase ya persistió el cambio)
    let backendChat: any = null;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(resolvedChatId)}/admins`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          participant: displayName,
          participantId: matchedUserId,
          participantTokens: allAdminTokens,
          activityId: resolvedActivityId,
          clientMessageId: sysMsgId,
          alreadySyncedWithSupabase: supabaseSynced
        })
      });
      const parsed = await safeParseJson<any>(res);
      if (!res.ok) {
        if (!supabaseSynced) {
          throw new Error(parsed.data?.error || 'Error al designar moderador del grupo.');
        }
        console.warn('[makeChatAdmin] Aviso no bloqueante del backend Express:', parsed.data?.error || res.status);
      } else if (parsed.isJson && parsed.data?.chat) {
        backendChat = parsed.data.chat;
      }
    } catch (err: any) {
      if (!supabaseSynced && err instanceof Error && err.message && !err.message.includes('Failed to fetch')) {
        throw err;
      }
      if (supabaseSynced) {
        console.warn('[makeChatAdmin] Aviso no bloqueante comunicando designación al backend Express:', err?.message || err);
      }
    }

    const mergedAdmins = Array.from(new Set([
      ...(Array.isArray(backendChat?.adminUsernames) ? backendChat.adminUsernames : []),
      ...allAdminTokens
    ]));

    // 4. Actualizar caché local 'club65_custom_chats'
    try {
      const stored = localStorage.getItem('club65_custom_chats');
      if (stored) {
        const list = JSON.parse(stored);
        const next = list.map((c: any) =>
          (String(c.id) === resolvedChatId ||
            String(c.id) === rawChatId ||
            (c.activityId && (String(c.activityId) === rawChatId || (resolvedActivityId && String(c.activityId) === resolvedActivityId))))
            ? {
                ...c,
                adminUsernames: Array.from(new Set([...(Array.isArray(c.adminUsernames) ? c.adminUsernames : []), ...mergedAdmins])),
                messages: createdSysMsg && Array.isArray(c.messages) && !c.messages.some((m: any) => String(m.id) === String(createdSysMsg.id))
                  ? [...c.messages, createdSysMsg]
                  : c.messages
              }
            : c
        );
        localStorage.setItem('club65_custom_chats', JSON.stringify(deduplicateChats(next)));
      }
    } catch (_) {}

    return {
      ...(backendChat || {}),
      id: backendChat?.id || resolvedChatId,
      adminUsernames: mergedAdmins,
      ...(createdSysMsg ? { systemMessage: createdSysMsg } : {})
    } as any;
  },

  async createChat(data: {
    id?: string;
    title: string;
    subtitle?: string;
    type: 'grupal' | 'privado';
    participants?: string[];
    participantIds?: string[];
    avatar?: string;
    image?: string;
    creatorName?: string;
    creatorId?: string;
    adminUsernames?: string[];
    otherUser?: any;
  }): Promise<Chat> {
    const rawUser = localStorage.getItem('club65_user') || localStorage.getItem('currentUser') || '{}';
    let localUser: any = {};
    try { localUser = JSON.parse(rawUser); } catch (_) {}
    const currentUser = (localUser?.id ? localUser : null) || (await api.getMe().catch(() => null));

    if (!currentUser?.id) {
      throw new Error('Usuario no autenticado para crear conversación.');
    }

    if (data.type === 'privado') {
      const otherUser = data.otherUser || {
        id: (data.participantIds || []).find((id: string) => id !== currentUser.id) || data.participants?.[0] || 'otro',
        nombre: data.title,
        avatar: data.avatar
      };
      return await chatService.createDirectChat({
        currentUser,
        otherUser
      });
    } else {
      const memberIds = data.participantIds || [];
      return await chatService.createGroupChat({
        nombre: data.title || (data as any).name || 'Grupo',
        foto_grupo_url: data.avatar || data.image || null,
        currentUser,
        memberUserIds: memberIds
      });
    }
  },


  async leaveChat(chatId: number | string, activityId?: number | string | null, userParam?: any): Promise<void> {
    const currentRaw = localStorage.getItem('club65_user') || localStorage.getItem('currentUser') || '{}';
    let userId = userParam?.id || '';
    let userNick = userParam?.usuario || '';
    let userApodo = userParam?.apodo || '';
    if (!userId || !userApodo) {
      try {
        const parsed = JSON.parse(currentRaw);
        if (!userId) userId = parsed?.id || '';
        if (!userNick) userNick = parsed?.usuario || '';
        if (!userApodo) userApodo = parsed?.apodo || '';
      } catch (_) {}
    }

    // Si aún no tenemos apodo, intentar recuperarlo de getStoredUserId() en Supabase
    if (!userApodo && supabase) {
      const sId = getStoredUserId() || userId;
      if (sId) {
        try {
          const { data: dbU } = await supabase.from('users').select('id, usuario, apodo').eq('id', sId).maybeSingle();
          if (dbU) {
            userId = dbU.id;
            userNick = dbU.usuario;
            userApodo = dbU.apodo;
          }
        } catch (_) {}
      }
    }

    const exitNowMs = Date.now();
    const exitNowIso = new Date(exitNowMs).toISOString();
    const exitName = (userApodo || userNick || 'Vecino').trim();
    const targetId = String(chatId);
    const targetActId = activityId ? String(activityId) : '';
    const tokensToLeave = Array.from(new Set([userId, userNick, userApodo, exitName].filter(Boolean).map(t => String(t).toLowerCase().trim())));

    // 1. Persistir inmediatamente en localStorage SOLO por identificadores únicos de esta cuenta (NUNCA 'local' ni apodos compartibles)
    try {
      localStorage.removeItem('left_chats_local');
      const uTokens = Array.from(new Set([userId, userNick].filter(Boolean).map(t => String(t).trim())));
      uTokens.forEach(tok => {
        const key = `left_chats_${tok}`;
        const stored: string[] = JSON.parse(localStorage.getItem(key) || '[]');
        [targetId, targetActId].filter(Boolean).forEach(id => {
          if (!stored.includes(id)) stored.push(id);
        });
        localStorage.setItem(key, JSON.stringify(stored));
      });
    } catch (_) {}

    // 2. Actualizar el cache local 'club65_custom_chats' SOLO en campos por-usuario preservando snapshot
    try {
      const stored = localStorage.getItem('club65_custom_chats');
      if (stored) {
        const chatList = JSON.parse(stored);
        const updated = chatList.map((c: any) => {
          if (String(c.id) === targetId || (targetActId && String(c.id) === targetActId) || (c.activityId && (String(c.activityId) === targetId || String(c.activityId) === targetActId))) {
            const curParts = Array.isArray(c.participants) ? c.participants : [];
            const curAdmins = Array.isArray(c.adminUsernames) ? c.adminUsernames : [];
            const curRem = Array.isArray(c.removedParticipants) ? c.removedParticipants : [];
            const curLeft = Array.isArray(c.leftVoluntarilyParticipants) ? c.leftVoluntarilyParticipants : [];
            const snapshotMap: Record<string, string[]> = { ...(c.participantsSnapshotOnRemoval || {}) };
            if (curParts.length > 0) {
              tokensToLeave.forEach(tok => {
                if (!snapshotMap[tok] || snapshotMap[tok].length === 0) {
                  snapshotMap[tok] = [...curParts];
                }
              });
            }
            return {
              ...c,
              participantsSnapshotOnRemoval: snapshotMap,
              participants: curParts.filter((p: any) => !tokensToLeave.includes(String(p).trim().toLowerCase())),
              adminUsernames: curAdmins.filter((a: any) => !tokensToLeave.includes(String(a).trim().toLowerCase())),
              removedParticipants: Array.from(new Set([...curRem, ...tokensToLeave])),
              leftVoluntarilyParticipants: Array.from(new Set([...curLeft, ...tokensToLeave]))
            };
          }
          return c;
        });
        localStorage.setItem('club65_custom_chats', JSON.stringify(updated));
      }
    } catch (_) {}

    // 3. Sincronizar salida en Supabase SIN desinscribir de la actividad asociada:
    //    a) Capturar snapshot de participantes ANTES de borrar chat_participants
    //    b) Persistir chat_removed_notice (reason: 'left', removedAt, participantsSnapshot) en users.notifications
    //    c) Insertar mensaje de sistema user_left con participantsSnapshot
    //    d) Eliminar fila en chat_participants
    let sysMsgId = `sys_left_${exitNowMs}_${Math.random().toString(36).substring(2, 6)}`;
    let participantsSnapshot: string[] = [];
    let resolvedChatId = targetId;
    let resolvedActId = targetActId || undefined;
    try {
      if (supabase) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(targetId)) {
          const { data: chatByAct } = await supabase
            .from('chats')
            .select('id, actividad_id')
            .eq('actividad_id', targetId)
            .limit(1)
            .maybeSingle();
          if (chatByAct?.id) {
            resolvedChatId = String(chatByAct.id);
            if (!resolvedActId && chatByAct.actividad_id) {
              resolvedActId = String(chatByAct.actividad_id);
            }
          }
        } else if (!resolvedActId) {
          const { data: chatRow } = await supabase
            .from('chats')
            .select('id, actividad_id')
            .eq('id', resolvedChatId)
            .maybeSingle();
          if (chatRow?.actividad_id) {
            resolvedActId = String(chatRow.actividad_id);
          }
        }

        try {
          const { data: partRows } = await supabase
            .from('chat_participants')
            .select('user_id, users:user_id (id, usuario, apodo)')
            .eq('chat_id', resolvedChatId);
          if (Array.isArray(partRows)) {
            participantsSnapshot = partRows
              .map((r: any) => {
                const u = Array.isArray(r.users) ? r.users[0] : r.users;
                return String(u?.apodo || u?.usuario || r.user_id || '').trim();
              })
              .filter((name: string) => Boolean(name) && !isDummyOrSystemParticipant(name));
          }
          if (exitName && !participantsSnapshot.some(p => tokensToLeave.includes(p.toLowerCase().trim()))) {
            participantsSnapshot.push(exitName);
          }
        } catch (_) {}

        if (userId) {
          try {
            const curNotifs = await this.fetchUserNotificationsOnce(String(userId), true).catch(() => []);
            const nextNotifs = [
              ...curNotifs.filter((n: any) => !(n && n.type === 'chat_removed_notice' && String(n.chatId) === resolvedChatId)),
              {
                id: `chat_removed_${resolvedChatId}_${exitNowMs}`,
                type: 'chat_removed_notice',
                reason: 'left',
                chatId: resolvedChatId,
                activityId: resolvedActId,
                participantsSnapshot,
                removedAt: exitNowMs,
                leftAt: exitNowMs,
                createdAt: exitNowIso
              }
            ];
            await supabase.from('users').update({ notifications: nextNotifs }).eq('id', userId);
            cachedNotificationsByUser.set(String(userId), nextNotifs);

            try {
              const storedRaw = localStorage.getItem('club65_user');
              if (storedRaw) {
                const parsedUser = JSON.parse(storedRaw);
                if (parsedUser && String(parsedUser.id) === String(userId)) {
                  localStorage.setItem('club65_user', JSON.stringify({ ...parsedUser, notifications: nextNotifs }));
                }
              }
            } catch (_) {}
          } catch (notifErr) {
            console.warn('Advertencia guardando chat_removed_notice al salir del grupo:', notifErr);
          }
        }

        // Insertar aviso del sistema con snapshot de participantes
        const sChatId = chatIdentifierToBigInt(resolvedChatId);
        await supabase.from('messages').insert({
          id: sysMsgId,
          chat_id: sChatId,
          sender_id: 'sistema',
          sender: 'Sistema CLUB65',
          avatar: '👋',
          role: 'sistema',
          text: `${exitName} salió del grupo.`,
          time: formatArgentinaTimeOnly(new Date(exitNowMs)),
          created_at: exitNowIso,
          reply_to: {
            event: 'user_left',
            participant: exitName,
            userId: userId,
            participantTokens: tokensToLeave,
            participantsSnapshot
          }
        });

        // Remover fila en chat_participants al final para que partChannel encuentre notifications actualizadas
        if (userId && resolvedChatId) {
          try {
            await supabase.from('chat_participants').delete().eq('chat_id', resolvedChatId).eq('user_id', userId);
          } catch (_) {}
        }
      }
    } catch (sbErr) {
      console.warn('Advertencia insertando mensaje de salida en Supabase:', sbErr);
    }

    // 4. Notificar al backend Express
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(resolvedChatId)}/leave`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          clientMessageId: sysMsgId,
          alreadySyncedWithSupabase: true,
          userId,
          userNick,
          userApodo: exitName,
          participantTokens: tokensToLeave,
          participantsSnapshot
        })
      });
      if (!res.ok) console.warn('Aviso: backend responded with non-ok on leave');
    } catch (_) {}
  },

  async deleteChat(chatId: number | string): Promise<void> {
    await fetch(`/api/chats/${chatId}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
  },

  async deleteChatForMe(chatId: number | string, activityId?: number | string | null): Promise<void> {
    const currentRaw = localStorage.getItem('club65_user') || localStorage.getItem('currentUser') || '{}';
    let userId = '';
    let userNick = '';
    let userApodo = '';
    try {
      const parsed = JSON.parse(currentRaw);
      userId = parsed?.id || '';
      userNick = parsed?.usuario || '';
      userApodo = parsed?.apodo || '';
    } catch (_) {}

    const targetId = String(chatId);
    const targetActId = activityId ? String(activityId) : '';
    const now = Date.now();

    // 1. Persistir localmente SOLO en las claves específicas de esta cuenta (NUNCA en 'local')
    try {
      const uTokens = [userId, userNick, userApodo].filter(Boolean);
      uTokens.forEach(tok => {
        // a. Lista legacy
        const key = `deleted_chats_${tok}`;
        const stored: string[] = JSON.parse(localStorage.getItem(key) || '[]');
        [targetId, targetActId].filter(Boolean).forEach(id => {
          if (!stored.includes(id)) {
            stored.push(id);
          }
        });
        localStorage.setItem(key, JSON.stringify(stored));

        // b. Timestamps de borrado/vaciado de chat
        const clearKey = `club65_chat_cleared_${tok}`;
        const clearMap: Record<string, number> = JSON.parse(localStorage.getItem(clearKey) || '{}');
        clearMap[targetId] = now;
        clearMap[String(chatIdentifierToBigInt(targetId))] = now;
        if (targetActId) {
          clearMap[targetActId] = now;
          clearMap[String(chatIdentifierToBigInt(targetActId))] = now;
        }
        localStorage.setItem(clearKey, JSON.stringify(clearMap));
      });

      // Limpiar de forma segura cualquier resto de 'deleted_chats_local' para no afectar a otras sesiones
      localStorage.removeItem('deleted_chats_local');
    } catch (_) {}

    // 2. Notificar al backend Express para la sesión actual
    try {
      await fetch(`/api/chats/${encodeURIComponent(targetId)}/delete-for-me`, {
        method: 'POST',
        headers: getHeaders()
      });
    } catch (netErr) {
      console.warn('Advertencia en llamada de red /delete-for-me:', netErr);
    }

    // 3. Persistir en la base de datos Supabase en users.notifications para sincronización multi-dispositivo
    if (userId && supabase) {
      try {
        await this.markChatAsClearedInSupabase(targetId, userId, targetActId);
      } catch (sbErr) {
        console.warn('Advertencia actualizando chat_cleared en Supabase:', sbErr);
      }
    }
  },

  async getReviews(forceRefresh = false): Promise<Review[]> {
    const now = Date.now();
    if (!forceRefresh && cachedReviewsList && (now - lastReviewsFetchTime < 60000)) {
      return cachedReviewsList;
    }
    if (reviewsInFlightPromise) {
      return reviewsInFlightPromise;
    }

    reviewsInFlightPromise = (async () => {
      try {
        // 1. Limitar la consulta inicial a las últimas 20 reseñas sin joins pesados
        const { data, error } = await supabase
          .from('reviews')
          .select('id, actividad_id, autor_id, calificacion, comentario, multimedia_urls, retirado_de_la_vista, creado_el, autor_nombre, actividad_titulo')
          .order('id', { ascending: false })
          .limit(20);

        if (!error && Array.isArray(data)) {
          if (data.length === 0) {
            cachedReviewsList = [];
            lastReviewsFetchTime = Date.now();
            return [];
          }
          const reviewsData: any[] = data as any[];
          reviewsData.sort((a: any, b: any) => {
            const dateA = new Date(a.creado_el || a.created_at || 0).getTime();
            const dateB = new Date(b.creado_el || b.created_at || 0).getTime();
            return dateB - dateA;
          });

          // 2. Reutilizar títulos de actividades en memoria; solo consultar IDs faltantes sin título
          const activitiesMap: Record<string, string> = {};
          if (Array.isArray(cachedActivitiesList)) {
            for (const act of cachedActivitiesList) {
              if (act && act.id !== undefined && act.id !== null) {
                activitiesMap[String(act.id)] = act.title || '';
              }
            }
          }
          const missingActIds = Array.from(
            new Set(
              reviewsData
                .filter((r: any) => r?.actividad_id && !r.actividad_titulo && !activitiesMap[String(r.actividad_id)])
                .map((r: any) => r.actividad_id)
            )
          );
          if (missingActIds.length > 0) {
            try {
              const { data: actData } = await supabase
                .from('activities')
                .select('id, title, titulo')
                .in('id', missingActIds)
                .limit(20);
              if (Array.isArray(actData)) {
                for (const act of actData) {
                  activitiesMap[String(act.id)] = act.title || act.titulo || '';
                }
              }
            } catch {}
          }

          // 3. Reutilizar apodos desde el mapa de usuarios en memoria (sin consultas pesadas adicionales)
          const usersMap: Record<string, string> = {};
          try {
            const allUsers = cachedUsersMap || (await this.getUsers().catch(() => ({} as Record<string, User>)));
            for (const [key, u] of Object.entries(allUsers)) {
              const cleanNick = u.apodo || u.usuario || u.nombre || '';
              if (cleanNick) {
                usersMap[key] = cleanNick;
                if (u.id) usersMap[String(u.id)] = cleanNick;
                if (u.email) usersMap[String(u.email).toLowerCase().trim()] = cleanNick;
              }
            }
          } catch {}

          const seen = new Set<string>();
          const uniqueReviews: Review[] = [];

          for (const rawRow of reviewsData) {
            const row: any = rawRow;
            const key = `${row.actividad_id}_${row.autor_id}`;
            if (!seen.has(key)) {
              seen.add(key);

              const tituloActividad = activitiesMap[String(row.actividad_id)] || row.actividad_titulo || row.actividad || '';

              // Priorizar apodo real y jamás mostrar dirección de correo electrónico
              let candidateName = '';
              if (row.autor_nombre && !String(row.autor_nombre).includes('@')) {
                candidateName = String(row.autor_nombre).trim();
              } else if (row.autor_id && usersMap[String(row.autor_id)]) {
                candidateName = usersMap[String(row.autor_id)];
              } else if (row.autor_id && usersMap[String(row.autor_id).toLowerCase()]) {
                candidateName = usersMap[String(row.autor_id).toLowerCase()];
              } else if (row.autor && !String(row.autor).includes('@')) {
                candidateName = String(row.autor).trim();
              } else if (row.autor_nombre && String(row.autor_nombre).includes('@')) {
                candidateName = String(row.autor_nombre).split('@')[0];
              } else if (row.autor && String(row.autor).includes('@')) {
                candidateName = String(row.autor).split('@')[0];
              }

              const nombreAutor = candidateName || 'Vecino';

              const retired = isReviewRetired(row);
              const mediaList = Array.isArray(row.multimedia_urls)
                ? row.multimedia_urls.filter(Boolean).map(String)
                : [];

              uniqueReviews.push({
                id: /^\d+$/.test(String(row.id)) ? Number(row.id) : String(row.id),
                actividadId: /^\d+$/.test(String(row.actividad_id)) ? Number(row.actividad_id) : (Number(row.actividad_id) || 0),
                actividad: tituloActividad,
                autor: nombreAutor,
                estrellas: Number(row.calificacion) || 5,
                fecha: row.creado_el || row.created_at ? formatArgentinaDateOnly(row.creado_el || row.created_at) : '',
                texto: retired ? ADMIN_REMOVED_REVIEW_TEXT : (row.comentario || ''),
                media: retired ? [] : mediaList,
                foto: retired ? '' : (mediaList[0] || ''),
                usuarioId: String(row.autor_id || ''),
                retiradoDeLaVista: retired,
                retirado_de_la_vista: retired,
                deletedByAdmin: retired
              } as any);
            }
          }
          cachedReviewsList = uniqueReviews;
          lastReviewsFetchTime = Date.now();
          return uniqueReviews;
        }
      } catch (err) {
        console.warn('Fallback reviews:', err);
      }

      try {
        const res = await fetch('/api/reviews', { headers: getHeaders() });
        const parsed = await safeParseJson<Review[]>(res);
        const list = parsed.ok && parsed.isJson && Array.isArray(parsed.data) ? parsed.data.slice(0, 20) : [];
        cachedReviewsList = list;
        lastReviewsFetchTime = Date.now();
        return list;
      } catch {
        return [];
      }
    })().finally(() => {
      reviewsInFlightPromise = null;
    });

    return reviewsInFlightPromise;
  },

  async createReview(rev: Partial<Review>): Promise<Review> {
    const rawMedia = (rev as any).media ||
      (rev as any).video ||
      (rev as any).multimedia ||
      (rev as any).foto;

    const mediaList = Array.isArray(rawMedia)
      ? rawMedia.filter(Boolean)
      : (rawMedia ? [String(rawMedia)] : []);

    const rawAutor = String((rev as any).userApodo || rev.autor || '').trim();
    const authorNick = rawAutor.includes('@') ? rawAutor.split('@')[0] : (rawAutor || 'Vecino');
    const me = await this.getMe().catch(() => null);
    const authorId = String((rev as any).usuarioId || (rev as any).userId || me?.id || '').trim();

    let createdReview: Review = {
      id: (rev as any).id || `rev_${Date.now()}`,
      actividadId: rev.actividadId as any,
      actividad: String(rev.actividad || '').trim(),
      autor: authorNick,
      estrellas: Number(rev.estrellas) || 5,
      fecha: formatArgentinaDateOnly(new Date()),
      texto: String(rev.texto || '').trim(),
      media: mediaList,
      foto: mediaList[0] || '',
      usuarioId: authorId
    } as any;

    // 1. Persistir primero en Supabase
    let savedToSupabase = false;
    if (supabase) {
      const payloadSupabase: Record<string, any> = {
        calificacion: Number(rev.estrellas) || 5,
        comentario: String(rev.texto || '').trim(),
        multimedia_urls: mediaList,
        actividad_id: String(rev.actividadId || ''),
        actividad_titulo: String(rev.actividad || '').trim(),
        autor_id: authorId,
        autor_nombre: authorNick
      };

      const { data, error } = await supabase
        .from('reviews')
        .upsert(payloadSupabase, { onConflict: 'actividad_id, autor_id' })
        .select('id, actividad_id, autor_id, calificacion, comentario, multimedia_urls, creado_el, autor_nombre, actividad_titulo');

      if (!error && Array.isArray(data) && data[0]?.id) {
        createdReview = {
          ...createdReview,
          id: data[0].id
        };
        savedToSupabase = true;
      } else if (error) {
        console.warn('Detalle error Supabase reviews:', error.message, error.details);
      }
    }

    // 2. Sincronizar de forma segura con backend Express si está disponible
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(rev)
      });
      const parsed = await safeParseJson<Review>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        createdReview = {
          ...parsed.data,
          id: savedToSupabase ? createdReview.id : parsed.data.id
        };
      } else if (!res.ok && !savedToSupabase) {
        throw new Error((parsed.data as any)?.error || 'Error al enviar la reseña.');
      }
    } catch (err: any) {
      if (!savedToSupabase) {
        throw new Error(err?.message || 'Error al enviar la reseña.');
      }
    }

    invalidateApiCaches();
    return createdReview;
  },

  async updateReview(id: number | string, rev: Partial<Review>): Promise<Review> {
    const rawMedia = (rev as any).media ||
      (rev as any).video ||
      (rev as any).multimedia ||
      rev.foto;

    const mediaList = Array.isArray(rawMedia)
      ? rawMedia.filter(Boolean)
      : (rawMedia ? [String(rawMedia)] : []);

    const rawAutor = String((rev as any).userApodo || rev.autor || '').trim();
    const authorNick = rawAutor.includes('@') ? rawAutor.split('@')[0] : (rawAutor || 'Vecino');

    let updatedReview: Review = {
      id: id as any,
      actividadId: rev.actividadId as any,
      actividad: String(rev.actividad || '').trim(),
      autor: authorNick,
      estrellas: Number(rev.estrellas) || 5,
      fecha: formatArgentinaDateOnly(new Date()),
      texto: String(rev.texto || '').trim(),
      media: mediaList,
      foto: mediaList[0] || ''
    } as any;

    let updatedInSupabase = false;
    if (supabase) {
      try {
        const updatePayload: Record<string, any> = {
          calificacion: Number(rev.estrellas) || 5,
          comentario: String(rev.texto || '').trim(),
          multimedia_urls: mediaList
        };
        if (authorNick) updatePayload.autor_nombre = authorNick;

        const idVal = /^\d+$/.test(String(id)) ? Number(id) : String(id);
        const { data: existingRow } = await supabase
          .from('reviews')
          .select('id, retirado_de_la_vista, comentario')
          .eq('id', idVal)
          .maybeSingle();
        if (existingRow && isReviewRetired(existingRow)) {
          throw new Error('Esta reseña fue retirada por administración y no puede modificarse.');
        }

        const { data: updRows, error: updErr } = await supabase
          .from('reviews')
          .update(updatePayload)
          .eq('id', idVal)
          .select('id, actividad_id, autor_id, calificacion, comentario, multimedia_urls, retirado_de_la_vista, creado_el, autor_nombre, actividad_titulo');

        if (!updErr && Array.isArray(updRows) && updRows[0]) {
          const row = updRows[0];
          updatedReview = {
            ...updatedReview,
            id: row.id,
            actividadId: row.actividad_id,
            actividad: row.actividad_titulo || updatedReview.actividad,
            autor: row.autor_nombre || updatedReview.autor,
            estrellas: Number(row.calificacion) || updatedReview.estrellas,
            texto: row.comentario || updatedReview.texto,
            media: Array.isArray(row.multimedia_urls) ? row.multimedia_urls : mediaList,
            foto: Array.isArray(row.multimedia_urls) && row.multimedia_urls[0] ? row.multimedia_urls[0] : ''
          };
          updatedInSupabase = true;
        } else if (rev.actividadId && ((rev as any).usuarioId || (rev as any).userId)) {
          const { error: upsErr } = await supabase
            .from('reviews')
            .upsert({
              actividad_id: String(rev.actividadId),
              actividad_titulo: String(rev.actividad || '').trim(),
              autor_id: String((rev as any).usuarioId || (rev as any).userId),
              autor_nombre: authorNick,
              ...updatePayload
            }, { onConflict: 'actividad_id, autor_id' });
          if (!upsErr) updatedInSupabase = true;
        }
      } catch (err) {
        console.warn('Excepción al actualizar reseña en Supabase:', err);
      }
    }

    try {
      const res = await fetch(`/api/reviews/${encodeURIComponent(String(id))}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(rev)
      });
      const parsed = await safeParseJson<Review>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        updatedReview = parsed.data;
      } else if (!res.ok && !updatedInSupabase) {
        throw new Error((parsed.data as any)?.error || 'Error al actualizar la reseña.');
      }
    } catch (err: any) {
      if (!updatedInSupabase) {
        throw new Error(err?.message || 'Error al actualizar la reseña.');
      }
    }

    invalidateApiCaches();
    return updatedReview;
  },

  async retireReviewByAdmin(
    id: number | string,
    fallback?: { activityId?: number | string; text?: string; reportedUser?: string }
  ): Promise<{ retiredReviewIds: (number | string)[] }> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión para retirar reseñas.'
    });

    let retiredInSupabase = false;
    const retiredReviewIds: (number | string)[] = [];
    const idStr = id !== undefined && id !== null ? String(id).trim() : '';

    try {
      if (supabase) {
        const updatePayload = {
          retirado_de_la_vista: true,
          comentario: ADMIN_REMOVED_REVIEW_TEXT,
          multimedia_urls: [] as string[]
        };

        if (idStr && idStr !== '0') {
          const { data: updRows, error: updErr } = await supabase
            .from('reviews')
            .update(updatePayload)
            .eq('id', /^\d+$/.test(idStr) ? Number(idStr) : idStr)
            .select('id');
          if (!updErr && Array.isArray(updRows) && updRows.length > 0) {
            retiredInSupabase = true;
            updRows.forEach((r: any) => retiredReviewIds.push(r.id));
          }
        }

        if (!retiredInSupabase && fallback && (fallback.text || fallback.activityId || fallback.reportedUser)) {
          let query = supabase
            .from('reviews')
            .select('id, actividad_id, autor_id, autor_nombre, comentario');
          if (fallback.activityId) {
            query = query.eq('actividad_id', String(fallback.activityId));
          }
          const { data: candidateRows } = await query.limit(100);
          if (Array.isArray(candidateRows)) {
            const cleanText = String(fallback.text || '').trim();
            const cleanUser = normalizeIdentifierToken(fallback.reportedUser);
            const matchedIds = candidateRows
              .filter((r: any) => {
                const textMatch = cleanText && String(r.comentario || '').trim() === cleanText;
                const userMatch =
                  cleanUser &&
                  (normalizeIdentifierToken(r.autor_nombre) === cleanUser ||
                    normalizeIdentifierToken(r.autor_id) === cleanUser);
                if (cleanText && cleanUser) return textMatch && userMatch;
                if (cleanText) return textMatch;
                if (fallback.activityId && cleanUser) return userMatch;
                return false;
              })
              .map((r: any) => r.id);

            if (matchedIds.length > 0) {
              const { error: fbErr } = await supabase
                .from('reviews')
                .update(updatePayload)
                .in('id', matchedIds);
              if (!fbErr) {
                retiredInSupabase = true;
                matchedIds.forEach(mid => retiredReviewIds.push(mid));
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn('Error retirando reseña en Supabase:', err);
    }

    try {
      const targetIds = Array.from(
        new Set(
          [idStr && idStr !== '0' ? idStr : null, ...retiredReviewIds]
            .filter((x): x is string | number => x !== null && String(x).trim() !== '')
            .map(String)
        )
      );
      for (const tid of targetIds) {
        const res = await fetch(`/api/reviews/${encodeURIComponent(tid)}/retire`, {
          method: 'POST',
          headers: getHeaders()
        });
        if (!res.ok && !retiredInSupabase) {
          throw new Error('Error al retirar reseña.');
        }
      }
    } catch (err) {
      if (!retiredInSupabase) {
        throw err instanceof Error ? err : new Error('Error al retirar reseña.');
      }
    }

    invalidateApiCaches();
    return { retiredReviewIds };
  },

  async deleteReview(
    id: number | string,
    fallback?: { activityId?: number | string; text?: string; reportedUser?: string }
  ): Promise<void> {
    await this.retireReviewByAdmin(id, fallback);
  },

  async removeReportedReviewMedia(
    reviewId: number | string | undefined,
    mediaUrl: string,
    fallback?: { activityId?: number | string; reportedUser?: string }
  ): Promise<{ deletedReviewIds: (number | string)[]; updatedReviewIds: (number | string)[] }> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión para retirar contenido multimedia.'
    });

    const cleanMediaUrl = String(mediaUrl || '').trim();
    const deletedReviewIds: (number | string)[] = [];
    const updatedReviewIds: (number | string)[] = [];
    if (!cleanMediaUrl) return { deletedReviewIds, updatedReviewIds };

    try {
      if (supabase) {
        const rowsToInspect: any[] = [];
        const revIdStr = reviewId !== undefined && reviewId !== null ? String(reviewId).trim() : '';

        if (revIdStr && revIdStr !== '0') {
          const { data: exactRow } = await supabase
            .from('reviews')
            .select('id, actividad_id, autor_nombre, comentario, multimedia_urls')
            .eq('id', /^\d+$/.test(revIdStr) ? Number(revIdStr) : revIdStr)
            .maybeSingle();
          if (exactRow) rowsToInspect.push(exactRow);
        }

        if (rowsToInspect.length === 0) {
          let query = supabase
            .from('reviews')
            .select('id, actividad_id, autor_nombre, comentario, multimedia_urls');
          if (fallback?.activityId) {
            query = query.eq('actividad_id', String(fallback.activityId));
          }
          const { data: allRows } = await query.limit(200);
          if (Array.isArray(allRows)) {
            for (const r of allRows) {
              const urls = Array.isArray(r.multimedia_urls) ? r.multimedia_urls : [];
              if (urls.some((u: any) => String(u || '').trim() === cleanMediaUrl)) {
                rowsToInspect.push(r);
              }
            }
          }
        }

        for (const row of rowsToInspect) {
          const curUrls = Array.isArray(row.multimedia_urls) ? row.multimedia_urls : [];
          let nextUrls = replaceMediaUrlWithRetiredMarker(curUrls, cleanMediaUrl);
          if (
            curUrls.length > 0 &&
            !curUrls.some((u: any) => String(u || '').trim() === cleanMediaUrl) &&
            revIdStr &&
            String(row.id) === revIdStr
          ) {
            nextUrls = [RETIRED_REVIEW_MEDIA_MARKER, ...curUrls.filter((u: any) => !isRetiredReviewMediaItem(u))];
          } else if (curUrls.length === 0) {
            nextUrls = [RETIRED_REVIEW_MEDIA_MARKER];
          }

          await supabase
            .from('reviews')
            .update({ multimedia_urls: nextUrls })
            .eq('id', row.id);
          updatedReviewIds.push(row.id);
        }
      }
    } catch (err) {
      console.warn('Error retirando multimedia de reseña en Supabase:', err);
    }

    // Best-effort sync with Express local JSON store if needed
    try {
      const targetIds = Array.from(
        new Set(
          [reviewId, ...updatedReviewIds].filter(
            (x): x is string | number => x !== undefined && x !== null && String(x).trim() !== ''
          )
        )
      );
      for (const tid of targetIds) {
        let nextMediaPayload: string[] | undefined;
        if (supabase) {
          const { data: rowAfter } = await supabase
            .from('reviews')
            .select('multimedia_urls')
            .eq('id', tid)
            .maybeSingle();
          if (rowAfter && Array.isArray(rowAfter.multimedia_urls)) {
            nextMediaPayload = rowAfter.multimedia_urls;
          }
        }
        await fetch(`/api/reviews/${encodeURIComponent(String(tid))}`, {
          method: 'PUT',
          headers: getHeaders(),
          body: JSON.stringify({
            media: nextMediaPayload || [RETIRED_REVIEW_MEDIA_MARKER],
            foto: (nextMediaPayload && nextMediaPayload[0]) || RETIRED_REVIEW_MEDIA_MARKER
          })
        }).catch(() => {});
      }
    } catch {}

    invalidateApiCaches();
    return { deletedReviewIds, updatedReviewIds };
  },

  async getContacts(): Promise<Contact[]> {
    let list: Contact[] = [];

    // 1. Intentar consultar desde Supabase directamente
    try {
      if (supabase) {
        const { data: dbContacts, error } = await supabase
          .from('contacts')
          .select('id, nombre, detalle, avatar, avatar_class, bio, foto, created_at')
          .order('created_at', { ascending: false })
          .limit(60);

        if (!error && Array.isArray(dbContacts) && dbContacts.length > 0) {
          list = dbContacts.map((c: any) => ({
            id: String(c.id),
            nombre: c.nombre || 'Contacto',
            detalle: c.detalle || 'Contacto de CLUB65',
            avatar: c.avatar || (c.nombre ? c.nombre.slice(0, 2).toUpperCase() : 'CO'),
            avatarClass: c.avatar_class || c.avatarClass || 'bg-club-teal',
            bio: c.bio || 'Miembro de la comunidad de CLUB65.',
            foto: sanitizeProfileAvatar(c.foto) || undefined
          }));
        }
      }
    } catch (sbErr) {
      console.warn('Error recuperando contactos de Supabase:', sbErr);
    }

    // 2. Traer desde el servidor Express si la lista de Supabase estaba vacía o para sincronizar
    try {
      const res = await fetch('/api/contacts', { headers: getHeaders() });
      const parsed = await safeParseJson<Contact[]>(res);
      if (parsed.ok && parsed.isJson && Array.isArray(parsed.data)) {
        const map = new Map<string, Contact>();
        list.forEach(c => map.set(c.id, c));
        parsed.data.forEach(sc => {
          const cleanSc = {
            ...sc,
            foto: sanitizeProfileAvatar(sc.foto) || undefined
          };
          if (!map.has(cleanSc.id)) {
            map.set(cleanSc.id, cleanSc);
          }
        });
        list = Array.from(map.values());
      }
    } catch {
      // Ignorar fallback de red
    }

    // 3. Unir con contactos guardados localmente, filtrando perfiles de prueba
    try {
      const stored = JSON.parse(localStorage.getItem('club65_custom_contacts') || '[]');
      if (Array.isArray(stored) && stored.length > 0) {
        const cleanedStored = stored.filter(c => !isHardcodedOrMockProfile(c));
        const map = new Map<string, Contact>();
        list.forEach(c => {
          if (c.nombre) map.set(c.nombre.toLowerCase().trim(), c);
        });
        cleanedStored.forEach((c: any) => {
          const key = (c.nombre || '').toLowerCase().trim();
          if (key && !map.has(key)) {
            map.set(key, c);
            list.unshift(c);
          }
        });
      }
    } catch {}

    // 4. Filtrar rigurosamente perfiles mock/hardcodeados y excluir al propio usuario
    const currentUser = await this.getCurrentUser().catch(() => null);
    list = filterContactsForUser(list, currentUser);

    // Sincronizar en localStorage limpio
    try {
      localStorage.setItem('club65_custom_contacts', JSON.stringify(list));
    } catch {}

    return list;
  },

  async addContact(contact: Partial<Contact>): Promise<Contact> {
    const currentUser = await this.getCurrentUser().catch(() => null);
    if (currentUser && isSelfUserOrContact(contact, currentUser)) {
      throw new Error('No podés agendar a tu propio usuario.');
    }

    const contactPayload = {
      ...contact,
      avatar: contact.avatar || (contact.nombre ? contact.nombre.slice(0, 2).toUpperCase() : 'CO'),
      avatarClass: contact.avatarClass || 'bg-club-teal',
      detalle: contact.detalle || 'Contacto agendado',
      bio: contact.bio || 'Miembro de la comunidad de CLUB65.'
    };

    let createdContact: Contact;
    try {
      const res = await fetch('/api/contacts', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(contactPayload)
      });
      const parsed = await safeParseJson<Contact>(res);
      if (parsed.ok && parsed.isJson && parsed.data) {
        createdContact = parsed.data;
      } else {
        createdContact = {
          id: (contact as any).id || 'contact_' + Date.now(),
          ...contactPayload
        } as Contact;
      }
    } catch {
      createdContact = {
        id: (contact as any).id || 'contact_' + Date.now(),
        ...contactPayload
      } as Contact;
    }

    // Persistir en Supabase con las columnas exactas de la tabla contacts
    try {
      if (supabase) {
        await supabase.from('contacts').insert({
          id: createdContact.id,
          nombre: createdContact.nombre,
          detalle: createdContact.detalle,
          avatar: createdContact.avatar,
          avatar_class: createdContact.avatarClass,
          bio: createdContact.bio,
          foto: createdContact.foto || null
        });
      }
    } catch (e) {
      console.warn('Error al insertar en tabla contacts de Supabase:', e);
    }

    // Persistir en localStorage
    try {
      const stored = JSON.parse(localStorage.getItem('club65_custom_contacts') || '[]');
      const filtered = stored.filter((c: any) => (c.nombre || '').toLowerCase().trim() !== (createdContact.nombre || '').toLowerCase().trim());
      filtered.unshift(createdContact);
      localStorage.setItem('club65_custom_contacts', JSON.stringify(filtered));
    } catch {}

    return createdContact;
  },

  async deleteContact(id: string, nombre?: string): Promise<void> {
    const cleanNombre = (nombre || '').trim();
    try {
      await fetch(`/api/contacts/${encodeURIComponent(id)}${cleanNombre ? `?nombre=${encodeURIComponent(cleanNombre)}` : ''}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
    } catch (err) {
      console.warn('Error en DELETE /api/contacts:', err);
    }

    try {
      if (supabase) {
        if (cleanNombre) {
          await supabase.from('contacts').delete().or(`id.eq.${id},nombre.eq.${cleanNombre}`);
        } else {
          await supabase.from('contacts').delete().eq('id', id);
        }
      }
    } catch (e) {
      console.warn('Error al borrar en Supabase contacts:', e);
    }

    try {
      const stored: Contact[] = JSON.parse(localStorage.getItem('club65_custom_contacts') || '[]');
      const cleanLow = cleanNombre.toLowerCase();
      const updated = stored.filter((c: any) => 
        c.id !== id && (!cleanLow || (c.nombre || '').toLowerCase().trim() !== cleanLow)
      );
      localStorage.setItem('club65_custom_contacts', JSON.stringify(updated));
    } catch {}
  },

  // SECURITY REPORTS
  async getReports(): Promise<SecurityReport[]> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('reports')
          .select('id, denunciante_id, mensaje_id, resena_id, actividad_id, motivo, comentario_denunciante, estado, comentario_resolucion, creado_el')
          .order('creado_el', { ascending: false })
          .limit(50);

        if (!error && Array.isArray(data)) {
          return data.map(mapSupabaseReportRow);
        }

        if (error && (error.code === '42703' || String(error.message || '').includes('does not exist'))) {
          const { data: legacyData, error: legacyErr } = await supabase
            .from('reports')
            .select('id, denunciante_id, mensaje_id, resena_id, actividad_id, motivo, estado, creado_el')
            .limit(50);
          if (!legacyErr && Array.isArray(legacyData)) {
            return legacyData.map(mapSupabaseReportRow);
          }
        }
      } catch (err) {
        console.warn('Error leyendo reportes en Supabase:', err);
      }
    }

    try {
      const res = await fetch('/api/reports', { headers: getHeaders() });
      const parsed = await safeParseJson<any[]>(res);
      if (!parsed.ok || !parsed.isJson || !Array.isArray(parsed.data)) return [];
      return parsed.data.map(mapSupabaseReportRow);
    } catch {
      return [];
    }
  },

  async createReport(report: {
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
    reporterUserId?: string;
  }): Promise<{ success: boolean; notificationMessage: string; report: SecurityReport }> {
    const { dbUser, actor } = await resolveVerifiedSupabaseCaller({
      candidateUserId: report.reporterUserId,
      errorMessage: 'Debés iniciar sesión para enviar un reporte.'
    });

    let effectiveUuid = actor.denuncianteUuid;
    const altUuids: string[] = [];
    if (!effectiveUuid && dbUser?.email && supabase) {
      try {
        const { data: matchingEmailRows } = await supabase
          .from('users')
          .select('id, usuario, apodo')
          .ilike('email', String(dbUser.email).trim())
          .neq('estado_alta', 'eliminado')
          .limit(5);
        if (Array.isArray(matchingEmailRows)) {
          for (const row of matchingEmailRows) {
            if (row?.id && isValidUuid(row.id)) {
              if (!effectiveUuid) effectiveUuid = String(row.id).trim();
              else altUuids.push(String(row.id).trim());
            }
          }
        }
      } catch {}
    }

    const reporterUser = actor.reporterUsername;

    let finalReportedUser = report.reportedUser;
    if (finalReportedUser) {
      const resolved = await resolveTargetUserTokensInSupabase(finalReportedUser);
      if (resolved.canonicalUsername) {
        finalReportedUser = resolved.canonicalUsername;
      }
    }

    const payload = buildSupabaseReportInsertPayload(
      {
        ...report,
        reportedUser: finalReportedUser
      },
      reporterUser,
      new Date(),
      effectiveUuid || '',
      {
        allowNullableDenuncianteUuid: !effectiveUuid,
        legacyReporterUserId: actor.legacyUserId || actor.actorId
      }
    );

    let createdReport: SecurityReport | null = null;
    if (supabase) {
      const selectCols =
        'id, denunciante_id, mensaje_id, resena_id, actividad_id, motivo, comentario_denunciante, estado, comentario_resolucion, creado_el';

      let { data: insertedRow, error } = await supabase
        .from('reports')
        .insert(payload)
        .select(selectCols)
        .single();

      // Si hay error de columna/FK/tipo, reintentar con fallbacks preservando motivo, comentario_denunciante y estado
      if (
        error &&
        (error.code === '22P02' ||
          error.code === '23503' ||
          error.code === '42703' ||
          error.code === 'PGRST204')
      ) {
        const fallbackPayloads = buildSupabaseReportFallbackPayloads(payload, altUuids);

        // Si denunciante_id tenía un UUID no presente en auth.users (23503 FK sobre denunciante_id), probar también con denunciante_id: null
        if (error.code === '23503' && payload.denunciante_id !== null) {
          const nullablePrimary = buildSupabaseReportInsertPayload(
            {
              ...report,
              id: payload.id,
              reportedUser: finalReportedUser
            },
            reporterUser,
            new Date(),
            '',
            {
              allowNullableDenuncianteUuid: true,
              legacyReporterUserId: actor.actorId
            }
          );
          fallbackPayloads.push(nullablePrimary, ...buildSupabaseReportFallbackPayloads(nullablePrimary, []));
        }

        for (const candidatePayload of fallbackPayloads) {
          const retry = await supabase
            .from('reports')
            .insert(candidatePayload)
            .select(selectCols)
            .single();
          insertedRow = retry.data;
          error = retry.error;
          if (!error && insertedRow) break;
        }
      }

      if (error || !insertedRow) {
        console.error('Error guardando reporte en Supabase:', error);
        if (error?.code === '23502' && String(error.message || '').includes('denunciante_id')) {
          throw new Error(
            'Tu cuenta aún no tiene confirmación de correo en Supabase Auth y la tabla reports exige denunciante_id UUID obligatorio. Confirmá tu correo o habilitá denunciante_id nullable en Supabase.'
          );
        }
        throw new Error(error?.message || 'No se pudo registrar el reporte en la base de datos.');
      }
      createdReport = mapSupabaseReportRow(insertedRow);
    }

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          ...report,
          id: payload.id,
          reportedUser: finalReportedUser,
          reporterUser
        })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data && !createdReport) {
        return parsed.data;
      }
    } catch {}

    if (!createdReport) {
      throw new Error('Error al enviar el reporte.');
    }

    invalidateApiCaches();
    return {
      success: true,
      notificationMessage:
        'Su reporte ha sido recibido, Te comunicaremos si detectamos que se incumplió una regla, así como las medidas que tomaremos al respecto',
      report: createdReport
    };
  },

  async resolveReport(
    id: string,
    status: 'resuelto' | 'desestimado' | 'ban_user' | 'delete_content' | 'dismiss',
    resolutionNote?: string,
    action?: string,
    sanctionReason?: string,
    adminComment?: string,
    sanctionType?: 'temporal_7' | 'temporal_30' | 'permanente',
    alsoDeletedContent?: boolean,
    resolutionDetail?: string
  ): Promise<SecurityReport> {
    const { session, dbUser: caller, actor } = await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión con una cuenta de moderación para resolver reportes.'
    });
    const sessionMeta = session?.user?.user_metadata || {};
    const resolvedBy =
      normalizeIdentifierToken(caller?.usuario || caller?.apodo || sessionMeta.usuario || sessionMeta.apodo || actor.reporterUsername) || 'administrador';

    const updatePayload = buildSupabaseReportResolvePayload({
      status,
      resolutionNote,
      action,
      sanctionReason,
      adminComment,
      sanctionType,
      alsoDeletedContent,
      resolutionDetail,
      resolvedBy
    });

    let resolvedReport: SecurityReport | null = null;
    if (supabase) {
      const { data: updatedRow, error } = await supabase
        .from('reports')
        .update(updatePayload)
        .eq('id', String(id).trim())
        .select('id, denunciante_id, mensaje_id, resena_id, actividad_id, motivo, comentario_denunciante, estado, comentario_resolucion, creado_el')
        .maybeSingle();

      if (error) {
        console.error('Error actualizando resolución de reporte en Supabase:', error);
        throw new Error(error.message || 'No se pudo guardar la resolución del reporte en Supabase.');
      }

      if (updatedRow) {
        resolvedReport = mapSupabaseReportRow(updatedRow);
        const reporterTarget = resolvedReport.reporterUsername || resolvedReport.reporterUser;
        if (reporterTarget) {
          const isDismiss = updatePayload.estado === 'desestimado';
          const resolvedMeta = (() => {
            try {
              return JSON.parse(updatePayload.comentario_resolucion || '{}');
            } catch {
              return {};
            }
          })();
          const cleanComment = resolvedMeta.adminComment;
          const resNote = resolvedMeta.resolutionNote || 'Resolución aplicada';
          const notifText = isDismiss
            ? `Tu reporte sobre "${resolvedReport.reason}" fue evaluado por el Administrador. Tras revisar el contexto, se desestimó al no evidenciar infracciones mayores a las normas comunitarias.`
            : `Resolución sobre tu reporte ("${resolvedReport.reason}"): El Administrador (@${resolvedBy}) aplicó medidas operativas (${resNote}).${cleanComment && cleanComment !== '-' ? ` Nota: ${cleanComment}` : ''}`;
          await appendUserNotificationInSupabase(reporterTarget, notifText);
        }
      }
    }

    try {
      const resolvedMeta = (() => {
        try {
          return JSON.parse(updatePayload.comentario_resolucion || '{}');
        } catch {
          return {};
        }
      })();
      const res = await fetch(`/api/reports/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          status: updatePayload.estado,
          resolutionNote: resolvedMeta.resolutionNote,
          action: action || status,
          sanctionReason,
          adminComment: resolvedMeta.adminComment,
          sanctionType,
          alsoDeletedContent: resolvedMeta.alsoDeletedContent,
          resolutionDetail
        })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data?.report && !resolvedReport) {
        resolvedReport = parsed.data.report;
      }
    } catch {}

    if (!resolvedReport) {
      throw new Error('Error al resolver reporte: el reporte no fue encontrado.');
    }

    invalidateApiCaches();
    return resolvedReport;
  },

  async getChatContextMessagesForReport(chatId: number | string): Promise<ChatMessage[]> {
    if (!supabase || chatId === undefined || chatId === null || String(chatId).trim() === '') {
      return [];
    }
    try {
      const bigChatId = chatIdentifierToBigInt(chatId);
      const { data, error } = await supabase
        .from('messages')
        .select('id, chat_id, sender_id, sender, avatar, role, text, time, created_at, is_deleted, deleted_by_admin, deleted_by_group_moderator, is_pinned')
        .eq('chat_id', bigChatId)
        .order('created_at', { ascending: true })
        .limit(200);

      if (error || !Array.isArray(data)) return [];
      return data.map((m: any) => {
        const displayState = resolveRemovedMessageDisplay(m);
        return {
          id: String(m.id),
          chatId: String(chatId),
          senderId: String(m.sender_id || ''),
          sender: m.sender || 'Vecino',
          avatar: m.avatar || '',
          role: m.role || 'Vecino',
          text: displayState.text,
          time: m.time || (m.created_at ? formatArgentinaTimeOnly(m.created_at) : ''),
          isDeleted: displayState.isDeleted,
          deletedByAdmin: displayState.deletedByAdmin,
          deletedByGroupModerator: displayState.deletedByGroupModerator,
          isPinned: Boolean(m.is_pinned) && !displayState.isDeleted,
          createdAt: m.created_at || undefined,
          timestamp: m.created_at ? new Date(m.created_at).getTime() : undefined
        };
      });
    } catch (err) {
      console.warn('Error cargando contexto de chat desde Supabase:', err);
      return [];
    }
  },

  async darDeBajaActividad(
    id: number | string,
    motivo?: string,
    executorUser?: { id?: string; usuario?: string; apodo?: string; tipo?: string; rol?: string } | null
  ): Promise<Activity> {
    const cleanId = String(id).trim();
    const numericId = Number(id);
    const cleanReason = (motivo && String(motivo).trim())
      ? String(motivo).trim()
      : 'Cancelada por el organizador';
    const fechaBajaIso = new Date().toISOString();
    const fechaBajaDisplay = formatArgentinaDateTime(fechaBajaIso);

    const { session, dbUser: executorProfile, actor } = await resolveVerifiedSupabaseCaller({
      candidateUserId: executorUser?.id,
      errorMessage: 'Debés iniciar sesión para dar de baja una actividad.'
    });
    const executorId = actor.actorId;

    const me = executorProfile || executorUser;
    const isAdminExec = isOfficialAdminRow(me);
    const sessionMeta = session?.user?.user_metadata || {};
    const responsableDisplay = String(
      me?.usuario || me?.apodo || sessionMeta.usuario || sessionMeta.apodo || actor.reporterUsername || executorId
    ).replace(/^@/, '');

    let sbUpdatedAct: any = null;
    if (supabase) {
      const { data: existingRow } = await supabase
        .from('activities')
        .select('id, title, titulo, organizer, creador, organizer_id, creador_id, enrolled_usernames')
        .eq('id', cleanId)
        .maybeSingle();

      const { data: updatedRow, error: updErr } = await supabase
        .from('activities')
        .update({
          is_approved: false,
          proposal_status: isAdminExec ? 'baja_forzada' : 'cancelada_organizador',
          estado: 'baja_forzada',
          fecha_baja: fechaBajaIso,
          motivo_baja: cleanReason,
          feedback_admin: cleanReason,
          admin_baja_id: executorId,
          proposal_note: cleanReason,
          feedback: cleanReason
        })
        .eq('id', cleanId)
        .select('id, title, titulo, organizer, creador, proposal_status, estado, fecha_baja, motivo_baja, enrolled_usernames')
        .maybeSingle();

      if (updErr) {
        console.warn('Error actualizando baja en Supabase activities:', updErr.message);
        throw new Error(`No se pudo actualizar la actividad en el sistema: ${updErr.message}`);
      }
      if (updatedRow) {
        sbUpdatedAct = updatedRow;
      }

      const actTitle = existingRow?.title || existingRow?.titulo || updatedRow?.title || updatedRow?.titulo || 'Actividad';
      const cleanActTitle = String(actTitle).replace(/^grupo:\s*/i, '').trim() || 'Actividad';
      const cleanActLower = cleanActTitle.toLowerCase();
      const actOrganizer = existingRow?.organizer || existingRow?.creador || updatedRow?.organizer || 'Organizador';

      if (!isNaN(numericId)) {
        try {
          await supabase.from('bajas').delete().eq('activity_id', numericId);
        } catch (_) {}
      }
      const { error: bajaErr } = await supabase.from('bajas').insert({
        id: `baja_${Date.now()}_${cleanId}`,
        activity_id: !isNaN(numericId) ? numericId : 0,
        title: actTitle,
        organizer: actOrganizer,
        date: fechaBajaDisplay,
        reason: cleanReason,
        admin_username: isAdminExec ? responsableDisplay : '-'
      });
      if (bajaErr) {
        console.warn('Error registrando baja en Supabase bajas:', bajaErr.message);
      }

      // Eliminar el grupo de chat asociado en Supabase y notificar a los participantes
      try {
        const { data: actGroupChats } = await supabase
          .from('chats')
          .select('id, nombre, tipo, actividad_id, creador_id')
          .eq('tipo', 'grupo_actividad');

        const matchedChats = Array.isArray(actGroupChats)
          ? actGroupChats.filter((c: any) => {
              if (!c) return false;
              if (c.actividad_id !== undefined && c.actividad_id !== null && String(c.actividad_id) === String(cleanId)) {
                return true;
              }
              const cName = String(c.nombre || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
              return Boolean(cleanActLower && cName === cleanActLower);
            })
          : [];

        const matchedChatIds = matchedChats.map((c: any) => String(c.id)).filter(Boolean);
        const participantUserIdsFromChat = new Set<string>();

        if (matchedChatIds.length > 0) {
          try {
            const { data: partRows } = await supabase
              .from('chat_participants')
              .select('user_id')
              .in('chat_id', matchedChatIds);
            if (Array.isArray(partRows)) {
              for (const pr of partRows) {
                if (pr?.user_id) participantUserIdsFromChat.add(String(pr.user_id).trim());
              }
            }
          } catch (partReadErr) {
            console.warn('Error leyendo chat_participants del grupo cancelado:', partReadErr);
          }

          try {
            await supabase.from('chat_participants').delete().in('chat_id', matchedChatIds);
          } catch (delPartErr) {
            console.warn('Error eliminando chat_participants del grupo cancelado:', delPartErr);
          }

          try {
            await supabase.from('chats').delete().in('id', matchedChatIds);
          } catch (delChatErr) {
            console.warn('Error eliminando grupo asociado de chats:', delChatErr);
          }
        }

        const targetTokens = new Set<string>();
        const addTok = (val: any) => {
          if (!val) return;
          if (typeof val === 'object') {
            addTok(val.id);
            addTok(val.usuario);
            addTok(val.apodo);
            addTok(val.nombre);
            return;
          }
          const clean = String(val).trim().toLowerCase().replace(/^@/, '');
          if (clean && !isDummyOrSystemParticipant(clean)) targetTokens.add(clean);
        };

        for (const uid of participantUserIdsFromChat) addTok(uid);
        const rawEnrolled = Array.isArray(existingRow?.enrolled_usernames)
          ? existingRow.enrolled_usernames
          : (Array.isArray(updatedRow?.enrolled_usernames) ? updatedRow.enrolled_usernames : []);
        const rawInscriptos = Array.isArray((existingRow as any)?.inscriptos)
          ? (existingRow as any).inscriptos
          : (Array.isArray((updatedRow as any)?.inscriptos) ? (updatedRow as any).inscriptos : []);
        for (const e of [...rawEnrolled, ...rawInscriptos]) addTok(e);
        addTok(existingRow?.organizer_id);
        addTok(existingRow?.creador_id);
        addTok(existingRow?.organizer);
        addTok(existingRow?.creador);
        for (const mc of matchedChats) addTok(mc?.creador_id);

        if (isAdminExec) {
          const orgTokens = new Set<string>(
            [existingRow?.organizer_id, existingRow?.creador_id, existingRow?.organizer, existingRow?.creador]
              .filter(Boolean)
              .map((v: any) => String(v).trim().toLowerCase().replace(/^@/, ''))
          );
          const enrolledTokens = new Set<string>(
            [...rawEnrolled, ...rawInscriptos]
              .map((e: any) => (typeof e === 'object' ? (e?.id || e?.usuario || e?.apodo || e?.nombre) : e))
              .filter(Boolean)
              .map((v: any) => String(v).trim().toLowerCase().replace(/^@/, ''))
          );
          const execTok = executorId.toLowerCase().replace(/^@/, '');
          if (!orgTokens.has(execTok) && !enrolledTokens.has(execTok)) {
            targetTokens.delete(execTok);
          }
        }

        if (targetTokens.size > 0) {
          const { data: userRows, error: uSelErr } = await supabase
            .from('users')
            .select('id, usuario, apodo, notifications');
          if (uSelErr) {
            console.warn('Error consultando users para notificar baja de grupo:', uSelErr.message);
          }
          if (Array.isArray(userRows)) {
            const noticeMsg = buildCancelledGroupNoticeMessage(cleanActTitle);
            const noticeTimestamp = Date.now();
            const updates: Promise<any>[] = [];
            for (const uRow of userRows) {
              if (!uRow?.id) continue;
              const uToks = [uRow.id, uRow.usuario, uRow.apodo]
                .filter(Boolean)
                .map((v: any) => String(v).trim().toLowerCase().replace(/^@/, ''));
              if (!uToks.some(t => targetTokens.has(t))) continue;

              const curNotifs = Array.isArray(uRow.notifications) ? uRow.notifications : [];
              const filtered = curNotifs.filter(
                (n: any) => !(n && n.type === 'cancelled_group_notice' && String(n.activityId) === String(cleanId))
              );
              const nextNotifs = [
                {
                  id: `cnotif_${cleanId}_${noticeTimestamp}`,
                  type: 'cancelled_group_notice',
                  activityId: !isNaN(numericId) ? numericId : cleanId,
                  activityTitle: cleanActTitle,
                  message: noticeMsg,
                  date: fechaBajaDisplay,
                  createdAt: fechaBajaIso,
                  dismissed: false
                },
                ...filtered
              ];
              cachedNotificationsByUser.set(String(uRow.id), nextNotifs);
              updates.push(
                Promise.resolve(
                  supabase.from('users').update({ notifications: nextNotifs }).eq('id', uRow.id)
                )
              );
            }
            if (updates.length > 0) {
              await Promise.allSettled(updates);
            }
          }
        }
      } catch (groupCleanupErr) {
        console.warn('Error limpiando grupo y notificando participantes en Supabase:', groupCleanupErr);
      }
    }

    let localActivity: Activity | null = null;
    if (!sbUpdatedAct) {
      try {
        const res = await fetch(`/api/activities/${encodeURIComponent(cleanId)}/force-cancel`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ reason: cleanReason })
        });
        const parsed = await safeParseJson<any>(res);
        if (parsed.ok && parsed.isJson && parsed.data) {
          localActivity = parsed.data.activity;
        }
      } catch (_) {}
    }

    invalidateApiCaches();

    const baseStatus = isAdminExec ? 'baja_forzada' : 'cancelada_organizador';
    if (sbUpdatedAct) {
      return {
        ...(localActivity || {}),
        id: Number(sbUpdatedAct.id) || numericId,
        title: sbUpdatedAct.title || sbUpdatedAct.titulo || localActivity?.title || '',
        isApproved: false,
        proposalStatus: baseStatus,
        estado: 'baja_forzada',
        baja_forzada: isAdminExec,
        canceladaPorOrganizador: !isAdminExec,
        fecha_baja: fechaBajaIso,
        bajaDate: fechaBajaDisplay,
        motivo_baja: cleanReason,
        feedback_admin: cleanReason,
        bajaReason: cleanReason,
        admin_baja_id: executorId,
        bajaAdmin: executorId,
        proposalNote: cleanReason
      } as Activity;
    }

    if (localActivity) {
      return localActivity;
    }

    return {
      id: numericId,
      isApproved: false,
      proposalStatus: baseStatus,
      estado: 'baja_forzada',
      baja_forzada: isAdminExec,
      canceladaPorOrganizador: !isAdminExec,
      fecha_baja: fechaBajaIso,
      bajaDate: fechaBajaDisplay,
      motivo_baja: cleanReason,
      feedback_admin: cleanReason,
      bajaReason: cleanReason,
      admin_baja_id: executorId,
      bajaAdmin: executorId
    } as unknown as Activity;
  },

  async forceCancelActivity(id: number | string, reason: string, adminUsername?: string): Promise<Activity> {
    const { dbUser: adminRow, actor } = await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión con una cuenta de moderación para dar de baja actividades.'
    });

    return this.darDeBajaActividad(id, reason, {
      id: actor.actorId,
      usuario: adminRow?.usuario || adminUsername || adminRow?.apodo || 'administrador',
      apodo: adminRow?.apodo || adminUsername || 'Administrador',
      tipo: adminRow?.tipo || 'moderador',
      rol: adminRow?.rol || 'moderador'
    });
  },

  async getBajas(): Promise<BajaRecord[]> {
    const mergedByActId = new Map<string, BajaRecord>();
    const actById = new Map<string, any>();

    if (supabase) {
      try {
        const [{ data: bajasRows }, { data: suspendedActs }] = await Promise.all([
          supabase
            .from('bajas')
            .select('id, activity_id, title, organizer, date, reason, admin_username, created_at')
            .order('created_at', { ascending: false })
            .limit(50),
          supabase
            .from('activities')
            .select('id, title, titulo, organizer, creador, organizer_id, creador_id, organizador_id, user_id, motivo_baja, fecha_baja, admin_baja_id, proposal_status, estado, feedback_admin, proposal_note, feedback')
            .or('proposal_status.eq.baja_forzada,proposal_status.eq.cancelada_organizador,estado.eq.baja_forzada')
            .limit(50)
        ]);

        if (Array.isArray(suspendedActs)) {
          for (const a of suspendedActs) {
            if (a && a.id !== undefined && a.id !== null) {
              actById.set(String(a.id), a);
            }
          }
        }

        const knownActivities = Array.from(actById.values());

        if (Array.isArray(bajasRows)) {
          for (const b of bajasRows) {
            const key = String(b.activity_id);
            if (!mergedByActId.has(key)) {
              const record: BajaRecord = {
                id: String(b.id),
                activityId: Number(b.activity_id) || b.activity_id,
                title: b.title || 'Actividad',
                organizer: b.organizer || 'Organizador',
                date: b.date || '',
                reason: b.reason || '-',
                adminUsername: b.admin_username || 'administrador'
              };
              record.adminUsername = resolveBajaAdminDisplay(record, knownActivities);
              mergedByActId.set(key, record);
            }
          }
        }

        if (Array.isArray(suspendedActs)) {
          for (const a of suspendedActs) {
            const key = String(a.id);
            if (!mergedByActId.has(key)) {
              const reason = a.motivo_baja || a.feedback_admin || a.proposal_note || a.feedback || '-';
              const record: BajaRecord = {
                id: `baja_act_${key}`,
                activityId: Number(a.id) || a.id,
                title: a.title || a.titulo || 'Actividad',
                organizer: a.organizer || a.creador || 'Organizador',
                date: a.fecha_baja
                  ? (String(a.fecha_baja).includes('T') ? formatArgentinaDateTime(a.fecha_baja) : String(a.fecha_baja))
                  : '',
                reason,
                adminUsername: a.admin_baja_id || 'administrador'
              };
              record.adminUsername = resolveBajaAdminDisplay(record, knownActivities);
              mergedByActId.set(key, record);
            }
          }
        }
      } catch (err) {
        console.warn('Error consultando bajas en Supabase:', err);
      }
    }

    try {
      const res = await fetch('/api/admin/bajas', { headers: getHeaders() });
      const parsed = await safeParseJson<BajaRecord[]>(res);
      if (parsed.ok && parsed.isJson && Array.isArray(parsed.data)) {
        const knownActivities = Array.from(actById.values());
        for (const b of parsed.data) {
          const key = String(b.activityId);
          if (!mergedByActId.has(key)) {
            mergedByActId.set(key, {
              ...b,
              adminUsername: resolveBajaAdminDisplay(b, knownActivities)
            });
          }
        }
      }
    } catch (_) {}

    return Array.from(mergedByActId.values());
  },

  // INSTITUTIONS
  async getInstitutions(forceRefresh = false): Promise<User[]> {
    const now = Date.now();
    if (!forceRefresh && cachedInstitutionsList && (now - lastInstitutionsFetchTime < 60000)) {
      return cachedInstitutionsList;
    }
    if (institutionsInFlightPromise) {
      return institutionsInFlightPromise;
    }

    institutionsInFlightPromise = (async () => {
      // Excluir avatar Base64 en listados de instituciones y deduplicar peticiones paralelas
      const { data, error } = await supabase
        .from('users')
        .select('id, usuario, apodo, email, bio, tipo, rol, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, localidad, is_verified, estado_alta, created_at')
        .or('tipo.eq.institucional,rol.eq.institucional')
        .neq('estado_alta', 'eliminado')
        .limit(50);

      if (error) {
        console.error('Error fetching institutions:', error);
        return [];
      }

      const mapped = (data || []).map(mapSupabaseUser);
      cachedInstitutionsList = mapped;
      lastInstitutionsFetchTime = Date.now();
      return mapped;
    })().finally(() => {
      institutionsInFlightPromise = null;
    });

    return institutionsInFlightPromise;
  },

  async getPendingInstitutions(): Promise<User[]> {
    const all = await this.getInstitutions();
    return all.filter((u: any) => {
      const estado = u.estadoAlta || u.estado_alta;
      return !estado || estado === 'pendiente';
    });
  },

  async getApprovedInstitutions(): Promise<User[]> {
    const all = await this.getInstitutions();
    return all.filter((u: any) => {
      const estado = u.estadoAlta || u.estado_alta;
      return estado === 'aprobada' || u.isVerified === true;
    });
  },

  async approveInstitution(userId: string, adminInfo?: { apodo?: string; usuario?: string }): Promise<User> {
    const { dbUser: moderatorRow } = await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión con una cuenta de moderación para aprobar instituciones.'
    });

    // 1. Obtener los metadatos institucionales actuales para preservar personería, cuit, manager, etc.
    const { data: existingUser } = await supabase
      .from('users')
      .select('legal_representative, apodo, usuario, created_at')
      .eq('id', userId)
      .maybeSingle();

    let meta: any = {};
    if (existingUser?.legal_representative && typeof existingUser.legal_representative === 'string') {
      try {
        const raw = existingUser.legal_representative.trim();
        if (raw.startsWith('{') && raw.endsWith('}')) {
          meta = JSON.parse(raw);
        } else {
          meta = { presidente: existingUser.legal_representative };
        }
      } catch {
        meta = { presidente: existingUser.legal_representative };
      }
    }

    const adminUser = (moderatorRow?.usuario || adminInfo?.usuario || 'Administrador').replace(/^@/, '');
    const adminNombre = moderatorRow?.apodo || adminInfo?.apodo || adminUser;
    const nowArt = formatArgentinaDateTime(new Date());

    meta.altaPor = `@${adminUser}`;
    meta.altaPorUsuario = adminUser;
    meta.altaPorApodo = adminNombre;
    meta.fechaAlta = nowArt;
    meta.fechaAltaIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('users')
      .update({
        estado_alta: 'aprobada',
        is_verified: true,
        legal_representative: JSON.stringify(meta)
      })
      .eq('id', userId)
      .select('id, usuario, apodo, email, avatar, bio, tipo, rol, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, localidad, is_verified, estado_alta, created_at')
      .single();

    if (error || !data) {
      console.error('Error al aprobar institucion:', error);
      throw new Error('Error al dar de alta la institución.');
    }

    try {
      await fetch(`/api/admin/institutions/${userId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getHeaders() },
        body: JSON.stringify({
          adminApodo: adminNombre,
          adminUsuario: adminUser,
          fechaAlta: nowArt
        })
      });
    } catch (_) {}

    invalidateApiCaches();
    return mapSupabaseUser(data);
  },

  async rejectInstitution(userId: string, reason?: string): Promise<User> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión con una cuenta de moderación para rechazar instituciones.'
    });

    const { data, error } = await supabase
      .from('users')
      .update({
        estado_alta: 'eliminado'
      })
      .eq('id', userId)
      .select('id, usuario, apodo, email, avatar, bio, tipo, estado_alta')
      .single();

    if (error || !data) {
      console.error('Error al rechazar institucion:', error);
      throw new Error('Error al rechazar la solicitud.');
    }

    invalidateApiCaches();
    return mapSupabaseUser(data);
  },

  async verifyInstitution(userId: string, isVerified: boolean): Promise<User> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión con una cuenta de moderación para verificar instituciones.'
    });

    let verifiedUser: User | null = null;
    if (supabase) {
      const { data, error } = await supabase
        .from('users')
        .update({ is_verified: Boolean(isVerified) })
        .eq('id', userId)
        .select('id, usuario, apodo, email, avatar, bio, tipo, rol, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, localidad, is_verified, estado_alta, created_at')
        .maybeSingle();
      if (!error && data) {
        verifiedUser = mapSupabaseUser(data);
      }
    }

    try {
      const res = await fetch(`/api/admin/institutions/${encodeURIComponent(userId)}/verify`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ isVerified })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data?.user && !verifiedUser) {
        verifiedUser = parsed.data.user;
      } else if (!res.ok && !verifiedUser) {
        throw new Error((parsed.data as any)?.error || 'Error al cambiar verificación institucional.');
      }
    } catch (err: any) {
      if (!verifiedUser) {
        throw new Error(err?.message || 'Error al cambiar verificación institucional.');
      }
    }

    if (!verifiedUser) {
      throw new Error('Error al cambiar verificación institucional.');
    }
    invalidateApiCaches();
    return verifiedUser;
  },

  // PROMOTE USER TO ADMINISTRATOR
  async promoteToAdmin(identifier: string): Promise<User> {
    const cleanIdentifier = normalizeAdminPromotionIdentifier(identifier);
    if (!cleanIdentifier) {
      throw new Error('Ingresá el nombre de usuario o correo electrónico de la cuenta a promover.');
    }

    const { dbUser: callerRow } = await resolveVerifiedSupabaseCaller({
      errorMessage: 'Solo los administradores oficiales con sesión iniciada pueden designar nuevos administradores.'
    });

    const caller = callerRow ? mapSupabaseUser(callerRow) : null;
    if (!caller || resolveUserRole(caller) !== 'moderador') {
      throw new Error('Solo los administradores oficiales pueden designar nuevos administradores.');
    }

    const USER_PROMOTE_SELECT = 'id, usuario, apodo, email, avatar, bio, tipo, rol, contacto_emergencia, text_size, contrast, localidad, is_verified, estado_alta, entidad_tipo, cuit, legal_representative, contacto_institucional, documento_cuit_url, documento_personeria_url, blocked_users, notifications, created_at';
    const candidates: any[] = [];
    const pushRows = (rows: any) => {
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r && r.id && !candidates.some((c) => String(c.id) === String(r.id))) {
            candidates.push(r);
          }
        }
      }
    };

    if (cleanIdentifier.includes('@')) {
      const { data: byEmail } = await supabase
        .from('users')
        .select(USER_PROMOTE_SELECT)
        .ilike('email', cleanIdentifier)
        .neq('estado_alta', 'eliminado')
        .limit(20);
      pushRows(byEmail);
    } else {
      const [{ data: byUser }, { data: byId }, { data: byApodo }] = await Promise.all([
        supabase
          .from('users')
          .select(USER_PROMOTE_SELECT)
          .ilike('usuario', cleanIdentifier)
          .neq('estado_alta', 'eliminado')
          .limit(20),
        supabase
          .from('users')
          .select(USER_PROMOTE_SELECT)
          .eq('id', cleanIdentifier)
          .neq('estado_alta', 'eliminado')
          .limit(5),
        supabase
          .from('users')
          .select(USER_PROMOTE_SELECT)
          .ilike('apodo', cleanIdentifier)
          .neq('estado_alta', 'eliminado')
          .limit(20)
      ]);
      pushRows(byUser);
      pushRows(byId);
      pushRows(byApodo);
    }

    const targetRow = findPromotableUserCandidate(candidates, cleanIdentifier);
    if (!targetRow) {
      throw new Error('No se encontró ninguna cuenta activa con ese nombre de usuario o correo electrónico.');
    }

    const payload = buildSupabaseAdminPromotionPayload(targetRow, {
      usuario: caller.usuario,
      apodo: caller.apodo
    });

    let updatedRow: any = null;
    const { data: sbUpdated, error: updateError } = await supabase
      .from('users')
      .update(payload)
      .eq('id', targetRow.id)
      .select(USER_PROMOTE_SELECT)
      .single();

    if (updateError && String(updateError.message || '').toLowerCase().includes('contacto_emergencia')) {
      const { contacto_emergencia: _ignored, ...fallbackPayload } = payload;
      const retryRes = await supabase
        .from('users')
        .update(fallbackPayload)
        .eq('id', targetRow.id)
        .select(USER_PROMOTE_SELECT)
        .single();
      if (retryRes.error || !retryRes.data) {
        throw new Error(retryRes.error?.message || 'Error al actualizar el rol del usuario en Supabase.');
      }
      updatedRow = retryRes.data;
    } else if (updateError || !sbUpdated) {
      throw new Error(updateError?.message || 'Error al actualizar el rol del usuario en Supabase.');
    } else {
      updatedRow = sbUpdated;
    }

    // Regla estricta: al promover un usuario a administrador, removerlo de todos los grupos en Supabase (manteniendo chats privados)
    try {
      const { data: memberRows } = await supabase
        .from('chat_participants')
        .select('chat_id, chats:chat_id ( id, tipo )')
        .eq('user_id', targetRow.id);
      if (Array.isArray(memberRows) && memberRows.length > 0) {
        const groupChatIds = memberRows
          .map((row: any) => {
            const c = Array.isArray(row?.chats) ? row.chats[0] : row?.chats;
            if (!c || c.tipo === 'privado') return null;
            return String(row.chat_id || c.id || '').trim();
          })
          .filter((cid): cid is string => Boolean(cid));
        if (groupChatIds.length > 0) {
          await supabase
            .from('chat_participants')
            .delete()
            .eq('user_id', targetRow.id)
            .in('chat_id', groupChatIds);
        }
      }
    } catch (cleanGrpErr) {
      console.warn('Aviso removiendo membresías grupales al promover administrador:', cleanGrpErr);
    }

    try {
      await fetch('/api/admin/promote', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          identifier: targetRow.id,
          username: targetRow.usuario || cleanIdentifier,
          email: targetRow.email
        })
      });
    } catch (_) {}

    invalidateApiCaches();

    const mappedUser = mapSupabaseUser(updatedRow);
    if (String(mappedUser.id) === String(caller.id)) {
      try {
        localStorage.setItem('club65_user', JSON.stringify(mappedUser));
        localStorage.setItem('currentUser', JSON.stringify(mappedUser));
      } catch (_) {}
    }

    return mappedUser;
  },

  // BANS & SANCTIONS
  async getSanctions(): Promise<SanctionRecord[]> {
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('sanctions')
          .select('id, username, reason, comment, admin_username, date, type, lift_date, expires_at, report_id, created_at')
          .order('created_at', { ascending: false })
          .limit(50);

        if (!error && Array.isArray(data)) {
          return data
            .map(mapSupabaseSanctionRow)
            .filter(s => isSanctionCurrentlyActive(s));
        }
      } catch (err) {
        console.warn('Error leyendo sanciones en Supabase:', err);
      }
    }

    try {
      const res = await fetch('/api/admin/sanctions', { headers: getHeaders() });
      const parsed = await safeParseJson<any[]>(res);
      if (!parsed.ok || !parsed.isJson || !Array.isArray(parsed.data)) return [];
      return parsed.data.map(mapSupabaseSanctionRow).filter(s => isSanctionCurrentlyActive(s));
    } catch {
      return [];
    }
  },

  async addSanction(sanction: {
    username: string;
    reason: string;
    comment?: string;
    type?: 'temporal_7' | 'temporal_30' | 'permanente';
    liftDate?: string;
    reportId?: string;
  }): Promise<SanctionRecord> {
    const cleanInputUser = String(sanction.username || '').trim().replace(/^@+/, '');
    if (!cleanInputUser || !sanction.reason) {
      throw new Error('Usuario y motivo de sanción requeridos.');
    }

    const { session, dbUser: caller, actor } = await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión con una cuenta de moderación para aplicar sanciones.'
    });
    const sessionMeta = session?.user?.user_metadata || {};
    const adminUsername =
      normalizeIdentifierToken(caller?.usuario || caller?.apodo || sessionMeta.usuario || sessionMeta.apodo || actor.reporterUsername) || 'administrador';

    const { canonicalUsername, matchedUser } = await resolveTargetUserTokensInSupabase(cleanInputUser);
    const targetUsername = canonicalUsername || normalizeIdentifierToken(cleanInputUser) || cleanInputUser;

    const timing = computeSanctionLiftAndExpiry(sanction.type || 'temporal_7');
    const finalLiftDate = sanction.liftDate || timing.liftDate;
    const cleanComment =
      sanction.comment && sanction.comment.trim() ? sanction.comment.trim() : '-';

    const supabasePayload = {
      id: `sanc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      username: targetUsername,
      reason: String(sanction.reason).trim(),
      comment: cleanComment,
      admin_username: adminUsername,
      date: timing.date,
      type: timing.type,
      lift_date: finalLiftDate,
      report_id: sanction.reportId ? String(sanction.reportId) : null
    };

    let createdSanction: SanctionRecord | null = null;
    if (supabase) {
      const { data: insertedRow, error } = await supabase
        .from('sanctions')
        .insert(supabasePayload)
        .select('id, username, reason, comment, admin_username, date, type, lift_date, expires_at, report_id, created_at')
        .single();

      if (error || !insertedRow) {
        console.error('Error guardando sanción en Supabase:', error);
        throw new Error(error?.message || 'No se pudo registrar la sanción en Supabase.');
      }

      createdSanction = mapSupabaseSanctionRow(insertedRow);
      if (!createdSanction.expiresAt && timing.expiresAt) {
        createdSanction.expiresAt = timing.expiresAt;
      }

      await appendUserNotificationInSupabase(
        targetUsername,
        `Has recibido una sanción (${supabasePayload.reason}): ${cleanComment !== '-' ? cleanComment : 'Incumplimiento de normas comunitarias'}.`,
        matchedUser?.id
      );
    }

    try {
      const res = await fetch('/api/admin/sanctions', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          ...sanction,
          username: targetUsername,
          liftDate: finalLiftDate
        })
      });
      const parsed = await safeParseJson<any>(res);
      if (parsed.ok && parsed.isJson && parsed.data?.sanction && !createdSanction) {
        createdSanction = parsed.data.sanction;
      }
    } catch {}

    if (!createdSanction) {
      throw new Error('Error al registrar sanción.');
    }

    invalidateApiCaches();
    return createdSanction;
  },

  async removeSanction(username: string): Promise<void> {
    await resolveVerifiedSupabaseCaller({
      errorMessage: 'Debés iniciar sesión con una cuenta de moderación para levantar sanciones.'
    });

    const cleanInput = String(username || '').trim();
    if (!cleanInput) return;

    const { tokens, matchedUser } = await resolveTargetUserTokensInSupabase(cleanInput);
    const tokenSet = new Set(tokens.map(normalizeIdentifierToken).filter(Boolean));
    tokenSet.add(normalizeIdentifierToken(cleanInput));

    if (supabase) {
      const { data: rows, error: selErr } = await supabase
        .from('sanctions')
        .select('id, username')
        .limit(250);

      if (selErr) {
        throw new Error(selErr.message || 'Error consultando sanciones en Supabase.');
      }

      const matchingIds = (rows || [])
        .filter((r: any) => tokenSet.has(normalizeIdentifierToken(r.username)))
        .map((r: any) => r.id);

      if (matchingIds.length > 0) {
        const { error: delErr } = await supabase
          .from('sanctions')
          .delete()
          .in('id', matchingIds);

        if (delErr) {
          throw new Error(delErr.message || 'Error al levantar sanción en Supabase.');
        }
      }

      await appendUserNotificationInSupabase(
        cleanInput,
        'Tu sanción ha sido levantada por un Administrador.',
        matchedUser?.id
      );
    }

    try {
      await fetch(`/api/admin/sanctions/${encodeURIComponent(cleanInput)}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
    } catch {}

    invalidateApiCaches();
  },

  async getBannedUsers(): Promise<string[]> {
    const activeSanctions = await this.getSanctions().catch(() => []);
    return Array.from(
      new Set(
        activeSanctions
          .filter(s => isSanctionCurrentlyActive(s))
          .map(s => normalizeIdentifierToken(s.username))
          .filter(Boolean)
      )
    );
  },

  async banUserGlobal(identifier: string): Promise<void> {
    await this.addSanction({
      username: identifier,
      reason: 'Comportamientos ilegales',
      comment: 'Veto preventivo aplicado por la administración.',
      type: 'permanente'
    });
  },

  async unbanUserGlobal(identifier: string): Promise<void> {
    await this.removeSanction(identifier);
  },

  async getSimulatedEmails(): Promise<SimulatedEmail[]> {
    try {
      const res = await fetch('/api/simulated-emails', { headers: getHeaders() });
      const parsed = await safeParseJson<SimulatedEmail[]>(res);
      return parsed.ok && parsed.isJson && Array.isArray(parsed.data) ? parsed.data : [];
    } catch {
      return [];
    }
  },

  async getCancelledGroupNotices(userOverride?: User | null, forceRefresh = false): Promise<CancelledGroupNotice[]> {
    const uid = userOverride?.id || getStoredUserId();
    if (uid && supabase) {
      try {
        const notifs = await this.fetchUserNotificationsOnce(String(uid), forceRefresh);
        return extractCancelledGroupNoticesFromNotifications(notifs);
      } catch (err) {
        console.warn('Error leyendo notificaciones de grupos cancelados en Supabase:', err);
      }
    }
    try {
      const res = await fetch('/api/cancelled-group-notices', { headers: getHeaders() });
      const parsed = await safeParseJson<CancelledGroupNotice[]>(res);
      return parsed.ok && parsed.isJson && Array.isArray(parsed.data) ? parsed.data : [];
    } catch {
      return [];
    }
  },

  async dismissCancelledGroupNotice(id: string, userIdOverride?: string): Promise<void> {
    const uid = userIdOverride || getStoredUserId();
    if (uid && supabase) {
      const uidStr = String(uid);
      const prevWrite = markReadWriteInFlight.get(uidStr);
      const writeTask = (async () => {
        if (prevWrite) {
          await prevWrite.catch(() => {});
        }
        try {
          const baseNotifs = cachedNotificationsByUser.has(uidStr)
            ? [...cachedNotificationsByUser.get(uidStr)!]
            : [...(await this.fetchUserNotificationsOnce(uidStr, true))];
          const nextNotifs = removeCancelledGroupNoticeFromNotifications(baseNotifs, id);
          cachedNotificationsByUser.set(uidStr, nextNotifs);
          const { error } = await supabase
            .from('users')
            .update({ notifications: nextNotifs })
            .eq('id', uidStr);
          if (error) {
            console.warn('Error cerrando notificación de grupo cancelado en Supabase:', error.message);
          }
        } catch (err) {
          console.warn('Error cerrando notificación de grupo cancelado en Supabase:', err);
        }
      })().finally(() => {
        if (markReadWriteInFlight.get(uidStr) === writeTask) {
          markReadWriteInFlight.delete(uidStr);
        }
      });
      markReadWriteInFlight.set(uidStr, writeTask);
      await writeTask;
    }

    try {
      await fetch(`/api/cancelled-group-notices/${encodeURIComponent(id)}/dismiss`, {
        method: 'POST',
        headers: getHeaders()
      });
    } catch (_) {}
  },

  async fetchUserNotificationsOnce(userId: string, forceRefresh = false): Promise<any[]> {
    if (!userId) return [];
    if (!forceRefresh && cachedNotificationsByUser.has(userId)) {
      return cachedNotificationsByUser.get(userId)!;
    }
    const existing = notificationsReadInFlight.get(userId);
    if (existing) {
      return existing;
    }

    const req = (async () => {
      try {
        const { data: userRow } = await supabase
          .from('users')
          .select('notifications')
          .eq('id', userId)
          .maybeSingle();

        const notifs = userRow && Array.isArray(userRow.notifications) ? userRow.notifications : [];
        cachedNotificationsByUser.set(userId, notifs);
        return notifs;
      } catch (err) {
        console.warn('Error leyendo notifications de Supabase:', err);
        return cachedNotificationsByUser.get(userId) || [];
      } finally {
        notificationsReadInFlight.delete(userId);
      }
    })();

    notificationsReadInFlight.set(userId, req);
    return req;
  },

  async getChatReadStatus(userId?: string): Promise<Record<string, number>> {
    const reads: Record<string, number> = {};
    const storageKey = `club65_chat_reads_${userId || 'anon'}`;
    try {
      const local = localStorage.getItem(storageKey);
      if (local) {
        Object.assign(reads, JSON.parse(local));
      }
    } catch (_) {}

    if (userId) {
      const notifs = await this.fetchUserNotificationsOnce(userId);
      for (const n of notifs) {
        if (n && n.type === 'chat_read' && n.chatId && n.readAt) {
          const cId = String(n.chatId);
          const rAt = Number(n.readAt) || 0;
          reads[cId] = Math.max(reads[cId] || 0, rAt);
          const sBig = String(chatIdentifierToBigInt(cId));
          reads[sBig] = Math.max(reads[sBig] || 0, rAt);
        }
      }
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(reads));
    } catch (_) {}

    return reads;
  },

  async markChatAsReadInSupabase(
    chatIdOrIds: string | number | Array<string | number>,
    userId?: string,
    currentNotifs?: any[]
  ): Promise<Record<string, number>> {
    const now = Date.now();
    const rawIds = Array.isArray(chatIdOrIds) ? chatIdOrIds : [chatIdOrIds];
    const targetIds = Array.from(new Set(rawIds.filter(Boolean).map(id => String(id))));
    const storageKey = `club65_chat_reads_${userId || 'anon'}`;
    const reads: Record<string, number> = {};

    try {
      const local = localStorage.getItem(storageKey);
      if (local) Object.assign(reads, JSON.parse(local));
    } catch (_) {}

    const idPairs = targetIds.map(cIdStr => ({
      cIdStr,
      sBig: String(chatIdentifierToBigInt(cIdStr))
    }));

    for (const { cIdStr, sBig } of idPairs) {
      reads[cIdStr] = now;
      reads[sBig] = now;
    }

    try {
      localStorage.setItem(storageKey, JSON.stringify(reads));
    } catch (_) {}

    if (!userId || targetIds.length === 0) {
      return reads;
    }

    // Si ya hay una actualización en vuelo para este usuario, esperar antes de consolidar
    const prevWrite = markReadWriteInFlight.get(userId);
    const writeTask = (async () => {
      if (prevWrite) {
        await prevWrite.catch(() => {});
      }

      try {
        let baseNotifs: any[] = [];
        if (cachedNotificationsByUser.has(userId)) {
          baseNotifs = [...cachedNotificationsByUser.get(userId)!];
        } else if (Array.isArray(currentNotifs) && currentNotifs.length > 0) {
          baseNotifs = [...currentNotifs];
          cachedNotificationsByUser.set(userId, baseNotifs);
        } else {
          baseNotifs = [...(await this.fetchUserNotificationsOnce(userId))];
        }

        const allTargetMatchTokens = new Set<string>();
        for (const { cIdStr, sBig } of idPairs) {
          allTargetMatchTokens.add(cIdStr);
          allTargetMatchTokens.add(sBig);
        }

        const filtered = baseNotifs.filter(
          (n: any) => !(n && n.type === 'chat_read' && allTargetMatchTokens.has(String(n.chatId)))
        );

        for (const { cIdStr } of idPairs) {
          filtered.push({
            id: `cr_${cIdStr}`,
            type: 'chat_read',
            chatId: cIdStr,
            readAt: now
          });
        }

        cachedNotificationsByUser.set(userId, filtered);

        await supabase
          .from('users')
          .update({ notifications: filtered })
          .eq('id', userId);
      } catch (e) {
        console.warn('Error actualizando chat_read en Supabase:', e);
      }

      return reads;
    })().finally(() => {
      if (markReadWriteInFlight.get(userId) === writeTask) {
        markReadWriteInFlight.delete(userId);
      }
    });

    markReadWriteInFlight.set(userId, writeTask);
    return writeTask;
  },

  async markChatAsClearedInSupabase(chatId: string | number, userId: string, activityId?: string | number): Promise<void> {
    if (!userId || !supabase) return;
    const now = Date.now();
    const cIdStr = String(chatId);
    const sBig = String(chatIdentifierToBigInt(chatId));
    const actStr = activityId ? String(activityId) : '';

    try {
      const baseNotifs = [...(await this.fetchUserNotificationsOnce(userId))];
      // Conservar chat_removed_notice para no re-agregar automáticamente al usuario a un grupo de actividad que abandonó
      const filtered = baseNotifs.filter((n: any) =>
        !(n && n.type === 'chat_cleared' && (String(n.chatId) === cIdStr || String(n.chatId) === sBig || (actStr && String(n.chatId) === actStr)))
      );
      filtered.push({
        id: `clear_${cIdStr}_${now}`,
        type: 'chat_cleared',
        chatId: cIdStr,
        clearedAt: now
      });
      if (actStr) {
        filtered.push({
          id: `clear_act_${actStr}_${now}`,
          type: 'chat_cleared',
          chatId: actStr,
          clearedAt: now
        });
      }

      cachedNotificationsByUser.set(userId, filtered);

      await supabase
        .from('users')
        .update({ notifications: filtered })
        .eq('id', userId);
    } catch (err) {
      console.warn('Error al guardar chat_cleared en users.notifications:', err);
    }
  },

  async getUserActivityAlertsState(userId?: string): Promise<{
    seenSuspendedIds: number[];
    seenAgendaCancelledIds: number[];
    dismissedAgendaCancelledIds: number[];
    seenRejectedProposalIds: number[];
    dismissedRejectedProposalIds: number[];
  }> {
    const seenSuspended = new Set<number>();
    const seenAgenda = new Set<number>();
    const dismissedAgenda = new Set<number>();
    const seenRejected = new Set<number>();
    const dismissedRejected = new Set<number>();

    const uidKey = userId || 'anon';
    try {
      const rawSusp = localStorage.getItem(`club65_seen_suspended_${uidKey}`);
      if (rawSusp) {
        for (const id of JSON.parse(rawSusp)) {
          if (!isNaN(Number(id))) seenSuspended.add(Number(id));
        }
      }
    } catch (_) {}

    try {
      const rawAgenda = localStorage.getItem(`club65_seen_agenda_cancelled_${uidKey}`);
      if (rawAgenda) {
        for (const id of JSON.parse(rawAgenda)) {
          if (!isNaN(Number(id))) seenAgenda.add(Number(id));
        }
      }
    } catch (_) {}

    try {
      const rawDismissed = localStorage.getItem(`club65_dismissed_cancelled_agenda_${uidKey}`)
        || localStorage.getItem('club65_dismissed_cancelled_agenda');
      if (rawDismissed) {
        for (const id of JSON.parse(rawDismissed)) {
          if (!isNaN(Number(id))) dismissedAgenda.add(Number(id));
        }
      }
    } catch (_) {}

    try {
      const rawSeenRej = localStorage.getItem(`club65_seen_rejected_proposal_${uidKey}`);
      if (rawSeenRej) {
        for (const id of JSON.parse(rawSeenRej)) {
          if (!isNaN(Number(id))) seenRejected.add(Number(id));
        }
      }
    } catch (_) {}

    try {
      const rawDismissedRej = localStorage.getItem(`club65_dismissed_rejected_proposal_${uidKey}`);
      if (rawDismissedRej) {
        for (const id of JSON.parse(rawDismissedRej)) {
          if (!isNaN(Number(id))) dismissedRejected.add(Number(id));
        }
      }
    } catch (_) {}

    if (userId && supabase) {
      try {
        const notifs = await this.fetchUserNotificationsOnce(userId);
        for (const n of notifs) {
          if (!n || n.activityId === undefined || n.activityId === null) continue;
          const numId = Number(n.activityId);
          if (isNaN(numId)) continue;
          if (n.type === 'seen_suspended_act') seenSuspended.add(numId);
          if (n.type === 'seen_agenda_cancelled') seenAgenda.add(numId);
          if (n.type === 'dismissed_agenda_cancelled') dismissedAgenda.add(numId);
          if (n.type === 'seen_rejected_proposal') seenRejected.add(numId);
          if (n.type === 'dismissed_rejected_proposal') dismissedRejected.add(numId);
        }
      } catch (err) {
        console.warn('Error leyendo estados de alertas de actividades:', err);
      }
    }

    const res = {
      seenSuspendedIds: Array.from(seenSuspended),
      seenAgendaCancelledIds: Array.from(seenAgenda),
      dismissedAgendaCancelledIds: Array.from(dismissedAgenda),
      seenRejectedProposalIds: Array.from(seenRejected),
      dismissedRejectedProposalIds: Array.from(dismissedRejected)
    };

    try {
      localStorage.setItem(`club65_seen_suspended_${uidKey}`, JSON.stringify(res.seenSuspendedIds));
      localStorage.setItem(`club65_seen_agenda_cancelled_${uidKey}`, JSON.stringify(res.seenAgendaCancelledIds));
      localStorage.setItem(`club65_dismissed_cancelled_agenda_${uidKey}`, JSON.stringify(res.dismissedAgendaCancelledIds));
      localStorage.setItem(`club65_seen_rejected_proposal_${uidKey}`, JSON.stringify(res.seenRejectedProposalIds));
      localStorage.setItem(`club65_dismissed_rejected_proposal_${uidKey}`, JSON.stringify(res.dismissedRejectedProposalIds));
    } catch (_) {}

    return res;
  },

  async markUserActivityAlertInSupabase(
    userId: string | undefined,
    markerType:
      | 'seen_suspended_act'
      | 'seen_agenda_cancelled'
      | 'dismissed_agenda_cancelled'
      | 'seen_rejected_proposal'
      | 'dismissed_rejected_proposal',
    activityIds: Array<number | string>
  ): Promise<number[]> {
    const cleanIds = Array.from(
      new Set(
        (activityIds || [])
          .map(id => Number(id))
          .filter(id => !isNaN(id) && id > 0)
      )
    );

    const uidKey = userId || 'anon';
    const storageKey = markerType === 'seen_suspended_act'
      ? `club65_seen_suspended_${uidKey}`
      : markerType === 'seen_agenda_cancelled'
        ? `club65_seen_agenda_cancelled_${uidKey}`
        : markerType === 'dismissed_agenda_cancelled'
          ? `club65_dismissed_cancelled_agenda_${uidKey}`
          : markerType === 'seen_rejected_proposal'
            ? `club65_seen_rejected_proposal_${uidKey}`
            : `club65_dismissed_rejected_proposal_${uidKey}`;

    const localSet = new Set<number>(cleanIds);
    try {
      const existingRaw = localStorage.getItem(storageKey);
      if (existingRaw) {
        for (const id of JSON.parse(existingRaw)) {
          if (!isNaN(Number(id))) localSet.add(Number(id));
        }
      }
      localStorage.setItem(storageKey, JSON.stringify(Array.from(localSet)));
    } catch (_) {}

    if (!userId || cleanIds.length === 0 || !supabase) {
      return Array.from(localSet);
    }

    const prevWrite = markReadWriteInFlight.get(userId);
    const writeTask = (async () => {
      if (prevWrite) {
        await prevWrite.catch(() => {});
      }

      try {
        let baseNotifs: any[] = [];
        if (cachedNotificationsByUser.has(userId)) {
          baseNotifs = [...cachedNotificationsByUser.get(userId)!];
        } else {
          baseNotifs = [...(await this.fetchUserNotificationsOnce(userId))];
        }

        const now = Date.now();
        const existingIdSet = new Set(
          baseNotifs
            .filter(n => n && n.type === markerType && n.activityId !== undefined)
            .map(n => String(n.activityId))
        );

        let changed = false;
        const nextNotifs = [...baseNotifs];
        for (const actId of cleanIds) {
          if (!existingIdSet.has(String(actId))) {
            changed = true;
            nextNotifs.push({
              id: `${markerType}_${actId}`,
              type: markerType,
              activityId: actId,
              seenAt: now
            });
          }
        }

        if (changed) {
          cachedNotificationsByUser.set(userId, nextNotifs);
          await supabase
            .from('users')
            .update({ notifications: nextNotifs })
            .eq('id', userId);
        }
      } catch (err) {
        console.warn(`Error guardando ${markerType} en Supabase:`, err);
      }

      return Array.from(localSet);
    })().finally(() => {
      if (markReadWriteInFlight.get(userId) === writeTask) {
        markReadWriteInFlight.delete(userId);
      }
    });

    markReadWriteInFlight.set(userId, writeTask);
    return writeTask;
  }
};

