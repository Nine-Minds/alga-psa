'use client';

import React from 'react';
import { readEntraContactLinkage, readEntraInactiveReason } from './entraContactLinkage';

interface EntraContactBadgeProps {
  contact: Record<string, unknown> | null | undefined;
  /** The list variant is one compact chip; detail shows the full provenance. */
  variant?: 'chip' | 'detail';
}

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toLocaleString();
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
  const linkage = readEntraContactLinkage(contact);
  if (!linkage.isLinked) {
    return null;
  }

  const inactiveReason = readEntraInactiveReason(contact);
  const lastSynced = formatDateTime(linkage.lastSyncedAt);

  if (variant === 'chip') {
    return (
      <span
        className="inline-flex flex-shrink-0 items-center rounded-full bg-[rgb(var(--color-border-100))] px-2 py-0.5 text-[10px] font-semibold text-[rgb(var(--color-text-500))]"
        id="entra-contact-chip"
        title={
          lastSynced
            ? `Microsoft Entra · last synced ${lastSynced}`
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
        <p>This contact is kept in step with a directory account.</p>
        {linkage.userPrincipalName ? (
          <p className="min-w-0 truncate" id="entra-contact-upn">
            Sign-in name: {linkage.userPrincipalName}
          </p>
        ) : null}
        {lastSynced ? <p id="entra-contact-last-synced">Last synced {lastSynced}</p> : null}
        {inactiveReason ? (
          <p className="font-medium text-[rgb(var(--color-text-700))]" id="entra-contact-inactive-reason">
            {inactiveReason === 'deleted_upstream'
              ? 'Inactive — the Microsoft account was deleted.'
              : 'Inactive — the Microsoft account is disabled.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default EntraContactBadge;
