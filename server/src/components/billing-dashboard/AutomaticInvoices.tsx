'use client'

import React, { useState } from 'react';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { Checkbox } from '../ui/Checkbox';
import { ICompanyBillingCycle } from '../../interfaces/billing.interfaces';
import { generateInvoice } from '../../lib/actions/invoiceActions';
import { ISO8601String } from '../../types/types.d';

interface AutomaticInvoicesProps {
  periods: (ICompanyBillingCycle & {
    company_name: string;
    can_generate: boolean;
    period_start_date: ISO8601String;
    period_end_date: ISO8601String;
  })[];
  onGenerateSuccess: () => void;
}

interface Period extends ICompanyBillingCycle {
  company_name: string;
  can_generate: boolean;
  billing_cycle_id?: string;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String;
}

const AutomaticInvoices: React.FC<AutomaticInvoicesProps> = ({ periods, onGenerateSuccess }) => {
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>('');

  const filteredPeriods = periods.filter(period => 
    period.company_name.toLowerCase().includes(companyFilter.toLowerCase())
  );

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const validIds = filteredPeriods
        .filter(p => p.can_generate)
        .map((p): string | undefined => p.billing_cycle_id)
        .filter((id): id is string => id !== undefined);
      setSelectedPeriods(new Set(validIds));
    } else {
      setSelectedPeriods(new Set());
    }
  };

  const handleSelectPeriod = (billingCycleId: string | undefined, event: React.ChangeEvent<HTMLInputElement>) => {
    if (!billingCycleId) return;
    
    const newSelected = new Set(selectedPeriods);
    if (event.target.checked) {
      newSelected.add(billingCycleId);
    } else {
      newSelected.delete(billingCycleId);
    }
    setSelectedPeriods(newSelected);
  };

  const handleGenerateInvoices = async () => {
    setIsGenerating(true);
    setError(null);
    try {
      for (const billingCycleId of selectedPeriods) {
        await generateInvoice(billingCycleId);
      }
      
      setSelectedPeriods(new Set());
      onGenerateSuccess();
    } catch (err) {
      setError('Error generating invoices');
      console.error('Error generating invoices:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Ready to Invoice Billing Periods</h2>
        <div className="flex gap-4">
          <input
            type="text"
            placeholder="Filter companies..."
            className="px-3 py-2 border rounded-md"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
          />
          <Button
            onClick={handleGenerateInvoices}
            disabled={selectedPeriods.size === 0 || isGenerating}
            className={selectedPeriods.size === 0 ? 'opacity-50' : ''}
          >
            {isGenerating ? 'Generating...' : `Generate Selected Invoices (${selectedPeriods.size})`}
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
          {error}
        </div>
      )}

      <DataTable
        data={filteredPeriods}
        columns={[
          {
            title: (
              <Checkbox
                id="select-all"
                checked={filteredPeriods.length > 0 && selectedPeriods.size === filteredPeriods.filter(p => p.can_generate).length}
                onChange={handleSelectAll}
                disabled={!filteredPeriods.some(p => p.can_generate)}
              />
            ),
            dataIndex: 'billing_cycle_id',
            render: (_: unknown, record: Period) => record.can_generate ? (
              <Checkbox
                id={`select-${record.billing_cycle_id}`}
                checked={selectedPeriods.has(record.billing_cycle_id || '')}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => handleSelectPeriod(record.billing_cycle_id, event)}
              />
            ) : null
          },
          {
            title: 'Company',
            dataIndex: 'company_name'
          },
          {
            title: 'Billing Cycle',
            dataIndex: 'billing_cycle'
          },
          {
            title: 'Period Start',
            dataIndex: 'period_start_date',
            render: (date: ISO8601String) => new Date(date).toLocaleDateString()
          },
          {
            title: 'Period End',
            dataIndex: 'period_end_date',
            render: (date: ISO8601String) => new Date(date).toLocaleDateString()
          },
          {
            title: 'Status',
            dataIndex: 'can_generate',
            render: (canGenerate: boolean) => !canGenerate ? (
              <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">
                Period Active
              </span>
            ) : null
          }
        ]}
        pagination={false}
      />
    </>
  );
};

export default AutomaticInvoices;
