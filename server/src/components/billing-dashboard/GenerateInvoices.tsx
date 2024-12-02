'use client'
import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { Checkbox } from '@/components/ui/Checkbox';
import { ICompanyBillingCycle } from '@/interfaces/billing.interfaces';
import { getAvailableBillingPeriods, generateInvoice } from '@/lib/actions/invoiceActions';
import { ISO8601String } from '@/types/types.d';

type BillingPeriodWithExtras = ICompanyBillingCycle & {
  company_name: string;
  total_unbilled: number;
};

const GenerateInvoices: React.FC = () => {
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [periods, setPeriods] = useState<BillingPeriodWithExtras[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBillingPeriods();
  }, []);

  const loadBillingPeriods = async () => {
    try {
      const availablePeriods = await getAvailableBillingPeriods();
      setPeriods(availablePeriods);
    } catch (err) {
      setError('Failed to load billing periods');
      console.error('Error loading billing periods:', err);
    }
  };

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const validIds = periods
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
      
      // Clear selections and reload periods after successful generation
      setSelectedPeriods(new Set());
      await loadBillingPeriods();
    } catch (err) {
      setError('Error generating invoices');
      console.error('Error generating invoices:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Ready to Invoice Billing Periods</h2>
            <Button
              onClick={handleGenerateInvoices}
              disabled={selectedPeriods.size === 0 || isGenerating}
            >
              {isGenerating ? 'Generating...' : 'Generate Selected Invoices'}
            </Button>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
              {error}
            </div>
          )}

          <Table>
            <thead>
              <tr>
                <th className="w-8">
                  <Checkbox
                    id="select-all"
                    checked={selectedPeriods.size === periods.length && periods.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
                <th>Company</th>
                <th>Billing Cycle</th>
                <th>Period Start</th>
                <th>Period End</th>
                <th className="text-right">Total Unbilled</th>
              </tr>
            </thead>
            <tbody>
              {periods.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-4 text-gray-500">
                    No billing periods ready for invoicing
                  </td>
                </tr>
              ) : (
                periods.map((period): JSX.Element => (
                  <tr key={period.billing_cycle_id}>
                    <td>
                      <Checkbox
                        id={`select-${period.billing_cycle_id}`}
                        checked={selectedPeriods.has(period.billing_cycle_id || '')}
                        onChange={(event) => handleSelectPeriod(period.billing_cycle_id, event)}
                      />
                    </td>
                    <td>{period.company_name}</td>
                    <td>{period.billing_cycle}</td>
                    <td>{new Date(period.period_start_date).toLocaleDateString()}</td>
                    <td>{new Date(period.period_end_date).toLocaleDateString()}</td>
                    <td className="text-right">
                      ${period.total_unbilled.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </Table>
        </div>
      </Card>
    </div>
  );
};

export default GenerateInvoices;
