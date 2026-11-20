import React from 'react';
import { useUser } from '../context/UserContext.tsx';
import { User } from '../types.ts';

export interface AvatarProps {
  user?: User | null;
  avatarUrl?: string | null;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  showVerified?: boolean;
}

export function Avatar({
  user,
  avatarUrl,
  name,
  size = 'md',
  className = '',
  onClick,
  showVerified = false
}: AvatarProps) {
  const { currentUser } = useUser();
  const effectiveUser = user !== undefined ? user : currentUser;
  const [imgError, setImgError] = React.useState(false);

  const resolvedAvatar = avatarUrl !== undefined
    ? (avatarUrl || '')
    : (effectiveUser?.avatar || '');

  React.useEffect(() => {
    setImgError(false);
  }, [resolvedAvatar]);

  const resolvedName = name !== undefined
    ? name
    : (effectiveUser?.apodo || effectiveUser?.usuario || 'Vecino');

  const initial = (resolvedName || 'U').charAt(0).toUpperCase();

  const sizeClasses: Record<string, string> = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-7 h-7 text-xs',
    md: 'w-9 h-9 text-sm',
    lg: 'w-12 h-12 text-base',
    xl: 'w-16 h-16 text-xl'
  };

  const selectedSize = sizeClasses[size] || sizeClasses.md;

  // Determinar rol y tipo de insignia de verificación:
  // - Administrador (tipo 'moderador'): Tilde violeta del dashboard (text-purple-700)
  // - Institucional (tipo 'institucional' y verificado): Tilde azul (text-blue-600)
  // - Personal (tipo 'personal'): SIN tilde de verificación
  const userType = effectiveUser?.tipo || effectiveUser?.rol;
  const isAdmin = userType === 'moderador' || userType === 'admin';
  const isInstitucional = userType === 'institucional';
  const isPersonal = userType === 'personal';

  let badgeColor = '';
  let badgeTitle = '';
  if (isAdmin) {
    badgeColor = 'text-purple-700';
    badgeTitle = 'Administrador Oficial Verificado';
  } else if (isInstitucional && (showVerified || (effectiveUser?.isVerified ?? false))) {
    badgeColor = 'text-blue-600';
    badgeTitle = 'Institución Verificada';
  } else if (!isPersonal && showVerified) {
    badgeColor = 'text-blue-600';
    badgeTitle = 'Verificado';
  }

  const badgeSizeClass = size === 'xs' ? 'text-[8px] w-2.5 h-2.5' : (size === 'lg' || size === 'xl' ? 'text-xs w-4 h-4' : 'text-[10px] w-3.5 h-3.5');

  return (
    <div className={`relative inline-flex items-center justify-center flex-shrink-0 ${className}`}>
      {resolvedAvatar && resolvedAvatar.trim() !== '' && !imgError ? (
        <img
          src={resolvedAvatar}
          alt={resolvedName}
          className={`${selectedSize} rounded-full object-cover border border-club-orange ${onClick ? 'cursor-pointer hover:opacity-90' : ''}`}
          onClick={onClick}
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className={`${selectedSize} rounded-full bg-club-orange text-white font-bold flex items-center justify-center border border-club-orange select-none ${onClick ? 'cursor-pointer hover:bg-club-orange-dark' : ''}`}
          onClick={onClick}
        >
          {initial}
        </div>
      )}
      {badgeColor && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 ${badgeColor} bg-white rounded-full flex items-center justify-center shadow-xs ${badgeSizeClass}`}
          title={badgeTitle}
        >
          <i className="fa-solid fa-circle-check" />
        </span>
      )}
    </div>
  );
}

export default Avatar;
