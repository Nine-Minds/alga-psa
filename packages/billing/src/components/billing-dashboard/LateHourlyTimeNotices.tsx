'use client';

import React from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import type { ILateHourlyTimeNotice } from '@alga-psa/types';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';

/**
 * Approved hourly time dated in a service period an earlier invoice closed.
 * Entries that no invoice will ever bill (no later period on their line) are a
 * warning with the operator's options; entries that bill on the line's next
 * invoice are listed so the carry-forward is never a surprise.
 */
export function LateHourlyTimeNotices({ notices, idPrefix }: { notices: ILateHourlyTimeNotice[]; idPrefix: string }) {
  const { t } = useTranslation('msp/invoicing');
  const { formatDate } = useFormatters();
  if (notices.length === 0) return null;
  const stranded = notices.filter((notice) => notice.disposition === 'no_later_period');
  const carried = notices.filter((notice) => notice.disposition === 'next_invoice');
  const date = (value: string) => formatDate(new Date(`${value}T00:00:00`), { dateStyle: 'medium' });
  const row = (notice: ILateHourlyTimeNotice) => (
    <li key={notice.entryId} className="rounded-md border border-border/70 bg-background/80 px-3 py-2 text-sm"
      data-testid={`${idPrefix}-entry-${notice.entryId}`}>
      <div className="font-medium">
        {[notice.clientName, notice.contractLineName].filter(Boolean).join(' · ')}
      </div>
      <div className="text-muted-foreground">
        {t('automaticInvoices.lateTime.entry', {
          defaultValue: '{{date}} · {{minutes}} min {{service}}{{work}}{{technician}}',
          date: date(notice.workDate),
          minutes: notice.billableMinutes,
          service: notice.serviceName ?? '',
          work: notice.workItemLabel ? ` · ${notice.workItemLabel}` : '',
          technician: notice.technicianName ? ` · ${notice.technicianName}` : '',
        })}
      </div>
      <div className="text-muted-foreground">
        {t('automaticInvoices.lateTime.closedBy', {
          defaultValue: 'Service period {{start}} – {{end}} was invoiced on {{invoice}} ({{status}}).',
          start: date(notice.closedPeriodStart),
          end: date(notice.closedPeriodEnd),
          invoice: notice.closedByInvoiceNumber ?? t('automaticInvoices.lateTime.unnumberedInvoice', { defaultValue: 'an earlier invoice' }),
          status: notice.closedByInvoiceStatus ?? '—',
        })}
      </div>
    </li>
  );
  return (
    <div className="space-y-3" data-testid={idPrefix}>
      {stranded.length > 0 && (
        <Alert className="border-warning/40 bg-warning/5" data-testid={`${idPrefix}-stranded`}>
          <AlertDescription>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="space-y-2">
                <h4 className="font-semibold">
                  {t('automaticInvoices.lateTime.strandedTitle', {
                    count: stranded.length,
                    defaultValue: 'Approved time that no invoice will bill ({{count}})',
                  })}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {t('automaticInvoices.lateTime.strandedDescription', {
                    defaultValue: 'This time was approved after its service period was invoiced, and its contract line has no later service period to carry it. Restore or extend the contract line so a later period exists and it bills there, or, if the invoice for that period is still a draft, reverse the draft and generate the period again to include it.',
                  })}
                </p>
                <ul className="space-y-2">{stranded.map(row)}</ul>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {carried.length > 0 && (
        <Alert className="border-border bg-muted/40" data-testid={`${idPrefix}-carried`}>
          <AlertDescription>
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="space-y-2">
                <h4 className="font-semibold">
                  {t('automaticInvoices.lateTime.carriedTitle', {
                    count: carried.length,
                    defaultValue: 'Late approved time billed on the next invoice ({{count}})',
                  })}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {t('automaticInvoices.lateTime.carriedDescription', {
                    defaultValue: 'This time was approved after its service period was invoiced. It bills once on the next invoice for its contract line, labelled with its own service period; the earlier invoice is not changed.',
                  })}
                </p>
                <ul className="space-y-2">{carried.map(row)}</ul>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default LateHourlyTimeNotices;
