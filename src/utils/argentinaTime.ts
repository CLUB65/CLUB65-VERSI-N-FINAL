/**
 * Utilidades de fecha y hora estándar de la República Argentina (ART: UTC-3)
 * Garantiza que en cualquier entorno de ejecución (servidor, contenedor o navegador),
 * los horarios y fechas de propuestas, moderación, cartelera, chats y registros correspondan exactamente a Argentina.
 * Formato oficial en castellano: d/m/a (Día/Mes/Año).
 */

export const ARGENTINA_TIMEZONE = 'America/Argentina/Buenos_Aires';

/**
 * Convierte de manera segura cualquier entrada (Date, ISO string, timestamp numérico, YYYY-MM-DD o DD/MM/YYYY)
 * a un objeto Date interpretado correctamente en la zona horaria de Argentina (UTC-3).
 */
export function toArgentinaDate(input?: string | number | Date | null): Date | null {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  
  if (typeof input === 'string') {
    const str = input.trim();
    if (!str) return null;

    // Si ya viene en formato fecha simple YYYY-MM-DD
    const ymdMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1], 10);
      const month = parseInt(ymdMatch[2], 10) - 1;
      const day = parseInt(ymdMatch[3], 10);
      // Anclar a las 12:00 ART (15:00 UTC) para asegurar estabilidad sin desfases de huso
      return new Date(Date.UTC(year, month, day, 15, 0, 0));
    }

    // Si viene en formato d/m/a (DD/MM/YYYY) con o sin hora
    const dmyMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const month = parseInt(dmyMatch[2], 10) - 1;
      const year = parseInt(dmyMatch[3], 10);
      const hour = dmyMatch[4] ? parseInt(dmyMatch[4], 10) : 12;
      const minute = dmyMatch[5] ? parseInt(dmyMatch[5], 10) : 0;
      const second = dmyMatch[6] ? parseInt(dmyMatch[6], 10) : 0;
      // ART es UTC-3 -> UTC = hora + 3
      return new Date(Date.UTC(year, month, day, hour + 3, minute, second));
    }

    // Timestamp numérico almacenado como string
    if (/^\d{10,13}$/.test(str)) {
      const d = new Date(parseInt(str, 10));
      if (!isNaN(d.getTime())) return d;
    }

    // Parseo ISO 8601 estándar o RFC
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  return null;
}

/**
 * Formato completo con fecha d/m/a y hora en zona horaria de Argentina (UTC-3):
 * Ej: "06/11/2026, 14:30 hs"
 */
export function formatArgentinaDateTime(input?: string | number | Date | null): string {
  const d = input ? toArgentinaDate(input) : new Date();
  if (!d) return '';
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: ARGENTINA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.day}/${m.month}/${m.year}, ${m.hour}:${m.minute} hs`;
}

/**
 * Formato solo fecha en castellano d/m/a en zona horaria de Argentina (UTC-3):
 * Ej: "06/11/2026"
 */
export function formatArgentinaDateOnly(input?: string | number | Date | null): string {
  const d = input ? toArgentinaDate(input) : new Date();
  if (!d) return '';
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: ARGENTINA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
  const parts = formatter.formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.day}/${m.month}/${m.year}`;
}

/**
 * Formato solo hora en zona horaria de Argentina (UTC-3):
 * Ej: "14:30 hs"
 */
export function formatArgentinaTimeOnly(input?: string | number | Date | null): string {
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const timeMatch = trimmed.match(/^(\d{1,2}):(\d{2})(?:\s*hs)?$/i);
    if (timeMatch) {
      return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]} hs`;
    }
  }
  const d = input ? toArgentinaDate(input) : new Date();
  if (!d) return '';
  const formatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: ARGENTINA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  return `${m.hour}:${m.minute} hs`;
}

/**
 * Formateador universal que convierte cualquier valor de fecha a formato d/m/a en hora de Argentina.
 */
export function formatToArgentinaDate(input?: any): string {
  if (!input) return '';
  if (typeof input === 'string') {
    const trimmed = input.trim();
    // Si ya viene como d/m/a con o sin ceros a la izquierda
    const dmyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmyMatch) {
      return `${dmyMatch[1].padStart(2, '0')}/${dmyMatch[2].padStart(2, '0')}/${dmyMatch[3]}`;
    }
    // Si viene como YYYY-MM-DD
    const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymdMatch) {
      return `${ymdMatch[3].padStart(2, '0')}/${ymdMatch[2].padStart(2, '0')}/${ymdMatch[1]}`;
    }
  }
  const d = toArgentinaDate(input);
  return d ? formatArgentinaDateOnly(d) : String(input || '');
}

/**
 * Devuelve la clave de fecha en zona de Argentina (DD/MM/YYYY) para agrupar mensajes por día.
 */
export function getMessageArgentinaDate(message: any, fallbackDate?: any): string {
  if (!message) return formatArgentinaDateOnly();

  // 1. Mensaje con createdAt o created_at (ISO o timestamp de Supabase)
  if (message.createdAt || message.created_at) {
    const d = toArgentinaDate(message.createdAt || message.created_at);
    if (d) return formatArgentinaDateOnly(d);
  }

  // 2. Mensaje con timestamp numérico
  if (typeof message.timestamp === 'number' && message.timestamp > 0) {
    const d = new Date(message.timestamp);
    if (!isNaN(d.getTime())) return formatArgentinaDateOnly(d);
  }

  // 3. ID de mensaje con timestamp generado (ej. msg_1792876904292)
  if (typeof message.id === 'string' && message.id.startsWith('msg_')) {
    const parts = message.id.split('_');
    if (parts.length > 1) {
      const ts = parseInt(parts[1], 10);
      if (!isNaN(ts) && ts > 1000000000000) {
        return formatArgentinaDateOnly(new Date(ts));
      }
    }
  }

  // 4. Mensaje con fecha explícita
  if (message.date || message.fecha) {
    const d = toArgentinaDate(message.date || message.fecha);
    if (d) return formatArgentinaDateOnly(d);
  }

  // 5. Time con fecha embebida (ej. "06/11/2026, 14:00 hs")
  if (typeof message.time === 'string') {
    const m = message.time.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
    if (m) {
      const [d, mo, y] = m[1].split('/');
      return `${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${y}`;
    }
  }

  // 6. Respaldo por fecha de creación del chat
  if (fallbackDate) {
    const d = toArgentinaDate(fallbackDate);
    if (d) return formatArgentinaDateOnly(d);
  }

  return formatArgentinaDateOnly(new Date());
}

/**
 * Genera el cartelito de fecha para separar conversaciones por día en el chat.
 * Siempre incluye la fecha exacta en formato en castellano d/m/a.
 * Ejemplos: "Hoy - 06/11/2026", "Ayer - 05/11/2026", o "04/11/2026"
 */
export function formatArgentinaDateHeader(dateStr: string): string {
  if (!dateStr) return '';
  const todayStr = formatArgentinaDateOnly(new Date());

  // Calcular ayer en Argentina
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayStr = formatArgentinaDateOnly(yesterday);

  if (dateStr === todayStr) {
    return `Hoy - ${dateStr}`;
  }
  if (dateStr === yesterdayStr) {
    return `Ayer - ${dateStr}`;
  }
  return dateStr;
}

/**
 * Devuelve la fecha actual en Argentina en formato YYYY-MM-DD para usar en atributos `min` de <input type="date">.
 */
export function getArgentinaTodayYMD(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

/**
 * Suma o resta una cantidad entera de días a una fecha en formato YYYY-MM-DD.
 */
export function addDaysYMD(ymd: string, days: number): string {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return dt.toISOString().split('T')[0];
}

/**
 * Devuelve la cantidad de minutos transcurridos en el día actual según el reloj de Argentina (hora * 60 + minuto).
 */
export function getArgentinaCurrentMinutes(): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: ARGENTINA_TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    hourCycle: 'h23'
  });
  const parts = formatter.formatToParts(new Date());
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = parseInt(p.value, 10);
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  if (h === 24) h = 0;
  return h * 60 + m;
}

/**
 * Parsea una fecha/hora en formato argentino ("DD/MM/YYYY", "DD/MM/YYYY, HH:MM hs", "YYYY-MM-DD" o ISO)
 * y devuelve el timestamp en milisegundos (o 0 si no es válido).
 */
export function parseArgentinaDateTime(str?: string | null): number {
  if (!str) return 0;
  const trimmed = String(str).trim();
  if (!trimmed) return 0;

  const ymdMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]) - 1;
    const day = Number(ymdMatch[3]);
    return new Date(Date.UTC(year, month, day, 3, 0, 0)).getTime();
  }

  const match = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    const hour = match[4] ? Number(match[4]) : 0;
    const minute = match[5] ? Number(match[5]) : 0;
    const second = match[6] ? Number(match[6]) : 0;
    return new Date(Date.UTC(year, month, day, hour + 3, minute, second)).getTime();
  }

  const t = Date.parse(trimmed);
  return isNaN(t) ? 0 : t;
}
