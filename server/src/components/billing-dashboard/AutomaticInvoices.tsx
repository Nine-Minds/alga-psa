'use client'

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { Checkbox } from '../ui/Checkbox';
import { Tooltip } from '../ui/Tooltip';
import { Info, AlertTriangle } from 'lucide-react';
import { ICompanyBillingCycle } from '../../interfaces/billing.interfaces';
import { InvoiceViewModel } from '../../interfaces/invoice.interfaces';
import { finalizeInvoice } from '../../lib/actions/invoiceActions';
import { getInvoicedBillingCycles, removeBillingCycle } from '../../lib/actions/billingCycleActions';
import { ISO8601String } from '../../types/types.d';
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter, DialogDescription } from '../ui/Dialog';
import { previewInvoice } from '@/lib/actions/invoiceActions';

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
  is_early?: boolean;
}

const AutomaticInvoices: React.FC<AutomaticInvoicesProps> = ({ periods, onGenerateSuccess }) => {
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [companyFilter, setCompanyFilter] = useState<string>('');
  const [invoicedPeriods, setInvoicedPeriods] = useState<Period[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [selectedCycleToReverse, setSelectedCycleToReverse] = useState<{
    id: string;
    company: string;
    period: string;
  } | null>(null);
  const [previewData, setPreviewData] = useState<InvoiceViewModel | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const itemsPerPage = 10;

  const filteredPeriods = periods.filter(period => 
    period.company_name.toLowerCase().includes(companyFilter.toLowerCase())
  );

  const filteredInvoicedPeriods = invoicedPeriods.filter(period =>
    period.company_name.toLowerCase().includes(companyFilter.toLowerCase())
  );

  useEffect(() => {
    const loadInvoicedPeriods = async () => {
      setIsLoading(true);
      try {
        const cycles = await getInvoicedBillingCycles();
        setInvoicedPeriods(cycles.map((cycle):Period => ({
          ...cycle,
          can_generate: false // Already invoiced periods can't be generated again
        })));
      } catch (error) {
        console.error('Error loading invoiced periods:', error);
      }
      setIsLoading(false);
    };

    loadInvoicedPeriods();
  }, []);

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

  const handlePreviewInvoice = async (billingCycleId: string) => {
    setIsPreviewLoading(true);
    try {
      const preview = await previewInvoice(billingCycleId);
      setPreviewData(preview);
      setShowPreviewDialog(true);
    } catch (error) {
      console.error('Error previewing invoice:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to preview invoice';
      if (errorMessage.includes('Nothing to bill') || errorMessage.includes('No active billing plans found')) {
        setErrors({
          preview: 'Nothing to bill for this period'
        });
      } else {
        setErrors({
          preview: errorMessage
        });
      }
    }
    setIsPreviewLoading(false);
  };

  const handleGenerateInvoices = async () => {
    setIsGenerating(true);
    setErrors({});
    const newErrors: {[key: string]: string} = {};
    
    for (const billingCycleId of selectedPeriods) {
      try {
        await finalizeInvoice(billingCycleId);
      } catch (err) {
        // Get company name for the failed billing cycle
        const period = periods.find(p => p.billing_cycle_id === billingCycleId);
        const companyName = period?.company_name || billingCycleId;
        
        // Store error message for this company
        newErrors[companyName] = err instanceof Error ? err.message : 'Unknown error occurred';
      }
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
    } else {
      setSelectedPeriods(new Set());
      // Refresh the invoiced periods list
      const cycles = await getInvoicedBillingCycles();
      setInvoicedPeriods(cycles.map((cycle):Period => ({
        ...cycle,
        can_generate: false, // Already invoiced periods can't be generated again
        is_early: false // Already invoiced periods can't be early
      })));
      onGenerateSuccess();
    }
    
    setIsGenerating(false);
  };

  const handleReverseBillingCycle = async () => {
    if (!selectedCycleToReverse) return;

    setIsReversing(true);
    try {
      await removeBillingCycle(selectedCycleToReverse.id);
      // Refresh both lists after successful reversal
      const cycles = await getInvoicedBillingCycles();
      setInvoicedPeriods(cycles.map((cycle):Period => ({
        ...cycle,
        can_generate: false, // Already invoiced periods can't be generated again
        is_early: false // Already invoiced periods can't be early
      })));
      setShowReverseDialog(false);
      setSelectedCycleToReverse(null);
      onGenerateSuccess(); // This will refresh the available periods list
    } catch (error) {
      setErrors({
        [selectedCycleToReverse.company]: error instanceof Error ? error.message : 'Failed to reverse billing cycle'
      });
    }
    setIsReversing(false);
  };

  return (
    <>
      <div className="space-y-8">
        <div>
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
                id='finalize-invoices-button'
                onClick={handleGenerateInvoices}
                disabled={selectedPeriods.size === 0 || isGenerating}
                className={selectedPeriods.size === 0 ? 'opacity-50' : ''}
              >
                {isGenerating ? 'Finalizing...' : `Finalize Selected Invoices (${selectedPeriods.size})`}
              </Button>
            </div>
          </div>

          {Object.keys(errors).length > 0 && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
              <h4 className="font-semibold mb-2">Errors occurred while finalizing invoices:</h4>
              <ul className="list-disc pl-5">
                {Object.entries(errors).map(([company, errorMessage]): JSX.Element => (
                  <li key={company}>
                    <span className="font-medium">{company}:</span> {errorMessage}
                  </li>
                ))}
              </ul>
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
                render: (_: boolean, record: Period) => {
                  return (
                    <div className="flex items-center gap-2">
                      {!record.can_generate && (
                        <span className="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">
                          Period Active
                        </span>
                      )}
                      {record.is_early && (
                        <div className="flex items-center">
                          <Tooltip content={`Warning: Current billing cycle hasn't ended yet (ends ${new Date(record.period_end_date).toLocaleDateString()})`}>
                            <div className="flex items-center">
                              <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-1 rounded mr-2">
                                Early Invoice
                              </span>
                              <Info className="h-4 w-4 text-yellow-500" />
                            </div>
                          </Tooltip>
                        </div>
                      )}
                      <Button
                        id={`preview-invoice-${record.billing_cycle_id}`}
                        onClick={() => handlePreviewInvoice(record.billing_cycle_id || '')}
                        disabled={isPreviewLoading || !record.billing_cycle_id}
                        variant="outline"
                        size="sm"
                      >
                        Preview
                      </Button>
                    </div>
                  );
                }
              }
            ]}
            pagination={false}
          />
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">Previously Invoiced Periods</h2>
          {isLoading ? (
            <div className="text-center py-4">Loading...</div>
          ) : (
            <>
              <DataTable
                data={filteredInvoicedPeriods}
                columns={[
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
                    title: 'Actions',
                    dataIndex: 'billing_cycle_id',
                    render: (_: unknown, record: Period) => (
                      <Button
                        id={`reverse-billing-cycle-${record.billing_cycle_id}`}
                        onClick={() => {
                          setSelectedCycleToReverse({
                            id: record.billing_cycle_id || '',
                            company: record.company_name,
                            period: `${new Date(record.period_start_date).toLocaleDateString()} - ${new Date(record.period_end_date).toLocaleDateString()}`
                          });
                          setShowReverseDialog(true);
                        }}
                        variant="destructive"
                        size="sm"
                      >
                        Reverse
                      </Button>
                    )
                  }
                ]}
                pagination={true}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                pageSize={itemsPerPage}
                totalItems={filteredInvoicedPeriods.length}
              />
            </>
          )}
        </div>
      </div>

      <Dialog
        isOpen={showReverseDialog}
        onClose={() => setShowReverseDialog(false)}
      >
        <DialogHeader>
          <DialogTitle>
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="h-5 w-5" />
              <span>Warning: Reverse Billing Cycle</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <DialogContent>
          <div className="text-sm space-y-2">
            <p className="font-semibold">You are about to reverse the billing cycle for:</p>
            <p>Company: {selectedCycleToReverse?.company}</p>
            <p>Period: {selectedCycleToReverse?.period}</p>
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded p-4 text-sm space-y-2 mt-4">
            <p className="font-semibold text-yellow-800">This action will:</p>
            <ul className="list-disc pl-5 text-yellow-700">
              <li>Reverse any invoices generated for this billing cycle</li>
              <li>Reissue any credits that were applied to these invoices</li>
              <li>Unmark all time entries and usage records as invoiced</li>
              <li>Mark the billing cycle as inactive</li>
            </ul>
            <p className="text-red-600 font-semibold mt-4">This action cannot be undone!</p>
          </div>
        </DialogContent>

        <DialogFooter>
          <Button
            id='cancel-reverse-billing-cycle-button'
            variant="outline"
            onClick={() => setShowReverseDialog(false)}
          >
            Cancel
          </Button>
          <Button
            id='reverse-billing-cycle-button'
            variant="destructive"
            onClick={handleReverseBillingCycle}
            disabled={isReversing}
          >
            {isReversing ? 'Reversing...' : 'Yes, Reverse Billing Cycle'}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        isOpen={showPreviewDialog}
        onClose={() => setShowPreviewDialog(false)}
      >
        <DialogHeader>
          <DialogTitle>
            Invoice Preview
          </DialogTitle>
          <DialogDescription>
            This is a preview of how the invoice will look when finalized.
          </DialogDescription>
        </DialogHeader>

        <DialogContent>
          {errors.preview ? (
            <div className="text-center py-8">
              <p className="text-gray-600">{errors.preview}</p>
            </div>
          ) : previewData && (
            <div className="space-y-4">
              <div className="border-b pb-4">
                <h3 className="font-semibold">Company Details</h3>
                <p>{previewData.company.name}</p>
                <p>{previewData.company.address}</p>
              </div>

              <div className="border-b pb-4">
                <h3 className="font-semibold">Invoice Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Invoice Number</p>
                    <p>{previewData.invoice_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Date</p>
                    <p>{previewData.invoice_date.toLocaleDateString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Due Date</p>
                    <p>{previewData.due_date.toLocaleDateString()}</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Line Items</h3>
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2">Description</th>
                      <th className="text-right py-2">Quantity</th>
                      <th className="text-right py-2">Rate</th>
                      <th className="text-right py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.invoice_items.map((item) => (
                      <tr key={item.item_id} className="border-b">
                        <td className="py-2">{item.description}</td>
                        <td className="text-right py-2">{item.quantity}</td>
                        <td className="text-right py-2">${(item.unit_price / 100).toFixed(2)}</td>
                        <td className="text-right py-2">${(item.total_price / 100).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="text-right py-2 font-semibold">Subtotal</td>
                      <td className="text-right py-2">${(previewData.subtotal / 100).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="text-right py-2 font-semibold">Tax</td>
                      <td className="text-right py-2">${(previewData.tax / 100).toFixed(2)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="text-right py-2 font-semibold">Total</td>
                      <td className="text-right py-2">${(previewData.total / 100).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </DialogContent>

        <DialogFooter>
          <Button
            id="close-preview-dialog-button"
            onClick={() => setShowPreviewDialog(false)}
          >
            Close Preview
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
};

export default AutomaticInvoices;
