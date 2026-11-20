import React, { useState } from 'react';

export interface SobreNosotrosProps {
  onBack: () => void;
  onExplore?: () => void;
}

export function SobreNosotros({ onBack, onExplore }: SobreNosotrosProps) {
  const [imgError, setImgError] = useState(false);

  return (
    <section
      aria-label="Sobre nosotros"
      className="space-y-6 pb-4"
    >
      {/* Barra superior con flechita para volver al home */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="pill-btn px-4 py-2 bg-white hover:bg-amber-100 text-club-brown border border-amber-300 font-bold text-base flex items-center gap-2 shadow-xs cursor-pointer transition whitespace-nowrap shrink-0"
        >
          <i className="fa-solid fa-arrow-left text-club-orange" aria-hidden="true" />
          <span>Volver a la página de inicio</span>
        </button>
      </div>

      {/* Tarjeta principal: Nuestra Misión + Imagen de comunidad */}
      <div className="bg-white rounded-[28px] border border-amber-200/90 retro-shadow overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 items-center gap-6 lg:gap-8 p-6 sm:p-8 lg:p-10">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-4">
            <p className="text-sm font-extrabold uppercase tracking-wider text-club-orange">
              Sobre nosotros · CLUB65
            </p>
            <h1 className="font-brand text-3xl sm:text-4xl lg:text-[2.65rem] font-extrabold text-club-brown leading-[1.12] text-balance">
              Nuestra Misión
            </h1>
            <p className="text-base sm:text-lg text-[#5C3A28] leading-relaxed font-semibold">
              CLUB65 es una plataforma vecinal creada para potenciar la vida social, cultural y recreativa de los adultos mayores de 65 años. Creemos firmemente que la vitalidad, el aprendizaje constante y el disfrute no tienen edad. Nuestro propósito principal es acercar propuestas significativas, fomentar el encuentro cara a cara y fortalecer los lazos de comunidad en cada barrio.
            </p>
          </div>

          <div className="lg:col-span-6 flex items-center justify-center">
            <div className="w-full aspect-video rounded-2xl overflow-hidden border border-amber-200/90 bg-amber-50 shadow-sm">
              {!imgError ? (
                <img
                  src="/assets/aistudio/Club65__7467ab1c.jpg"
                  alt="Mosaico de personas mayores que forman parte de la comunidad CLUB65"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                  className="w-full h-full object-contain block"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-br from-[#FCE0A2] via-amber-100 to-teal-50 dark:from-[#273142] dark:via-[#1F2733] dark:to-[#192D47] text-club-brown">
                  <i className="fa-solid fa-people-group text-4xl text-club-orange mb-3" aria-hidden="true" />
                  <p className="font-brand text-xl font-bold">Comunidad CLUB65</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bloque: ¿Qué nos moviliza? */}
      <div className="bg-amber-50 rounded-3xl p-6 sm:p-8 border border-amber-200/90 retro-shadow space-y-3">
        <h2 className="font-brand text-2xl sm:text-3xl font-bold text-club-brown flex items-center gap-3 text-balance">
          <span className="w-10 h-10 rounded-2xl bg-club-orange/15 text-club-orange flex items-center justify-center flex-shrink-0">
            <i className="fa-solid fa-heart text-lg" aria-hidden="true" />
          </span>
          <span>¿Qué nos moviliza?</span>
        </h2>
        <p className="text-base sm:text-lg text-[#5C3A28] leading-relaxed font-semibold max-w-4xl">
          Sabemos que mantenerse activo, conectado y rodeado de intereses compartidos es la clave para una vida plena. Por eso diseñamos un espacio digital ágil, cálido y seguro que simplifica el acceso a todo lo que sucede cerca tuyo, ayudándote a elegir qué hacer, con quiénes compartirlo y cómo ser parte activa de tu comunidad.
        </p>
      </div>

      {/* Bloque: Lo que encontrás en CLUB65 */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-amber-200/90 retro-shadow space-y-6">
        <div className="border-b border-amber-100 pb-3">
          <h2 className="font-brand text-2xl sm:text-3xl font-bold text-club-brown text-balance">
            Lo que encontrás en CLUB65
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <article className="bg-amber-50/75 rounded-2xl p-5 sm:p-6 border border-amber-200/80 flex flex-col gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#F26A2E]/15 text-club-orange flex items-center justify-center text-xl flex-shrink-0">
              <i className="fa-solid fa-compass" aria-hidden="true" />
            </div>
            <h3 className="font-brand text-xl font-bold text-club-brown leading-snug">
              Cartelera de Actividades Verificadas
            </h3>
            <p className="text-base text-[#5C3A28] leading-relaxed font-semibold">
              Talleres de movimiento, estimulación cognitiva, mateadas, ciclos de cine, tejido, caminatas y paseos al aire libre organizados tanto por vecinos como por instituciones de confianza.
            </p>
          </article>

          <article className="bg-amber-50/75 rounded-2xl p-5 sm:p-6 border border-amber-200/80 flex flex-col gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#3B98A6]/15 text-club-teal flex items-center justify-center text-xl flex-shrink-0">
              <i className="fa-solid fa-comments" aria-hidden="true" />
            </div>
            <h3 className="font-brand text-xl font-bold text-club-brown leading-snug">
              Comunidad y Diálogo (Mi Chat)
            </h3>
            <p className="text-base text-[#5C3A28] leading-relaxed font-semibold">
              Un espacio propio para conversar, coordinar salidas, formar grupos de interés y entablar vínculos genuinos con personas de tu misma generación y zona.
            </p>
          </article>

          <article className="bg-amber-50/75 rounded-2xl p-5 sm:p-6 border border-amber-200/80 flex flex-col gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emerald-600/15 text-emerald-700 flex items-center justify-center text-xl flex-shrink-0">
              <i className="fa-solid fa-shield-halved" aria-hidden="true" />
            </div>
            <h3 className="font-brand text-xl font-bold text-club-brown leading-snug">
              Seguridad y Transparencia
            </h3>
            <p className="text-base text-[#5C3A28] leading-relaxed font-semibold">
              Cada propuesta publicada cuenta con un sistema de validación institucional y moderación comunitaria, garantizando un entorno confiable, cuidado y libre de preocupaciones.
            </p>
          </article>
        </div>
      </div>

      {/* Bloque: Nuestros Pilares */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-amber-200/90 retro-shadow space-y-6">
        <div className="border-b border-amber-100 pb-3">
          <h2 className="font-brand text-2xl sm:text-3xl font-bold text-club-brown text-balance">
            Nuestros Pilares
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <article className="bg-club-cream rounded-2xl p-5 sm:p-6 border border-amber-200/80 space-y-2.5">
            <span className="font-brand text-2xl font-extrabold text-club-orange tabular-nums">01.</span>
            <h3 className="font-brand text-xl font-bold text-club-brown leading-snug">
              Autonomía y Protagonismo
            </h3>
            <p className="text-base text-[#5C3A28] leading-relaxed font-semibold">
              Promovemos una adultez activa y participativa, donde vos elegís cómo disfrutar tu tiempo y qué actividades liderar o sumar a la agenda barrial.
            </p>
          </article>

          <article className="bg-club-cream rounded-2xl p-5 sm:p-6 border border-amber-200/80 space-y-2.5">
            <span className="font-brand text-2xl font-extrabold text-club-teal tabular-nums">02.</span>
            <h3 className="font-brand text-xl font-bold text-club-brown leading-snug">
              Cercanía
            </h3>
            <p className="text-base text-[#5C3A28] leading-relaxed font-semibold">
              Creemos en el valor de lo local: lo que pasa en tu cuadra, en tu plaza y en tu municipio, al alcance de un clic.
            </p>
          </article>

          <article className="bg-club-cream rounded-2xl p-5 sm:p-6 border border-amber-200/80 space-y-2.5">
            <span className="font-brand text-2xl font-extrabold text-club-brown tabular-nums">03.</span>
            <h3 className="font-brand text-xl font-bold text-club-brown leading-snug">
              Accesibilidad y Calidez
            </h3>
            <p className="text-base text-[#5C3A28] leading-relaxed font-semibold">
              Una plataforma pensada desde el diseño y la usabilidad para ser disfrutada sin barreras técnicas.
            </p>
          </article>
        </div>
      </div>

      {/* Cierre */}
      <div className="bg-amber-50 rounded-3xl p-6 sm:p-8 border border-amber-200/90 retro-shadow flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
        <p className="font-brand text-xl sm:text-2xl font-extrabold text-club-brown text-balance">
          CLUB65: Conectando experiencias, construyendo comunidad.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 shrink-0">
          {onExplore && (
            <button
              type="button"
              onClick={onExplore}
              className="pill-btn px-5 py-2.5 bg-club-orange hover:bg-club-orange-dark text-white font-bold text-base shadow-sm cursor-pointer flex items-center gap-2 whitespace-nowrap shrink-0"
            >
              <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
              <span>Explorar actividades</span>
            </button>
          )}
          <button
            type="button"
            onClick={onBack}
            className="pill-btn px-5 py-2.5 bg-white hover:bg-amber-100 text-club-brown border border-amber-300 font-bold text-base shadow-xs cursor-pointer flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <i className="fa-solid fa-arrow-left text-club-orange" aria-hidden="true" />
            <span>Volver al inicio</span>
          </button>
        </div>
      </div>
    </section>
  );
}

export default SobreNosotros;
