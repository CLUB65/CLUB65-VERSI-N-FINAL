import React, { useState, useRef } from 'react';
import { useUser } from '../context/UserContext.tsx';
import { Avatar } from './Avatar.tsx';

export interface HeaderProps {
  currentView: string;
  setCurrentView: (view: any) => void;
  setModalLoginOpen: (open: boolean) => void;
  setModalRegisterOpen: (open: boolean) => void;
  setModalEditProfileOpen: (open: boolean) => void;
  setModalSupabaseOpen: (open: boolean) => void;
  setModalVisorImgSrc: (src: string | null) => void;
  setProfileForm: (form: any) => void;
  supabaseHealthState: any;
  onLogout: () => void;
  onProponerActividad?: () => void;
  onPublicarActividad?: () => void;
  pendingActivitiesCount?: number;
  isDarkMode?: boolean;
}

export function Header({
  currentView,
  setCurrentView,
  setModalLoginOpen,
  setModalRegisterOpen,
  setModalEditProfileOpen,
  setModalSupabaseOpen,
  setModalVisorImgSrc,
  setProfileForm,
  supabaseHealthState,
  onLogout,
  onProponerActividad,
  onPublicarActividad,
  pendingActivitiesCount,
  isDarkMode
}: HeaderProps) {
  const { currentUser } = useUser();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const dropdownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeDarkMode = isDarkMode ?? Boolean(currentUser?.contrast);

  return (
    <nav className="bg-club-cream border-b-2 border-amber-200/60 sticky top-0 z-30 retro-shadow">
      <div className="max-w-5xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
        {/* BRAND LOGO */}
        <button
          onClick={() => setCurrentView(currentUser ? 'explorar' : 'home-visitante')}
          className="flex items-center gap-2.5 sm:gap-3 text-left cursor-pointer border-none bg-transparent min-w-0 transition-transform duration-300 ease-out hover:scale-105"
        >
          <div className="w-11 h-11 sm:w-12 sm:h-12 flex-shrink-0 flex items-center justify-center">
            <img
              src={activeDarkMode ? '/assets/aistudio/ISOTIPO_CLUB65_NEGATIVIZADO_7727b397.png' : '/assets/aistudio/ISOLOGO_5e044cb6.png'}
              alt="Club65 Isotipo"
              className="w-full h-full object-contain"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
          <div className="h-9 sm:h-11 flex items-center min-w-0">
            <img
              src={activeDarkMode ? '/assets/aistudio/LOGO_CLUB65_NEGATIVIZADO_6eb1c78e.png' : '/assets/aistudio/LOGOTIPO_10cf9c66.png'}
              alt="CLUB65 Conectando Experiencias"
              className="h-full object-contain"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          </div>
        </button>

        {/* USER SESSION ACTIONS / DROPDOWN */}
        <div
          className="relative min-w-0 max-w-full"
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
          {currentUser ? (
            <div>
              <button
                onClick={() => {
                  if (dropdownTimeoutRef.current) clearTimeout(dropdownTimeoutRef.current);
                  setUserDropdownOpen(!userDropdownOpen);
                }}
                className="flex items-center gap-2.5 bg-amber-100/70 hover:bg-amber-100 border border-amber-200 px-3.5 py-1.5 rounded-full text-base transition cursor-pointer max-w-full min-w-0"
              >
                <Avatar
                  user={currentUser}
                  size="sm"
                  onClick={(e) => {
                    if (currentUser.avatar) {
                      e.stopPropagation();
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
                <i className="fa-solid fa-chevron-down text-sm text-stone-500 ml-1 flex-shrink-0" />
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
                          <i className="fa-solid fa-shield-halved text-sm" /> Perfil de Moderador
                        </span>
                      ) : currentUser.tipo === 'institucional' ? (
                        <span className="text-blue-700 font-bold flex items-center gap-1.5">
                          <i className="fa-solid fa-landmark text-sm" /> Institución Verificada
                        </span>
                      ) : (
                        <span className="text-stone-500 flex items-center gap-1.5">
                          <i className="fa-solid fa-user text-sm" /> Perfil Individual
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
                      onClick={onLogout}
                      className="w-full px-3 py-2 text-left hover:bg-rose-50 text-rose-700 rounded-xl flex items-center gap-2 font-bold cursor-pointer break-words"
                    >
                      <i className="fa-solid fa-arrow-right-from-bracket flex-shrink-0" /> <span>Cerrar sesión</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setModalLoginOpen(true)}
                className="pill-btn px-3.5 sm:px-4 py-2 bg-white text-club-brown border border-amber-300 hover:bg-amber-50 text-base font-bold shadow-xs cursor-pointer flex items-center gap-1.5 min-w-0 break-words"
              >
                <i className="fa-solid fa-right-to-bracket text-club-orange flex-shrink-0" /> <span>Iniciar sesión</span>
              </button>
              <button
                onClick={() => setModalRegisterOpen(true)}
                className="pill-btn px-3.5 sm:px-4 py-2 bg-club-orange text-white hover:bg-club-orange-dark text-base font-bold shadow-sm cursor-pointer flex items-center gap-1.5 min-w-0 break-words"
              >
                <i className="fa-solid fa-user-plus flex-shrink-0" /> <span>Registrarme</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* PESTAÑAS PRINCIPALES DE NAVEGACIÓN */}
      <div className="max-w-5xl mx-auto px-4 pb-3 pt-1 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCurrentView('explorar')}
          className={`pill-btn px-4 sm:px-5 py-2 text-base font-bold transition flex items-center gap-2 min-w-0 max-w-full break-words ${
            currentView === 'explorar'
              ? 'bg-club-orange text-white shadow-md'
              : 'bg-white text-club-brown hover:bg-amber-50 border border-amber-200/80'
          }`}
        >
          <i className="fa-solid fa-compass flex-shrink-0" /> <span>Cartelera</span>
        </button>

        {currentUser && (
          <>
            <button
              onClick={() => setCurrentView('agenda')}
              className={`pill-btn px-4 sm:px-5 py-2 text-base font-bold transition flex items-center gap-2 min-w-0 max-w-full break-words ${
                currentView === 'agenda'
                  ? 'bg-club-orange text-white shadow-md'
                  : 'bg-white text-club-brown hover:bg-amber-50 border border-amber-200/80'
              }`}
            >
              <i className="fa-solid fa-calendar-check flex-shrink-0" /> <span>Mi Agenda</span>
            </button>

            <button
              onClick={() => setCurrentView('mis-actividades')}
              className={`pill-btn px-4 sm:px-5 py-2 text-base font-bold transition flex items-center gap-2 min-w-0 max-w-full break-words ${
                currentView === 'mis-actividades'
                  ? 'bg-club-orange text-white shadow-md'
                  : 'bg-white text-club-brown hover:bg-amber-50 border border-amber-200/80'
              }`}
            >
              <i className="fa-solid fa-list-check flex-shrink-0" /> <span>Mis Actividades</span>
            </button>

            <button
              onClick={() => setCurrentView('chat')}
              className={`pill-btn px-4 sm:px-5 py-2 text-base font-bold transition flex items-center gap-2 min-w-0 max-w-full break-words ${
                currentView === 'chat'
                  ? 'bg-club-orange text-white shadow-md'
                  : 'bg-white text-club-brown hover:bg-amber-50 border border-amber-200/80'
              }`}
            >
              <i className="fa-solid fa-comments flex-shrink-0" /> <span>Mi Chat</span>
            </button>
          </>
        )}

        <button
          onClick={() => setCurrentView('resenas')}
          className={`pill-btn px-4 sm:px-5 py-2 text-base font-bold transition flex items-center gap-2 min-w-0 max-w-full break-words ${
            currentView === 'resenas'
              ? 'bg-club-orange text-white shadow-md'
              : 'bg-white text-club-brown hover:bg-amber-50 border border-amber-200/80'
          }`}
        >
          <i className="fa-solid fa-star text-amber-500 flex-shrink-0" /> <span>Reseñas</span>
        </button>

        <button
          onClick={() => setCurrentView('galeria')}
          className={`pill-btn px-4 sm:px-5 py-2 text-base font-bold transition flex items-center gap-2 min-w-0 max-w-full break-words ${
            currentView === 'galeria'
              ? 'bg-club-orange text-white shadow-md'
              : 'bg-white text-club-brown hover:bg-amber-50 border border-amber-200/80'
          }`}
        >
          <i className="fa-solid fa-images text-club-teal flex-shrink-0" /> <span>Galería</span>
        </button>

        {currentUser && (
          <>
            {currentUser.tipo === 'personal' && onProponerActividad && (
              <button
                onClick={onProponerActividad}
                className="pill-btn px-4 py-2 text-base bg-club-blue text-club-brown hover:bg-club-orange hover:text-white border border-club-teal/30 flex items-center gap-2 font-bold cursor-pointer min-w-0 max-w-full break-words"
              >
                <i className="fa-solid fa-plus-circle flex-shrink-0" /> <span>Proponer Actividad</span>
              </button>
            )}

            {currentUser.tipo === 'personal' && (
              <button
                onClick={() => setCurrentView('whatsapp-comunidad')}
                className={`pill-btn px-4 py-2 text-base flex items-center gap-2 font-bold cursor-pointer min-w-0 max-w-full break-words ${
                  currentView === 'whatsapp-comunidad'
                    ? 'bg-club-orange text-white shadow-sm'
                    : 'bg-white text-club-brown border border-amber-200 hover:bg-amber-50'
                }`}
              >
                <i className="fa-brands fa-whatsapp text-emerald-600 text-base flex-shrink-0" /> <span>Comunidad de WhatsApp</span>
              </button>
            )}

            {currentUser.tipo === 'institucional' && onPublicarActividad && (
              <button
                onClick={onPublicarActividad}
                className="pill-btn px-4 py-2 text-base bg-club-orange text-white flex items-center gap-2 font-bold sm:ml-auto shadow-sm cursor-pointer min-w-0 max-w-full break-words"
              >
                <i className="fa-solid fa-circle-plus flex-shrink-0" /> <span>Publicar actividad validada</span>
              </button>
            )}

            {currentUser.tipo === 'moderador' && (
              <button
                onClick={() => setCurrentView('moderacion')}
                className="pill-btn px-4 py-2 text-base bg-purple-700 text-white hover:bg-purple-800 flex items-center gap-2 font-bold sm:ml-auto shadow-sm cursor-pointer min-w-0 max-w-full break-words"
              >
                <i className="fa-solid fa-shield-halved flex-shrink-0" /> <span>Panel de Administración</span>{' '}
                {typeof pendingActivitiesCount === 'number' && (
                  <span className="bg-amber-400 text-purple-900 font-black text-sm px-2 py-0.5 rounded-full flex-shrink-0">
                    {pendingActivitiesCount}
                  </span>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </nav>
  );
}

export default Header;
