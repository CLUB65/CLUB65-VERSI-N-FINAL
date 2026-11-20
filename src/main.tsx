import React, { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in CLUB65:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8F3EC] flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-6 sm:p-8 border-2 border-amber-300 shadow-xl text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 text-club-orange rounded-full flex items-center justify-center mx-auto text-2xl font-bold">
              <i className="fa-solid fa-triangle-exclamation" />
            </div>
            <h2 className="font-brand text-2xl font-bold text-club-brown">
              Algo no salió como esperábamos
            </h2>
            <p className="text-base text-stone-600 leading-relaxed">
              Ocurrió un error inesperado al cargar la pantalla. Podés intentar recargar la aplicación para continuar.
            </p>
            {this.state.error && (
              <pre className="text-sm bg-stone-100 p-3 rounded-xl text-stone-700 overflow-x-auto text-left max-h-32 leading-relaxed">
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="pill-btn w-full py-3 px-4 bg-club-orange hover:bg-club-orange-dark text-white font-bold text-base shadow-md cursor-pointer flex items-center justify-center gap-2"
            >
              <i className="fa-solid fa-arrow-rotate-right" /> Recargar CLUB65
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import { AuthProvider } from './context/AuthContext.tsx';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <AuthProvider>
      <App />
    </AuthProvider>
  </ErrorBoundary>
);
