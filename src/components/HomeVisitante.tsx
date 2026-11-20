import React from 'react';

export interface HomeVisitanteProps {
  onExplore: () => void;
  onRegister: () => void;
  onLogin: () => void;
  isDarkMode?: boolean;
}

function SparkleStar({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={`pointer-events-none select-none ${className}`}
    >
      <path d="M12 0 C13.2 8.2 15.8 10.8 24 12 C15.8 13.2 13.2 15.8 12 24 C10.8 15.8 8.2 13.2 0 12 C8.2 10.8 10.8 8.2 12 0 Z" />
    </svg>
  );
}

export function HomeVisitante({
  onExplore,
  onRegister,
  onLogin,
  isDarkMode = false
}: HomeVisitanteProps) {
  return (
    <section
      aria-label="Inicio para visitantes"
      className="relative w-full flex-1 bg-[#FCE0A2] dark:bg-[#161B24] flex items-center justify-center py-8 sm:py-12 md:py-16 overflow-hidden transition-colors duration-200"
    >
      {/* Destellos / estrellas de 4 puntas en el fondo exterior */}
      <SparkleStar className="absolute top-3 left-[35%] w-5 h-5 sm:w-6 sm:h-6 text-[#FFFFFF] opacity-95 dark:text-[#6ED2E0] dark:opacity-35" />
      <SparkleStar className="absolute top-5 right-[3%] sm:right-[4%] w-6 h-6 sm:w-8 sm:h-8 text-[#FFFFFF] opacity-95 dark:text-[#FF9B66] dark:opacity-35" />
      <SparkleStar className="hidden sm:block absolute top-[14%] left-[2.5%] w-5 h-5 text-[#F35C22] opacity-90 dark:text-[#FF9B66] dark:opacity-45" />
      <SparkleStar className="absolute top-[56%] left-[1.5%] sm:left-[2%] w-6 h-6 sm:w-7 sm:h-7 text-[#FFFFFF] opacity-95 dark:text-[#6ED2E0] dark:opacity-30" />
      <SparkleStar className="hidden md:block absolute top-[46%] right-[2%] w-5 h-5 text-[#4D899C] opacity-90 dark:text-[#6ED2E0] dark:opacity-40" />
      <SparkleStar className="absolute bottom-5 left-[4%] sm:left-[8%] w-5 h-5 sm:w-6 sm:h-6 text-[#4D899C] opacity-90 dark:text-[#6ED2E0] dark:opacity-40" />
      <SparkleStar className="absolute bottom-3 left-[28%] sm:left-[30%] w-6 h-6 sm:w-7 sm:h-7 text-[#FFFFFF] opacity-95 dark:text-[#FDE8BA] dark:opacity-25" />
      <SparkleStar className="absolute bottom-5 left-[39%] sm:left-[40%] w-5 h-5 sm:w-6 sm:h-6 text-[#4D899C] opacity-95 dark:text-[#6ED2E0] dark:opacity-40" />
      <SparkleStar className="absolute bottom-4 right-[15%] sm:right-[19%] w-5 h-5 sm:w-6 sm:h-6 text-[#F35C22] opacity-95 dark:text-[#FF9B66] dark:opacity-45" />
      <SparkleStar className="hidden sm:block absolute bottom-8 right-[3%] w-5 h-5 text-[#FFFFFF] opacity-90 dark:text-[#FDE8BA] dark:opacity-25" />

      {/* Tarjeta Hero Principal */}
      <div className="relative z-10 w-[90%] md:w-[88%] max-w-[1440px] mx-auto bg-[#FFFFFF] dark:bg-[#1F2733] dark:border dark:border-[#3E4D63] rounded-[28px] shadow-lg overflow-hidden">
        {/* Destellos sutiles en esquinas internas de la tarjeta */}
        <SparkleStar className="hidden sm:block absolute top-5 left-5 sm:top-6 sm:left-7 w-5 h-5 sm:w-6 sm:h-6 text-[#F35C22]/85 dark:text-[#FF9B66]/45 z-0" />
        <SparkleStar className="hidden sm:block absolute bottom-5 left-5 sm:bottom-6 sm:left-7 w-5 h-5 sm:w-6 sm:h-6 text-[#4D899C] dark:text-[#6ED2E0]/45 z-0" />
        <SparkleStar className="hidden sm:block absolute top-10 right-[17%] w-6 h-6 text-[#FCE0A2] dark:text-[#FDE8BA]/30 z-0" />
        <SparkleStar className="hidden sm:block absolute top-[40%] right-5 sm:right-7 w-5 h-5 text-[#4D899C] dark:text-[#6ED2E0]/45 z-0" />

        {/* Ondas curvas retro (firulete) desde la esquina inferior derecha */}
        <img
          src="/assets/aistudio/FIRULETE_e1787823.png"
          alt=""
          aria-hidden="true"
          className="pointer-events-none select-none absolute bottom-0 right-0 translate-x-[6.4%] translate-y-[3.4%] w-[280px] sm:w-[390px] lg:w-[440px] xl:w-[515px] h-auto object-contain z-0 dark:opacity-20 dark:brightness-75"
        />

        {/* Contenido en 2 columnas */}
        <div className="relative z-10 flex flex-col lg:flex-row items-center justify-between gap-6 lg:gap-4 px-5 py-8 sm:px-9 sm:py-11 lg:px-10 lg:py-12 xl:px-14 xl:py-12">
          {/* Columna Izquierda */}
          <div className="w-full lg:flex-1 min-w-0 flex flex-col items-start text-left justify-center space-y-5 sm:space-y-6">
            <span className="inline-block rounded-full bg-[#FDE3A7] text-[#4A2311] dark:bg-[#3A3123] dark:text-[#FDE8BA] dark:border dark:border-[#9C7C3B] uppercase font-bold text-sm xl:text-base tracking-wide px-4 sm:px-5 py-1.5 sm:py-2 max-w-full break-words">
              PLATAFORMA VECINAL PARA MAYORES DE 65 AÑOS
            </span>

            <h1 className="font-brand text-2xl sm:text-3xl lg:text-[2.4rem] xl:text-[3rem] font-extrabold leading-[1.1] text-[#4A2311] dark:text-[#F4F6F9] max-w-[720px] text-balance break-words">
              Conectá con personas de tu edad a través de actividades en tu barrio
            </h1>

            <p className="text-base sm:text-lg lg:text-lg xl:text-[1.15rem] text-[#5C3A28] dark:text-[#E1E7F0] leading-relaxed max-w-[660px] font-semibold">
              Talleres de movimiento, estimulación cognitiva, mateadas, tejido y paseos al aire libre organizados por tus vecinos e instituciones verificadas.
            </p>

            <div className="flex flex-wrap items-center gap-3.5 sm:gap-4 pt-2 pb-1 w-full">
              <button
                type="button"
                onClick={onExplore}
                className="relative hover:z-10 rounded-full px-5 py-3 bg-[#F35C22] hover:bg-[#e15018] text-[#3E1A09] dark:bg-[#C94810] dark:hover:bg-[#B23E0B] dark:text-white font-bold text-base shadow-md hover:shadow-lg origin-center hover:scale-[1.05] active:scale-[0.98] transition-all duration-200 ease-out flex items-center justify-center gap-2 cursor-pointer w-full sm:w-auto min-w-0 break-words"
              >
                <i className="fa-solid fa-magnifying-glass text-base shrink-0" aria-hidden="true" />
                <span>Explorar actividades</span>
              </button>

              <button
                type="button"
                onClick={onRegister}
                className="relative hover:z-10 rounded-full px-5 py-3 bg-[#538D9F] hover:bg-[#467d8e] text-[#3E1A09] dark:bg-[#237887] dark:hover:bg-[#1D6470] dark:text-white font-bold text-base shadow-md hover:shadow-lg origin-center hover:scale-[1.05] active:scale-[0.98] transition-all duration-200 ease-out flex items-center justify-center gap-2 cursor-pointer w-full sm:w-auto min-w-0 break-words"
              >
                <i className="fa-solid fa-user-plus text-base shrink-0" aria-hidden="true" />
                <span>Registrarme gratis</span>
              </button>

              <button
                type="button"
                onClick={onLogin}
                className="relative hover:z-10 rounded-full px-5 py-3 bg-[#4B210F] hover:bg-[#3a180a] text-[#FFFFFF] dark:bg-[#2D384B] dark:hover:bg-[#39475E] dark:border dark:border-[#687E9E] dark:text-[#F4F6F9] font-bold text-base shadow-md hover:shadow-lg origin-center hover:scale-[1.05] active:scale-[0.98] transition-all duration-200 ease-out flex items-center justify-center gap-2 cursor-pointer w-full sm:w-auto min-w-0 break-words"
              >
                <i className="fa-solid fa-right-to-bracket text-base shrink-0" aria-hidden="true" />
                <span>Iniciar sesión</span>
              </button>
            </div>
          </div>

          {/* Columna Derecha */}
          <div className="w-full lg:w-auto lg:shrink-0 flex items-center justify-center lg:justify-end pt-2 lg:pt-0">
            <div className="relative flex items-center justify-center w-64 sm:w-80 md:w-[340px] lg:w-[350px] xl:w-[450px] lg:-mr-4 xl:-mr-6 lg:-ml-4 xl:-ml-6">
              <img
                src={isDarkMode ? '/assets/aistudio/ISOTIPO_CLUB65_NEGATIVIZADO_7727b397.png' : '/assets/aistudio/ISOLOGO_5e044cb6.png'}
                alt="Pareja bailando CLUB65"
                className={
                  isDarkMode
                    ? 'w-full h-auto object-contain lg:-translate-x-6 xl:-translate-x-8 transition-transform duration-300 ease-out hover:scale-105 cursor-pointer drop-shadow-[0_6px_18px_rgba(0,0,0,0.45)]'
                    : 'w-full h-auto object-contain lg:-translate-x-6 xl:-translate-x-8 transition-transform duration-300 ease-out hover:scale-105 cursor-pointer [filter:drop-shadow(2px_0_0_#ffffff)_drop-shadow(-2px_0_0_#ffffff)_drop-shadow(0_2px_0_#ffffff)_drop-shadow(0_-2px_0_#ffffff)]'
                }
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default HomeVisitante;
