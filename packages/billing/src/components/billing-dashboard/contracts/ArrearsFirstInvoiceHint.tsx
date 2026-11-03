'use client';

import React from 'react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatYmd } from '@alga-psa/ui/lib/i18n/useFormatYmd';
import {
  resolveArrearsFirstInvoiceHint,
  type ArrearsFirstInvoiceHintResult,
  type FirstInvoiceClientSchedule,
} from '../../../lib/firstInvoiceDate';

export interface ArrearsFirstInvoiceHintProps {
  id: string;
  lineType?: string;
  cadenceOwner?: 'client' | 'contract';
  billingTiming?: 'arrears' | 'advance';
  /** Contract/line start date, `YYYY-MM-DD`. */
  startDate?: string | null;
  /**
   * The client's billing schedule, fetched once by the surface via
   * `useClientBillingSchedule`. `null`/`undefined` (loading, failed, forbidden)
   * renders nothing, so the hint never flashes or guesses a date.
   */
  clientSchedule?: FirstInvoiceClientSchedule | null;
  /** Edit surfaces pass today so the hint hides once the first invoice window has opened. */
  today?: Date;
  /** When given, shows a "Bill in advance" button that calls it. */
  onBillInAdvance?: () => void;
}

/**
 * Tells the user, at the point they choose billing timing, when the first
 * partial period of a Fixed, client-cadence, arrears line will be invoiced and
 * which dates it covers. Renders nothing in every other case; the rule lives in
 * `resolveArrearsFirstInvoiceHint`.
 */
export function ArrearsFirstInvoiceHint({
  id,
  lineType,
  cadenceOwner,
  billingTiming,
  startDate,
  clientSchedule,
  today,
  onBillInAdvance,
}: ArrearsFirstInvoiceHintProps) {
  const hint = resolveArrearsFirstInvoiceHint(
    { lineType, cadenceOwner, billingTiming, startDate, clientSchedule },
    today,
  );
  if (!hint) return null;

  return <HintBody id={id} hint={hint} onBillInAdvance={onBillInAdvance} />;
}

// Split from the gate above so the formatting/translation hooks only run when a hint is actually shown.
function HintBody({
  id,
  hint,
  onBillInAdvance,
}: {
  id: string;
  hint: ArrearsFirstInvoiceHintResult;
  onBillInAdvance?: () => void;
}) {
  const { t } = useTranslation('msp/contracts');
  const formatYmd = useFormatYmd();

  return (
    <Alert variant="info" id={id}>
      <AlertDescription>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            {t('arrearsFirstInvoiceHint.message', {
              invoiceDate: formatYmd(hint.invoiceDate),
              periodStart: formatYmd(hint.periodStart),
              periodEnd: formatYmd(hint.periodEndInclusive),
              advanceInvoiceDate: formatYmd(hint.advanceInvoiceDate),
              defaultValue:
                'First invoice: the {{invoiceDate}} invoice covers {{periodStart}} – {{periodEnd}} (billed in arrears). Choose In Advance to bill it on the invoice for the period starting {{advanceInvoiceDate}}.',
            })}
          </p>
          {onBillInAdvance && (
            <Button id={`${id}-bill-in-advance`} type="button" variant="outline" size="sm" onClick={onBillInAdvance}>
              {t('arrearsFirstInvoiceHint.billInAdvance', { defaultValue: 'Bill in advance' })}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
