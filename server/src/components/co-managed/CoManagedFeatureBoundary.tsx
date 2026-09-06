'use client';

import type { ReactNode } from 'react';
import type { ProductCode } from '@alga-psa/types';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

/** Presentation only. Never use this release flag in backend authorization. */
export function CoManagedFeatureBoundary({ children }: { children: ReactNode }) {
  const { enabled, loading, error } = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  if (enabled !== true || loading || error) return null;
  return <>{children}</>;
}

export function CoManagedWorkspaceBoundary({ children, productCode }: {
  children: ReactNode;
  productCode: ProductCode;
}) {
  return productCode === 'co_managed'
    ? <CoManagedFeatureBoundary>{children}</CoManagedFeatureBoundary>
    : <>{children}</>;
}
