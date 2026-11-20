import React from 'react';

/**
 * Borde inferior ondulado (estilo festón suave) para la cabecera blanca del chat activo.
 */
export function ScallopedHeaderEdge() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none w-full overflow-hidden leading-none h-3.5 relative z-20 -mb-3.5"
    >
      <svg
        viewBox="0 0 1200 24"
        preserveAspectRatio="none"
        className="w-full h-full block"
      >
        <defs>
          <pattern
            id="chat-scallop-pattern"
            x="0"
            y="0"
            width="48"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 0 H48 V4 C40 20 8 20 0 4 Z"
              fill="var(--c65-chat-header-bg, #FFFFFF)"
            />
            <path
              d="M0 4 C8 20 40 20 48 4"
              fill="none"
              stroke="var(--c65-chat-header-border, #EEDCC9)"
              strokeWidth="2"
            />
          </pattern>
        </defs>
        <rect width="1200" height="24" fill="url(#chat-scallop-pattern)" />
      </svg>
    </div>
  );
}

/**
 * Marca de agua sutil en líneas finas color arena/beige (#B89B7D) para el área de mensajes:
 * notas musicales, tazas de café y vecinos caminando/charlando con muy baja opacidad.
 */
export function ChatWatermark() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none absolute inset-0 overflow-hidden z-0"
    >
      <svg
        className="w-full h-full text-[#B89B7D] opacity-[0.17] dark:text-[#8FA3BF] dark:opacity-[0.09]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="club65-chat-watermark"
            width="420"
            height="340"
            patternUnits="userSpaceOnUse"
          >
            {/* Clave de sol y notas musicales */}
            <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(26, 22)">
              <path d="M22 68 C10 68 8 52 20 48 C32 44 36 58 24 62 C15 64 14 52 22 44 L22 14 C22 6 30 6 30 14 C30 22 18 32 14 40 C10 50 14 68 24 72 C28 74 28 80 22 80 C18 80 16 76 18 73" />
              <line x1="6" y1="30" x2="90" y2="20" strokeOpacity="0.45" />
              <line x1="6" y1="42" x2="90" y2="32" strokeOpacity="0.45" />
              <line x1="6" y1="54" x2="90" y2="44" strokeOpacity="0.45" />
              <circle cx="54" cy="48" r="5" />
              <path d="M59 48 V22 L78 18 V44" />
              <circle cx="73" cy="44" r="5" />
            </g>

            {/* Taza de café humeante en platito */}
            <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(230, 58)">
              <path d="M16 32 H64 V50 C64 64 52 72 40 72 C28 72 16 64 16 50 Z" />
              <path d="M64 38 C74 38 76 54 64 56" />
              <path d="M8 76 C22 82 58 82 72 76" />
              <path d="M30 22 C26 15 34 10 30 3" />
              <path d="M42 20 C38 13 46 8 42 1" />
              <path d="M54 22 C50 15 58 10 54 3" />
            </g>

            {/* Pareja de vecinos caminando y charlando */}
            <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(290, 175)">
              {/* Persona izquierda */}
              <circle cx="28" cy="18" r="9" />
              <path d="M18 36 C18 29 38 29 38 36 L40 68 H16 Z" />
              <path d="M22 68 L18 106 M34 68 L36 106" />
              <path d="M38 42 L52 54" />
              {/* Persona derecha */}
              <circle cx="68" cy="20" r="9" />
              <path d="M58 38 C58 31 78 31 78 38 L84 74 H54 Z" />
              <path d="M63 74 L60 106 M75 74 L78 106" />
              <path d="M58 44 L52 54" />
            </g>

            {/* Corcheas sueltas y taza pequeña inferior izquierda */}
            <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" transform="translate(65, 200)">
              <circle cx="14" cy="36" r="5" />
              <path d="M19 36 V10 C25 12 29 16 29 22" />
              <path d="M90 54 H130 V68 C130 78 121 85 110 85 C99 85 90 78 90 68 Z" />
              <path d="M130 58 C138 58 139 70 130 72" />
              <path d="M84 89 C98 94 122 94 136 89" />
              <path d="M104 44 C101 38 107 34 104 28" />
              <path d="M116 44 C113 38 119 34 116 28" />
            </g>

            {/* Destellos sutiles en línea */}
            <path
              d="M175 140 C177 148 182 153 190 155 C182 157 177 162 175 170 C173 162 168 157 160 155 C168 153 173 148 175 140 Z"
              stroke="currentColor"
              strokeWidth="1.3"
              fill="none"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#club65-chat-watermark)" />
      </svg>
    </div>
  );
}
