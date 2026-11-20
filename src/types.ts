export interface UserNotification {
  id: string;
  text: string;
  time: string;
  read: boolean;
}

export interface SanctionRecord {
  id: string;
  username: string;
  reason: string; // One of the 9 motives
  motivo?: string;
  comment?: string;
  adminUsername: string;
  date: string;
  type: 'temporal_7' | 'temporal_30' | 'permanente';
  tipo?: string;
  liftDate?: string;
  expiresAt?: number | string;
  reportId?: string;
}

export interface User {
  id: string;
  usuario: string;
  clave: string;
  apodo: string;
  avatar?: string;
  bio: string;
  textSize: 'normal' | 'grande' | 'gigante';
  contrast: boolean;
  tipo: 'personal' | 'institucional' | 'moderador';
  rol?: 'personal' | 'institucional' | 'moderador' | string;
  nombre?: string;
  nombreCompleto?: string;
  username?: string;
  name?: string;
  contactoEmergencia?: string;
  supabaseId?: string;
  previousTokens?: string[];
  esInstitucion?: boolean;
  localidad?: string;
  email?: string;
  isVerified?: boolean;
  cuit?: string;
  legalRepresentative?: string;
  responsableLegal?: string;
  documentoAdjunto?: string;
  documentoLegal?: string;
  documentoDescargaUrl?: string;
  contacto_institucional?: string;
  contactoInstitucional?: string;
  documento_cuit_url?: string;
  documentoCuitUrl?: string;
  documento_personeria_url?: string;
  documentoPersoneriaUrl?: string;
  entidadTipo?: string;
  institucion?: string;
  direccionFisica?: string;
  sitioWebRedSocial?: string;
  presidenteFuncionario?: string;
  managerNombre?: string;
  managerRol?: string;
  gestorNombre?: string;
  gestorRol?: string;
  altaPor?: string;
  altaPorUsuario?: string;
  altaPorApodo?: string;
  fechaAlta?: string;
  constanciaCuitUrl?: string;
  constanciaCuitNombre?: string;
  personeriaDocUrl?: string;
  personeriaDocNombre?: string;
  agenda?: number[];
  estado_alta?: 'pendiente' | 'aprobada' | 'rechazada' | string;
  estadoAlta?: 'pendiente' | 'aprobada' | 'rechazada';
  isSuspended?: boolean;
  blockedUsers?: string[];
  blockedByUsers?: string[];
  myBlockedUsers?: string[];
  notifications?: UserNotification[];
  createdAt?: string;
}

export type TipoEntidadInstitucional =
  | 'Asociación Civil / Club Social'
  | 'Centro de Jubilados'
  | 'Centro Cultural'
  | 'Municipio / Ente Estatal'
  | 'Fundación'
  | 'Otro';

export interface FileUploadInfo {
  name: string;
  size: number;
  type: string;
  dataUrl?: string;
  file?: File;
}

export interface InstitutionalRegistrationData {
  entidadTipo: TipoEntidadInstitucional | string;
  cuit: string;
  contactoInstitucional: string;
  direccionFisica: string;
  localidad: string;
  sitioWebRedSocial?: string;
  presidenteFuncionario: string;
  managerNombre?: string;
  managerRol?: string;
  gestorNombre?: string;
  gestorRol?: string;
  documento_cuit_url?: string;
  documento_personeria_url?: string;
  constanciaCuitFile?: FileUploadInfo | null;
  personeriaDocFile?: FileUploadInfo | null;
}

export interface ActivityVersion {
  version: number;
  date: string;
  title: string;
  schedule: string;
  location: string;
  lat?: number;
  lng?: number;
  capacity: number;
  description: string;
  shortDescription?: string;
  image?: string;
  videoUrl?: string;
  video_url?: string;
  note?: string;
  moderationNote?: string;
  moderationDate?: string;
  moderationAdmin?: string;
  isRecurrent?: boolean;
  frequency?: string;
  frecuencia?: string;
  diasSemana?: string[];
  diaMes?: number;
  cantidadEventos?: number;
  cerrarInscripcionAlIniciarPrimerEncuentro?: boolean;
  firstEncounterDate?: string;
  firstEncounterStartTime?: string;
  firstEncounterEndTime?: string;
}

export interface Activity {
  id: number;
  title: string;
  nombre?: string;
  category: 'salud' | 'cultura' | 'social' | 'musica' | 'tecnologia' | 'memoria' | 'naturaleza' | string;
  categoria?: string;
  schedule: string;
  horario?: string;
  location: string;
  direccion?: string;
  ubicacion?: string;
  fechaRealizacion?: string;
  firstMeetingDate?: string;
  fechaPrimerEncuentro?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  fechaIni?: string;
  horaIni?: string;
  fechaFin?: string;
  horaFin?: string;
  fecha_inicio?: string;
  hora_inicio?: string;
  fecha_fin?: string;
  hora_fin?: string;
  createdBy?: string;
  userId?: string;
  createdById?: string;
  lat: number;
  lng: number;
  organizer: string;
  organizerBio: string;
  organizerId: string;
  isInstitutional: boolean;
  isRecurrent: boolean;
  is_recurrent?: boolean;
  frequency?: string;
  frecuencia?: string;
  diasSemana?: string[];
  dias_semana?: string[];
  diaMes?: number;
  dia_mes?: number;
  cantidadEventos?: number;
  cantidad_eventos?: number;
  totalEncuentros?: number;
  cerrarInscripcionAlIniciarPrimerEncuentro?: boolean;
  firstEncounterDate?: string;
  firstEncounterStartTime?: string;
  firstEncounterEndTime?: string;
  firstEncounterEndTimestamp?: number;
  enrolled: boolean;
  capacity: number;
  enrolledCount: number;
  shortDescription?: string;
  description: string;
  descripcion?: string;
  image?: string;
  foto?: string;
  videoUrl?: string;
  video_url?: string;
  organizerName?: string;
  organizerLocation?: string;
  isApproved: boolean;
  proposalStatus?: 'aprobada' | 'pendiente' | 'cambios_solicitados' | 'rechazada' | 'baja_forzada' | 'cancelada_organizador';
  estado?: string;
  baja_forzada?: boolean;
  fecha_baja?: string | null;
  motivo_baja?: string;
  feedback_admin?: string;
  admin_baja_id?: string;
  bajaDate?: string;
  bajaTimestamp?: number;
  bajaReason?: string;
  bajaAdmin?: string;
  canceladaPorOrganizador?: boolean;
  cancelDate?: string;
  proposalNote?: string;
  feedback?: string;
  changesRequestedByAdmin?: string;
  userFeedbackNote?: string;
  proposedAt?: string;
  proposedTimestamp?: number;
  changesRequestedAt?: string;
  changesRequestedTimestamp?: number;
  approvedAt?: string;
  approvedTimestamp?: number;
  rejectedAt?: string;
  rejectedTimestamp?: number;
  rejectionReason?: string;
  changesSubmittedAt?: string;
  changesSubmittedTimestamp?: number;
  versions?: ActivityVersion[];
  vettedUsers: string[];
  enrolledUsernames: string[];
  inscriptos?: any[];
}

export interface CancelledGroupNotice {
  id: string;
  activityId: number | string;
  activityTitle: string;
  message: string;
  date: string;
  participants: string[];
}

export interface BajaRecord {
  id: string;
  activityId: number;
  title: string;
  activityTitle?: string;
  organizer: string;
  date: string;
  reason: string;
  adminUsername: string;
}

export interface ChatMessage {
  id?: string;
  chatId?: string;
  chat_id?: string;
  senderId: string;
  sender: string;
  avatar: string;
  role: string;
  text: string;
  time: string;
  isOrganizer?: boolean;
  isVerifiedInst?: boolean;
  isAdminUser?: boolean;
  isDeleted?: boolean;
  deletedByAdmin?: boolean;
  deletedByGroupModerator?: boolean;
  retirado?: boolean;
  eliminado?: boolean;
  replyTo?: {
    id: string;
    sender: string;
    text: string;
  };
  isPinned?: boolean;
  isSystem?: boolean;
  createdAt?: string;
  timestamp?: number;
}

export interface Chat {
  id: number | string;
  title: string;
  name?: string;
  subtitle: string;
  type: 'grupal' | 'privado';
  activityId?: number | null;
  actividad_id?: string;
  destinatario?: string;
  senderId?: string;
  recipientId?: string;
  organizerId?: string;
  organizer?: string;
  creatorId?: string;
  creatorName?: string;
  createdBy?: string;
  adminUsernames?: string[];
  avatar?: string;
  image?: string;
  allowedRoles?: string[];
  participants?: string[];
  participantIds?: string[];
  moderators?: string[];
  moderadores?: string[];
  removedParticipants?: string[];
  vetoedParticipants?: string[];
  leftVoluntarilyParticipants?: string[];
  participantsSnapshotOnRemoval?: Record<string, string[]>;
  leftVoluntarily?: boolean;
  removedByUser?: boolean;
  vetoedByUser?: boolean;
  removedAtForUser?: number;
  leftAtForUser?: number;
  deletedForUserIds?: string[];
  pinnedMessageId?: string;
  created_at?: string;
  createdAt?: string;
  lastMessage?: string;
  lastMessageTime?: string | number;
  updatedAt?: number | string;
  updated_at?: number | string;
  messages: ChatMessage[];
}

export interface Review {
  id: number | string;
  actividadId: number | string;
  actividad: string;
  autor: string;
  estrellas: number;
  fecha: string;
  texto: string;
  foto?: string | null;
  media?: string[];
  usuarioId?: string;
  userId?: string;
  userApodo?: string;
  autorId?: string;
  organizer?: string;
  organizerId?: string;
  avatar?: string | null;
  retiradoDeLaVista?: boolean;
  retirado_de_la_vista?: boolean;
  deletedByAdmin?: boolean;
}

export interface Contact {
  id: string;
  userId?: string;
  nombre: string;
  detalle: string;
  avatar: string;
  avatarClass: string;
  bio: string;
  foto?: string | null;
  tipo?: string;
  rol?: string;
}

export interface PasswordResetRequest {
  id: string;
  email: string;
  username: string;
  code: string;
  token: string;
  expiresAt: number;
  verified: boolean;
  createdAt: string;
}

export interface SimulatedEmail {
  id: string;
  to: string;
  subject: string;
  body: string;
  date: string;
}

export interface SecurityReport {
  id: string;
  type: 'chat_message' | 'review_media' | 'review_text' | 'chat_general';
  chatId?: number | string;
  conversacionId?: number | string;
  messageId?: string;
  mensajeId?: string;
  targetId?: string;
  messageText?: string;
  content?: string;
  mensaje?: string;
  texto?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  reviewId?: number | string;
  activityId?: number | string;
  actividadId?: number | string;
  reportedUser?: string;
  usuarioReportado?: string;
  reporterUser: string;
  reporterUsername?: string;
  reporterEmail?: string;
  reason: string;
  comment?: string;
  timestamp: string;
  createdAt?: string;
  status: 'pendiente' | 'resuelto' | 'desestimado' | 'pending' | 'resolved';
  resolutionNote?: string;
  resolutionAction?: string;
  resolutionDecision?: string;
  sanctionReason?: string;
  sanctionType?: 'temporal_7' | 'temporal_30' | 'permanente';
  alsoDeletedContent?: boolean;
  resolutionDetail?: string;
  adminComment?: string;
  resolvedBy?: string;
  resolvedAt?: string;
}
