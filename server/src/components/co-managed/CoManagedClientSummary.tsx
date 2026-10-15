'use client';

import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedClientManagementView } from '@alga-psa/co-managed';

/** Compact client-record summary. Its action opens the stable co-managed view
 * in place (setup for an unconfigured client, history or management for an
 * existing relationship) without navigating the client route. */
export default function CoManagedClientSummary({ view, idPrefix, selectedRelationshipId, onSelectRelationship, onOpenTab }: {
  view: CoManagedClientManagementView;
  clientId: string;
  idPrefix: string;
  selectedRelationshipId?: string | null;
  onSelectRelationship?: (relationshipId: string) => void;
  onOpenTab?: (tabId: string) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const selected = view.relationships.find(
    (entry) => entry.relationshipId === (selectedRelationshipId ?? view.selectedRelationshipId)) ?? null;
  const action = (label: string, onClick: () => void) => (
    <Button id={`${idPrefix}-summary-action`} variant="link" className="h-auto p-0 text-sm font-semibold" onClick={onClick}>
      {label}
    </Button>
  );
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
  if (!selected) {
    return (
      <span id={`${idPrefix}-summary`} className="flex items-center gap-2 text-sm text-[rgb(var(--color-text-600))]">
        {t('coManaged.client.notEnabled', { defaultValue: 'Co-managed IT not enabled' })}
        {action(
          t('coManaged.provisioning.create', { defaultValue: 'Enable co-managed IT' }),
          () => onOpenTab?.('co-managed'))}
      </span>
    );
  }
  const seats = selected.usedSeats != null
    ? t('coManaged.client.seatUsage', { defaultValue: '{{used}} of {{allocated}} technician seats', used: selected.usedSeats, allocated: selected.seats })
    : t('coManaged.client.seatAllocation', { defaultValue: '{{allocated}} allocated technician seats', allocated: selected.seats });
  return (
    <span id={`${idPrefix}-summary`} className="flex items-center gap-3 text-sm text-[rgb(var(--color-text-600))]">
      <span className="font-medium text-[rgb(var(--color-text-800))]">
        {t(`coManaged.provisioning.states.${selected.state}`, { defaultValue: selected.state })}
      </span>
      <span>{seats}</span>
      {action(
        t('coManaged.policy.manage', { defaultValue: 'Manage' }),
        () => { onSelectRelationship?.(selected.relationshipId); onOpenTab?.('co-managed'); })}
    </span>
  );
}
