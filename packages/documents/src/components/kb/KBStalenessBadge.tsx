'use client';

import React from 'react';
import { Badge } from '@alga-psa/ui/components/Badge';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { AlertCircle, Clock } from 'lucide-react';

interface KBStalenessBadgeProps {
  nextReviewDue: Date | string | null;
  showDate?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export default function KBStalenessBadge({
  nextReviewDue,
  showDate = false,
  size = 'md',
  className = '',
}: KBStalenessBadgeProps) {
  const { t } = useTranslation('msp/knowledge-base');
  const { formatDate } = useFormatters();

  if (!nextReviewDue) {
    return null;
  }

  const dueDate = new Date(nextReviewDue);
  const now = new Date();
  const isOverdue = dueDate < now;

  // Calculate days until/past due
  const diffTime = dueDate.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  // Only show badge if overdue or due within 7 days
  if (!isOverdue && diffDays > 7) {
    return null;
  }

  const iconClass = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4';
  const badgeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : '';

  if (isOverdue) {
    return (
      <Badge
        className={`bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 ${badgeClass} ${className}`}
        title={t('staleness.tooltips.reviewOverdue', {
          defaultValue: 'Review was due {{date}}',
          date: formatDate(dueDate),
        })}
      >
        <AlertCircle className={`${iconClass} mr-1`} />
        {showDate ? (
          <span>{t('staleness.badges.overdueBy', {
            defaultValue: 'Overdue by {{count}} days',
            count: Math.abs(diffDays),
          })}</span>
        ) : (
          <span>{t('staleness.badges.reviewOverdue', { defaultValue: 'Review Overdue' })}</span>
        )}
      </Badge>
    );
  }

  // Due soon (within 7 days)
  return (
    <Badge
      className={`bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300 ${badgeClass} ${className}`}
      title={t('staleness.tooltips.reviewDue', {
        defaultValue: 'Review due {{date}}',
        date: formatDate(dueDate),
      })}
    >
      <Clock className={`${iconClass} mr-1`} />
      {showDate ? (
        <span>{t('staleness.badges.dueIn', {
          defaultValue: 'Due in {{count}} days',
          count: diffDays,
        })}</span>
      ) : (
        <span>{t('staleness.badges.reviewDueSoon', { defaultValue: 'Review Due Soon' })}</span>
      )}
    </Badge>
  );
}
