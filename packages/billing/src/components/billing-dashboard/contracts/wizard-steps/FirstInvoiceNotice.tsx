'use client';

import { useEffect, useMemo, useState } from 'react';
import { parse } from 'date-fns';
import { getClientBillingCycleAnchor } from '@alga-psa/billing/actions/billingCycleAnchorActions';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  resolveFirstInvoiceDate,
  type FirstInvoiceClientSchedule,
  type FirstInvoiceDate,
  type FirstInvoiceDateInput,
} from './firstInvoiceDate';

interface FirstInvoiceNoticeProps {
  id: string;
  cadenceOwner?: 'client' | 'contract';
  billingTiming?: 'arrears' | 'advance';
  billingFrequency?: string;
  startDate?: string;
  clientId?: string;
  className?: string;
}

type ClientScheduleState =
  | { status: 'idle' }
  | { status: 'loading'; clientId: string }
  | { status: 'ready'; clientId: string; schedule: FirstInvoiceClientSchedule | null };

/**
 * Client cadence follows the client's own billing cycle, so it needs that cycle
 * before a date can be stated. A failed or forbidden fetch resolves to `null`
 * (rendered as a date-free sentence) rather than a guessed date.
 */
function useFirstInvoiceDate(input: FirstInvoiceDateInput, clientId?: string) {
  const needsClientSchedule = input.cadenceOwner !== 'contract';
  const [scheduleState, setScheduleState] = useState<ClientScheduleState>({ status: 'idle' });

  useEffect(() => {
    if (!needsClientSchedule || !clientId) {
      setScheduleState({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setScheduleState({ status: 'loading', clientId });
    getClientBillingCycleAnchor(clientId)
      .then((config) => {
        if (cancelled) return;
        const usable = !isActionMessageError(config) && !isActionPermissionError(config);
        setScheduleState({
          status: 'ready',
          clientId,
          schedule: usable ? { billingCycle: config.billingCycle, anchor: config.anchor } : null,
        });
      })
      .catch((error) => {
        console.error('Failed to load client billing schedule for first invoice timing', error);
        if (!cancelled) {
          setScheduleState({ status: 'ready', clientId, schedule: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [needsClientSchedule, clientId]);

  const isLoading =
    needsClientSchedule && !!clientId && (scheduleState.status !== 'ready' || scheduleState.clientId !== clientId);
  const clientSchedule =
    scheduleState.status === 'ready' && scheduleState.clientId === clientId ? scheduleState.schedule : null;

  const result = useMemo(
    () => resolveFirstInvoiceDate({ ...input, clientSchedule }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input.cadenceOwner, input.billingTiming, input.billingFrequency, input.startDate, clientSchedule],
  );

  return { result, isLoading };
}

/**
 * One plain sentence saying when the fixed-fee line first invoices, for the
 * wizard review step and the post-creation confirmation.
 */
export function FirstInvoiceNotice({
  id,
  cadenceOwner,
  billingTiming,
  billingFrequency,
  startDate,
  clientId,
  className,
}: FirstInvoiceNoticeProps) {
  const { t } = useTranslation('msp/contracts');
  const { formatDate } = useFormatters();
  const { result, isLoading } = useFirstInvoiceDate(
    { cadenceOwner, billingTiming, billingFrequency, startDate },
    clientId,
  );

  // LEVERAGE: pattern ymd-local-format — parse a YYYY-MM-DD string as a local date, then format it in the user's locale (also in ReviewContractStep)
  const formatYmd = (ymd: string) => {
    const local = parse(ymd, 'yyyy-MM-dd', new Date());
    return isNaN(local.getTime()) ? ymd : formatDate(local);
  };

  if (isLoading) {
    return (
      <p id={id} className={className}>
        {t('wizardFirstInvoice.loading', {
          defaultValue: "Checking the client's billing schedule…",
        })}
      </p>
    );
  }

  return (
    <div id={id} className={className}>
      <p>{describeFirstInvoice(result, t, formatYmd)}</p>
      {result.status === 'date' && result.scenario.endsWith('arrears') && (
        <p>
          {t('wizardFirstInvoice.arrearsPreviewNote', {
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
      return t('wizardFirstInvoice.client.arrears', {
        date,
        defaultValue:
          "Billed in arrears on the client's billing schedule: the first invoice becomes available on {{date}}, when the client's current billing period ends.",
      });
    case 'client_advance':
      return t('wizardFirstInvoice.client.advance', {
        date,
        defaultValue:
          "Billed in advance on the client's billing schedule: the first invoice is available from {{date}}, the start of the client's billing period that contains the contract start date.",
      });
  }
}
