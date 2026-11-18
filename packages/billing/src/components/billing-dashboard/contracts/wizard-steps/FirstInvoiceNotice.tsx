'use client';

import { useMemo } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatYmd } from '@alga-psa/ui/lib/i18n/useFormatYmd';
import { useClientBillingSchedule } from '../../../../hooks/useClientBillingSchedule';
import {
  resolveFirstInvoiceDate,
  type FirstInvoiceDate,
  type FirstInvoiceDateInput,
} from '../../../../lib/firstInvoiceDate';

interface FirstInvoiceNoticeProps {
  id: string;
  cadenceOwner?: 'client' | 'contract';
  billingTiming?: 'arrears' | 'advance';
  billingFrequency?: string;
  startDate?: string;
  clientId?: string;
  /** Names of the lines this sentence covers; shown above it when more than one line could be meant. */
  lineNames?: string[];
  className?: string;
}

/**
 * Client cadence follows the client's own billing cycle, so it needs that cycle
 * before a date can be stated. A failed or forbidden fetch resolves to `null`
 * (rendered as a date-free sentence) rather than a guessed date.
 */
function useFirstInvoiceDate(input: FirstInvoiceDateInput, clientId?: string) {
  const needsClientSchedule = input.cadenceOwner !== 'contract';
  const { isLoading, schedule: clientSchedule } = useClientBillingSchedule(clientId, needsClientSchedule);

  const result = useMemo(
    () => resolveFirstInvoiceDate({ ...input, clientSchedule }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.cadenceOwner, input.billingTiming, input.billingFrequency, input.startDate, clientSchedule],
  );

  return { result, isLoading };
}

/**
 * One plain sentence saying when a recurring line (or a group of lines sharing
 * timing and frequency) first invoices, for the wizard review step and the
 * post-creation confirmation.
 */
export function FirstInvoiceNotice({
  id,
  cadenceOwner,
  billingTiming,
  billingFrequency,
  startDate,
  clientId,
  lineNames,
  className,
}: FirstInvoiceNoticeProps) {
  const { t } = useTranslation('msp/contracts');
  const formatYmd = useFormatYmd();
  const { result, isLoading } = useFirstInvoiceDate(
    { cadenceOwner, billingTiming, billingFrequency, startDate },
    clientId,
  );

  if (isLoading) {
    return (
      <p id={id} className={className}>
        {t('wizardFirstInvoice.loading', {
          defaultValue: "Checking the client's billing schedule…",
        })}
      </p>
    );
  }

  const coversSeveralLines = (lineNames?.length ?? 0) > 1;

  return (
    <div id={id} className={className}>
      {lineNames && lineNames.length > 0 && (
        <p className="font-medium text-[rgb(var(--color-text-700))]">{lineNames.join(', ')}</p>
      )}
      <p>{describeFirstInvoice(result, t, formatYmd)}</p>
      {result.status === 'date' && result.scenario.endsWith('arrears') && (
        <p>
          {coversSeveralLines
            ? t('wizardFirstInvoice.arrearsPreviewNoteMany', {
                defaultValue:
                  'Until then, an invoice preview for this client has nothing to bill for these lines.',
              })
            : t('wizardFirstInvoice.arrearsPreviewNote', {
                defaultValue:
                  'Until then, an invoice preview for this client has nothing to bill for this line.',
              })}
        </p>
      )}
    </div>
  );
}

function describeFirstInvoice(
  result: FirstInvoiceDate,
  t: (key: string, options?: Record<string, unknown>) => string,
  formatYmd: (ymd: string) => string,
): string {
  if (result.status === 'unavailable') {
    switch (result.reason) {
      case 'missing_start_date':
        return t('wizardFirstInvoice.unavailable.missingStartDate', {
          defaultValue: 'Choose a start date to see when this contract first invoices.',
        });
      case 'unsupported_frequency':
        return t('wizardFirstInvoice.unavailable.unsupportedFrequency', {
          defaultValue:
            "No first invoice date is shown because contract-cadence billing doesn't support this frequency. Pick a supported frequency or bill on the client's schedule.",
        });
      case 'client_schedule_unavailable':
        return t('wizardFirstInvoice.unavailable.clientSchedule', {
          defaultValue:
            "This line bills on the client's billing schedule. That schedule couldn't be loaded, so no date is shown.",
        });
    }
  }

  const date = formatYmd(result.invoiceDate);
  switch (result.scenario) {
    case 'contract_arrears':
      return t('wizardFirstInvoice.contract.arrears', {
        date,
        defaultValue:
          "Billed in arrears on the contract's cadence: the first invoice becomes available on {{date}}, when the first service period ends.",
      });
    case 'contract_advance':
      return t('wizardFirstInvoice.contract.advance', {
        date,
        defaultValue:
          "Billed in advance on the contract's cadence: the first invoice is available from {{date}}, the contract start date.",
      });
    case 'client_arrears':
      if (result.startsMidPeriod) {
        return t('wizardFirstInvoice.client.arrearsPartial', {
          date,
          periodStart: formatYmd(result.servicePeriodStart),
          periodEnd: formatYmd(result.servicePeriodEndInclusive),
          defaultValue:
            "Billed in arrears on the client's billing schedule: the first invoice becomes available on {{date}}, when the client's billing period containing the start date ends. Because the start date falls partway through that period, it covers {{periodStart}} – {{periodEnd}}.",
        });
      }
      return t('wizardFirstInvoice.client.arrears', {
        date,
        defaultValue:
          "Billed in arrears on the client's billing schedule: the first invoice becomes available on {{date}}, when the client's billing period containing the start date ends.",
      });
    case 'client_advance':
      return t('wizardFirstInvoice.client.advance', {
        date,
        defaultValue:
          "Billed in advance on the client's billing schedule: the first invoice is available from {{date}}, the start of the client's billing period that contains the contract start date.",
      });
  }
}
