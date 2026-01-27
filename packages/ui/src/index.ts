// @alga-psa/ui - Buildable exports only
// This index exports code that can be pre-built (no 'use client' directives, pure utilities)
//
// For runtime code (React components, hooks, etc.), import from specific paths:
//   - Components: @alga-psa/ui/components
//   - Hooks: @alga-psa/ui/hooks
//   - Editor: @alga-psa/ui/editor
//   - UI Reflection (runtime): @alga-psa/ui/ui-reflection
//   - i18n client: @alga-psa/ui/lib/i18n/client
//   - Services: @alga-psa/ui/services
//   - Context: @alga-psa/ui/context

// === Buildable lib utilities ===
export { cn, filterTagsByText } from './lib/utils';
export { generateEntityColor, generateAvatarColor, type ColorResult } from './lib/colorUtils';

// === Buildable i18n config (no React) ===
export {
  LOCALE_CONFIG,
  I18N_CONFIG,
  TRANSLATION_PATHS,
  isSupportedLocale,
  getBestMatchingLocale,
  type SupportedLocale,
} from './lib/i18n/config';
export { interpolateFallback } from './lib/i18n/interpolateFallback';

// === Buildable UI reflection types and builders (no React) ===
export * from './ui-reflection/types';
export * from './ui-reflection/actionBuilders';

// === Tag utilities (pure function) ===
import type { ITag } from '@alga-psa/types';
export const getUniqueTagTexts = (tags: ITag[]): string[] => {
  const uniqueTags = new Set<string>();
  tags.forEach(tag => uniqueTags.add(tag.tag_text));
  return Array.from(uniqueTags).sort();
};

// === Runtime exports (re-exported for backward compatibility) ===
// These are React components/hooks that require 'use client'
// Prefer importing from specific subpaths for better tree-shaking

// Context - Drawer
export { DrawerProvider, useDrawer } from './context/DrawerContext';

// Context - Unsaved Changes
export { UnsavedChangesProvider, useUnsavedChanges, useRegisterUnsavedChanges } from './context/UnsavedChangesContext';

// Hooks - Toast
export { useToast } from './hooks/use-toast';

// Lib - Error handling
export { handleError } from './lib/errorHandling';

// Lib - Date locale
export { getDateFnsLocale } from './lib/dateFnsLocale';
