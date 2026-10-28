'use client';

import React, { useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import {
  ArrowRightLeft,
  HandHelping,
  History as HistoryIcon,
  PackageCheck,
  PackageOpen,
  Pencil,
  Truck,
  Undo2,
} from 'lucide-react';
import type { IAssetCustodyDetail, IAssetCustodyEventDetail } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { BentoChip, BentoLabelValue, BentoTile, BentoTileEmpty } from '@alga-psa/ui/components/bento';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { formatCalendarDate, getCurrentDateInUserTimeZone } from '@alga-psa/core';
import { getAssetCustody, listCustodyEvents } from '../../actions/assetCustodyActions';
import { useAssetCrossFeature } from '../../context/AssetCrossFeatureContext';
import { matchAnyEntityAssetsKeys, matchAssetCacheKeys } from '../../lib/assetCacheKeys';
import {
  custodyEventToHistoryEntry,
  daysHeldSince,
  describeCustodyHistory,
  formatCustodyPlace,
  isFollowUpOverdue,
} from '../../lib/custodyDisplay';
import { custodyOutcome, useCustodyLocations } from './custodyClient';
import { usePartyLabels, usePurposeOptions } from './CustodyFields';
import { CustodyStepDialog, OpenCustodyDialog, type CustodyDialogKind } from './CustodyDialogs';

interface CustodyData {
  open: IAssetCustodyDetail | null;
  episodes: IAssetCustodyDetail[];
}

/**
 * Asset detail "Custody" card (design D8). Renders nothing for a user without asset:read; the action
 * buttons and "Receive into custody" only render for a user with asset:update (probed through the
 * update-gated location list, since there is no client-side permission hook).
 */
export function CustodyCard({ id, assetId }: { id: string; assetId: string }) {
  const { t, i18n } = useTranslation('msp/assets');
  const { mutate } = useSWRConfig();
  const crossFeature = useAssetCrossFeature();
  const purposes = usePurposeOptions();
  const parties = usePartyLabels();
  const { canUpdate } = useCustodyLocations();
  const [dialog, setDialog] = useState<CustodyDialogKind | null>(null);
  const [opening, setOpening] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data, isLoading } = useSWR(['asset', assetId, 'custody'], async ([, aid]) => {
    const result = await getAssetCustody(aid as string);
    if (isActionPermissionError(result)) return { denied: true as const };
    const outcome = custodyOutcome<CustodyData>(result);
    return outcome.ok ? { denied: false as const, ...outcome.data } : { denied: true as const };
  });

  const refresh = () => {
    void mutate(matchAssetCacheKeys([assetId]));
    // Every custody read (queue, list badges) and any mounted ticket/project Assets panel, which show this
    // asset's status and custody chip but are keyed by the ticket, not the asset.
    void mutate((key: unknown) => Array.isArray(key) && key[0] === 'custody');
    void mutate(matchAnyEntityAssetsKeys);
  };

  if (isLoading || !data || data.denied) return null;
  const { open, episodes } = data;
  const pastEpisodes = episodes.filter((e) => e.custody_id !== open?.custody_id);
  if (!open && !canUpdate && episodes.length === 0) return null;

  const today = getCurrentDateInUserTimeZone();
  const overdue = open ? isFollowUpOverdue(open.follow_up_on, today) : false;
  const days = open ? daysHeldSince(open.opened_at, Date.now()) : 0;
  const purposeLabel = open ? purposes.find((p) => p.value === open.purpose)?.label ?? open.purpose : '';
  const place =
    open?.state === 'with_vendor'
      ? t('custody.card.withVendor', { defaultValue: 'With vendor' })
      : formatCustodyPlace(open?.location_name, open?.bin);

  return (
    <BentoTile
      id={id}
      title={t('custody.card.title', { defaultValue: 'Custody' })}
      icon={<PackageOpen className="h-4 w-4" />}
      action={
        open ? (
          <BentoChip tone={open.state === 'with_vendor' ? 'warning' : 'info'}>
            {open.state === 'with_vendor'
              ? t('custody.state.with_vendor', { defaultValue: 'With vendor' })
              : t('custody.state.in_office', { defaultValue: 'In office' })}
          </BentoChip>
        ) : undefined
      }
    >
      {open ? (
        <div className="space-y-3">
          <div className="space-y-1.5 text-sm">
            <BentoLabelValue label={t('custody.card.location', { defaultValue: 'Location' })} value={place} />
            {open.state === 'in_office' ? (
              <BentoLabelValue label={t('custody.card.holder', { defaultValue: 'Holder' })} value={open.holder_name} />
            ) : null}
            <BentoLabelValue label={t('custody.card.purpose', { defaultValue: 'Purpose' })} value={purposeLabel} />
            <BentoLabelValue
              label={t('custody.card.nextAction', { defaultValue: 'Next action' })}
              value={parties[open.next_action_party]}
            />
            <BentoLabelValue
              label={t('custody.card.followUp', { defaultValue: 'Follow up' })}
              value={
                open.follow_up_on ? (
                  <span className={overdue ? 'text-red-600 dark:text-red-400' : undefined}>
                    {formatCalendarDate(open.follow_up_on, 'MMM d, yyyy')}
                    {overdue ? ` (${t('custody.card.overdue', { defaultValue: 'overdue' })})` : ''}
                  </span>
                ) : null
              }
            />
            <BentoLabelValue
              label={t('custody.card.daysHeld', { defaultValue: 'Days held' })}
              value={String(days)}
            />
            {open.ticket_id ? (
              <BentoLabelValue
                label={t('custody.card.ticket', { defaultValue: 'Ticket' })}
                value={
                  <button
                    id={`${id}-ticket-link`}
                    type="button"
                    className="text-[rgb(var(--color-primary-600))] hover:underline"
                    onClick={() => void crossFeature.openTicketDetailsDrawer({ ticketId: open.ticket_id! })}
                  >
                    {open.ticket_number ?? t('custody.card.openTicket', { defaultValue: 'Open ticket' })}
                  </button>
                }
              />
            ) : null}
          </div>
          {open.next_action_note ? (
            <p className="text-xs text-[rgb(var(--color-text-500))]">{open.next_action_note}</p>
          ) : null}
          {open.condition_note ? (
            <BentoLabelValue
              stacked
              label={t('custody.card.condition', { defaultValue: 'Condition' })}
              value={<span className="whitespace-normal font-normal">{open.condition_note}</span>}
            />
          ) : null}
          {open.accessories?.length ? (
            <BentoLabelValue
              stacked
              label={t('custody.card.accessories', { defaultValue: 'Accessories' })}
              value={
                <span className="whitespace-normal font-normal">
                  {open.accessories.map((a) => (a.quantity > 1 ? `${a.quantity} x ${a.label}` : a.label)).join(', ')}
                </span>
              }
            />
          ) : null}

          {canUpdate ? (
            <div className="flex flex-wrap gap-2 border-t border-[rgb(var(--color-border-100))] pt-3">
              {open.state === 'in_office' ? (
                <>
                  <Button id={`${id}-move`} size="xs" variant="outline" onClick={() => setDialog('move')}>
                    <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
                    {t('custody.actions.move', { defaultValue: 'Move' })}
                  </Button>
                  <Button id={`${id}-hand-off`} size="xs" variant="outline" onClick={() => setDialog('handOff')}>
                    <HandHelping className="mr-1 h-3.5 w-3.5" />
                    {t('custody.actions.handOff', { defaultValue: 'Hand off' })}
                  </Button>
                  <Button id={`${id}-ship`} size="xs" variant="outline" onClick={() => setDialog('ship')}>
                    <Truck className="mr-1 h-3.5 w-3.5" />
                    {t('custody.actions.ship', { defaultValue: 'Ship to vendor' })}
                  </Button>
                </>
              ) : (
                <Button id={`${id}-receive-back`} size="xs" variant="outline" onClick={() => setDialog('receiveBack')}>
                  <PackageCheck className="mr-1 h-3.5 w-3.5" />
                  {t('custody.actions.receiveBack', { defaultValue: 'Receive back' })}
                </Button>
              )}
              <Button id={`${id}-return`} size="xs" variant="outline" onClick={() => setDialog('return')}>
                <Undo2 className="mr-1 h-3.5 w-3.5" />
                {t('custody.actions.returnToClient', { defaultValue: 'Return to client' })}
              </Button>
              <Button id={`${id}-edit`} size="xs" variant="ghost" onClick={() => setDialog('edit')}>
                <Pencil className="mr-1 h-3.5 w-3.5" />
                {t('custody.actions.edit', { defaultValue: 'Edit details' })}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <BentoTileEmpty id={`${id}-empty`}>
            {t('custody.card.notInCustody', { defaultValue: 'Not currently in MSP custody.' })}
          </BentoTileEmpty>
          {canUpdate ? (
            <Button id={`${id}-open`} size="xs" variant="outline" onClick={() => setOpening(true)}>
              <PackageOpen className="mr-1 h-3.5 w-3.5" />
              {t('custody.actions.receiveIntoCustody', { defaultValue: 'Receive into custody' })}
            </Button>
          ) : null}
        </div>
      )}

      {open || pastEpisodes.length > 0 ? (
        <div className="mt-3 border-t border-[rgb(var(--color-border-100))] pt-2">
          <button
            id={`${id}-toggle-history`}
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-[rgb(var(--color-primary-600))] hover:underline"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((v) => !v)}
          >
            <HistoryIcon className="h-3.5 w-3.5" />
            {showHistory
              ? t('custody.card.hideHistory', { defaultValue: 'Hide custody history' })
              : pastEpisodes.length > 0
                ? t('custody.card.showHistoryWithPast', {
                    defaultValue: 'Custody history ({{count}} past episodes)',
                    count: pastEpisodes.length,
                  })
                : t('custody.card.showHistory', { defaultValue: 'Custody history' })}
          </button>
          {showHistory ? <CustodyEventList id={`${id}-history`} assetId={assetId} lang={i18n?.language} /> : null}
        </div>
      ) : null}

      {open ? (
        <CustodyStepDialog kind={dialog} custody={open} onClose={() => setDialog(null)} onDone={refresh} />
      ) : null}
      <OpenCustodyDialog isOpen={opening} onClose={() => setOpening(false)} assetId={assetId} onDone={refresh} />
    </BentoTile>
  );
}

function CustodyEventList({ id, assetId, lang }: { id: string; assetId: string; lang?: string }) {
  const { t } = useTranslation('msp/assets');
  const { renderCustodyPhotos } = useAssetCrossFeature();
  const { data, isLoading } = useSWR(['asset', assetId, 'custody-events'], async ([, aid]) => {
    const outcome = custodyOutcome<IAssetCustodyEventDetail[]>(await listCustodyEvents(aid as string));
    return outcome.ok ? outcome.data : [];
  });

  const rows = useMemo(() => {
    const events = data ?? [];
    // The first `received` of an episode is intake; later ones are receive-back from a vendor.
    const firstReceived = new Map<string, string>();
    for (const e of [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))) {
      if (e.event_type === 'received' && !firstReceived.has(e.custody_id)) firstReceived.set(e.custody_id, e.event_id);
    }
    return events.map((e) => {
      const entry = custodyEventToHistoryEntry(e, e.event_type === 'received' && firstReceived.get(e.custody_id) !== e.event_id);
      return { event: e, description: describeCustodyHistory(entry, t), documentIds: entry.documentIds };
    });
  }, [data, t]);

  if (isLoading) return <div className="mt-2 h-8 animate-pulse rounded-md skeleton-fill" />;
  if (rows.length === 0) {
    return (
      <p id={id} className="mt-2 text-xs text-[rgb(var(--color-text-400))]">
        {t('custody.card.noEvents', { defaultValue: 'No custody events recorded.' })}
      </p>
    );
  }
  return (
    <ul id={id} className="mt-2 space-y-1.5">
      {rows.map(({ event, description, documentIds }) => (
        <li key={event.event_id} className="text-xs">
          <div className="font-medium text-[rgb(var(--color-text-800))]">{description?.title ?? event.event_type}</div>
          <div className="text-[rgb(var(--color-text-400))]">
            {[new Date(event.occurred_at).toLocaleString(lang), event.actor_name].filter(Boolean).join(' · ')}
            {event.note ? ` · ${event.note}` : ''}
          </div>
          {documentIds.length ? renderCustodyPhotos?.(documentIds, event.event_id) : null}
        </li>
      ))}
    </ul>
  );
}

export default CustodyCard;
