'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import {
  getEntraReconciliationQueue,
  resolveEntraQueueToExisting,
  resolveEntraQueueToNew,
  type EntraReconciliationQueueItem,
} from '@alga-psa/integrations/actions';
import { getAllContacts } from '@alga-psa/clients/actions';
import { ContactPicker } from '@alga-psa/ui/components/ContactPicker';
import type { IContact } from '@alga-psa/types';

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export default function EntraReconciliationQueue() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<EntraReconciliationQueueItem[]>([]);
  const [allContacts, setAllContacts] = React.useState<IContact[]>([]);
  const [resolvingItemId, setResolvingItemId] = React.useState<string | null>(null);
  const [existingContactIdByItem, setExistingContactIdByItem] = React.useState<Record<string, string>>({});

  const loadQueue = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await getEntraReconciliationQueue(50);
      if ('error' in result) {
        setItems([]);
        setError(result.error || 'Failed to load reconciliation queue.');
        return;
      }
      setItems(result.data?.items || []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  React.useEffect(() => {
    const loadContacts = async () => {
      try {
        const result = await getAllContacts('active');
        const normalized = (Array.isArray(result) ? result : []) as IContact[];
        setAllContacts(normalized);
      } catch {
        setAllContacts([]);
      }
    };
    void loadContacts();
  }, []);

  const contactsByClient = React.useMemo(() => {
    const grouped = new Map<string, IContact[]>();
    for (const contact of allContacts) {
      const clientId = typeof contact.client_id === 'string' ? contact.client_id : null;
      if (!clientId) {
        continue;
      }
      const bucket = grouped.get(clientId) || [];
      bucket.push(contact);
      grouped.set(clientId, bucket);
    }
    return grouped;
  }, [allContacts]);

  const handleResolveExisting = React.useCallback(async (item: EntraReconciliationQueueItem) => {
    const contactNameId = String(existingContactIdByItem[item.queueItemId] || '').trim();
    if (!contactNameId) {
      setError('Enter a contact ID to resolve to existing contact.');
      return;
    }

    setResolvingItemId(item.queueItemId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await resolveEntraQueueToExisting({
        queueItemId: item.queueItemId,
        contactNameId,
      });
      if ('error' in result) {
        setError(result.error || 'Failed to resolve queue item.');
      } else {
        setSuccessMessage(`Resolved queue item ${item.queueItemId} to existing contact ${contactNameId}.`);
        await loadQueue();
      }
    } finally {
      setResolvingItemId(null);
    }
  }, [existingContactIdByItem, loadQueue]);

  const handleResolveNew = React.useCallback(async (item: EntraReconciliationQueueItem) => {
    setResolvingItemId(item.queueItemId);
    setError(null);
    setSuccessMessage(null);
    try {
      const result = await resolveEntraQueueToNew({ queueItemId: item.queueItemId });
      if ('error' in result) {
        setError(result.error || 'Failed to resolve queue item.');
      } else {
        setSuccessMessage(`Resolved queue item ${item.queueItemId} by creating contact ${result.data?.contactNameId || ''}.`);
        await loadQueue();
      }
    } finally {
      setResolvingItemId(null);
    }
  }, [loadQueue]);

  return (
    <div className="rounded-lg border border-border/70 bg-background p-4" id="entra-reconciliation-queue">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Ambiguous Match Queue</p>
        <Button id="entra-reconciliation-queue-refresh" type="button" size="sm" variant="ghost" onClick={loadQueue} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading queue…</p> : null}
      {!loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No ambiguous matches are waiting for review.</p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {successMessage ? <p className="text-sm text-emerald-600">{successMessage}</p> : null}

      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.queueItemId}
              className="rounded-md border border-border/60 p-3 text-sm"
              id={`entra-queue-item-${item.queueItemId}`}
            >
              <p className="font-medium">
                {item.displayName || item.userPrincipalName || item.email || item.entraObjectId}
              </p>
              <p className="text-xs text-muted-foreground">
                {item.email || item.userPrincipalName || 'No email identity'} · queued {formatDateTime(item.createdAt)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Candidate contacts: {item.candidateContacts.length}
              </p>
              {item.candidateContacts.length > 0 ? (
                <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                  {item.candidateContacts.slice(0, 3).map((candidate, index) => (
                    <li key={`${item.queueItemId}-candidate-${index}`}>
                      {String(candidate.fullName || candidate.email || candidate.contactNameId || 'candidate')}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                {item.clientId ? (
                  <p className="text-xs text-muted-foreground sm:col-span-3">
                    Existing contact options are limited to this mapped client.
                  </p>
                ) : null}
                <ContactPicker
                  id={`entra-queue-existing-contact-${item.queueItemId}`}
                  contacts={item.clientId ? (contactsByClient.get(item.clientId) || []) : allContacts}
                  value={existingContactIdByItem[item.queueItemId] || ''}
                  onValueChange={(val) => {
                    setExistingContactIdByItem((current) => ({
                      ...current,
                      [item.queueItemId]: val,
                    }));
                  }}
                  placeholder="Select existing contact..."
                  label="Existing Contact"
                  buttonWidth="full"
                />
                <Button
                  id={`entra-queue-resolve-existing-${item.queueItemId}`}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resolvingItemId === item.queueItemId}
                  onClick={() => void handleResolveExisting(item)}
                >
                  Resolve to Existing
                </Button>
                <Button
                  id={`entra-queue-resolve-new-${item.queueItemId}`}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={resolvingItemId === item.queueItemId}
                  onClick={() => void handleResolveNew(item)}
                >
                  Resolve to New
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
