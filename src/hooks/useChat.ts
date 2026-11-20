import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Chat, ChatMessage, User, Activity } from '../types';
import * as chatService from '../services/chatService';
import { supabase } from '../supabaseClient';
import {
  chatIdentifierToBigInt,
  getPinnedMessageFromList,
  getUserChatDepartureTimestamp,
  buildChatUserTokens
} from '../utils/chatLogic';
import { resolveRemovedMessageDisplay } from '../utils/reportsAndSanctions';

export function useChat(currentUser: User | null) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChats, setLoadingChats] = useState<boolean>(false);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const recentlySentMsgIdsRef = useRef<Set<string>>(new Set());
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const currentUserRef = useRef<User | null>(currentUser);
  currentUserRef.current = currentUser;

  // 1. Cargar la lista de chats del usuario autenticado cruzando únicamente con chat_participants
  const currentUserId = currentUser?.id ? String(currentUser.id) : null;

  const refreshChats = useCallback(async () => {
    const activeUser = currentUserRef.current;
    if (!activeUser || !activeUser.id) {
      setChats([]);
      setActiveChatId(null);
      setMessages([]);
      return;
    }

    setLoadingChats(true);
    setError(null);
    try {
      const userChats = await chatService.getUserChats(activeUser);
      setChats(userChats);
    } catch (err: any) {
      console.error('Error cargando chats del usuario:', err);
      setError(err?.message || 'Error al cargar conversaciones');
      setChats([]);
    } finally {
      setLoadingChats(false);
    }
  }, [currentUserId]);

  // Carga inicial y ante cambio de usuario
  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  // 2. Chat actualmente seleccionado
  const activeChat = useMemo(() => {
    if (!activeChatId) return null;
    return chats.find((c) => String(c.id) === String(activeChatId)) || null;
  }, [chats, activeChatId]);

  // 3. Cargar mensajes cuando se selecciona una conversación
  const loadMessages = useCallback(async (chatId: string | number) => {
    if (!chatId) {
      setMessages([]);
      return;
    }

    setLoadingMessages(true);
    try {
      const chatMsgs = await chatService.getChatMessages(chatId, currentUserRef.current);
      setMessages(chatMsgs);

      const pinnedMsg = getPinnedMessageFromList(chatMsgs);

      // Actualizar también los mensajes en la lista local de chats para snippets
      setChats((prev) =>
        prev.map((c) =>
          String(c.id) === String(chatId)
            ? {
                ...c,
                pinnedMessageId: pinnedMsg ? String(pinnedMsg.id) : undefined,
                messages: chatMsgs,
                lastMessage: chatMsgs[chatMsgs.length - 1]?.text || c.lastMessage,
                lastMessageTime: chatMsgs[chatMsgs.length - 1]?.time || c.lastMessageTime
              }
            : c
        )
      );
    } catch (err) {
      console.warn('Error cargando mensajes del chat seleccionado:', err);
    } finally {
      setLoadingMessages(false);
    }
  }, [currentUserId]);

  // Al cambiar activeChatId, cargar estrictamente los mensajes de ese chat
  useEffect(() => {
    if (activeChatId) {
      loadMessages(activeChatId);
    } else {
      setMessages([]);
    }
  }, [activeChatId, loadMessages]);

  // 4. Suscripción en tiempo real a nuevos mensajes para el chat abierto
  useEffect(() => {
    if (!activeChatId) return;

    const targetChatIdStr = String(activeChatId);
    const bigChatIdStr = String(chatIdentifierToBigInt(activeChatId));

    const channel = supabase
      .channel(`chat_messages_${targetChatIdStr}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${bigChatIdStr}`
        },
        (payload: any) => {
          const newRow = payload?.new;
          if (!newRow) return;

          // Ignorar el eco de Realtime para un mensaje recién enviado localmente
          if (recentlySentMsgIdsRef.current.has(String(newRow.id))) {
            return;
          }

          const displayState = resolveRemovedMessageDisplay(newRow);

          let parsedReplyTo = newRow.reply_to;
          if (typeof parsedReplyTo === 'string') {
            try { parsedReplyTo = JSON.parse(parsedReplyTo); } catch {}
          }

          const newMsg: ChatMessage = {
            id: String(newRow.id),
            chatId: targetChatIdStr,
            senderId: String(newRow.sender_id || ''),
            sender: newRow.sender || 'Vecino',
            avatar: newRow.avatar || '',
            role: newRow.role || 'Vecino',
            text: displayState.text,
            time: newRow.time || 'Recién',
            isDeleted: displayState.isDeleted,
            deletedByAdmin: displayState.deletedByAdmin,
            deletedByGroupModerator: displayState.deletedByGroupModerator,
            isPinned: Boolean(newRow.is_pinned) && !displayState.isDeleted,
            replyTo: (parsedReplyTo && !parsedReplyTo.event) ? parsedReplyTo : undefined,
            createdAt: newRow.created_at || new Date().toISOString(),
            timestamp: newRow.created_at ? new Date(newRow.created_at).getTime() : Date.now()
          };
          if (parsedReplyTo && typeof parsedReplyTo === 'object') {
            (newMsg as any).reply_to = parsedReplyTo;
          }

          const liveChat = chatsRef.current.find((c) => String(c.id) === targetChatIdStr);
          const departureAt = liveChat ? getUserChatDepartureTimestamp(liveChat, currentUserRef.current) : 0;
          if (departureAt > 0 && (newMsg.timestamp || Date.now()) > departureAt) {
            return;
          }

          setMessages((prev) => {
            if (prev.some((m) => String(m.id) === String(newMsg.id))) return prev;
            return [...prev, newMsg];
          });

          setChats((prev) =>
            prev.map((c) =>
              String(c.id) === targetChatIdStr
                ? {
                    ...c,
                    pinnedMessageId: newMsg.isPinned && !newMsg.isDeleted ? String(newMsg.id) : c.pinnedMessageId,
                    lastMessage: newMsg.text,
                    lastMessageTime: newMsg.time,
                    updatedAt: newMsg.createdAt
                  }
                : c
            )
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${bigChatIdStr}`
        },
        (payload: any) => {
          const newRow = payload?.new;
          if (!newRow || !newRow.id) return;

          const displayState = resolveRemovedMessageDisplay(newRow);
          const isPinnedRow = Boolean(newRow.is_pinned) && !displayState.isDeleted;

          setMessages((prev) =>
            prev.map((m) => {
              if (String(m.id) === String(newRow.id)) {
                return {
                  ...m,
                  isDeleted: displayState.isDeleted,
                  deletedByAdmin: displayState.deletedByAdmin,
                  deletedByGroupModerator: displayState.deletedByGroupModerator,
                  isPinned: isPinnedRow,
                  text: displayState.isDeleted ? displayState.text : (newRow.text !== undefined ? newRow.text : m.text)
                };
              }
              if (isPinnedRow && m.isPinned) {
                return { ...m, isPinned: false };
              }
              return m;
            })
          );

          setChats((prev) =>
            prev.map((c) => {
              if (String(c.id) !== targetChatIdStr) return c;
              const updatedMsgs = (c.messages || []).map((m) => {
                if (String(m.id) === String(newRow.id)) {
                  return {
                    ...m,
                    isDeleted: displayState.isDeleted,
                    deletedByAdmin: displayState.deletedByAdmin,
                    deletedByGroupModerator: displayState.deletedByGroupModerator,
                    isPinned: isPinnedRow,
                    text: displayState.isDeleted ? displayState.text : (newRow.text !== undefined ? newRow.text : m.text)
                  };
                }
                if (isPinnedRow && m.isPinned) {
                  return { ...m, isPinned: false };
                }
                return m;
              });
              let nextPinnedId = c.pinnedMessageId;
              if (isPinnedRow) {
                nextPinnedId = String(newRow.id);
              } else if (String(c.pinnedMessageId || '') === String(newRow.id)) {
                const otherPinned = getPinnedMessageFromList(updatedMsgs);
                nextPinnedId = otherPinned ? String(otherPinned.id) : undefined;
              }
              return {
                ...c,
                pinnedMessageId: nextPinnedId,
                messages: updatedMsgs
              };
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeChatId]);

  // 5. Suscripción en tiempo real a chat_participants: actualiza estado local con payload sin recargas masivas
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`user_chats_changes_${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_participants',
          filter: `user_id=eq.${currentUserId}`
        },
        (payload: any) => {
          const newChatId = payload?.new?.chat_id ? String(payload.new.chat_id) : '';
          const activeUser = currentUserRef.current;
          if (!newChatId || !activeUser?.id) return;
          if (chatsRef.current.some((c) => String(c.id) === newChatId)) return;

          chatService.getSingleChatById(newChatId, activeUser).then((singleChat) => {
            if (!singleChat) return;
            setChats((prev) => {
              if (prev.some((c) => String(c.id) === String(singleChat.id))) return prev;
              return [singleChat, ...prev];
            });
          }).catch(() => {});
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_participants',
          filter: `user_id=eq.${currentUserId}`
        },
        (payload: any) => {
          const removedChatId = payload?.old?.chat_id ? String(payload.old.chat_id) : '';
          if (!removedChatId) return;
          const activeUser = currentUserRef.current;
          const userTokens = activeUser ? buildChatUserTokens(activeUser) : [];
          setChats((prev) =>
            prev.map((c) => {
              if (String(c.id) !== removedChatId) return c;
              if (c.type !== 'grupal') return c;
              const nowMs = Date.now();
              return {
                ...c,
                removedByUser: true,
                removedAtForUser: c.removedAtForUser || nowMs,
                removedParticipants: Array.from(new Set([...(c.removedParticipants || []), ...userTokens]))
              };
            })
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  // 6. Enviar mensaje
  const sendMessage = useCallback(
    async (text: string, replyTo?: { id: string; sender: string; text: string }) => {
      const activeUser = currentUserRef.current;
      if (!activeChatId || !activeUser || !text.trim()) return;

      const clientMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      recentlySentMsgIdsRef.current.add(clientMsgId);
      setTimeout(() => recentlySentMsgIdsRef.current.delete(clientMsgId), 30000);

      setIsSending(true);
      try {
        const liveChat = chatsRef.current.find((c) => String(c.id) === String(activeChatId));
        const savedMsg = await chatService.sendChatMessage({
          selectedChatId: activeChatId,
          text,
          currentUser: activeUser,
          replyTo,
          providedMsgId: clientMsgId,
          chatType: liveChat?.type
        });

        // Actualizar estado de mensajes
        setMessages((prev) => {
          if (prev.some((m) => String(m.id) === String(savedMsg.id))) return prev;
          return [...prev, savedMsg];
        });

        // Actualizar último mensaje en lista de chats
        setChats((prev) =>
          prev.map((c) =>
            String(c.id) === String(activeChatId)
              ? {
                  ...c,
                  lastMessage: savedMsg.text,
                  lastMessageTime: savedMsg.time,
                  updatedAt: savedMsg.createdAt
                }
              : c
          )
        );

        return savedMsg;
      } catch (err: any) {
        console.error('Error al enviar mensaje:', err);
        throw err;
      } finally {
        setIsSending(false);
      }
    },
    [activeChatId, currentUserId]
  );

  // 7. Crear grupo
  const createGroup = useCallback(
    async (nombre: string, fotoUrl?: string | null, memberUserIds: string[] = []) => {
      if (!currentUser) throw new Error('No hay usuario autenticado');
      const newChat = await chatService.createGroupChat({
        nombre,
        foto_grupo_url: fotoUrl,
        currentUser,
        memberUserIds
      });

      setChats((prev) => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      return newChat;
    },
    [currentUser]
  );

  // 8. Crear o abrir chat directo
  const createDirect = useCallback(
    async (otherUser: User | { id: string; apodo?: string; usuario?: string; nombre?: string; avatar?: string }) => {
      if (!currentUser) throw new Error('No hay usuario autenticado');
      const chat = await chatService.createDirectChat({
        currentUser,
        otherUser
      });

      setChats((prev) => {
        const exists = prev.some((c) => String(c.id) === String(chat.id));
        return exists ? prev : [chat, ...prev];
      });
      setActiveChatId(chat.id);
      return chat;
    },
    [currentUser]
  );

  // 9. Salir del chat activo (mantiene la conversación en chats recientes en modo solo lectura)
  const leaveCurrentChat = useCallback(async () => {
    if (!activeChatId || !currentUser?.id) return;
    const leavingId = activeChatId;
    const exitNowMs = Date.now();
    await chatService.leaveChat(leavingId, currentUser.id);

    const userTokens = buildChatUserTokens(currentUser);
    setChats((prev) =>
      prev.map((c) => {
        if (String(c.id) !== String(leavingId)) return c;
        const currentParts = Array.isArray(c.participants) ? c.participants : [];
        const snapshotMap: Record<string, string[]> = { ...(c.participantsSnapshotOnRemoval || {}) };
        if (currentParts.length > 0) {
          userTokens.forEach((tok) => {
            if (!snapshotMap[tok] || snapshotMap[tok].length === 0) {
              snapshotMap[tok] = [...currentParts];
            }
          });
        }
        return {
          ...c,
          leftVoluntarily: true,
          removedByUser: true,
          leftAtForUser: exitNowMs,
          removedAtForUser: exitNowMs,
          participantsSnapshotOnRemoval: snapshotMap,
          leftVoluntarilyParticipants: Array.from(new Set([...(c.leftVoluntarilyParticipants || []), ...userTokens])),
          removedParticipants: Array.from(new Set([...(c.removedParticipants || []), ...userTokens])),
          participants: currentParts.filter((p) => !userTokens.includes(String(p).trim().toLowerCase()))
        };
      })
    );
  }, [activeChatId, currentUser]);
  // 10. Crear o vincular chat de actividad
  const createActivityChat = useCallback(
    async (activity: Partial<Activity> & { id: string | number; title: string; image?: string | null }) => {
      if (!currentUser) throw new Error('No hay usuario autenticado');
      const actChat = await chatService.createActivityChat({
        activity,
        currentUser
      });
      setChats((prev) => {
        const exists = prev.some((c) => String(c.id) === String(actChat.id));
        return exists ? prev : [actChat, ...prev];
      });
      return actChat;
    },
    [currentUser]
  );

  return {
    chats,
    setChats,
    activeChatId,
    setActiveChatId,
    activeChat,
    messages,
    setMessages,
    loadingChats,
    loadingMessages,
    isSending,
    error,
    refreshChats,
    loadMessages,
    sendMessage,
    createGroup,
    createDirect,
    createActivityChat,
    leaveCurrentChat
  };
}
