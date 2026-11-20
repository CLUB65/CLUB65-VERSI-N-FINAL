import emailjs from '@emailjs/browser';

export const EMAILJS_SERVICE_ID = 'service_lrtiu38';
export const EMAILJS_TEMPLATE_ID_CODIGO = 'template_tvhl70r';
export const EMAILJS_TEMPLATE_ID_MULTIUSO = 'template_kl5co4n';
export const EMAILJS_PUBLIC_KEY = '-ZJsT5jGiOdFiffft';
export const EMAIL_ADMIN_CLUB65 = 'club65.info@gmail.com';

export const SOPORTE_ASUNTOS = [
  'Consulta general',
  'Soporte técnico',
  'Cuenta institucional',
  'Sugerencia',
] as const;

export const MOTIVOS_RECHAZO_INSTITUCION = [
  'Documentación de CUIT / inscripción ARCA ilegible, incompleta o vencida',
  'Falta de acreditación válida de personería jurídica o representación legal',
  'Los datos de la entidad no coinciden con los registros públicos o documentación adjunta',
  'No se pudo verificar el teléfono o correo de contacto institucional',
  'La entidad o actividad declarada no se ajusta al propósito comunitario de CLUB65',
  'Solicitud duplicada o cuenta institucional ya registrada previamente',
] as const;

if (typeof window !== 'undefined') {
  try {
    emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
  } catch {
    // Non-blocking initialization fallback; publicKey is also passed per send()
  }
}

export type EmailSenderFn = (
  serviceId: string,
  templateId: string,
  templateParams: Record<string, unknown>,
  options: { publicKey: string }
) => Promise<unknown>;

export function generateRecoveryCodeAndExpiry(nowMs: number = Date.now()): {
  codigo: string;
  codigoExpira: string;
} {
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  const codigoExpira = new Date(nowMs + 60 * 60 * 1000).toISOString();
  return { codigo, codigoExpira };
}

export function validateRecoveryCodeMatch(
  storedCode: string | null | undefined,
  storedExpiresAt: string | null | undefined,
  enteredCode: string,
  now: Date = new Date()
): { valid: boolean; reason?: 'missing' | 'mismatch' | 'expired'; error?: string } {
  const cleanStored = String(storedCode || '').trim();
  const cleanEntered = String(enteredCode || '').trim();

  if (!cleanStored) {
    return {
      valid: false,
      reason: 'missing',
      error: 'No hay un código de recuperación activo para esta cuenta. Solicitá uno nuevo.',
    };
  }

  if (cleanStored !== cleanEntered) {
    return {
      valid: false,
      reason: 'mismatch',
      error: 'El código ingresado es incorrecto. Revisá tu correo e intentá nuevamente.',
    };
  }

  if (!storedExpiresAt) {
    return {
      valid: false,
      reason: 'expired',
      error: 'El código venció. Por favor solicitá un nuevo código de recuperación.',
    };
  }

  const expiresDate = new Date(storedExpiresAt);
  if (Number.isNaN(expiresDate.getTime()) || !(now < expiresDate)) {
    return {
      valid: false,
      reason: 'expired',
      error: 'El código venció porque pasó más de 1 hora desde su envío. Solicitá uno nuevo con "Reenviar código".',
    };
  }

  return { valid: true };
}

export function buildSupportEmailParams(input: {
  senderName: string;
  senderEmail: string;
  subject: string;
  message: string;
}): Record<string, string> {
  const cleanSubject = input.subject.trim() || 'Consulta general';
  const cleanName = input.senderName.trim() || 'Invitado';
  const cleanEmail = input.senderEmail.trim();
  const cleanMessage = input.message.trim();

  return {
    to_email: EMAIL_ADMIN_CLUB65,
    to_name: 'Equipo CLUB65',
    asunto: `Soporte CLUB65: ${cleanSubject}`,
    cuerpo_mensaje: [
      `Usuario / Nombre: ${cleanName}`,
      `Correo de contacto: ${cleanEmail}`,
      `Asunto: ${cleanSubject}`,
      '',
      'Consulta:',
      cleanMessage,
    ].join('\n'),
  };
}

export function buildRecoveryCodeEmailParams(input: {
  toEmail: string;
  toName: string;
  codigo: string;
}): Record<string, string> {
  return {
    to_email: input.toEmail.trim(),
    to_name: input.toName.trim() || 'Vecino/a',
    codigo: input.codigo.trim(),
  };
}

export function buildInstitutionalApprovalEmailParams(input: {
  toEmail: string;
  institutionName: string;
}): Record<string, string> {
  const name = input.institutionName.trim() || 'Institución';
  return {
    to_email: input.toEmail.trim(),
    to_name: name,
    asunto: '¡Tu cuenta institucional en CLUB65 fue aprobada!',
    cuerpo_mensaje: [
      `¡Hola ${name}!`,
      '',
      'Queremos contarte que tu cuenta institucional en CLUB65 ya fue validada y dada de alta oficialmente por nuestro equipo.',
      '',
      'A partir de este momento podés ingresar a la plataforma y empezar a publicar actividades verificadas para toda la comunidad.',
      '',
      '¡Gracias por sumarte y por acompañar las propuestas de CLUB65!',
      '',
      'Un saludo cordial,',
      'El equipo de CLUB65',
    ].join('\n'),
  };
}

export function buildInstitutionalRejectionEmailParams(input: {
  toEmail: string;
  institutionName: string;
  reason: string;
}): Record<string, string> {
  const name = input.institutionName.trim() || 'Institución';
  const cleanReason = input.reason.trim();
  return {
    to_email: input.toEmail.trim(),
    to_name: name,
    asunto: 'Actualización sobre tu solicitud institucional en CLUB65',
    cuerpo_mensaje: [
      `Hola ${name},`,
      '',
      'Te escribimos para contarte que revisamos tu solicitud de alta institucional en CLUB65 y, por el momento, no pudimos aprobarla.',
      '',
      `Motivo informado: ${cleanReason}`,
      '',
      'Si querés revisar los datos o enviar nuevamente la documentación, podés contactarte con nuestro equipo desde la sección de Soporte de la plataforma o escribiéndonos a club65.info@gmail.com.',
      '',
      'Saludos cordiales,',
      'El equipo de CLUB65',
    ].join('\n'),
  };
}

const defaultSender: EmailSenderFn = (serviceId, templateId, templateParams, options) =>
  emailjs.send(serviceId, templateId, templateParams, options);

export async function sendSupportEmail(
  input: {
    senderName: string;
    senderEmail: string;
    subject: string;
    message: string;
  },
  sender: EmailSenderFn = defaultSender
): Promise<void> {
  const params = buildSupportEmailParams(input);
  await sender(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID_MULTIUSO, params, {
    publicKey: EMAILJS_PUBLIC_KEY,
  });
}

export async function sendRecoveryCodeEmail(
  input: {
    toEmail: string;
    toName: string;
    codigo: string;
  },
  sender: EmailSenderFn = defaultSender
): Promise<void> {
  const params = buildRecoveryCodeEmailParams(input);
  await sender(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID_CODIGO, params, {
    publicKey: EMAILJS_PUBLIC_KEY,
  });
}

export async function sendInstitutionalApprovalEmail(
  input: {
    toEmail: string;
    institutionName: string;
  },
  sender: EmailSenderFn = defaultSender
): Promise<void> {
  const params = buildInstitutionalApprovalEmailParams(input);
  await sender(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID_MULTIUSO, params, {
    publicKey: EMAILJS_PUBLIC_KEY,
  });
}

export async function sendInstitutionalRejectionEmail(
  input: {
    toEmail: string;
    institutionName: string;
    reason: string;
  },
  sender: EmailSenderFn = defaultSender
): Promise<void> {
  const params = buildInstitutionalRejectionEmailParams(input);
  await sender(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID_MULTIUSO, params, {
    publicKey: EMAILJS_PUBLIC_KEY,
  });
}
