'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

export type PrintableSummaryMetric = {
  label: React.ReactNode;
  value: React.ReactNode;
};

export interface PrintableSummaryProps {
  metrics: PrintableSummaryMetric[];
  className?: string;
}

/**
 * Print-only KPI strip. Laid out as a fixed table row so the metric cards that
 * reports show on screen survive `@media print` without their grid/flex chrome.
 */
export function PrintableSummary({ metrics, className }: PrintableSummaryProps): React.ReactElement | null {
  if (metrics.length === 0) return null;

  return (
    <section className={cn('app-print-table-section', className)} style={{ marginBottom: '10pt' }}>
      <table className="app-print-table" style={{ tableLayout: 'fixed' }}>
        <tbody>
          <tr>
            {metrics.map((metric, idx) => (
              <td key={idx} style={{ verticalAlign: 'top' }}>
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
