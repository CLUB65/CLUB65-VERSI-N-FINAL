import confetti from 'canvas-confetti';

export const CONFETTI_COLORS: string[] = [
  '#26ccff',
  '#a25afd',
  '#ff5e7e',
  '#88ff5a',
  '#fcff42',
  '#ffa62d',
  '#ff36ff',
];

export interface ConfettiOrigin {
  x: number;
  y: number;
}

export interface ConfettiBurstOptions {
  particleCount: number;
  spread: number;
  startVelocity: number;
  decay: number;
  gravity: number;
  scalar: number;
  ticks: number;
  colors: string[];
  shapes: Array<'square' | 'circle'>;
  origin: ConfettiOrigin;
  zIndex: number;
  disableForReducedMotion: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getConfettiBurstOptions(origin?: Partial<ConfettiOrigin>): ConfettiBurstOptions {
  const safeX = typeof origin?.x === 'number' && Number.isFinite(origin.x) ? clamp(origin.x, 0.15, 0.85) : 0.5;
  const safeY = typeof origin?.y === 'number' && Number.isFinite(origin.y) ? clamp(origin.y, 0.2, 0.75) : 0.38;

  return {
    particleCount: 95,
    spread: 85,
    startVelocity: 42,
    decay: 0.92,
    gravity: 0.95,
    scalar: 0.95,
    ticks: 190,
    colors: [...CONFETTI_COLORS],
    shapes: ['square', 'circle'],
    origin: { x: safeX, y: safeY },
    zIndex: 99999,
    disableForReducedMotion: false,
  };
}

export function shouldTriggerActivityPublishedConfetti(params: {
  isEditResubmission?: boolean;
  isInst?: boolean;
  createdActivity?: {
    id?: string | number | null;
    isApproved?: boolean;
    proposalStatus?: string | null;
    estado?: string | null;
    fechaBaja?: string | null;
  } | null;
}): boolean {
  if (params.isEditResubmission) return false;
  if (!params.isInst) return false;
  const act = params.createdActivity;
  if (!act || act.id === undefined || act.id === null || act.id === '') return false;
  const status = String(act.estado || act.proposalStatus || '').trim().toLowerCase();
  if (status === 'pendiente' || status === 'rechazada' || status === 'baja_forzada' || status === 'cambios_solicitados') {
    return false;
  }
  if (act.fechaBaja) return false;
  return act.isApproved !== false;
}

export function shouldTriggerReviewPublishedConfetti(params: {
  isEdit?: boolean;
  textoResena?: string | null;
  califEstrellas?: number | null;
  actividadId?: string | number | null;
  hasUser?: boolean;
  createdReview?: { id?: string | number | null } | null;
}): boolean {
  if (params.isEdit) return false;
  if (!params.hasUser) return false;
  if (!params.textoResena || !params.textoResena.trim()) return false;
  const stars = Number(params.califEstrellas);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) return false;
  if (params.actividadId === undefined || params.actividadId === null || String(params.actividadId).trim() === '') {
    return false;
  }
  if (!params.createdReview) return false;
  return true;
}

export function shouldTriggerEnrollmentConfetti(params: {
  wasAlreadyEnrolled?: boolean;
  hasUser?: boolean;
  enrollSucceeded?: boolean;
}): boolean {
  if (params.wasAlreadyEnrolled) return false;
  if (!params.hasUser) return false;
  return Boolean(params.enrollSucceeded);
}

let sharedCanvas: HTMLCanvasElement | null = null;
let sharedLauncher: ReturnType<typeof confetti.create> | null = null;

function ensureConfettiLauncher(): ReturnType<typeof confetti.create> | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;

  if (!sharedCanvas || !document.body.contains(sharedCanvas)) {
    const existing = document.querySelector<HTMLCanvasElement>('[data-testid="celebration-confetti-canvas"]');
    if (existing) {
      sharedCanvas = existing;
    } else {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('data-testid', 'celebration-confetti-canvas');
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.position = 'fixed';
      canvas.style.inset = '0';
      canvas.style.width = '100vw';
      canvas.style.height = '100vh';
      canvas.style.pointerEvents = 'none';
      canvas.style.zIndex = '99999';
      document.body.appendChild(canvas);
      sharedCanvas = canvas;
    }
    sharedLauncher = confetti.create(sharedCanvas, {
      resize: true,
      useWorker: false,
    });
  }

  return sharedLauncher;
}

export function launchCelebrationConfetti(origin?: Partial<ConfettiOrigin>): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const prevCount = Number(document.documentElement.dataset.confettiCount || '0') || 0;
  document.documentElement.dataset.confettiCount = String(prevCount + 1);

  try {
    const launcher = ensureConfettiLauncher();
    if (!launcher) return;

    const opts = getConfettiBurstOptions(origin);
    launcher({
      ...opts,
      particleCount: 65,
      spread: 75,
      startVelocity: 40,
    });
    launcher({
      ...opts,
      particleCount: 35,
      spread: 105,
      startVelocity: 30,
      scalar: 0.85,
    });
  } catch (err) {
    console.warn('No se pudo renderizar el confetti:', err);
  }
}
