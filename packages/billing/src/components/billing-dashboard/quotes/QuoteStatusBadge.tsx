'use client';

import React from 'react';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { QUOTE_STATUS_METADATA, type QuoteStatus } from '@alga-psa/types';

interface QuoteStatusBadgeProps {
  status?: QuoteStatus | null;
  className?: string;
}

const QUOTE_STATUS_VARIANTS: Record<QuoteStatus, BadgeVariant> = {
  draft: 'secondary',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  expired: 'warning',
  converted: 'primary',
  cancelled: 'outline',
  superseded: 'default-muted',
  archived: 'outline',
};

const QuoteStatusBadge: React.FC<QuoteStatusBadgeProps> = ({ status = 'draft', className }) => {
  const resolvedStatus: QuoteStatus = status ?? 'draft';
  const metadata = QUOTE_STATUS_METADATA[resolvedStatus];

  return (
    <Badge variant={QUOTE_STATUS_VARIANTS[resolvedStatus]} className={className} title={metadata.description}>
      {metadata.label}
    </Badge>
  );
};

export default QuoteStatusBadge;
