'use client';

import React, { useEffect, useState } from 'react';
import {
  listRenewalQueueRows,
  type RenewalQueueRow,
} from '@alga-psa/billing/actions/renewalsQueueActions';

const DEFAULT_HORIZON_DAYS = 90;

export default function RenewalsQueueTab() {
  const [rows, setRows] = useState<RenewalQueueRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadRows = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const result = await listRenewalQueueRows();
        if (!cancelled) {
          setRows(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load renewal queue rows');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadRows();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section
      data-testid="renewals-queue-page"
      className="space-y-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-100))] p-4"
    >
      <header className="space-y-1">
        <h2 className="text-xl font-semibold">Renewals</h2>
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          Track upcoming contract renewal decisions and take action from a single queue.
        </p>
        <p className="text-xs text-[rgb(var(--color-text-400))]">
          Showing contracts due within the next {DEFAULT_HORIZON_DAYS} days.
        </p>
      </header>

      <div
        data-testid="renewals-queue-content"
        className="rounded-md border border-dashed border-[rgb(var(--color-border-200))] p-4 text-sm text-[rgb(var(--color-text-500))]"
      >
        {isLoading && <p>Loading renewal queue...</p>}
        {!isLoading && error && <p>{error}</p>}
        {!isLoading && !error && rows.length === 0 && <p>No upcoming renewals found.</p>}
        {!isLoading && !error && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((row) => (
              <div
                key={`${row.client_contract_id}:${row.renewal_cycle_key ?? row.decision_due_date ?? row.contract_id}`}
                data-testid="renewals-queue-row"
                className="rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-0))] p-3"
              >
                <p className="font-medium">{row.contract_name ?? row.contract_id}</p>
                <p className="text-xs text-[rgb(var(--color-text-500))]">
                  {row.client_name ?? row.client_id} • due {row.decision_due_date ?? 'n/a'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
