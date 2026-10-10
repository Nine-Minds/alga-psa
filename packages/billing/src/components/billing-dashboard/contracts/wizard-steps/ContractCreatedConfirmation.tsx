'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ContractWizardData } from '../ContractWizard';
import { FirstInvoiceNotice } from './FirstInvoiceNotice';

interface ContractCreatedConfirmationProps {
  data: ContractWizardData;
}

/**
 * Shown after a contract with fixed-fee lines is created, so the operator
 * learns when it first invoices before the wizard closes.
 */
export function ContractCreatedConfirmation({ data }: ContractCreatedConfirmationProps) {
  const { t } = useTranslation('msp/contracts');

  return (
    <div id="contract-wizard-created-confirmation" className="space-y-4" role="status">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-[rgb(var(--color-status-success))]" />
        <h3 className="text-lg font-semibold">
          {t('wizardCreated.heading', {
            contractName: data.contract_name,
            defaultValue: '{{contractName}} was created',
          })}
        </h3>
      </div>
      <div className="space-y-1 text-sm text-[rgb(var(--color-text-500))]">
        <p className="font-medium text-[rgb(var(--color-text-700))]">
          {t('wizardCreated.firstInvoiceHeading', { defaultValue: 'First invoice' })}
        </p>
        <FirstInvoiceNotice
          id="contract-wizard-created-first-invoice"
          className="space-y-1"
          cadenceOwner={data.cadence_owner}
          billingTiming={data.billing_timing}
          billingFrequency={data.fixed_billing_frequency ?? data.billing_frequency}
          startDate={data.start_date}
          clientId={data.client_id}
        />
      </div>
    </div>
  );
}
