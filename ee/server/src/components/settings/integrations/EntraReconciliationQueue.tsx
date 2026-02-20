'use client';

import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import {
  getEntraReconciliationQueue,
  type EntraReconciliationQueueItem,
} from '@alga-psa/integrations/actions';

function formatDateTime(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
}

export default function EntraReconciliationQueue() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<EntraReconciliationQueueItem[]>([]);

  const loadQueue = React.useCallback(async () => {
    setLoading(true);
    setError(null);
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
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
