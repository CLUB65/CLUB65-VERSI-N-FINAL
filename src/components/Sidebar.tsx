import React from 'react';
import { useUser } from '../context/UserContext.tsx';
import { Chat, CancelledGroupNotice } from '../types.ts';
import { Avatar } from './Avatar.tsx';
import { formatActivitySystemNotice, buildCancelledGroupNoticeMessage, isAdministratorUser } from '../utils/chatLogic.ts';

export interface SidebarProps {
  chats: Chat[];
  activeChatId: string | number | null;
  onSelectChat: (chat: Chat) => void;
  onOpenCrearGrupo: () => void;
  onOpenDirectorio: () => void;
  cancelledGroupNotices?: CancelledGroupNotice[];
  onDismissCancelledNotice?: (noticeId: string) => void;
  getChatDisplayTitle: (chat: Chat, current?: any) => string;
  getChatDisplayPhoto: (chat: Chat) => string | undefined;
  getChatUnreadCount: (chat: Chat, user: any, lastReads: Record<string, number>, isCurrentlyActiveChat?: boolean) => number;
  lastReads: Record<string, number>;
  className?: string;
}

export function Sidebar({
  chats,
  activeChatId,
  onSelectChat,
  onOpenCrearGrupo,
  onOpenDirectorio,
  cancelledGroupNotices = [],
  onDismissCancelledNotice,
  getChatDisplayTitle,
  getChatDisplayPhoto,
  getChatUnreadCount,
  lastReads,
  className = ''
}: SidebarProps) {
  const { currentUser } = useUser();

  return (
    <div className={`w-full md:w-80 border-r border-amber-200/80 bg-amber-50/40 flex flex-col ${className}`}>
      {/* Sidebar Header */}
      <div className="p-4 border-b border-amber-200/80 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-brand text-xl font-bold text-club-brown">Mi Chat</h3>
          {currentUser && (
            <div className="flex items-center gap-1.5 text-sm text-stone-600 min-w-0">
              <Avatar user={currentUser} size="xs" />
              <span className="font-semibold truncate max-w-[120px]">{currentUser.apodo}</span>
            </div>
          )}
        </div>

        <div className={`grid grid-cols-1 ${isAdministratorUser(currentUser) ? '' : 'sm:grid-cols-2'} gap-2 pt-1`}>
          {!isAdministratorUser(currentUser) && (
            <button
              onClick={onOpenCrearGrupo}
              className="p-2.5 bg-white hover:bg-amber-100 border border-amber-200 rounded-xl text-base font-bold text-club-brown flex items-center justify-center gap-1.5 shadow-xs cursor-pointer min-w-0 break-words leading-snug"
            >
              <i className="fa-solid fa-users text-club-orange flex-shrink-0" /> <span>Crear Grupo</span>
            </button>
          )}
          <button
            onClick={onOpenDirectorio}
            className="p-2.5 bg-white hover:bg-amber-100 border border-amber-200 rounded-xl text-base font-bold text-club-brown flex items-center justify-center gap-1.5 shadow-xs cursor-pointer min-w-0 break-words leading-snug"
          >
            <i className="fa-solid fa-address-book text-club-teal flex-shrink-0" /> <span>Mis Contactos</span>
          </button>
        </div>
      </div>

      {/* Notices & Chat List */}
      <div className="flex-1 overflow-y-auto divide-y divide-amber-100/80">
        {cancelledGroupNotices.map((notice) => (
          <div
            key={notice.id}
            data-testid={`cancelled-group-notice-${notice.activityId}`}
            className="p-3.5 bg-amber-50/95 border-b border-amber-200/90 flex items-start justify-between gap-2 text-base"
          >
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <i className="fa-solid fa-circle-exclamation text-club-orange mt-1 text-base flex-shrink-0" />
              <span className="italic text-stone-700 leading-relaxed break-words">
                {buildCancelledGroupNoticeMessage(notice.activityTitle)}
              </span>
            </div>
            {onDismissCancelledNotice && (
              <button
                type="button"
                onClick={() => onDismissCancelledNotice(notice.id)}
                className="text-stone-400 hover:text-stone-600 p-1 cursor-pointer flex-shrink-0"
                title="Cerrar notificación"
                aria-label={`Cerrar notificación de ${notice.activityTitle}`}
              >
                <i className="fa-solid fa-xmark text-base" />
              </button>
            )}
          </div>
        ))}

        {chats.length === 0 && cancelledGroupNotices.length === 0 ? (
          <div className="p-6 text-center text-base text-stone-500 leading-relaxed">
            <i className="fa-solid fa-comments text-2xl text-amber-300 mb-2 block" />
            No tenés conversaciones activas aún.
          </div>
        ) : (
          chats.map((c) => {
            const isAct = String(c.id) === String(activeChatId);
            const title = getChatDisplayTitle(c, currentUser);
            const photo = getChatDisplayPhoto(c);
            const unread = currentUser ? getChatUnreadCount(c, currentUser, lastReads, isAct) : 0;
            const lastMsg = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;

            return (
              <button
                key={c.id}
                onClick={() => onSelectChat(c)}
                className={`w-full text-left p-3.5 transition flex items-center gap-3 cursor-pointer ${
                  isAct ? 'bg-amber-100/80 border-l-4 border-l-club-orange font-bold' : 'hover:bg-amber-50/80'
                }`}
              >
                <div className="relative flex-shrink-0">
                  <Avatar avatarUrl={photo} name={title} size="md" />
                  {unread > 0 && (
                    <span
                      className="absolute -top-1 -right-1 bg-rose-600 text-white text-sm font-black min-w-[20px] h-[20px] px-1 rounded-full flex items-center justify-center border-2 border-white shadow-xs animate-pulse"
                      title={`${unread} novedad(es) sin leer`}
                    >
                      {unread}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className={`text-base truncate text-club-brown ${isAct ? 'font-black' : 'font-bold'}`}>
                      {title}
                    </p>
                    {lastMsg?.time && (
                      <span className={`text-sm flex-shrink-0 ${unread > 0 ? 'font-bold text-rose-600' : 'text-stone-400'}`}>{lastMsg.time}</span>
                    )}
                  </div>
                  {lastMsg?.text && (() => {
                    const isSys = lastMsg.sender === 'Sistema CLUB65' || lastMsg.senderId === 'system' || lastMsg.senderId === 'sistema' || (lastMsg as any).role === 'sistema';
                    const formatted = isSys ? formatActivitySystemNotice(lastMsg.text, c, null, lastMsg.replyTo || (lastMsg as any).reply_to) : lastMsg.text;
                    return (
                      <p className="text-sm text-stone-500 truncate mt-0.5 leading-relaxed">
                        {isSys ? formatted : (lastMsg.sender ? `${lastMsg.sender}: ` : '') + lastMsg.text}
                      </p>
                    );
                  })()}
                </div>
                {unread > 0 && (
                  <span className="bg-rose-600 text-white text-sm font-black min-w-[20px] h-[20px] px-1 rounded-full flex items-center justify-center shadow-xs flex-shrink-0">
                    {unread}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default Sidebar;
