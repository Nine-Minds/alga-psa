'use client';

/**
 * Per-credential History panel (EE-only, Pro tier).
 *
 * A compact, read-only timeline for one credential: "{actor} {operation} ·
 * {relative time}" with the value-free enrichment detail (changed field names,
 * grant deltas) as a secondary line. Mounted from the CredentialsScreen row
 * action, which only renders when the viewer has `credential:audit`; the
 * action's server-side read-scope is the enforcement.
 */

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  Eye,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  Trash2,
  Unlink,
  Users,
} from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatters } from '@alga-psa/ui/lib/i18n/client';
import { useCredentialAudit } from './useCredentialAudit';
import { useCredentialAuditLabels } from './credentialAuditLabels';
import type { CredentialAuditEventOperation } from '../../lib/actions/credentials/credentialAuditActions';

const OPERATION_ICONS: Record<CredentialAuditEventOperation, React.ComponentType<{ className?: string }>> = {
  credential_reveal: Eye,
  credential_otp_seed_reveal: KeyRound,
  credential_created: Plus,
  credential_updated: Pencil,
  credential_deleted: Trash2,
  credential_grants_changed: Users,
  credential_associated: Link2,
  credential_detached: Unlink,
  hudu_password_reveal: Eye,
};

export interface CredentialAuditPanelProps {
  credentialId: string;
}

export function CredentialAuditPanel({ credentialId }: CredentialAuditPanelProps) {
  const { t } = useTranslation('msp/credentials');
  const { operationLabel, actorLabel, detailLine } = useCredentialAuditLabels();
  const { formatRelativeTime, formatDate } = useFormatters();
  const { events, nextCursor, isLoading, loadError, loadMore } = useCredentialAudit({ credentialId });

  const formatTimestamp = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : `${formatRelativeTime(date)} · ${formatDate(date, { dateStyle: 'medium', timeStyle: 'short' })}`;
  };

  if (isLoading && !events) {
    return (
      <p id="credential-audit-panel-loading" className="text-sm text-[rgb(var(--color-text-500))]">
        {t('credentials.audit.loading')}
      </p>
    );
  }

  if (loadError && !events) {
    return (
      <Alert id="credential-audit-panel-error" variant="destructive">
        <AlertDescription>{t('credentials.audit.error')}</AlertDescription>
      </Alert>
    );
  }

  if (events && events.length === 0) {
    return (
      <p id="credential-audit-panel-empty" className="text-sm text-[rgb(var(--color-text-500))] py-1">
        {t('credentials.audit.empty')}
      </p>
    );
  }

  return (
    <div id="credential-audit-panel" className="space-y-3">
      <ul className="divide-y divide-[rgb(var(--color-border-100))]">
        {(events ?? []).map((event) => {
          const Icon = OPERATION_ICONS[event.operation] ?? Eye;
          const detail = detailLine(event);
          return (
            <li key={event.auditId} className="flex items-start gap-3 py-2">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))]">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium text-[rgb(var(--color-text-900))]">
                    {actorLabel(event.actor)}
                  </span>
                  <span className="text-[rgb(var(--color-text-700))]">
                    {operationLabel(event.operation, event.entity?.type)}
                  </span>
                </div>
                <div className="text-xs text-[rgb(var(--color-text-500))]">
                  {formatTimestamp(event.timestamp)}
                </div>
                {detail && (
                  <div id={`credential-audit-detail-${event.auditId}`} className="mt-0.5 text-xs text-[rgb(var(--color-text-700))]">
                    {detail}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {loadError && (
        <Alert id="credential-audit-panel-more-error" variant="destructive">
          <AlertDescription>{t('credentials.audit.error')}</AlertDescription>
        </Alert>
      )}
      {nextCursor !== null && (
        <div className="flex justify-center">
          <Button
            id="credential-audit-panel-load-more"
            variant="outline"
            size="sm"
            onClick={() => void loadMore()}
            disabled={isLoading}
          >
            {t('credentials.audit.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

export default CredentialAuditPanel;
