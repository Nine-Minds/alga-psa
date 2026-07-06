'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { BentoTile, BentoTileEmpty, BentoTileSkeleton } from '@alga-psa/ui/components/bento/BentoTile';
import type { TabContent } from '@alga-psa/ui/components/CustomTabs';
import type { SurveyClientSatisfactionSummary } from '@alga-psa/types';
import { getClientPulse } from '../../../actions/clientPulseActions';
import type {
  ClientAttentionFlag,
  ClientPulse,
  ClientTimelineEvent,
} from '../../../lib/commandCenterTypes';
import { useContactQuickViewDrawer } from '../../contacts/bento/useContactQuickViewDrawer';
import ConcernsCard from './ConcernsCard';
import ClientTimelinePanel from './ClientTimelinePanel';
import FocusViewHost from './FocusViewHost';
import {
  DocumentsCard,
  InstallBaseCard,
  LocationsCard,
  MoneyCard,
  NotesCard,
  PeopleCard,
  RecordCard,
  ServiceCard,
} from './PulseCards';

type TFn = (key: string, options?: Record<string, unknown>) => string;

interface ClientCommandCenterProps {
  idPrefix: string;
  clientId: string;
  tabs: TabContent[];
  /** ?tab= value present when the page loaded (deep link, D3). */
  initialTabId?: string | null;
  /** Sync the focus-view state back into the URL (?tab=). */
  onTabUrlChange: (tabId: string | null) => void;
  /** Dirty state of the shared client-record edit buffer (Details / Additional Info). */
  hasUnsavedRecordChanges: boolean;
  /** Reset the record edit buffer to the saved client. */
  onDiscardRecordChanges: () => void;
  onNewTicket: () => void;
  onManageLocations: () => void;
  onAddContact?: (() => void) | null;
  /** Open a ticket in the shared drawer (composition-provided); falls back to navigation. */
  onOpenTicketDetails?: ((ticketId: string) => void | Promise<void>) | null;
  /** Bump when the host mutated pulse-visible data (quick-add ticket/contact) to refetch in place. */
  refreshNonce?: number;
  surveySummary: SurveyClientSatisfactionSummary | null;
  renderSurveySummaryCard: (props: { summary: SurveyClientSatisfactionSummary | null }) => React.ReactNode;
  t: TFn;
}

// Focus views editing the shared client-record buffer — closing these while
// dirty is the silent-data-loss path the close guard exists for.
const RECORD_FORM_TAB_IDS = new Set(['details', 'additional-info']);

export default function ClientCommandCenter({
  idPrefix,
  clientId,
  tabs,
  initialTabId,
  onTabUrlChange,
  hasUnsavedRecordChanges,
  onDiscardRecordChanges,
  onNewTicket,
  onManageLocations,
  onAddContact,
  onOpenTicketDetails,
  refreshNonce = 0,
  surveySummary,
  renderSurveySummaryCard,
  t,
}: ClientCommandCenterProps) {
  const router = useRouter();
  const [pulse, setPulse] = useState<ClientPulse | null>(null);
  const [pulseError, setPulseError] = useState<string | null>(null);
  const tabIds = useMemo(() => new Set(tabs.map((tab) => tab.id)), [tabs]);
  const [focusTabId, setFocusTabId] = useState<string | null>(null);

  // Deep-link consumption (D3). Some tabs join the registry asynchronously
  // (e.g. Equipment appears after its permission check resolves), so the
  // ?tab= deep link must wait for its tab instead of being decided at mount.
  // Consumed exactly once; any user interaction cancels a pending deep link.
  const deepLinkConsumedRef = useRef(false);
  useEffect(() => {
    if (deepLinkConsumedRef.current) return;
    if (!initialTabId) {
      deepLinkConsumedRef.current = true;
      return;
    }
    if (tabIds.has(initialTabId)) {
      deepLinkConsumedRef.current = true;
      setFocusTabId(initialTabId);
    }
  }, [initialTabId, tabIds]);

  // Bumped when a drawer edit changed data the cards summarize (e.g. a contact
  // saved from the quick view) — refetches in place, keeping the current cards.
  const [pulseRefreshKey, setPulseRefreshKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getClientPulse(clientId)
      .then((data) => { if (!cancelled) setPulse(data); })
      .catch(() => {
        if (!cancelled) {
          setPulseError(t('clientCommandCenter.pulseError', { defaultValue: 'Could not load the client snapshot.' }));
        }
      });
    return () => { cancelled = true; };
  }, [clientId, t, pulseRefreshKey, refreshNonce]);

  const openContactQuickView = useContactQuickViewDrawer();
  const handleOpenContact = useCallback((contactId: string) => {
    void openContactQuickView(contactId, {
      onChangesSaved: () => setPulseRefreshKey((key) => key + 1),
    });
  }, [openContactQuickView]);

  const openFocus = useCallback((tabId: string) => {
    if (!tabIds.has(tabId)) return;
    deepLinkConsumedRef.current = true;
    setFocusTabId(tabId);
    onTabUrlChange(tabId);
  }, [tabIds, onTabUrlChange]);

  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const closeFocus = useCallback(() => {
    // Closing a record form with pending edits reads as "done" while the edits
    // sit unsaved — confirm the discard instead of losing them silently.
    if (hasUnsavedRecordChanges && focusTabId && RECORD_FORM_TAB_IDS.has(focusTabId)) {
      setConfirmDiscardOpen(true);
      return;
    }
    deepLinkConsumedRef.current = true;
    setFocusTabId(null);
    onTabUrlChange(null);
  }, [onTabUrlChange, hasUnsavedRecordChanges, focusTabId]);

  /** First existing tab id from a preference list (AlgaDesk filters some out). */
  const resolveTab = useCallback((...preferred: string[]): string | null => {
    for (const candidate of preferred) {
      if (tabIds.has(candidate)) return candidate;
    }
    return null;
  }, [tabIds]);

  const focusOpener = useCallback((...preferred: string[]): (() => void) | null => {
    const target = resolveTab(...preferred);
    return target ? () => openFocus(target) : null;
  }, [resolveTab, openFocus]);

  const currencyCode = pulse?.money?.currencyCode ?? 'USD';
  const formatMoney = useCallback((cents: number) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currencyCode,
        maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
      }).format(cents / 100);
    } catch {
      return `$${(cents / 100).toFixed(2)}`;
    }
  }, [currencyCode]);

  const navigateToRef = useCallback((refType: string, refId: string) => {
    switch (refType) {
      case 'ticket':
        // Stay on the client page: open the ticket in a drawer when the
        // composition layer provides one; full navigation is the fallback.
        if (onOpenTicketDetails) {
          void onOpenTicketDetails(refId);
        } else {
          router.push(`/msp/tickets/${refId}`);
        }
        return;
      case 'invoice':
        router.push(`/msp/invoices/${refId}`);
        return;
      case 'sales_order':
        router.push('/msp/inventory/sales-orders');
        return;
      case 'rma':
        router.push('/msp/inventory/rma');
        return;
      case 'quote':
        router.push('/msp/billing?tab=quotes');
        return;
      case 'stock_unit': {
        const target = resolveTab('equipment', 'assets');
        if (target) openFocus(target);
        return;
      }
      case 'interaction': {
        const target = resolveTab('interactions');
        if (target) openFocus(target);
        return;
      }
      default:
        break;
    }
  }, [router, resolveTab, openFocus, onOpenTicketDetails]);

  const handleFlagClick = useCallback((flag: ClientAttentionFlag) => {
    if (flag.refType && flag.refId) {
      navigateToRef(flag.refType, flag.refId);
    }
  }, [navigateToRef]);

  const handleTimelineEventClick = useCallback((event: ClientTimelineEvent) => {
    navigateToRef(event.refType, event.refId);
  }, [navigateToRef]);

  // The reach-the-customer basics, always visible: default location's phone
  // and email, website, and primary address. Only fields that exist render.
  const identityLocation = pulse?.locations.find((location) => location.is_default) ?? pulse?.locations[0] ?? null;
  const identityItems: Array<{ key: string; href: string | null; text: React.ReactNode }> = [];
  if (identityLocation?.phone) {
    identityItems.push({ key: 'phone', href: `tel:${identityLocation.phone}`, text: `☎ ${identityLocation.phone}` });
  }
  if (identityLocation?.email) {
    identityItems.push({ key: 'email', href: `mailto:${identityLocation.email}`, text: `✉ ${identityLocation.email}` });
  }
  if (pulse?.record.url) {
    const href = /^https?:\/\//i.test(pulse.record.url) ? pulse.record.url : `https://${pulse.record.url}`;
    identityItems.push({ key: 'url', href, text: `🌐 ${pulse.record.url}` });
  }
  if (identityLocation?.address_line1) {
    identityItems.push({
      key: 'address',
      href: null,
      text: (
        <>
          <MapPin className="inline w-3.5 h-3.5 -mt-0.5 mr-1 text-gray-500" aria-hidden="true" />
          {[identityLocation.address_line1, identityLocation.city].filter(Boolean).join(', ')}
        </>
      ),
    });
  }

  return (
    <div id={`${idPrefix}-command-center`} className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-[13px] text-gray-600">
        {identityItems.length > 0 && (
          <span id={`${idPrefix}-identity`} className="contents">
            {identityItems.map((item) => item.href ? (
              <a
                key={item.key}
                href={item.href}
                target={item.key === 'url' ? '_blank' : undefined}
                rel={item.key === 'url' ? 'noreferrer' : undefined}
                className="hover:text-primary-700 hover:underline"
              >
                {item.text}
              </a>
            ) : (
              <span key={item.key}>{item.text}</span>
            ))}
          </span>
        )}
      </div>

      {pulseError && (
        <p id={`${idPrefix}-pulse-error`} className="text-[13px] text-red-600 mb-4">{pulseError}</p>
      )}

      {/* Bento mosaic: a 6-column canvas where tiles earn different widths —
          Concerns full-bleed, Service the hero, halves and thirds below. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-6 gap-4">
          {!pulse && !pulseError && (
            <>
              <BentoTileSkeleton id={`${idPrefix}-skeleton-hero`} lines={2} className="sm:col-span-4" />
              <BentoTileSkeleton id={`${idPrefix}-skeleton-side`} lines={2} className="sm:col-span-2" />
              <BentoTileSkeleton id={`${idPrefix}-skeleton-left`} className="sm:col-span-3" />
              <BentoTileSkeleton id={`${idPrefix}-skeleton-right`} className="sm:col-span-3" />
            </>
          )}

          {pulse && (
            <ConcernsCard
              id={`${idPrefix}-card-concerns`}
              flags={pulse.attention}
              formatMoney={formatMoney}
              onFlagClick={handleFlagClick}
              className="sm:col-span-6"
              t={t}
            />
          )}
          {pulse?.service && (
            <ServiceCard
              id={`${idPrefix}-card-service`}
              data={pulse.service}
              onOpen={focusOpener('tickets')}
              onOpenTicket={(ticketId) => navigateToRef('ticket', ticketId)}
              onNewTicket={onNewTicket}
              className="sm:col-span-4"
              t={t}
            />
          )}
          {pulse && (
            <RecordCard
              id={`${idPrefix}-card-record`}
              data={pulse.record}
              onOpen={focusOpener('details')}
              onOpenAdditionalInfo={focusOpener('additional-info')}
              className={pulse.service ? 'sm:col-span-2' : 'sm:col-span-6'}
              t={t}
            />
          )}
          {pulse?.money && (
            <MoneyCard
              id={`${idPrefix}-card-money`}
              data={pulse.money}
              formatMoney={formatMoney}
              onOpen={focusOpener('billing-dashboard', 'billing')}
              onOpenInvoice={(invoiceId) => navigateToRef('invoice', invoiceId)}
              onOpenBillingSetup={focusOpener('billing')}
              onOpenTaxSettings={focusOpener('tax-settings')}
              className="sm:col-span-3"
              t={t}
            />
          )}
          {pulse?.installBase && (
            <InstallBaseCard
              id={`${idPrefix}-card-install-base`}
              data={pulse.installBase}
              onOpen={focusOpener('equipment', 'assets')}
              // Only when Equipment holds the header action — otherwise the
              // header already opens Assets and the footer link would duplicate it.
              onOpenAssetList={tabIds.has('equipment') ? focusOpener('assets') : null}
              onOpenAsset={(assetId) => router.push(`/msp/assets/${assetId}`)}
              className="sm:col-span-3"
              t={t}
            />
          )}
          {pulse && (
            <PeopleCard
              id={`${idPrefix}-card-people`}
              data={pulse.people}
              onOpen={focusOpener('contacts')}
              onOpenContact={handleOpenContact}
              onAddContact={onAddContact}
              className="sm:col-span-3"
              t={t}
            />
          )}
          {pulse && (
            <LocationsCard
              id={`${idPrefix}-card-locations`}
              locations={pulse.locations}
              onManage={onManageLocations}
              className="sm:col-span-3"
              t={t}
            />
          )}
          {pulse?.documents && (
            <DocumentsCard
              id={`${idPrefix}-card-documents`}
              data={pulse.documents}
              onOpen={focusOpener('documents')}
              className="sm:col-span-2"
              t={t}
            />
          )}
          {pulse && (
            <NotesCard
              id={`${idPrefix}-card-notes`}
              data={pulse.notes}
              onOpen={focusOpener('notes')}
              className="sm:col-span-2"
              t={t}
            />
          )}
          {/* W5: the full survey card earns its grid slot only with real
              responses — an empty one said "no data" four ways. */}
          {pulse && surveySummary && (
            surveySummary.totalResponses > 0 ? (
              <div id={`${idPrefix}-card-csat`} className="min-w-0 sm:col-span-2">
                {renderSurveySummaryCard({ summary: surveySummary })}
              </div>
            ) : (
              <BentoTile id={`${idPrefix}-card-csat`} className="sm:col-span-2 self-start">
                <BentoTileEmpty id={`${idPrefix}-card-csat-empty`}>
                  {t('clientCommandCenter.csatEmpty', { defaultValue: 'No survey responses yet.' })}
                </BentoTileEmpty>
              </BentoTile>
            )
          )}
        </div>

        <div className="lg:col-span-1 min-w-0 lg:sticky lg:top-4 self-stretch">
          <ClientTimelinePanel
            idPrefix={idPrefix}
            clientId={clientId}
            formatMoney={formatMoney}
            onEventClick={handleTimelineEventClick}
            t={t}
          />
        </div>
      </div>

      <FocusViewHost
        idPrefix={idPrefix}
        tabs={tabs}
        activeTabId={focusTabId}
        onSelectTab={openFocus}
        onClose={closeFocus}
        t={t}
      />

      <ConfirmationDialog
        id={`${idPrefix}-discard-confirm`}
        isOpen={confirmDiscardOpen}
        onClose={() => setConfirmDiscardOpen(false)}
        onConfirm={() => {
          setConfirmDiscardOpen(false);
          onDiscardRecordChanges();
          deepLinkConsumedRef.current = true;
          setFocusTabId(null);
          onTabUrlChange(null);
        }}
        title={t('clientCommandCenter.discardTitle', { defaultValue: 'Unsaved changes' })}
        message={t('clientCommandCenter.discardMessage', {
          defaultValue: 'You have unsaved client record changes. Close and discard them?',
        })}
        confirmLabel={t('clientCommandCenter.discardConfirm', { defaultValue: 'Discard changes' })}
        cancelLabel={t('clientCommandCenter.discardCancel', { defaultValue: 'Keep editing' })}
      />
    </div>
  );
}
