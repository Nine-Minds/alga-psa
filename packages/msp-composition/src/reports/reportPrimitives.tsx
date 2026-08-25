'use client';

import type { ReactNode } from 'react';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

export const isReportActionError = (value: unknown) =>
  isActionMessageError(value) || isActionPermissionError(value);

export function formatHours(value: number): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}h`;
}

export function MetricCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-3">
      <p className="text-xs font-medium text-[rgb(var(--color-text-500))]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[rgb(var(--color-text-900))]">{value}</p>
    </div>
  );
}

export interface PrintMetric {
  label: string;
  value: number | string;
}

export function PrintHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="app-print-detail-header">
      <h1>{title}</h1>
      <p className="app-print-detail-subtitle">{subtitle}</p>
    </header>
  );
}

export function PrintSummary({ metrics }: { metrics: PrintMetric[] }) {
  if (metrics.length === 0) return null;
  return (
    <section className="app-print-table-section" style={{ marginBottom: '10pt' }}>
      <table className="app-print-table" style={{ tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            {metrics.map((metric) => (
              <td key={metric.label} style={{ verticalAlign: 'top' }}>
                <div style={{ fontSize: '8pt', color: '#555', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {metric.label}
                </div>
                <div style={{ fontSize: '15pt', fontWeight: 700, marginTop: '2pt' }}>{metric.value}</div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export function PrintReportRoot({ children }: { children: ReactNode }) {
  return <div className="app-print-root app-print-only">{children}</div>;
}

export function LoadingReport() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
