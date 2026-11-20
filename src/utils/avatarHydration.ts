import { sanitizeProfileAvatar } from './chatLogic';

export interface CollectAvatarIdsInput {
  activities?: any[];
  chats?: any[];
  contacts?: any[];
  reviews?: any[];
  allUsersMap?: Record<string, any>;
  currentUser?: any;
  attemptedIds?: Set<string>;
}

const IGNORED_PARTICIPANT_TOKENS = new Set([
  'system',
  'sistema',
  'sistema club65',
  'usuario',
  'vecino',
  'organizador',
  'institución',
  'institucion',
  'participante',
  'vos'
]);

function isIgnoredToken(raw: any): boolean {
  if (!raw) return true;
  const low = String(raw).trim().toLowerCase();
  if (!low) return true;
  return IGNORED_PARTICIPANT_TOKENS.has(low);
}

/**
 * Collects unique Supabase `users.id` values whose profile avatars are needed
 * for Cartelera, Mi Chat, Contactos, and Reviews, skipping users whose avatars
 * are already hydrated in `allUsersMap` or already attempted in `attemptedIds`.
 */
export function collectNeededAvatarUserIds({
  activities = [],
  chats = [],
  contacts = [],
  reviews = [],
  allUsersMap = {},
  currentUser = null,
  attemptedIds
}: CollectAvatarIdsInput): string[] {
  const tokenToUserId = new Map<string, string>();
  const usersWithAvatar = new Set<string>();

  const registerUser = (u: any) => {
    if (!u || typeof u !== 'object' || !u.id) return;
    const uid = String(u.id).trim();
    if (!uid) return;

    const existingAvatar = sanitizeProfileAvatar(
      u.avatar || u.foto || u.image || u.photo_url || u.avatar_url
    );
    if (existingAvatar) {
      usersWithAvatar.add(uid);
      usersWithAvatar.add(uid.toLowerCase());
    }

    const tokens = [
      u.id,
      u.usuario,
      u.username,
      u.apodo,
      u.nombre,
      u.institucion
    ];
    for (const tok of tokens) {
      if (!tok) continue;
      const clean = String(tok).trim();
      const low = clean.toLowerCase();
      if (!clean || isIgnoredToken(clean)) continue;
      if (!tokenToUserId.has(clean)) tokenToUserId.set(clean, uid);
      if (!tokenToUserId.has(low)) tokenToUserId.set(low, uid);
    }
  };

  for (const key of Object.keys(allUsersMap || {})) {
    registerUser(allUsersMap[key]);
  }
  if (currentUser) {
    registerUser(currentUser);
  }

  const neededIds = new Set<string>();

  const addDirectUserId = (rawId: any) => {
    if (!rawId) return;
    const clean = String(rawId).trim();
    if (!clean || isIgnoredToken(clean)) return;
    // Resolve canonical ID if known in map, otherwise keep direct ID if it looks like a user ID
    const canonical = tokenToUserId.get(clean) || tokenToUserId.get(clean.toLowerCase()) || clean;
    if (usersWithAvatar.has(canonical) || usersWithAvatar.has(canonical.toLowerCase())) return;
    if (attemptedIds && (attemptedIds.has(canonical) || attemptedIds.has(canonical.toLowerCase()))) return;
    neededIds.add(canonical);
  };

  const addResolvedFromToken = (rawToken: any) => {
    if (!rawToken) return;
    const clean = String(rawToken).trim().replace(/^@/, '');
    if (!clean || isIgnoredToken(clean)) return;
    const canonical = tokenToUserId.get(clean) || tokenToUserId.get(clean.toLowerCase());
    if (!canonical) return;
    if (usersWithAvatar.has(canonical) || usersWithAvatar.has(canonical.toLowerCase())) return;
    if (attemptedIds && (attemptedIds.has(canonical) || attemptedIds.has(canonical.toLowerCase()))) return;
    neededIds.add(canonical);
  };

  // 1. Activities (Cartelera, Mi Agenda, Mis Actividades, Moderación)
  for (const act of activities || []) {
    if (!act || typeof act !== 'object') continue;
    [
      act.organizerId,
      act.organizer_id,
      act.creador_id,
      act.organizador_id,
      act.userId,
      act.createdById
    ].forEach(addDirectUserId);

    [act.organizer, act.organizerNombre, act.creador].forEach(addResolvedFromToken);
  }

  // 2. Chats (Mi Chat list, header, messages, participant modal)
  for (const chat of chats || []) {
    if (!chat || typeof chat !== 'object') continue;
    if (Array.isArray(chat.participantIds)) {
      chat.participantIds.forEach(addDirectUserId);
    }
    addDirectUserId(chat.creatorId);
    addDirectUserId(chat.creator_id);
    if (chat.organizerId && chat.organizerId !== 'personal' && chat.organizerId !== 'institucional') {
      addDirectUserId(chat.organizerId);
    }

    if (Array.isArray(chat.participants)) {
      for (const p of chat.participants) {
        if (p && typeof p === 'object') {
          addDirectUserId(p.userId || p.user_id || p.id);
          addResolvedFromToken(p.apodo || p.usuario || p.nombre || p.name);
        } else {
          addResolvedFromToken(p);
        }
      }
    }

    addResolvedFromToken(chat.title);
    addResolvedFromToken(chat.name);
    addResolvedFromToken(chat.destinatario);

    if (Array.isArray(chat.messages)) {
      for (const msg of chat.messages) {
        if (!msg || typeof msg !== 'object') continue;
        if (isIgnoredToken(msg.sender) || isIgnoredToken(msg.senderId || msg.sender_id)) continue;
        addDirectUserId(msg.senderId || msg.sender_id);
        addResolvedFromToken(msg.sender);
      }
    }
  }

  // 3. Contacts (Mis Contactos / chat lookup)
  for (const contact of contacts || []) {
    if (!contact || typeof contact !== 'object') continue;
    addResolvedFromToken(contact.id);
    addResolvedFromToken(contact.usuario);
    addResolvedFromToken(contact.apodo);
    addResolvedFromToken(contact.nombre);
  }

  // 4. Reviews
  for (const rev of reviews || []) {
    if (!rev || typeof rev !== 'object') continue;
    addDirectUserId(rev.autorId || rev.userId || rev.user_id);
    addResolvedFromToken(rev.autor || rev.apodo || rev.usuario);
  }

  // 5. Current user if missing avatar
  if (currentUser?.id && !sanitizeProfileAvatar(currentUser.avatar)) {
    addDirectUserId(currentUser.id);
  }

  return Array.from(neededIds);
}

/**
 * Immutably merges fetched `id -> avatarUrl` pairs into `allUsersMap`.
 * Returns the exact `prevMap` reference when no entries changed to prevent redundant re-renders.
 */
export function mergeAvatarsIntoUsersMap<T extends Record<string, any>>(
  prevMap: Record<string, T>,
  avatarsById: Record<string, string>
): Record<string, T> {
  if (!prevMap || !avatarsById) return prevMap;

  const normalizedAvatars = new Map<string, string>();
  for (const [rawId, rawUrl] of Object.entries(avatarsById)) {
    const cleanId = String(rawId || '').trim();
    const safeUrl = sanitizeProfileAvatar(rawUrl);
    if (cleanId && safeUrl) {
      normalizedAvatars.set(cleanId, safeUrl);
      normalizedAvatars.set(cleanId.toLowerCase(), safeUrl);
    }
  }

  if (normalizedAvatars.size === 0) return prevMap;

  let changed = false;
  const nextMap: Record<string, T> = { ...prevMap };

  for (const key of Object.keys(prevMap)) {
    const userObj = prevMap[key];
    if (!userObj || !userObj.id) continue;
    const uid = String(userObj.id).trim();
    const incomingAvatar = normalizedAvatars.get(uid) || normalizedAvatars.get(uid.toLowerCase());
    if (!incomingAvatar) continue;

    const currentAvatar = sanitizeProfileAvatar(userObj.avatar);
    if (currentAvatar !== incomingAvatar) {
      nextMap[key] = {
        ...userObj,
        avatar: incomingAvatar
      };
      changed = true;
    }
  }

  return changed ? nextMap : prevMap;
}
