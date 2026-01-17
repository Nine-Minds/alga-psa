/**
 * Next.js middleware for i18n locale resolution
 * This runs on every request to ensure proper locale detection
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  LOCALE_CONFIG,
  isSupportedLocale,
  getBestMatchingLocale,
  type SupportedLocale
} from './i18nConfig';

/**
 * Extract locale from URL path
 */
function getLocaleFromPath(pathname: string): SupportedLocale | null {
  const segments = pathname.split('/');
  const potentialLocale = segments[1];

  if (potentialLocale && isSupportedLocale(potentialLocale)) {
    return potentialLocale;
  }

  return null;
}

/**
 * Detect best locale for the request
 */
function detectLocale(request: NextRequest): SupportedLocale {
  // 1. Check if locale is in the URL path
  const pathLocale = getLocaleFromPath(request.nextUrl.pathname);
  if (pathLocale) {
    return pathLocale;
  }

  // 2. Check cookie
  const localeCookie = request.cookies.get(LOCALE_CONFIG.cookie.name);
  if (localeCookie?.value && isSupportedLocale(localeCookie.value)) {
    return localeCookie.value;
  }

  // 3. Check Accept-Language header
  const acceptLanguage = request.headers.get('accept-language');
  if (acceptLanguage) {
    const preferredLocales = acceptLanguage
      .split(',')
      .map((lang) => lang.split(';')[0].trim());
    return getBestMatchingLocale(preferredLocales);
  }

  // 4. Default locale
  return LOCALE_CONFIG.defaultLocale as SupportedLocale;
}

/**
 * i18n middleware for locale resolution
 * Sets locale cookie and adds locale header for server components
 */
export function i18nMiddleware(request: NextRequest, response: NextResponse = NextResponse.next()) {
  const locale = detectLocale(request);

  // Set locale cookie if not already set or different
  const currentLocaleCookie = request.cookies.get(LOCALE_CONFIG.cookie.name);
  if (currentLocaleCookie?.value !== locale) {
    response.cookies.set(LOCALE_CONFIG.cookie.name, locale, {
      maxAge: LOCALE_CONFIG.cookie.maxAge,
      sameSite: LOCALE_CONFIG.cookie.sameSite,
      secure: LOCALE_CONFIG.cookie.secure,
      path: '/',
    });
  }

  // Add locale header for server components
  response.headers.set('x-locale', locale);

  // Add vary header for proper caching
  const vary = response.headers.get('vary');
  if (vary) {
    response.headers.set('vary', `${vary}, Accept-Language`);
  } else {
    response.headers.set('vary', 'Accept-Language');
  }

  return response;
}

/**
 * Paths that should skip i18n middleware
 */
export const i18nExcludedPaths = [
  '/api',
  '/_next',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.json',
];

/**
 * Check if a path should skip i18n middleware
 */
export function shouldSkipI18n(pathname: string): boolean {
  return i18nExcludedPaths.some((path) => pathname.startsWith(path));
}
