'use client'

import React, { useState, useEffect } from 'react';
import { Card } from '../ui/Card';
import CustomSelect from '../ui/CustomSelect';
import { IClientContractLineCycle, IService } from '../../interfaces/billing.interfaces';
import { IClient } from '../../interfaces';
import { getAvailableBillingPeriods } from '../../lib/actions/billingAndTax';
import { getAllClients } from '../../lib/actions/client-actions/clientActions';
import { getServices } from '../../lib/actions/serviceActions';
import AutomaticInvoices from './AutomaticInvoices';
import PrepaymentInvoices from './PrepaymentInvoices';
import ManualInvoices from './ManualInvoices';
import SuccessDialog from '../ui/SuccessDialog';

type InvoiceType = 'automatic' | 'manual' | 'prepayment';

interface SelectOption {
  value: string;
  label: string;
}

interface Service {
  service_id: string;
  service_name: string;
  rate: number;
}

const invoiceTypeOptions: SelectOption[] = [
  { value: 'automatic', label: 'Automatic Invoices' },
  { value: 'manual', label: 'Manual Invoices' },
  { value: 'prepayment', label: 'Prepayment' }
];

const GenerateInvoices: React.FC = () => {
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('automatic');
  const [error, setError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<(IClientContractLineCycle & {
    client_name: string;
    can_generate: boolean;
    is_early?: boolean;
  })[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [periodsData, clientsData, servicesData] = await Promise.all([
        getAvailableBillingPeriods(),
        getAllClients(),
        getServices()
      ]);

      setPeriods(periodsData);
      setClients(clientsData);
      // Transform IService to Service, using default_rate as rate
      if (servicesData && Array.isArray(servicesData.services)) {
        setServices(servicesData.services.map((service): Service => ({
          service_id: service.service_id,
          service_name: service.service_name,
          rate: service.default_rate || 0
        })));
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
    loadData();
    setShowSuccessDialog(true);
  };

  const renderContent = () => {
    switch (invoiceType) {
      case 'automatic':
        return (
          <AutomaticInvoices
            periods={periods}
            onGenerateSuccess={handleGenerateSuccess}
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
              <CustomSelect
                value={invoiceType}
                onValueChange={(value: string) => setInvoiceType(value as InvoiceType)}
                options={invoiceTypeOptions}
                className="w-full md:w-64"
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
        message="Invoice generated successfully!"
        id="invoice-success-dialog"
      />
    </>
  );
};

export default GenerateInvoices;
