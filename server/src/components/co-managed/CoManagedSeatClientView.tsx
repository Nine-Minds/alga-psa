'use client';

import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent } from '@alga-psa/ui/components/Card';
import type { getCoManagedSeatClientState } from '@/lib/actions/coManagedSeatActions';
import CoManagedSeatPanel from './CoManagedSeatPanel';
import type { SeatEnableStory } from '@/lib/co-managed/seatEnableStory';

export type CoManagedSeatClientState = Awaited<ReturnType<typeof getCoManagedSeatClientState>>;

/**
 * The tab body for a client whose workspace side is not shown: the seat panel when the client has a
 * seat arrangement, otherwise a plain "not enabled" card (the chooser itself is rendered by
 * `CoManagedClientView`, which owns the workspace setup it hands over to).
 */
export default function CoManagedSeatClientView({ state, clientName, idPrefix, onReload, notEnabledHeading = 'notEnabled', children }: {
  state: CoManagedSeatClientState;
  clientName: string;
  idPrefix: string;
  onReload: () => Promise<void> | void;
  /** The heading variant for a client with no arrangement, from `resolveSeatEnableStory`. */
  notEnabledHeading?: SeatEnableStory['heading'];
  /** The shape chooser, when the client may be given an arrangement. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation('msp/licensing');
  return (
    <div id={`${idPrefix}-view`} className="space-y-4">
      <Card id={`${idPrefix}-status`}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div>
            <p className="text-sm text-[rgb(var(--color-text-500))]">{t('coManaged.client.forClient', { defaultValue: 'Co-managed IT for {{name}}', name: clientName })}</p>
            <h3 className="text-lg font-semibold">{state.panel
              ? t('coManaged.seat.client.seatArrangement', { defaultValue: 'Seat arrangement' })
              : notEnabledHeading === 'trialEnables'
                ? t('coManaged.client.notEnabledTrialEnables', { defaultValue: 'Co-managed IT is not enabled yet. Starting the free 15-day Seat trial enables it for this client.' })
                : t('coManaged.client.notEnabled', { defaultValue: 'Co-managed IT not enabled' })}</h3>
          </div>
          <Button id={`${idPrefix}-refresh`} variant="outline" size="sm" onClick={() => void onReload()}>
            {t('coManaged.provisioning.refresh', { defaultValue: 'Refresh' })}
          </Button>
        </CardContent>
      </Card>
      {state.panel
        ? <CoManagedSeatPanel panel={state.panel} canManage={state.canManage} idPrefix={idPrefix} onChanged={onReload} />
        : children}
    </div>
  );
}
