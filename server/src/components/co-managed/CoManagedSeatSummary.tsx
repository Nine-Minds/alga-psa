'use client';

import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { CoManagedSeatClientState } from './CoManagedSeatClientView';

/** The client header's co-managed line for a seat arrangement, or for a client that may be given one. */
export default function CoManagedSeatSummary({ state, idPrefix, onOpenTab }: {
  state: CoManagedSeatClientState;
  idPrefix: string;
  onOpenTab?: (tabId: string) => void;
}) {
  const { t } = useTranslation('msp/licensing');
  const wrap = 'flex items-center gap-2 text-sm text-[rgb(var(--color-text-600))]';
  const open = (label: string) => (
    <Button id={`${idPrefix}-summary-action`} variant="link" className="h-auto p-0 text-sm font-semibold" onClick={() => onOpenTab?.('co-managed')}>{label}</Button>
  );
  if (state.panel) {
    return (
      <span id={`${idPrefix}-summary`} className={wrap}>
        {t('coManaged.seat.client.summary', { defaultValue: 'Seat arrangement: {{used}} of {{count}} seats used', used: state.panel.usedSeats, count: state.panel.seats })}
        {open(t('coManaged.client.viewDetails', { defaultValue: 'View details' }))}
      </span>
    );
  }
  if (!state.enable) return null;
  return (
    <span id={`${idPrefix}-summary`} className={wrap}>
      {t('coManaged.client.notEnabled', { defaultValue: 'Co-managed IT not enabled' })}
      {open(t('coManaged.provisioning.create', { defaultValue: 'Enable co-managed IT' }))}
    </span>
  );
}
