'use client';

import { Button } from '@alga-psa/ui/components/Button';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedClientManagementView } from '@alga-psa/co-managed';
import { resolveClientRelationshipSummary } from '@/lib/co-managed/clientRelationshipSummary';

/** Compact client-record summary and the client header's only co-managed
 * entry. Its action opens the stable co-managed view in place: setup for an
 * unconfigured client (offered only when the view grants setup authority),
 * history or management for an existing relationship. */
export default function CoManagedClientSummary({ view, idPrefix, selectedRelationshipId, onSelectRelationship, onOpenTab }: {
  view: CoManagedClientManagementView;
  clientId: string;
  idPrefix: string;
  selectedRelationshipId?: string | null;
  onSelectRelationship?: (relationshipId: string) => void;
  onOpenTab?: (tabId: string) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const { formatDate } = useFormatters();
  const phase = resolveClientRelationshipSummary(view, selectedRelationshipId);
  const action = (label: string, onClick: () => void) => (
    <Button id={`${idPrefix}-summary-action`} variant="link" className="h-auto p-0 text-sm font-semibold" onClick={onClick}>
      {label}
    </Button>
  );
  const wrap = 'flex items-center gap-2 text-sm text-[rgb(var(--color-text-600))]';
  switch (phase.kind) {
    case 'absent':
      return null;
    case 'attention':
      // Offer nothing that would add a second relationship.
      return (
        <span id={`${idPrefix}-summary`} className={wrap}>
          {t('coManaged.client.inconsistent', { defaultValue: 'Co-managed record needs attention' })}
        </span>
      );
    case 'not_enabled':
      return (
        <span id={`${idPrefix}-summary`} className={wrap}>
          {t('coManaged.client.notEnabled', { defaultValue: 'Co-managed IT not enabled' })}
          {view.canSetUp && action(
            t('coManaged.provisioning.create', { defaultValue: 'Enable co-managed IT' }),
            () => onOpenTab?.('co-managed'))}
        </span>
      );
    case 'selection_required':
      return (
        <span id={`${idPrefix}-summary`} className={wrap}>
          {phase.multiple
            ? t('coManaged.client.selectionRequired', { defaultValue: 'Multiple co-managed relationships' })
            : t('coManaged.client.endedHint', { defaultValue: 'This relationship has ended. Retained history and archives remain available.' })}
          {action(
            phase.multiple
              ? t('coManaged.client.chooseRelationship', { defaultValue: 'Choose relationship' })
              : t('coManaged.client.viewHistory', { defaultValue: 'View history' }),
            () => {
              if (!phase.multiple && phase.historyRelationshipId) onSelectRelationship?.(phase.historyRelationshipId);
              onOpenTab?.('co-managed');
            })}
        </span>
      );
    case 'ended': {
      const selected = phase.relationship;
      return (
        <span id={`${idPrefix}-summary`} className="flex items-center gap-3 text-sm text-[rgb(var(--color-text-600))]">
          <span className="font-medium text-[rgb(var(--color-text-800))]">
            {t(`coManaged.provisioning.states.${selected.state}`, { defaultValue: selected.state })}
          </span>
          {selected.endedAt && <span>{t('coManaged.client.endedOn', { defaultValue: 'Ended {{date}}', date: formatDate(new Date(selected.endedAt), { dateStyle: 'medium' }) })}</span>}
          {action(
            t('coManaged.client.viewHistory', { defaultValue: 'View history' }),
            () => { onSelectRelationship?.(selected.relationshipId); onOpenTab?.('co-managed'); })}
        </span>
      );
    }
    case 'live': {
      const selected = phase.relationship;
      const seats = selected.usedSeats != null
        ? t('coManaged.client.seatUsage', { defaultValue: '{{used}} of {{count}} technician seats', used: selected.usedSeats, count: selected.seats })
        : t('coManaged.client.seatAllocation', { defaultValue: '{{count}} allocated technician seats', count: selected.seats });
      return (
        <span id={`${idPrefix}-summary`} className="flex items-center gap-3 text-sm text-[rgb(var(--color-text-600))]">
          <span className="font-medium text-[rgb(var(--color-text-800))]">
            {t(`coManaged.provisioning.states.${selected.state}`, { defaultValue: selected.state })}
          </span>
          <span>{seats}</span>
          {action(
            t('coManaged.client.viewDetails', { defaultValue: 'View details' }),
            () => { onSelectRelationship?.(selected.relationshipId); onOpenTab?.('co-managed'); })}
        </span>
      );
    }
  }
}
