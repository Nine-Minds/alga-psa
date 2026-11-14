'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCapability } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ClientCoManagedIntegrationProps, ClientCoManagedSlots } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import { getCoManagedClientManagement } from '@/lib/actions/coManagedActions';
import CoManagedClientSummary from './CoManagedClientSummary';
import CoManagedClientView from './CoManagedClientView';
import { getCoManagedSeatClientState } from '@/lib/actions/coManagedSeatActions';
import CoManagedSeatClientView, { type CoManagedSeatClientState } from './CoManagedSeatClientView';
import CoManagedSeatSummary from './CoManagedSeatSummary';
import CoManagedShapeChooser from './CoManagedShapeChooser';

type View = Awaited<ReturnType<typeof getCoManagedClientManagement>>;

/**
 * App-owned co-managed integration for the client record. It owns capability
 * admission and the shared refresh state behind the summary and the co-managed
 * tab. When the capability does not admit this tenant it renders the ordinary
 * client with no feature slots and starts no feature read.
 */
export default function ClientCoManagedIntegration({ clientId, clientName, idPrefix, relationshipId, onOpenTab, children }: ClientCoManagedIntegrationProps) {
  const { t } = useTranslation('msp/licensing');
  const { admitted } = useCapability('co-managed');
  // The seat shape is a second capability. With it closed nothing below reads or renders seat state.
  const seatCapability = useCapability('co-managed-seat');
  const seatOpen = seatCapability.enabled || seatCapability.admitted;
  const [seatState, setSeatState] = useState<CoManagedSeatClientState | null>(null);
  const seatGeneration = useRef(0);
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(relationshipId ?? null);
  const generation = useRef(0);
  const viewRef = useRef<View | null>(null);
  // The setup draft lives in the tab; the command center asks before discarding it.
  const dirtyRef = useRef(false);
  const [resetKey, setResetKey] = useState(0);

  // A client switch resets the slots and shows loading. A manual refresh keeps
  // the current slots so the registered tab survives; only a first-load failure
  // drops back to the ordinary client.
  const load = useCallback(async (relId: string | null, reset: boolean) => {
    const current = ++generation.current;
    if (reset) {
      viewRef.current = null;
      setView(null);
      setStatus('loading');
    }
    try {
      const next = await getCoManagedClientManagement(clientId, relId ?? undefined);
      if (generation.current !== current) return;
      viewRef.current = next;
      setView(next);
      setStatus('ready');
    } catch {
      if (generation.current !== current) return;
      if (!viewRef.current) { setView(null); setStatus('error'); }
    }
  }, [clientId]);
  const reload = useCallback(() => load(selectedRelationshipId, false), [load, selectedRelationshipId]);

  // Selecting a relationship updates this view in place; the URL is only synced
  // shallowly because routing would re-render the server tree and close the view.
  const selectRelationship = useCallback((relId: string | null) => {
    setSelectedRelationshipId(relId);
    if (typeof window !== 'undefined') {
      const query = new URLSearchParams({ tab: 'co-managed' });
      if (relId) query.set('relationshipId', relId);
      window.history.replaceState(null, '', `${window.location.pathname}?${query.toString()}`);
    }
    void load(relId, false);
  }, [load]);

  useEffect(() => {
    if (!admitted) {
      generation.current += 1;
      viewRef.current = null;
      setView(null);
      setStatus('idle');
      return;
    }
    void load(relationshipId ?? null, true);
    return () => { generation.current += 1; };
    // Reset only for a new client or capability change; a deep-link relationship is applied at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admitted, clientId]);

  const loadSeat = useCallback(async () => {
    const current = ++seatGeneration.current;
    try {
      const next = await getCoManagedSeatClientState(clientId);
      if (seatGeneration.current === current) setSeatState(next);
    } catch {
      if (seatGeneration.current === current) setSeatState(null);
    }
  }, [clientId]);

  useEffect(() => {
    if (!seatOpen) { seatGeneration.current += 1; setSeatState(null); return; }
    void loadSeat();
    return () => { seatGeneration.current += 1; };
  }, [seatOpen, loadSeat]);

  const reloadAll = useCallback(async () => {
    await Promise.all([admitted ? reload() : Promise.resolve(), seatOpen ? loadSeat() : Promise.resolve()]);
  }, [admitted, seatOpen, reload, loadSeat]);

  const workspaceReady = admitted && status === 'ready' && view !== null;
  // Seat state may not be there yet or may be unreadable; then the client renders as it always has.
  const seat = seatOpen ? seatState : null;
  if (!workspaceReady && !seat) return <>{children(null)}</>;

  const enable = seat?.enable ?? null;
  const chooser = enable ? (workspace: React.ReactNode) => (
    <CoManagedShapeChooser clientId={clientId} idPrefix={idPrefix} enable={enable} workspaceSetup={workspace}
      onEnabled={reloadAll} onDirtyChange={(dirty) => { dirtyRef.current = dirty; }} />
  ) : null;

  const tabLabel = t('coManaged.client.tab', { defaultValue: 'Co-managed IT' });
  const tabBase = {
    id: 'co-managed',
    label: tabLabel,
    hasUnsavedChanges: () => dirtyRef.current,
    onDiscardUnsavedChanges: () => { dirtyRef.current = false; setResetKey((key) => key + 1); },
  };
  if (!workspaceReady || !view) {
    if (!seat) return <>{children(null)}</>;
    // Seat-only: the workspace side is not open for this tenant, so the tab is the seat panel or chooser.
    const slots: ClientCoManagedSlots = {
      summary: <CoManagedSeatSummary state={seat} idPrefix={idPrefix} onOpenTab={onOpenTab} />,
      tab: { ...tabBase, content: (
        <CoManagedSeatClientView key={resetKey} state={seat} clientName={clientName} idPrefix={idPrefix} onReload={reloadAll}>
          {chooser?.(null)}
        </CoManagedSeatClientView>) },
    };
    return <>{children(slots)}</>;
  }

  const slots: ClientCoManagedSlots = {
    summary: seat?.panel
      ? <CoManagedSeatSummary state={seat} idPrefix={idPrefix} onOpenTab={onOpenTab} />
      : <CoManagedClientSummary view={view} clientId={clientId} idPrefix={idPrefix}
        selectedRelationshipId={selectedRelationshipId} onSelectRelationship={selectRelationship} onOpenTab={onOpenTab} />,
    tab: {
      ...tabBase,
      content: seat?.panel ? (
        <CoManagedSeatClientView key={resetKey} state={seat} clientName={clientName} idPrefix={idPrefix} onReload={reloadAll} />
      ) : (
        <CoManagedClientView
          view={view}
          clientId={clientId}
          clientName={clientName}
          idPrefix={idPrefix}
          relationshipId={selectedRelationshipId}
          onSelectRelationship={selectRelationship}
          onReload={seat ? reloadAll : reload}
          resetKey={resetKey}
          onDirtyChange={(dirty) => { dirtyRef.current = dirty; }}
          renderSetup={chooser ?? undefined}
        />
      ),
    },
  };
  return <>{children(slots)}</>;
}
