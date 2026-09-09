// Locale configuration for the email package.
//
// This file previously held a hand-copied subset of the i18n config to break the
// email -> ui dependency cycle. The canonical config now lives in
// @alga-psa/core (extracted from ui for the same reason), which this package
// already depends on, so re-export it instead of maintaining a drifting copy.
export { LOCALE_CONFIG, isSupportedLocale, normalizeLocale } from '@alga-psa/core/i18n/config';
export type { SupportedLocale } from '@alga-psa/core/i18n/config';
