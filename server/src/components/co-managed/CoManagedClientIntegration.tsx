'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ClientCoManagedIntegrationProps, ClientCoManagedSlots } from '@alga-psa/clients/context/ClientCrossFeatureContext';
import { getCoManagedClientManagement } from '@/lib/actions/coManagedActions';
import CoManagedClientSummary from './CoManagedClientSummary';
import CoManagedClientView from './CoManagedClientView';
import QualifiedTicketList from './QualifiedTicketList';

type View = Awaited<ReturnType<typeof getCoManagedClientManagement>>;

/**
 * App-owned co-managed integration for the client record. It owns product
 * eligibility via the release boundary, client-authorized discovery, and the
 * shared refresh state behind the summary and the co-managed tab. When the
 * feature is unavailable it renders the ordinary client with no feature slots
 * and starts no feature read.
 */
export default function ClientCoManagedIntegration({ clientId, clientName, idPrefix, relationshipId, onOpenTab, children }: ClientCoManagedIntegrationProps) {
  const { t } = useTranslation('msp/licensing');
  const { enabled, loading, error } = useFeatureFlag('release-v1-6-feature', { defaultValue: false });
  const usable = enabled === true && !loading && !error;
  const [view, setView] = useState<View | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(relationshipId ?? null);
  const generation = useRef(0);
  const viewRef = useRef<View | null>(null);
  const dirtyRef = useRef(false);
  const [resetKey, setResetKey] = useState(0);

  // A client/relationship switch resets the slots and shows loading. A manual
  // refresh keeps the current slots so the registered tab and any open focus
  // view survive; only a first-load failure drops back to the ordinary client.
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

  // Selecting a relationship updates this view in place. Routing to the same
  // page with a new query would re-render the server tree and close the focus
  // view, so the URL is only synced shallowly for sharing and reloads.
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
    if (!usable) {
      generation.current += 1;
      viewRef.current = null;
      setView(null);
      setStatus('idle');
      return;
    }
    void load(relationshipId ?? null, true);
    return () => { generation.current += 1; };
    // Reset only for a new client or feature availability. A pending deep-link
    // relationship is applied at mount; later URL changes are selections below
    // and must not drop the tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usable, clientId]);

  // A URL/deep-link selection that differs from the current one loads the new
  // relationship without resetting the slots, so the focus view stays open.
  useEffect(() => {
    const next = relationshipId ?? null;
    if (next === null || next === selectedRelationshipId) return;
    setSelectedRelationshipId(next);
    void load(next, false);
  }, [relationshipId, selectedRelationshipId, load]);

  if (!usable || status !== 'ready' || !view) return <>{children(null)}</>;

  const slots: ClientCoManagedSlots = {
    summary: <CoManagedClientSummary view={view} clientId={clientId} idPrefix={idPrefix}
      selectedRelationshipId={selectedRelationshipId} onSelectRelationship={selectRelationship} onOpenTab={onOpenTab} />,
    // Only a co-managed client replaces its native ticket list. The refactored
    // combined list body is embedded with the client fixed to this record; it
    // matches native MSP tickets and every authorized shared relationship for
    // the client, without a second page heading or global client selector.
    ...(view.relationships.length > 0 ? {
      ticketsContent: (
        <QualifiedTicketList
          scope={{ kind: 'qualified', view: 'working', workspace: 'all' }}
          fixedClientId={clientId}
          embedded
          actorScope={`client:${clientId}`}
          idPrefix={`co-managed-client-${clientId}`}
        />
      ),
    } : {}),
    tab: {
      id: 'co-managed',
      label: t('coManaged.client.tab', { defaultValue: 'Co-managed IT' }),
      hasUnsavedChanges: () => dirtyRef.current,
      onDiscardUnsavedChanges: () => { dirtyRef.current = false; setResetKey((key) => key + 1); },
      content: (
        <CoManagedClientView
          view={view}
          clientId={clientId}
          clientName={clientName}
          idPrefix={idPrefix}
          relationshipId={selectedRelationshipId}
          onSelectRelationship={selectRelationship}
          onReload={reload}
          resetKey={resetKey}
          onDirtyChange={(dirty) => { dirtyRef.current = dirty; }}
        />
      ),
    },
  };
  return <>{children(slots)}</>;
}
