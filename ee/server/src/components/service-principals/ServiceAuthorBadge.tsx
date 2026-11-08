'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export interface ServiceAuthorBadgeProps {
  className?: string;
}

/** The "Service" badge on a comment or activity authored by a service principal (PRD R5.7). */
export function ServiceAuthorBadge({ className }: ServiceAuthorBadgeProps) {
  const { t } = useTranslation('msp/settings');
  return (
    <Badge variant="info" size="sm" className={className} data-testid="service-author-badge">
      {t('servicePrincipals.badge.service', { defaultValue: 'Service' })}
    </Badge>
  );
}

export default ServiceAuthorBadge;
