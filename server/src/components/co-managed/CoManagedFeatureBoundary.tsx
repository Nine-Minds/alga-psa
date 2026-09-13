'use client';

import type { ReactNode } from 'react';
import type { ProductCode } from '@alga-psa/types';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import CoManagedAcceptanceBoundary from './CoManagedAcceptanceBoundary';

/**
 * Presentation only. Never use this release flag in backend authorization.
 *
 * `fallback` renders once the flag has *resolved* to unavailable. It stays
 * unrendered while the flag is still loading so a transient default-off never
 * flashes it. Callers that add feature UI beside existing UI can omit it (the
 * block simply disappears); callers that *replace* a whole route with feature
 * UI must supply one, or the route renders blank when the flag is off.
 */
export function CoManagedFeatureBoundary({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { enabled, loading, error } = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  if (loading) return null;
  if (enabled !== true || error) return <>{fallback ?? null}</>;
  return <>{children}</>;
}

export function CoManagedWorkspaceBoundary({ children, productCode, requireAcceptance = false }: {
  children: ReactNode;
  productCode: ProductCode;
  requireAcceptance?: boolean;
}) {
  return productCode === 'co_managed'
    ? <CoManagedFeatureBoundary>{requireAcceptance
      ? <CoManagedAcceptanceBoundary>{children}</CoManagedAcceptanceBoundary> : children}</CoManagedFeatureBoundary>
    : <>{children}</>;
}
