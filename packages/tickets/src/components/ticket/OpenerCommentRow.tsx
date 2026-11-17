'use client';

import React from 'react';
import { Mail } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { withDataAutomationId } from '@alga-psa/ui/ui-reflection/withDataAutomationId';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';

export interface OpenerCommentRowProps {
  /** Automation/DOM id; the same id the full comment uses, so #comment-… anchors still resolve. */
  id: string;
  senderName: string;
  /** Shown in angle brackets when it differs from the name. Callers pass null where it is redacted (portal). */
  senderAddress?: string | null;
  createdAt?: string | Date | null;
  attachmentCount?: number | null;
  variant?: 'default' | 'compact';
  accentBorderClassName?: string;
  onExpand: () => void;
}

/** One-line stand-in for the comment that opened a ticket by email. */
export const OpenerCommentRow: React.FC<OpenerCommentRowProps> = ({
  id,
  senderName,
  senderAddress,
  createdAt,
  attachmentCount,
  variant = 'default',
  accentBorderClassName,
  onExpand,
}) => {
  const { t } = useTranslation('features/tickets');
  const { formatDate } = useFormatters();
  const isCompact = variant === 'compact';
  const showAddress = Boolean(senderAddress) && (senderAddress ?? '').toLowerCase() !== senderName.trim().toLowerCase();
  const showLabel = t('conversation.opener.show', 'Show original email');

  return (
    <div
      {...withDataAutomationId({ id })}
      className={`flex w-full max-w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-gray-500 dark:text-[rgb(var(--color-text-400))] ${
        isCompact
          ? `border-l-2 rounded-r-md pl-3 pr-2 py-1 ${accentBorderClassName ?? 'border-gray-200 dark:border-[rgb(var(--color-border-200))]'}`
          : 'rounded-lg border border-dashed border-gray-200 dark:border-[rgb(var(--color-border-200))] px-3 py-1.5 mb-2'
      }`}
    >
      <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">
        {t('conversation.opener.openedBy', { sender: senderName, defaultValue: 'Opened by email from {{sender}}' })}
        {showAddress && <span {...withDataAutomationId({ id: `${id}-opener-address` })}> ‹{senderAddress}›</span>}
      </span>
      {createdAt && (
        <span className="shrink-0 whitespace-nowrap">
          · {formatDate(new Date(createdAt), isCompact
            ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
            : { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      )}
      {attachmentCount ? (
        <span className="shrink-0 whitespace-nowrap">
          · {t('conversation.opener.attachments', { count: attachmentCount, defaultValue: '{{count}} attachments' })}
        </span>
      ) : null}
      <span aria-hidden="true">·</span>
      <Button
        id={`${id}-opener-toggle`}
        type="button"
        variant="link"
        size="sm"
        className="h-auto p-0 text-sm font-medium"
        aria-expanded={false}
        onClick={onExpand}
      >
        {showLabel}
      </Button>
    </div>
  );
};

export default OpenerCommentRow;
