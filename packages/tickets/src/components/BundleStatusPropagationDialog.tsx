'use client';

import React from 'react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type {
  BundlePropagationChild,
  BundleStatusPropagationPreview,
} from '../lib/ticketBundlePropagation';

interface BundleStatusPropagationDialogProps {
  isOpen: boolean;
  preview: BundleStatusPropagationPreview | null;
  isSubmitting?: boolean;
  onCancel: () => void;
  onMasterOnly: () => void;
  onPropagate: () => void;
}

function childLabel(child: BundlePropagationChild): string {
  const identifier = child.ticket_number ?? child.ticket_id;
  return child.title ? `${identifier} — ${child.title}` : identifier;
}

function ChildList({ children }: { children: BundlePropagationChild[] }) {
  return (
    <ul className="max-h-48 overflow-y-auto rounded-md border border-[rgb(var(--color-border-200))] divide-y divide-[rgb(var(--color-border-200))]">
      {children.map((child) => (
        <li key={child.ticket_id} className="px-3 py-1.5 text-sm text-[rgb(var(--color-text-700))]">
          {childLabel(child)}
        </li>
      ))}
    </ul>
  );
}

/**
 * FR8 — confirmation shown before a sync-mode bundle master status change
 * closes or reopens child tickets. Built on ConfirmationDialog so it carries
 * propagate (confirm) / master-only (third button) / cancel.
 */
export function BundleStatusPropagationDialog({
  isOpen,
  preview,
  isSubmitting,
  onCancel,
  onMasterOnly,
  onPropagate,
}: BundleStatusPropagationDialogProps) {
  const { t } = useTranslation('features/tickets');
  const isClose = preview?.crossesBoundary === 'close';
  const affected = preview?.affectedChildren ?? [];
  const count = affected.length;
  const independentlyClosed = (preview?.unaffectedChildren ?? []).filter(
    (child) => child.reason === 'independently_closed',
  );

  const message = isClose ? (
    <div className="space-y-3">
      <p>{t('details.bundle.propagation.closeBody', { count })}</p>
      <ChildList>{affected}</ChildList>
      <p className="text-xs text-amber-600 dark:text-amber-400">
        {t('details.bundle.propagation.boardRulesNote')}
      </p>
    </div>
  ) : (
    <div className="space-y-3">
      <p>{t('details.bundle.propagation.reopenBody', { count })}</p>
      <ChildList>{affected}</ChildList>
      {independentlyClosed.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-[rgb(var(--color-text-500))]">
            {t('details.bundle.propagation.stayClosedHeading')}
          </p>
          <ul className="space-y-0.5">
            {independentlyClosed.map((child) => (
              <li key={child.ticket_id} className="text-xs text-[rgb(var(--color-text-500))]">
                {childLabel(child)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <ConfirmationDialog
      id="bundle-status-propagation-dialog"
      isOpen={isOpen && preview !== null}
      onClose={onCancel}
      onConfirm={onPropagate}
      onCancel={onMasterOnly}
      title={
        isClose
          ? t('details.bundle.propagation.closeTitle', { count })
          : t('details.bundle.propagation.reopenTitle', { count })
      }
      message={message}
      confirmLabel={
        isClose
          ? t('details.bundle.propagation.closeConfirm', { count })
          : t('details.bundle.propagation.reopenConfirm', { count })
      }
      thirdButtonLabel={
        isClose
          ? t('details.bundle.propagation.masterOnlyClose')
          : t('details.bundle.propagation.masterOnlyReopen')
      }
      cancelLabel={t('actions.cancel', 'Cancel')}
      isConfirming={isSubmitting}
    />
  );
}
