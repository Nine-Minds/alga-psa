// Locale configuration for the email package.
//
// This file previously held a hand-copied subset of the i18n config to break the
// email -> ui dependency cycle. The canonical config now lives in
// @alga-psa/core (extracted from ui for the same reason), which this package
// already depends on, so re-export it instead of maintaining a drifting copy.
export {
  LOCALE_CONFIG,
  PSEUDO_LOCALES,
  getTranslationLanguageCode,
  isSupportedLocale,
  normalizeLocale,
} from '@alga-psa/core/i18n/config';
export type { SupportedLocale } from '@alga-psa/core/i18n/config';

import {
  LOCALE_CONFIG,
  PSEUDO_LOCALES,
  getTranslationLanguageCode,
  type SupportedLocale,
} from '@alga-psa/core/i18n/config';

/**
 * The locales an email or notification template ships copy for.
 *
 * Templates carry written copy, so they are stored per *language pack* rather
 * than per selectable locale. That is narrower than `supportedLocales` in two
 * ways: a regional variant (`en-AU`) has no pack of its own and renders the
 * language it falls back to, and the `xx`/`yy` pseudo-locales are QA fills that
 * must never reach a recipient's mailbox. Seeding either would write duplicate
 * or unreadable rows into every tenant's template table.
 *
 * The migrations keep their own copy of this list (they are `.cjs` and cannot
 * import this module); `templateLocaleParity.test.ts` holds the two in step.
 */
export const TEMPLATE_LOCALES: readonly SupportedLocale[] = [
  ...new Set(
    LOCALE_CONFIG.supportedLocales
      .filter((locale) => !(PSEUDO_LOCALES as readonly string[]).includes(locale))
      .map((locale) => getTranslationLanguageCode(locale)),
  ),
];
