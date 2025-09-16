'use client';

import React from 'react';
import { getCookie, setCookie } from 'cookies-next';
import { LOCALE_CONFIG } from '@/lib/i18n/config';

export function SimpleLanguageSwitcher() {
  const [currentLocale, setCurrentLocale] = React.useState('en');
  const [isOpen, setIsOpen] = React.useState(false);

  React.useEffect(() => {
    const locale = getCookie(LOCALE_CONFIG.cookie.name) || 'en';
    setCurrentLocale(locale as string);
  }, []);

  const handleLocaleChange = (locale: string) => {
    setCookie(LOCALE_CONFIG.cookie.name, locale, LOCALE_CONFIG.cookie);
    setCurrentLocale(locale);
    setIsOpen(false);
    // Reload to apply new locale
    window.location.reload();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
      >
        <span>{currentLocale.toUpperCase()}</span>
        <svg
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
          <button
            className={`block w-full px-4 py-2 text-sm text-left hover:bg-gray-100 ${
              currentLocale === 'en' ? 'bg-gray-50 font-semibold' : ''
            }`}
            onClick={() => handleLocaleChange('en')}
          >
            English
          </button>
          <button
            className={`block w-full px-4 py-2 text-sm text-left hover:bg-gray-100 ${
              currentLocale === 'fr' ? 'bg-gray-50 font-semibold' : ''
            }`}
            onClick={() => handleLocaleChange('fr')}
          >
            Français
          </button>
        </div>
      )}
    </div>
  );
}