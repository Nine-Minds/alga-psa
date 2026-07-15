'use client'

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Coins, FileText, Receipt } from 'lucide-react';
import type { IService } from '@alga-psa/types';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import GenerateTab, { type InvoiceType } from './invoicing/GenerateTab';
import DraftsTab from './invoicing/DraftsTab';
import FinalizedTab from './invoicing/FinalizedTab';
import ProjectBillingReviewTab from './invoicing/ProjectBillingReviewTab';
import { getReadyEntryCount } from '@alga-psa/billing/actions/projectBillingScheduleActions';
import { useTranslation } from 'react-i18next';
import { isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

interface InvoicingHubProps {
  initialServices: IService[];
}

type InvoicingSubTab = 'generate' | 'drafts' | 'finalized' | 'project-billing';

const INVOICING_SUBTABS: readonly InvoicingSubTab[] = ['generate', 'drafts', 'finalized', 'project-billing'];

const InvoicingHub: React.FC<InvoicingHubProps> = ({ initialServices }) => {
  const { t } = useTranslation('msp/invoicing');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { enabled: billingEnabled } = useFeatureFlag('billing-enabled');

  // Get active sub-tab from URL or default to 'generate'
  const requestedSubtab = searchParams?.get('subtab');
  const activeSubTab = requestedSubtab && INVOICING_SUBTABS.includes(requestedSubtab as InvoicingSubTab)
    ? (requestedSubtab as InvoicingSubTab)
    : 'generate';
  const sourceSalesOrderId = searchParams?.get('salesOrderId') ?? searchParams?.get('soId');

  // Trigger for refreshing data across tabs
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Count of ready project-billing entries awaiting review, shown as a pill on the tab.
  const [readyProjectBillingCount, setReadyProjectBillingCount] = useState(0);

  // Invoice type lives here (not in GenerateTab) so the selector can ride inline
  // on the tab-bar row — data-first chrome, matching the invoicing mockup.
  const [invoiceType, setInvoiceType] = useState<InvoiceType>(sourceSalesOrderId ? 'manual' : 'automatic');

  useEffect(() => {
    if (activeSubTab === 'generate' && sourceSalesOrderId) {
      setInvoiceType('manual');
    }
  }, [activeSubTab, sourceSalesOrderId]);

  // Keep the ready-count pill fresh: on mount and whenever a tab action bumps the
  // refresh trigger (e.g. approving/holding an entry in the Project Billing tab).
  useEffect(() => {
    let active = true;
    getReadyEntryCount()
      .then((count) => {
        if (!active) return;
        setReadyProjectBillingCount(
          isActionMessageError(count) || isActionPermissionError(count) ? 0 : count,
        );
      })
      .catch((err) => { console.error('Failed to load ready project billing count:', err); });
    return () => { active = false; };
  }, [refreshTrigger]);

  const invoiceTypeOptions = useMemo(() => {
    const options = [
      {
        value: 'automatic',
        textValue: t('generateTab.types.automatic', { defaultValue: 'Automatic Invoices' }),
        label: (
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            <span>{t('generateTab.types.automatic', { defaultValue: 'Automatic Invoices' })}</span>
          </div>
        ),
      },
      {
        value: 'manual',
        textValue: t('generateTab.types.manual', { defaultValue: 'Manual Invoice' }),
        label: (
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span>{t('generateTab.types.manual', { defaultValue: 'Manual Invoice' })}</span>
          </div>
        ),
      },
      {
        value: 'prepayment',
        textValue: t('generateTab.types.prepayment', { defaultValue: 'Prepayment' }),
        label: (
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4" />
            <span>{t('generateTab.types.prepayment', { defaultValue: 'Prepayment' })}</span>
          </div>
        ),
      },
    ];
    return billingEnabled ? options : options.filter((option) => option.value !== 'prepayment');
  }, [billingEnabled, t]);

  const handleTabChange = (tabId: string) => {
    if (tabId === activeSubTab) {
      return;
    }

    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', 'invoicing');
    params.set('subtab', tabId);
    router.push(`/msp/billing?${params.toString()}`);
  };

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  // Only the Generate sub-tab is type-scoped, so the selector rides the tab bar
  // there and disappears on Drafts/Finalized.
  const typeSelector = activeSubTab === 'generate' ? (
    <div className="ml-auto self-center pb-1">
      <CustomSelect
        value={invoiceType}
        onValueChange={(value: string) => setInvoiceType(value as InvoiceType)}
        options={invoiceTypeOptions}
        className="w-auto min-w-[200px]"
      />
    </div>
  ) : null;

  // The page title shares the tab-bar row (data-first chrome) instead of taking
  // its own line above the tabs.
  const titleHeading = (
    <h2 className="mr-6 text-xl font-bold">
      {t('hub.title', { defaultValue: 'Invoicing' })}
    </h2>
  );

  return (
    <div>
      <CustomTabs
        startContent={titleHeading}
        tabs={[
          {
            id: 'generate',
            label: t('hub.tabs.generate', { defaultValue: 'Generate' }),
            content: (
              <GenerateTab
                initialServices={initialServices}
                invoiceType={invoiceType}
                onGenerateSuccess={handleRefreshData}
                refreshTrigger={refreshTrigger}
                sourceSalesOrderId={sourceSalesOrderId}
              />
            )
          },
          {
            id: 'drafts',
            label: t('hub.tabs.drafts', { defaultValue: 'Drafts' }),
            content: (
              <DraftsTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          },
          {
            id: 'finalized',
            label: t('hub.tabs.finalized', { defaultValue: 'Finalized' }),
            content: (
              <FinalizedTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          },
          {
            id: 'project-billing',
            label: (
              <span className="flex items-center gap-1.5">
                {t('hub.tabs.projectBilling', { defaultValue: 'Project Billing' })}
                {readyProjectBillingCount > 0 && (
                  <span className="px-1.5 py-0.5 text-xs bg-primary-100 text-primary-700 rounded-full">
                    {readyProjectBillingCount}
                  </span>
                )}
              </span>
            ),
            content: (
              <ProjectBillingReviewTab
                onRefreshNeeded={handleRefreshData}
                refreshTrigger={refreshTrigger}
              />
            )
          }
        ]}
        defaultTab={activeSubTab}
        onTabChange={handleTabChange}
        extraContent={typeSelector}
      />
    </div>
  );
};

export default InvoicingHub;
