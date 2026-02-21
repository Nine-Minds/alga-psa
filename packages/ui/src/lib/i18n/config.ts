/**
 * Re-export i18n config from @alga-psa/core (single source of truth).
 * This re-export exists so that consumers can import from '@alga-psa/ui/lib/i18n/config'
 * without changing existing import paths.
 */
export {
  LOCALE_CONFIG,
  I18N_CONFIG,
  PSEUDO_LOCALES,
  ROUTE_NAMESPACES,
  TRANSLATION_PATHS,
  filterPseudoLocales,
  getNamespacesForRoute,
  isSupportedLocale,
  getBestMatchingLocale,
} from '@alga-psa/core/i18n/config';

export type { SupportedLocale } from '@alga-psa/core/i18n/config';
