'use client';

import { memo, useEffect, useState } from 'react';
import { Info, FileText } from 'lucide-react';
import { getEligibleContractLinesForUI, getClientIdForWorkItem } from 'server/src/lib/utils/contractLineDisambiguation';
import { ISO8601String } from 'server/src/types/types.d';

interface ContractInfoBannerProps {
  workItemId: string;
  workItemType: string;
  serviceId?: string | null;
  entryDate?: Date;
  clientId?: string | null;
}

interface EligiblePlanUI {
  client_contract_line_id: string;
  contract_line_name: string;
  contract_line_type: string;
  start_date: ISO8601String;
  end_date?: ISO8601String | null;
  contract_name?: string;
  has_bucket_overlay: boolean;
}

/**
 * ContractInfoBanner displays information about which contract will be used
 * for a time entry. This is a read-only informational component.
 */
const ContractInfoBanner = memo(function ContractInfoBanner({
  workItemId,
  workItemType,
  serviceId,
  entryDate,
  clientId: propClientId
}: ContractInfoBannerProps) {
  const [contractInfo, setContractInfo] = useState<{
    contractName?: string;
    contractLineName?: string;
    contractLineType?: string;
    multipleLines?: boolean;
    noContract?: boolean;
    loading?: boolean;
  }>({ loading: true });

  useEffect(() => {
    const fetchContractInfo = async () => {
      setContractInfo({ loading: true });

      // Get client ID if not provided
      let clientId = propClientId;
      if (!clientId && workItemId && workItemType) {
        try {
          clientId = await getClientIdForWorkItem(workItemId, workItemType);
        } catch (error) {
          console.error('Error fetching client ID:', error);
        }
      }

      if (!clientId || !serviceId) {
        setContractInfo({ noContract: true, loading: false });
        return;
      }

      try {
        const plans = await getEligibleContractLinesForUI(clientId, serviceId) as EligiblePlanUI[];
        const date = entryDate || new Date();

        // Filter by date
        const eligiblePlans = plans.filter(plan => {
          const start = new Date(plan.start_date as string);
          const end = plan.end_date ? new Date(plan.end_date as string) : null;
          return start <= date && (!end || end >= date);
        });

        if (eligiblePlans.length === 0) {
          setContractInfo({ noContract: true, loading: false });
        } else if (eligiblePlans.length === 1) {
          setContractInfo({
            contractName: eligiblePlans[0].contract_name,
            contractLineName: eligiblePlans[0].contract_line_name,
            contractLineType: eligiblePlans[0].contract_line_type,
            loading: false
          });
        } else {
          // Multiple eligible lines - find the default (bucket overlay or first)
          const overlayPlans = eligiblePlans.filter(p => p.has_bucket_overlay);
          const defaultPlan = overlayPlans.length === 1 ? overlayPlans[0] : eligiblePlans[0];
          setContractInfo({
            contractName: defaultPlan.contract_name,
            contractLineName: defaultPlan.contract_line_name,
            contractLineType: defaultPlan.contract_line_type,
            multipleLines: true,
            loading: false
          });
        }
      } catch (error) {
        console.error('Error fetching contract info:', error);
        setContractInfo({ noContract: true, loading: false });
      }
    };

    fetchContractInfo();
  }, [workItemId, workItemType, serviceId, entryDate, propClientId]);

  if (contractInfo.loading) {
    return (
      <div className="p-3 bg-gray-50 border border-gray-200 rounded-md animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      </div>
    );
  }

  if (contractInfo.noContract) {
    return (
      <div className="p-3 bg-gray-50 border border-gray-200 rounded-md">
        <div className="flex items-center">
          <Info className="h-5 w-5 text-gray-400 mr-2 flex-shrink-0" />
          <p className="text-sm text-gray-600">
            No contract line found for this service. Time will be billed at default rates.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 bg-blue-50 border border-blue-100 rounded-md">
      <div className="flex items-start">
        <FileText className="h-5 w-5 text-blue-500 mr-2 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm text-blue-700 font-medium">
            Contract: {contractInfo.contractName || 'Default Contract'}
          </p>
          <p className="text-xs text-blue-600 mt-0.5">
            {contractInfo.contractLineName} ({contractInfo.contractLineType})
          </p>
          {contractInfo.multipleLines && (
            <p className="text-xs text-blue-500 mt-1 italic">
              Multiple contract lines available - using default selection
            </p>
          )}
        </div>
      </div>
    </div>
  );
});

export default ContractInfoBanner;
