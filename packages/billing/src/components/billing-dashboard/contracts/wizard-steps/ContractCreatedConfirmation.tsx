'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ContractWizardData } from '../ContractWizard';
import { FirstInvoiceNotice } from './FirstInvoiceNotice';
import { firstInvoiceLines, groupFirstInvoiceLines } from './firstInvoiceLines';

interface ContractCreatedConfirmationProps {
  data: ContractWizardData;
}

/**
 * Shown after a contract with recurring lines is created, so the operator
 * learns when each one first invoices before the wizard closes. Lines that
 * share timing and frequency share a sentence; every sentence names its lines.
 */
export function ContractCreatedConfirmation({ data }: ContractCreatedConfirmationProps) {
  const { t } = useTranslation('msp/contracts');
  const groups = groupFirstInvoiceLines(firstInvoiceLines(data, t));

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
        {groups.map((group, index) => (
          <FirstInvoiceNotice
            key={group.key}
            id={index === 0 ? 'contract-wizard-created-first-invoice' : `contract-wizard-created-first-invoice-${index}`}
            className="space-y-1"
            cadenceOwner={data.cadence_owner}
            billingTiming={group.billingTiming}
            billingFrequency={group.billingFrequency}
            startDate={data.start_date}
            clientId={data.client_id}
            lineNames={group.names}
          />
        ))}
      </div>
    </div>
  );
}
