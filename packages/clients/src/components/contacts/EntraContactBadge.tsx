'use client';

import React from 'react';
import { useTranslation, useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { readEntraContactLinkage, readEntraInactiveReason } from './entraContactLinkage';

interface EntraContactBadgeProps {
  contact: Record<string, unknown> | null | undefined;
  /** The list variant is one compact chip; detail shows the full provenance. */
  variant?: 'chip' | 'detail';
}

function formatDateTime(value: string | null, formatDate: ReturnType<typeof useFormatters>['formatDate']): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : formatDate(new Date(parsed), { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
}

/**
 * Says a contact is maintained by Microsoft Entra, and when it was last
 * checked. Renders nothing for contacts that are not linked, which is every
 * contact outside an Entra tenant — this is additive to a shared surface.
 */
export function EntraContactBadge({
  contact,
  variant = 'chip',
}: EntraContactBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation('msp/contacts');
  const { formatDate } = useFormatters();
  const linkage = readEntraContactLinkage(contact);
  if (!linkage.isLinked) {
    return null;
  }

  const inactiveReason = readEntraInactiveReason(contact);
  const lastSynced = formatDateTime(linkage.lastSyncedAt, formatDate);

  if (variant === 'chip') {
    return (
      <span
        className="inline-flex flex-shrink-0 items-center rounded-full bg-[rgb(var(--color-border-100))] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--color-text-500))]"
        id="entra-contact-chip"
        title={
          lastSynced
            ? t('entraContactBadge.lastSyncedTitle', { date: lastSynced })
            : 'Microsoft Entra'
        }
      >
        Entra
      </span>
    );
  }

  return (
    <div
      className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-border-50))] p-3"
      id="entra-contact-provenance"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-[rgb(var(--color-text-400))]">
        Microsoft Entra
      </p>
      <div className="mt-1 space-y-0.5 text-sm text-[rgb(var(--color-text-600))]">
        <p>{t('entraContactBadge.description')}</p>
        {linkage.userPrincipalName ? (
          <p className="min-w-0 truncate" id="entra-contact-upn">
            {t('entraContactBadge.signInName', { name: linkage.userPrincipalName })}
          </p>
        ) : null}
        {lastSynced ? <p id="entra-contact-last-synced">{t('entraContactBadge.lastSynced', { date: lastSynced })}</p> : null}
        {inactiveReason ? (
          <p className="font-medium text-[rgb(var(--color-text-700))]" id="entra-contact-inactive-reason">
            {inactiveReason === 'deleted_upstream'
              ? t('entraContactBadge.deleted')
              : t('entraContactBadge.disabled')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default EntraContactBadge;
