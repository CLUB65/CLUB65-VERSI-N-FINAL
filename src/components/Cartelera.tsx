import React from 'react';
import { useUser } from '../context/UserContext.tsx';
import { findActiveSanctionForUser } from '../utils/reportsAndSanctions.ts';

export interface CarteleraProps {
  sanctionsList?: any[];
  onProponerActividad?: () => void;
  className?: string;
}

export function Cartelera({
  sanctionsList = [],
  className = ''
}: CarteleraProps) {
  const { currentUser } = useUser();

  if (!currentUser) {
    return null;
  }

  const currentSanction = findActiveSanctionForUser(sanctionsList || [], currentUser);

  if (!currentSanction) {
    return null;
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* CARTEL DE SANCIÓN ACTIVA */}
      <div className="p-4 sm:p-5 rounded-2xl bg-red-100 border-2 border-red-400 text-red-950 flex items-start gap-3 shadow-md mb-4">
        <span className="text-2xl select-none flex-shrink-0">🚫</span>
        <div className="flex-1 min-w-0 text-base leading-relaxed break-words">
          <p className="font-bold text-red-900 text-lg leading-snug">
            Cuenta con sanción activa ({currentSanction.type === 'permanente' ? 'Permanente' : 'Temporal'})
          </p>
          <p className="text-base text-red-800 mt-1 leading-relaxed">
            Motivo: <span className="font-semibold">{currentSanction.reason || currentSanction.motivo || 'Incumplimiento de normas comunitarias de CLUB65'}</span>.
          </p>
          <p className="text-base text-red-700 mt-1 font-medium leading-relaxed">
            Durante este período no tenés permitido enviar mensajes en chats ni crear nuevas actividades.
          </p>
        </div>
      </div>
    </div>
  );
}

export default Cartelera;
