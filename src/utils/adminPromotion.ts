import { formatArgentinaDateTime } from './argentinaTime.ts';

export const ADMIN_OFFICIAL_BIO =
  'Administrador Oficial de CLUB65. Equipo de gestión y seguridad comunitaria.';

export function normalizeAdminPromotionIdentifier(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^@+/, '')
    .trim();
}

export function isEliminatedUserRow(row: any): boolean {
  if (!row) return true;
  const estado = String(row.estado_alta || row.estadoAlta || '')
    .trim()
    .toLowerCase();
  return estado === 'eliminado';
}

export function isOfficialAdminRow(row: any): boolean {
  if (!row) return false;
  const candidates = [row.tipo, row.rol]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());
  return candidates.some(
    (c) => c === 'moderador' || c === 'admin' || c === 'administrador'
  );
}

export function findPromotableUserCandidate<T extends Record<string, any>>(
  rows: T[],
  rawIdentifier: string
): T | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const clean = normalizeAdminPromotionIdentifier(rawIdentifier).toLowerCase();
  if (!clean) return null;

  const activeRows = rows.filter((r) => r && !isEliminatedUserRow(r));
  if (activeRows.length === 0) return null;

  // 1. Exact email match
  const byEmail = activeRows.find(
    (r) => String(r.email || '').trim().toLowerCase() === clean
  );
  if (byEmail) return byEmail;

  // 2. Exact username (usuario) match
  const byUsuario = activeRows.find(
    (r) =>
      String(r.usuario || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '') === clean
  );
  if (byUsuario) return byUsuario;

  // 3. Exact ID match
  const byId = activeRows.find(
    (r) => String(r.id || '').trim().toLowerCase() === clean
  );
  if (byId) return byId;

  // 4. Fallback exact apodo match
  const byApodo = activeRows.find(
    (r) => String(r.apodo || '').trim().toLowerCase() === clean
  );
  return byApodo || null;
}

export function buildSupabaseAdminPromotionPayload(
  existingRow: Record<string, any>,
  promotedBy?: { usuario?: string; apodo?: string }
): Record<string, any> {
  const existingNotifs = Array.isArray(existingRow?.notifications)
    ? existingRow.notifications
    : [];
  const alreadyAdmin = isOfficialAdminRow(existingRow);
  const promoterTag = normalizeAdminPromotionIdentifier(
    promotedBy?.usuario || promotedBy?.apodo || ''
  );

  const nextNotifs = alreadyAdmin
    ? existingNotifs
    : [
        {
          id: `admin_promoted_${Date.now()}`,
          type: 'admin_promotion',
          text: promoterTag
            ? `¡Has sido designado como Administrador Oficial de CLUB65 por @${promoterTag} con acceso total al Panel de Control!`
            : '¡Has sido designado como Administrador Oficial de CLUB65 con acceso total al Panel de Control!',
          time: formatArgentinaDateTime(new Date()),
          read: false,
          createdAt: new Date().toISOString()
        },
        ...existingNotifs
      ];

  return {
    tipo: 'moderador',
    rol: 'moderador',
    is_verified: true,
    estado_alta: 'aprobada',
    bio: ADMIN_OFFICIAL_BIO,
    entidad_tipo: null,
    cuit: null,
    legal_representative: null,
    contacto_institucional: null,
    documento_cuit_url: null,
    documento_personeria_url: null,
    contacto_emergencia: null,
    notifications: nextNotifs
  };
}

export function applyAdminPromotionToLocalUser<T extends Record<string, any>>(
  user: T
): T {
  const next: any = {
    ...user,
    tipo: 'moderador',
    rol: 'moderador',
    isVerified: true,
    estadoAlta: 'aprobada',
    estado_alta: 'aprobada',
    esInstitucion: false,
    bio: ADMIN_OFFICIAL_BIO
  };

  delete next.entidadTipo;
  delete next.cuit;
  delete next.legalRepresentative;
  delete next.responsableLegal;
  delete next.presidenteFuncionario;
  delete next.managerNombre;
  delete next.managerRol;
  delete next.gestorNombre;
  delete next.gestorRol;
  delete next.contactoInstitucional;
  delete next.contacto_institucional;
  delete next.documento_cuit_url;
  delete next.documentoCuitUrl;
  delete next.documento_personeria_url;
  delete next.documentoPersoneriaUrl;
  delete next.constanciaCuitUrl;
  delete next.constanciaCuitNombre;
  delete next.personeriaDocUrl;
  delete next.personeriaDocNombre;
  delete next.altaPor;
  delete next.altaPorUsuario;
  delete next.altaPorApodo;
  delete next.fechaAlta;
  delete next.contactoEmergencia;
  delete next.institucion;
  delete next.direccionFisica;
  delete next.sitioWebRedSocial;

  return next as T;
}

export function canViewerBlockOrPrivateChat(viewer: any): boolean {
  if (!viewer) return false;
  return !isOfficialAdminRow(viewer);
}

