'use client';

import type { ReactNode } from 'react';

/**
 * CE stub for the principal cell in the API keys table
 * (ee/server/src/components/service-principals/ApiKeyPrincipalCell.tsx, resolved via the
 * edition-swapped `@enterprise` alias). Renders nothing in Community Edition.
 */

export interface ApiKeyPrincipalCellProps {
  userType?: string | null;
  displayName?: string;
  /** What CE renders: the key owner exactly as today. */
  fallback?: ReactNode;
  [key: string]: unknown;
}

export function ApiKeyPrincipalCell({ fallback }: ApiKeyPrincipalCellProps) {
  return <>{fallback ?? null}</>;
}

export default ApiKeyPrincipalCell;
