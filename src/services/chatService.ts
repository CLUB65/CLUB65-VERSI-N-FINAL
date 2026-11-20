import { supabase } from '../supabaseClient';
import { Chat, ChatMessage, User, Activity } from '../types';
import { formatArgentinaTimeOnly } from '../utils/argentinaTime';
import { chatIdentifierToBigInt, filterChatMessagesForUser, getPinnedMessageFromList, isChatDeletedForUser, isAdministratorUser } from '../utils/chatLogic';
import { normalizeActivityIdForChat, isActivityChatEligible, doesDbChatRowMatchActivity } from '../utils/proposalLogic';
import { resolveRemovedMessageDisplay } from '../utils/reportsAndSanctions';

export interface ChatParticipantInfo {
  userId: string;
  name: string;
  avatar?: string;
  role?: string;
}

export interface ChatRow {
  id: string;
  nombre: string;
  tipo: 'grupo_actividad' | 'grupo_libre' | 'privado';
  foto_grupo_url: string | null;
  creado_el: string;
  creador_id: string | null;
  actividad_id?: string | null;
}

/**
 * 1. Listar los chats del usuario actual filtrando estrictamente por membresía:
 * La lista de conversaciones del usuario autenticado DEBE consultarse únicamente cruzando con la tabla chat_participants:
 * const { data, error } = await supabase
 *   .from('chat_participants')
 *   .select(`
 *     chat_id,
 *     chats:chat_id (
 *       id,
 *       nombre,
 *       tipo,
 *       foto_grupo_url,
 *       creado_el,
 *       creador_id
 *     )
 *   `)
 *   .eq('user_id', currentUser.id);
 * Mapea ese resultado para obtener la lista de chats. Si el usuario no tiene registros en chat_participants, el estado debe quedar como array vacío ([]).
 */
const userChatsInFlight = new Map<string, Promise<Chat[]>>();

export async function getUserChats(currentUser: User | { id: string } | null): Promise<Chat[]> {
  if (!currentUser || !currentUser.id) {
    return [];
  }

  const userKey = String(currentUser.id);
  const existingPromise = userChatsInFlight.get(userKey);
  if (existingPromise) {
    return existingPromise;
  }

  const run = (async (): Promise<Chat[]> => {
    try {
      const cleanGroupStr = (str?: string) => String(str || '').replace(/^grupo:\s*/i, '').trim().toLowerCase();

      // 1. Consultar en paralelo:
      //    a) Todas las conversaciones del usuario en una sola consulta relacional sobre chat_participants -> chats
      //    b) Lista de actividades (se reutiliza tanto para detectar grupos faltantes como para asociar activityId)
      const [partResult, actsResult] = await Promise.all([
        supabase
          .from('chat_participants')
          .select(`
            chat_id,
            chats:chat_id (
              id,
              nombre,
              tipo,
              foto_grupo_url,
              creado_el,
              creador_id,
              actividad_id
            )
          `)
          .eq('user_id', currentUser.id),
        supabase
          .from('activities')
          .select('id, title, titulo, image, imagen_url, creador_id, organizer_id, enrolled_usernames, vetted_users, proposal_status, estado, is_approved, fecha_baja')
          .order('id', { ascending: false })
          .limit(60)
      ]);

      if (partResult.error) {
        console.warn('Error al consultar chat_participants:', partResult.error.message);
        return [];
      }

      const isCurrentUserAdmin = isAdministratorUser(currentUser);
      const rawChatRows: ChatRow[] = [];
      const joinedChatIds = new Set<string>();
      const staleAdminGroupChatIds: string[] = [];
      for (const item of partResult.data || []) {
        const rawChat = (item as any)?.chats;
        const c = Array.isArray(rawChat) ? rawChat[0] : rawChat;
        if (c && c.id) {
          if (isCurrentUserAdmin && c.tipo !== 'privado') {
            staleAdminGroupChatIds.push(String(c.id));
            continue;
          }
          rawChatRows.push(c as ChatRow);
          joinedChatIds.add(String(c.id));
        }
      }

      // Limpieza persistente en Supabase: si un administrador figuraba en chat_participants de algún grupo, removerlo automáticamente
      if (isCurrentUserAdmin && staleAdminGroupChatIds.length > 0) {
        try {
          await supabase
            .from('chat_participants')
            .delete()
            .eq('user_id', currentUser.id)
            .in('chat_id', staleAdminGroupChatIds);
        } catch (cleanErr) {
          console.warn('Aviso limpiando membresías grupales obsoletas de administrador:', cleanErr);
        }
      }

      const allActivitiesList: any[] = Array.isArray(actsResult.data) ? actsResult.data : [];

      // Parsear avisos de retiro/salida/veto persistidos en currentUser.notifications ANTES del Paso 2
      // para no re-inscribir automáticamente al usuario en chats grupales que abandonó o de los que fue retirado.
      const removedNoticeByChatId = new Map<string, any>();
      const removedNoticeActivityIds = new Set<string>();
      const locallyLeftIds = new Set<string>();
      try {
        const notifs = Array.isArray((currentUser as any)?.notifications) ? (currentUser as any).notifications : [];
        for (const n of notifs) {
          if (n && n.type === 'chat_removed_notice') {
            if (n.chatId) {
              const cIdStr = String(n.chatId);
              const existing = removedNoticeByChatId.get(cIdStr);
              const nTs = typeof n.removedAt === 'number'
                ? n.removedAt
                : (new Date(n.removedAt || n.leftAt || n.createdAt || 0).getTime() || 0);
              const exTs = existing
                ? (typeof existing.removedAt === 'number'
                    ? existing.removedAt
                    : (new Date(existing.removedAt || existing.leftAt || existing.createdAt || 0).getTime() || 0))
                : -1;
              if (!existing || nTs >= exTs) {
                removedNoticeByChatId.set(cIdStr, n);
              }
            }
            if (n.activityId) {
              removedNoticeActivityIds.add(String(n.activityId));
            }
          }
        }
      } catch (_) {}

      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('left_chats_local');
          const u = currentUser as any;
          const uToks = Array.from(new Set([u.id, u.usuario].filter(Boolean).map(t => String(t).trim())));
          for (const tok of uToks) {
            const raw = localStorage.getItem(`left_chats_${tok}`);
            if (raw) {
              const arr = JSON.parse(raw);
              if (Array.isArray(arr)) {
                arr.forEach((x: any) => { if (x) locallyLeftIds.add(String(x)); });
              }
            }
          }
        }
      } catch (_) {}

      // 2. Sincronizar actividades propias/inscriptas que aún no tengan vínculo en chat_participants (en lote, sin bucles N+1)
      //    Los usuarios administradores NUNCA forman parte de grupos, por lo que no se sincronizan grupos de actividades para ellos.
      if (!isCurrentUserAdmin) {
      try {
        const u = currentUser as any;
        const userTokens = [u.id, u.usuario, u.apodo, u.nombre]
          .filter(Boolean)
          .map((t: any) => String(t).toLowerCase().trim());

        const myActivities = allActivitiesList.filter((act: any) => {
          if (!isActivityChatEligible(act)) {
            return false;
          }
          const vetted = Array.isArray(act.vetted_users) ? act.vetted_users : [];
          if (vetted.some((v: any) => userTokens.includes(String(v || '').toLowerCase().trim()))) {
            return false;
          }
          // Si el usuario abandonó voluntariamente o fue retirado del grupo de esta actividad, nunca re-agregarlo automáticamente
          if (removedNoticeActivityIds.has(String(act.id)) || locallyLeftIds.has(String(act.id))) {
            return false;
          }
          const isCreator = userTokens.includes(String(act.creador_id || '').toLowerCase().trim());
          const isOrganizer = userTokens.includes(String(act.organizer_id || '').toLowerCase().trim());
          if (isCreator || isOrganizer) return true;
          const enrolled = Array.isArray(act.enrolled_usernames)
            ? act.enrolled_usernames
            : (Array.isArray(act.inscriptos) ? act.inscriptos : []);
          return enrolled.some((e: any) => {
            const val = typeof e === 'object' ? (e.usuario || e.apodo || e.nombre || e.id) : String(e || '');
            return userTokens.includes(String(val).toLowerCase().trim());
          });
        });

        const missingActivities = myActivities.filter((act: any) => {
          const rawTitle = (act.title || act.titulo || '').trim();
          if (!rawTitle) return false;
          return !rawChatRows.some((c) => doesDbChatRowMatchActivity(c, act.id, rawTitle));
        });

        if (missingActivities.length > 0) {
          // Una única consulta batch para obtener los chats de actividades existentes
          const { data: existingActChats } = await supabase
            .from('chats')
            .select('id, nombre, tipo, foto_grupo_url, creado_el, creador_id, actividad_id')
            .eq('tipo', 'grupo_actividad')
            .order('creado_el', { ascending: true });

          const actChatsList: ChatRow[] = Array.isArray(existingActChats) ? (existingActChats as ChatRow[]) : [];
          const newChatsToInsert: any[] = [];
          const candidateChatRowsToJoin: ChatRow[] = [];

          for (const act of missingActivities) {
            const rawTitle = (act.title || act.titulo || '').trim();
            const cleanTitle = rawTitle.replace(/^grupo:\s*/i, '').trim();
            const groupTitle = cleanTitle;
            const actIdForChat = normalizeActivityIdForChat(act.id);

            const matched =
              actChatsList.find((c) => actIdForChat !== null && c.actividad_id != null && String(c.actividad_id) === String(actIdForChat)) ||
              actChatsList.find((c) => doesDbChatRowMatchActivity(c, act.id, rawTitle));

            if (matched) {
              if (!removedNoticeByChatId.has(String(matched.id)) && !locallyLeftIds.has(String(matched.id))) {
                candidateChatRowsToJoin.push(matched);
              }
            } else {
              const newChatUuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                ? crypto.randomUUID()
                : undefined;
              const newPayload: any = {
                nombre: groupTitle,
                tipo: 'grupo_actividad',
                foto_grupo_url: act.image || (act as any).imagen_url || null,
                creado_el: new Date().toISOString(),
                creador_id: act.creador_id || currentUser.id
              };
              if (newChatUuid) newPayload.id = newChatUuid;
              if (actIdForChat !== null) {
                newPayload.actividad_id = actIdForChat;
              }
              newChatsToInsert.push(newPayload);
            }
          }

          if (newChatsToInsert.length > 0) {
            const { data: insertedChats } = await supabase
              .from('chats')
              .insert(newChatsToInsert)
              .select('id, nombre, tipo, foto_grupo_url, creado_el, creador_id, actividad_id');

            if (Array.isArray(insertedChats)) {
              candidateChatRowsToJoin.push(...(insertedChats as ChatRow[]));
            }
          }

          const newParticipantRows: any[] = [];
          for (const chatRow of candidateChatRowsToJoin) {
            if (!chatRow?.id) continue;
            const cId = String(chatRow.id);
            if (!joinedChatIds.has(cId)) {
              joinedChatIds.add(cId);
              rawChatRows.push(chatRow);
              const partRow: any = {
                chat_id: cId,
                user_id: currentUser.id,
                joined_at: new Date().toISOString()
              };
              if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                partRow.id = crypto.randomUUID();
              }
              newParticipantRows.push(partRow);
            }
          }

          if (newParticipantRows.length > 0) {
            await supabase
              .from('chat_participants')
              .upsert(newParticipantRows, { onConflict: 'chat_id,user_id', ignoreDuplicates: true });
          }
        }
      } catch (syncErr) {
        console.warn('Aviso sincronizando actividades con chat_participants:', syncErr);
      }

      // 2b. Si el usuario salió voluntariamente, fue retirado o vetado de algún grupo en el que SÍ participaba,
      //     recuperar ese chat en modo solo lectura desde sus notificaciones persistidas en Supabase.
      try {
        const missingRemovedChatIds: string[] = [];
        for (const cIdStr of removedNoticeByChatId.keys()) {
          if (!joinedChatIds.has(cIdStr) && !missingRemovedChatIds.includes(cIdStr)) {
            missingRemovedChatIds.push(cIdStr);
          }
        }
        if (missingRemovedChatIds.length > 0) {
          const { data: removedChatRows } = await supabase
            .from('chats')
            .select('id, nombre, tipo, foto_grupo_url, creado_el, creador_id, actividad_id')
            .in('id', missingRemovedChatIds);
          if (Array.isArray(removedChatRows)) {
            for (const rc of removedChatRows) {
              if (rc && rc.id && !joinedChatIds.has(String(rc.id))) {
                rawChatRows.push(rc as ChatRow);
              }
            }
          }
        }
      } catch (remErr) {
        console.warn('Aviso recuperando chats de retiro/salida/veto:', remErr);
      }
      }

      if (rawChatRows.length === 0) {
        return [];
      }

      // Deduplicar filas de chats del usuario para que un mismo grupo nunca se devuelva dos veces,
      // excluyendo además chats de propuestas pendientes/rechazadas/con cambios solicitados.
      const prioritizedRawRows = [...rawChatRows].sort((a, b) => {
        const aHasId = a?.actividad_id != null ? 1 : 0;
        const bHasId = b?.actividad_id != null ? 1 : 0;
        return bHasId - aHasId;
      });

      const validChatRows: ChatRow[] = [];
      const chatIds: string[] = [];
      const seenGroupTitles = new Set<string>();
      const seenActivityIds = new Set<string>();
      const seenChatIds = new Set<string>();

      const uForSync = currentUser as any;
      const currentUserTokensForCheck = [uForSync.id, uForSync.usuario, uForSync.apodo, uForSync.nombre]
        .filter(Boolean)
        .map((t: any) => String(t).toLowerCase().trim());

      for (const c of prioritizedRawRows) {
        if (!c || !c.id) continue;
        if (isCurrentUserAdmin && c.tipo !== 'privado') continue;
        const sId = String(c.id);
        if (seenChatIds.has(sId)) continue;

        if (c.tipo === 'grupo_actividad' || (c.tipo !== 'privado' && c.actividad_id != null)) {
          const matchedAct = allActivitiesList.find((a: any) =>
            doesDbChatRowMatchActivity(c, a.id, a.title || a.titulo)
          );
          if (matchedAct) {
            const actStatus = String(matchedAct.proposal_status || matchedAct.estado || '').toLowerCase().trim();
            const isCancelledOrSuspended =
              actStatus === 'baja_forzada' ||
              actStatus === 'cancelada_organizador' ||
              Boolean(matchedAct.fecha_baja && String(matchedAct.fecha_baja).trim() !== '');
            if (
              !isCancelledOrSuspended &&
              (actStatus === 'pendiente' || actStatus === 'cambios_solicitados' || actStatus === 'rechazada' || matchedAct.is_approved === false)
            ) {
              continue;
            }
            const isActCreatorOrOrg =
              currentUserTokensForCheck.includes(String(matchedAct.creador_id || '').toLowerCase().trim()) ||
              currentUserTokensForCheck.includes(String(matchedAct.organizer_id || '').toLowerCase().trim()) ||
              currentUserTokensForCheck.includes(String(c.creador_id || '').toLowerCase().trim());
            const isVetoedOrRemovedNotice =
              removedNoticeByChatId.has(sId) ||
              (matchedAct?.id ? removedNoticeActivityIds.has(String(matchedAct.id)) : false);
            if (!isActCreatorOrOrg && !isVetoedOrRemovedNotice && Array.isArray(matchedAct.enrolled_usernames)) {
              const enrolledInAct = matchedAct.enrolled_usernames.some((e: any) => {
                const val = typeof e === 'object' ? (e.usuario || e.apodo || e.nombre || e.id) : String(e || '');
                return currentUserTokensForCheck.includes(String(val).toLowerCase().trim());
              });
              if (!enrolledInAct) {
                continue;
              }
            }
            const actKey = String(matchedAct.id);
            if (seenActivityIds.has(actKey)) {
              continue;
            }
            seenActivityIds.add(actKey);
          } else if (c.actividad_id != null) {
            const actKey = String(c.actividad_id);
            if (seenActivityIds.has(actKey)) {
              continue;
            }
            seenActivityIds.add(actKey);
          }
        }

        const cClean = cleanGroupStr(c.nombre);
        const isGroup = c.tipo === 'grupo_actividad' || c.tipo === 'grupo_libre';
        if (isGroup && cClean) {
          if (seenGroupTitles.has(cClean)) {
            continue; // Grupo duplicado ya procesado
          }
          seenGroupTitles.add(cClean);
        }
        seenChatIds.add(sId);
        validChatRows.push(c);
        chatIds.push(sId);
      }

      if (validChatRows.length === 0) {
        return [];
      }

      // 3. Obtener en paralelo todos los participantes (.in) y todos los mensajes recientes (.in) en 2 únicas consultas
      const bigIntChatIds = Array.from(new Set(
        chatIds.map(id => chatIdentifierToBigInt(id)).filter(Boolean)
      ));

      const [participantsResult, messagesResult] = await Promise.all([
        supabase
          .from('chat_participants')
          .select(`
            chat_id,
            user_id,
            users:user_id (
              id,
              usuario,
              apodo,
              tipo,
              rol
            )
          `)
          .in('chat_id', chatIds),
        bigIntChatIds.length > 0
          ? supabase
              .from('messages')
              .select('id, chat_id, sender_id, sender, role, text, time, created_at, is_deleted, deleted_by_admin, deleted_by_group_moderator, is_pinned, reply_to')
              .in('chat_id', bigIntChatIds)
              .order('created_at', { ascending: false })
              .limit(80)
          : Promise.resolve({ data: [], error: null })
      ]);

      const chatTypeById = new Map<string, string>();
      for (const vc of validChatRows) {
        chatTypeById.set(String(vc.id), vc.tipo);
      }

      const participantsMap = new Map<string, ChatParticipantInfo[]>();
      if (Array.isArray(participantsResult.data)) {
        participantsResult.data.forEach((row: any) => {
          const cId = String(row.chat_id);
          if (!participantsMap.has(cId)) {
            participantsMap.set(cId, []);
          }
          const u = Array.isArray(row.users) ? row.users[0] : row.users;
          // Los administradores nunca forman parte de chats grupales
          if (chatTypeById.get(cId) !== 'privado' && isAdministratorUser(u)) {
            return;
          }
          const displayName = u?.apodo || u?.usuario || row.user_id;
          participantsMap.get(cId)!.push({
            userId: String(row.user_id),
            name: displayName,
            role: u?.tipo
          });
        });
      }

      const msgsByChat = new Map<string, ChatMessage[]>();
      if (Array.isArray(messagesResult.data)) {
        const sortedMessages = [...messagesResult.data].sort((a: any, b: any) => {
          const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
          const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
          return ta - tb;
        });
        for (const m of sortedMessages as any[]) {
          const mChatBig = String(m.chat_id);
          const matchedChatId = chatIds.find(id => String(chatIdentifierToBigInt(id)) === mChatBig) || mChatBig;
          const displayState = resolveRemovedMessageDisplay(m);

          let parsedReplyTo: any = m.reply_to;
          if (typeof parsedReplyTo === 'string') {
            try { parsedReplyTo = JSON.parse(parsedReplyTo); } catch {}
          }
          const isRealReply =
            parsedReplyTo &&
            typeof parsedReplyTo === 'object' &&
            !parsedReplyTo.event &&
            !parsedReplyTo.is_group_init &&
            Boolean(parsedReplyTo.text || parsedReplyTo.sender || parsedReplyTo.id);

          const msgObj: ChatMessage = {
            id: String(m.id),
            chatId: matchedChatId,
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
            replyTo: isRealReply
              ? {
                  id: String(parsedReplyTo.id || ''),
                  sender: String(parsedReplyTo.sender || ''),
                  text: String(parsedReplyTo.text || '')
                }
              : undefined,
            createdAt: m.created_at || new Date().toISOString(),
            timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now()
          };
          if (parsedReplyTo && typeof parsedReplyTo === 'object') {
            (msgObj as any).reply_to = parsedReplyTo;
          }

          const existingList = msgsByChat.get(matchedChatId) || [];
          existingList.push(msgObj);
          msgsByChat.set(matchedChatId, existingList);
        }
      }

      // 4. Mapear al modelo Chat del frontend
      const uAny = currentUser as any;
      const currentUserTokens = [uAny.id, uAny.usuario, uAny.apodo, uAny.nombre]
        .filter(Boolean)
        .map((t: any) => String(t).trim());
      const currentUserTokensLower = currentUserTokens.map(t => t.toLowerCase());

      const mappedChats: Chat[] = validChatRows.map((c) => {
        const members = participantsMap.get(c.id) || [];
        const isPrivate = c.tipo === 'privado';
        const allMsgs = msgsByChat.get(c.id) || [];

        let displayTitle = c.nombre;
        let displayAvatar = c.foto_grupo_url || undefined;

        if (isPrivate) {
          const otherMember = members.find((m) => m.userId !== currentUser.id);
          if (otherMember) {
            displayTitle = otherMember.name || c.nombre;
            if (otherMember.avatar) {
              displayAvatar = otherMember.avatar;
            }
          }
        }

        const cleanT = cleanGroupStr(c.nombre);
        const matchedAct = allActivitiesList.find(a =>
          (c.actividad_id && String(a.id) === String(c.actividad_id)) ||
          cleanGroupStr(a.title || a.titulo) === cleanT
        );
        const resolvedActivityId = matchedAct ? matchedAct.id : (c.actividad_id || undefined);
        const isGroup = c.tipo === 'grupo_actividad' || c.tipo === 'grupo_libre';
        const normalizedTitle = displayTitle;

        const removedNotice =
          removedNoticeByChatId.get(String(c.id)) ||
          (resolvedActivityId
            ? Array.from(removedNoticeByChatId.values()).find((n: any) => n.activityId && String(n.activityId) === String(resolvedActivityId))
            : undefined);
        const isStillJoined = joinedChatIds.has(String(c.id));
        const extraRemovedProps: Record<string, any> = {};
        if (!isStillJoined && removedNotice && isGroup) {
          let snapList: string[] = Array.isArray(removedNotice.participantsSnapshot)
            ? removedNotice.participantsSnapshot
            : [];
          if (snapList.length === 0 && allMsgs.length > 0) {
            const selfIdLow = String(currentUser.id || '').trim().toLowerCase();
            for (let i = allMsgs.length - 1; i >= 0; i--) {
              const rt = (allMsgs[i] as any)?.reply_to || (allMsgs[i] as any)?.replyTo;
              if (rt && typeof rt === 'object' && Array.isArray(rt.participantsSnapshot) && rt.participantsSnapshot.length > 0) {
                const pName = String(rt.participant || '').trim().toLowerCase();
                const pId = String(rt.participantId || rt.userId || '').trim().toLowerCase();
                if (pId && selfIdLow && pId !== selfIdLow) {
                  continue;
                }
                const pToks = Array.isArray(rt.participantTokens) ? rt.participantTokens.map((t: any) => String(t).trim().toLowerCase()).filter(Boolean) : [];
                if (
                  (pName && currentUserTokensLower.includes(pName)) ||
                  (pId && currentUserTokensLower.includes(pId)) ||
                  pToks.some((t: string) => currentUserTokensLower.includes(t))
                ) {
                  snapList = rt.participantsSnapshot;
                  break;
                }
              }
            }
          }

          const snapshotMap: Record<string, string[]> = {};
          if (snapList.length > 0) {
            for (const tok of currentUserTokensLower) {
              snapshotMap[tok] = snapList;
            }
          }

          const noticeTs = removedNotice.removedAt || removedNotice.leftAt || removedNotice.createdAt || undefined;
          extraRemovedProps.removedParticipants = currentUserTokens;
          extraRemovedProps.removedByUser = true;
          if (noticeTs !== undefined) {
            extraRemovedProps.removedAtForUser = noticeTs;
          }
          if (Object.keys(snapshotMap).length > 0) {
            extraRemovedProps.participantsSnapshotOnRemoval = snapshotMap;
          }
          if (removedNotice.reason === 'left') {
            extraRemovedProps.leftVoluntarily = true;
            extraRemovedProps.leftVoluntarilyParticipants = currentUserTokens;
            if (noticeTs !== undefined) {
              extraRemovedProps.leftAtForUser = noticeTs;
            }
          } else if (removedNotice.reason === 'vetoed') {
            extraRemovedProps.vetoedParticipants = currentUserTokens;
            extraRemovedProps.vetoedByUser = true;
          }
        }

        const chatMetaForFilter = {
          id: c.id,
          activityId: resolvedActivityId,
          type: isPrivate ? 'privado' : 'grupal',
          messages: allMsgs,
          ...extraRemovedProps
        };
        const userFilteredMsgs = filterChatMessagesForUser(allMsgs, c.id, currentUser, chatMetaForFilter);
        const effectiveLastMsg = userFilteredMsgs.length > 0 ? userFilteredMsgs[userFilteredMsgs.length - 1] : null;
        const pinnedMsg = getPinnedMessageFromList(userFilteredMsgs);

        // Derivar cronológicamente los moderadores designados activos a partir de mensajes de sistema
        const activeAdminsMap = new Map<string, string>();
        if (isGroup && allMsgs.length > 0) {
          const addAdminToken = (tok: any) => {
            const clean = String(tok || '').trim();
            const low = clean.toLowerCase();
            if (clean && low && !activeAdminsMap.has(low)) {
              activeAdminsMap.set(low, clean);
            }
          };
          const revokeAdminTokens = (tokens: string[]) => {
            const lowSet = new Set(tokens.map(t => String(t || '').trim().toLowerCase()).filter(Boolean));
            if (lowSet.size === 0) return;
            for (const key of Array.from(activeAdminsMap.keys())) {
              if (lowSet.has(key)) {
                activeAdminsMap.delete(key);
              }
            }
          };

          for (const m of allMsgs) {
            const rt = (m as any)?.reply_to || (m as any)?.replyTo;
            const textClean = String(m?.text || '').toLowerCase().trim();
            const eventTokens: string[] = [];
            if (rt && typeof rt === 'object') {
              [rt.participant, rt.participantId, rt.userId, ...(Array.isArray(rt.participantTokens) ? rt.participantTokens : [])]
                .filter(Boolean)
                .forEach((x: any) => eventTokens.push(String(x).trim()));
            }

            if (rt && typeof rt === 'object' && rt.is_group_init && Array.isArray(rt.adminUsernames)) {
              rt.adminUsernames.forEach(addAdminToken);
            }

            const isMakeAdmin = (rt && typeof rt === 'object' && rt.action === 'make_admin') ||
              /fue designado\/a moderador\/a/i.test(textClean);
            if (isMakeAdmin) {
              eventTokens.forEach(addAdminToken);
              if (Array.isArray(rt?.adminUsernames)) {
                rt.adminUsernames.forEach(addAdminToken);
              }
              // Enriquecer con nombre/userId del miembro si coincide por alguno de los tokens
              const evLowSet = new Set(eventTokens.map(t => t.toLowerCase()));
              members.forEach(mem => {
                const mUid = String(mem.userId || '').trim();
                const mName = String(mem.name || '').trim();
                if (
                  (mUid && evLowSet.has(mUid.toLowerCase())) ||
                  (mName && evLowSet.has(mName.toLowerCase())) ||
                  (mName && mName.length > 2 && textClean.includes(mName.toLowerCase()))
                ) {
                  addAdminToken(mUid);
                  addAdminToken(mName);
                }
              });
            }

            const isRemovalOrAdd =
              (rt && typeof rt === 'object' && (
                rt.event === 'participant_removed' ||
                rt.event === 'user_left' ||
                rt.event === 'participant_added'
              )) ||
              /fue retirad[oa] del grupo/i.test(textClean) ||
              /(?:salió|abandonó)\s+del grupo/i.test(textClean) ||
              /fue agregad[oa] al grupo/i.test(textClean) ||
              /¡Bienvenido a/i.test(String(m?.text || ''));

            if (isRemovalOrAdd) {
              const revToks = [...eventTokens];
              members.forEach(mem => {
                const mName = String(mem.name || '').trim();
                const mUid = String(mem.userId || '').trim();
                if (
                  (mName && mName.length > 2 && textClean.includes(mName.toLowerCase())) ||
                  eventTokens.some(et => et.toLowerCase() === mName.toLowerCase() || et.toLowerCase() === mUid.toLowerCase())
                ) {
                  if (mName) revToks.push(mName);
                  if (mUid) revToks.push(mUid);
                }
              });
              revokeAdminTokens(revToks);
            }
          }
        }
        const hydratedAdminUsernames = Array.from(activeAdminsMap.values());

        return {
          id: c.id,
          title: isPrivate ? displayTitle : normalizedTitle,
          name: isPrivate ? displayTitle : normalizedTitle,
          subtitle: isPrivate ? 'Chat directo' : (matchedAct ? `Canal de la actividad: ${matchedAct.title || cleanT}` : 'Grupo vecinal'),
          type: isPrivate ? 'privado' : 'grupal',
          activityId: resolvedActivityId,
          avatar: displayAvatar,
          image: displayAvatar,
          creatorId: c.creador_id || undefined,
          participants: members.map((m) => m.name),
          participantIds: members.map((m) => m.userId),
          ...(hydratedAdminUsernames.length > 0 ? { adminUsernames: hydratedAdminUsernames } : {}),
          ...extraRemovedProps,
          pinnedMessageId: pinnedMsg ? String(pinnedMsg.id) : undefined,
          lastMessage: effectiveLastMsg?.text,
          lastMessageTime: effectiveLastMsg?.time,
          updatedAt: effectiveLastMsg?.createdAt || c.creado_el,
          messages: userFilteredMsgs,
          created_at: c.creado_el,
          createdAt: c.creado_el
        };
      });

      return mappedChats.filter(c => !isChatDeletedForUser(c, currentUser));
    } catch (err) {
      console.warn('Excepción en getUserChats:', err);
      return [];
    } finally {
      userChatsInFlight.delete(userKey);
    }
  })();

  userChatsInFlight.set(userKey, run);
  return run;
}

/**
 * 1b. Hidratar un único chat recién agregado por Realtime (chat_participants INSERT)
 * sin volver a consultar todas las conversaciones, actividades ni participantes de la app.
 */
export async function getSingleChatById(
  chatId: string,
  currentUser: User | { id: string } | null
): Promise<Chat | null> {
  if (!chatId || !currentUser?.id) return null;
  try {
    const sChatId = String(chatId);
    const bigId = chatIdentifierToBigInt(sChatId);

    const [chatRes, partsRes, msgsRes] = await Promise.all([
      supabase
        .from('chats')
        .select('id, nombre, tipo, foto_grupo_url, creado_el, creador_id, actividad_id')
        .eq('id', sChatId)
        .maybeSingle(),
      supabase
        .from('chat_participants')
        .select(`
          chat_id,
          user_id,
          users:user_id (
            id,
            usuario,
            apodo,
            tipo,
            rol
          )
        `)
        .eq('chat_id', sChatId),
      supabase
        .from('messages')
        .select('id, chat_id, sender_id, sender, role, text, time, created_at, is_deleted, deleted_by_admin, deleted_by_group_moderator, is_pinned, reply_to')
        .eq('chat_id', bigId)
        .order('created_at', { ascending: false })
        .limit(30)
    ]);

    const c = chatRes.data as ChatRow | null;
    if (!c || !c.id) return null;

    if (isAdministratorUser(currentUser) && c.tipo !== 'privado') {
      return null;
    }

    const isPrivate = c.tipo === 'privado';
    const members: ChatParticipantInfo[] = [];
    if (Array.isArray(partsRes.data)) {
      for (const row of partsRes.data as any[]) {
        const u = Array.isArray(row.users) ? row.users[0] : row.users;
        if (!isPrivate && isAdministratorUser(u)) continue;
        members.push({
          userId: String(row.user_id),
          name: u?.apodo || u?.usuario || String(row.user_id),
          role: u?.tipo
        });
      }
    }

    const rawMsgs = Array.isArray(msgsRes.data)
      ? [...msgsRes.data].sort((a: any, b: any) => {
          const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
          const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
          return ta - tb;
        })
      : [];

    const mappedMsgs: ChatMessage[] = rawMsgs.map((m: any) => {
      const displayState = resolveRemovedMessageDisplay(m);
      let parsedReplyTo: any = m.reply_to;
      if (typeof parsedReplyTo === 'string') {
        try { parsedReplyTo = JSON.parse(parsedReplyTo); } catch {}
      }
      const isRealReply =
        parsedReplyTo &&
        typeof parsedReplyTo === 'object' &&
        !parsedReplyTo.event &&
        !parsedReplyTo.is_group_init &&
        Boolean(parsedReplyTo.text || parsedReplyTo.sender || parsedReplyTo.id);

      const msgObj: ChatMessage = {
        id: String(m.id),
        chatId: sChatId,
        senderId: String(m.sender_id || ''),
        sender: m.sender || 'Vecino',
        avatar: '',
        role: m.role || 'Vecino',
        text: displayState.text,
        time: m.time || (m.created_at ? formatArgentinaTimeOnly(m.created_at) : ''),
        isDeleted: displayState.isDeleted,
        deletedByAdmin: displayState.deletedByAdmin,
        deletedByGroupModerator: displayState.deletedByGroupModerator,
        isPinned: Boolean(m.is_pinned) && !displayState.isDeleted,
        replyTo: isRealReply
          ? {
              id: String(parsedReplyTo.id || ''),
              sender: String(parsedReplyTo.sender || ''),
              text: String(parsedReplyTo.text || '')
            }
          : undefined,
        createdAt: m.created_at || new Date().toISOString(),
        timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now()
      };
      if (parsedReplyTo && typeof parsedReplyTo === 'object') {
        (msgObj as any).reply_to = parsedReplyTo;
      }
      return msgObj;
    });

    const filteredMsgs = filterChatMessagesForUser(mappedMsgs, sChatId, currentUser, {
      id: sChatId,
      activityId: c.actividad_id || undefined,
      type: isPrivate ? 'privado' : 'grupal',
      messages: mappedMsgs
    });
    const lastMsg = filteredMsgs.length > 0 ? filteredMsgs[filteredMsgs.length - 1] : null;
    const pinnedMsg = getPinnedMessageFromList(filteredMsgs);

    let displayTitle = c.nombre;
    if (isPrivate) {
      const otherMember = members.find((m) => m.userId !== currentUser.id);
      if (otherMember?.name) displayTitle = otherMember.name;
    }

    const mappedChat: Chat = {
      id: c.id,
      title: displayTitle,
      name: displayTitle,
      subtitle: isPrivate ? 'Chat directo' : (c.actividad_id ? `Canal de la actividad: ${c.nombre}` : 'Grupo vecinal'),
      type: isPrivate ? 'privado' : 'grupal',
      activityId: c.actividad_id != null ? (Number(c.actividad_id) || (c.actividad_id as any)) : undefined,
      avatar: c.foto_grupo_url || undefined,
      image: c.foto_grupo_url || undefined,
      creatorId: c.creador_id || undefined,
      participants: members.map((m) => m.name),
      participantIds: members.map((m) => m.userId),
      pinnedMessageId: pinnedMsg ? String(pinnedMsg.id) : undefined,
      lastMessage: lastMsg?.text,
      lastMessageTime: lastMsg?.time,
      updatedAt: lastMsg?.createdAt || c.creado_el,
      messages: filteredMsgs,
      created_at: c.creado_el,
      createdAt: c.creado_el
    };

    return isChatDeletedForUser(mappedChat, currentUser) ? null : mappedChat;
  } catch (err) {
    console.warn('Error en getSingleChatById:', err);
    return null;
  }
}

/**
 * 2. Lógica al CREAR un chat o grupo:
 * a) Inserta la fila en la tabla chats obteniendo su id (UUID).
 * b) Inmediatamente inserta en chat_participants las filas correspondientes:
 *    - Para grupos: una fila para el creador (user_id: currentUser.id) y una fila por cada miembro seleccionado/agregado.
 * Elimina cualquier truco previo que guardaba eventos de miembros en la columna reply_to de la tabla messages.
 */
export async function createGroupChat(params: {
  nombre: string;
  foto_grupo_url?: string | null;
  currentUser: User | { id: string; apodo?: string; usuario?: string; nombre?: string; avatar?: string };
  memberUserIds: string[];
}): Promise<Chat> {
  const { nombre, foto_grupo_url, currentUser, memberUserIds } = params;
  if (!currentUser?.id) {
    throw new Error('Usuario no autenticado para crear grupo.');
  }

  if (isAdministratorUser(currentUser)) {
    throw new Error('Los usuarios administradores no pueden crear ni formar parte de ningún grupo.');
  }

  const cleanName = nombre.trim().replace(/^grupo:\s*/i, '').trim();
  if (!cleanName) {
    throw new Error('El nombre del grupo es obligatorio.');
  }

  // Verificar en Supabase que ni el creador ni ningún miembro seleccionado tenga perfil administrador
  const candidateIdsToCheck = Array.from(
    new Set([currentUser.id, ...memberUserIds.filter(Boolean)].map((id) => String(id).trim()).filter(Boolean))
  );
  if (candidateIdsToCheck.length > 0) {
    try {
      const { data: userRows } = await supabase
        .from('users')
        .select('id, tipo, rol')
        .in('id', candidateIdsToCheck);
      if (Array.isArray(userRows)) {
        const adminRow = userRows.find((u: any) => isAdministratorUser(u));
        if (adminRow) {
          if (String(adminRow.id) === String(currentUser.id)) {
            throw new Error('Los usuarios administradores no pueden crear ni formar parte de ningún grupo.');
          }
          throw new Error('Los usuarios administradores no pueden formar parte de ningún grupo.');
        }
      }
    } catch (checkErr: any) {
      if (checkErr?.message?.includes('administradores no pueden')) {
        throw checkErr;
      }
    }
  }

  // Generar UUID seguro o permitir que Supabase use default gen_random_uuid()
  const newChatUuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : undefined;

  const chatPayload: any = {
    nombre: cleanName,
    tipo: 'grupo_libre',
    creador_id: currentUser.id,
    foto_grupo_url: foto_grupo_url || null
  };
  if (newChatUuid) {
    chatPayload.id = newChatUuid;
  }

  // a) Insertar la fila en la tabla chats
  const { data: newChat, error: chatErr } = await supabase
    .from('chats')
    .insert(chatPayload)
    .select('id, nombre, tipo, foto_grupo_url, creado_el, creador_id')
    .single();

  if (chatErr || !newChat) {
    console.error('Error insertando grupo en Supabase:', chatErr);
    throw new Error(chatErr?.message || 'Error al crear el grupo.');
  }

  // b) Inmediatamente insertar en chat_participants: creador + miembros seleccionados
  const uniqueMemberIds = Array.from(
    new Set([currentUser.id, ...memberUserIds.filter(Boolean)])
  );

  const participantRows = uniqueMemberIds.map((uid) => ({
    chat_id: newChat.id,
    user_id: uid
  }));

  const { error: partErr } = await supabase
    .from('chat_participants')
    .insert(participantRows);

  if (partErr) {
    console.warn('Advertencia insertando miembros en chat_participants:', partErr.message);
    // Asegurar que al menos el creador quede registrado
    await supabase.from('chat_participants').insert([
      { chat_id: newChat.id, user_id: currentUser.id }
    ]);
  }

  const myDisplayName = (currentUser as any).apodo || (currentUser as any).nombre || (currentUser as any).usuario || 'Organizador';

  return {
    id: newChat.id,
    title: newChat.nombre,
    name: newChat.nombre,
    subtitle: 'Grupo vecinal',
    type: 'grupal',
    avatar: newChat.foto_grupo_url || undefined,
    image: newChat.foto_grupo_url || undefined,
    creatorId: currentUser.id,
    creatorName: myDisplayName,
    adminUsernames: [myDisplayName.toLowerCase()],
    participants: [myDisplayName],
    participantIds: uniqueMemberIds,
    messages: [],
    created_at: newChat.creado_el,
    createdAt: newChat.creado_el
  };
}

/**
 * 2. Lógica al CREAR un chat directo:
 * a) Inserta fila en chats con tipo 'privado' obteniendo su id (UUID).
 * b) Inmediatamente inserta dos filas en chat_participants (una para el emisor y otra para el receptor).
 */
export async function createDirectChat(params: {
  currentUser: User | { id: string; apodo?: string; usuario?: string; nombre?: string; avatar?: string };
  otherUser: User | { id: string; apodo?: string; usuario?: string; nombre?: string; avatar?: string };
}): Promise<Chat> {
  const { currentUser, otherUser } = params;
  if (!currentUser?.id || !otherUser?.id) {
    throw new Error('Identificadores no válidos para iniciar chat directo.');
  }

  const otherDisplayName = otherUser.apodo || (otherUser as any).nombre || otherUser.usuario || 'Chat Privado';

  // Verificar si hay bloqueo activo entre ambos usuarios
  try {
    const { data: userRows } = await supabase
      .from('users')
      .select('id, usuario, apodo, blocked_users')
      .in('id', [String(currentUser.id), String(otherUser.id)]);

    if (Array.isArray(userRows) && userRows.length > 0) {
      const senderRow = userRows.find(u => String(u.id) === String(currentUser.id));
      const recipientRow = userRows.find(u => String(u.id) === String(otherUser.id));

      const senderTokens = [
        senderRow?.id, senderRow?.usuario, senderRow?.apodo, (senderRow as any)?.nombre,
        (currentUser as any).id, (currentUser as any).usuario, (currentUser as any).apodo, (currentUser as any).nombre
      ].filter(Boolean).map(t => String(t).toLowerCase().trim());

      const recipientTokens = [
        recipientRow?.id, recipientRow?.usuario, recipientRow?.apodo, (recipientRow as any)?.nombre,
        (otherUser as any).id, (otherUser as any).usuario, (otherUser as any).apodo, (otherUser as any).nombre
      ].filter(Boolean).map(t => String(t).toLowerCase().trim());

      const senderBlocked = Array.isArray(senderRow?.blocked_users) ? senderRow.blocked_users.map((b: any) => String(b).toLowerCase().trim()) : [];
      const recipientBlocked = Array.isArray(recipientRow?.blocked_users) ? recipientRow.blocked_users.map((b: any) => String(b).toLowerCase().trim()) : [];

      if (recipientTokens.some(tok => senderBlocked.includes(tok))) {
        throw new Error('Has bloqueado a este usuario. Desbloquealo para interactuar con él.');
      }
      if (senderTokens.some(tok => recipientBlocked.includes(tok))) {
        throw new Error('El usuario te ha bloqueado. No es posible iniciar un chat privado.');
      }
    }
  } catch (bErr: any) {
    if (bErr.message && (bErr.message.includes('bloqueado') || bErr.message.includes('restringida'))) {
      throw bErr;
    }
  }

  // Verificar si ya existe un chat directo compartido entre ambos en una sola consulta .in()
  try {
    const { data: myParticipations } = await supabase
      .from('chat_participants')
      .select(`
        chat_id,
        chats:chat_id (
          id,
          nombre,
          tipo,
          foto_grupo_url,
          creado_el,
          creador_id
        )
      `)
      .eq('user_id', currentUser.id);

    if (Array.isArray(myParticipations)) {
      const privateChatsMap = new Map<string, ChatRow>();
      for (const item of myParticipations) {
        const rawChat = (item as any)?.chats;
        const c = Array.isArray(rawChat) ? rawChat[0] : rawChat;
        if (c && c.tipo === 'privado' && c.id) {
          privateChatsMap.set(String(c.id), c as ChatRow);
        }
      }

      const privateChatIds = Array.from(privateChatsMap.keys());
      if (privateChatIds.length > 0) {
        const { data: sharedParts } = await supabase
          .from('chat_participants')
          .select('chat_id, user_id')
          .in('chat_id', privateChatIds)
          .eq('user_id', otherUser.id)
          .limit(1);

        const matchedPart = Array.isArray(sharedParts) && sharedParts.length > 0 ? sharedParts[0] : null;
        if (matchedPart) {
          const existing = privateChatsMap.get(String(matchedPart.chat_id));
          if (existing) {
            return {
              id: existing.id,
              title: otherDisplayName,
              name: otherDisplayName,
              subtitle: 'Chat directo',
              type: 'privado',
              avatar: otherUser.avatar || undefined,
              creatorId: existing.creador_id || currentUser.id,
              participants: [otherDisplayName],
              participantIds: [currentUser.id, otherUser.id],
              messages: [],
              created_at: existing.creado_el,
              createdAt: existing.creado_el
            };
          }
        }
      }
    }
  } catch (checkErr) {
    console.warn('Error verificando chat directo existente:', checkErr);
  }

  // a) Inserta la fila en la tabla chats obteniendo su id (UUID)
  const newChatUuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : undefined;

  const chatPayload: any = {
    nombre: otherDisplayName,
    tipo: 'privado',
    creador_id: currentUser.id,
    foto_grupo_url: null
  };
  if (newChatUuid) {
    chatPayload.id = newChatUuid;
  }

  const { data: newChat, error: chatErr } = await supabase
    .from('chats')
    .insert(chatPayload)
    .select('id, nombre, tipo, foto_grupo_url, creado_el, creador_id')
    .single();

  if (chatErr || !newChat) {
    console.error('Error insertando chat directo en Supabase:', chatErr);
    throw new Error(chatErr?.message || 'Error al iniciar chat directo.');
  }

  // b) Inmediatamente inserta en chat_participants dos filas (emisor y receptor)
  const { error: partErr } = await supabase
    .from('chat_participants')
    .insert([
      { chat_id: newChat.id, user_id: currentUser.id },
      { chat_id: newChat.id, user_id: otherUser.id }
    ]);

  if (partErr) {
    console.warn('Error insertando participantes en chat directo:', partErr.message);
  }

  return {
    id: newChat.id,
    title: otherDisplayName,
    name: otherDisplayName,
    subtitle: 'Chat directo',
    type: 'privado',
    avatar: otherUser.avatar || undefined,
    creatorId: currentUser.id,
    participants: [otherDisplayName],
    participantIds: [currentUser.id, otherUser.id],
    messages: [],
    created_at: newChat.creado_el,
    createdAt: newChat.creado_el
  };
}

/**
 * 3. Lectura de mensajes:
 * Al abrir una conversación seleccionada, carga los últimos 80 mensajes con columnas explícitas (sin avatar Base64).
 */
export async function getChatMessages(selectedChatId: string | number, currentUser?: any): Promise<ChatMessage[]> {
  if (!selectedChatId) return [];

  let user = currentUser;
  if (!user && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem('club65_user') || localStorage.getItem('currentUser') || '{}';
      user = JSON.parse(raw);
    } catch (_) {}
  }

  try {
    const bigChatId = chatIdentifierToBigInt(selectedChatId);
    const { data, error } = await supabase
      .from('messages')
      .select('id, chat_id, sender_id, sender, role, text, time, created_at, is_deleted, deleted_by_admin, deleted_by_group_moderator, is_pinned, reply_to')
      .eq('chat_id', bigChatId)
      .order('created_at', { ascending: false })
      .limit(80);

    if (error) {
      console.warn('Error recuperando mensajes de Supabase:', error.message);
      return [];
    }

    if (!Array.isArray(data)) return [];

    const chronologicalData = [...data].sort((a: any, b: any) => {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });

    const loadedMsgs = chronologicalData.map((m: any) => {
      const displayState = resolveRemovedMessageDisplay(m);
      const isPinned = Boolean(m.is_pinned) && !displayState.isDeleted;

      let parsedReplyTo: any = m.reply_to;
      if (typeof parsedReplyTo === 'string') {
        try {
          parsedReplyTo = JSON.parse(parsedReplyTo);
        } catch {}
      }

      const isRealReply =
        parsedReplyTo &&
        typeof parsedReplyTo === 'object' &&
        !parsedReplyTo.event &&
        !parsedReplyTo.is_group_init &&
        Boolean(parsedReplyTo.text || parsedReplyTo.sender || parsedReplyTo.id);

      const msgItem: ChatMessage = {
        id: String(m.id),
        chatId: String(selectedChatId),
        senderId: String(m.sender_id || m.senderId || ''),
        sender: m.sender || m.remitente || 'Vecino',
        avatar: m.avatar || '',
        role: m.role || 'Vecino',
        text: displayState.text,
        isDeleted: displayState.isDeleted,
        deletedByAdmin: displayState.deletedByAdmin,
        deletedByGroupModerator: displayState.deletedByGroupModerator,
        retirado: displayState.isDeleted,
        isPinned,
        time: m.time || (m.created_at ? formatArgentinaTimeOnly(m.created_at) : 'Recién'),
        replyTo: isRealReply
          ? {
              id: String(parsedReplyTo.id || ''),
              sender: String(parsedReplyTo.sender || ''),
              text: String(parsedReplyTo.text || '')
            }
          : undefined,
        createdAt: m.created_at || new Date().toISOString(),
        timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now()
      };
      if (parsedReplyTo && typeof parsedReplyTo === 'object') {
        (msgItem as any).reply_to = parsedReplyTo;
      }
      return msgItem;
    });

    return filterChatMessagesForUser(loadedMsgs, selectedChatId, user, {
      id: String(selectedChatId),
      messages: loadedMsgs
    });
  } catch (err) {
    console.warn('Excepción en getChatMessages:', err);
    return [];
  }
}

/**
 * 3. Envío de mensajes:
 * Asegura que el payload use el chat_id correspondiente al chat abierto y el sender_id del usuario logueado.
 */
export async function sendChatMessage(params: {
  selectedChatId: string | number;
  text: string;
  currentUser: User | { id: string; apodo?: string; usuario?: string; nombre?: string; avatar?: string; tipo?: string };
  replyTo?: { id: string; sender: string; text: string };
  providedMsgId?: string;
  chatType?: 'grupal' | 'privado';
}): Promise<ChatMessage> {
  const { selectedChatId, text, currentUser, replyTo, providedMsgId, chatType } = params;
  if (!selectedChatId) throw new Error('Identificador de chat no válido.');
  if (!currentUser?.id) throw new Error('Usuario no autenticado.');

  const cleanText = text.trim();
  if (!cleanText) throw new Error('El mensaje no puede estar vacío.');

  // Validar membresía en chats grupales y bloqueos en chats privados directamente en Supabase
  try {
    const sChatId = String(selectedChatId);
    const { data: chatRow } = await supabase
      .from('chats')
      .select('id, tipo, chat_participants(user_id)')
      .eq('id', sChatId)
      .maybeSingle();

    if (chatRow) {
      const participants: any[] = Array.isArray((chatRow as any).chat_participants)
        ? (chatRow as any).chat_participants
        : [];

      if (chatRow.tipo !== 'privado' || chatType === 'grupal') {
        const isActiveMember = participants.some(p => String(p.user_id) === String(currentUser.id));
        if (!isActiveMember) {
          throw new Error('Ya no formás parte de este grupo. No podés enviar mensajes en esta conversación.');
        }
      } else if (chatRow.tipo === 'privado') {
        const otherPart = participants.find(p => String(p.user_id) !== String(currentUser.id));
        if (otherPart && otherPart.user_id) {
          const { data: userRows } = await supabase
            .from('users')
            .select('id, usuario, apodo, blocked_users')
            .in('id', [String(currentUser.id), String(otherPart.user_id)]);

          if (Array.isArray(userRows) && userRows.length > 0) {
            const senderRow = userRows.find(u => String(u.id) === String(currentUser.id));
            const recipientRow = userRows.find(u => String(u.id) === String(otherPart.user_id));

            const senderTokens = [
              senderRow?.id, senderRow?.usuario, senderRow?.apodo, (senderRow as any)?.nombre,
              (currentUser as any).id, (currentUser as any).usuario, (currentUser as any).apodo, (currentUser as any).nombre
            ].filter(Boolean).map(t => String(t).toLowerCase().trim());

            const recipientTokens = [
              recipientRow?.id, recipientRow?.usuario, recipientRow?.apodo, (recipientRow as any)?.nombre
            ].filter(Boolean).map(t => String(t).toLowerCase().trim());

            const senderBlocked = Array.isArray(senderRow?.blocked_users) ? senderRow.blocked_users.map((b: any) => String(b).toLowerCase().trim()) : [];
            const recipientBlocked = Array.isArray(recipientRow?.blocked_users) ? recipientRow.blocked_users.map((b: any) => String(b).toLowerCase().trim()) : [];

            if (recipientTokens.some(tok => senderBlocked.includes(tok))) {
              throw new Error('Has bloqueado a este usuario. Desbloquealo para interactuar con él.');
            }
            if (senderTokens.some(tok => recipientBlocked.includes(tok))) {
              throw new Error('El usuario te ha bloqueado. La comunicación en este chat está restringida.');
            }
          }
        }
      }
    }
  } catch (guardErr: any) {
    if (
      guardErr?.message &&
      (guardErr.message.includes('bloqueado') ||
        guardErr.message.includes('restringida') ||
        guardErr.message.includes('formás parte'))
    ) {
      throw guardErr;
    }
  }

  const nowMs = Date.now();
  const createdIso = new Date(nowMs).toISOString();
  const clientMsgId = providedMsgId || `msg_${nowMs}_${Math.random().toString(36).substring(2, 7)}`;
  const senderName =
    (currentUser as any).apodo ||
    (currentUser as any).nombre ||
    (currentUser as any).usuario ||
    'Vecino';
  const role =
    currentUser.tipo === 'moderador'
      ? 'Administrador'
      : (currentUser.tipo === 'institucional' ? 'Institución' : 'Vecino');
  const timeStr = formatArgentinaTimeOnly(new Date(nowMs));

  const payload: any = {
    id: clientMsgId,
    chat_id: chatIdentifierToBigInt(selectedChatId),
    sender_id: currentUser.id,
    sender: senderName,
    avatar: currentUser.avatar || '',
    role,
    text: cleanText,
    time: timeStr,
    created_at: createdIso,
    reply_to: replyTo ? JSON.stringify(replyTo) : null,
    is_deleted: false,
    is_pinned: false
  };

  const { data, error } = await supabase.from('messages').insert(payload).select().single();

  if (error) {
    console.error('Error insertando mensaje en Supabase:', error);
    throw new Error(error.message || 'Error al enviar mensaje');
  }

  return {
    id: data?.id ? String(data.id) : clientMsgId,
    chatId: String(selectedChatId),
    senderId: currentUser.id,
    sender: senderName,
    avatar: currentUser.avatar || '',
    role,
    text: cleanText,
    time: timeStr,
    isDeleted: false,
    isPinned: false,
    replyTo: replyTo || undefined,
    createdAt: createdIso,
    timestamp: nowMs
  };
}

/**
 * Salir voluntariamente de un chat:
 * Remueve al usuario de chat_participants para este chat.
 */
export async function leaveChat(chatId: string | number, userId: string): Promise<void> {
  if (!chatId || !userId) return;
  try {
    await supabase
      .from('chat_participants')
      .delete()
      .eq('chat_id', String(chatId))
      .eq('user_id', String(userId));
  } catch (err) {
    console.warn('Error al salir de chat en chat_participants:', err);
  }
}

/**
 * Agregar un participante a un grupo existente en chat_participants:
 */
export async function addParticipantToGroup(chatId: string | number, userId: string): Promise<void> {
  if (!chatId || !userId) return;
  try {
    const { data: uRow } = await supabase
      .from('users')
      .select('id, tipo, rol')
      .eq('id', String(userId))
      .maybeSingle();
    if (isAdministratorUser(uRow)) {
      throw new Error('Los usuarios administradores no pueden formar parte de ningún grupo.');
    }
  } catch (checkErr: any) {
    if (checkErr?.message?.includes('administradores no pueden')) {
      throw checkErr;
    }
  }
  try {
    await supabase
      .from('chat_participants')
      .insert({
        chat_id: String(chatId),
        user_id: String(userId)
      });
  } catch (err) {
    console.warn('Error agregando participante a chat_participants:', err);
  }
}

/**
 * Remover un participante de un grupo en chat_participants:
 */
export async function removeParticipantFromGroup(chatId: string | number, userId: string): Promise<void> {
  if (!chatId || !userId) return;
  try {
    await supabase
      .from('chat_participants')
      .delete()
      .eq('chat_id', String(chatId))
      .eq('user_id', String(userId));
  } catch (err) {
    console.warn('Error removiendo participante de chat_participants:', err);
  }
}

/**
 * Crea o vincula automáticamente el chat de una actividad en Supabase:
 * a) Inserta o encuentra la fila en la tabla `chats` con tipo 'grupo_actividad', id UUID y creador_id.
 * b) Inmediatamente inserta en `chat_participants` la membresía del creador/organizador.
 * c) Si el chat es nuevo, inserta el mensaje de bienvenida inicial en `messages`.
 */
export async function createActivityChat(params: {
  activity: Partial<Activity> & {
    id: string | number;
    title: string;
    image?: string | null;
    organizerId?: string;
    creador_id?: string;
    organizer?: string;
    organizerName?: string;
  };
  currentUser: User | { id: string; apodo?: string; usuario?: string; nombre?: string; avatar?: string; tipo?: string };
}): Promise<Chat> {
  const { activity, currentUser } = params;
  if (!currentUser?.id) {
    throw new Error('Usuario no autenticado para crear el chat de la actividad.');
  }

  const rawTitle = (activity.title || (activity as any).titulo || (activity as any).nombre || 'Actividad').trim();
  const cleanTitle = rawTitle.replace(/^grupo:\s*/i, '').trim();
  const groupTitle = cleanTitle;
  const actIdForChat = normalizeActivityIdForChat(activity.id);

  // 1. Buscar si ya existe un chat para esta actividad en la tabla chats (orden ascendente por creación)
  let existingChat: any = null;
  try {
    const { data: allActChats } = await supabase
      .from('chats')
      .select('id, nombre, tipo, foto_grupo_url, creado_el, creador_id, actividad_id')
      .eq('tipo', 'grupo_actividad')
      .order('creado_el', { ascending: true });

    const matchingList = (Array.isArray(allActChats) ? allActChats : []).filter((c: any) =>
      doesDbChatRowMatchActivity(c, activity.id, cleanTitle)
    );

    if (matchingList.length > 0) {
      // Priorizar el chat que ya tenga el actividad_id vinculado
      matchingList.sort((a: any, b: any) => {
        const aExact = actIdForChat !== null && a.actividad_id != null && String(a.actividad_id) === String(actIdForChat) ? 0 : 1;
        const bExact = actIdForChat !== null && b.actividad_id != null && String(b.actividad_id) === String(actIdForChat) ? 0 : 1;
        return aExact - bExact;
      });
      existingChat = matchingList[0];
      // Si hubiese filas duplicadas en Supabase para la misma actividad, consolidar mensajes y participantes en el chat principal y borrar los clones
      if (matchingList.length > 1) {
        const primaryId = matchingList[0].id;
        for (const dup of matchingList.slice(1)) {
          try {
            const primaryBig = chatIdentifierToBigInt(primaryId);
            const dupBig = chatIdentifierToBigInt(dup.id);
            await supabase.from('messages').update({ chat_id: primaryBig }).eq('chat_id', dupBig);
            await supabase.from('chat_participants').delete().eq('chat_id', dup.id);
            await supabase.from('chats').delete().eq('id', dup.id);
          } catch (e) {
            console.warn('Aviso limpiando chat duplicado en Supabase:', e);
          }
        }
      }
    }
  } catch (findErr) {
    console.warn('Error buscando chat previo de actividad:', findErr);
  }

  let chatId = existingChat?.id;
  let chatCreatedEl = existingChat?.creado_el || new Date().toISOString();
  const avatarUrl = activity.image || (activity as any).imagen_url || (activity as any).foto || existingChat?.foto_grupo_url || null;

  if (!existingChat) {
    // 2. Crear nueva fila única en chats
    const newChatUuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : undefined;

    const chatPayload: any = {
      nombre: groupTitle,
      tipo: 'grupo_actividad',
      creador_id: currentUser.id,
      foto_grupo_url: avatarUrl,
      creado_el: chatCreatedEl
    };
    if (newChatUuid) {
      chatPayload.id = newChatUuid;
    }
    if (actIdForChat !== null) {
      chatPayload.actividad_id = actIdForChat;
    }

    const { data: newChat, error: chatErr } = await supabase
      .from('chats')
      .insert(chatPayload)
      .select('id, nombre, tipo, foto_grupo_url, creado_el, creador_id, actividad_id')
      .single();

    if (chatErr || !newChat) {
      console.error('Error insertando chat de actividad en chats:', chatErr);
      throw new Error(chatErr?.message || 'Error al crear el chat de la actividad.');
    }
    chatId = newChat.id;
    chatCreatedEl = newChat.creado_el;
  } else {
    // Si ya existía, asegurar estandarización de nombre, creador, foto y vínculo actividad_id
    const patchPayload: Record<string, any> = {};
    if (existingChat.nombre !== groupTitle) {
      patchPayload.nombre = groupTitle;
    }
    if (!existingChat.creador_id && currentUser.id) {
      patchPayload.creador_id = currentUser.id;
    }
    if ((existingChat.actividad_id === null || existingChat.actividad_id === undefined) && actIdForChat !== null) {
      patchPayload.actividad_id = actIdForChat;
    }
    if (!existingChat.foto_grupo_url && avatarUrl) {
      patchPayload.foto_grupo_url = avatarUrl;
    }
    if (Object.keys(patchPayload).length > 0) {
      await supabase.from('chats').update(patchPayload).eq('id', chatId);
    }
  }

  // 3. Inmediatamente asegurar que el creador esté registrado en chat_participants (NUNCA si es administrador)
  let isCreatorAdmin = isAdministratorUser(currentUser);
  if (!isCreatorAdmin) {
    try {
      const { data: creatorRow } = await supabase
        .from('users')
        .select('id, tipo, rol')
        .eq('id', currentUser.id)
        .maybeSingle();
      if (isAdministratorUser(creatorRow)) {
        isCreatorAdmin = true;
      }
    } catch (_) {}
  }

  if (!isCreatorAdmin) {
    try {
      const { data: existingPart } = await supabase
        .from('chat_participants')
        .select('id')
        .eq('chat_id', chatId)
        .eq('user_id', currentUser.id)
        .limit(1);

      if (!existingPart || existingPart.length === 0) {
        const partRow: any = {
          chat_id: chatId,
          user_id: currentUser.id,
          joined_at: new Date().toISOString()
        };
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          partRow.id = crypto.randomUUID();
        }
        await supabase.from('chat_participants').insert(partRow);
      }
    } catch (partErr) {
      console.warn('Error vinculando creador a chat_participants:', partErr);
    }
  }

  // 4. Si el chat no tiene mensajes, insertar mensaje de bienvenida inicial
  try {
    const bigChatId = chatIdentifierToBigInt(chatId);
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('chat_id', bigChatId);

    if (!count || count === 0) {
      const myDisplayName = (currentUser as any).apodo || (currentUser as any).nombre || (currentUser as any).usuario || 'Organizador';
      const welcomeMsg = {
        id: `msg_${Date.now()}_init`,
        chat_id: bigChatId,
        sender_id: currentUser.id,
        sender: myDisplayName,
        avatar: currentUser.avatar || '',
        role: currentUser.tipo === 'institucional' ? 'Institución' : 'Vecino',
        text: `¡Bienvenidos al grupo de la actividad "${cleanTitle}"! Este canal es para coordinar detalles y novedades entre los participantes.`,
        time: formatArgentinaTimeOnly(new Date()),
        created_at: new Date().toISOString()
      };
      await supabase.from('messages').insert(welcomeMsg);
    }
  } catch (msgErr) {
    console.warn('Error insertando mensaje inicial en chat de actividad:', msgErr);
  }

  const myDisplayName = (currentUser as any).apodo || (currentUser as any).nombre || (currentUser as any).usuario || 'Organizador';

  return {
    id: chatId,
    title: groupTitle,
    name: groupTitle,
    subtitle: `Canal de la actividad: ${cleanTitle}`,
    type: 'grupal',
    activityId: Number(activity.id) || (activity.id as any) || null,
    avatar: avatarUrl || undefined,
    image: avatarUrl || undefined,
    creatorId: currentUser.id,
    creatorName: myDisplayName,
    organizer: myDisplayName,
    organizerId: currentUser.id,
    adminUsernames: isCreatorAdmin ? [] : [myDisplayName.toLowerCase()],
    participants: isCreatorAdmin ? [] : [myDisplayName],
    participantIds: isCreatorAdmin ? [] : [currentUser.id],
    messages: [],
    created_at: chatCreatedEl,
    createdAt: chatCreatedEl
  };
}

/**
 * Inscribe a un usuario en el chat grupal de una actividad:
 * - Localiza o crea el chat de la actividad en chats.
 * - Inserta una fila en chat_participants para currentUser.id.
 * - Registra mensaje de bienvenida del sistema.
 */
export async function enrollUserInActivityChat(params: {
  activityId: string | number;
  activityTitle: string;
  activityImage?: string | null;
  currentUser: User | { id: string; apodo?: string; usuario?: string; nombre?: string; avatar?: string; tipo?: string; rol?: string };
}): Promise<void> {
  const { activityId, activityTitle, activityImage, currentUser } = params;
  if (!currentUser?.id) return;

  // REGLA ESTRICTA: Los usuarios administradores nunca forman parte de ningún grupo
  if (isAdministratorUser(currentUser)) return;
  try {
    const { data: uRow } = await supabase
      .from('users')
      .select('id, tipo, rol')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (isAdministratorUser(uRow)) return;
  } catch (_) {}

  const rawTitle = activityTitle.trim();
  const cleanTitle = rawTitle.replace(/^grupo:\s*/i, '').trim();
  const groupTitle = cleanTitle;
  const actIdForChat = normalizeActivityIdForChat(activityId);

  let chatId: string | null = null;
  try {
    const { data: allActChats } = await supabase
      .from('chats')
      .select('id, nombre, actividad_id')
      .eq('tipo', 'grupo_actividad')
      .order('creado_el', { ascending: true });

    const foundList = (Array.isArray(allActChats) ? allActChats : []).filter((c: any) =>
      doesDbChatRowMatchActivity(c, activityId, cleanTitle)
    );

    if (foundList.length > 0) {
      chatId = String(foundList[0].id);
      if (foundList.length > 1) {
        for (const dup of foundList.slice(1)) {
          try {
            const primaryBig = chatIdentifierToBigInt(chatId);
            const dupBig = chatIdentifierToBigInt(dup.id);
            await supabase.from('messages').update({ chat_id: primaryBig }).eq('chat_id', dupBig);
            await supabase.from('chat_participants').delete().eq('chat_id', dup.id);
            await supabase.from('chats').delete().eq('id', dup.id);
          } catch (_) {}
        }
      }
    } else {
      const newChatUuid = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : undefined;
      const newPayload: any = {
        nombre: groupTitle,
        tipo: 'grupo_actividad',
        foto_grupo_url: activityImage || null,
        creado_el: new Date().toISOString()
      };
      if (newChatUuid) newPayload.id = newChatUuid;
      if (actIdForChat !== null) newPayload.actividad_id = actIdForChat;

      const { data: created } = await supabase.from('chats').insert(newPayload).select('id').single();
      chatId = created?.id || newChatUuid || null;
    }
  } catch (err) {
    console.warn('Error localizando chat para inscripción:', err);
  }

  if (!chatId) return;

  // Registrar al participante en chat_participants de forma idempotente
  try {
    const { data: existing } = await supabase
      .from('chat_participants')
      .select('id')
      .eq('chat_id', chatId)
      .eq('user_id', currentUser.id)
      .limit(1);

    if (!existing || existing.length === 0) {
      const partRow: any = {
        chat_id: chatId,
        user_id: currentUser.id,
        joined_at: new Date().toISOString()
      };
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        partRow.id = crypto.randomUUID();
      }
      await supabase.from('chat_participants').insert(partRow);

      // Mensaje de bienvenida
      const displayName = currentUser.apodo || currentUser.usuario || 'Un nuevo vecino';
      await supabase.from('messages').insert({
        id: `msg_${Date.now()}_join`,
        chat_id: chatIdentifierToBigInt(chatId),
        sender_id: 'sistema',
        sender: 'Sistema CLUB65',
        avatar: '👋',
        role: 'sistema',
        text: `¡Bienvenido a ${cleanTitle}, ${displayName}!`,
        time: formatArgentinaTimeOnly(new Date()),
        created_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.warn('Error añadiendo usuario a chat_participants:', err);
  }
}

/**
 * Remueve al usuario de chat_participants cuando se desinscribe de una actividad.
 */
export async function unenrollUserFromActivityChat(params: {
  activityId: string | number;
  activityTitle?: string;
  userId: string;
}): Promise<void> {
  const { activityId, activityTitle, userId } = params;
  if (!userId) return;

  try {
    const { data: allActChats } = await supabase
      .from('chats')
      .select('id, nombre, tipo, actividad_id')
      .neq('tipo', 'privado')
      .order('creado_el', { ascending: true });

    const foundList = (Array.isArray(allActChats) ? allActChats : []).filter((c: any) =>
      doesDbChatRowMatchActivity(c, activityId, activityTitle)
    );
    if (foundList.length > 0) {
      const chatIds = foundList.map(c => c.id);
      await supabase
        .from('chat_participants')
        .delete()
        .in('chat_id', chatIds)
        .eq('user_id', userId);
    }
  } catch (err) {
    console.warn('Error al desinscribir de chat_participants:', err);
  }
}

