'use client';

import React from 'react';
import { ServiceAuthorBadge } from './ServiceAuthorBadge';

export interface ApiKeyPrincipalCellProps {
  /** The key owner's user type; only `service` owners get the principal rendering. */
  userType?: string | null;
  /** The owner's display name (a principal's name is stored as its first name). */
  displayName: string;
  /** Today's rendering, used for every key that is not principal-owned. */
  fallback?: React.ReactNode;
}

/** Owner cell of the admin API-keys table: principal name + "Service" badge for principal-owned keys. */
export function ApiKeyPrincipalCell({ userType, displayName, fallback }: ApiKeyPrincipalCellProps) {
  if (userType !== 'service') return <>{fallback ?? displayName}</>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{displayName}</span>
      <ServiceAuthorBadge />
    </span>
  );
}

export default ApiKeyPrincipalCell;
