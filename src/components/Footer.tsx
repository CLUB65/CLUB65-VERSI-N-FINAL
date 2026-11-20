import React from 'react';

export const CLUB65_FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61596245219445';

export interface FooterProps {
  isDarkMode?: boolean;
  onBrandClick?: () => void;
}

export function Footer(_props: FooterProps) {
  return (
    <footer className="bg-club-cream border-t-2 border-amber-200/60 retro-shadow relative z-20">
      <div className="w-full px-4 sm:px-6 md:px-8 py-4 sm:py-5 flex flex-col sm:flex-row items-center justify-center sm:justify-end gap-4">
        {/* INFORMACIÓN PROPIA Y REDES */}
        <div className="flex flex-wrap items-center justify-center sm:justify-end gap-3 sm:gap-5">
          <div className="flex items-center gap-2 text-sm sm:text-base font-semibold text-club-brown/80 text-center sm:text-right">
            <span>CLUB65 · Plataforma Vecinal +65</span>
          </div>

          <span
            aria-hidden="true"
            className="hidden sm:inline-block h-5 w-px bg-amber-300/70 dark:bg-[#3E4D63]"
          />

          <a
            href={CLUB65_FACEBOOK_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visitar página de CLUB65 en Facebook"
            title="Seguinos en Facebook"
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white hover:bg-amber-50 border border-amber-200/80 hover:border-amber-300 text-club-teal hover:text-club-brown shadow-2xs flex-shrink-0 transition-all duration-300 ease-out hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-club-orange"
          >
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
              className="w-4 h-4"
            >
              <path d="M13.5 21v-7.5h2.55l.38-3H13.5V8.58c0-.87.24-1.46 1.49-1.46h1.59V4.44c-.28-.04-1.22-.12-2.32-.12-2.3 0-3.87 1.4-3.87 3.98v2.2H7.8v3h2.59V21h3.11Z" />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  );
}

export default Footer;
