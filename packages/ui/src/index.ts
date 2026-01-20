// Root index for @alga-psa/ui
// Warning: Importing from this root index in server-side code or instrumentation
// may pull in client components and cause build/runtime errors.
// Prefer importing from specific subpaths like @alga-psa/ui/lib/utils.

export { cn } from './lib/utils';
export { throwPermissionError, handleError } from './lib/errorHandling';
export { getDateFnsLocale } from './lib/dateFnsLocale';
export { useToast } from './hooks/use-toast';
export { useFeatureFlag } from './hooks/useFeatureFlag';
export { useTagPermissions } from './hooks/useTagPermissions';
export { useTenant } from './components/providers/TenantProvider';
export { DrawerProvider, useDrawer } from './context/DrawerContext';

// Tag utilities
import type { ITag } from '@alga-psa/types';
export const getUniqueTagTexts = (tags: ITag[]): string[] => {
  const uniqueTags = new Set<string>();
  tags.forEach(tag => uniqueTags.add(tag.tag_text));
  return Array.from(uniqueTags).sort();
};

export * from './ui-reflection';
export * from './context';
export * from './editor';
export * from './services';
