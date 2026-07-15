'use client';

import { useTranslation } from 'react-i18next';
import type { ProjectBillingScheduleStatus } from '@alga-psa/types';
import { statusVisual } from './billingViewHelpers';

const STATUS_LABEL_FALLBACK: Record<ProjectBillingScheduleStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  approved: 'Approved',
  invoiced: 'Invoiced',
  canceled: 'Canceled',
};

interface StatusChipProps {
  status: ProjectBillingScheduleStatus;
  id?: string;
}

/** Status pill used across the schedule table and phase context. */
export default function StatusChip({ status, id }: StatusChipProps) {
  const { t } = useTranslation('features/projects');
  const visual = statusVisual(status);
  return (
    <span
      id={id}
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${visual.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${visual.dot}`} />
      {t(`billing.status.${status}`, STATUS_LABEL_FALLBACK[status])}
    </span>
  );
}
