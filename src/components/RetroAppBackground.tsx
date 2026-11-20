import React from 'react';

/**
 * Fondo decorativo superior para vistas internas sobre amarillo pastel (#FCE0A2):
 * muestra la onda pastel debajo de la barra superior y deja el final de la página limpio.
 * Siempre pointer-events-none para no interferir con la interacción.
 */
export function RetroAppBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none absolute inset-0 overflow-hidden z-0"
    >
      <img
        src="/assets/aistudio/ONDA_PASTEL_169e86e8.png"
        alt=""
        className="w-full min-h-[52px] sm:min-h-0 h-auto object-cover object-top block transition-opacity duration-200 dark:opacity-20 dark:brightness-50 dark:saturate-50"
      />
    </div>
  );
}

export default RetroAppBackground;
