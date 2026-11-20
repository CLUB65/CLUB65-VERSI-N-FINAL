import fs from 'node:fs';
import path from 'node:path';
import type { User, Activity, ChatMessage, Chat, Review, Contact, SecurityReport, SanctionRecord, SimulatedEmail, BajaRecord, CancelledGroupNotice, PasswordResetRequest } from '../types.ts';
import { formatArgentinaDateTime, formatArgentinaDateOnly, formatArgentinaTimeOnly } from '../utils/argentinaTime.ts';
import { deduplicateMessages } from '../utils/chatLogic.ts';
import {
  findPromotableUserCandidate,
  applyAdminPromotionToLocalUser,
  isOfficialAdminRow
} from '../utils/adminPromotion.ts';
import {
  ADMIN_REMOVED_REVIEW_TEXT,
  RETIRED_REVIEW_MEDIA_MARKER,
  replaceMediaUrlWithRetiredMarker
} from '../utils/reportsAndSanctions.ts';

export type { User, Activity, ChatMessage, Chat, Review, Contact, SecurityReport, SanctionRecord, SimulatedEmail, BajaRecord, CancelledGroupNotice, PasswordResetRequest };

export interface DatabaseSchema {
  users: Record<string, User>;
  activities: Activity[];
  chats: Record<string, Chat>;
  reviews: Review[];
  contacts: Contact[];
  bannedUsers: string[];
  sanctions: SanctionRecord[];
  reports: SecurityReport[];
  simulatedEmails?: SimulatedEmail[];
  passwordResetRequests?: PasswordResetRequest[];
  bajas?: BajaRecord[];
  cancelledGroupNotices?: CancelledGroupNotice[];
}

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DB_DIR, 'club65_db.json');

const INITIAL_DATA: DatabaseSchema = {
  users: {},
  activities: [],
  chats: {},
  reviews: [],
  contacts: [],
  bannedUsers: [],
  sanctions: [],
  reports: [],
  simulatedEmails: [],
  passwordResetRequests: [],
  bajas: [],
  cancelledGroupNotices: []
};

let inMemoryCache: DatabaseSchema | null = null;

function ensureDbFile(): DatabaseSchema {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
  } catch (e) {}

  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = inMemoryCache || { ...INITIAL_DATA };
      try {
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      } catch (e) {}
      inMemoryCache = initial;
      return initial;
    }

    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed: DatabaseSchema = JSON.parse(raw);

    if (!parsed.users) parsed.users = {};
    if (!parsed.activities) parsed.activities = [];
    if (!parsed.chats) parsed.chats = {};
    if (!parsed.reviews) parsed.reviews = [];
    if (!parsed.contacts) parsed.contacts = inMemoryCache?.contacts || [];
    if (!parsed.bannedUsers) parsed.bannedUsers = [];
    if (!parsed.sanctions) parsed.sanctions = [];
    if (!parsed.reports) parsed.reports = [];
    if (!parsed.simulatedEmails) parsed.simulatedEmails = [];
    if (!parsed.passwordResetRequests) parsed.passwordResetRequests = [];
    if (!parsed.bajas) parsed.bajas = [];
    if (!parsed.cancelledGroupNotices) parsed.cancelledGroupNotices = [];

    inMemoryCache = parsed;
    return parsed;
  } catch (err) {
    if (!inMemoryCache) {
      inMemoryCache = { ...INITIAL_DATA };
    }
    return inMemoryCache;
  }
}

function saveDb(data: DatabaseSchema): void {
  inMemoryCache = data;
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    // Si el entorno web bloquea o rompe el archivo, la app sigue viva con los datos en memoria
  }
}

export const db = {
  getUsers(): Record<string, User> {
    const data = ensureDbFile();
    return data.users;
  },

  getUser(id: string): User | undefined {
    const data = ensureDbFile();
    return data.users[id];
  },

  findUserByCredentials(usuarioOrEmail: string, clave: string): User | undefined {
    const data = ensureDbFile();
    const u = usuarioOrEmail.trim().toLowerCase();
    return Object.values(data.users).find(
      user => (user.usuario.trim().toLowerCase() === u || (user.email && user.email.trim().toLowerCase() === u)) && user.clave === clave
    );
  },

  findUserByUsername(usuario: string): User | undefined {
    const data = ensureDbFile();
    const u = usuario.trim().toLowerCase();
    return Object.values(data.users).find(
      user => user.usuario.trim().toLowerCase() === u
    );
  },

  findUserByEmail(email: string): User | undefined {
    const data = ensureDbFile();
    const em = email.trim().toLowerCase();
    return Object.values(data.users).find(
      user => (user.email && user.email.trim().toLowerCase() === em) || (user.usuario.trim().toLowerCase() === em)
    );
  },

  createPasswordResetRequest(emailOrUsername: string): { request: PasswordResetRequest; user: User } | null {
    const data = ensureDbFile();
    const target = emailOrUsername.trim().toLowerCase();
    const user = Object.values(data.users).find(
      u => (u.email && u.email.trim().toLowerCase() === target) || (u.usuario.trim().toLowerCase() === target)
    );
    if (!user) return null;

    if (!data.passwordResetRequests) {
      data.passwordResetRequests = [];
    }

    const targetEmail = (user.email || `${user.usuario}@correo.club65.ar`).trim().toLowerCase();

    // Invalidate prior pending requests for this email
    data.passwordResetRequests = data.passwordResetRequests.filter(r => r.email.toLowerCase() !== targetEmail);

    // Generate 6-digit verification code & token
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const token = `rst_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    const request: PasswordResetRequest = {
      id: `req_${Date.now()}`,
      email: targetEmail,
      username: user.usuario,
      code,
      token,
      expiresAt,
      verified: false,
      createdAt: formatArgentinaDateTime(new Date())
    };

    data.passwordResetRequests.push(request);

    db.addSimulatedEmail({
      to: targetEmail,
      subject: 'CLUB65 - Código de confirmación para restablecer contraseña',
      body: `Hola ${user.apodo}:\n\nHemos recibido una solicitud para restablecer la contraseña de tu cuenta (@${user.usuario}) en CLUB65.\n\nTu código de verificación de 6 dígitos es: ${code}\n\nEste código es confidencial y vence en 15 minutos. Ingresalo en la pantalla de recuperación para confirmar tu identidad antes de cambiar tu contraseña.\n\nSi no fuiste vos quien solicitó este cambio, no te preocupes: tu cuenta sigue protegida.\n\nAtentamente,\nEquipo de Seguridad de CLUB65`
    });

    saveDb(data);
    return { request, user };
  },

  verifyPasswordResetCode(emailOrUsername: string, code: string): { success: boolean; error?: string; token?: string; user?: { usuario: string; apodo: string; email: string } } {
    const data = ensureDbFile();
    const target = emailOrUsername.trim().toLowerCase();
    const user = Object.values(data.users).find(
      u => (u.email && u.email.trim().toLowerCase() === target) || (u.usuario.trim().toLowerCase() === target)
    );
    if (!user) {
      return { success: false, error: 'No se encontró ninguna cuenta asociada a este correo electrónico.' };
    }

    const targetEmail = (user.email || `${user.usuario}@correo.club65.ar`).trim().toLowerCase();
    const requests = (data.passwordResetRequests || []).filter(r => r.email.toLowerCase() === targetEmail);
    if (requests.length === 0) {
      return { success: false, error: 'No hay ninguna solicitud de recuperación pendiente. Por favor solicitá un código nuevo.' };
    }

    const latest = requests[requests.length - 1];
    if (latest.expiresAt < Date.now()) {
      return { success: false, error: 'El código ha expirado. Por favor solicitá uno nuevo.' };
    }

    if (latest.code !== code.trim()) {
      return { success: false, error: 'El código de verificación es incorrecto. Revisá el correo que te enviamos.' };
    }

    latest.verified = true;
    saveDb(data);

    return {
      success: true,
      token: latest.token,
      user: {
        usuario: user.usuario,
        apodo: user.apodo,
        email: targetEmail
      }
    };
  },

  completePasswordReset(emailOrUsername: string, token: string, newClave: string): { success: boolean; error?: string; user?: User } {
    const data = ensureDbFile();
    const target = emailOrUsername.trim().toLowerCase();
    const user = Object.values(data.users).find(
      u => (u.email && u.email.trim().toLowerCase() === target) || (u.usuario.trim().toLowerCase() === target)
    );
    if (!user) {
      return { success: false, error: 'No se encontró la cuenta para restablecer la contraseña.' };
    }

    const targetEmail = (user.email || `${user.usuario}@correo.club65.ar`).trim().toLowerCase();
    const reqIndex = (data.passwordResetRequests || []).findIndex(
      r => r.email.toLowerCase() === targetEmail && r.token === token && r.verified && r.expiresAt >= Date.now()
    );

    if (reqIndex === -1) {
      return { success: false, error: 'La confirmación por correo no es válida o ha expirado. Por razones de seguridad, iniciá el proceso de recuperación nuevamente.' };
    }

    user.clave = newClave;
    // Consume the token so it cannot be used again
    data.passwordResetRequests!.splice(reqIndex, 1);

    db.addSimulatedEmail({
      to: targetEmail,
      subject: 'CLUB65 - Tu contraseña ha sido actualizada',
      body: `Hola ${user.apodo}:\n\nTe informamos que tu contraseña en CLUB65 fue restablecida exitosamente.\nSi no realizaste este cambio, por favor contactá al soporte de CLUB65 de inmediato.\n\nAtentamente,\nEquipo de Seguridad de CLUB65`
    });

    saveDb(data);
    return { success: true, user };
  },

  resetUserPassword(emailOrUsername: string, newClave: string): User | undefined {
    const data = ensureDbFile();
    const target = emailOrUsername.trim().toLowerCase();
    const user = Object.values(data.users).find(
      u => (u.email && u.email.trim().toLowerCase() === target) || (u.usuario.trim().toLowerCase() === target)
    );
    if (!user) return undefined;
    user.clave = newClave;
    db.addSimulatedEmail({
      to: user.email || `${user.usuario}@correo.club65.ar`,
      subject: 'CLUB65 - Tu contraseña ha sido actualizada',
      body: `Hola ${user.apodo}:\n\nTe informamos que tu contraseña en CLUB65 fue restablecida exitosamente.\nSi no realizaste este cambio, por favor contactá al soporte de CLUB65.\n\nAtentamente,\nEquipo de CLUB65`
    });
    saveDb(data);
    return user;
  },

  getPublicUser(identifier: string): { id: string; usuario: string; apodo: string; avatar?: string; bio: string; tipo: string; localidad?: string } | undefined {
    const data = ensureDbFile();
    const clean = identifier.replace(/^@/, '').trim().toLowerCase();
    const u = Object.values(data.users).find(
      user => user.usuario.toLowerCase() === clean || user.apodo.toLowerCase() === clean || user.id.toLowerCase() === clean
    );
    if (!u) return undefined;
    return {
      id: u.id,
      usuario: u.usuario,
      apodo: u.apodo,
      avatar: u.avatar,
      bio: u.bio,
      tipo: u.tipo,
      localidad: u.localidad
    };
  },

  createUser(user: Omit<User, 'id' | 'createdAt'>): User {
    const data = ensureDbFile();
    const id = `user_${Date.now()}`;
    const newUser: User = {
      ...user,
      id,
      blockedUsers: [],
      notifications: [],
      createdAt: new Date().toISOString()
    };
    data.users[id] = newUser;
    saveDb(data);
    return newUser;
  },

  updateUser(id: string, updates: Partial<User>): User | undefined {
    const data = ensureDbFile();
    const oldUser = data.users[id];
    if (!oldUser) return undefined;
    
    const oldApodo = oldUser.apodo;
    const oldUsername = oldUser.usuario;
    const newApodo = updates.apodo || oldApodo;
    const newBio = updates.bio !== undefined ? updates.bio : oldUser.bio;

    data.users[id] = { ...oldUser, ...updates };

    if (updates.avatar && updates.avatar !== oldUser.avatar) {
      const newAv = updates.avatar;
      Object.values(data.chats).forEach(chat => {
        chat.messages.forEach(msg => {
          if (msg.senderId === id || msg.senderId === oldUsername || msg.sender === oldApodo || msg.sender === newApodo) {
            msg.avatar = newAv;
          }
        });
      });
      if (data.contacts) {
        data.contacts.forEach(c => {
          if (c.id === id || c.nombre.toLowerCase() === oldApodo.toLowerCase() || c.nombre.toLowerCase() === newApodo.toLowerCase()) {
            c.foto = newAv;
            c.avatar = newAv;
          }
        });
      }
      if (data.reviews) {
        data.reviews.forEach(rev => {
          if (rev.autor.toLowerCase() === oldApodo.toLowerCase() || rev.autor.toLowerCase() === newApodo.toLowerCase()) {
            rev.foto = newAv;
          }
        });
      }
    }

    if (updates.apodo && updates.apodo !== oldApodo) {
      Object.values(data.chats).forEach(chat => {
        if (chat.creatorId === id) {
          chat.creatorName = newApodo;
        }
        if (chat.participants) {
          chat.participants = chat.participants.map(p => p === oldApodo ? newApodo : p);
        }
        chat.messages.forEach(msg => {
          if (msg.senderId === id || msg.senderId === oldUsername || msg.sender === oldApodo) {
            msg.sender = newApodo;
          }
        });
      });

      data.activities.forEach(act => {
        if (act.organizerId === id) {
          act.organizer = newApodo;
          act.organizerBio = newBio;
        }
      });

      data.reviews.forEach(rev => {
        if (rev.autor === oldApodo) {
          rev.autor = newApodo;
        }
      });
    }

  saveDb(data);

  // Sincronizar en la tabla users de Supabase
  try {
    const supabaseClient = (globalThis as any).supabase || (db as any).supabase;
    if (supabaseClient) {
      const updateData: any = {};
      if (updates.apodo !== undefined) updateData.apodo = updates.apodo;
      if (updates.bio !== undefined) updateData.bio = updates.bio;
      if (updates.avatar !== undefined) updateData.avatar = updates.avatar;
      if (updates.textSize !== undefined) updateData.text_size = updates.textSize;
      if (updates.contrast !== undefined) updateData.contrast = Boolean(updates.contrast);
      if (updates.contactoEmergencia !== undefined) {
        updateData.contacto_emergencia = updates.contactoEmergencia;
      }

      if (Object.keys(updateData).length > 0) {
        supabaseClient
          .from('users')
          .update(updateData)
          .eq('id', id)
          .then(({ error }: any) => {
            if (error) console.error('Error al actualizar en Supabase:', error);
          });
      }
    }
  } catch (err) {
    console.error('Error sincronizando con Supabase:', err);
  }

  return data.users[id];
},

  saveUser(user: User): void {
    const data = ensureDbFile();
    data.users[user.id] = user;
    saveDb(data);
  },

  blockUser(userId: string, targetUsername: string): boolean {
    const data = ensureDbFile();
    let user = data.users[userId];
    if (!user) {
      user = Object.values(data.users).find(u => u.id === userId || u.usuario === userId || u.apodo === userId) as any;
    }
    if (!user) {
      user = {
        id: userId,
        usuario: userId,
        clave: '',
        apodo: userId,
        bio: '',
        textSize: 'normal',
        contrast: false,
        tipo: 'personal',
        isVerified: false,
        blockedUsers: [],
        notifications: [],
        createdAt: new Date().toISOString()
      };
      data.users[userId] = user;
    }
    if (!user.blockedUsers) user.blockedUsers = [];
    const lowerTarget = targetUsername.trim().toLowerCase();

    const targetObj = Object.values(data.users).find(
      u => u.id.toLowerCase() === lowerTarget || u.usuario.toLowerCase() === lowerTarget || u.apodo.toLowerCase() === lowerTarget
    );
    const toAdd = [lowerTarget];
    if (targetObj) {
      toAdd.push(targetObj.id.toLowerCase());
      toAdd.push(targetObj.usuario.toLowerCase());
      toAdd.push(targetObj.apodo.toLowerCase());
    }
    toAdd.forEach(t => {
      if (!user!.blockedUsers!.includes(t)) {
        user!.blockedUsers!.push(t);
      }
    });
    saveDb(data);
    return true;
  },

  unblockUser(userId: string, targetUsername: string): boolean {
    const data = ensureDbFile();
    let user = data.users[userId];
    if (!user) {
      user = Object.values(data.users).find(u => u.id === userId || u.usuario === userId || u.apodo === userId) as any;
    }
    if (!user || !user.blockedUsers) return true;
    const lowerTarget = targetUsername.trim().toLowerCase();
    const targetObj = Object.values(data.users).find(
      u => u.id.toLowerCase() === lowerTarget || u.usuario.toLowerCase() === lowerTarget || u.apodo.toLowerCase() === lowerTarget
    );
    const toRemove = [lowerTarget];
    if (targetObj) {
      toRemove.push(targetObj.id.toLowerCase());
      toRemove.push(targetObj.usuario.toLowerCase());
      toRemove.push(targetObj.apodo.toLowerCase());
    }
    user.blockedUsers = user.blockedUsers.filter(u => !toRemove.includes(u.toLowerCase()));
    saveDb(data);
    return true;
  },

  isUserBlocked(userA: string, userB: string): boolean {
    const data = ensureDbFile();
    const aLower = (userA || '').trim().toLowerCase();
    const bLower = (userB || '').trim().toLowerCase();
    if (!aLower || !bLower) return false;

    // Find userA and userB objects
    const uA = Object.values(data.users).find(
      u => u.id.toLowerCase() === aLower || u.usuario.toLowerCase() === aLower || u.apodo.toLowerCase() === aLower
    );
    const uB = Object.values(data.users).find(
      u => u.id.toLowerCase() === bLower || u.usuario.toLowerCase() === bLower || u.apodo.toLowerCase() === bLower
    );

    const aBlocksB = uA?.blockedUsers?.some(
      b => b.toLowerCase() === bLower || (uB && (b.toLowerCase() === uB.usuario.toLowerCase() || b.toLowerCase() === uB.apodo.toLowerCase() || b.toLowerCase() === uB.id.toLowerCase()))
    );

    const bBlocksA = uB?.blockedUsers?.some(
      b => b.toLowerCase() === aLower || (uA && (b.toLowerCase() === uA.usuario.toLowerCase() || b.toLowerCase() === uA.apodo.toLowerCase() || b.toLowerCase() === uA.id.toLowerCase()))
    );

    return Boolean(aBlocksB || bBlocksA);
  },

  addNotification(usernameOrId: string, text: string): void {
    const data = ensureDbFile();
    const lower = usernameOrId.trim().toLowerCase();
    const user = Object.values(data.users).find(
      u => u.id.toLowerCase() === lower || u.usuario.toLowerCase() === lower || u.apodo.toLowerCase() === lower
    );
    if (user) {
      if (!user.notifications) user.notifications = [];
      user.notifications.unshift({
        id: `notif_${Date.now()}_${Math.random()}`,
        text,
        time: 'Recién',
        read: false
      });
      saveDb(data);
    }
  },

  getActivities(): Activity[] {
    const data = ensureDbFile();
    return data.activities;
  },

  getActivityById(id: number | string): Activity | undefined {
    const data = ensureDbFile();
    return data.activities.find(a => String(a.id) === String(id));
  },

  createActivity(act: Omit<Activity, 'id'>): Activity {
    const data = ensureDbFile();
    const id = Date.now();
    const nowStr = formatArgentinaDateTime();
    const newAct: Activity = {
      ...act,
      id,
      proposedAt: act.proposedAt || nowStr,
      proposedTimestamp: Date.now(),
      versions: act.versions || [
        {
          version: 1,
          date: act.proposedAt || nowStr,
          title: act.title,
          schedule: act.schedule,
          location: act.location,
          lat: act.lat,
          lng: act.lng,
          capacity: act.capacity,
          description: act.description,
          shortDescription: act.shortDescription,
          image: act.image,
          ...(act.videoUrl ? { videoUrl: act.videoUrl } : {}),
          isRecurrent: Boolean(act.isRecurrent),
          note: 'Versión original de la propuesta'
        }
      ]
    };
    data.activities.unshift(newAct);
    saveDb(data);
    return newAct;
  },

  updateActivity(id: number | string, updates: Partial<Activity>): Activity | undefined {
    const data = ensureDbFile();
    const idx = data.activities.findIndex(a => String(a.id) === String(id));
    if (idx === -1) return undefined;
    const nowStr = formatArgentinaDateTime();
    const merged = { ...data.activities[idx], ...updates };
    if (updates.proposalStatus === 'cambios_solicitados') {
      merged.changesRequestedAt = nowStr;
    }
    data.activities[idx] = merged;
    saveDb(data);
    return data.activities[idx];
  },

  deleteActivity(id: number): boolean {
    const data = ensureDbFile();
    const act = data.activities.find(a => a.id === id);
    if (!act) return false;

    const nowStr = formatArgentinaDateTime();
    act.isApproved = false;
    act.proposalStatus = 'cancelada_organizador';
    act.canceladaPorOrganizador = true;
    act.cancelDate = nowStr;

    // Group ceases to exist and participants receive notice in recent messages
    const chatKey = Object.keys(data.chats).find(
      k => data.chats[k].activityId === id || Number(k) === id
    );
    const chat = chatKey ? data.chats[chatKey] : undefined;
    const participants = Array.from(new Set([
      ...(chat?.participants || []),
      ...(act.enrolledUsernames || [])
    ]));

    if (!data.cancelledGroupNotices) data.cancelledGroupNotices = [];
    data.cancelledGroupNotices = data.cancelledGroupNotices.filter(n => n.activityId !== act.id);
    data.cancelledGroupNotices.unshift({
      id: `cnotif_${Date.now()}_${act.id}`,
      activityId: act.id,
      activityTitle: act.title,
      message: `Ya no formas parte del grupo ${act.title} porque la actividad fue cancelada.`,
      date: nowStr,
      participants
    });

    if (chatKey) {
      delete data.chats[chatKey];
    }

    if (act.enrolledUsernames) {
      act.enrolledUsernames.forEach(username => {
        db.addNotification(username, `Aviso: La actividad "${act.title}" a la que asistías fue cancelada por su organizador.`);
      });
    }

    saveDb(data);
    return true;
  },

  enrollActivity(id: number | string, username: string, apodo?: string): Activity | undefined {
    const data = ensureDbFile();
    const act = data.activities.find(a => String(a.id) === String(id));
    if (!act) return undefined;

    const matchedUser = Object.values(data.users).find(
      u => u.usuario.toLowerCase() === username.toLowerCase() || (apodo && u.apodo.toLowerCase() === apodo.toLowerCase())
    );
    const userApodo = apodo || (matchedUser ? matchedUser.apodo : username);

    if (!act.enrolledUsernames) act.enrolledUsernames = [];
    if (!act.enrolledUsernames.includes(username)) {
      act.enrolledUsernames.push(username);
      act.enrolledCount = act.enrolledUsernames.length;
    }

    // Sync into the activity's group chat (or create it if it doesn't exist)
    const chatKey = Object.keys(data.chats).find(
      k => String(data.chats[k].activityId) === String(act.id) || String(data.chats[k].id) === String(act.id) || String(k) === String(act.id) || k === `activity_${act.id}`
    );
    if (chatKey) {
      const chat = data.chats[chatKey];
      if (!chat.participants) chat.participants = [];
      const participantsSet = new Set(chat.participants);
      participantsSet.add(userApodo);
      if (username) participantsSet.add(username);
      chat.participants = Array.from(participantsSet);
    } else {
      const newKey = `activity_${act.id}`;
      const newChat: Chat = {
        id: act.id,
        title: act.title,
        subtitle: `Canal vecinal de ${act.title}`,
        type: 'grupal',
        activityId: act.id,
        organizerId: act.organizerId || 'organizador',
        creatorId: act.organizerId || 'organizador',
        creatorName: act.organizer || '',
        adminUsernames: [act.organizer].filter(Boolean),
        allowedRoles: ['personal', 'institucional'],
        participants: Array.from(new Set([act.organizer, userApodo, username].filter((p: any) => Boolean(p) && !['sistema club65', 'sistema', 'organizador', 'admin'].includes(String(p).toLowerCase().trim())))),
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
            text: `¡${userApodo} se unió a la actividad!`,
            time: 'Recién'
          }
        ]
      };
      data.chats[newKey] = newChat;
    }

    saveDb(data);
    return act;
  },

  unenrollActivity(id: number | string, username: string, apodo?: string): Activity | undefined {
    const data = ensureDbFile();
    const act = data.activities.find(a => String(a.id) === String(id));
    if (!act) return undefined;

    const matchedUser = Object.values(data.users).find(
      u => u.usuario.toLowerCase() === username.toLowerCase() || (apodo && u.apodo.toLowerCase() === apodo.toLowerCase())
    );
    const userApodo = apodo || (matchedUser ? matchedUser.apodo : username);

    if (act.enrolledUsernames) {
      act.enrolledUsernames = act.enrolledUsernames.filter(
        u => u.toLowerCase() !== username.toLowerCase() && (!apodo || u.toLowerCase() !== apodo.toLowerCase())
      );
      act.enrolledCount = act.enrolledUsernames.length;
    }

    // Remove from chat
    const chatKey = Object.keys(data.chats).find(
      k => String(data.chats[k].activityId) === String(act.id) || String(data.chats[k].id) === String(act.id) || String(k) === String(act.id) || k === `activity_${act.id}`
    );
    if (chatKey) {
      const chat = data.chats[chatKey];
      if (chat.participants) {
        chat.participants = chat.participants.filter(
          p => p.toLowerCase() !== userApodo.toLowerCase() && p.toLowerCase() !== username.toLowerCase()
        );
      }
    }

    saveDb(data);
    return act;
  },

  resubmitActivityProposal(id: number | string, updates: Partial<Activity> & { userFeedbackNote?: string }): Activity | undefined {
    const data = ensureDbFile();
   const act = data.activities.find(a => String(a.id) === String(id));
    if (!act) return undefined;

    const nowStr = formatArgentinaDateTime();

    if (!act.versions || act.versions.length === 0) {
      act.versions = [
        {
          version: 1,
          date: act.proposedAt || nowStr,
          title: act.title,
          schedule: act.schedule,
          location: act.location,
          lat: act.lat,
          lng: act.lng,
          capacity: act.capacity,
          description: act.description,
          shortDescription: act.shortDescription,
          image: act.image,
          ...(act.videoUrl ? { videoUrl: act.videoUrl } : {}),
          isRecurrent: act.isRecurrent,
          note: 'Versión original de la propuesta',
          moderationNote: act.proposalNote,
          moderationDate: act.changesRequestedAt
        }
      ];
    } else {
      if (act.versions[0] && !act.versions[0].moderationNote && act.proposalNote) {
        act.versions[0].moderationNote = act.proposalNote;
        act.versions[0].moderationDate = act.changesRequestedAt;
      }
      if (act.versions[0] && act.versions[0].isRecurrent === undefined) {
        act.versions[0].isRecurrent = act.isRecurrent;
      }
    }

    Object.assign(act, updates);
    act.proposalStatus = 'pendiente';
    act.isApproved = false;
    act.changesSubmittedAt = nowStr;
    act.changesSubmittedTimestamp = Date.now();
    if (updates.userFeedbackNote) {
      act.userFeedbackNote = updates.userFeedbackNote;
    }

    const nextVerNum = act.versions.length + 1;
    act.versions.push({
      version: nextVerNum,
      date: nowStr,
      title: act.title,
      schedule: act.schedule,
      location: act.location,
      lat: act.lat,
      lng: act.lng,
      capacity: act.capacity,
      description: act.description,
      shortDescription: act.shortDescription,
      image: act.image,
      videoUrl: act.videoUrl || '',
      isRecurrent: act.isRecurrent,
      note: updates.userFeedbackNote || 'Modificaciones enviadas por el organizador'
    });

    db.addNotification(
      'administrador',
      `El vecino ${act.organizer} reenvió con modificaciones la actividad "${act.title}".`
    );

    saveDb(data);
    return act;
  },

  vetoUserFromActivity(id: number, username: string): Activity | undefined {
    const data = ensureDbFile();
    const act = data.activities.find(a => a.id === id);
    if (!act) return undefined;

    const lowerTarget = username.trim().toLowerCase();
    const matchedUser = Object.values(data.users).find(
      u => u.usuario.toLowerCase() === lowerTarget || u.apodo.toLowerCase() === lowerTarget
    );
    const namesToVeto = [lowerTarget];
    if (matchedUser) {
      namesToVeto.push(matchedUser.usuario.toLowerCase());
      namesToVeto.push(matchedUser.apodo.toLowerCase());
    }

    if (!act.vettedUsers) act.vettedUsers = [];
    namesToVeto.forEach(n => {
      if (!act.vettedUsers.includes(n)) act.vettedUsers.push(n);
    });

    if (act.enrolledUsernames) {
      act.enrolledUsernames = act.enrolledUsernames.filter(
        u => !namesToVeto.includes(u.trim().toLowerCase())
      );
      act.enrolledCount = act.enrolledUsernames.length;
    } else {
      act.enrolledCount = Math.max(0, (act.enrolledCount || 1) - 1);
    }

    const chatKey = Object.keys(data.chats).find(k => data.chats[k].activityId === id);
    if (chatKey && data.chats[chatKey].participants) {
      const ch = data.chats[chatKey];
      const wasParticipant = (ch.participants || []).some(p => namesToVeto.includes(p.trim().toLowerCase()));
      if (wasParticipant) {
        if (!ch.participantsSnapshotOnRemoval) {
          ch.participantsSnapshotOnRemoval = {};
        }
        const snapshotBeforeRemoval = [...(ch.participants || [])];
        namesToVeto.forEach(n => {
          if (!ch.participantsSnapshotOnRemoval![n]) {
            ch.participantsSnapshotOnRemoval![n] = snapshotBeforeRemoval;
          }
        });
        if (!ch.removedParticipants) ch.removedParticipants = [];
        if (!ch.vetoedParticipants) ch.vetoedParticipants = [];
        namesToVeto.forEach(n => {
          if (!ch.removedParticipants!.includes(n)) {
            ch.removedParticipants!.push(n);
          }
          if (!ch.vetoedParticipants!.includes(n)) {
            ch.vetoedParticipants!.push(n);
          }
        });
        ch.participants = (ch.participants || []).filter(
          p => !namesToVeto.includes(p.trim().toLowerCase())
        );
      }
    }

    if (matchedUser) {
      db.addNotification(
        matchedUser.usuario,
        `Fuiste vetado de esta actividad: "${act.title}". Ya no podés volver a inscribirte.`
      );
    }

    saveDb(data);
    return act;
  },

  getChats(): Record<string, Chat> {
    const data = ensureDbFile();
    return data.chats;
  },

  getChat(id: string | number): Chat | undefined {
    const data = ensureDbFile();
    if (data.chats[String(id)]) return data.chats[String(id)];
    return Object.values(data.chats).find(c => String(c.id) === String(id) || (c.activityId && String(c.activityId) === String(id)));
  },

  addChatMessage(chatId: string | number, msg: ChatMessage): ChatMessage | undefined {
    const data = ensureDbFile();
    let chat: Chat | undefined = data.chats[String(chatId)];
    if (!chat) {
      chat = Object.values(data.chats).find(c => String(c.id) === String(chatId) || (c.activityId && String(c.activityId) === String(chatId)));
    }
    if (!chat) return undefined;

    const nowMs = Date.now();
    const createdIso = msg.createdAt || new Date(nowMs).toISOString();
    const messageWithId = {
      ...msg,
      id: msg.id || `msg_${nowMs}_${Math.random().toString(36).substring(2, 7)}`,
      createdAt: createdIso,
      timestamp: msg.timestamp || nowMs
    };
    if (!chat.messages) chat.messages = [];
    chat.messages.push(messageWithId);
    chat.messages = deduplicateMessages(chat.messages);

    // Actualizar última actividad del chat
    (chat as any).updatedAt = createdIso;
    (chat as any).updated_at = createdIso;
    chat.lastMessage = msg.text || '';
    chat.lastMessageTime = msg.time || 'Recién';

    const sender = String(msg.sender || '').trim();
    const isSystem = msg.role === 'sistema' || sender.toLowerCase() === 'sistema club65' || msg.senderId === 'sistema';
    if (sender && !isSystem) {
      if (!chat.participants) chat.participants = [];
      const senderLow = sender.toLowerCase();
      if (!chat.participants.some(p => String(p).toLowerCase().trim() === senderLow)) {
        chat.participants.push(sender);
      }
    }

    saveDb(data);
    return messageWithId;
  },

  deleteChatMessage(chatId: string | number, messageId: string, deletedByAdmin = true, reasonText?: string, deletedByGroupModerator = false): boolean {
    const data = ensureDbFile();
    const chat = data.chats[String(chatId)];
    if (!chat) return false;

    const msg = chat.messages.find(m => m.id === messageId);
    if (!msg) return false;

    if (deletedByGroupModerator) {
      msg.deletedByGroupModerator = true;
      msg.deletedByAdmin = false;
      msg.text = 'Este mensaje fue retirado por el moderador del grupo';
    } else if (deletedByAdmin) {
      msg.deletedByGroupModerator = false;
      msg.deletedByAdmin = true;
      msg.text = reasonText || 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65';
    } else {
      msg.deletedByGroupModerator = false;
      msg.deletedByAdmin = false;
      msg.text = reasonText || 'Mensaje eliminado';
    }
    msg.isDeleted = true;

    saveDb(data);
    return true;
  },

  addChatParticipant(chatId: string | number, participantName: string, candidateTokens?: string[], messageId?: string): boolean {
    const data = ensureDbFile();
    let chat: Chat | undefined = data.chats[String(chatId)];
    if (!chat) {
      chat = Object.values(data.chats).find(c => String(c.id) === String(chatId) || (c.activityId && String(c.activityId) === String(chatId)));
    }
    if (!chat) return false;
    if (!chat.participants) chat.participants = [];

    const target = participantName.trim().toLowerCase();
    const matchedUser = Object.values(data.users).find(
      u => u.usuario.toLowerCase() === target || u.apodo.toLowerCase() === target || u.id.toLowerCase() === target
    );
    const matchedContact = data.contacts?.find(
      c => c.nombre.toLowerCase() === target || c.id.toLowerCase() === target
    );
    const targetsToClear = new Set<string>([target, participantName.trim()]);
    if (matchedUser) {
      targetsToClear.add(matchedUser.usuario.toLowerCase());
      targetsToClear.add(matchedUser.apodo.toLowerCase());
      targetsToClear.add(matchedUser.id.toLowerCase());
      targetsToClear.add(matchedUser.usuario);
      targetsToClear.add(matchedUser.apodo);
    }
    if (matchedContact) {
      targetsToClear.add(matchedContact.nombre.toLowerCase());
      targetsToClear.add(matchedContact.id.toLowerCase());
      targetsToClear.add(matchedContact.nombre);
    }
    if (candidateTokens && Array.isArray(candidateTokens)) {
      candidateTokens.forEach(tok => {
        if (tok) {
          targetsToClear.add(String(tok).trim());
          targetsToClear.add(String(tok).trim().toLowerCase());
        }
      });
    }

    if (chat.removedParticipants) {
      chat.removedParticipants = chat.removedParticipants.filter(p => !targetsToClear.has(p.trim().toLowerCase()) && !targetsToClear.has(p.trim()));
    }
    if (chat.leftVoluntarilyParticipants) {
      chat.leftVoluntarilyParticipants = chat.leftVoluntarilyParticipants.filter(p => !targetsToClear.has(p.trim().toLowerCase()) && !targetsToClear.has(p.trim()));
    }
    if (chat.vetoedParticipants) {
      chat.vetoedParticipants = chat.vetoedParticipants.filter(p => !targetsToClear.has(p.trim().toLowerCase()) && !targetsToClear.has(p.trim()));
    }
    if (chat.adminUsernames) {
      chat.adminUsernames = chat.adminUsernames.filter(a => !targetsToClear.has(a.trim().toLowerCase()) && !targetsToClear.has(a.trim()));
    }

    const displayName = matchedUser?.apodo || matchedContact?.nombre || participantName.trim();
    if (!chat.participants.some(p => targetsToClear.has(p.trim().toLowerCase()) || p.trim().toLowerCase() === displayName.toLowerCase())) {
      chat.participants.push(displayName);
    }

    const rawTitle = chat.name || (chat as any).activityTitle || (chat.activityId ? data.activities?.find(a => String(a.id) === String(chat.activityId))?.title : '') || 'la actividad';
    const cleanGroupName = String(rawTitle).replace(/^Grupo:\s*/i, '').trim();
    const noticeText = chat.activityId
      ? `¡Bienvenido a ${cleanGroupName}, ${displayName}!`
      : `${displayName} fue agregado al grupo por el moderador del grupo.`;

    if (!chat.messages) chat.messages = [];
    chat.messages.push({
      id: messageId || `sys_add_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      senderId: 'sistema',
      sender: 'Sistema CLUB65',
      avatar: '👋',
      role: 'sistema',
      text: noticeText,
      time: 'Ahora'
    });

    // If linked to an activity, also ensure the participant is in enrolledUsernames and cleared from vettedUsers
    if (chat.activityId) {
      const act = data.activities.find(a => String(a.id) === String(chat.activityId));
      if (act) {
        if (act.vettedUsers) {
          act.vettedUsers = act.vettedUsers.filter(u => !targetsToClear.has(u.trim().toLowerCase()));
        }
        if (!act.enrolledUsernames) act.enrolledUsernames = [];
        if (!act.enrolledUsernames.some(u => targetsToClear.has(u.trim().toLowerCase()))) {
          act.enrolledUsernames.push(displayName);
          act.enrolledCount = act.enrolledUsernames.length;
        }
      }
    }

    saveDb(data);
    return true;
  },

  removeChatParticipant(chatId: string | number, participantName: string, candidateTokens?: string[] | string, messageId?: string): boolean {
    const data = ensureDbFile();
    let chat: Chat | undefined = data.chats[String(chatId)];
    if (!chat) {
      chat = Object.values(data.chats).find(c =>
        String(c.id) === String(chatId) ||
        (c.activityId && String(c.activityId) === String(chatId)) ||
        ((c as any).actividad_id && String((c as any).actividad_id) === String(chatId))
      );
    }
    if (!chat) return false;
    if (!chat.participants) chat.participants = [];

    const target = participantName.trim().toLowerCase();
    const matchedUser = Object.values(data.users).find(
      u => u.usuario.toLowerCase() === target || u.apodo.toLowerCase() === target || u.id.toLowerCase() === target
    );
    const matchedContact = data.contacts?.find(
      c => c.nombre.toLowerCase() === target || c.id.toLowerCase() === target
    );
    const targetsToRemove = new Set<string>([target]);
    if (matchedUser) {
      targetsToRemove.add(matchedUser.usuario.toLowerCase());
      targetsToRemove.add(matchedUser.apodo.toLowerCase());
      targetsToRemove.add(matchedUser.id.toLowerCase());
    }
    if (matchedContact) {
      targetsToRemove.add(matchedContact.nombre.toLowerCase());
      targetsToRemove.add(matchedContact.nombre.split(' ')[0].toLowerCase());
    }
    if (Array.isArray(candidateTokens)) {
      candidateTokens.forEach(tok => {
        if (tok) {
          targetsToRemove.add(String(tok).trim().toLowerCase());
        }
      });
    } else if (typeof candidateTokens === 'string' && candidateTokens.trim()) {
      targetsToRemove.add(candidateTokens.trim().toLowerCase());
    }

    // Snapshot of participants right at the moment this user is removed
    if (!chat.participantsSnapshotOnRemoval) {
      chat.participantsSnapshotOnRemoval = {};
    }
    const snapshotBeforeRemoval = [...chat.participants];
    targetsToRemove.forEach(t => {
      if (!chat.participantsSnapshotOnRemoval![t]) {
        chat.participantsSnapshotOnRemoval![t] = snapshotBeforeRemoval;
      }
    });

    chat.participants = chat.participants.filter(p => !targetsToRemove.has(p.trim().toLowerCase()));
    if (chat.adminUsernames) {
      chat.adminUsernames = chat.adminUsernames.filter(a => !targetsToRemove.has(a.trim().toLowerCase()));
    }

    if (!chat.removedParticipants) chat.removedParticipants = [];
    targetsToRemove.forEach(t => {
      if (!chat.removedParticipants!.includes(t)) {
        chat.removedParticipants!.push(t);
      }
    });

    // Actualizar actividad vinculada si existe
    if (chat.activityId) {
      const act = data.activities.find(a => String(a.id) === String(chat.activityId));
      if (act && Array.isArray(act.enrolledUsernames)) {
        act.enrolledUsernames = act.enrolledUsernames.filter(u => !targetsToRemove.has(String(u).trim().toLowerCase()));
        act.enrolledCount = act.enrolledUsernames.length;
      }
    }

    // Add system notification message
    if (!chat.messages) chat.messages = [];
    chat.messages.push({
      id: messageId || `sys_rem_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      senderId: 'sistema',
      sender: 'Sistema CLUB65',
      avatar: '🛡️',
      role: 'sistema',
      text: `${participantName} fue retirado del grupo por el moderador del grupo.`,
      time: 'Ahora'
    });

    saveDb(data);
    return true;
  },

  updateChatPhoto(chatId: string | number, avatarUrl: string): boolean {
    const data = ensureDbFile();
    const chat = data.chats[String(chatId)];
    if (!chat) return false;

    chat.avatar = avatarUrl;
    chat.image = avatarUrl;
    saveDb(data);
    return true;
  },

  makeChatAdmin(chatId: string | number, participantName: string): boolean {
    const data = ensureDbFile();
    const chat = data.chats[String(chatId)];
    if (!chat) return false;

    if (!chat.adminUsernames) chat.adminUsernames = [];
    if (!chat.adminUsernames.includes(participantName)) {
      chat.adminUsernames.push(participantName);
      chat.messages.push({
        id: `sys_${Date.now()}`,
        senderId: 'sistema',
        sender: 'Sistema CLUB65',
        avatar: '⭐',
        role: 'sistema',
        text: `¡${participantName} fue designado administrador del grupo!`,
        time: 'Ahora'
      });
      saveDb(data);
    }
    return true;
  },

  createChat(chat: Omit<Chat, 'id'> & { id?: any }): Chat {
    const data = ensureDbFile();
    const id = (chat as any).id || Date.now();
    const newChat: Chat = { ...chat, id };
    data.chats[String(id)] = newChat;
    saveDb(data);
    return newChat;
  },

  deleteChat(id: string | number): boolean {
    const data = ensureDbFile();
    const strId = String(id);
    delete data.chats[strId];
    for (const k of Object.keys(data.chats)) {
      if (String(data.chats[k].id) === strId) {
        delete data.chats[k];
      }
    }
    saveDb(data);
    return true;
  },

  deleteChatForUser(chatId: string | number, userIdentifiers: string[]): boolean {
    const data = ensureDbFile();
    let chat: Chat | undefined = data.chats[String(chatId)];
    if (!chat) {
      chat = Object.values(data.chats).find(c => 
        String(c.id) === String(chatId) || (c.activityId && String(c.activityId) === String(chatId))
      );
    }
    if (!chat) return false;

    if (!chat.deletedForUserIds) {
      chat.deletedForUserIds = [];
    }
    userIdentifiers.forEach(ident => {
      const clean = ident.trim().toLowerCase();
      if (clean && !chat.deletedForUserIds!.includes(clean)) {
        chat.deletedForUserIds!.push(clean);
      }
    });

    saveDb(data);
    return true;
  },

  saveChat(chat: Chat): Chat {
    const data = ensureDbFile();
    data.chats[String(chat.id)] = chat;
    saveDb(data);
    return chat;
  },

  getReviews(): Review[] {
    const data = ensureDbFile();
    return data.reviews;
  },

  createReview(rev: Omit<Review, 'id'>): Review {
    const data = ensureDbFile();
    const id = Date.now();
    const newRev: Review = { ...rev, id };
    data.reviews.unshift(newRev);
    saveDb(data);
    return newRev;
  },

  updateReview(id: number, updates: Partial<Review>): Review | undefined {
    const data = ensureDbFile();
    const idx = data.reviews.findIndex(r => r.id === id);
    if (idx === -1) return undefined;
    data.reviews[idx] = { ...data.reviews[idx], ...updates };
    saveDb(data);
    return data.reviews[idx];
  },

  retireReview(id: number | string): Review | undefined {
    const data = ensureDbFile();
    const rev = data.reviews.find(r => String(r.id) === String(id));
    if (!rev) return undefined;
    rev.retiradoDeLaVista = true;
    rev.retirado_de_la_vista = true;
    rev.deletedByAdmin = true;
    rev.texto = ADMIN_REMOVED_REVIEW_TEXT;
    rev.media = [];
    rev.foto = null;
    saveDb(data);
    return rev;
  },

  deleteReview(id: number): boolean {
    const data = ensureDbFile();
    data.reviews = data.reviews.filter(r => r.id !== id);
    saveDb(data);
    return true;
  },

  getContacts(): Contact[] {
    const data = ensureDbFile();
    return data.contacts;
  },

  addContact(contact: Omit<Contact, 'id'>): Contact {
    const data = ensureDbFile();
    const id = `contact_${Date.now()}`;
    const newContact: Contact = { ...contact, id };
    data.contacts.push(newContact);
    saveDb(data);
    return newContact;
  },

  deleteContact(id: string, nombre?: string): boolean {
    const data = ensureDbFile();
    const cleanName = (nombre || '').toLowerCase().trim();
    data.contacts = data.contacts.filter(c => 
      c.id !== id && (!cleanName || (c.nombre || '').toLowerCase().trim() !== cleanName)
    );
    saveDb(data);
    return true;
  },

  leaveChat(chatId: string | number, usernameOrId: string, apodo?: string, userId?: string, extraTokens?: string[]): boolean {
    const data = ensureDbFile();
    let chat: Chat | undefined = data.chats[String(chatId)];
    if (!chat) {
      chat = Object.values(data.chats).find(c => 
        String(c.id) === String(chatId) || (c.activityId && String(c.activityId) === String(chatId))
      );
    }
    if (!chat) return false;

    const lowerTarget = usernameOrId.trim().toLowerCase();
    const lowerApodo = (apodo || '').trim().toLowerCase();
    const lowerId = (userId || '').trim().toLowerCase();
    const namesToLeave = [
      lowerTarget,
      lowerApodo,
      lowerId,
      ...(extraTokens || []).map(t => String(t).trim().toLowerCase())
    ].filter(Boolean);

    if (chat.participants) {
      if (!chat.participantsSnapshotOnRemoval) {
        chat.participantsSnapshotOnRemoval = {};
      }
      const snapshotBeforeLeaving = [...chat.participants];
      namesToLeave.forEach(n => {
        if (!chat.participantsSnapshotOnRemoval![n]) {
          chat.participantsSnapshotOnRemoval![n] = snapshotBeforeLeaving;
        }
      });

      if (!chat.removedParticipants) {
        chat.removedParticipants = [];
      }
      if (!chat.leftVoluntarilyParticipants) {
        chat.leftVoluntarilyParticipants = [];
      }
      namesToLeave.forEach(n => {
        if (!chat.removedParticipants!.includes(n)) {
          chat.removedParticipants!.push(n);
        }
        if (!chat.leftVoluntarilyParticipants!.includes(n)) {
          chat.leftVoluntarilyParticipants!.push(n);
        }
      });

      chat.participants = chat.participants.filter(p => {
        const lp = p.trim().toLowerCase();
        return !namesToLeave.includes(lp);
      });
    }

    if (chat.adminUsernames) {
      chat.adminUsernames = chat.adminUsernames.filter(a => !namesToLeave.includes(a.trim().toLowerCase()));
    }

    const isCreator = (
      chat.creatorId === userId ||
      chat.creatorId === usernameOrId ||
      chat.creatorName === apodo ||
      chat.creatorName === usernameOrId ||
      chat.organizerId === userId ||
      chat.organizerId === usernameOrId
    );

    if (isCreator) {
      if (chat.participants && chat.participants.length > 0) {
        chat.creatorName = chat.participants[0];
        const nextUser = Object.values(data.users).find(
          u => u.apodo.toLowerCase() === chat.participants![0].toLowerCase() || u.usuario.toLowerCase() === chat.participants![0].toLowerCase()
        );
        chat.creatorId = nextUser ? nextUser.id : undefined;
        chat.organizerId = nextUser ? nextUser.id : undefined;
      }
    }

    saveDb(data);
    return true;
  },

  // CHAT PINNING
  pinChatMessage(chatId: string | number, messageId: string | null): boolean {
    const data = ensureDbFile();
    const chat = data.chats[String(chatId)];
    if (!chat) return false;

    chat.pinnedMessageId = messageId || undefined;
    if (chat.messages) {
      chat.messages.forEach(m => {
        m.isPinned = messageId ? m.id === messageId : false;
      });
    }
    saveDb(data);
    return true;
  },

  // SECURITY REPORTS
  getSecurityReports(): SecurityReport[] {
    const data = ensureDbFile();
    return data.reports || [];
  },

  createSecurityReport(rep: Omit<SecurityReport, 'id' | 'timestamp' | 'status'>): SecurityReport {
    const data = ensureDbFile();
    const id = `rep_${Date.now()}`;
    let mediaUrls = rep.mediaUrls;
    let mediaUrl = rep.mediaUrl;
    if (rep.reviewId) {
      const rev = data.reviews.find(r => r.id === rep.reviewId);
      if (rev) {
        if (!mediaUrls && rev.media && rev.media.length > 0) {
          mediaUrls = [...rev.media];
        } else if (!mediaUrls && rev.foto) {
          mediaUrls = [rev.foto];
        }
        if (!mediaUrl) {
          mediaUrl = rev.foto || (rev.media && rev.media[0]);
        }
      }
    }
    const newReport: SecurityReport = {
      ...rep,
      id,
      mediaUrl,
      mediaUrls,
      timestamp: 'Recién',
      status: 'pendiente'
    };
    if (!data.reports) data.reports = [];
    data.reports.unshift(newReport);
    saveDb(data);
    return newReport;
  },

  resolveSecurityReport(
    id: string,
    status: 'resuelto' | 'desestimado',
    resolutionNote?: string,
    action?: string,
    sanctionReason?: string,
    adminComment?: string,
    adminUsername = 'administrador',
    sanctionType?: 'temporal_7' | 'temporal_30' | 'permanente',
    alsoDeletedContent?: boolean,
    resolutionDetail?: string
  ): SecurityReport | undefined {
    const data = ensureDbFile();
    if (!data.reports) return undefined;
    const rep = data.reports.find(r => r.id === id);
    if (!rep) return undefined;

    const cleanComment = adminComment && adminComment.trim() ? adminComment.trim() : '-';
    const cleanNote = resolutionNote && resolutionNote.trim() ? resolutionNote.trim() : (status === 'resuelto' ? 'Reporte procesado con éxito.' : '-');

    rep.status = status;
    rep.resolutionNote = cleanNote;
    rep.resolutionAction = action;
    rep.resolutionDecision = status === 'resuelto' ? (action || 'Sancionado') : 'Desestimado';
    rep.sanctionReason = sanctionReason || rep.reason;
    rep.adminComment = cleanComment;
    rep.resolvedBy = adminUsername;
    rep.resolvedAt = formatArgentinaDateTime();
    rep.sanctionType = sanctionType;
    rep.alsoDeletedContent = Boolean(alsoDeletedContent);
    rep.resolutionDetail = resolutionDetail || '';

    // Send detailed notification to the reporter user explaining the decision
    if (rep.reporterUser || rep.reporterUsername) {
      const recipient = rep.reporterUser || rep.reporterUsername!;
      const notifMessage = status === 'resuelto'
        ? `Resolución sobre tu reporte ("${rep.reason}"): El Administrador (${adminUsername}) aplicó medidas operativas (${action === 'ban_user' ? 'Usuario sancionado' : (action === 'delete_content' ? 'Contenido retirado' : 'Intervenido')}). ${cleanComment !== '-' ? `Nota: ${cleanComment}. ` : ''}${rep.resolutionNote}`
        : `Tu reporte sobre "${rep.reason}" fue evaluado por el Administrador. Tras revisar el contexto, se desestimó al no evidenciar infracciones mayores a las normas comunitarias.`;
      db.addNotification(recipient, notifMessage);

      // Dispatch simulated email to the reporter's email address
      const reporterUserObj = Object.values(data.users).find(
        u => u.apodo.toLowerCase() === recipient.toLowerCase() || u.usuario.toLowerCase() === recipient.toLowerCase()
      );
      const emailRecipient = rep.reporterEmail || reporterUserObj?.email || `${(rep.reporterUsername || reporterUserObj?.usuario || 'vecino').toLowerCase()}@correo.club65.ar`;
      rep.reporterEmail = emailRecipient;

      const emailSubject = `CLUB65 - Resolución sobre tu reporte de seguridad ("${rep.reason}")`;
      const emailBody = status === 'resuelto'
        ? `Hola ${recipient}:\n\nTe informamos que el Administrador Oficial (${adminUsername}) ha evaluado tu reporte por "${rep.reason}".\n\nMedida tomada: ${action === 'ban_user' ? 'Sanción preventiva aplicada al usuario denunciado' : (action === 'delete_content' ? 'El contenido denunciado fue retirado de la plataforma' : 'Medidas de moderación y advertencia comunitaria')}.\nDetalle: ${rep.resolutionNote}\n${cleanComment !== '-' ? `Comentario del administrador: ${cleanComment}\n` : ''}\nAgradecemos tu colaboración para mantener a CLUB65 como un espacio seguro para todos los adultos mayores.\n\nAtentamente,\nEquipo de Administración y Seguridad - CLUB65`
        : `Hola ${recipient}:\n\nTe informamos que el Administrador Oficial (${adminUsername}) ha evaluado tu reporte por "${rep.reason}".\n\nTras una revisión del contexto en la conversación, se determinó desestimar el caso al no configurarse una falta a las normas comunitarias.\n${cleanComment !== '-' ? `Observaciones: ${cleanComment}\n` : ''}\nAtentamente,\nEquipo de Administración y Seguridad - CLUB65`;

      db.addSimulatedEmail({
        to: emailRecipient,
        subject: emailSubject,
        body: emailBody
      });
    }

    // Execute immediate action if requested
    if (action === 'delete_content' || action === 'ban_and_delete' || action === 'eliminar') {
      if (rep.type === 'chat_message' && rep.chatId && rep.messageId) {
        db.deleteChatMessage(rep.chatId, rep.messageId, true, 'Este mensaje fue retirado por no cumplir con las condiciones de uso de CLUB65', false);
      } else if (rep.type === 'review_media' && rep.mediaUrl) {
        let rev = data.reviews.find(r => (r.media && r.media.includes(rep.mediaUrl!)) || r.foto === rep.mediaUrl);
        if (!rev && rep.reviewId) {
          rev = data.reviews.find(r => String(r.id) === String(rep.reviewId));
        }
        if (rev) {
          if (Array.isArray(rev.media) && rev.media.length > 0) {
            rev.media = replaceMediaUrlWithRetiredMarker(rev.media, rep.mediaUrl);
          } else if (rev.foto === rep.mediaUrl) {
            rev.media = [RETIRED_REVIEW_MEDIA_MARKER];
          }
          if (rev.foto === rep.mediaUrl) {
            rev.foto = RETIRED_REVIEW_MEDIA_MARKER;
          }
        }
      } else if (rep.reviewId || rep.type === 'review_text') {
        const revId = rep.reviewId || (rep.mediaUrl ? data.reviews.find(r => r.foto === rep.mediaUrl || r.media?.includes(rep.mediaUrl!))?.id : undefined);
        if (revId) {
          const rev = data.reviews.find(r => String(r.id) === String(revId));
          if (rev) {
            rev.retiradoDeLaVista = true;
            rev.retirado_de_la_vista = true;
            rev.deletedByAdmin = true;
            rev.texto = ADMIN_REMOVED_REVIEW_TEXT;
            rev.media = [];
            rev.foto = null;
          }
        }
      }
    }
    
    if ((action === 'ban_user' || action === 'ban_and_delete') && rep.reportedUser) {
      db.addSanction({
        username: rep.reportedUser,
        reason: sanctionReason || rep.reason,
        comment: cleanComment,
        adminUsername,
        type: sanctionType || 'temporal_30',
        reportId: rep.id
      });
    }


    saveDb(data);
    return rep;
  },

  // INSTITUTION VALIDATION
  approveInstitution(userId: string, adminInfo?: { adminApodo?: string; adminUsuario?: string; fechaAlta?: string }): User | undefined {
    const data = ensureDbFile();
    const user = data.users[userId];
    if (!user) return undefined;

    user.isVerified = true;
    user.estadoAlta = 'aprobada';
    if (adminInfo) {
      user.altaPor = adminInfo.adminApodo ? `@${adminInfo.adminUsuario || 'admin'} (${adminInfo.adminApodo})` : `@${adminInfo.adminUsuario || 'admin'}`;
      user.fechaAlta = adminInfo.fechaAlta || new Date().toISOString();
    }
    db.addNotification(user.apodo, '¡Felicitaciones! Tu institución ha sido dada de alta y verificada oficialmente con tilde azul en CLUB65.');
    saveDb(data);
    return user;
  },

  rejectInstitution(userId: string, reason?: string): User | undefined {
    const data = ensureDbFile();
    const user = data.users[userId];
    if (!user) return undefined;

    user.isVerified = false;
    user.estadoAlta = 'rechazada';
    db.addNotification(user.apodo, `Tu solicitud de alta institucional fue rechazada. Motivo: ${reason || 'Documentación incompleta o no verificada.'}`);
    saveDb(data);
    return user;
  },

  verifyInstitution(userId: string, isVerified: boolean): User | undefined {
    const data = ensureDbFile();
    const user = data.users[userId];
    if (!user) return undefined;

    user.isVerified = isVerified;
    user.estadoAlta = isVerified ? 'aprobada' : 'rechazada';
    saveDb(data);
    return user;
  },

  // FORCE CANCEL / REMOVE ACTIVITY FROM CARTELERA
  forceCancelActivity(id: number, reason?: string, adminUsername = 'administrador'): Activity | undefined {
    const data = ensureDbFile();
    const act = data.activities.find(a => a.id === id);
    if (!act) return undefined;

    const fechaBaja = formatArgentinaDateTime();
    const motivoBaja = (reason && reason.trim()) ? reason.trim() : '-';

    act.isApproved = false;
    act.proposalStatus = 'baja_forzada';
    act.baja_forzada = true;
    act.bajaDate = fechaBaja;
    act.bajaTimestamp = Date.now();
    act.bajaReason = motivoBaja;
    act.bajaAdmin = adminUsername;
    act.proposalNote = motivoBaja;

    // Group ceases to exist and participants receive notice in recent messages
    const chatKey = Object.keys(data.chats).find(
      k => data.chats[k].activityId === id || Number(k) === id
    );
    const chat = chatKey ? data.chats[chatKey] : undefined;
    const participants = Array.from(new Set([
      ...(chat?.participants || []),
      ...(act.enrolledUsernames || [])
    ]));

    if (!data.cancelledGroupNotices) data.cancelledGroupNotices = [];
    data.cancelledGroupNotices = data.cancelledGroupNotices.filter(n => n.activityId !== act.id);
    data.cancelledGroupNotices.unshift({
      id: `cnotif_${Date.now()}_${act.id}`,
      activityId: act.id,
      activityTitle: act.title,
      message: `Ya no formas parte del grupo ${act.title} porque la actividad fue cancelada.`,
      date: fechaBaja,
      participants
    });

    if (chatKey) {
      delete data.chats[chatKey];
    }

    if (!data.bajas) data.bajas = [];
    data.bajas = data.bajas.filter(b => b.activityId !== act.id);
    data.bajas.unshift({
      id: `baja_${Date.now()}`,
      activityId: act.id,
      title: act.title,
      organizer: act.organizer,
      date: fechaBaja,
      reason: motivoBaja,
      adminUsername
    });

    db.addNotification(act.organizer, `Tu actividad "${act.title}" ha sido dada de baja de la Cartelera pública por el Administrador (@${adminUsername}). Motivo: ${motivoBaja}`);

    if (act.enrolledUsernames) {
      act.enrolledUsernames.forEach(username => {
        db.addNotification(username, `Aviso: La actividad "${act.title}" a la que asistías fue dada de baja de la Cartelera por la administración.`);
      });
    }

    saveDb(data);
    return act;
  },

  getCancelledGroupNotices(): CancelledGroupNotice[] {
    const data = ensureDbFile();
    return data.cancelledGroupNotices || [];
  },

  dismissCancelledGroupNotice(id: string, userTokens: string | string[]): boolean {
    const data = ensureDbFile();
    if (!data.cancelledGroupNotices) return true;
    const tokens = (Array.isArray(userTokens) ? userTokens : [userTokens])
      .filter(Boolean)
      .map(t => String(t).trim().toLowerCase());
    data.cancelledGroupNotices.forEach(n => {
      if (n.id === id) {
        n.participants = n.participants.filter(p => !tokens.includes(p.trim().toLowerCase()));
      }
    });
    data.cancelledGroupNotices = data.cancelledGroupNotices.filter(n => n.participants.length > 0);
    saveDb(data);
    return true;
  },

  getBajas(): BajaRecord[] {
    const data = ensureDbFile();
    return data.bajas || [];
  },

  // MAKE USER ADMINISTRATOR
  makeUserAdmin(identifier: string): User | undefined {
    const data = ensureDbFile();
    const matched = findPromotableUserCandidate(Object.values(data.users), identifier);
    if (!matched) return undefined;

    const wasAdmin = isOfficialAdminRow(matched);
    const updated = applyAdminPromotionToLocalUser(matched);
    const key = Object.keys(data.users).find((k) => data.users[k]?.id === matched.id) || matched.usuario;
    data.users[key] = updated;

    // Los usuarios administradores no pueden formar parte de ningún grupo: removerlos de chats grupales existentes
    const adminTokens = new Set(
      [updated.id, updated.usuario, updated.apodo, (updated as any).nombre, (updated as any).supabaseId]
        .filter(Boolean)
        .map((t: any) => String(t).trim().toLowerCase())
    );
    if (data.chats && typeof data.chats === 'object') {
      for (const chatKey of Object.keys(data.chats)) {
        const chat: any = data.chats[chatKey];
        if (!chat || chat.type === 'privado') continue;
        data.chats[chatKey] = {
          ...chat,
          participants: Array.isArray(chat.participants)
            ? chat.participants.filter((p: any) => !adminTokens.has(String(p || '').trim().toLowerCase()))
            : chat.participants,
          participantIds: Array.isArray(chat.participantIds)
            ? chat.participantIds.filter((p: any) => !adminTokens.has(String(p || '').trim().toLowerCase()))
            : chat.participantIds,
          adminUsernames: Array.isArray(chat.adminUsernames)
            ? chat.adminUsernames.filter((p: any) => !adminTokens.has(String(p || '').trim().toLowerCase()))
            : chat.adminUsernames
        };
      }
    }

    if (!wasAdmin) {
      db.addNotification(updated.apodo, '¡Has sido designado como Administrador Oficial de CLUB65 con acceso total al Panel de Control!');
    }
    saveDb(data);
    return updated;
  },

  // SANCTIONS MANAGEMENT
  getSanctions(): SanctionRecord[] {
    const data = ensureDbFile();
    return data.sanctions || [];
  },

  addSanction(record: Omit<SanctionRecord, 'id' | 'date'> & { id?: string; date?: string }): SanctionRecord {
    const data = ensureDbFile();
    if (!data.sanctions) data.sanctions = [];
    if (!data.bannedUsers) data.bannedUsers = [];

    const dateStr = record.date || formatArgentinaDateOnly();

    let liftDate = record.liftDate;
    if (!liftDate) {
      if (record.type === 'temporal_7') {
        const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        liftDate = formatArgentinaDateOnly(d);
      } else if (record.type === 'temporal_30') {
        const d = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        liftDate = formatArgentinaDateOnly(d);
      } else {
        liftDate = 'Sin fecha (Permanente)';
      }
    }

    const cleanComment = record.comment && record.comment.trim() ? record.comment.trim() : '-';

    const newSanction: SanctionRecord = {
      id: record.id || `sanc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      username: record.username,
      reason: record.reason,
      comment: cleanComment,
      adminUsername: record.adminUsername || 'administrador',
      date: dateStr,
      type: record.type,
      liftDate,
      reportId: record.reportId
    };


    data.sanctions.unshift(newSanction);

    const lowerTarget = record.username.trim().toLowerCase();
    if (!data.bannedUsers.includes(lowerTarget)) {
      data.bannedUsers.push(lowerTarget);
    }

    const user = Object.values(data.users).find(
      u => u.usuario.toLowerCase() === lowerTarget || u.apodo.toLowerCase() === lowerTarget || u.id.toLowerCase() === lowerTarget
    );
    if (user) {
      user.isSuspended = true;
      db.addNotification(user.apodo, `Has recibido una sanción (${record.reason}): ${record.comment || 'Violación de normas comunitarias'}.`);
    }

    saveDb(data);
    return newSanction;
  },

  removeSanction(username: string): void {
    const data = ensureDbFile();
    const lower = username.trim().toLowerCase();
    if (data.sanctions) {
      data.sanctions = data.sanctions.filter(s => s.username.toLowerCase() !== lower);
    }
    if (data.bannedUsers) {
      data.bannedUsers = data.bannedUsers.filter(b => b.toLowerCase() !== lower);
    }
    const user = Object.values(data.users).find(
      u => u.usuario.toLowerCase() === lower || u.apodo.toLowerCase() === lower || u.id.toLowerCase() === lower
    );
    if (user) {
      user.isSuspended = false;
      db.addNotification(user.apodo, 'Tu sanción ha sido levantada por un Administrador.');
    }
    saveDb(data);
  },

  // GLOBAL BANS & SUSPENSIONS
  banUserGlobal(identifier: string): void {
    db.addSanction({
      username: identifier,
      reason: 'Comportamientos ilegales',
      comment: 'Veto preventivo aplicado por la administración.',
      adminUsername: 'administrador',
      type: 'permanente'
    });
  },

  unbanUserGlobal(identifier: string): void {
    db.removeSanction(identifier);
  },

  isUserBanned(identifier: string): boolean {
    const data = ensureDbFile();
    return data.bannedUsers ? data.bannedUsers.includes(identifier.trim().toLowerCase()) : false;
  },

  // SIMULATED EMAILS
  getSimulatedEmails(): SimulatedEmail[] {
    const data = ensureDbFile();
    return data.simulatedEmails || [];
  },

  addSimulatedEmail(email: Omit<SimulatedEmail, 'id' | 'date'>): SimulatedEmail {
    const data = ensureDbFile();
    if (!data.simulatedEmails) data.simulatedEmails = [];
    const now = new Date();
    const dateStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}, ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} hs`;
    const newEmail: SimulatedEmail = {
      ...email,
      id: `email_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      date: dateStr
    };
    data.simulatedEmails.unshift(newEmail);
    saveDb(data);
    return newEmail;
  }
};
