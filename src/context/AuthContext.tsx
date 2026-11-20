import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { User } from '../types.ts';
import { api } from '../api.ts';

export interface AuthContextType {
  currentUser: User | null;
  user: User | null; // Alias para compatibilidad de nomenclatura
  loading: boolean;
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>;
  setUser: React.Dispatch<React.SetStateAction<User | null>>;
  refreshUser: (forceRefresh?: boolean) => Promise<User | null>;
  login: (usuarioOrEmail: string, clave: string) => Promise<User>;
  register: (data: any) => Promise<User>;
  logout: () => Promise<void>;
  updateCurrentUserProfile: (updates: Partial<User>) => Promise<User>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
export const UserContext = AuthContext;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Obtención centralizada única al iniciar la aplicación (una sola vez)
  useEffect(() => {
    let isMounted = true;
    async function loadInitialUser() {
      try {
        const user = await api.getMe();
        if (isMounted) {
          setCurrentUser(user);
        }
      } catch (err) {
        console.error('Error al inicializar sesión en AuthContext:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }
    loadInitialUser();
    return () => {
      isMounted = false;
    };
  }, []);

  const refreshUser = useCallback(async (forceRefresh = true) => {
    try {
      const refreshed = await api.getMe(forceRefresh);
      setCurrentUser(refreshed);
      return refreshed;
    } catch (err) {
      console.warn('Error al refrescar usuario actual:', err);
      return null;
    }
  }, []);

  const login = useCallback(async (usuarioOrEmail: string, clave: string) => {
    const user = await api.login(usuarioOrEmail, clave);
    setCurrentUser(user);
    return user;
  }, []);

  const register = useCallback(async (data: any) => {
    const user = await api.register(data);
    if (user.tipo === 'institucional' && user.estadoAlta !== 'aprobada') {
      setCurrentUser(null);
    } else {
      setCurrentUser(user);
    }
    return user;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setCurrentUser(null);
  }, []);

  const updateCurrentUserProfile = useCallback(async (updates: Partial<User>) => {
    const updated = await api.updateProfile(updates);
    setCurrentUser(updated);
    return updated;
  }, []);

  const value: AuthContextType = {
    currentUser,
    user: currentUser,
    loading,
    setCurrentUser,
    setUser: setCurrentUser,
    refreshUser,
    login,
    register,
    logout,
    updateCurrentUserProfile
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe ser utilizado dentro de un AuthProvider / UserProvider');
  }
  return context;
}

export function useUser(): AuthContextType {
  return useAuth();
}
