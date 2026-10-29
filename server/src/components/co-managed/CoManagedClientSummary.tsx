'use client';

import { Button } from '@alga-psa/ui/components/Button';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedClientManagementView } from '@alga-psa/co-managed';

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
  const selected = view.relationships.find(
    (entry) => entry.relationshipId === (selectedRelationshipId ?? view.selectedRelationshipId)) ?? null;
  const action = (label: string, onClick: () => void) => (
    <Button id={`${idPrefix}-summary-action`} variant="link" className="h-auto p-0 text-sm font-semibold" onClick={onClick}>
      {label}
    </Button>
  );
  // With nothing live or retained the client is not enabled (a cancelled setup
  // does not count), and only an actor the view authorizes for setup sees Enable.
  const setupOpen = !view.inconsistent && view.relationships.every((entry) => entry.ended && !entry.retained);
  // A setup whose relationship record names another sponsor or client is not
  // "not enabled": say it needs attention and offer nothing that would add a second one.
  if (!selected && view.inconsistent && !view.relationships.some((entry) => !entry.ended)) {
    return (
      <span id={`${idPrefix}-summary`} className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-600))]">
        {t('coManaged.client.inconsistent', { defaultValue: 'Co-managed record needs attention' })}
      </span>
    );
  }
  if (!selected && setupOpen) {
    return (
      <span id={`${idPrefix}-summary`} className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-600))]">
        {t('coManaged.client.notEnabled', { defaultValue: 'Co-managed IT not enabled' })}
        {view.canSetUp && action(
          t('coManaged.provisioning.create', { defaultValue: 'Enable co-managed IT' }),
          () => onOpenTab?.('co-managed'))}
      </span>
    );
  }
  if (view.selectionRequired) {
    const live = view.relationships.filter((entry) => !entry.ended);
    const history = view.relationships[0];
    const multiple = live.length > 1;
    return (
      <span id={`${idPrefix}-summary`} className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-600))]">
        {multiple
          ? t('coManaged.client.selectionRequired', { defaultValue: 'Multiple co-managed relationships' })
          : t('coManaged.client.endedHint', { defaultValue: 'This relationship has ended. Retained history and archives remain available.' })}
        {action(
          multiple
            ? t('coManaged.client.chooseRelationship', { defaultValue: 'Choose relationship' })
            : t('coManaged.client.viewHistory', { defaultValue: 'View history' }),
          () => {
            if (!multiple && history) onSelectRelationship?.(history.relationshipId);
            onOpenTab?.('co-managed');
          })}
      </span>
    );
  }
  // Without a selection the view requires one (handled above); this keeps the
  // selected relationship non-null below.
  if (!selected) return null;
  if (selected.ended) {
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
