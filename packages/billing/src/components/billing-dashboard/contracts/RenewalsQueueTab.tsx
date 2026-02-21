'use client';

import React from 'react';

export default function RenewalsQueueTab() {
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
      </header>

      <div className="rounded-md border border-dashed border-[rgb(var(--color-border-200))] p-4 text-sm text-[rgb(var(--color-text-500))]">
        Renewal queue table will appear here.
      </div>
    </section>
  );
}
