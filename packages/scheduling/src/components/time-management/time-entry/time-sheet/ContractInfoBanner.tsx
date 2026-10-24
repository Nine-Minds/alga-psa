'use client';

import { memo } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Info, FileText } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { ISO8601String } from '@alga-psa/types';

export interface EligiblePlanUI {
  client_contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  start_date: ISO8601String;
  end_date?: ISO8601String | null;
  contract_name?: string;
  has_bucket_overlay: boolean;
}

interface ContractInfoBannerProps {
  /** Lines loaded by the form (single fetch). `null` while loading. */
  eligibleContractLines: EligiblePlanUI[] | null;
}

/**
 * ContractInfoBanner displays which contract a time entry will use. It is
 * presentational: the form owns the eligibility fetch and passes the lines in.
 * The ambiguous case (several lines, no single bucket-overlay line) renders the
 * "select a contract line" warning that sits directly above the form's picker.
 *
 * Only render when a service is selected.
 */
const ContractInfoBanner = memo(function ContractInfoBanner({
  eligibleContractLines: plans
}: ContractInfoBannerProps) {
  const { t } = useTranslation('msp/time-entry');

  let contractInfo: {
    contractName?: string;
    contractLineName?: string;
    contractLineType?: string;
    requiresSelection?: boolean;
    noContract?: boolean;
    loading?: boolean;
  };
  if (plans === null) {
    contractInfo = { loading: true };
  } else if (plans.length === 0) {
    contractInfo = { noContract: true };
  } else {
    const single = plans.length === 1 ? plans[0] : (() => {
      const overlayPlans = plans.filter((p) => p.has_bucket_overlay);
      return overlayPlans.length === 1 ? overlayPlans[0] : null;
    })();
    contractInfo = single
      ? {
          contractName: single.contract_name,
          contractLineName: single.contract_line_name,
          contractLineType: single.contract_line_type,
        }
      : { requiresSelection: true };
  }

  // Don't render anything if loading
  if (contractInfo.loading) {
    return (
      <div className="p-3 bg-[rgb(var(--color-border-50))] border border-[rgb(var(--color-border-200))] rounded-md animate-pulse">
        <div className="h-4 skeleton-fill rounded w-3/4"></div>
      </div>
    );
  }

  // Show "no contract" message only when we have a service but couldn't find a matching contract
  if (contractInfo.noContract) {
    return (
      <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
        <div className="flex items-center">
          <Info className="h-5 w-5 text-gray-400 mr-2 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            {t('contractInfo.noContract', {
              defaultValue: 'No contract line found for this service. Time will be routed to the system-managed default contract.'
            })}
          </p>
        </div>
      </div>
    );
  }

  if (contractInfo.requiresSelection) {
    return (
      <Alert variant="warning">
        <Info className="h-5 w-5" />
        <AlertDescription>
          {t('contractInfo.multipleEligible', {
            defaultValue: 'Multiple contract lines are eligible for this date. Select a contract line to persist assignment.'
          })}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="info">
      <FileText className="h-5 w-5" />
      <AlertDescription>
        <p className="font-medium">
          {t('contractInfo.contract', {
            defaultValue: 'Contract: {{name}}',
            name: contractInfo.contractName || t('contractInfo.defaultContract', { defaultValue: 'System-managed default contract' })
          })}
        </p>
        <p className="text-xs mt-0.5">
          {contractInfo.contractLineName} ({contractInfo.contractLineType})
        </p>
      </AlertDescription>
    </Alert>
  );
});

export default ContractInfoBanner;
