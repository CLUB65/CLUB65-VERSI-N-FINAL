import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './src/server/db.ts';
import { hasFirstEncounterStarted, hasFirstEncounterEnded, isActivityPast, isTechnicalIdentifier, isDummyOrSystemParticipant, chatIdentifierToBigInt, deduplicateMessages, deduplicateChats, filterContactsForUser, isSelfUserOrContact, validateGroupCreation, isUserGroupModerator, isAdministratorUser, checkActivitiesCollision, isUserEnrolledInActivity, canUserCreateActivity, checkActivityNameCollision, isActivityApproved, sanitizeProfileAvatar, AUTO_EXPIRED_PROPOSAL_REASON, isPendingProposalExpired } from './src/utils/chatLogic.ts';
import { formatArgentinaDateTime, formatArgentinaDateOnly, formatArgentinaTimeOnly } from './src/utils/argentinaTime.ts';
import { getSupabaseHealth, syncSeedToSupabase, serverSupabase } from './src/server/supabaseSync.ts';
import { supabase } from './src/supabaseClient.ts';
import { normalizeActivityIdForChat, doesDbChatRowMatchActivity, isUuidString } from './src/utils/proposalLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.NODE_ENV === 'production' ? (process.env.PORT || 3000) : 3000);

// Increased limits to smoothly handle user photo & short video uploads (<=45s)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Helper to extract session username or token from header
function getAuthUser(req: express.Request) {
  const allUsers: any[] = (typeof db.getUsers === 'function') ? Object.values(db.getUsers()) : [];
  const headerVal = (req.headers['x-user-id'] || req.headers['authorization'] || req.headers['x-user-name']) as string;
  const rawRole = String(req.headers['x-user-role'] || req.headers['x-user-tipo'] || '').trim().toLowerCase();
  const effectiveRole = (rawRole === 'moderador' || rawRole === 'admin' || rawRole === 'administrador')
    ? 'moderador'
    : (rawRole === 'institucional' ? 'institucional' : (rawRole ? 'personal' : null));

  if (headerVal) {
    const cleanVal = headerVal.replace(/^Bearer\s+/i, '').trim();
    const cleanValLower = cleanVal.toLowerCase();

    // 1. Buscar coincidencia directa por ID
    let user: any = db.getUser(cleanVal);
    if (user) {
      if (effectiveRole && user.tipo !== effectiveRole) {
        user.tipo = effectiveRole;
      }
      return user;
    }

    // 2. Buscar por apodo, usuario, email o supabaseId
    user = allUsers.find((u: any) => {
      if (!u) return false;
      return (
        (u.id && String(u.id).toLowerCase() === cleanValLower) ||
        (u.supabaseId && String(u.supabaseId).toLowerCase() === cleanValLower) ||
        (u.usuario && u.usuario.toLowerCase() === cleanValLower) ||
        (u.apodo && u.apodo.toLowerCase() === cleanValLower) ||
        (u.email && u.email.toLowerCase() === cleanValLower) ||
        (u.nombre && u.nombre.toLowerCase() === cleanValLower)
      );
    });

    if (user) {
      if (effectiveRole && user.tipo !== effectiveRole) {
        user.tipo = effectiveRole;
      }
      return user;
    }
  }

  // 3. Fallback: priorizar coincidencia con cabeceras
  const userNameHeader = decodeURIComponent(String(req.headers['x-user-name'] || '')).toLowerCase().trim();
  if (userNameHeader) {
    const matched = allUsers.find((u: any) => 
      (u.usuario && u.usuario.toLowerCase() === userNameHeader) ||
      (u.apodo && u.apodo.toLowerCase() === userNameHeader) ||
      (u.nombre && u.nombre.toLowerCase() === userNameHeader)
    );
    if (matched) {
      if (effectiveRole && matched.tipo !== effectiveRole) {
        matched.tipo = effectiveRole;
      }
      return matched;
    }
  }

  // 4. Si el usuario está autenticado vía Supabase en el cliente (headers presentes), sintetizar y guardar en db
  const rawUserId = String(req.headers['x-user-id'] || '').trim();
  const rawUserName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();
  if (rawUserId || rawUserName) {
    const fallbackId = rawUserId || `u_${Date.now()}`;
    const fallbackName = rawUserName || rawUserId;
    const synthesized: any = {
      id: fallbackId,
      usuario: fallbackName,
      apodo: fallbackName,
      bio: effectiveRole === 'moderador' ? 'Administrador Oficial de CLUB65.' : '',
      textSize: 'normal',
      contrast: false,
      tipo: effectiveRole || 'personal',
      isVerified: effectiveRole === 'moderador',
      blockedUsers: [],
      notifications: [],
      createdAt: new Date().toISOString()
    };
    if (typeof (db as any).saveUser === 'function') {
      (db as any).saveUser(synthesized);
    }
    return synthesized;
  }

  return allUsers[0] || null;
}

// ================= AUTH ROUTES =================
app.post('/api/auth/login', (req, res) => {
  const { usuario, clave } = req.body;
  if (!usuario || !clave) {
    return res.status(400).json({ error: 'Usuario o correo electrónico y clave requeridos.' });
  }

  const user = db.findUserByCredentials(usuario, clave);
  if (!user) {
    return res.status(401).json({ error: 'Datos incorrectos. Por favor verificá tu usuario o correo electrónico y contraseña.' });
  }

  if (db.isUserBanned(user.usuario) || db.isUserBanned(user.id)) {
    return res.status(403).json({ error: 'Este usuario ha sido suspendido de la plataforma.' });
  }

  const isInstUser = user.tipo === 'institucional' || (user as any).rol === 'institucional';
  if (isInstUser && (user as any).estadoAlta !== 'aprobada') {
    return res.status(403).json({ error: 'Tu cuenta institucional se encuentra pendiente de validación por el equipo de moderación.' });
  }

  const allUsers = Object.values(db.getUsers());
  const myIdentifiers = [user.id?.toLowerCase(), user.usuario?.toLowerCase(), user.apodo?.toLowerCase()].filter(Boolean) as string[];
  const whoBlockedMe = allUsers.filter(u => 
    u.blockedUsers && u.blockedUsers.some(b => b && myIdentifiers.includes(b.toLowerCase()))
  ).flatMap(u => [u.id, u.usuario, u.apodo].filter(Boolean) as string[]);

  const mutualBlocked = Array.from(new Set([
    ...(user.blockedUsers || []),
    ...whoBlockedMe
  ]));

  res.json({
    success: true,
    user: {
      ...user,
      blockedUsers: mutualBlocked,
      myBlockedUsers: user.blockedUsers || [],
      blockedByUsers: whoBlockedMe
    }
  });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: 'Debes ingresar un correo electrónico.' });
  }

  const result = db.createPasswordResetRequest(String(email).trim());
  if (!result) {
    return res.status(404).json({ error: 'No se encontró ninguna cuenta asociada a este correo electrónico.' });
  }

  res.json({
    success: true,
    message: `Hemos enviado un código de confirmación seguro a tu casilla ${result.request.email}.`,
    email: result.request.email,
    usuario: result.user.usuario,
    apodo: result.user.apodo,
    devCode: result.request.code
  });
});

app.post('/api/auth/verify-reset-code', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code || !String(code).trim()) {
    return res.status(400).json({ error: 'Correo electrónico y código de verificación requeridos.' });
  }

  const result = db.verifyPasswordResetCode(String(email).trim(), String(code).trim());
  if (!result.success) {
    return res.status(400).json({ error: result.error || 'Código incorrecto o expirado.' });
  }

  res.json({
    success: true,
    message: 'Código verificado con éxito. Ya podés crear tu nueva contraseña.',
    token: result.token,
    user: result.user
  });
});

app.post('/api/auth/resend-reset-code', (req, res) => {
  const { email } = req.body;
  if (!email || !String(email).trim()) {
    return res.status(400).json({ error: 'Debes ingresar un correo electrónico.' });
  }

  const result = db.createPasswordResetRequest(String(email).trim());
  if (!result) {
    return res.status(404).json({ error: 'No se encontró ninguna cuenta asociada a este correo electrónico.' });
  }

  res.json({
    success: true,
    message: `Hemos reenviado un nuevo código de confirmación a ${result.request.email}.`,
    email: result.request.email,
    devCode: result.request.code
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !newPassword || !String(newPassword).trim()) {
    return res.status(400).json({ error: 'Correo electrónico y nueva contraseña requeridos.' });
  }

  if (!token) {
    return res.status(401).json({ error: 'Operación no permitida: Se requiere confirmación previa desde el correo electrónico.' });
  }

  const result = db.completePasswordReset(String(email).trim(), String(token).trim(), String(newPassword).trim());
  if (!result.success || !result.user) {
    return res.status(400).json({ error: result.error || 'No se pudo restablecer la contraseña.' });
  }

  res.json({
    success: true,
    message: 'Contraseña restablecida exitosamente. Ya podés iniciar sesión.',
    user: {
      usuario: result.user.usuario,
      apodo: result.user.apodo
    }
  });
});

app.get('/api/users', (_req, res) => {
  res.json(db.getUsers());
});

app.post('/api/auth/register', (req, res) => {
  const {
    usuario,
    clave,
    apodo,
    tipo,
    localidad,
    cuit,
    entidadTipo,
    contactoInstitucional,
    direccionFisica,
    sitioWebRedSocial,
    presidenteFuncionario,
    managerNombre,
    managerRol,
    gestorNombre,
    gestorRol,
    documento_cuit_url,
    documentoCuitUrl,
    documento_personeria_url,
    documentoPersoneriaUrl,
    constanciaCuitUrl,
    constanciaCuitNombre,
    personeriaDocUrl,
    personeriaDocNombre,
    email
  } = req.body;

  if (!usuario || !clave || !apodo) {
    return res.status(400).json({ error: 'Faltan campos requeridos.' });
  }

  if (db.isUserBanned(usuario)) {
    return res.status(403).json({ error: 'No se puede registrar este usuario.' });
  }

  const existing = db.findUserByUsername(usuario);
  if (existing) {
    return res.status(409).json({ error: 'El nombre de usuario ya está registrado.' });
  }

  const isInst = tipo === 'institucional';
  const defaultAvatar = undefined;
  const telContact = contactoInstitucional || '';
  const presLegal = presidenteFuncionario || apodo || '';
  const manNom = managerNombre || gestorNombre ? String(managerNombre || gestorNombre).trim() : '';
  const manRol = managerRol || gestorRol ? String(managerRol || gestorRol).trim() : '';
  const cuitDoc = documento_cuit_url || documentoCuitUrl || constanciaCuitUrl || '';
  const persDoc = documento_personeria_url || documentoPersoneriaUrl || personeriaDocUrl || '';

  const newUser = db.createUser({
    usuario,
    clave,
    apodo,
    email: email || '',
    avatar: defaultAvatar,
    bio: req.body.bio ? String(req.body.bio).trim() : '',
    textSize: 'normal',
    contrast: false,
    tipo: isInst ? 'institucional' : 'personal',
    rol: isInst ? 'institucional' : 'personal',
    entidadTipo: entidadTipo || undefined,
    localidad: localidad ? String(localidad).trim() : '',
    cuit: cuit ? String(cuit).trim() : '',
    direccionFisica: direccionFisica ? String(direccionFisica).trim() : '',
    sitioWebRedSocial: sitioWebRedSocial ? String(sitioWebRedSocial).trim() : '',
    presidenteFuncionario: presLegal,
    managerNombre: manNom,
    managerRol: manRol,
    gestorNombre: manNom,
    gestorRol: manRol,
    documento_cuit_url: cuitDoc,
    documentoCuitUrl: cuitDoc,
    documento_personeria_url: persDoc,
    documentoPersoneriaUrl: persDoc,
    constanciaCuitUrl: cuitDoc,
    constanciaCuitNombre: constanciaCuitNombre || '',
    personeriaDocUrl: persDoc,
    personeriaDocNombre: personeriaDocNombre || '',
    documentoLegal: personeriaDocNombre || constanciaCuitNombre || 'Documento_Legal.pdf',
    documentoDescargaUrl: persDoc || cuitDoc || '',
    isVerified: false,
    estadoAlta: isInst ? 'pendiente' : 'aprobada',
    estado_alta: isInst ? 'pendiente' : 'aprobada',
    legalRepresentative: presLegal,
    responsableLegal: presLegal,
    contacto_institucional: telContact,
    contactoInstitucional: telContact,
  });

  if (isInst) {
    const instEmail = email || `${usuario.toLowerCase()}@institucion.club65.ar`;
    db.addSimulatedEmail({
      to: instEmail,
      subject: 'CLUB65 - Solicitud de Alta Institucional Recibida (Procedimiento y Plazos)',
      body: `Estimados representantes de "${apodo}":\n\nHemos recibido correctamente su registro institucional en CLUB65.\n\nDatos de Validación Declarados:\n- Tipo de entidad: ${entidadTipo || 'S/D'}\n- CUIT / Personería: ${cuit || 'S/D'}\n- Dirección física: ${direccionFisica || 'S/D'} (${localidad || ''})\n- Teléfono oficial: ${telContact || 'S/D'}\n- Presidente / Funcionario a cargo: ${presLegal || 'S/D'}\n- Manager de la cuenta: ${manNom ? `${manNom}` : 'Mismo titular'}\n- Cargo/rol del manager de la cuenta en la entidad: ${manRol || (manNom ? 'No especificado' : 'Presidente / Titular')}\n\nProcedimiento de Validación Oficial:\n1. Revisión de Documentación: El Administrador Oficial revisará la documentación legal adjunta y CUIT (${cuit || 'S/D'}) en un plazo de 24 a 48 hs hábiles.\n2. Verificación Telefónica: Se podrá coordinar una llamada de verificación al teléfono informado (${telContact || 'S/D'}).\n3. Estado de la cuenta: Las cuentas institucionales permanecen en estado pendiente y no pueden publicar actividades hasta ser validadas en el Panel de Administración.\n\nAtentamente,\nEquipo de Administración y Seguridad de CLUB65`
    });
  }

  res.status(201).json({
    success: true,
    user: newUser,
    isPendingValidation: isInst,
    message: isInst
      ? 'La cuenta ha sido registrada y se encuentra a la espera de ser dada de alta por el Administrador Oficial. Se envió un correo electrónico con los detalles del procedimiento.'
      : undefined
  });
});

app.get('/api/users/profile/:username', (req, res) => {
  const profile = db.getPublicUser(req.params.username);
  if (!profile) return res.status(404).json({ error: 'Usuario no encontrado.' });
  res.json(profile);
});

app.get('/api/auth/me', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'No autenticado.' });
  }

  const allUsers = Object.values(db.getUsers());
  const myIdentifiers = [user.id?.toLowerCase(), user.usuario?.toLowerCase(), user.apodo?.toLowerCase()].filter(Boolean) as string[];
  const whoBlockedMe = allUsers.filter(u => 
    u.blockedUsers && u.blockedUsers.some(b => b && myIdentifiers.includes(b.toLowerCase()))
  ).flatMap(u => [u.id, u.usuario, u.apodo].filter(Boolean) as string[]);

  const mutualBlocked = Array.from(new Set([
    ...(user.blockedUsers || []),
    ...whoBlockedMe
  ]));

  res.json({
      user: {
        ...user,
        contactoEmergencia: user.contactoEmergencia || (user as any).contacto_emergencia || '',
        blockedUsers: mutualBlocked,
        myBlockedUsers: user.blockedUsers || [],
        blockedByUsers: whoBlockedMe
      }
    });
});

app.put('/api/auth/profile', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'No autenticado.' });
  }

  const { apodo, bio, avatar, textSize, contrast, previousApodo, previousUsuario, userId, contactoEmergencia } = req.body;
  
  // Incluimos tokens previos y tokens actuales para no perder el rastro
  const oldTokens = [
    user.id,
    user.supabaseId,
    user.usuario,
    user.apodo,
    user.nombre,
    userId,
    previousApodo,
    previousUsuario
  ]
    .filter(Boolean)
    .map((s: any) => String(s).toLowerCase().trim());
const updated = db.updateUser(user.id, {
  ...(apodo ? { apodo } : {}),
  ...(bio !== undefined ? { bio } : {}),
  ...(avatar ? { avatar } : {}),
  ...(textSize ? { textSize } : {}),
  ...(contrast !== undefined ? { contrast } : {}),
  ...(contactoEmergencia !== undefined ? { contactoEmergencia } : {}),
});

  const newNick = (apodo || user.apodo || user.usuario || '').trim();

  // 1. Sincronizar inscripciones en actividades
  try {
    const allActivities = typeof db.getActivities === 'function' ? Object.values(db.getActivities()) : [];
    allActivities.forEach((act: any) => {
      if (act && Array.isArray(act.enrolledUsernames)) {
        let enrolledChanged = false;
        const nextEnrolled = act.enrolledUsernames.map((u: string) => {
          const cleanU = String(u || '').toLowerCase().trim();
          if (oldTokens.includes(cleanU) || cleanU === String(user.id).toLowerCase()) {
            enrolledChanged = true;
            return newNick;
          }
          return u;
        });

         if (enrolledChanged) {
      act.enrolledUsernames = Array.from(new Set(nextEnrolled));
      if (typeof (db as any).saveActivity === 'function') {
        (db as any).saveActivity(act);
      }
    }
        }
      });
    } catch (e) {
      console.error('Error sincronizando actividades tras cambio de perfil:', e);
    }

    // 2. Sincronizar participantes en chats existentes
  try {
    const allChats = typeof db.getChats === 'function' ? Object.values(db.getChats()) : [];
    allChats.forEach((chat: any) => {
      if (chat && Array.isArray(chat.participants)) {
        let chatChanged = false;
        const nextParticipants = chat.participants.map((p: string) => {
          const cleanP = String(p || '').toLowerCase().trim();
          if (oldTokens.includes(cleanP) || cleanP === String(user.id).toLowerCase()) {
            chatChanged = true;
            return newNick;
          }
          return p;
        });

        if (chatChanged) {
          chat.participants = Array.from(new Set(nextParticipants));
          if (typeof (db as any).saveChat === 'function') {
            (db as any).saveChat(chat);
          }
        }
      }
    });
  } catch (e) {
    console.error('Error sincronizando chats tras cambio de perfil:', e);
  }

  res.json({
    success: true,
    user: {
      ...updated,
      contactoEmergencia: updated?.contactoEmergencia || contactoEmergencia || ''
    }
  });
});

// ================= BLOCK / UNBLOCK ROUTES =================
app.post('/api/users/block', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado.' });
  const { targetUsername, targetId } = req.body;
  if (!targetUsername && !targetId) return res.status(400).json({ error: 'Usuario a bloquear requerido.' });

  const identifier = targetUsername || targetId;
  db.blockUser(user.id, identifier);
  if (targetId && targetId !== identifier) {
    db.blockUser(user.id, targetId);
  }

  if (serverSupabase) {
    try {
      const tokensToAdd = new Set<string>();
      if (identifier) {
        tokensToAdd.add(String(identifier));
        tokensToAdd.add(String(identifier).toLowerCase());
      }
      if (targetId) {
        tokensToAdd.add(String(targetId));
        tokensToAdd.add(String(targetId).toLowerCase());
      }

      // Lookup target user in Supabase to add all aliases
      const { data: matched } = await serverSupabase
        .from('users')
        .select('id, usuario, apodo, nombre')
        .or(`id.eq.${targetId || identifier},usuario.ilike.${identifier},apodo.ilike.${identifier}`)
        .limit(3);

      if (Array.isArray(matched)) {
        for (const m of matched) {
          if (m.id) { tokensToAdd.add(String(m.id)); tokensToAdd.add(String(m.id).toLowerCase()); }
          if (m.usuario) { tokensToAdd.add(String(m.usuario)); tokensToAdd.add(String(m.usuario).toLowerCase()); }
          if (m.apodo) { tokensToAdd.add(String(m.apodo)); tokensToAdd.add(String(m.apodo).toLowerCase()); }
          if (m.nombre) { tokensToAdd.add(String(m.nombre)); tokensToAdd.add(String(m.nombre).toLowerCase()); }
        }
      }

      const { data: userRow } = await serverSupabase
        .from('users')
        .select('id, blocked_users')
        .eq('id', user.id)
        .maybeSingle();

      if (userRow) {
        const curList = Array.isArray(userRow.blocked_users) ? userRow.blocked_users : [];
        const nextList = Array.from(new Set([...curList, ...Array.from(tokensToAdd)]));
        await serverSupabase.from('users').update({ blocked_users: nextList }).eq('id', userRow.id);
      }
    } catch (e) {
      console.warn('Error sincronizando bloqueo en Supabase:', e);
    }
  }

  res.json({ success: true, message: `Usuario ${identifier} bloqueado.` });
});

app.post('/api/users/unblock', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado.' });
  const { targetUsername, targetId } = req.body;
  if (!targetUsername && !targetId) return res.status(400).json({ error: 'Usuario a desbloquear requerido.' });

  const identifier = targetUsername || targetId;
  db.unblockUser(user.id, identifier);
  if (targetId && targetId !== identifier) {
    db.unblockUser(user.id, targetId);
  }

  if (serverSupabase) {
    try {
      const tokensToRemove = new Set<string>();
      if (identifier) tokensToRemove.add(String(identifier).toLowerCase());
      if (targetId) tokensToRemove.add(String(targetId).toLowerCase());

      const { data: matched } = await serverSupabase
        .from('users')
        .select('id, usuario, apodo, nombre')
        .or(`id.eq.${targetId || identifier},usuario.ilike.${identifier},apodo.ilike.${identifier}`)
        .limit(3);

      if (Array.isArray(matched)) {
        for (const m of matched) {
          if (m.id) tokensToRemove.add(String(m.id).toLowerCase());
          if (m.usuario) tokensToRemove.add(String(m.usuario).toLowerCase());
          if (m.apodo) tokensToRemove.add(String(m.apodo).toLowerCase());
          if (m.nombre) tokensToRemove.add(String(m.nombre).toLowerCase());
        }
      }

      const { data: userRow } = await serverSupabase
        .from('users')
        .select('id, blocked_users')
        .eq('id', user.id)
        .maybeSingle();

      if (userRow) {
        const curList = Array.isArray(userRow.blocked_users) ? userRow.blocked_users : [];
        const nextList = curList.filter((b: any) => !tokensToRemove.has(String(b).toLowerCase().trim()));
        await serverSupabase.from('users').update({ blocked_users: nextList }).eq('id', userRow.id);
      }
    } catch (e) {
      console.warn('Error sincronizando desbloqueo en Supabase:', e);
    }
  }

  res.json({ success: true, message: `Usuario ${identifier} desbloqueado.` });
});

app.get('/api/users', (_req, res) => {
  const users = typeof db.getUsers === 'function' ? Object.values(db.getUsers()) : [];
  res.json(users);
});

// ================= ACTIVITIES ROUTES =================
app.get('/api/activities', (_req, res) => {
  const activities = db.getActivities();
  const nowStr = formatArgentinaDateTime();
  const nowTs = Date.now();
  const updatedList = activities.map((act: any) => {
    if (!isPendingProposalExpired(act)) return act;
    const patched = db.updateActivity(act.id, {
      isApproved: false,
      proposalStatus: 'rechazada',
      estado: 'rechazada',
      rejectionReason: AUTO_EXPIRED_PROPOSAL_REASON,
      feedback: AUTO_EXPIRED_PROPOSAL_REASON,
      proposalNote: AUTO_EXPIRED_PROPOSAL_REASON,
      rejectedAt: nowStr,
      rejectedTimestamp: nowTs
    });
    return patched || {
      ...act,
      isApproved: false,
      proposalStatus: 'rechazada',
      estado: 'rechazada',
      rejectionReason: AUTO_EXPIRED_PROPOSAL_REASON,
      feedback: AUTO_EXPIRED_PROPOSAL_REASON,
      proposalNote: AUTO_EXPIRED_PROPOSAL_REASON,
      rejectedAt: nowStr,
      rejectedTimestamp: nowTs
    };
  });
  res.json(updatedList);
});

app.post('/api/activities', (req, res) => {
  const user = getAuthUser(req);
  const {
    title,
    category,
    schedule,
    location,
    lat,
    lng,
    capacity,
    description,
    shortDescription,
    avance,
    image,
    foto,
    videoUrl,
    video_url,
    isInstitutional,
    isRecurrent,
    cerrarInscripcionAlIniciarPrimerEncuentro,
    firstEncounterDate,
    firstEncounterStartTime,
    firstEncounterEndTime
  } = req.body;

  if (!title || !location) {
    return res.status(400).json({ error: 'Título y ubicación requeridos.' });
  }

  // Validación de nombre duplicado: mientras esté una actividad publicada en cartelera, ninguna otra puede llamarse igual
  const existingActivitiesList = typeof db.getActivities === 'function' ? db.getActivities() : [];
  const nameCollisionCheck = checkActivityNameCollision(title, null, existingActivitiesList);
  if (nameCollisionCheck.hasCollision) {
    return res.status(409).json({ error: nameCollisionCheck.reason });
  }

  // Prevenir que el usuario cree una actividad en un horario en el que ya está inscripto o que ya organice
  if (user) {
    const existingActivities = existingActivitiesList;
    const candidateActivity = {
      title,
      schedule,
      startDate: req.body.startDate || req.body.fechaIni,
      endDate: req.body.endDate || req.body.fechaFin,
      startTime: req.body.startTime || req.body.horaIni || firstEncounterStartTime,
      endTime: req.body.endTime || req.body.horaFin || firstEncounterEndTime,
      firstEncounterDate,
      firstEncounterStartTime,
      firstEncounterEndTime,
      isRecurrent: Boolean(isRecurrent),
      diasSemana: req.body.diasSemana,
      cantidadEventos: req.body.cantidadEventos
    };
    const collisionCheck = canUserCreateActivity(candidateActivity, user, existingActivities);
    if (!collisionCheck.allowed) {
      return res.status(409).json({ error: collisionCheck.reason || 'Superposición de horario con una actividad a la que ya estás inscripto/a.' });
    }
  }

  // Institutional profiles or explicitly institutional activities are automatically approved!
  const isInst = (user?.tipo === 'institucional') || (user?.rol === 'institucional') || Boolean(isInstitutional) || Boolean(req.body.isInstitutional) || Boolean(req.body.is_institutional);
  const isApproved = isInst || (user?.tipo === 'moderador') || (user?.rol === 'moderador');

  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();
  const headerId = String(req.headers['x-user-id'] || '').trim();

  const organizer = (
    (user && (user.apodo || user.nombre || user.usuario || (user as any).institucion)) ||
    req.body.organizer ||
    req.body.organizerName ||
    headerName ||
    headerId ||
    'Organizador'
  );
  const organizerId = user ? user.id : (req.body.organizerId || headerId || (isInst ? 'institucional' : 'personal'));
  const organizerBio = user ? user.bio : '';

  const newActivity = db.createActivity({
    title,
    category: category || 'salud',
    schedule: schedule || 'A coordinar',
    location,
    lat: typeof lat === 'number' && !isNaN(lat) ? lat : -34.6068,
    lng: typeof lng === 'number' && !isNaN(lng) ? lng : -58.5647,
    organizer,
    organizerBio,
    organizerId,
    isInstitutional: isInst,
    isRecurrent: Boolean(isRecurrent),
    cerrarInscripcionAlIniciarPrimerEncuentro: Boolean(isRecurrent) && Boolean(cerrarInscripcionAlIniciarPrimerEncuentro),
    firstEncounterDate: Boolean(isRecurrent) ? (firstEncounterDate || undefined) : undefined,
    firstEncounterStartTime: Boolean(isRecurrent) ? (firstEncounterStartTime || undefined) : undefined,
    firstEncounterEndTime: Boolean(isRecurrent) ? (firstEncounterEndTime || undefined) : undefined,
    enrolled: false,
    capacity: capacity || 20,
    enrolledCount: 0,
    shortDescription: shortDescription || avance || '',
    description: description || '',
    image: (image && image.trim()) || (foto && foto.trim()) || undefined,
    videoUrl: (videoUrl && String(videoUrl).trim()) || (video_url && String(video_url).trim()) || undefined,
    isApproved,
    proposalStatus: isApproved ? 'aprobada' : 'pendiente',
    vettedUsers: [],
    enrolledUsernames: []
  });

  // If auto-approved, initialize chat in local db and Supabase
  if (isApproved) {
    const creatorUser = (user?.usuario || user?.nombre || user?.apodo || organizer || 'Organizador').trim();
    const creatorId = String(user?.id || organizerId || 'admin').trim();
    const cleanTitle = newActivity.title.replace(/^grupo:\s*/i, '').trim();
    const groupTitle = cleanTitle;

    db.createChat({
      id: newActivity.id,
      title: groupTitle,
      name: groupTitle,
      subtitle: `Encuentro coordinado por ${organizer}`,
      type: 'grupal',
      activityId: newActivity.id,
      avatar: newActivity.image || undefined,
      image: newActivity.image || undefined,
      organizerId: creatorId,
      creatorId: creatorId,
      creatorName: creatorUser,
      adminUsernames: Array.from(new Set([creatorUser, creatorId, organizer].filter(Boolean))),
      participants: Array.from(new Set([creatorUser, organizer].filter(Boolean))),
      messages: []
    });

    if (serverSupabase) {
      (async () => {
        try {
          const isUUID = (str: any) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim());
          let query = serverSupabase.from('chats').select('id, nombre');
          if (isUUID(String(newActivity.id))) {
            query = query.eq('actividad_id', String(newActivity.id));
          } else {
            query = query.or(`nombre.eq."${cleanTitle}",nombre.eq."Grupo: ${cleanTitle}"`);
          }
          const { data: foundList } = await query.order('creado_el', { ascending: true });
          const existingChat = Array.isArray(foundList) && foundList.length > 0 ? foundList[0] : null;

          let targetChatId = existingChat?.id;
          if (!existingChat) {
            const chatPayload: any = {
              nombre: groupTitle,
              tipo: 'grupo_actividad',
              foto_grupo_url: newActivity.image || null,
              creador_id: creatorId
            };
            if (isUUID(String(newActivity.id))) {
              chatPayload.actividad_id = String(newActivity.id);
            }
            const { data: newChat } = await serverSupabase.from('chats').insert(chatPayload).select('id').single();
            targetChatId = newChat?.id;
          }

          if (targetChatId && creatorId) {
            const { data: hasPart } = await serverSupabase
              .from('chat_participants')
              .select('id')
              .eq('chat_id', targetChatId)
              .eq('user_id', creatorId)
              .limit(1);

            if (!hasPart || hasPart.length === 0) {
              await serverSupabase.from('chat_participants').insert({
                chat_id: targetChatId,
                user_id: creatorId,
                joined_at: new Date().toISOString()
              });
            }
          }
        } catch (sbErr) {
          console.warn('Error sincronizando chat de actividad aprobada en Supabase desde backend:', sbErr);
        }
      })();
    }
  }

  res.status(201).json(newActivity);
});

app.post('/api/activities/:id/enroll', async (req, res) => {
  const rawId = req.params.id;
  const numId = Number(rawId);
  const targetId = !isNaN(numId) ? numId : rawId;
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado.' });

  let act = db.getActivityById(targetId);
  if (!act) {
    const allActs = db.getActivities ? db.getActivities() : [];
    act = allActs.find((a: any) => String(a.id) === String(rawId));
  }
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada.' });
  if (isActivityPast(act)) {
    return res.status(400).json({ error: 'Esta actividad ya ha finalizado.' });
  }
  const isRecurrentAct = Boolean(act.isRecurrent || (act as any).es_recurrente);
  const shouldCloseAct = Boolean(act.cerrarInscripcionAlIniciarPrimerEncuentro || (act as any).cerrar_inscripcion_al_iniciar_primer_encuentro);
  if (isRecurrentAct && shouldCloseAct && (hasFirstEncounterStarted(act) || hasFirstEncounterEnded(act))) {
    return res.status(400).json({ error: 'Las inscripciones están cerradas porque el primer encuentro ya se realizó.' });
  }

  const userTokens = [user.usuario.toLowerCase(), (user.apodo || '').toLowerCase(), (user.id || '').toLowerCase()];
  if (act.vettedUsers?.some(u => userTokens.includes(u.toLowerCase()))) {
    return res.status(403).json({ error: 'No podés inscribirte porque fuiste vetado de esta actividad.' });
  }

  // Verificar colisión horaria con otras actividades en las que el usuario ya esté inscripto
  const allActs = db.getActivities ? db.getActivities() : [];
  const userEnrolled = allActs.filter((a: any) =>
    String(a.id) !== String(targetId) && isUserEnrolledInActivity(a, user)
  );
  for (const enr of userEnrolled) {
    const col = checkActivitiesCollision(act, enr);
    if (col.hasCollision) {
      return res.status(400).json({ error: col.reason || `Coincide en horario con "${enr.title}". No es posible inscribirse a dos actividades en el mismo momento.` });
    }
  }

  // Check if organizer has blocked this user
  if (db.isUserBlocked(act.organizer, user.apodo) || db.isUserBlocked(act.organizerId, user.id)) {
    return res.status(403).json({ error: 'Inscripción no disponible.' });
  }

  // 1. Inscripción usando un único identificador consistente
    const canonicalUser = user.usuario || user.apodo || user.nombre || 'Participante';
    const updated = db.enrollActivity(act.id, canonicalUser);

    // 2. Chat de la actividad
    const allChatsObj = db.getChats ? db.getChats() : {};
    const allChatList = Object.values(allChatsObj) as any[];

    let chat = allChatList.find(c =>
      (c && c.activityId && (String(c.activityId) === String(act.id) || Number(c.activityId) === Number(act.id))) ||
      (c && c.id && (String(c.id) === String(act.id) || Number(c.id) === Number(act.id))) ||
      (c && c.title && act.title && c.title.trim().toLowerCase() === act.title.trim().toLowerCase())
    ) || (db.getChat ? (db.getChat(`activity_${act.id}`) || db.getChat(act.id)) : null);

    if (!chat) {
      chat = db.createChat({
        id: act.id,
        title: act.title || 'Actividad',
        name: act.title || 'Actividad',
        subtitle: `Canal vecinal de ${act.title || 'la actividad'}`,
        type: 'grupal',
        activityId: act.id,
        organizerId: act.organizerId || 'organizador',
        creatorId: act.organizerId || 'organizador',
        creatorName: act.organizer || 'Organizador',
        adminUsernames: [act.organizer, act.organizerId].filter(Boolean),
        allowedRoles: ['personal', 'institucional'],
        participants: Array.from(new Set([act.organizer, canonicalUser].filter(Boolean))),
        messages: [
          {
            id: `m_init_${Date.now()}`,
            senderId: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: 'S',
            role: 'institucional',
            text: `Bienvenidos al canal de ${act.title}.`,
            time: 'Ahora'
          },
          {
            id: `m_join_${Date.now()}`,
            senderId: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: 'S',
            role: 'sistema',
            text: `¡${canonicalUser} se unió a la actividad!`,
            time: 'Recién'
          }
        ]
      });
    } else {
      if (!Array.isArray(chat.participants)) {
        chat.participants = [];
      }
      const canLow = canonicalUser.toLowerCase().trim();
      const yaEsta = chat.participants.some((p: any) => String(p).toLowerCase().trim() === canLow);
      if (!yaEsta) {
        chat.participants.push(canonicalUser);
        if (db.addChatMessage) {
          db.addChatMessage(chat.id, {
            senderId: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: 'S',
            role: 'sistema',
            text: `¡${canonicalUser} se unió a la actividad!`,
            time: 'Recién'
          });
        }
      }
      if (db.saveChat) {
        db.saveChat(chat);
      }
    }

    // 3. Sincronización real con Supabase
    try {
      if (supabase) {
        const actTitle = String(act.title || (act as any).titulo || 'Actividad').replace(/^grupo:\s*/i, '').trim();
        const actIdForChat = normalizeActivityIdForChat(act.id);

        const { data: allActChats } = await supabase
          .from('chats')
          .select('id, nombre, actividad_id')
          .eq('tipo', 'grupo_actividad')
          .order('creado_el', { ascending: true });

        const existingChat = (Array.isArray(allActChats) ? allActChats : []).find((c: any) =>
          doesDbChatRowMatchActivity(c, act.id, actTitle)
        );

        if (!existingChat) {
          const chatPayload: any = {
            nombre: actTitle,
            tipo: 'grupo_actividad'
          };
          if (actIdForChat !== null) {
            chatPayload.actividad_id = actIdForChat;
          }
          if (user?.id && isUuidString(String(user.id))) {
            chatPayload.creador_id = user.id;
          }

          const { error: insErr } = await supabase.from('chats').insert(chatPayload);
          if (insErr) {
            console.error('Error insertando chat de actividad en Supabase:', insErr.message);
          }
        }
      }
    } catch (err) {
      console.error('Error sincronizando chat en Supabase:', err);
    }

    res.json({ success: true, activity: updated });
});

app.post('/api/activities/:id/unenroll', (req, res) => {
  const rawId = req.params.id;
  const numId = Number(rawId);
  const targetId = !isNaN(numId) ? numId : rawId;
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado.' });

  const updated = db.unenrollActivity(targetId, user.usuario, user.apodo);

  // Quitar al usuario de los participantes del chat oficial de esta actividad
  const allChatsObj = db.getChats ? db.getChats() : {};
  const allChatList = Object.values(allChatsObj) as any[];
  const chat = allChatList.find(c => 
    c && c.activityId && (String(c.activityId) === String(targetId) || Number(c.activityId) === Number(targetId))
  ) || (db.getChat ? (db.getChat(`activity_${targetId}`) || db.getChat(targetId)) : null);

  if (chat && Array.isArray(chat.participants)) {
    const userTokensToRemove = [
      user.usuario,
      user.apodo,
      user.nombre,
      user.id
    ].filter(Boolean).map(t => String(t).toLowerCase().trim());

    chat.participants = chat.participants.filter(
      (p: any) => !userTokensToRemove.includes(String(p).toLowerCase().trim())
    );

    if (db.saveChat) {
      db.saveChat(chat);
    }
  }

  res.json({ success: true, activity: updated });
});

app.post('/api/activities/:id/resubmit', (req, res) => {
  const rawId = req.params.id;
  const numId = Number(rawId);
  const id = !isNaN(numId) && String(numId) === String(rawId) ? numId : rawId;
  const user = getAuthUser(req);
    // Permitir reenvío si hay sesión o si la petición proviene de un usuario local/personal

  const { title, schedule, location, lat, lng, capacity, description, shortDescription, image, videoUrl, video_url, userFeedbackNote, isRecurrent } = req.body;
  if (title) {
    const existingActivitiesList = typeof db.getActivities === 'function' ? db.getActivities() : [];
    const nameCollisionCheck = checkActivityNameCollision(title, id, existingActivitiesList);
    if (nameCollisionCheck.hasCollision) {
      return res.status(409).json({ error: nameCollisionCheck.reason });
    }
  }
  const incomingVideoUrl = videoUrl !== undefined ? videoUrl : video_url;
  const updated = db.resubmitActivityProposal(id, {
    ...(title ? { title } : {}),
    ...(schedule ? { schedule } : {}),
    ...(location ? { location } : {}),
    ...(typeof lat === 'number' && !isNaN(lat) ? { lat } : {}),
    ...(typeof lng === 'number' && !isNaN(lng) ? { lng } : {}),
    ...(capacity !== undefined ? { capacity } : {}),
    ...(description ? { description } : {}),
    ...(shortDescription ? { shortDescription } : {}),
    ...(image ? { image } : {}),
    ...(incomingVideoUrl !== undefined ? { videoUrl: String(incomingVideoUrl || '').trim() } : {}),
    ...(userFeedbackNote ? { userFeedbackNote } : {}),
    ...(isRecurrent !== undefined ? { isRecurrent: Boolean(isRecurrent) } : {})
  });

  if (!updated) return res.status(404).json({ error: 'Actividad no encontrada.' });
  res.json({ success: true, activity: updated });
});

app.post('/api/activities/:id/veto', (req, res) => {
  const id = Number(req.params.id);
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Usuario a vetar requerido.' });

  const updated = db.vetoUserFromActivity(id, username);
  res.json({ success: true, activity: updated });
});

app.post('/api/activities/:id/moderate', (req, res) => {
  const user = getAuthUser(req);
  const id = Number(req.params.id);
  const { action, note } = req.body; // 'approve', 'reject', 'request_changes'

  if (action === 'approve') {
    const nowStr = formatArgentinaDateTime();
    const act = db.updateActivity(id, {
      isApproved: true,
      proposalStatus: 'aprobada',
      proposalNote: note,
      approvedAt: nowStr,
      approvedTimestamp: Date.now()
    });
    if (act) {
      const createdChat = db.createChat({
        title: act.title,
        subtitle: `Canal vecinal de ${act.title}`,
        type: 'grupal',
        activityId: act.id,
        organizerId: act.organizerId,
        adminUsernames: [act.organizer],
        allowedRoles: ['personal', 'institucional'],
        participants: [act.organizer],
        messages: [
          {
            id: `msg_app_${Date.now()}`,
            senderId: 'sistema',
            sender: 'Administración CLUB65',
            avatar: '🛡️',
            role: 'institucional',
            text: `¡La iniciativa "${act.title}" ha sido aprobada y publicada en la Cartelera!`,
            time: 'Ahora'
          }
        ]
      });
      db.addNotification(act.organizer, `¡Tu actividad "${act.title}" fue aprobada y publicada en la Cartelera!`);

      // Sincronizar persistentemente en Supabase
      if (serverSupabase) {
        (async () => {
          try {
            const actTitle = String(act.title || (act as any).titulo || 'Actividad').replace(/^grupo:\s*/i, '').trim();
            const actIdForChat = normalizeActivityIdForChat(id);

            const { data: allActChats } = await serverSupabase
              .from('chats')
              .select('id, nombre, actividad_id')
              .eq('tipo', 'grupo_actividad')
              .order('creado_el', { ascending: true });

            const existingChat = (Array.isArray(allActChats) ? allActChats : []).find((c: any) =>
              doesDbChatRowMatchActivity(c, id, actTitle)
            );

            let sChatId: number | null = null;
            if (!existingChat) {
              const chatPayload: any = {
                nombre: actTitle,
                tipo: 'grupo_actividad',
                foto_grupo_url: act.image || null
              };
              if (actIdForChat !== null) {
                chatPayload.actividad_id = actIdForChat;
              }
              if (act.organizerId && isUuidString(String(act.organizerId))) {
                chatPayload.creador_id = String(act.organizerId);
              }
              const { data: newRow } = await serverSupabase.from('chats').insert(chatPayload).select('id').maybeSingle();
              if (newRow) sChatId = chatIdentifierToBigInt(newRow.id);
            } else {
              sChatId = chatIdentifierToBigInt(existingChat.id);
            }
            if (sChatId) {
              await serverSupabase.from('messages').insert({
                chat_id: sChatId,
                sender: 'Administración CLUB65',
                sender_id: 'sistema',
                role: 'institucional',
                text: `¡La iniciativa "${act.title}" ha sido aprobada y publicada en la Cartelera!`,
                avatar: '🛡️',
                created_at: new Date().toISOString()
              });
            }
          } catch (sbErr) {
            console.warn('Error sincronizando chat aprobado en Supabase:', sbErr);
          }
        })();
      }
    }
    return res.json({ success: true, activity: act });
  } else if (action === 'request_changes') {
    const act = db.getActivityById(id);
    if (!act) return res.status(404).json({ error: 'Actividad no encontrada.' });
    if (!note || !String(note).trim()) {
      return res.status(400).json({ error: 'Debes indicar los cambios que se solicitan al organizador.' });
    }
    const adminUser = user?.usuario || user?.apodo || 'administrador';
    const nowStr = formatArgentinaDateTime();
    const noteText = String(note).trim();

    if (act.versions && act.versions.length > 0) {
      const lastVer = act.versions[act.versions.length - 1];
      lastVer.moderationNote = noteText;
      lastVer.moderationDate = nowStr;
      lastVer.moderationAdmin = adminUser;
    }

    const updated = db.updateActivity(id, {
      isApproved: false,
      proposalStatus: 'cambios_solicitados',
      proposalNote: noteText,
      changesRequestedAt: nowStr,
      changesRequestedTimestamp: Date.now(),
      changesRequestedByAdmin: adminUser,
      changesSubmittedAt: undefined,
      versions: act.versions
    });

    db.addNotification(act.organizer, `El moderador (@${adminUser}) solicitó cambios en "${act.title}": ${noteText}`);
    return res.json({ success: true, activity: updated || act });
  } else {
    const nowStr = formatArgentinaDateTime();
    const rejectNote = (note && String(note).trim()) ? String(note).trim() : '';
    const act = db.updateActivity(id, {
      isApproved: false,
      proposalStatus: 'rechazada',
      estado: 'rechazada',
      rejectionReason: rejectNote,
      feedback: rejectNote,
      proposalNote: rejectNote,
      rejectedAt: nowStr,
      rejectedTimestamp: Date.now()
    });
    if (act) {
      db.addNotification(act.organizer, `Tu propuesta "${act.title}" fue rechazada.`);
    }
    return res.json({ success: true, activity: act });
  }
});

app.get('/api/admin/bajas', (_req, res) => {
  res.json(db.getBajas());
});

app.post('/api/activities/:id/force-cancel', (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body;
  const user = getAuthUser(req);

  if (user && user.tipo !== 'moderador') {
    return res.status(403).json({ error: 'Solo administradores pueden forzar la baja de actividades.' });
  }

  const cleanReason = (reason && String(reason).trim()) ? String(reason).trim() : '-';
  const act = db.forceCancelActivity(id, cleanReason, user?.apodo || user?.usuario || 'administrador');
  if (!act) return res.status(404).json({ error: 'Actividad no encontrada.' });
  res.json({ success: true, activity: act });
});

app.delete('/api/activities/:id', (req, res) => {
  const id = Number(req.params.id);
  const deleted = db.deleteActivity(id);
  res.json({ success: deleted });
});

// ================= CHAT ROUTES =================
app.get('/api/chats', (req, res) => {
// 1. Obtener usuario por sesión o por cabeceras de la petición
  let user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();

  if (!user && headerId) {
    user = { id: headerId, nombre: headerName, usuario: headerName };
  }

  // 1.b. Asegurar que todas las actividades activas tengan su chat grupal oficial
  try {
    const activities = typeof db.getActivities === 'function' ? db.getActivities() : [];
    const currentChats = db.getChats ? db.getChats() : {};
    const chatList = Object.values(currentChats) as any[];

    for (const act of activities) {
      if (!act || !act.title) continue;
      // STRICT RULE: Only officially approved activities get a group chat automatically!
      if (!isActivityApproved(act)) continue;

      const actId = act.id;
      const cleanTitle = act.title.replace(/^grupo:\s*/i, '').trim().toLowerCase();
      const groupTitle = act.title.replace(/^grupo:\s*/i, '').trim();
      const exists = chatList.some(c => {
        if (!c) return false;
        if (c.activityId && (String(c.activityId) === String(actId) || Number(c.activityId) === Number(actId))) return true;
        if (c.id && (String(c.id) === String(actId) || Number(c.id) === Number(actId))) return true;
        const cClean = String(c.title || c.name || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();
        return cClean && cClean === cleanTitle;
      });

      if (!exists && db.createChat) {
        db.createChat({
          id: actId,
          title: groupTitle,
          name: groupTitle,
          subtitle: `Canal vecinal de ${act.title}`,
          type: 'grupal',
          activityId: actId,
          avatar: act.image || act.foto || undefined,
          image: act.image || act.foto || undefined,
          organizerId: act.organizerId || 'organizador',
          creatorId: act.organizerId || 'organizador',
          creatorName: act.organizer || '',
          adminUsernames: [act.organizer].filter(Boolean),
          allowedRoles: ['personal', 'institucional'],
          participants: Array.from(new Set([act.organizer, ...(act.enrolledUsernames || [])].filter((p: any) => Boolean(p) && !['sistema club65', 'sistema', 'organizador', 'admin'].includes(String(p).toLowerCase().trim())))),
          messages: [
            {
              id: `m_init_${Date.now()}_${actId}`,
              senderId: 'sistema',
              sender: 'Sistema CLUB65',
              avatar: 'S',
              role: 'institucional',
              text: `Bienvenidos al canal de "${act.title}".`,
              time: 'Inicio'
            }
          ]
        });
      }
    }
  } catch (syncErr) {
    console.warn('Error sincronizando chats de actividades en server:', syncErr);
  }

  const allChats = Object.values(db.getChats());

  // 2. Si no hay usuario identificado, NO devolvemos chats ajenos
  if (!user) {
    return res.json([]);
  }

  // 3. Tokens de identidad de este usuario
  const userTokens = [
    user.id,
    user.supabaseId,
    user.usuario,
    user.apodo,
    user.nombre,
    (user as any).institucion,
    headerId,
    headerName,
    ...(user.previousTokens || [])
  ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

  const filtered = allChats.filter(c => {
    if (!c) return false;

    // Si el usuario borró este chat puntualmente de su bandeja
    if (c.deletedForUserIds?.some((u: string) => u && userTokens.includes(String(u).toLowerCase().trim()))) {
      return false;
    }

    // Regla de actividades: Si el chat está asociado a una actividad (propuesta vecinal), SOLO mostrar si fue aprobada
    if (c.activityId) {
      const allActs = typeof db.getActivities === 'function' ? db.getActivities() : [];
      const relAct = allActs.find((a: any) => String(a.id) === String(c.activityId) || Number(a.id) === Number(c.activityId));
      if (relAct && !isActivityApproved(relAct)) {
        return false;
      }
    }

    // Participación directa en la conversación
    const allDirectParts = [
      ...(c.participants || []),
      ...(c.participantIds || []),
      ...(c.adminUsernames || []),
      c.senderId,
      c.recipientId,
      c.creatorId,
      c.creatorName,
      c.organizerId
    ].filter(Boolean).map((p: any) => String(p?.id || p?.usuario || p?.nombre || p).toLowerCase().trim());

    const isParticipant = allDirectParts.some(p => userTokens.includes(p));
    const isRemoved = c.removedParticipants?.some((p: string) => p && userTokens.includes(String(p).toLowerCase().trim()));
    
    // Chats privados directos
    if (c.type === 'privado') {
      return isParticipant;
    }

    // Chats grupales (con o sin actividad asociada)
    if (c.type === 'grupal' || c.activityId || !c.type) {
      return true;
    }

    return isParticipant;
  });

  return res.json(deduplicateChats(filtered));
});
        
app.get('/api/chats/:id/messages', (req, res) => {
  let chat = db.getChat(req.params.id);
  if (!chat) {
    const all = db.getChats();
    const foundKey = Object.keys(all).find(k => String(k) === String(req.params.id) || String(all[k].id) === String(req.params.id));
    if (foundKey) chat = all[foundKey];
  }
  if (!chat) return res.status(404).json({ error: 'Chat no encontrado.' });
  res.json(deduplicateMessages(chat.messages || []));
});

app.post('/api/chats/:id/messages', (req, res) => {
  let user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();

  if (!user && (headerId || headerName)) {
    user = { id: headerId, nombre: headerName, usuario: headerName, apodo: headerName } as any;
  }

  const { text, replyTo } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío.' });
  }

  let chat = db.getChat(req.params.id);
  if (!chat) {
    const all = db.getChats ? Object.values(db.getChats()) as any[] : [];
    chat = all.find(c => String(c.id) === String(req.params.id) || String(c.activityId) === String(req.params.id));
  }
  let sender = (user?.apodo || user?.nombre || user?.usuario || headerName || 'Usuario').trim();
  if (isTechnicalIdentifier(sender)) {
    const dbU: any = db.getUser ? db.getUser(sender) : null;
    if (dbU && (!isTechnicalIdentifier(dbU.apodo) || !isTechnicalIdentifier(dbU.usuario) || dbU.nombre)) {
      sender = dbU.apodo || dbU.usuario || dbU.nombre;
    } else if (headerName && !isTechnicalIdentifier(headerName)) {
      sender = headerName;
    } else {
      sender = 'Vecino';
    }
  }
  const senderId = user?.id || headerId || 'visitante';
  const role = user ? (user.tipo || 'personal') : 'personal';
  const avatar = user ? (user.avatar || user.foto || (user.tipo === 'institucional' ? '3F' : (user.apodo || user.usuario || 'U').substring(0, 2).toUpperCase())) : 'U';

  if (!chat) {
    const rawTitle = req.body.chatTitle || req.body.title;
    const rawType = req.body.chatType || req.body.type || (req.body.activityId ? 'grupal' : undefined);
    const actId = req.body.activityId;
    const isGrupal = rawType === 'grupal' || Boolean(actId);

    let resolvedTitle = rawTitle;
    if (!resolvedTitle) {
      if (actId) {
        resolvedTitle = 'Actividad Comunitaria';
      } else if (isGrupal) {
        resolvedTitle = 'Grupo Vecinal';
      } else {
        resolvedTitle = req.body.recipientName || 'Conversación Privada';
      }
    }

    const initialParts = Array.isArray(req.body.participants) && req.body.participants.length > 0
      ? req.body.participants
      : (isGrupal ? [sender] : [headerName, sender].filter(Boolean));

    chat = db.createChat({
      id: req.params.id,
      title: resolvedTitle,
      name: resolvedTitle,
      subtitle: isGrupal ? `Canal vecinal de ${resolvedTitle}` : 'Chat directo',
      type: isGrupal ? 'grupal' : 'privado',
      activityId: actId,
      messages: [],
      participants: initialParts
    } as any);
  } else {
    // Si el chat existía pero era de actividad o el cliente mandó metadata de grupo, asegurar tipo grupal y título
    if (req.body.chatType === 'grupal' || req.body.activityId || chat.activityId) {
      chat.type = 'grupal';
      if (req.body.chatTitle) {
        chat.title = req.body.chatTitle;
        chat.name = req.body.chatTitle;
      }
    }
  }

  // Asegurar que el remitente figure en los participantes activos del chat
  if (sender && chat && Array.isArray(chat.participants)) {
    const senderLow = sender.toLowerCase();
    if (!chat.participants.some((p: any) => String(p).toLowerCase().trim() === senderLow)) {
      chat.participants.push(sender);
    }
  }

  const userTokens = [user?.id, user?.usuario, user?.apodo, user?.nombre, headerId, headerName].filter(Boolean).map(t => String(t).toLowerCase().trim());
  const isOrganizer = Boolean(
    chat && (
      userTokens.includes(String(chat.creatorId || '').toLowerCase().trim()) ||
      userTokens.includes(String(chat.organizerId || '').toLowerCase().trim()) ||
      userTokens.includes(String(chat.creatorName || '').toLowerCase().trim())
    )
  );

  const now = new Date();
  const time = formatArgentinaTimeOnly(now);
  const nowIso = req.body.createdAt || now.toISOString();
  const nowMs = typeof req.body.timestamp === 'number' && req.body.timestamp > 0 ? req.body.timestamp : now.getTime();

  let parsedReply = replyTo;
  if (typeof parsedReply === 'string') {
    try { parsedReply = JSON.parse(parsedReply); } catch {}
  }
  const isRealReply = parsedReply && typeof parsedReply === 'object' && !parsedReply.is_group_init && Boolean(parsedReply.text || parsedReply.sender || parsedReply.id);
  const safeReplyTo = isRealReply ? {
    id: String(parsedReply.id || ''),
    sender: String(parsedReply.sender || ''),
    text: String(parsedReply.text || '')
  } : undefined;

  const newMsg = db.addChatMessage(chat.id, {
    id: req.body.id || `msg_${nowMs}_${Math.random().toString(36).substring(2, 7)}`,
    senderId,
    sender,
    avatar,
    role,
    text: text.trim(),
    time,
    createdAt: nowIso,
    timestamp: nowMs,
    isOrganizer,
    isVerifiedInst: user?.tipo === 'institucional',
    replyTo: safeReplyTo
  });

  if (!newMsg) return res.status(404).json({ error: 'Chat no encontrado.' });

  // Sincronizar participante en el chat si es un usuario real
  if (sender && sender.toLowerCase() !== 'sistema club65') {
    if (!Array.isArray(chat.participants)) chat.participants = [];
    const senderLow = sender.toLowerCase().trim();
    if (!chat.participants.some(p => String(p).toLowerCase().trim() === senderLow)) {
      chat.participants.push(sender);
    }
  }

  // Actualizar última actividad del chat en base de datos
  (chat as any).updatedAt = nowIso;
  (chat as any).updated_at = nowIso;
  chat.lastMessage = text.trim();
  chat.lastMessageTime = time;
  if (db.saveChat) db.saveChat(chat);

  // Sincronizar mensaje en tiempo real a Supabase tabla messages
  try {
    if (serverSupabase) {
      const sChatId = chatIdentifierToBigInt(chat.id);
      const payloadToSupabase: any = {
        id: newMsg.id,
        chat_id: sChatId,
        sender_id: senderId,
        sender: sender,
        avatar: avatar,
        role: role,
        text: text.trim(),
        time: time,
        created_at: nowIso,
        reply_to: newMsg.replyTo || null
      };
      Promise.resolve(serverSupabase.from('messages').insert(payloadToSupabase)).then((res: any) => {
        if (res && res.error) console.warn('Advertencia Supabase messages insert:', res.error.message);
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('Error sincronizando mensaje en Supabase desde server:', err);
  }

  res.status(201).json(newMsg);
});

// PIN / UNPIN A CHAT MESSAGE (ADMIN/MODERATOR ACTION)
app.post('/api/chats/:id/pin', async (req, res) => {
  let user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();
  const headerRole = String(req.headers['x-user-role'] || '').trim().toLowerCase();

  if (!user && (headerId || headerName)) {
    user = { id: headerId, nombre: headerName, usuario: headerName, apodo: headerName, tipo: headerRole || undefined } as any;
  }

  if (!user) {
    return res.status(401).json({ error: 'Debes iniciar sesión para fijar o desfijar mensajes.' });
  }

  const chatId = req.params.id;
  const { messageId } = req.body;
  const targetMsgId = messageId ? String(messageId) : null;
  const activeSupabase = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
  const sChatBigInt = chatIdentifierToBigInt(chatId);

  let chat = db.getChat(chatId);
  if (!chat) {
    const all = db.getChats ? Object.values(db.getChats()) as any[] : [];
    chat = all.find(c => String(c.id) === String(chatId) || String(c.activityId) === String(chatId));
  }

  let effectiveChat: any = chat;
  let actsList: any[] = db.getActivities ? db.getActivities() : [];

  if (!effectiveChat && activeSupabase) {
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(chatId));
      const [chatRes, msgsRes] = await Promise.all([
        isUuid
          ? activeSupabase.from('chats').select('id, nombre, tipo, creador_id, actividad_id').eq('id', chatId).maybeSingle()
          : Promise.resolve({ data: null }),
        activeSupabase.from('messages').select('id, text, reply_to, created_at').eq('chat_id', sChatBigInt).order('created_at', { ascending: true }).limit(300)
      ]);
      const row: any = chatRes?.data;
      if (row) {
        if (row.tipo === 'privado') {
          return res.status(403).json({ error: 'Solo se pueden fijar mensajes en chats grupales.' });
        }
        effectiveChat = {
          id: row.id,
          title: row.nombre,
          name: row.nombre,
          type: 'grupal',
          creatorId: row.creador_id,
          activityId: row.actividad_id,
          messages: Array.isArray(msgsRes?.data) ? msgsRes.data : []
        };
      }
      if (row?.actividad_id) {
        const { data: actRow } = await activeSupabase.from('activities').select('id, title, titulo, organizer, organizer_id, organizador_id, creador_id').eq('id', row.actividad_id).maybeSingle();
        if (actRow) {
          actsList = [actRow, ...actsList];
        }
      }
    } catch (lookupErr) {
      console.warn('Error consultando chat en Supabase durante pin:', lookupErr);
    }
  }

  if (effectiveChat && effectiveChat.type === 'privado') {
    return res.status(403).json({ error: 'Solo se pueden fijar mensajes en chats grupales.' });
  }

  const userTokens = [
    user?.id,
    user?.usuario,
    user?.apodo,
    user?.nombre,
    headerId,
    headerName
  ].filter(Boolean).map(t => String(t).toLowerCase().trim());

  let isActOrganizer = false;
  if (effectiveChat?.activityId) {
    const numActId = Number(effectiveChat.activityId);
    let act: any = (!isNaN(numActId) && db.getActivityById) ? db.getActivityById(numActId) : null;
    if (!act) {
      act = actsList.find(a => String(a.id) === String(effectiveChat.activityId));
    }
    if (act) {
      isActOrganizer = [act.organizerId, act.organizer_id, act.organizador_id, act.creador_id, act.organizer]
        .filter(Boolean)
        .some(t => userTokens.includes(String(t).toLowerCase().trim()));
    }
  }

  const isGlobalAdmin = ['moderador', 'admin', 'administrador'].includes(
    String(user?.tipo || (user as any)?.rol || headerRole || '').toLowerCase().trim()
  );

  const isModerator = Boolean(
    isGlobalAdmin ||
    isActOrganizer ||
    (effectiveChat && (
      userTokens.includes(String(effectiveChat.creatorId || '').toLowerCase().trim()) ||
      userTokens.includes(String(effectiveChat.organizerId || '').toLowerCase().trim()) ||
      userTokens.includes(String(effectiveChat.creatorName || '').toLowerCase().trim()) ||
      (effectiveChat.adminUsernames || []).some((adm: string) =>
        userTokens.includes(String(adm).toLowerCase().trim())
      ) ||
      isUserGroupModerator(effectiveChat, user, actsList)
    ))
  );

  if (!isModerator) {
    return res.status(403).json({ error: 'Solo los moderadores u organizadores del grupo pueden fijar mensajes.' });
  }

  // Sincronizar en Supabase (tabla messages, columna is_pinned)
  try {
    if (activeSupabase) {
      if (targetMsgId) {
        const { error: pinErr } = await activeSupabase
          .from('messages')
          .update({ is_pinned: true })
          .eq('id', targetMsgId)
          .neq('is_deleted', true);

        if (pinErr) {
          return res.status(500).json({ error: pinErr.message || 'Error fijando mensaje en Supabase.' });
        }

        await activeSupabase
          .from('messages')
          .update({ is_pinned: false })
          .eq('chat_id', sChatBigInt)
          .eq('is_pinned', true)
          .neq('id', targetMsgId);
      } else {
        const { error: unpinErr } = await activeSupabase
          .from('messages')
          .update({ is_pinned: false })
          .eq('chat_id', sChatBigInt)
          .eq('is_pinned', true);

        if (unpinErr) {
          return res.status(500).json({ error: unpinErr.message || 'Error desfijando mensaje en Supabase.' });
        }
      }
    }
  } catch (sbErr) {
    console.warn('Error sincronizando pin con Supabase desde backend:', sbErr);
  }

  if (chat) {
    chat.pinnedMessageId = targetMsgId || undefined;
    if (Array.isArray(chat.messages)) {
      chat.messages = chat.messages.map((m: any) => ({
        ...m,
        isPinned: targetMsgId ? String(m.id) === targetMsgId : false
      }));
    }
    if (typeof db.saveChat === 'function') {
      db.saveChat(chat);
    }
  }

  const updatedChat = chat ? (db.getChat(chat.id) || chat) : { id: chatId, pinnedMessageId: targetMsgId || undefined };
  return res.json({ success: true, chat: updatedChat });
});

// DELETE A CHAT MESSAGE (MODERATOR / ADMIN ACTION)
app.post('/api/chats/:id/messages/:msgId/delete', async (req, res) => {
  let user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();
  const headerRole = String(req.headers['x-user-role'] || '').toLowerCase().trim();

  if (!user && (headerId || headerName)) {
    user = {
      id: headerId,
      nombre: headerName,
      usuario: headerName,
      apodo: headerName,
      tipo: (headerRole === 'moderador' || headerRole === 'admin' || headerRole === 'administrador') ? 'moderador' : 'personal'
    } as any;
  }

  const chatId = req.params.id;
  const msgId = req.params.msgId;
  const isDeletedByAdminAction = Boolean(req.body?.deletedByAdmin);
  const defaultRemovalText = isDeletedByAdminAction
    ? 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65'
    : 'Este mensaje fue retirado por el moderador del grupo.';
  const removalText = String(req.body?.reasonText || defaultRemovalText).trim() || defaultRemovalText;
  const fallbackText = typeof req.body?.fallbackMessageText === 'string' ? req.body.fallbackMessageText.trim() : '';

  const supabaseUpdatePayload = {
    is_deleted: true,
    is_pinned: false,
    deleted_by_admin: isDeletedByAdminAction,
    deleted_by_group_moderator: !isDeletedByAdminAction,
    text: removalText
  };

  const syncRemovalInSupabase = async () => {
    try {
      const activeSupabase = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
      if (!activeSupabase) return;
      let matched = false;
      if (msgId && msgId !== '0' && msgId !== 'undefined' && msgId !== 'null') {
        const { data: updatedRows } = await activeSupabase
          .from('messages')
          .update(supabaseUpdatePayload)
          .eq('id', msgId)
          .select('id');
        if (Array.isArray(updatedRows) && updatedRows.length > 0) {
          matched = true;
        }
      }
      if (!matched && fallbackText && chatId) {
        const bigChatId = chatIdentifierToBigInt(chatId);
        await activeSupabase
          .from('messages')
          .update(supabaseUpdatePayload)
          .eq('chat_id', bigChatId)
          .eq('text', fallbackText);
      }
    } catch (e) {
      console.warn('Error sincronizando eliminación de mensaje con Supabase:', e);
    }
  };

  let chat = db.getChat(chatId);
  if (!chat) {
    const all = db.getChats ? Object.values(db.getChats()) as any[] : [];
    chat = all.find(c => String(c.id) === String(chatId) || String(c.activityId) === String(chatId));
  }

  if (!chat) {
    await syncRemovalInSupabase();
    return res.json({ success: true, message: 'Mensaje retirado.' });
  }

  const userTokens = [
    user?.id,
    user?.usuario,
    user?.apodo,
    user?.nombre,
    headerId,
    headerName
  ].filter(Boolean).map(t => String(t).toLowerCase().trim());

  let isActOrganizer = false;
  if (chat.activityId) {
    const numActId = Number(chat.activityId);
    let act = (!isNaN(numActId) && db.getActivityById) ? db.getActivityById(numActId) : null;
    if (!act && db.getActivities) {
      act = (db.getActivities() as any[]).find(a => String(a.id) === String(chat.activityId));
    }
    if (act) {
      isActOrganizer = userTokens.includes(String(act.organizerId || '').toLowerCase().trim()) ||
                       userTokens.includes(String(act.organizer || '').toLowerCase().trim());
    }
  }

  const isGlobalModeratorRole = Boolean(
    headerRole === 'moderador' ||
    headerRole === 'admin' ||
    headerRole === 'administrador' ||
    (user && (user.tipo === 'moderador' || (user as any).rol === 'moderador' || (user as any).tipo === 'admin' || (user as any).rol === 'admin'))
  );

  const isModerator = Boolean(
    isGlobalModeratorRole ||
    (user && (
      isActOrganizer ||
      userTokens.includes(String(chat.creatorId || '').toLowerCase().trim()) ||
      userTokens.includes(String(chat.organizerId || '').toLowerCase().trim()) ||
      userTokens.includes(String(chat.creatorName || '').toLowerCase().trim()) ||
      (chat.adminUsernames || []).some((adm: string) =>
        userTokens.includes(String(adm).toLowerCase().trim())
      )
    ))
  );

  if (!isModerator) {
    return res.status(403).json({ error: 'Solo los moderadores u organizadores del grupo pueden retirar mensajes.' });
  }

  if (String(chat.pinnedMessageId || '') === String(msgId)) {
    chat.pinnedMessageId = undefined;
  }
  if (Array.isArray(chat.messages)) {
    chat.messages = chat.messages.map((m: any) => {
      const matchesMsg =
        (msgId && msgId !== '0' && String(m.id) === String(msgId)) ||
        (!msgId && fallbackText && String(m.text || '').trim() === fallbackText);
      if (matchesMsg) {
        return {
          ...m,
          isDeleted: true,
          isPinned: false,
          retirado: true,
          deletedByAdmin: isDeletedByAdminAction,
          deletedByGroupModerator: !isDeletedByAdminAction,
          deletedBy: isDeletedByAdminAction
            ? 'Administración CLUB65'
            : (user?.apodo || user?.nombre || user?.usuario || headerName || 'Moderador'),
          text: removalText
        };
      }
      return m;
    });
  }

  if (typeof db.saveChat === 'function') {
    db.saveChat(chat);
  } else if (typeof (db as any).deleteChatMessage === 'function') {
    (db as any).deleteChatMessage(chat.id, msgId, isDeletedByAdminAction, removalText, !isDeletedByAdminAction);
  }

  await syncRemovalInSupabase();

  const updatedChat = db.getChat(chat.id) || chat;
  res.json({ success: true, chat: updatedChat });
});

app.delete('/api/chats/:id/messages/:msgId', async (req, res) => {
  const chatId = req.params.id;
  const msgId = req.params.msgId;
  const isDeletedByAdminAction = Boolean(req.body?.deletedByAdmin ?? req.query?.deletedByAdmin === 'true');
  const defaultRemovalText = isDeletedByAdminAction
    ? 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65'
    : 'Este mensaje fue retirado por el moderador del grupo.';
  const removalText = String(req.body?.reasonText || req.query?.reasonText || defaultRemovalText).trim() || defaultRemovalText;
  const fallbackText = typeof req.body?.fallbackMessageText === 'string' ? req.body.fallbackMessageText.trim() : '';
  const updatePayload = {
    is_deleted: true,
    is_pinned: false,
    deleted_by_admin: isDeletedByAdminAction,
    deleted_by_group_moderator: !isDeletedByAdminAction,
    text: removalText
  };
  try {
    const activeSupabase = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
    if (activeSupabase) {
      let matched = false;
      if (msgId && msgId !== '0' && msgId !== 'undefined' && msgId !== 'null') {
        const { data: updatedRows } = await activeSupabase
          .from('messages')
          .update(updatePayload)
          .eq('id', msgId)
          .select('id');
        if (Array.isArray(updatedRows) && updatedRows.length > 0) {
          matched = true;
        }
      }
      if (!matched && fallbackText && chatId) {
        const bigChatId = chatIdentifierToBigInt(chatId);
        await activeSupabase
          .from('messages')
          .update(updatePayload)
          .eq('chat_id', bigChatId)
          .eq('text', fallbackText);
      }
    }
  } catch (syncErr) {
    console.warn('Error sincronizando eliminación de mensaje con Supabase:', syncErr);
  }
  res.json({ success: true });
});

// CANCELLED GROUP NOTICES
app.get('/api/cancelled-group-notices', (req, res) => {
  const user = getAuthUser(req);
  const allNotices = db.getCancelledGroupNotices();
  if (!user) return res.json([]);
  const userTokens = [user.usuario?.toLowerCase(), user.apodo?.toLowerCase(), user.id?.toLowerCase()].filter(Boolean) as string[];
  const myNotices = allNotices.filter(n =>
    n.participants && n.participants.some(p => p && userTokens.includes(p.toLowerCase()))
  );
  res.json(myNotices);
});

app.post('/api/cancelled-group-notices/:id/dismiss', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'No autenticado.' });
  const ok = db.dismissCancelledGroupNotice(req.params.id, [user.usuario, user.apodo, user.id]);
  res.json({ success: ok });
});

// Helper para recuperar de forma duradera el creador, moderadores y participantes reales desde mensajes de Supabase
async function enrichChatFromSupabaseMessages(chat: any, chatId: string | number) {
  if (!serverSupabase || !chat) return;
  try {
    const sChatIdBig = chatIdentifierToBigInt(chat ? chat.id : chatId);
    const { data: rawDbMsgs } = await serverSupabase
      .from('messages')
      .select('id, chat_id, sender_id, sender, avatar, role, text, time, reply_to, is_pinned, is_deleted, deleted_by_admin, deleted_by_group_moderator, created_at')
      .eq('chat_id', sChatIdBig)
      .order('created_at', { ascending: false })
      .limit(40);

    const dbMsgs = Array.isArray(rawDbMsgs) ? [...rawDbMsgs].reverse() : [];

    if (Array.isArray(dbMsgs) && dbMsgs.length > 0) {
      if (!Array.isArray(chat.participants)) chat.participants = [];
      if (!Array.isArray(chat.adminUsernames)) chat.adminUsernames = [];
      if (!Array.isArray(chat.removedParticipants)) chat.removedParticipants = [];
      if (!Array.isArray(chat.leftVoluntarilyParticipants)) chat.leftVoluntarilyParticipants = [];

      // Sort messages chronologically
      const sortedDbMsgs = [...dbMsgs].sort((a: any, b: any) => {
        const timeA = new Date(a.created_at || a.createdAt || 0).getTime();
        const timeB = new Date(b.created_at || b.createdAt || 0).getTime();
        return timeA - timeB;
      });

      for (const rawM of sortedDbMsgs) {
        const m: any = rawM;
        let rt = m.reply_to || m.replyTo;
        if (typeof rt === 'string') {
          try { rt = JSON.parse(rt); } catch {}
        }
        if (rt && typeof rt === 'object') {
          if (rt.creatorId && !chat.creatorId) chat.creatorId = String(rt.creatorId);
          if (rt.creatorName && !chat.creatorName) chat.creatorName = String(rt.creatorName);
          if (Array.isArray(rt.adminUsernames)) {
            chat.adminUsernames = Array.from(new Set([...chat.adminUsernames, ...rt.adminUsernames]));
          }
          if (Array.isArray(rt.participants)) {
            chat.participants = Array.from(new Set([...chat.participants, ...rt.participants]));
          }
          if (rt.action === 'make_admin' && (rt.participant || rt.participantId)) {
            const p = String(rt.participant || rt.participantId).trim();
            if (p) chat.adminUsernames = Array.from(new Set([...chat.adminUsernames, p]));
          }
          if (rt.event === 'participant_added' && (rt.participant || rt.participantId || rt.participantTokens)) {
            const p = String(rt.participant || rt.participantId).trim();
            const candTokens = [
              p,
              rt.participantId,
              ...(Array.isArray(rt.participantTokens) ? rt.participantTokens : [])
            ].filter(Boolean).map((t: any) => String(t).trim().toLowerCase());

            // Clear from removedParticipants, leftVoluntarilyParticipants, and vetoedParticipants
            chat.removedParticipants = (chat.removedParticipants || []).filter(
              (x: string) => !candTokens.includes(String(x).toLowerCase().trim())
            );
            chat.leftVoluntarilyParticipants = (chat.leftVoluntarilyParticipants || []).filter(
              (x: string) => !candTokens.includes(String(x).toLowerCase().trim())
            );
            if (chat.vetoedParticipants) {
              chat.vetoedParticipants = chat.vetoedParticipants.filter(
                (x: string) => !candTokens.includes(String(x).toLowerCase().trim())
              );
            }
            // A participant added back to a group returns as a regular participant, NOT moderator
            chat.adminUsernames = (chat.adminUsernames || []).filter(
              (x: string) => !candTokens.includes(String(x).toLowerCase().trim())
            );

            if (p && !chat.participants.some((x: string) => candTokens.includes(String(x).toLowerCase().trim()))) {
              chat.participants.push(p);
            }
          }
          if (rt.event === 'participant_removed' && (rt.participant || rt.participantId || rt.participantTokens)) {
            const p = String(rt.participant || rt.participantId).trim().toLowerCase();
            const candTokens = [
              p,
              rt.participantId,
              ...(Array.isArray(rt.participantTokens) ? rt.participantTokens : [])
            ].filter(Boolean).map((t: any) => String(t).trim().toLowerCase());

            candTokens.forEach(tok => {
              if (!chat.removedParticipants.includes(tok)) {
                chat.removedParticipants.push(tok);
              }
            });
            chat.participants = (chat.participants || []).filter(
              (x: string) => !candTokens.includes(String(x).toLowerCase().trim())
            );
            // Remove moderator privileges upon removal from group
            chat.adminUsernames = (chat.adminUsernames || []).filter(
              (x: string) => !candTokens.includes(String(x).toLowerCase().trim())
            );
          }
          const isLeftEvent = rt.event === 'user_left' || (
            m.role === 'sistema' && typeof m.text === 'string' && /(?:salió|abandonó)\s+(?:del\s+|el\s+)grupo/i.test(m.text)
          );
          if (isLeftEvent) {
            let p = String(rt.participant || rt.userId || '').trim();
            if (!p && typeof m.text === 'string') {
              const match = m.text.match(/^([^]+?)\s+(?:salió|abandonó)\s+(?:del|el)\s+grupo/i);
              if (match) p = match[1].trim();
            }
            const candTokens = [
              p,
              rt.participant,
              rt.userId,
              ...(Array.isArray(rt.participantTokens) ? rt.participantTokens : [])
            ].filter(Boolean).map((t: any) => String(t).trim().toLowerCase());

            candTokens.forEach(tok => {
              if (!chat.removedParticipants.includes(tok)) chat.removedParticipants.push(tok);
              if (!chat.leftVoluntarilyParticipants.includes(tok)) chat.leftVoluntarilyParticipants.push(tok);
            });
            chat.participants = (chat.participants || []).filter(
              (x: string) => !candTokens.includes(String(x).toLowerCase().trim())
            );
            chat.adminUsernames = (chat.adminUsernames || []).filter(
              (x: string) => !candTokens.includes(String(x).toLowerCase().trim())
            );
          }
        }
        if (m.sender && m.sender_id !== 'sistema' && m.role !== 'sistema') {
          const sClean = String(m.sender).trim();
          const sLow = sClean.toLowerCase();
          const isExited = (chat.removedParticipants || []).includes(sLow) || (chat.leftVoluntarilyParticipants || []).includes(sLow);
          if (sClean && !chat.participants.includes(sClean) && !isExited) {
            chat.participants.push(sClean);
          }
        }
      }
      // Final sanitation of participants and adminUsernames
      const allRemLower = new Set([
        ...(chat.removedParticipants || []),
        ...(chat.leftVoluntarilyParticipants || [])
      ].map((x: string) => String(x).toLowerCase().trim()));
      chat.participants = (chat.participants || []).filter((p: string) => !allRemLower.has(String(p).toLowerCase().trim()));
      chat.adminUsernames = (chat.adminUsernames || []).filter((a: string) => !allRemLower.has(String(a).toLowerCase().trim()));
    }
  } catch (err) {
    console.warn('Advertencia al enriquecer chat desde mensajes de Supabase:', err);
  }
}

// GROUP MODERATION: ADD PARTICIPANT
app.post('/api/chats/:id/participants/add', async (req, res) => {
  let user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();
  const headerRole = String(req.headers['x-user-role'] || '').trim();

  if (!user && (headerId || headerName)) {
    user = { id: headerId, nombre: headerName, usuario: headerName, apodo: headerName, tipo: headerRole || 'personal' } as any;
  }

  const chatId = req.params.id;
  const { participant, candidateTokens } = req.body;
  if (!participant) return res.status(400).json({ error: 'Participante requerido.' });

  let chat = db.getChat(chatId);
  if (!chat) {
    const all = db.getChats ? Object.values(db.getChats()) as any[] : [];
    chat = all.find(c =>
      String(c.id) === String(chatId) ||
      (c.activityId && String(c.activityId) === String(chatId)) ||
      ((c as any).actividad_id && String((c as any).actividad_id) === String(chatId))
    );
  }

  if (!chat && serverSupabase) {
    try {
      const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      let query = serverSupabase.from('chats').select('id, nombre, tipo, actividad_id, creador_id');
      if (isValidUUID(chatId)) {
        query = query.or(`id.eq.${chatId},actividad_id.eq.${chatId}`);
      }
      const { data: sbChats } = await query.limit(1);
      if (Array.isArray(sbChats) && sbChats.length > 0) {
        const row = sbChats[0];
        chat = db.createChat({
          id: row.id,
          title: row.nombre || 'Grupo',
          name: row.nombre || 'Grupo',
          type: row.tipo === 'privado' ? 'privado' : 'grupal',
          activityId: row.actividad_id,
          creatorId: row.creador_id,
          participants: [],
          messages: []
        } as any);
      }
    } catch (_) {}
  }

  if (chat) {
    await enrichChatFromSupabaseMessages(chat, chatId);
  }

  // Verificación de permisos de moderación amplia
  const userTokens = [
    user?.id,
    user?.usuario,
    user?.apodo,
    user?.nombre,
    user?.email,
    headerId,
    headerName
  ].filter(Boolean).map(t => String(t).toLowerCase().trim());

  let isActOrganizer = false;
  const actId = chat?.activityId || (chat as any)?.actividad_id;
  if (actId) {
    let act = db.getActivityById ? db.getActivityById(actId) : undefined;
    if (!act && db.getActivities) {
      act = db.getActivities().find((a: any) => String(a.id) === String(actId));
    }
    if (!act && serverSupabase) {
      try {
        const { data: sbAct } = await serverSupabase.from('activities').select('id, organizer_id, organizer, is_institutional').eq('id', actId).maybeSingle();
        if (sbAct) act = sbAct as any;
      } catch (_) {}
    }
    if (act) {
      const orgTokens = [
        act.organizerId,
        (act as any).creador_id,
        (act as any).organizer_id,
        act.organizer,
        (act as any).creador,
        (act as any).organizerNombre,
        (act as any).organizerName
      ].filter(Boolean).map(t => String(t).toLowerCase().trim());
      if (orgTokens.some(tok => userTokens.includes(tok))) {
        isActOrganizer = true;
      }
    }
  }

  const creatorTokens = [
    (chat as any)?.creador_id,
    chat?.creatorId,
    (chat as any)?.createdBy,
    chat?.creatorName,
    (chat as any)?.organizer,
    chat?.organizerId
  ].filter(Boolean).map(t => String(t).toLowerCase().trim());

  const explicitModerators = [
    ...(Array.isArray((chat as any)?.moderators) ? (chat as any).moderators : []),
    ...(Array.isArray((chat as any)?.moderadores) ? (chat as any).moderadores : []),
    ...(Array.isArray(chat?.adminUsernames) ? chat.adminUsernames : [])
  ].map(m => String(m).toLowerCase().trim());

  const isModerator = Boolean(
    user && (
      user.tipo === 'moderador' ||
      headerRole === 'moderador' ||
      userTokens.includes('moderador') ||
      creatorTokens.some(ct => userTokens.includes(ct)) ||
      explicitModerators.some(em => userTokens.includes(em)) ||
      isActOrganizer ||
      isUserGroupModerator(chat, user, db.getActivities ? db.getActivities() : []) ||
      (chat && chat.type !== 'privado' && (chat.participants || []).some(p => userTokens.includes(String(p).toLowerCase().trim())))
    )
  );

  if (!isModerator) {
    return res.status(403).json({ error: 'Permisos insuficientes para agregar participantes a este grupo.' });
  }

  const targetName = participant.trim();
  const targetTokens = new Set<string>();
  targetTokens.add(targetName);
  targetTokens.add(targetName.toLowerCase());

  if (Array.isArray(candidateTokens)) {
    candidateTokens.forEach(t => {
      if (t) {
        targetTokens.add(String(t).trim());
        targetTokens.add(String(t).trim().toLowerCase());
      }
    });
  }

  // Lookup user in local db or contacts
  const allDbUsers = Object.values(db.getUsers ? db.getUsers() : {});
  const matchedUser = allDbUsers.find((u: any) =>
    u && [u.id, u.usuario, u.apodo, u.nombre, (u as any).supabaseId].filter(Boolean).some((tok: any) => targetTokens.has(String(tok).toLowerCase().trim()))
  );
  let resolvedDisplayName = targetName;
  let resolvedUserId = '';
  if (matchedUser) {
    if (isAdministratorUser(matchedUser)) {
      return res.status(403).json({ error: 'Los usuarios administradores no pueden formar parte de ningún grupo.' });
    }
    if (matchedUser.apodo) resolvedDisplayName = matchedUser.apodo;
    else if (matchedUser.usuario) resolvedDisplayName = matchedUser.usuario;
    if (matchedUser.id) resolvedUserId = matchedUser.id;
    [matchedUser.id, matchedUser.usuario, matchedUser.apodo, matchedUser.nombre, (matchedUser as any).supabaseId].filter(Boolean).forEach((t: any) => {
      targetTokens.add(String(t).trim());
      targetTokens.add(String(t).trim().toLowerCase());
    });
  } else {
    const activeSbCheck = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
    if (activeSbCheck) {
      try {
        const { data: sbU } = await activeSbCheck
          .from('users')
          .select('id, tipo, rol')
          .or(`id.eq.${targetName},usuario.eq.${targetName},apodo.eq.${targetName}`)
          .limit(1)
          .maybeSingle();
        if (isAdministratorUser(sbU)) {
          return res.status(403).json({ error: 'Los usuarios administradores no pueden formar parte de ningún grupo.' });
        }
      } catch (_) {}
    }
  }

  if (user && (db.isUserBlocked(user.apodo, resolvedDisplayName) || db.isUserBlocked(user.usuario, resolvedDisplayName))) {
    return res.status(403).json({ error: 'No podés agregar a este usuario debido a bloqueos activos.' });
  }

  // 1. Agregar en la base de datos local
  const ok = db.addChatParticipant(chat ? chat.id : chatId, resolvedDisplayName, Array.from(targetTokens), req.body.clientMessageId);
  if (chat) {
    if (chat.adminUsernames) {
      chat.adminUsernames = chat.adminUsernames.filter((a: string) => !targetTokens.has(String(a).toLowerCase().trim()) && !targetTokens.has(String(a).trim()));
    }
    db.saveChat(chat);
  }

  let linkedAct: any = null;
  if (actId) {
    linkedAct = db.getActivityById(actId);
    if (linkedAct) {
      if (linkedAct.vettedUsers) {
        linkedAct.vettedUsers = linkedAct.vettedUsers.filter((u: string) => !targetTokens.has(u.toLowerCase()));
      }
      if (!linkedAct.enrolledUsernames) linkedAct.enrolledUsernames = [];
      if (!linkedAct.enrolledUsernames.some((u: string) => targetTokens.has(u.toLowerCase()))) {
        linkedAct.enrolledUsernames.push(resolvedDisplayName);
        linkedAct.enrolledCount = linkedAct.enrolledUsernames.length;
      }
    }
  }

  // 2. Sincronizar persistentemente con Supabase
  try {
    const activeSupabase = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
    if (activeSupabase) {
      // Sincronizar en tabla 'activities' si es un grupo de actividad
      let actRowTitle = '';
      if (actId) {
        const { data: actRow } = await activeSupabase.from('activities').select('id, title, enrolled_usernames, enrolled_count, vetted_users').eq('id', actId).maybeSingle();
        if (actRow) {
          actRowTitle = actRow.title || '';
          const currentEnrolled: string[] = Array.isArray(actRow.enrolled_usernames) ? actRow.enrolled_usernames : [];
          const updatedEnrolled = currentEnrolled.some(u => targetTokens.has(String(u).trim().toLowerCase()))
            ? currentEnrolled
            : [...currentEnrolled, resolvedDisplayName];
          const currentVetted: string[] = Array.isArray(actRow.vetted_users) ? actRow.vetted_users : [];
          const updatedVetted = currentVetted.filter(u => !targetTokens.has(String(u).trim().toLowerCase()));

          await activeSupabase.from('activities').update({
            enrolled_usernames: updatedEnrolled,
            enrolled_count: updatedEnrolled.length,
            vetted_users: updatedVetted
          }).eq('id', actId);
        }
      }

      // Publicar aviso del sistema en tabla 'messages' solo si no fue sincronizado previamente por el cliente
      if (!req.body.alreadySyncedWithSupabase) {
        const sChatId = chatIdentifierToBigInt(chat ? chat.id : chatId);
        const nowIso = new Date().toISOString();

        // Comprobar si ya fue insertado por el cliente recientemente
        const thirtySecsAgo = new Date(Date.now() - 30000).toISOString();
        const { data: recentSys } = await activeSupabase
          .from('messages')
          .select('id, reply_to, text')
          .eq('chat_id', sChatId)
          .eq('role', 'sistema')
          .gte('created_at', thirtySecsAgo)
          .limit(10);

        const rawTitle = chat?.name || chat?.title || actRowTitle || linkedAct?.title || 'la actividad';
        const cleanGroupName = String(rawTitle).replace(/^Grupo:\s*/i, '').trim();
        const expectedText = (chat?.activityId || actId)
          ? `¡Bienvenido a ${cleanGroupName}, ${resolvedDisplayName}!`
          : `${resolvedDisplayName} fue agregado al grupo por el moderador del grupo.`;
        const alreadyInserted = recentSys && recentSys.some((m: any) => {
          if (m.text === expectedText || m.text === `${resolvedDisplayName} fue agregado al grupo por el moderador del grupo.`) return true;
          let rt = m.reply_to;
          if (typeof rt === 'string') {
            try { rt = JSON.parse(rt); } catch {}
          }
          return rt?.event === 'participant_added' && (
            rt?.participant === resolvedDisplayName ||
            (Array.isArray(rt?.participantTokens) && rt.participantTokens.some((t: string) => targetTokens.has(String(t).toLowerCase().trim())))
          );
        });

        if (!alreadyInserted) {
          const sysMsg = {
            id: req.body.clientMessageId || `sys_add_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            chat_id: sChatId,
            sender_id: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: '👋',
            role: 'sistema',
            text: expectedText,
            time: formatArgentinaTimeOnly(new Date()),
            created_at: nowIso,
            reply_to: {
              event: 'participant_added',
              participant: resolvedDisplayName,
              participantId: resolvedUserId || undefined,
              participantTokens: Array.from(targetTokens)
            }
          };
          await activeSupabase.from('messages').insert(sysMsg);
        }
      }
    }
  } catch (sbErr) {
    console.warn('Error sincronizando adición de participante con Supabase:', sbErr);
  }

  const updatedChat = chat ? (db.getChat(chat.id) || chat) : { id: chatId };
  res.json({ success: ok, chat: updatedChat });
});

// GROUP MODERATION: REMOVE PARTICIPANT
app.post('/api/chats/:id/participants/remove', async (req, res) => {
  let user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();
  const headerRole = String(req.headers['x-user-role'] || '').trim();

  if (!user && (headerId || headerName)) {
    user = { id: headerId, nombre: headerName, usuario: headerName, apodo: headerName, tipo: headerRole || 'personal' } as any;
  }

  const chatId = req.params.id;
  const { participant, candidateTokens } = req.body;
  if (!participant) return res.status(400).json({ error: 'Participante requerido.' });

  let chat = db.getChat(chatId);
  if (!chat) {
    const all = db.getChats ? Object.values(db.getChats()) as any[] : [];
    chat = all.find(c =>
      String(c.id) === String(chatId) ||
      (c.activityId && String(c.activityId) === String(chatId)) ||
      ((c as any).actividad_id && String((c as any).actividad_id) === String(chatId))
    );
  }

  if (!chat && serverSupabase) {
    try {
      const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      let query = serverSupabase.from('chats').select('id, nombre, tipo, actividad_id, creador_id');
      if (isValidUUID(chatId)) {
        query = query.or(`id.eq.${chatId},actividad_id.eq.${chatId}`);
      }
      const { data: sbChats } = await query.limit(1);
      if (Array.isArray(sbChats) && sbChats.length > 0) {
        const row = sbChats[0];
        chat = db.createChat({
          id: row.id,
          title: row.nombre || 'Grupo',
          name: row.nombre || 'Grupo',
          type: row.tipo === 'privado' ? 'privado' : 'grupal',
          activityId: row.actividad_id,
          creatorId: row.creador_id,
          participants: [],
          messages: []
        } as any);
      }
    } catch (_) {}
  }

  if (chat) {
    await enrichChatFromSupabaseMessages(chat, chatId);
  }

  // Verificación de permisos de moderación amplia
  const userTokens = [
    user?.id,
    user?.usuario,
    user?.apodo,
    user?.nombre,
    user?.email,
    headerId,
    headerName
  ].filter(Boolean).map(t => String(t).toLowerCase().trim());

  let isActOrganizer = false;
  const actId = chat?.activityId || (chat as any)?.actividad_id;
  if (actId) {
    let act = db.getActivityById ? db.getActivityById(actId) : undefined;
    if (!act && db.getActivities) {
      act = db.getActivities().find((a: any) => String(a.id) === String(actId));
    }
    if (!act && serverSupabase) {
      try {
        const { data: sbAct } = await serverSupabase.from('activities').select('id, organizer_id, organizer, is_institutional').eq('id', actId).maybeSingle();
        if (sbAct) act = sbAct as any;
      } catch (_) {}
    }
    if (act) {
      const orgTokens = [
        act.organizerId,
        (act as any).creador_id,
        (act as any).organizer_id,
        act.organizer,
        (act as any).creador,
        (act as any).organizerNombre,
        (act as any).organizerName
      ].filter(Boolean).map(t => String(t).toLowerCase().trim());
      if (orgTokens.some(tok => userTokens.includes(tok))) {
        isActOrganizer = true;
      }
    }
  }

  const creatorTokens = [
    (chat as any)?.creador_id,
    chat?.creatorId,
    (chat as any)?.createdBy,
    chat?.creatorName,
    (chat as any)?.organizer,
    chat?.organizerId
  ].filter(Boolean).map(t => String(t).toLowerCase().trim());

  const explicitModerators = [
    ...(Array.isArray((chat as any)?.moderators) ? (chat as any).moderators : []),
    ...(Array.isArray((chat as any)?.moderadores) ? (chat as any).moderadores : []),
    ...(Array.isArray(chat?.adminUsernames) ? chat.adminUsernames : [])
  ].map(m => String(m).toLowerCase().trim());

  const isModerator = Boolean(
    user && (
      user.tipo === 'moderador' ||
      headerRole === 'moderador' ||
      userTokens.includes('moderador') ||
      creatorTokens.some(ct => userTokens.includes(ct)) ||
      explicitModerators.some(em => userTokens.includes(em)) ||
      isActOrganizer ||
      isUserGroupModerator(chat, user, db.getActivities ? db.getActivities() : [])
    )
  );

  if (!isModerator) {
    return res.status(403).json({ error: 'Permisos insuficientes para moderar este grupo.' });
  }

  const targetName = participant.trim();
  const targetTokens = new Set<string>();
  targetTokens.add(targetName);
  targetTokens.add(targetName.toLowerCase());

  if (Array.isArray(candidateTokens)) {
    candidateTokens.forEach(t => {
      if (t) {
        targetTokens.add(String(t).trim());
        targetTokens.add(String(t).toLowerCase().trim());
      }
    });
  }

  const allDbUsers = Object.values(db.getUsers ? db.getUsers() : {});
  const matchedUser = allDbUsers.find((u: any) =>
    u && [u.id, u.usuario, u.apodo, u.nombre, (u as any).supabaseId].filter(Boolean).some((tok: any) => targetTokens.has(String(tok).toLowerCase().trim()))
  );
  if (matchedUser) {
    [matchedUser.id, matchedUser.usuario, matchedUser.apodo, matchedUser.nombre, (matchedUser as any).supabaseId].filter(Boolean).forEach((t: any) => {
      targetTokens.add(String(t).trim());
      targetTokens.add(String(t).trim().toLowerCase());
    });
  }

  // 1. Quitar en la base de datos local en memoria/archivo
  db.removeChatParticipant(chat ? chat.id : chatId, participant, Array.from(targetTokens), req.body.clientMessageId);
  if (chat) {
    if (chat.adminUsernames) {
      chat.adminUsernames = chat.adminUsernames.filter((a: string) => !targetTokens.has(String(a).toLowerCase().trim()) && !targetTokens.has(String(a).trim()));
    }
    db.saveChat(chat);
  }

  // 2. Sincronizar persistentemente con Supabase
  try {
    const activeSupabase = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
    if (activeSupabase) {
      const targetLow = targetName.toLowerCase();

      let matchedUserId: string | undefined = undefined;
      let resolvedDisplayName = targetName;
      try {
        const { data: dbUser } = await activeSupabase
          .from('users')
          .select('id, usuario, apodo')
          .or(`id.eq.${targetName},usuario.eq.${targetName},apodo.eq.${targetName}`)
          .limit(1)
          .maybeSingle();
        if (dbUser) {
          matchedUserId = dbUser.id;
          resolvedDisplayName = dbUser.apodo || dbUser.usuario || targetName;
          if (dbUser.id) { targetTokens.add(String(dbUser.id).trim()); targetTokens.add(String(dbUser.id).toLowerCase().trim()); }
          if (dbUser.usuario) { targetTokens.add(String(dbUser.usuario).trim()); targetTokens.add(String(dbUser.usuario).toLowerCase().trim()); }
          if (dbUser.apodo) { targetTokens.add(String(dbUser.apodo).trim()); targetTokens.add(String(dbUser.apodo).toLowerCase().trim()); }
        }
      } catch (_) {}

      // Sincronizar en tabla 'activities' si es un grupo de actividad
      if (actId) {
        const { data: actRow } = await activeSupabase.from('activities').select('id, enrolled_usernames, enrolled_count, vetted_users').eq('id', actId).maybeSingle();
        if (actRow) {
          const currentEnrolled: string[] = Array.isArray(actRow.enrolled_usernames) ? actRow.enrolled_usernames : [];
          const updatedEnrolled = currentEnrolled.filter(u => !targetTokens.has(String(u).trim().toLowerCase()));
          const currentVetted: string[] = Array.isArray(actRow.vetted_users) ? actRow.vetted_users : [];
          const updatedVetted = currentVetted.includes(resolvedDisplayName) ? currentVetted : [...currentVetted, resolvedDisplayName];

          await activeSupabase.from('activities').update({
            enrolled_usernames: updatedEnrolled,
            enrolled_count: updatedEnrolled.length,
            vetted_users: updatedVetted
          }).eq('id', actId);
        }
      }

      // Publicar aviso del sistema en tabla 'messages' solo si no fue sincronizado previamente por el cliente
      if (!req.body.alreadySyncedWithSupabase) {
        const sChatId = chatIdentifierToBigInt(chat ? chat.id : chatId);
        const nowIso = new Date().toISOString();

        const thirtySecsAgo = new Date(Date.now() - 30000).toISOString();
        const { data: recentSys } = await activeSupabase
          .from('messages')
          .select('id, reply_to, text')
          .eq('chat_id', sChatId)
          .eq('role', 'sistema')
          .gte('created_at', thirtySecsAgo)
          .limit(10);

        const expectedText = `${resolvedDisplayName} fue retirado del grupo por el moderador del grupo.`;
        const alreadyInserted = recentSys && recentSys.some((m: any) => {
          if (m.text === expectedText) return true;
          let rt = m.reply_to;
          if (typeof rt === 'string') {
            try { rt = JSON.parse(rt); } catch {}
          }
          return rt?.event === 'participant_removed' && (
            rt?.participant === resolvedDisplayName ||
            (Array.isArray(rt?.participantTokens) && rt.participantTokens.some((t: string) => targetTokens.has(String(t).toLowerCase().trim())))
          );
        });

        if (!alreadyInserted) {
          const sysMsg = {
            id: req.body.clientMessageId || `sys_rem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            chat_id: sChatId,
            sender_id: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: '🛡️',
            role: 'sistema',
            text: expectedText,
            time: formatArgentinaTimeOnly(new Date()),
            created_at: nowIso,
            reply_to: {
              event: 'participant_removed',
              participant: resolvedDisplayName,
              participantId: matchedUserId,
              participantTokens: Array.from(targetTokens)
            }
          };
          await activeSupabase.from('messages').insert(sysMsg);
        }
      }
    }
  } catch (sbErr) {
    console.warn('Error sincronizando eliminación de participante con Supabase:', sbErr);
  }

  const updatedChat = chat ? (db.getChat(chat.id) || chat) : { id: chatId };
  res.json({ success: true, chat: updatedChat });
});

// GROUP MODERATION: CHANGE PHOTO
app.post('/api/chats/:id/photo', async (req, res) => {
  let user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();

  if (!user && (headerId || headerName)) {
    user = { id: headerId, nombre: headerName, usuario: headerName, apodo: headerName } as any;
  }

  const chatId = req.params.id;
  const { photo, avatar, image } = req.body;
  const photoUrl = photo || avatar || image;

  if (!photoUrl) {
    return res.status(400).json({ error: 'Foto requerida.' });
  }

  let chat = db.getChat(chatId);
  if (!chat) {
    const all = db.getChats ? Object.values(db.getChats()) as any[] : [];
    chat = all.find(c => String(c.id) === String(chatId) || String(c.activityId) === String(chatId));
  }

  // Sincronizar de forma duradera a Supabase en tabla 'chats' (foto_grupo_url)
  try {
    const activeSupabase = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
    if (activeSupabase) {
      const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      if (isValidUUID(String(chatId))) {
        await activeSupabase.from('chats').update({ foto_grupo_url: photoUrl }).eq('id', chatId);
      } else if (chat?.id && isValidUUID(String(chat.id))) {
        await activeSupabase.from('chats').update({ foto_grupo_url: photoUrl }).eq('id', chat.id);
      }
      if (chat?.activityId && isValidUUID(String(chat.activityId))) {
        await activeSupabase.from('chats').update({ foto_grupo_url: photoUrl }).eq('actividad_id', chat.activityId);
      }
    }
  } catch (sbErr) {
    console.warn('Error sincronizando foto del grupo con Supabase:', sbErr);
  }

  if (chat) {
    chat.avatar = photoUrl;
    chat.image = photoUrl;
    if (typeof db.saveChat === 'function') {
      db.saveChat(chat);
    }
  }

  const updatedChat = chat ? (db.getChat(chat.id) || chat) : { id: chatId, image: photoUrl, avatar: photoUrl };
  return res.json({ success: true, chat: updatedChat });
});

// GROUP MODERATION: DESIGNAR MODERADOR
app.post('/api/chats/:id/admins', async (req, res) => {
  let user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();

  if (!user && (headerId || headerName)) {
    user = { id: headerId, nombre: headerName, usuario: headerName, apodo: headerName } as any;
  }

  const chatId = String(req.params.id || '').trim();
  const { participant, participantId, participantTokens, activityId, clientMessageId, alreadySyncedWithSupabase } = req.body || {};
  if (!chatId || chatId === 'undefined' || chatId === 'null') {
    console.warn('[POST /api/chats/:id/admins] chat_id inválido recibido:', chatId);
    return res.status(400).json({ error: 'Identificador de chat inválido.' });
  }
  if (!participant) return res.status(400).json({ error: 'Participante requerido.' });

  let chat = db.getChat(chatId);
  if (!chat) {
    const all = db.getChats ? Object.values(db.getChats()) as any[] : [];
    chat = all.find(
      c =>
        String(c.id) === String(chatId) ||
        (c.activityId && (String(c.activityId) === String(chatId) || (activityId && String(c.activityId) === String(activityId))))
    );
  }
  if (!chat && serverSupabase) {
    try {
      const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      let sbChats: any[] | null = null;

      if (isValidUUID(chatId)) {
        const { data } = await serverSupabase
          .from('chats')
          .select('id, nombre, tipo, actividad_id, creador_id')
          .eq('id', chatId)
          .limit(1);
        sbChats = data;
      }

      const actLookup = activityId || (!isValidUUID(chatId) && !isNaN(Number(chatId)) ? chatId : null);
      if ((!sbChats || sbChats.length === 0) && actLookup) {
        const { data } = await serverSupabase
          .from('chats')
          .select('id, nombre, tipo, actividad_id, creador_id')
          .eq('actividad_id', String(actLookup))
          .limit(1);
        sbChats = data;
      }

      if (Array.isArray(sbChats) && sbChats.length > 0) {
        const row = sbChats[0];
        chat = db.createChat({
          id: row.id,
          title: row.nombre || 'Grupo',
          name: row.nombre || 'Grupo',
          type: row.tipo === 'privado' ? 'privado' : 'grupal',
          activityId: row.actividad_id,
          creatorId: row.creador_id,
          participants: [],
          messages: []
        } as any);
      }
    } catch (sbLookupErr) {
      console.warn('[POST /api/chats/:id/admins] Error consultando chat en Supabase:', sbLookupErr);
    }
  }

  if (!chat && alreadySyncedWithSupabase) {
    const fallbackTokens = Array.from(new Set([
      String(typeof participant === 'object' ? (participant.apodo || participant.usuario || participant.nombre || participant.id) : participant).trim(),
      ...(Array.isArray(participantTokens) ? participantTokens.map((t: any) => String(t).trim()) : []),
      ...(participantId ? [String(participantId).trim()] : [])
    ].filter(Boolean)));
    return res.json({
      success: true,
      chat: {
        id: chatId,
        adminUsernames: fallbackTokens
      }
    });
  }

  if (!chat) return res.status(404).json({ error: 'Chat no encontrado.' });
  await enrichChatFromSupabaseMessages(chat, chat.id || chatId);

  const userTokens = [
    user?.id,
    user?.usuario,
    user?.apodo,
    user?.nombre,
    headerId,
    headerName
  ].filter(Boolean).map(t => String(t).toLowerCase().trim());

  // Verificar la actividad si está vinculada al chat (en db local o en Supabase)
  let isActOrganizer = false;
  if (chat.activityId) {
    const numActId = Number(chat.activityId);
    let act = (!isNaN(numActId) && db.getActivityById) ? db.getActivityById(numActId) : null;
    if (!act && db.getActivities) {
      act = (db.getActivities() as any[]).find(a => String(a.id) === String(chat.activityId));
    }
    if (!act && serverSupabase) {
      try {
        const { data: sbAct } = await serverSupabase.from('activities').select('id, organizer_id, organizer, is_institutional').eq('id', chat.activityId).maybeSingle();
        if (sbAct) act = sbAct as any;
      } catch {}
    }
    if (act) {
      const aAny = act as any;
      const actOrgTokens = [
        act.organizerId,
        aAny.organizer_id,
        aAny.organizador_id,
        aAny.creador_id,
        act.organizer,
        aAny.organizador,
        aAny.creador
      ].filter(Boolean).map(t => String(t).toLowerCase().trim());
      isActOrganizer = userTokens.some(tok => actOrgTokens.includes(tok));
    }
  }

  const isCreatorOrAdmin = Boolean(
    user && (
      user.tipo === 'moderador' ||
      user.tipo === 'institucional' ||
      isActOrganizer ||
      userTokens.includes(String(chat.creatorId || '').toLowerCase().trim()) ||
      userTokens.includes(String(chat.organizerId || '').toLowerCase().trim()) ||
      userTokens.includes(String(chat.creatorName || '').toLowerCase().trim()) ||
      userTokens.includes(String(chat.organizer || '').toLowerCase().trim()) ||
      (chat.adminUsernames || []).some((adm: string) =>
        userTokens.includes(String(adm).toLowerCase().trim())
      ) ||
      isUserGroupModerator(chat, user, db.getActivities ? db.getActivities() : [])
    )
  );

  if (!isCreatorOrAdmin && !alreadySyncedWithSupabase) {
    return res.status(403).json({ error: 'Solo quien modera u organiza el grupo puede designar moderadores.' });
  }

  const adminList: string[] = Array.isArray(chat.adminUsernames) ? chat.adminUsernames : [];
  chat.adminUsernames = adminList;

  const cleanPart = String(typeof participant === 'object' ? (participant.usuario || participant.nombre || participant.id) : participant).trim();

  // Buscar información completa del participante en db local o Supabase para agregar todos sus tokens
  const candidateTokens: string[] = [
    cleanPart,
    ...(Array.isArray(participantTokens) ? participantTokens.map((t: any) => String(t).trim()).filter(Boolean) : []),
    ...(participantId ? [String(participantId).trim()] : [])
  ];
  const allDbUsers: any[] = typeof db.getUsers === 'function' ? Object.values(db.getUsers()) : [];
  let matchedPartUser = allDbUsers.find((u: any) =>
    (u.id && String(u.id).toLowerCase() === cleanPart.toLowerCase()) ||
    (u.usuario && u.usuario.toLowerCase() === cleanPart.toLowerCase()) ||
    (u.apodo && u.apodo.toLowerCase() === cleanPart.toLowerCase()) ||
    (u.nombre && u.nombre.toLowerCase() === cleanPart.toLowerCase())
  );

  if (!matchedPartUser && serverSupabase) {
    try {
      const { data: sbU } = await serverSupabase.from('users').select('id, usuario, apodo')
        .or(`id.eq.${cleanPart},usuario.eq.${cleanPart},apodo.eq.${cleanPart}`)
        .limit(1)
        .maybeSingle();
      if (sbU) matchedPartUser = sbU;
    } catch {}
  }

  if (matchedPartUser) {
    if (matchedPartUser.usuario) candidateTokens.push(matchedPartUser.usuario);
    if (matchedPartUser.apodo) candidateTokens.push(matchedPartUser.apodo);
    if (matchedPartUser.nombre) candidateTokens.push(matchedPartUser.nombre);
    if (matchedPartUser.id) candidateTokens.push(matchedPartUser.id);
  }

  candidateTokens.forEach(tok => {
    const tClean = tok.trim();
    if (tClean && !adminList.some((a: string) => a.toLowerCase().trim() === tClean.toLowerCase())) {
      adminList.push(tClean);
    }
  });

  if (typeof db.saveChat === 'function') {
    db.saveChat(chat);
  } else if (typeof (db as any).makeChatAdmin === 'function') {
    (db as any).makeChatAdmin(chat.id, cleanPart);
  }

  // Sincronizar en Supabase solo si el cliente aún no lo persistió directamente
  if (serverSupabase && !alreadySyncedWithSupabase) {
    try {
      const sChatId = chatIdentifierToBigInt(chat.id);
      const displayName = matchedPartUser?.apodo || matchedPartUser?.usuario || cleanPart;
      const nowIso = new Date().toISOString();
      const sysMsg = {
        id: clientMessageId || `msg_adm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        chat_id: sChatId,
        sender_id: 'sistema',
        sender: 'Sistema CLUB65',
        avatar: 'S',
        role: 'institucional',
        text: `Sistema CLUB65: ${displayName} fue designado/a moderador/a del grupo.`,
        time: formatArgentinaTimeOnly(new Date()),
        created_at: nowIso,
        reply_to: {
          action: 'make_admin',
          adminUsernames: chat.adminUsernames,
          participant: displayName,
          participantId: matchedPartUser?.id || cleanPart,
          participantTokens: chat.adminUsernames
        }
      };
      await serverSupabase.from('messages').insert(sysMsg);
    } catch (sbErr) {
      console.warn('Error sincronizando designación de moderador en Supabase:', sbErr);
    }
  }

  const updatedChat = db.getChat(chat.id) || chat;
  res.json({ success: true, chat: updatedChat });
});

app.post('/api/chats', async (req, res) => {
  const user = getAuthUser(req);
  const { title, subtitle, type, participants, avatar, image, creatorName, creatorId, adminUsernames, actividadId } = req.body;
  if (!title) return res.status(400).json({ error: 'Título requerido.' });

  const isGroupRequest = type !== 'privado';
  if (isGroupRequest && isAdministratorUser(user)) {
    return res.status(403).json({ error: 'Los usuarios administradores no pueden crear ni formar parte de ningún grupo.' });
  }

  // Validar que ningún invitado a un grupo sea administrador
  if (isGroupRequest && Array.isArray(participants) && participants.length > 0) {
    const allDbUsersForGroup = Object.values(db.getUsers ? db.getUsers() : {});
    for (const p of participants) {
      if (!p || typeof p !== 'string') continue;
      const pLow = p.trim().toLowerCase();
      const matchedDbUser = allDbUsersForGroup.find((u: any) =>
        u && [u.id, u.usuario, u.apodo, u.nombre, (u as any).supabaseId]
          .filter(Boolean)
          .some((tok: any) => String(tok).trim().toLowerCase() === pLow)
      );
      if (isAdministratorUser(matchedDbUser)) {
        return res.status(403).json({ error: 'Los usuarios administradores no pueden formar parte de ningún grupo.' });
      }
    }
  }

  // Validar bloqueos
  if (user && participants && Array.isArray(participants)) {
    for (const p of participants) {
      if (db.isUserBlocked(user.usuario, p) || db.isUserBlocked(user.apodo, p)) {
        return res.status(403).json({ error: `No podés agregar a ${p} al grupo debido a bloqueos activos.` });
      }
    }
  }

  // Resolver nombre de creador
  const effectiveCreatorName = (
    creatorName ||
    (user ? (user.apodo || user.nombre || user.usuario) : '') ||
    'Usuario'
  ).trim();

  const effectiveCreatorId = String(creatorId || user?.id || 'user_' + Date.now());

  // Limpiar participantes recibidos: descartar identificadores técnicos como usr_..., user_..., c_..., UUIDs, bots o el propio usuario
  const cleanParticipants = (Array.isArray(participants) ? participants : [])
    .filter((p: any) => p && typeof p === 'string' && !isTechnicalIdentifier(p) && !isDummyOrSystemParticipant(p) && !isSelfUserOrContact(p, user) && p !== effectiveCreatorId && p !== effectiveCreatorName);

  // Validación estricta: un grupo vecinal o libre no puede crearse consigo mismo únicamente
  if ((type === 'grupal' || type === 'grupo_libre' || !type) && !actividadId) {
    if (cleanParticipants.length === 0) {
      return res.status(400).json({ error: 'Para crear un grupo debés invitar al menos a otro contacto.' });
    }
  }

  // Participantes iniciales con nombres legibles
  const initialParticipants = Array.from(
    new Set([
      effectiveCreatorName,
      ...cleanParticipants
    ])
  ).filter(p => !isTechnicalIdentifier(p) && !isDummyOrSystemParticipant(p));

  const initialAdmins = Array.from(
    new Set([
      effectiveCreatorName.toLowerCase(),
      effectiveCreatorId.toLowerCase(),
      ...(Array.isArray(adminUsernames) ? adminUsernames.map((a: string) => String(a).toLowerCase()) : [])
    ])
  );

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const initMsgId = `msg_init_${nowMs}`;

  const creationNoticeText = type === 'privado'
    ? `Se inició un chat privado con ${title}.`
    : initialParticipants.length > 1
      ? `Se inició el grupo "${title}" con ${initialParticipants.join(', ')}.`
      : `Se inició el grupo "${title}" con ${effectiveCreatorName}.`;

  const initialMessages = [
    {
      id: initMsgId,
      senderId: 'sistema',
      sender: 'Sistema CLUB65',
      avatar: 'S',
      role: 'institucional',
      text: creationNoticeText,
      time: 'Ahora',
      createdAt: nowIso,
      timestamp: nowMs
    }
  ];

  const isValidUUID = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const targetChatId = (req.body.id && isValidUUID(String(req.body.id)))
    ? String(req.body.id)
    : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `chat_${Date.now()}`);

  // 1. Crear el chat en el storage local/memoria directamente con su UUID definitivo
  const newChat = db.createChat({
    id: targetChatId,
    title,
    name: title,
    subtitle: subtitle || (type === 'grupal' ? `${initialParticipants.length} participantes` : 'Chat directo'),
    type: type || 'grupal',
    organizerId: effectiveCreatorId,
    creatorId: effectiveCreatorId,
    creatorName: effectiveCreatorName,
    adminUsernames: initialAdmins,
    avatar: avatar || undefined,
    image: avatar || undefined,
    allowedRoles: [user ? user.tipo : 'personal'],
    participants: initialParticipants,
    messages: initialMessages,
    updatedAt: nowIso,
    updated_at: nowIso,
    lastMessage: creationNoticeText,
    lastMessageTime: 'Ahora'
  } as any);

  // 2. Persistir en la tabla 'chats' y 'messages' de Supabase
  try {
    const activeSupabase = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
    if (activeSupabase) {
      const isAct = Boolean(actividadId);
      const chatTipo = (type === 'privado' || (type as string) === 'directo')
        ? 'privado'
        : (isAct ? 'grupo_actividad' : 'grupo_libre');

      const payload: any = {
        nombre: title,
        tipo: chatTipo
      };

      if (isValidUUID(String(newChat.id))) {
        payload.id = newChat.id;
      }
      if (user?.id && isValidUUID(String(user.id))) {
        payload.creador_id = user.id;
      }
      if (actividadId && isValidUUID(String(actividadId))) {
        payload.actividad_id = actividadId;
      }
      if (avatar || image) {
        payload.foto_grupo_url = avatar || image;
      }

      const { data: insertedChat, error: sbError } = await activeSupabase.from('chats').insert(payload).select().single();
      if (!sbError && insertedChat?.id) {
        const oldId = String(newChat.id);
        if (oldId !== String(insertedChat.id)) {
          if (db.deleteChat) db.deleteChat(oldId);
          newChat.id = insertedChat.id;
          if (db.saveChat) db.saveChat(newChat);
        }
      }

      // Insertar el mensaje inicial en Supabase con metadata completa
      const sChatIdBig = chatIdentifierToBigInt(newChat.id);
      await activeSupabase.from('messages').insert({
        id: initMsgId,
        chat_id: sChatIdBig,
        sender_id: 'sistema',
        sender: 'Sistema CLUB65',
        avatar: 'S',
        role: 'institucional',
        text: creationNoticeText,
        time: 'Ahora',
        created_at: nowIso,
        reply_to: {
          is_group_init: true,
          title: title,
          creatorId: effectiveCreatorId,
          creatorName: effectiveCreatorName,
          participants: initialParticipants,
          adminUsernames: initialAdmins,
          avatar: avatar || image || null
        }
      });
    }
  } catch (err) {
    console.warn('Excepción al sincronizar chat o mensaje inicial con Supabase:', err);
  }

  res.status(201).json(newChat);
});

app.post('/api/chats/:id/leave', async (req, res) => {
  const user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();
  let uName = user?.usuario || req.body.userNick || headerName || 'Usuario';
  let uApodo = user?.apodo || req.body.userApodo || (headerName !== 'Usuario' ? headerName : '') || '';
  let uId = user?.id || req.body.userId || headerId || '';

  // Ensure real apodo is fetched from DB or Supabase if not present in request
  if (!uApodo || uApodo === 'Usuario' || uApodo === 'Vecino') {
    const allDbUsers = Object.values(db.getUsers ? db.getUsers() : {});
    const localMatch: any = allDbUsers.find((u: any) =>
      u && [u.id, u.usuario, u.apodo, u.nombre].filter(Boolean).some(tok =>
        [uId, uName, headerName, headerId].filter(Boolean).map(x => String(x).toLowerCase().trim()).includes(String(tok).toLowerCase().trim())
      )
    );
    if (localMatch?.apodo) {
      uApodo = localMatch.apodo;
    } else if (localMatch?.nombre) {
      uApodo = localMatch.nombre;
    }
  }

  if (serverSupabase && (!uApodo || uApodo === 'Usuario' || uApodo === 'Vecino')) {
    try {
      const { data: dbUser } = await serverSupabase
        .from('users')
        .select('id, usuario, apodo, nombre')
        .or(`id.eq.${uId || '00000000-0000-0000-0000-000000000000'},usuario.eq.${uName},apodo.eq.${uName}`)
        .limit(1)
        .maybeSingle();
      if (dbUser) {
        if (dbUser.apodo) uApodo = dbUser.apodo;
        else if (dbUser.nombre) uApodo = dbUser.nombre;
        else if (dbUser.usuario) uApodo = dbUser.usuario;
      }
    } catch (_) {}
  }

  const exitName = (uApodo || uName || 'Vecino').trim();

  const tokenSet = new Set<string>();
  [exitName, uApodo, uName, uId, headerName, headerId, ...(Array.isArray(req.body.participantTokens) ? req.body.participantTokens : [])]
    .filter(Boolean)
    .forEach(t => {
      const s = String(t).trim();
      if (s) {
        tokenSet.add(s);
        tokenSet.add(s.toLowerCase());
      }
    });
  const participantTokens = Array.from(tokenSet);

  const success = db.leaveChat(req.params.id, uName, uApodo, uId, participantTokens);

  // Sincronizar salida del chat sin crear jamás grupos paralelos ni duplicados
  try {
    const activeSupabase = serverSupabase || (typeof supabase !== 'undefined' ? supabase : null);
    if (activeSupabase) {
      const cId = req.params.id;
      let chat = db.getChat(cId);
      if (!chat) {
        const all = db.getChats ? Object.values(db.getChats()) as any[] : [];
        chat = all.find(c => String(c.id) === String(cId) || (c.activityId && String(c.activityId) === String(cId)));
      }

      if (!req.body.alreadySyncedWithSupabase) {
        const sChatId = chatIdentifierToBigInt(cId);
        const nowIso = new Date().toISOString();

        const thirtySecsAgo = new Date(Date.now() - 30000).toISOString();
        const { data: recentSys } = await activeSupabase
          .from('messages')
          .select('id, reply_to, text')
          .eq('chat_id', sChatId)
          .eq('role', 'sistema')
          .gte('created_at', thirtySecsAgo)
          .limit(10);

        const expectedText = `${exitName} salió del grupo.`;
        const alreadyInserted = recentSys && recentSys.some((m: any) => {
          if (m.text === expectedText) return true;
          let rt = m.reply_to;
          if (typeof rt === 'string') {
            try { rt = JSON.parse(rt); } catch {}
          }
          return rt?.event === 'user_left' && (
            rt?.participant === exitName ||
            (rt?.userId && rt.userId === uId) ||
            (Array.isArray(rt?.participantTokens) && rt.participantTokens.some((t: string) => tokenSet.has(t.toLowerCase())))
          );
        });

        if (!alreadyInserted) {
          await activeSupabase.from('messages').insert({
            id: req.body.clientMessageId || `sys_left_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            chat_id: sChatId,
            sender_id: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: '👋',
            role: 'sistema',
            text: expectedText,
            time: formatArgentinaTimeOnly(new Date()),
            created_at: nowIso,
            reply_to: {
              event: 'user_left',
              participant: exitName,
              userId: uId,
              participantTokens,
              ...(Array.isArray(req.body.participantsSnapshot) ? { participantsSnapshot: req.body.participantsSnapshot } : {})
            }
          });
        }
      }
    }
  } catch (sbErr) {
    console.warn('Advertencia sincronizando salida de chat en Supabase:', sbErr);
  }

  res.json({ success });
});

app.delete('/api/chats/:id', (req, res) => {
  db.deleteChat(req.params.id);
  res.json({ success: true });
});

app.post('/api/chats/:id/delete-for-me', async (req, res) => {
  const user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const headerName = decodeURIComponent(String(req.headers['x-user-name'] || '')).trim();

  const idList = [
    user?.id,
    user?.usuario,
    user?.apodo,
    user?.nombre,
    headerId,
    headerName
  ].filter(Boolean) as string[];

  if (idList.length === 0) return res.status(401).json({ error: 'No autenticado.' });

  const ok = db.deleteChatForUser(req.params.id, idList);

  // Sincronizar borrado con Supabase tabla chats (columna deleted_for_user_ids)
  try {
    if (serverSupabase) {
      const cId = req.params.id;
      const isNum = !isNaN(Number(cId));
      let q = serverSupabase.from('chats').select('id, deleted_for_user_ids');
      if (isNum) {
        q = q.or(`id.eq.${Number(cId)},activity_id.eq.${Number(cId)}`);
      } else {
        q = q.eq('id', cId);
      }
      const { data: rows } = await q;
      if (Array.isArray(rows) && rows.length > 0) {
        for (const row of rows) {
          const prevDeleted = Array.isArray(row.deleted_for_user_ids) ? row.deleted_for_user_ids : [];
          const merged = Array.from(new Set([...prevDeleted, ...idList.map(s => s.toLowerCase())]));
          await serverSupabase.from('chats').update({ deleted_for_user_ids: merged }).eq('id', row.id);
        }
      }
    }
  } catch (sbErr) {
    console.warn('Advertencia actualizando deleted_for_user_ids en Supabase:', sbErr);
  }

  res.json({ success: ok });
});

// ================= REVIEWS ROUTES =================
app.get('/api/reviews', (_req, res) => {
  res.json(db.getReviews());
});
app.post('/api/reviews', (req, res) => {
  const user = getAuthUser(req);
  const { actividadId, actividad, estrellas, texto, foto, media, autor, userApodo, usuario } = req.body;
  
  if (!actividad || !texto) {
    return res.status(400).json({ error: 'Actividad y opinión requeridas.' });
  }

  const mediaArray: string[] = Array.isArray(media) ? media : (foto ? [foto] : []);
  let rawAuthor = userApodo || autor || user?.apodo || user?.usuario || user?.nombre || 'Vecino de CLUB65';
  if (user?.apodo && !user.apodo.includes('@')) {
    rawAuthor = user.apodo;
  } else if (rawAuthor.includes('@')) {
    rawAuthor = rawAuthor.split('@')[0];
  }
  const authorName = rawAuthor.trim() || 'Vecino de CLUB65';

  const now = new Date();
  const fechaReal = formatArgentinaDateOnly(now);

  const newReview = db.createReview({
    actividadId,
    actividad,
    autor: authorName,
    estrellas: Number(estrellas),
    fecha: fechaReal,
    texto,
    foto: mediaArray[0] || null,
    media: mediaArray
  });

  res.status(201).json(newReview);
});

app.put('/api/reviews/:id', (req, res) => {
  const id = Number(req.params.id);
  const updates = { ...req.body };
  if (Array.isArray(updates.media)) {
    updates.foto = updates.media[0] || null;
  }
  const updated = db.updateReview(id, updates);
  if (!updated) return res.status(404).json({ error: 'Reseña no encontrada.' });
  res.json(updated);
});

app.post('/api/reviews/:id/retire', (req, res) => {
  const id = req.params.id;
  const retired = db.retireReview(Number(id) || (id as any));
  res.json({ success: true, review: retired || null });
});

app.delete('/api/reviews/:id', (req, res) => {
  const id = req.params.id;
  const ok = db.deleteReview(Number(id) || (id as any));
  res.json({ success: ok });
});

// ================= CONTACTS ROUTES =================
app.get('/api/contacts', async (req, res) => {
  const user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const effectiveUser = user || (headerId ? db.getUser(headerId) : null);

  let contacts = db.getContacts();
  if (serverSupabase) {
    try {
      const { data: dbContacts, error } = await serverSupabase
        .from('contacts')
        .select('id, nombre, detalle, avatar, avatar_class, bio, foto, created_at')
        .order('created_at', { ascending: false })
        .limit(60);
      if (!error && Array.isArray(dbContacts) && dbContacts.length > 0) {
        const map = new Map<string, any>();
        dbContacts.forEach((c: any) => {
          map.set(String(c.id), {
            id: String(c.id),
            nombre: c.nombre,
            detalle: c.detalle,
            avatar: c.avatar,
            avatarClass: c.avatar_class || 'bg-club-teal',
            bio: c.bio,
            foto: sanitizeProfileAvatar(c.foto) || undefined
          });
        });
        contacts.forEach(c => {
          if (!map.has(String(c.id))) map.set(String(c.id), c);
        });
        contacts = Array.from(map.values());
      }
    } catch {}
  }
  contacts = filterContactsForUser(contacts, effectiveUser);
  res.json(contacts);
});

app.post('/api/contacts', async (req, res) => {
  const user = getAuthUser(req);
  const headerId = String(req.headers['x-user-id'] || '').trim();
  const effectiveUser = user || (headerId ? db.getUser(headerId) : null);
  const userId = effectiveUser?.id || headerId;

  const { nombre, detalle, avatar, avatarClass, bio, foto } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido.' });

  if (effectiveUser && isSelfUserOrContact({ nombre, id: req.body.id }, effectiveUser)) {
    return res.status(400).json({ error: 'No podés agendar a tu propio usuario.' });
  }

  const newContact = db.addContact({
    userId,
    nombre,
    detalle: detalle || 'Contacto agendado',
    avatar: avatar || nombre.slice(0, 2).toUpperCase(),
    avatarClass: avatarClass || 'bg-club-teal',
    bio: bio || 'Miembro de la comunidad.',
    foto: foto || null
  });

  if (serverSupabase) {
    try {
      await serverSupabase.from('contacts').insert({
        id: newContact.id,
        nombre: newContact.nombre,
        detalle: newContact.detalle,
        avatar: newContact.avatar,
        avatar_class: newContact.avatarClass,
        bio: newContact.bio,
        foto: newContact.foto
      });
    } catch (e) {
      console.warn('Error sincronizando nuevo contacto en Supabase:', e);
    }
  }

  res.status(201).json(newContact);
});

app.delete('/api/contacts/:id', async (req, res) => {
  const targetId = req.params.id;
  const targetName = (req.query.nombre as string) || req.body?.nombre;
  const success = db.deleteContact(targetId, targetName);
  if (serverSupabase) {
    try {
      if (targetName) {
        await serverSupabase.from('contacts').delete().or(`id.eq.${targetId},nombre.eq.${targetName}`);
      } else {
        await serverSupabase.from('contacts').delete().eq('id', targetId);
      }
    } catch (e) {
      console.warn('Error eliminando contacto en Supabase:', e);
    }
  }
  res.json({ success });
});

// ================= SECURITY REPORTS ROUTES =================
app.get('/api/reports', (_req, res) => {
  res.json(db.getSecurityReports());
});

app.post('/api/reports', (req, res) => {
  const user = getAuthUser(req);
  const { id, type, chatId, messageId, messageText, mediaUrl, mediaUrls, reviewId, activityId, reportedUser, reporterUser: bodyReporter, reason, comment } = req.body;

  if (!reason) {
    return res.status(400).json({ error: 'Motivo de reporte requerido.' });
  }

  const reporterUser = bodyReporter || (user ? user.usuario || user.apodo : 'Vecino de CLUB65');

  const newReport = db.createSecurityReport({
    ...(id ? { id: String(id) } : {}),
    type: type || 'chat_message',
    chatId: chatId ? (Number(chatId) || chatId) : undefined,
    messageId,
    messageText,
    mediaUrl,
    mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : (mediaUrl ? [mediaUrl] : undefined),
    reviewId: reviewId ? (Number(reviewId) || reviewId) : undefined,
    activityId: activityId ? Number(activityId) : undefined,
    reportedUser: reportedUser || 'Usuario de CLUB65',
    reporterUser,
    reason,
    comment: comment || ''
  });

  res.status(201).json({
    success: true,
    report: newReport,
    notificationMessage: 'Su reporte ha sido recibido, Te comunicaremos si detectamos que se incumplió una regla, así como las medidas que tomaremos al respecto'
  });
});

app.post('/api/reports/:id/resolve', (req, res) => {
  const id = req.params.id;
  const user = getAuthUser(req);
  const { status, resolutionNote, action, sanctionReason, adminComment, sanctionType, alsoDeletedContent, resolutionDetail } = req.body;

  const resolved = db.resolveSecurityReport(
    id,
    status,
    resolutionNote,
    action,
    sanctionReason,
    adminComment,
    user?.apodo || 'administrador',
    sanctionType,
    alsoDeletedContent,
    resolutionDetail
  );
  if (!resolved) return res.status(404).json({ error: 'Reporte no encontrado.' });

  res.json({ success: true, report: resolved });
});

// ================= ADMIN / INSTITUTION VALIDATION ROUTES =================
app.get('/api/admin/institutions', (_req, res) => {
  const allUsers = Object.values(db.getUsers());
  const pending = allUsers.filter(u => u.tipo === 'institucional');
  res.json(pending);
});

app.post('/api/admin/institutions/:id/approve', (req, res) => {
  const userId = req.params.id;
  const { adminApodo, adminUsuario, fechaAlta } = req.body || {};
  const updated = db.approveInstitution(userId, { adminApodo, adminUsuario, fechaAlta });
  if (!updated) return res.status(404).json({ error: 'Institución no encontrada.' });
  res.json({ success: true, user: updated, message: 'Institución dada de alta oficialmente.' });
});

app.post('/api/admin/institutions/:id/reject', (req, res) => {
  const userId = req.params.id;
  const { reason } = req.body;
  const updated = db.rejectInstitution(userId, reason);
  if (!updated) return res.status(404).json({ error: 'Institución no encontrada.' });
  res.json({ success: true, user: updated, message: 'Solicitud de alta rechazada.' });
});

app.post('/api/admin/institutions/:id/verify', (req, res) => {
  const userId = req.params.id;
  const { isVerified } = req.body;

  const updated = db.verifyInstitution(userId, isVerified !== false);
  if (!updated) return res.status(404).json({ error: 'Institución no encontrada.' });

  db.addNotification(updated.apodo, isVerified ? '¡Tu institución ha sido verificada con tilde azul oficial de CLUB65!' : 'Se rechazó la verificación de la institución.');
  res.json({ success: true, user: updated });
});

// PROMOTE USER TO ADMINISTRATOR
app.post('/api/admin/promote', async (req, res) => {
  const caller = getAuthUser(req);
  const callerRole = String(caller?.tipo || caller?.rol || '').trim().toLowerCase();
  if (!caller || (callerRole !== 'moderador' && callerRole !== 'admin' && callerRole !== 'administrador')) {
    return res.status(403).json({ error: 'Solo los administradores oficiales pueden designar nuevos administradores.' });
  }

  const rawIdentifier = req.body?.identifier || req.body?.username || req.body?.email;
  const cleanIdentifier = String(rawIdentifier || '').trim().replace(/^@+/, '').trim();
  if (!cleanIdentifier) {
    return res.status(400).json({ error: 'Nombre de usuario o correo electrónico requerido.' });
  }

  const updated = db.makeUserAdmin(cleanIdentifier);

  if (serverSupabase) {
    try {
      const { data: rows } = await serverSupabase
        .from('users')
        .select('id, usuario, email, apodo, tipo, rol, estado_alta, notifications')
        .or(`email.ilike.${cleanIdentifier},usuario.ilike.${cleanIdentifier},id.eq.${cleanIdentifier}`)
        .neq('estado_alta', 'eliminado')
        .limit(10);

      const cleanLower = cleanIdentifier.toLowerCase();
      const sbTarget = Array.isArray(rows)
        ? rows.find(
            (r: any) =>
              String(r.email || '').trim().toLowerCase() === cleanLower ||
              String(r.usuario || '').trim().toLowerCase().replace(/^@+/, '') === cleanLower ||
              String(r.id || '').trim().toLowerCase() === cleanLower
          )
        : null;

      if (sbTarget) {
        await serverSupabase
          .from('users')
          .update({
            tipo: 'moderador',
            rol: 'moderador',
            is_verified: true,
            estado_alta: 'aprobada',
            entidad_tipo: null,
            cuit: null,
            legal_representative: null,
            contacto_institucional: null,
            documento_cuit_url: null,
            documento_personeria_url: null
          })
          .eq('id', sbTarget.id);

        // Remover automáticamente cualquier membresía grupal en Supabase (manteniendo chats privados)
        try {
          const { data: sbMemberships } = await serverSupabase
            .from('chat_participants')
            .select('chat_id, chats:chat_id ( id, tipo )')
            .eq('user_id', sbTarget.id);
          if (Array.isArray(sbMemberships) && sbMemberships.length > 0) {
            const grpIds = sbMemberships
              .map((row: any) => {
                const c = Array.isArray(row?.chats) ? row.chats[0] : row?.chats;
                if (!c || c.tipo === 'privado') return null;
                return String(row.chat_id || c.id || '').trim();
              })
              .filter((cid): cid is string => Boolean(cid));
            if (grpIds.length > 0) {
              await serverSupabase
                .from('chat_participants')
                .delete()
                .eq('user_id', sbTarget.id)
                .in('chat_id', grpIds);
            }
          }
        } catch (cleanMemErr) {
          console.warn('Aviso limpiando grupos en serverSupabase al promover administrador:', cleanMemErr);
        }
      }
    } catch (sbErr) {
      console.warn('Error sincronizando designación de administrador en serverSupabase:', sbErr);
    }
  }

  if (!updated) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  res.json({ success: true, user: updated, message: `El usuario ${updated.apodo} ahora es Administrador Oficial.` });
});

// ================= ADMIN BANS & SANCTIONS ROUTES =================
app.get('/api/admin/sanctions', (_req, res) => {
  res.json(db.getSanctions());
});

app.post('/api/admin/sanctions', (req, res) => {
  const user = getAuthUser(req);
  const { username, reason, comment, type, liftDate, reportId } = req.body;
  if (!username || !reason) {
    return res.status(400).json({ error: 'Usuario y motivo requeridos.' });
  }

  const sanction = db.addSanction({
    username,
    reason,
    comment,
    adminUsername: user?.usuario || 'administrador',
    type: type || 'permanente',
    liftDate,
    reportId
  });

  res.status(201).json({ success: true, sanction });
});

app.delete('/api/admin/sanctions/:username', (req, res) => {
  const username = req.params.username;
  db.removeSanction(username);
  res.json({ success: true, message: `Sanción levantada para ${username}.` });
});

app.get('/api/admin/banned', (_req, res) => {
  res.json({
    bannedUsers: db.getSanctions().map(s => s.username)
  });
});

app.post('/api/admin/ban', (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Identificador requerido.' });
  db.banUserGlobal(identifier);
  res.json({ success: true, message: `Usuario ${identifier} vetado correctamente.` });
});

app.post('/api/admin/unban', (req, res) => {
  const { identifier } = req.body;
  if (!identifier) return res.status(400).json({ error: 'Identificador requerido.' });
  db.unbanUserGlobal(identifier);
  res.json({ success: true, message: `Sanción levantada para ${identifier}.` });
});

// ================= SIMULATED EMAILS ROUTE =================
app.get('/api/simulated-emails', (_req, res) => {
  res.json(db.getSimulatedEmails());
});

// ================= SUPABASE STATUS & SYNC ROUTES =================
app.get('/api/supabase/status', async (_req, res) => {
  const health = await getSupabaseHealth();
  res.json(health);
});

app.post('/api/supabase/sync', async (_req, res) => {
  const ok = await syncSeedToSupabase();
  res.json({ success: ok });
});


// Ensure unmatched /api/* routes never fall through to HTML SPA fallback
app.all('/api/*', (_req, res) => {
  res.status(404).json({ error: 'Ruta de API no encontrada.' });
});

app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error en ruta /api:', err);
  res.status(err?.status || 500).json({ error: err?.message || 'Error interno del servidor.' });
});

// ================= VITE DEV / PRODUCTION STATIC =================
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`CLUB65 Server listening on http://0.0.0.0:${PORT}`);
  });

  server.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer();
