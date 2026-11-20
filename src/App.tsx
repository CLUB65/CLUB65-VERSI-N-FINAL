/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User, Activity, ActivityVersion, Chat, Review, Contact, ChatMessage, SecurityReport, SanctionRecord, BajaRecord, CancelledGroupNotice, FileUploadInfo, TipoEntidadInstitucional } from './types.ts';
import { api, setStoredUserId, clearBrowserSessionKeys, uploadInstitutionalDocToStorage, invalidateApiCaches, resolveUserRole } from './api.ts';
import { normalizeAdminPromotionIdentifier } from './utils/adminPromotion.ts';
import { uploadToStorage, uploadDataUrlToStorage } from './storageService.ts';
import * as chatService from './services/chatService.ts';
import {
  launchCelebrationConfetti,
  shouldTriggerActivityPublishedConfetti,
  shouldTriggerReviewPublishedConfetti,
  shouldTriggerEnrollmentConfetti
} from './utils/confetti.ts';
import {
  SOPORTE_ASUNTOS,
  MOTIVOS_RECHAZO_INSTITUCION,
  sendSupportEmail,
  sendInstitutionalApprovalEmail,
  sendInstitutionalRejectionEmail
} from './services/emailService.ts';
import {
  canRemoveParticipantFromGroup,
  getBlockedMessageForActivity,
  getBlockedMessageForReviews,
  cleanCommentOrDash,
  formatResolutionMeasure,
  getParticipantRoleLabel,
  getProposalSortingTime,
  hasFirstEncounterStarted,
  hasFirstEncounterEnded,
  getMyActivitiesSortingTime,
  isUserLeftVoluntarilyFromChat,
  isUserRemovedFromChat,
  getUserChatDepartureTimestamp,
  buildChatUserTokens,
  getVisibleParticipantsForUser,
  isChatDeletedForUser,
  filterChatMessagesForUser,
  getUserChatClearedTimestamp,
  isUserVetoedFromChat,
  isUserVettedFromActivity,
  canUserEnrollActivity,
  isActivityPast,
  getAgendaCalendarDays,
  isDummyOrSystemParticipant,
  filterRealParticipants,
  getPrivateChatResolvedTitle,
  isTechnicalIdentifier,
  isHardcodedOrMockProfile,
  filterAndSortRecentChats,
  getChatLastActivityTime,
  chatIdentifierToBigInt,
  cleanSystemCreationMessage,
  formatActivitySystemNotice,
  deduplicateMessages,
  deduplicateChats,
  cleanGroupTitle,
  resolveActivityById,
  resolveActivityForChat,
  buildAttendanceNomina,
  isDuplicateMessage,
  isAdministratorUser,
  isUserAdminByReference,
  resolveSenderDisplayName,
  isUserGroupModerator,
  isSelfUserOrContact,
  filterContactsForUser,
  validateGroupCreation,
  getResolvedChatParticipants,
  isUserEnrolledInActivity,
  checkActivitiesCollision,
  canUserCreateActivity,
  checkActivityNameCollision,
  getActivitySessions,
  isActivityEligibleForReview,
  getActivityRealizadaStatusLabel,
  isActivityApproved,
  isUserReview,
  calculateReviewsAverage,
  filterReviewsForActivity,
  getReviewsOfUserActivities,
  sanitizeProfileAvatar,
  sanitizeProfileBio,
  isMessageFromOtherUser,
  getChatUnreadCount,
  filterCarteleraActivities,
  extractDynamicLocations,
  isActivityOwnedByUser,
  isActivitySuspendedByAdmin,
  isActivityCancelledByOrganizer,
  getSuspensionReasonText,
  hasMisActividadesSuspensionAlert,
  hasAgendaCancellationAlert,
  filterAgendaActivities,
  isActCancelled as isActCancelledLogic,
  buildCancelledGroupNoticeMessage,
  extractCancelledGroupNoticesFromNotifications,
  filterChatsAfterActivityCancellation,
  doesChatMatchActivity,
  formatIncomingMessageToast,
  shouldOpenMessageMenuUpwards,
  getPinnedMessageFromList,
  filterActivitiesForBajaSection,
  isProposalRejected,
  getRejectedProposalReason,
  hasMisActividadesRejectedAlert,
  filterPersonalMisActividades,
  resolveBajaAdminDisplay
} from './utils/chatLogic.ts';
import {
  ADMIN_REMOVED_MESSAGE_TEXT,
  ADMIN_REMOVED_REVIEW_TEXT,
  ADMIN_REMOVED_REVIEW_MEDIA_TEXT,
  RETIRED_REVIEW_MEDIA_MARKER,
  findActiveSanctionForUser,
  formatSuspendedLoginError,
  isReportPending,
  isReportResolved,
  isReviewRetired,
  isRetiredReviewMediaItem,
  replaceMediaUrlWithRetiredMarker,
  resolveRemovedMessageDisplay,
  safeParseJson
} from './utils/reportsAndSanctions.ts';
import {
  resolveRealOrganizerDisplay,
  partitionPendingNeighborhoodProposals,
  MAX_ACTIVITY_VIDEO_DURATION_SECONDS,
  validateActivityVideoDuration,
  resolveActivityVideoUrl
} from './utils/proposalLogic.ts';
import { canViewerBlockOrPrivateChat, isOfficialAdminRow } from './utils/adminPromotion.ts';
import { collectNeededAvatarUserIds, mergeAvatarsIntoUsersMap } from './utils/avatarHydration.ts';
import { LeafletMap } from './components/LeafletMap.tsx';
import { useUser } from './context/UserContext.tsx';
import { Header } from './components/Header.tsx';
import { Footer } from './components/Footer.tsx';
import { HomeVisitante } from './components/HomeVisitante.tsx';
import { SobreNosotros } from './components/SobreNosotros.tsx';
import { Cartelera } from './components/Cartelera.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { Avatar } from './components/Avatar.tsx';
import { RetroAppBackground } from './components/RetroAppBackground.tsx';
import { ScallopedHeaderEdge, ChatWatermark } from './components/ChatDecorations.tsx';
import { supabase, SUPABASE_PROJECT_ID, SUPABASE_URL, checkSupabaseStatus } from './supabaseClient.ts';
import {
  formatArgentinaDateTime,
  formatArgentinaDateOnly,
  formatArgentinaTimeOnly,
  formatToArgentinaDate,
  getMessageArgentinaDate,
  formatArgentinaDateHeader,
  getArgentinaTodayYMD,
  getArgentinaCurrentMinutes,
  addDaysYMD
} from './utils/argentinaTime.ts';

function formatFechaVisual(fechaStr?: string): string {
  if (!fechaStr) return '';
  return formatToArgentinaDate(fechaStr);
}

function addMinutesToHHMM(hhmm: string, minsToAdd: number): { time: string; nextDay: boolean } {
  const parts = String(hhmm || '').split(':').map(Number);
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) {
    return { time: hhmm, nextDay: false };
  }
  const total = parts[0] * 60 + parts[1] + minsToAdd;
  const nextDay = total >= 1440;
  const wrapped = ((total % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return {
    time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    nextDay
  };
}

function getTimeSlots(options?: { minMinutes?: number; maxMinutes?: number; isToday?: boolean; currentMinutes?: number }): string[] {
  const slots: string[] = [];
  const minMin = options?.minMinutes ?? -1;
  const maxMin = options?.maxMinutes ?? Infinity;
  const isToday = Boolean(options?.isToday);
  const curMin = options?.currentMinutes ?? -1;

  for (let h = 0; h <= 23; h++) {
    for (let m = 0; m < 60; m += 30) {
      const slotMin = h * 60 + m;
      if (slotMin <= minMin) continue;
      if (slotMin >= maxMin) continue;
      if (isToday && slotMin <= curMin) continue;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}


declare global {
  interface Window {
    jspdf?: {
      jsPDF: new () => {
        setFont: (font: string, style?: string) => void;
        setFontSize: (size: number) => void;
        text: (text: string, x: number, y: number) => void;
        setLineWidth: (width: number) => void;
        line: (x1: number, y1: number, x2: number, y2: number) => void;
        save: (filename: string) => void;
      };
    };
  }
}

interface GalleryItem {
  reviewId?: number | string;
  mediaUrl: string;
  autor: string;
  estrellas: number;
  fecha: string;
  texto: string;
  actividad: string;
}

function isVideoMedia(url?: string | null): boolean {
  if (!url || isRetiredReviewMediaItem(url)) return false;
  return url.startsWith('data:video') || /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url);
}

const NOMBRES_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export interface LocationItem {
  nombre: string;
  detalle: string;
  lat?: number;
  lng?: number;
}

const BUSQUEDA_UBICACIONES_EXTENDIDAS: LocationItem[] = [];

export const MOTIVOS_REPORTE = [
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

const UBICACIONES_SUGERIDAS = BUSQUEDA_UBICACIONES_EXTENDIDAS.slice(0, 8);

// Componente para Ajuste y Recorte de Foto (Circular para perfiles/grupos, Rectangular 16:10 para cartelera)
function ImageCropperModal({
  imageSrc,
  title = 'Ajustar imagen',
  shape = 'circle',
  applyLabel = 'Ajustar imagen',
  onCancel,
  onApply
}: {
  imageSrc: string;
  title?: string;
  shape?: 'circle' | 'rectangle';
  applyLabel?: string;
  onCancel: () => void;
  onApply: (croppedDataUrl: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [posX, setPosX] = useState(0);
  const [posY, setPosY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const isRect = shape === 'rectangle';

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - posX, y: e.clientY - posY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosX(e.clientX - dragStart.x);
    setPosY(e.clientY - dragStart.y);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - posX, y: e.touches[0].clientY - posY });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setPosX(e.touches[0].clientX - dragStart.x);
    setPosY(e.touches[0].clientY - dragStart.y);
  };

  const handleApply = () => {
    const canvas = document.createElement('canvas');
    const canvasW = isRect ? 800 : 400;
    const canvasH = isRect ? 480 : 400;
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    if (!ctx || !imgRef.current) {
      onCancel();
      return;
    }

    const img = imgRef.current;
    ctx.save();
    // Exportar el recorte cuadrado completo sin máscara circular en JPEG para evitar esquinas negras;
    // la vista ya muestra fotos de perfil y grupo con recorte circular (rounded-full).

    const viewW = isRect ? 320 : 260;
    const viewH = isRect ? 192 : 260;
    const scale = canvasW / viewW;

    const imgRatio = img.naturalWidth / img.naturalHeight;
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
    const drawWidth = baseW * zoom * scale;
    const drawHeight = baseH * zoom * scale;

    ctx.drawImage(
      img,
      centerX - drawWidth / 2,
      centerY - drawHeight / 2,
      drawWidth,
      drawHeight
    );
    ctx.restore();

    const croppedBase64 = canvas.toDataURL('image/jpeg', 0.92);
    onApply(croppedBase64);
  };

  return (
    <div className="fixed inset-0 bg-black/85 z-[100] flex items-center justify-center p-4">
      <div className={`bg-stone-900 border-2 border-amber-400 text-amber-50 w-full ${isRect ? 'max-w-md' : 'max-w-sm'} rounded-3xl p-5 shadow-2xl flex flex-col items-center space-y-4 animate-in fade-in zoom-in-95`}>
        <div className="w-full flex items-center justify-between border-b border-stone-800 pb-3">
          <h3 className="font-brand text-lg font-bold text-amber-300 flex items-center gap-2">
            <i className="fa-solid fa-crop-simple text-club-orange" /> {title}
          </h3>
          <button onClick={onCancel} className="text-xl text-stone-400 hover:text-white cursor-pointer font-bold">
            &times;
          </button>
        </div>

        <div
          className={`relative ${isRect ? 'w-[320px] h-[192px] rounded-2xl' : 'w-[260px] h-[260px] rounded-full'} overflow-hidden border-4 border-amber-400 bg-stone-950 flex items-center justify-center cursor-move select-none shadow-inner`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleMouseUp}
        >
          <img
            ref={imgRef}
            src={imageSrc}
            alt="Ajuste"
            draggable={false}
            style={{
              transform: `translate(${posX}px, ${posY}px) scale(${zoom})`,
              transformOrigin: 'center center',
              maxWidth: 'none',
              maxHeight: 'none',
              width: '100%',
              height: '100%',
              objectFit: 'contain'
            }}
            className="pointer-events-none transition-transform duration-75"
          />
          <div className={`absolute inset-0 ${isRect ? 'rounded-2xl' : 'rounded-full'} border border-white/40 pointer-events-none`} />
        </div>

        <p className="text-sm text-stone-400 text-center leading-relaxed">
          <i className="fa-solid fa-arrows-up-down-left-right mr-1 text-club-orange" /> Arrastrá para posicionar y usá el deslizador para hacer zoom
        </p>

        <div className="w-full flex items-center gap-3 px-2">
          <button
            type="button"
            onClick={() => setZoom(prev => Math.max(1, prev - 0.2))}
            className="w-9 h-9 rounded-full bg-stone-800 hover:bg-stone-700 text-amber-300 flex items-center justify-center font-bold cursor-pointer flex-shrink-0"
          >
            <i className="fa-solid fa-minus text-sm" />
          </button>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="flex-1 accent-amber-400 cursor-pointer min-w-0"
          />
          <button
            type="button"
            onClick={() => setZoom(prev => Math.min(3, prev + 0.2))}
            className="w-9 h-9 rounded-full bg-stone-800 hover:bg-stone-700 text-amber-300 flex items-center justify-center font-bold cursor-pointer flex-shrink-0"
          >
            <i className="fa-solid fa-plus text-sm" />
          </button>
          <button
            type="button"
            onClick={() => { setZoom(1); setPosX(0); setPosY(0); }}
            className="px-2.5 py-1.5 bg-stone-800 hover:bg-stone-700 text-sm rounded-lg text-stone-300 font-bold cursor-pointer flex-shrink-0"
            title="Restablecer posición"
          >
            Centrar
          </button>
        </div>

        <div className="w-full flex flex-wrap justify-between gap-3 pt-2 border-t border-stone-800">
          <button
            type="button"
            onClick={onCancel}
            className="pill-btn flex-1 min-w-[120px] py-2.5 px-3 bg-stone-800 hover:bg-stone-700 text-stone-300 text-base font-bold cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="pill-btn flex-1 min-w-[120px] py-2.5 px-3 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow cursor-pointer flex items-center justify-center gap-1.5"
          >
            <i className="fa-solid fa-check" /> {applyLabel || 'Ajustar imagen'}
          </button>
        </div>
      </div>
    </div>
  );
}
function getCleanEnrolledList(rawList: any[]): string[] {
  if (!Array.isArray(rawList)) return [];

  const cleaned: string[] = [];

  for (const item of rawList) {
    const rawVal = String(typeof item === 'string' ? item : item?.nombre || item?.usuario || item?.id || '').trim();
    if (!rawVal) continue;
    const low = rawVal.toLowerCase();

    // Buscar si ya existe este participante o una variante (apodo/nombre/id)
    const existingIndex = cleaned.findIndex(existing => {
      const exLow = existing.toLowerCase();
      if (exLow === low) return true;

      // Si uno es ID técnico usr_... y el otro no
      if ((low.startsWith('usr_') && !exLow.startsWith('usr_')) || (exLow.startsWith('usr_') && !low.startsWith('usr_'))) {
        return true;
      }

      // Si uno contiene al otro o comparten la raíz principal (ej: "nerinitaa" y "nerina")
      const root1 = low.slice(0, 4);
      const root2 = exLow.slice(0, 4);
      if (root1 === root2 && root1.length >= 4) return true;
      if (exLow.includes(low) || low.includes(exLow)) return true;

      return false;
    });

    if (existingIndex === -1) {
      cleaned.push(rawVal);
    } else {
      // Priorizar el nombre o apodo más representativo frente a un ID técnico
      if (cleaned[existingIndex].startsWith('usr_') && !rawVal.startsWith('usr_')) {
        cleaned[existingIndex] = rawVal;
      }
    }
  }

  return cleaned;
}

function formatCuitMask(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

interface InstitutionalDocUploadFieldProps {
  title: string;
  subtitle: string;
  file: FileUploadInfo | null;
  onFileChange: (file: FileUploadInfo | null) => void;
  required?: boolean;
}

function InstitutionalDocUploadField({
  title,
  subtitle,
  file,
  onFileChange,
  required = false
}: InstitutionalDocUploadFieldProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = (selectedFile: File) => {
    if (selectedFile.size > 5 * 1024 * 1024) {
      alert('El archivo seleccionado supera el límite de 5MB. Por favor seleccioná un archivo más liviano.');
      return;
    }
    const previewUrl = URL.createObjectURL(selectedFile);
    onFileChange({
      name: selectedFile.name,
      size: selectedFile.size,
      type: selectedFile.type,
      dataUrl: previewUrl,
      file: selectedFile
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="bg-white/95 p-3.5 rounded-xl border border-blue-200 space-y-2 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="font-bold text-base text-blue-950 block leading-snug">
          {title} {required && <span className="text-rose-600">*</span>}
        </label>
        <span className="text-sm text-stone-600 font-semibold bg-stone-100 px-2.5 py-0.5 rounded-md flex-shrink-0">
          Máx. 5MB
        </span>
      </div>
      <p className="text-sm text-stone-600 leading-relaxed">{subtitle}</p>

      {file ? (
        <div className="flex flex-wrap items-center justify-between p-3 bg-blue-50/90 rounded-xl border border-blue-300 gap-2">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <i
              className={
                file.type.includes('pdf') || file.name.endsWith('.pdf')
                  ? 'fa-solid fa-file-pdf text-rose-600 text-lg flex-shrink-0'
                  : 'fa-solid fa-file-image text-blue-600 text-lg flex-shrink-0'
              }
            />
            <div className="min-w-0">
              <p className="font-bold text-base text-blue-950 truncate">{file.name}</p>
              <p className="text-sm text-stone-600">
                {(file.size / (1024 * 1024)).toFixed(2)} MB •{' '}
                {file.type.includes('pdf') || file.name.endsWith('.pdf') ? 'Documento PDF' : 'Imagen'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onFileChange(null);
              if (inputRef.current) inputRef.current.value = '';
            }}
            className="pill-btn px-3 py-1.5 bg-white hover:bg-rose-50 text-rose-700 border border-rose-200 text-sm font-bold cursor-pointer flex-shrink-0"
            title="Quitar archivo"
          >
            <i className="fa-solid fa-trash-can mr-1" /> Quitar
          </button>
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-3.5 text-center cursor-pointer transition ${
            isDragging
              ? 'border-blue-600 bg-blue-100/90'
              : 'border-blue-300 hover:border-blue-500 bg-blue-50/40 hover:bg-blue-50/80'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                processFile(e.target.files[0]);
              }
            }}
          />
          <div className="flex flex-wrap items-center justify-center gap-2 text-blue-900">
            <i className="fa-solid fa-cloud-arrow-up text-lg text-blue-700" />
            <span className="font-bold text-base">Arrastrá tu archivo aquí o hacé clic para explorar</span>
          </div>
          <span className="text-sm text-stone-600 block mt-1">Formatos admitidos: PDF o imagen (PNG, JPG)</span>
        </div>
      )}
    </div>
  );
}

export default function App() {
  // Current authenticated user session from centralized UserContext / AuthContext
  const { currentUser, setCurrentUser, logout: contextLogout } = useUser();
  const currentUserRef = useRef<User | null>(currentUser);
  currentUserRef.current = currentUser;
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUploadingActivityImage, setIsUploadingActivityImage] = useState(false);
  const [isUploadingActivityVideo, setIsUploadingActivityVideo] = useState(false);
  const [loading, setLoading] = useState(true);

  // In-app Toast notification state (avoiding window.alert in iframe)
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastChatTargetId, setToastChatTargetId] = useState<string | number | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  function playNotificationSound() {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.1); // A5
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } catch (_) {}
  }

  function showToast(msg: string, targetChatId?: string | number | null) {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    setToastChatTargetId(targetChatId || null);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
      setToastChatTargetId(null);
    }, 5000);
  }

  // Active view state
  const [currentView, setCurrentView] = useState<string>('home-visitante');
  const prevViewRef = useRef(currentView);
  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;
  const [showCookiesBanner, setShowCookiesBanner] = useState(true);
  const [guestTextSize, setGuestTextSize] = useState<'normal' | 'grande' | 'gigante'>(() => {
    try {
      const saved = localStorage.getItem('club65_guest_text_size');
      if (saved === 'grande' || saved === 'gigante' || saved === 'normal') return saved;
    } catch {}
    return 'normal';
  });
  const [guestContrast, setGuestContrast] = useState<boolean>(() => {
    try {
      return localStorage.getItem('club65_guest_contrast') === 'true';
    } catch {}
    return false;
  });
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const dropdownTimeoutRef = useRef<any>(null);
  const locationDebounceTimerRef = useRef<any>(null);
  const tabsScrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollTabsLeft, setCanScrollTabsLeft] = useState(false);
  const [canScrollTabsRight, setCanScrollTabsRight] = useState(false);

  const updateNavTabsScrollState = () => {
    const el = tabsScrollRef.current;
    if (!el) {
      setCanScrollTabsLeft(false);
      setCanScrollTabsRight(false);
      return;
    }
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollTabsLeft(el.scrollLeft > 4);
    setCanScrollTabsRight(maxScroll > 4 && el.scrollLeft < maxScroll - 4);
  };

  const scrollNavTabs = (direction: 'left' | 'right') => {
    const el = tabsScrollRef.current;
    if (!el) return;
    const step = Math.max(180, Math.round(el.clientWidth * 0.55));
    el.scrollBy({ left: direction === 'left' ? -step : step, behavior: 'smooth' });
  };

  useEffect(() => {
    const raf = requestAnimationFrame(updateNavTabsScrollState);
    const el = tabsScrollRef.current;
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateNavTabsScrollState) : null;
    if (el && ro) ro.observe(el);
    window.addEventListener('resize', updateNavTabsScrollState);
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', updateNavTabsScrollState);
    };
  }, [currentUser, currentView, guestTextSize]);

  // Main data states
  const [activities, setActivities] = useState<Activity[]>([]);
  const activitiesRef = useRef<Activity[]>([]);
  activitiesRef.current = activities;
  const [chats, setChats] = useState<Chat[]>([]);
  const chatsRef = useRef<Chat[]>([]);
  chatsRef.current = chats;
  const recentlySentMsgIdsRef = useRef<Set<string>>(new Set());
  const lastMarkReadSyncRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [reports, setReports] = useState<SecurityReport[]>([]);
  const [pendingInstitutions, setPendingInstitutions] = useState<User[]>([]);
  const [approvedInstitutions, setApprovedInstitutions] = useState<User[]>([]);
  const [bannedUsersList, setBannedUsersList] = useState<string[]>([]);
  const [sanctionsList, setSanctionsList] = useState<SanctionRecord[]>([]);
  const [bajasList, setBajasList] = useState<BajaRecord[]>([]);
  const [cancelledGroupNotices, setCancelledGroupNotices] = useState<CancelledGroupNotice[]>([]);
  const [seenSuspendedActIds, setSeenSuspendedActIds] = useState<number[]>([]);
  const [seenCancelledAgendaActIds, setSeenCancelledAgendaActIds] = useState<number[]>([]);
  const [seenRejectedProposalIds, setSeenRejectedProposalIds] = useState<number[]>([]);
  const [dismissedRejectedProposalIds, setDismissedRejectedProposalIds] = useState<number[]>([]);
  const [modalBajaActividad, setModalBajaActividad] = useState<{ id: number; title: string } | null>(null);
  const [motivoBajaInput, setMotivoBajaInput] = useState('');
  const [modalRechazoInstitucion, setModalRechazoInstitucion] = useState<User | null>(null);
  const [motivoRechazoInstitucion, setMotivoRechazoInstitucion] = useState('');
  const [detalleRechazoInstitucion, setDetalleRechazoInstitucion] = useState('');
  const [rechazoInstitucionError, setRechazoInstitucionError] = useState('');
  const [rechazoInstitucionLoading, setRechazoInstitucionLoading] = useState(false);
  const [sancionMotivoInput, setSancionMotivoInput] = useState(MOTIVOS_REPORTE[0]);
  const [sancionTipoInput, setSancionTipoInput] = useState<'temporal_7' | 'temporal_30' | 'permanente'>('temporal_7');
  const [sancionComentarioInput, setSancionComentarioInput] = useState('');
// Verificación dinámica de sanción para cualquier usuario
  const checkUserSanction = (user: any) => {
    if (!user) return null;
    return findActiveSanctionForUser(sanctionsList || [], user, bannedUsersList || []);
  };

  // Expulsar inmediatamente al usuario si se le aplica una sanción activa
  useEffect(() => {
    const activeUser = currentUserRef.current;
    if (!activeUser) return;

    const activeSanction: any = checkUserSanction(activeUser);
    if (activeSanction) {
      // Cerrar sesión en Supabase y redireccionar
      api.logout().catch(() => {});
      setCurrentUser(null);
      setStoredUserId(null);
      localStorage.removeItem('club65_user_id');
      setCurrentView('home-visitante');

      showToast(formatSuspendedLoginError(activeSanction));
    }
  }, [currentUser?.id, sanctionsList, bannedUsersList]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [currentCategory, setCurrentCategory] = useState<string>('todas');

  // Filtros avanzados de Cartelera
  const [filterFrequency, setFilterFrequency] = useState<string>('todas');
  const [filterInitiative, setFilterInitiative] = useState<string>('todas');
  const [filterTiming, setFilterTiming] = useState<string>('cualquiera');
  const [filterCapacity, setFilterCapacity] = useState<string>('cualquiera');
  const [filterLocation, setFilterLocation] = useState<string>('todas');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState<boolean>(false);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const handleResetFilters = () => {
    setFilterFrequency('todas');
    setFilterInitiative('todas');
    setFilterTiming('cualquiera');
    setFilterCapacity('cualquiera');
    setFilterLocation('todas');
  };

  // Restablecer automáticamente si el usuario sale de la Cartelera y vuelve a entrar
  useEffect(() => {
    if (currentView !== 'explorar') {
      handleResetFilters();
      setIsFilterMenuOpen(false);
    }
    if (currentView !== 'soporte') {
      setSoporteEnviadoMsg('');
      setSoporteError('');
      setSoporteAsunto(SOPORTE_ASUNTOS[0]);
      setSoporteEmailInvitado('');
      setSoporteMensaje('');
    }
  }, [currentView]);

  // Limpiar mensajes de confirmación de Soporte al cambiar o cerrar la sesión
  useEffect(() => {
    setSoporteEnviadoMsg('');
    setSoporteError('');
  }, [currentUser?.id]);

  // Listener para cerrar el menú flotante al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setIsFilterMenuOpen(false);
      }
    };
    if (isFilterMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isFilterMenuOpen]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (filterFrequency !== 'todas') count++;
    if (filterInitiative !== 'todas') count++;
    if (filterTiming !== 'cualquiera') count++;
    if (filterCapacity !== 'cualquiera') count++;
    if (filterLocation !== 'todas') count++;
    return count;
  }, [filterFrequency, filterInitiative, filterTiming, filterCapacity, filterLocation]);

  // Active chat state
  const [activeChatId, setActiveChatId] = useState<number | string | null>(null);
  const activeChatIdRef = useRef(activeChatId);
  activeChatIdRef.current = activeChatId;
  const [chatLastReads, setChatLastReads] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem('club65_chat_last_reads');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [chatInputText, setChatInputText] = useState('');
  const [isSendingChatMessage, setIsSendingChatMessage] = useState(false);
  const [replyingToMessage, setReplyingToMessage] = useState<{ id: string; sender: string; text: string } | null>(null);
  const [openChatMenuId, setOpenChatMenuId] = useState<number | string | null>(null);
  const chatMenuTimeoutRef = useRef<any>(null);
  const [chatToDeleteForMe, setChatToDeleteForMe] = useState<Chat | null>(null);
  const [dismissedCancelledAgendaActIds, setDismissedCancelledAgendaActIds] = useState<number[]>([]);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatMessagesContainerRef = useRef<HTMLDivElement>(null);
  const prevActiveChatIdRef = useRef<any>(null);
  const prevChatMsgCountRef = useRef<number>(0);
  const isUserScrolledUpChatRef = useRef<boolean>(false);
  // Limpiar el chat abierto al cambiar de cuenta o de usuario
  useEffect(() => {
    setActiveChatId(null);
  }, [currentUser?.id, currentUser?.usuario]);

  // Load Supabase chat read markers when currentUser changes
  useEffect(() => {
    if (!currentUser) {
      setChatLastReads({});
      return;
    }
    const uid = currentUser.id || currentUser.usuario || (currentUser as any).supabaseId;
    api.getChatReadStatus(uid).then((reads) => {
      if (reads && Object.keys(reads).length > 0) {
        setChatLastReads(reads);
      }
    }).catch(() => {});
  }, [currentUser?.id, currentUser?.usuario]);

  // Mark chat as read locally and in Supabase (unified single call per action)
  function markChatAsRead(chatId: string | number, minTimestamp?: number) {
    if (!chatId) return;
    const cid = String(chatId);
    const now = Date.now();
    const targetChat = chatsRef.current.find(c => String(c.id) === cid || (c.activityId && String(c.activityId) === cid));

    let maxMsgTime = minTimestamp || 0;
    if (targetChat?.messages) {
      for (const m of targetChat.messages) {
        let t = m.timestamp;
        if (!t && m.createdAt) t = new Date(m.createdAt).getTime();
        if (!t && (m as any).created_at) t = new Date((m as any).created_at).getTime();
        if (t && t > maxMsgTime) maxMsgTime = t;
      }
    }
    const readTimestamp = Math.max(now, maxMsgTime);

    const targetActId = targetChat?.activityId ? String(targetChat.activityId) : '';
    const targetOfficialId = targetChat?.id ? String(targetChat.id) : '';
    const sCidBig = String(chatIdentifierToBigInt(cid));
    const sActBig = targetActId ? String(chatIdentifierToBigInt(targetActId)) : '';
    const sOfficialBig = targetOfficialId ? String(chatIdentifierToBigInt(targetOfficialId)) : '';

    setChatLastReads(prev => {
      const next = {
        ...prev,
        [cid]: readTimestamp,
        [sCidBig]: readTimestamp,
        ...(targetActId ? { [targetActId]: readTimestamp, [sActBig]: readTimestamp } : {}),
        ...(targetOfficialId ? { [targetOfficialId]: readTimestamp, [sOfficialBig]: readTimestamp } : {})
      };
      try {
        localStorage.setItem('club65_chat_last_reads', JSON.stringify(next));
        if (currentUser) {
          const uid = currentUser.id || currentUser.usuario || (currentUser as any).supabaseId;
          localStorage.setItem(`club65_chat_reads_${uid}`, JSON.stringify(next));
        }
      } catch {}
      return next;
    });

    if (currentUser) {
      const uid = currentUser.id || currentUser.usuario || (currentUser as any).supabaseId;
      const idsToSync = Array.from(new Set([cid, targetOfficialId, targetActId].filter(Boolean)));
      const syncKey = `${uid}:${idsToSync.join(',')}`;
      const nowSync = Date.now();
      if (
        lastMarkReadSyncRef.current.key === syncKey &&
        nowSync - lastMarkReadSyncRef.current.at < 1000 &&
        !minTimestamp
      ) {
        return;
      }
      lastMarkReadSyncRef.current = { key: syncKey, at: nowSync };
      api.markChatAsReadInSupabase(idsToSync, uid, currentUser.notifications).catch(() => {});
    }
  }

  // Marcar automáticamente como leído el chat abierto solo al entrar a la vista o cambiar de conversación
  useEffect(() => {
    if (currentView === 'chat' && activeChatId) {
      markChatAsRead(activeChatId);
    }
  }, [currentView, activeChatId]);

  // Photo Cropper / Adjuster State (Circular para perfiles/grupos, Rectangular para cartelera)
  const [imageCropperState, setImageCropperState] = useState<{
    isOpen: boolean;
    rawSrc: string;
    target: 'group' | 'profile' | 'activity' | 'newGroup';
    shape?: 'circle' | 'rectangle';
    title: string;
  } | null>(null);

  // Report resolution decision & context states
  const [modalDecisionReporte, setModalDecisionReporte] = useState<{
    report: SecurityReport;
    actionType: 'sancionar' | 'eliminar' | 'desestimar';
    motive: string;
    comment: string;
    sanctionType: 'temporal_7' | 'temporal_30' | 'permanente';
    alsoDelete: boolean;
  } | null>(null);
  const [isResolvingReport, setIsResolvingReport] = useState(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [verContextoReporteId, setVerContextoReporteId] = useState<string | null>(null);
  const [reportContextThreads, setReportContextThreads] = useState<Record<string, ChatMessage[]>>({});
  const [inputPromoverAdmin, setInputPromoverAdmin] = useState('');
  const [isPromotingAdmin, setIsPromotingAdmin] = useState(false);
  const [promoteAdminError, setPromoteAdminError] = useState('');
  const [editingProposalActivityId, setEditingProposalActivityId] = useState<string | number | null>(null);
  const [userFeedbackInput, setUserFeedbackInput] = useState<string>('');
  const [modalInstPendingNotice, setModalInstPendingNotice] = useState<{ email: string; apodo: string } | null>(null);
  const [filtroReportes, setFiltroReportes] = useState<'pendientes' | 'historial'>('pendientes');
  const [allUsersMap, setAllUsersMap] = useState<Record<string, User>>({});
  const allUsersMapRef = useRef<Record<string, User>>({});
  allUsersMapRef.current = allUsersMap;
  const hydratedAvatarIdsRef = useRef<Set<string>>(new Set());
  const [modalDesignarAdminOpen, setModalDesignarAdminOpen] = useState(false);
  const [modalSupabaseOpen, setModalSupabaseOpen] = useState(false);
  const [supabaseHealthState, setSupabaseHealthState] = useState<{
    connected: boolean;
    tablesReady: boolean;
    missingTables: string[];
    error?: string;
  } | null>(null);
  const [isSyncingSupabase, setIsSyncingSupabase] = useState(false);

  // Message options & deletion confirm modals
  const [openMessageMenuId, setOpenMessageMenuId] = useState<string | null>(null);
  const [openMessageMenuUpwards, setOpenMessageMenuUpwards] = useState(false);
  const messageMenuTimeoutRef = useRef<any>(null);
  const [messageToDelete, setMessageToDelete] = useState<{ chatId: number | string; messageId: string; messageText: string; sender: string } | null>(null);
  const [confirmDenounceMessage, setConfirmDenounceMessage] = useState<{ chatId: number | string; messageId: string; messageText: string; sender: string } | null>(null);

  // Unified report modal
  const [modalReporteData, setModalReporteData] = useState<{
    isOpen: boolean;
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
    comment: string;
  }>({
    isOpen: false,
    type: 'chat_message',
    reason: 'Spam',
    comment: ''
  });

  // Group moderation modal
  const [modalModerarGrupoOpen, setModalModerarGrupoOpen] = useState(false);
  const [isModifyingParticipant, setIsModifyingParticipant] = useState<string | null>(null);
  const [adminChangePhotoInput, setAdminChangePhotoInput] = useState('');

  // Dashboard tab
  const [dashboardTab, setDashboardTab] = useState<'propuestas' | 'instituciones' | 'reportes' | 'sanciones'>('propuestas');
  const [subTabPropuestas, setSubTabPropuestas] = useState<'por_evaluar' | 'cambios_solicitados'>('por_evaluar');
  const [subTabInstituciones, setSubTabInstituciones] = useState<'pendientes' | 'dadas_de_alta'>('pendientes');
  const [subTabSanciones, setSubTabSanciones] = useState<'usuarios' | 'actividades'>('usuarios');
  const [modalSolicitarCambiosAct, setModalSolicitarCambiosAct] = useState<Activity | null>(null);
  const [solicitarCambiosNota, setSolicitarCambiosNota] = useState('');
  const [searchBannedQuery, setSearchBannedQuery] = useState('');
  const [modalConfirmReportVisor, setModalConfirmReportVisor] = useState(false);
  const [visorMenuOpen, setVisorMenuOpen] = useState(false);
  const [seenCancelledMisActividadesIds, setSeenCancelledMisActividadesIds] = useState<number[]>([]);

  // Calendar state: inicializado dinámicamente al mes y año actual
  const [calMesActual, setCalMesActual] = useState(() => new Date().getMonth());
  const [calAnoActual, setCalAnoActual] = useState(() => new Date().getFullYear());

  // Subtabs
  const [subTabMisActividades, setSubTabMisActividades] = useState<'moderar' | 'realizadas'>('moderar');
  const [subTabResenas, setSubTabResenas] = useState<'mis-opiniones' | 'actividades-organizadas'>('mis-opiniones');

  // Modals state
  const [modalLoginOpen, setModalLoginOpen] = useState(false);
  const [modalRegisterOpen, setModalRegisterOpen] = useState(false);
  const [modalEditProfileOpen, setModalEditProfileOpen] = useState(false);
  const [modalDetalleId, setModalDetalleId] = useState<number | string | null>(null);
  const [modalCustomActivity, setModalCustomActivity] = useState<Activity | null>(null);
  const [modalOpinionesId, setModalOpinionesId] = useState<number | string | null>(null);
  const [modalOpinionesTitle, setModalOpinionesTitle] = useState<string | null>(null);
  const [resenasOriginActivityId, setResenasOriginActivityId] = useState<number | null>(null);

  // Review writing & editing with multi-media
  const [modalEscribirResenaOpen, setModalEscribirResenaOpen] = useState(false);
  const [resenaEditData, setResenaEditData] = useState<{ id?: number | string; actividadId: number | string; actividad: string; estrellas: number; texto: string } | null>(null);
  const [califEstrellas, setCalifEstrellas] = useState(5);
  const [textoResena, setTextoResena] = useState('');
  const [archivosResena, setArchivosResena] = useState<string[]>([]);

  // Review Gallery Visor state (with next/prev arrows, author, stars, review text)
  const [galeriaItems, setGaleriaItems] = useState<GalleryItem[]>([]);
  const [galeriaIndex, setGaleriaIndex] = useState<number>(0);
  const [modalGaleriaOpen, setModalGaleriaOpen] = useState(false);

  // Directory and contact profile
  const [modalDirectorioOpen, setModalDirectorioOpen] = useState(false);
  const [modalPerfilContacto, setModalPerfilContacto] = useState<Contact | null>(null);
  const [indiceResenaPerfil, setIndiceResenaPerfil] = useState(0);

  // Inscriptos / Personal moderation modals
  const [modalInscriptosId, setModalInscriptosId] = useState<number | null>(null);
  const [modalModeracionActividadId, setModalModeracionActividadId] = useState<number | null>(null);

  // Activity creation modal
  const [modalCrearEventoOpen, setModalCrearEventoOpen] = useState(false);
  const [eventoTipoCreacion, setEventoTipoCreacion] = useState<'personal' | 'institucional'>('personal');
  const [modalFechasRepetitivasOpen, setModalFechasRepetitivasOpen] = useState(false);

  // Group creation & participant modals
  const [modalCrearGrupoOpen, setModalCrearGrupoOpen] = useState(false);
  const [fotoNuevoGrupo, setFotoNuevoGrupo] = useState<string>('');
  const [modalVerParticipantesOpen, setModalVerParticipantesOpen] = useState(false);

  // Cancellation and simple image visor
  const [modalConfirmarCancelacion, setModalConfirmarCancelacion] = useState<{ id?: number; nombre: string; dia: string; hora: string; tipo: 'personal' | 'institucional' } | null>(null);
  const [motivoCancelacionInput, setMotivoCancelacionInput] = useState<string>('Cancelada por el organizador');
  const [isCancellingActivity, setIsCancellingActivity] = useState<boolean>(false);
  const [modalVisorImgSrc, setModalVisorImgSrc] = useState<string | null>(null);
  const [modalVisorImgShape, setModalVisorImgShape] = useState<'circle' | 'rect'>('circle');

  // Forms
  const [loginForm, setLoginForm] = useState({ usuario: '', clave: '' });
  const [loginError, setLoginError] = useState('');

  // Password recovery state
  const [modalForgotPasswordOpen, setModalForgotPasswordOpen] = useState(false);
  const [forgotStep, setForgotStep] = useState<'email' | 'code' | 'password' | 'success'>('email');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotResetToken, setForgotResetToken] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotUserFound, setForgotUserFound] = useState<{ usuario: string; apodo: string; email: string } | null>(null);
  const [forgotError, setForgotError] = useState('');
  const [forgotSuccessMsg, setForgotSuccessMsg] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // Soporte form state
  const [soporteAsunto, setSoporteAsunto] = useState<string>(SOPORTE_ASUNTOS[0]);
  const [soporteEmailInvitado, setSoporteEmailInvitado] = useState('');
  const [soporteMensaje, setSoporteMensaje] = useState('');
  const [soporteEnviando, setSoporteEnviando] = useState(false);
  const [soporteError, setSoporteError] = useState('');
  const [soporteEnviadoMsg, setSoporteEnviadoMsg] = useState('');
  const [regForm, setRegForm] = useState({
    tipo: 'personal' as 'personal' | 'institucional',
    nombre: '',
    usuario: '',
    email: '',
    clave: '',
    localidad: '',
    cuit: '',
    entidadTipo: 'Asociación Civil / Club Social',
    contactoInstitucional: '',
    direccionFisica: '',
    sitioWebRedSocial: '',
    presidenteFuncionario: '',
    managerNombre: '',
    managerRol: '',
    gestorNombre: '',
    gestorRol: '',
    terminos: false
  });
  const [regFiles, setRegFiles] = useState<{
    constanciaCuit: FileUploadInfo | null;
    personeriaDoc: FileUploadInfo | null;
  }>({
    constanciaCuit: null,
    personeriaDoc: null
  });
  const [regError, setRegError] = useState('');
  const [profileForm, setProfileForm] = useState({
  apodo: '',
  bio: '',
  contactoEmergencia: '',
  avatar: ''
  });
interface EventoFormData {
  nombre: string;
  avance: string;
  categoria: string;
  frecuencia: 'unico' | 'recurrente';
  fechaIni: string;
  horaIni: string;
  fechaFin: string;
  horaFin: string;
  fechaPrimerEncuentro?: string;
  direccion: string;
  lat: number;
  lng: number;
  tipoCupo: 'limitado' | 'ilimitado';
  cupoMax: number;
  descripcion: string;
  imagen: string;
  videoUrl: string;
  cerrarInscripcionAlIniciarPrimerEncuentro: boolean;
  firstEncounterStartTime?: string;
  firstEncounterEndTime?: string;
}

const INITIAL_EVENTO_FORM: EventoFormData = {
  nombre: '',
  avance: '',
  categoria: 'salud',
  frecuencia: 'unico',
  fechaIni: '',
  horaIni: '',
  fechaFin: '',
  horaFin: '',
  fechaPrimerEncuentro: '',
  direccion: '',
  lat: -34.6068,
  lng: -58.5647,
  tipoCupo: 'limitado',
  cupoMax: 20,
  descripcion: '',
  imagen: '',
  videoUrl: '',
  cerrarInscripcionAlIniciarPrimerEncuentro: false,
};
function getDraftStorageKey(user: { id?: string | number; usuario?: string } | null | undefined): string | null {
  if (!user) return null;
  const identifier = String(user.id || user.usuario || '').trim();
  if (!identifier) return null;
  return `club65_borrador_evento_${identifier.toLowerCase()}`;
}

function loadUserDraft(user: { id?: string | number; usuario?: string } | null | undefined): EventoFormData {
  const key = getDraftStorageKey(user);
  if (!key) return { ...INITIAL_EVENTO_FORM };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...INITIAL_EVENTO_FORM };
    const parsed = JSON.parse(raw);
    return { ...INITIAL_EVENTO_FORM, ...parsed };
  } catch {
    return { ...INITIAL_EVENTO_FORM };
  }
}

  // Event form (cada cuenta tiene su propio borrador aislado)
  const [eventoForm, setEventoForm] = useState<EventoFormData>(INITIAL_EVENTO_FORM);

  const resetEventoForm = () => {
    setEventoForm(INITIAL_EVENTO_FORM);
    setHoraInicioRecurrente('');
    setHoraFinRecurrente('');
    setEditingProposalActivityId(null);
    setUserFeedbackInput('');
    setEventoImgLabel('Sin imagen seleccionada');
    setIsUploadingActivityImage(false);
    setIsUploadingActivityVideo(false);
    if (currentUser) {
      const key = getDraftStorageKey(currentUser);
      if (key) {
        try { localStorage.removeItem(key); } catch (_) {}
      }
    }
    try { localStorage.removeItem('club65_borrador_evento'); } catch (_) {}
  };

  const [eventoImgLabel, setEventoImgLabel] = useState('Sin imagen seleccionada');
  const [sugerenciasUbicacion, setSugerenciasUbicacion] = useState<LocationItem[]>([]);
  const [showSugerencias, setShowSugerencias] = useState(false);
  const [isSearchingLocation, setIsSearchingLocation] = useState(false);

  // Recurring dates helper
  const [frecuenciaRecurrente, setFrecuenciaRecurrente] = useState('semanal');
  const [diasSemanaRecurrente, setDiasSemanaRecurrente] = useState<string[]>(['Lunes']);
  const [diaMesRecurrente, setDiaMesRecurrente] = useState(15);
  const [horaInicioRecurrente, setHoraInicioRecurrente] = useState('');
  const [horaFinRecurrente, setHoraFinRecurrente] = useState('');
  const [cantidadEventosRecurrente, setCantidadEventosRecurrente] = useState(12);
  const [resumenRecurrente, setResumenRecurrente] = useState('Semanal (Lunes) • 12 encuentros');

  const updateRecurrenteHorarios = (newIni: string, newFin: string) => {
    setHoraInicioRecurrente(newIni);
    setHoraFinRecurrente(newFin);
    setEventoForm(prev => ({
      ...prev,
      horaIni: newIni,
      horaFin: newFin,
      firstEncounterStartTime: newIni,
      firstEncounterEndTime: newFin
    }));

    const diasStr = frecuenciaRecurrente === 'mensual'
      ? `Día ${diaMesRecurrente} de cada mes`
      : Array.isArray(diasSemanaRecurrente) && diasSemanaRecurrente.length > 0
        ? `${frecuenciaRecurrente === 'quincenal' ? 'Cada 2 semanas' : 'Semanal'} (${diasSemanaRecurrente.join(', ')})`
        : 'Días a confirmar';

    const horasStr = newIni && newFin
      ? `${newIni} a ${newFin} h`
      : newIni
        ? `a las ${newIni} h`
        : '';

    const baseSchedule = [diasStr, horasStr].filter(Boolean).join(' • ');
    const totalEncuentros = cantidadEventosRecurrente ? ` • ${cantidadEventosRecurrente} encuentros` : '';
    setResumenRecurrente(`${baseSchedule}${totalEncuentros}`);
  };

  // Cargar borrador aislado de la cuenta activa o reiniciar si no tiene
  useEffect(() => {
    if (currentUser) {
      const userDraft = loadUserDraft(currentUser);
      setEventoForm(userDraft);
      setEventoImgLabel(userDraft.imagen ? 'Imagen guardada ✓' : 'Sin imagen seleccionada');
      if (userDraft.frecuencia === 'recurrente') {
        setHoraInicioRecurrente(userDraft.horaIni || '');
        setHoraFinRecurrente(userDraft.horaFin || '');
      }
    } else {
      setEventoForm(INITIAL_EVENTO_FORM);
      setEventoImgLabel('Sin imagen seleccionada');
      setHoraInicioRecurrente('');
      setHoraFinRecurrente('');
    }
    try {
      localStorage.removeItem('club65_borrador_evento');
    } catch (_) {}
  }, [currentUser?.id, currentUser?.usuario]);


  // Comprobación en vivo de colisión horaria al proponer / crear actividades
  const liveCreationCollision = React.useMemo(() => {
    if (!modalCrearEventoOpen || !currentUser) return null;
    const isRec = eventoForm.frecuencia === 'recurrente';
    const hasDate = isRec ? Boolean(eventoForm.fechaPrimerEncuentro) : Boolean(eventoForm.fechaIni);
    const hasTime = isRec ? Boolean(eventoForm.horaIni || horaInicioRecurrente) : Boolean(eventoForm.horaIni);
    if (!hasDate || !hasTime) return null;

    const resolvedSingleFechaFin = !isRec
      ? (eventoForm.fechaFin || (eventoForm.fechaIni && eventoForm.horaFin && eventoForm.horaIni && eventoForm.horaFin <= eventoForm.horaIni ? addDaysYMD(eventoForm.fechaIni, 1) : eventoForm.fechaIni))
      : undefined;

    let scheduleFinal = `${formatFechaVisual(eventoForm.fechaIni)} a las ${eventoForm.horaIni} h`;
    if (isRec) {
      const diasStr = frecuenciaRecurrente === 'mensual'
        ? `Día ${diaMesRecurrente} de cada mes`
        : Array.isArray(diasSemanaRecurrente) && diasSemanaRecurrente.length > 0
          ? `${frecuenciaRecurrente === 'quincenal' ? 'Cada 2 semanas' : 'Semanal'} (${diasSemanaRecurrente.join(', ')})`
          : 'Días a confirmar';
      const horaIniUsar = horaInicioRecurrente || eventoForm.horaIni || '';
      const horaFinUsar = horaFinRecurrente || eventoForm.horaFin || '';
      const horasStr = horaIniUsar && horaFinUsar ? `${horaIniUsar} a ${horaFinUsar} h` : horaIniUsar ? `a las ${horaIniUsar} h` : '';
      const baseSchedule = [diasStr, horasStr].filter(Boolean).join(' • ');
      const totalEncuentros = cantidadEventosRecurrente ? ` • ${cantidadEventosRecurrente} encuentros` : '';
      scheduleFinal = `${baseSchedule}${totalEncuentros}`;
    } else if (eventoForm.horaFin) {
      if (resolvedSingleFechaFin && resolvedSingleFechaFin !== eventoForm.fechaIni) {
        scheduleFinal += ` hasta ${formatFechaVisual(resolvedSingleFechaFin)} a las ${eventoForm.horaFin} h`;
      } else {
        scheduleFinal += ` hasta las ${eventoForm.horaFin} h`;
      }
    }

    let computedEndDate: string | undefined = undefined;
    if (isRec) {
      const tempSessions = getActivitySessions({
        isRecurrent: true,
        firstEncounterDate: eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni,
        startDate: eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni,
        fechaPrimerEncuentro: eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni,
        horaIni: horaInicioRecurrente || eventoForm.horaIni || '',
        horaFin: horaFinRecurrente || eventoForm.horaFin || '',
        startTime: horaInicioRecurrente || eventoForm.horaIni || '',
        endTime: horaFinRecurrente || eventoForm.horaFin || '',
        diasSemana: diasSemanaRecurrente,
        dias_semana: diasSemanaRecurrente,
        diaMes: diaMesRecurrente,
        dia_mes: diaMesRecurrente,
        cantidadEventos: cantidadEventosRecurrente,
        cantidad_eventos: cantidadEventosRecurrente,
        frequency: frecuenciaRecurrente,
        frecuencia: frecuenciaRecurrente,
        schedule: scheduleFinal
      });
      if (tempSessions.length > 0) {
        computedEndDate = tempSessions[tempSessions.length - 1].date;
      }
    }

    const candidate = {
      id: editingProposalActivityId || undefined,
      title: eventoForm.nombre || 'Nueva actividad',
      nombre: eventoForm.nombre || 'Nueva actividad',
      schedule: scheduleFinal,
      horario: scheduleFinal,
      isRecurrent: isRec,
      es_recurrente: isRec,
      frequency: frecuenciaRecurrente,
      frecuencia: frecuenciaRecurrente,
      startDate: isRec ? (eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : eventoForm.fechaIni,
      endDate: isRec ? (computedEndDate || eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : (resolvedSingleFechaFin || eventoForm.fechaIni),
      fechaIni: isRec ? (eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : eventoForm.fechaIni,
      fechaFin: isRec ? (computedEndDate || eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : (resolvedSingleFechaFin || eventoForm.fechaIni),
      startTime: eventoForm.horaIni || horaInicioRecurrente || '',
      endTime: eventoForm.horaFin || horaFinRecurrente || '',
      horaIni: eventoForm.horaIni || horaInicioRecurrente || '',
      horaFin: eventoForm.horaFin || horaFinRecurrente || '',
      firstEncounterDate: isRec ? eventoForm.fechaPrimerEncuentro : undefined,
      fechaPrimerEncuentro: isRec ? eventoForm.fechaPrimerEncuentro : undefined,
      firstMeetingDate: isRec ? eventoForm.fechaPrimerEncuentro : undefined,
      diasSemana: isRec ? diasSemanaRecurrente : undefined,
      dias_semana: isRec ? diasSemanaRecurrente : undefined,
      diaMes: isRec ? diaMesRecurrente : undefined,
      dia_mes: isRec ? diaMesRecurrente : undefined,
      cantidadEventos: isRec ? cantidadEventosRecurrente : undefined,
      cantidad_eventos: isRec ? cantidadEventosRecurrente : undefined,
    };

    const res = canUserCreateActivity(candidate, currentUser, activities);
    return res.allowed ? null : res;
  }, [modalCrearEventoOpen, currentUser, activities, editingProposalActivityId, eventoForm, horaInicioRecurrente, horaFinRecurrente, frecuenciaRecurrente, diasSemanaRecurrente, diaMesRecurrente, cantidadEventosRecurrente]);

  // Comprobación en vivo de nombre duplicado con actividades publicadas en cartelera
  const liveCreationNameCollision = React.useMemo(() => {
    if (!modalCrearEventoOpen) return null;
    const res = checkActivityNameCollision(eventoForm.nombre, editingProposalActivityId, activities);
    return res.hasCollision ? res : null;
  }, [modalCrearEventoOpen, eventoForm.nombre, editingProposalActivityId, activities]);


  // Group creation form
  const [nombreNuevoGrupo, setNombreNuevoGrupo] = useState('');
  const [participantesSeleccionadosGrupo, setParticipantesSeleccionadosGrupo] = useState<string[]>([]);

  // Global admin ban form
  const [inputVetarGlobal, setInputVetarGlobal] = useState('');

  // Apply saved guest accessibility preferences immediately on mount
  useEffect(() => {
    applyAccessibility(guestTextSize, guestContrast);
  }, []);

  // Initial load
  useEffect(() => {
    async function initApp() {
      try {
        setLoading(true);
        const user = currentUser || await api.getMe();
        if (user && !currentUser) {
          setCurrentUser(user);
        }
        if (user) {
          setCurrentView(user.tipo === 'moderador' ? 'moderacion' : 'explorar');
        } else {
          setCurrentView('home-visitante');
        }

        // Limpiar cualquier contacto hardcodeado / de prueba o que coincida con el propio usuario del almacenamiento local
        try {
          const rawContacts = localStorage.getItem('club65_custom_contacts');
          if (rawContacts) {
            const parsed = JSON.parse(rawContacts);
            if (Array.isArray(parsed)) {
              const cleaned = parsed.filter(c => !isHardcodedOrMockProfile(c) && !isSelfUserOrContact(c, user));
              localStorage.setItem('club65_custom_contacts', JSON.stringify(cleaned));
            }
          }
        } catch (e) {}

        const isModUser = Boolean(user && (user.tipo === 'moderador' || (user as any).rol === 'moderador'));
        const [acts, chatsList, revs, conts, reps, insts, appInsts, bans, sancs, allUsers, bajas, notices] = await Promise.all([
          api.getActivities(),
          user?.id ? api.getChats(user) : Promise.resolve([]),
          api.getReviews(),
          user?.id ? api.getContacts() : Promise.resolve([]),
          isModUser ? api.getReports() : Promise.resolve([]),
          isModUser ? api.getPendingInstitutions() : Promise.resolve([]),
          isModUser ? api.getApprovedInstitutions() : Promise.resolve([]),
          api.getBannedUsers(),
          api.getSanctions(),
          api.getUsers().catch(() => ({} as Record<string, User>)),
          api.getBajas().catch(() => []),
          user?.id ? api.getCancelledGroupNotices(user).catch(() => []) : Promise.resolve([])
        ]);

        const baseUsersMap = allUsers || {};
        const neededAvatarIds = collectNeededAvatarUserIds({
          activities: acts,
          chats: chatsList,
          contacts: conts,
          reviews: revs,
          allUsersMap: baseUsersMap,
          currentUser: user
        });
        let hydratedUsersMap = baseUsersMap;
        if (neededAvatarIds.length > 0) {
          neededAvatarIds.forEach(id => hydratedAvatarIdsRef.current.add(id));
          const avatarsById = await api.getUserAvatarsByIds(neededAvatarIds).catch(() => ({} as Record<string, string>));
          hydratedUsersMap = mergeAvatarsIntoUsersMap(baseUsersMap, avatarsById);
        }

        setActivities(acts);
        setChats(deduplicateChats(chatsList));
        setReviews(revs);
        setContacts(filterContactsForUser(conts, user));
        setReports(reps);
        setPendingInstitutions(insts);
        setApprovedInstitutions(appInsts);
        setBannedUsersList(bans);
        setSanctionsList(sancs);
        setAllUsersMap(hydratedUsersMap);
        setBajasList(bajas);
        setCancelledGroupNotices(filterDismissedNotices(notices || [], user?.id));

        if (user) {
          applyAccessibility(user.textSize, user.contrast);
          setGuestTextSize(user.textSize || 'normal');
          setGuestContrast(Boolean(user.contrast));
          try {
            localStorage.setItem('club65_guest_text_size', user.textSize || 'normal');
            localStorage.setItem('club65_guest_contrast', String(Boolean(user.contrast)));
          } catch {}
          setProfileForm({ apodo: user.apodo, bio: user.bio, contactoEmergencia: user.contactoEmergencia || '', avatar: user.avatar || '' });
          api.getUserActivityAlertsState(user.id).then(alerts => {
            setSeenSuspendedActIds(alerts.seenSuspendedIds);
            setSeenCancelledMisActividadesIds(alerts.seenSuspendedIds);
            setSeenCancelledAgendaActIds(alerts.seenAgendaCancelledIds);
            setDismissedCancelledAgendaActIds(alerts.dismissedAgendaCancelledIds);
            setSeenRejectedProposalIds(alerts.seenRejectedProposalIds);
            setDismissedRejectedProposalIds(alerts.dismissedRejectedProposalIds);
          }).catch(() => {
            setSeenSuspendedActIds(getSeenSuspendedFromStorage(user.id));
          });
        } else {
          applyAccessibility(guestTextSize, guestContrast);
        }

        checkSupabaseStatus().then(status => {
          setSupabaseHealthState(status);
        }).catch(() => {});
      } catch (err) {
        console.error('Error initializing app:', err);
      } finally {
        setLoading(false);
      }
    }
    initApp();
  }, []);

  const missingAvatarIdsKey = useMemo(() => {
    if (loading) return '';
    const needed = collectNeededAvatarUserIds({
      activities,
      chats,
      contacts,
      reviews,
      allUsersMap,
      currentUser,
      attemptedIds: hydratedAvatarIdsRef.current
    });
    return needed.join(',');
  }, [loading, activities, chats, contacts, reviews, allUsersMap, currentUser]);

  useEffect(() => {
    if (!missingAvatarIdsKey) return;
    const idsToFetch = missingAvatarIdsKey.split(',').filter(Boolean);
    if (idsToFetch.length === 0) return;

    idsToFetch.forEach(id => hydratedAvatarIdsRef.current.add(id));
    let cancelled = false;
    api.getUserAvatarsByIds(idsToFetch).then((avatarsById) => {
      if (cancelled || !avatarsById || Object.keys(avatarsById).length === 0) return;
      setAllUsersMap((prev) => mergeAvatarsIntoUsersMap(prev, avatarsById));
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [missingAvatarIdsKey]);

  // Suscripciones Supabase Realtime livianas: actualizan estado local directamente desde payload sin polling ni recargas completas
  useEffect(() => {
    if (!currentUser?.id) return;
    const channel = supabase
      .channel('realtime_all_messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload: any) => {
          const newRow = payload?.new;
          if (!newRow) return;

          // Evitar reprocesar o re-fetchear cuando el evento corresponde a un envío local reciente
          if (recentlySentMsgIdsRef.current.has(String(newRow.id))) {
            return;
          }

          let parsedReplyTo = newRow.reply_to;
          if (typeof parsedReplyTo === 'string') {
            try { parsedReplyTo = JSON.parse(parsedReplyTo); } catch {}
          }
          const isRealReply = parsedReplyTo && typeof parsedReplyTo === 'object' && !parsedReplyTo.is_group_init && !parsedReplyTo.event && Boolean(parsedReplyTo.text || parsedReplyTo.sender || parsedReplyTo.id);
          const safeReplyTo = isRealReply ? {
            id: String(parsedReplyTo.id || ''),
            sender: String(parsedReplyTo.sender || ''),
            text: String(parsedReplyTo.text || '')
          } : undefined;

          const activeU = currentUserRef.current || currentUser;
          const isFromOther = isMessageFromOtherUser(newRow, activeU);
          const displayState = resolveRemovedMessageDisplay(newRow);
          const isDeleted = displayState.isDeleted;
          const isDeletedByAdmin = displayState.deletedByAdmin;
          const isDeletedByMod = displayState.deletedByGroupModerator;
          const textContent = displayState.text;

          const matchingChat = chatsRef.current.find((c: any) => {
            const cBigId = chatIdentifierToBigInt(c.id);
            const aBigId = c.activityId ? chatIdentifierToBigInt(c.activityId) : null;
            return (
              String(c.id) === String(newRow.chat_id) ||
              (c.activityId && String(c.activityId) === String(newRow.chat_id)) ||
              cBigId === Number(newRow.chat_id) ||
              (aBigId && aBigId === Number(newRow.chat_id))
            );
          });

          if (matchingChat) {
            if ((matchingChat.messages || []).some((m: any) => String(m.id) === String(newRow.id))) {
              return;
            }

            const newMsgTs = newRow.created_at ? new Date(newRow.created_at).getTime() : Date.now();
            const myTokens = buildChatUserTokens(activeU);
            const myStrictIds = [activeU?.id, (activeU as any)?.supabaseId]
              .filter(Boolean)
              .map((x: any) => String(x).trim().toLowerCase());
            const rtEvent = parsedReplyTo && typeof parsedReplyTo === 'object' ? parsedReplyTo.event : undefined;
            const rtTargetId = String(parsedReplyTo?.participantId || parsedReplyTo?.userId || '').trim().toLowerCase();
            const rtConflictingId = Boolean(rtTargetId && myStrictIds.length > 0 && !myStrictIds.includes(rtTargetId));
            const rtTargetsMe = Boolean(
              rtEvent &&
              parsedReplyTo &&
              !rtConflictingId &&
              (
                (parsedReplyTo.participant && myTokens.includes(String(parsedReplyTo.participant).trim().toLowerCase())) ||
                (rtTargetId && myTokens.includes(rtTargetId)) ||
                (Array.isArray(parsedReplyTo.participantTokens) &&
                  parsedReplyTo.participantTokens.some((t: any) => Boolean(t) && myTokens.includes(String(t).trim().toLowerCase())))
              )
            );
            const isSelfExitEvent = (rtEvent === 'user_left' || rtEvent === 'participant_removed' || rtEvent === 'participant_vetoed') && rtTargetsMe;
            const isSelfReaddedEvent = rtEvent === 'participant_added' && rtTargetsMe;

            const departureAt = matchingChat.type === 'grupal'
              ? getUserChatDepartureTimestamp(matchingChat, activeU)
              : 0;
            const isOutOfGroup = matchingChat.type === 'grupal' && (
              departureAt > 0 ||
              isUserRemovedFromChat(matchingChat, activeU) ||
              isUserLeftVoluntarilyFromChat(matchingChat, activeU) ||
              isUserVetoedFromChat(matchingChat, activeU)
            );

            // Si el usuario ya dejó o fue retirado del grupo y NO lo están re-agregando, bloquear mensajes posteriores
            if (isOutOfGroup && !isSelfReaddedEvent) {
              if (!isSelfExitEvent || (departureAt > 0 && newMsgTs > departureAt + 5000)) {
                return;
              }
            }

            const newMsgObj: ChatMessage = {
              id: String(newRow.id),
              chatId: String(matchingChat.id),
              senderId: String(newRow.sender_id || ''),
              sender: newRow.sender || 'Vecino',
              avatar: newRow.avatar || '',
              role: newRow.role || 'Vecino',
              text: textContent,
              isDeleted,
              deletedByAdmin: isDeletedByAdmin,
              deletedByGroupModerator: isDeletedByMod,
              retirado: isDeleted,
              isPinned: Boolean(newRow.is_pinned),
              time: newRow.time || formatArgentinaTimeOnly(newRow.created_at || new Date()),
              createdAt: newRow.created_at || new Date().toISOString(),
              timestamp: newMsgTs,
              replyTo: safeReplyTo
            };
            if (parsedReplyTo && typeof parsedReplyTo === 'object') {
              (newMsgObj as any).reply_to = parsedReplyTo;
            }

            setChats((prevChats: any[]) =>
              deduplicateChats(
                prevChats.map((c: any) => {
                  if (String(c.id) !== String(matchingChat.id)) return c;
                  if ((c.messages || []).some((m: any) => String(m.id) === String(newMsgObj.id))) return c;
                  const updatedMsgs = deduplicateMessages([...(c.messages || []), newMsgObj]);
                  const nextPinnedId = newMsgObj.isPinned && !newMsgObj.isDeleted
                    ? String(newMsgObj.id)
                    : c.pinnedMessageId;

                  if (isSelfExitEvent) {
                    const snapshotMap: Record<string, string[]> = { ...(c.participantsSnapshotOnRemoval || {}) };
                    const snapList: string[] = Array.isArray(parsedReplyTo?.participantsSnapshot) && parsedReplyTo.participantsSnapshot.length > 0
                      ? parsedReplyTo.participantsSnapshot
                      : (Array.isArray(c.participants) ? [...c.participants] : []);
                    if (snapList.length > 0) {
                      myTokens.forEach((tok) => {
                        if (!snapshotMap[tok] || snapshotMap[tok].length === 0) {
                          snapshotMap[tok] = snapList;
                        }
                      });
                    }
                    const nextParts = (c.participants || []).filter((p: string) => !myTokens.includes(String(p).trim().toLowerCase()));
                    return {
                      ...c,
                      leftVoluntarily: rtEvent === 'user_left' ? true : c.leftVoluntarily,
                      removedByUser: rtEvent === 'participant_removed' || rtEvent === 'user_left' ? true : c.removedByUser,
                      vetoedByUser: rtEvent === 'participant_vetoed' ? true : c.vetoedByUser,
                      removedAtForUser: c.removedAtForUser || newMsgTs,
                      leftAtForUser: rtEvent === 'user_left' ? (c.leftAtForUser || newMsgTs) : c.leftAtForUser,
                      participantsSnapshotOnRemoval: snapshotMap,
                      participants: nextParts,
                      pinnedMessageId: nextPinnedId,
                      messages: updatedMsgs,
                      lastMessage: newMsgObj.text,
                      lastMessageTime: newMsgObj.time,
                      updatedAt: newMsgObj.createdAt,
                      updated_at: newMsgObj.createdAt
                    };
                  }

                  if (isSelfReaddedEvent) {
                    const curParts = Array.isArray(c.participants) ? c.participants : [];
                    const selfDisplay = activeU?.apodo || activeU?.usuario || activeU?.nombre || '';
                    const nextParts = selfDisplay && !curParts.some((p: string) => myTokens.includes(String(p).trim().toLowerCase()))
                      ? [...curParts, selfDisplay]
                      : curParts;
                    return {
                      ...c,
                      leftVoluntarily: false,
                      removedByUser: false,
                      vetoedByUser: false,
                      removedAtForUser: undefined,
                      leftAtForUser: undefined,
                      participants: nextParts,
                      removedParticipants: (c.removedParticipants || []).filter((p: string) => !myTokens.includes(String(p).trim().toLowerCase())),
                      leftVoluntarilyParticipants: (c.leftVoluntarilyParticipants || []).filter((p: string) => !myTokens.includes(String(p).trim().toLowerCase())),
                      vetoedParticipants: (c.vetoedParticipants || []).filter((p: string) => !myTokens.includes(String(p).trim().toLowerCase())),
                      pinnedMessageId: nextPinnedId,
                      messages: updatedMsgs,
                      lastMessage: newMsgObj.text,
                      lastMessageTime: newMsgObj.time,
                      updatedAt: newMsgObj.createdAt,
                      updated_at: newMsgObj.createdAt
                    };
                  }

                  const isOtherExitEvent =
                    !isSelfExitEvent &&
                    (rtEvent === 'user_left' || rtEvent === 'participant_removed' || rtEvent === 'participant_vetoed');
                  const departedTokens = isOtherExitEvent && parsedReplyTo
                    ? [
                        parsedReplyTo.participant,
                        parsedReplyTo.participantId,
                        parsedReplyTo.userId,
                        ...(Array.isArray(parsedReplyTo.participantTokens) ? parsedReplyTo.participantTokens : [])
                      ]
                        .filter(Boolean)
                        .map((t: any) => String(t).trim().toLowerCase())
                    : [];
                  const updatedPartsForOtherExit = isOtherExitEvent && departedTokens.length > 0 && Array.isArray(c.participants)
                    ? c.participants.filter((p: string) => !departedTokens.includes(String(p).trim().toLowerCase()))
                    : c.participants;

                  return {
                    ...c,
                    participants: updatedPartsForOtherExit,
                    pinnedMessageId: nextPinnedId,
                    messages: updatedMsgs,
                    lastMessage: newMsgObj.text,
                    lastMessageTime: newMsgObj.time,
                    updatedAt: newMsgObj.createdAt,
                    updated_at: newMsgObj.createdAt
                  };
                })
              )
            );

            if (isFromOther && !isSelfExitEvent && (!isOutOfGroup || isSelfReaddedEvent)) {
              const isChatOpen = currentViewRef.current === 'chat' && (
                String(activeChatIdRef.current) === String(matchingChat.id) ||
                (matchingChat.activityId && String(activeChatIdRef.current) === String(matchingChat.activityId)) ||
                chatIdentifierToBigInt(activeChatIdRef.current) === Number(newRow.chat_id)
              );
              if (isChatOpen) {
                markChatAsRead(matchingChat.id, newMsgObj.timestamp);
              } else {
                showToast(
                  formatIncomingMessageToast(matchingChat, newRow.sender, newRow.text, newRow.sender_id, allUsersMapRef.current),
                  matchingChat.id
                );
                playNotificationSound();
              }
            }
          }
          // Si el mensaje pertenece a un chat ajeno al usuario actual, no disparar consultas a la DB.
          // Los chats nuevos en los que ingresa el usuario llegan por partChannel (chat_participants INSERT).
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages' },
        (payload: any) => {
          const newRow = payload?.new;
          if (!newRow || !newRow.id) return;

          const displayState = resolveRemovedMessageDisplay(newRow);
          const isDeleted = displayState.isDeleted;
          const isDeletedByAdmin = displayState.deletedByAdmin;
          const isDeletedByMod = displayState.deletedByGroupModerator;
          const isPinnedRow = Boolean(newRow.is_pinned) && !isDeleted;
          const textContent = isDeleted ? displayState.text : newRow.text;

          setChats((prevChats: any[]) =>
            prevChats.map((c: any) => {
              const cBigId = chatIdentifierToBigInt(c.id);
              const aBigId = c.activityId ? chatIdentifierToBigInt(c.activityId) : null;
              const matchesChat =
                String(c.id) === String(newRow.chat_id) ||
                (c.activityId && String(c.activityId) === String(newRow.chat_id)) ||
                cBigId === Number(newRow.chat_id) ||
                (aBigId && aBigId === Number(newRow.chat_id));
              const hasMsg = (c.messages || []).some((m: any) => String(m.id) === String(newRow.id));

              if (!matchesChat && !hasMsg) return c;

              const updatedMsgs = (c.messages || []).map((m: any) => {
                if (String(m.id) === String(newRow.id)) {
                  return {
                    ...m,
                    isPinned: isPinnedRow,
                    isDeleted,
                    retirado: isDeleted,
                    deletedByAdmin: isDeletedByAdmin,
                    deletedByGroupModerator: isDeletedByMod,
                    text: textContent !== undefined ? textContent : m.text
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

    // Suscripción en tiempo real a chat_participants: actualiza solo el chat afectado sin recargar todos los chats
    const partChannel = supabase
      .channel(`user_chat_parts_${currentUser.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_participants',
          filter: `user_id=eq.${currentUser.id}`
        },
        (payload: any) => {
          const newChatId = payload?.new?.chat_id ? String(payload.new.chat_id) : '';
          const activeU = currentUserRef.current || currentUser;
          if (!newChatId || !activeU?.id) return;
          if (chatsRef.current.some((c: any) => String(c.id) === newChatId)) return;

          chatService.getSingleChatById(newChatId, activeU).then((singleChat) => {
            if (!singleChat) return;
            setChats((prev) => {
              if (prev.some((c) => String(c.id) === String(singleChat.id))) return prev;
              return deduplicateChats([singleChat, ...prev]);
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
          filter: `user_id=eq.${currentUser.id}`
        },
        (payload: any) => {
          const removedChatId = payload?.old?.chat_id ? String(payload.old.chat_id) : '';
          if (!removedChatId) return;
          const activeU = currentUserRef.current || currentUser;
          const myTokens = activeU ? buildChatUserTokens(activeU) : [];
          setChats((prev) =>
            prev.reduce((acc: Chat[], c: Chat) => {
              if (String(c.id) !== removedChatId) {
                acc.push(c);
                return acc;
              }
              if (c.type === 'privado') {
                return acc;
              }
              const nowMs = Date.now();
              acc.push({
                ...c,
                removedByUser: true,
                removedAtForUser: (c as any).removedAtForUser || nowMs,
                removedParticipants: Array.from(new Set([...((c as any).removedParticipants || []), ...myTokens]))
              } as any);
              return acc;
            }, [])
          );
        }
      )
      .subscribe();

    // Suscripción en tiempo real a activities: parchea directamente el estado local con payload.new / payload.old
    const actChannel = supabase
      .channel('realtime_activities_updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activities' },
        (payload: any) => {
          const evType = payload?.eventType;
          if (evType === 'DELETE') {
            const deletedId = payload?.old?.id;
            if (deletedId === undefined || deletedId === null) return;
            const deletedIdStr = String(deletedId);
            setActivities((prev) => prev.filter((a) => String(a.id) !== deletedIdStr));
            setChats((prev) => prev.filter((c) => !c.activityId || String(c.activityId) !== deletedIdStr));
            setActiveChatId((cur) => (cur && String(cur) === deletedIdStr ? null : cur));
            return;
          }

          const newRow = payload?.new;
          if (!newRow || newRow.id === undefined || newRow.id === null) return;

          const mappedAct = api.mapSupabaseActivityRow(newRow, allUsersMapRef.current);
          const mappedIdStr = String(mappedAct.id);

          setActivities((prev) => {
            const idx = prev.findIndex((a) => String(a.id) === mappedIdStr);
            if (idx === -1) {
              return [mappedAct, ...prev];
            }
            const next = [...prev];
            next[idx] = mappedAct;
            return next;
          });

          const statusLow = String(mappedAct.proposalStatus || (mappedAct as any).estado || '').toLowerCase().trim();
          const isCancelledOrBaja =
            statusLow === 'baja_forzada' ||
            statusLow === 'cancelada_organizador' ||
            Boolean((mappedAct as any).fechaBaja || (newRow as any).fecha_baja);

          if (isCancelledOrBaja) {
            const bajaRecord: BajaRecord = {
              id: `baja_act_${mappedIdStr}`,
              activityId: Number(mappedAct.id) || (mappedAct.id as any),
              title: mappedAct.title || 'Actividad',
              organizer: mappedAct.organizer || 'Organizador',
              date: newRow.fecha_baja
                ? (String(newRow.fecha_baja).includes('T') ? formatArgentinaDateTime(newRow.fecha_baja) : String(newRow.fecha_baja))
                : formatArgentinaDateTime(),
              reason: newRow.motivo_baja || newRow.feedback_admin || newRow.proposal_note || newRow.feedback || '-',
              adminUsername: statusLow === 'cancelada_organizador' ? '-' : (newRow.admin_baja_id || 'administrador')
            };
            setBajasList((prev) => {
              const exists = prev.some((b) => String(b.activityId) === mappedIdStr);
              if (exists) {
                return prev.map((b) => (String(b.activityId) === mappedIdStr ? { ...b, ...bajaRecord } : b));
              }
              return [bajaRecord, ...prev];
            });
            setChats((prev) => prev.filter((c) => !c.activityId || String(c.activityId) !== mappedIdStr));
            setActiveChatId((cur) => {
              if (!cur) return cur;
              const matchedChat = chatsRef.current.find(
                (c) => (String(c.id) === String(cur) || (c.activityId && String(c.activityId) === String(cur))) &&
                  c.activityId && String(c.activityId) === mappedIdStr
              );
              return matchedChat ? null : cur;
            });
          } else {
            setChats((prev) =>
              prev.map((c) => {
                if (!c.activityId || String(c.activityId) !== mappedIdStr) return c;
                return {
                  ...c,
                  title: mappedAct.title || c.title,
                  name: mappedAct.title || c.name,
                  avatar: mappedAct.image || c.avatar,
                  image: mappedAct.image || c.image
                };
              })
            );
          }
        }
      )
      .subscribe();

    // Suscripción en tiempo real a users: aplica payload.new directamente sin disparar api.getChats ni api.getMe
    const userNotifChannel = supabase
      .channel(`realtime_user_notifs_${currentUser.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'users',
          filter: `id=eq.${currentUser.id}`
        },
        (payload: any) => {
          const updatedRow = payload?.new;
          const activeU = currentUserRef.current || currentUser;
          if (!updatedRow || !activeU) return;

          const nextRole = resolveUserRole(updatedRow);
          const prevRole = resolveUserRole(activeU);
          const roleChanged =
            nextRole !== prevRole ||
            (updatedRow.tipo && updatedRow.tipo !== activeU.tipo) ||
            (updatedRow.rol && updatedRow.rol !== activeU.rol);

          const updatedNotifs = Array.isArray(updatedRow.notifications)
            ? updatedRow.notifications
            : activeU.notifications;

          const nextBlocked = Array.isArray(updatedRow.blocked_users)
            ? updatedRow.blocked_users
            : (activeU.myBlockedUsers || activeU.blockedUsers || []);

          const patchedUser: User = {
            ...activeU,
            apodo: updatedRow.apodo ?? activeU.apodo,
            bio: updatedRow.bio !== undefined ? (sanitizeProfileBio(updatedRow.bio) || '') : activeU.bio,
            contactoEmergencia: updatedRow.contacto_emergencia ?? activeU.contactoEmergencia,
            textSize: updatedRow.text_size ?? activeU.textSize,
            contrast: updatedRow.contrast !== undefined ? Boolean(updatedRow.contrast) : activeU.contrast,
            tipo: nextRole,
            rol: nextRole,
            isVerified: nextRole === 'moderador' ? true : (nextRole === 'institucional' ? Boolean(updatedRow.is_verified ?? activeU.isVerified) : false),
            estadoAlta: updatedRow.estado_alta ?? activeU.estadoAlta,
            myBlockedUsers: nextBlocked,
            blockedUsers: Array.from(new Set([...nextBlocked, ...(activeU.blockedByUsers || [])])),
            notifications: updatedNotifs
          };

          setCurrentUser(patchedUser);

          if (Array.isArray(updatedRow.notifications)) {
            const extracted = extractCancelledGroupNoticesFromNotifications(updatedRow.notifications);
            setCancelledGroupNotices(filterDismissedNotices(extracted, activeU.id));

            // Aplicar avisos de salida/retiro/veto directamente en memoria sobre el chat correspondiente
            const myTokens = buildChatUserTokens(patchedUser);
            const removedNotices = updatedRow.notifications.filter((n: any) => n && n.type === 'chat_removed_notice' && n.chatId);
            if (removedNotices.length > 0) {
              setChats((prev) =>
                prev.map((c) => {
                  const matchNotice = removedNotices.find((n: any) => String(n.chatId) === String(c.id));
                  if (!matchNotice || c.type !== 'grupal') return c;
                  const noticeTs = matchNotice.removedAt || matchNotice.leftAt || matchNotice.createdAt || Date.now();
                  return {
                    ...c,
                    removedByUser: true,
                    removedAtForUser: (c as any).removedAtForUser || noticeTs,
                    removedParticipants: Array.from(new Set([...((c as any).removedParticipants || []), ...myTokens])),
                    ...(matchNotice.reason === 'left'
                      ? {
                          leftVoluntarily: true,
                          leftAtForUser: (c as any).leftAtForUser || noticeTs,
                          leftVoluntarilyParticipants: Array.from(new Set([...((c as any).leftVoluntarilyParticipants || []), ...myTokens]))
                        }
                      : {}),
                    ...(matchNotice.reason === 'vetoed'
                      ? {
                          vetoedByUser: true,
                          vetoedParticipants: Array.from(new Set([...((c as any).vetoedParticipants || []), ...myTokens]))
                        }
                      : {})
                  } as any;
                })
              );
            }
          }

          if (roleChanged) {
            setProfileForm({
              apodo: patchedUser.apodo,
              bio: patchedUser.bio,
              contactoEmergencia: patchedUser.contactoEmergencia || '',
              avatar: patchedUser.avatar || ''
            });
            if (nextRole === 'moderador' && prevRole !== 'moderador') {
              showToast('¡Tu cuenta fue designada como Administrador oficial de CLUB65!');
              setCurrentView('moderacion');
              Promise.all([
                api.getReports().catch(() => []),
                api.getPendingInstitutions().catch(() => []),
                api.getApprovedInstitutions().catch(() => [])
              ]).then(([reps, pInsts, aInsts]) => {
                setReports(reps);
                setPendingInstitutions(pInsts);
                setApprovedInstitutions(aInsts);
              }).catch(() => {});
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(partChannel);
      supabase.removeChannel(actChannel);
      supabase.removeChannel(userNotifChannel);
    };
  }, [currentUser?.id, currentUser?.usuario]);

  // Al abrir una conversación seleccionada, carga los últimos 80 mensajes con columnas explícitas (sin avatar Base64)
  useEffect(() => {
    if (!activeChatId) return;

    let isMounted = true;
    const loadSelectedChatMessages = async () => {
      try {
        const bigId = chatIdentifierToBigInt(activeChatId);
        const { data, error } = await supabase
          .from('messages')
          .select('id, chat_id, sender_id, sender, role, text, time, created_at, is_deleted, deleted_by_admin, deleted_by_group_moderator, is_pinned, reply_to')
          .eq('chat_id', bigId)
          .order('created_at', { ascending: false })
          .limit(80);

        if (error) {
          console.warn('Error al cargar mensajes del chat activo:', error.message);
          return;
        }

        if (isMounted && Array.isArray(data)) {
          const chronologicalData = [...data].sort((a: any, b: any) => {
            const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
            return ta - tb;
          });
          const loadedMsgs: ChatMessage[] = chronologicalData.map((m: any) => {
            const displayState = resolveRemovedMessageDisplay(m);
            const isDeleted = displayState.isDeleted;
            const isDeletedByAdmin = displayState.deletedByAdmin;
            const isDeletedByMod = displayState.deletedByGroupModerator;
            const isPinned = Boolean(m.is_pinned) && !isDeleted;
            const textContent = displayState.text;

            let parsedReplyTo: any = m.reply_to;
            if (typeof parsedReplyTo === 'string') {
              try { parsedReplyTo = JSON.parse(parsedReplyTo); } catch {}
            }

            const isRealReply = parsedReplyTo && typeof parsedReplyTo === 'object' && !parsedReplyTo.event && Boolean(parsedReplyTo.text || parsedReplyTo.sender || parsedReplyTo.id);

            const msgItem: ChatMessage = {
              id: String(m.id),
              chatId: String(activeChatId),
              senderId: String(m.sender_id || ''),
              sender: m.sender || m.remitente || 'Vecino',
              avatar: '',
              role: m.role || 'Vecino',
              text: textContent,
              isDeleted,
              deletedByAdmin: isDeletedByAdmin,
              deletedByGroupModerator: isDeletedByMod,
              retirado: isDeleted,
              isPinned,
              time: m.time || (m.created_at ? formatArgentinaTimeOnly(m.created_at) : 'Recién'),
              replyTo: isRealReply ? {
                id: String(parsedReplyTo.id || ''),
                sender: String(parsedReplyTo.sender || ''),
                text: String(parsedReplyTo.text || '')
              } : undefined,
              createdAt: m.created_at || new Date().toISOString(),
              timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now()
            };
            if (parsedReplyTo && typeof parsedReplyTo === 'object') {
              (msgItem as any).reply_to = parsedReplyTo;
            }
            return msgItem;
          });

          const activeU = currentUserRef.current || currentUser;
          const targetChatMeta = chatsRef.current.find((c: any) =>
            String(c.id) === String(activeChatId) || (c.activityId && String(c.activityId) === String(activeChatId))
          ) || { id: activeChatId, type: 'grupal' };
          const filteredLoadedMsgs = filterChatMessagesForUser(
            loadedMsgs,
            activeChatId,
            activeU,
            { ...targetChatMeta, messages: loadedMsgs }
          );
          const pinnedLoadedMsg = getPinnedMessageFromList(filteredLoadedMsgs);

          setChats(prev => prev.map(c => {
            if (String(c.id) === String(activeChatId) || (c.activityId && String(c.activityId) === String(activeChatId))) {
              return {
                ...c,
                pinnedMessageId: pinnedLoadedMsg ? String(pinnedLoadedMsg.id) : undefined,
                messages: filteredLoadedMsgs,
                lastMessage: filteredLoadedMsgs[filteredLoadedMsgs.length - 1]?.text || (filteredLoadedMsgs.length === 0 ? '' : c.lastMessage),
                lastMessageTime: filteredLoadedMsgs[filteredLoadedMsgs.length - 1]?.time || (filteredLoadedMsgs.length === 0 ? '' : c.lastMessageTime)
              };
            }
            return c;
          }));
        }
      } catch (err) {
        console.warn('Excepción al cargar mensajes del chat:', err);
      }
    };

    loadSelectedChatMessages();

    return () => {
      isMounted = false;
    };
  }, [activeChatId]);


  // Track leaving tabs to dismiss notification dots and persist seen state in Supabase
  useEffect(() => {
    const activeU = currentUserRef.current;
    const currentActs = activitiesRef.current;
    if (activeU && prevViewRef.current === 'mis-actividades' && currentView !== 'mis-actividades') {
      const suspendedIds = currentActs
        .filter(a =>
          isActivityOwnedByUser(a, activeU) &&
          (isActivitySuspendedByAdmin(a) || a.proposalStatus === 'cambios_solicitados')
        )
        .map(a => Number(a.id))
        .filter(id => !isNaN(id) && id > 0);
      if (suspendedIds.length > 0) {
        setSeenSuspendedActIds(prev => {
          const next = Array.from(new Set([...prev, ...suspendedIds]));
          saveSeenSuspendedToStorage(next, activeU?.id);
          return next;
        });
        setSeenCancelledMisActividadesIds(prev => Array.from(new Set([...prev, ...suspendedIds])));
        api.markUserActivityAlertInSupabase(activeU?.id, 'seen_suspended_act', suspendedIds).catch(() => {});
      }
      const rejectedIds = currentActs
        .filter(a => isActivityOwnedByUser(a, activeU) && isProposalRejected(a))
        .map(a => Number(a.id))
        .filter(id => !isNaN(id) && id > 0);
      if (rejectedIds.length > 0) {
        setSeenRejectedProposalIds(prev => Array.from(new Set([...prev, ...rejectedIds])));
        api.markUserActivityAlertInSupabase(activeU?.id, 'seen_rejected_proposal', rejectedIds).catch(() => {});
      }
    }
    if (activeU && prevViewRef.current === 'agenda' && currentView !== 'agenda') {
      const userAgendaIds = new Set(
        (Array.isArray((activeU as any)?.agenda) ? (activeU as any).agenda : []).map((id: any) => String(id))
      );
      const alertIds = currentActs
        .filter(a =>
          isUserVettedFromActivity(a, activeU) ||
          ((isActivitySuspendedByAdmin(a) || isActivityCancelledByOrganizer(a)) &&
            (isUserEnrolledInActivity(a, activeU) || userAgendaIds.has(String(a.id))))
        )
        .map(a => Number(a.id))
        .filter(id => !isNaN(id) && id > 0);
      if (alertIds.length > 0) {
        setSeenCancelledAgendaActIds(prev => Array.from(new Set([...prev, ...alertIds])));
        api.markUserActivityAlertInSupabase(activeU?.id, 'seen_agenda_cancelled', alertIds).catch(() => {});
      }
    }
    prevViewRef.current = currentView;
  }, [currentView]);

  // Scroll handler to detect when user intentionally scrolls up to read earlier messages
  function handleChatContainerScroll() {
    const container = chatMessagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // Si el usuario está a más de 80px del final, marcamos que está leyendo historial
    isUserScrolledUpChatRef.current = distanceFromBottom > 80;
  }

  // Auto-scroll inteligente del chat:
  // 1. Al abrir o cambiar de chat (activeChatId), va directo al final.
  // 2. Si llega un mensaje nuevo y el usuario está abajo (o si el mensaje es propio), baja al final.
  // 3. NUNCA baja abruptamente si el usuario subió la barra para leer mensajes anteriores, ni durante el refresco cada 5s.
  useEffect(() => {
    if (!activeChatId || !chatMessagesContainerRef.current) return;
    const container = chatMessagesContainerRef.current;

    const currentChat = chats.find(c => 
      String(c.id) === String(activeChatId) || 
      (c.activityId && String(c.activityId) === String(activeChatId))
    );
    const msgs = currentChat?.messages || [];
    const currentCount = msgs.length;
    const prevCount = prevChatMsgCountRef.current;
    const isNewChat = prevActiveChatIdRef.current !== activeChatId;

    if (isNewChat) {
      prevActiveChatIdRef.current = activeChatId;
      prevChatMsgCountRef.current = currentCount;
      isUserScrolledUpChatRef.current = false;
      requestAnimationFrame(() => {
        if (chatMessagesContainerRef.current) {
          chatMessagesContainerRef.current.scrollTop = chatMessagesContainerRef.current.scrollHeight;
        }
      });
      return;
    }

    if (currentCount > prevCount) {
      const lastMsg = msgs[msgs.length - 1];
      const uAny = currentUser as any;
      const myTokens = currentUser ? [
        currentUser.id,
        currentUser.usuario,
        currentUser.apodo,
        currentUser.nombre,
        uAny?.institucion,
        uAny?.nombreCompleto
      ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim()) : [];

      const lastSenderTokens = [
        lastMsg?.sender,
        lastMsg?.senderId,
        (lastMsg as any)?.sender_id,
        (lastMsg as any)?.userId,
        (lastMsg as any)?.user_id
      ].filter(Boolean).map(t => String(t).toLowerCase().trim());
      const isMyMessage = Boolean(currentUser && lastSenderTokens.some(tok => myTokens.includes(tok)));

      if (isMyMessage || !isUserScrolledUpChatRef.current) {
        isUserScrolledUpChatRef.current = false;
        requestAnimationFrame(() => {
          if (chatMessagesContainerRef.current) {
            chatMessagesContainerRef.current.scrollTop = chatMessagesContainerRef.current.scrollHeight;
          }
        });
      }
    }

    prevChatMsgCountRef.current = currentCount;
  }, [chats, activeChatId, currentUser]);


  // Close message options menu when clicking outside
  useEffect(() => {
    function handleClickOutside() {
      if (messageMenuTimeoutRef.current) {
        clearTimeout(messageMenuTimeoutRef.current);
        messageMenuTimeoutRef.current = null;
      }
      setOpenMessageMenuId(null);
    }
    if (openMessageMenuId !== null) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [openMessageMenuId]);

  function applyAccessibility(size: 'normal' | 'grande' | 'gigante', contrast: boolean) {
    document.documentElement.classList.remove('text-size-grande', 'text-size-gigante', 'dark');
    document.body.classList.remove('text-size-grande', 'text-size-gigante', 'high-contrast');
    if (size === 'grande') {
      document.documentElement.classList.add('text-size-grande');
      document.body.classList.add('text-size-grande');
    }
    if (size === 'gigante') {
      document.documentElement.classList.add('text-size-gigante');
      document.body.classList.add('text-size-gigante');
    }
    if (contrast) {
      document.documentElement.classList.add('dark');
      document.body.classList.add('high-contrast');
    }
  }

  async function handleSetTextSize(size: 'normal' | 'grande' | 'gigante') {
    if (!currentUser) {
      setGuestTextSize(size);
      try {
        localStorage.setItem('club65_guest_text_size', size);
      } catch {}
      applyAccessibility(size, guestContrast);
      return;
    }
    try {
      const updated = await api.updateProfile({ textSize: size });
      setCurrentUser(updated);
      setGuestTextSize(updated.textSize || size);
      try {
        localStorage.setItem('club65_guest_text_size', updated.textSize || size);
      } catch {}
      applyAccessibility(updated.textSize || size, updated.contrast);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleToggleContrast() {
    if (!currentUser) {
      const next = !guestContrast;
      setGuestContrast(next);
      try {
        localStorage.setItem('club65_guest_contrast', String(next));
      } catch {}
      applyAccessibility(guestTextSize, next);
      return;
    }
    try {
      const next = !currentUser.contrast;
      const updated = await api.updateProfile({ contrast: next });
      setCurrentUser(updated);
      setGuestContrast(Boolean(updated.contrast));
      try {
        localStorage.setItem('club65_guest_contrast', String(Boolean(updated.contrast)));
      } catch {}
      applyAccessibility(updated.textSize, updated.contrast);
    } catch (e) {
      console.error(e);
    }
  }

  function getDismissedNoticesKey(uid?: string) {
    return `club65_dismissed_notices_${uid || 'anon'}`;
  }

  function getDismissedNoticesFromStorage(uid?: string): string[] {
    try {
      const raw = localStorage.getItem(getDismissedNoticesKey(uid));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveDismissedNoticeToStorage(noticeId: string, uid?: string) {
    try {
      const list = getDismissedNoticesFromStorage(uid);
      if (!list.includes(noticeId)) {
        list.push(noticeId);
        localStorage.setItem(getDismissedNoticesKey(uid), JSON.stringify(list));
      }
    } catch {}
  }

  function getSeenSuspendedKey(uid?: string) {
    return `club65_seen_suspended_${uid || 'anon'}`;
  }

  function getSeenSuspendedFromStorage(uid?: string): number[] {
    try {
      const raw = localStorage.getItem(getSeenSuspendedKey(uid));
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSeenSuspendedToStorage(actIds: number[], uid?: string) {
    try {
      const existing = getSeenSuspendedFromStorage(uid);
      const combined = Array.from(new Set([...existing, ...actIds]));
      localStorage.setItem(getSeenSuspendedKey(uid), JSON.stringify(combined));
    } catch {}
  }

  function filterDismissedNotices(noticesList: CancelledGroupNotice[], uid?: string): CancelledGroupNotice[] {
    const dismissed = getDismissedNoticesFromStorage(uid);
    return noticesList.filter(n => !dismissed.includes(n.id));
  }

  async function handleDismissCancelledNotice(noticeId: string) {
    saveDismissedNoticeToStorage(noticeId, currentUser?.id);
    setCancelledGroupNotices(prev => prev.filter(n => n.id !== noticeId));
    try {
      await api.dismissCancelledGroupNotice(noticeId, currentUser?.id);
    } catch (err) {
      console.error('Error dismissing notice:', err);
    }
  }

  async function refreshData(userOverride?: User | null) {
    (window as any).refreshData = refreshData;
    try {
      const activeUser = userOverride !== undefined ? userOverride : (currentUserRef.current || currentUser || await api.getMe().catch(() => null));
      const isModUser = Boolean(activeUser && (activeUser.tipo === 'moderador' || (activeUser as any).rol === 'moderador'));
      const [acts, chatsList, revs, conts, reps, insts, appInsts, bans, sancs, allUsers, bajas, notices] = await Promise.all([
        api.getActivities(true),
        activeUser?.id ? api.getChats(activeUser) : Promise.resolve([]),
        api.getReviews(true),
        activeUser?.id ? api.getContacts() : Promise.resolve([]),
        isModUser ? api.getReports() : Promise.resolve([]),
        isModUser ? api.getPendingInstitutions() : Promise.resolve([]),
        isModUser ? api.getApprovedInstitutions() : Promise.resolve([]),
        api.getBannedUsers(),
        api.getSanctions(),
        api.getUsers().catch(() => ({} as Record<string, User>)),
        api.getBajas().catch(() => []),
        activeUser?.id ? api.getCancelledGroupNotices(activeUser).catch(() => []) : Promise.resolve([])
      ]);
      try {
        localStorage.removeItem('deleted_chats_local');
        localStorage.removeItem('left_chats_local');
      } catch (_) {}
      setActivities(acts);
      setChats((prevChats: any[]) => {
        if (!activeUser?.id) return [];
        if (!chatsList || chatsList.length === 0) return [];
        const updated = chatsList.map((fc: any) => {
          const prevMatch = Array.isArray(prevChats) ? prevChats.find((p: any) => String(p.id) === String(fc.id)) : null;
          if (prevMatch && prevMatch.messages && prevMatch.messages.length > 0) {
            const mergedMsgs = deduplicateMessages([...(prevMatch.messages || []), ...(fc.messages || [])]);
            const filteredMsgs = filterChatMessagesForUser(mergedMsgs, fc.id, activeUser, { ...fc, messages: mergedMsgs });
            const pinnedMsg = getPinnedMessageFromList(filteredMsgs);
            const lastM = filteredMsgs[filteredMsgs.length - 1];
            return {
              ...fc,
              pinnedMessageId: fc.pinnedMessageId || (pinnedMsg ? String(pinnedMsg.id) : undefined),
              messages: filteredMsgs,
              lastMessage: lastM?.text || (filteredMsgs.length === 0 ? 'Sin mensajes' : fc.lastMessage),
              lastMessageTime: lastM?.time || fc.lastMessageTime
            };
          }
          return fc;
        });
        return deduplicateChats(updated);
      });
      setReviews(revs);
      setContacts(filterContactsForUser(conts, activeUser));
      setReports(reps);
      setPendingInstitutions(insts);
      setApprovedInstitutions(appInsts);
      setBannedUsersList(bans);
      setSanctionsList(sancs);
      const baseUsersMap = allUsers || {};
      if (userOverride !== undefined) {
        hydratedAvatarIdsRef.current.clear();
      }
      const neededAvatarIds = collectNeededAvatarUserIds({
        activities: acts,
        chats: chatsList,
        contacts: conts,
        reviews: revs,
        allUsersMap: baseUsersMap,
        currentUser: activeUser
      });
      let hydratedUsersMap = baseUsersMap;
      if (neededAvatarIds.length > 0) {
        neededAvatarIds.forEach(id => hydratedAvatarIdsRef.current.add(id));
        const avatarsById = await api.getUserAvatarsByIds(neededAvatarIds).catch(() => ({} as Record<string, string>));
        hydratedUsersMap = mergeAvatarsIntoUsersMap(baseUsersMap, avatarsById);
      }
      if (allUsers) setAllUsersMap(hydratedUsersMap);
      setBajasList(bajas);
      setCancelledGroupNotices(filterDismissedNotices(notices || [], activeUser?.id));
    } catch (e) {
      console.error(e);
    }
  }

  function getCandidateTokens(targetName?: string, optionalId?: string): string[] {
    const tokens = new Set<string>();
    if (targetName) {
      const clean = String(targetName).trim().toLowerCase().replace(/^@/, '');
      if (clean) tokens.add(clean);
    }
    if (optionalId) {
      const cleanId = String(optionalId).trim().toLowerCase();
      if (cleanId) {
        tokens.add(cleanId);
        tokens.add(cleanId.replace(/^u_/, ''));
        tokens.add(cleanId.replace(/^usr_/, ''));
      }
    }
    const searchKeys = Array.from(tokens);
    for (const key of searchKeys) {
      const u = allUsersMap[key] || Object.values(allUsersMap).find(user => 
        (user.id && user.id.toLowerCase() === key) ||
        (user.usuario && user.usuario.toLowerCase() === key) ||
        (user.apodo && user.apodo.toLowerCase() === key) ||
        (user.nombre && user.nombre.toLowerCase() === key)
      );
      if (u) {
        if (u.id) { tokens.add(u.id.toLowerCase()); tokens.add(u.id.toLowerCase().replace(/^u_/, '')); tokens.add(u.id.toLowerCase().replace(/^usr_/, '')); }
        if (u.usuario) tokens.add(u.usuario.toLowerCase());
        if (u.apodo) tokens.add(u.apodo.toLowerCase());
        if (u.nombre) tokens.add(u.nombre.toLowerCase());
      }
    }
    return Array.from(tokens);
  }

  function isUserBlocked(targetName?: string, optionalId?: string): boolean {
    return didIBlockUser(targetName, optionalId) || didOtherBlockMe(targetName, optionalId);
  }

  function didIBlockUser(targetName?: string, optionalId?: string): boolean {
    if (!targetName && !optionalId) return false;
    const candidates = getCandidateTokens(targetName, optionalId);
    const myBlocked = [
      ...(currentUser?.myBlockedUsers || []),
      ...(currentUser?.blockedUsers || []),
      ...((currentUser as any)?.blocked_users || [])
    ].map(u => String(u).toLowerCase().trim());
    return candidates.some(c => myBlocked.includes(c));
  }

  function didIBlockContact(contact?: Contact | { nombre?: string; id?: string } | null): boolean {
    if (!contact) return false;
    return didIBlockUser(contact.nombre, contact.id);
  }

  function didOtherBlockMe(targetName?: string, optionalId?: string): boolean {
    if (!targetName && !optionalId) return false;
    const candidates = getCandidateTokens(targetName, optionalId);

    // 1. Comprobar en lista de quiénes me bloquearon (desde el perfil del usuario actual)
    const blockedBy = (currentUser?.blockedByUsers || []).map(u => String(u).toLowerCase().trim());
    if (candidates.some(c => blockedBy.includes(c))) return true;

    // 2. Comprobar en tiempo real en allUsersMap: si el usuario objetivo tiene a currentUser en su lista blockedUsers
    const myTokens = currentUser ? [
      currentUser.id,
      currentUser.usuario,
      currentUser.apodo,
      currentUser.nombre
    ].filter(Boolean).map(t => String(t).toLowerCase().trim()) : [];

    if (myTokens.length > 0) {
      for (const cand of candidates) {
        const targetObj = allUsersMap[cand] || Object.values(allUsersMap).find((u: any) =>
          (u.id && u.id.toLowerCase() === cand) ||
          (u.usuario && u.usuario.toLowerCase() === cand) ||
          (u.apodo && u.apodo.toLowerCase() === cand) ||
          (u.nombre && u.nombre.toLowerCase() === cand)
        );
        if (targetObj) {
          const targetBlockedList = [
            ...(targetObj.blockedUsers || []),
            ...((targetObj as any).myBlockedUsers || []),
            ...((targetObj as any).blocked_users || [])
          ].map((b: any) => String(b).toLowerCase().trim());

          if (myTokens.some(tok => targetBlockedList.includes(tok))) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function getUserPhotoByName(name?: string): string | undefined {
    if (!name) return undefined;
    const clean = String(name).trim().toLowerCase().replace(/^@/, '');
    if (!clean) return undefined;

    // 1. Coincidencia con usuario de la sesión actual
    if (currentUser) {
      const myTokens = [
        currentUser.usuario,
        currentUser.apodo,
        currentUser.nombre,
        currentUser.id,
        (currentUser as any).institucion
      ].filter(Boolean).map(s => String(s).toLowerCase().trim());
      if (myTokens.includes(clean)) {
        const myPhoto = sanitizeProfileAvatar(currentUser.avatar || (currentUser as any).foto);
        if (myPhoto) return myPhoto;
      }
    }

    // 2. Coincidencia directa en el mapa de usuarios
    const directUser = allUsersMap[clean];
    const directPhoto = sanitizeProfileAvatar(directUser?.avatar || (directUser as any)?.foto || (directUser as any)?.image);
    if (directPhoto) return directPhoto;

    // 3. Búsqueda en todos los usuarios registrados
    for (const key of Object.keys(allUsersMap)) {
      const u: any = allUsersMap[key];
      if (!u) continue;
      const photo = sanitizeProfileAvatar(u.avatar || u.foto || u.image || u.photo_url || u.avatar_url);
      if (!photo) continue;

      const uTokens = [
        u.usuario,
        u.apodo,
        u.nombre,
        u.id,
        u.email,
        u.institucion
      ].filter(Boolean).map((s: any) => String(s).toLowerCase().trim());

      if (uTokens.includes(clean)) return photo;
    }

    // 4. Búsqueda en la agenda de contactos
    const foundContact: any = contacts.find(c => {
      const cAny = c as any;
      const cTokens = [cAny.nombre, cAny.id, cAny.usuario, cAny.apodo].filter(Boolean).map((s: any) => String(s).toLowerCase().trim());
      return cTokens.includes(clean);
    });
    if (foundContact) {
      const rawCPhoto = foundContact.foto || (foundContact.avatar && (String(foundContact.avatar).startsWith('data:') || String(foundContact.avatar).startsWith('http') || String(foundContact.avatar).startsWith('/')) ? foundContact.avatar : undefined);
      const cPhoto = sanitizeProfileAvatar(rawCPhoto);
      if (cPhoto) return cPhoto;
    }

    return undefined;
  }

  function getOrganizerApodo(act?: Activity | null): string {
    if (!act) return 'Organizador';

    // 1. Si la actividad es del usuario en sesión
    if (currentUser) {
      const isMine =
        (act.organizerId && String(act.organizerId) === String(currentUser.id)) ||
        (act.organizer && act.organizer.toLowerCase().trim() === currentUser.apodo?.toLowerCase().trim()) ||
        (act.organizer && act.organizer.toLowerCase().trim() === currentUser.usuario?.toLowerCase().trim());
      if (isMine) {
        return (currentUser as any)?.institucion || currentUser.apodo || currentUser.usuario || currentUser.nombre || 'Organizador';
      }
    }

    // 2. Buscar en allUsersMap por organizerId o tokens asociados
    const candidates = [
      act.organizerId,
      (act as any).userId,
      (act as any).createdById,
      (act as any).creador_id,
      act.organizer,
      (act as any).organizerNombre
    ].filter(Boolean).map(c => String(c).trim());

    for (const cand of candidates) {
      const match = allUsersMap[cand] || allUsersMap[cand.toLowerCase()];
      if (match) {
        const nick = match.apodo || match.usuario || match.nombre || (match as any).institucion;
        if (nick) return nick;
      }
    }

    // 3. Revisar si act.organizer o act.organizerNombre ya es un apodo legible (no un UUID ni ID tipo usr_...)
    const isIdLike = (str?: string) =>
      !str ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str.trim()) ||
      /^usr_/i.test(str.trim()) ||
      str === act.organizerId;

    if (act.organizer && !isIdLike(act.organizer)) {
      return act.organizer;
    }
    if ((act as any).organizerNombre && !isIdLike((act as any).organizerNombre)) {
      return (act as any).organizerNombre;
    }

    return act.isInstitutional ? 'Institución' : 'Organizador';
  }

  function resolveActivityOrganizerDisplay(act?: Activity | null): {
    organizerId: string;
    name: string;
    avatar: string | null;
    isInstitutional: boolean;
    bio?: string;
    location?: string;
  } {
    if (!act) {
      return { organizerId: '', name: 'Organizador', avatar: null, isInstitutional: false };
    }

    const resolved = resolveRealOrganizerDisplay(act, currentUser, allUsersMap);
    const fallbackAvatar =
      resolved.avatar ||
      getUserPhotoByName(resolved.organizerId) ||
      getUserPhotoByName(resolved.name) ||
      getUserPhotoByName(act.organizerId) ||
      getUserPhotoByName(act.organizer);

    return {
      organizerId: resolved.organizerId,
      name: resolved.name || getOrganizerApodo(act),
      avatar: sanitizeProfileAvatar(fallbackAvatar),
      isInstitutional: resolved.isInstitutional,
      bio: resolved.bio,
      location: resolved.location
    };
  }

function getChatDisplayTitle(chat: any, current?: any): string {
  if (!chat) return 'Chat';

  if (chat.type === 'grupal' && chat.title) {
    return chat.title;
  }

  return getPrivateChatResolvedTitle(chat, current || currentUser, allUsersMap, contacts);
}

  function getChatDisplayPhoto(chat: Chat): string | undefined {
    const directPhoto = sanitizeProfileAvatar(chat.image || chat.avatar);
    if (directPhoto) return directPhoto;

    if (chat.type === 'privado') {
      const myTokens = currentUser
        ? [
            currentUser.id,
            currentUser.usuario,
            currentUser.apodo,
            currentUser.nombre
          ]
            .filter(Boolean)
            .map(t => String(t).toLowerCase().trim())
        : [];

      const otherPartId = Array.isArray((chat as any).participantIds)
        ? (chat as any).participantIds.find((pid: string) => pid && !myTokens.includes(String(pid).toLowerCase().trim()))
        : undefined;
      if (otherPartId) {
        const byIdPhoto = getUserPhotoByName(otherPartId);
        if (byIdPhoto) return byIdPhoto;
      }

      const otherPartToken = Array.isArray(chat.participants)
        ? chat.participants.find((p: string) => p && !myTokens.includes(String(p).toLowerCase().trim()))
        : undefined;
      if (otherPartToken) {
        const byPartPhoto = getUserPhotoByName(otherPartToken);
        if (byPartPhoto) return byPartPhoto;
      }

      const displayTitle = getChatDisplayTitle(chat, currentUser);
      return getUserPhotoByName(displayTitle);
    }

    if (chat.type === 'grupal') {
      const linkedAct = resolveActivityForChat(chat, activities);
      const actImg = sanitizeProfileAvatar(linkedAct?.image);
      if (actImg) return actImg;
    }

    return undefined;
  }

  async function handleAddParticipantToGroup(participantName: string) {
    if (!activeChatId) return;
    if (isModifyingParticipant) return;
    if (isSelfUserOrContact(participantName, currentUser)) {
      showToast('No podés agregarte a vos misma al grupo.');
      return;
    }
    setIsModifyingParticipant(participantName);
    try {
      const targetChat = chats.find(c => String(c.id) === String(activeChatId) || (c.activityId && String(c.activityId) === String(activeChatId)));
      const actId = targetChat?.activityId;

      // Recopilar todos los tokens identificadores del participante
      const targetTokens = new Set<string>();
      targetTokens.add(participantName.trim());
      targetTokens.add(participantName.trim().toLowerCase());

      const foundUser = Object.values(allUsersMap).find(u =>
        u && [u.id, u.usuario, u.apodo, (u as any).supabaseId].filter(Boolean).some(
          t => String(t).trim().toLowerCase() === participantName.trim().toLowerCase()
        )
      );
      if (isAdministratorUser(foundUser) || isUserAdminByReference(participantName, allUsersMap)) {
        showToast('Los usuarios administradores no pueden formar parte de ningún grupo.');
        return;
      }
      if (foundUser) {
        [foundUser.id, foundUser.usuario, foundUser.apodo, (foundUser as any).supabaseId].filter(Boolean).forEach(t => {
          targetTokens.add(String(t).trim());
          targetTokens.add(String(t).trim().toLowerCase());
        });
      }
      const foundContact = contacts.find(ct =>
        ct && (ct.id === participantName || ct.nombre.toLowerCase().trim() === participantName.toLowerCase().trim())
      );
      if (foundContact && isUserAdminByReference(foundContact, allUsersMap)) {
        showToast('Los usuarios administradores no pueden formar parte de ningún grupo.');
        return;
      }
      if (foundContact) {
        [foundContact.id, foundContact.nombre].filter(Boolean).forEach(t => {
          targetTokens.add(String(t).trim());
          targetTokens.add(String(t).trim().toLowerCase());
        });
      }

      setChats(prev => prev.map(c => {
        if (c.id === activeChatId || String(c.id) === String(activeChatId) || (actId && (String(c.id) === String(actId) || String(c.activityId) === String(actId)))) {
          const currentParts = Array.isArray(c.participants) ? c.participants : [];
          const curRemoved = Array.isArray(c.removedParticipants) ? c.removedParticipants : [];
          const curLeft = Array.isArray(c.leftVoluntarilyParticipants) ? c.leftVoluntarilyParticipants : [];
          const curVetted = Array.isArray(c.vetoedParticipants) ? c.vetoedParticipants : [];
          const isAlreadyIn = currentParts.some(p => targetTokens.has(String(p).toLowerCase().trim()) || targetTokens.has(String(p).trim()));
          const updatedParts = isAlreadyIn
            ? currentParts
            : [...currentParts, participantName];
          const curAdmins = Array.isArray(c.adminUsernames) ? c.adminUsernames : [];
          const linkedAct = activities.find(a =>
            (c.activityId && String(a.id) === String(c.activityId)) ||
            (actId && (String(a.id) === String(actId) || Number(a.id) === Number(actId))) ||
            (a.title && c.name && a.title.trim().toLowerCase() === String(c.name).trim().toLowerCase())
          );
          const rawGroupName = linkedAct?.title || c.name || c.title || 'la actividad';
          const cleanGroupName = rawGroupName.replace(/^Grupo:\s*/i, '').trim();
          const isActGroup = Boolean(c.activityId || actId || linkedAct);

          const sysAddMsg = {
            id: `sys_add_${Date.now()}`,
            role: 'sistema',
            senderId: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: '👋',
            text: isActGroup
              ? `¡Bienvenido a ${cleanGroupName}, ${participantName}!`
              : `${participantName} fue agregado al grupo por el moderador del grupo.`,
            time: 'Ahora',
            timestamp: Date.now(),
            replyTo: {
              event: 'participant_added',
              participant: participantName,
              participantTokens: Array.from(targetTokens)
            }
          };
          const curMsgs = Array.isArray(c.messages) ? c.messages : [];
          return {
            ...c,
            participants: updatedParts,
            adminUsernames: curAdmins.filter(a => !targetTokens.has(String(a).toLowerCase().trim()) && !targetTokens.has(String(a).trim())),
            removedParticipants: curRemoved.filter(p => !targetTokens.has(String(p).toLowerCase().trim()) && !targetTokens.has(String(p).trim())),
            leftVoluntarilyParticipants: curLeft.filter(p => !targetTokens.has(String(p).toLowerCase().trim()) && !targetTokens.has(String(p).trim())),
            vetoedParticipants: curVetted.filter(p => !targetTokens.has(String(p).toLowerCase().trim()) && !targetTokens.has(String(p).trim())),
            messages: [...curMsgs, sysAddMsg as any]
          };
        }
        return c;
      }));

      if (actId) {
        setActivities(prev => prev.map(a => {
          if (String(a.id) === String(actId) || Number(a.id) === Number(actId)) {
            const currentEnrolled = Array.isArray(a.enrolledUsernames) ? a.enrolledUsernames : [];
            const isAlreadyEnrolled = currentEnrolled.some(u => targetTokens.has(String(u).trim().toLowerCase()));
            const updatedEnrolled = isAlreadyEnrolled
              ? currentEnrolled
              : [...currentEnrolled, participantName];
            const currentVetted = Array.isArray(a.vettedUsers) ? a.vettedUsers : [];
            const updatedVetted = currentVetted.filter(u => !targetTokens.has(String(u).trim().toLowerCase()));
            return {
              ...a,
              enrolledUsernames: updatedEnrolled,
              enrolledCount: updatedEnrolled.length,
              vettedUsers: updatedVetted
            };
          }
          return a;
        }));
      }

      await api.addChatParticipant(activeChatId, participantName, actId || undefined, Array.from(targetTokens));
      await refreshData();
      showToast(`¡${participantName} fue agregado al grupo con éxito!`);
    } catch (err: any) {
      showToast(err.message || 'Error al agregar participante al grupo.');
    } finally {
      setIsModifyingParticipant(null);
    }
  }

  async function openUserProfileByName(username?: string, optionalId?: string) {
    if (!username && !optionalId) return;
    const clean = (username || '').replace(/^@/, '').trim();
    const cleanId = (optionalId || '').trim();
    if (!clean && !cleanId) return;

    const cleanLower = clean.toLowerCase();
    const cleanIdLower = cleanId.toLowerCase();

    // 1. Coincidencia con usuario de la sesión actual
    if (currentUser && (
      (cleanId && String(currentUser.id).toLowerCase() === cleanIdLower) ||
      (clean && (
        (currentUser.usuario && cleanLower === currentUser.usuario.toLowerCase()) ||
        (currentUser.apodo && cleanLower === currentUser.apodo.toLowerCase()) ||
        (currentUser.nombre && cleanLower === currentUser.nombre.toLowerCase()) ||
        (currentUser.id && cleanLower === String(currentUser.id).toLowerCase())
      ))
    )) {
      const isMod = currentUser.tipo === 'moderador';
      const isInst = currentUser.tipo === 'institucional';
      setModalPerfilContacto({
        id: currentUser.id,
        nombre: currentUser.apodo || currentUser.nombre || currentUser.usuario,
        detalle: isMod ? 'Equipo de Moderación • Tu Perfil' : `${currentUser.localidad ? `${currentUser.localidad} • ` : ''}${isInst ? 'Institución • Tu Perfil' : 'Tu Perfil'}`,
        avatar: (currentUser.apodo || currentUser.nombre || 'YO').slice(0, 2).toUpperCase(),
        avatarClass: isMod ? 'bg-purple-600 text-white' : isInst ? 'bg-club-blue text-white' : 'bg-club-orange text-white',
        bio: sanitizeProfileBio(currentUser.bio) || (isMod ? 'Equipo oficial de moderación de CLUB65.' : ''),
        foto: sanitizeProfileAvatar(currentUser.avatar || (currentUser as any).foto) || '',
        tipo: currentUser.tipo,
        rol: currentUser.tipo
      });
      return;
    }

    // 2. Búsqueda en allUsersMap (priorizando id si está disponible)
    let userInMap: User | undefined = undefined;
    if (cleanIdLower) {
      userInMap = allUsersMap[cleanIdLower] || Object.values(allUsersMap).find(u => u && u.id && String(u.id).toLowerCase() === cleanIdLower);
    }
    if (!userInMap && cleanLower) {
      userInMap = allUsersMap[cleanLower] ||
        Object.values(allUsersMap).find(u =>
          u && (
            (u.usuario && u.usuario.toLowerCase() === cleanLower) ||
            (u.apodo && u.apodo.toLowerCase() === cleanLower) ||
            (u.nombre && u.nombre.toLowerCase() === cleanLower) ||
            (u.id && String(u.id).toLowerCase() === cleanLower)
          )
        );
    }

    const foundContact = contacts.find(c =>
      (cleanIdLower && c.id && c.id.toLowerCase() === cleanIdLower) ||
      (cleanLower && (
        (c.nombre && c.nombre.toLowerCase() === cleanLower) ||
        (c.id && c.id.toLowerCase() === cleanLower)
      ))
    );

    if (userInMap) {
      const realNick = userInMap.apodo || userInMap.usuario || userInMap.nombre || clean;
      const isMod = userInMap.tipo === 'moderador' || (userInMap as any).rol === 'moderador';
      const isInst = userInMap.tipo === 'institucional' || (userInMap as any).rol === 'institucional';
      const realPhoto = sanitizeProfileAvatar(userInMap.avatar || (userInMap as any).foto || (userInMap as any).image || foundContact?.foto || getUserPhotoByName(clean));
      const realBio = sanitizeProfileBio(userInMap.bio) || (isMod ? 'Equipo oficial de moderación y administración de CLUB65.' : (foundContact ? sanitizeProfileBio(foundContact.bio) || '' : ''));

      const targetModalId = userInMap.id || cleanId || `u_${clean}`;
      setModalPerfilContacto({
        id: targetModalId,
        nombre: realNick,
        detalle: isMod ? 'Equipo de Moderación • CLUB65' : `${userInMap.localidad ? `${userInMap.localidad} • ` : ''}${isInst ? 'Institución' : 'Miembro de CLUB65'}`,
        avatar: (realNick || 'CL').slice(0, 2).toUpperCase(),
        avatarClass: isMod ? 'bg-purple-600 text-white' : isInst ? 'bg-club-blue text-white' : 'bg-club-orange text-white',
        bio: realBio,
        foto: realPhoto || '',
        tipo: isMod ? 'moderador' : (isInst ? 'institucional' : 'personal'),
        rol: isMod ? 'moderador' : (isInst ? 'institucional' : 'personal')
      });
      if (!realPhoto && userInMap.id) {
        api.getUserAvatarById(String(userInMap.id)).then((fetchedAvatar) => {
          if (!fetchedAvatar) return;
          setModalPerfilContacto((prev: any) =>
            prev && String(prev.id) === String(targetModalId) ? { ...prev, foto: fetchedAvatar } : prev
          );
          setAllUsersMap((prev) => {
            const keyId = String(userInMap.id);
            const existing = prev[keyId];
            if (!existing) return prev;
            const enriched = { ...existing, avatar: fetchedAvatar };
            return {
              ...prev,
              [keyId]: enriched,
              [keyId.toLowerCase()]: enriched,
              ...(existing.usuario ? { [existing.usuario.toLowerCase().trim()]: enriched } : {}),
              ...(existing.apodo ? { [existing.apodo.toLowerCase().trim()]: enriched } : {})
            };
          });
        }).catch(() => {});
      }
      return;
    }

    try {
      const serverUser = await api.getUserProfile(cleanId || clean);
      if (serverUser) {
        const isMod = serverUser.tipo === 'moderador' || (serverUser as any).rol === 'moderador';
        const isInst = serverUser.tipo === 'institucional' || (serverUser as any).rol === 'institucional';
        const realPhoto = sanitizeProfileAvatar(serverUser.avatar || (serverUser as any).foto || foundContact?.foto || getUserPhotoByName(clean));
        const realBio = sanitizeProfileBio(serverUser.bio) || (isMod ? 'Equipo oficial de moderación y administración de CLUB65.' : (foundContact ? sanitizeProfileBio(foundContact.bio) || '' : ''));

        setModalPerfilContacto({
          id: serverUser.id || cleanId || `u_${clean}`,
          nombre: serverUser.apodo || clean,
          detalle: isMod ? 'Equipo de Moderación • CLUB65' : `${serverUser.localidad ? `${serverUser.localidad} • ` : ''}${isInst ? 'Institución' : 'Miembro de CLUB65'}`,
          avatar: (serverUser.apodo || clean).slice(0, 2).toUpperCase(),
          avatarClass: isMod ? 'bg-purple-600 text-white' : isInst ? 'bg-club-blue text-white' : 'bg-club-orange text-white',
          bio: realBio,
          foto: realPhoto || '',
          tipo: isMod ? 'moderador' : (isInst ? 'institucional' : 'personal'),
          rol: isMod ? 'moderador' : (isInst ? 'institucional' : 'personal')
        });
        return;
      }
    } catch {
      // fallback
    }

    if (foundContact) {
      setModalPerfilContacto({
        ...foundContact,
        bio: sanitizeProfileBio(foundContact.bio) || '',
        foto: sanitizeProfileAvatar(foundContact.foto) || ''
      });
    } else {
      setModalPerfilContacto({
        id: cleanId || `u_${clean}`,
        nombre: clean || 'Vecino',
        detalle: 'Vecino',
        avatar: (clean || 'VE').slice(0, 2).toUpperCase(),
        avatarClass: 'bg-club-orange text-white',
        bio: '',
        foto: ''
      });
    }
  }

  async function handleBlockUser(targetUsername: string, optionalId?: string) {
    try {
      await api.blockUser(targetUsername, optionalId);
      const cleanTokens = getCandidateTokens(targetUsername, optionalId);
      setCurrentUser(prev => {
        if (!prev) return null;
        const newBlocked = Array.from(new Set([...(prev.blockedUsers || []), ...cleanTokens]));
        const newMyBlocked = Array.from(new Set([...(prev.myBlockedUsers || []), ...cleanTokens]));
        const updated = {
          ...prev,
          blockedUsers: newBlocked,
          myBlockedUsers: newMyBlocked
        };
        try {
          localStorage.setItem('club65_user', JSON.stringify(updated));
        } catch {}
        return updated;
      });
      showToast(`Bloqueaste a ${targetUsername}`);
      const me = await api.getMe(true).catch(() => null);
      if (me) {
        setCurrentUser(me);
        try {
          localStorage.setItem('club65_user', JSON.stringify(me));
        } catch {}
      }
      await refreshData();
    } catch (err: any) {
      showToast(err.message || 'Error al bloquear usuario.');
    }
  }

  async function handleUnblockUser(targetUsername: string, optionalId?: string) {
    try {
      await api.unblockUser(targetUsername, optionalId);
      const cleanTokens = getCandidateTokens(targetUsername, optionalId);
      setCurrentUser(prev => {
        if (!prev) return null;
        const updated = {
          ...prev,
          blockedUsers: (prev.blockedUsers || []).filter(u => !cleanTokens.includes(u.toLowerCase())),
          myBlockedUsers: (prev.myBlockedUsers || []).filter(u => !cleanTokens.includes(u.toLowerCase()))
        };
        try {
          localStorage.setItem('club65_user', JSON.stringify(updated));
        } catch {}
        return updated;
      });
      showToast(`Desbloqueaste a ${targetUsername}`);
      const me = await api.getMe(true).catch(() => null);
      if (me) {
        setCurrentUser(me);
        try {
          localStorage.setItem('club65_user', JSON.stringify(me));
        } catch {}
      }
      await refreshData();
    } catch (err: any) {
      showToast(err.message || 'Error al desbloquear usuario.');
    }
  }

  async function resolveLoggedInActorId(): Promise<string | null> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) return session.user.id;
    } catch {}
    if (currentUser?.id) return currentUser.id;
    try {
      const restored = await api.getMe();
      if (restored?.id) {
        setCurrentUser(restored);
        return restored.id;
      }
    } catch {}
    return null;
  }

  async function openReportModal(data: {
    type: 'chat_message' | 'review_media' | 'review_text' | 'chat_general';
    chatId?: number | string;
    messageId?: string;
    messageText?: string;
    mediaUrl?: string;
    mediaUrls?: string[];
    reviewId?: number | string;
    activityId?: number | string;
    reportedUser?: string;
  }) {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión para enviar un reporte.');
      setModalLoginOpen(true);
      return;
    }
    setModalReporteData({
      isOpen: true,
      reason: 'Spam',
      comment: '',
      ...data
    });
  }

  async function handleSubmitReport(e: React.FormEvent) {
    e.preventDefault();
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión para enviar un reporte.');
      setModalLoginOpen(true);
      return;
    }
    if (!modalReporteData.reason) {
      showToast('Seleccioná un motivo para enviar el reporte.');
      return;
    }
    if (isSubmittingReport) return;

    setIsSubmittingReport(true);
    try {
      const res = await api.createReport({
        type: modalReporteData.type,
        chatId: modalReporteData.chatId,
        messageId: modalReporteData.messageId,
        messageText: modalReporteData.messageText,
        mediaUrl: modalReporteData.mediaUrl,
        mediaUrls: modalReporteData.mediaUrls,
        reviewId: modalReporteData.reviewId,
        activityId: modalReporteData.activityId,
        reportedUser: modalReporteData.reportedUser,
        reason: modalReporteData.reason,
        comment: modalReporteData.comment,
        reporterUserId: userId
      });

      // Show exact notification text required by user
      showToast(res.notificationMessage || 'Su reporte ha sido recibido, Te comunicaremos si detectamos que se incumplió una regla, así como las medidas que tomaremos al respecto');

      // If this report came from deleting a chat message, execute the deletion
      if (confirmDenounceMessage) {
        await api.deleteChatMessage(
          confirmDenounceMessage.chatId,
          confirmDenounceMessage.messageId,
          'Este mensaje fue retirado por el moderador del grupo.',
          false,
          confirmDenounceMessage.messageText
        );
        setConfirmDenounceMessage(null);
      }

      setModalReporteData({
        isOpen: false,
        type: 'chat_message',
        reason: 'Spam',
        comment: ''
      });
      await refreshData();
    } catch (err: any) {
      showToast(err.message || 'Error al enviar reporte');
      if (err?.code === 'AUTH_REQUIRED') {
        setModalLoginOpen(true);
      }
    } finally {
      setIsSubmittingReport(false);
    }
  }

  async function handleDeleteChatMessage(chatId: number | string, messageId: string) {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión para retirar mensajes.');
      setModalLoginOpen(true);
      return;
    }
    try {
      const removalNotice = 'Este mensaje fue retirado por el moderador del grupo.';

      // Guardar en localStorage para prevenir que reaparezca ante latencia de red
      try {
        const removedList = JSON.parse(localStorage.getItem('club65_removed_messages') || '[]');
        if (!removedList.includes(String(messageId))) {
          removedList.push(String(messageId));
          localStorage.setItem('club65_removed_messages', JSON.stringify(removedList));
        }
      } catch {}

      // 1. Marcar como retirado al instante en pantalla
      setChats(prev => prev.map(c => {
        if (c.id === chatId || String(c.id) === String(chatId)) {
          return {
            ...c,
            pinnedMessageId: String(c.pinnedMessageId || '') === String(messageId) ? undefined : c.pinnedMessageId,
            messages: (c.messages || []).map((m: any) =>
              String(m.id) === String(messageId)
                ? {
                    ...m,
                    isDeleted: true,
                    isPinned: false,
                    retirado: true,
                    deletedByAdmin: false,
                    deletedByGroupModerator: true,
                    text: removalNotice
                  }
                : m
            )
          };
        }
        return c;
      }));

      // 2. Notificar al backend y actualizar en Supabase
      await api.deleteChatMessage(chatId, messageId, removalNotice);
      showToast('Mensaje retirado correctamente.');
      await refreshData();
    } catch (err: any) {
      console.error(err);
      showToast(err?.message || 'Error al retirar mensaje.');
      await refreshData().catch(() => {});
    }
  }

  async function handleRemoveParticipant(participant: string) {
    if (!activeChatId) return;
    if (isModifyingParticipant) return;
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión para moderar participantes del grupo.');
      setModalLoginOpen(true);
      return;
    }
    setIsModifyingParticipant(participant);
    try {
      const targetChat = chats.find(c => String(c.id) === String(activeChatId) || (c.activityId && String(c.activityId) === String(activeChatId)));
      const actId = targetChat?.activityId;

      // Recopilar todos los tokens identificadores del participante
      const targetTokens = new Set<string>();
      targetTokens.add(participant.trim());
      targetTokens.add(participant.trim().toLowerCase());

      const foundUser = Object.values(allUsersMap).find(u =>
        u && [u.id, u.usuario, u.apodo, (u as any).supabaseId].filter(Boolean).some(
          t => String(t).trim().toLowerCase() === participant.trim().toLowerCase()
        )
      );
      if (foundUser) {
        [foundUser.id, foundUser.usuario, foundUser.apodo, (foundUser as any).supabaseId].filter(Boolean).forEach(t => {
          targetTokens.add(String(t).trim());
          targetTokens.add(String(t).trim().toLowerCase());
        });
      }
      const foundContact = contacts.find(ct =>
        ct && (ct.id === participant || ct.nombre.toLowerCase().trim() === participant.toLowerCase().trim())
      );
      if (foundContact) {
        [foundContact.id, foundContact.nombre].filter(Boolean).forEach(t => {
          targetTokens.add(String(t).trim());
          targetTokens.add(String(t).trim().toLowerCase());
        });
      }

      setChats(prev => prev.map(c => {
        if (c.id === activeChatId || String(c.id) === String(activeChatId) || (actId && (String(c.id) === String(actId) || String(c.activityId) === String(actId)))) {
          const currentParts = Array.isArray(c.participants) ? c.participants : [];
          const snapshotBeforeRemoval = [...currentParts];
          const curRemoved = Array.isArray(c.removedParticipants) ? c.removedParticipants : [];
          const curAdmins = Array.isArray(c.adminUsernames) ? c.adminUsernames : [];
          const snapshotMap: Record<string, string[]> = { ...(c.participantsSnapshotOnRemoval || {}) };
          if (snapshotBeforeRemoval.length > 0) {
            Array.from(targetTokens).forEach(tok => {
              if (!snapshotMap[tok] || snapshotMap[tok].length === 0) {
                snapshotMap[tok] = snapshotBeforeRemoval;
              }
            });
          }
          const sysRemMsg = {
            id: `sys_rem_${Date.now()}`,
            role: 'sistema',
            senderId: 'sistema',
            sender: 'Sistema CLUB65',
            avatar: '🛡️',
            text: `${participant} fue retirado del grupo por el moderador del grupo.`,
            time: 'Ahora',
            timestamp: Date.now(),
            replyTo: {
              event: 'participant_removed',
              participant: participant,
              participantTokens: Array.from(targetTokens),
              participantsSnapshot: snapshotBeforeRemoval
            }
          };
          const curMsgs = Array.isArray(c.messages) ? c.messages : [];
          return {
            ...c,
            participantsSnapshotOnRemoval: snapshotMap,
            participants: currentParts.filter(p => !targetTokens.has(String(p).toLowerCase().trim()) && !targetTokens.has(String(p).trim())),
            adminUsernames: curAdmins.filter(a => !targetTokens.has(String(a).toLowerCase().trim()) && !targetTokens.has(String(a).trim())),
            removedParticipants: Array.from(new Set([...curRemoved, ...Array.from(targetTokens)])),
            messages: [...curMsgs, sysRemMsg as any]
          };
        }
        return c;
      }));

      if (actId) {
        setActivities(prev => prev.map(a => {
          if (String(a.id) === String(actId) || Number(a.id) === Number(actId)) {
            const currentEnrolled = Array.isArray(a.enrolledUsernames) ? a.enrolledUsernames : [];
            const updatedEnrolled = currentEnrolled.filter(u => !targetTokens.has(String(u).trim().toLowerCase()));
            return {
              ...a,
              enrolledUsernames: updatedEnrolled,
              enrolledCount: updatedEnrolled.length
            };
          }
          return a;
        }));
      }

      await api.removeChatParticipant(activeChatId, participant, actId || undefined, Array.from(targetTokens));
      showToast(`Se retiró a ${participant} del grupo.`);
      await refreshData();
    } catch (err: any) {
      showToast(err?.message || 'Error al remover participante.');
    } finally {
      setIsModifyingParticipant(null);
    }
  }

  async function handleChangeChatPhoto(url: string) {
    if (!activeChatId || !url.trim()) return;
    const cleanUrl = url.trim();
    try {
      setChats(prev => prev.map(c => (c.id === activeChatId || String(c.id) === String(activeChatId)) ? { ...c, image: cleanUrl, avatar: cleanUrl } : c));
      await api.updateChatPhoto(activeChatId, cleanUrl);
      showToast('Foto del grupo actualizada con éxito.');
      setAdminChangePhotoInput('');
      await refreshData();
    } catch (err: any) {
      // Si la API falló por tamaño o headers pero el estado local se actualizó, avisamos amablemente
      console.error(err);
      showToast(err?.message || 'Foto actualizada en el grupo.');
      await refreshData().catch(() => {});
    }
  }

  async function handleMakeAdmin(
    participant: string,
    explicitChatId?: number | string | null,
    explicitActivityId?: number | string | null
  ) {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión para designar moderadores del grupo.');
      setModalLoginOpen(true);
      return;
    }

    const candidateChatId = explicitChatId ?? activeChat?.id ?? activeChatId;
    const rawChatId = candidateChatId !== undefined && candidateChatId !== null ? String(candidateChatId).trim() : '';

    if (!rawChatId || rawChatId === 'undefined' || rawChatId === 'null') {
      console.error('[handleMakeAdmin] chat_id inválido o no encontrado en el estado al intentar designar moderador:', {
        explicitChatId,
        activeChatId,
        activeChatIdFromState: activeChat?.id,
        participant
      });
      showToast('No se encontró un chat válido seleccionado. Volvé a abrir el grupo e intentá nuevamente.');
      return;
    }

    if (!participant || !String(participant).trim()) {
      console.warn('[handleMakeAdmin] Participante inválido o vacío:', { chatId: rawChatId, participant });
      return;
    }

    const targetChat = chats.find(
      c =>
        String(c.id) === rawChatId ||
        (c.activityId && String(c.activityId) === rawChatId) ||
        (explicitActivityId && c.activityId && String(c.activityId) === String(explicitActivityId))
    );
    const resolvedChatId: string | number = targetChat?.id ?? rawChatId;
    const resolvedActId: string | number | undefined = (explicitActivityId ?? targetChat?.activityId) ?? undefined;

    if (!targetChat) {
      console.warn('[handleMakeAdmin] El chat seleccionado no estaba indexado localmente por ID exacto; intentando resolver por ID/actividad:', {
        rawChatId,
        resolvedChatId,
        resolvedActId
      });
    }

    try {
      // 1. Encontrar todos los identificadores del participante si es posible
      const cleanLow = participant.toLowerCase().trim();
      const partObj = allUsersMap[cleanLow] ||
        Object.values(allUsersMap).find(u =>
          u.usuario?.toLowerCase() === cleanLow ||
          u.apodo?.toLowerCase() === cleanLow ||
          u.nombre?.toLowerCase() === cleanLow ||
          u.id?.toLowerCase() === cleanLow
        );
      const cleanParticipantName = partObj?.apodo || partObj?.nombre || partObj?.usuario || participant;
      const participantTokens = Array.from(new Set([
        participant,
        cleanParticipantName,
        partObj?.id,
        partObj?.usuario,
        partObj?.apodo,
        partObj?.nombre,
        (partObj as any)?.supabaseId
      ].filter(Boolean).map(t => String(t).trim())));

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const clientSysMsgId = `msg_adm_${nowMs}_${Math.random().toString(36).substring(2, 6)}`;
      const matchesTargetChat = (c: Chat) =>
        String(c.id) === String(resolvedChatId) ||
        String(c.id) === rawChatId ||
        (resolvedActId && (String(c.id) === String(resolvedActId) || String(c.activityId) === String(resolvedActId)));

      // Actualización optimista inmediata en la interfaz (adminUsernames + mensaje de sistema cronológico)
      setChats(prev => prev.map(c => {
        if (!matchesTargetChat(c)) return c;
        const currentAdmins = Array.isArray(c.adminUsernames) ? c.adminUsernames : [];
        const mergedAdmins = Array.from(new Set([...currentAdmins, ...participantTokens]));
        const optimisticReplyTo = {
          action: 'make_admin',
          adminUsernames: mergedAdmins,
          participant: cleanParticipantName,
          participantId: partObj?.id || cleanParticipantName,
          participantTokens
        };
        const optimisticSysMsg: any = {
          id: clientSysMsgId,
          chatId: c.id,
          senderId: 'sistema',
          sender: 'Sistema CLUB65',
          avatar: 'S',
          role: 'institucional',
          text: `Sistema CLUB65: ${cleanParticipantName} fue designado/a moderador/a del grupo.`,
          time: 'Ahora',
          createdAt: nowIso,
          timestamp: nowMs,
          replyTo: optimisticReplyTo,
          reply_to: optimisticReplyTo
        };
        const curMsgs = Array.isArray(c.messages) ? c.messages : [];
        return {
          ...c,
          adminUsernames: mergedAdmins,
          messages: curMsgs.some((m: any) => String(m.id) === clientSysMsgId) ? curMsgs : [...curMsgs, optimisticSysMsg]
        };
      }));

      // 2. Persistir en Supabase y notificar backend
      const updatedChat: any = await api.makeChatAdmin(resolvedChatId, participant, {
        activityId: resolvedActId,
        chatTitle: targetChat?.title || targetChat?.name || activeChat?.title,
        participantTokens,
        clientMessageId: clientSysMsgId
      });

      if (updatedChat) {
        setChats(prev => prev.map(c => {
          if (!matchesTargetChat(c)) return c;
          const nextAdmins = Array.from(new Set([
            ...(Array.isArray(c.adminUsernames) ? c.adminUsernames : []),
            ...(Array.isArray(updatedChat.adminUsernames) ? updatedChat.adminUsernames : [])
          ]));
          const curMsgs = Array.isArray(c.messages) ? c.messages : [];
          const sysMsg = updatedChat.systemMessage;
          const nextMsgs = sysMsg && !curMsgs.some((m: any) => String(m.id) === String(sysMsg.id))
            ? [...curMsgs, sysMsg]
            : curMsgs;
          return {
            ...c,
            adminUsernames: nextAdmins,
            messages: nextMsgs
          };
        }));
      }

      showToast(`¡${cleanParticipantName} ahora es moderador del grupo!`);
      await refreshData();
    } catch (err: any) {
      console.error('[handleMakeAdmin] Error al designar moderador del grupo:', err);
      const errorMsg = err?.message && !err.message.includes('administrador')
        ? err.message
        : 'No se pudo designar moderador del grupo.';
      showToast(errorMsg);
      await refreshData().catch(() => {});
    }
  }

  async function handleAdminModerateProposal(id: number, action: 'approve' | 'reject' | 'request_changes', note?: string) {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión con una cuenta de moderación autenticada para moderar propuestas.');
      setModalLoginOpen(true);
      return;
    }
    try {
      await api.moderateActivity(id, action, note);
      if (action === 'approve') {
        showToast('Propuesta aprobada y publicada en la Cartelera comunitaria.');
      } else if (action === 'request_changes') {
        showToast('Devolución enviada al vecino para que ajuste la propuesta.');
      } else {
        showToast('Propuesta rechazada y archivada.');
      }
      setModalSolicitarCambiosAct(null);
      setSolicitarCambiosNota('');
      await refreshData();
    } catch (err: any) {
      showToast(err.message || 'Error al procesar propuesta.');
    }
  }

  async function handleApproveInstitution(targetUserId: string) {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión con una cuenta de moderación autenticada para aprobar instituciones.');
      setModalLoginOpen(true);
      return;
    }
    try {
      const adminUsuario = (currentUser?.usuario || 'Administrador').replace(/^@/, '');
      const adminApodo = currentUser?.apodo || adminUsuario;
      const approvedInst = await api.approveInstitution(targetUserId, { apodo: adminApodo, usuario: adminUsuario });
      const instEmail = (approvedInst?.email || '').trim();
      const instName = approvedInst?.apodo || approvedInst?.usuario || 'Institución';

      if (instEmail) {
        try {
          await sendInstitutionalApprovalEmail({
            toEmail: instEmail,
            institutionName: instName
          });
          showToast('Institución dada de alta exitosamente en CLUB65 y correo de bienvenida enviado.');
        } catch (emailErr) {
          console.error('Error al enviar correo de aprobación institucional:', emailErr);
          showToast('Institución dada de alta en CLUB65, pero no se pudo enviar el correo de aviso.');
        }
      } else {
        showToast('Institución dada de alta exitosamente en CLUB65.');
      }
      await refreshData();
    } catch (err: any) {
      showToast(err.message || 'Error al dar de alta la institución.');
    }
  }

  function openModalRechazoInstitucion(inst: User) {
    setModalRechazoInstitucion(inst);
    setMotivoRechazoInstitucion('');
    setDetalleRechazoInstitucion('');
    setRechazoInstitucionError('');
  }

  async function handleConfirmarRechazoInstitucion(e: React.FormEvent) {
    e.preventDefault();
    if (!modalRechazoInstitucion) return;
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      setRechazoInstitucionError('Debés iniciar sesión con una cuenta de moderación autenticada.');
      return;
    }
    if (!motivoRechazoInstitucion.trim()) {
      setRechazoInstitucionError('Debés seleccionar un motivo específico de la lista para rechazar el alta.');
      return;
    }

    const motivoFinal = detalleRechazoInstitucion.trim()
      ? `${motivoRechazoInstitucion.trim()} (${detalleRechazoInstitucion.trim()})`
      : motivoRechazoInstitucion.trim();

    setRechazoInstitucionLoading(true);
    setRechazoInstitucionError('');
    try {
      const rejectedInst = await api.rejectInstitution(modalRechazoInstitucion.id, motivoFinal);
      const instEmail = (rejectedInst?.email || modalRechazoInstitucion.email || '').trim();
      const instName = rejectedInst?.apodo || modalRechazoInstitucion.apodo || rejectedInst?.usuario || 'Institución';

      if (instEmail) {
        try {
          await sendInstitutionalRejectionEmail({
            toEmail: instEmail,
            institutionName: instName,
            reason: motivoFinal
          });
          showToast('Solicitud rechazada y correo informativo enviado a la institución.');
        } catch (emailErr) {
          console.error('Error al enviar correo de rechazo institucional:', emailErr);
          showToast('Solicitud de alta rechazada, pero no se pudo enviar el correo informativo.');
        }
      } else {
        showToast('Solicitud de alta institucional rechazada.');
      }

      setModalRechazoInstitucion(null);
      setMotivoRechazoInstitucion('');
      setDetalleRechazoInstitucion('');
      await refreshData();
    } catch (err: any) {
      setRechazoInstitucionError(err.message || 'Error al rechazar alta institucional.');
    } finally {
      setRechazoInstitucionLoading(false);
    }
  }

  async function handlePromoteToAdmin() {
    const cleanIdentifier = normalizeAdminPromotionIdentifier(inputPromoverAdmin);
    if (!cleanIdentifier || isPromotingAdmin) return;
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      setPromoteAdminError('Debés iniciar sesión con una cuenta de moderación autenticada.');
      return;
    }
    setPromoteAdminError('');
    setIsPromotingAdmin(true);
    try {
      const updated = await api.promoteToAdmin(cleanIdentifier);
      showToast(`¡${updated.apodo || `@${updated.usuario}`} (@${updated.usuario}) ahora es Administrador oficial de CLUB65!`);
      setInputPromoverAdmin('');
      setPromoteAdminError('');
      setModalDesignarAdminOpen(false);
      await refreshData();
    } catch (err: any) {
      const msg = err?.message || 'Error al designar administrador.';
      setPromoteAdminError(msg);
      showToast(msg);
    } finally {
      setIsPromotingAdmin(false);
    }
  }

  function openModalBajaForzada(id: number, title: string) {
    setModalBajaActividad({ id, title });
    setMotivoBajaInput('');
  }

  async function handleConfirmarBajaForzada() {
    if (!modalBajaActividad) return;
    await handleDarDeBajaActividad(modalBajaActividad.id, motivoBajaInput);
  }
  async function handleLiftSanction(username: string) {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión con una cuenta de moderación autenticada para levantar sanciones.');
      setModalLoginOpen(true);
      return;
    }
    try {
      await api.removeSanction(username);
      showToast(`Sanción levantada para @${username}.`);
      await refreshData();
    } catch (err: any) {
      showToast(err.message || 'Error al levantar sanción.');
    }
  }

  async function handleConfirmReportDecision() {
    if (!modalDecisionReporte || isResolvingReport) return;
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión con una cuenta de moderación autenticada para dictar resoluciones.');
      setModalLoginOpen(true);
      return;
    }
    const { report, actionType, motive, comment, sanctionType, alsoDelete } = modalDecisionReporte;
    const cleanComment = comment && comment.trim() ? comment.trim() : '-';

    const removeReportedContent = async (persistToBackend: boolean) => {
      const isChatReport =
        report.type === 'chat_message' ||
        report.type === 'chat_general' ||
        Boolean(report.chatId || report.conversacionId);
      const isReviewMediaReport = report.type === 'review_media' && Boolean(report.mediaUrl);
      const isReviewTextReport =
        report.type === 'review_text' ||
        (!isChatReport && !isReviewMediaReport && Boolean(report.reviewId));

      if (isChatReport) {
        const msgId = String(report.messageId || report.mensajeId || report.targetId || '').trim();
        const rawChatId = String(report.chatId || report.conversacionId || report.actividadId || '').trim();
        const reportedText = String(
          report.messageText || report.content || report.mensaje || report.texto || ''
        ).trim();

        const targetChat = (chats || []).find((c: any) => {
          const msgs = Array.isArray(c.messages) ? c.messages : (Array.isArray(c.mensajes) ? c.mensajes : []);
          const hasMsg = msgs.some((m: any) =>
            (msgId && String(m.id).trim() === msgId) ||
            (reportedText && String(m.text || m.texto || m.content || m.mensaje || '').trim() === reportedText)
          );
          const chatBigId = chatIdentifierToBigInt(c.id);
          return (
            hasMsg ||
            (rawChatId && (
              String(c.id).trim() === rawChatId ||
              String(c.actividadId || c.activityId || '').trim() === rawChatId ||
              String(chatBigId) === rawChatId
            ))
          );
        });

        const effectiveChatId = targetChat ? targetChat.id : rawChatId;

        if (persistToBackend && (msgId || (effectiveChatId && reportedText))) {
          try {
            await api.deleteChatMessage(
              effectiveChatId || rawChatId,
              msgId,
              ADMIN_REMOVED_MESSAGE_TEXT,
              true,
              reportedText
            );
          } catch (err) {
            console.warn('Advertencia API deleteChatMessage:', err);
          }
        }

        // Persistir retiro local contra latencias de recarga
        try {
          const removedList = JSON.parse(localStorage.getItem('club65_removed_messages') || '[]');
          if (msgId && !removedList.includes(msgId)) removedList.push(msgId);
          else if (!msgId && reportedText && !removedList.includes(reportedText)) removedList.push(reportedText);
          localStorage.setItem('club65_removed_messages', JSON.stringify(removedList));
        } catch (_) {}

        setChats((prevChats: any[]) =>
          (prevChats || []).map((c: any) => {
            const msgs = Array.isArray(c.messages) ? c.messages : (Array.isArray(c.mensajes) ? c.mensajes : []);
            const chatBigId = chatIdentifierToBigInt(c.id);
            const hasTarget =
              (effectiveChatId && (String(c.id).trim() === String(effectiveChatId).trim() || String(chatBigId) === String(effectiveChatId).trim())) ||
              msgs.some((m: any) =>
                (msgId && String(m.id).trim() === msgId) ||
                (reportedText && String(m.text || m.content || m.mensaje || '').trim() === reportedText)
              );

            if (!hasTarget) return c;

            const updateMessageList = (lista: any[]) =>
              (lista || []).map((m: any) => {
                const match =
                  (msgId && String(m.id).trim() === msgId) ||
                  (reportedText && String(m.text || m.content || m.mensaje || '').trim() === reportedText);

                if (match) {
                  return {
                    ...m,
                    isDeleted: true,
                    isPinned: false,
                    deletedByAdmin: true,
                    deletedByGroupModerator: false,
                    eliminado: true,
                    retirado: true,
                    text: ADMIN_REMOVED_MESSAGE_TEXT,
                    texto: ADMIN_REMOVED_MESSAGE_TEXT,
                    content: ADMIN_REMOVED_MESSAGE_TEXT,
                    mensaje: ADMIN_REMOVED_MESSAGE_TEXT
                  };
                }
                return m;
              });

            const nextMessages = Array.isArray(c.messages) ? updateMessageList(c.messages) : c.messages;
            const nextMensajes = Array.isArray(c.mensajes) ? updateMessageList(c.mensajes) : c.mensajes;
            const unpin = msgId && String(c.pinnedMessageId || '') === msgId;

            return {
              ...c,
              ...(unpin ? { pinnedMessageId: undefined } : {}),
              ...(Array.isArray(c.messages) ? { messages: nextMessages } : {}),
              ...(Array.isArray(c.mensajes) ? { mensajes: nextMensajes } : {})
            };
          })
        );
      }

      if (isReviewMediaReport && report.mediaUrl) {
        const targetMediaUrl = String(report.mediaUrl).trim();
        let removalResult: { deletedReviewIds: (number | string)[]; updatedReviewIds: (number | string)[] } = {
          deletedReviewIds: [],
          updatedReviewIds: []
        };
        if (persistToBackend) {
          removalResult = await api.removeReportedReviewMedia(report.reviewId, targetMediaUrl, {
            activityId: report.activityId || report.actividadId,
            reportedUser: report.reportedUser || report.usuarioReportado
          });
        }

        setReviews(prev =>
          prev.map(rev => {
            const revMatches =
              (report.reviewId && String(rev.id) === String(report.reviewId)) ||
              removalResult.deletedReviewIds.some(id => String(id) === String(rev.id)) ||
              removalResult.updatedReviewIds.some(id => String(id) === String(rev.id)) ||
              (Array.isArray(rev.media) && rev.media.some(u => String(u).trim() === targetMediaUrl)) ||
              String(rev.foto || '').trim() === targetMediaUrl;
            if (!revMatches) return rev;
            const currentMedia = rev.media && rev.media.length > 0 ? rev.media : (rev.foto ? [rev.foto] : []);
            let nextMedia = replaceMediaUrlWithRetiredMarker(currentMedia, targetMediaUrl);
            if (currentMedia.length === 0) {
              nextMedia = [RETIRED_REVIEW_MEDIA_MARKER];
            } else if (
              report.reviewId &&
              String(rev.id) === String(report.reviewId) &&
              !currentMedia.some(u => String(u).trim() === targetMediaUrl) &&
              !nextMedia.some(u => isRetiredReviewMediaItem(u))
            ) {
              nextMedia = [RETIRED_REVIEW_MEDIA_MARKER, ...nextMedia];
            }
            const nextFoto = String(rev.foto || '').trim() === targetMediaUrl ? RETIRED_REVIEW_MEDIA_MARKER : rev.foto;
            return { ...rev, media: nextMedia, foto: nextFoto };
          })
        );

        setGaleriaItems(prev =>
          prev.map(item =>
            String(item.mediaUrl || '').trim() === targetMediaUrl
              ? { ...item, mediaUrl: RETIRED_REVIEW_MEDIA_MARKER }
              : item
          )
        );
      } else if (isReviewTextReport) {
        const revId = report.reviewId;
        const fallbackText = String(report.messageText || report.content || report.texto || '').trim();
        let retireResult: { retiredReviewIds: (number | string)[] } = { retiredReviewIds: [] };
        if (persistToBackend) {
          retireResult = await api.retireReviewByAdmin(revId || 0, {
            activityId: report.activityId || report.actividadId,
            text: fallbackText,
            reportedUser: report.reportedUser || report.usuarioReportado
          });
        }

        setReviews(prev =>
          prev.map(rev => {
            const matchById =
              (revId && String(rev.id) === String(revId)) ||
              retireResult.retiredReviewIds.some(id => String(id) === String(rev.id));
            const matchByFallback =
              !revId &&
              fallbackText &&
              String(rev.texto || '').trim() === fallbackText &&
              (!report.activityId || String(rev.actividadId) === String(report.activityId));
            if (!matchById && !matchByFallback) return rev;
            return {
              ...rev,
              retiradoDeLaVista: true,
              retirado_de_la_vista: true,
              deletedByAdmin: true,
              texto: ADMIN_REMOVED_REVIEW_TEXT,
              media: [],
              foto: null
            };
          })
        );
      }
    };

    setIsResolvingReport(true);
    try {
      let resolutionDetail = '';

      if (actionType === 'sancionar') {
        const targetUser = (report.reportedUser || report.usuarioReportado || '').replace(/^@+/, '').trim();
        let sancDesc = 'Suspensión preventiva';
        if (sanctionType === 'temporal_7') sancDesc = 'Suspensión temporal por 7 días';
        else if (sanctionType === 'temporal_30') sancDesc = 'Suspensión temporal por 30 días';
        else if (sanctionType === 'permanente') sancDesc = 'Veto permanente de la plataforma';

        const deletePart = alsoDelete ? ' y retiro de contenido reportado' : '';
        resolutionDetail = `${sancDesc} a @${targetUser || 'usuario'}${deletePart}`;

        await api.resolveReport(
          report.id,
          'ban_user',
          cleanComment,
          'sancionar',
          motive,
          cleanComment,
          sanctionType,
          alsoDelete,
          resolutionDetail
        );

        if (targetUser) {
          await api.addSanction({
            username: targetUser,
            reason: motive,
            comment: cleanComment,
            type: sanctionType,
            reportId: report.id
          });
        }

        if (alsoDelete) {
          await removeReportedContent(true);
        }

        showToast(`Usuario @${targetUser || 'denunciado'} sancionado y notificación enviada al denunciante.`);
      } else if (actionType === 'eliminar') {
        resolutionDetail = 'Retiro del contenido reportado de la plataforma';
        await api.resolveReport(
          report.id,
          'delete_content',
          cleanComment,
          'eliminar',
          motive,
          cleanComment,
          undefined,
          true,
          resolutionDetail
        );

        await removeReportedContent(true);

        showToast('Contenido retirado y notificación enviada al denunciante.');
      } else {
        resolutionDetail = 'Caso desestimado al no evidenciar infracciones mayores a las normas comunitarias';
        await api.resolveReport(
          report.id,
          'dismiss',
          cleanComment,
          'desestimar',
          motive,
          cleanComment,
          undefined,
          false,
          resolutionDetail
        );
        showToast('Reporte desestimado.');
      }

      // 1. Cerrar el modal
      setModalDecisionReporte(null);

      // 2. Sincronizar desde Supabase para mover el reporte a Historial y actualizar sanciones/contenidos
      await refreshData();

      // 3. Re-aplicar guard en memoria para evitar desfases visuales inmediatos
      if (actionType === 'eliminar' || (actionType === 'sancionar' && alsoDelete)) {
        await removeReportedContent(false);
      }
    } catch (err: any) {
      showToast(err.message || 'Error al procesar resolución de reporte.');
    } finally {
      setIsResolvingReport(false);
    }
  }
  async function handleLiftBan(identifier: string) {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión con una cuenta de moderación autenticada para levantar sanciones.');
      setModalLoginOpen(true);
      return;
    }
    try {
      await api.unbanUserGlobal(identifier);
      showToast(`Sanción levantada para ${identifier}.`);
      await refreshData();
    } catch (err: any) {
      showToast(err.message || 'Error al levantar sanción.');
    }
  }

  // Login handler
  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError('');
    try {
      const user = await api.login(loginForm.usuario, loginForm.clave);
      setCurrentUser(user);
      setProfileForm({ apodo: user.apodo, bio: user.bio, contactoEmergencia: user.contactoEmergencia || '', avatar: user.avatar || '' });
      setGuestTextSize(user.textSize || 'normal');
      setGuestContrast(Boolean(user.contrast));
      try {
        localStorage.setItem('club65_guest_text_size', user.textSize || 'normal');
        localStorage.setItem('club65_guest_contrast', String(Boolean(user.contrast)));
      } catch {}
      applyAccessibility(user.textSize, user.contrast);
      setModalLoginOpen(false);
      setLoginForm({ usuario: '', clave: '' });
      try {
        const alerts = await api.getUserActivityAlertsState(user.id);
        setSeenSuspendedActIds(alerts.seenSuspendedIds);
        setSeenCancelledMisActividadesIds(alerts.seenSuspendedIds);
        setSeenCancelledAgendaActIds(alerts.seenAgendaCancelledIds);
        setDismissedCancelledAgendaActIds(alerts.dismissedAgendaCancelledIds);
        setSeenRejectedProposalIds(alerts.seenRejectedProposalIds);
        setDismissedRejectedProposalIds(alerts.dismissedRejectedProposalIds);
      } catch (_) {}
      await refreshData(user);
      setCurrentView(user.tipo === 'moderador' ? 'moderacion' : 'explorar');
    } catch (err: any) {
      setLoginError(err.message || 'Error al iniciar sesión.');
    }
  }

  // Forgot password handlers
  async function handleForgotPasswordSubmitEmail(e: React.FormEvent) {
    e.preventDefault();
    setForgotError('');
    setForgotSuccessMsg('');
    if (!forgotEmail.trim()) {
      setForgotError('Por favor ingresá tu correo electrónico.');
      return;
    }
    setForgotLoading(true);
    try {
      const res = await api.forgotPassword(forgotEmail.trim());
      setForgotUserFound({ usuario: res.usuario, apodo: res.apodo, email: res.email });
      setForgotCode('');
      setForgotStep('code');
      setForgotSuccessMsg(res.message);
      showToast('Código de confirmación enviado a tu correo.');
    } catch (err: any) {
      setForgotError(err.message || 'No se encontró ninguna cuenta con este correo.');
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleVerifyResetCode(e: React.FormEvent) {
    e.preventDefault();
    setForgotError('');
    if (!forgotCode.trim()) {
      setForgotError('Ingresá el código de 6 dígitos enviado a tu correo.');
      return;
    }
    setForgotLoading(true);
    try {
      const res = await api.verifyResetCode(forgotEmail.trim(), forgotCode.trim());
      setForgotResetToken(res.token);
      setForgotStep('password');
      setForgotSuccessMsg('Código verificado con éxito. Ya podés crear tu nueva contraseña.');
      showToast('Identidad confirmada desde el correo.');
    } catch (err: any) {
      setForgotError(err.message || 'El código ingresado es incorrecto o ha expirado.');
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleResendResetCode() {
    setForgotError('');
    setForgotLoading(true);
    try {
      const res = await api.resendResetCode(forgotEmail.trim());
      setForgotCode('');
      setForgotSuccessMsg(`Se reenvió un nuevo código de confirmación a ${res.email}.`);
      showToast('Nuevo código enviado a tu correo.');
    } catch (err: any) {
      setForgotError(err.message || 'No se pudo reenviar el código.');
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleSoporteSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSoporteError('');
    setSoporteEnviadoMsg('');

    const senderEmail = (currentUser?.email || soporteEmailInvitado).trim();
    const senderName = currentUser
      ? `${currentUser.apodo || currentUser.nombre || currentUser.usuario}${currentUser.usuario ? ` (@${currentUser.usuario})` : ''}`
      : 'Invitado (sin sesión)';

    if (!senderEmail) {
      setSoporteError('Por favor ingresá tu correo electrónico para que podamos responderte.');
      return;
    }
    if (!soporteMensaje.trim()) {
      setSoporteError('Por favor escribí tu consulta antes de enviar el mensaje.');
      return;
    }

    setSoporteEnviando(true);
    try {
      await sendSupportEmail({
        senderName,
        senderEmail,
        subject: soporteAsunto,
        message: soporteMensaje
      });
      setSoporteEnviadoMsg('¡Mensaje enviado correctamente al equipo de CLUB65! Te responderemos a tu correo a la brevedad.');
      showToast('¡Mensaje enviado al equipo de soporte! Te responderemos a la brevedad.');
      setSoporteMensaje('');
      setSoporteAsunto(SOPORTE_ASUNTOS[0]);
      if (!currentUser?.email) {
        setSoporteEmailInvitado('');
      }
    } catch (err) {
      console.error('Error al enviar mensaje de soporte por EmailJS:', err);
      setSoporteError('No pudimos enviar tu mensaje en este momento. Por favor intentá nuevamente en unos minutos.');
    } finally {
      setSoporteEnviando(false);
    }
  }

  async function handleResetPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setForgotError('');
    if (!forgotNewPassword || forgotNewPassword.length < 3) {
      setForgotError('La nueva contraseña debe tener al menos 3 caracteres.');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      setForgotError('Las contraseñas no coinciden.');
      return;
    }
    if (!forgotResetToken) {
      setForgotError('Operación no permitida: Debes confirmar el código recibido por correo antes de cambiar tu contraseña.');
      setForgotStep('code');
      return;
    }
    setForgotLoading(true);
    try {
      const res = await api.resetPassword(forgotEmail.trim(), forgotResetToken, forgotNewPassword.trim());
      setForgotStep('success');
      showToast('¡Contraseña restablecida con éxito!');
      setLoginForm({ usuario: res.user.usuario, clave: '' });
    } catch (err: any) {
      setForgotError(err.message || 'Error al restablecer contraseña.');
    } finally {
      setForgotLoading(false);
    }
  }

  // Quick demo login
  async function quickLogin(usuario: string, clave: string) {
    setLoginError('');
    try {
      const user = await api.login(usuario, clave);
      setCurrentUser(user);
      setProfileForm({ apodo: user.apodo, bio: user.bio, contactoEmergencia: user.contactoEmergencia || '', avatar: user.avatar || '' });
      setGuestTextSize(user.textSize || 'normal');
      setGuestContrast(Boolean(user.contrast));
      try {
        localStorage.setItem('club65_guest_text_size', user.textSize || 'normal');
        localStorage.setItem('club65_guest_contrast', String(Boolean(user.contrast)));
      } catch {}
      applyAccessibility(user.textSize, user.contrast);
      setModalLoginOpen(false);
      await refreshData(user);
      setCurrentView(user.tipo === 'moderador' ? 'moderacion' : 'explorar');
    } catch (err: any) {
      setLoginError(err.message);
    }
  }

  // Register handler
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError('');

    if (regForm.tipo === 'institucional') {
      const cleanCuitDigits = regForm.cuit.replace(/\D/g, '');
      if (cleanCuitDigits.length !== 11) {
        setRegError('El CUIT institucional debe contener exactamente 11 dígitos con formato XX-XXXXXXXX-X.');
        return;
      }
      if (!regForm.presidenteFuncionario.trim()) {
        setRegError('Por favor indicá el Nombre y Apellido del Presidente o Funcionario a cargo.');
        return;
      }
      if (!regForm.contactoInstitucional.trim()) {
        setRegError('Por favor indicá el teléfono de contacto institucional.');
        return;
      }
      if (!regForm.direccionFisica.trim()) {
        setRegError('Por favor indicá la dirección física (calle y altura) de la institución.');
        return;
      }
      if (!regFiles.constanciaCuit) {
        setRegError('Por favor adjuntá la Constancia de CUIT / Inscripción ARCA (PDF o imagen, máx. 5MB).');
        return;
      }
      if (!regFiles.personeriaDoc) {
        setRegError('Por favor adjuntá el documento que acredite personería o representación legal (Acta de autoridades, estatuto o nota membretada oficial).');
        return;
      }
    }

    try {
      let cuitUploadedUrl = regFiles.constanciaCuit?.dataUrl || '';
      let personeriaUploadedUrl = regFiles.personeriaDoc?.dataUrl || '';

      if (regForm.tipo === 'institucional') {
        const cleanUser = regForm.usuario.trim().toLowerCase();
        if (regFiles.constanciaCuit) {
          try {
            cuitUploadedUrl = await uploadInstitutionalDocToStorage(
              regFiles.constanciaCuit,
              cleanUser,
              'cuit'
            );
          } catch (e) {
            console.warn('Fallback a dataUrl para CUIT:', e);
          }
        }
        if (regFiles.personeriaDoc) {
          try {
            personeriaUploadedUrl = await uploadInstitutionalDocToStorage(
              regFiles.personeriaDoc,
              cleanUser,
              'personeria'
            );
          } catch (e) {
            console.warn('Fallback a dataUrl para Personeria:', e);
          }
        }
      }

      const user = await api.register({
        usuario: regForm.usuario,
        clave: regForm.clave,
        apodo: regForm.nombre,
        tipo: regForm.tipo,
        localidad: regForm.localidad,
        cuit: regForm.cuit,
        entidadTipo: regForm.entidadTipo,
        contactoInstitucional: regForm.contactoInstitucional,
        direccionFisica: regForm.direccionFisica,
        sitioWebRedSocial: regForm.sitioWebRedSocial,
        presidenteFuncionario: regForm.presidenteFuncionario,
        managerNombre: regForm.managerNombre || regForm.gestorNombre,
        managerRol: regForm.managerRol || regForm.gestorRol,
        gestorNombre: regForm.managerNombre || regForm.gestorNombre,
        gestorRol: regForm.managerRol || regForm.gestorRol,
        documento_cuit_url: cuitUploadedUrl,
        documentoCuitUrl: cuitUploadedUrl,
        documento_personeria_url: personeriaUploadedUrl,
        documentoPersoneriaUrl: personeriaUploadedUrl,
        constanciaCuitUrl: cuitUploadedUrl,
        constanciaCuitNombre: regFiles.constanciaCuit?.name,
        personeriaDocUrl: personeriaUploadedUrl,
        personeriaDocNombre: regFiles.personeriaDoc?.name,
        email: regForm.email,
        textSize: guestTextSize,
        contrast: guestContrast
      });

      if (regForm.tipo === 'institucional') {
        clearBrowserSessionKeys();
        setCurrentUser(null);
        setChats([]);
        setActiveChatId(null);
        setProfileForm({ apodo: '', bio: '', contactoEmergencia: '', avatar: '' });
        setModalRegisterOpen(false);
        setModalInstPendingNotice({
          email: regForm.email || `${regForm.usuario}@correo.club65.ar`,
          apodo: regForm.nombre
        });
        setRegForm({
          tipo: 'personal',
          nombre: '',
          usuario: '',
          email: '',
          clave: '',
          localidad: '',
          cuit: '',
          entidadTipo: 'Asociación Civil / Club Social',
          contactoInstitucional: '',
          direccionFisica: '',
          sitioWebRedSocial: '',
          presidenteFuncionario: '',
          managerNombre: '',
          managerRol: '',
          gestorNombre: '',
          gestorRol: '',
          terminos: false
        });
        setRegFiles({
          constanciaCuit: null,
          personeriaDoc: null
        });
        await refreshData(null);
        return;
      }

      setCurrentUser(user);
      setProfileForm({ apodo: user.apodo, bio: user.bio, contactoEmergencia: user.contactoEmergencia || '', avatar: user.avatar || '' });
      applyAccessibility(user.textSize, user.contrast);
      setModalRegisterOpen(false);
      await refreshData(user);
      setCurrentView('explorar');
      showToast(`¡Cuenta creada con éxito para ${user.apodo}!`);
    } catch (err: any) {
      setRegError(err.message || 'Error al registrar.');
    }
  }

  async function handleLogout() {
    try {
      await contextLogout();
    } catch (_) {}
    const preservedTextSize = currentUser?.textSize || guestTextSize || 'normal';
    const preservedContrast = currentUser ? Boolean(currentUser.contrast) : guestContrast;
    clearBrowserSessionKeys();
    invalidateApiCaches();
    hydratedAvatarIdsRef.current.clear();
    setCurrentUser(null);
    setChats([]);
    setChatLastReads({});
    setSeenSuspendedActIds([]);
    setSeenCancelledMisActividadesIds([]);
    setSeenCancelledAgendaActIds([]);
    setDismissedCancelledAgendaActIds([]);
    setSeenRejectedProposalIds([]);
    setDismissedRejectedProposalIds([]);
    setCancelledGroupNotices([]);
    setActiveChatId(null);
    setGuestTextSize(preservedTextSize);
    setGuestContrast(preservedContrast);
    try {
      localStorage.setItem('club65_guest_text_size', preservedTextSize);
      localStorage.setItem('club65_guest_contrast', String(preservedContrast));
    } catch {}
    applyAccessibility(preservedTextSize, preservedContrast);
    setSoporteEnviadoMsg('');
    setSoporteError('');
    setSoporteAsunto(SOPORTE_ASUNTOS[0]);
    setSoporteEmailInvitado('');
    setSoporteMensaje('');
    setCurrentView('home-visitante');
    setUserDropdownOpen(false);
  }

  // Save profile with contextual toast message based on what was updated
  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser) return;
    try {
      const apodoCambiado = profileForm.apodo.trim() !== currentUser.apodo.trim();
      const fotoCambiada = profileForm.avatar !== currentUser.avatar;

      const updated = await api.updateProfile({
      apodo: profileForm.apodo,
      bio: profileForm.bio,
      avatar: profileForm.avatar,
      contactoEmergencia: profileForm.contactoEmergencia?.trim() || ''
    });
      const userFinal = (updated as any)?.user || updated;
      setCurrentUser(userFinal);
      if (userFinal?.id) {
        setStoredUserId(String(userFinal.id));
      }
    setModalEditProfileOpen(false);
    await refreshData();

      if (apodoCambiado && fotoCambiada) {
        showToast('¡Perfil, foto y mensajes actualizados con éxito!');
      } else if (fotoCambiada) {
        showToast('¡Foto de perfil actualizada con éxito!');
      } else if (apodoCambiado) {
        showToast('¡Apodo y mensajes anteriores actualizados con tu nuevo nombre!');
      } else {
        showToast('¡Perfil actualizado con éxito!');
      }
    } catch (err: any) {
      showToast(err.message || 'Error al actualizar perfil');
    }
  }

  function handleProfilePhotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setImageCropperState({
        isOpen: true,
        rawSrc: objectUrl,
        target: 'profile',
        title: 'Ajustar imagen',
        shape: 'circle'
      });
      e.target.value = '';
    }
  }

// Toggle enrollment
  async function toggleEnrollment(actId: number) {
    if (!currentUser) {
      setModalDetalleId(null);
      setModalLoginOpen(true);
      return;
    }

    const act = activities.find((a: any) => Number(a.id) === Number(actId));
    if (!act) return;

    const u = currentUser as any;
    const myUsername = u.usuario || u.nombre || String(u.id || 'usuario');
    const myApodo = u.apodo || u.nombre || myUsername;
    const isEnrolled = isUserEnrolledInActivity(act, currentUser);

    if (!isEnrolled) {
      const myEnrolledActs = activities.filter((a: any) =>
        String(a.id) !== String(act.id) && isUserEnrolledInActivity(a, currentUser)
      );
      const enrollCheck = canUserEnrollActivity(act, currentUser, undefined, myEnrolledActs);
      if (!enrollCheck.allowed) {
        showToast(enrollCheck.reason || 'No podés inscribirte a esta actividad.');
        return;
      }
    }

    try {
      // 1. Actualizar inmediatamente la actividad en el estado local
      setActivities((prevActs: any[]) =>
        prevActs.map((a: any) => {
          if (Number(a.id) === Number(actId) || String(a.id) === String(actId)) {
            const currentUsers: string[] = (Array.isArray(a.enrolledUsernames) && a.enrolledUsernames.length > 0)
              ? [...a.enrolledUsernames]
              : (Array.isArray(a.enrolled_usernames) ? [...a.enrolled_usernames] : []);
            const userTokens = [myUsername, myApodo, u.id, u.nombre].filter(Boolean).map(x => String(x).toLowerCase().trim());
            const nextUsers = isEnrolled
              ? currentUsers.filter((x) => !userTokens.includes(String(x).toLowerCase().trim()))
              : Array.from(new Set([...currentUsers, myUsername]));
            const currentEnrolledCount = typeof a.inscriptos === 'number' ? a.inscriptos : (a.enrolledCount || 0);
            return {
              ...a,
              enrolledUsernames: nextUsers,
              enrolled_usernames: nextUsers,
              inscriptos: isEnrolled ? Math.max(0, currentEnrolledCount - 1) : currentEnrolledCount + 1,
              enrolledCount: isEnrolled ? Math.max(0, currentEnrolledCount - 1) : currentEnrolledCount + 1
            };
          }
          return a;
        })
      );

      // 2. Actualizar inmediatamente la lista de chats recientes según inscripción o cancelación
      const actTitleClean = cleanGroupTitle(act.title);
      const myUserTokens = [myUsername, myApodo, u.id, u.nombre]
        .filter(Boolean)
        .map((t: any) => String(t).toLowerCase().trim());

      if (!isEnrolled) {
        setChats((prevChats: any[]) => {
          const list = Array.isArray(prevChats) ? [...prevChats] : [];
          // 1. Buscar si ya existe el chat oficial (por ID de actividad o por título)
          const existingIdx = list.findIndex(c => 
            (c.activityId && String(c.activityId) === String(act.id)) ||
            (c.id && String(c.id) === String(act.id)) ||
            (actTitleClean && cleanGroupTitle(c.title || c.name) === actTitleClean)
          );

          if (existingIdx !== -1) {
            const currentParts = list[existingIdx].participants || [];
            const isAlreadyIn = currentParts.some((p: any) => 
              String(p).toLowerCase() === myApodo.toLowerCase() || 
              String(p).toLowerCase() === myUsername.toLowerCase()
            );
            const cleanedLeftVol = (list[existingIdx].leftVoluntarilyParticipants || []).filter(
              (p: any) => !myUserTokens.includes(String(p).toLowerCase().trim())
            );
            const cleanedRem = (list[existingIdx].removedParticipants || []).filter(
              (p: any) => !myUserTokens.includes(String(p).toLowerCase().trim())
            );
            const cleanedDel = (list[existingIdx].deletedForUserIds || []).filter(
              (p: any) => !myUserTokens.includes(String(p).toLowerCase().trim())
            );

            list[existingIdx] = {
              ...list[existingIdx],
              avatar: list[existingIdx].avatar || act.image || act.foto || '',
              participants: isAlreadyIn ? currentParts : [...currentParts, myApodo],
              leftVoluntarilyParticipants: cleanedLeftVol,
              removedParticipants: cleanedRem,
              deletedForUserIds: cleanedDel
            };
          } else {
            const cleanTitle = act.title.replace(/^grupo:\s*/i, '').trim();
            const newActChat: any = {
              id: act.id,
              activityId: act.id,
              title: cleanTitle,
              name: cleanTitle,
              avatar: act.image || act.foto || '', // Foto de la actividad
              image: act.image || act.foto || '',
              subtitle: act.organizer ? `Grupo coordinado por ${act.organizer}` : `Canal vecinal de ${act.title}`,
              type: 'grupal',
              organizerId: act.organizerId || 'organizador',
              creatorId: act.organizerId || 'organizador',
              creatorName: act.organizer || '',
              adminUsernames: [act.organizer].filter(Boolean),
              allowedRoles: ['personal', 'institucional'],
              participants: Array.from(new Set([act.organizer, myApodo, myUsername].filter((p: any) => Boolean(p) && !isDummyOrSystemParticipant(p)))),
              messages: []
            };
            list.unshift(newActChat);
          }
          const deduplicatedList = deduplicateChats(list);
          try {
            localStorage.setItem('club65_custom_chats', JSON.stringify(deduplicatedList));
          } catch (_) {}
          return deduplicatedList;
        });
      } else {
        const matchesThisActivityChat = (c: any) => {
          if (!c || c.type === 'privado') return false;
          const cTitleClean = cleanGroupTitle(c.title || c.name);
          return Boolean(
            (c.activityId && String(c.activityId) === String(act.id)) ||
            (c.id && String(c.id) === String(act.id)) ||
            (actTitleClean && cTitleClean === actTitleClean)
          );
        };
        const isLeaderOfActChat = (c: any) => {
          if (u?.tipo === 'moderador') return true;
          const orgTokens = [
            c?.creatorId,
            c?.creatorName,
            c?.organizerId,
            c?.organizer,
            act?.organizerId,
            act?.organizer,
            (act as any)?.creador_id
          ]
            .filter(Boolean)
            .map((t: any) => String(t).toLowerCase().trim());
          return orgTokens.some(t => myUserTokens.includes(t));
        };

        const removedChatIds = new Set<string>();
        setChats((prevChats: any[]) => {
          const next = (Array.isArray(prevChats) ? prevChats : []).filter((c: any) => {
            if (!matchesThisActivityChat(c)) return true;
            if (isLeaderOfActChat(c)) return true;
            if (c?.id) removedChatIds.add(String(c.id));
            if (c?.activityId) removedChatIds.add(String(c.activityId));
            return false;
          });
          try {
            localStorage.setItem('club65_custom_chats', JSON.stringify(next));
          } catch (_) {}
          return next;
        });
        setActiveChatId(cur => {
          if (!cur) return cur;
          const curStr = String(cur);
          if (curStr === String(act.id) || removedChatIds.has(curStr)) {
            return null;
          }
          return cur;
        });
      }

      // 3. Cerrar el modal y sincronizar con el backend antes de celebrar
      setModalDetalleId(null);

      // 4. Notificar al backend y sincronizar datos
      if (isEnrolled) {
        await api.unenrollActivity(actId);
        showToast(`Cancelaste tu inscripción a "${act.title}".`);
      } else {
        await api.enrollActivity(actId);
        showToast(`¡Te inscribiste con éxito a "${act.title}"! Ya podés encontrar el grupo en Mi Chat.`);
        if (shouldTriggerEnrollmentConfetti({
          wasAlreadyEnrolled: false,
          hasUser: Boolean(currentUser),
          enrollSucceeded: true
        })) {
          launchCelebrationConfetti();
        }

        // Vincular al usuario en el chat grupal de la actividad
        const targetChat = chats.find((c: any) =>
          (c.activityId && String(c.activityId) === String(actId)) ||
          (c.name && act?.title && c.name.trim().toLowerCase() === act.title.trim().toLowerCase())
        );

        if (targetChat && !isAdministratorUser(currentUser)) {
          const myToken = currentUser?.usuario || currentUser?.apodo || currentUser?.nombre || currentUser?.id;
          if (myToken) {
            try {
              await api.addChatParticipant(targetChat.id, myToken, actId);
            } catch (chatErr) {
              console.warn('Usuario ya vinculado al chat de la actividad:', chatErr);
            }
          }
        }
      }
      await refreshData();
    } catch (err: any) {
      console.warn('Error al actualizar la inscripción:', err);
      showToast(err?.message || 'No se pudo actualizar la inscripción.');
      await refreshData().catch(() => {});
    }
  }
  // Veto user from activity
  async function handleVetoUser(actId: number | string, username: string) {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión para vetar participantes de una actividad.');
      setModalLoginOpen(true);
      return;
    }
    try {
      const updated = await api.vetoUser(actId, username);
      setActivities(prev => prev.map(a => String(a.id) === String(actId) ? updated : a));
      await refreshData();
      showToast(`El usuario ${username} ha sido vetado de la actividad. El cupo ha sido liberado.`);
    } catch (err: any) {
      showToast(err.message || 'Error al vetar usuario.');
    }
  }

  // Centralized cancellation / force-removal handler (Supabase activities + bajas)
  async function handleDarDeBajaActividad(id: number | string, motivo?: string) {
    if (!id || isCancellingActivity) return;
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión para dar de baja una actividad.');
      setModalLoginOpen(true);
      return;
    }
    const cleanMotivo = (motivo && String(motivo).trim())
      ? String(motivo).trim()
      : 'Cancelada por el organizador';
    const isAdminExec = isOfficialAdminRow(currentUser);
    const targetAct = activities.find(a => String(a.id) === String(id));
    const targetTitle = targetAct?.title || modalBajaActividad?.title || modalConfirmarCancelacion?.nombre || 'Actividad';

    setIsCancellingActivity(true);
    try {
      const updatedAct = await api.darDeBajaActividad(
        id,
        cleanMotivo,
        currentUser ? { ...currentUser, id: userId } : { id: userId }
      );

      // Update local activities state immediately
      setActivities((prevActs: any[]) =>
        prevActs.map((a: any) => {
          if (String(a.id) === String(id)) {
            return {
              ...a,
              ...updatedAct,
              isApproved: false,
              proposalStatus: isAdminExec ? 'baja_forzada' : 'cancelada_organizador',
              estado: 'baja_forzada',
              baja_forzada: isAdminExec,
              canceladaPorOrganizador: !isAdminExec,
              fecha_baja: updatedAct.fecha_baja || new Date().toISOString(),
              motivo_baja: cleanMotivo,
              feedback_admin: cleanMotivo,
              bajaReason: cleanMotivo,
              proposalNote: cleanMotivo,
              admin_baja_id: userId
            };
          }
          return a;
        })
      );

      // Remove associated group chat locally right away & clear activeChatId if it was open
      setChats((prevChats: any[]) => {
        const next = filterChatsAfterActivityCancellation(prevChats, id, targetTitle);
        setActiveChatId(curId => {
          if (!curId) return curId;
          const activeObj = prevChats.find(c => String(c.id) === String(curId) || (c.activityId && String(c.activityId) === String(curId)));
          if (activeObj && doesChatMatchActivity(activeObj, id, targetTitle)) {
            return null;
          }
          return curId;
        });
        return next;
      });

      // Update local bajas registry immediately
      try {
        const newBaja = {
          id: 'baja_' + Date.now(),
          activityId: Number(id) || id,
          title: targetTitle,
          organizer: targetAct?.organizer || currentUser?.apodo || currentUser?.usuario || 'Organizador',
          reason: cleanMotivo,
          date: formatArgentinaDateTime(),
          adminUsername: isAdminExec ? (currentUser?.usuario || currentUser?.apodo || userId) : '-'
        };
        if (typeof setBajasList === 'function') {
          setBajasList((prev: any[]) => [
            newBaja,
            ...(Array.isArray(prev) ? prev.filter((b: any) => String(b.activityId) !== String(id)) : [])
          ]);
        }
      } catch (_) {}

      await refreshData();

      setModalConfirmarCancelacion(null);
      setModalBajaActividad(null);
      setModalModeracionActividadId(null);
      setMotivoBajaInput('');
      setMotivoCancelacionInput('Cancelada por el organizador');

      showToast(
        isAdminExec
          ? `Actividad "${targetTitle}" dada de baja de la Cartelera.`
          : 'Actividad cancelada correctamente. Se notificará a los inscriptos.'
      );
    } catch (err: any) {
      showToast(err?.message || 'Error al cancelar la actividad.');
    } finally {
      setIsCancellingActivity(false);
    }
  }

function isUserChatModerator(chat: any, user: any, activitiesList: any[] = []): boolean {
  if (!chat || !user) return false;
  if (isUserRemovedFromChat(chat, user) || isUserLeftVoluntarilyFromChat(chat, user)) {
    return false;
  }
  return isUserGroupModerator(chat, user, activitiesList);
}

  // Send message in active chat with reply support
  async function handleSendChatMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeChatId || !chatInputText.trim() || isSendingChatMessage) return;

    const currentChat = chats.find(c => 
      String(c.id) === String(activeChatId) || 
      (c.activityId && String(c.activityId) === String(activeChatId))
    );
    if (currentChat && isUserVetoedFromChat(currentChat, currentUser)) {
      showToast('Ya no formás parte de este grupo porque fuiste vetado de la actividad.');
      return;
    }
    if (currentChat && isUserLeftVoluntarilyFromChat(currentChat, currentUser)) {
      showToast('Te retiraste voluntariamente de este grupo. Ya no podés enviar mensajes.');
      return;
    }
    if (currentChat && isUserRemovedFromChat(currentChat, currentUser)) {
      showToast('Fuiste retirado de este grupo por el moderador. Ya no podés enviar mensajes.');
      return;
    }
    if (currentChat && currentChat.type === 'privado') {
      const otherPartId = currentChat.participantIds?.find((id: string) => String(id) !== String(currentUser?.id));
      const otherDisplay = getChatDisplayTitle(currentChat, currentUser);
      if (
        isUserBlocked(otherDisplay, otherPartId) ||
        didOtherBlockMe(otherDisplay, otherPartId) ||
        didIBlockUser(otherDisplay, otherPartId)
      ) {
        showToast('No podés enviar mensajes a este usuario porque la comunicación está restringida.');
        return;
      }
    }

    // Si el chat estaba marcado como borrado en la lista del usuario, desmarcarlo para que permanezca con el nuevo mensaje
    try {
      const uTokens = [currentUser?.id, currentUser?.usuario, currentUser?.apodo].filter(Boolean) as string[];
      uTokens.forEach(tok => {
        const key = `deleted_chats_${tok}`;
        const stored: string[] = JSON.parse(localStorage.getItem(key) || '[]');
        const updated = stored.filter(id => String(id) !== String(activeChatId));
        if (updated.length !== stored.length) {
          localStorage.setItem(key, JSON.stringify(updated));
        }
      });
    } catch (_) {}

    setIsSendingChatMessage(true);
    const textToSend = chatInputText.trim();
    setChatInputText('');
    setReplyingToMessage(null);

    // 1. Crear el objeto del mensaje de forma inmediata
    const u = currentUser as any;
    const currentId = String(u?.id || u?.usuario || u?.apodo || 'user_' + Date.now());
    const currentName =
      u?.apodo ||
      u?.nombre ||
      u?.usuario ||
      u?.nombreCompleto ||
      u?.institucion ||
      (u?.esInstitucion ? (u?.institucion || 'Institución') : 'Usuario');
    const currentAvatar = u?.avatar || '';

    const replyData = replyingToMessage ? {
      id: replyingToMessage.id,
      sender: replyingToMessage.sender,
      text: replyingToMessage.text
    } : undefined;

    const isOrg = isUserChatModerator(currentChat, currentUser, activities);
    const clientMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    recentlySentMsgIdsRef.current.add(clientMsgId);
    setTimeout(() => recentlySentMsgIdsRef.current.delete(clientMsgId), 30000);
    const optimisticMsg: any = {
      id: clientMsgId,
      chatId: activeChatId,
      senderId: currentId,
      sender_id: currentId,
      userId: currentId,
      user_id: currentId,
      sender: currentName,
      autor: currentName,
      author: currentName,
      avatar: currentAvatar,
      role: (u?.tipo === 'moderador' || u?.rol === 'moderador' || u?.tipo === 'admin' || u?.rol === 'admin')
        ? 'Administrador'
        : (u?.tipo === 'institucional' || u?.rol === 'institucional' || u?.esInstitucion)
        ? 'Institución'
        : 'Personal',
      text: textToSend,
      time: formatArgentinaTimeOnly(new Date()),
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      isOrganizer: isOrg,
      isAdminUser: Boolean(u?.tipo === 'moderador' || u?.rol === 'moderador' || u?.tipo === 'admin' || u?.rol === 'admin'),
      isVerifiedInst: Boolean((u?.tipo === 'institucional' || u?.rol === 'institucional' || u?.esInstitucion) && (u?.isVerified || u?.is_verified)),
      replyTo: replyData
    };

    // 2. Pintar inmediatamente en pantalla sin esperar la red
    setChats((prevChats: any[]) =>
      prevChats.map((c: any) => {
        if (String(c.id) === String(activeChatId) || (c.activityId && String(c.activityId) === String(activeChatId))) {
          const currentParts = Array.isArray(c.participants) ? c.participants : [];
          const updatedParts = currentParts.includes(currentName) ? currentParts : [...currentParts, currentName];
          return {
            ...c,
            participants: updatedParts,
            messages: deduplicateMessages([...(c.messages || []), optimisticMsg]),
            lastMessage: optimisticMsg.text,
            lastMessageTime: optimisticMsg.time,
            updatedAt: optimisticMsg.createdAt,
            updated_at: optimisticMsg.createdAt
          };
        }
        return c;
      })
    );

    markChatAsRead(activeChatId);
    isUserScrolledUpChatRef.current = false;
    requestAnimationFrame(() => {
      if (chatMessagesContainerRef.current) {
        chatMessagesContainerRef.current.scrollTop = chatMessagesContainerRef.current.scrollHeight;
      }
    });

    // 3. Persistir en segundo plano pasando el mismo clientMsgId para consistencia estricta
    try {
      const saved = await api.sendChatMessage(
        activeChatId,
        textToSend,
        replyData,
        currentUser,
        currentChat ? {
          title: currentChat.title,
          type: currentChat.type,
          activityId: currentChat.activityId,
          participants: currentChat.participants
        } : undefined,
        clientMsgId
      );
      if (saved && saved.id) {
        setChats((prevChats: any[]) =>
          prevChats.map((c: any) => {
            if (String(c.id) === String(activeChatId) || (c.activityId && String(c.activityId) === String(activeChatId))) {
              const currentMsgs = c.messages || [];
              const updatedMsgs = currentMsgs.map((m: any) =>
                String(m.id) === String(clientMsgId)
                  ? {
                      ...m,
                      ...saved,
                      isPinned: Boolean(m.isPinned || saved?.isPinned),
                      replyTo: m.replyTo || saved?.replyTo || replyData || undefined
                    }
                  : m
              );
              const exists = updatedMsgs.some((m: any) => String(m.id) === String(saved.id));
              const finalMsgs = deduplicateMessages(
                exists
                  ? updatedMsgs
                  : [...updatedMsgs, { ...saved, replyTo: saved?.replyTo || replyData || undefined }]
              );
              return {
                ...c,
                messages: finalMsgs,
                lastMessage: saved.text,
                lastMessageTime: saved.time
              };
            }
            return c;
          })
        );
      }
    } catch (err: any) {
      console.warn('Persistencia en segundo plano diferida:', err);
    } finally {
      setIsSendingChatMessage(false);
    }
  }

  // Delete chat for current user only (removes from recent chats)
  async function handleDeleteChatForMe(chatId: any) {
    try {
      const targetId = String(chatId);
      const targetChat = chats.find(c => String(c.id) === targetId || (c.activityId && String(c.activityId) === targetId));
      const targetActId = targetChat?.activityId ? String(targetChat.activityId) : '';

      // 1. Quitarlo inmediatamente de la vista y resetear chat activo si corresponde
      setChats(prev => prev.filter(c => 
        String(c.id) !== targetId && 
        String(c.activityId) !== targetId &&
        (!targetActId || (String(c.id) !== targetActId && String(c.activityId) !== targetActId))
      ));
      if (String(activeChatId) === targetId || (activeChat && String(activeChat.activityId) === targetId) || (targetActId && String(activeChatId) === targetActId)) {
        setActiveChatId(null);
      }
      setChatToDeleteForMe(null);

      // 2. Persistir localmente de forma estrictamente individual (NUNCA 'local' para no afectar a otras cuentas)
      try {
        const nowIso = new Date().toISOString();
        const uTokens = [currentUser?.id, currentUser?.usuario, currentUser?.apodo].filter(Boolean) as string[];
        uTokens.forEach(tok => {
          const key = `deleted_chats_${tok}`;
          const stored: string[] = JSON.parse(localStorage.getItem(key) || '[]');
          [targetId, targetActId].filter(Boolean).forEach(id => {
            if (!stored.includes(id)) {
              stored.push(id);
            }
          });
          localStorage.setItem(key, JSON.stringify(stored));

          // Registrar timestamp de vaciado para que al reabrir el chat no reaparezcan los mensajes viejos
          const clearKey = `club65_chat_cleared_${tok}`;
          const clearObj: Record<string, string> = JSON.parse(localStorage.getItem(clearKey) || '{}');
          [targetId, targetActId].filter(Boolean).forEach(id => {
            clearObj[id] = nowIso;
          });
          localStorage.setItem(clearKey, JSON.stringify(clearObj));
        });

        // Limpiar remanente obsoleto 'deleted_chats_local'
        localStorage.removeItem('deleted_chats_local');
      } catch (_) {}

      // 3. Notificar al usuario
      showToast('Chat borrado de tus mensajes recientes.');

      // 4. Sincronizar con el backend y Supabase
      try {
        await api.deleteChatForMe(targetId, targetActId);
      } catch (backendErr) {
        console.warn('Persistencia remota de borrado diferida:', backendErr);
      }
    } catch (err: any) {
      console.error('Error al borrar chat:', err);
      showToast('No se pudo borrar el chat.');
    }
  }

  // Pin / unpin message toggle
  async function handlePinChatMessage(messageId: string) {
    if (!activeChatId || !currentUser) return;
    const chat = chats.find(c => c.id === activeChatId || String(c.id) === String(activeChatId));
    if (!chat || chat.type !== 'grupal') return;

    const canModerate =
      !isUserRemovedFromChat(chat, currentUser) &&
      !isUserLeftVoluntarilyFromChat(chat, currentUser) &&
      isUserGroupModerator(chat, currentUser, activities);

    if (!canModerate) {
      showToast('Solo los moderadores del grupo pueden fijar o desfijar mensajes.');
      return;
    }

    const currentPinnedMsg = getPinnedMessageFromList(chat.messages, chat.pinnedMessageId);
    const prevPinnedId = currentPinnedMsg ? String(currentPinnedMsg.id) : (chat.pinnedMessageId ? String(chat.pinnedMessageId) : undefined);
    const isAlreadyPinned = Boolean(prevPinnedId) && String(prevPinnedId) === String(messageId);
    const newPinId = isAlreadyPinned ? '' : messageId;

    // Actualización optimista inmediata
    setChats(prev => prev.map(c => {
      if (c.id === activeChatId || String(c.id) === String(activeChatId)) {
        return {
          ...c,
          pinnedMessageId: newPinId || undefined,
          messages: (c.messages || []).map(m => ({
            ...m,
            isPinned: newPinId ? String(m.id) === String(newPinId) : false
          }))
        };
      }
      return c;
    }));

    try {
      await api.pinChatMessage(activeChatId, newPinId || null);
      showToast(isAlreadyPinned ? 'Mensaje desfijado del grupo.' : 'Mensaje fijado en el grupo con éxito.');
      await refreshData();
    } catch (err: any) {
      // Revertir estado optimista si falló la persistencia en Supabase
      setChats(prev => prev.map(c => {
        if (c.id === activeChatId || String(c.id) === String(activeChatId)) {
          return {
            ...c,
            pinnedMessageId: prevPinnedId,
            messages: (c.messages || []).map(m => ({
              ...m,
              isPinned: prevPinnedId ? String(m.id) === String(prevPinnedId) : false
            }))
          };
        }
        return c;
      }));
      showToast(err.message || 'Error al fijar mensaje');
    }
  }

  // Leave active group chat (voluntarily) - keeps chat in recent chats list with ex-participant read-only status
  // and does NOT unenroll the user from any linked activity
  async function handleSalirGrupoActivo() {
    if (!activeChatId) return;
    const c = chats.find(x => String(x.id) === String(activeChatId));
    if (!c) return;

    try {
      const exitNowMs = Date.now();
      const exitNowIso = new Date(exitNowMs).toISOString();
      const myId = currentUser?.id || '';
      const myNick = currentUser?.usuario || currentUser?.apodo || '';
      const myApodo = currentUser?.apodo || '';
      const myNombre = currentUser?.nombre || '';
      const exitDisplay = (myApodo || myNick || myNombre || 'Vecino').trim();
      const myTokens = Array.from(new Set([myId, myNick, myApodo, myNombre].filter(Boolean).map(t => String(t).trim().toLowerCase())));

      const relatedAct = activities.find((a: any) =>
        (c.activityId && String(a.id) === String(c.activityId)) ||
        (a.title && c.name && a.title.trim().toLowerCase() === String(c.name).trim().toLowerCase())
      );
      const resolvedBeforeExit = getResolvedChatParticipants(c, currentUser, allUsersMap, relatedAct, contacts)
        .map(p => p.displayName)
        .filter(Boolean);
      const snapshotBeforeExit = resolvedBeforeExit.length > 0
        ? resolvedBeforeExit
        : (Array.isArray(c.participants) ? c.participants.filter((p: string) => Boolean(p) && !isDummyOrSystemParticipant(p)) : []);
      if (exitDisplay && !snapshotBeforeExit.some(p => myTokens.includes(String(p).trim().toLowerCase()))) {
        snapshotBeforeExit.push(exitDisplay);
      }

      // 1. Persistir inmediatamente en localStorage SOLO por identificadores únicos de esta cuenta (NUNCA 'local' ni apodos compartibles)
      try {
        localStorage.removeItem('left_chats_local');
        const uTokens = Array.from(new Set([myId, myNick].filter(Boolean).map(t => String(t).trim())));
        uTokens.forEach(tok => {
          const key = `left_chats_${tok}`;
          const stored: string[] = JSON.parse(localStorage.getItem(key) || '[]');
          [String(c.id), c.activityId ? String(c.activityId) : ''].filter(Boolean).forEach(id => {
            if (!stored.includes(id)) stored.push(id);
          });
          localStorage.setItem(key, JSON.stringify(stored));
        });
      } catch (_) {}

      // 2. Actualizar optimista e inmediatamente las notifications de currentUser para que refreshData conserve el grupo en modo solo lectura
      let updatedUserForRefresh: User | null = currentUser;
      if (currentUser) {
        const curNotifs = Array.isArray(currentUser.notifications) ? currentUser.notifications : [];
        const nextNotifs = [
          ...curNotifs.filter((n: any) => !(n && n.type === 'chat_removed_notice' && String(n.chatId) === String(c.id))),
          {
            id: `chat_removed_${String(c.id)}_${exitNowMs}`,
            text: `Saliste del grupo "${c.title || c.name || 'Grupo'}".`,
            time: formatArgentinaTimeOnly(new Date(exitNowMs)),
            read: true,
            type: 'chat_removed_notice',
            reason: 'left',
            chatId: String(c.id),
            activityId: c.activityId ? String(c.activityId) : undefined,
            participantsSnapshot: snapshotBeforeExit,
            removedAt: exitNowMs,
            leftAt: exitNowMs,
            createdAt: exitNowIso
          }
        ];
        updatedUserForRefresh = { ...currentUser, notifications: nextNotifs };
        setCurrentUser(updatedUserForRefresh);
        try {
          const storedRaw = localStorage.getItem('club65_user');
          if (storedRaw) {
            const parsedU = JSON.parse(storedRaw);
            if (parsedU && String(parsedU.id) === String(currentUser.id)) {
              localStorage.setItem('club65_user', JSON.stringify({ ...parsedU, notifications: nextNotifs }));
            }
          }
        } catch (_) {}
      }

      setReplyingToMessage(null);

      // 3. Marcar de inmediato en el estado local que se retiró voluntariamente conservando el snapshot y el mensaje de salida
      const optimisticLeftMsg: ChatMessage = {
        id: `sys_left_${exitNowMs}`,
        chatId: String(c.id),
        senderId: 'sistema',
        sender: 'Sistema CLUB65',
        avatar: '👋',
        role: 'sistema',
        text: `${exitDisplay} salió del grupo.`,
        time: formatArgentinaTimeOnly(new Date(exitNowMs)),
        createdAt: exitNowIso,
        timestamp: exitNowMs,
        replyTo: {
          event: 'user_left',
          participant: exitDisplay,
          userId: myId,
          participantTokens: myTokens,
          participantsSnapshot: snapshotBeforeExit
        } as any
      };
      (optimisticLeftMsg as any).reply_to = optimisticLeftMsg.replyTo;

      setChats(prev => prev.map(chat => {
        if (String(chat.id) === String(activeChatId)) {
          const prevParts = (chat.participants || []).filter((p: string) =>
            !myTokens.includes(String(p).toLowerCase().trim())
          );
          const prevAdmins = (chat.adminUsernames || []).filter((a: string) =>
            !myTokens.includes(String(a).toLowerCase().trim())
          );
          const leftVol = Array.from(new Set([...(chat.leftVoluntarilyParticipants || []), myNick, myId, myApodo, myNombre].filter(Boolean)));
          const remParts = Array.from(new Set([...(chat.removedParticipants || []), myNick, myId, myApodo, myNombre].filter(Boolean)));
          const snapshotMap: Record<string, string[]> = { ...(chat.participantsSnapshotOnRemoval || {}) };
          myTokens.forEach(tok => {
            if (!snapshotMap[tok] || snapshotMap[tok].length === 0) {
              snapshotMap[tok] = snapshotBeforeExit;
            }
          });
          const curMsgs = Array.isArray(chat.messages) ? chat.messages : [];
          return {
            ...chat,
            leftVoluntarily: true,
            removedByUser: true,
            leftAtForUser: exitNowMs,
            removedAtForUser: exitNowMs,
            participantsSnapshotOnRemoval: snapshotMap,
            participants: prevParts,
            adminUsernames: prevAdmins,
            leftVoluntarilyParticipants: leftVol,
            removedParticipants: remParts,
            messages: deduplicateMessages([...curMsgs, optimisticLeftMsg]),
            lastMessage: optimisticLeftMsg.text,
            lastMessageTime: optimisticLeftMsg.time
          };
        }
        return chat;
      }));

      // 4. Notificar a la API (SIN desinscribir de la actividad asociada)
      await api.leaveChat(activeChatId, c.activityId, updatedUserForRefresh || currentUser);

      // 5. Refrescar manteniendo al grupo en chats recientes con su snapshot congelado
      await refreshData(updatedUserForRefresh);
      showToast(`Saliste del grupo "${c.title}". Podés seguir consultando los mensajes anteriores.`);
    } catch (err: any) {
      showToast(err.message || 'Error al salir del grupo');
    }
  }



  // Remove cancelled or vetoed activity notification from agenda
  async function handleRemoveCancelledFromAgenda(actId: number | string) {
    const targetAct = activities.find(a => String(a.id) === String(actId));
    const isVetoed = Boolean(targetAct && currentUser && isUserVettedFromActivity(targetAct, currentUser));
    const numActId = Number(actId);
    if (!isNaN(numActId)) {
      setDismissedCancelledAgendaActIds(prev => Array.from(new Set([...prev, numActId])));
      setSeenCancelledAgendaActIds(prev => Array.from(new Set([...prev, numActId])));
    }
    if (currentUser) {
      api.markUserActivityAlertInSupabase(currentUser.id, 'dismissed_agenda_cancelled', [actId]).catch(() => {});
      api.markUserActivityAlertInSupabase(currentUser.id, 'seen_agenda_cancelled', [actId]).catch(() => {});
      try {
        await api.unenrollActivity(actId);
      } catch {}
    }
    showToast(isVetoed ? 'Notificación retirada de tu agenda.' : 'Actividad cancelada retirada de tu agenda.');
  }

  async function handleDismissRejectedProposal(actId: number | string) {
    const numActId = Number(actId);
    if (!isNaN(numActId)) {
      setDismissedRejectedProposalIds(prev => Array.from(new Set([...prev, numActId])));
      setSeenRejectedProposalIds(prev => Array.from(new Set([...prev, numActId])));
    }
    if (currentUser) {
      api.markUserActivityAlertInSupabase(currentUser.id, 'dismissed_rejected_proposal', [actId]).catch(() => {});
      api.markUserActivityAlertInSupabase(currentUser.id, 'seen_rejected_proposal', [actId]).catch(() => {});
    }
    showToast('Propuesta rechazada retirada de tu listado.');
  }

  // Búsqueda de ubicación en tiempo real con OpenStreetMap Nominatim (100% gratuito y libre)
  function handleSearchLocation(query: string) {
    setEventoForm(prev => ({ ...prev, direccion: query }));
    if (!query.trim()) {
      setShowSugerencias(false);
      setIsSearchingLocation(false);
      return;
    }

    const q = query.toLowerCase().trim();
    const directOption: LocationItem = {
      nombre: query,
      detalle: 'Dirección personalizada',
      lat: eventoForm.lat || -34.6068,
      lng: eventoForm.lng || -58.5647
    };

    setSugerenciasUbicacion([directOption]);
    setShowSugerencias(true);
    setIsSearchingLocation(true);

    // 2. Consulta en vivo a Nominatim OpenStreetMap sin coste ni API key
    if (locationDebounceTimerRef.current) {
      clearTimeout(locationDebounceTimerRef.current);
    }
    locationDebounceTimerRef.current = setTimeout(async () => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=8`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'es' } });
        const parsed = await safeParseJson<any[]>(res);
        if (parsed.ok && parsed.isJson) {
          const data = parsed.data;
          if (Array.isArray(data) && data.length > 0) {
            const realExternal: LocationItem[] = data.filter((item: any) => item && (item.display_name || item.name)).map((item: any) => {
              const displayName = String(item.display_name || item.name || query);
              const parts = displayName.split(',');
              const cleanTitle = parts.slice(0, 2).join(',').trim();
              return {
                nombre: cleanTitle || item.name || query,
                detalle: displayName,
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon)
              };
            });

            // Si es la primera coincidencia y la dirección escrita coincide, actualizamos coordenadas
            if (realExternal[0] && typeof realExternal[0].lat === 'number' && !isNaN(realExternal[0].lat)) {
              const firstLat = realExternal[0].lat ?? -34.6068;
              const firstLng = realExternal[0].lng ?? -58.5647;
              setEventoForm(prev => {
                if (prev.direccion === query) {
                  return { ...prev, lat: firstLat, lng: firstLng };
                }
                return prev;
              });
            }

            setSugerenciasUbicacion(prev => {
              const existing = new Set(prev.map(p => (p.nombre || '').toLowerCase()));
              const fresh = realExternal.filter((r) => !existing.has((r.nombre || '').toLowerCase()));
              const combined = [directOption, ...prev.filter(p => p !== directOption), ...fresh];
              setShowSugerencias(combined.length > 0);
              return combined.slice(0, 20);
            });
          }
        }
      } catch {
        // Mantiene la opción directa ingresada por el vecino
      } finally {
        setIsSearchingLocation(false);
      }
    }, 350);
  }

  function handleEventImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setImageCropperState({
        isOpen: true,
        rawSrc: objectUrl,
        title: 'Ajustar imagen',
        target: 'activity',
        shape: 'rectangle'
      });
      e.target.value = '';
    }
  }

  async function handleEventVideoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      showToast('Por favor, seleccioná un archivo de video válido.');
      return;
    }

    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);
    tempVideo.src = objectUrl;

    await new Promise<void>((resolve) => {
      tempVideo.onloadedmetadata = async () => {
        URL.revokeObjectURL(objectUrl);
        const validation = validateActivityVideoDuration(tempVideo.duration);
        if (!validation.valid) {
          showToast(validation.error || `El límite máximo permitido es de ${MAX_ACTIVITY_VIDEO_DURATION_SECONDS} segundos.`);
          resolve();
          return;
        }

        setIsUploadingActivityVideo(true);
        showToast('Subiendo video explicativo al servidor...');
        try {
          let publicUrl = '';
          try {
            publicUrl = await uploadToStorage(file, 'actividades', 'videos');
          } catch (primaryErr) {
            console.warn('Bucket actividades rechazó video, usando bucket reviews-media:', primaryErr);
            publicUrl = await uploadToStorage(file, 'reviews-media', 'actividades-videos');
          }
          setEventoForm((prev) => ({ ...prev, videoUrl: publicUrl }));
          showToast('Video explicativo subido ✓');
        } catch (err: any) {
          console.error('Error al subir video explicativo de la actividad:', err);
          showToast(err?.message || 'No se pudo subir el video explicativo.');
        } finally {
          setIsUploadingActivityVideo(false);
          resolve();
        }
      };

      tempVideo.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        showToast('No se pudo procesar el video seleccionado.');
        resolve();
      };
    });
  }

  // Submit new activity
 // Submit new activity
  async function handleSubmitEvento(e: React.FormEvent) {
    e.preventDefault();

    if (isUploadingActivityImage) {
      showToast('Aguardá unos segundos mientras se termina de subir la foto seleccionada.');
      return;
    }
    if (isUploadingActivityVideo) {
      showToast('Aguardá unos segundos mientras se termina de subir el video seleccionado.');
      return;
    }

    let resolvedSingleFechaFin = eventoForm.fechaFin || eventoForm.fechaIni;
    if (eventoForm.frecuencia === 'unico') {
      if (!eventoForm.fechaIni || !eventoForm.horaIni) {
        showToast('Debés indicar la fecha y hora de inicio.');
        return;
      }

      const now = new Date();
      const startDateTime = new Date(`${eventoForm.fechaIni}T${eventoForm.horaIni}:00-03:00`);

      if (isNaN(startDateTime.getTime()) || startDateTime <= now) {
        showToast('La fecha y hora de inicio no pueden ser anteriores o iguales al momento actual.');
        return;
      }

      if (!eventoForm.fechaFin && eventoForm.horaFin && eventoForm.horaFin <= eventoForm.horaIni) {
        resolvedSingleFechaFin = addDaysYMD(eventoForm.fechaIni, 1);
      }
      const horaFin = eventoForm.horaFin || eventoForm.horaIni;
      const endDateTime = new Date(`${resolvedSingleFechaFin}T${horaFin}:00-03:00`);

      if (isNaN(endDateTime.getTime()) || endDateTime <= startDateTime) {
        showToast('La fecha y horario de finalización deben ser posteriores a los de inicio.');
        return;
      }
    }
    if (isPublishing) return;

    if (!eventoForm.nombre.trim() || !eventoForm.avance.trim() || !eventoForm.descripcion.trim() || !eventoForm.direccion.trim()) {
      showToast('Por favor, completa todos los campos obligatorios del formulario.');
      return;
    }

    const fechaIniFormateada = formatFechaVisual(eventoForm.fechaIni);
    const fechaFinFormateada = formatFechaVisual(resolvedSingleFechaFin);

    let scheduleText = `${fechaIniFormateada} a las ${eventoForm.horaIni} h`;
    if (eventoForm.frecuencia === 'recurrente') {
      scheduleText = typeof resumenRecurrente !== 'undefined' ? resumenRecurrente : scheduleText;
    } else if (eventoForm.horaFin) {
      if (resolvedSingleFechaFin && resolvedSingleFechaFin !== eventoForm.fechaIni) {
        scheduleText += ` hasta ${fechaFinFormateada} a las ${eventoForm.horaFin} h`;
      } else {
        scheduleText += ` hasta las ${eventoForm.horaFin} h`;
      }
    }

    const isRecurrentAct = eventoForm.frecuencia === 'recurrente';
    let scheduleFinal = scheduleText;
    if (isRecurrentAct) {
      const diasStr = frecuenciaRecurrente === 'mensual'
        ? `Día ${diaMesRecurrente} de cada mes`
        : Array.isArray(diasSemanaRecurrente) && diasSemanaRecurrente.length > 0
          ? `${frecuenciaRecurrente === 'quincenal' ? 'Cada 2 semanas' : 'Semanal'} (${diasSemanaRecurrente.join(', ')})`
          : 'Días a confirmar';

      const horaIniUsar = horaInicioRecurrente || eventoForm.horaIni || '';
      const horaFinUsar = horaFinRecurrente || eventoForm.horaFin || '';
      const horasStr = horaIniUsar && horaFinUsar
        ? `${horaIniUsar} a ${horaFinUsar} h`
        : horaIniUsar
          ? `a las ${horaIniUsar} h`
          : '';

      const baseSchedule = [diasStr, horasStr].filter(Boolean).join(' • ');
      const totalEncuentros = cantidadEventosRecurrente ? ` • ${cantidadEventosRecurrente} encuentros` : '';
      scheduleFinal = `${baseSchedule}${totalEncuentros}`;
    }

    let computedEndDate: string | undefined = undefined;
    if (isRecurrentAct) {
      const tempSessions = getActivitySessions({
        isRecurrent: true,
        firstEncounterDate: eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni,
        startDate: eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni,
        fechaPrimerEncuentro: eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni,
        horaIni: horaInicioRecurrente || eventoForm.horaIni || '',
        horaFin: horaFinRecurrente || eventoForm.horaFin || '',
        startTime: horaInicioRecurrente || eventoForm.horaIni || '',
        endTime: horaFinRecurrente || eventoForm.horaFin || '',
        diasSemana: diasSemanaRecurrente,
        dias_semana: diasSemanaRecurrente,
        diaMes: diaMesRecurrente,
        dia_mes: diaMesRecurrente,
        cantidadEventos: cantidadEventosRecurrente,
        cantidad_eventos: cantidadEventosRecurrente,
        frequency: frecuenciaRecurrente,
        frecuencia: frecuenciaRecurrente,
        schedule: scheduleFinal
      });
      if (tempSessions.length > 0) {
        computedEndDate = tempSessions[tempSessions.length - 1].date;
      }
    }

    // Validación de superposición horaria: no se permite proponer ni crear actividades
    // que coincidan en día y horario (aunque coincidan solo 15 minutos) con una actividad a la que esté inscripto o ya organice
    const candidateActivity = {
      id: editingProposalActivityId || undefined,
      title: eventoForm.nombre.trim(),
      nombre: eventoForm.nombre.trim(),
      schedule: scheduleFinal,
      horario: scheduleFinal,
      isRecurrent: isRecurrentAct,
      es_recurrente: isRecurrentAct,
      frequency: isRecurrentAct ? frecuenciaRecurrente : eventoForm.frecuencia,
      frecuencia: isRecurrentAct ? frecuenciaRecurrente : eventoForm.frecuencia,
      startDate: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : eventoForm.fechaIni,
      endDate: isRecurrentAct ? (computedEndDate || eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : (resolvedSingleFechaFin || eventoForm.fechaIni),
      fechaIni: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : eventoForm.fechaIni,
      fechaFin: isRecurrentAct ? (computedEndDate || eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : (resolvedSingleFechaFin || eventoForm.fechaIni),
      startTime: eventoForm.horaIni || horaInicioRecurrente || '',
      endTime: eventoForm.horaFin || horaFinRecurrente || '',
      horaIni: eventoForm.horaIni || horaInicioRecurrente || '',
      horaFin: eventoForm.horaFin || horaFinRecurrente || '',
      firstEncounterDate: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || undefined) : undefined,
      fechaPrimerEncuentro: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || undefined) : undefined,
      firstMeetingDate: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || undefined) : undefined,
      firstEncounterStartTime: isRecurrentAct ? (eventoForm.horaIni || horaInicioRecurrente || undefined) : undefined,
      firstEncounterEndTime: isRecurrentAct ? (eventoForm.horaFin || horaFinRecurrente || undefined) : undefined,
      diasSemana: isRecurrentAct ? diasSemanaRecurrente : undefined,
      dias_semana: isRecurrentAct ? diasSemanaRecurrente : undefined,
      diaMes: isRecurrentAct ? diaMesRecurrente : undefined,
      dia_mes: isRecurrentAct ? diaMesRecurrente : undefined,
      cantidadEventos: isRecurrentAct ? cantidadEventosRecurrente : undefined,
      cantidad_eventos: isRecurrentAct ? cantidadEventosRecurrente : undefined,
    };

    const nameCollisionCheck = checkActivityNameCollision(eventoForm.nombre, editingProposalActivityId, activities);
    if (nameCollisionCheck.hasCollision) {
      showToast(nameCollisionCheck.reason || 'Ya existe una actividad con este nombre en Cartelera.');
      return;
    }

    const creationCheck = canUserCreateActivity(candidateActivity, currentUser, activities);
    if (!creationCheck.allowed) {
      showToast(creationCheck.reason || 'No podés crear ni proponer una actividad que coincida en día y horario con otra a la que estás inscripto/a.');
      return;
    }

    setIsPublishing(true);

    try {
      if (editingProposalActivityId) {
        await api.resubmitProposal(editingProposalActivityId, {
          title: eventoForm.nombre.trim(),
          shortDescription: eventoForm.avance.trim(),
          avance: eventoForm.avance.trim(),
          category: eventoForm.categoria,
          schedule: scheduleFinal,
          isRecurrent: isRecurrentAct,
          frequency: isRecurrentAct ? frecuenciaRecurrente : eventoForm.frecuencia,
          frecuencia: isRecurrentAct ? frecuenciaRecurrente : eventoForm.frecuencia,
          startDate: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : eventoForm.fechaIni,
          startTime: eventoForm.horaIni || horaInicioRecurrente || '',
          endDate: isRecurrentAct ? (computedEndDate || eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : (resolvedSingleFechaFin || eventoForm.fechaIni),
          endTime: eventoForm.horaFin || horaFinRecurrente || '',
          fechaIni: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : eventoForm.fechaIni,
          horaIni: eventoForm.horaIni || horaInicioRecurrente || '',
          fechaFin: isRecurrentAct ? (computedEndDate || eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : (resolvedSingleFechaFin || eventoForm.fechaIni),
          horaFin: eventoForm.horaFin || horaFinRecurrente || '',
          firstEncounterDate: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || undefined) : undefined,
          firstEncounterStartTime: isRecurrentAct ? (eventoForm.horaIni || horaInicioRecurrente || undefined) : undefined,
          firstEncounterEndTime: isRecurrentAct ? (eventoForm.horaFin || horaFinRecurrente || undefined) : undefined,
          diasSemana: isRecurrentAct ? diasSemanaRecurrente : undefined,
          dias_semana: isRecurrentAct ? diasSemanaRecurrente : undefined,
          diaMes: isRecurrentAct ? diaMesRecurrente : undefined,
          dia_mes: isRecurrentAct ? diaMesRecurrente : undefined,
          cantidadEventos: isRecurrentAct ? cantidadEventosRecurrente : undefined,
          cantidad_eventos: isRecurrentAct ? cantidadEventosRecurrente : undefined,
          direccion: eventoForm.direccion.trim(),
          lat: eventoForm.lat || -34.6068,
          lng: eventoForm.lng || -58.5647,
          tipoCupo: eventoForm.tipoCupo,
          cupoMax: eventoForm.tipoCupo === 'limitado' ? Number(eventoForm.cupoMax) || 20 : 999,
          description: eventoForm.descripcion.trim() || eventoForm.avance.trim(),
          descripcion: eventoForm.descripcion.trim() || eventoForm.avance.trim(),
          image: eventoForm.imagen || '',
          imagen: eventoForm.imagen || '',
          videoUrl: eventoForm.videoUrl || '',
          video_url: eventoForm.videoUrl || '',
          userFeedbackNote: userFeedbackInput.trim() || undefined,
          cerrarInscripcionAlIniciarPrimerEncuentro: isRecurrentAct && Boolean(eventoForm.cerrarInscripcionAlIniciarPrimerEncuentro)
        });

        setModalCrearEventoOpen(false);
        setEditingProposalActivityId(null);
        resetEventoForm();
        await refreshData();
        showToast('¡Modificaciones reenviadas con éxito! Tu propuesta volvió a revisión del moderador.');
        return;
      }

    const isInst = Boolean(
      eventoTipoCreacion === 'institucional' ||
      currentUser?.tipo === 'institucional' ||
      (currentUser as any)?.rol === 'institucional' ||
      (currentUser as any)?.esInstitucion
    );

    // 1. Crear la actividad
    const newAct = await api.createActivity({
      title: eventoForm.nombre.trim(),
      nombre: eventoForm.nombre.trim(),
      category: eventoForm.categoria,
      categoria: eventoForm.categoria,
      schedule: scheduleFinal,
      horario: scheduleFinal,
      startDate: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : eventoForm.fechaIni,
      endDate: isRecurrentAct ? (computedEndDate || eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : (resolvedSingleFechaFin || eventoForm.fechaIni),
      fechaIni: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : eventoForm.fechaIni,
      fechaFin: isRecurrentAct ? (computedEndDate || eventoForm.fechaPrimerEncuentro || eventoForm.fechaIni) : (resolvedSingleFechaFin || eventoForm.fechaIni),
      startTime: eventoForm.horaIni || horaInicioRecurrente || '',
      endTime: eventoForm.horaFin || horaFinRecurrente || '',
      horaIni: eventoForm.horaIni || horaInicioRecurrente || '',
      horaFin: eventoForm.horaFin || horaFinRecurrente || '',
      firstMeetingDate: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || undefined) : undefined,
      fechaPrimerEncuentro: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || undefined) : undefined,
      firstEncounterDate: isRecurrentAct ? (eventoForm.fechaPrimerEncuentro || undefined) : undefined,
      firstEncounterStartTime: isRecurrentAct ? (eventoForm.horaIni || horaInicioRecurrente || eventoForm.firstEncounterStartTime || undefined) : undefined,
      firstEncounterEndTime: isRecurrentAct ? (eventoForm.horaFin || horaFinRecurrente || eventoForm.firstEncounterEndTime || undefined) : undefined,
      diasSemana: isRecurrentAct ? diasSemanaRecurrente : undefined,
      dias_semana: isRecurrentAct ? diasSemanaRecurrente : undefined,
      diaMes: isRecurrentAct ? diaMesRecurrente : undefined,
      dia_mes: isRecurrentAct ? diaMesRecurrente : undefined,
      cantidadEventos: isRecurrentAct ? cantidadEventosRecurrente : undefined,
      cantidad_eventos: isRecurrentAct ? cantidadEventosRecurrente : undefined,
      frequency: isRecurrentAct ? frecuenciaRecurrente : undefined,
      frecuencia: isRecurrentAct ? frecuenciaRecurrente : undefined,
      location: eventoForm.direccion.trim(),
      direccion: eventoForm.direccion.trim(),
      lat: eventoForm.lat,
      lng: eventoForm.lng,
      capacity: eventoForm.tipoCupo === 'limitado' ? Number(eventoForm.cupoMax) : 0,
      shortDescription: eventoForm.avance.trim(),
      description: eventoForm.descripcion.trim(),
      descripcion: eventoForm.descripcion.trim(),
      image: eventoForm.imagen || '',
      videoUrl: eventoForm.videoUrl || '',
      video_url: eventoForm.videoUrl || '',
      isInstitutional: isInst,
      isRecurrent: isRecurrentAct,
      cerrarInscripcionAlIniciarPrimerEncuentro: isRecurrentAct && Boolean(eventoForm.cerrarInscripcionAlIniciarPrimerEncuentro),
      isApproved: isInst,
      proposalStatus: isInst ? 'aprobada' : 'pendiente',
      organizerId: currentUser?.id ? String(currentUser.id) : (currentUser?.apodo || currentUser?.usuario || ''),
      organizer: (currentUser as any)?.institucion || currentUser?.apodo || currentUser?.usuario || currentUser?.nombre || '',
      organizerName: (currentUser as any)?.institucion || currentUser?.apodo || currentUser?.usuario || currentUser?.nombre || '',
    });

      setModalCrearEventoOpen(false);
      resetEventoForm();

      if (newAct) {
        setActivities((prev: any[]) => {
          const list = prev || [];
          const exists = list.some(a => String(a.id) === String(newAct.id));
          return exists ? list.map(a => String(a.id) === String(newAct.id) ? newAct : a) : [newAct, ...list];
        });

        // Solo crear/vincular el chat grupal cuando la actividad ya está aprobada (nunca para propuestas vecinales pendientes)
        if (currentUser?.id && (isInst || newAct.isApproved || newAct.proposalStatus === 'aprobada')) {
          try {
            const actChat = await chatService.createActivityChat({
              activity: newAct,
              currentUser
            });
            if (actChat) {
              setChats((prev: any[]) => deduplicateChats([actChat, ...(prev || [])]));
            }
          } catch (chatErr) {
            console.warn('Aviso vinculando chat en frontend:', chatErr);
          }
        }
      }
      await refreshData().catch(() => {});

      if (isInst) {
        showToast('¡Actividad Oficial creada y publicada con éxito! Ya podés verla en la Cartelera y en Mi Agenda.');
        if (shouldTriggerActivityPublishedConfetti({
          isEditResubmission: false,
          isInst: true,
          createdActivity: newAct
        })) {
          launchCelebrationConfetti();
        }
      } else {
        showToast(`¡Gracias ${currentUser?.apodo || 'vecino'}! Tu propuesta "${newAct?.title || eventoForm.nombre}" fue enviada a revisión. Debe ser aprobada.`);
      }
    } catch (err: any) {
      console.error(err);
      showToast(err?.message || 'Error al procesar la actividad.');
    } finally {
      setIsPublishing(false);
    }
  }

  // Multi-media review upload: validates 45-second video duration and uploads to reviews-media bucket
  async function handleMultiMediaReviewFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (file.type.startsWith('video/')) {
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        const objectUrl = URL.createObjectURL(file);
        tempVideo.src = objectUrl;

        await new Promise<void>((resolve) => {
          tempVideo.onloadedmetadata = async () => {
            URL.revokeObjectURL(objectUrl);
            if (tempVideo.duration > 45) {
              showToast(`El video dura ${Math.round(tempVideo.duration)} seg. El límite máximo permitido es de 45 segundos.`);
              resolve();
              return;
            }
            showToast('Subiendo video al servidor...');
            try {
              const publicUrl = await uploadToStorage(file, 'reviews-media', 'resenas');
              setArchivosResena(prev => [...prev, publicUrl]);
              showToast('Video subido ✓');
            } catch (err: any) {
              console.error('Error al subir video a reviews-media:', err);
              showToast(err?.message || 'Error al subir el video.');
            }
            resolve();
          };
          tempVideo.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            showToast('No se pudo procesar el video seleccionado.');
            resolve();
          };
        });
      } else {
        showToast('Subiendo foto al servidor...');
        try {
          const publicUrl = await uploadToStorage(file, 'reviews-media', 'resenas');
          setArchivosResena(prev => [...prev, publicUrl]);
          showToast('Foto subida ✓');
        } catch (err: any) {
          console.error('Error al subir foto a reviews-media:', err);
          showToast(err?.message || 'Error al subir la foto.');
        }
      }
    }
  }

  // Remove individual photo from review
  function handleRemoveReviewMedia(indexToRemove: number) {
    setArchivosResena(prev => prev.filter((_, idx) => idx !== indexToRemove));
  }

  // Save review (create or edit)
  async function handleGuardarResena(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !resenaEditData || !resenaEditData.actividadId) {
      showToast('Faltan datos de la actividad para publicar la reseña.');
      return;
    }
    if (!textoResena.trim()) {
      showToast('Por favor, escribí tu opinión antes de publicar la reseña.');
      return;
    }
    const stars = Number(califEstrellas);
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) {
      showToast('Por favor, seleccioná una calificación de 1 a 5 estrellas.');
      return;
    }

    try {
      let userAuthorName = (currentUser?.apodo && !currentUser.apodo.includes('@'))
        ? currentUser.apodo.trim()
        : (currentUser?.usuario && !currentUser.usuario.includes('@')
          ? currentUser.usuario.trim()
          : (currentUser?.nombre && !currentUser.nombre.includes('@')
            ? currentUser.nombre.trim()
            : (currentUser?.apodo ? currentUser.apodo.split('@')[0] : (currentUser?.usuario ? currentUser.usuario.split('@')[0] : 'Vecino de CLUB65'))));

      if (resenaEditData.id) {
        await api.updateReview(resenaEditData.id, {
          texto: textoResena.trim(),
          estrellas: stars,
          media: archivosResena,
          foto: archivosResena[0] || null,
          autor: userAuthorName,
          userApodo: userAuthorName
        });
        showToast('¡Tu reseña fue actualizada correctamente!');
      } else {
        const createdReview = await api.createReview({
          actividadId: resenaEditData.actividadId,
          actividad: resenaEditData.actividad,
          estrellas: stars,
          texto: textoResena.trim(),
          media: archivosResena,
          foto: archivosResena[0] || null,
          autor: userAuthorName,
          userApodo: userAuthorName,
          usuarioId: currentUser?.id,
          avatar: currentUser?.avatar || null
        });
        showToast('¡Tu reseña y contenidos multimedia se han publicado con éxito en la comunidad!');
        if (shouldTriggerReviewPublishedConfetti({
          isEdit: false,
          textoResena,
          califEstrellas: stars,
          actividadId: resenaEditData.actividadId,
          hasUser: Boolean(currentUser),
          createdReview
        })) {
          launchCelebrationConfetti();
        }
      }
      setModalEscribirResenaOpen(false);
      setResenaEditData(null);
      setTextoResena('');
      setArchivosResena([]);
      await refreshData();
    } catch (err: any) {
      showToast(err.message || 'Error al guardar reseña');
    }
  }

  // Open Gallery Visor with all media items for the activity
  function openGalleryVisor(clickedMediaUrl: string, activityId: number | string) {
    if (isRetiredReviewMediaItem(clickedMediaUrl)) return;
    const activityReviews = reviews.filter(r => String(r.actividadId) === String(activityId) || (!activityId && String(r.actividadId) === '1'));
    const items: GalleryItem[] = [];

    activityReviews.forEach(r => {
      if (isReviewRetired(r)) return;
      const mediaList = r.media && r.media.length ? r.media : (r.foto ? [r.foto] : []);
      mediaList.forEach(url => {
        if (isRetiredReviewMediaItem(url)) return;
        items.push({
          reviewId: r.id,
          mediaUrl: url,
          autor: r.autor,
          estrellas: r.estrellas,
          fecha: r.fecha,
          texto: r.texto,
          actividad: r.actividad
        });
      });
    });

    if (items.length === 0) {
      setModalVisorImgShape('rect');
      setModalVisorImgSrc(clickedMediaUrl);
      return;
    }

    const clickedIdx = items.findIndex(it => it.mediaUrl === clickedMediaUrl);
    setGaleriaItems(items);
    setGaleriaIndex(clickedIdx !== -1 ? clickedIdx : 0);
    setModalGaleriaOpen(true);
  }

  function handleGaleriaPrev() {
    setGaleriaIndex(prev => (prev === 0 ? galeriaItems.length - 1 : prev - 1));
  }

  function handleGaleriaNext() {
    setGaleriaIndex(prev => (prev === galeriaItems.length - 1 ? 0 : prev + 1));
  }

  // Add contact
  async function handleAgendarContacto(nombre: string, localidad = '', avatar = '', avatarClass = 'bg-club-teal', bio = 'Miembro de la comunidad', foto?: string) {
    const cleanNombre = (nombre || '').toLowerCase().trim();
    if (!currentUser) return;

    const u = currentUser as any;
    if (
      isSelfUserOrContact({ nombre, localidad }, currentUser) ||
      (u.apodo && u.apodo.toLowerCase().trim() === cleanNombre) ||
      (u.usuario && u.usuario.toLowerCase().trim() === cleanNombre) ||
      (u.nombre && u.nombre.toLowerCase().trim() === cleanNombre) ||
      (u.institucion && String(u.institucion).toLowerCase().trim() === cleanNombre) ||
      (u.id && String(u.id).toLowerCase().trim() === cleanNombre) ||
      cleanNombre.startsWith('usr_')
    ) {
      showToast('No podés agendar a tu propio usuario.');
      return;
    }

    if (contacts.some((c: any) => (c.nombre || '').toLowerCase().trim() === cleanNombre)) {
      showToast(`${nombre} ya está en tus contactos.`);
      return;
    }

    const resolvedPhoto = foto || getUserPhotoByName(nombre) || allUsersMap[cleanNombre]?.avatar || (allUsersMap[cleanNombre] as any)?.foto;
    const newContact: Contact = {
      id: 'contact_' + Date.now(),
      nombre,
      detalle: `${localidad ? `${localidad} • ` : ''}Agendado`,
      avatar: avatar || nombre.slice(0, 2).toUpperCase(),
      avatarClass,
      bio,
      foto: resolvedPhoto
    };

    // 1. Actualización inmediata del estado en pantalla (excluyendo siempre al propio usuario)
    setContacts((prev: any[]) => {
      const map = new Map<string, Contact>();
      map.set(nombre.toLowerCase().trim(), newContact);
      filterContactsForUser(Array.isArray(prev) ? prev : [], currentUser).forEach((c: any) => {
        if (c?.nombre && !map.has(c.nombre.toLowerCase().trim())) {
          map.set(c.nombre.toLowerCase().trim(), c);
        }
      });
      return Array.from(map.values());
    });

    // 2. Persistencia local para que no se pierda al recargar
    try {
      const stored = JSON.parse(localStorage.getItem('club65_custom_contacts') || '[]');
      const filtered = stored.filter((c: any) => (c.nombre || '').toLowerCase().trim() !== cleanNombre && !isSelfUserOrContact(c, currentUser));
      filtered.unshift(newContact);
      localStorage.setItem('club65_custom_contacts', JSON.stringify(filtered));
    } catch (e) {}

    showToast(`¡${nombre} ha sido agregado a tus Contactos!`);

    // 3. Notificación a la API y persistencia en Supabase
    try {
      await api.addContact({
        id: newContact.id,
        nombre,
        detalle: newContact.detalle,
        avatar: newContact.avatar,
        avatarClass: newContact.avatarClass,
        bio: newContact.bio,
        foto: newContact.foto
      });
    } catch (err: any) {
      console.warn('Persistencia en backend diferida:', err);
    }
  }
  // Delete contact (desagendar)
  async function handleDesagendarContacto(contactId: string, contactNombre: string) {
    try {
      const cleanNombre = (contactNombre || '').toLowerCase().trim();
      setContacts(prev => prev.filter(c => c.id !== contactId && (c.nombre || '').toLowerCase().trim() !== cleanNombre));
      if (modalPerfilContacto?.id === contactId || (modalPerfilContacto?.nombre && modalPerfilContacto.nombre.toLowerCase().trim() === cleanNombre)) {
        setModalPerfilContacto(null);
      }
      try {
        const stored = JSON.parse(localStorage.getItem('club65_custom_contacts') || '[]');
        const filtered = stored.filter((c: any) => c.id !== contactId && (c.nombre || '').toLowerCase().trim() !== cleanNombre && !isHardcodedOrMockProfile(c) && !isSelfUserOrContact(c, currentUser));
        localStorage.setItem('club65_custom_contacts', JSON.stringify(filtered));
      } catch (e) {}
      await api.deleteContact(contactId, contactNombre);
      await refreshData();
      showToast(`${contactNombre} fue eliminado de tus contactos.`);
    } catch (err: any) {
      showToast(err.message || 'Error al eliminar contacto');
    }
  }

  // Create new group chat
  async function handleCrearNuevoGrupo(e: React.FormEvent) {
    e.preventDefault();
    const validation = validateGroupCreation(nombreNuevoGrupo, participantesSeleccionadosGrupo, currentUser, allUsersMap);
    if (!validation.valid) {
      showToast(validation.error || 'Por favor completá los datos del grupo.');
      return;
    }

    try {
      const u = currentUser as any;
      const myDisplayName = (u?.nombre || u?.institucion || u?.apodo || u?.usuario || 'Organizador').trim();
      const myId = String(u?.id || '').trim();

      // Participantes reales invitados que no sean el usuario ni bots/identificadores técnicos
      const cleanInvited = validation.cleanParticipants;

      const allParts = Array.from(new Set([
        myDisplayName,
        ...cleanInvited
      ].filter(Boolean)));

      if (allParts.length < 2) {
        showToast('Para crear un grupo debés invitar al menos a otro contacto.');
        return;
      }

      // Obtener los IDs de usuario reales para chat_participants
      const memberUserIds: string[] = [];
      for (const pName of cleanInvited) {
        const pNameLower = pName.toLowerCase().trim();
        const contact = contacts.find(c => (c.nombre || '').toLowerCase().trim() === pNameLower || String(c.id).toLowerCase() === pNameLower);
        let resolvedId = contact?.userId;
        if (!resolvedId && contact && contact.id && !contact.id.startsWith('contact_')) {
          resolvedId = contact.id;
        }
        if (!resolvedId) {
          const userObj = Object.values(allUsersMap).find((user: any) =>
            (user.apodo && user.apodo.toLowerCase().trim() === pNameLower) ||
            (user.usuario && user.usuario.toLowerCase().trim() === pNameLower) ||
            (user.nombre && user.nombre.toLowerCase().trim() === pNameLower) ||
            (user.id && String(user.id).toLowerCase() === pNameLower)
          );
          if (userObj?.id) {
            resolvedId = userObj.id;
          }
        }
        memberUserIds.push(resolvedId || contact?.userId || contact?.id || pName);
      }

      if (!currentUser) {
        showToast('Debés iniciar sesión para crear un grupo.');
        return;
      }

      const freshChat = await chatService.createGroupChat({
        nombre: nombreNuevoGrupo.trim(),
        foto_grupo_url: fotoNuevoGrupo || null,
        currentUser,
        memberUserIds
      });

      setChats((prevChats: any[]) => deduplicateChats([freshChat, ...(prevChats || [])]));
      markChatAsRead(freshChat.id);
      setChatLastReads(prev => ({ ...prev, [String(freshChat.id)]: Date.now() }));

      try {
        const stored = JSON.parse(localStorage.getItem('club65_custom_contacts') || '[]');
        if (stored.length > 0) {
          setContacts((prev: any[]) => {
            const map = new Map();
            filterContactsForUser([...(prev || []), ...stored], currentUser).forEach((c: any) => {
              if (c?.nombre) map.set(c.nombre.toLowerCase().trim(), c);
            });
            return Array.from(map.values());
          });
        }
      } catch (e) {}

      setModalCrearGrupoOpen(false);
      setNombreNuevoGrupo('');
      setFotoNuevoGrupo('');
      setParticipantesSeleccionadosGrupo([]);
      setActiveChatId(freshChat.id);

      showToast(`¡Grupo "${freshChat.title}" creado con éxito! Sos la moderadora.`);
    } catch (err: any) {
      showToast(err.message || 'Error al crear grupo');
    }
  }
  // Admin moderation
  async function handleAdminModerate(actId: number, action: 'approve' | 'reject') {
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión con una cuenta de moderación autenticada.');
      setModalLoginOpen(true);
      return;
    }
    try {
      await api.moderateActivity(actId, action);
      await refreshData();
      showToast(action === 'approve' ? 'Iniciativa vecinal aprobada y publicada en la cartelera.' : 'Propuesta rechazada.');
    } catch (err: any) {
      showToast(err.message || 'Error al moderar');
    }
  }

  async function handleGlobalBan(e: React.FormEvent) {
    e.preventDefault();
    if (!inputVetarGlobal.trim()) return;
    const userId = await resolveLoggedInActorId();
    if (!userId) {
      showToast('Debés iniciar sesión con una cuenta de moderación autenticada para aplicar sanciones.');
      setModalLoginOpen(true);
      return;
    }
    const cleanUser = inputVetarGlobal.trim().replace(/^@/, '');
    try {
      await api.addSanction({
        username: cleanUser,
        reason: sancionMotivoInput,
        comment: sancionComentarioInput.trim(),
        type: sancionTipoInput
      });
      setInputVetarGlobal('');
      setSancionComentarioInput('');
      await refreshData();
      showToast(`El usuario @${cleanUser} ha sido sancionado y registrado en la lista de suspensiones.`);
    } catch (err: any) {
      showToast(err.message || 'Error al sancionar usuario.');
    }
  }

  function descargarPlanillaPDF(tituloActividad: string, nomina: Array<{ nombre: string; contacto: string }>) {
    const jsPDFClass = (window as any).jspdf?.jsPDF || (window as any).jsPDF;
    if (!jsPDFClass) {
      showToast('No se pudo inicializar el generador de PDF. Podés intentar recargar la página.');
      return;
    }
    const doc = new jsPDFClass();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('CLUB65 - PLANILLA OFICIAL DE ASISTENCIA', 14, 20);

    doc.setFontSize(12);
    doc.text(`Actividad: ${tituloActividad || 'Actividad Comunitaria'}`, 14, 30);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Fecha de emisión: ${formatArgentinaDateOnly()}`, 14, 37);

    doc.setLineWidth(0.5);
    doc.line(14, 42, 196, 42);

    let y = 52;
    doc.setFont('helvetica', 'bold');
    doc.text('N°', 14, y);
    doc.text('Nombre y Apellido', 25, y);
    doc.text('Contacto de Emergencia', 95, y);
    doc.text('Firma de Asistencia', 155, y);
    doc.line(14, y + 2, 196, y + 2);

    y += 10;
    doc.setFont('helvetica', 'normal');

    nomina.forEach((p, idx) => {
      doc.text(`${idx + 1}`, 14, y);
      doc.text(p.nombre || '-', 25, y);
      doc.text(p.contacto || '-', 95, y);
      doc.line(155, y, 190, y);
      y += 10;
    });

    const safeFilename = (tituloActividad || 'Actividad').replace(/[^a-zA-Z0-9_-]/g, '_');
    doc.save(`Planilla_Asistencia_${safeFilename}.pdf`);
  }

  async function handleDescargarPlanillaActividad(act: Activity | undefined, rawEnrolledOverride?: any[]) {
    const cleanList = getCleanEnrolledList(rawEnrolledOverride ?? (act?.enrolledUsernames || []));
    let usersMap: Record<string, User> = {};
    try {
      usersMap = (allUsersMap && Object.keys(allUsersMap).length > 0)
        ? allUsersMap
        : await api.getUsers();
    } catch {
      usersMap = {};
    }
    const nomina = buildAttendanceNomina(cleanList, usersMap);
    descargarPlanillaPDF(act?.title || 'Actividad', nomina);
  }

  function isActCancelled(act: any): boolean {
    return isActCancelledLogic(act);
  }

  // Dynamic Locations extracted strictly from activities currently available in Cartelera
  const dynamicLocations = useMemo(() => {
    return extractDynamicLocations(activities, { currentUser });
  }, [activities, currentUser, isFilterMenuOpen]);

  useEffect(() => {
    if (filterLocation !== 'todas' && !dynamicLocations.includes(filterLocation)) {
      setFilterLocation('todas');
    }
  }, [dynamicLocations, filterLocation]);

  // Filtered activities with useMemo
  const actividadesFiltradas = useMemo(() => {
    return filterCarteleraActivities(activities, {
      category: currentCategory,
      searchQuery,
      frequency: filterFrequency,
      initiative: filterInitiative,
      timing: filterTiming,
      capacity: filterCapacity,
      location: filterLocation,
      currentUser
    });
  }, [
    activities,
    currentCategory,
    searchQuery,
    filterFrequency,
    filterInitiative,
    filterTiming,
    filterCapacity,
    filterLocation,
    currentUser
  ]);

  const filteredActivities = actividadesFiltradas;

  const agendaActivities = filterAgendaActivities(activities, currentUser, dismissedCancelledAgendaActIds);

  const activeAgendaActivitiesCount = agendaActivities.filter(
    a => !isActCancelled(a) && !isUserVettedFromActivity(a, currentUser)
  ).length;

  const {
    pendingActivities,
    proposalsPorEvaluar,
    proposalsModificacionesSolicitadas
  } = partitionPendingNeighborhoodProposals(activities);

  const activeChat = chats.find(c => 
    c && activeChatId !== null && activeChatId !== undefined && (
      String(c.id) === String(activeChatId) ||
      (c.activityId && String(c.activityId) === String(activeChatId))
    )
  );
  const modalActividad = modalCustomActivity || resolveActivityById(activities, modalDetalleId);

  const actividadOpiniones = activities.find(a => String(a.id) === String(modalOpinionesId));
  const targetOpinionesTitle = (modalOpinionesTitle || actividadOpiniones?.title || '').trim().toLowerCase();
  const opinionesActividad = filterReviewsForActivity(reviews, modalOpinionesId, targetOpinionesTitle);

  const closeModalDetalle = () => {
    setModalDetalleId(null);
    setModalCustomActivity(null);
  };

  const handleOpenChatActivityDetail = async (chat: Chat) => {
    setModalCustomActivity(null);
    const matched = resolveActivityForChat(chat, activities);
    if (matched) {
      setModalDetalleId(matched.id);
      return;
    }
    const rawActId = chat.activityId ?? (chat as any).actividad_id;
    if (rawActId !== undefined && rawActId !== null && String(rawActId).trim() !== '') {
      const fetched = await api.getActivityById(rawActId).catch(() => null);
      if (fetched) {
        setActivities(prev => (prev.some(a => String(a.id) === String(fetched.id)) ? prev : [...prev, fetched]));
        setModalDetalleId(fetched.id);
        return;
      }
    }
    showToast('No se encontró el detalle de esta actividad.');
  };

  const openVersionDetail = (v: ActivityVersion, baseAct: Activity) => {
    setModalCustomActivity({
      ...baseAct,
      id: -(baseAct.id * 100 + v.version),
      title: v.title,
      schedule: v.schedule,
      isRecurrent: typeof v.isRecurrent === 'boolean' ? v.isRecurrent : baseAct.isRecurrent,
      location: v.location,
      lat: typeof v.lat === 'number' && !isNaN(v.lat) ? v.lat : (baseAct.lat || -34.6068),
      lng: typeof v.lng === 'number' && !isNaN(v.lng) ? v.lng : (baseAct.lng || -58.5647),
      capacity: v.capacity,
      shortDescription: v.shortDescription || v.title,
      description: v.description,
      image: v.image || baseAct.image,
      videoUrl: v.videoUrl || '',
      video_url: v.videoUrl || ''
    });
    setModalDetalleId(baseAct.id);
  };

  // Calendar calculations
  const primerDiaSemana = new Date(calAnoActual, calMesActual, 1).getDay();
  const offsetLunes = primerDiaSemana === 0 ? 6 : primerDiaSemana - 1;
  const totalDiasMes = new Date(calAnoActual, calMesActual + 1, 0).getDate();
  const diasMesAnterior = new Date(calAnoActual, calMesActual, 0).getDate();

  const agendaCalendarMap: Record<number, string> = getAgendaCalendarDays(
    agendaActivities,
    currentUser,
    calAnoActual,
    calMesActual
  );

  const calNombreMesAno = `${NOMBRES_MESES[calMesActual]} ${calAnoActual}`;

  // Current active chat moderation flag
  const isCurrentUserModeratorOfActiveChat = Boolean(
    activeChat &&
    currentUser &&
    !isUserRemovedFromChat(activeChat, currentUser) &&
    !isUserLeftVoluntarilyFromChat(activeChat, currentUser) &&
    isUserGroupModerator(activeChat, currentUser, activities)
  );

  const isDarkMode = currentUser ? Boolean(currentUser.contrast) : guestContrast;
  const isHomeVisitante = !currentUser && currentView === 'home-visitante';
  const isVisitorCompactHeader =
    !currentUser &&
    (currentView === 'home-visitante' ||
      currentView === 'explorar' ||
      currentView === 'sobre-nosotros' ||
      currentView === 'soporte' ||
      currentView === 'accesibilidad');

  return (
    <div className={`min-h-screen flex flex-col overflow-x-clip ${isHomeVisitante ? 'bg-[#FCE0A2]' : 'bg-[#FCE0A2]'}`}>
      {/* BANNER DE COOKIES */}
      {showCookiesBanner && (
        <aside
          id="banner-cookies"
          className="fixed bottom-0 inset-x-0 bg-[#3D2114] text-amber-100 z-50 p-4 border-t-2 border-club-orange shadow-2xl"
        >
          <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-base">
            <div className="flex items-center gap-3 min-w-0">
              <i className="fa-solid fa-cookie-bite text-club-orange text-2xl flex-shrink-0" />
              <p className="leading-relaxed break-words">
                <strong>Este sitio utiliza cookies:</strong> Usamos cookies técnicas para recordar tu sesión y preferencias de accesibilidad. Podés aceptar todas o elegir solo las necesarias.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
              <button
                onClick={() => setShowCookiesBanner(false)}
                className="pill-btn px-4 py-2 bg-stone-700 hover:bg-stone-600 text-white text-base font-bold"
              >
                Solo necesarias
              </button>
              <button
                onClick={() => setShowCookiesBanner(false)}
                className="pill-btn px-5 py-2 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow-sm"
              >
                Aceptar
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* NAVBAR PRINCIPAL */}
      <nav className="bg-club-cream border-b-2 border-amber-200/60 sticky top-0 z-30 retro-shadow">
        <div className={`w-full ${isVisitorCompactHeader ? 'px-3 sm:px-6 md:px-8 py-2.5 sm:py-3 flex flex-nowrap' : 'px-4 sm:px-6 md:px-8 py-3 flex flex-wrap lg:flex-nowrap'} justify-between items-center gap-x-2 sm:gap-x-4 gap-y-2`}>
          {/* BRAND LOGO */}
          <button
            onClick={() => setCurrentView(currentUser ? 'explorar' : 'home-visitante')}
            className={`order-1 flex-shrink-0 flex items-center ${isVisitorCompactHeader ? 'gap-1.5 sm:gap-3' : 'gap-2 sm:gap-3'} text-left cursor-pointer border-none bg-transparent min-w-0 transition-transform duration-300 ease-out hover:scale-105`}
          >
            <div className={`${isVisitorCompactHeader ? 'w-8 h-8 sm:w-12 sm:h-12' : 'w-9 h-9 sm:w-12 sm:h-12'} flex-shrink-0 flex items-center justify-center`}>
              <img
                src={isDarkMode ? '/assets/aistudio/ISOTIPO_CLUB65_NEGATIVIZADO_7727b397.png' : '/assets/aistudio/ISOLOGO_5e044cb6.png'}
                alt="Club65 Isotipo"
                className="w-full h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div className={`${isVisitorCompactHeader ? 'h-7 sm:h-11' : 'h-8 sm:h-11'} flex items-center min-w-0`}>
              <img
                src={isDarkMode ? '/assets/aistudio/LOGO_CLUB65_NEGATIVIZADO_6eb1c78e.png' : '/assets/aistudio/LOGOTIPO_10cf9c66.png'}
                alt="CLUB65 Conectando Experiencias"
                className="h-full object-contain"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
          </button>

          {/* USER SESSION ACTIONS / DROPDOWN */}
          {currentUser && (
          <div
            className="order-2 lg:order-3 flex-shrink-0 relative min-w-0 max-w-full"
            onMouseEnter={() => {
              if (dropdownTimeoutRef.current) {
                clearTimeout(dropdownTimeoutRef.current);
                dropdownTimeoutRef.current = null;
              }
            }}
            onMouseLeave={() => {
              if (dropdownTimeoutRef.current) {
                clearTimeout(dropdownTimeoutRef.current);
              }
              dropdownTimeoutRef.current = setTimeout(() => {
                setUserDropdownOpen(false);
              }, 600);
            }}
          >
              <div>
                <button
                  onClick={() => {
                    if (dropdownTimeoutRef.current) clearTimeout(dropdownTimeoutRef.current);
                    setUserDropdownOpen(!userDropdownOpen);
                  }}
                  className="flex items-center gap-2 sm:gap-2.5 bg-amber-100/70 hover:bg-amber-100 border border-amber-200 px-3 py-1.5 sm:px-3.5 sm:py-1.5 rounded-full text-base transition cursor-pointer max-w-full min-w-0"
                >
                  <Avatar
                    user={currentUser}
                    size="sm"
                    onClick={(e) => {
                      if (currentUser?.avatar) {
                        e.stopPropagation();
                        setModalVisorImgShape('circle');
                        setModalVisorImgSrc(currentUser.avatar);
                      }
                    }}
                  />
                  <span className="font-bold text-club-brown truncate">
                    ¡Bienvenida/o, {currentUser.apodo}!
                  </span>
                  {currentUser.tipo === 'moderador' ? (
                    <span className="text-purple-700 flex-shrink-0" title="Administrador Oficial Verificado"><i className="fa-solid fa-circle-check" /></span>
                  ) : (currentUser.tipo === 'institucional' && currentUser.isVerified ? (
                    <span className="text-blue-600 flex-shrink-0" title="Institución Verificada"><i className="fa-solid fa-circle-check" /></span>
                  ) : null)}
                  <i className="fa-solid fa-chevron-down text-sm text-stone-500 ml-0.5 sm:ml-1 flex-shrink-0" />
                </button>

                {/* Dropdown Menu */}
                {userDropdownOpen && (
                  <div
                    onMouseEnter={() => {
                      if (dropdownTimeoutRef.current) {
                        clearTimeout(dropdownTimeoutRef.current);
                        dropdownTimeoutRef.current = null;
                      }
                    }}
                    className="absolute right-0 mt-1 w-72 max-w-[calc(100vw-1.5rem)] bg-white border border-amber-200 rounded-2xl shadow-xl z-50 py-1.5 text-base text-club-brown divide-y divide-amber-100"
                  >
                    <div className="px-3.5 py-2.5 bg-amber-50/70 rounded-t-2xl min-w-0">
                      <p className="font-black text-base text-club-brown truncate">{currentUser.apodo || currentUser.usuario}</p>
                      <p className="text-sm font-semibold mt-0.5">
                        {currentUser.tipo === 'moderador' ? (
                          <span className="text-purple-700 font-bold flex items-center gap-1.5">
                            <i className="fa-solid fa-shield-halved text-sm" /> Perfil de Administrador
                          </span>
                        ) : currentUser.tipo === 'institucional' ? (
                          <span className="text-blue-700 font-bold flex items-center gap-1.5">
                            <i className="fa-solid fa-landmark text-sm" /> Institución Verificada
                          </span>
                        ) : (
                          <span className="text-stone-500 flex items-center gap-1.5">
                            <i className="fa-solid fa-user text-sm" /> Perfil Personal
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="p-1">
                      {currentUser.tipo === 'moderador' && (
                        <button
                          onClick={() => {
                            setCurrentView('moderacion');
                            setUserDropdownOpen(false);
                          }}
                          className="w-full px-3 py-2 text-left hover:bg-purple-50 text-purple-800 rounded-xl flex items-center gap-2 font-bold cursor-pointer break-words"
                        >
                          <i className="fa-solid fa-shield-halved text-purple-700 flex-shrink-0" /> <span>Panel de Administración</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setProfileForm({
                            apodo: currentUser?.apodo || '',
                            bio: currentUser?.bio || '',
                            avatar: currentUser?.avatar || '',
                            contactoEmergencia: currentUser?.contactoEmergencia || ''
                          });
                          setModalEditProfileOpen(true);
                          setUserDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-amber-50 rounded-xl flex items-center gap-2 font-bold cursor-pointer break-words"
                      >
                        <i className="fa-solid fa-user-pen text-club-orange flex-shrink-0" /> <span>Mi Perfil {currentUser.tipo === 'moderador' ? '(Moderador)' : ''}</span>
                      </button>
                    </div>

                    <div className="p-1">
                      <button
                        onClick={() => {
                          setCurrentView('info-util');
                          setUserDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-amber-50 rounded-xl flex items-center gap-2 font-bold cursor-pointer break-words"
                      >
                        <i className="fa-solid fa-shield-heart text-emerald-600 flex-shrink-0" /> <span>Información Útil</span>
                      </button>
                      <button
                        onClick={() => {
                          setCurrentView('accesibilidad');
                          setUserDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-amber-50 rounded-xl flex items-center gap-2 font-bold cursor-pointer break-words"
                      >
                        <i className="fa-solid fa-universal-access text-club-teal flex-shrink-0" /> <span>Accesibilidad</span>
                      </button>
                    </div>

                    <div className="p-1">
                      <button
                        onClick={() => {
                          setCurrentView('soporte');
                          setUserDropdownOpen(false);
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-amber-50 rounded-xl flex items-center gap-2 font-bold cursor-pointer break-words"
                      >
                        <i className="fa-solid fa-headset text-stone-600 flex-shrink-0" /> <span>Soporte</span>
                      </button>
                    </div>

                    <div className="p-1">
                      <button
                        onClick={handleLogout}
                        className="w-full px-3 py-2 text-left hover:bg-rose-50 text-rose-700 rounded-xl flex items-center gap-2 font-bold cursor-pointer break-words"
                      >
                        <i className="fa-solid fa-arrow-right-from-bracket flex-shrink-0" /> <span>Cerrar sesión</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
          </div>
          )}

          {/* PESTAÑAS PRINCIPALES */}
          <div
            className={
              isVisitorCompactHeader
                ? 'order-2 lg:order-3 flex-shrink-0 flex items-center justify-end gap-1.5'
                : 'order-3 lg:order-2 w-full lg:w-auto lg:flex-1 min-w-0 flex items-center justify-center gap-1.5'
            }
          >
              {!isVisitorCompactHeader && canScrollTabsLeft && (
                <button
                  type="button"
                  onClick={() => scrollNavTabs('left')}
                  aria-label="Desplazar categorías hacia la izquierda"
                  title="Categorías anteriores"
                  className="w-8 h-8 rounded-full bg-white hover:bg-amber-50 border border-amber-300 text-club-brown shadow-xs flex items-center justify-center flex-shrink-0 cursor-pointer transition"
                >
                  <i className="fa-solid fa-chevron-left text-sm" />
                </button>
              )}

              <div
                ref={tabsScrollRef}
                onScroll={updateNavTabsScrollState}
                className="min-w-0 max-w-full flex items-center flex-nowrap gap-2 overflow-x-auto scroll-smooth py-1 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-amber-100/60 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-thumb]:bg-club-orange/45 hover:[&::-webkit-scrollbar-thumb]:bg-club-orange/75 [&::-webkit-scrollbar-thumb]:rounded-full"
              >
                {!isVisitorCompactHeader && (
                  <button
                    onClick={() => setCurrentView('explorar')}
                    className={`pill-btn px-3.5 sm:px-4 py-1.5 sm:py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer ${
                      currentView === 'explorar'
                        ? 'bg-club-orange text-white shadow-sm'
                        : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                    }`}
                  >
                    <i className="fa-solid fa-compass flex-shrink-0" /> <span>Cartelera</span>
                  </button>
                )}

                {!currentUser && (
                  <>
                    {(currentView === 'home-visitante' || currentView === 'sobre-nosotros') && (
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentView('sobre-nosotros');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`h-8 sm:h-9 px-2.5 sm:px-4 rounded-full text-xs sm:text-sm font-bold flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap shadow-2xs cursor-pointer transition ${
                          currentView === 'sobre-nosotros'
                            ? 'bg-club-orange text-white border border-club-orange'
                            : 'bg-white/85 hover:bg-amber-50 border border-amber-200/80 text-club-brown hover:text-club-orange-dark hover:border-amber-300'
                        }`}
                      >
                        <span>Sobre nosotros</span>
                      </button>
                    )}
                    {!isVisitorCompactHeader && (
                      <button
                        onClick={() => setCurrentView('info-util')}
                        className={`pill-btn px-3.5 sm:px-4 py-1.5 sm:py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer ${
                          currentView === 'info-util'
                            ? 'bg-club-orange text-white shadow-sm'
                            : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                        }`}
                      >
                        <i className="fa-solid fa-shield-heart text-emerald-600 flex-shrink-0" /> <span>Información Útil</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setCurrentView('accesibilidad')}
                      title="Accesibilidad"
                      aria-label="Accesibilidad"
                      className={
                        isVisitorCompactHeader
                          ? 'w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/85 hover:bg-amber-50 border border-amber-200/80 text-club-teal flex items-center justify-center shadow-2xs cursor-pointer transition text-sm sm:text-base flex-shrink-0'
                          : `pill-btn px-4 py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer ${
                              currentView === 'accesibilidad'
                                ? 'bg-club-orange text-white shadow-sm'
                                : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                            }`
                      }
                    >
                      <i className={`fa-solid fa-universal-access text-club-teal flex-shrink-0`} />
                      {!isVisitorCompactHeader && <span>Accesibilidad</span>}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentView('soporte')}
                      title="Soporte"
                      aria-label="Soporte"
                      className={
                        isVisitorCompactHeader
                          ? 'w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white/85 hover:bg-amber-50 border border-amber-200/80 text-stone-600 flex items-center justify-center shadow-2xs cursor-pointer transition text-sm sm:text-base flex-shrink-0'
                          : `pill-btn px-4 py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer ${
                              currentView === 'soporte'
                                ? 'bg-club-orange text-white shadow-sm'
                                : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                            }`
                      }
                    >
                      <i className={`fa-solid fa-headset text-stone-600 flex-shrink-0`} />
                      {!isVisitorCompactHeader && <span>Soporte</span>}
                    </button>
                  </>
                )}

                {currentUser && (
                  <>
                    {currentUser.tipo !== 'moderador' && (() => {
                    const hasCancelledAlert = hasAgendaCancellationAlert(
                      activities,
                      currentUser,
                      seenCancelledAgendaActIds,
                      dismissedCancelledAgendaActIds
                    );
                    return (
                      <button
                        onClick={() => setCurrentView('agenda')}
                        className={`pill-btn px-4 py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer relative ${
                          currentView === 'agenda'
                            ? 'bg-club-orange text-white shadow-sm'
                            : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                        }`}
                      >
                        <i className="fa-solid fa-calendar-check text-club-orange flex-shrink-0" /> <span>Mi Agenda</span>{' '}
                        <span className="bg-club-orange text-white text-sm px-2 py-0.5 rounded-full flex-shrink-0">
                          {activeAgendaActivitiesCount}
                        </span>
                        {hasCancelledAlert && (
                          <span className="flex h-2.5 w-2.5 relative ml-0.5 flex-shrink-0" title="Actividades canceladas">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600" />
                          </span>
                        )}
                      </button>
                    );
                  })()}

                  {currentUser.tipo !== 'moderador' && (() => {
                    const visibleRecent = filterAndSortRecentChats(chats, currentUser, activities);
                    const unreadChatCount = visibleRecent.reduce((acc, c) => {
                      if (!c || isChatDeletedForUser(c, currentUser)) return acc;
                      const isCurrent = currentView === 'chat' && activeChatId && (
                        String(c.id) === String(activeChatId) ||
                        (c.activityId && String(c.activityId) === String(activeChatId))
                      );
                      return acc + getChatUnreadCount(c, currentUser, chatLastReads, Boolean(isCurrent));
                    }, 0);
                    const hasUnread = unreadChatCount > 0;

                    return (
                      <button
                        onClick={() => setCurrentView('chat')}
                        className={`pill-btn px-4 py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer relative ${
                          currentView === 'chat'
                            ? 'bg-club-orange text-white shadow-sm'
                            : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                        }`}
                      >
                        <i className="fa-solid fa-comments text-club-teal flex-shrink-0" /> <span>Mi Chat</span>
                        {hasUnread && (
                          <span
                            className="inline-flex items-center justify-center bg-rose-600 text-white text-sm font-black min-w-[20px] h-[20px] px-1.5 rounded-full shadow-xs leading-none animate-pulse flex-shrink-0"
                            title={`${unreadChatCount} novedad(es) sin leer en chats`}
                          >
                            {unreadChatCount}
                          </span>
                        )}
                      </button>
                    );
                  })()}

                  {currentUser.tipo !== 'moderador' && (() => {
                    const isActOrganizer = (a: any): boolean => isActivityOwnedByUser(a, currentUser);
                    const hasModificaciones = activities.some(a =>
                      isActOrganizer(a) &&
                      a.proposalStatus === 'cambios_solicitados' &&
                      !a.changesSubmittedAt
                    );
                    const hasSuspensiones = hasMisActividadesSuspensionAlert(activities, currentUser, seenSuspendedActIds);
                    const hasRechazos = hasMisActividadesRejectedAlert(
                      activities,
                      currentUser,
                      seenRejectedProposalIds,
                      dismissedRejectedProposalIds
                    );
                    const showAlert = hasModificaciones || hasSuspensiones || hasRechazos;
                    return (
                      <button
                        onClick={() => setCurrentView('mis-actividades')}
                        className={`pill-btn px-4 py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer relative ${
                          currentView === 'mis-actividades'
                            ? 'bg-club-orange text-white shadow-sm'
                            : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                        }`}
                      >
                        <i className="fa-solid fa-list-check text-club-orange flex-shrink-0" /> <span>Mis Actividades</span>
                        {showAlert && (
                          <span className="flex h-2.5 w-2.5 relative ml-0.5 flex-shrink-0" title="Novedades en tus actividades">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600" />
                          </span>
                        )}
                      </button>
                    );
                  })()}

                  {currentUser.tipo === 'personal' && (
                    <button
                      onClick={() => setCurrentView('resenas')}
                      className={`pill-btn px-4 py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer ${
                        currentView === 'resenas'
                          ? 'bg-club-orange text-white shadow-sm'
                          : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                      }`}
                    >
                      <i className="fa-solid fa-star text-club-orange flex-shrink-0" /> <span>Mis Reseñas</span>
                    </button>
                  )}

                  {currentUser.tipo === 'personal' && (
                    <button
                      onClick={() => {
                  const isBanned = (sanctionsList || []).some((s: any) => {
                    const cur = String(currentUser?.username || currentUser?.apodo || currentUser?.id || '').toLowerCase().trim();
                    const sancUser = String(s.username || s.usuario || s.userId || '').toLowerCase().trim();
                    if (!cur || !sancUser || cur !== sancUser) return false;
                    if (s.type === 'permanente') return true;
                    if (s.expiresAt) return new Date(s.expiresAt).getTime() > Date.now();
                    return true;
                  });

                  if (isBanned) {
                    showToast('Tu cuenta tiene una sanción activa y no puede proponer actividades.');
                    return;
                  }

                  setEditingProposalActivityId(null);
                  setUserFeedbackInput('');
                  const userDraft = loadUserDraft(currentUser);
                  setEventoForm(userDraft);
                  setEventoImgLabel(userDraft.imagen ? 'Imagen guardada ✓' : 'Sin imagen seleccionada');
                  setEventoTipoCreacion('personal');
                  setModalCrearEventoOpen(true);
                }}
                      className="pill-btn px-4 py-2 text-base bg-club-blue text-club-brown hover:bg-club-orange hover:text-white border border-club-teal/30 flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer"
                    >
                      <i className="fa-solid fa-plus-circle flex-shrink-0" /> <span>Proponer Actividad</span>
                    </button>
                  )}

                  {currentUser.tipo === 'personal' && (
                    <button
                      onClick={() => setCurrentView('whatsapp-comunidad')}
                      className={`pill-btn px-4 py-2 text-base flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold cursor-pointer ${
                        currentView === 'whatsapp-comunidad'
                          ? 'bg-club-orange text-white shadow-sm'
                          : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                      }`}
                    >
                      <i className="fa-brands fa-whatsapp text-emerald-600 text-base flex-shrink-0" /> <span>Canal de WhatsApp</span>
                    </button>
                  )}

                  {currentUser.tipo === 'institucional' && (
                    <button
                      onClick={() => {
                        setEditingProposalActivityId(null);
                        setUserFeedbackInput('');
                        const userDraft = loadUserDraft(currentUser);
                        setEventoForm(userDraft);
                        setEventoImgLabel(userDraft.imagen ? 'Imagen guardada ✓' : 'Sin imagen seleccionada');
                        setEventoTipoCreacion('institucional');
                        setModalCrearEventoOpen(true);
                      }}
                      className="pill-btn px-4 py-2 text-base bg-club-orange text-white flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold sm:ml-auto shadow-sm cursor-pointer"
                    >
                      <i className="fa-solid fa-circle-plus flex-shrink-0" /> <span>Publicar actividad validada</span>
                    </button>
                  )}

                  {currentUser.tipo === 'moderador' && (
                    <button
                      onClick={() => setCurrentView('moderacion')}
                      className="pill-btn px-4 py-2 text-base bg-purple-700 text-white hover:bg-purple-800 flex items-center gap-2 flex-shrink-0 whitespace-nowrap font-bold sm:ml-auto shadow-sm cursor-pointer"
                    >
                      <i className="fa-solid fa-shield-halved flex-shrink-0" /> <span>Panel de Administración</span>{' '}
                      <span className="bg-amber-400 text-purple-900 font-black text-sm px-2 py-0.5 rounded-full flex-shrink-0">
                        {pendingActivities.length}
                      </span>
                    </button>
                  )}
                  </>
                )}
              </div>

              {!isVisitorCompactHeader && canScrollTabsRight && (
                <button
                  type="button"
                  onClick={() => scrollNavTabs('right')}
                  aria-label="Desplazar categorías hacia la derecha"
                  title="Más categorías"
                  className="w-8 h-8 rounded-full bg-white hover:bg-amber-50 border border-amber-300 text-club-brown shadow-xs flex items-center justify-center flex-shrink-0 cursor-pointer transition"
                >
                  <i className="fa-solid fa-chevron-right text-sm" />
                </button>
              )}
          </div>
        </div>
      </nav>

      {/* ÁREA DE CONTENIDO DEBAJO DEL HEADER */}
      <div
        className={
          isHomeVisitante
            ? 'flex-1 w-full flex flex-col'
            : 'relative flex-1 w-full flex flex-col bg-[#FCE0A2] overflow-x-clip pb-12'
        }
      >
        {!isHomeVisitante && <RetroAppBackground />}

        {/* CONTENEDOR PRINCIPAL */}
        <main
          className={
            isHomeVisitante
              ? 'flex-1 w-full flex flex-col'
              : 'relative z-10 w-[92%] md:w-[90%] max-w-[1440px] mx-auto pt-5 sm:pt-7 flex-1 flex flex-col space-y-5 sm:space-y-6'
          }
        >
        {/* CARTELERA: BANNER DE CONTEXTO Y SANCIONES */}
        <Cartelera sanctionsList={sanctionsList} />

        {/* HOME VISITANTE */}
        {isHomeVisitante && (
          <HomeVisitante
            onExplore={() => setCurrentView('explorar')}
            onRegister={() => setModalRegisterOpen(true)}
            onLogin={() => setModalLoginOpen(true)}
            isDarkMode={isDarkMode}
          />
        )}

        {/* SOBRE NOSOTROS (VISITANTE) */}
        {!currentUser && currentView === 'sobre-nosotros' && (
          <SobreNosotros
            onBack={() => {
              setCurrentView('home-visitante');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onExplore={() => {
              setCurrentView('explorar');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        )}

        {/* 1. VISTA EXPLORAR ACTIVIDADES */}
        {currentView === 'explorar' && (
          <section className="space-y-6">
            {!currentUser && (
              <div className="flex flex-wrap items-center justify-between pb-1">
                <button
                  type="button"
                  onClick={() => setCurrentView('home-visitante')}
                  className="pill-btn px-4 py-2 bg-white hover:bg-amber-100 text-club-brown border border-amber-300 font-bold text-base flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <i className="fa-solid fa-arrow-left text-club-orange" /> Volver a la página de inicio
                </button>
              </div>
            )}
            <div className="bg-white rounded-3xl p-4 sm:p-5 border border-amber-200/80 retro-shadow">
              <div className="flex flex-col gap-3">
                <div className="relative flex-1 min-w-0">
                  <i className="fa-solid fa-magnifying-glass absolute left-4 top-3.5 text-amber-800/40 text-lg" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscá por actividad, lugar o temática (ej: memoria, elongación)..."
                    className="w-full pl-12 pr-4 py-3 bg-amber-50/50 border border-amber-200 rounded-full text-club-brown placeholder-amber-800/40 text-base focus:outline-none focus:ring-2 focus:ring-club-orange"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setCurrentCategory('todas')}
                    className={`cat-pill px-4 py-2 rounded-full font-bold text-base cursor-pointer transition ${
                      currentCategory === 'todas'
                        ? 'bg-club-brown text-white shadow-xs'
                        : 'bg-amber-100 text-club-brown hover:bg-amber-200'
                    }`}
                  >
                    Todas
                  </button>
                  <button
                    onClick={() => setCurrentCategory('salud')}
                    className={`cat-pill px-4 py-2 rounded-full font-bold text-base cursor-pointer transition ${
                      currentCategory === 'salud'
                        ? 'bg-club-brown text-white shadow-xs'
                        : 'bg-amber-100 text-club-brown hover:bg-amber-200'
                    }`}
                  >
                    Salud y Movimiento
                  </button>
                  <button
                    onClick={() => setCurrentCategory('cultura')}
                    className={`cat-pill px-4 py-2 rounded-full font-bold text-base cursor-pointer transition ${
                      currentCategory === 'cultura'
                        ? 'bg-club-brown text-white shadow-xs'
                        : 'bg-amber-100 text-club-brown hover:bg-amber-200'
                    }`}
                  >
                    Cultura y Arte
                  </button>
                  <button
                    onClick={() => setCurrentCategory('social')}
                    className={`cat-pill px-4 py-2 rounded-full font-bold text-base cursor-pointer transition ${
                      currentCategory === 'social'
                        ? 'bg-club-brown text-white shadow-xs'
                        : 'bg-amber-100 text-club-brown hover:bg-amber-200'
                    }`}
                  >
                    Juegos y Mateadas
                  </button>
                  <button
                    onClick={() => setCurrentCategory('musica')}
                    className={`cat-pill px-4 py-2 rounded-full font-bold text-base cursor-pointer transition ${
                      currentCategory === 'musica'
                        ? 'bg-club-brown text-white shadow-xs'
                        : 'bg-amber-100 text-club-brown hover:bg-amber-200'
                    }`}
                  >
                    Música y Baile
                  </button>
                  <button
                    onClick={() => setCurrentCategory('tecnologia')}
                    className={`cat-pill px-4 py-2 rounded-full font-bold text-base cursor-pointer transition ${
                      currentCategory === 'tecnologia'
                        ? 'bg-club-brown text-white shadow-xs'
                        : 'bg-amber-100 text-club-brown hover:bg-amber-200'
                    }`}
                  >
                    Tecnología
                  </button>
                  <button
                    onClick={() => setCurrentCategory('memoria')}
                    className={`cat-pill px-4 py-2 rounded-full font-bold text-base cursor-pointer transition ${
                      currentCategory === 'memoria'
                        ? 'bg-club-brown text-white shadow-xs'
                        : 'bg-amber-100 text-club-brown hover:bg-amber-200'
                    }`}
                  >
                    Memoria
                  </button>
                  <button
                    onClick={() => setCurrentCategory('naturaleza')}
                    className={`cat-pill px-4 py-2 rounded-full font-bold text-base cursor-pointer transition ${
                      currentCategory === 'naturaleza'
                        ? 'bg-club-brown text-white shadow-xs'
                        : 'bg-amber-100 text-club-brown hover:bg-amber-200'
                    }`}
                  >
                    Naturaleza y Paseos
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="min-w-0">
                <h2 className="font-brand text-2xl sm:text-3xl font-bold text-club-brown">
                  Actividades Disponibles
                </h2>
                <p className="text-base text-club-brown/75 leading-relaxed">
                  Talleres deportivos, culturales y salidas barriales para adultos mayores
                </p>
              </div>

              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-sm font-bold bg-amber-200/60 px-3.5 py-1.5 rounded-full text-club-brown">
                  {actividadesFiltradas.length} disponibles
                </span>

                {/* Menú desplegable de filtros discreto y compacto */}
                <div className="relative" ref={filterMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsFilterMenuOpen(prev => !prev)}
                    className={`px-4 py-2 rounded-full text-base font-bold inline-flex items-center gap-2 cursor-pointer transition-all border shadow-xs ${
                      activeFiltersCount > 0
                        ? 'bg-amber-100 hover:bg-amber-200 border-amber-400 text-club-brown font-extrabold ring-2 ring-amber-300/60'
                        : 'bg-amber-50 hover:bg-amber-100 border-amber-300/80 text-club-brown/90'
                    }`}
                    aria-label="Filtrar actividades"
                    aria-expanded={isFilterMenuOpen}
                  >
                    <i className="fa-solid fa-filter text-amber-700 text-sm" />
                    <span>Filtrar actividades</span>
                    {activeFiltersCount > 0 ? (
                      <span className="w-6 h-6 rounded-full bg-club-orange text-white text-sm font-black flex items-center justify-center shadow-xs">
                        {activeFiltersCount}
                      </span>
                    ) : (
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                    )}
                  </button>

                  {/* Menú flotante / Popover de filtros */}
                  {isFilterMenuOpen && (
                    <div className="fixed inset-x-3 top-32 sm:inset-x-auto sm:top-auto sm:absolute sm:right-0 sm:mt-2 w-auto sm:w-[34rem] md:w-[44rem] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-9rem)] sm:max-h-[82vh] overflow-y-auto bg-white rounded-2xl sm:rounded-3xl border-2 border-amber-200 shadow-2xl p-3 sm:p-4 z-40 animate-in fade-in zoom-in-95 duration-150 retro-shadow flex flex-col">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-amber-100 mb-2.5">
                        <div className="flex items-center gap-2">
                          <i className="fa-solid fa-sliders text-club-orange text-xs sm:text-sm" />
                          <h3 className="font-bold text-sm sm:text-base text-club-brown">Filtros de Cartelera</h3>
                        </div>
                        {activeFiltersCount > 0 && (
                          <button
                            type="button"
                            onClick={handleResetFilters}
                            className="text-xs font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer"
                          >
                            Limpiar filtros
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-x-3.5 gap-y-2 text-xs text-club-brown">
                        {/* a) Frecuencia del encuentro */}
                        <div className="min-w-0 md:col-span-2 flex flex-col justify-between">
                          <label className="font-bold mb-1 text-xs text-club-brown flex items-center gap-1.5 leading-snug">
                            <i className="fa-solid fa-repeat text-amber-600 text-[0.7rem] shrink-0" />
                            <span>Frecuencia del encuentro</span>
                          </label>
                          <select
                            value={filterFrequency}
                            onChange={(e) => setFilterFrequency(e.target.value)}
                            className="w-full bg-amber-50/70 border border-amber-200 rounded-xl px-2.5 py-1.5 text-xs font-medium text-club-brown focus:outline-none focus:ring-2 focus:ring-amber-400"
                          >
                            <option value="todas">Todas</option>
                            <option value="unico">Encuentro único</option>
                            <option value="semanal">Recurrente: Semanal</option>
                            <option value="quincenal">Recurrente: Quincenal</option>
                            <option value="mensual">Recurrente: Mensual</option>
                          </select>
                        </div>

                        {/* b) Iniciativa */}
                        <div className="min-w-0 md:col-span-2 flex flex-col justify-between">
                          <label className="font-bold mb-1 text-xs text-club-brown flex items-center gap-1.5 leading-snug">
                            <i className="fa-solid fa-shield-halved text-amber-600 text-[0.7rem] shrink-0" />
                            <span>Iniciativa</span>
                          </label>
                          <select
                            value={filterInitiative}
                            onChange={(e) => setFilterInitiative(e.target.value)}
                            className="w-full bg-amber-50/70 border border-amber-200 rounded-xl px-2.5 py-1.5 text-xs font-medium text-club-brown focus:outline-none focus:ring-2 focus:ring-amber-400"
                          >
                            <option value="todas">Todas</option>
                            <option value="verificadas">Actividades verificadas</option>
                            <option value="vecinales">Iniciativas vecinales</option>
                          </select>
                        </div>

                        {/* c) Temporalidad / Fecha */}
                        <div className="min-w-0 md:col-span-2 flex flex-col justify-between">
                          <label className="font-bold mb-1 text-xs text-club-brown flex items-center gap-1.5 leading-snug">
                            <i className="fa-solid fa-calendar-days text-amber-600 text-[0.7rem] shrink-0" />
                            <span> Fecha</span>
                          </label>
                          <select
                            value={filterTiming}
                            onChange={(e) => setFilterTiming(e.target.value)}
                            className="w-full bg-amber-50/70 border border-amber-200 rounded-xl px-2.5 py-1.5 text-xs font-medium text-club-brown focus:outline-none focus:ring-2 focus:ring-amber-400"
                          >
                            <option value="cualquiera">Cualquier fecha</option>
                            <option value="este_mes">Este mes</option>
                            <option value="proximo_mes">Próximo mes</option>
                          </select>
                        </div>

                        {/* d) Cupo disponible */}
                        <div className="min-w-0 sm:col-span-2 md:col-span-3 flex flex-col justify-between">
                          <label className="font-bold mb-1 text-xs text-club-brown flex items-center gap-1.5 leading-snug">
                            <i className="fa-solid fa-users-line text-amber-600 text-[0.7rem] shrink-0" />
                            <span>Cupo disponible </span>
                          </label>
                          <select
                            value={filterCapacity}
                            onChange={(e) => setFilterCapacity(e.target.value)}
                            className="w-full bg-amber-50/70 border border-amber-200 rounded-xl px-2.5 py-1.5 text-xs font-medium text-club-brown focus:outline-none focus:ring-2 focus:ring-amber-400"
                          >
                            <option value="cualquiera">Cualquier cupo</option>
                            <option value="libre">Libre / Sin límite de cupo</option>
                            <option value="chico">Grupo chico (hasta 20 cupos)</option>
                            <option value="mediano">Grupo mediano (de 21 a 50 cupos)</option>
                            <option value="grande">Grupo grande (más de 50 cupos)</option>
                          </select>
                        </div>

                        {/* e) Ubicación (Localidades y Barrios dinámicos) */}
                        <div className="min-w-0 sm:col-span-2 md:col-span-3 flex flex-col justify-between">
                          <label className="font-bold mb-1 text-xs text-club-brown flex items-center gap-1.5 leading-snug">
                            <i className="fa-solid fa-location-dot text-amber-600 text-[0.7rem] shrink-0" />
                            <span>Ubicación </span>
                          </label>
                          <select
                            value={filterLocation}
                            onChange={(e) => setFilterLocation(e.target.value)}
                            className="w-full bg-amber-50/70 border border-amber-200 rounded-xl px-2.5 py-1.5 text-xs font-medium text-club-brown focus:outline-none focus:ring-2 focus:ring-amber-400"
                          >
                            <option value="todas">Todas las zonas disponibles</option>
                            {dynamicLocations.map((loc) => (
                              <option key={loc} value={loc}>
                                {loc}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="sticky bottom-0 bg-white/95 backdrop-blur-xs pt-2 mt-2.5 border-t border-amber-100 flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={handleResetFilters}
                          className="px-3 py-1 rounded-full text-xs sm:text-sm font-bold text-stone-600 hover:text-stone-900 hover:bg-amber-100/60 transition cursor-pointer"
                        >
                          Restablecer
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsFilterMenuOpen(false)}
                          aria-label="Cerrar filtros"
                          className="px-4 py-1 rounded-full text-xs sm:text-sm font-bold bg-club-orange hover:bg-club-orange-dark text-white transition shadow-xs cursor-pointer"
                        >
                          Listo
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Fila de badges de filtros activos cuando hay filtros aplicados */}
            {activeFiltersCount > 0 && (
              <div className="flex items-center gap-2 flex-wrap pt-1 animate-in fade-in">
                <span className="text-sm font-bold text-club-brown/80 flex items-center gap-1">
                  <i className="fa-solid fa-filter text-amber-600 text-sm" /> Filtros activos:
                </span>

                {filterFrequency !== 'todas' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    <span>
                      {filterFrequency === 'unico' && 'Encuentro único'}
                      {filterFrequency === 'semanal' && 'Recurrente: Semanal'}
                      {filterFrequency === 'quincenal' && 'Recurrente: Quincenal'}
                      {filterFrequency === 'mensual' && 'Recurrente: Mensual'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFilterFrequency('todas')}
                      className="hover:text-red-700 ml-1 cursor-pointer font-bold"
                      title="Quitar filtro"
                    >
                      ×
                    </button>
                  </span>
                )}

                {filterInitiative !== 'todas' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold bg-blue-100 text-blue-900 border border-blue-200">
                    <span>
                      {filterInitiative === 'verificadas' ? 'Actividades verificadas' : 'Iniciativas vecinales'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFilterInitiative('todas')}
                      className="hover:text-red-700 ml-1 cursor-pointer font-bold"
                      title="Quitar filtro"
                    >
                      ×
                    </button>
                  </span>
                )}

                {filterTiming !== 'cualquiera' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold bg-emerald-100 text-emerald-900 border border-emerald-200">
                    <span>{filterTiming === 'este_mes' ? 'Este mes' : 'Próximo mes'}</span>
                    <button
                      type="button"
                      onClick={() => setFilterTiming('cualquiera')}
                      className="hover:text-red-700 ml-1 cursor-pointer font-bold"
                      title="Quitar filtro"
                    >
                      ×
                    </button>
                  </span>
                )}

                {filterCapacity !== 'cualquiera' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold bg-purple-100 text-purple-900 border border-purple-200">
                    <span>
                      {filterCapacity === 'libre' && 'Libre / Sin límite'}
                      {filterCapacity === 'chico' && 'Grupo chico (≤ 20)'}
                      {filterCapacity === 'mediano' && 'Grupo mediano (21-50)'}
                      {filterCapacity === 'grande' && 'Grupo grande (> 50)'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFilterCapacity('cualquiera')}
                      className="hover:text-red-700 ml-1 cursor-pointer font-bold"
                      title="Quitar filtro"
                    >
                      ×
                    </button>
                  </span>
                )}

                {filterLocation !== 'todas' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    <span>{filterLocation}</span>
                    <button
                      type="button"
                      onClick={() => setFilterLocation('todas')}
                      className="hover:text-red-700 ml-1 cursor-pointer font-bold"
                      title="Quitar filtro"
                    >
                      ×
                    </button>
                  </span>
                )}

                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-sm font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer ml-1"
                >
                  Limpiar todos
                </button>
              </div>
            )}

            {actividadesFiltradas.length === 0 ? (
              <div className="bg-white rounded-3xl p-8 sm:p-14 border-2 border-dashed border-amber-300/80 text-center space-y-5 max-w-2xl mx-auto my-6 retro-shadow animate-in fade-in">
                <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto text-club-orange text-3xl shadow-xs">
                  <i className={`fa-solid ${activeFiltersCount > 0 ? 'fa-filter-circle-xmark' : 'fa-calendar-plus'}`} />
                </div>
                <div className="space-y-2">
                  <h3 className="font-brand text-xl sm:text-2xl font-bold text-club-brown leading-snug">
                    {activeFiltersCount > 0
                      ? 'No hay actividades disponibles con los filtros seleccionados.'
                      : 'No hay actividades disponibles por el momento. ¡Sé el primero en proponer una!'}
                  </h3>
                  <p className="text-stone-600 text-base max-w-md mx-auto leading-relaxed">
                    {activeFiltersCount > 0
                      ? 'Probá ajustando la frecuencia, fecha, cupo o ubicación para encontrar más propuestas de la comunidad.'
                      : 'Compartí un taller, una caminata, una partida de cartas o una mateada con los vecinos de la comunidad.'}
                  </p>
                </div>
                <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                  {activeFiltersCount > 0 && (
                    <button
                      type="button"
                      onClick={handleResetFilters}
                      className="pill-btn px-5 py-2.5 bg-amber-100 hover:bg-amber-200 text-club-brown font-bold text-base border border-amber-300 shadow-xs inline-flex items-center gap-2 cursor-pointer transition"
                    >
                      <i className="fa-solid fa-arrow-rotate-left text-sm" /> Restablecer filtros
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (currentUser) {
                        setEditingProposalActivityId(null);
                        setUserFeedbackInput('');
                        const userDraft = loadUserDraft(currentUser);
                        setEventoForm(userDraft);
                        setEventoImgLabel(userDraft.imagen ? 'Imagen guardada ✓' : 'Sin imagen seleccionada');
                        setEventoTipoCreacion(currentUser.tipo === 'institucional' ? 'institucional' : 'personal');
                        setModalCrearEventoOpen(true);
                      } else {
                        setModalLoginOpen(true);
                        showToast('Iniciá sesión o registrate para proponer una actividad comunitaria.');
                      }
                    }}
                    className="pill-btn px-6 py-3 bg-club-orange hover:bg-club-orange-dark text-white font-bold text-base shadow-md inline-flex items-center gap-2.5 cursor-pointer transition"
                  >
                    <i className="fa-solid fa-plus-circle text-lg" /> Proponer una actividad
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {actividadesFiltradas.map((act) => {
                  const isUserEnrolled = currentUser ? act.enrolledUsernames?.includes(currentUser.usuario) : false;
                  const isUserOrganizer = currentUser ? isActivityOwnedByUser(act, currentUser) : false;
                  const rawList = Array.isArray(act.enrolledUsernames)
                    ? act.enrolledUsernames
                    : Array.isArray((act as any).inscriptos)
                      ? (act as any).inscriptos
                      : [];

    const uniqueEnrolled = new Set(
      rawList
        .map((u: any) => {
          const val = typeof u === 'object' ? (u.id || u.usuario || u.apodo || u.nombre) : String(u || '');
          return String(val).toLowerCase().trim();
        })
        .filter(Boolean)
    );

    const inscriptosAct = uniqueEnrolled.size > 0 ? uniqueEnrolled.size : Number(act.enrolledCount || 0);
    const cuposLibresAct = Math.max(0, Number(act.capacity || 20) - inscriptosAct);
    const orgDisplay = resolveActivityOrganizerDisplay(act);

                  return (
                    <div
                      key={act.id}
                      className="bg-white rounded-3xl border border-amber-200 overflow-hidden retro-shadow flex flex-col justify-between min-w-0"
                    >
                      <div>
                        <div className="relative h-52 overflow-hidden bg-amber-100">
                          {act.image && typeof act.image === 'string' && act.image.trim() !== '' ? (
                            <img
                              src={act.image}
                              alt={act.title}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-amber-600 bg-amber-50">
                              <i className="fa-solid fa-shapes text-3xl mb-1 text-club-orange/40" />
                              <span className="text-sm font-bold text-amber-700/60">{act.category || 'Actividad'}</span>
                            </div>
                          )}
                          <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-1.5">
                            {orgDisplay.isInstitutional ? (
                              <span className="bg-blue-100 text-blue-900 border border-blue-200 text-sm font-bold px-3 py-1 rounded-full flex items-center gap-1.5">
                                <i className="fa-solid fa-circle-check text-blue-600" /> Institución Verificada
                              </span>
                            ) : isUserOrganizer ? (
                              <span className="bg-amber-200 text-amber-950 border border-amber-400 text-sm font-black px-3 py-1 rounded-full flex items-center gap-1.5">
                                <i className="fa-solid fa-star text-club-orange" /> Tu Iniciativa Aprobada
                              </span>
                            ) : (
                              <span className="bg-amber-100 text-amber-900 border border-amber-300 text-sm font-bold px-3 py-1 rounded-full flex items-center gap-1.5">
                                <i className="fa-solid fa-users text-club-orange" /> Actividad de la comunidad
                              </span>
                            )}

                            <span
                              className={`text-sm font-bold px-2.5 py-1 rounded-full border shadow-xs ${
                                act.isRecurrent
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : 'bg-purple-100 text-purple-900 border-purple-200'
                              }`}
                            >
                              <i className={`fa-solid ${act.isRecurrent ? 'fa-repeat text-club-orange' : 'fa-calendar-day text-purple-700'} mr-1`} />
                              {act.isRecurrent ? 'Encuentro recurrente' : 'Encuentro único'}
                            </span>
                          </div>

                          <div className="absolute bottom-2 right-2 bg-black/65 text-white text-sm px-3 py-1 rounded-full font-bold max-w-[calc(100%-1rem)] truncate">
                            <i className="fa-solid fa-clock" /> {act.schedule ? act.schedule.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1') : ''}
                          </div>
                        </div>

                        <div className="p-5 space-y-3">
                          <h3 className="font-brand text-xl font-bold text-club-brown break-words">{act.title}</h3>
                          <div className="flex items-center gap-2.5">
                            {orgDisplay.avatar && (
                              <img
                                src={orgDisplay.avatar}
                                alt={orgDisplay.name}
                                referrerPolicy="no-referrer"
                                className="w-9 h-9 rounded-full object-cover border border-amber-300 shadow-2xs flex-shrink-0 bg-white"
                                onError={(e) => {
                                  const img = e.currentTarget;
                                  img.classList.add('hidden');
                                  const fallback = img.nextElementSibling;
                                  if (fallback) {
                                    fallback.classList.remove('hidden');
                                    fallback.classList.add('flex');
                                  }
                                }}
                              />
                            )}
                            <div
                              className={`w-9 h-9 rounded-full ${orgDisplay.avatar ? 'hidden' : 'flex'} items-center justify-center text-sm font-bold shadow-2xs flex-shrink-0 ${
                                orgDisplay.isInstitutional ? 'bg-club-blue text-club-brown' : 'bg-club-orange text-white'
                              }`}
                            >
                              {orgDisplay.isInstitutional ? <i className="fa-solid fa-landmark" /> : <i className="fa-solid fa-user" />}
                            </div>
                            <div className="min-w-0 leading-snug">
                              <span className="text-sm font-bold uppercase tracking-wide text-stone-500 block">
                                Organizado por
                              </span>
                              <p className="text-base font-bold text-club-brown truncate flex items-center gap-1">
                                <span className="truncate">{orgDisplay.name}</span>
                                {orgDisplay.isInstitutional && (
                                  <i className="fa-solid fa-circle-check text-blue-600 text-sm flex-shrink-0" />
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="text-base font-semibold text-club-brown/85 bg-amber-50 p-3 rounded-xl border border-amber-200/60 flex items-center gap-2 min-w-0">
                            <i className="fa-solid fa-location-dot text-club-orange flex-shrink-0" />
                            <span className="break-words min-w-0">
                              {didOtherBlockMe(act.organizer)
                                ? 'El organizador te bloqueó'
                                : didIBlockUser(act.organizer) || isUserBlocked(act.organizer)
                                ? 'Desbloqueá al organizador para ver ubicación'
                                : act.location}
                            </span>
                          </div>
                          {Boolean(act.isRecurrent && (act.firstMeetingDate || act.fechaPrimerEncuentro)) && (
                            <div className="text-base font-semibold text-club-brown/85 bg-amber-50 p-3 rounded-xl border border-amber-200/60 flex items-center gap-2 min-w-0">
                              <i className="fa-solid fa-calendar-day text-club-orange flex-shrink-0" />
                              <span className="break-words min-w-0"><strong>1° encuentro:</strong> {formatFechaVisual(act.firstMeetingDate || act.fechaPrimerEncuentro)}</span>
                            </div>
                          )}
                          {/* Caratula de la actividad en Cartelera muestra el Avance Corto */}
                          <p className="text-base text-stone-600 line-clamp-2 leading-relaxed">
                            {act.shortDescription || act.description}
                          </p>
                        </div>
                      </div>

                      <div className="p-4 bg-amber-50/50 border-t border-amber-100 flex items-center justify-between gap-2 flex-wrap">
                        <div className="min-w-0">
                          {(() => {
                const isSinCupo = !act.capacity || Number(act.capacity) >= 999 || (act as any).tipoCupo === 'sin_limite' || (act as any).tipoCupo === 'ilimitado';
                const cupoTexto = isSinCupo ? 'Cupo libre' : `${inscriptosAct}/${act.capacity}`;

                if (isUserOrganizer) {
                  return (
                    <span className="text-sm font-bold text-club-orange flex items-center gap-1">
                      <i className="fa-solid fa-user-gear" /> Tu Encuentro ({cupoTexto})
                    </span>
                  );
                }

                if (isUserEnrolled) {
                  return (
                    <span className="text-emerald-700 font-black text-sm flex items-center gap-1">
                      <i className="fa-solid fa-circle-check" /> Inscripta/o ({cupoTexto})
                    </span>
                  );
                }

                const isRecurrentAct = Boolean(act.isRecurrent || (act as any).es_recurrente);
                const shouldCloseAct = Boolean(act.cerrarInscripcionAlIniciarPrimerEncuentro || (act as any).cerrar_inscripcion_al_iniciar_primer_encuentro);
                if (isRecurrentAct && shouldCloseAct && (hasFirstEncounterStarted(act) || hasFirstEncounterEnded(act))) {
                  return (
                    <span className="text-sm font-bold text-amber-800 bg-amber-100 px-3 py-1 rounded-full border border-amber-300 inline-flex items-center gap-1">
                      <i className="fa-solid fa-lock text-amber-700 text-sm" /> Inscripciones cerradas
                    </span>
                  );
                }

                return (
                  <span className="text-sm font-bold text-stone-600">
                    {isSinCupo ? 'Cupo libre' : `Cupo: ${cuposLibresAct} vacantes de ${act.capacity}`}
                  </span>
                );
              })()}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 ml-auto">
                          {isUserOrganizer && currentUser?.tipo === 'personal' && (
                            <button
                              onClick={() => setModalModeracionActividadId(act.id)}
                              className="pill-btn px-3.5 py-2 bg-amber-100 hover:bg-amber-200 text-club-brown text-base font-bold border border-amber-300 flex items-center gap-1 cursor-pointer"
                            >
                              <i className="fa-solid fa-sliders text-club-orange" /> Moderar mi actividad
                            </button>
                          )}
                          <button
                            onClick={() => setModalDetalleId(act.id)}
                            className="pill-btn px-4 py-2 bg-club-orange text-white text-base font-bold hover:bg-club-orange-dark shadow-sm cursor-pointer"
                          >
                            Ver detalles
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* 2. VISTA MI AGENDA */}
        {currentView === 'agenda' && (
          <section className="space-y-6">
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-amber-200 retro-shadow">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-amber-100 pb-4">
                <div className="min-w-0">
                  <h2 className="font-brand text-2xl sm:text-3xl font-bold text-club-brown flex items-center gap-2 flex-wrap">
                    <i className="fa-solid fa-calendar-days text-club-orange flex-shrink-0" /> <span>Tu Calendario de Encuentros</span>
                  </h2>
                  <p className="text-base text-club-brown/80 mt-1 leading-relaxed">
                    Días y horarios de las actividades donde ya estás inscripta/o o que organizás.
                  </p>
                </div>
                <span className="text-base font-bold bg-club-orange/10 text-club-orange px-4 py-2 rounded-full self-start sm:self-auto flex-shrink-0">
                  {calNombreMesAno}
                </span>
              </div>

              <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-1 bg-amber-50/70 p-4 rounded-2xl border border-amber-200/70 min-w-0">
                  <div className="text-center font-bold text-club-brown mb-3 flex items-center justify-between gap-2 px-1">
                    <button
                      onClick={() => {
                        if (calMesActual === 0) {
                          setCalMesActual(11);
                          setCalAnoActual(prev => prev - 1);
                        } else {
                          setCalMesActual(prev => prev - 1);
                        }
                      }}
                      className="w-9 h-9 rounded-full bg-white hover:bg-amber-100 text-club-brown flex items-center justify-center transition border border-amber-200 cursor-pointer flex-shrink-0"
                      aria-label="Mes anterior"
                    >
                      <i className="fa-solid fa-chevron-left text-sm" />
                    </button>
                    <span className="font-brand text-lg text-club-brown break-words">{calNombreMesAno}</span>
                    <button
                      onClick={() => {
                        if (calMesActual === 11) {
                          setCalMesActual(0);
                          setCalAnoActual(prev => prev + 1);
                        } else {
                          setCalMesActual(prev => prev + 1);
                        }
                      }}
                      className="w-9 h-9 rounded-full bg-white hover:bg-amber-100 text-club-brown flex items-center justify-center transition border border-amber-200 cursor-pointer flex-shrink-0"
                      aria-label="Mes siguiente"
                    >
                      <i className="fa-solid fa-chevron-right text-sm" />
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-sm font-bold text-club-brown/70 mb-2">
                    <span>Lu</span><span>Ma</span><span>Mi</span><span>Ju</span><span>Vi</span><span>Sá</span><span>Do</span>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-sm sm:text-base font-semibold">
                    {Array.from({ length: offsetLunes }).map((_, i) => (
                      <span key={`prev-${i}`} className="p-1.5 text-stone-300 text-sm">
                        {diasMesAnterior - offsetLunes + 1 + i}
                      </span>
                    ))}

                    {Array.from({ length: totalDiasMes }).map((_, i) => {
                      const d = i + 1;
                      const actTooltip = agendaCalendarMap[d];

                      if (actTooltip) {
                        return (
                          <span
                            key={`d-${d}`}
                            className="p-1.5 bg-club-orange text-white rounded-full font-bold text-sm shadow-sm cursor-pointer transition hover:scale-110 flex items-center justify-center"
                            title={actTooltip}
                          >
                            {d}
                          </span>
                        );
                      }
                      return (
                        <span key={`d-${d}`} className="p-1.5 hover:bg-amber-100 rounded-full cursor-pointer text-sm flex items-center justify-center">
                          {d}
                        </span>
                      );
                    })}
                  </div>

                  <div className="mt-4 pt-3 border-t border-amber-200 text-sm text-stone-600 flex items-start gap-2 leading-relaxed">
                    <span className="w-3.5 h-3.5 rounded-full bg-club-orange inline-block mt-1 flex-shrink-0" />
                    <span>Pasá el cursor sobre el día marcado para ver la actividad</span>
                  </div>
                </div>

                <div className="lg:col-span-2 space-y-4 min-w-0">
                  {agendaActivities.length === 0 ? (
                    <p className="text-base text-stone-500 py-6 text-center leading-relaxed">
                      No hay actividades programadas en tu agenda.
                    </p>
                  ) : (
                    agendaActivities.map((act) => {
                      const isVetoed = isUserVettedFromActivity(act, currentUser);
                      const isCancelled = isActivitySuspendedByAdmin(act) || isActivityCancelledByOrganizer(act) || isActCancelled(act);
                      const isAlertCard = isCancelled || isVetoed;
                      const isUnseenAlert = !seenCancelledAgendaActIds.some(id => String(id) === String(act.id));
                      const motivoCancelacion = isCancelled ? getSuspensionReasonText(act, bajasList) : '';
                      return (
                        <div
                          key={act.id}
                          className={`p-4 rounded-2xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                            isAlertCard
                              ? 'bg-rose-50/70 border-rose-300'
                              : 'bg-amber-50/60 border-amber-200'
                          }`}
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            {isVetoed ? (
                              <span className="text-sm font-black uppercase bg-rose-100 text-rose-800 border border-rose-300 px-3 py-0.5 rounded-full inline-flex items-center gap-1.5 flex-wrap">
                                {isUnseenAlert && (
                                  <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse flex-shrink-0" />
                                )}
                                <i className="fa-solid fa-user-slash text-rose-600" /> Fuiste vetado de esta actividad
                              </span>
                            ) : isCancelled ? (
                              <span className="text-sm font-black uppercase bg-rose-100 text-rose-800 border border-rose-300 px-3 py-0.5 rounded-full inline-flex items-center gap-1.5 flex-wrap">
                                {isUnseenAlert && (
                                  <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse flex-shrink-0" />
                                )}
                                <i className="fa-solid fa-ban text-rose-600" /> Actividad cancelada
                              </span>
                            ) : (
                              <span className="text-sm font-bold uppercase bg-amber-200 text-club-brown px-3 py-0.5 rounded-full inline-block">
                                {act.organizerId === currentUser?.id || act.organizerId === 'personal'
                                  ? 'Organizado por vos'
                                  : 'Próximo Encuentro'}
                              </span>
                            )}
                            <h4 className="font-bold text-lg text-club-brown mt-1 break-words">{act.title}</h4>
                            <p className="text-base text-stone-700 leading-relaxed break-words">
                              {act.schedule} • {act.location}
                            </p>
                            {isCancelled && motivoCancelacion && motivoCancelacion !== '-' && (
                              <p className="text-base text-rose-900 bg-white/90 px-3 py-2 rounded-lg border border-rose-200 mt-1.5 leading-relaxed break-words">
                                <strong>Motivo:</strong> {motivoCancelacion}
                              </p>
                            )}
                            {(act.firstMeetingDate || act.fechaPrimerEncuentro) && (
                            <p className="text-base text-stone-700 flex items-center flex-wrap gap-1.5 mt-0.5 leading-relaxed">
                              <i className="fa-regular fa-calendar text-club-orange text-sm flex-shrink-0" />
                              <span><strong>1° encuentro:</strong> {formatFechaVisual(act.firstMeetingDate || act.fechaPrimerEncuentro)}</span>
                            </p>
                          )}
                          </div>
                          <div className="flex items-center flex-wrap gap-2 flex-shrink-0">
                            {!isVetoed && (
                              <button
                                onClick={() => setModalDetalleId(act.id)}
                                className="pill-btn px-4 py-2 bg-white hover:bg-amber-100 border border-amber-300 text-club-brown text-base font-bold shadow-xs cursor-pointer"
                              >
                                Ver detalles
                              </button>
                            )}
                            {isAlertCard && (
                              <button
                                type="button"
                                onClick={() => handleRemoveCancelledFromAgenda(act.id)}
                                className="w-9 h-9 rounded-full bg-rose-100 hover:bg-rose-200 text-rose-700 flex items-center justify-center transition cursor-pointer flex-shrink-0 border border-rose-300 shadow-xs"
                                title={isVetoed ? "Quitar notificación de mi agenda" : "Quitar actividad cancelada de mi agenda"}
                                aria-label={isVetoed ? "Quitar notificación de mi agenda" : "Quitar actividad cancelada de mi agenda"}
                              >
                                <i className="fa-solid fa-xmark text-base" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 3. VISTA MIS ACTIVIDADES */}
        {currentView === 'mis-actividades' && (
          <section className="space-y-6">
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-amber-200 retro-shadow space-y-5 sm:space-y-6">
              <div className="border-b border-amber-100 pb-3">
                <h2 className="font-brand text-2xl sm:text-3xl font-bold text-club-brown flex items-center gap-2 flex-wrap">
                  <i className="fa-solid fa-list-check text-club-orange flex-shrink-0" /> <span>Mis Actividades</span>
                </h2>
                <p className="text-base text-stone-600 mt-1 leading-relaxed">
                  {currentUser?.tipo === 'institucional'
                    ? 'Supervisá tus talleres vigentes y analizá las valoraciones y fotos de talleres finalizados.'
                    : 'Supervisá las actividades comunitarias que propusiste y su estado de aprobación.'}
                </p>
              </div>

              {/* Vista Institucional */}
              {currentUser?.tipo === 'institucional' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap sm:flex-nowrap bg-amber-50 p-1.5 rounded-2xl border border-amber-200 w-full max-w-2xl gap-1.5">
                    <button
                      onClick={() => setSubTabMisActividades('moderar')}
                      className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer break-words ${
                        subTabMisActividades === 'moderar'
                          ? 'bg-club-orange text-white shadow-xs'
                          : 'text-club-brown hover:text-club-orange'
                      }`}
                    >
                      Moderar mis actividades
                    </button>
                    <button
                      onClick={() => setSubTabMisActividades('realizadas')}
                      className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer break-words ${
                        subTabMisActividades === 'realizadas'
                          ? 'bg-club-orange text-white shadow-xs'
                          : 'text-club-brown hover:text-club-orange'
                      }`}
                    >
                      Actividades realizadas (reseñas)
                    </button>
                  </div>

                  {subTabMisActividades === 'moderar' && (() => {
                    const actividadesInstVigentes = activities
                      .filter(a => {
                        if (!isActivityOwnedByUser(a, currentUser)) return false;
                        if (isActivitySuspendedByAdmin(a)) return true;
                        if (isActivityCancelledByOrganizer(a)) return false;

                        const isEnded = isActivityPast(a);
                        return !isEnded;
                      })
                      .sort((a, b) => getMyActivitiesSortingTime(b) - getMyActivitiesSortingTime(a));

                    if (actividadesInstVigentes.length === 0) {
                      return (
                        <div className="bg-white rounded-2xl p-8 border border-amber-200 text-center space-y-2">
                          <p className="text-lg font-bold text-club-brown">Todavía no tenés talleres ni actividades activas.</p>
                          <p className="text-base text-stone-600 leading-relaxed">Cuando publiques un taller institucional desde la Cartelera, vas a poder ver sus inscriptos y gestionarlo desde acá.</p>
                        </div>
                      );
                    }

                    return (
                    <div className="space-y-4">
                      {actividadesInstVigentes.map(act => {
                        if (isActivitySuspendedByAdmin(act)) {
                          const motivoBaja = getSuspensionReasonText(act, bajasList);
                          const isUnseenSusp = !seenSuspendedActIds.some(id => String(id) === String(act.id));
                          return (
                            <div key={act.id} className="p-4 bg-rose-50/80 rounded-2xl border-2 border-rose-300 space-y-2 shadow-xs animate-in fade-in">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-black bg-rose-100 text-rose-800 border border-rose-300 px-3 py-0.5 rounded-full uppercase inline-flex items-center gap-1.5 flex-wrap">
                                  {isUnseenSusp && (
                                    <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse flex-shrink-0" />
                                  )}
                                  <i className="fa-solid fa-ban text-rose-600" /> Actividad suspendida por la administración de CLUB65
                                </span>
                              </div>
                              <h4 className="font-bold text-lg text-stone-800 break-words">{act.title}</h4>
                              <p className="text-base text-stone-700 leading-relaxed break-words">{act.schedule} • {act.location}</p>
                              <div className="p-3 bg-white rounded-xl border border-rose-200 text-base text-rose-900 leading-relaxed break-words">
                                <strong>Motivo de la suspensión:</strong> {motivoBaja}
                              </div>
                            </div>
                          );
                        }
                        return (
                        <div
                          key={act.id}
                          className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center flex-wrap gap-2">
                              <span className="text-sm font-bold bg-emerald-100 text-emerald-800 px-3 py-0.5 rounded-full">
                                Taller en curso
                              </span>
                              <span className="text-sm text-stone-600">{act.schedule}</span>
                            </div>
                            {(act.firstMeetingDate || act.fechaPrimerEncuentro) && (
                            <p className="text-base text-stone-700 flex items-center flex-wrap gap-1.5 leading-relaxed">
                              <i className="fa-regular fa-calendar text-club-orange text-sm flex-shrink-0" />
                              <span><strong>1° encuentro:</strong> {formatFechaVisual(act.firstMeetingDate || act.fechaPrimerEncuentro)}</span>
                            </p>
                          )}
                            <h3 className="font-bold text-lg text-club-brown break-words">{act.title}</h3>
                           <p className="text-base text-stone-700 leading-relaxed break-words">
                          {(() => {
                            const inscritosCount = getCleanEnrolledList(act.enrolledUsernames || []).length;
                            const isSinCupo = !act.capacity || Number(act.capacity) >= 999 || (act as any).tipoCupo === 'sin_limite' || (act as any).tipoCupo === 'ilimitado';
                            const vacantes = Math.max(0, Number(act.capacity || 20) - inscritosCount);

                            return (
                              <>
                                <strong>Inscriptos:</strong> {isSinCupo ? `${inscritosCount} (Cupo libre)` : `${inscritosCount} de ${act.capacity || 20} (${vacantes} cupos libres)`} • <strong>Lugar:</strong>{' '}{act.location}
                              </>
                            );
                          })()}
                        </p>
                          </div>
                          <div className="flex flex-wrap gap-2 flex-shrink-0">
                            <button
                              onClick={() => setModalInscriptosId(act.id)}
                              className="pill-btn px-4 py-2 bg-club-blue text-club-brown text-base font-bold hover:bg-club-teal hover:text-white border border-amber-200 cursor-pointer"
                            >
                              <i className="fa-solid fa-users text-club-orange mr-1.5" /> Ver Inscriptos ({getCleanEnrolledList(act.enrolledUsernames || []).length})
                            </button>
                            <button
                              onClick={() => {
                                setMotivoCancelacionInput('Cancelada por el organizador');
                                setModalConfirmarCancelacion({
                                  id: act.id,
                                  nombre: act.title,
                                  dia: act.schedule,
                                  hora: '',
                                  tipo: 'institucional'
                                });
                              }}
                              className="pill-btn px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-base font-bold cursor-pointer"
                            >
                              <i className="fa-solid fa-ban text-rose-600 mr-1.5" /> Cancelar actividad
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    </div>
                    );
                  })()}

                  {subTabMisActividades === 'realizadas' && (
                    <div className="space-y-4">
                      {(() => {
              const actividadesInstFinalizadas = activities.filter(a => {
                if (!isActivityOwnedByUser(a, currentUser)) return false;

                return a.isRecurrent ? hasFirstEncounterEnded(a) : isActivityPast(a);
              });

              if (actividadesInstFinalizadas.length === 0) {
                return (
                  <div className="bg-white rounded-2xl p-8 border border-amber-200 text-center space-y-2">
                    <p className="text-lg font-bold text-club-brown">No tenés talleres ni actividades finalizadas aún.</p>
                    <p className="text-base text-stone-600 leading-relaxed">Cuando concluya la fecha u horario de un taller que supervisás, acá vas a poder consultar las opiniones y fotos de los participantes.</p>
                  </div>
                );
              }

              return (
                <div className="space-y-4">
                  {actividadesInstFinalizadas.map(act => {
                    const actReviews = reviews.filter(r => {
                    const rawR = r as any;
                    const rId = rawR.actividadId ?? rawR.activityId ?? rawR.actividad_id;
                    const rTitle = (rawR.actividad ?? rawR.title ?? '').trim().toLowerCase();
                    const actTitle = act.title?.trim().toLowerCase();

                    return (rId && String(rId).trim() === String(act.id).trim()) || (actTitle && rTitle === actTitle);
                  });
                  const reviewCount = actReviews.length;

                    const statusLabel = getActivityRealizadaStatusLabel(act);
                    const isEnCurso = statusLabel === 'ACTIVIDAD EN CURSO';

                    return (
                      <div key={act.id} className="bg-white p-5 rounded-2xl border border-amber-200 space-y-3 shadow-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={`text-sm font-bold uppercase tracking-wide px-3 py-0.5 rounded-full ${
                            isEnCurso
                              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                              : 'text-stone-600 bg-stone-100'
                          }`}>
                            {statusLabel} • {act.schedule ? act.schedule.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1') : ''}
                          </span>
                          <span className="text-base font-bold text-amber-600 flex items-center gap-1">
                            <i className="fa-solid fa-star" /> {reviewCount} {reviewCount === 1 ? 'reseña' : 'reseñas'}
                          </span>
                        </div>

                        <h3 className="font-bold text-lg text-club-brown break-words">{act.title}</h3>

                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-2 border-t border-amber-100">
                          <p className="text-base text-stone-700 leading-relaxed">
                            <i className="fa-solid fa-camera-retro text-club-orange mr-1.5" />
                            Fotos y opiniones aportadas por los vecinos ({reviewCount}).
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setResenasOriginActivityId(null);
                              setModalOpinionesTitle(act.title || null);
                              setModalOpinionesId(act.id);
                            }}
                            className="pill-btn px-4 py-2 bg-club-orange text-white text-base font-bold hover:bg-club-orange-dark shadow-sm cursor-pointer flex-shrink-0"
                          >
                            Ver opiniones y fotos
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
                    </div>
                  )}
                </div>
              )}

              {/* Vista Personal */}
              {currentUser?.tipo === 'personal' && (
                <div className="space-y-4">
            {filterPersonalMisActividades(activities, currentUser, dismissedRejectedProposalIds)
          .sort((a, b) => getMyActivitiesSortingTime(b) - getMyActivitiesSortingTime(a))
                  .map(p => {
                    if (isActivitySuspendedByAdmin(p)) {
                      const motivoBaja = getSuspensionReasonText(p, bajasList);
                      const isUnseenSusp = !seenSuspendedActIds.some(id => String(id) === String(p.id));
                      return (
                        <div key={p.id} className="p-4 bg-rose-50/80 rounded-2xl border-2 border-rose-300 space-y-2 shadow-xs animate-in fade-in">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black bg-rose-100 text-rose-800 border border-rose-300 px-3 py-0.5 rounded-full uppercase inline-flex items-center gap-1.5 flex-wrap">
                              {isUnseenSusp && (
                                <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse flex-shrink-0" />
                              )}
                              <i className="fa-solid fa-ban text-rose-600" /> Actividad suspendida por la administración de CLUB65
                            </span>
                          </div>
                          <h4 className="font-bold text-lg text-stone-800 break-words">{p.title}</h4>
                          <p className="text-base text-stone-700 leading-relaxed break-words">{p.schedule} • {p.location}</p>
                          <div className="p-3 bg-white rounded-xl border border-rose-200 text-base text-rose-900 leading-relaxed break-words">
                            <strong>Motivo de la suspensión:</strong> {motivoBaja}
                          </div>
                        </div>
                      );
                    }
                    if (isActivityCancelledByOrganizer(p)) {
                      const motivoOrg = getSuspensionReasonText(p, bajasList);
                      return (
                        <div key={p.id} className="p-4 bg-stone-50 rounded-2xl border border-stone-300 space-y-2 shadow-xs">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black bg-stone-200 text-stone-700 border border-stone-300 px-3 py-0.5 rounded-full uppercase inline-flex items-center gap-1.5">
                              <i className="fa-solid fa-ban text-stone-600" /> Actividad cancelada
                            </span>
                          </div>
                          <h4 className="font-bold text-lg text-stone-800 break-words">{p.title}</h4>
                          <p className="text-base text-stone-700 leading-relaxed break-words">{p.schedule} • {p.location}</p>
                          {motivoOrg && motivoOrg !== '-' && (
                            <div className="p-3 bg-white rounded-xl border border-stone-200 text-base text-stone-700 leading-relaxed break-words">
                              <strong>Motivo:</strong> {motivoOrg}
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (isProposalRejected(p)) {
                      const motivoRechazo = getRejectedProposalReason(p);
                      const isUnseenRechazo = !seenRejectedProposalIds.some(id => String(id) === String(p.id));
                      return (
                        <div key={p.id} className="p-4 bg-rose-50/80 rounded-2xl border-2 border-rose-300 space-y-2 shadow-xs animate-in fade-in">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-black bg-rose-100 text-rose-800 border border-rose-300 px-3 py-0.5 rounded-full uppercase inline-flex items-center gap-1.5 flex-wrap">
                                {isUnseenRechazo && (
                                  <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse flex-shrink-0" />
                                )}
                                <i className="fa-solid fa-circle-xmark text-rose-600" /> Propuesta rechazada
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleDismissRejectedProposal(p.id)}
                              className="w-9 h-9 rounded-full bg-rose-100 hover:bg-rose-200 text-rose-700 flex items-center justify-center transition cursor-pointer flex-shrink-0 border border-rose-300 shadow-xs"
                              title="Quitar propuesta rechazada de mi listado"
                              aria-label="Quitar propuesta rechazada de mi listado"
                            >
                              <i className="fa-solid fa-xmark text-base" />
                            </button>
                          </div>
                          <h4 className="font-bold text-lg text-stone-800 break-words">{p.title}</h4>
                          <p className="text-base text-stone-700 leading-relaxed break-words">{p.schedule} • {p.location}</p>
                          {motivoRechazo && (
                            <div className="p-3 bg-white rounded-xl border border-rose-200 text-base text-rose-900 leading-relaxed break-words">
                              <strong>Motivo:</strong> {motivoRechazo}
                            </div>
                          )}
                        </div>
                      );
                    }
                    if (p.isApproved) {
                      return (
                        <div
                          key={p.id}
                          className="p-4 bg-amber-50/80 rounded-2xl border-2 border-amber-300 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <span className="text-sm font-bold bg-emerald-100 text-emerald-800 px-3 py-0.5 rounded-full uppercase inline-block">
                              Aprobada y Publicada ✓
                            </span>
                            <h4 className="font-bold text-lg text-club-brown mt-1 break-words">{p.title}</h4>
                            <p className="text-base text-stone-700 leading-relaxed break-words">
                              {p.schedule} • {p.location} • Inscriptos: {p.enrolledUsernames ? p.enrolledUsernames.length : p.enrolledCount}/{p.capacity}
                            </p>
                          </div>
                          <button
                            onClick={() => setModalModeracionActividadId(p.id)}
                            className="pill-btn px-4 py-2 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow-sm cursor-pointer flex-shrink-0"
                          >
                            <i className="fa-solid fa-sliders mr-1.5" /> Moderar mi actividad
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div key={p.id} className="p-4 bg-amber-100/60 rounded-2xl border-2 border-amber-300 space-y-2.5 shadow-xs animate-in fade-in">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-black bg-amber-300 text-amber-950 px-3 py-0.5 rounded-full uppercase">
                            ⏳ Aprobación pendiente
                          </span>
                        {p.changesSubmittedAt ? (
                          <span className="text-sm font-black bg-emerald-100 text-emerald-800 px-3 py-0.5 rounded-full uppercase inline-flex items-center gap-1 border border-emerald-300 shadow-xs">
                            <i className="fa-solid fa-check" /> Modificaciones enviadas a revisión
                          </span>
                        ) : p.proposalStatus === 'cambios_solicitados' ? (
                          <span className="text-sm font-black bg-rose-100 text-rose-800 px-3 py-0.5 rounded-full uppercase inline-flex items-center gap-1.5 border border-rose-300 shadow-xs">
                            {!seenCancelledMisActividadesIds.includes(p.id) && (
                              <span className="w-2 h-2 rounded-full bg-rose-600 animate-pulse flex-shrink-0" />
                            )}
                            <i className="fa-solid fa-bell text-rose-600" /> Modificaciones solicitadas
                          </span>
                        ) : null}
                        <span className="text-base font-bold text-amber-900">En revisión de seguridad</span>
                      </div>
                      <h4 className="font-bold text-lg text-club-brown break-words">{p.title}</h4>
                      <p className="text-base text-stone-700 leading-relaxed break-words">{p.schedule} • {p.location}</p>
                      
                      <div className="p-3 bg-white/80 rounded-xl border border-amber-200 text-base text-amber-900 font-semibold flex items-start gap-2 leading-relaxed">
                        <i className="fa-solid fa-circle-exclamation text-club-orange text-base mt-1 flex-shrink-0" />
                        <span>Esta actividad no estará disponible en la Cartelera hasta que sea aprobada.</span>
                      </div>

                      {p.changesSubmittedAt ? (
                        <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-base text-emerald-900 font-semibold flex items-start gap-2 leading-relaxed">
                          <i className="fa-solid fa-clock-rotate-left text-emerald-600 text-base mt-1 flex-shrink-0" />
                          <span>Tus modificaciones fueron enviadas ({p.changesSubmittedAt}). La propuesta está en revisión del Administrador Oficial.</span>
                        </div>
                      ) : p.proposalStatus === 'cambios_solicitados' ? (
                        <div className="p-3.5 bg-white rounded-xl border-2 border-rose-300 text-base text-amber-950 space-y-2.5 shadow-xs">
                          <div className="flex items-center gap-1.5 font-bold text-rose-700">
                            <i className="fa-solid fa-comment-dots" /> Modificaciones solicitadas por el Administrador Oficial:
                          </div>
                          <p className="italic text-stone-700 font-medium leading-relaxed break-words">
                            "{p.proposalNote || 'Por favor revisá los detalles del punto de encuentro y los cupos asignados antes de la aprobación final.'}"
                          </p>
                          <div className="flex justify-end pt-1">
                            <button
                              onClick={() => {
                                const fallbackImg =
                                  p.image ||
                                  (p as any).imagen_url ||
                                  (Array.isArray(p.versions) && p.versions.length > 0
                                    ? (p.versions[p.versions.length - 1]?.image || '')
                                    : '') ||
                                  '';
                                const fallbackVideo = resolveActivityVideoUrl(p, p.versions);
                                const isRec = Boolean(p.isRecurrent || (p as any).is_recurrent || (p as any).es_recurrente || p.frequency === 'recurrente');
                                const recFreq = String((p as any).frecuencia_tipo || p.frequency || 'semanal').toLowerCase();
                                const normalizedRecFreq = ['semanal', 'quincenal', 'mensual'].includes(recFreq) ? recFreq : 'semanal';
                                const recDays = Array.isArray((p as any).diasSemana)
                                  ? (p as any).diasSemana
                                  : Array.isArray((p as any).dias_semana)
                                    ? (p as any).dias_semana
                                    : ['Lunes'];
                                const recCount = Number((p as any).cantidadEventos ?? (p as any).cantidad_eventos ?? 12) || 12;
                                const startTimeVal = p.horaIni || p.startTime || (p as any).hora_inicio || '18:00';
                                const endTimeVal = p.horaFin || p.endTime || (p as any).hora_fin || '20:00';
                                const firstEncDate = p.firstEncounterDate || (p as any).firstMeetingDate || (p as any).fechaPrimerEncuentro || p.fechaIni || p.startDate || (p as any).fecha_inicio || '';

                                setEditingProposalActivityId(p.id);
                                setUserFeedbackInput('');
                                setFrecuenciaRecurrente(normalizedRecFreq);
                                setDiasSemanaRecurrente(recDays);
                                setCantidadEventosRecurrente(recCount);
                                setHoraInicioRecurrente(startTimeVal);
                                setHoraFinRecurrente(endTimeVal);
                                if (p.schedule) setResumenRecurrente(p.schedule);
                                setEventoForm({
                                  nombre: p.title,
                                  avance: p.shortDescription || (p as any).avance || '',
                                  categoria: p.category,
                                  frecuencia: isRec ? 'recurrente' : 'unico',
                                  fechaIni: p.fechaIni || p.startDate || (p as any).fecha_inicio || '',
                                  horaIni: startTimeVal,
                                  fechaFin: p.fechaFin || p.endDate || (p as any).fecha_fin || p.fechaIni || p.startDate || '',
                                  horaFin: endTimeVal,
                                  fechaPrimerEncuentro: firstEncDate,
                                  firstEncounterStartTime: startTimeVal,
                                  firstEncounterEndTime: endTimeVal,
                                  direccion: p.direccion || p.location || (p as any).ubicacion || '',
                                  lat: typeof p.lat === 'number' ? p.lat : -34.6068,
                                  lng: typeof p.lng === 'number' ? p.lng : -58.5647,
                                  tipoCupo: !p.capacity || p.capacity >= 900 ? 'ilimitado' : 'limitado',
                                  cupoMax: p.capacity && p.capacity < 900 ? p.capacity : 20,
                                  descripcion: p.description,
                                  imagen: fallbackImg,
                                  videoUrl: fallbackVideo,
                                  cerrarInscripcionAlIniciarPrimerEncuentro: Boolean(p.cerrarInscripcionAlIniciarPrimerEncuentro)
                                });
                                setEventoImgLabel(fallbackImg ? 'Foto actual conservada ✓' : 'Sin imagen seleccionada');
                                setEventoTipoCreacion('personal');
                                setModalCrearEventoOpen(true);
                              }}
                              className="pill-btn px-4 py-2 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <i className="fa-solid fa-pen" /> Modificar y reenviar propuesta
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          </section>
        )}

        {/* 4. VISTA MI CHAT */}
        {currentView === 'chat' && (
          <section className="w-full flex-1 flex flex-col">
            <div className="w-full bg-[#FCF7EE] rounded-[28px] shadow-xl border border-[#ECCEA9]/80 overflow-hidden flex flex-col md:flex-row h-[78dvh] min-h-[540px] max-h-[680px] md:max-h-none md:h-[min(680px,calc(100dvh-13rem))]">
              {/* Panel Izquierdo: Lista de conversaciones (~32% en escritorio) */}
              <div className={`${activeChat ? 'hidden md:flex' : 'flex flex-1 min-h-0'} w-full md:flex-none md:w-[32%] md:min-w-[320px] md:max-w-[440px] md:h-full md:border-r border-[#E6B288]/60 bg-[#F1B485] flex-col min-w-0`}>
                <div className="p-4 sm:p-5 pb-3 space-y-2.5 flex-shrink-0 bg-[#F1B485]">
                  <h3 className="font-brand text-2xl sm:text-[1.7rem] font-extrabold text-[#3D1C0A] leading-tight">Mi Chat</h3>

                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {!isAdministratorUser(currentUser) && (
                      <button
                        onClick={() => setModalCrearGrupoOpen(true)}
                        className="px-3.5 py-1.5 bg-white hover:bg-[#FFF8EF] border border-[#ECC7A6] rounded-full text-sm font-bold text-[#3D1C0A] inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap transition"
                      >
                        <i className="fa-solid fa-users text-[#F16623] flex-shrink-0" /> <span>Crear Grupo</span>
                      </button>
                    )}
                    <button
                      onClick={() => setModalDirectorioOpen(true)}
                      className="px-3.5 py-1.5 bg-white hover:bg-[#FFF8EF] border border-[#ECC7A6] rounded-full text-sm font-bold text-[#3D1C0A] inline-flex items-center justify-center gap-1.5 shadow-sm cursor-pointer whitespace-nowrap transition"
                    >
                      <i className="fa-solid fa-address-book text-[#3994A4] flex-shrink-0" /> <span>Mis Contactos</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-3 sm:px-4 pb-4 space-y-2.5 bg-[#F1B485]">
                  {cancelledGroupNotices.map((notice) => (
                    <div
                      key={notice.id}
                      data-testid={`cancelled-group-notice-${notice.activityId}`}
                      className="p-3.5 rounded-2xl bg-white/90 border border-[#F16623]/40 shadow-xs flex items-start justify-between gap-2 text-base"
                    >
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <i className="fa-solid fa-circle-exclamation text-[#F16623] mt-1 text-base flex-shrink-0" />
                        <span className="italic text-[#3D1C0A] leading-relaxed break-words">
                          {buildCancelledGroupNoticeMessage(notice.activityTitle)}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDismissCancelledNotice(notice.id);
                        }}
                        className="text-stone-500 hover:text-[#3D1C0A] p-1 cursor-pointer flex-shrink-0 leading-none"
                        title="Cerrar notificación"
                        aria-label={`Cerrar notificación de ${notice.activityTitle}`}
                      >
                        <i className="fa-solid fa-xmark text-base" />
                      </button>
                    </div>
                  ))}

                  {(() => {
                    const visibleRecentChats = filterAndSortRecentChats(chats, currentUser, activities);
                    if (visibleRecentChats.length === 0 && cancelledGroupNotices.length === 0) {
                      return <p className="p-5 text-base font-semibold text-[#5E3A26] text-center leading-relaxed">No tenés conversaciones activas.</p>;
                    }

                    return visibleRecentChats.map((c) => {
                      const lastMsg = c.messages[c.messages.length - 1] || { text: 'Sin mensajes', time: '' };
                      const isCurrent = activeChatId !== null && activeChatId !== undefined && (
                        String(c.id) === String(activeChatId) ||
                        (c.activityId && String(c.activityId) === String(activeChatId))
                      );
                      const cDisplayTitle = getChatDisplayTitle(c, currentUser);
                      const cPhoto = getChatDisplayPhoto(c);
                      const unreadInChat = getChatUnreadCount(c, currentUser, chatLastReads, Boolean(isCurrent));

                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            setActiveChatId(c.id);
                          }}
                          className={`rounded-2xl p-3.5 cursor-pointer transition flex items-center gap-3 relative ${
                            isCurrent
                              ? 'bg-[#FFFFFF] border-2 border-[#F16623]/55 shadow-md'
                              : 'bg-[#FCE5CE]/75 hover:bg-[#FFF4E8] border border-white/60 shadow-2xs'
                          }`}
                        >
                          <div className="relative flex-shrink-0">
                            <div
                              className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-base overflow-hidden shadow-xs ${
                                c.type === 'grupal' ? 'bg-[#F16623] text-white' : 'bg-[#3994A4] text-white'
                              }`}
                            >
                              {cPhoto ? (
                                <img
                                  src={cPhoto}
                                  alt={cDisplayTitle}
                                  className="w-full h-full object-cover aspect-square rounded-full cursor-pointer hover:opacity-90 transition"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setModalVisorImgShape('circle');
                                    setModalVisorImgSrc(cPhoto);
                                  }}
                                  title="Hacé clic para ver foto ampliada"
                                />
                              ) : c.type === 'grupal' ? (
                                <i className="fa-solid fa-users" />
                              ) : (
                                (cDisplayTitle || '?').charAt(0)
                              )}
                            </div>
                            {unreadInChat > 0 && (
                              <span
                                className="absolute -top-1 -right-1 bg-rose-600 text-white text-sm font-black min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center border-2 border-white shadow-xs animate-pulse"
                                title={`${unreadInChat} novedad(es) sin leer`}
                              >
                                {unreadInChat}
                              </span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <h5 className="text-base truncate font-extrabold text-[#3D1C0A] min-w-0 flex-1">{cDisplayTitle}</h5>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {unreadInChat > 0 && (
                                  <span
                                    className="bg-rose-600 text-white text-sm font-black min-w-[22px] h-[22px] px-1.5 rounded-full flex items-center justify-center shadow-xs"
                                    title={`${unreadInChat} novedad(es) sin leer`}
                                  >
                                    {unreadInChat}
                                  </span>
                                )}
                                <span className={`text-sm whitespace-nowrap ${unreadInChat > 0 ? 'font-bold text-rose-600' : 'text-[#6D4C3D]'}`}>
                                  {formatArgentinaTimeOnly(lastMsg.time || lastMsg.createdAt || (lastMsg as any).created_at)}
                                </span>
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenChatMenuId(prev => (prev != null && String(prev) === String(c.id) ? null : c.id));
                                    }}
                                    className="w-8 h-8 rounded-full flex items-center justify-center text-[#6D4C3D] hover:text-[#3D1C0A] hover:bg-[#F7C59F]/60 transition cursor-pointer"
                                    title="Opciones de chat"
                                    aria-label={`Opciones del chat ${cDisplayTitle}`}
                                  >
                                    <i className="fa-solid fa-ellipsis-vertical text-base" />
                                  </button>

                                  {openChatMenuId != null && String(openChatMenuId) === String(c.id) && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-30"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenChatMenuId(null);
                                        }}
                                      />
                                      <div
                                        className="absolute right-0 top-9 bg-white text-[#3D1C0A] rounded-2xl shadow-xl border border-amber-200 py-1.5 z-40 min-w-[180px] text-base animate-in fade-in zoom-in-95"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <button
                                          type="button"
                                          onClick={async (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setOpenChatMenuId(null);
                                            await handleDeleteChatForMe(c.id);
                                          }}
                                          className="w-full px-4 py-2 text-left hover:bg-rose-50 text-rose-700 font-bold flex items-center gap-2 cursor-pointer transition text-base"
                                        >
                                          <i className="fa-solid fa-trash-can text-rose-600 text-base" />
                                          <span>Borrar chat</span>
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`font-bold text-sm px-2 py-0.5 rounded-full flex-shrink-0 leading-tight ${
                                c.type === 'grupal' ? 'bg-[#FDE2CD] text-[#A94110]' : 'bg-[#D6EEF2] text-[#246A76]'
                              }`}>
                                {c.type === 'grupal' ? 'Grupo' : 'Privado'}
                              </span>
                              <p className="text-sm text-[#5E4032] truncate leading-snug min-w-0 flex-1">
                              {(() => {
                                if (!lastMsg.text || lastMsg.text === 'Sin mensajes') return lastMsg.text || 'Sin mensajes';

                                const uAny = currentUser as any;
                                const myTokens = currentUser ? [
                                  currentUser.id,
                                  currentUser.usuario,
                                  currentUser.apodo,
                                  currentUser.nombre,
                                  uAny?.institucion,
                                  uAny?.nombreCompleto,
                                  uAny?.username,
                                  uAny?.name
                                ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim()) : [];

                                const mAny = lastMsg as any;
                                const senderTokens = [
                                  lastMsg.senderId,
                                  lastMsg.sender,
                                  mAny?.autor,
                                  mAny?.userId,
                                  mAny?.author
                                ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

                                const isSysLast = lastMsg.sender === 'Sistema CLUB65' ||
                                  lastMsg.senderId === 'system' ||
                                  lastMsg.senderId === 'sistema' ||
                                  (lastMsg as any).role === 'sistema';
                                if (isSysLast) {
                                  const relatedAct = activities.find((a: any) =>
                                    (c.activityId && String(a.id) === String(c.activityId)) ||
                                    (a.title && c.name && a.title.trim().toLowerCase() === String(c.name).trim().toLowerCase())
                                  );
                                  return formatActivitySystemNotice(lastMsg.text, c, relatedAct, lastMsg.replyTo || (lastMsg as any).reply_to);
                                }

                                const isMine = Boolean(currentUser && senderTokens.some(tok => myTokens.includes(tok)));

                                if (isMine) {
                                  return `Vos: ${lastMsg.text}`;
                                }

                                const senderName = resolveSenderDisplayName(lastMsg.sender, lastMsg.senderId, allUsersMap, cDisplayTitle);

                                return `${senderName}: ${lastMsg.text}`;
                              })()}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Panel Derecho: Ventana de conversación activa (~68% en escritorio) */}
              <div className={`${activeChat ? 'flex' : 'hidden md:flex'} flex-1 min-h-0 min-w-0 flex-col bg-[#FCF7EE] relative`}>
                {!activeChat ? (
                  <div className="relative flex-1 bg-[#FCF7EE] flex flex-col items-center justify-center p-6 text-center z-10 space-y-4 overflow-hidden">
                    <ChatWatermark />
                    <div className="relative z-10 w-24 h-24 rounded-full bg-[#FDE2CD] dark:bg-[#273142] flex items-center justify-center border-2 border-[#ECC7A6] dark:border-[#52647F] shadow-inner">
                      <img
                        src={isDarkMode ? '/assets/aistudio/ISOTIPO_CLUB65_NEGATIVIZADO_7727b397.png' : '/assets/aistudio/ISOLOGO_5e044cb6.png'}
                        alt="Club65"
                        className="w-14 h-14 object-contain"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                    <div className="relative z-10 max-w-md space-y-2">
                      <h4 className="font-brand text-2xl font-bold text-[#3D1C0A]">CLUB65 Conectando Experiencias</h4>
                      <p className="text-base text-[#5E4032] leading-relaxed">
                        Seleccioná una conversación a la izquierda o comunicate con tus grupos de actividades barriales.
                      </p>
                    </div>
                    <span className="relative z-10 text-sm text-[#A94110] font-bold bg-[#F7D3B4]/85 px-5 py-2 rounded-full border border-[#E8BA92]">
                      <i className="fa-solid fa-lock text-sm mr-1.5" /> Mensajes seguros entre vecinos e instituciones
                    </span>
                  </div>
                ) : (() => {
                  const isUserRemovedFromActiveChat =
                    isUserRemovedFromChat(activeChat, currentUser) ||
                    isUserVetoedFromChat(activeChat, currentUser);
                  const rawPartsHeader = getVisibleParticipantsForUser(activeChat, currentUser);
  const myHeaderTokens = [
    (currentUser?.id || '').toLowerCase(),
    (currentUser?.usuario || '').toLowerCase(),
    (currentUser?.apodo || '').toLowerCase(),
    (currentUser?.nombre || '').toLowerCase()
  ].filter(Boolean);

  let selfHeaderCount = 0;
  const visibleParticipants = rawPartsHeader.filter((p: string) => {
    if (!p || isDummyOrSystemParticipant(p)) return false;
    const cleanP = String(p).toLowerCase().trim();
    const isMe = myHeaderTokens.includes(cleanP) || cleanP.startsWith('usr_');

    if (isMe) {
      selfHeaderCount++;
      return selfHeaderCount === 1;
    }
    return true;
  });

                  return (
                    <div className="flex-1 min-h-0 flex flex-col h-full">
                      {/* Cabecera del chat activo con borde inferior festón ondulado */}
                      <div className="relative z-20 flex-shrink-0">
                        <div className="px-4 sm:px-6 py-3 sm:py-3.5 bg-white flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 sm:gap-3">
                          <div className="md:hidden">
                            <button
                              type="button"
                              onClick={() => setActiveChatId(null)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-[#FCE5CE] hover:bg-[#F7C59F] text-[#3D1C0A] font-bold text-sm cursor-pointer border border-[#ECC7A6] transition whitespace-nowrap"
                              title="Volver a chats"
                              aria-label="Volver a chats"
                            >
                              <i className="fa-solid fa-arrow-left text-sm" />
                              <span>Volver a chats</span>
                            </button>
                          </div>
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-lg shadow-sm flex-shrink-0 overflow-hidden ${
                                activeChat.type === 'grupal' ? 'bg-[#F16623] text-white' : 'bg-[#3994A4] text-white'
                              }`}
                            >
                              {getChatDisplayPhoto(activeChat) ? (
                                <img src={getChatDisplayPhoto(activeChat)} alt={getChatDisplayTitle(activeChat, currentUser)} className="w-full h-full object-cover aspect-square rounded-full" />
                              ) : activeChat.type === 'grupal' ? (
                                <i className="fa-solid fa-users" />
                              ) : (
                                (getChatDisplayTitle(activeChat, currentUser) || '?').charAt(0)
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <h4 className="font-bold text-lg sm:text-xl text-[#3D1C0A] break-words leading-snug">{getChatDisplayTitle(activeChat, currentUser)}</h4>
                              </div>
                              <p className="text-sm">
                                {activeChat.type === 'grupal' ? (
                                  <button
                                    onClick={() => setModalVerParticipantesOpen(true)}
                                    className="text-[#5E4032] hover:text-[#3994A4] hover:underline font-semibold inline-flex items-center gap-1 cursor-pointer text-sm text-left break-words max-w-full"
                                  >
                                    <span>Ver participantes ({(() => {
                                      const relatedAct = activities.find((a: any) =>
                                        (activeChat.activityId && String(a.id) === String(activeChat.activityId)) ||
                                        (a.title && activeChat.name && a.title.trim().toLowerCase() === String(activeChat.name).trim().toLowerCase())
                                      );
                                      const resolved = getResolvedChatParticipants(activeChat, currentUser, allUsersMap, relatedAct, contacts);
                                      return resolved.length || 1;
                                    })()})</span>
                                  </button>
                                ) : (
                                  <span className="text-[#6D4C3D]">Chat privado directo</span>
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center flex-wrap gap-2">
                            {/* Ver perfil option in direct private chats */}
                            {activeChat.type === 'privado' && (
                              <button
                                onClick={() => {
                                  const activeDisplayTitle = getChatDisplayTitle(activeChat, currentUser);
                                  const otherPartId = activeChat.participants?.find((p: string) => {
                                    const pLow = String(p).toLowerCase().trim();
                                    return pLow !== String(currentUser?.id).toLowerCase().trim() &&
                                      pLow !== String(currentUser?.usuario).toLowerCase().trim() &&
                                      pLow !== String(currentUser?.apodo).toLowerCase().trim();
                                  });
                                  openUserProfileByName(activeDisplayTitle, otherPartId);
                                }}
                                className="text-sm font-bold bg-[#FCF4E8] hover:bg-[#F7E5CD] text-[#3D1C0A] px-3.5 py-1.5 rounded-full border border-[#E6C9A8] inline-flex items-center gap-1.5 shadow-xs cursor-pointer transition whitespace-nowrap"
                              >
                                <i className="fa-solid fa-user text-[#F16623]" /> Ver perfil
                              </button>
                            )}

                            {(() => {
                              const relatedChatAct = resolveActivityForChat(activeChat, activities);
                              const hasLinkedActivity = Boolean(
                                relatedChatAct ||
                                activeChat.activityId ||
                                (activeChat as any).actividad_id
                              );
                              if (!hasLinkedActivity) return null;
                              return (
                                <button
                                  onClick={() => handleOpenChatActivityDetail(activeChat)}
                                  className="text-sm font-bold bg-[#FCF4E8] hover:bg-[#F7E5CD] text-[#3D1C0A] px-3.5 py-1.5 rounded-full border border-[#E6C9A8] inline-flex items-center gap-1.5 shadow-xs cursor-pointer transition whitespace-nowrap"
                                >
                                  <i className="fa-solid fa-circle-info text-[#F16623]" /> Ver detalles
                                </button>
                              );
                            })()}

                            {activeChat.type === 'grupal' && !isUserRemovedFromActiveChat && currentUser &&
                            isUserChatModerator(activeChat, currentUser, activities) && (
                              <button
                                onClick={() => setModalModerarGrupoOpen(true)}
                                className="text-sm font-bold bg-[#FDE8A6] hover:bg-[#FAD97A] text-[#3D1C0A] px-3.5 py-1.5 rounded-full border border-[#ECC864] inline-flex items-center gap-1.5 shadow-xs cursor-pointer transition whitespace-nowrap"
                              >
                                <i className="fa-solid fa-gear text-[#F16623]" /> Moderar grupo
                              </button>
                            )}

                            {activeChat.type === 'grupal' && !isUserRemovedFromActiveChat && (
                              <button
                                onClick={handleSalirGrupoActivo}
                                className="text-sm font-bold bg-[#FCE4EC] hover:bg-[#F8CBD9] text-[#881337] px-3.5 py-1.5 rounded-full border border-[#F1AFC4] inline-flex items-center gap-1.5 shadow-xs cursor-pointer transition whitespace-nowrap"
                              >
                                <i className="fa-solid fa-right-from-bracket" /> Salir del grupo
                              </button>
                            )}

                            {activeChat.type === 'grupal' && isUserRemovedFromActiveChat && (
                              <button
                                onClick={() => handleDeleteChatForMe(activeChat.id)}
                                className="text-sm font-bold bg-stone-100 hover:bg-rose-50 text-stone-700 hover:text-rose-700 px-3.5 py-1.5 rounded-full border border-stone-300 hover:border-rose-200 inline-flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap"
                                title="Eliminar este chat de tus mensajes recientes"
                              >
                                <i className="fa-solid fa-trash-can" /> Borrar chat
                              </button>
                            )}
                          </div>
                        </div>
                        <ScallopedHeaderEdge />
                      </div>

                    {/* PINNED MESSAGE BANNER */}
                    {activeChat.type === 'grupal' && (() => {
                      const pinned = getPinnedMessageFromList(activeChat.messages, activeChat.pinnedMessageId);
                      if (!pinned) return null;
                      return (
                        <div
                          onClick={() => {
                            const elem = document.getElementById(`msg-${pinned.id}`);
                            if (elem && chatMessagesContainerRef.current) {
                              const container = chatMessagesContainerRef.current;
                              const elemTop = elem.offsetTop;
                              container.scrollTo({ top: Math.max(0, elemTop - container.clientHeight / 2), behavior: 'smooth' });
                              elem.classList.add('ring-4', 'ring-amber-400', 'rounded-2xl', 'transition-all');
                              setTimeout(() => {
                                elem.classList.remove('ring-4', 'ring-amber-400');
                              }, 2500);
                            }
                          }}
                          className="relative z-10 bg-[#FDE8A6]/95 hover:bg-[#FAD97A] border-b border-[#ECC864] px-4 pt-5 pb-2.5 flex flex-wrap items-center justify-between gap-2 text-sm text-[#3D1C0A] shadow-xs animate-in fade-in cursor-pointer"
                          title="Hacé clic para ver el mensaje fijado en la conversación"
                        >
                          <div className="flex items-center gap-2 truncate min-w-0">
                            <i className="fa-solid fa-thumbtack text-[#F16623] flex-shrink-0" />
                            <span className="font-bold text-[#3D1C0A] flex-shrink-0">Mensaje fijado:</span>
                            <span className="truncate italic text-[#5E4032]">"{pinned.text}"</span>
                          </div>
                          {isCurrentUserModeratorOfActiveChat && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePinChatMessage(pinned.id || '');
                              }}
                              className="text-sm text-[#3D1C0A] hover:text-rose-700 font-bold ml-2 cursor-pointer underline flex-shrink-0"
                            >
                              Desfijar
                            </button>
                          )}
                        </div>
                      );
                    })()}

                    {/* Área de mensajes con fondo crema #FCF7EE y marca de agua sutil */}
                    <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col bg-[#FCF7EE]">
                      <ChatWatermark />
                      <div ref={chatMessagesContainerRef} onScroll={handleChatContainerScroll} className="relative z-10 flex-1 min-h-0 px-3.5 sm:px-6 pt-5 pb-4 overflow-y-auto space-y-3.5">
                        {(() => {
                          const displayMessages = deduplicateMessages(activeChat.messages || []);
                          return displayMessages.map((m, idx) => {
                            const currentDateKey = getMessageArgentinaDate(m, activeChat.created_at || (activeChat as any).createdAt);
                            const prevDateKey = idx > 0 ? getMessageArgentinaDate(displayMessages[idx - 1], activeChat.created_at || (activeChat as any).createdAt) : null;
                            const showDateDivider = idx === 0 || currentDateKey !== prevDateKey;
                          const dateDividerLabel = formatArgentinaDateHeader(currentDateKey);

                          const isSystemMsg = m.sender === 'Sistema CLUB65' ||
                            m.senderId === 'system' ||
                            m.senderId === 'sistema' ||
                            (m as any).sender_id === 'system' ||
                            (m as any).sender_id === 'sistema' ||
                            (m as any).role === 'sistema' ||
                            m.isSystem ||
                            (m.id && String(m.id).startsWith('msg_init_')) ||
                            (m.id && String(m.id).startsWith('msg_adm_')) ||
                            (m.text && (m.text.startsWith('Sistema CLUB65:') || m.text.startsWith('Sistema:')));
                          if (isSystemMsg) {
                            const relatedAct = activities.find((a: any) =>
                              (activeChat.activityId && String(a.id) === String(activeChat.activityId)) ||
                              (a.title && activeChat.name && a.title.trim().toLowerCase() === String(activeChat.name).trim().toLowerCase())
                            );
                            const formattedNotice = formatActivitySystemNotice(
                              m.text,
                              activeChat,
                              relatedAct,
                              m.replyTo || (m as any).reply_to
                            );

                            return (
                              <React.Fragment key={m.id || `msg-${idx}`}>
                                {showDateDivider && (
                                  <div className="flex justify-center my-3 w-full select-none" data-testid={`chat-date-divider-${currentDateKey}`}>
                                    <div className="bg-[#F7D3B4] text-[#3D1C0A] border border-[#E8BA92] rounded-full px-4 py-1 text-sm font-bold shadow-2xs flex items-center gap-2">
                                      <i className="fa-regular fa-calendar text-[#F16623] text-sm" />
                                      <span>{dateDividerLabel}</span>
                                    </div>
                                  </div>
                                )}
                                <div id={`msg-${m.id}`} className="flex justify-center my-2.5 w-full">
                                  <div className="bg-[#F7D3B4]/90 border border-[#E8BA92] rounded-full sm:rounded-2xl px-5 py-2 text-base text-[#3D1C0A] font-semibold text-center shadow-2xs max-w-[92%] leading-relaxed break-words">
                                    {formattedNotice}
                                  </div>
                                </div>
                              </React.Fragment>
                            );
                          }

                          // Tokens exclusivos de la sesión que está abierta en este momento
    const uAny = currentUser as any;
    const myTokens = currentUser ? [
      currentUser.id,
      currentUser.usuario,
      currentUser.apodo,
      currentUser.nombre,
      uAny?.institucion,
      uAny?.nombreCompleto,
      uAny?.username,
      uAny?.name,
      uAny?.supabaseId,
      uAny?.email
    ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim()) : [];

    const mAny = m as any;
    const msgTokens = [
      m.senderId,
      mAny.sender_id,
      m.sender,
      mAny.autor,
      mAny.userId,
      mAny.user_id,
      mAny.author,
      mAny.from,
      mAny.creadorId,
      mAny.creador_id
    ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

    const otherTitle = getChatDisplayTitle(activeChat, currentUser);
    const otherTokens = [
      activeChat?.title,
      activeChat?.destinatario,
      otherTitle
    ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

    const isSystem = m.sender === 'Sistema CLUB65' || m.senderId === 'system' || (m as any).sender_id === 'system' || mAny.isSystem;

    let esPropio = !isSystem && Boolean(currentUser && msgTokens.some(tok => myTokens.includes(tok)));

    if (!esPropio && !isSystem && activeChat?.type === 'privado') {
      const esDelOtro = msgTokens.some(tok => otherTokens.includes(tok));
      if (!esDelOtro) {
        esPropio = true;
      }
    }
    const removedDisplay = resolveRemovedMessageDisplay(m);
    const isLocallyMarkedRemoved = (() => {
      try {
        const list = JSON.parse(localStorage.getItem('club65_removed_messages') || '[]');
        return Array.isArray(list) && list.includes(String(m.id));
      } catch (_) {
        return false;
      }
    })();
    const isDeleted = Boolean(removedDisplay.isDeleted || isLocallyMarkedRemoved);

    let bubbleBg = '';
    let align = '';

    if (isDeleted) {
      align = esPropio ? 'ml-auto flex-row-reverse max-w-[92%] sm:max-w-[78%]' : 'mr-auto max-w-[92%] sm:max-w-[78%]';
      bubbleBg = 'bg-stone-100 text-stone-700 border border-stone-300 shadow-sm';
    } else if (esPropio) {
      align = 'ml-auto flex-row-reverse max-w-[92%] sm:max-w-[78%]';
      bubbleBg = 'bg-[#D6EEF2] text-[#1D3B42] border border-[#3994A4]/35 shadow-sm';
    } else {
      align = 'mr-auto max-w-[92%] sm:max-w-[78%]';
      bubbleBg = 'bg-[#FFFFFF] text-[#3D1C0A] border border-[#EDE0D0] shadow-sm';
    }

    let displayName = m.sender;
    if (esPropio) {
      displayName = currentUser?.apodo || currentUser?.nombre || currentUser?.usuario || 'Vos';
    } else if (!m.sender || isTechnicalIdentifier(m.sender) || m.sender === 'Vecino' || m.sender === 'Usuario' || String(m.sender).startsWith('org_') || String(m.sender).startsWith('usr_')) {
      displayName = otherTitle;
    }

    const isMsgAdmin = isCurrentUserModeratorOfActiveChat;
    const msgKey = m.id || `msg_${idx}`;

    const senderPhoto = esPropio
      ? (sanitizeProfileAvatar(currentUser?.avatar) || getUserPhotoByName(currentUser?.id) || getUserPhotoByName(currentUser?.apodo || currentUser?.nombre))
      : (getUserPhotoByName(m.senderId || (m as any).sender_id) || getUserPhotoByName(m.sender) || getUserPhotoByName(displayName));
                          return (
                            <React.Fragment key={m.id || `msg-${idx}`}>
                              {showDateDivider && (
                                <div className="flex justify-center my-3 w-full select-none" data-testid={`chat-date-divider-${currentDateKey}`}>
                                  <div className="bg-[#F7D3B4] text-[#3D1C0A] border border-[#E8BA92] rounded-full px-4 py-1 text-sm font-bold shadow-2xs flex items-center gap-2">
                                    <i className="fa-regular fa-calendar text-[#F16623] text-sm" />
                                    <span>{dateDividerLabel}</span>
                                  </div>
                                </div>
                              )}
                              <div id={`msg-${m.id}`} className={`flex items-start gap-2.5 sm:gap-3 ${align}`}>
                              <div
                                onClick={() => {
                                  if (esPropio) {
                                    if (currentUser?.avatar) {
                                      setModalVisorImgShape('circle');
                                      setModalVisorImgSrc(currentUser.avatar);
                                    }
                                  } else {
                                    openUserProfileByName(displayName);
                                  }
                                }}
                                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-base flex-shrink-0 overflow-hidden cursor-pointer shadow-xs ${
                                  esPropio ? 'bg-[#3994A4] text-white' : 'bg-[#F16623] text-white'
                                }`}
                                title={esPropio ? 'Tu perfil' : `Ver perfil de ${displayName}`}
                              >
                                {senderPhoto ? (
                                  <img src={senderPhoto} alt={displayName} className="w-full h-full object-cover rounded-full aspect-square" />
                                ) : (
                                  esPropio ? displayName.charAt(0).toUpperCase() : (m.avatar || displayName.charAt(0).toUpperCase())
                                )}
                              </div>
                              <div className={`${bubbleBg} px-4 sm:px-5 py-3 rounded-2xl ${esPropio ? 'rounded-tr-xs' : 'rounded-tl-xs'} text-base relative min-w-[150px] sm:min-w-[180px] max-w-[85%] sm:max-w-[82%] break-words`}>
                                <div className="flex justify-between items-start gap-2 mb-1">
                                  <p className="font-extrabold text-base flex flex-wrap items-center gap-1.5 min-w-0">
                                    <span>{displayName}</span>
                                    {activeChat.type === 'grupal' && (m.isOrganizer || (activeChat.creatorId === m.senderId) || (activeChat.creatorName && activeChat.creatorName.toLowerCase().trim() === displayName.toLowerCase().trim()) || (activeChat.adminUsernames?.some((a: string) => {
                                      const aLow = String(a).toLowerCase().trim();
                                      return aLow === displayName.toLowerCase().trim() || (m.sender && aLow === m.sender.toLowerCase().trim()) || (m.senderId && aLow === m.senderId.toLowerCase().trim());
                                    }))) && (
                                      <span className="bg-[#FDE8A6] text-[#5A2B1B] font-extrabold px-2 py-0.5 rounded-full text-sm">
                                        ★ Moderador del grupo
                                      </span>
                                    )}
                                    {m.isAdminUser || m.role === 'Administrador' ? (
                                      <i className="fa-solid fa-circle-check text-purple-700 text-base ml-1" title="Administrador Oficial Verificado" />
                                    ) : m.isVerifiedInst ? (
                                      <i className="fa-solid fa-circle-check text-[#3994A4] text-base ml-1" title="Institución Verificada" />
                                    ) : null}
                                  </p>

                                  {/* Three dots options menu: only shown if message is NOT deleted */}
                                  {!isDeleted && (
                                    <div
                                      className="relative flex-shrink-0"
                                      onMouseEnter={() => {
                                        if (messageMenuTimeoutRef.current) {
                                          clearTimeout(messageMenuTimeoutRef.current);
                                          messageMenuTimeoutRef.current = null;
                                        }
                                      }}
                                      onMouseLeave={() => {
                                        if (openMessageMenuId === msgKey) {
                                          if (messageMenuTimeoutRef.current) {
                                            clearTimeout(messageMenuTimeoutRef.current);
                                          }
                                          messageMenuTimeoutRef.current = setTimeout(() => {
                                            setOpenMessageMenuId(null);
                                          }, 600);
                                        }
                                      }}
                                    >
                                      <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (messageMenuTimeoutRef.current) {
                                              clearTimeout(messageMenuTimeoutRef.current);
                                              messageMenuTimeoutRef.current = null;
                                            }
                                            if (openMessageMenuId === msgKey) {
                                              setOpenMessageMenuId(null);
                                            } else {
                                              const btnRect = e.currentTarget.getBoundingClientRect();
                                              const containerRect = chatMessagesContainerRef.current?.getBoundingClientRect();
                                              const openUp = shouldOpenMessageMenuUpwards({
                                                triggerTop: btnRect.top,
                                                triggerBottom: btnRect.bottom,
                                                containerTop: containerRect ? containerRect.top : 0,
                                                containerBottom: containerRect ? containerRect.bottom : window.innerHeight,
                                                isLastMessage: idx === displayMessages.length - 1
                                              });
                                              setOpenMessageMenuUpwards(openUp);
                                              setOpenMessageMenuId(msgKey);
                                              messageMenuTimeoutRef.current = setTimeout(() => {
                                                setOpenMessageMenuId(null);
                                              }, 3500);
                                            }
                                          }}
                                          className="opacity-75 hover:opacity-100 p-1 rounded cursor-pointer leading-none text-base"
                                          title="Opciones de mensaje"
                                        >
                                          <i className="fa-solid fa-ellipsis-vertical" />
                                        </button>

                                        {openMessageMenuId === msgKey && (
                                          <div
                                            onMouseEnter={() => {
                                              if (messageMenuTimeoutRef.current) {
                                                clearTimeout(messageMenuTimeoutRef.current);
                                                messageMenuTimeoutRef.current = null;
                                              }
                                            }}
                                            className={`absolute right-0 ${openMessageMenuUpwards ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} bg-white text-[#3D1C0A] border border-amber-200 rounded-2xl shadow-xl z-40 py-1.5 min-w-[205px] text-base divide-y divide-amber-100 animate-in fade-in zoom-in-95`}
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                          {!isUserRemovedFromActiveChat && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (messageMenuTimeoutRef.current) {
                                                  clearTimeout(messageMenuTimeoutRef.current);
                                                  messageMenuTimeoutRef.current = null;
                                                }
                                                setOpenMessageMenuId(null);
                                                setReplyingToMessage({
                                                  id: m.id || String(idx),
                                                  sender: displayName,
                                                  text: m.text
                                                });
                                              }}
                                              className="w-full px-4 py-2 text-left hover:bg-amber-50 font-bold flex items-center gap-2 text-[#3D1C0A] cursor-pointer text-base"
                                            >
                                              <i className="fa-solid fa-reply text-[#3994A4] text-base" /> Responder
                                            </button>
                                          )}

                                          {isMsgAdmin && activeChat.type === 'grupal' && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (messageMenuTimeoutRef.current) {
                                                  clearTimeout(messageMenuTimeoutRef.current);
                                                  messageMenuTimeoutRef.current = null;
                                                }
                                                setOpenMessageMenuId(null);
                                                handlePinChatMessage(m.id || String(idx));
                                              }}
                                              className="w-full px-4 py-2 text-left hover:bg-amber-50 font-bold flex items-center gap-2 text-[#3D1C0A] cursor-pointer text-base"
                                            >
                                              <i className="fa-solid fa-thumbtack text-[#F16623] text-base" />
                                              {(() => {
                                                const curPinned = getPinnedMessageFromList(activeChat.messages, activeChat.pinnedMessageId);
                                                return String(curPinned?.id || activeChat.pinnedMessageId || '') === String(m.id || idx) ? 'Desfijar mensaje' : 'Fijar mensaje';
                                              })()}
                                            </button>
                                          )}

                                          {!esPropio && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (messageMenuTimeoutRef.current) {
                                                  clearTimeout(messageMenuTimeoutRef.current);
                                                  messageMenuTimeoutRef.current = null;
                                                }
                                                setOpenMessageMenuId(null);
                                                openReportModal({
                                                  type: 'chat_message',
                                                  chatId: activeChat.id,
                                                  messageId: m.id || String(idx),
                                                  messageText: m.text,
                                                  reportedUser: displayName
                                                });
                                              }}
                                              className="w-full px-4 py-2 text-left hover:bg-amber-50 font-bold flex items-center gap-2 text-[#3D1C0A] cursor-pointer text-base"
                                            >
                                              <i className="fa-solid fa-flag text-[#F16623] text-base" /> Reportar
                                            </button>
                                          )}

                                          {isMsgAdmin && !m.isDeleted && activeChat.type === 'grupal' && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                if (messageMenuTimeoutRef.current) {
                                                  clearTimeout(messageMenuTimeoutRef.current);
                                                  messageMenuTimeoutRef.current = null;
                                                }
                                                setOpenMessageMenuId(null);
                                                setMessageToDelete({
                                                  chatId: activeChat.id,
                                                  messageId: m.id || String(idx),
                                                  messageText: m.text,
                                                  sender: displayName
                                                });
                                              }}
                                              className="w-full px-4 py-2 text-left hover:bg-rose-50 text-rose-700 font-bold flex items-center gap-2 cursor-pointer text-base"
                                            >
                                              <i className="fa-solid fa-trash-can text-rose-600 text-base" /> Eliminar mensaje
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>

                                {/* Reply reference if present */}
                                {m.replyTo && (m.replyTo.text || m.replyTo.sender) && (
                                  <div className="mb-2 p-2.5 rounded-xl bg-black/5 border-l-4 border-[#3994A4] text-base text-left">
                                    <p className="font-bold text-base text-[#3D1C0A]">{m.replyTo.sender || 'Mensaje'}</p>
                                    <p className="line-clamp-1 italic text-base opacity-90">{m.replyTo.text}</p>
                                  </div>
                                )}

                               {isDeleted ? (
                        <p className="text-base italic text-stone-600 py-1 select-none flex items-center gap-1.5 leading-relaxed">
                          <span>🚫</span>
                          <span>
                            {removedDisplay.deletedByAdmin
                              ? ADMIN_REMOVED_MESSAGE_TEXT
                              : (removedDisplay.deletedByGroupModerator
                                  ? 'Este mensaje fue retirado por el moderador del grupo'
                                  : ADMIN_REMOVED_MESSAGE_TEXT)}
                          </span>
                        </p>
                      ) : (
                        <p className="text-base font-medium leading-relaxed whitespace-pre-line">{m.text}</p>
                      )}
                                <span className={`text-sm block text-right mt-1 ${esPropio ? 'text-[#246A76]' : 'text-[#7A5C4D]'}`}>
                                  {formatArgentinaTimeOnly(m.time || m.createdAt || (m as any).created_at)}
                                </span>
                              </div>
                            </div>
                          </React.Fragment>
                        );
                        });
                        })()}
                        <div ref={chatMessagesEndRef} />
                      </div>
                    </div>

                    {/* Barra inferior de escritura */}
                    <div className="px-3.5 sm:px-6 py-3 sm:py-3.5 bg-[#FCF7EE]/95 border-t border-[#EEDCC9]/80 flex-shrink-0 relative z-20">
                      {replyingToMessage && !isUserRemovedFromActiveChat && (
                        <div className="bg-[#F7D3B4]/80 border border-[#E8BA92] rounded-2xl p-2.5 mb-2.5 flex items-center justify-between gap-2 text-base animate-in fade-in">
                          <div className="border-l-4 border-[#F16623] pl-2.5 min-w-0 flex-1">
                            <span className="font-bold text-[#3D1C0A] block truncate">Respondiendo a {replyingToMessage.sender}</span>
                            <span className="text-base text-[#5E4032] truncate block max-w-full sm:max-w-md">{replyingToMessage.text}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReplyingToMessage(null)}
                            className="text-[#5E4032] hover:text-[#3D1C0A] p-1 text-xl font-bold cursor-pointer flex-shrink-0"
                            title="Cancelar respuesta"
                          >
                            &times;
                          </button>
                        </div>
                      )}

                      {(() => {
                        if (activeChat.type === 'privado') {
                          const otherPartId = activeChat.participantIds?.find((id: string) => String(id) !== String(currentUser?.id));
                          const otherDisplay = getChatDisplayTitle(activeChat, currentUser);
                          const otherBlockedMe = didOtherBlockMe(otherDisplay, otherPartId);
                          const iBlockedOther = didIBlockUser(otherDisplay, otherPartId);
                          const isBlocked = otherBlockedMe || iBlockedOther || isUserBlocked(otherDisplay, otherPartId);

                          if (isBlocked) {
                            return (
                              <div className="p-3 bg-rose-50 text-rose-700 text-base font-semibold rounded-2xl border border-rose-200 flex flex-col sm:flex-row items-center justify-between gap-2 shadow-2xs leading-relaxed">
                                <div className="flex items-center gap-2 min-w-0">
                                  <i className="fa-solid fa-ban text-rose-500 text-base flex-shrink-0" />
                                  <span className="break-words">
                                    {otherBlockedMe
                                      ? `${otherDisplay} te bloqueó. La comunicación en este chat está restringida.`
                                      : `Bloqueaste a ${otherDisplay}. Desbloquealo para volver a enviar mensajes.`}
                                  </span>
                                </div>
                                {iBlockedOther && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnblockUser(otherDisplay, otherPartId)}
                                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full text-base font-bold transition shadow-xs cursor-pointer flex-shrink-0"
                                  >
                                    <i className="fa-solid fa-lock-open mr-1.5" />
                                    Desbloquear
                                  </button>
                                )}
                              </div>
                            );
                          }
                        }

                        if (isUserRemovedFromActiveChat) {
                          return (
                            <div className="p-3.5 bg-[#FDE8A6]/70 text-[#3D1C0A] text-base font-semibold text-center rounded-2xl border border-[#ECC864] flex items-center justify-center gap-2 shadow-2xs leading-relaxed">
                              <i className="fa-solid fa-user-slash text-[#F16623] text-base flex-shrink-0" />
                              <span>
                                {isUserVetoedFromChat(activeChat, currentUser)
                                  ? 'Ya no formás parte de este grupo porque fuiste vetado de la actividad.'
                                  : isUserLeftVoluntarilyFromChat(activeChat, currentUser)
                                  ? 'Te retiraste voluntariamente de este grupo. Ya no podés enviar mensajes en esta conversación.'
                                  : 'Ya no formás parte de este grupo (fuiste retirado/a por el moderador). Ya no podés enviar mensajes en esta conversación.'}
                              </span>
                            </div>
                          );
                        }

                        return (
                          <form onSubmit={handleSendChatMessage} className="flex items-center gap-2.5 sm:gap-3">
                            <input
                              type="text"
                              value={chatInputText}
                              onChange={(e) => setChatInputText(e.target.value)}
                              placeholder="Escribí un mensaje aquí..."
                              className="min-w-0 flex-1 px-5 py-3 bg-white border border-[#E6D5C3] rounded-full text-[#3D1C0A] placeholder-[#8E7363] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F16623] text-base"
                            />
                            <button
                              type="submit"
                              disabled={isSendingChatMessage || !chatInputText.trim()}
                              aria-label={isSendingChatMessage ? 'Enviando mensaje' : 'Enviar mensaje'}
                              title={isSendingChatMessage ? 'Enviando mensaje...' : 'Enviar mensaje'}
                              className="w-12 h-12 rounded-full bg-[#F16623] text-white hover:bg-[#D95516] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-md cursor-pointer flex-shrink-0 transition active:scale-95"
                            >
                              <i className="fa-solid fa-paper-plane text-lg text-white" />
                            </button>
                          </form>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}
              </div>
            </div>
          </section>
        )}

        {/* 5. VISTA COMUNIDAD DE WHATSAPP */}
        {currentView === 'whatsapp-comunidad' && (
          <section className="space-y-6">
            <div className="bg-white rounded-3xl p-6 sm:p-8 border border-amber-200 retro-shadow space-y-6 max-w-2xl mx-auto">
              <div className="flex items-center gap-3 border-b border-amber-100 pb-4">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl flex-shrink-0">
                  <i className="fa-brands fa-whatsapp" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-brand text-2xl font-bold text-club-brown">Canal de WhatsApp</h2>
                  <p className="text-base text-stone-600 leading-relaxed">Seguí el canal de CLUB65 y enterate al instante de las próximas actividades en tu celular.</p>
                </div>
              </div>

              <div className="bg-amber-50/60 p-5 rounded-2xl border border-amber-200 space-y-3">
                <h3 className="font-bold text-lg text-club-brown flex items-center gap-2">
                  <i className="fa-solid fa-circle-check text-emerald-600 flex-shrink-0" /> ¿Qué vas a encontrar en el canal?
                </h3>
                <ul className="text-base space-y-2.5 text-club-brown/90 leading-relaxed">
                  <li className="flex items-start gap-2">
                    <i className="fa-solid fa-check text-emerald-600 mt-1 flex-shrink-0" /> <span>Avisos de nuevas actividades y talleres antes de que se agoten los cupos.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <i className="fa-solid fa-check text-emerald-600 mt-1 flex-shrink-0" /> <span>Información centralizada en un solo lugar.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <i className="fa-solid fa-check text-emerald-600 mt-1 flex-shrink-0" /> <span>Espacio moderado y cuidado exclusivo para miembros de CLUB65.</span>
                  </li>
                </ul>
              </div>

              <div className="text-center pt-2">
                <a
                  href="https://whatsapp.com/channel/0029Vb9H5CT0wajuVzdX3f0m"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pill-btn inline-flex items-center justify-center flex-wrap gap-2.5 px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base shadow-md transition"
                >
                  <i className="fa-brands fa-whatsapp text-xl" />
                  <span>Unirme al Canal de WhatsApp</span>
                  <i className="fa-solid fa-arrow-up-right-from-square text-sm" />
                </a>
                <p className="text-base text-stone-500 mt-3 leading-relaxed">Se abrirá la aplicación oficial de WhatsApp en tu dispositivo.</p>
              </div>
              </div>
          </section>
        )}

        {/* 6. VISTA MIS RESEÑAS */}
        {currentView === 'resenas' && (
          <section className="space-y-6">
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-amber-200 retro-shadow space-y-5">
              <div className="border-b border-amber-100 pb-3">
                <h2 className="font-brand text-2xl sm:text-3xl font-bold text-club-brown flex items-center gap-2 flex-wrap">
                  <i className="fa-solid fa-star text-club-orange flex-shrink-0" /> <span>Tus Reseñas y Experiencias</span>
                </h2>
                <p className="text-base text-stone-600 mt-1 leading-relaxed">
                  Compartí tu opinión sobre actividades a las que fuiste o revisá qué opinan de tus encuentros.
                </p>
              </div>

              <div className="flex flex-wrap sm:flex-nowrap bg-amber-50 p-1.5 rounded-2xl border border-amber-200 w-full max-w-2xl gap-1.5">
                <button
                  onClick={() => setSubTabResenas('mis-opiniones')}
                  className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer break-words ${
                    subTabResenas === 'mis-opiniones'
                      ? 'bg-club-orange text-white shadow-xs'
                      : 'text-club-brown hover:text-club-orange'
                  }`}
                >
                  Reseñas publicadas
                </button>
                <button
                  onClick={() => setSubTabResenas('actividades-organizadas')}
                  className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer break-words ${
                    subTabResenas === 'actividades-organizadas'
                      ? 'bg-club-orange text-white shadow-xs'
                      : 'text-club-brown hover:text-club-orange'
                  }`}
                >
                  Actividades realizadas (reseñas)
                </button>
              </div>

              {subTabResenas === 'mis-opiniones' && (
                <div className="space-y-4">
                  {/* Dynamic pending review prompt card */}
                  {(() => {
                  if (!currentUser) return null;

                  const userTokens = [
                    currentUser.id,
                    currentUser.usuario,
                    currentUser.apodo,
                    currentUser.nombre,
                    currentUser.email
                  ].filter(Boolean).map(t => String(t).replace(/[!¡]/g, '').trim().toLowerCase());

                  const pendingActivities = activities.filter(a => {
                    if (!isUserEnrolledInActivity(a, currentUser)) return false;

                    const targetTitle = (a.title || (a as any).titulo || '').trim().toLowerCase();
                    const hasReviewed = reviews.some(r => {
                      const matchId = String(r.actividadId) === String(a.id);
                      const matchTitle = targetTitle && r.actividad && r.actividad.trim().toLowerCase() === targetTitle;
                      if (!matchId && !matchTitle) return false;
                      const rAutorTokens = [r.autor, (r as any).autor_nombre, (r as any).autor_id, (r as any).usuarioId]
                        .filter(Boolean)
                        .map(t => String(t).replace(/[!¡]/g, '').trim().toLowerCase());
                      return userTokens.some(ut => rAutorTokens.includes(ut));
                    });

                    if (hasReviewed) return false;

                    return isActivityEligibleForReview(a);
                  });

                  if (pendingActivities.length === 0) return null;

                  return (
                    <div className="space-y-4 mb-6">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <h3 className="font-brand text-lg font-bold text-club-brown flex items-center gap-2">
                          <i className="fa-solid fa-pen-to-square text-club-orange" /> Actividades disponibles para reseñar
                        </h3>
                        <span className="text-sm bg-club-orange text-white font-bold px-3 py-0.5 rounded-full">
                          {pendingActivities.length} {pendingActivities.length === 1 ? 'disponible' : 'disponibles'}
                        </span>
                      </div>
                      <div className="space-y-3">
                        {pendingActivities.map(pendingActivity => (
                          <div
                            key={pendingActivity.id}
                            className="p-4 bg-orange-50/80 rounded-2xl border-2 border-dashed border-club-orange/50 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 shadow-xs"
                          >
                            <div className="min-w-0 flex-1 space-y-1">
                              <span className="text-sm font-bold bg-club-orange text-white px-3 py-0.5 rounded-full uppercase inline-block">
                                Pendiente de tu reseña
                              </span>
                              <h3 className="font-bold text-lg text-club-brown mt-1 break-words">
                                {pendingActivity.title}
                              </h3>
                              <p className="text-base text-stone-700 leading-relaxed break-words">
                                {pendingActivity.location ? `Asististe en ${pendingActivity.location}` : 'Participaste en este encuentro'}
                                {pendingActivity.schedule ? ` • ${pendingActivity.schedule.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1')}` : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setResenaEditData({
                                  actividadId: pendingActivity.id,
                                  actividad: pendingActivity.title,
                                  estrellas: 5,
                                  texto: ''
                                });
                                setCalifEstrellas(5);
                                setTextoResena('');
                                setArchivosResena([]);
                                setModalEscribirResenaOpen(true);
                              }}
                              className="pill-btn px-4 py-2 bg-club-orange text-white text-base font-bold hover:bg-club-orange-dark shadow-sm flex items-center gap-1.5 self-start sm:self-auto cursor-pointer flex-shrink-0"
                            >
                              <i className="fa-solid fa-pen-to-square" /> Dejar mi reseña
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                  {/* Published reviews list - strictly authored by current user */}
                  {(() => {
                    const misResenasPublicadas = currentUser ? reviews.filter(r => isUserReview(r, currentUser)) : [];

                    if (misResenasPublicadas.length === 0) {
                      return (
                        <div className="bg-white rounded-2xl p-8 border border-amber-200 text-center space-y-2">
                          <i className="fa-solid fa-pen-nib text-amber-400 text-3xl mb-1" />
                          <p className="text-lg font-bold text-club-brown">Aún no publicaste reseñas.</p>
                          <p className="text-base text-stone-600 mt-1 max-w-lg mx-auto leading-relaxed">
                            Cuando participes de una actividad y finalice su encuentro, podrás dejar tu reseña y compartir tu opinión y fotos con la comunidad.
                          </p>
                        </div>
                      );
                    }

                    return (
                      <div className="space-y-3">
                        {misResenasPublicadas.map((r, idx) => {
                          const reviewRetired = isReviewRetired(r);
                          const mediaItems = reviewRetired ? [] : (r.media && r.media.length ? r.media : (r.foto ? [r.foto] : []));
                          const tituloActividad = r.actividad || (r as any).actividad_titulo || 'Encuentro CLUB65';

                          return (
                            <div
                              key={r.id ? `rev-${r.id}` : `rev-idx-${idx}`}
                              className={`p-4 rounded-2xl border flex flex-col md:flex-row justify-between gap-4 ${
                                reviewRetired
                                  ? 'bg-stone-50/90 border-stone-300'
                                  : 'bg-amber-50/60 border-amber-200'
                              }`}
                            >
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <span className={`text-sm font-bold px-3 py-0.5 rounded-full inline-block ${
                                  reviewRetired
                                    ? 'text-stone-700 bg-stone-200'
                                    : 'text-emerald-700 bg-emerald-100'
                                }`}>
                                  {reviewRetired ? 'Reseña retirada' : 'Reseña publicada'}
                                </span>
                                <h3 className="font-bold text-lg text-club-brown mt-1 break-words">
                                  {tituloActividad}
                                </h3>
                                <div className="flex flex-wrap items-center gap-1 text-amber-500 text-base my-1">
                                  {Array.from({ length: Number(r.estrellas) || (r as any).calificacion || 5 }).map((_, i) => (
                                    <i key={i} className="fa-solid fa-star" />
                                  ))}
                                  <span className="text-sm text-stone-500 ml-1">• {r.fecha ? formatToArgentinaDate(r.fecha) : 'Reciente'}</span>
                                  <span className="text-sm font-semibold text-club-brown ml-1">por {r.autor?.includes('@') ? r.autor.split('@')[0] : (r.autor || 'Vecino')}</span>
                                </div>
                                {reviewRetired ? (
                                  <p className="text-base italic text-stone-600 leading-relaxed break-words flex items-center gap-1.5 py-0.5">
                                    <span>🚫</span>
                                    <span>{ADMIN_REMOVED_REVIEW_TEXT}</span>
                                  </p>
                                ) : (
                                  <p className="text-base text-club-brown/90 leading-relaxed break-words">
                                    "{r.texto || (r as any).comentario || ''}"
                                  </p>
                                )}
                                {/* Multi-media preview (photos and videos click-to-expand) */}
                                {mediaItems.length > 0 && (
                                  <div className="mt-2.5 flex flex-wrap gap-2">
                                    {mediaItems.map((url, mIdx) => {
                                      if (isRetiredReviewMediaItem(url)) {
                                        return (
                                          <div
                                            key={mIdx}
                                            className="rounded-xl overflow-hidden min-h-28 w-44 sm:w-52 border border-stone-300 bg-stone-100 p-2.5 flex flex-col items-center justify-center text-center gap-1 shadow-2xs"
                                          >
                                            <span className="text-stone-500 text-base">🚫</span>
                                            <p className="text-sm italic text-stone-600 leading-snug break-words">
                                              {ADMIN_REMOVED_REVIEW_MEDIA_TEXT}
                                            </p>
                                          </div>
                                        );
                                      }
                                      const isVid = isVideoMedia(url);
                                      return (
                                        <div
                                          key={mIdx}
                                          className="rounded-xl overflow-hidden h-28 w-36 border border-amber-200 relative shadow-xs bg-black flex items-center justify-center cursor-pointer group"
                                          onClick={() => openGalleryVisor(url, r.actividadId)}
                                        >
                                          {isVid ? (
                                            <div className="w-full h-full relative flex items-center justify-center">
                                              <video
                                                src={url}
                                                playsInline
                                                preload="metadata"
                                                className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition pointer-events-none"
                                              />
                                              <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition">
                                                <div className="w-10 h-10 rounded-full bg-club-orange/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition">
                                                  <i className="fa-solid fa-play text-sm ml-0.5" />
                                                </div>
                                              </div>
                                              <span className="absolute bottom-1 left-1.5 bg-black/75 text-white text-sm px-2 py-0.5 rounded font-bold">
                                                <i className="fa-solid fa-video mr-1" /> Video
                                              </span>
                                            </div>
                                          ) : (
                                            <img
                                              src={url}
                                              alt={`Adjunto ${mIdx + 1}`}
                                              className="w-full h-full object-cover group-hover:scale-105 transition"
                                            />
                                          )}
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              openGalleryVisor(url, r.actividadId);
                                            }}
                                            className="absolute top-1 right-1 bg-black/60 hover:bg-club-orange text-white text-sm px-2 py-0.5 rounded-md font-bold cursor-pointer"
                                            title="Ver en pantalla completa"
                                          >
                                            <i className="fa-solid fa-expand" />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 self-start md:self-center flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setResenasOriginActivityId(null);
                                    setModalOpinionesTitle(tituloActividad);
                                    setModalOpinionesId(r.actividadId);
                                  }}
                                  className="pill-btn px-4 py-2 bg-amber-100 hover:bg-amber-200 text-club-brown text-base font-bold border border-amber-300 cursor-pointer"
                                >
                                  Ver otras reseñas
                                </button>
                                {!reviewRetired && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setResenaEditData({
                                        id: r.id,
                                        actividadId: r.actividadId,
                                        actividad: r.actividad,
                                        estrellas: r.estrellas,
                                        texto: r.texto
                                      });
                                      setCalifEstrellas(r.estrellas);
                                      setTextoResena(r.texto);
                                      setArchivosResena(r.media && r.media.length ? [...r.media] : (r.foto ? [r.foto] : []));
                                      setModalEscribirResenaOpen(true);
                                    }}
                                    className="pill-btn px-4 py-2 bg-white border border-amber-300 text-club-brown text-base font-bold hover:bg-stone-50 cursor-pointer"
                                  >
                                    Editar Reseña
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}

              {subTabResenas === 'actividades-organizadas' && (() => {
                  const misOrganizadasFinalizadas = activities.filter(a => {
                    if (!isActivityOwnedByUser(a, currentUser)) return false;

                    return a.isRecurrent ? hasFirstEncounterEnded(a) : isActivityPast(a);
                  });

                  if (misOrganizadasFinalizadas.length === 0) {
                    return (
                      <div className="bg-white rounded-2xl p-8 border border-amber-200 text-center space-y-2">
                        <p className="text-lg font-bold text-club-brown">No tenés actividades organizadas finalizadas aún.</p>
                        <p className="text-base text-stone-600 mt-1 leading-relaxed">Cuando una actividad que hayas propuesto concluya, acá podrás consultar las opiniones y fotos de los participantes.</p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-4">
                      {misOrganizadasFinalizadas.map(act => {
                         const reviewCount = reviews.filter(r => {
                          const rawR = r as any;
                          const rId = rawR.actividadId ?? rawR.activityId ?? rawR.actividad_id;
                          const rTitle = (rawR.actividad ?? rawR.title ?? '').trim().toLowerCase();
                          const actTitle = act.title?.trim().toLowerCase();

                          return (rId && String(rId).trim() === String(act.id).trim()) || (actTitle && rTitle === actTitle);
                        }).length;

                        const statusLabel = getActivityRealizadaStatusLabel(act);
                        const isEnCurso = statusLabel === 'ACTIVIDAD EN CURSO';

                        return (
                          <div key={act.id} className="bg-white p-5 rounded-2xl border border-amber-200 space-y-3 shadow-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className={`text-sm font-bold uppercase tracking-wide px-3 py-0.5 rounded-full ${
                                isEnCurso
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'text-stone-600 bg-stone-100'
                              }`}>
                                {statusLabel} • {act.schedule ? act.schedule.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1') : ''}
                              </span>
                              <span className="text-base font-bold text-amber-600 flex items-center gap-1">
                                <i className="fa-solid fa-star" /> {reviewCount} {reviewCount === 1 ? 'reseña' : 'reseñas'}
                              </span>
                            </div>

                            <h3 className="font-bold text-lg text-club-brown break-words">{act.title}</h3>

                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pt-2 border-t border-amber-100">
                              <p className="text-base text-stone-700 leading-relaxed">
                                <i className="fa-solid fa-camera-retro text-club-orange mr-1.5" />
                                Fotos y opiniones aportadas por los participantes ({reviewCount}).
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  setResenasOriginActivityId(null);
                                  setModalOpinionesTitle(act.title || null);
                                  setModalOpinionesId(act.id);
                                }}
                                className="pill-btn px-4 py-2 bg-club-orange text-white text-base font-bold hover:bg-club-orange-dark shadow-sm cursor-pointer flex-shrink-0"
                              >
                                Ver opiniones y fotos
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
          </div>
        </section>
      )}

        {/* 7. VISTA INFORMACIÓN ÚTIL */}
        {currentView === 'info-util' && (
          <section className="space-y-6">
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-amber-200 retro-shadow space-y-6">
              <div className="border-b border-amber-100 pb-3">
                <h2 className="font-brand text-2xl font-bold text-club-brown flex items-center gap-2">
                  <i className="fa-solid fa-shield-heart text-emerald-600 flex-shrink-0" /> <span>Información Útil y Seguridad de Datos</span>
                </h2>
                <p className="text-base text-stone-600 leading-relaxed mt-1">
                  Cuidado de tus datos personales, recomendaciones de seguridad y teléfonos de asistencia.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-amber-50 p-4 sm:p-5 rounded-2xl border border-amber-200 space-y-2.5 min-w-0">
                  <h3 className="font-bold text-lg text-club-brown flex items-center gap-2">
                    <i className="fa-solid fa-user-shield text-club-orange flex-shrink-0" /> <span>Seguridad y Cuidado Digital</span>
                  </h3>
                  <ul className="text-base space-y-2 text-club-brown/90 list-disc list-inside leading-relaxed">
                    <li>CLUB65 <strong>nunca te solicitará claves bancarias ni datos confidenciales</strong> por chat.</li>
                    <li>Todas las actividades comunitarias son revisadas por moderadores antes de salir en cartelera.</li>
                    <li>Podés reportar reseñas sospechosas o mensajes inapropiados con un solo clic.</li>
                  </ul>
                </div>

                <div className="bg-amber-50 p-4 sm:p-5 rounded-2xl border border-amber-200 space-y-2.5 min-w-0">
                  <h3 className="font-bold text-lg text-club-brown flex items-center gap-2">
                    <i className="fa-solid fa-arrow-up-right-from-square text-club-teal flex-shrink-0" /> <span>Enlaces y Trámites Frecuentes</span>
                  </h3>
                  <div className="space-y-2 text-base">
                    <a
                      href="https://www.pami.org.ar"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3 bg-white rounded-xl border border-amber-200 text-club-teal font-bold hover:underline break-words leading-relaxed"
                    >
                      Portal Oficial PAMI • Cartilla y Turnos Médicos →
                    </a>
                    <a
                      href="https://www.anses.gob.ar"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-3 bg-white rounded-xl border border-amber-200 text-club-teal font-bold hover:underline break-words leading-relaxed"
                    >
                      ANSES • Calendario de Pagos y Asignaciones →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 8. VISTA ACCESIBILIDAD */}
        {currentView === 'accesibilidad' && (() => {
          const activeTextSize = currentUser ? (currentUser.textSize || 'normal') : guestTextSize;
          const activeContrast = currentUser ? Boolean(currentUser.contrast) : guestContrast;
          return (
          <section className="space-y-6">
            {!currentUser && (
              <div className="flex flex-wrap items-center justify-between pb-1">
                <button
                  type="button"
                  onClick={() => setCurrentView('home-visitante')}
                  className="pill-btn px-4 py-2 bg-white hover:bg-amber-100 text-club-brown border border-amber-300 font-bold text-base flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <i className="fa-solid fa-arrow-left text-club-orange" aria-hidden="true" /> Volver a la página de inicio
                </button>
              </div>
            )}
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-amber-200 retro-shadow space-y-6 max-w-xl mx-auto">
              <div className="border-b border-amber-100 pb-3">
                <h2 className="font-brand text-2xl font-bold text-club-brown flex items-center gap-2">
                  <i className="fa-solid fa-universal-access text-club-teal flex-shrink-0" /> <span>Configuración de Accesibilidad</span>
                </h2>
                <p className="text-base text-stone-600 leading-relaxed mt-1">Ajustá la visualización de la plataforma para tu cuenta.</p>
              </div>

              <div className="space-y-4">
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 space-y-2.5">
                  <h3 className="font-bold text-lg text-club-brown">Tamaño de letra en pantalla:</h3>
                  <p className="text-base text-stone-600 leading-relaxed">Aumenta de forma legible todos los textos, descripciones y botones.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1 text-base">
                    <button
                      onClick={() => handleSetTextSize('normal')}
                      className={`pill-btn py-2.5 px-3 font-bold cursor-pointer break-words flex flex-col items-center justify-center leading-tight ${
                        activeTextSize === 'normal'
                          ? 'bg-club-orange text-white border border-club-orange shadow-sm'
                          : 'bg-white text-club-brown border border-amber-300 hover:bg-amber-100/60'
                      }`}
                    >
                      <span>Normal</span>
                      <span className="text-sm font-semibold opacity-85 mt-0.5">16px (por defecto)</span>
                    </button>
                    <button
                      onClick={() => handleSetTextSize('grande')}
                      className={`pill-btn py-2.5 px-3 font-bold cursor-pointer break-words flex flex-col items-center justify-center leading-tight ${
                        activeTextSize === 'grande'
                          ? 'bg-club-orange text-white border border-club-orange shadow-sm'
                          : 'bg-white text-club-brown border border-amber-300 hover:bg-amber-100/60'
                      }`}
                    >
                      <span>Grande</span>
                      <span className="text-sm font-semibold opacity-85 mt-0.5">18px</span>
                    </button>
                    <button
                      onClick={() => handleSetTextSize('gigante')}
                      className={`pill-btn py-2.5 px-3 font-bold cursor-pointer break-words flex flex-col items-center justify-center leading-tight ${
                        activeTextSize === 'gigante'
                          ? 'bg-club-orange text-white border border-club-orange shadow-sm'
                          : 'bg-white text-club-brown border border-amber-300 hover:bg-amber-100/60'
                      }`}
                    >
                      <span>Extra Grande</span>
                      <span className="text-sm font-semibold opacity-85 mt-0.5">20px</span>
                    </button>
                  </div>
                </div>

                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-bold text-lg text-club-brown flex items-center gap-2 flex-wrap">
                      <span>Modo oscuro (alto contraste)</span>
                      <span
                        className={`text-sm font-bold px-2.5 py-0.5 rounded-full border ${
                          activeContrast
                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                            : 'bg-white text-stone-700 border-amber-300'
                        }`}
                      >
                        {activeContrast ? 'Oscuro activado' : 'Claro activado'}
                      </span>
                    </h3>
                    <p className="text-base text-stone-600 leading-relaxed mt-0.5">
                      Paleta oscura suave con alto contraste y tipografía legible para descansar la vista.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleContrast}
                    aria-pressed={activeContrast}
                    className={`pill-btn px-5 py-2.5 text-base font-bold cursor-pointer self-start sm:self-auto flex-shrink-0 flex items-center gap-2 transition ${
                      activeContrast
                        ? 'bg-club-orange text-white border border-club-orange hover:bg-club-orange-dark shadow-sm'
                        : 'bg-white border border-amber-300 text-club-brown hover:bg-amber-100/60'
                    }`}
                  >
                    <i className={`fa-solid ${activeContrast ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true" />
                    <span>{activeContrast ? 'Cambiar a modo claro' : 'Activar modo oscuro'}</span>
                  </button>
                </div>
              </div>
            </div>
          </section>
          );
        })()}

        {/* 9. VISTA SOPORTE */}
        {currentView === 'soporte' && (
          <section className="space-y-6">
            {!currentUser && (
              <div className="flex flex-wrap items-center justify-between pb-1">
                <button
                  type="button"
                  onClick={() => setCurrentView('home-visitante')}
                  className="pill-btn px-4 py-2 bg-white hover:bg-amber-100 text-club-brown border border-amber-300 font-bold text-base flex items-center gap-2 shadow-xs cursor-pointer"
                >
                  <i className="fa-solid fa-arrow-left text-club-orange" aria-hidden="true" /> Volver a la página de inicio
                </button>
              </div>
            )}
            <div className="bg-white rounded-3xl p-4 sm:p-6 border border-amber-200 retro-shadow space-y-5 max-w-lg mx-auto">
              <div className="border-b border-amber-100 pb-3">
                <h2 className="font-brand text-2xl font-bold text-club-brown flex items-center gap-2">
                  <i className="fa-solid fa-headset text-club-orange flex-shrink-0" /> <span>Contactar Soporte CLUB65</span>
                </h2>
                <p className="text-base text-stone-600 leading-relaxed mt-1">Asistencia técnica para usuarios e instituciones colaboradoras.</p>
              </div>

              <div className="space-y-3">
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-center gap-3 min-w-0">
                  <i className="fa-solid fa-phone text-2xl text-club-orange flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-base text-club-brown">Línea Telefónica Gratuita</p>
                    <p className="text-base text-stone-600 leading-relaxed break-words">0800-666-CLUB (2582) • Lun a Vie de 9 a 18 hs</p>
                  </div>
                </div>

                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 flex items-center gap-3 min-w-0">
                  <i className="fa-brands fa-whatsapp text-2xl text-emerald-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-bold text-base text-club-brown">WhatsApp de Asistencia</p>
                    <p className="text-base text-stone-600 leading-relaxed break-words">+54 11 32172728 • Mensajes y notas de voz</p>
                  </div>
                </div>

                <form
                  onSubmit={handleSoporteSubmit}
                  className="space-y-4 pt-2"
                >
                  {soporteEnviadoMsg && (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-base rounded-xl font-semibold flex items-start gap-2 leading-relaxed">
                      <i className="fa-solid fa-circle-check text-emerald-600 mt-1 flex-shrink-0" />
                      <span>{soporteEnviadoMsg}</span>
                    </div>
                  )}

                  {soporteError && (
                    <div className="p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-base rounded-xl font-semibold flex items-start gap-2 leading-relaxed">
                      <i className="fa-solid fa-circle-exclamation mt-1 flex-shrink-0" />
                      <span>{soporteError}</span>
                    </div>
                  )}

                  {currentUser && currentUser.email ? (
                    <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl text-base text-club-brown flex items-center gap-2.5 min-w-0">
                      <i className="fa-solid fa-user-check text-club-orange flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-bold truncate">
                          Enviando como {currentUser.apodo || currentUser.nombre || currentUser.usuario}
                          {currentUser.usuario ? ` (@${currentUser.usuario})` : ''}
                        </p>
                        <p className="text-sm text-stone-600 truncate">
                          Te responderemos a tu correo registrado: <strong>{currentUser.email}</strong>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label htmlFor="soporte-email-invitado" className="block text-base font-bold text-club-brown">
                        Tu correo electrónico: *
                      </label>
                      <input
                        id="soporte-email-invitado"
                        type="email"
                        required
                        value={soporteEmailInvitado}
                        onChange={(e) => {
                          setSoporteEmailInvitado(e.target.value);
                          if (soporteError) setSoporteError('');
                          if (soporteEnviadoMsg) setSoporteEnviadoMsg('');
                        }}
                        placeholder="ej: tu.nombre@correo.com"
                        className="w-full px-3.5 py-2.5 bg-amber-50/50 border border-amber-200 rounded-xl text-base outline-none focus:ring-2 focus:ring-club-orange"
                      />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label htmlFor="soporte-asunto" className="block text-base font-bold text-club-brown">
                      Asunto: *
                    </label>
                    <select
                      id="soporte-asunto"
                      value={soporteAsunto}
                      onChange={(e) => {
                        setSoporteAsunto(e.target.value);
                        if (soporteEnviadoMsg) setSoporteEnviadoMsg('');
                      }}
                      className="w-full px-3.5 py-2.5 bg-amber-50/50 border border-amber-200 rounded-xl text-base font-semibold text-club-brown outline-none focus:ring-2 focus:ring-club-orange"
                    >
                      {SOPORTE_ASUNTOS.map((op) => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="soporte-mensaje" className="block text-base font-bold text-club-brown">
                      Escribinos tu consulta directa: *
                    </label>
                    <textarea
                      id="soporte-mensaje"
                      rows={3}
                      required
                      value={soporteMensaje}
                      onChange={(e) => {
                        setSoporteMensaje(e.target.value);
                        if (soporteError) setSoporteError('');
                        if (soporteEnviadoMsg) setSoporteEnviadoMsg('');
                      }}
                      placeholder="Escribí aquí en qué podemos ayudarte..."
                      className="w-full px-3.5 py-2.5 bg-amber-50/50 border border-amber-200 rounded-xl text-base outline-none focus:ring-2 focus:ring-club-orange leading-relaxed"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={soporteEnviando}
                    className="pill-btn w-full py-3 px-4 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow-sm cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
                  >
                    {soporteEnviando ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Enviando mensaje...
                      </>
                    ) : (
                      'Enviar Mensaje al Equipo'
                    )}
                  </button>
                </form>
              </div>
            </div>
          </section>
        )}

        {/* 10. VISTA PANEL DE ADMINISTRACIÓN / DASHBOARD - CLUB65 */}
        {currentView === 'moderacion' && currentUser?.tipo === 'moderador' && (() => {
        const pendingInstsList = (pendingInstitutions || []).filter((i: any) => {
          const esInst = i.tipo === 'institucional' || i.rol === 'institucional';
          const estaPendiente = !i.estadoAlta || i.estadoAlta === 'pendiente' || i.estado_alta === 'pendiente';
          const noEliminado = i.estadoAlta !== 'eliminado' && i.estado_alta !== 'eliminado';
          return esInst && estaPendiente && noEliminado;
        });

        // Instituciones dadas de alta oficialmente en el sistema
        const approvedInstsMap = new Map<string, User>();
        (approvedInstitutions || []).forEach((inst) => {
          if (inst && inst.id) approvedInstsMap.set(String(inst.id), inst);
        });
        Object.values(allUsersMap || {}).forEach((u: any) => {
          if (u && (u.tipo === 'institucional' || u.rol === 'institucional')) {
            if (u.estadoAlta === 'aprobada' || u.estado_alta === 'aprobada' || u.isVerified === true) {
              if (!approvedInstsMap.has(String(u.id))) {
                approvedInstsMap.set(String(u.id), u);
              }
            }
          }
        });
        const approvedInstsList = Array.from(approvedInstsMap.values()).filter(
          (i: any) => (i.estadoAlta as string) !== 'eliminado' && (i.estadoAlta === 'aprobada' || i.estado_alta === 'aprobada' || i.isVerified === true)
        );

        const pendingRepsList = reports.filter(r => isReportPending(r));
          const activeApprovedActivities = filterActivitiesForBajaSection(activities);

          return (
            <section className="space-y-6">
              <div className="bg-white rounded-3xl p-4 sm:p-8 border-2 border-purple-200 retro-shadow space-y-5 sm:space-y-6">
                
                {/* TOP HEADER & KEY METRICS */}
                <div className="border-b border-purple-100 pb-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h2 className="font-brand text-2xl sm:text-3xl font-black text-purple-950 flex items-center gap-2 flex-wrap">
                        <i className="fa-solid fa-shield-halved text-purple-700 flex-shrink-0" /> <span>DASHBOARD - CLUB65</span>
                      </h2>
                      <p className="text-base text-purple-900/80 mt-1 leading-relaxed">
                        Panel de trabajo operativo: supervisión de propuestas, seguridad comunitaria y control institucional.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap self-start sm:self-auto">
                      <span className="bg-purple-100 text-purple-800 text-sm font-black px-3.5 py-1.5 rounded-full border border-purple-300">
                        Rol: Administrador oficial
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setPromoteAdminError('');
                          setModalDesignarAdminOpen(true);
                        }}
                        className="pill-btn px-4 py-2 bg-purple-800 hover:bg-purple-900 text-white text-base font-bold shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <i className="fa-solid fa-crown text-amber-300 flex-shrink-0" /> <span>Designar nuevo Administrador oficial</span>
                      </button>
                    </div>
                  </div>

                  {/* 4 SUMMARY STAT CARDS (INDICADORES DE MÉTRICAS OPERATIVAS) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                    <div className="p-4 rounded-2xl border-2 bg-amber-50/70 border-amber-200 text-center select-none shadow-xs min-w-0">
                      <div className="font-brand text-2xl sm:text-3xl font-black text-amber-900">
                        [ {pendingActivities.length} ]
                      </div>
                      <div className="text-base font-bold text-amber-950 mt-1 break-words">Propuestas Pendientes</div>
                    </div>

                    <div className="p-4 rounded-2xl border-2 bg-blue-50/70 border-blue-200 text-center select-none shadow-xs min-w-0">
                      <div className="font-brand text-2xl sm:text-3xl font-black text-blue-900">
                        [ {pendingInstsList.length} ]
                      </div>
                      <div className="text-base font-bold text-blue-950 mt-1 break-words">Instituciones por Validar</div>
                    </div>

                    <div className="p-4 rounded-2xl border-2 bg-rose-50/70 border-rose-200 text-center select-none shadow-xs min-w-0">
                      <div className="font-brand text-2xl sm:text-3xl font-black text-rose-900">
                        [ {pendingRepsList.length} ]
                      </div>
                      <div className="text-base font-bold text-rose-950 mt-1 break-words">Reportes de Seguridad</div>
                    </div>

                    <div className="p-4 rounded-2xl border-2 bg-stone-100/70 border-stone-300 text-center select-none shadow-xs min-w-0">
                      <div className="font-brand text-2xl sm:text-3xl font-black text-stone-900">
                        [ {sanctionsList.length > 0 ? sanctionsList.length : bannedUsersList.length} ]
                      </div>
                      <div className="text-base font-bold text-stone-950 mt-1 break-words">Usuarios Sancionados</div>
                    </div>
                  </div>
                </div>

                {/* INTERNAL TABS */}
                <div className="flex flex-wrap gap-2 pb-2 border-b border-purple-100 text-base font-bold">
                  <button
                    onClick={() => setDashboardTab('propuestas')}
                    className={`px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 min-w-0 max-w-full break-words ${
                      dashboardTab === 'propuestas'
                        ? 'bg-purple-800 text-white shadow-sm'
                        : 'bg-purple-50 text-purple-900 hover:bg-purple-100'
                    }`}
                  >
                    <i className="fa-solid fa-inbox flex-shrink-0" />
                    <span>1. Propuestas Vecinales ({pendingActivities.length})</span>
                  </button>
                  <button
                    onClick={() => setDashboardTab('instituciones')}
                    className={`px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 min-w-0 max-w-full break-words ${
                      dashboardTab === 'instituciones'
                        ? 'bg-purple-800 text-white shadow-sm'
                        : 'bg-purple-50 text-purple-900 hover:bg-purple-100'
                    }`}
                  >
                    <i className="fa-solid fa-landmark flex-shrink-0" />
                    <span>2. Validación Institucional ({pendingInstsList.length})</span>
                  </button>
                  <button
                    onClick={() => setDashboardTab('reportes')}
                    className={`px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 min-w-0 max-w-full break-words ${
                      dashboardTab === 'reportes'
                        ? 'bg-purple-800 text-white shadow-sm'
                        : 'bg-purple-50 text-purple-900 hover:bg-purple-100'
                    }`}
                  >
                    <i className="fa-solid fa-triangle-exclamation flex-shrink-0" />
                    <span>3. Centro de Reportes ({pendingRepsList.length})</span>
                  </button>
                  <button
                    onClick={() => setDashboardTab('sanciones')}
                    className={`px-4 py-2.5 rounded-xl transition cursor-pointer flex items-center gap-2 min-w-0 max-w-full break-words ${
                      dashboardTab === 'sanciones'
                        ? 'bg-purple-800 text-white shadow-sm'
                        : 'bg-purple-50 text-purple-900 hover:bg-purple-100'
                    }`}
                  >
                    <i className="fa-solid fa-ban flex-shrink-0" />
                    <span>4. Gestión de Sanciones</span>
                  </button>
                </div>

                {/* ============================================================== */}
                {/* PILAR 1: BANDEJA DE ENTRADA DE INICIATIVAS VECINALES (PROPUESTAS) */}
                {/* ============================================================== */}
                {dashboardTab === 'propuestas' && (
                  <div className="space-y-4">
                    <div className="bg-amber-50/70 p-4 rounded-2xl border border-amber-200 text-base text-amber-950 leading-relaxed">
                      <p className="font-bold flex items-center gap-2">
                        <i className="fa-solid fa-circle-info text-amber-600 text-base flex-shrink-0" /> Bandeja de Entrada de Iniciativas Vecinales:
                      </p>
                      <p className="mt-1 text-stone-700">
                        Cada vez que un usuario personal propone una actividad, el evento cae en esta cola. Podés <strong>Aprobar y Publicar</strong>, <strong>Solicitar cambios</strong> con devolución directa, o <strong>Rechazar</strong>.
                      </p>
                    </div>

                    {/* Sub-tabs de Iniciativas Vecinales */}
                    <div className="flex flex-wrap sm:flex-nowrap bg-amber-100/60 p-1.5 rounded-2xl border border-amber-200 max-w-2xl mb-2 gap-1.5">
                      <button
                        onClick={() => setSubTabPropuestas('por_evaluar')}
                        className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer transition flex items-center justify-center gap-2 ${
                          subTabPropuestas === 'por_evaluar'
                            ? 'bg-club-orange text-white shadow-xs'
                            : 'text-club-brown hover:text-club-orange'
                        }`}
                      >
                        <i className="fa-solid fa-inbox flex-shrink-0" />
                        <span>Por evaluar ({proposalsPorEvaluar.length})</span>
                      </button>
                      <button
                        onClick={() => setSubTabPropuestas('cambios_solicitados')}
                        className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer transition flex items-center justify-center gap-2 ${
                          subTabPropuestas === 'cambios_solicitados'
                            ? 'bg-club-orange text-white shadow-xs'
                            : 'text-club-brown hover:text-club-orange'
                        }`}
                      >
                        <i className="fa-solid fa-clock-rotate-left flex-shrink-0" />
                        <span>Modificaciones solicitadas ({proposalsModificacionesSolicitadas.length})</span>
                      </button>
                    </div>

                    {(() => {
                      const displayedProposals = subTabPropuestas === 'por_evaluar'
                        ? proposalsPorEvaluar
                        : proposalsModificacionesSolicitadas;

                      if (displayedProposals.length === 0) {
                        return (
                          <div className="p-8 text-center bg-stone-50 rounded-2xl border border-stone-200 text-stone-600 text-base leading-relaxed">
                            <i className="fa-solid fa-circle-check text-2xl text-emerald-600 mb-2 block" />
                            {subTabPropuestas === 'por_evaluar'
                              ? 'No hay propuestas vecinales pendientes de evaluar en este momento.'
                              : 'No hay propuestas con modificaciones solicitadas a la espera del organizador.'}
                          </div>
                        );
                      }

                      return displayedProposals.map((act) => {
                        const orgDash = resolveActivityOrganizerDisplay(act);
                        const proposalImg =
                          (act.image && typeof act.image === 'string' && act.image.trim() !== '' ? act.image.trim() : '') ||
                          ((act as any).imagen_url && typeof (act as any).imagen_url === 'string' && (act as any).imagen_url.trim() !== '' ? (act as any).imagen_url.trim() : '') ||
                          (Array.isArray(act.versions) && act.versions.length > 0 ? String(act.versions[act.versions.length - 1]?.image || '').trim() : '');
                        return (
                        <div
                          key={act.id}
                          className="bg-white border-2 border-amber-200 p-5 rounded-2xl shadow-xs space-y-3 hover:border-amber-300 transition"
                        >
                          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b border-amber-100 pb-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="bg-amber-100 text-amber-900 font-bold px-3 py-0.5 rounded-full text-sm">
                                  Iniciativa Vecinal
                                </span>
                                {act.changesSubmittedAt && (
                                  <span className="bg-emerald-100 text-emerald-900 font-bold px-3 py-0.5 rounded-full text-sm border border-emerald-300 inline-flex items-center gap-1">
                                    <i className="fa-solid fa-reply-all text-emerald-600" /> Modificaciones recibidas
                                  </span>
                                )}
                                {act.proposalStatus === 'cambios_solicitados' && (
                                  <span className="bg-rose-100 text-rose-900 font-bold px-3 py-0.5 rounded-full text-sm border border-rose-200 inline-flex items-center gap-1">
                                    <i className="fa-solid fa-hourglass-half text-rose-600" /> A la espera del organizador
                                  </span>
                                )}
                              </div>
                              <h3 className="font-brand text-xl font-bold text-club-brown mt-1.5 break-words">{act.title}</h3>
                            </div>
                            <div className="text-base text-stone-700">
                              <strong>Propuesto por:</strong>{' '}
                              <button
                                type="button"
                                onClick={() => openUserProfileByName(orgDash.name, orgDash.organizerId || act.organizerId || (act as any).userId)}
                                className="font-bold text-club-orange hover:underline cursor-pointer inline-flex items-center gap-1 ml-1"
                                title="Ver perfil del vecino"
                              >
                                <i className="fa-solid fa-user-circle text-sm" /> @{orgDash.name}
                              </button>
                            </div>
                          </div>

                          {act.changesSubmittedAt && (
                            <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-300 text-emerald-950 text-base font-semibold flex items-start gap-2 leading-relaxed">
                              <i className="fa-solid fa-circle-check text-emerald-600 text-lg mt-0.5 flex-shrink-0" />
                              <div className="min-w-0">
                                <span>¡El organizador reenvió la propuesta con cambios aplicados ({act.changesSubmittedAt})!</span>
                                {act.userFeedbackNote && (
                                  <p className="mt-1 font-normal italic text-stone-700 break-words">Nota del organizador: "{act.userFeedbackNote}"</p>
                                )}
                              </div>
                            </div>
                          )}

                          {act.proposalStatus === 'cambios_solicitados' && (
                            <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-300 text-amber-950 text-base font-semibold flex items-start gap-2 leading-relaxed">
                              <i className="fa-solid fa-clock-rotate-left text-amber-600 text-lg mt-0.5 flex-shrink-0" />
                              <div className="min-w-0">
                                <span>A la espera de que el organizador aplique las modificaciones solicitadas ({act.changesRequestedAt}).</span>
                                {act.proposalNote && (
                                  <p className="mt-1 font-normal italic text-rose-900 break-words">Observación enviada: "{act.proposalNote}"</p>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col sm:flex-row gap-4">
                            <div className="w-full sm:w-48 h-36 rounded-2xl overflow-hidden bg-amber-100 flex-shrink-0 border border-amber-200 shadow-xs">
                              {proposalImg ? (
                                <>
                                  <img
                                    src={proposalImg}
                                    alt={act.title}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      const img = e.currentTarget;
                                      img.classList.add('hidden');
                                      const fallback = img.nextElementSibling;
                                      if (fallback) {
                                        fallback.classList.remove('hidden');
                                        fallback.classList.add('flex');
                                      }
                                    }}
                                  />
                                  <div className="hidden w-full h-full flex-col items-center justify-center text-amber-600 bg-amber-50">
                                    <i className="fa-solid fa-shapes text-2xl text-club-orange/40 mb-1" />
                                    <span className="text-sm font-bold text-amber-700/70">{act.category || 'Actividad'}</span>
                                  </div>
                                </>
                              ) : (
                                <div className="w-full h-full flex flex-col items-center justify-center text-amber-600 bg-amber-50">
                                  <i className="fa-solid fa-shapes text-2xl text-club-orange/40 mb-1" />
                                  <span className="text-sm font-bold text-amber-700/70">{act.category || 'Actividad'}</span>
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0 space-y-2.5">
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-amber-50/50 p-3.5 rounded-xl border border-amber-200 text-base">
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Día y Horario:</span>
                                  <span className="font-bold text-club-brown break-words">{act.schedule}</span>
                                </div>
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Lugar / Encuentro:</span>
                                  <span className="font-bold text-club-brown break-words">{act.location}</span>
                                </div>
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Cupo Previsto:</span>
                                  <span className="font-bold text-club-brown">{act.capacity} personas</span>
                                </div>
                              </div>
                              <div className="text-base text-stone-700 bg-white p-3.5 rounded-xl border border-amber-100 leading-relaxed">
                                <span className="font-bold text-club-brown block mb-1">Descripción de la actividad:</span>
                                <p className="italic break-words">"{act.description}"</p>
                              </div>
                            </div>
                          </div>

                          {/* Ubicación y Mapa interactivo de la propuesta */}
                          <div className="bg-white p-4 rounded-2xl border border-amber-200 space-y-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <h5 className="font-brand text-base font-bold text-club-brown flex items-center gap-1.5">
                                  <i className="fa-solid fa-map-location-dot text-club-orange flex-shrink-0" /> Ubicación y Mapa (OpenStreetMap)
                                </h5>
                                <p className="text-base text-stone-700 font-semibold break-words">{act.location}</p>
                              </div>
                              <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(act.location)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="pill-btn px-3.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-base font-bold inline-flex items-center gap-1.5 border border-blue-200 shadow-2xs"
                                title="Abrir en Google Maps"
                              >
                                <i className="fa-solid fa-diamond-turn-right text-blue-600" /> Cómo llegar
                              </a>
                            </div>
                            <div className="h-44 w-full rounded-xl overflow-hidden border border-amber-200 shadow-inner">
                              <LeafletMap
                                lat={act.lat}
                                lng={act.lng}
                                title={act.title}
                                locationName={act.location}
                                height={176}
                              />
                            </div>
                          </div>

                          {/* Cronología de la propuesta vecinal */}
                          <div className="p-3.5 bg-amber-100/50 rounded-xl border border-amber-200 text-base space-y-1.5">
                            <div className="font-bold text-stone-800 flex items-center gap-1.5">
                              <i className="fa-solid fa-clock-rotate-left text-club-orange" /> Cronología de la propuesta:
                            </div>
                            <div className="flex flex-wrap gap-4 text-stone-700">
                              <div>
                                <span className="font-bold block text-club-brown">Propuesta enviada:</span>
                                <span>{act.proposedAt || 'Fecha no registrada'}</span>
                              </div>
                              {act.changesRequestedAt && (
                                <div>
                                  <span className="font-bold block text-rose-800">Modificaciones solicitadas:</span>
                                  <span>{act.changesRequestedAt}</span>
                                </div>
                              )}
                              {act.changesSubmittedAt && (
                                <div>
                                  <span className="font-bold block text-emerald-800">Modificaciones reenviadas:</span>
                                  <span>{act.changesSubmittedAt}</span>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Historial de versiones intercalado con Devolución de moderación */}
                          <div className="bg-amber-50/70 p-4 rounded-2xl border border-amber-200 text-base space-y-2.5">
                            <div className="font-bold text-club-brown flex flex-wrap items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5">
                                <i className="fa-solid fa-code-branch text-club-orange" /> Historial de versiones y moderación
                              </span>
                              {(!act.versions || act.versions.length === 0) && (
                                <button
                                  type="button"
                                  onClick={() => setModalDetalleId(act.id)}
                                  className="pill-btn px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-club-brown text-sm font-bold flex items-center gap-1.5 border border-amber-300 shadow-2xs cursor-pointer"
                                >
                                  <i className="fa-solid fa-eye text-club-orange" /> Ver detalles
                                </button>
                              )}
                            </div>

                            {act.versions && act.versions.length > 0 ? (
                              <div className="space-y-2.5">
                                {act.versions.map((v, vIdx) => (
                                  <React.Fragment key={vIdx}>
                                    <div className="p-3.5 bg-white rounded-xl border border-amber-200 text-base space-y-1.5 shadow-2xs">
                                      <div className="flex flex-wrap justify-between items-center gap-2 font-bold">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="text-purple-900 font-bold bg-purple-50 px-2.5 py-0.5 rounded-md border border-purple-200 text-sm">
                                            Versión {v.version}
                                          </span>
                                          <span className="text-sm text-stone-500 font-normal">
                                            {v.date || (v as any).timestamp || 'Fecha no registrada'}
                                          </span>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => openVersionDetail(v, act)}
                                          className="pill-btn px-3 py-1 bg-amber-100 hover:bg-amber-200 text-club-brown text-sm font-bold flex items-center gap-1.5 border border-amber-300 shadow-2xs cursor-pointer"
                                        >
                                          <i className="fa-solid fa-eye text-club-orange" /> Ver detalles
                                        </button>
                                      </div>
                                      <p className="text-stone-700 leading-relaxed break-words">
                                        <strong>Título:</strong> {v.title} • <strong>Tipo:</strong> {v.isRecurrent ? 'Encuentro recurrente' : 'Encuentro único'} • <strong>Horario:</strong> {v.schedule} • <strong>Lugar:</strong> {v.location} • <strong>Cupo:</strong> {v.capacity}
                                      </p>
                                      {v.note && (
                                        <p className="text-stone-600 italic bg-amber-50/50 p-2 rounded-lg border border-amber-100 leading-relaxed break-words">
                                          "{v.note}"
                                        </p>
                                      )}
                                    </div>

                                    {(v.moderationNote || (act.versions && vIdx === act.versions.length - 1 && act.proposalStatus === 'cambios_solicitados' && act.proposalNote)) && (
                                      <div className="p-3.5 my-1.5 bg-rose-50 border-l-4 border-rose-500 rounded-r-xl text-rose-900 text-base space-y-1 shadow-2xs">
                                        <div className="flex flex-wrap items-center justify-between gap-1 font-bold">
                                          <span className="flex items-center gap-1.5 text-rose-900">
                                            <i className="fa-solid fa-comment-dots text-rose-600" />
                                            Devolución de moderación (Versión {v.version})
                                          </span>
                                          <span className="text-sm text-stone-600 font-semibold">
                                            Moderador General • {v.moderationDate || act.changesRequestedAt || 'Fecha no registrada'}
                                          </span>
                                        </div>
                                        <p className="font-semibold text-rose-800 leading-relaxed break-words">{v.moderationNote || act.proposalNote}</p>
                                      </div>
                                    )}
                                  </React.Fragment>
                                ))}
                              </div>
                            ) : (
                              <>
                                <p className="text-base text-stone-700 leading-relaxed break-words">
                                  <strong>Versión actual:</strong> {act.title} • <strong>Tipo:</strong> {act.isRecurrent ? 'Encuentro recurrente' : 'Encuentro único'} • {act.schedule} • {act.location} • Cupo: {act.capacity} personas
                                </p>
                                {act.proposalNote && (
                                  <div className="p-3.5 my-1.5 bg-rose-50 border-l-4 border-rose-500 rounded-r-xl text-rose-900 text-base space-y-1 shadow-2xs">
                                    <div className="flex flex-wrap items-center justify-between gap-1 font-bold">
                                      <span className="flex items-center gap-1.5 text-rose-900">
                                        <i className="fa-solid fa-comment-dots text-rose-600" />
                                        Devolución de moderación
                                      </span>
                                      <span className="text-sm text-stone-600 font-semibold">
                                        Moderador General • {act.changesRequestedAt || 'Fecha no registrada'}
                                      </span>
                                    </div>
                                    <p className="font-semibold text-rose-800 leading-relaxed break-words">{act.proposalNote}</p>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-amber-100">
                            <button
                              onClick={() => handleAdminModerateProposal(act.id, 'approve')}
                              className="pill-btn px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                            >
                              <i className="fa-solid fa-check" /> Aprobar y Publicar
                            </button>
                            {act.proposalStatus === 'cambios_solicitados' && !act.changesSubmittedAt ? (
                              <button
                                disabled
                                className="pill-btn px-4 py-2 bg-stone-200 text-stone-600 text-base font-bold flex items-center gap-1.5 cursor-not-allowed border border-stone-300 shadow-2xs"
                                title="La solicitud de cambios ya fue enviada y está a la espera de la respuesta del organizador"
                              >
                                <i className="fa-solid fa-paper-plane text-stone-500" /> Solicitud de cambios enviada
                              </button>
                            ) : (
                              <button
                                onClick={() => setModalSolicitarCambiosAct(act)}
                                className="pill-btn px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                              >
                                <i className="fa-solid fa-pen-to-square" /> Solicitar cambios
                              </button>
                            )}
                            <button
                              onClick={() => handleAdminModerateProposal(act.id, 'reject')}
                              className="pill-btn px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-base font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                            >
                              <i className="fa-solid fa-trash-can" /> Rechazar
                            </button>
                          </div>
                        </div>
                        );
                      });
                    })()}
                  </div>
                )}

                {/* ============================================================== */}
                {/* PILAR 2: VALIDACIÓN DE NUEVAS INSTITUCIONES                     */}
                {/* ============================================================== */}
                {dashboardTab === 'instituciones' && (
                  <div className="space-y-4">
                    <div className="bg-blue-50/70 p-4 rounded-2xl border border-blue-200 text-base text-blue-950 leading-relaxed">
                      <p className="font-bold flex items-center gap-2">
                        <i className="fa-solid fa-shield-halved text-blue-700 text-base flex-shrink-0" /> Validación de Nuevas Instituciones:
                      </p>
                      <p className="mt-1 text-stone-700">
                        Las instituciones pueden publicar talleres oficiales sin filtro previo. Su alta requiere revisión rigurosa del tipo de entidad, número de contacto institucional, personería jurídica y documentación legal adjunta.
                      </p>
                    </div>

                    {/* Sub-tabs de Validación Institucional */}
                    <div className="flex flex-wrap sm:flex-nowrap bg-blue-100/60 p-1.5 rounded-2xl border border-blue-200 max-w-2xl mb-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSubTabInstituciones('pendientes')}
                        className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer transition flex items-center justify-center gap-2 ${
                          subTabInstituciones === 'pendientes'
                            ? 'bg-blue-700 text-white shadow-xs'
                            : 'text-blue-900 hover:text-blue-700'
                        }`}
                      >
                        <i className="fa-solid fa-clock flex-shrink-0" />
                        <span>Pendientes de validación ({pendingInstsList.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSubTabInstituciones('dadas_de_alta')}
                        className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer transition flex items-center justify-center gap-2 ${
                          subTabInstituciones === 'dadas_de_alta'
                            ? 'bg-blue-700 text-white shadow-xs'
                            : 'text-blue-900 hover:text-blue-700'
                        }`}
                      >
                        <i className="fa-solid fa-circle-check flex-shrink-0" />
                        <span>Instituciones dadas de alta ({approvedInstsList.length})</span>
                      </button>
                    </div>

                    {/* 1. Solapa: Pendientes de validación */}
                    {subTabInstituciones === 'pendientes' && (
                      pendingInstsList.length === 0 ? (
                        <div className="p-8 text-center bg-stone-50 rounded-2xl border border-stone-200 text-stone-600 text-base leading-relaxed">
                          <i className="fa-solid fa-circle-check text-2xl text-emerald-600 mb-2 block" />
                          No hay instituciones pendientes de validación en este momento.
                        </div>
                      ) : (
                        pendingInstsList.map((inst) => (
                          <div
                            key={inst.id}
                            className="bg-white border-2 border-blue-200 p-5 rounded-2xl shadow-xs space-y-4 hover:border-blue-300 transition"
                          >
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-blue-100 pb-3">
                              <div className="min-w-0">
                                <span className="bg-blue-100 text-blue-900 font-bold px-3 py-0.5 rounded-full text-sm inline-block">
                                  Solicitud de Alta Institucional
                                </span>
                                <h3 className="font-brand text-xl font-bold text-club-brown mt-1.5 break-words">{inst.apodo}</h3>
                                <p className="text-base text-stone-600 mt-0.5 break-words">
                                  Usuario: <span className="font-bold text-stone-800">@{inst.usuario}</span>{' '}
                                  <span className="text-sm text-amber-800 bg-amber-100 font-bold px-2.5 py-0.5 rounded-full ml-1 inline-block">(Cuenta en espera de ser dada de alta)</span>
                                  {inst.email ? ` • ${inst.email}` : ''}
                                </p>
                              </div>
                              <span className="text-sm font-bold text-amber-700 bg-amber-50 px-3 py-1 rounded-full border border-amber-200 flex-shrink-0">
                                Pendiente de Alta
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-blue-50/40 p-4 rounded-2xl border border-blue-100 text-base">
                              <div className="min-w-0">
                                <span className="text-sm text-stone-600 font-bold block">Tipo de Entidad:</span>
                                <span className="font-bold text-club-brown break-words">{inst.entidadTipo || 'No especificado'}</span>
                              </div>
                              <div className="min-w-0">
                                <span className="text-sm text-stone-600 font-bold block">CUIT / Inscripción ARCA:</span>
                                <span className="font-bold text-club-brown font-mono break-all">{inst.cuit || 'S/D'}</span>
                              </div>
                              <div className="min-w-0">
                                <span className="text-sm text-stone-600 font-bold block">Contacto Institucional:</span>
                                <span className="font-bold text-club-brown flex items-center gap-1.5 break-words">
                                  <i className="fa-solid fa-phone text-club-teal text-sm flex-shrink-0" />
                                  {inst.contacto_institucional || inst.contactoInstitucional || 'S/D'}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <span className="text-sm text-stone-600 font-bold block">Sede y Dirección física:</span>
                                <span className="font-bold text-club-brown break-words">
                                  {inst.direccionFisica ? `${inst.direccionFisica}${inst.localidad ? `, ${inst.localidad}` : ''}` : (inst.localidad || 'No especificada')}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <span className="text-sm text-stone-600 font-bold block">Presidente / Funcionario a cargo:</span>
                                <span className="font-bold text-club-brown break-words">
                                  {inst.presidenteFuncionario || inst.legalRepresentative || inst.responsableLegal || 'S/D'}
                                </span>
                              </div>
                              <div className="min-w-0">
                                <span className="text-sm text-stone-600 font-bold block">Manager de la cuenta:</span>
                                <span className="font-bold text-club-brown break-words">
                                  {inst.managerNombre || inst.gestorNombre || 'Mismo Presidente / Titular'}
                                </span>
                              </div>
                              <div className="sm:col-span-2 lg:col-span-3 min-w-0">
                                <span className="text-sm text-stone-600 font-bold block">Cargo/rol del manager de la cuenta en la entidad:</span>
                                <span className="font-bold text-club-brown break-words">
                                  {inst.managerRol || inst.gestorRol || (inst.managerNombre || inst.gestorNombre ? 'No especificado' : 'Presidente / Titular')}
                                </span>
                              </div>
                              <div className="sm:col-span-2 lg:col-span-3 min-w-0">
                                <span className="text-sm text-stone-600 font-bold block">Sitio Web oficial / Red Social:</span>
                                {inst.sitioWebRedSocial ? (
                                  <a
                                    href={inst.sitioWebRedSocial.startsWith('http') ? inst.sitioWebRedSocial : `https://${inst.sitioWebRedSocial}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-bold text-blue-700 hover:underline inline-flex items-center gap-1.5 break-all mt-0.5"
                                  >
                                    <i className="fa-solid fa-arrow-up-right-from-square text-sm flex-shrink-0" />
                                    <span>{inst.sitioWebRedSocial}</span>
                                  </a>
                                ) : (
                                  <span className="text-stone-500 italic">No informado</span>
                                )}
                              </div>
                            </div>

                            {/* Documentación de Respaldo: 2 archivos */}
                            {(() => {
                              const cuitUrl = inst.documento_cuit_url || inst.documentoCuitUrl || inst.constanciaCuitUrl || inst.documentoDescargaUrl;
                              const cuitNombre = inst.constanciaCuitNombre || 'Constancia_CUIT_ARCA.pdf';
                              const personeriaUrl = inst.documento_personeria_url || inst.documentoPersoneriaUrl || inst.personeriaDocUrl || inst.documentoDescargaUrl;
                              const personeriaNombre = inst.personeriaDocNombre || inst.documentoLegal || 'Acreditacion_Personeria.pdf';

                              return (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-base">
                                  <div className="bg-blue-50/70 p-3.5 rounded-xl border border-blue-200 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                      <i className="fa-solid fa-file-invoice text-blue-700 text-xl flex-shrink-0" />
                                      <div className="min-w-0">
                                        <p className="font-bold text-blue-950 truncate">Constancia CUIT / ARCA</p>
                                        <p className="text-sm text-stone-600 truncate">{cuitNombre}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      {cuitUrl ? (
                                        <>
                                          <a
                                            href={cuitUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="pill-btn px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                            title="Abrir constancia en nueva pestaña"
                                          >
                                            <i className="fa-solid fa-arrow-up-right-from-square text-sm" /> Ver
                                          </a>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const a = document.createElement('a');
                                              a.href = cuitUrl;
                                              a.download = cuitNombre;
                                              a.click();
                                              showToast('Descargando Constancia de CUIT / ARCA...');
                                            }}
                                            className="pill-btn px-3 py-1.5 bg-white hover:bg-blue-100 text-blue-900 border border-blue-300 font-bold text-sm inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                                            title="Descargar archivo"
                                          >
                                            <i className="fa-solid fa-download text-sm" />
                                          </button>
                                        </>
                                      ) : (
                                        <span className="text-sm text-stone-500 italic">No disponible</span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="bg-blue-50/70 p-3.5 rounded-xl border border-blue-200 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                      <i className="fa-solid fa-file-shield text-purple-700 text-xl flex-shrink-0" />
                                      <div className="min-w-0">
                                        <p className="font-bold text-blue-950 truncate">Personería / Representación</p>
                                        <p className="text-sm text-stone-600 truncate">{personeriaNombre}</p>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      {personeriaUrl ? (
                                        <>
                                          <a
                                            href={personeriaUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="pill-btn px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                            title="Abrir personería en nueva pestaña"
                                          >
                                            <i className="fa-solid fa-arrow-up-right-from-square text-sm" /> Ver
                                          </a>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const a = document.createElement('a');
                                              a.href = personeriaUrl;
                                              a.download = personeriaNombre;
                                              a.click();
                                              showToast('Descargando Documento de Personería...');
                                            }}
                                            className="pill-btn px-3 py-1.5 bg-white hover:bg-blue-100 text-purple-900 border border-purple-300 font-bold text-sm inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                                            title="Descargar archivo"
                                          >
                                            <i className="fa-solid fa-download text-sm" />
                                          </button>
                                        </>
                                      ) : (
                                        <span className="text-sm text-stone-500 italic">No disponible</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                            <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-blue-100">
                              <button
                                onClick={() => openModalRechazoInstitucion(inst)}
                                className="pill-btn px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 text-base font-bold flex items-center gap-1.5 cursor-pointer"
                              >
                                <i className="fa-solid fa-xmark" /> Rechazar alta
                              </button>
                              <button
                                onClick={() => handleApproveInstitution(inst.id)}
                                className="pill-btn px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                              >
                                <i className="fa-solid fa-check" /> Dar de alta institución
                              </button>
                            </div>
                          </div>
                        ))
                      )
                    )}

                    {/* 2. Solapa: Instituciones dadas de alta */}
                    {subTabInstituciones === 'dadas_de_alta' && (
                      approvedInstsList.length === 0 ? (
                        <div className="p-8 text-center bg-stone-50 rounded-2xl border border-stone-200 text-stone-600 text-base leading-relaxed">
                          <i className="fa-solid fa-landmark text-2xl text-blue-600 mb-2 block" />
                          No hay instituciones dadas de alta registradas todavía.
                        </div>
                      ) : (
                        approvedInstsList.map((inst) => {
                          const adminAltaUsuario = (
                            inst.altaPorUsuario ||
                            (inst.altaPor ? inst.altaPor.replace(/^@/, '').split(' ')[0].replace(/[()]/g, '') : '') ||
                            'Administrador'
                          ).replace(/^@/, '');
                          const adminAltaDisplay = `@${adminAltaUsuario}`;
                          const fechaAltaDisplay = inst.fechaAlta
                            ? (inst.fechaAlta.includes('hs') || inst.fechaAlta.includes('/') ? inst.fechaAlta : formatArgentinaDateTime(inst.fechaAlta))
                            : (inst.createdAt ? formatArgentinaDateTime(inst.createdAt) : 'Fecha inicial de alta');

                          return (
                            <div
                              key={inst.id}
                              className="bg-white border-2 border-emerald-200 p-5 rounded-2xl shadow-xs space-y-4 hover:border-emerald-300 transition"
                            >
                              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-emerald-100 pb-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="bg-emerald-100 text-emerald-900 font-bold px-3 py-0.5 rounded-full text-sm inline-flex items-center gap-1.5 border border-emerald-300">
                                      <i className="fa-solid fa-circle-check text-emerald-600 text-sm" /> Institución Oficial dada de alta
                                    </span>
                                    <span className="bg-blue-100 text-blue-900 font-bold px-3 py-0.5 rounded-full text-sm">
                                      {inst.entidadTipo || 'Entidad Oficial'}
                                    </span>
                                  </div>
                                  <h3 className="font-brand text-xl font-bold text-club-brown mt-1.5 flex items-center gap-1.5 flex-wrap break-words">
                                    <span>{inst.apodo}</span>
                                    <i className="fa-solid fa-circle-check text-blue-600 text-base" title="Institución verificada con tilde azul" />
                                  </h3>
                                  <p className="text-base text-stone-600 mt-0.5 break-words">
                                    Perfil / Usuario: <button
                                      type="button"
                                      onClick={() => openUserProfileByName(inst.usuario)}
                                      className="font-bold text-club-orange hover:underline cursor-pointer"
                                    >
                                      @{inst.usuario}
                                    </button>
                                    {inst.email ? ` • ${inst.email}` : ''}
                                  </p>
                                </div>
                                <div className="text-right flex flex-col items-start sm:items-end gap-1 flex-shrink-0">
                                  <span className="text-sm font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 inline-flex items-center gap-1.5">
                                    <i className="fa-solid fa-shield-check text-emerald-600" /> Alta Confirmada
                                  </span>
                                </div>
                              </div>

                              {/* CAJA DESTACADA: AUDITORÍA DE ALTA */}
                              <div className="bg-emerald-50/70 p-3.5 rounded-2xl border border-emerald-200 text-base text-emerald-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-2xs">
                                <div className="flex items-center gap-3 min-w-0">
                                  <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center flex-shrink-0 shadow-2xs">
                                    <i className="fa-solid fa-user-check text-base" />
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-sm text-emerald-800 font-medium">Administrador que otorgó el alta oficial:</div>
                                    <div className="font-bold text-base text-emerald-950 flex items-center flex-wrap gap-1.5 mt-0.5">
                                      <i className="fa-solid fa-crown text-purple-700 text-sm" />
                                      <span className="font-mono text-purple-950 bg-purple-100/90 border border-purple-300 px-2.5 py-0.5 rounded-md font-bold break-all">
                                        {adminAltaDisplay}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                <div className="sm:text-right border-t sm:border-t-0 border-emerald-200 pt-2 sm:pt-0 w-full sm:w-auto">
                                  <div className="text-sm text-emerald-800 font-medium">Fecha y hora exacta de alta:</div>
                                  <div className="font-bold font-mono text-base text-emerald-950 flex items-center sm:justify-end gap-1.5">
                                    <i className="fa-solid fa-clock text-emerald-700 text-sm" />
                                    <span>{fechaAltaDisplay}</span>
                                  </div>
                                </div>
                              </div>

                              {/* INFORMACIÓN INSTITUCIONAL COMPLETA */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 bg-stone-50/60 p-4 rounded-2xl border border-stone-200 text-base">
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Tipo de Entidad:</span>
                                  <span className="font-bold text-club-brown break-words">{inst.entidadTipo || 'No especificado'}</span>
                                </div>
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">CUIT / Inscripción ARCA:</span>
                                  <span className="font-bold text-club-brown font-mono break-all">{inst.cuit || 'S/D'}</span>
                                </div>
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Contacto Institucional:</span>
                                  <span className="font-bold text-club-brown flex items-center gap-1.5 break-words">
                                    <i className="fa-solid fa-phone text-club-teal text-sm flex-shrink-0" />
                                    {inst.contacto_institucional || inst.contactoInstitucional || 'S/D'}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Sede y Dirección física:</span>
                                  <span className="font-bold text-club-brown break-words">
                                    {inst.direccionFisica ? `${inst.direccionFisica}${inst.localidad ? `, ${inst.localidad}` : ''}` : (inst.localidad || 'No especificada')}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Presidente / Funcionario a cargo:</span>
                                  <span className="font-bold text-club-brown break-words">
                                    {inst.presidenteFuncionario || inst.legalRepresentative || inst.responsableLegal || 'S/D'}
                                  </span>
                                </div>
                                <div className="min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Manager de la cuenta:</span>
                                  <span className="font-bold text-club-brown break-words">
                                    {inst.managerNombre || inst.gestorNombre || 'Mismo Presidente / Titular'}
                                  </span>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3 min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Cargo/rol del manager de la cuenta en la entidad:</span>
                                  <span className="font-bold text-club-brown break-words">
                                    {inst.managerRol || inst.gestorRol || (inst.managerNombre || inst.gestorNombre ? 'No especificado' : 'Presidente / Titular')}
                                  </span>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3 min-w-0">
                                  <span className="text-sm text-stone-600 font-bold block">Sitio Web oficial / Red Social:</span>
                                  {inst.sitioWebRedSocial ? (
                                    <a
                                      href={inst.sitioWebRedSocial.startsWith('http') ? inst.sitioWebRedSocial : `https://${inst.sitioWebRedSocial}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-bold text-blue-700 hover:underline inline-flex items-center gap-1.5 break-all mt-0.5"
                                    >
                                      <i className="fa-solid fa-arrow-up-right-from-square text-sm flex-shrink-0" />
                                      <span>{inst.sitioWebRedSocial}</span>
                                    </a>
                                  ) : (
                                    <span className="text-stone-500 italic">No informado</span>
                                  )}
                                </div>
                              </div>

                              {/* Documentación de Respaldo */}
                              {(() => {
                                const cuitUrl = inst.documento_cuit_url || inst.documentoCuitUrl || inst.constanciaCuitUrl || inst.documentoDescargaUrl;
                                const cuitNombre = inst.constanciaCuitNombre || 'Constancia_CUIT_ARCA.pdf';
                                const personeriaUrl = inst.documento_personeria_url || inst.documentoPersoneriaUrl || inst.personeriaDocUrl || inst.documentoDescargaUrl;
                                const personeriaNombre = inst.personeriaDocNombre || inst.documentoLegal || 'Acreditacion_Personeria.pdf';

                                return (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-base">
                                    <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <i className="fa-solid fa-file-invoice text-emerald-700 text-xl flex-shrink-0" />
                                        <div className="min-w-0">
                                          <p className="font-bold text-stone-900 truncate">Constancia CUIT / ARCA</p>
                                          <p className="text-sm text-stone-600 truncate">{cuitNombre}</p>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {cuitUrl ? (
                                          <>
                                            <a
                                              href={cuitUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="pill-btn px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                              title="Abrir constancia en nueva pestaña"
                                            >
                                              <i className="fa-solid fa-arrow-up-right-from-square text-sm" /> Ver
                                            </a>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const a = document.createElement('a');
                                                a.href = cuitUrl;
                                                a.download = cuitNombre;
                                                a.click();
                                                showToast('Descargando Constancia de CUIT / ARCA...');
                                              }}
                                              className="pill-btn px-3 py-1.5 bg-white hover:bg-emerald-50 text-emerald-900 border border-emerald-300 font-bold text-sm inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                                              title="Descargar archivo"
                                            >
                                              <i className="fa-solid fa-download text-sm" />
                                            </button>
                                          </>
                                        ) : (
                                          <span className="text-sm text-stone-500 italic">No disponible</span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
                                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                        <i className="fa-solid fa-file-shield text-purple-700 text-xl flex-shrink-0" />
                                        <div className="min-w-0">
                                          <p className="font-bold text-stone-900 truncate">Personería / Representación</p>
                                          <p className="text-sm text-stone-600 truncate">{personeriaNombre}</p>
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-1.5 flex-shrink-0">
                                        {personeriaUrl ? (
                                          <>
                                            <a
                                              href={personeriaUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="pill-btn px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                                              title="Abrir personería en nueva pestaña"
                                            >
                                              <i className="fa-solid fa-arrow-up-right-from-square text-sm" /> Ver
                                            </a>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                const a = document.createElement('a');
                                                a.href = personeriaUrl;
                                                a.download = personeriaNombre;
                                                a.click();
                                                showToast('Descargando Documento de Personería...');
                                              }}
                                              className="pill-btn px-3 py-1.5 bg-white hover:bg-purple-50 text-purple-900 border border-purple-300 font-bold text-sm inline-flex items-center gap-1 shadow-2xs cursor-pointer"
                                              title="Descargar archivo"
                                            >
                                              <i className="fa-solid fa-download text-sm" />
                                            </button>
                                          </>
                                        ) : (
                                          <span className="text-sm text-stone-500 italic">No disponible</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}

                              <div className="flex items-center justify-end gap-2 pt-2 border-t border-emerald-100">
                                <button
                                  type="button"
                                  onClick={() => openUserProfileByName(inst.usuario)}
                                  className="pill-btn px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 text-base font-bold flex items-center gap-1.5 cursor-pointer"
                                >
                                  <i className="fa-solid fa-user-circle" /> Ver perfil público institucional
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )
                    )}
                  </div>
                )}

                {/* ============================================================== */}
                {/* PILAR 3: CENTRO DE REPORTES Y SEGURIDAD                        */}
                {/* ============================================================== */}
                {dashboardTab === 'reportes' && (() => {
                  const pendingReports = reports.filter(r => isReportPending(r));
                  const resolvedReports = reports.filter(r => isReportResolved(r));

                  return (
                    <div className="space-y-4">
                      <div className="bg-rose-50/70 p-4 rounded-2xl border border-rose-200 text-base text-rose-950 leading-relaxed">
                        <p className="font-bold flex items-center gap-2">
                          <i className="fa-solid fa-triangle-exclamation text-rose-600 text-base flex-shrink-0" /> Centro de Reportes y Seguridad Comunitaria:
                        </p>
                        <p className="mt-1 text-stone-700">
                          Alertas vecinales de mensajes o contenido inapropiado. Podés revisar la <strong>conversación en contexto (24 horas)</strong> y pulsar <strong>Dictar resolución</strong> para aplicar la medida correspondiente con notificación automática y correo electrónico al denunciante.
                        </p>
                      </div>

                      {/* Sub-pestañas: Alertas pendientes vs Historial de resoluciones */}
                      <div className="flex flex-wrap gap-2 border-b border-rose-200 pb-3">
                        <button
                          type="button"
                          onClick={() => setFiltroReportes('pendientes')}
                          className={`pill-btn px-4 py-2 text-base font-bold flex items-center gap-1.5 cursor-pointer ${
                            filtroReportes === 'pendientes'
                              ? 'bg-rose-700 text-white shadow-xs'
                              : 'bg-white text-stone-700 border border-stone-200 hover:bg-rose-50'
                          }`}
                        >
                          <i className="fa-solid fa-bell" />
                          <span>Alertas Pendientes ({pendingReports.length})</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setFiltroReportes('historial')}
                          className={`pill-btn px-4 py-2 text-base font-bold flex items-center gap-1.5 cursor-pointer ${
                            filtroReportes === 'historial'
                              ? 'bg-rose-700 text-white shadow-xs'
                              : 'bg-white text-stone-700 border border-stone-200 hover:bg-rose-50'
                          }`}
                        >
                          <i className="fa-solid fa-clock-rotate-left" />
                          <span>Historial de Resoluciones (Últimos 30 días) ({resolvedReports.length})</span>
                        </button>
                      </div>

                      {/* VISTA 1: REPORTES PENDIENTES */}
                      {filtroReportes === 'pendientes' && (
                        <div className="space-y-4">
                          {pendingReports.length === 0 ? (
                            <div className="p-8 text-center bg-stone-50 rounded-2xl border border-stone-200 text-stone-600 text-base leading-relaxed">
                              <i className="fa-solid fa-shield text-2xl text-emerald-600 mb-2 block" />
                              No hay alertas de seguridad pendientes en este momento.
                            </div>
                          ) : (
                            pendingReports.map((rep) => (
                              <div
                                key={rep.id}
                                className="bg-white border-2 border-rose-200 hover:border-rose-300 p-5 rounded-2xl shadow-xs space-y-3 transition"
                              >
                                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-rose-100 pb-3">
                                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                                    <span className="bg-rose-100 text-rose-900 font-bold px-3 py-0.5 rounded-full text-sm">
                                      Motivo: {rep.reason}
                                    </span>
                                    <span className="text-sm text-stone-600 break-words">
                                      Reportado por{' '}
                                      <button
                                        type="button"
                                        onClick={() => openUserProfileByName(rep.reporterUsername || rep.reporterUser)}
                                        className="font-bold text-club-brown hover:underline cursor-pointer"
                                      >
                                        @{rep.reporterUsername || rep.reporterUser || 'vecino'}
                                      </button>
                                      {' '}• {rep.createdAt ? formatArgentinaDateTime(rep.createdAt) : (rep.timestamp ? formatArgentinaDateTime(rep.timestamp) : 'Reciente')}
                                    </span>
                                  </div>
                                  <span className="text-sm font-bold px-3 py-1 rounded-full bg-rose-100 text-rose-800 flex-shrink-0">
                                    Alerta Pendiente
                                  </span>
                                </div>

                                <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-base space-y-2.5">
                                  <div className="flex flex-wrap justify-between items-center gap-2 text-stone-600 font-bold text-sm">
                                    <span>Tipo: {rep.type}</span>
                                    {rep.reportedUser && (
                                      <span>
                                        Usuario denunciado:{' '}
                                        <button
                                          type="button"
                                          onClick={() => openUserProfileByName(rep.reportedUser)}
                                          className="font-bold text-rose-700 hover:underline cursor-pointer ml-1"
                                        >
                                          @{rep.reportedUser}
                                        </button>
                                      </span>
                                    )}
                                  </div>

                                  {rep.messageText && (
                                    <p className="p-3 bg-white rounded-lg border border-stone-200 text-stone-800 font-medium italic leading-relaxed break-words">
                                      "{rep.messageText}"
                                    </p>
                                  )}

                                  {rep.mediaUrl && (
                                    <div className="pt-1">
                                      <span className="text-sm text-stone-600 block mb-1">Contenido multimedia adjunto:</span>
                                      {isVideoMedia(rep.mediaUrl) ? (
                                        <video src={rep.mediaUrl} controls className="h-28 rounded-lg border bg-black" />
                                      ) : (
                                        <img src={rep.mediaUrl} alt="Contenido" className="h-28 rounded-lg object-cover border" />
                                      )}
                                    </div>
                                  )}

                                  {rep.comment && (
                                    <p className="text-base text-stone-700 leading-relaxed break-words">
                                      <strong>Comentario del vecino denunciante:</strong> {rep.comment}
                                    </p>
                                  )}

                                  {/* VER CONVERSACIÓN EN CONTEXTO (24 HORAS) */}
                                  {rep.chatId && (
                                    <div className="pt-2 border-t border-stone-200">
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          const nextId = verContextoReporteId === rep.id ? null : rep.id;
                                          setVerContextoReporteId(nextId);
                                          if (nextId && rep.chatId && !reportContextThreads[rep.id]) {
                                            const localChat = chats.find(
                                              c =>
                                                String(c.id) === String(rep.chatId) ||
                                                String(chatIdentifierToBigInt(c.id)) === String(rep.chatId)
                                            );
                                            if (!localChat || !localChat.messages || localChat.messages.length === 0) {
                                              const fetchedMsgs = await api.getChatContextMessagesForReport(rep.chatId);
                                              setReportContextThreads(prev => ({ ...prev, [rep.id]: fetchedMsgs }));
                                            }
                                          }
                                        }}
                                        className="text-base font-bold text-purple-700 hover:text-purple-900 inline-flex items-center gap-1.5 underline cursor-pointer"
                                      >
                                        <i className="fa-solid fa-comments" />
                                        {verContextoReporteId === rep.id ? 'Ocultar chat en contexto' : 'Ver conversación en contexto (24 horas antes y después)'}
                                      </button>

                                      {verContextoReporteId === rep.id && (() => {
                                        const chat = chats.find(
                                          c =>
                                            String(c.id) === String(rep.chatId) ||
                                            String(chatIdentifierToBigInt(c.id)) === String(rep.chatId)
                                        );
                                        const threadMessages =
                                          (chat && Array.isArray(chat.messages) && chat.messages.length > 0
                                            ? chat.messages
                                            : reportContextThreads[rep.id]) || [];
                                        if (threadMessages.length === 0) {
                                          return <p className="text-base text-stone-500 italic mt-1">Chat no disponible.</p>;
                                        }
                                        const mIdx = threadMessages.findIndex(
                                          m =>
                                            String(m.id) === String(rep.messageId) ||
                                            (rep.messageText && String(m.text || '').trim() === String(rep.messageText).trim())
                                        );
                                        const startIdx = mIdx === -1 ? Math.max(0, threadMessages.length - 8) : Math.max(0, mIdx - 4);
                                        const endIdx = mIdx === -1 ? threadMessages.length : Math.min(threadMessages.length, mIdx + 5);
                                        const contextThread = threadMessages.slice(startIdx, endIdx);

                                        return (
                                          <div className="mt-2.5 p-3.5 bg-purple-50/70 rounded-xl border border-purple-200 space-y-2.5">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                              <p className="text-sm font-black text-purple-900 uppercase">
                                                {chat ? `Grupo: ${chat.title}` : 'Conversación reportada'} • Contexto del chat (24 hs):
                                              </p>
                                              <span className="text-sm text-stone-600">Conforme a normativas de seguridad comunitaria</span>
                                            </div>
                                            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                                              {contextThread.map((ctxMsg, cIdx) => {
                                                const isReported = ctxMsg.id === rep.messageId || ctxMsg.text === rep.messageText;
                                                return (
                                                  <div
                                                    key={cIdx}
                                                    className={`p-3 rounded-xl text-base transition ${
                                                      isReported
                                                        ? 'bg-rose-100 border-2 border-rose-400 font-semibold text-rose-950 shadow-xs'
                                                        : 'bg-white border border-stone-200 text-stone-700'
                                                    }`}
                                                  >
                                                    <div className="flex justify-between items-center text-sm mb-1 gap-2">
                                                      <span className={`font-bold ${isReported ? 'text-rose-900 flex items-center gap-1' : 'text-stone-700'}`}>
                                                        {isReported && <i className="fa-solid fa-triangle-exclamation text-rose-600" />}
                                                        {ctxMsg.sender} {isReported && '• [MENSAJE DENUNCIADO]'}
                                                      </span>
                                                      <span className="text-stone-500">{formatArgentinaTimeOnly(ctxMsg.time || ctxMsg.createdAt || (ctxMsg as any).created_at)}</span>
                                                    </div>
                                                    <p className="leading-relaxed break-words">{ctxMsg.text}</p>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-rose-100">
                                  <button
                                    onClick={() => setModalDecisionReporte({
                                      report: rep,
                                      actionType: 'sancionar',
                                      motive: rep.reason || MOTIVOS_REPORTE[0],
                                      comment: '',
                                      sanctionType: 'temporal_7',
                                      alsoDelete: true
                                    })}
                                    className="pill-btn px-5 py-2.5 bg-rose-700 hover:bg-rose-800 text-white text-base font-bold flex items-center gap-1.5 shadow-xs cursor-pointer"
                                  >
                                    <i className="fa-solid fa-gavel" /> Dictar resolución
                                  </button>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      )}

                      {/* VISTA 2: HISTORIAL DE RESOLUCIONES (ÚLTIMOS 30 DÍAS) */}
                      {filtroReportes === 'historial' && (
                        <div className="space-y-4">
                          {resolvedReports.length === 0 ? (
                            <div className="p-8 text-center bg-stone-50 rounded-2xl border border-stone-200 text-stone-600 text-base leading-relaxed">
                              <i className="fa-solid fa-inbox text-2xl text-stone-400 mb-2 block" />
                              No hay resoluciones registradas en los últimos 30 días.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {resolvedReports.map((rep) => (
                                <div
                                  key={rep.id}
                                  className="bg-white border-2 border-stone-200 p-4 rounded-2xl shadow-xs text-base space-y-2.5 hover:border-stone-300 transition"
                                >
                                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-stone-100 pb-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      {(() => {
                                        const isDesestimado = rep.resolutionDecision === 'desestimado' || rep.status === 'desestimado';
                                        return (
                                          <span className={`px-3 py-0.5 rounded-full font-bold text-sm ${
                                            isDesestimado
                                              ? 'bg-stone-100 text-stone-800 border border-stone-300'
                                              : rep.resolutionAction === 'ban_user'
                                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                              : 'bg-amber-100 text-amber-900 border border-amber-300'
                                          }`}>
                                            {isDesestimado
                                              ? 'Caso Desestimado'
                                              : rep.resolutionAction === 'ban_user'
                                              ? 'Usuario Sancionado'
                                              : (rep.resolutionAction === 'delete_content' ? 'Contenido Retirado' : 'Resolución con Medidas')}
                                          </span>
                                        );
                                      })()}
                                      <span className="text-sm text-stone-600 font-bold">
                                        Fecha: <span className="text-club-brown">{rep.resolvedAt || rep.timestamp || 'Reciente'}</span>
                                      </span>
                                      <span className="text-sm text-stone-600 font-bold">
                                        • Dictada por: <span className="text-club-teal font-extrabold">@{rep.resolvedBy || 'administrador'}</span>
                                      </span>
                                    </div>
                                  </div>

                                  {rep.resolutionDecision !== 'desestimado' && rep.status !== 'desestimado' && (
                                    <div className="p-3 bg-amber-50/90 rounded-xl border border-amber-200 text-club-brown leading-relaxed">
                                      <span className="font-bold text-amber-950 block text-sm mb-0.5">
                                        <i className="fa-solid fa-gavel text-amber-600 mr-1" /> Resolución / Medida tomada:
                                      </span>
                                      <p className="font-semibold text-club-brown break-words">
                                        {formatResolutionMeasure(rep)}
                                      </p>
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-stone-50 p-3 rounded-xl border border-stone-100">
                                    <div className="min-w-0">
                                      <span className="text-stone-500 font-bold block text-sm">DENUNCIANTE:</span>
                                      <button
                                        type="button"
                                        onClick={() => openUserProfileByName(rep.reporterUsername || rep.reporterUser)}
                                        className="font-bold text-club-brown hover:underline cursor-pointer break-all"
                                      >
                                        @{rep.reporterUsername || rep.reporterUser}
                                      </button>
                                    </div>
                                    <div className="min-w-0">
                                      <span className="text-stone-500 font-bold block text-sm">DENUNCIADO:</span>
                                      {rep.reportedUser ? (
                                        <button
                                          type="button"
                                          onClick={() => openUserProfileByName(rep.reportedUser)}
                                          className="font-bold text-rose-700 hover:underline cursor-pointer break-all"
                                        >
                                          @{rep.reportedUser}
                                        </button>
                                      ) : (
                                        <span className="text-stone-700">Contenido multimedia</span>
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <span className="text-stone-500 font-bold block text-sm">MOTIVO:</span>
                                      <span className="font-bold text-club-brown break-words">{rep.sanctionReason || rep.reason}</span>
                                    </div>
                                  </div>

                                  {rep.messageText && (
                                    <p className="text-stone-700 italic bg-stone-50 p-2.5 rounded-lg border border-stone-100 leading-relaxed break-words">
                                      Contenido reportado: "{rep.messageText}"
                                    </p>
                                  )}

                                  {(rep.mediaUrl || rep.type === 'review_media') && (() => {
                                    const isDesestimado = rep.resolutionDecision === 'desestimado' || rep.status === 'desestimado';
                                    const isMediaRemoved = !isDesestimado && Boolean(rep.alsoDeletedContent || rep.resolutionAction === 'delete_content' || rep.resolutionAction === 'eliminar');
                                    if (isMediaRemoved) {
                                      return (
                                        <div className="p-3 bg-stone-100 rounded-xl border border-stone-200 text-stone-700 italic text-center font-bold text-base flex items-center justify-center gap-1.5">
                                          <i className="fa-solid fa-ban text-stone-500" /> Contenido multimedia retirado
                                        </div>
                                      );
                                    }
                                    return (
                                      <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 space-y-1.5">
                                        <span className="text-sm font-bold text-stone-600 block uppercase">Contenido multimedia reportado (conservado):</span>
                                        {rep.mediaUrl && (
                                          <div className="w-48 h-32 rounded-lg overflow-hidden border border-stone-300 bg-black flex items-center justify-center">
                                            {isVideoMedia(rep.mediaUrl) ? (
                                              <video src={rep.mediaUrl} controls className="w-full h-full object-contain" />
                                            ) : (
                                              <img
                                                src={rep.mediaUrl}
                                                alt="Contenido desestimado"
                                                className="w-full h-full object-cover cursor-pointer"
                                                onClick={() => {
                                                  if (rep.mediaUrl) {
                                                    setModalVisorImgShape('rect');
                                                    setModalVisorImgSrc(rep.mediaUrl);
                                                  }
                                                }}
                                              />
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}

                                  <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-stone-800 leading-relaxed">
                                    <span className="font-bold text-blue-900 block mb-0.5">Comentario del administrador:</span>
                                    <p className="italic text-stone-700 break-words">
                                      {cleanCommentOrDash(rep.adminComment || rep.resolutionNote) === '-' ? '-' : `"${cleanCommentOrDash(rep.adminComment || rep.resolutionNote)}"`}
                                    </p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ============================================================== */}
                {/* PILAR 4: GESTIÓN DE SANCIONES Y BAJAS (VETO GLOBAL)            */}
                {/* ============================================================== */}
                {dashboardTab === 'sanciones' && (
                  <div className="space-y-6">
                    <div className="bg-stone-100 p-4 rounded-2xl border border-stone-300 text-base text-stone-900 leading-relaxed">
                      <p className="font-bold flex items-center gap-2">
                        <i className="fa-solid fa-ban text-stone-700 text-base flex-shrink-0" /> Gestión de Sanciones y Bajas de Actividades:
                      </p>
                      <p className="mt-1 text-stone-700">
                        Administración de suspensiones de usuarios con detalle de motivos, comentarios, y fecha de levantamiento automático, junto a la baja forzada de actividades de la cartelera y designación de administradores.
                      </p>
                    </div>

                    {/* Sub-tabs de Sanciones: Usuarios vs Actividades */}
                    <div className="flex flex-wrap sm:flex-nowrap bg-stone-200/70 p-1.5 rounded-2xl border border-stone-300 max-w-2xl mb-2 gap-1.5">
                      <button
                        onClick={() => setSubTabSanciones('usuarios')}
                        className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer transition flex items-center justify-center gap-2 ${
                          subTabSanciones === 'usuarios'
                            ? 'bg-purple-800 text-white shadow-xs'
                            : 'text-stone-700 hover:text-purple-900'
                        }`}
                      >
                        <i className="fa-solid fa-user-slash flex-shrink-0" />
                        <span>Sanciones a Usuarios ({sanctionsList.length})</span>
                      </button>
                      <button
                        onClick={() => setSubTabSanciones('actividades')}
                        className={`flex-1 min-w-0 py-2.5 px-3 text-base font-bold rounded-xl cursor-pointer transition flex items-center justify-center gap-2 ${
                          subTabSanciones === 'actividades'
                            ? 'bg-purple-800 text-white shadow-xs'
                            : 'text-stone-700 hover:text-purple-900'
                        }`}
                      >
                        <i className="fa-solid fa-ban flex-shrink-0" />
                        <span>Bajas de Actividades ({bajasList.length})</span>
                      </button>
                    </div>

                    {subTabSanciones === 'actividades' ? (
                      <div className="space-y-6">
                        {/* SECTION: BAJA FORZADA DE ACTIVIDADES DE LA CARTELERA */}
                        <div className="p-4 bg-white rounded-2xl border border-purple-200 space-y-3">
                      <div className="border-b border-purple-100 pb-2">
                        <h4 className="font-bold text-base text-club-brown uppercase tracking-wider">
                          Baja Forzada de Actividades de la Cartelera
                        </h4>
                        <p className="text-base text-stone-600 leading-relaxed">
                          Podés revisar el detalle completo de la actividad antes de darla de baja forzada de la cartelera comunitaria.
                        </p>
                      </div>

                      <div className="space-y-2.5 max-h-72 overflow-y-auto">
                        {activeApprovedActivities.length === 0 ? (
                          <p className="text-base text-stone-500 py-3 text-center">No hay actividades activas en la Cartelera.</p>
                        ) : (
                          activeApprovedActivities.map((act) => (
                            <div
                              key={act.id}
                              className="p-3.5 bg-amber-50/50 rounded-xl border border-amber-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2.5 text-base"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="font-bold text-club-brown text-base break-words">{act.title}</span>
                                <span className="text-sm text-stone-600 block sm:inline sm:ml-2 break-words">
                                  ({act.location} • {act.schedule}) • Organizador:{' '}
                                  <button
                                    type="button"
                                    onClick={() => openUserProfileByName(act.organizer)}
                                    className="font-bold text-club-orange hover:underline cursor-pointer"
                                  >
                                    @{act.organizer}
                                  </button>
                                </span>
                              </div>
                              <div className="flex items-center flex-wrap gap-2 self-end sm:self-auto flex-shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setModalDetalleId(act.id)}
                                  className="pill-btn px-3.5 py-1.5 bg-white hover:bg-amber-100 text-club-brown border border-amber-300 font-bold text-base cursor-pointer"
                                >
                                  Ver detalles
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openModalBajaForzada(act.id, act.title)}
                                  className="pill-btn px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-300 font-bold text-base cursor-pointer flex items-center gap-1.5"
                                >
                                  <i className="fa-solid fa-ban" /> Dar de baja
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* SECTION: REGISTRO DE ACTIVIDADES DADAS DE BAJA */}
                    <div className="p-4 bg-white rounded-2xl border border-purple-200 space-y-3">
                      <div className="border-b border-purple-100 pb-2">
                        <h4 className="font-bold text-base text-club-brown uppercase tracking-wider">
                          Registro de Actividades dadas de baja ({bajasList.length})
                        </h4>
                        <p className="text-base text-stone-600 leading-relaxed">
                          Historial y registro de actividades retiradas forzadamente de la cartelera por la administración.
                        </p>
                      </div>

                      <div className="space-y-2.5 max-h-72 overflow-y-auto">
                        {bajasList.length === 0 ? (
                          <p className="text-base text-stone-500 py-3 text-center">No hay registros de actividades dadas de baja.</p>
                        ) : (
                          bajasList.map((b) => (
                            <div
                              key={b.id}
                              className="p-3.5 bg-stone-50 rounded-xl border border-stone-200 text-base space-y-1.5"
                            >
                              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                                <span className="font-bold text-stone-900 text-base break-words">{b.title}</span>
                                <span className="text-sm text-stone-600">
                                  Fecha de baja: <strong className="text-stone-800">{formatToArgentinaDate(b.date)}</strong>
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-3 text-sm text-stone-700">
                                <span>Organizador: <strong className="text-club-brown">@{b.organizer}</strong></span>
                                {(() => {
                                  const adminDisplay = resolveBajaAdminDisplay(b, activities);
                                  return (
                                    <span>
                                      Administrador:{' '}
                                      <strong className={adminDisplay === '-' ? 'text-stone-600' : 'text-purple-900'}>
                                        {adminDisplay === '-' ? '-' : `@${adminDisplay}`}
                                      </strong>
                                    </span>
                                  );
                                })()}
                              </div>
                              <div className="p-2.5 bg-white rounded-lg border border-stone-200 text-base text-rose-900 leading-relaxed break-words">
                                <strong>Motivo de la baja:</strong> {cleanCommentOrDash(b.reason)}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* SECTION: LISTA DE USUARIOS SANCIONADOS (AGRUPADOS POR USUARIO) */}
                    <div className="p-4 bg-white rounded-2xl border border-purple-200 space-y-3">
                      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3 border-b border-purple-100 pb-3">
                        <div className="min-w-0">
                          <h4 className="font-bold text-base text-club-brown uppercase tracking-wider">
                            Lista de Usuarios Sancionados ({sanctionsList.length})
                          </h4>
                          <p className="text-base text-stone-600 leading-relaxed">
                            Registro de suspensiones temporales y vetos permanentes aplicados.
                          </p>
                        </div>
                        <input
                          type="text"
                          value={searchBannedQuery}
                          onChange={(e) => setSearchBannedQuery(e.target.value)}
                          placeholder="Buscar usuario o motivo..."
                          className="px-3.5 py-2 bg-stone-50 border border-stone-300 rounded-xl text-base outline-none w-full sm:w-64"
                        />
                      </div>

                      <div className="space-y-3 max-h-[28rem] overflow-y-auto">
                        {sanctionsList.length === 0 ? (
                          <p className="text-base text-stone-500 py-4 text-center">No hay usuarios sancionados actualmente.</p>
                        ) : (() => {
                          const qBan = (searchBannedQuery || '').toLowerCase().trim();
                          const filteredSanctions = sanctionsList.filter(s =>
                            !qBan ||
                            (s.username || '').toLowerCase().includes(qBan) ||
                            (s.reason || '').toLowerCase().includes(qBan) ||
                            (s.comment && s.comment.toLowerCase().includes(qBan))
                          );

                          const groupedByUser: Record<string, SanctionRecord[]> = {};
                          filteredSanctions.forEach(s => {
                            const key = (s.username || '').toLowerCase().trim();
                            if (!key) return;
                            if (!groupedByUser[key]) groupedByUser[key] = [];
                            groupedByUser[key].push(s);
                          });

                          const userKeys = Object.keys(groupedByUser);
                          if (userKeys.length === 0) {
                            return <p className="text-base text-stone-500 py-4 text-center">No se encontraron sanciones con ese criterio.</p>;
                          }

                          return userKeys.map((uKey) => {
                            const userSanctions = groupedByUser[uKey];
                            const firstSanc = userSanctions[0];
                            return (
                              <div
                                key={uKey}
                                className="p-4 bg-rose-50/60 rounded-2xl border-2 border-rose-200 text-base space-y-3 shadow-2xs"
                              >
                                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-2 border-b border-rose-200/80 pb-2.5">
                                  <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                                    <span className="w-9 h-9 rounded-full bg-rose-200 text-rose-800 flex items-center justify-center font-bold text-base shadow-xs flex-shrink-0">
                                      <i className="fa-solid fa-user-slash" />
                                    </span>
                                    <div className="min-w-0">
                                      <button
                                        type="button"
                                        onClick={() => openUserProfileByName(firstSanc.username)}
                                        className="font-bold text-lg text-stone-900 hover:text-rose-700 hover:underline cursor-pointer break-all"
                                      >
                                        @{firstSanc.username}
                                      </button>
                                      {userSanctions.length > 1 && (
                                        <span className="ml-2 bg-rose-200 text-rose-900 px-2.5 py-0.5 rounded-full font-bold text-sm inline-block">
                                          {userSanctions.length} sanciones registradas
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <button
                                    onClick={() => handleLiftSanction(firstSanc.username)}
                                    className="pill-btn px-4 py-1.5 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-base font-bold cursor-pointer self-end sm:self-auto shadow-2xs flex-shrink-0"
                                  >
                                    Levantar sanción
                                  </button>
                                </div>

                                <div className="space-y-2.5">
                                  {userSanctions.map((sanc, sIdx) => (
                                    <div
                                      key={sanc.id || sIdx}
                                      className="p-3.5 bg-white rounded-xl border border-rose-100 text-base space-y-2 shadow-2xs"
                                    >
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <span className="font-bold text-rose-900 text-base flex items-center gap-1.5 flex-wrap">
                                          <span className="w-6 h-6 rounded-full bg-rose-100 text-rose-800 flex items-center justify-center text-sm font-black flex-shrink-0">
                                            {sIdx + 1}
                                          </span>
                                          <span>Motivo de sanción: <strong className="text-rose-800">{sanc.reason}</strong></span>
                                        </span>
                                        <span className="bg-rose-100 text-rose-800 px-3 py-0.5 rounded-full font-bold text-sm">
                                          {sanc.type === 'temporal_7'
                                            ? 'Suspensión temporal (7 días)'
                                            : sanc.type === 'temporal_30'
                                            ? 'Suspensión temporal (30 días)'
                                            : 'Vetado de forma permanente'}
                                        </span>
                                      </div>

                                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-stone-50 p-3 rounded-lg border border-stone-100 text-base">
                                        <div>
                                          <span className="text-sm text-stone-600 font-bold block">Administrador que sancionó:</span>
                                          <span className="font-bold text-purple-900">@{sanc.adminUsername}</span>
                                        </div>
                                        <div>
                                          <span className="text-sm text-stone-600 font-bold block">Fecha de sanción:</span>
                                          <span className="font-bold text-stone-700">{formatToArgentinaDate(sanc.date)}</span>
                                        </div>
                                        <div>
                                          <span className="text-sm text-stone-600 font-bold block">Levantamiento automático:</span>
                                          <span className="font-bold text-stone-700">
                                            {sanc.type === 'permanente'
                                              ? 'Permanente (no se levanta automáticamente)'
                                              : (sanc.liftDate ? formatToArgentinaDate(sanc.liftDate) : 'En plazo')}
                                          </span>
                                        </div>
                                      </div>

                                      <div className="text-base text-stone-700 bg-stone-50 p-3 rounded-lg border border-stone-200 leading-relaxed break-words">
                                        <strong>Comentario del administrador:</strong>{' '}
                                        {cleanCommentOrDash(sanc.comment) === '-' ? '-' : `"${cleanCommentOrDash(sanc.comment)}"`}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>

                    {/* SECTION: APLICAR SANCIÓN PREVENTIVA A USUARIO */}
                    <div className="p-4 bg-white rounded-2xl border border-purple-200 space-y-3">
                      <h4 className="font-bold text-base text-club-brown uppercase tracking-wider">
                        Suspender o Vetar nuevo usuario globalmente
                      </h4>
                      <form onSubmit={handleGlobalBan} className="space-y-3 text-base">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <div>
                            <label className="block text-stone-700 font-bold mb-1">Nombre de usuario a sancionar: *</label>
                            <input
                              type="text"
                              required
                              value={inputVetarGlobal}
                              onChange={(e) => setInputVetarGlobal(e.target.value)}
                              placeholder="Ej: usuario_ejemplo"
                              className="w-full px-3.5 py-2.5 bg-purple-50/40 border border-purple-200 rounded-xl outline-none text-base"
                            />
                          </div>
                          <div>
                            <label className="block text-stone-700 font-bold mb-1">Motivo de sanción: *</label>
                            <select
                              value={sancionMotivoInput}
                              onChange={(e) => setSancionMotivoInput(e.target.value)}
                              className="w-full px-3.5 py-2.5 bg-purple-50/40 border border-purple-200 rounded-xl outline-none font-bold text-base"
                            >
                              {MOTIVOS_REPORTE.map((m, idx) => (
                                <option key={idx} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-stone-700 font-bold mb-1">Tipo de sanción: *</label>
                            <select
                              value={sancionTipoInput}
                              onChange={(e) => setSancionTipoInput(e.target.value as any)}
                              className="w-full px-3.5 py-2.5 bg-purple-50/40 border border-purple-200 rounded-xl outline-none font-bold text-base"
                            >
                              <option value="temporal_7">Suspensión temporal (7 días)</option>
                              <option value="temporal_30">Suspensión temporal (30 días)</option>
                              <option value="permanente">Vetado de forma permanente</option>
                            </select>
                          </div>
                        </div>

                        <div>
                          <label className="block text-stone-700 font-bold mb-1">Comentario del administrador (opcional):</label>
                          <textarea
                            rows={2}
                            value={sancionComentarioInput}
                            onChange={(e) => setSancionComentarioInput(e.target.value)}
                            placeholder="Escribí un comentario u observación (si se deja vacío se registrará como '-')..."
                            className="w-full p-3 bg-purple-50/40 border border-purple-200 rounded-xl outline-none text-base focus:ring-2 focus:ring-purple-600"
                          />
                        </div>

                        <button
                          type="submit"
                          className="pill-btn px-5 py-2.5 bg-purple-800 hover:bg-purple-900 text-white text-base font-bold shadow-xs cursor-pointer"
                        >
                          Aplicar Sanción
                        </button>
                      </form>
                    </div>
                  </div>
                )}

                  </div>
                )}

              </div>
            </section>
          );
        })()}
      </main>
      </div>

      {/* PIE DE PÁGINA GLOBAL */}
      <Footer
        isDarkMode={isDarkMode}
        onBrandClick={() => {
          setCurrentView(currentUser ? 'explorar' : 'home-visitante');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      />

      {/* ========================================================= */}
      {/* ========================= MODALS ======================== */}
      {/* ========================================================= */}

      {/* MODAL: INICIAR SESIÓN */}
      {modalLoginOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
          <div className="bg-club-cream w-full max-w-md rounded-3xl border-2 border-amber-200 p-5 sm:p-6 space-y-4 shadow-2xl max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="flex justify-between items-center gap-2 border-b border-amber-200 pb-2">
              <h3 className="font-brand text-xl font-bold text-club-brown min-w-0 break-words">Iniciar Sesión</h3>
              <button
                onClick={() => setModalLoginOpen(false)}
                className="text-2xl text-stone-400 font-bold leading-none cursor-pointer shrink-0 p-1"
                aria-label="Cerrar modal"
              >
                &times;
              </button>
            </div>

            {loginError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-base rounded-xl font-semibold leading-relaxed break-words">
                {loginError}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-4 text-base text-club-brown">
              <div>
                <label className="block font-bold mb-1.5">Usuario o Correo Electrónico:</label>
                <input
                  type="text"
                  required
                  value={loginForm.usuario}
                  onChange={(e) => setLoginForm({ ...loginForm, usuario: e.target.value })}
                  placeholder="Ej: tu_usuario o nombre@correo.com"
                  className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                />
              </div>
              <div>
                <label className="block font-bold mb-1.5">Contraseña:</label>
                <input
                  type="password"
                  required
                  value={loginForm.clave}
                  onChange={(e) => setLoginForm({ ...loginForm, clave: e.target.value })}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                />
              </div>

              <div className="flex flex-wrap justify-between items-center gap-2 text-base">
                <button
                  type="button"
                  onClick={() => {
                    setModalLoginOpen(false);
                    setForgotError('');
                    setForgotSuccessMsg('');
                    setForgotStep('email');
                    setForgotEmail(loginForm.usuario.includes('@') ? loginForm.usuario : '');
                    setForgotCode('');
                    setForgotResetToken('');
                    setForgotNewPassword('');
                    setForgotConfirmPassword('');
                    setForgotUserFound(null);
                    setModalForgotPasswordOpen(true);
                  }}
                  className="text-club-orange font-bold hover:underline cursor-pointer text-left"
                >
                  ¿Olvidaste tu contraseña?
                </button>
              </div>

              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="submit"
                  className="pill-btn w-full py-2.5 px-4 bg-club-orange text-white text-base font-bold shadow-md hover:bg-club-orange-dark cursor-pointer transition"
                >
                  <i className="fa-solid fa-right-to-bracket mr-1.5" /> Iniciar sesión
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setModalLoginOpen(false);
                    setCurrentView('explorar');
                    showToast('Estás navegando en modo invitado');
                  }}
                  className="pill-btn w-full py-2.5 px-4 bg-white hover:bg-amber-50 text-club-brown border border-amber-300 font-bold text-base cursor-pointer transition flex items-center justify-center gap-2 flex-wrap"
                >
                  <i className="fa-solid fa-user text-stone-500" /> Continuar como invitado
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setModalLoginOpen(false);
                    setModalRegisterOpen(true);
                  }}
                  className="text-base text-center text-stone-600 hover:text-club-brown font-bold cursor-pointer pt-1"
                >
                  ¿No tenés cuenta? Registrate acá
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RECUPERAR CONTRASEÑA (Confirmación segura por correo) */}
      {modalForgotPasswordOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-amber-200 p-5 sm:p-6 space-y-4 shadow-2xl max-h-[90dvh] overflow-y-auto min-w-0 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center gap-2 border-b border-amber-200 pb-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-full bg-amber-100 text-club-orange flex items-center justify-center text-lg flex-shrink-0">
                  <i className="fa-solid fa-shield-halved" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-bold bg-amber-200 text-club-brown px-2.5 py-0.5 rounded-full uppercase tracking-wider inline-block">
                    Seguridad de Cuenta
                  </span>
                  <h3 className="font-brand text-xl font-bold text-club-brown mt-0.5 break-words">Recuperar Contraseña</h3>
                </div>
              </div>
              <button
                onClick={() => setModalForgotPasswordOpen(false)}
                className="text-2xl text-stone-400 hover:text-stone-700 font-bold leading-none cursor-pointer p-1 shrink-0"
                aria-label="Cerrar modal"
              >
                &times;
              </button>
            </div>

            {/* Stepper Indicator */}
            <div className="grid grid-cols-3 gap-1.5 pb-1">
              <div className={`h-1.5 rounded-full transition-colors ${forgotStep === 'email' ? 'bg-club-orange' : 'bg-emerald-500'}`} />
              <div className={`h-1.5 rounded-full transition-colors ${forgotStep === 'email' ? 'bg-stone-200' : forgotStep === 'code' ? 'bg-club-orange' : 'bg-emerald-500'}`} />
              <div className={`h-1.5 rounded-full transition-colors ${forgotStep === 'password' || forgotStep === 'success' ? 'bg-club-orange' : 'bg-stone-200'}`} />
            </div>

            {forgotError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-base rounded-xl font-semibold flex items-center gap-2 leading-relaxed">
                <i className="fa-solid fa-circle-exclamation flex-shrink-0" />
                <span className="min-w-0 break-words">{forgotError}</span>
              </div>
            )}

            {forgotSuccessMsg && forgotStep !== 'success' && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-base rounded-xl font-semibold flex items-center gap-2 leading-relaxed">
                <i className="fa-solid fa-circle-check text-emerald-600 flex-shrink-0" />
                <span className="min-w-0 break-words">{forgotSuccessMsg}</span>
              </div>
            )}

            {/* PASO 1: Ingreso de correo electrónico */}
            {forgotStep === 'email' && (
              <form onSubmit={handleForgotPasswordSubmitEmail} className="space-y-4 text-base text-club-brown">
                <div className="text-stone-700 leading-relaxed bg-white p-3.5 rounded-2xl border border-amber-200 space-y-1.5">
                  <p className="font-bold text-club-brown flex items-center gap-1.5 text-base">
                    <i className="fa-solid fa-envelope text-club-orange" /> Paso 1: Verificación de identidad
                  </p>
                  <p className="text-base text-stone-600 leading-relaxed">
                    Ingresá el correo electrónico de tu cuenta. Por razones estrictas de seguridad, te enviaremos un código de confirmación a tu casilla antes de permitirte restablecer tu contraseña.
                  </p>
                </div>

                <div>
                  <label className="block font-bold mb-1.5">Correo electrónico registrado: *</label>
                  <input
                    type="email"
                    required
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="ej: nombre@correo.com"
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base font-semibold"
                  />
                </div>

                <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-amber-200">
                  <button
                    type="button"
                    onClick={() => {
                      setModalForgotPasswordOpen(false);
                      setModalLoginOpen(true);
                    }}
                    className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="pill-btn px-5 py-2 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {forgotLoading ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Verificando...
                      </>
                    ) : (
                      <>
                        Continuar <i className="fa-solid fa-arrow-right" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* PASO 2: Confirmación mediante código de correo */}
            {forgotStep === 'code' && (
              <form onSubmit={handleVerifyResetCode} className="space-y-4 text-base text-club-brown">
                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 text-club-brown space-y-1.5">
                  <p className="font-bold flex items-center gap-1.5 text-base text-amber-950">
                    <i className="fa-solid fa-paper-plane text-club-orange" /> Paso 2: Código enviado por correo
                  </p>
                  <p className="text-base text-stone-700 leading-relaxed break-words">
                    Hemos despachado un código de seguridad de 6 dígitos a tu casilla: <strong className="text-club-brown">{forgotEmail}</strong>.
                  </p>
                  <p className="text-sm text-stone-600 leading-relaxed">
                    Por seguridad, no se puede cambiar la contraseña sin confirmar previamente el código recibido en tu bandeja de entrada. Tiene una validez de 1 hora.
                  </p>
                </div>

                <div>
                  <label className="block font-bold mb-1.5">Ingresá el código de 6 dígitos: *</label>
                  <input
                    type="text"
                    required
                    inputMode="numeric"
                    autoFocus
                    maxLength={6}
                    value={forgotCode}
                    onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    className="w-full px-3 py-2.5 bg-white border-2 border-amber-300 focus:border-club-orange rounded-xl outline-none text-center font-mono text-2xl font-bold tracking-widest shadow-inner text-club-brown"
                  />
                  <div className="flex flex-wrap justify-between items-center gap-2 mt-2.5 text-base">
                    <button
                      type="button"
                      onClick={handleResendResetCode}
                      disabled={forgotLoading}
                      className="text-club-orange font-bold hover:underline cursor-pointer disabled:opacity-50"
                    >
                      <i className="fa-solid fa-arrow-rotate-right mr-1" /> Reenviar código
                    </button>
                    <button
                      type="button"
                      onClick={() => setForgotStep('email')}
                      className="text-stone-600 hover:text-stone-800 cursor-pointer font-semibold"
                    >
                      Cambiar correo
                    </button>
                  </div>
                </div>

                <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-amber-200">
                  <button
                    type="button"
                    onClick={() => {
                      setModalForgotPasswordOpen(false);
                      setModalLoginOpen(true);
                    }}
                    className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading || forgotCode.length !== 6}
                    className="pill-btn px-5 py-2 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {forgotLoading ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Verificando...
                      </>
                    ) : (
                      <>
                        Confirmar código <i className="fa-solid fa-check" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* PASO 3: Definición segura de nueva contraseña (solo habilitado con token verificado) */}
            {forgotStep === 'password' && (
              <form onSubmit={handleResetPasswordSubmit} className="space-y-4 text-base text-club-brown">
                <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 text-emerald-950 space-y-1.5">
                  <p className="font-bold flex items-center gap-1.5 text-base text-emerald-900">
                    <i className="fa-solid fa-circle-check text-emerald-600" /> Paso 3: Identidad confirmada
                  </p>
                  <p className="text-base text-emerald-800 break-words">
                    Usuario: <strong>@{forgotUserFound?.usuario}</strong> ({forgotUserFound?.apodo})
                  </p>
                  <p className="text-sm text-emerald-700 leading-relaxed break-words">
                    Confirmamos tu identidad con el código enviado a tu casilla <strong>{forgotEmail}</strong>. Ahora podés definir tu nueva contraseña.
                  </p>
                </div>

                <div>
                  <label className="block font-bold mb-1.5">Nueva Contraseña: *</label>
                  <input
                    type="password"
                    required
                    autoFocus
                    value={forgotNewPassword}
                    onChange={(e) => setForgotNewPassword(e.target.value)}
                    placeholder="Mínimo 3 caracteres"
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1.5">Confirmar Nueva Contraseña: *</label>
                  <input
                    type="password"
                    required
                    value={forgotConfirmPassword}
                    onChange={(e) => setForgotConfirmPassword(e.target.value)}
                    placeholder="Repetí la contraseña"
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                  />
                </div>

                <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-amber-200">
                  <button
                    type="button"
                    onClick={() => setForgotStep('code')}
                    className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
                  >
                    Volver
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="pill-btn px-5 py-2 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow-sm cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {forgotLoading ? (
                      <>
                        <i className="fa-solid fa-spinner fa-spin" /> Guardando...
                      </>
                    ) : (
                      <>
                        <i className="fa-solid fa-lock" /> Guardar nueva contraseña
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* PASO 4: Éxito final */}
            {forgotStep === 'success' && (
              <div className="space-y-4 text-base text-club-brown text-center py-2">
                <div className="w-14 h-14 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
                  <i className="fa-solid fa-check" />
                </div>
                <div className="space-y-1.5">
                  <h4 className="font-brand text-xl font-bold text-club-brown">¡Contraseña restablecida con éxito!</h4>
                  <p className="text-stone-600 leading-relaxed text-base">
                    Tu contraseña ha sido actualizada de forma segura tras la confirmación desde tu correo electrónico.
                  </p>
                </div>
                <div className="p-3.5 bg-white rounded-2xl border border-amber-200 text-base text-stone-600 leading-relaxed break-words">
                  Ya podés iniciar sesión con tu usuario <strong>@{forgotUserFound?.usuario}</strong> y tu nueva contraseña.
                </div>
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setModalForgotPasswordOpen(false);
                      setModalLoginOpen(true);
                    }}
                    className="pill-btn w-full py-2.5 bg-club-orange hover:bg-club-orange-dark text-white font-bold text-base shadow-md cursor-pointer flex items-center justify-center gap-2"
                  >
                    <i className="fa-solid fa-right-to-bracket" /> Iniciar sesión ahora
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: REGISTRARSE */}
      {modalRegisterOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className={`bg-club-cream w-full ${regForm.tipo === 'institucional' ? 'max-w-2xl' : 'max-w-lg'} rounded-3xl border-2 border-amber-200 p-5 sm:p-6 space-y-4 shadow-2xl max-h-[92vh] overflow-y-auto transition-all min-w-0`}>
            <div className="flex justify-between items-center gap-2 border-b border-amber-200 pb-2">
              <h3 className="font-brand text-xl font-bold text-club-brown min-w-0 break-words">
                {regForm.tipo === 'institucional' ? 'Registro Institucional' : 'Crear Nueva Cuenta'}
              </h3>
              <button
                onClick={() => setModalRegisterOpen(false)}
                className="text-2xl text-stone-400 hover:text-stone-700 font-bold leading-none cursor-pointer shrink-0 p-1"
                aria-label="Cerrar modal"
              >
                &times;
              </button>
            </div>

            {regError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-base rounded-xl font-semibold flex items-center gap-2 leading-relaxed">
                <i className="fa-solid fa-circle-exclamation text-rose-500 text-base flex-shrink-0" />
                <span className="min-w-0 break-words">{regError}</span>
              </div>
            )}

            <form onSubmit={handleRegister} className="space-y-4 text-base text-club-brown">
              <div>
                <label className="block font-bold mb-1.5">¿Qué tipo de cuenta deseás registrar?</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer font-bold transition min-w-0 ${
                    regForm.tipo === 'personal'
                      ? 'border-club-orange bg-amber-50 text-club-brown shadow-2xs'
                      : 'border-amber-200 bg-white text-stone-600'
                  }`}>
                    <input
                      type="radio"
                      name="reg_tipo"
                      value="personal"
                      checked={regForm.tipo === 'personal'}
                      onChange={() => setRegForm({ ...regForm, tipo: 'personal' })}
                      className="shrink-0"
                    />{' '}
                    <span className="break-words">Personal (+65)</span>
                  </label>
                  <label className={`flex items-center gap-2.5 p-3 rounded-xl border cursor-pointer font-bold transition min-w-0 ${
                    regForm.tipo === 'institucional'
                      ? 'border-blue-500 bg-blue-50 text-blue-950 shadow-2xs'
                      : 'border-amber-200 bg-white text-stone-600'
                  }`}>
                    <input
                      type="radio"
                      name="reg_tipo"
                      value="institucional"
                      checked={regForm.tipo === 'institucional'}
                      onChange={() => setRegForm({ ...regForm, tipo: 'institucional' })}
                      className="shrink-0"
                    />{' '}
                    <span className="break-words">Institucional</span>
                  </label>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  <label className="font-bold">
                    {regForm.tipo === 'institucional' ? 'Nombre oficial de la Institución o Centro: *' : 'Nombre o apodo: *'}
                  </label>
                  {regForm.tipo !== 'institucional' && (
                    <div className="relative group inline-block">
                      <span
                        tabIndex={0}
                        className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-sm font-black flex items-center justify-center cursor-help border border-amber-300"
                        aria-label="Información sobre tu nombre o apodo"
                      >
                        <i className="fa-solid fa-info" />
                      </span>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block group-focus:block z-30 w-64 p-2.5 bg-stone-900 text-amber-50 text-sm rounded-xl shadow-xl border border-amber-400/30 text-center leading-relaxed pointer-events-none">
                        Con este nombre o apodo le aparecerás a otros usuarios de la plataforma en chats, actividades y reseñas.
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-stone-900" />
                      </div>
                    </div>
                  )}
                </div>
                <input
                  type="text"
                  required
                  value={regForm.nombre}
                  onChange={(e) => setRegForm({ ...regForm, nombre: e.target.value })}
                  placeholder={regForm.tipo === 'institucional' ? 'Ej: Centro de Jubilados Caseros / Club Social' : 'Ej: Mario Gómez'}
                  className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1.5">Nombre de Usuario (para iniciar sesión): *</label>
                  <input
                    type="text"
                    required
                    value={regForm.usuario}
                    onChange={(e) => setRegForm({ ...regForm, usuario: e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '') })}
                    placeholder="Ej: centrojubilados_caseros"
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1.5">Correo electrónico oficial: *</label>
                  <input
                    type="email"
                    required
                    value={regForm.email}
                    onChange={(e) => setRegForm({ ...regForm, email: e.target.value })}
                    placeholder="contacto@institucion.org.ar"
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                  />
                </div>
              </div>

              {/* SECCIÓN INSTITUCIONAL DESTACADA */}
              {regForm.tipo === 'institucional' && (
                <div className="p-4 bg-blue-50/70 border-2 border-blue-200 rounded-2xl space-y-4">
                  <div className="flex items-center gap-3 text-blue-900 font-bold border-b border-blue-200 pb-2.5">
                    <div className="w-9 h-9 rounded-full bg-blue-100 border border-blue-300 flex items-center justify-center text-club-teal text-base flex-shrink-0">
                      <i className="fa-solid fa-shield-halved" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-base text-blue-950 break-words">Datos de Validación y Personería Jurídica</h4>
                      <p className="text-sm text-blue-800/85 font-normal leading-relaxed">
                        Validación para Clubes, Centros de Jubilados, Asociaciones y Entes Estatales en Argentina
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5 text-sm font-black text-blue-900 uppercase tracking-wide">
                      <i className="fa-solid fa-landmark text-blue-600" />
                      <span>1. Datos Institucionales Básicos</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold mb-1 text-base">Tipo de entidad: *</label>
                        <select
                          value={regForm.entidadTipo}
                          onChange={(e) => setRegForm({ ...regForm, entidadTipo: e.target.value })}
                          className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl outline-none text-base text-club-brown focus:ring-2 focus:ring-blue-400 font-medium"
                        >
                          <option value="Asociación Civil / Club Social">Asociación Civil / Club Social</option>
                          <option value="Centro de Jubilados">Centro de Jubilados</option>
                          <option value="Centro Cultural">Centro Cultural</option>
                          <option value="Municipio / Ente Estatal">Municipio / Ente Estatal</option>
                          <option value="Fundación">Fundación</option>
                          <option value="Otro">Otro</option>
                        </select>
                      </div>

                      <div>
                        <label className="block font-bold mb-1 text-base">CUIT (XX-XXXXXXXX-X): *</label>
                        <input
                          type="text"
                          required={regForm.tipo === 'institucional'}
                          value={regForm.cuit}
                          maxLength={13}
                          onChange={(e) => setRegForm({ ...regForm, cuit: formatCuitMask(e.target.value) })}
                          placeholder="30-XXXXXXXX-X"
                          className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl outline-none text-base text-club-brown font-mono focus:ring-2 focus:ring-blue-400"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold mb-1 text-base">Teléfono de contacto institucional: *</label>
                        <input
                          type="tel"
                          required={regForm.tipo === 'institucional'}
                          value={regForm.contactoInstitucional}
                          onChange={(e) => setRegForm({ ...regForm, contactoInstitucional: e.target.value })}
                          placeholder="Ej: 11 4750-1234 / 11 5533-8899"
                          className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl outline-none text-base text-club-brown focus:ring-2 focus:ring-blue-400"
                        />
                      </div>

                      <div>
                        <label className="block font-bold mb-1 text-base">Dirección física (calle y altura): *</label>
                        <input
                          type="text"
                          required={regForm.tipo === 'institucional'}
                          value={regForm.direccionFisica}
                          onChange={(e) => setRegForm({ ...regForm, direccionFisica: e.target.value })}
                          placeholder="Ej: Av. San Martín 1450"
                          className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl outline-none text-base text-club-brown focus:ring-2 focus:ring-blue-400"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block font-bold mb-1 text-base">
                        Enlace a Sitio Web oficial o Red Social: <span className="font-normal text-stone-500 text-sm">(Opcional recomendado)</span>
                      </label>
                      <input
                        type="text"
                        value={regForm.sitioWebRedSocial}
                        onChange={(e) => setRegForm({ ...regForm, sitioWebRedSocial: e.target.value })}
                        placeholder="https://instagram.com/tu_institucion o sitio oficial"
                        className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl outline-none text-base text-club-brown focus:ring-2 focus:ring-blue-400"
                      />
                    </div>
                  </div>

                  <div className="space-y-3 pt-2.5 border-t border-blue-200">
                    <div className="flex items-center gap-1.5 text-sm font-black text-blue-900 uppercase tracking-wide">
                      <i className="fa-solid fa-user-tie text-blue-600" />
                      <span>2. Datos del Responsable / Manager de la cuenta</span>
                    </div>

                    <div>
                      <label className="block font-bold mb-1 text-base">
                        Nombre y Apellido del Presidente o Funcionario a cargo: *
                      </label>
                      <input
                        type="text"
                        required={regForm.tipo === 'institucional'}
                        value={regForm.presidenteFuncionario}
                        onChange={(e) => setRegForm({ ...regForm, presidenteFuncionario: e.target.value })}
                        placeholder="Ej: Lic. Roberto Gómez (Presidente / Director)"
                        className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl outline-none text-base text-club-brown focus:ring-2 focus:ring-blue-400"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-bold mb-1 text-base">
                          Persona que es manager de la cuenta: <span className="font-normal text-stone-500 text-sm">(si es diferente)</span>
                        </label>
                        <input
                          type="text"
                          value={regForm.managerNombre || regForm.gestorNombre}
                          onChange={(e) => setRegForm({ ...regForm, managerNombre: e.target.value, gestorNombre: e.target.value })}
                          placeholder="Ej: Lucía Martínez"
                          className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl outline-none text-base text-club-brown focus:ring-2 focus:ring-blue-400"
                        />
                      </div>

                      <div>
                        <label className="block font-bold mb-1 text-base">Cargo/rol del manager de la cuenta en la entidad:</label>
                        <input
                          type="text"
                          value={regForm.managerRol || regForm.gestorRol}
                          onChange={(e) => setRegForm({ ...regForm, managerRol: e.target.value, gestorRol: e.target.value })}
                          placeholder="Ej: Secretaria / Director de Tercera Edad / Coordinador"
                          className="w-full px-3 py-2.5 bg-white border border-blue-200 rounded-xl outline-none text-base text-club-brown focus:ring-2 focus:ring-blue-400"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-2.5 border-t border-blue-200">
                    <div className="flex items-center gap-1.5 text-sm font-black text-blue-900 uppercase tracking-wide">
                      <i className="fa-solid fa-folder-open text-blue-600" />
                      <span>3. Documentación de Respaldo</span>
                    </div>

                    <InstitutionalDocUploadField
                      title="Constancia de CUIT / Inscripción ARCA"
                      subtitle="Adjuntá la constancia oficial emitida por ARCA (ex-AFIP) en PDF o imagen."
                      file={regFiles.constanciaCuit}
                      onFileChange={(f) => setRegFiles(prev => ({ ...prev, constanciaCuit: f }))}
                      required
                    />

                    <InstitutionalDocUploadField
                      title="Documento que acredite personería o representación"
                      subtitle="Acta de designación de autoridades, estatuto social o nota oficial membretada firmada."
                      file={regFiles.personeriaDoc}
                      onFileChange={(f) => setRegFiles(prev => ({ ...prev, personeriaDoc: f }))}
                      required
                    />
                  </div>
                </div>
              )}

              {/* Password & Localidad */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1.5">
                    {regForm.tipo === 'institucional' ? 'Contraseña para la cuenta institucional: *' : 'Contraseña: *'}
                  </label>
                  <input
                    type="password"
                    required
                    value={regForm.clave}
                    onChange={(e) => setRegForm({ ...regForm, clave: e.target.value })}
                    placeholder="••••••••"
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1.5">
                    {regForm.tipo === 'institucional' ? 'Partido / Municipio de radicación: *' : 'Localidad (Barrio): *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={regForm.localidad}
                    onChange={(e) => setRegForm({ ...regForm, localidad: e.target.value })}
                    placeholder={regForm.tipo === 'institucional' ? 'Ej: Tres de Febrero / Caseros' : 'Ej: Caseros'}
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none focus:ring-2 focus:ring-club-orange text-base"
                  />
                </div>
              </div>

              <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 space-y-1.5">
                <label className="flex items-start gap-2.5 cursor-pointer font-bold text-base leading-relaxed">
                  <input
                    type="checkbox"
                    required
                    checked={regForm.terminos}
                    onChange={(e) => setRegForm({ ...regForm, terminos: e.target.checked })}
                    className="mt-1 shrink-0"
                  />
                  <span className="min-w-0 break-words">
                    {regForm.tipo === 'institucional'
                      ? 'Declaro bajo juramento la veracidad de la personería y documentación institucional aportada y acepto los Términos y Convivencia de CLUB65.'
                      : 'Acepto los Términos y Condiciones y las Políticas de Privacidad y Convivencia de CLUB65.'}
                  </span>
                </label>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="submit"
                  className="pill-btn w-full py-3 px-4 bg-club-orange hover:bg-club-orange-dark text-white font-bold shadow-md cursor-pointer transition flex items-center justify-center gap-2 text-base"
                >
                  <i className={regForm.tipo === 'institucional' ? 'fa-solid fa-building-circle-check' : 'fa-solid fa-user-plus'} />
                  {regForm.tipo === 'institucional' ? 'Enviar Solicitud de Registro Institucional' : 'Crear mi cuenta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDITAR MI PERFIL */}
      {modalEditProfileOpen && currentUser && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-amber-200 retro-shadow-strong overflow-hidden flex flex-col max-h-[90dvh] min-w-0">
            <div className="p-4 bg-white border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-brand text-xl font-bold text-club-brown">Mi Perfil</h3>
              {currentUser.tipo === 'moderador' ? (
                <span className="px-3 py-1 rounded-full text-sm font-bold bg-purple-100 text-purple-800 border border-purple-300 flex items-center gap-1.5 shadow-xs">
                  <i className="fa-solid fa-shield-halved" /> Perfil de Administrador
                </span>
              ) : currentUser.tipo === 'institucional' ? (
                <span className="px-3 py-1 rounded-full text-sm font-bold bg-blue-100 text-blue-800 border border-blue-300 flex items-center gap-1.5 shadow-xs">
                  <i className="fa-solid fa-landmark" /> Perfil Institucional
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full text-sm font-bold bg-amber-100 text-amber-800 border border-amber-300 flex items-center gap-1.5 shadow-xs">
                  <i className="fa-solid fa-user" /> Perfil Personal
                </span>
              )}
            </div>

            <form onSubmit={handleSaveProfile} className="p-5 space-y-4 text-base text-club-brown overflow-y-auto">
              {currentUser.tipo === 'moderador' && (
                <div className="p-3.5 bg-purple-50 border border-purple-200 rounded-2xl flex items-start gap-3 text-base text-purple-900">
                  <i className="fa-solid fa-shield-halved text-purple-700 text-lg mt-0.5 flex-shrink-0" />
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold">Cuenta de Moderación y Administración</p>
                    <p className="text-sm text-purple-800 leading-relaxed break-words">
                      Tu perfil cuenta con atribuciones oficiales para validar actividades, gestionar reportes de seguridad, supervisar sanciones y administrar la plataforma CLUB65.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4">
                {profileForm.avatar && profileForm.avatar.trim() !== '' ? (
                  <img
                    src={profileForm.avatar}
                    alt={profileForm.apodo}
                    className="w-16 h-16 rounded-full object-cover border-2 border-club-orange shadow-sm cursor-pointer shrink-0"
                    onClick={() => {
                      setModalVisorImgShape('circle');
                      setModalVisorImgSrc(profileForm.avatar);
                    }}
                    title="Hacé clic para ver en grande"
                    onError={(e) => {
                      (e.currentTarget as HTMLElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-club-orange text-white font-bold text-xl flex items-center justify-center border-2 border-club-orange shadow-sm shrink-0">
                    {(profileForm.apodo || currentUser.usuario || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="space-y-2 min-w-0">
                  <p className="text-base font-black text-club-brown break-words">
                    Usuario: <span className="text-club-orange">@{currentUser.usuario}</span>
                  </p>
                  <div>
                    <label className="pill-btn px-4 py-2 bg-amber-100 hover:bg-amber-200 text-club-brown font-bold border border-amber-300 cursor-pointer inline-flex items-center gap-2 text-base shadow-2xs">
                      <i className="fa-solid fa-upload text-club-orange" /> {profileForm.avatar ? 'Cambiar foto de perfil' : 'Subir foto de perfil'}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleProfilePhotoFile}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                  <label className="font-bold text-club-brown">Nombre o Apodo en la plataforma:</label>
                  <div className="relative group inline-block">
                    <span
                      tabIndex={0}
                      className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-sm font-black flex items-center justify-center cursor-help border border-amber-300"
                      aria-label="Información sobre tu apodo"
                    >
                      <i className="fa-solid fa-info" />
                    </span>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block group-focus:block z-30 w-64 p-2.5 bg-stone-900 text-amber-50 text-sm rounded-xl shadow-xl border border-amber-400/30 text-center leading-relaxed pointer-events-none">
                      Con este nombre o apodo le aparecerás a otros usuarios de la plataforma en chats, actividades y reseñas.
                      <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-stone-900" />
                    </div>
                  </div>
                </div>
                <input
                  type="text"
                  required
                  value={profileForm.apodo}
                  onChange={(e) => setProfileForm({ ...profileForm, apodo: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none text-base font-bold focus:ring-2 focus:ring-club-orange"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="font-bold text-club-brown">Breve descripción:</label>
                  <span className="text-sm text-stone-500 font-semibold">{profileForm.bio.length} / 140</span>
                </div>
                <textarea
                  maxLength={140}
                  rows={3}
                  value={profileForm.bio}
                  onChange={(e) => setProfileForm({ ...profileForm, bio: e.target.value })}
                  placeholder="Contá un poco sobre tus gustos o hobbies..."
                  className="w-full p-3 bg-white border border-amber-200 rounded-xl outline-none text-base leading-relaxed focus:ring-2 focus:ring-club-orange"
                />
              </div>

              {currentUser.tipo !== 'moderador' && (
                <div className="mb-2">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <label className="font-bold text-club-brown">Contacto de emergencia:</label>
                    <div className="relative group inline-block">
                      <span
                        tabIndex={0}
                        className="w-5 h-5 rounded-full bg-amber-200 text-amber-900 text-sm font-black flex items-center justify-center cursor-help border border-amber-300"
                        aria-label="Información sobre contacto de emergencia"
                      >
                        <i className="fa-solid fa-info" />
                      </span>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block group-focus:block z-30 w-64 p-2.5 bg-stone-900 text-amber-50 text-sm rounded-xl shadow-xl border border-amber-400/30 text-center leading-relaxed pointer-events-none">
                        Solo se le mostrará al organizador de la actividad en la que te inscribas por una eventual emergencia.
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-stone-900" />
                      </div>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={profileForm.contactoEmergencia || ''}
                    onChange={(e) => setProfileForm({ ...profileForm, contactoEmergencia: e.target.value })}
                    placeholder="Ej: 11 2345-6789 (Hijo / Familiar)"
                    className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none text-base font-medium focus:ring-2 focus:ring-club-orange"
                  />
                </div>
              )}

              <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-amber-200">
                <button
                  type="button"
                  onClick={() => setModalEditProfileOpen(false)}
                  className="pill-btn px-4 py-2 bg-stone-100 text-stone-700 text-base font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="pill-btn px-5 py-2 bg-club-orange text-white text-base font-bold shadow-sm cursor-pointer"
                >
                  Guardar cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR CANCELACIÓN */}
      {modalConfirmarCancelacion && (
        <div className="fixed inset-0 bg-black/75 z-[60] flex items-center justify-center p-3">
          <div className="bg-club-cream w-full max-w-md rounded-3xl border-2 border-rose-300 p-5 sm:p-6 space-y-4 shadow-2xl max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="flex items-center gap-3 text-rose-700">
              <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-2xl flex-shrink-0">
                <i className="fa-solid fa-triangle-exclamation" />
              </div>
              <div className="min-w-0">
                <h3 className="font-brand text-xl font-bold text-club-brown">Cancelar Actividad</h3>
                <p className="text-base text-rose-600 font-semibold">Esta acción no se puede deshacer.</p>
              </div>
            </div>

            <p className="text-base text-club-brown leading-relaxed bg-white p-3.5 rounded-2xl border border-rose-200 break-words">
              ¿Estás seguro de que querés cancelar tu actividad "{modalConfirmarCancelacion.nombre}" programada para {modalConfirmarCancelacion.dia}{modalConfirmarCancelacion.hora ? ` a las ${modalConfirmarCancelacion.hora}` : ''}?
            </p>

            <div className="space-y-1.5 text-base">
              <label className="block font-bold text-club-brown">
                Motivo de la cancelación:
              </label>
              <textarea
                rows={2}
                value={motivoCancelacionInput}
                onChange={(e) => setMotivoCancelacionInput(e.target.value)}
                placeholder="Cancelada por el organizador"
                disabled={isCancellingActivity}
                className="w-full p-3 bg-white border border-rose-200 rounded-xl outline-none text-base focus:ring-2 focus:ring-rose-500 disabled:opacity-60"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-amber-200">
              <button
                type="button"
                disabled={isCancellingActivity}
                onClick={() => {
                  setModalConfirmarCancelacion(null);
                  setMotivoCancelacionInput('Cancelada por el organizador');
                }}
                className="pill-btn px-5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer disabled:opacity-50"
              >
                NO
              </button>
              <button
                type="button"
                disabled={isCancellingActivity}
                onClick={() => {
                  const targetAct = (modalConfirmarCancelacion.id !== undefined
                    ? activities.find(a => String(a.id) === String(modalConfirmarCancelacion.id))
                    : null) || activities.find(a => {
                    const aTitle = (a.title || '').toLowerCase().trim();
                    const mTitle = (modalConfirmarCancelacion.nombre || '').toLowerCase().trim();
                    return aTitle === mTitle || (mTitle.length >= 3 && aTitle.includes(mTitle.slice(0, 10)));
                  });
                  const resolvedId = modalConfirmarCancelacion.id ?? targetAct?.id;
                  if (resolvedId !== undefined) {
                    handleDarDeBajaActividad(resolvedId, motivoCancelacionInput);
                  }
                }}
                className="pill-btn px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white text-base font-bold shadow-sm cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
              >
                {isCancellingActivity ? (
                  <>
                    <i className="fa-solid fa-spinner animate-spin" /> Guardando...
                  </>
                ) : (
                  'SÍ'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR BAJA FORZADA CON MOTIVO */}
      {modalBajaActividad && (
        <div className="fixed inset-0 bg-black/75 z-[80] flex items-center justify-center p-4">
          <div className="bg-club-cream w-full max-w-md rounded-3xl border-2 border-rose-300 p-5 sm:p-6 space-y-4 shadow-2xl text-club-brown animate-in fade-in zoom-in-95 max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="flex items-center gap-3 text-rose-700 border-b border-rose-200 pb-3">
              <i className="fa-solid fa-ban text-2xl shrink-0" />
              <div className="min-w-0">
                <span className="text-sm font-black uppercase tracking-wider bg-rose-100 text-rose-800 px-2.5 py-0.5 rounded-full inline-block">
                  Baja Forzada
                </span>
                <h4 className="font-brand text-xl font-bold text-club-brown mt-1">
                  Dar de baja actividad
                </h4>
              </div>
            </div>
            <p className="text-base text-stone-700 leading-relaxed bg-white p-3.5 rounded-xl border border-rose-100 break-words">
              ¿Estás seguro de forzar la baja de la actividad <strong>"{modalBajaActividad.title}"</strong> de la Cartelera pública?
            </p>
            <div className="space-y-1.5 text-base">
              <label className="block font-bold text-club-brown">
                Motivo de la baja forzada: *
              </label>
              <textarea
                rows={3}
                required
                value={motivoBajaInput}
                onChange={(e) => setMotivoBajaInput(e.target.value)}
                disabled={isCancellingActivity}
                placeholder="Explicá el motivo de la baja (ej: obras de mantenimiento, suspensión de espacio, incumplimiento)..."
                className="w-full p-3 bg-white border border-rose-200 rounded-xl outline-none text-base focus:ring-2 focus:ring-rose-500 disabled:opacity-60"
              />
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-rose-200">
              <button
                type="button"
                disabled={isCancellingActivity}
                onClick={() => {
                  setModalBajaActividad(null);
                  setMotivoBajaInput('');
                }}
                className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={isCancellingActivity}
                onClick={handleConfirmarBajaForzada}
                className="pill-btn px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-base font-bold shadow-xs cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
              >
                {isCancellingActivity ? (
                  <>
                    <i className="fa-solid fa-spinner animate-spin" /> Guardando...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-ban" /> Confirmar baja de actividad
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

     {/* MODAL: VER PARTICIPANTES CON AGENDAR CONTACTO Y MODERADOR BADGE */}
      {modalVerParticipantesOpen && activeChat && (() => {
        const isVetoed = isUserVetoedFromChat(activeChat, currentUser);
        const isLeftVoluntarily = isUserLeftVoluntarilyFromChat(activeChat, currentUser);
        const isRemoved = isUserRemovedFromChat(activeChat, currentUser);
        const isOut = isLeftVoluntarily || isRemoved || isVetoed;

        const chat = activeChat as any;
        const relatedAct = activities.find((a: any) =>
          (chat.activityId && String(a.id) === String(chat.activityId)) ||
          (a.title && chat.name && a.title.trim().toLowerCase() === String(chat.name).trim().toLowerCase())
        ) as any;

        const resolvedParticipants = getResolvedChatParticipants(
          activeChat,
          currentUser,
          allUsersMap,
          relatedAct,
          contacts
        );

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
            <div className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-amber-200 p-5 space-y-4 shadow-xl max-h-[90dvh] flex flex-col min-w-0">
              <div className="border-b border-amber-200 pb-2 flex flex-wrap justify-between items-center gap-2">
                <h3 className="font-brand text-xl font-bold text-club-brown min-w-0 break-words">
                  {isOut ? 'Participantes del Grupo (Al momento de tu retiro)' : 'Participantes del Grupo'}
                </h3>
                <span className="text-base font-bold bg-amber-100 text-club-brown px-3 py-0.5 rounded-full shrink-0">
                  {resolvedParticipants.length}
                </span>
              </div>

              {isLeftVoluntarily ? (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-sm text-stone-600 flex items-center gap-2 leading-relaxed">
                  <i className="fa-solid fa-clock-rotate-left text-club-orange shrink-0" />
                  <span className="min-w-0 break-words">Mostrando los participantes que integraban el grupo al momento de tu salida</span>
                </div>
              ) : (isRemoved || isVetoed) ? (
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-sm text-stone-600 flex items-center gap-2 leading-relaxed">
                  <i className="fa-solid fa-clock-rotate-left text-club-orange shrink-0" />
                  <span className="min-w-0 break-words">Mostrando los participantes que integraban el grupo al momento en que fuiste retirado/a.</span>
                </div>
              ) : null}

              <div className="space-y-2.5 text-base overflow-y-auto flex-1 pr-0.5">
                {resolvedParticipants.map((part, idx) => {
                  const displayName = part.displayName;
                  const pLower = displayName.trim().toLowerCase();
                  const contactInfo = contacts.find((c: any) => (c.nombre || '').toLowerCase().trim() === pLower);
                  const isSelfParticipant = part.isSelf;
                  const isModerador = part.isAdmin;
                  const isModerator = isModerador;
                  const yaEsContacto = currentUser && !isSelfParticipant
                    ? contacts.some((c: any) => (c.nombre || '').toLowerCase().trim() === pLower && !isSelfUserOrContact(c, currentUser))
                    : false;

                  const rawPartPhoto = getUserPhotoByName(part.userId) || getUserPhotoByName(displayName) || part.foto || contactInfo?.foto;
                  const photoUrl = sanitizeProfileAvatar(rawPartPhoto);

                  return (
                    <div key={part.canonicalId || idx} className="p-3 bg-white rounded-2xl border border-amber-200 flex flex-wrap justify-between items-center gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-club-blue text-club-brown font-bold flex items-center justify-center text-base shrink-0 overflow-hidden">
                          {photoUrl ? (
                            <img src={photoUrl} alt={displayName} className="w-full h-full object-cover" />
                          ) : (
                            part.avatar || displayName.slice(0, 2).toUpperCase()
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-bold text-base text-club-brown break-words">{displayName}</p>
                            {isSelfParticipant && (
                              <span className="text-sm bg-stone-200 text-stone-700 font-bold px-2 py-0.5 rounded">
                                Vos
                              </span>
                            )}
                            {isModerador && (
                              <span className="text-sm font-bold bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full border border-amber-300">
                                👑 Moderador
                              </span>
                            )}
                          </div>
                          <p className={`text-sm font-semibold break-words ${isModerador ? 'text-amber-800' : 'text-stone-500'}`}>
                            {isModerador ? 'Moderador/a del grupo' : 'Participante'}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                        {currentUser && !isSelfParticipant && (
                          yaEsContacto ? (
                            <span className="px-3 py-1.5 flex items-center justify-center text-sm text-emerald-800 font-bold bg-emerald-50 rounded-xl border border-emerald-200">
                              <i className="fa-solid fa-check mr-1" /> Agendado
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => (handleAgendarContacto as any)(displayName, '', displayName.slice(0, 2).toUpperCase(), 'bg-club-teal')}
                              className="px-3.5 py-1.5 flex items-center justify-center pill-btn bg-club-teal text-white font-bold text-base cursor-pointer hover:opacity-90"
                            >
                              <i className="fa-solid fa-user-plus mr-1" /> Agendar
                            </button>
                          )
                        )}
                        <button
                          onClick={() => {
                            setModalVerParticipantesOpen(false);
                            openUserProfileByName(displayName, part.userId);
                          }}
                          className="px-3.5 py-1.5 flex items-center justify-center pill-btn bg-amber-100 hover:bg-amber-200 text-club-brown font-bold text-base cursor-pointer"
                        >
                          Ver perfil
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 flex justify-end border-t border-amber-200">
                <button
                  onClick={() => setModalVerParticipantesOpen(false)}
                  className="pill-btn px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-base cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: DETALLE DE ACTIVIDAD (Con Días y Horarios vs Día y Horario y Evento Recurrente/Único) */}
      {modalActividad && (() => {
        const isCancelled = modalActividad.proposalStatus === 'baja_forzada' || modalActividad.proposalStatus === 'cancelada_organizador' || Boolean(modalActividad.canceladaPorOrganizador);
        return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-2xl rounded-3xl border-2 border-amber-200 retro-shadow-strong overflow-hidden max-h-[92vh] flex flex-col min-w-0">
            <div className="p-4 sm:p-5 bg-white border-b border-amber-200 flex items-start justify-between gap-2">
              <div className="min-w-0">
                {(() => {
                  const modalOrgHeader = resolveActivityOrganizerDisplay(modalActividad);
                  return (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-sm font-black uppercase tracking-wider px-3 py-0.5 rounded-full inline-block ${
                          modalOrgHeader.isInstitutional
                            ? 'bg-blue-100 text-blue-900'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {modalOrgHeader.isInstitutional ? (
                          <>
                            <i className="fa-solid fa-circle-check text-blue-600 mr-1" /> Institución Verificada
                          </>
                        ) : (
                          <>
                            <i className="fa-solid fa-users text-club-orange mr-1" /> Actividad de la comunidad
                          </>
                        )}
                      </span>
                    </div>
                  );
                })()}

                <h3 className="font-brand text-xl sm:text-2xl font-bold text-club-brown mt-1 break-words">
                  {modalActividad.title}
                </h3>
              </div>
              {!(isCancelled || modalCustomActivity) && (
                <button
                  onClick={closeModalDetalle}
                  className="text-stone-400 hover:text-club-brown text-2xl font-bold leading-none p-1 cursor-pointer shrink-0"
                  aria-label="Cerrar detalle"
                >
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-club-brown text-base">
              <div className="p-3.5 bg-amber-100/70 rounded-2xl border border-amber-300 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                {(() => {
                  const orgDisplay = resolveActivityOrganizerDisplay(modalActividad);
                  const orgApodo = orgDisplay.name;
                  const orgPhoto = orgDisplay.avatar;
                  const orgIsInst = orgDisplay.isInstitutional;
                  const orgLocation = orgDisplay.location;

                  return (
                    <div className="flex items-center gap-3 min-w-0">
                      {orgPhoto && (
                        <img
                          src={orgPhoto}
                          alt={orgApodo}
                          referrerPolicy="no-referrer"
                          className="w-12 h-12 rounded-full object-cover border border-amber-300 shadow-xs flex-shrink-0 bg-white"
                          onError={(e) => {
                            const img = e.currentTarget;
                            img.classList.add('hidden');
                            const fallback = img.nextElementSibling;
                            if (fallback) {
                              fallback.classList.remove('hidden');
                              fallback.classList.add('flex');
                            }
                          }}
                        />
                      )}
                      <div
                        className={`w-12 h-12 rounded-full ${orgPhoto ? 'hidden' : 'flex'} items-center justify-center text-lg font-bold shadow-xs flex-shrink-0 ${
                          orgIsInst ? 'bg-club-blue text-club-brown' : 'bg-club-orange text-white'
                        }`}
                      >
                        {orgIsInst ? <i className="fa-solid fa-landmark" /> : <i className="fa-solid fa-user" />}
                      </div>
                      <div className="min-w-0">
                        <span className="text-sm font-bold text-stone-500 uppercase block">Organizado por</span>
                        <p className="font-bold text-base text-club-brown flex items-center gap-1.5 flex-wrap break-words">
                          <span>{orgApodo}</span>
                          {orgIsInst && <i className="fa-solid fa-circle-check text-blue-600 text-sm" />}
                        </p>
                        <p className="text-sm text-stone-600 break-words">
                          {orgIsInst ? 'Institución oficial verificada' : 'Vecino organizador'}
                          {orgLocation ? ` • ${orgLocation}` : ''}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                {currentUser && (
                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    <button
                      onClick={() => {
                        const orgDisplay = resolveActivityOrganizerDisplay(modalActividad);
                        setModalDetalleId(null);
                        openUserProfileByName(
                          orgDisplay.name,
                          orgDisplay.organizerId || modalActividad.organizerId || (modalActividad as any).userId || (modalActividad as any).creador_id
                        );
                      }}
                      className="pill-btn px-4 py-1.5 bg-white hover:bg-amber-50 text-club-brown text-base font-bold border border-amber-300 cursor-pointer"
                    >
                      Ver perfil
                    </button>
                  </div>
                )}
              </div>

              <div className={`grid ${isCancelled ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'} gap-3 bg-white p-4 rounded-2xl border border-amber-200/70 text-base`}>
                <div className="min-w-0">
                  <p className="text-sm text-stone-500 font-bold">
                    {modalActividad.isRecurrent ? 'Días y Horarios' : 'Día y Horario'}
                  </p>
                {(() => {
                  const act = modalActividad as any;
                  const fIni = act.startDate || act.fechaIni || act.date || act.fecha;
                  const hIni = act.startTime || act.horaIni || act.time || act.hora;
                  const fFin = act.endDate || act.fechaFin;
                  const hFin = act.endTime || act.horaFin;
                  let scheduleDisplay = act.schedule ? act.schedule.replace(/(\d{4})-(\d{2})-(\d{2})/g, '$3/$2/$1') : '';

                  if (!act.isRecurrent && fIni && hIni) {
                    const fIniVisual = formatFechaVisual(fIni);
                    const fFinVisual = formatFechaVisual(fFin);
                    scheduleDisplay = `${fIniVisual} a las ${hIni} h`;
                    if (hFin) {
                      if (fFin && fFin !== fIni) {
                        scheduleDisplay += ` hasta ${fFinVisual} a las ${hFin} h`;
                      } else {
                        scheduleDisplay += ` hasta las ${hFin} h`;
                      }
                    }
                  }

                  if (isCancelled) {
                    return (
                      <p className="font-bold text-rose-700 flex items-center gap-1.5 mt-0.5 break-words">
                        <i className="fa-solid fa-ban text-rose-600 shrink-0" /> <span>Actividad cancelada ({scheduleDisplay})</span>
                      </p>
                    );
                  }

                  return <p className="font-bold text-club-brown break-words">{scheduleDisplay}</p>;
                })()}

{Boolean(modalActividad.isRecurrent && (modalActividad.firstMeetingDate || (modalActividad as any).fechaPrimerEncuentro)) && (
  <p className="text-sm font-bold text-club-orange mt-1.5 flex items-center gap-1.5">
    <i className="fa-regular fa-calendar-check" />
    <span>1° encuentro: {formatFechaVisual(modalActividad.firstMeetingDate || (modalActividad as any).fechaPrimerEncuentro)}</span>
  </p>
)}

                </div>
                {!isCancelled && (
                  <div className="min-w-0">
                    <p className="text-sm text-stone-500 font-bold">Cupos</p>
                    <p className="font-bold text-club-brown break-words">
                     {(() => {
                const rawList = Array.isArray(modalActividad.enrolledUsernames)
                  ? modalActividad.enrolledUsernames
                  : Array.isArray(modalActividad.inscriptos)
                    ? modalActividad.inscriptos
                    : [];
                const uniqueCount = new Set(
                  rawList
                    .map((u: any) => {
                      const val = typeof u === 'object' ? (u.id || u.usuario || u.apodo || u.nombre) : String(u || '');
                      return String(val).toLowerCase().trim();
                    })
                    .filter(Boolean)
                ).size;
                const totalInscriptos = uniqueCount > 0 ? uniqueCount : Number(modalActividad.enrolledCount || 0);
                if (
                    !modalActividad.capacity ||
                    Number(modalActividad.capacity) >= 999 ||
                    (modalActividad as any).tipoCupo === 'sin_limite' ||
                    (modalActividad as any).tipoCupo === 'ilimitado'
                  ) {
                    return `${totalInscriptos} inscriptos (Cupo libre)`;
                  }

                  const vacantes = Math.max(0, Number(modalActividad.capacity || 20) - totalInscriptos);
                  return `${totalInscriptos} de ${modalActividad.capacity} inscriptos (${vacantes} vacantes libres)`;
              })()}
                    </p>
                  </div>
                )}
              </div>

              {/* Opiniones de vecinos */}
              {didOtherBlockMe(modalActividad.organizer) ? (
                <div className="p-3.5 bg-stone-100 rounded-2xl border border-stone-200 text-stone-600 text-base font-semibold">
                  <i className="fa-solid fa-ban mr-1.5" /> Reseñas no disponibles (el organizador te bloqueó)
                </div>
              ) : isUserBlocked(modalActividad.organizer) ? (
                <div className="p-3.5 bg-stone-100 rounded-2xl border border-stone-200 text-stone-600 text-base font-semibold">
                  <i className="fa-solid fa-ban mr-1.5" /> Reseñas no disponibles (organizador bloqueado)
                </div>
              ) : (
                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-base min-w-0">
                    <span className="font-bold text-club-brown block">Esta actividad cuenta con opiniones de vecinos</span>
                    <span className="text-stone-600 text-sm">Consultá las valoraciones y fotos de los participantes.</span>
                  </div>
                  <button
                    onClick={() => {
                      const id = modalActividad.id;
                      setResenasOriginActivityId(id);
                      setModalDetalleId(null);
                      setModalOpinionesTitle(modalActividad.title || null);
                      setModalOpinionesId(id);
                    }}
                    className="pill-btn px-4 py-2 bg-amber-200 hover:bg-amber-300 text-club-brown font-bold text-base border border-amber-400 flex items-center gap-1.5 shadow-xs cursor-pointer shrink-0"
                  >
                    <i className="fa-solid fa-star text-club-orange" /> Ver Reseñas
                  </button>
                </div>
              )}

              <div>
                <h4 className="font-brand text-lg font-bold text-club-brown mb-1.5">Descripción de la actividad</h4>
                <p className="text-base text-club-brown/90 leading-relaxed whitespace-pre-line bg-white p-3.5 rounded-2xl border border-amber-200 break-words">
                  {modalActividad.shortDescription || modalActividad.description}
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <h4 className="font-brand text-lg font-bold text-club-brown">Sobre este encuentro</h4>
                  <span
                    className={`text-sm font-bold px-3 py-0.5 rounded-full border shadow-xs ${
                      modalActividad.isRecurrent
                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                        : 'bg-purple-100 text-purple-900 border-purple-200'
                    }`}
                  >
                    <i className={`fa-solid ${modalActividad.isRecurrent ? 'fa-repeat text-club-orange' : 'fa-calendar-day text-purple-700'} mr-1`} />
                    {modalActividad.isRecurrent ? 'Encuentro recurrente' : 'Encuentro único'}
                  </span>
                </div>
                <p className="text-base text-club-brown/90 leading-relaxed whitespace-pre-line break-words">
                  {modalActividad.description}
                </p>
              </div>

              {(() => {
                const activityVideoUrl = resolveActivityVideoUrl(modalActividad);
                if (!activityVideoUrl) return null;
                return (
                  <div className="bg-white p-4 rounded-2xl border border-amber-200 space-y-2.5">
                    <h4 className="font-brand text-lg font-bold text-club-brown flex items-center gap-2">
                      <i className="fa-solid fa-video text-club-orange" /> Video explicativo de la actividad
                    </h4>
                    <div className="rounded-2xl overflow-hidden border border-amber-200 bg-black shadow-xs">
                      <video
                        src={activityVideoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full max-h-80 object-contain bg-black"
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Ubicación y Mapa */}
              <div className="bg-white p-4 rounded-2xl border border-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h4 className="font-brand text-lg font-bold text-club-brown flex items-center gap-2">
                      <i className="fa-solid fa-map-location-dot text-club-orange" /> Ubicación
                    </h4>
                    <p className={`text-base font-semibold break-words ${isUserBlocked(modalActividad.organizer) ? 'text-rose-700 italic' : 'text-club-brown/80'}`}>
                      {didOtherBlockMe(modalActividad.organizer)
                        ? 'El organizador te bloqueó'
                        : didIBlockUser(modalActividad.organizer) || isUserBlocked(modalActividad.organizer)
                        ? 'Desbloqueá al organizador para ver ubicación'
                        : modalActividad.location}
                    </p>
                  </div>
                  {!isUserBlocked(modalActividad.organizer) && (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(modalActividad.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pill-btn px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-base font-bold flex items-center gap-1.5 border border-blue-200 shadow-2xs shrink-0"
                      title="Abrir indicaciones en Google Maps"
                    >
                      <i className="fa-solid fa-diamond-turn-right text-blue-600" /> Cómo llegar
                    </a>
                  )}
                </div>
                {!isUserBlocked(modalActividad.organizer) && (
                  <div className="mt-2 rounded-2xl overflow-hidden border border-amber-200 shadow-inner">
                    <LeafletMap
                      lat={modalActividad.lat}
                      lng={modalActividad.lng}
                      title={modalActividad.title}
                      locationName={modalActividad.location}
                      height={260}
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 bg-white border-t border-amber-200 flex flex-wrap items-center justify-end gap-2">
              {isCancelled ? (
                <div className="w-full flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <span className="text-base font-bold text-rose-800 bg-rose-50 border border-rose-200 px-3.5 py-2 rounded-xl flex items-center gap-2 leading-relaxed">
                    <i className="fa-solid fa-ban text-rose-600 shrink-0" /> <span>Esta actividad fue cancelada. Las inscripciones y el chat del encuentro están dados de baja.</span>
                  </span>
                  <button
                    onClick={closeModalDetalle}
                    className="pill-btn px-5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-base border border-stone-300 cursor-pointer self-end sm:self-auto shrink-0"
                  >
                    Cerrar
                  </button>
                </div>
              ) : modalCustomActivity ? (
                <div className="w-full flex flex-wrap items-center justify-between gap-2">
                  <span className="text-base font-bold text-purple-900 bg-purple-50 px-3.5 py-1.5 rounded-xl border border-purple-200 flex items-center gap-1.5">
                    <i className="fa-solid fa-eye text-purple-600" /> Vista previa de versión
                  </span>
                  <button
                    onClick={closeModalDetalle}
                    className="pill-btn px-5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-base border border-stone-300 cursor-pointer"
                  >
                    Cerrar detalle
                  </button>
                </div>
              ) : !currentUser ? (
                <button
                  onClick={() => {
                    setModalDetalleId(null);
                    setModalLoginOpen(true);
                  }}
                  className="pill-btn px-6 py-2.5 bg-club-orange text-white text-base font-bold shadow-md cursor-pointer"
                >
                  Iniciá sesión para anotarte
                </button>
              ) : isUserBlocked(modalActividad.organizer) ? (
                <span className="text-base font-bold text-rose-700 bg-rose-50 px-4 py-2 rounded-xl border border-rose-200">
                  <i className="fa-solid fa-user-slash mr-1" />
                  {didOtherBlockMe(modalActividad.organizer)
                    ? 'El organizador te bloqueó'
                    : 'Desbloqueá al organizador para ver ubicación'}
                </span>
              ) : currentUser && (
                String(currentUser.id) === String(modalActividad.organizerId) ||
                currentUser.usuario === modalActividad.organizer ||
                currentUser.apodo === modalActividad.organizer ||
               (currentUser as any).nombre === modalActividad.organizer
              ) ? (
                <>
                  <button
                    onClick={() => {
                      setModalDetalleId(null);
                      setModalModeracionActividadId(modalActividad.id);
                    }}
                    className="pill-btn px-5 py-2.5 bg-amber-100 hover:bg-amber-200 text-club-brown text-base font-bold border border-amber-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <i className="fa-solid fa-sliders text-club-orange" /> Moderar mi actividad
                  </button>
                  <button
                    onClick={() => {
                      setModalDetalleId(null);
                      setCurrentView('chat');
                      const actClean = cleanGroupTitle(modalActividad.title);
                      const c = chats.find(x =>
                        (x.activityId && (String(x.activityId) === String(modalActividad.id) || Number(x.activityId) === Number(modalActividad.id))) ||
                        (x.id && (String(x.id) === String(modalActividad.id) || Number(x.id) === Number(modalActividad.id))) ||
                        (actClean && cleanGroupTitle(x.title || x.name) === actClean)
                      );
                      if (c) setActiveChatId(c.id);
                      else setActiveChatId(modalActividad.id);
                    }}
                    className="pill-btn px-5 py-2.5 bg-club-teal text-white text-base font-bold cursor-pointer"
                  >
                    Ir al Chat del Encuentro
                  </button>
                </>
              ) : currentUser.tipo === 'personal' ? (
                (() => {
                  const myTokens = [currentUser.id, currentUser.usuario, currentUser.apodo, currentUser.nombre].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());
                  const enrolledList = Array.isArray(modalActividad.enrolledUsernames)
                    ? modalActividad.enrolledUsernames
                    : (Array.isArray((modalActividad as any).enrolled_usernames) ? (modalActividad as any).enrolled_usernames : (Array.isArray(modalActividad.inscriptos) ? modalActividad.inscriptos : []));
                  const isEnrolledNow = enrolledList.some((usr: any) => {
                    const val = typeof usr === 'object' ? (usr.usuario || usr.apodo || usr.nombre || usr.id) : String(usr || '');
                    return myTokens.includes(String(val).toLowerCase().trim());
                  });

                  if (isEnrolledNow) {
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => {
                            setModalDetalleId(null);
                            setCurrentView('chat');
                            const actClean = cleanGroupTitle(modalActividad.title);
                            const c = chats.find(x =>
                              (x.activityId && (String(x.activityId) === String(modalActividad.id) || Number(x.activityId) === Number(modalActividad.id))) ||
                              (x.id && (String(x.id) === String(modalActividad.id) || Number(x.id) === Number(modalActividad.id))) ||
                              (actClean && cleanGroupTitle(x.title || x.name) === actClean)
                            );
                            if (c) setActiveChatId(c.id);
                            else setActiveChatId(modalActividad.id);
                          }}
                          className="pill-btn px-4 py-2.5 bg-club-teal text-white text-base font-bold cursor-pointer flex items-center gap-1.5"
                        >
                          <i className="fa-solid fa-comments" /> Ir al Chat
                        </button>
                        <button
                          onClick={() => toggleEnrollment(modalActividad.id)}
                          className="pill-btn px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold shadow-md cursor-pointer"
                        >
                          Inscripta ✓ (Cancelar)
                        </button>
                      </div>
                    );
                  }

                  const myEnrolledActs = activities.filter((a: any) =>
                    String(a.id) !== String(modalActividad.id) && isUserEnrolledInActivity(a, currentUser)
                  );
                  const enrollCheck = canUserEnrollActivity(modalActividad, currentUser, undefined, myEnrolledActs);
                  if (!enrollCheck.allowed) {
                    return (
                      <button
                        disabled
                        className="pill-btn px-5 py-2.5 bg-stone-200 text-stone-600 border border-stone-300 text-base font-bold cursor-not-allowed shadow-none flex items-center gap-2"
                        title={enrollCheck.reason}
                      >
                        <i className="fa-solid fa-lock text-stone-500" />
                        <span>{enrollCheck.reason}</span>
                      </button>
                    );
                  }
                  return (
                    <button
                      onClick={() => toggleEnrollment(modalActividad.id)}
                      className="pill-btn px-6 py-2.5 bg-club-orange text-white text-base font-bold shadow-md cursor-pointer"
                    >
                      Preinscribirme a la actividad
                    </button>
                  );
                })()
              ) : (
                <span className="text-base font-bold text-stone-500">Inscripción inhabilitada para este perfil</span>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* MODAL: RESEÑAS DE LA COMUNIDAD (Si se abrió desde detalle, al cerrar vuelve a detalle) */}
      {modalOpinionesId !== null && (() => {
        const actividadOpiniones = activities.find(a => String(a.id) === String(modalOpinionesId));

        const isRecurrentOpiniones = Boolean(
          actividadOpiniones && (
            actividadOpiniones.isRecurrent ||
            actividadOpiniones.is_recurrent ||
            (actividadOpiniones as any).es_recurrente ||
            actividadOpiniones.frequency === 'recurrente' ||
            actividadOpiniones.frecuencia === 'recurrente' ||
            /\b(semanal|quincenal|mensual|cada\s*2\s*semanas|\d+\s*encuentros)\b/i.test(String(actividadOpiniones.schedule || ''))
          )
        );

        const tituloActividadModal = actividadOpiniones?.title || modalOpinionesTitle || (opinionesActividad[0]?.actividad) || (opinionesActividad[0] as any)?.actividad_titulo || 'Opiniones y Experiencias';
        const statsResenas = calculateReviewsAverage(opinionesActividad);

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
            <div className="bg-club-cream w-full max-w-3xl rounded-3xl border-2 border-amber-200 retro-shadow-strong overflow-hidden max-h-[92vh] flex flex-col min-w-0">
              <div className="p-4 bg-white border-b border-amber-200 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-bold bg-amber-200 text-club-brown px-3 py-0.5 rounded-full uppercase inline-block">
                    Reseñas de la comunidad
                  </span>
                  <div className="flex flex-wrap items-center gap-2.5 mt-1.5">
                    <h3 className="font-brand text-xl font-bold text-club-brown break-words">
                      {tituloActividadModal}
                    </h3>
                    {statsResenas.count > 0 ? (
                      <div className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-900 border border-amber-300 px-3 py-0.5 rounded-full text-sm font-bold shadow-xs">
                        <i className="fa-solid fa-star text-amber-500" />
                        <span className="text-base font-black">{statsResenas.formatted}</span>
                        <span className="text-amber-800/80 font-medium">({statsResenas.count} {statsResenas.count === 1 ? 'reseña' : 'reseñas'})</span>
                      </div>
                    ) : (
                      <span className="text-base text-stone-500 font-semibold italic">(Sin reseñas aún)</span>
                    )}
                  </div>
                  {actividadOpiniones && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-stone-600 mt-2 font-medium">
                      {isRecurrentOpiniones ? (
                        (() => {
                          const hasExplicitStart = Boolean(
                            actividadOpiniones.firstEncounterDate ||
                            actividadOpiniones.firstMeetingDate ||
                            (actividadOpiniones as any).fechaPrimerEncuentro ||
                            actividadOpiniones.startDate ||
                            (actividadOpiniones as any).fechaIni
                          );
                          const sessions = hasExplicitStart ? getActivitySessions(actividadOpiniones) : [];
                          const firstDateRaw =
                            actividadOpiniones.firstEncounterDate ||
                            actividadOpiniones.firstMeetingDate ||
                            (actividadOpiniones as any).fechaPrimerEncuentro ||
                            actividadOpiniones.startDate ||
                            (actividadOpiniones as any).fechaIni ||
                            (sessions.length > 0 ? sessions[0].date : '') ||
                            actividadOpiniones.fechaRealizacion ||
                            actividadOpiniones.schedule ||
                            'Fecha no registrada';
                          const sessionLastDate = sessions.length > 0 ? sessions[sessions.length - 1].date : '';
                          const explicitEndDate = actividadOpiniones.endDate || (actividadOpiniones as any).fechaFin || '';
                          const lastDateRaw =
                            (sessionLastDate && (!explicitEndDate || explicitEndDate <= firstDateRaw)
                              ? sessionLastDate
                              : explicitEndDate) ||
                            sessionLastDate ||
                            firstDateRaw;
                          const firstDateDisplay = formatFechaVisual(firstDateRaw) || firstDateRaw;
                          const lastDateDisplay = formatFechaVisual(lastDateRaw) || lastDateRaw;
                          return (
                            <>
                              <span>
                                <i className="fa-solid fa-calendar-day text-club-orange mr-1" />
                                <strong>Fecha del primer encuentro:</strong> {firstDateDisplay}
                              </span>
                              <span>
                                <i className="fa-solid fa-calendar-check text-club-orange mr-1" />
                                <strong>Fecha del último encuentro:</strong> {lastDateDisplay}
                              </span>
                            </>
                          );
                        })()
                      ) : (
                        <span>
                          <i className="fa-solid fa-calendar-day text-club-orange mr-1" />
                          <strong>Fecha en que se realizó:</strong> {actividadOpiniones.fechaRealizacion || actividadOpiniones.schedule || 'Fecha no registrada'}
                        </span>
                      )}
                      <span>
                        <i className="fa-solid fa-user-check text-club-teal mr-1" />
                        <strong>Organizador:</strong> {resolveActivityOrganizerDisplay(actividadOpiniones).name}
                      </span>
                      {isRecurrentOpiniones && (
                        <span className="bg-amber-100 text-amber-900 border border-amber-300 font-bold px-2.5 py-0.5 rounded-full text-sm inline-flex items-center gap-1">
                          <i className="fa-solid fa-repeat text-club-orange" /> Encuentros recurrentes • Reseñas unificadas
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

            <div className="p-5 overflow-y-auto space-y-4 text-base text-club-brown">
              {actividadOpiniones?.isRecurrent && !hasFirstEncounterEnded(actividadOpiniones) && (
                <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-300 text-amber-950 text-base font-semibold flex items-center gap-2.5 shadow-2xs leading-relaxed">
                  <i className="fa-solid fa-clock text-club-orange text-lg flex-shrink-0" />
                  <span>La posibilidad de dejar una reseña estará disponible a partir de la finalización del primer encuentro.</span>
                </div>
              )}
              {opinionesActividad.length === 0 ? (
                <p className="p-8 text-center text-base text-stone-500 font-semibold">Esta actividad aún no cuenta con reseñas</p>
              ) : (
                opinionesActividad.map((r) => {
                  const reviewRetired = isReviewRetired(r);
                  const mediaItems = reviewRetired ? [] : (r.media && r.media.length ? r.media : (r.foto ? [r.foto] : []));

                  return (
                    <div
                      key={r.id}
                      className={`p-4 rounded-2xl border space-y-2.5 ${
                        reviewRetired ? 'bg-stone-50/90 border-stone-300' : 'bg-white border-amber-200'
                      }`}
                    >
                      <div className="flex flex-wrap justify-between items-center gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-club-brown text-base">
                            {(() => {
                              const a = (r as any).autor || (r as any).apodo || (r as any).usuario || (r as any).nombre || 'Vecino';
                              return a.includes('@') ? a.split('@')[0] : a;
                            })()}
                          </span>
                          {!reviewRetired && currentUser && currentUser.apodo !== r.autor && (
                            <button
                              type="button"
                              onClick={() => openReportModal({
                                type: 'review_text',
                                reviewId: r.id,
                                activityId: r.actividadId,
                                reportedUser: r.autor,
                                messageText: r.texto
                              })}
                              className="text-sm text-stone-500 hover:text-rose-600 font-bold flex items-center gap-1 cursor-pointer transition ml-1"
                              title="Reportar esta reseña"
                            >
                              <i className="fa-solid fa-flag" /> Reportar
                            </button>
                          )}
                        </div>
                        <span className="text-sm text-stone-500 font-medium">
                          {Array.from({ length: r.estrellas }).map((_, i) => (
                            <i key={i} className="fa-solid fa-star text-amber-400" />
                          ))}{' '}
                          • {formatToArgentinaDate(r.fecha)}
                        </span>
                      </div>
                      {reviewRetired ? (
                        <p className="text-stone-600 text-base leading-relaxed italic break-words flex items-center gap-1.5 py-0.5">
                          <span>🚫</span>
                          <span>{ADMIN_REMOVED_REVIEW_TEXT}</span>
                        </p>
                      ) : (
                        <p className="text-stone-700 text-base leading-relaxed italic break-words">"{r.texto}"</p>
                      )}

                      {mediaItems.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {mediaItems.map((url: string, mIdx: number) => {
                            if (isRetiredReviewMediaItem(url)) {
                              return (
                                <div
                                  key={mIdx}
                                  className="rounded-xl overflow-hidden min-h-28 w-44 sm:w-52 border border-stone-300 bg-stone-100 p-2.5 flex flex-col items-center justify-center text-center gap-1 shadow-2xs"
                                >
                                  <span className="text-stone-500 text-base">🚫</span>
                                  <p className="text-sm italic text-stone-600 leading-snug break-words">
                                    {ADMIN_REMOVED_REVIEW_MEDIA_TEXT}
                                  </p>
                                </div>
                              );
                            }
                            const isVid = isVideoMedia(url);
                            return (
                              <div
                                key={mIdx}
                                className="rounded-xl overflow-hidden h-28 w-36 border border-amber-200 relative shadow-xs bg-black flex items-center justify-center cursor-pointer group"
                                onClick={() => openGalleryVisor(url, r.actividadId)}
                              >
                                {isVid ? (
                                  <div className="w-full h-full relative flex items-center justify-center">
                                    <video
                                      src={url}
                                      playsInline
                                      preload="metadata"
                                      className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition pointer-events-none"
                                    />
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/10 transition">
                                      <div className="w-10 h-10 rounded-full bg-club-orange/90 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition">
                                        <i className="fa-solid fa-play text-sm ml-0.5" />
                                      </div>
                                    </div>
                                    <span className="absolute bottom-1 left-1.5 bg-black/75 text-white text-sm px-1.5 py-0.5 rounded font-bold">
                                      <i className="fa-solid fa-video mr-1" /> Video
                                    </span>
                                  </div>
                                ) : (
                                  <img
                                    src={url}
                                    alt={`Foto ${mIdx + 1}`}
                                    className="w-full h-full object-cover group-hover:scale-105 transition"
                                  />
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openGalleryVisor(url, r.actividadId);
                                  }}
                                  className="absolute top-1 right-1 bg-black/60 hover:bg-club-orange text-white text-sm px-1.5 py-0.5 rounded-md font-bold cursor-pointer"
                                  title="Ver en pantalla completa"
                                >
                                  <i className="fa-solid fa-expand" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-3.5 bg-white border-t border-amber-200 flex flex-wrap justify-between items-center gap-2">
              {currentUser && actividadOpiniones && isUserEnrolledInActivity(actividadOpiniones, currentUser) && (
                (() => {
                  const userTokens = [
                    currentUser.id,
                    currentUser.usuario,
                    currentUser.apodo,
                    currentUser.nombre,
                    currentUser.email
                  ].filter(Boolean).map(t => String(t).replace(/[!¡]/g, '').trim().toLowerCase());
                  const targetTitle = (actividadOpiniones.title || (actividadOpiniones as any).titulo || '').trim().toLowerCase();
                  const existingReview = reviews.find(r => {
                    const matchId = String(r.actividadId) === String(actividadOpiniones.id);
                    const matchTitle = targetTitle && r.actividad && r.actividad.trim().toLowerCase() === targetTitle;
                    if (!matchId && !matchTitle) return false;
                    const rAutorTokens = [r.autor, (r as any).autor_nombre, (r as any).autor_id, (r as any).usuarioId]
                      .filter(Boolean)
                      .map(t => String(t).replace(/[!¡]/g, '').trim().toLowerCase());
                    return userTokens.some(ut => rAutorTokens.includes(ut));
                  });

                  if (existingReview) {
                    if (isReviewRetired(existingReview)) {
                      return (
                        <span className="text-sm text-stone-600 italic flex items-center gap-1.5 py-1">
                          <span>🚫</span>
                          <span>{ADMIN_REMOVED_REVIEW_TEXT}</span>
                        </span>
                      );
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setResenaEditData({
                            id: existingReview.id,
                            actividadId: existingReview.actividadId,
                            actividad: existingReview.actividad,
                            estrellas: existingReview.estrellas,
                            texto: existingReview.texto
                          });
                          setCalifEstrellas(existingReview.estrellas);
                          setTextoResena(existingReview.texto);
                          setArchivosResena(existingReview.media && existingReview.media.length ? [...existingReview.media] : (existingReview.foto ? [existingReview.foto] : []));
                          setModalOpinionesId(null);
                          setModalOpinionesTitle(null);
                          setModalEscribirResenaOpen(true);
                        }}
                        className="pill-btn px-4 py-2 bg-amber-100 hover:bg-amber-200 text-club-brown text-base font-bold border border-amber-300 flex items-center gap-1.5 cursor-pointer"
                      >
                        <i className="fa-solid fa-pen-to-square text-club-orange" /> Modificar mi reseña
                      </button>
                    );
                  }

                  if (!isActivityEligibleForReview(actividadOpiniones)) {
                    return (
                      <span className="text-base text-stone-600 italic flex items-center gap-1.5 py-1">
                        <i className="fa-regular fa-clock text-amber-500" /> Podrás dejar tu reseña una vez que se realice la actividad.
                      </span>
                    );
                  }

                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setResenaEditData({
                          actividadId: actividadOpiniones.id,
                          actividad: actividadOpiniones.title,
                          estrellas: 5,
                          texto: ''
                        });
                        setCalifEstrellas(5);
                        setTextoResena('');
                        setArchivosResena([]);
                        setModalOpinionesId(null);
                        setModalOpinionesTitle(null);
                        setModalEscribirResenaOpen(true);
                      }}
                      className="pill-btn px-4 py-2 bg-club-orange text-white text-base font-bold hover:bg-club-orange-dark shadow-sm flex items-center gap-1.5 cursor-pointer"
                    >
                      <i className="fa-solid fa-pen-to-square" /> Dejar mi reseña
                    </button>
                  );
                })()
              )}
              <button
                onClick={() => {
                  if (resenasOriginActivityId) {
                    setModalDetalleId(resenasOriginActivityId);
                    setResenasOriginActivityId(null);
                  }
                  setModalOpinionesId(null);
                  setModalOpinionesTitle(null);
                }}
                className="pill-btn px-5 py-2 bg-club-brown text-white text-base font-bold shadow-sm cursor-pointer ml-auto"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      );
    })()}

      {/* MODAL: GALERÍA VISOR DE FOTOS CON FLECHAS, TRES PUNTITOS PARA REPORTAR, RESEÑA ESCRITA Y AUTOR */}
      {modalGaleriaOpen && galeriaItems.length > 0 && (
        <div
          className="fixed inset-0 bg-black/90 z-[75] flex items-center justify-center p-3 sm:p-6"
          onClick={() => setModalGaleriaOpen(false)}
        >
          <div
            className="relative max-w-2xl w-full bg-[#18110D] border-2 border-amber-500/40 rounded-3xl overflow-hidden shadow-2xl flex flex-col text-white max-h-[92dvh] min-w-0"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Bar with counter, three dots and close */}
            <div className="p-4 bg-black/40 border-b border-amber-500/20 flex flex-wrap justify-between items-center gap-2 text-base">
              <span className="font-bold text-amber-200">
                <i className="fa-solid fa-camera mr-1.5 text-club-orange" />
                Foto {galeriaIndex + 1} de {galeriaItems.length}
              </span>
              <div className="flex items-center gap-2">
                {currentUser &&
                  !isRetiredReviewMediaItem(galeriaItems[galeriaIndex]?.mediaUrl) &&
                  galeriaItems[galeriaIndex]?.autor !== currentUser.apodo &&
                  galeriaItems[galeriaIndex]?.autor !== currentUser.usuario && (
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setVisorMenuOpen(!visorMenuOpen);
                      }}
                      className="p-2 text-stone-300 hover:text-white rounded-md cursor-pointer text-base"
                      title="Opciones"
                      aria-label="Opciones de foto"
                    >
                      <i className="fa-solid fa-ellipsis-vertical" />
                    </button>

                    {visorMenuOpen && (
                      <div className="absolute right-0 top-9 bg-white text-club-brown rounded-xl shadow-xl z-50 py-1 min-w-[140px] text-base">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setVisorMenuOpen(false);
                            setModalConfirmReportVisor(true);
                          }}
                          className="w-full px-3.5 py-2 text-left hover:bg-rose-50 text-rose-700 font-bold flex items-center gap-2 cursor-pointer"
                        >
                          <i className="fa-solid fa-flag text-rose-600 text-sm" /> Reportar
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <button
                  onClick={() => setModalGaleriaOpen(false)}
                  className="pill-btn px-3.5 py-1.5 bg-stone-800 hover:bg-stone-700 text-white text-base font-bold cursor-pointer"
                >
                  Cerrar &times;
                </button>
              </div>
            </div>

            {/* Media Area with Left & Right arrows */}
            <div className="relative h-80 sm:h-96 bg-black flex items-center justify-center overflow-hidden">
              {isRetiredReviewMediaItem(galeriaItems[galeriaIndex]?.mediaUrl) ? (
                <div className="p-6 max-w-md text-center space-y-2">
                  <span className="text-3xl block">🚫</span>
                  <p className="text-base italic text-stone-200 leading-relaxed">
                    {ADMIN_REMOVED_REVIEW_MEDIA_TEXT}
                  </p>
                </div>
              ) : isVideoMedia(galeriaItems[galeriaIndex]?.mediaUrl) ? (
                <video
                  key={galeriaItems[galeriaIndex]?.mediaUrl}
                  src={galeriaItems[galeriaIndex]?.mediaUrl}
                  controls
                  autoPlay
                  playsInline
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <img
                  src={galeriaItems[galeriaIndex]?.mediaUrl}
                  alt="Foto reseña"
                  className="max-h-full max-w-full object-contain"
                />
              )}

              {galeriaItems.length > 1 && (
                <button
                  onClick={handleGaleriaPrev}
                  className="absolute left-3 w-10 h-10 rounded-full bg-black/70 hover:bg-club-orange text-white flex items-center justify-center text-base transition border border-white/20 cursor-pointer shadow-lg"
                  title="Foto anterior"
                  aria-label="Foto anterior"
                >
                  <i className="fa-solid fa-chevron-left" />
                </button>
              )}

              {galeriaItems.length > 1 && (
                <button
                  onClick={handleGaleriaNext}
                  className="absolute right-3 w-10 h-10 rounded-full bg-black/70 hover:bg-club-orange text-white flex items-center justify-center text-base transition border border-white/20 cursor-pointer shadow-lg"
                  title="Foto siguiente"
                  aria-label="Foto siguiente"
                >
                  <i className="fa-solid fa-chevron-right" />
                </button>
              )}
            </div>

            {/* Bottom info section */}
            <div className="p-4 sm:p-5 bg-[#241712] border-t border-amber-500/20 space-y-2.5 overflow-y-auto">
              <div className="flex flex-wrap justify-between items-center gap-2 text-base">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-club-orange text-white font-bold flex items-center justify-center text-sm shrink-0">
                    {(() => {
                      const a = galeriaItems[galeriaIndex]?.autor || 'V';
                      return (a.includes('@') ? a.split('@')[0] : a).charAt(0).toUpperCase();
                    })()}
                  </div>
                  <div className="min-w-0">
                    <span className="font-bold text-amber-200 block break-words">
                      {(() => {
                        const a = galeriaItems[galeriaIndex]?.autor || 'Vecino';
                        return a.includes('@') ? a.split('@')[0] : a;
                      })()}
                    </span>
                    <span className="text-sm text-stone-300 break-words block">{galeriaItems[galeriaIndex]?.actividad}</span>
                  </div>
                </div>
                <div className="text-amber-400 text-base flex items-center gap-1 flex-wrap">
                  {Array.from({ length: galeriaItems[galeriaIndex]?.estrellas || 5 }).map((_, i) => (
                    <i key={i} className="fa-solid fa-star" />
                  ))}
                  <span className="text-sm text-stone-300 ml-1">• {galeriaItems[galeriaIndex]?.fecha}</span>
                </div>
              </div>

              <div className="p-3 bg-black/30 rounded-2xl border border-amber-900/40 text-base text-amber-100/90 leading-relaxed italic break-words">
                "{galeriaItems[galeriaIndex]?.texto}"
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ESCRIBIR O EDITAR RESEÑA (Con soporte para adjuntar/eliminar múltiples fotos sin reemplazarlas) */}
      {modalEscribirResenaOpen && resenaEditData && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-amber-200 retro-shadow-strong overflow-hidden flex flex-col max-h-[92vh] min-w-0">
            <div className="p-4 bg-white border-b border-amber-200 flex items-center justify-between gap-2">
              <h3 className="font-brand text-xl font-bold text-club-brown min-w-0 break-words">
                {resenaEditData.id ? 'Editar mi reseña' : 'Dejar mi reseña'}
              </h3>
              <button
                onClick={() => setModalEscribirResenaOpen(false)}
                className="pill-btn px-3.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer shrink-0"
              >
                Cerrar
              </button>
            </div>

            <form onSubmit={handleGuardarResena} className="p-5 space-y-4 text-base text-club-brown overflow-y-auto">
              <div className="min-w-0">
                <span className="text-sm font-bold text-stone-500 uppercase">Actividad:</span>
                <h4 className="font-bold text-lg text-club-brown break-words">{resenaEditData.actividad}</h4>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-club-brown block">¿Cómo calificarías este encuentro?</label>
                <div className="flex gap-2.5 text-2xl text-amber-400 cursor-pointer">
                  {[1, 2, 3, 4, 5].map((num) => (
                    <i
                      key={num}
                      className={num <= califEstrellas ? 'fa-solid fa-star text-amber-400' : 'fa-regular fa-star text-stone-300'}
                      onClick={() => setCalifEstrellas(num)}
                    />
                  ))}
                </div>
                <span className="text-sm text-stone-600 font-bold block">
                  {['Muy mala (1/5)', 'Regular (2/5)', 'Buena (3/5)', 'Muy buena (4/5)', 'Excelente (5/5)'][califEstrellas - 1]}
                </span>
              </div>

              <div className="space-y-1.5">
                <label className="font-bold text-club-brown block">Escribí tu opinión para los demás vecinos:</label>
                <textarea
                  rows={3}
                  required
                  value={textoResena}
                  onChange={(e) => setTextoResena(e.target.value)}
                  placeholder="Contanos qué te parecieron los profesores, la música o el grupo..."
                  className="w-full p-3 bg-white border border-amber-200 rounded-xl outline-none text-base leading-relaxed focus:ring-2 focus:ring-club-orange"
                />
              </div>

              {/* Multi-media upload and management */}
              <div className="space-y-2.5 bg-amber-50 p-3.5 rounded-2xl border border-amber-200">
                <div className="p-3 bg-amber-100/80 border border-amber-300 rounded-xl text-sm text-amber-950 font-semibold flex items-center gap-2 leading-relaxed">
                  <i className="fa-solid fa-clock text-club-orange text-base flex-shrink-0" />
                  <span className="min-w-0 break-words"><strong>Límite de duración:</strong> La duración máxima permitida para los videos es de <strong>45 segundos</strong>.</span>
                </div>

                <label className="font-bold text-club-brown flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <i className="fa-solid fa-camera text-club-orange" /> Fotos o videos de la actividad ({archivosResena.length})
                  </span>
                  <label className="pill-btn px-3.5 py-1.5 bg-club-orange text-white text-base font-bold cursor-pointer hover:bg-club-orange-dark shadow-xs inline-flex items-center gap-1.5">
                    <i className="fa-solid fa-plus" /> Agregar fotos/videos
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={handleMultiMediaReviewFiles}
                      className="hidden"
                    />
                  </label>
                </label>

                {archivosResena.length === 0 ? (
                  <p className="text-sm text-stone-600 italic py-2 text-center leading-relaxed">
                    No hay fotos o videos adjuntos aún. Podés subir más de uno.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 max-h-48 overflow-y-auto">
                    {archivosResena.map((url, idx) => {
                      if (isRetiredReviewMediaItem(url)) {
                        return (
                          <div
                            key={idx}
                            className="relative rounded-xl overflow-hidden border border-stone-300 min-h-24 p-2.5 bg-stone-100 flex flex-col items-center justify-center text-center gap-1"
                          >
                            <span className="text-stone-500 text-sm">🚫</span>
                            <p className="text-sm italic text-stone-600 leading-snug break-words">
                              {ADMIN_REMOVED_REVIEW_MEDIA_TEXT}
                            </p>
                          </div>
                        );
                      }
                      const isVid = isVideoMedia(url);
                      return (
                        <div key={idx} className="relative group rounded-xl overflow-hidden border border-amber-300 h-24 bg-black flex items-center justify-center">
                          {isVid ? (
                            <video src={url} controls className="w-full h-full object-contain" />
                          ) : (
                            <img
                              src={url}
                              alt={`Adjunto ${idx + 1}`}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.currentTarget as HTMLElement).style.display = 'none';
                              }}
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => handleRemoveReviewMedia(idx)}
                            className="absolute top-1 right-1 w-7 h-7 rounded-full bg-rose-600 text-white font-bold text-base flex items-center justify-center hover:bg-rose-700 shadow z-10 cursor-pointer"
                            title="Eliminar este contenido"
                            aria-label="Eliminar archivo adjunto"
                          >
                            &times;
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-amber-200">
                <button
                  type="button"
                  onClick={() => setModalEscribirResenaOpen(false)}
                  className="pill-btn px-4 py-2 bg-stone-100 text-stone-700 text-base font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="pill-btn px-5 py-2 bg-club-orange text-white text-base font-bold shadow-sm cursor-pointer"
                >
                  {resenaEditData.id ? 'Guardar cambios' : 'Publicar mi reseña'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MIS CONTACTOS (Con opción de desagendar / eliminar contacto) */}
      {modalDirectorioOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
          <div className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-amber-200 p-5 space-y-4 max-h-[90dvh] flex flex-col min-w-0">
            <div className="border-b border-amber-200 pb-2">
              <h3 className="font-brand text-xl font-bold text-club-brown flex items-center gap-2">
                <i className="fa-solid fa-address-book text-club-orange" /> Contactos de CLUB65
              </h3>
            </div>
            <p className="text-base text-stone-600 leading-relaxed">Explorá a los vecinos y miembros que tenés agendados:</p>

            <div className="space-y-2.5 overflow-y-auto flex-1 pr-0.5">
              {(() => {
                const localStored = (() => {
                  try {
                    const parsed = JSON.parse(localStorage.getItem('club65_custom_contacts') || '[]');
                    return Array.isArray(parsed) ? parsed.filter(c => !isHardcodedOrMockProfile(c) && !isSelfUserOrContact(c, currentUser)) : [];
                  } catch {
                    return [];
                  }
                })();
                const contactsMap = new Map<string, Contact>();
                filterContactsForUser([...contacts, ...localStored], currentUser).forEach((c: any) => {
                  if (c?.nombre) {
                    contactsMap.set(c.nombre.toLowerCase().trim(), c);
                  }
                });
                const displayedContacts = Array.from(contactsMap.values());
                if (displayedContacts.length === 0) {
                  return <p className="p-4 text-center text-base text-stone-500">No tenés contactos agendados aún.</p>;
                }
                return displayedContacts.map((u) => {
                  const rawPhoto = getUserPhotoByName(u.nombre) || getUserPhotoByName(u.id) || allUsersMap[u.nombre.toLowerCase().trim()]?.avatar || u.foto;
                  const contactPhoto = sanitizeProfileAvatar(rawPhoto);
                  return (
                    <div key={u.id} className="p-3 bg-white rounded-2xl border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-10 h-10 rounded-full ${u.avatarClass || 'bg-club-teal'} text-white font-bold flex items-center justify-center text-base overflow-hidden flex-shrink-0`}>
                          {contactPhoto ? <img src={contactPhoto} alt={u.nombre} className="w-full h-full object-cover aspect-square" /> : (u.avatar || u.nombre.slice(0, 2).toUpperCase())}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-base text-club-brown break-words">{u.nombre}</p>
                          <p className="text-sm text-stone-500 break-words">{u.detalle}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto flex-shrink-0">
                        <button
                          onClick={() => {
                            setModalDirectorioOpen(false);
                            openUserProfileByName(u.nombre);
                          }}
                          className="flex-1 sm:flex-none px-3.5 py-1.5 flex items-center justify-center pill-btn bg-amber-100 hover:bg-amber-200 text-club-brown font-bold text-base border border-amber-300 shadow-2xs cursor-pointer"
                        >
                          Ver perfil
                        </button>
                        <button
                          onClick={() => handleDesagendarContacto(u.id, u.nombre)}
                          className="flex-1 sm:flex-none px-3.5 py-1.5 flex items-center justify-center pill-btn bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-base border border-rose-200 gap-1.5 cursor-pointer"
                          title="Desagendar contacto"
                        >
                          <i className="fa-solid fa-user-minus text-sm" /> Desagendar
                        </button>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="pt-2 flex justify-end border-t border-amber-200">
              <button
                onClick={() => setModalDirectorioOpen(false)}
                className="pill-btn px-5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-base cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: FICHA DE PERFIL DE CONTACTO */}
      {modalPerfilContacto && (
        <div className="fixed inset-0 bg-black/60 z-[105] flex items-center justify-center p-3">
          <div className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-amber-200 p-5 space-y-4 max-h-[90vh] overflow-y-auto min-w-0">
            <div className="flex flex-wrap justify-between items-start gap-2.5 border-b border-amber-200 pb-3">
              <div className="flex items-center gap-3 min-w-0">
                {(() => {
                  const rawPhoto = getUserPhotoByName(modalPerfilContacto.nombre) || 
                    getUserPhotoByName(modalPerfilContacto.id) ||
                    (allUsersMap[modalPerfilContacto.nombre.toLowerCase().trim()]?.avatar) ||
                    (allUsersMap[String(modalPerfilContacto.id).toLowerCase().trim()]?.avatar) ||
                    modalPerfilContacto.foto;
                  const profPhoto = sanitizeProfileAvatar(rawPhoto);

                  return (
                    <div
                      className="cursor-pointer shrink-0"
                      onClick={() => {
                        if (profPhoto) {
                          setModalVisorImgShape('circle');
                          setModalVisorImgSrc(profPhoto);
                        }
                      }}
                      title={profPhoto ? 'Ver foto de perfil' : modalPerfilContacto.nombre}
                    >
                      {profPhoto ? (
                        <img
                          src={profPhoto}
                          alt={modalPerfilContacto.nombre}
                          className="w-14 h-14 rounded-full object-cover border-2 border-club-orange shadow-sm aspect-square"
                        />
                      ) : (
                        <div className={`w-14 h-14 rounded-full ${modalPerfilContacto.avatarClass || 'bg-club-orange text-white'} text-club-brown flex items-center justify-center text-lg font-bold shadow-sm`}>
                          {modalPerfilContacto.avatar || modalPerfilContacto.nombre.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="min-w-0">
                  <h4 className="font-bold text-lg text-club-brown flex items-center gap-1.5 flex-wrap break-words">
                    <span>{modalPerfilContacto.nombre}</span>
                    {modalPerfilContacto.tipo === 'moderador' || modalPerfilContacto.rol === 'moderador' || modalPerfilContacto.detalle?.includes('Moderación') ? (
                      <i className="fa-solid fa-circle-check text-purple-700 text-sm" title="Administrador Oficial Verificado" />
                    ) : modalPerfilContacto.tipo === 'institucional' || modalPerfilContacto.avatarClass?.includes('bg-club-blue') ? (
                      <i className="fa-solid fa-circle-check text-blue-600 text-sm" title="Institución Verificada" />
                    ) : null}
                  </h4>
                  {modalPerfilContacto.tipo === 'moderador' || modalPerfilContacto.rol === 'moderador' || modalPerfilContacto.detalle?.includes('Moderación') ? (
                    <span className="text-sm text-purple-800 bg-purple-100 border border-purple-300 font-bold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs mt-0.5">
                      <i className="fa-solid fa-shield-halved" /> Equipo de Moderación
                    </span>
                  ) : modalPerfilContacto.tipo === 'institucional' || modalPerfilContacto.avatarClass?.includes('bg-club-blue') ? (
                    <span className="text-sm text-blue-800 bg-blue-100 border border-blue-300 font-bold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 shadow-xs mt-0.5">
                      <i className="fa-solid fa-landmark" /> Institución Verificada
                    </span>
                  ) : (
                    <span className="text-sm text-stone-600 bg-stone-100 border border-stone-200 font-bold px-2.5 py-0.5 rounded-full inline-block mt-0.5">
                      Perfil Personal
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {currentUser && canViewerBlockOrPrivateChat(currentUser) && !isSelfUserOrContact(modalPerfilContacto, currentUser) && currentUser.apodo !== modalPerfilContacto.nombre && currentUser.usuario !== modalPerfilContacto.nombre && (() => {
                  const isBlockedByMe = didIBlockContact(modalPerfilContacto) || didIBlockUser(modalPerfilContacto.nombre, modalPerfilContacto.id);
                  const isOtherBlockingMe = didOtherBlockMe(modalPerfilContacto.nombre, modalPerfilContacto.id);

                  if (isOtherBlockingMe) {
                    return (
                      <span className="text-sm font-bold text-rose-800 bg-rose-100 border border-rose-300 px-2.5 py-1 rounded-full">
                        <i className="fa-solid fa-lock mr-1" /> Bloqueado por el usuario
                      </span>
                    );
                  }

                  if (isBlockedByMe) {
                    return (
                      <button
                        type="button"
                        onClick={() => handleUnblockUser(modalPerfilContacto.nombre, modalPerfilContacto.id)}
                        className="pill-btn px-3.5 py-1.5 text-base font-bold border transition cursor-pointer bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-300 flex items-center gap-1.5 shadow-xs"
                        title="Hacé clic para desbloquear al usuario"
                      >
                        <i className="fa-solid fa-lock-open text-emerald-600" /> Desbloquear
                      </button>
                    );
                  }

                  return (
                    <button
                      type="button"
                      onClick={() => handleBlockUser(modalPerfilContacto.nombre, modalPerfilContacto.id)}
                      className="pill-btn px-3.5 py-1.5 text-base font-bold border transition cursor-pointer bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-300 shadow-xs"
                    >
                      Bloquear
                    </button>
                  );
                })()}
              </div>
            </div>

            {didOtherBlockMe(modalPerfilContacto.nombre, modalPerfilContacto.id) ? (
              <div className="p-6 bg-rose-50 border-2 border-rose-300 rounded-2xl text-center space-y-2">
                <i className="fa-solid fa-user-slash text-2xl text-rose-600 block" />
                <p className="font-bold text-base text-rose-900">
                  {modalPerfilContacto.nombre} te bloqueó
                </p>
                <p className="text-base text-rose-700 leading-relaxed">
                  No es posible ver la información, reseñas ni interactuar con este miembro de la comunidad.
                </p>
              </div>
            ) : (didIBlockContact(modalPerfilContacto) || didIBlockUser(modalPerfilContacto.nombre, modalPerfilContacto.id)) ? (
              <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-3">
                <i className="fa-solid fa-user-slash text-2xl text-rose-600 block" />
                <p className="font-bold text-base text-rose-800">
                  Bloqueaste a {modalPerfilContacto.nombre}
                </p>
                <p className="text-base text-rose-700 leading-relaxed">
                  Desbloqueá a este usuario para volver a ver su información y contactarte.
                </p>
                <button
                  type="button"
                  onClick={() => handleUnblockUser(modalPerfilContacto.nombre, modalPerfilContacto.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-base font-bold transition shadow-xs cursor-pointer"
                >
                  <i className="fa-solid fa-lock-open" />
                  Desbloquear
                </button>
              </div>
            ) : (
              <>
                {(() => {
                  const sanitizedBio = sanitizeProfileBio(modalPerfilContacto.bio);
                  return (
                    <p className="text-base text-stone-700 leading-relaxed bg-white p-3.5 rounded-2xl border border-amber-100 break-words">
                      {sanitizedBio ? sanitizedBio : <span className="text-stone-400 italic">Sin biografía registrada.</span>}
                    </p>
                  );
                })()}

                {modalPerfilContacto.tipo === 'moderador' || modalPerfilContacto.rol === 'moderador' || modalPerfilContacto.detalle?.includes('Moderación') ? (
                  <div className="p-3.5 bg-purple-50/80 rounded-2xl border border-purple-200 text-base text-purple-950 space-y-1.5 shadow-2xs">
                    <div className="flex items-center gap-1.5 font-bold text-purple-800">
                      <i className="fa-solid fa-shield-halved text-purple-700" />
                      <span>Rol de Gestión y Seguridad</span>
                    </div>
                    <p className="text-sm text-purple-900 leading-relaxed">
                      Este usuario forma parte del equipo de moderación oficial de CLUB65. Su rol es velar por la seguridad comunitaria, validar las actividades propuestas y auditar reportes vecinales.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 pt-1">
                    {(() => {
                      const userReviews = getReviewsOfUserActivities(reviews, modalPerfilContacto, activities).filter(
                        r => !isReviewRetired(r)
                      );
                      const organizerStats = calculateReviewsAverage(userReviews);

                      return (
                        <>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <h5 className="font-bold text-base text-club-brown flex items-center gap-1.5">
                                <i className="fa-solid fa-star text-amber-500" /> Reseñas de sus actividades:
                              </h5>
                              {organizerStats.count > 0 && (
                                <div
                                  data-testid="organizer-average-rating"
                                  title={`Puntuación promedio: ${organizerStats.formatted} de 5 (${organizerStats.count} ${organizerStats.count === 1 ? 'reseña' : 'reseñas'})`}
                                  className="inline-flex items-center gap-1 bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full text-sm font-bold shadow-2xs shrink-0"
                                >
                                  <i className="fa-solid fa-star text-amber-500 text-xs" />
                                  <span className="font-black">{organizerStats.formatted}</span>
                                  <span className="text-xs text-amber-800/80 font-medium">({organizerStats.count})</span>
                                </div>
                              )}
                            </div>
                            {userReviews.length > 1 && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => setIndiceResenaPerfil(prev => (prev === 0 ? userReviews.length - 1 : prev - 1))}
                                  className="w-8 h-8 rounded-full bg-amber-100 hover:bg-amber-200 text-club-brown flex items-center justify-center text-sm font-bold cursor-pointer"
                                  aria-label="Reseña anterior"
                                >
                                  <i className="fa-solid fa-chevron-left" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setIndiceResenaPerfil(prev => (prev >= userReviews.length - 1 ? 0 : prev + 1))}
                                  className="w-8 h-8 rounded-full bg-amber-100 hover:bg-amber-200 text-club-brown flex items-center justify-center text-sm font-bold cursor-pointer"
                                  aria-label="Siguiente reseña"
                                >
                                  <i className="fa-solid fa-chevron-right" />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="p-3.5 bg-white rounded-xl border border-amber-200 text-base min-h-[70px]">
                            {userReviews.length === 0 ? (
                              <p className="text-stone-500 italic text-center py-2 text-base">Aún no hay reseñas de otros usuarios sobre las actividades realizadas por este perfil.</p>
                            ) : (
                              (() => {
                                const currentRev = userReviews[indiceResenaPerfil % userReviews.length];
                                const reviewRetired = isReviewRetired(currentRev);
                                const revAuthor = currentRev.autor || currentRev.autor_nombre || 'Vecino';
                                const revDate = currentRev.fecha || (currentRev.creado_el ? new Date(currentRev.creado_el).toLocaleDateString('es-AR') : 'Reciente');
                                const revStars = Number(currentRev.estrellas) || Number(currentRev.calificacion) || 5;
                                const revActTitle = currentRev.actividad || currentRev.actividad_titulo || currentRev.actividadTitulo || 'Actividad vecinal';
                                const revComment = currentRev.texto || currentRev.comentario || '';
                                return (
                                  <div>
                                    <div className="flex flex-wrap justify-between gap-2 font-bold text-club-brown">
                                      <span className="break-words">
                                        {revAuthor}{' '}
                                        <span className="text-sm text-stone-500 font-normal">
                                          • {revDate}
                                        </span>
                                      </span>
                                      <span className="text-amber-500 shrink-0">
                                        {'★'.repeat(revStars)}
                                      </span>
                                    </div>
                                    <p className="text-sm font-bold text-club-orange mt-1 break-words">
                                      {revActTitle}
                                    </p>
                                    {reviewRetired ? (
                                      <p className="text-stone-600 mt-1 italic leading-relaxed break-words flex items-center gap-1.5">
                                        <span>🚫</span>
                                        <span>{ADMIN_REMOVED_REVIEW_TEXT}</span>
                                      </p>
                                    ) : (
                                      <p className="text-stone-600 mt-1 italic leading-relaxed break-words">
                                        "{revComment}"
                                      </p>
                                    )}
                                  </div>
                                );
                              })()
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}
              </>
            )}

            <div className="pt-2 flex flex-wrap justify-end gap-2 border-t border-amber-200">
              <button
                onClick={() => setModalPerfilContacto(null)}
                className="pill-btn px-4 py-2 bg-stone-100 text-stone-700 font-bold text-base cursor-pointer"
              >
                Cerrar
              </button>
       {modalPerfilContacto && !isUserBlocked(modalPerfilContacto.nombre, modalPerfilContacto.id) && 
                     currentUser && 
                     canViewerBlockOrPrivateChat(currentUser) && 
                     !isSelfUserOrContact(modalPerfilContacto, currentUser) &&
                     String(modalPerfilContacto.nombre || '').toLowerCase() !== String(currentUser.apodo || '').toLowerCase() &&
                     String(modalPerfilContacto.nombre || '').toLowerCase() !== String(currentUser.usuario || '').toLowerCase() &&
                     String(modalPerfilContacto.nombre || '').toLowerCase() !== String((currentUser as any)?.nombre || '').toLowerCase() &&
                     String(modalPerfilContacto.nombre || '').toLowerCase() !== String(currentUser.id || '').toLowerCase() && (
                      <button
                        onClick={async () => {
                  const contactName = 
                    modalPerfilContacto.nombre || 
                    (modalPerfilContacto as any).apodo || 
                    'Contacto';

                  setModalPerfilContacto(null);
                  setCurrentView('chat');

                  const contactId = String((modalPerfilContacto as any)?.id || (modalPerfilContacto as any)?.userId || '').trim();
                  const myId = String(currentUser?.id || '').trim();
                  const myName = (currentUser?.nombre || currentUser?.apodo || currentUser?.usuario || '').trim();

                  const existing = chats.find(c => {
                    if (c.type !== 'privado') return false;
                    const resolved = getChatDisplayTitle(c, currentUser);
                    if (resolved.toLowerCase() === contactName.toLowerCase()) return true;
                    if (c.title?.toLowerCase() === contactName.toLowerCase()) return true;
                    if (c.name?.toLowerCase() === contactName.toLowerCase()) return true;
                    return c.participants?.some((p: any) => {
                      const pStr = String(p).toLowerCase();
                      return pStr === contactName.toLowerCase() || (contactId && pStr === contactId.toLowerCase());
                    });
                  });

                  if (existing) {
                    setChats((prevChats: any[]) =>
                      prevChats.map(c =>
                        String(c.id) === String(existing.id)
                          ? { ...c, messages: filterChatMessagesForUser(c.messages || [], c.id, currentUser, c) }
                          : c
                      )
                    );
                    setActiveChatId(existing.id);
                  } else {
                    const matchedUser = Object.values(allUsersMap).find((u: any) =>
                      (u.apodo && u.apodo.toLowerCase().trim() === contactName.toLowerCase().trim()) ||
                      (u.usuario && u.usuario.toLowerCase().trim() === contactName.toLowerCase().trim()) ||
                      (u.nombre && u.nombre.toLowerCase().trim() === contactName.toLowerCase().trim())
                    );
                    const otherUserId = matchedUser?.id || (modalPerfilContacto as any).userId || (contactId && !contactId.startsWith('contact_') ? contactId : undefined) || contactId || (modalPerfilContacto as any).id;
                    const directChat = await chatService.createDirectChat({
                      currentUser,
                      otherUser: {
                        id: otherUserId,
                        apodo: contactName,
                        nombre: contactName,
                        avatar: modalPerfilContacto.foto || undefined
                      }
                    });
                    setChats((prevChats: any[]) => {
                      const exists = prevChats.some(c => String(c.id) === String(directChat.id));
                      return exists ? prevChats : deduplicateChats([directChat, ...prevChats]);
                    });
                    setActiveChatId(directChat.id);
                  }
                }}
                className="pill-btn px-4 py-2 bg-club-teal text-white font-bold text-base flex items-center gap-1.5 cursor-pointer"
              >
                <i className="fa-solid fa-comments" /> Iniciar chat privado
              </button>
            )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: LISTADO OFICIAL DE INSCRIPTOS (Con Veto funcional de usuarios) */}
      {modalInscriptosId !== null && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-2xl rounded-3xl border-2 border-amber-200 retro-shadow-strong overflow-hidden max-h-[90vh] flex flex-col min-w-0">
            <div className="p-4 bg-white border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-bold bg-blue-100 text-blue-900 px-3 py-0.5 rounded-full uppercase inline-block">
                  Nómina de Participantes
                </span>
                <h3 className="font-brand text-xl font-bold text-club-brown mt-1 break-words">
                  {activities.find(a => a.id === modalInscriptosId)?.title || 'Actividad'}
                </h3>
              </div>
              <button
                onClick={() => setModalInscriptosId(null)}
                className="pill-btn px-3.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer shrink-0"
              >
                Cerrar
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-3">
              {(() => {
            const actInsc = activities.find(a => a.id === modalInscriptosId);
            const cleanList = getCleanEnrolledList(actInsc?.enrolledUsernames || []);
            const ocupados = cleanList.length;
            const isSinCupo = !actInsc?.capacity || Number(actInsc?.capacity) >= 999 || (actInsc as any)?.tipoCupo === 'sin_limite' || (actInsc as any)?.tipoCupo === 'ilimitado';
            const disponibles = actInsc ? Math.max(0, Number(actInsc.capacity || 20) - ocupados) : 0;

            return (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-base text-stone-700 bg-amber-50 p-3.5 rounded-2xl border border-amber-200">
                <span className="font-bold text-club-brown flex items-center gap-1.5">
                  <i className="fa-solid fa-users text-club-orange" />
                  {isSinCupo ? (
                    <>Inscriptos confirmados: <span className="text-club-orange font-black text-lg">{ocupados}</span></>
                  ) : (
                    <>Cupos ocupados: <span className="text-club-orange font-black text-lg">{ocupados}</span> de {actInsc?.capacity || 20}</>
                  )}
                </span>
                <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                  <i className="fa-solid fa-circle-check" />
                  {isSinCupo ? (
                    <span>Cupo libre</span>
                  ) : (
                    <>Lugares disponibles: <span className="font-black text-lg">{disponibles}</span></>
                  )}
                </span>
              </div>
            );
          })()}

              <div className="space-y-2 text-base">
                {(() => {
                  const actInsc = activities.find(a => a.id === modalInscriptosId);
                  const rawEnrolled = Array.isArray(actInsc?.enrolledUsernames) ? actInsc.enrolledUsernames : [];

                  const uniqueMap = new Map<string, string>();
                  rawEnrolled.forEach((item: any) => {
                    const str = String(item || '').trim();
                    if (!str) return;
                    const low = str.toLowerCase();

                    let groupKey = low;
                    if (low.startsWith('usr_1793003176395') || low === 'nerinitaa' || low === 'nerina') {
                      groupKey = 'nerina_user';
                    }

                    const currentVal = uniqueMap.get(groupKey);
                    if (!currentVal || currentVal.startsWith('usr_')) {
                      uniqueMap.set(groupKey, str);
                    }
                  });

                  const enrolledList = Array.from(uniqueMap.values());

                  if (enrolledList.length === 0) {
                    return (
                      <p className="p-5 bg-white rounded-2xl border border-amber-200 text-stone-500 italic text-center">
                        No hay participantes inscriptos en esta actividad.
                      </p>
                    );
                  }
                  return enrolledList.map((uName, idx) => (
                    <div key={idx} className="bg-white p-3.5 rounded-2xl border border-amber-200 flex flex-col sm:flex-row justify-between sm:items-center gap-2.5 shadow-xs">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-club-orange text-white font-bold flex items-center justify-center text-base shrink-0">
                          {uName.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-base text-club-brown break-words">{uName}</p>
                          <p className="text-sm text-stone-500">Inscripto confirmado</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleVetoUser(modalInscriptosId, uName)}
                        className="pill-btn px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-base font-bold cursor-pointer shrink-0"
                      >
                        <i className="fa-solid fa-user-slash mr-1" /> Vetar de la actividad
                      </button>
                    </div>
                  ));
                })()}
              </div>
            </div>

            <div className="p-3.5 bg-white border-t border-amber-200 flex flex-wrap justify-between items-center gap-2">
            <button
          onClick={async () => {
            const act = activities.find(a => a.id === modalInscriptosId);
            const cleanList = getCleanEnrolledList(act?.enrolledUsernames || []);

            let debugMsg = '';
            let contactosMap: Record<string, string> = {};

            try {
              const usersMap = (allUsersMap && Object.keys(allUsersMap).length > 0)
                ? allUsersMap
                : await api.getUsers();
              Object.values(usersMap).forEach((u: any) => {
                const num = String(u.contactoEmergencia || u.contacto_emergencia || '').trim();
                ['id', 'usuario', 'apodo', 'nombre'].forEach(k => {
                  if (u[k]) contactosMap[String(u[k]).trim().toLowerCase()] = num;
                });
              });
            } catch (err: any) {
              debugMsg = `Excepción JS: ${err?.message || err}`;
            }

            const nomina = cleanList.map(n => {
              const key = String(n || '').trim().toLowerCase();
              return {
                nombre: n,
                contacto: contactosMap[key] || '-'
              };
            });

            descargarPlanillaPDF(act?.title || 'Actividad', nomina);
          }}
          className="pill-btn px-4 py-2 bg-amber-100 hover:bg-amber-200 text-club-brown text-base font-bold flex items-center gap-2 cursor-pointer"
        >
          <i className="fa-solid fa-file-arrow-down text-club-orange" /> Descargar Planilla
        </button>
              <button
                onClick={() => setModalInscriptosId(null)}
                className="pill-btn px-5 py-2 bg-club-orange text-white text-base font-bold shadow-sm cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MODERACIÓN PERSONAL DE LA ACTIVIDAD (Dinámico por actividad) */}
      {modalModeracionActividadId !== null && (() => {
        const actModerar = activities.find(a => a.id === modalModeracionActividadId);
        if (!actModerar) return null;
        const inscriptosCount = actModerar.enrolledUsernames ? actModerar.enrolledUsernames.length : actModerar.enrolledCount;
        const libresCount = Math.max(0, actModerar.capacity - inscriptosCount);
        const enrolledParticipants = (actModerar.enrolledUsernames && actModerar.enrolledUsernames.length > 0)
          ? actModerar.enrolledUsernames.filter(u => u !== currentUser?.usuario && u !== currentUser?.apodo)
          : [];
        const relatedChat = chats.find(c => c.activityId === actModerar.id);

        return (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
            <div className="bg-club-cream w-full max-w-xl rounded-3xl border-2 border-amber-200 retro-shadow-strong overflow-hidden max-h-[90vh] flex flex-col min-w-0">
              <div className="p-4 bg-white border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-bold bg-amber-200 text-club-brown px-3 py-0.5 rounded-full uppercase inline-block">
                    Panel de Organización Vecinal
                  </span>
                  <h3 className="font-brand text-xl font-bold text-club-brown mt-1 break-words">
                    Moderar mi actividad: {actModerar.title}
                  </h3>
                </div>
                <button
                  onClick={() => setModalModeracionActividadId(null)}
                  className="pill-btn px-3.5 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer shrink-0"
                >
                  Cerrar
                </button>
              </div>

              <div className="p-5 overflow-y-auto space-y-4 text-base text-club-brown">
                <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 space-y-2 leading-relaxed">
                  <p className="font-bold text-lg text-club-brown">Estado de la actividad</p>
                  <p className="text-stone-700">
                    <strong>{actModerar.isApproved ? 'Aprobada por moderación CLUB65 ✓' : 'En revisión de seguridad'}</strong> • {actModerar.isApproved ? 'Visible para todos los vecinos en la Cartelera.' : 'Pendiente de aprobación.'}
                  </p>
                  <p className="text-stone-700">
                    Cupos: <strong>
                      {inscriptosCount} de {actModerar.capacity} personas anotadas
                    </strong> (
                      {libresCount} lugares libres
                    ).
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-bold text-lg text-club-brown">Participantes confirmados:</h4>
                  {enrolledParticipants.length === 0 ? (
                    <p className="p-3.5 bg-white rounded-xl border border-amber-200 text-stone-500 italic text-center">
                      Aún no hay otros participantes anotados en esta actividad.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {enrolledParticipants.map((uName, idx) => (
                        <div key={idx} className="p-3.5 bg-white rounded-xl border border-amber-200 flex flex-wrap justify-between items-center gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-club-brown break-words">{uName}</p>
                            <p className="text-sm text-stone-500">Inscripta/o en tu actividad</p>
                          </div>
                          <button
                            onClick={() => handleVetoUser(actModerar.id, uName)}
                            className="pill-btn px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-base cursor-pointer shrink-0"
                          >
                            Vetar de la actividad
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t border-amber-200 flex flex-col sm:flex-row gap-2">
                  <button
                    onClick={() => {
                      setMotivoCancelacionInput('Cancelada por el organizador');
                      setModalConfirmarCancelacion({
                        id: actModerar.id,
                        nombre: actModerar.title,
                        dia: actModerar.schedule,
                        hora: '',
                        tipo: 'personal'
                      });
                    }}
                    className="pill-btn flex-1 py-2.5 px-4 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-base text-center flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <i className="fa-solid fa-ban" /> Cancelar actividad
                  </button>
                  {relatedChat && (
                    <button
                      onClick={() => {
                        setModalModeracionActividadId(null);
                        setCurrentView('chat');
                        setActiveChatId(relatedChat.id);
                      }}
                      className="pill-btn flex-1 py-2.5 px-4 bg-club-teal hover:bg-club-teal/80 text-white font-bold text-base text-center shadow-xs cursor-pointer"
                    >
                      Enviar mensaje al grupo
                    </button>
                  )}
                </div>
              </div>

              <div className="p-3.5 bg-white border-t border-amber-200 flex flex-wrap justify-between items-center gap-2">
                <button
                  onClick={() => handleDescargarPlanillaActividad(actModerar, enrolledParticipants)}
                  className="pill-btn px-4 py-2 bg-amber-100 hover:bg-amber-200 text-club-brown text-base font-bold flex items-center gap-2 cursor-pointer"
                >
                  <i className="fa-solid fa-file-arrow-down text-club-orange" /> Descargar Planilla
                </button>
                <button
                  onClick={() => setModalModeracionActividadId(null)}
                  className="pill-btn px-5 py-2 bg-club-orange text-white text-base font-bold shadow-sm cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: CREAR / PROPONER EVENTO */}
      {modalCrearEventoOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-4xl rounded-3xl border-2 border-amber-200 retro-shadow-strong overflow-hidden max-h-[92dvh] flex flex-col min-w-0">
            <div className="p-4 sm:p-5 bg-white border-b border-amber-200 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-brand text-xl sm:text-2xl font-bold text-club-brown break-words min-w-0">
                {editingProposalActivityId ? 'Modificar y reenviar propuesta comunitaria' : (eventoTipoCreacion === 'institucional' ? 'Crear actividad validada' : 'Proponer actividad comunitaria')}
              </h3>
            </div>

            <form onSubmit={handleSubmitEvento} className="p-4 sm:p-6 overflow-y-auto space-y-6 text-base text-club-brown leading-relaxed">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-amber-200 space-y-4 min-w-0">
                  <h4 className="font-brand text-lg font-bold text-club-brown border-b border-amber-100 pb-2">Información general</h4>
                  <div>
                    <label className="block font-bold text-base text-club-brown mb-1">Nombre de la actividad *</label>
                    <input
                      type="text"
                      required
                      value={eventoForm.nombre}
                      onChange={(e) => setEventoForm({ ...eventoForm, nombre: e.target.value })}
                      placeholder="Elige un nombre corto y memorable"
                      className="w-full px-3.5 py-2.5 bg-amber-50/50 border border-amber-200 rounded-xl outline-none text-base focus:ring-2 focus:ring-club-orange"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-base text-club-brown mb-1">Avance corto *</label>
                    <textarea
                      rows={2}
                      required
                      value={eventoForm.avance}
                      onChange={(e) => setEventoForm({ ...eventoForm, avance: e.target.value })}
                      placeholder="Agrega algunas palabras debajo del nombre de la actividad para incentivar a los participantes (aparecerá en la carátula de la Cartelera)."
                      className="w-full px-3.5 py-2.5 bg-amber-50/50 border border-amber-200 rounded-xl outline-none text-base leading-relaxed focus:ring-2 focus:ring-club-orange"
                    />
                  </div>
                  <div>
                    <label className="block font-bold text-base text-club-brown mb-1">Categoría de actividad</label>
                    <select
                      value={eventoForm.categoria}
                      onChange={(e) => setEventoForm({ ...eventoForm, categoria: e.target.value as any })}
                      className="w-full px-3.5 py-2.5 bg-amber-50/50 border border-amber-200 rounded-xl outline-none text-base"
                    >
                      <option value="salud">Salud y Movimiento</option>
                      <option value="cultura">Cultura y Arte</option>
                      <option value="social">Juegos y Mateadas</option>
                      <option value="musica">Música y Baile</option>
                      <option value="tecnologia">Tecnología y Celulares</option>
                      <option value="memoria">Estimulación y Memoria</option>
                      <option value="naturaleza">Naturaleza y Paseos</option>
                    </select>
                  </div>
                </div>

                <div className="lg:col-span-1 bg-white p-5 rounded-2xl border border-amber-200 flex flex-col justify-between space-y-3 min-w-0">
                  <div>
                    <h4 className="font-brand text-lg font-bold text-club-brown border-b border-amber-100 pb-2">Imagen de la actividad</h4>
                    <label className="mt-3 relative overflow-hidden border-2 border-dashed border-amber-300 rounded-2xl h-40 flex flex-col items-center justify-center text-center p-3 hover:bg-amber-50/50 cursor-pointer">
                      {isUploadingActivityImage ? (
                        <div className="flex flex-col items-center justify-center text-club-orange">
                          <i className="fa-solid fa-spinner fa-spin text-2xl mb-1" />
                          <span className="text-base font-bold">Subiendo foto...</span>
                        </div>
                      ) : eventoForm.imagen ? (
                        <img
                          src={eventoForm.imagen}
                          alt="Vista previa de actividad"
                          className="w-full h-full object-cover rounded-xl"
                        />
                      ) : (
                        <>
                          <div className="w-10 h-10 rounded-full bg-club-orange/10 text-club-orange flex items-center justify-center text-xl mb-1">
                            <i className="fa-solid fa-cloud-arrow-up" />
                          </div>
                          <span className="text-base font-bold text-club-orange">Subir desde dispositivo</span>
                          <span className="text-sm text-stone-500 mt-1">Recomendado 16:9</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={isUploadingActivityImage}
                        onChange={handleEventImageFile}
                        className="hidden"
                      />
                    </label>
                  </div>
                  <div className="text-sm text-stone-500 pt-2 border-t border-amber-100 break-words">
                    <span className="font-bold text-club-brown block mb-1">Imagen activa:</span>
                    <span className={`font-bold ${isUploadingActivityImage ? 'text-club-orange' : eventoForm.imagen ? 'text-emerald-700' : 'text-stone-500'}`}>
                      {isUploadingActivityImage ? 'Subiendo foto al servidor...' : eventoImgLabel}
                    </span>
                    {eventoForm.imagen && !isUploadingActivityImage && (
                      <p className="mt-1 text-sm text-stone-500">Podés cambiarla haciendo clic en el cuadro de arriba.</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-amber-200 space-y-4">
                <h4 className="font-brand text-lg font-bold text-club-brown border-b border-amber-100 pb-2">Fecha y horario</h4>
                <div className="flex flex-wrap gap-2 text-base">
                  <label className="flex items-center gap-2 p-2.5 px-4 rounded-xl border border-amber-200 bg-amber-50 font-bold cursor-pointer">
                    <input
                      type="radio"
                      name="ev_frecuencia"
                      value="unico"
                      checked={eventoForm.frecuencia === 'unico'}
                      onChange={() => setEventoForm({ ...eventoForm, frecuencia: 'unico' })}
                      className="w-4 h-4 shrink-0"
                    />
                    <span>Encuentro único</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 px-4 rounded-xl border border-amber-200 hover:bg-amber-50 font-bold cursor-pointer">
                    <input
                      type="radio"
                      name="ev_frecuencia"
                      value="recurrente"
                      checked={eventoForm.frecuencia === 'recurrente'}
                      onChange={() => setEventoForm({ ...eventoForm, frecuencia: 'recurrente' })}
                      className="w-4 h-4 shrink-0"
                    />
                    <span>Encuentro recurrente</span>
                  </label>
                </div>

                {eventoForm.frecuencia === 'unico' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-base pt-1">
                    <div>
                      <label className="block font-bold text-stone-700 mb-1">Fecha de inicio</label>
                      <input
                        type="date"
                        min={getArgentinaTodayYMD()}
                        value={eventoForm.fechaIni}
                        onChange={(e) => {
                          const newFechaIni = e.target.value;
                          setEventoForm((prev: any) => {
                            let nextFechaFin = prev.fechaFin;
                            if (nextFechaFin && newFechaIni && nextFechaFin < newFechaIni) {
                              nextFechaFin = newFechaIni;
                            }
                            return { ...prev, fechaIni: newFechaIni, fechaFin: nextFechaFin };
                          });
                        }}
                        className="w-full px-3 py-2 bg-amber-50/50 border border-amber-200 rounded-xl outline-none text-base"
                      />
                    </div>
                    {/* Hora de inicio */}
                    <div>
                      <label className="block font-bold text-stone-700 mb-1">Hora de inicio</label>
                      <select
                        value={eventoForm.horaIni}
                        onChange={(e) => {
                          const newHoraIni = e.target.value;
                          setEventoForm((prev: any) => {
                            if (!newHoraIni) return { ...prev, horaIni: newHoraIni };
                            const isSameDay = !prev.fechaFin || prev.fechaFin === prev.fechaIni;
                            let newHoraFin = prev.horaFin;
                            let newFechaFin = prev.fechaFin;
                            if (isSameDay && newHoraFin && newHoraFin <= newHoraIni) {
                              const bumped = addMinutesToHHMM(newHoraIni, 120);
                              newHoraFin = bumped.time;
                              if (bumped.nextDay && prev.fechaIni) {
                                newFechaFin = addDaysYMD(prev.fechaIni, 1);
                              }
                            }
                            return { ...prev, horaIni: newHoraIni, horaFin: newHoraFin, fechaFin: newFechaFin };
                          });
                        }}
                        className="w-full px-3 py-2 bg-amber-50/50 border border-amber-200 rounded-xl outline-none cursor-pointer text-stone-800 font-medium text-base"
                      >
                        <option value="">Seleccionar horario</option>
                        {(() => {
                          const todayStr = getArgentinaTodayYMD();
                          const isToday = eventoForm.fechaIni === todayStr;
                          const currentMinutes = getArgentinaCurrentMinutes();
                          const slots = getTimeSlots({ isToday, currentMinutes });

                          return slots.map((time) => (
                            <option key={time} value={time}>
                              {time} h
                            </option>
                          ));
                        })()}
                      </select>
                    </div>

                    {/* Fecha de finalización */}
                    <div>
                      <label className="block font-bold text-stone-700 mb-1">Fecha de finalización</label>
                      <input
                        type="date"
                        min={eventoForm.fechaIni || getArgentinaTodayYMD()}
                        value={eventoForm.fechaFin}
                        onChange={(e) => setEventoForm({ ...eventoForm, fechaFin: e.target.value })}
                        className="w-full px-3 py-2 bg-amber-50/50 border border-amber-200 rounded-xl outline-none text-base"
                      />
                    </div>

                    {/* Hora de finalización */}
                    <div>
                      <label className="block font-bold text-stone-700 mb-1">Hora de finalización</label>
                      <select
                        value={eventoForm.horaFin}
                        onChange={(e) => {
                          const selectedFin = e.target.value;
                          setEventoForm((prev: any) => {
                            const isSameDay = !prev.fechaFin || prev.fechaFin === prev.fechaIni;
                            let nextFechaFin = prev.fechaFin;
                            if (selectedFin && prev.horaIni && isSameDay && selectedFin <= prev.horaIni && prev.fechaIni) {
                              nextFechaFin = addDaysYMD(prev.fechaIni, 1);
                            }
                            return { ...prev, horaFin: selectedFin, fechaFin: nextFechaFin };
                          });
                        }}
                        disabled={!eventoForm.horaIni}
                        className="w-full px-3 py-2 bg-amber-50/50 border border-amber-200 rounded-xl outline-none cursor-pointer text-stone-800 font-medium text-base disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <option value="">Seleccionar horario</option>
                        {(() => {
                          if (!eventoForm.horaIni) return null;

                          const sameDay = !eventoForm.fechaFin || eventoForm.fechaFin === eventoForm.fechaIni;
                          const [startH, startM] = eventoForm.horaIni.split(':').map(Number);
                          const startTotalMin = startH * 60 + startM;

                          if (!sameDay) {
                            return getTimeSlots().map((time) => (
                              <option key={time} value={time}>
                                {time} h
                              </option>
                            ));
                          }

                          const sameDaySlots = getTimeSlots({ minMinutes: startTotalMin });
                          const nextDaySlots = getTimeSlots({ maxMinutes: startTotalMin });

                          return (
                            <>
                              {sameDaySlots.map((time) => (
                                <option key={time} value={time}>
                                  {time} h
                                </option>
                              ))}
                              {nextDaySlots.map((time) => (
                                <option key={`next-${time}`} value={time}>
                                  {time} h (día siguiente)
                                </option>
                              ))}
                            </>
                          );
                        })()}
                      </select>
                    </div>
                  </div>
                ) : (
                  <div className="pt-2 space-y-3">
                    <div className="p-4 bg-amber-50/60 rounded-2xl border border-amber-200 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                      <div className="min-w-0">
                        <span className="text-base font-bold text-club-brown block break-words">
                          <i className="fa-solid fa-calendar-week text-club-orange mr-1" /> {resumenRecurrente}
                        </span>
                        <span className="text-sm text-stone-600">Configurá las fechas repetitivas de los encuentros.</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (eventoForm.horaIni && !horaInicioRecurrente) {
                            setHoraInicioRecurrente(eventoForm.horaIni);
                          }
                          if (eventoForm.horaFin && !horaFinRecurrente) {
                            setHoraFinRecurrente(eventoForm.horaFin);
                          }
                          setModalFechasRepetitivasOpen(true);
                        }}
                        className="pill-btn px-4 py-2 bg-club-teal hover:bg-club-teal/80 text-white text-base font-bold flex items-center gap-1.5 self-start sm:self-auto shadow-xs cursor-pointer shrink-0"
                      >
                        <i className="fa-regular fa-calendar-plus" />
                        <span>Modificar fechas repetitivas</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-base">
                      <div className="p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200 min-w-0">
                        <label className="block font-bold text-base text-club-brown mb-1.5">
                          <i className="fa-regular fa-calendar text-club-orange mr-1.5" />
                          Fecha del primer encuentro *
                        </label>
                        <input
                          type="date"
                          required
                          min={getArgentinaTodayYMD()}
                          value={eventoForm.fechaPrimerEncuentro || ''}
                          onChange={(e) =>
                            setEventoForm({ ...eventoForm, fechaPrimerEncuentro: e.target.value })
                          }
                          className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl text-base text-club-brown outline-none focus:ring-2 focus:ring-club-orange"
                        />
                        <p className="text-sm text-stone-600 mt-1">
                          Indicá el día exacto de la primera reunión.
                        </p>
                      </div>

                      <div className="p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200 min-w-0">
                        <label className="block font-bold text-base text-stone-700 mb-1.5">
                          Hora de inicio *
                        </label>
                        <select
                          value={horaInicioRecurrente || eventoForm.horaIni || ''}
                          onChange={(e) => {
                            const newHoraIni = e.target.value;
                            let newHoraFin = horaFinRecurrente || eventoForm.horaFin || '';
                            if (newHoraIni && newHoraFin && newHoraFin === newHoraIni) {
                              newHoraFin = addMinutesToHHMM(newHoraIni, 120).time;
                            } else if (newHoraIni && newHoraFin && newHoraFin < newHoraIni) {
                              // Mantener si ya cruza medianoche salvo que se prefiera ajustar cuando era horario diurno
                              const [iniH] = newHoraIni.split(':').map(Number);
                              const [finH] = newHoraFin.split(':').map(Number);
                              if (iniH < 18 && finH >= 7) {
                                newHoraFin = addMinutesToHHMM(newHoraIni, 120).time;
                              }
                            }
                            updateRecurrenteHorarios(newHoraIni, newHoraFin);
                          }}
                          className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl outline-none cursor-pointer text-stone-800 font-medium text-base focus:ring-2 focus:ring-club-orange"
                        >
                          <option value="">Seleccionar horario</option>
                          {(() => {
                            const todayStr = getArgentinaTodayYMD();
                            const isToday = eventoForm.fechaPrimerEncuentro === todayStr;
                            const currentMinutes = getArgentinaCurrentMinutes();
                            const slots = getTimeSlots({ isToday, currentMinutes });
                            return slots.map((time) => (
                              <option key={time} value={time}>
                                {time} h
                              </option>
                            ));
                          })()}
                        </select>
                        <p className="text-sm text-stone-600 mt-1">
                          Horario de comienzo de las reuniones.
                        </p>
                      </div>

                      <div className="p-3.5 bg-amber-50/70 rounded-2xl border border-amber-200 min-w-0">
                        <label className="block font-bold text-base text-stone-700 mb-1.5">
                          Hora de finalización *
                        </label>
                        <select
                          value={horaFinRecurrente || eventoForm.horaFin || ''}
                          onChange={(e) => {
                            updateRecurrenteHorarios(horaInicioRecurrente || eventoForm.horaIni || '', e.target.value);
                          }}
                          disabled={!(horaInicioRecurrente || eventoForm.horaIni)}
                          className="w-full px-3 py-2 bg-white border border-amber-200 rounded-xl outline-none cursor-pointer text-stone-800 font-medium text-base focus:ring-2 focus:ring-club-orange disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <option value="">Seleccionar horario</option>
                          {(() => {
                            const ini = horaInicioRecurrente || eventoForm.horaIni;
                            if (!ini) return null;
                            const [startH, startM] = ini.split(':').map(Number);
                            const startTotalMin = startH * 60 + startM;
                            const sameDaySlots = getTimeSlots({ minMinutes: startTotalMin });
                            const nextDaySlots = getTimeSlots({ maxMinutes: startTotalMin });
                            return (
                              <>
                                {sameDaySlots.map((time) => (
                                  <option key={time} value={time}>
                                    {time} h
                                  </option>
                                ))}
                                {nextDaySlots.map((time) => (
                                  <option key={`next-${time}`} value={time}>
                                    {time} h (día siguiente)
                                  </option>
                                ))}
                              </>
                            );
                          })()}
                        </select>
                        <p className="text-sm text-stone-600 mt-1">
                          Horario de cierre de las reuniones.
                        </p>
                      </div>
                    </div>

                    <div className="p-3.5 bg-amber-50/50 rounded-2xl border border-amber-200/80">
                      <label className="flex items-start gap-2.5 text-base text-club-brown cursor-pointer select-none font-bold">
                        <input
                          type="checkbox"
                          checked={Boolean(eventoForm.cerrarInscripcionAlIniciarPrimerEncuentro)}
                          onChange={(e) => setEventoForm({ ...eventoForm, cerrarInscripcionAlIniciarPrimerEncuentro: e.target.checked })}
                          className="w-5 h-5 mt-0.5 rounded text-club-orange accent-club-orange border-amber-300 focus:ring-amber-400 cursor-pointer shrink-0"
                        />
                        <span>Cerrar inscripciones al comenzar el primer encuentro</span>
                      </label>
                      <p className="text-sm text-stone-600 mt-1 pl-7 leading-relaxed">
                        Si marcás esta opción, la actividad no permitirá más preinscripciones una vez iniciado el primer encuentro.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white p-5 rounded-2xl border border-amber-200 space-y-3 relative">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 pb-2">
                  <h4 className="font-brand text-lg font-bold text-club-brown">Ubicación de la actividad (Presencial)</h4>
                  <span className="text-sm font-bold text-club-orange bg-orange-50 border border-orange-200 px-3 py-0.5 rounded-full">
                    <i className="fa-solid fa-person-walking mr-1" /> Encuentro Presencial
                  </span>
                </div>

                <div className="relative">
                  <div className="flex flex-wrap items-center justify-between gap-1 mb-1">
                    <label className="block font-bold text-base text-club-brown">Dirección o punto de encuentro *</label>
                    <span className="text-sm text-stone-500 font-semibold flex items-center gap-1">
                      <i className="fa-solid fa-earth-americas text-club-teal" /> Buscador libre OpenStreetMap
                    </span>
                  </div>
                  <div className="relative">
                    <i className="fa-solid fa-magnifying-glass absolute left-3.5 top-3.5 text-stone-400 text-base" />
                    <input
                      type="text"
                      required
                      value={eventoForm.direccion}
                      onChange={(e) => handleSearchLocation(e.target.value)}
                      placeholder="Escribí una calle, altura, plaza o club..."
                      className="w-full pl-10 pr-16 py-2.5 bg-amber-50/50 border border-amber-200 rounded-xl outline-none text-base focus:ring-2 focus:ring-club-orange"
                    />
                    <div className="absolute right-3 top-3 flex items-center gap-1.5">
                      {isSearchingLocation && (
                        <i className="fa-solid fa-spinner fa-spin text-club-orange text-base" title="Buscando en OpenStreetMap..." />
                      )}
                      {eventoForm.direccion && (
                        <button
                          type="button"
                          onClick={() => {
                            setEventoForm(prev => ({ ...prev, direccion: '', lat: -34.6068, lng: -58.5647 }));
                            setShowSugerencias(false);
                          }}
                          className="text-stone-400 hover:text-stone-600 text-base font-bold cursor-pointer"
                        >
                          <i className="fa-solid fa-circle-xmark" />
                        </button>
                      )}
                    </div>
                  </div>
                  {showSugerencias && sugerenciasUbicacion.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-amber-200 rounded-2xl shadow-xl z-30 max-h-56 overflow-y-auto divide-y divide-amber-100">
                      {sugerenciasUbicacion.map((u, i) => (
                        <div
                          key={i}
                          onClick={() => {
                            const chosenAddress = u.nombre || u.detalle;
                            setEventoForm(prev => ({
                              ...prev,
                              direccion: chosenAddress,
                              lat: u.lat ?? prev.lat ?? -34.6068,
                              lng: u.lng ?? prev.lng ?? -58.5647
                            }));
                            setShowSugerencias(false);
                          }}
                          className="p-3 hover:bg-amber-50 cursor-pointer flex items-start gap-2.5 transition"
                        >
                          <i className="fa-solid fa-location-dot text-club-orange text-base mt-1 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-base text-club-brown break-words">{u.nombre}</p>
                            <p className="text-sm text-stone-500 leading-snug break-words">{u.detalle}</p>
                          </div>
                          {u.lat && u.lng && (
                            <span className="text-sm text-stone-400 self-center shrink-0">
                              OSM
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {eventoForm.direccion && (
                    <div className="mt-3 p-3 bg-amber-50/60 rounded-xl border border-amber-200 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-base font-bold text-club-brown flex items-center gap-1.5">
                          <i className="fa-solid fa-map-location-dot text-club-orange" />
                          Vista previa en OpenStreetMap
                        </span>
                        <span className="text-sm text-emerald-800 bg-emerald-100/80 px-2.5 py-0.5 rounded-full font-bold">
                          Leaflet + OSM libre
                        </span>
                      </div>
                      <div className="h-40 w-full rounded-xl overflow-hidden border border-amber-200 shadow-inner">
                        <LeafletMap
                          lat={eventoForm.lat || -34.6068}
                          lng={eventoForm.lng || -58.5647}
                          title={eventoForm.nombre || 'Ubicación seleccionada'}
                          locationName={eventoForm.direccion}
                          height={160}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-amber-200 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 pb-2">
                  <h4 className="font-brand text-lg font-bold text-club-brown">Cupos de asistencia</h4>
                  <span className="text-sm text-stone-500">Configurá la capacidad de participantes</span>
                </div>

                <div className="flex flex-wrap gap-2 text-base">
                  <label className="flex items-center gap-2 p-2.5 px-4 rounded-xl border border-amber-200 bg-amber-50 font-bold cursor-pointer">
                    <input
                      type="radio"
                      name="ev_tipo_cupo"
                      value="limitado"
                      checked={eventoForm.tipoCupo === 'limitado'}
                      onChange={() => setEventoForm({ ...eventoForm, tipoCupo: 'limitado' })}
                      className="w-4 h-4 shrink-0"
                    />
                    <span>Establecer cupo máximo</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 px-4 rounded-xl border border-amber-200 hover:bg-amber-50 font-bold cursor-pointer">
                    <input
                      type="radio"
                      name="ev_tipo_cupo"
                      value="ilimitado"
                      checked={eventoForm.tipoCupo === 'ilimitado'}
                      onChange={() => setEventoForm({ ...eventoForm, tipoCupo: 'ilimitado' })}
                      className="w-4 h-4 shrink-0"
                    />
                    <span>No establecer cupos (Sin límite)</span>
                  </label>
                </div>

                {eventoForm.tipoCupo === 'limitado' && (
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <label className="text-base font-bold text-club-brown">Cantidad máxima de personas:</label>
                    <input
                      type="number"
                      min={2}
                      max={150}
                      value={eventoForm.cupoMax}
                      onChange={(e) => setEventoForm({ ...eventoForm, cupoMax: Number(e.target.value) })}
                      className="w-24 px-3 py-1.5 bg-amber-50/50 border border-amber-200 rounded-xl text-base text-center font-bold outline-none focus:ring-2 focus:ring-club-orange"
                    />
                    <span className="text-sm text-stone-500">vacantes disponibles</span>
                  </div>
                )}
              </div>

              <div className="bg-white p-5 rounded-2xl border border-amber-200 space-y-3">
                <h4 className="font-brand text-lg font-bold text-club-brown border-b border-amber-100 pb-2">
                  Acerca de la actividad (Detalles) *
                </h4>
                <textarea
                  rows={4}
                  required
                  value={eventoForm.descripcion}
                  onChange={(e) => setEventoForm({ ...eventoForm, descripcion: e.target.value })}
                  placeholder="Utiliza este espacio para darles todos los detalles a los participantes acerca de esta actividad (aparecerá en la vista de detalle y mapa)."
                  className="w-full px-3.5 py-2.5 bg-amber-50/50 border border-amber-200 rounded-xl outline-none text-base leading-relaxed focus:ring-2 focus:ring-club-orange"
                />
              </div>

              <div className="bg-white p-5 rounded-2xl border border-amber-200 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-100 pb-2">
                  <h4 className="font-brand text-lg font-bold text-club-brown flex items-center gap-2">
                    <i className="fa-solid fa-video text-club-orange" /> Video explicativo de la actividad (Opcional)
                  </h4>
                  <span className="text-sm font-bold text-amber-900 bg-amber-100/80 px-3 py-0.5 rounded-full border border-amber-200">
                    Máx. {MAX_ACTIVITY_VIDEO_DURATION_SECONDS} segundos
                  </span>
                </div>

                <p className="text-sm text-stone-600 leading-relaxed">
                  Si querés, podés subir un video breve presentando la actividad. Se mostrará en los detalles de la actividad para que los vecinos conozcan de qué se trata.
                </p>

                <div className="p-2.5 bg-amber-50/90 border border-amber-200 rounded-xl text-sm text-amber-900 flex items-start gap-2">
                  <i className="fa-solid fa-circle-info text-amber-600 mt-0.5 shrink-0" />
                  <span>
                    <strong className="font-bold">Límite de duración:</strong> La duración máxima permitida para el video es de {MAX_ACTIVITY_VIDEO_DURATION_SECONDS} segundos.
                  </span>
                </div>

                {isUploadingActivityVideo ? (
                  <div className="w-full py-6 px-4 rounded-xl border-2 border-dashed border-amber-300 bg-amber-50/60 flex flex-col items-center justify-center gap-2 text-club-orange">
                    <i className="fa-solid fa-spinner fa-spin text-2xl" />
                    <span className="text-base font-bold">Subiendo video explicativo al servidor...</span>
                  </div>
                ) : eventoForm.videoUrl ? (
                  <div className="space-y-3">
                    <div className="rounded-xl overflow-hidden border border-amber-200 bg-black shadow-xs">
                      <video
                        src={eventoForm.videoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="w-full max-h-64 object-contain bg-black"
                      />
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-bold text-emerald-700 flex items-center gap-1.5">
                        <i className="fa-solid fa-circle-check" /> Video explicativo cargado ✓
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="pill-btn px-3.5 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-sm font-bold cursor-pointer inline-flex items-center gap-1.5 transition">
                          <i className="fa-solid fa-arrows-rotate" />
                          <span>Cambiar video</span>
                          <input
                            type="file"
                            accept="video/*"
                            disabled={isUploadingActivityVideo}
                            onChange={handleEventVideoFile}
                            className="hidden"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setEventoForm((prev) => ({ ...prev, videoUrl: '' }))}
                          className="pill-btn px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-sm font-bold cursor-pointer inline-flex items-center gap-1.5 transition"
                        >
                          <i className="fa-solid fa-trash-can" />
                          <span>Quitar video</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <label className="w-full py-3.5 px-4 bg-amber-50/60 hover:bg-amber-100/70 text-club-brown border-2 border-dashed border-amber-300 rounded-xl font-bold text-base cursor-pointer flex items-center justify-center gap-2 transition">
                    <i className="fa-solid fa-cloud-arrow-up text-club-orange text-lg" />
                    <span>Adjuntar video explicativo (opcional)</span>
                    <input
                      type="file"
                      accept="video/*"
                      disabled={isUploadingActivityVideo}
                      onChange={handleEventVideoFile}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {liveCreationCollision && (
                <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl flex items-start gap-3 text-rose-900 text-base shadow-xs">
                  <i className="fa-solid fa-triangle-exclamation text-rose-600 text-lg mt-1 shrink-0" />
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-rose-950 text-lg">
                      Superposición de horario con otra actividad
                    </p>
                    <p className="text-rose-800 leading-relaxed font-medium break-words">
                      {liveCreationCollision.reason}
                    </p>
                    <p className="text-sm text-rose-700 leading-relaxed">
                      No es posible proponer ni coordinar una actividad en un horario en el que ya estás inscripto/a o participás como organizador/a. Modificá el día u horario para continuar.
                    </p>
                  </div>
                </div>
              )}

              {liveCreationNameCollision && (
                <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-2xl flex items-start gap-3 text-amber-950 text-base shadow-xs">
                  <i className="fa-solid fa-triangle-exclamation text-club-orange text-lg mt-1 shrink-0" />
                  <div className="space-y-1 min-w-0">
                    <p className="font-bold text-amber-950 text-lg">
                      Nombre de actividad ya publicado en Cartelera
                    </p>
                    <p className="text-amber-900 leading-relaxed font-medium break-words">
                      {liveCreationNameCollision.reason}
                    </p>
                    <p className="text-sm text-amber-800 leading-relaxed">
                      Mientras una actividad esté publicada y vigente en la cartelera, ninguna otra puede tener el mismo nombre. Cuando la actividad anterior finalice o sea dada de baja, el nombre quedará disponible nuevamente.
                    </p>
                  </div>
                </div>
              )}

              <div className="pt-2 flex flex-col-reverse sm:flex-row flex-wrap justify-between items-stretch sm:items-center gap-3 border-t border-amber-200/80">
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  {/* Botón Cancelar: resetea y cierra */}
                  <button
                    type="button"
                    onClick={() => {
                      resetEventoForm();
                      setModalCrearEventoOpen(false);
                    }}
                    className="pill-btn px-4 py-2.5 bg-white border border-stone-300 text-stone-700 hover:bg-stone-100 text-base font-bold w-full sm:w-auto cursor-pointer"
                  >
                    Cancelar
                  </button>

                  {/* Botón Guardar Borrador */}
                  <button
                    type="button"
                    onClick={() => {
                      if (!currentUser) {
                        showToast('Iniciá sesión en tu cuenta para guardar un borrador.');
                        return;
                      }
                      const key = getDraftStorageKey(currentUser);
                      if (key) {
                        try {
                          localStorage.setItem(key, JSON.stringify(eventoForm));
                        } catch (_) {}
                        showToast('¡Borrador guardado con éxito en tu cuenta!');
                        setModalCrearEventoOpen(false);
                      }
                    }}
                    className="pill-btn px-4 py-2.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 text-base font-bold w-full sm:w-auto cursor-pointer flex items-center justify-center gap-1.5"
                  >
                    <i className="fa-regular fa-floppy-disk" />
                    <span>Guardar borrador</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    type="submit"
                    disabled={isPublishing || isUploadingActivityImage || isUploadingActivityVideo || Boolean(liveCreationCollision) || Boolean(liveCreationNameCollision)}
                    title={liveCreationNameCollision?.reason || liveCreationCollision?.reason || ''}
                    className={`pill-btn px-6 py-2.5 bg-club-orange text-white text-base font-bold hover:bg-club-orange-dark shadow-md flex items-center justify-center gap-2 w-full sm:w-auto ${
                      (isPublishing || isUploadingActivityImage || isUploadingActivityVideo || Boolean(liveCreationCollision) || Boolean(liveCreationNameCollision)) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                    }`}
                  >
                    <i className={`fa-solid ${(isPublishing || isUploadingActivityImage || isUploadingActivityVideo) ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`} />
                    <span>
                      {isUploadingActivityImage
                        ? 'Subiendo imagen...'
                        : isUploadingActivityVideo
                        ? 'Subiendo video...'
                        : isPublishing
                        ? 'Procesando...'
                        : editingProposalActivityId
                        ? 'Guardar y reenviar propuesta'
                        : eventoTipoCreacion === 'institucional'
                        ? 'Publicar actividad validada'
                        : 'Enviar a Revisión de Moderación'}
                    </span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUBMODAL: AGREGAR FECHAS REPETITIVAS */}
      {modalFechasRepetitivasOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-2xl rounded-3xl border-2 border-amber-200 retro-shadow-strong overflow-hidden flex flex-col max-h-[90dvh] min-w-0">
            <div className="p-4 bg-white border-b border-amber-200 flex items-center justify-between">
              <h3 className="font-brand text-xl font-bold text-club-brown">Agregar fechas repetitivas</h3>
            </div>

            <div className="p-5 space-y-5 text-base text-club-brown overflow-y-auto leading-relaxed">
              <div className="space-y-1.5">
                <label className="block font-bold text-club-brown">Frecuencia</label>
                <select
                  value={frecuenciaRecurrente}
                  onChange={(e) => setFrecuenciaRecurrente(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none font-bold text-base focus:ring-2 focus:ring-club-orange"
                >
                  <option value="semanal">Semanal</option>
                  <option value="quincenal">Quincenal (Cada 2 semanas)</option>
                  <option value="mensual">Mensual</option>
                </select>
              </div>

              {frecuenciaRecurrente !== 'mensual' ? (
                <div className="space-y-1.5">
                  <label className="block font-bold text-club-brown">Se repite el</label>
                  <div className="flex flex-wrap gap-2">
                    {['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((dia) => {
                      const sel = diasSemanaRecurrente.includes(dia);
                      return (
                        <button
                          key={dia}
                          type="button"
                          onClick={() => {
                            if (sel) {
                              if (diasSemanaRecurrente.length > 1) {
                                setDiasSemanaRecurrente(prev => prev.filter(d => d !== dia));
                              }
                            } else {
                              setDiasSemanaRecurrente(prev => [...prev, dia]);
                            }
                          }}
                          className={`w-11 h-11 rounded-xl font-bold flex items-center justify-center text-base cursor-pointer ${
                            sel
                              ? 'border-2 border-club-orange bg-club-orange text-white shadow-xs'
                              : 'border border-amber-200 bg-white hover:bg-amber-50 text-club-brown'
                          }`}
                        >
                          {dia.charAt(0)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="block font-bold text-club-brown">Día del mes (numérico)</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <span>El día</span>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={diaMesRecurrente}
                      onChange={(e) => setDiaMesRecurrente(Number(e.target.value))}
                      className="w-20 px-3 py-1.5 bg-white border border-amber-200 rounded-xl text-center font-bold text-base outline-none focus:ring-2 focus:ring-club-orange"
                    />
                    <span>de cada mes</span>
                  </div>
                </div>
              )}

              <div className="space-y-1.5 pt-2 border-t border-amber-200/70">
                <h4 className="font-bold text-lg text-club-brown">Finalización de la actividad</h4>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <label className="font-bold text-stone-700">Cantidad de encuentros:</label>
                  <input
                    type="number"
                    min={2}
                    max={52}
                    value={cantidadEventosRecurrente}
                    onChange={(e) => setCantidadEventosRecurrente(Number(e.target.value))}
                    className="w-24 px-3 py-1.5 bg-white border border-amber-200 rounded-xl text-center font-bold text-base outline-none focus:ring-2 focus:ring-club-orange"
                  />
                  <span className="text-stone-600">encuentros en total</span>
                </div>
              </div>

              <div className="bg-amber-50 p-4 rounded-2xl border border-amber-200 text-base">
                <p className="font-bold text-club-brown mb-1">
                  <i className="fa-solid fa-eye text-club-orange mr-1" /> Vista previa del cronograma:
                </p>
                <p className="text-stone-700 leading-relaxed">
                  {frecuenciaRecurrente === 'mensual'
                    ? `Se llevarán a cabo ${cantidadEventosRecurrente} encuentros en total, el día ${diaMesRecurrente} de cada mes.`
                    : frecuenciaRecurrente === 'quincenal'
                    ? `Se llevarán a cabo ${cantidadEventosRecurrente} encuentros cada 2 semanas los días ${diasSemanaRecurrente.join(', ')}.`
                    : `Se llevarán a cabo ${cantidadEventosRecurrente} encuentros todas las semanas los días ${diasSemanaRecurrente.join(', ')}.`}
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-white border-t border-amber-200 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalFechasRepetitivasOpen(false)}
                className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  const effectiveHoraIni = horaInicioRecurrente || eventoForm.horaIni || '';
                  const effectiveHoraFin = horaFinRecurrente || eventoForm.horaFin || '';
                  const horarioTexto = (effectiveHoraIni && effectiveHoraFin)
                    ? ` • ${effectiveHoraIni} a ${effectiveHoraFin} h`
                    : '';

                  const summary = (frecuenciaRecurrente === 'mensual'
                    ? `Mensual (día ${diaMesRecurrente}) • ${cantidadEventosRecurrente} encuentros`
                    : frecuenciaRecurrente === 'quincenal'
                    ? `Cada 2 semanas (${diasSemanaRecurrente.join(', ')}) • ${cantidadEventosRecurrente} encuentros`
                    : `Semanal (${diasSemanaRecurrente.join(', ')}) • ${cantidadEventosRecurrente} encuentros`) + horarioTexto;

                  setResumenRecurrente(summary);
                  setModalFechasRepetitivasOpen(false);
                }}
                className="pill-btn px-5 py-2 bg-club-orange text-white text-base font-bold hover:bg-club-orange-dark shadow-sm cursor-pointer"
              >
                Guardar fechas repetitivas
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREAR NUEVO CHAT GRUPAL */}
      {modalCrearGrupoOpen && !isAdministratorUser(currentUser) && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-3">
          <div className="bg-club-cream w-full max-w-md rounded-3xl border-2 border-amber-200 p-5 space-y-4 max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="flex flex-wrap justify-between items-center gap-2 border-b border-amber-200 pb-2">
              <h3 className="font-brand text-xl font-bold text-club-brown flex items-center gap-2">
                <i className="fa-solid fa-users text-club-orange" /> Crear Nuevo Chat Grupal
              </h3>
            </div>

            <form onSubmit={handleCrearNuevoGrupo} className="space-y-3 text-base leading-relaxed">
              <div>
                <label className="block font-bold text-club-brown mb-1">Nombre del grupo:</label>
                <input
                  type="text"
                  required
                  value={nombreNuevoGrupo}
                  onChange={(e) => setNombreNuevoGrupo(e.target.value)}
                  placeholder="Ej: Compañeros de caminatas"
                  className="w-full px-3.5 py-2.5 bg-white border border-amber-200 rounded-xl outline-none text-base focus:ring-2 focus:ring-club-orange"
                />
              </div>

              <div>
                <label className="block font-bold text-club-brown mb-1">
                  <i className="fa-solid fa-camera text-club-orange mr-1" /> Foto o portada del grupo (opcional):
                </label>
                <div className="flex flex-wrap items-center gap-3 bg-white p-3 rounded-xl border border-amber-200">
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-club-orange flex items-center justify-center bg-amber-100 text-club-orange font-bold text-lg flex-shrink-0 aspect-square">
                    {fotoNuevoGrupo ? (
                      <img
                        src={fotoNuevoGrupo}
                        alt="Foto grupo"
                        className="w-full h-full object-cover aspect-square rounded-full"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <i className="fa-solid fa-users text-amber-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="pill-btn px-3.5 py-2 bg-amber-100 hover:bg-amber-200 text-club-brown text-base font-bold border border-amber-300 cursor-pointer inline-flex items-center gap-1.5 shadow-2xs">
                        <i className="fa-solid fa-upload text-club-orange" />
                        <span>{fotoNuevoGrupo ? 'Cambiar foto' : 'Subir foto del grupo'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const objectUrl = URL.createObjectURL(file);
                              setImageCropperState({
                                isOpen: true,
                                rawSrc: objectUrl,
                                target: 'newGroup',
                                title: 'Ajustar imagen',
                                shape: 'circle'
                              });
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                      {fotoNuevoGrupo && (
                        <button
                          type="button"
                          onClick={() => setFotoNuevoGrupo('')}
                          className="text-sm text-rose-600 hover:underline font-bold cursor-pointer"
                        >
                          Quitar
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-stone-500 mt-1">Se almacena directamente en el servidor de fotos.</p>
                  </div>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                  <label className="font-bold text-club-brown">Invitar participantes (Mis Contactos):</label>
                  {participantesSeleccionadosGrupo.length > 0 && (
                    <span className="text-sm font-bold text-club-orange bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300">
                      {participantesSeleccionadosGrupo.length} {participantesSeleccionadosGrupo.length === 1 ? 'seleccionado' : 'seleccionados'}
                    </span>
                  )}
                </div>
                <div className="space-y-1.5 bg-white p-3 rounded-xl border border-amber-200 max-h-44 overflow-y-auto">
                  {(() => {
                    const localStored = (() => {
                      try {
                        const parsed = JSON.parse(localStorage.getItem('club65_custom_contacts') || '[]');
                        return Array.isArray(parsed) ? parsed.filter(c => !isHardcodedOrMockProfile(c) && !isSelfUserOrContact(c, currentUser)) : [];
                      } catch {
                        return [];
                      }
                    })();
                    const contactsMap = new Map<string, Contact>();
                    filterContactsForUser([...contacts, ...localStored], currentUser).forEach((c: any) => {
                      if (c?.nombre) {
                        contactsMap.set(c.nombre.toLowerCase().trim(), c);
                      }
                    });
                    const allAvailable = Array.from(contactsMap.values());
                    const eligibleContacts = allAvailable.filter(c => !isSelfUserOrContact(c, currentUser) && !isUserAdminByReference(c, allUsersMap) && !didOtherBlockMe(c.nombre) && !didIBlockUser(c.nombre) && !didIBlockContact(c));
                    if (eligibleContacts.length === 0) {
                      return <p className="p-2 text-stone-500 italic leading-relaxed">No tenés otros contactos agendados disponibles para invitar a un grupo. Agendá a otros vecinos para poder armar un grupo con ellos.</p>;
                    }
                    return eligibleContacts.map((c) => (
                      <label key={c.id} className="flex items-center gap-2.5 cursor-pointer text-base font-semibold hover:bg-amber-50/60 p-1.5 rounded-lg transition-colors">
                        <input
                          type="checkbox"
                          checked={participantesSeleccionadosGrupo.includes(c.nombre)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setParticipantesSeleccionadosGrupo(prev => [...prev, c.nombre]);
                            } else {
                              setParticipantesSeleccionadosGrupo(prev => prev.filter(n => n !== c.nombre));
                            }
                          }}
                          className="w-4 h-4 text-club-orange shrink-0"
                        />{' '}
                        <span className="min-w-0 break-words">{c.nombre}</span>
                      </label>
                    ));
                  })()}
                </div>
                {participantesSeleccionadosGrupo.length === 0 && (
                  <p className="text-sm text-amber-800 font-semibold mt-1.5 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 leading-relaxed">
                    <i className="fa-solid fa-circle-info mr-1 text-club-orange" />
                    Seleccioná al menos un contacto para habilitar la creación del grupo.
                  </p>
                )}
              </div>

              <div className="pt-2 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalCrearGrupoOpen(false)}
                  className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
                >
                  Cerrar
                </button>
                <button
                  type="submit"
                  disabled={participantesSeleccionadosGrupo.length === 0}
                  className={`pill-btn px-5 py-2 text-white text-base font-bold shadow-sm transition-all ${
                    participantesSeleccionadosGrupo.length === 0
                      ? 'bg-stone-300 opacity-60 cursor-not-allowed'
                      : 'bg-club-orange hover:bg-club-orange-dark cursor-pointer'
                  }`}
                  title={participantesSeleccionadosGrupo.length === 0 ? 'Seleccioná al menos un participante para el grupo' : 'Crear Grupo'}
                >
                  Crear Grupo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR ELIMINACIÓN DE MENSAJE (PASO 1) */}
      {messageToDelete && (
        <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4">
          <div className="bg-club-cream w-full max-w-sm rounded-3xl border-2 border-rose-300 p-6 space-y-4 shadow-2xl text-club-brown animate-in fade-in zoom-in-95 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-3 text-rose-700">
              <i className="fa-solid fa-trash-can text-2xl shrink-0" />
              <h4 className="font-brand text-xl font-bold">Eliminar Mensaje</h4>
            </div>
            <p className="text-base font-semibold text-center py-2 leading-relaxed">
              ¿Estas seguro de que querés eliminar este mensaje?
            </p>
            <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-amber-200">
              <button
                onClick={() => setMessageToDelete(null)}
                className="pill-btn px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
              >
                NO
              </button>
              <button
                onClick={() => {
                  const curr = messageToDelete;
                  setMessageToDelete(null);
                  setConfirmDenounceMessage(curr);
                }}
                className="pill-btn px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white text-base font-bold cursor-pointer"
              >
                SI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR DENUNCIA DE MENSAJE (PASO 2) */}
      {confirmDenounceMessage && (
        <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4">
          <div className="bg-club-cream w-full max-w-sm rounded-3xl border-2 border-amber-300 p-6 space-y-4 shadow-2xl text-club-brown animate-in fade-in zoom-in-95 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-3 text-club-orange">
              <i className="fa-solid fa-shield-halved text-2xl shrink-0" />
              <h4 className="font-brand text-xl font-bold">Seguridad Comunitaria</h4>
            </div>
            <p className="text-base font-semibold text-center py-2 leading-relaxed">
              ¿querés denunciar este mensaje?
            </p>
            <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-amber-200">
              <button
                onClick={async () => {
                  await handleDeleteChatMessage(confirmDenounceMessage.chatId, confirmDenounceMessage.messageId);
                  setConfirmDenounceMessage(null);
                }}
                className="pill-btn px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
              >
                NO
              </button>
              <button
                onClick={() => {
                  const curr = confirmDenounceMessage;
                  openReportModal({
                    type: 'chat_message',
                    chatId: curr.chatId,
                    messageId: curr.messageId,
                    messageText: curr.messageText,
                    reportedUser: curr.sender
                  });
                }}
                className="pill-btn px-6 py-2 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold cursor-pointer"
              >
                SI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRMAR REPORTE DESDE VISOR DE FOTOS/VIDEOS */}
      {modalConfirmReportVisor && (
        <div className="fixed inset-0 bg-black/70 z-[85] flex items-center justify-center p-4">
          <div className="bg-club-cream w-full max-w-sm rounded-3xl border-2 border-rose-300 p-6 space-y-4 shadow-2xl text-club-brown animate-in fade-in zoom-in-95 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-3 text-rose-700">
              <i className="fa-solid fa-flag text-2xl shrink-0" />
              <h4 className="font-brand text-xl font-bold">Reportar Contenido</h4>
            </div>
            <p className="text-base font-semibold text-center py-2 leading-relaxed">
              ¿Estás seguro de que querés reportar esta foto o video?
            </p>
            <div className="flex flex-wrap justify-end gap-3 pt-2 border-t border-amber-200">
              <button
                onClick={() => setModalConfirmReportVisor(false)}
                className="pill-btn px-6 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
              >
                NO
              </button>
              <button
                onClick={() => {
                  setModalConfirmReportVisor(false);
                  openReportModal({
                    type: 'review_media',
                    reviewId: galeriaItems[galeriaIndex]?.reviewId,
                    mediaUrl: galeriaItems[galeriaIndex]?.mediaUrl,
                    reportedUser: galeriaItems[galeriaIndex]?.autor,
                    activityId: resenasOriginActivityId || undefined
                  });
                }}
                className="pill-btn px-6 py-2 bg-rose-600 hover:bg-rose-700 text-white text-base font-bold cursor-pointer"
              >
                SI
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL UNIFICADO: REPORTAR UN PROBLEMA (Formulario unificado con 9 opciones para toda la web) */}
      {modalReporteData.isOpen && (
        <div className="fixed inset-0 bg-black/75 z-[90] flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-md rounded-3xl border-2 border-amber-200 p-6 space-y-4 shadow-2xl text-club-brown max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="border-b border-amber-200 pb-2 flex items-center justify-between">
              <h3 className="font-brand text-xl font-bold text-club-brown flex items-center gap-2">
                <i className="fa-solid fa-triangle-exclamation text-rose-600 shrink-0" /> Reportar un problema
              </h3>
            </div>

            <form onSubmit={handleSubmitReport} className="space-y-4 text-base leading-relaxed">
              <div>
                <label className="block font-bold text-lg text-club-brown mb-2">¿Qué queres reportar?</label>
                <div className="space-y-1.5 bg-white p-3.5 rounded-2xl border border-amber-200">
                  {[
                    'Spam',
                    'Odio, abuso, o acoso',
                    'Discurso violento',
                    'Comportamientos ilegales',
                    'Suplantación de identidad',
                    'Suicidio o Autolesiones',
                    'Terrorismo o extremismo',
                    'Integridad cívica',
                    'Contenido sexual'
                  ].map((opt) => (
                    <label
                      key={opt}
                      className={`flex items-center gap-2.5 p-2 rounded-xl cursor-pointer font-semibold transition ${
                        modalReporteData.reason === opt ? 'bg-amber-100 text-club-brown font-bold' : 'hover:bg-amber-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="report_reason"
                        value={opt}
                        checked={modalReporteData.reason === opt}
                        onChange={() => setModalReporteData(prev => ({ ...prev, reason: opt }))}
                        className="w-4 h-4 text-club-orange shrink-0"
                      />
                      <span className="min-w-0 break-words">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-base text-club-brown mb-1">
                  ¿Querés dejar un comentario explicativo? (opcional)
                </label>
                <textarea
                  rows={3}
                  value={modalReporteData.comment}
                  onChange={(e) => setModalReporteData(prev => ({ ...prev, comment: e.target.value }))}
                  placeholder="Contanos brevemente qué sucedió..."
                  className="w-full p-3 bg-white border border-amber-200 rounded-xl outline-none text-base leading-relaxed focus:ring-2 focus:ring-club-orange"
                />
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-amber-200">
                <button
                  type="button"
                  onClick={() => {
                    setModalReporteData({
                      isOpen: false,
                      type: 'chat_message',
                      reason: 'Spam',
                      comment: ''
                    });
                    setConfirmDenounceMessage(null);
                  }}
                  className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReport}
                  className="pill-btn px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-base font-bold shadow cursor-pointer"
                >
                  {isSubmittingReport ? 'Enviando...' : 'Enviar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MODERACIÓN FUNCIONAL DEL GRUPO (Eliminar participante, Cambiar foto, Hacer admin) */}
      {modalModerarGrupoOpen && activeChat && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-amber-200 p-6 space-y-5 shadow-2xl text-club-brown max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="border-b border-amber-200 pb-3">
              <span className="text-sm font-bold bg-amber-200 text-club-brown px-3 py-0.5 rounded-full uppercase inline-block">
                Moderación del Grupo
              </span>
              <h3 className="font-brand text-xl font-bold text-club-brown mt-1 break-words">
                Moderar grupo: {activeChat.title}
              </h3>
            </div>

            {/* Cambiar foto del grupo (con ajuste circular interactivo estilo WhatsApp) */}
            <div className="bg-white p-4 rounded-2xl border border-amber-200 space-y-2">
              <label className="block text-base font-bold text-club-brown">
                <i className="fa-solid fa-camera text-club-orange mr-1" /> Foto del grupo
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-club-orange flex items-center justify-center bg-club-orange text-white font-bold text-xl flex-shrink-0 shadow-sm aspect-square">
                  {activeChat.image || activeChat.avatar ? (
                    <img
                      src={activeChat.image || activeChat.avatar}
                      alt="Foto grupo"
                      className="w-full h-full object-cover aspect-square rounded-full"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <i className="fa-solid fa-users" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <label className="pill-btn px-4 py-2 bg-amber-100 hover:bg-amber-200 text-club-brown text-base font-bold border border-amber-300 cursor-pointer inline-flex items-center gap-2 shadow-xs">
                    <i className="fa-solid fa-camera text-club-orange" /> Subir y ajustar foto del grupo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const objectUrl = URL.createObjectURL(file);
                          setImageCropperState({
                            isOpen: true,
                            rawSrc: objectUrl,
                            target: 'group',
                            title: 'Ajustar foto del grupo'
                          });
                        }
                      }}
                    />
                  </label>
                  <p className="text-sm text-stone-500 mt-1 leading-relaxed">Podrás encuadrar y hacer zoom sobre la foto antes de aplicarla.</p>
                </div>
              </div>
            </div>

            {/* Participantes del grupo y Agregar participante */}
            {(() => {
              const linkedAct = activeChat.activityId 
                ? activities.find(a => Number(a.id) === Number(activeChat.activityId) || String(a.id) === String(activeChat.activityId))
                : null;

              const isInvalidGeneric = (str: any) => {
                const low = String(str || '').toLowerCase().trim();
                return (
                  !low ||
                  low === 'institución comunitaria' ||
                  low === 'institucion comunitaria' ||
                  low === 'institución' ||
                  low === 'institucion' ||
                  low === 'vecino de club65' ||
                  low === 'vecino' ||
                  low === 'sistema club65' ||
                  low === 'system' ||
                  low === 'usuario' ||
                  low.startsWith('usr_') ||
                  low.startsWith('user_')
                );
              };

              // Identificar tokens del usuario actual
              const myTokens = [
                currentUser?.id,
                currentUser?.usuario,
                currentUser?.nombre,
                currentUser?.apodo,
                (currentUser as any)?.institucion
              ].filter(Boolean).map((t: any) => String(t).toLowerCase().trim());

              // Resolver participantes usando deduplicación canónica para prevenir duplicados
              const resolvedParts = getResolvedChatParticipants(
                activeChat,
                currentUser,
                allUsersMap,
                linkedAct,
                contacts
              );

              const finalParticipants: { name: string; isAdmin: boolean; isSelf: boolean; foto?: string }[] = resolvedParts.map(p => ({
                name: p.displayName,
                isAdmin: p.isAdmin,
                isSelf: p.isSelf,
                foto: p.foto
              }));

              // Armar lista de candidatos a agregar
              const currentPartNames = new Set(finalParticipants.map(p => p.name.toLowerCase().trim()));
              let eligibleToAdd: { nombre: string; detalle: string; foto?: string }[] = [];

              if (activeChat.activityId) {
                const enrolled = linkedAct?.enrolledUsernames || [];
                const vetted = linkedAct?.vettedUsers || (linkedAct as any)?.vetted_users || [];
                const removedFromChat = activeChat.removedParticipants || [];
                const allCandidates = Array.from(new Set([...enrolled, ...vetted, ...removedFromChat]));
                eligibleToAdd = allCandidates
                  .filter(uName => {
                    const norm = uName.trim().toLowerCase();
                    const isAlreadyIn = currentPartNames.has(norm);
                    const isSelf = myTokens.includes(norm);
                    return !isAlreadyIn && !isSelf && !isInvalidGeneric(uName) && !isUserAdminByReference(uName, allUsersMap);
                  })
                  .map(uName => {
                    const uLow = uName.trim().toLowerCase();
                    const uObj = allUsersMap[uLow] || Object.values(allUsersMap).find(u =>
                      u.usuario?.toLowerCase() === uLow ||
                      u.apodo?.toLowerCase() === uLow ||
                      u.id?.toLowerCase() === uLow
                    );
                    const display = uObj?.apodo || uObj?.usuario || uName;
                    const isVetted = vetted.some((v: string) => String(v).trim().toLowerCase() === uLow) ||
                                     removedFromChat.some((r: string) => String(r).trim().toLowerCase() === uLow);
                    return {
                      nombre: display,
                      detalle: isVetted ? 'Participante retirado/a (hacé clic para volver a agregarlo/a)' : 'Inscripto/a a la actividad',
                      foto: getUserPhotoByName(display) || getUserPhotoByName(uName)
                    };
                  })
                  .filter(item => !isTechnicalIdentifier(item.nombre) && !isUserAdminByReference(item.nombre, allUsersMap));
              } else {
                const contactItems = filterContactsForUser(contacts, currentUser)
                  .filter(c => !isUserAdminByReference(c, allUsersMap))
                  .map(c => {
                  const isPrevRemoved = (activeChat.removedParticipants || []).some(
                    (r: string) => String(r).trim().toLowerCase() === c.nombre.trim().toLowerCase()
                  );
                  return {
                    nombre: c.nombre,
                    detalle: isPrevRemoved ? 'Contacto (retirado/a anteriormente)' : (c.detalle || 'Contacto de tu agenda'),
                    foto: c.foto || getUserPhotoByName(c.nombre)
                  };
                });

                const removedItems: { nombre: string; detalle: string; foto?: string }[] = [];
                (activeChat.removedParticipants || []).forEach((r: string) => {
                  const rClean = String(r).trim();
                  if (!rClean || isTechnicalIdentifier(rClean) || isInvalidGeneric(rClean) || isUserAdminByReference(rClean, allUsersMap)) return;
                  const uObj = allUsersMap[rClean.toLowerCase()] || Object.values(allUsersMap).find(u => u && [u.usuario, u.apodo, u.id].some(tok => tok && String(tok).toLowerCase().trim() === rClean.toLowerCase()));
                  if (isAdministratorUser(uObj)) return;
                  const displayName = uObj?.apodo || uObj?.usuario || rClean;
                  if (displayName && !isTechnicalIdentifier(displayName) && !isInvalidGeneric(displayName) && !isUserAdminByReference(displayName, allUsersMap)) {
                    removedItems.push({
                      nombre: displayName,
                      detalle: 'Participante retirado/a (hacé clic para volver a agregarlo/a)',
                      foto: getUserPhotoByName(displayName)
                    });
                  }
                });

                eligibleToAdd = [...contactItems, ...removedItems]
                  .filter(c => {
                    const cNorm = c.nombre.trim().toLowerCase();
                    const isAlreadyIn = currentPartNames.has(cNorm);
                    const isSelf = myTokens.includes(cNorm) || isSelfUserOrContact(c, currentUser);
                    return !isAlreadyIn && !isSelf && !isInvalidGeneric(c.nombre) && !isUserAdminByReference(c, allUsersMap) && !didOtherBlockMe(c.nombre) && !didIBlockUser(c.nombre) && !didIBlockContact(c);
                  });
              }

              const seenUsers = new Set<string>();
              const uniqueEligible = (eligibleToAdd || []).filter((u: any) => {
                if (isUserAdminByReference(u, allUsersMap)) return false;
                const rawVal = typeof u === 'object' 
                  ? (u.usuario || u.nombre || u.apodo || u.id || '') 
                  : String(u || '');
                const cleanKey = String(rawVal).toLowerCase().trim().replace(/^usr_/, '');
                if (!cleanKey || seenUsers.has(cleanKey)) return false;
                seenUsers.add(cleanKey);
                return true;
              });

              return (
                <>
                  <div className="space-y-2">
                    <h4 className="font-bold text-lg text-club-brown flex items-center justify-between">
                      <span>Participantes ({finalParticipants.length})</span>
                    </h4>
                    <div className="space-y-2.5 max-h-72 overflow-y-auto overflow-x-hidden pr-0.5">
                      {finalParticipants.map((part, idx) => {
                        const rawPartPhoto = getUserPhotoByName(part.name) || (allUsersMap[part.name.toLowerCase().trim()]?.avatar) || part.foto;
                        const partPhoto = sanitizeProfileAvatar(rawPartPhoto);
                        return (
                          <div
                            key={idx}
                            className="p-3.5 bg-white rounded-2xl border border-amber-200 shadow-xs space-y-2.5"
                          >
                            <div className="flex items-center justify-between gap-3 min-w-0">
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div className="w-10 h-10 rounded-full bg-club-orange/20 text-club-orange font-bold flex items-center justify-center text-sm overflow-hidden flex-shrink-0 border border-amber-200">
                                  {partPhoto ? (
                                    <img src={partPhoto} alt={part.name} className="w-full h-full object-cover aspect-square rounded-full" />
                                  ) : (
                                    (part.name || '?').charAt(0).toUpperCase()
                                  )}
                                </div>
                                <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="font-bold text-base text-club-brown break-words leading-snug">{part.name}</span>
                                  {part.isAdmin && (
                                    <span className="bg-amber-100 text-amber-900 font-bold px-2.5 py-0.5 rounded-full text-xs border border-amber-200 inline-flex items-center gap-1">
                                      👑 Moderador del grupo
                                    </span>
                                  )}
                                </div>
                              </div>
                              {part.isSelf && (
                                <span className="text-sm font-bold text-stone-500 italic shrink-0">
                                  Vos (Organizador)
                                </span>
                              )}
                            </div>

                            {!part.isSelf && (
                              <div className="pt-2.5 border-t border-amber-100 flex flex-wrap items-center gap-2">
                                {!part.isAdmin && (
                                  <button
                                    type="button"
                                    aria-label={`Designar moderador del grupo a ${part.name}`}
                                    title="Designar moderador del grupo"
                                    onClick={() => handleMakeAdmin(part.name, activeChat?.id, activeChat?.activityId)}
                                    className="inline-flex items-center justify-center gap-1.5 flex-1 min-w-[160px] px-3 py-1.5 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold text-sm transition-colors cursor-pointer"
                                  >
                                    <i className="fa-solid fa-crown text-amber-600 text-xs shrink-0" />
                                    <span>Designar moderador</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Eliminar participante ${part.name}`}
                                  title="Eliminar participante del grupo"
                                  disabled={Boolean(isModifyingParticipant)}
                                  onClick={() => handleRemoveParticipant(part.name)}
                                  className={`inline-flex items-center justify-center gap-1.5 flex-1 min-w-[160px] px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-sm transition-colors ${
                                    isModifyingParticipant ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                                  }`}
                                >
                                  <i className="fa-solid fa-user-minus text-xs shrink-0" />
                                  <span>{isModifyingParticipant === part.name ? 'Retirando...' : 'Eliminar participante'}</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* AGREGAR PARTICIPANTE AL GRUPO */}
                  <div className="bg-amber-50/70 p-4 rounded-2xl border border-amber-200 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-bold text-base text-club-brown flex items-center gap-1.5">
                        <i className="fa-solid fa-user-plus text-club-orange" />
                        <span>Agregar participante</span>
                      </h4>
                      <span className="text-sm text-stone-500 font-semibold">
                        {activeChat.activityId ? 'Inscriptos a la actividad fuera del grupo' : 'Tus contactos disponibles'}
                      </span>
                    </div>

                    {uniqueEligible.length === 0 ? (
                      <p className="text-stone-500 text-base italic bg-white p-3 rounded-xl border border-amber-200 text-center leading-relaxed">
                        {activeChat.activityId
                          ? 'No hay otros participantes inscriptos a la actividad fuera de este grupo.'
                          : 'No tenés otros contactos disponibles para agregar a este grupo.'}
                      </p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {uniqueEligible.map((u: any, i: number) => {
                          const rawCandPhoto = getUserPhotoByName(u.nombre) || (allUsersMap[u.nombre.toLowerCase().trim()]?.avatar) || u.foto;
                          const candPhoto = sanitizeProfileAvatar(rawCandPhoto);
                          return (
                            <div
                              key={i}
                              className="p-2.5 bg-white rounded-xl border border-amber-200 flex flex-wrap items-center justify-between gap-2 text-base"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-club-orange/20 text-club-orange font-bold flex items-center justify-center text-sm overflow-hidden flex-shrink-0">
                                  {candPhoto ? (
                                    <img src={candPhoto} alt={u.nombre} className="w-full h-full object-cover aspect-square rounded-full" />
                                  ) : (
                                    (u.nombre || '?').charAt(0).toUpperCase()
                                  )}
                                </div>
                              <div className="min-w-0">
                                <p className="font-bold text-club-brown break-words">{u.nombre}</p>
                                <p className="text-sm text-stone-500 break-words">{u.detalle}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={Boolean(isModifyingParticipant)}
                              onClick={() => handleAddParticipantToGroup(u.nombre)}
                              className={`pill-btn px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base shadow-xs flex items-center gap-1.5 shrink-0 ${
                                isModifyingParticipant ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                              }`}
                            >
                              <i className="fa-solid fa-plus text-sm" /> {isModifyingParticipant === u.nombre ? 'Agregando...' : 'Agregar'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    )}
                  </div>
                </>
              );
            })()}

            <div className="pt-2 flex justify-end border-t border-amber-200">
              <button
                type="button"
                onClick={() => setModalModerarGrupoOpen(false)}
                className="pill-btn px-5 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DESIGNAR NUEVO ADMINISTRADOR OFICIAL */}
      {modalDesignarAdminOpen && (
        <div className="fixed inset-0 bg-black/70 z-[75] flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-md rounded-3xl border-2 border-purple-300 p-6 space-y-4 shadow-2xl text-club-brown animate-in fade-in zoom-in-95 max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="flex items-center gap-3 border-b border-purple-200 pb-3">
              <div className="w-11 h-11 rounded-full bg-purple-100 text-purple-900 flex items-center justify-center text-xl flex-shrink-0">
                <i className="fa-solid fa-crown text-amber-500" />
              </div>
              <div className="min-w-0">
                <span className="text-sm font-black bg-purple-100 text-purple-900 px-2.5 py-0.5 rounded-full uppercase inline-block">
                  Gestión de Autoridades
                </span>
                <h3 className="font-brand text-xl font-bold text-purple-950 mt-0.5 break-words">
                  Designar Administrador Oficial
                </h3>
              </div>
            </div>

            <p className="text-base text-stone-700 leading-relaxed bg-white p-3.5 rounded-xl border border-purple-100">
              Ingresá el nombre de usuario o correo electrónico de la cuenta existente que deseás nombrar como <strong>Administrador oficial</strong> de CLUB65. Dejará su rol anterior y tendrá acceso exclusivo y completo a la supervisión comunitaria, validación institucional, revisión de propuestas y centro de resoluciones.
            </p>

            <div className="space-y-1.5 text-base">
              <label className="block font-bold text-club-brown">
                Nombre de usuario o correo electrónico:
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-3 text-stone-400">
                  <i className="fa-solid fa-user-shield" />
                </span>
                <input
                  type="text"
                  value={inputPromoverAdmin}
                  disabled={isPromotingAdmin}
                  onChange={(e) => {
                    setInputPromoverAdmin(e.target.value);
                    if (promoteAdminError) setPromoteAdminError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputPromoverAdmin.trim() && !isPromotingAdmin) {
                      e.preventDefault();
                      handlePromoteToAdmin();
                    }
                  }}
                  placeholder="ej: nombre_usuario o correo@ejemplo.com"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-purple-200 rounded-xl outline-none text-base focus:ring-2 focus:ring-purple-600 font-bold disabled:opacity-60"
                />
              </div>
              {promoteAdminError && (
                <p className="text-sm font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mt-2">
                  {promoteAdminError}
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-purple-200">
              <button
                type="button"
                disabled={isPromotingAdmin}
                onClick={() => {
                  setModalDesignarAdminOpen(false);
                  setInputPromoverAdmin('');
                  setPromoteAdminError('');
                }}
                className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handlePromoteToAdmin}
                disabled={!inputPromoverAdmin.trim() || isPromotingAdmin}
                className="pill-btn px-5 py-2 bg-purple-800 hover:bg-purple-900 disabled:opacity-50 text-white text-base font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <i className="fa-solid fa-crown text-amber-300" />
                <span>{isPromotingAdmin ? 'Designando...' : 'Confirmar designación'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: SOLICITAR CAMBIOS EN PROPUESTA */}
      {modalSolicitarCambiosAct && (
        <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-3 sm:p-4">
          <div className="bg-club-cream w-full max-w-md rounded-3xl border-2 border-amber-300 p-6 space-y-4 shadow-2xl text-club-brown max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="border-b border-amber-200 pb-2">
              <h3 className="font-brand text-xl font-bold text-club-brown">
                Solicitar Cambios en Propuesta
              </h3>
              <p className="text-base text-stone-600 mt-0.5 break-words">{modalSolicitarCambiosAct.title}</p>
            </div>

            <div className="space-y-1.5 text-base leading-relaxed">
              <label className="block font-bold text-club-brown">
                Escribí una nota para indicarle al vecino qué modificaciones debe realizar:
              </label>
              <textarea
                rows={4}
                value={solicitarCambiosNota}
                onChange={(e) => setSolicitarCambiosNota(e.target.value)}
                placeholder="Ej: Por favor aclará si se requiere llevar mate propio o si el salón cuenta con sillas suficientes..."
                className="w-full p-3 bg-white border border-amber-200 rounded-xl outline-none text-base leading-relaxed focus:ring-2 focus:ring-club-orange"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-amber-200">
              <button
                type="button"
                onClick={() => {
                  setModalSolicitarCambiosAct(null);
                  setSolicitarCambiosNota('');
                }}
                className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => handleAdminModerateProposal(modalSolicitarCambiosAct.id, 'request_changes', solicitarCambiosNota)}
                className="pill-btn px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-base font-bold shadow-xs cursor-pointer"
              >
                Solicitar cambios
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: VISOR DE FOTO SIMPLE (z-[200] para mostrarse siempre por delante de otros perfiles y modales) */}
      {modalVisorImgSrc && (
        <div
          className="fixed inset-0 bg-black/85 z-[200] flex items-center justify-center p-4 cursor-pointer"
          onClick={() => {
            setModalVisorImgSrc(null);
            setModalVisorImgShape('circle');
          }}
        >
          <div
            className="relative max-w-md w-full bg-[#1A110E] p-5 rounded-3xl border border-amber-500/30 flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {modalVisorImgShape === 'circle' ? (
              <div className="w-72 h-72 max-w-full aspect-square rounded-full overflow-hidden flex items-center justify-center">
                <img
                  src={modalVisorImgSrc}
                  alt="Visor"
                  className="w-full h-full object-cover scale-[1.03]"
                />
              </div>
            ) : (
              <div className="max-w-full max-h-[70vh] rounded-2xl overflow-hidden flex items-center justify-center">
                <img
                  src={modalVisorImgSrc}
                  alt="Visor"
                  className="max-w-full max-h-[70vh] object-contain rounded-2xl"
                />
              </div>
            )}
            <button
              onClick={() => {
                setModalVisorImgSrc(null);
                setModalVisorImgShape('circle');
              }}
              className="pill-btn px-5 py-2 bg-club-orange text-white text-base font-bold shadow cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* MODAL: AJUSTE Y RECORTE DE FOTO (Circular para perfiles/grupos, Rectangular 16:10 para cartelera) */}
      {imageCropperState && imageCropperState.isOpen && (
        <ImageCropperModal
          imageSrc={imageCropperState.rawSrc}
          title={imageCropperState.title}
          shape={imageCropperState.shape || (imageCropperState.target === 'activity' ? 'rectangle' : 'circle')}
          onCancel={() => setImageCropperState(null)}
          onApply={async (cropped) => {
            setImageCropperState(null);
            if (imageCropperState.target === 'profile') {
              showToast('Subiendo foto de perfil al servidor...');
              try {
                const cleanUser = currentUser?.usuario || currentUser?.id || 'usuario';
                const publicUrl = await uploadDataUrlToStorage(cropped, 'avatars', `${cleanUser}_perfil.jpg`, 'perfiles');
                setProfileForm(p => ({ ...p, avatar: publicUrl }));
                const u = await api.updateProfile({ avatar: publicUrl });
                setCurrentUser(u);
                await refreshData();
                showToast('¡Foto de perfil guardada con éxito!');
              } catch (err: any) {
                console.error('Error al subir foto de perfil:', err);
                showToast(err?.message || 'Error al subir la foto de perfil.');
              }
            } else if (imageCropperState.target === 'group') {
              showToast('Subiendo foto del grupo al servidor...');
              try {
                const publicUrl = await uploadDataUrlToStorage(cropped, 'chats-grupos', `grupo_${activeChatId || Date.now()}.jpg`, 'grupos');
                await handleChangeChatPhoto(publicUrl);
              } catch (err: any) {
                console.error('Error al subir foto del grupo:', err);
                showToast(err?.message || 'Error al subir foto del grupo.');
              }
            } else if (imageCropperState.target === 'newGroup' || (imageCropperState.target as any) === 'new_group') {
              showToast('Subiendo foto del grupo al servidor...');
              try {
                const publicUrl = await uploadDataUrlToStorage(cropped, 'chats-grupos', `nuevo_grupo_${Date.now()}.jpg`, 'grupos');
                setFotoNuevoGrupo(publicUrl);
                showToast('¡Foto del grupo ajustada y guardada con éxito!');
              } catch (err: any) {
                console.error('Error al subir foto del grupo:', err);
                showToast(err?.message || 'Error al subir foto del grupo.');
              }
            } else if (imageCropperState.target === 'activity') {
              setIsUploadingActivityImage(true);
              setEventoImgLabel('Subiendo foto...');
              showToast('Subiendo imagen de la actividad al servidor...');
              try {
                const publicUrl = await uploadDataUrlToStorage(cropped, 'actividades', `act_${Date.now()}.jpg`, 'cartelera');
                setEventoForm(prev => ({ ...prev, imagen: publicUrl }));
                setEventoImgLabel('Foto subida al servidor ✓');
                showToast('¡Foto de la actividad guardada con éxito!');
              } catch (err: any) {
                console.error('Error al subir imagen de actividad:', err);
                setEventoImgLabel('Error al subir foto (reintentar)');
                showToast(err?.message || 'Error al subir la imagen de la actividad.');
              } finally {
                setIsUploadingActivityImage(false);
              }
            }
          }}
        />
      )}

      {/* MODAL: EVALUACIÓN Y SANCIÓN DE REPORTES (CON LOS 9 MOTIVOS Y NOTIFICACIÓN AL DENUNCIANTE) */}
      {modalDecisionReporte && (
        <div className="fixed inset-0 bg-black/75 z-[90] flex items-center justify-center p-3 sm:p-4 animate-in fade-in">
          <div className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-rose-300 p-6 space-y-4 shadow-2xl text-club-brown max-h-[92dvh] overflow-y-auto min-w-0">
            <div className="border-b border-rose-200 pb-3 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-black bg-rose-200 text-rose-900 px-3 py-0.5 rounded-full uppercase tracking-wider inline-block">
                  Resolución de Seguridad
                </span>
                <h3 className="font-brand text-xl font-bold text-club-brown mt-1 break-words">
                  Resolución de Reporte y Aplicación de Sanción
                </h3>
              </div>
              <button
                onClick={() => setModalDecisionReporte(null)}
                className="text-stone-400 hover:text-stone-700 text-2xl font-bold cursor-pointer shrink-0 p-1"
              >
                &times;
              </button>
            </div>

            <div className="bg-rose-50/60 p-4 rounded-2xl border border-rose-200 text-base space-y-1.5 leading-relaxed">
              <p className="font-bold text-stone-800 break-words">
                Denunciado:{' '}
                <button
                  type="button"
                  onClick={() => {
                    if (modalDecisionReporte.report.reportedUser) {
                      openUserProfileByName(modalDecisionReporte.report.reportedUser);
                    }
                  }}
                  className="text-rose-700 font-extrabold hover:underline cursor-pointer"
                >
                  @{modalDecisionReporte.report.reportedUser || 'usuario'}
                </button>
              </p>
              <p className="text-stone-700 break-words">
                <strong>Motivo denunciado:</strong> {modalDecisionReporte.report.reason}
              </p>
              {modalDecisionReporte.report.messageText && (
                <p className="text-stone-700 italic bg-white p-2.5 rounded-lg border border-rose-100 break-words">
                  "{modalDecisionReporte.report.messageText}"
                </p>
              )}
            </div>

            <div className="space-y-3 text-base leading-relaxed">
              <div>
                <label className="block font-bold text-club-brown mb-1.5">Decisión a tomar:</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'sancionar', label: 'Sancionar usuario', icon: 'fa-gavel' },
                    { id: 'eliminar', label: 'Retirar contenido', icon: 'fa-trash-can' },
                    { id: 'desestimar', label: 'Desestimar', icon: 'fa-xmark' }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setModalDecisionReporte(prev => prev ? ({ ...prev, actionType: opt.id as any }) : null)}
                      className={`p-3 rounded-xl border text-center font-bold flex flex-col items-center gap-1 cursor-pointer transition text-base ${
                        modalDecisionReporte.actionType === opt.id
                          ? 'bg-rose-700 border-rose-800 text-white shadow-xs'
                          : 'bg-white border-amber-200 text-stone-700 hover:bg-amber-50'
                      }`}
                    >
                      <i className={`fa-solid ${opt.icon} text-base`} />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {modalDecisionReporte.actionType === 'sancionar' && (
                <>
                  <div>
                    <label className="block font-bold text-club-brown mb-1">
                      Motivo de la sanción (coincidente con los 9 motivos del reporte):
                    </label>
                    <select
                      value={modalDecisionReporte.motive}
                      onChange={(e) => setModalDecisionReporte(prev => prev ? ({ ...prev, motive: e.target.value }) : null)}
                      className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl font-bold text-base outline-none focus:ring-2 focus:ring-rose-500"
                    >
                      {MOTIVOS_REPORTE.map((m, idx) => (
                        <option key={idx} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-club-brown mb-1">Tipo de sanción:</label>
                    <div className="space-y-2 bg-white p-3.5 rounded-2xl border border-amber-200">
                      {[
                        { id: 'temporal_7', label: 'Suspensión temporal (7 días)' },
                        { id: 'temporal_30', label: 'Suspensión temporal (30 días)' },
                        { id: 'permanente', label: 'Vetado de forma permanente' }
                      ].map(item => (
                        <label key={item.id} className="flex items-center gap-2.5 cursor-pointer font-bold">
                          <input
                            type="radio"
                            name="sanction_type"
                            value={item.id}
                            checked={modalDecisionReporte.sanctionType === item.id}
                            onChange={() => setModalDecisionReporte(prev => prev ? ({ ...prev, sanctionType: item.id as any }) : null)}
                            className="w-4 h-4 shrink-0"
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-200 bg-white cursor-pointer font-bold">
                    <input
                      type="checkbox"
                      checked={modalDecisionReporte.alsoDelete}
                      onChange={(e) => setModalDecisionReporte(prev => prev ? ({ ...prev, alsoDelete: e.target.checked }) : null)}
                      className="w-4 h-4 mt-1 shrink-0"
                    />
                    <span>Retirar también el contenido reportado de la vista pública</span>
                  </label>
                </>
              )}

              <div>
                <label className="block font-bold text-club-brown mb-1">
                  Comentario o motivo concreto (se incluirá en el registro y en la notificación):
                </label>
                <textarea
                  rows={3}
                  value={modalDecisionReporte.comment}
                  onChange={(e) => setModalDecisionReporte(prev => prev ? ({ ...prev, comment: e.target.value }) : null)}
                  placeholder="Aclaración adicional de la administración sobre la sanción aplicada..."
                  className="w-full p-3 bg-white border border-amber-200 rounded-xl outline-none text-base leading-relaxed focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-rose-200">
              <button
                type="button"
                onClick={() => setModalDecisionReporte(null)}
                className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmReportDecision}
                disabled={isResolvingReport}
                className="pill-btn px-5 py-2 bg-rose-700 hover:bg-rose-800 disabled:opacity-60 text-white text-base font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <i className="fa-solid fa-check" /> {isResolvingReport ? 'Procesando...' : 'Confirmar resolución'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AVISO ALTA INSTITUCIONAL EN ESPERA DE VERIFICACIÓN */}
      {modalInstPendingNotice && (
        <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4">
          <div className="bg-club-cream w-full max-w-md rounded-3xl border-2 border-blue-300 p-6 space-y-4 shadow-2xl text-club-brown animate-in fade-in zoom-in-95 max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="flex items-center gap-3 text-blue-900 border-b border-blue-100 pb-3">
              <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-800 flex items-center justify-center text-xl flex-shrink-0 shadow-inner">
                <i className="fa-solid fa-hourglass-half text-club-orange" />
              </div>
              <div className="min-w-0">
                <span className="text-sm font-black bg-blue-100 text-blue-900 px-2.5 py-0.5 rounded-full uppercase inline-block">
                  Registro Institucional Recibido
                </span>
                <h4 className="font-brand text-xl font-bold text-club-brown mt-0.5">Cuenta en Proceso de Alta</h4>
              </div>
            </div>

            <div className="p-4 bg-white rounded-2xl border border-blue-200 text-base space-y-3 leading-relaxed">
              <p className="font-bold text-club-brown text-lg break-words">
                ¡Gracias por registrar a <strong>{modalInstPendingNotice.apodo}</strong>!
              </p>
              <p className="text-stone-700 leading-relaxed">
                ¡Tu solicitud de registro fue enviada correctamente! El equipo de Club65 evaluará la información proporcionada y te notificará la decisión por correo electrónico a la dirección que ingresaste durante el registro. Una vez evaluada tu solicitud, recibirás un mensaje informándote si tu institución fue dada de alta o si fue rechazada.
              </p>
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-blue-950 flex items-start gap-2.5">
                <i className="fa-solid fa-envelope text-blue-600 text-base mt-1 flex-shrink-0" />
                <span className="leading-relaxed break-words min-w-0">
                  Dirección de correo registrada para recibir la notificación: <strong>{modalInstPendingNotice.email}</strong>
                </span>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-amber-200">
              <button
                type="button"
                onClick={() => setModalInstPendingNotice(null)}
                className="pill-btn px-6 py-2.5 bg-club-orange hover:bg-club-orange-dark text-white text-base font-bold shadow-sm cursor-pointer"
              >
                Entendido, muchas gracias
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ESTADO Y CONFIGURACIÓN DE BASE DE DATOS SUPABASE */}
      {modalSupabaseOpen && (
        <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4">
          <div className="bg-club-cream w-full max-w-xl rounded-3xl border-2 border-emerald-300 p-6 space-y-4 shadow-2xl text-club-brown animate-in fade-in zoom-in-95 max-h-[90dvh] overflow-y-auto min-w-0">
            <div className="flex items-start justify-between gap-2 border-b border-emerald-200 pb-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center text-2xl flex-shrink-0 shadow-inner">
                  <i className="fa-solid fa-database text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <span className="text-sm font-black bg-emerald-100 text-emerald-900 px-2.5 py-0.5 rounded-full uppercase tracking-wider inline-block">
                    Sistema operativo
                  </span>
                  <h4 className="font-brand text-xl font-bold text-club-brown mt-0.5">Estado del Sistema</h4>
                </div>
              </div>
            </div>

            <div className="space-y-3 text-base leading-relaxed">
              <div className="p-4 bg-white rounded-2xl border border-emerald-200 space-y-2.5">
                <div className="flex flex-wrap justify-between items-center gap-2 py-1 border-b border-stone-100">
                  <span className="text-stone-600 font-bold">Proyecto ID:</span>
                  <span className="font-mono bg-stone-100 text-stone-800 px-2.5 py-0.5 rounded-lg font-bold text-sm break-all">
                    {SUPABASE_PROJECT_ID}
                  </span>
                </div>
                <div className="flex flex-wrap justify-between items-center gap-2 py-1 border-b border-stone-100">
                  <span className="text-stone-600 font-bold">URL del servidor:</span>
                  <span className="font-mono text-emerald-800 font-bold text-sm break-all max-w-full">
                    {SUPABASE_URL}
                  </span>
                </div>
                <div className="flex flex-wrap justify-between items-center gap-2 py-1 border-b border-stone-100">
                  <span className="text-stone-600 font-bold">Conexión del servicio:</span>
                  <span className="text-emerald-700 font-bold flex items-center gap-1.5">
                    <i className="fa-solid fa-circle-check text-emerald-600" /> Configurado y en línea
                  </span>
                </div>
                <div className="flex flex-wrap justify-between items-center gap-2 py-1">
                  <span className="text-stone-600 font-bold">Estado general:</span>
                  <span className={`font-bold flex items-center gap-1.5 ${supabaseHealthState?.tablesReady ? 'text-emerald-700' : 'text-amber-800'}`}>
                    <i className={`fa-solid ${supabaseHealthState?.tablesReady ? 'fa-circle-check text-emerald-600' : 'fa-triangle-exclamation text-amber-500'}`} />
                    {supabaseHealthState?.tablesReady ? 'Sistema operativo' : 'Conectado (sincronización pendiente)'}
                  </span>
                </div>
              </div>

              {!supabaseHealthState?.tablesReady && (
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-950 space-y-2 leading-relaxed">
                  <p className="font-bold flex items-center gap-1.5 text-amber-900">
                    <i className="fa-solid fa-circle-info text-club-orange" />
                    ¿Cómo verificar la sincronización del sistema?
                  </p>
                  <p className="text-base text-stone-700 leading-relaxed">
                    Usá el botón inferior para comprobar la conexión con el servidor y sincronizar los datos.
                  </p>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    setIsSyncingSupabase(true);
                    try {
                      const res = await fetch('/api/supabase/sync', { method: 'POST' });
                      const parsed = await safeParseJson<any>(res);
                      const data = parsed.isJson && parsed.data ? parsed.data : {};
                      const status = await checkSupabaseStatus();
                      setSupabaseHealthState(status);
                      if (data.success || status.tablesReady) {
                        await refreshData();
                        showToast('¡Datos iniciales sincronizados con el sistema!');
                      } else {
                        showToast('Sincronización pendiente en el servidor.');
                      }
                    } catch {
                      showToast('Error al intentar sincronizar con el servidor.');
                    } finally {
                      setIsSyncingSupabase(false);
                    }
                  }}
                  disabled={isSyncingSupabase}
                  className="pill-btn flex-1 py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-base shadow-xs cursor-pointer flex items-center justify-center gap-2"
                >
                  <i className={`fa-solid ${isSyncingSupabase ? 'fa-spinner fa-spin' : 'fa-arrows-rotate'}`} />
                  {isSyncingSupabase ? 'Verificando y sincronizando...' : 'Comprobar y sincronizar datos'}
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-emerald-200">
              <button
                type="button"
                onClick={() => setModalSupabaseOpen(false)}
                className="pill-btn px-6 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 text-base font-bold cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RECHAZAR ALTA INSTITUCIONAL CON MOTIVO OBLIGATORIO */}
      {modalRechazoInstitucion && (
        <div className="fixed inset-0 bg-black/70 z-[75] flex items-center justify-center p-3 sm:p-4">
          <form
            onSubmit={handleConfirmarRechazoInstitucion}
            className="bg-club-cream w-full max-w-lg rounded-3xl border-2 border-rose-300 p-6 space-y-4 shadow-2xl text-club-brown max-h-[92dvh] overflow-y-auto min-w-0"
          >
            <div className="flex justify-between items-start gap-2 border-b border-rose-200 pb-3">
              <div className="min-w-0">
                <span className="text-sm font-bold bg-rose-100 text-rose-800 px-3 py-0.5 rounded-full uppercase tracking-wider inline-block">
                  Validación Institucional
                </span>
                <h3 className="font-brand text-xl font-bold text-club-brown mt-1">
                  Rechazar Alta Institucional
                </h3>
                <p className="text-base text-stone-600 mt-0.5 break-words">
                  Institución: <strong>{modalRechazoInstitucion.apodo || modalRechazoInstitucion.usuario}</strong>
                  {modalRechazoInstitucion.email ? ` • ${modalRechazoInstitucion.email}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setModalRechazoInstitucion(null);
                  setMotivoRechazoInstitucion('');
                  setDetalleRechazoInstitucion('');
                  setRechazoInstitucionError('');
                }}
                className="text-2xl text-stone-400 hover:text-stone-700 font-bold leading-none cursor-pointer p-1 shrink-0"
                aria-label="Cerrar modal"
              >
                &times;
              </button>
            </div>

            {rechazoInstitucionError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-base rounded-xl font-semibold flex items-center gap-2">
                <i className="fa-solid fa-circle-exclamation flex-shrink-0" />
                <span className="break-words">{rechazoInstitucionError}</span>
              </div>
            )}

            <div className="space-y-2 text-base leading-relaxed">
              <label className="block font-bold text-club-brown">
                Seleccioná el motivo del rechazo (obligatorio): *
              </label>
              <div className="space-y-1.5">
                {MOTIVOS_RECHAZO_INSTITUCION.map((causa) => {
                  const isSelected = motivoRechazoInstitucion === causa;
                  return (
                    <label
                      key={causa}
                      className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition ${
                        isSelected
                          ? 'bg-rose-50 border-rose-400 text-rose-950 font-semibold shadow-2xs'
                          : 'bg-white border-amber-200 hover:border-rose-300 text-stone-700'
                      }`}
                    >
                      <input
                        type="radio"
                        name="motivoRechazoInstitucion"
                        value={causa}
                        checked={isSelected}
                        onChange={() => {
                          setMotivoRechazoInstitucion(causa);
                          if (rechazoInstitucionError) setRechazoInstitucionError('');
                        }}
                        className="mt-1 w-4 h-4 accent-rose-600 flex-shrink-0"
                      />
                      <span className="text-base leading-relaxed break-words min-w-0">{causa}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1 text-base">
              <label htmlFor="detalle-rechazo-inst" className="block font-bold text-club-brown">
                Aclaración adicional para la institución (opcional):
              </label>
              <textarea
                id="detalle-rechazo-inst"
                rows={2}
                value={detalleRechazoInstitucion}
                onChange={(e) => setDetalleRechazoInstitucion(e.target.value)}
                placeholder="Ej: La constancia de CUIT adjuntada corresponde a otro período o se ve borrosa..."
                className="w-full p-3 bg-white border border-amber-200 rounded-xl outline-none text-base leading-relaxed focus:ring-2 focus:ring-rose-400"
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-rose-200">
              <button
                type="button"
                disabled={rechazoInstitucionLoading}
                onClick={() => {
                  setModalRechazoInstitucion(null);
                  setMotivoRechazoInstitucion('');
                  setDetalleRechazoInstitucion('');
                  setRechazoInstitucionError('');
                }}
                className="pill-btn px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 text-base font-bold cursor-pointer disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={rechazoInstitucionLoading || !motivoRechazoInstitucion}
                className="pill-btn px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-base font-bold shadow-xs cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {rechazoInstitucionLoading ? (
                  <>
                    <i className="fa-solid fa-spinner fa-spin" /> Rechazando...
                  </>
                ) : (
                  <>
                    <i className="fa-solid fa-xmark" /> Confirmar rechazo y enviar aviso
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* IN-APP TOAST NOTIFICATION */}
      {toastMessage && (
        <div className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:bottom-6 sm:right-6 z-[100] bg-stone-900/95 text-white px-4 sm:px-5 py-3.5 rounded-2xl shadow-2xl border border-club-orange/40 text-base font-semibold flex flex-wrap items-center gap-2.5 sm:gap-3 animate-in fade-in slide-in-from-bottom-2 max-w-full sm:max-w-md">
          <i className={`fa-solid ${toastChatTargetId ? 'fa-comments text-club-orange text-lg shrink-0' : 'fa-circle-check text-club-orange text-lg shrink-0'}`} />
          <span className="flex-1 min-w-0 break-words leading-snug">{toastMessage}</span>
          {toastChatTargetId && (
            <button
              type="button"
              onClick={() => {
                setActiveChatId(toastChatTargetId);
                setCurrentView('chat');
                setToastMessage(null);
                setToastChatTargetId(null);
              }}
              className="px-3 py-1 bg-club-orange hover:bg-club-orange-dark text-white rounded-lg text-base font-bold shrink-0 cursor-pointer shadow-xs"
            >
              Ver
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setToastMessage(null);
              setToastChatTargetId(null);
            }}
            className="ml-1 text-stone-400 hover:text-white text-xl cursor-pointer leading-none shrink-0"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}