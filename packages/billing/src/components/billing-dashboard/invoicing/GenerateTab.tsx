'use client'

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Coins, FileText, Receipt } from 'lucide-react';
import type { IService, IClient } from '@alga-psa/types';
import { getAllClientsForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { getServices } from '@alga-psa/billing/actions';
import AutomaticInvoices from '../AutomaticInvoices';
import ManualInvoices from '../ManualInvoices';
import PrepaymentInvoices from '../PrepaymentInvoices';
import SuccessDialog from '@alga-psa/ui/components/SuccessDialog';
import { useFeatureFlag } from '@alga-psa/ui/hooks';

interface GenerateTabProps {
  initialServices: IService[];
  onGenerateSuccess: () => void;
  refreshTrigger: number;
}

type InvoiceType = 'automatic' | 'manual' | 'prepayment';

interface SelectOption {
  value: string;
  label: React.JSX.Element;
}

const GenerateTab: React.FC<GenerateTabProps> = ({
  initialServices,
  onGenerateSuccess,
  refreshTrigger
}) => {
  const router = useRouter();
  const { enabled: billingEnabled } = useFeatureFlag('billing-enabled');
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('automatic');
  const [error, setError] = useState<string | null>(null);
  const [clients, setClients] = useState<IClient[]>([]);
  const [services, setServices] = useState<IService[]>([]);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [internalRefreshTrigger, setInternalRefreshTrigger] = useState(0);

  // Only load clients and services for manual/prepayment invoices
  useEffect(() => {
    if (invoiceType !== 'automatic') {
      loadManualInvoiceData();
    }
  }, [invoiceType, refreshTrigger]);

  const loadManualInvoiceData = async () => {
    try {
      const [clientsData, servicesData] = await Promise.all([
        getAllClientsForBilling(),
        getServices(1, 999, { item_kind: 'any' })
      ]);

      setClients(clientsData);

      if (servicesData && Array.isArray(servicesData.services)) {
        setServices(servicesData.services);
      } else {
        console.warn('Services data is not in the expected format:', servicesData);
        setServices([]);
      }
    } catch (err) {
      setError('Failed to load data');
      console.error('Error loading data:', err);
    }
  };

  const handleGenerateSuccess = () => {
    setInternalRefreshTrigger(prev => prev + 1);
    setSuccessMessage('Invoice generated successfully!');
    setShowSuccessDialog(true);
    onGenerateSuccess();
  };

  const handleViewDrafts = () => {
    setShowSuccessDialog(false);
    router.push('/msp/billing?tab=invoicing&subtab=drafts');
  };

  const allInvoiceTypeOptions: SelectOption[] = [
    {
      value: 'automatic',
      label: (
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4" />
          <span>Automatic Invoices</span>
        </div>
      )
    },
    {
      value: 'manual',
      label: (
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          <span>Manual Invoice</span>
        </div>
      )
    },
    {
      value: 'prepayment',
      label: (
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4" />
          <span>Prepayment</span>
        </div>
      )
    }
  ];

  const invoiceTypeOptions = useMemo(() => {
    if (billingEnabled) {
      return allInvoiceTypeOptions;
    }
    return allInvoiceTypeOptions.filter(option => option.value !== 'prepayment');
  }, [billingEnabled]);

  const renderContent = () => {
    switch (invoiceType) {
      case 'automatic':
        return (
          <AutomaticInvoices
            onGenerateSuccess={handleGenerateSuccess}
            refreshTrigger={refreshTrigger + internalRefreshTrigger}
          />
        );
      case 'manual':
        return (
          <ManualInvoices
            clients={clients}
            services={services}
            onGenerateSuccess={handleGenerateSuccess}
          />
        );
      case 'prepayment':
        if (!billingEnabled) {
          return null;
        }
        return (
          <PrepaymentInvoices
            clients={clients}
            onGenerateSuccess={handleGenerateSuccess}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="space-y-4">
        <Card>
          <div className="p-4">
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Invoice Type
              </label>
              <CustomSelect
                value={invoiceType}
                onValueChange={(value: string) => setInvoiceType(value as InvoiceType)}
                options={invoiceTypeOptions}
                className="w-full md:w-80"
              />
            </div>

            {error && (
              <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
                {error}
              </div>
            )}

            {renderContent()}
          </div>
        </Card>
      </div>

      <SuccessDialog
        isOpen={showSuccessDialog}
        onClose={() => setShowSuccessDialog(false)}
        message={successMessage}
        id="invoice-success-dialog"
      />
    </>
  );
};

export default GenerateTab;
