/**
 * Language Switcher Component
 * Can be used in both MSP and Client portals
 */

'use client';

import React, { useState } from 'react';
import { useI18n } from '@alga-psa/ui/lib/i18n/client';
import type { SupportedLocale } from '@alga-psa/ui/lib/i18n/config';

interface LanguageSwitcherProps {
  /** Visual variant of the switcher */
  variant?: 'dropdown' | 'buttons' | 'minimal';
  /** Portal context - affects where preferences are saved */
  portal?: 'msp' | 'client';
  /** Additional CSS classes */
  className?: string;
  /** Show language names instead of codes */
  showNames?: boolean;
  /** Show flags (requires flag icons to be available) */
  showFlags?: boolean;
  /** Callback when language changes */
  onChange?: (locale: SupportedLocale) => void;
}

export function LanguageSwitcher({
  variant = 'dropdown',
  portal = 'client',
  className = '',
  showNames = true,
  showFlags = false,
  onChange,
}: LanguageSwitcherProps) {
  const { locale, setLocale, supportedLocales, localeNames } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [isChanging, setIsChanging] = useState(false);

  const handleLocaleChange = async (newLocale: SupportedLocale) => {
    if (newLocale === locale || isChanging) return;

    setIsChanging(true);
    try {
      await setLocale(newLocale);
      onChange?.(newLocale);
      setIsOpen(false);
    } finally {
      setIsChanging(false);
    }
  };

  const getLocaleDisplay = (loc: SupportedLocale) => {
    if (showNames) {
      return localeNames[loc] || loc.toUpperCase();
    }
    return loc.toUpperCase();
  };

  // Dropdown variant
  if (variant === 'dropdown') {
    return (
      <div className={`relative ${className}`}>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isChanging}
          aria-label="Select language"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          {showFlags && (
            <span className="text-lg" role="img" aria-hidden="true">
              {getFlagEmoji(locale)}
            </span>
          )}
          <span>{getLocaleDisplay(locale)}</span>
          <svg
            className={`w-4 h-4 ml-1 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg">
            <ul className="py-1" role="listbox">
              {supportedLocales.map((loc) => (
                <li key={loc} role="option" aria-selected={loc === locale}>
                  <button
                    type="button"
                    className={`w-full px-3 py-2 text-sm text-left hover:bg-gray-100 focus:bg-gray-100 focus:outline-none ${
                      loc === locale ? 'bg-gray-50 font-semibold' : ''
                    }`}
                    onClick={() => handleLocaleChange(loc)}
                    disabled={isChanging || loc === locale}
                  >
                    <div className="flex items-center gap-2">
                      {showFlags && (
                        <span className="text-lg" role="img" aria-hidden="true">
                          {getFlagEmoji(loc)}
                        </span>
                      )}
                      <span>{getLocaleDisplay(loc)}</span>
                      {loc === locale && (
                        <svg
                          className="w-4 h-4 ml-auto text-indigo-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // Buttons variant
  if (variant === 'buttons') {
    return (
      <div className={`flex gap-2 ${className}`} role="group" aria-label="Select language">
        {supportedLocales.map((loc) => (
          <button
            key={loc}
            type="button"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              loc === locale
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            onClick={() => handleLocaleChange(loc)}
            disabled={isChanging || loc === locale}
            aria-pressed={loc === locale}
          >
            {showFlags && (
              <span className="mr-1" role="img" aria-hidden="true">
                {getFlagEmoji(loc)}
              </span>
            )}
            {getLocaleDisplay(loc)}
          </button>
        ))}
      </div>
    );
  }

  // Minimal variant
  return (
    <div className={`inline-flex items-center gap-1 text-sm ${className}`}>
      {supportedLocales.map((loc, index) => (
        <React.Fragment key={loc}>
          {index > 0 && <span className="text-gray-400">|</span>}
          <button
            type="button"
            className={`px-1 hover:underline ${
              loc === locale ? 'font-semibold text-indigo-600' : 'text-gray-600'
            }`}
            onClick={() => handleLocaleChange(loc)}
            disabled={isChanging || loc === locale}
            aria-pressed={loc === locale}
          >
            {showNames ? localeNames[loc] : loc.toUpperCase()}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

/**
 * Helper function to get flag emoji for a locale
 */
function getFlagEmoji(locale: string): string {
  const flags: Record<string, string> = {
    en: '🇬🇧',
    fr: '🇫🇷',
    es: '🇪🇸',
    de: '🇩🇪',
    it: '🇮🇹',
    pt: '🇵🇹',
    ja: '🇯🇵',
    zh: '🇨🇳',
    ar: '🇸🇦',
    he: '🇮🇱',
  };
  return flags[locale] || '🌐';
}