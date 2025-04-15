'use client'

import React, { useState, useEffect } from 'react';
import { toPlainDate } from '../../lib/utils/dateTimeUtils';
import { Button } from '../ui/Button';
import { DataTable } from '../ui/DataTable';
import { Checkbox } from '../ui/Checkbox';
import { Tooltip } from '../ui/Tooltip'; // Use the refactored custom Tooltip
// Removed direct Radix imports:
// TooltipContent,
// TooltipProvider,
// TooltipTrigger,
import { Info, AlertTriangle, X, MoreVertical } from 'lucide-react'; // Changed to MoreVertical
import { ICompanyBillingCycle } from '../../interfaces/billing.interfaces';
import { InvoiceViewModel, PreviewInvoiceResponse } from '../../interfaces/invoice.interfaces';
import { generateInvoice, previewInvoice } from '../../lib/actions/invoiceGeneration';
// Updated import for billing cycle actions
import { getInvoicedBillingCycles, removeBillingCycle, hardDeleteBillingCycle } from '../../lib/actions/billingCycleActions';
import { ISO8601String } from '../../types/types.d';
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter, DialogDescription } from '../ui/Dialog';
import { formatCurrency } from '../../lib/utils/formatters';
// Added imports for DropdownMenu
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  // DropdownMenuLabel, // Removed - not exported/needed
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/DropdownMenu";
// Use ConfirmationDialog instead of AlertDialog
import { ConfirmationDialog } from '../ui/ConfirmationDialog'; // Corrected import
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
  // State to hold both preview data and the associated billing cycle ID
  const [previewState, setPreviewState] = useState<{
    data: InvoiceViewModel | null;
    billingCycleId: string | null;
  }>({ data: null, billingCycleId: null });
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isGeneratingFromPreview, setIsGeneratingFromPreview] = useState(false); // Loading state for generate from preview
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  // State for delete confirmation
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedCycleToDelete, setSelectedCycleToDelete] = useState<{
    id: string;
    company: string;
    period: string;
  } | null>(null);
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

  // Debug effect to log preview data
  useEffect(() => {
    if (previewState.data) {
      console.log("Preview data items:", previewState.data.invoice_items);
      console.log("Bundle headers:", previewState.data.invoice_items.filter(item => item.is_bundle_header));
    }
  }, [previewState.data]);

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
    setErrors({}); // Clear previous errors
    const response = await previewInvoice(billingCycleId);
    if (response.success) {
      setPreviewState({ data: response.data, billingCycleId: billingCycleId });
      setShowPreviewDialog(true);
    } else {
      setPreviewState({ data: null, billingCycleId: null }); // Clear preview state on error
      setErrors({
        preview: response.error
      });
      // Optionally open the dialog even on error to show the message
      setShowPreviewDialog(true);
    }
    setIsPreviewLoading(false);
  };

  const handleGenerateInvoices = async () => {
    setIsGenerating(true);
    setErrors({});
    const newErrors: {[key: string]: string} = {};

    for (const billingCycleId of selectedPeriods) {
      try {
        await generateInvoice(billingCycleId);
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

  const handleDeleteBillingCycle = async () => {
    if (!selectedCycleToDelete) return;

    setIsDeleting(true);
    setErrors({}); // Clear previous errors
    try {
      await hardDeleteBillingCycle(selectedCycleToDelete.id);
      // Refresh invoiced periods list after successful deletion
      const cycles = await getInvoicedBillingCycles();
      setInvoicedPeriods(cycles.map((cycle):Period => ({
        ...cycle,
        can_generate: false,
        is_early: false
      })));
      setShowDeleteDialog(false);
      setSelectedCycleToDelete(null);
      // Refresh the 'Ready to Invoice' list by calling the prop function
      onGenerateSuccess();
    } catch (error) {
      setErrors({
        [selectedCycleToDelete.company]: error instanceof Error ? error.message : 'Failed to delete billing cycle'
      });
      // Keep dialog open on error to show message? Or close it? Closing for now.
      setShowDeleteDialog(false);
    }
    setIsDeleting(false);
  };

  const handleGenerateFromPreview = async () => {
    if (!previewState.billingCycleId) return;

    setIsGeneratingFromPreview(true);
    setErrors({}); // Clear previous errors

    try {
      await generateInvoice(previewState.billingCycleId);
      setShowPreviewDialog(false); // Close dialog on success
      setPreviewState({ data: null, billingCycleId: null }); // Reset preview state
      // TODO: Add success toast notification here if available
      onGenerateSuccess(); // Refresh data lists
    } catch (err) {
      // TODO: Add error toast notification here if available
      // Display error within the dialog for now, or could use main error display
      setErrors({
        preview: err instanceof Error ? err.message : 'Failed to generate invoice from preview'
      });
    } finally {
      setIsGeneratingFromPreview(false);
    }
  };

  return (
    // Removed TooltipProvider wrapper
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
                id='generate-invoices-button'
                onClick={handleGenerateInvoices}
                disabled={selectedPeriods.size === 0 || isGenerating}
                className={selectedPeriods.size === 0 ? 'opacity-50' : ''}
              >
                {isGenerating ? 'Generating...' : `Generate Invoices for Selected Periods (${selectedPeriods.size})`}
              </Button>
            </div>
          </div>

          {Object.keys(errors).length > 0 && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
              <button
                onClick={() => setErrors({})}
                className="absolute top-2 right-2 p-1 hover:bg-red-200 rounded-full transition-colors"
                aria-label="Close error message"
              >
                <X className="h-5 w-5" />
              </button>
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
            // Add onRowClick prop - implementation depends on DataTable component
            // Assuming it takes a function like this:
            onRowClick={(record: Period) => {
              if (record.billing_cycle_id) {
                handlePreviewInvoice(record.billing_cycle_id);
              }
            }}
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
                    // Stop propagation to prevent row click when clicking checkbox
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      event.stopPropagation();
                      handleSelectPeriod(record.billing_cycle_id, event);
                    }}
                    onClick={(e) => e.stopPropagation()} // Also stop propagation on click
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
                render: (date: ISO8601String) => toPlainDate(date).toLocaleString()
              },
              {
                title: 'Period End',
                dataIndex: 'period_end_date',
                render: (date: ISO8601String) => toPlainDate(date).toLocaleString()
              },
              {
                title: 'Actions', // Renamed from Status
                dataIndex: 'billing_cycle_id', // Use ID for actions
                render: (_: unknown, record: Period) => {
                  // Only show actions if it's a valid, generatable period
                  if (!record.billing_cycle_id || !record.can_generate) {
                    return null; // Or some placeholder if needed
                  }
                  return (
                    // Centered the content horizontally
                    <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}> {/* Stop row click propagation */}
                      {record.is_early && (
                        <Tooltip
                          content={
                            <p>Warning: Current billing cycle hasn't ended yet (ends {toPlainDate(record.period_end_date).toLocaleString()})</p>
                          }
                          side="top" // Pass side prop to custom component
                          className="max-w-xs" // Pass className for content styling
                        >
                          {/* The trigger element is now the direct child */}
                          <div className="flex items-center mr-2 cursor-help">
                            <Info className="h-4 w-4 text-yellow-500" />
                          </div>
                        </Tooltip>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button id={`actions-trigger-${record.billing_cycle_id}`} variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            id={`preview-invoice-${record.billing_cycle_id}`}
                            onClick={() => handlePreviewInvoice(record.billing_cycle_id || '')}
                            disabled={isPreviewLoading} // Disable only during preview loading
                          >
                            Preview
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {/* Delete Option Moved Here */}
                          <DropdownMenuItem
                            id={`delete-billing-cycle-${record.billing_cycle_id}`}
                            className="text-red-600 focus:text-red-600 focus:bg-red-50"
                            onSelect={(e) => e.preventDefault()} // Prevent closing dropdown immediately
                            onClick={() => {
                              setSelectedCycleToDelete({
                                id: record.billing_cycle_id || '',
                                company: record.company_name,
                                period: `${toPlainDate(record.period_start_date).toLocaleString()} - ${toPlainDate(record.period_end_date).toLocaleString()}`
                              });
                              setShowDeleteDialog(true); // Open the confirmation dialog
                            }}
                          >
                            Delete Cycle
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                }
              }
            ]}
            pagination={false}
            // Fixed rowClassName prop
            rowClassName={() => "cursor-pointer hover:bg-muted/50"}
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
                    render: (date: ISO8601String) => toPlainDate(date).toLocaleString()
                  },
                  {
                    title: 'Period End',
                    dataIndex: 'period_end_date',
                    render: (date: ISO8601String) => toPlainDate(date).toLocaleString()
                  },
                  {
                    title: 'Actions',
                    dataIndex: 'billing_cycle_id',
                    render: (_: unknown, record: Period) => (
                      // Centered the content horizontally
                      <div className="flex justify-center">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button id={`actions-trigger-invoiced-${record.billing_cycle_id}`} variant="ghost" className="h-8 w-8 p-0">
                              <span className="sr-only">Open menu</span>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              id={`reverse-billing-cycle-${record.billing_cycle_id}`}
                              onClick={() => {
                                setSelectedCycleToReverse({
                                  id: record.billing_cycle_id || '',
                                  company: record.company_name,
                                  period: `${toPlainDate(record.period_start_date).toLocaleString()} - ${toPlainDate(record.period_end_date).toLocaleString()}`
                                });
                                setShowReverseDialog(true);
                              }}
                            >
                              Reverse Invoice
                            </DropdownMenuItem>
                            {/* Delete option removed from this table */}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
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
        // Reset preview state when dialog is closed
        onClose={() => {
          setShowPreviewDialog(false);
          setPreviewState({ data: null, billingCycleId: null });
          setErrors({}); // Clear preview-specific errors on close
        }}
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
              {/* Display error message if present */}
              <p className="text-red-600">{errors.preview}</p>
            </div>
          ) : previewState.data && ( // Check previewState.data instead of previewData
            <div className="space-y-4">
              <div className="border-b pb-4">
                <h3 className="font-semibold">Company Details</h3>
                <p>{previewState.data.company.name}</p>
                <p>{previewState.data.company.address}</p>
              </div>

              <div className="border-b pb-4">
                <h3 className="font-semibold">Invoice Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Invoice Number</p>
                    <p>{previewState.data.invoice_number}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Date</p>
                    <p>{previewState.data.invoice_date.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Due Date</p>
                    <p>{previewState.data.due_date.toLocaleString()}</p>
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
                    {/* Map over previewState.data.invoice_items */}
                    {previewState.data.invoice_items.map((item) => {
                      if (item.is_bundle_header) {
                        // Render bundle header style (Option A)
                        return (
                          <tr key={item.item_id} className="border-b bg-muted/50 font-semibold">
                            {/* Use colSpan=4 to span all columns - Description, Qty, Rate, Amount */}
                            <td className="py-2 px-2" colSpan={4}>{item.description}</td>
                          </tr>
                        );
                      } else {
                        // Check if it's a detail line (fixed-fee allocation or bundle component) by checking parent_item_id
                        if (item.parent_item_id) {
                          // Render detail line (blank Qty/Rate)
                          return (
                            <tr key={item.item_id} className="border-b">
                              <td className="py-2 px-2">{item.description}</td>
                              <td className="text-right py-2 px-2"></td> {/* Blank Quantity */}
                              <td className="text-right py-2 px-2"></td> {/* Blank Rate */}
                              <td className="text-right py-2 px-2">{formatCurrency(item.total_price / 100)}</td>
                            </tr>
                          );
                        } else {
                          // Render regular standalone item
                          return (
                            <tr key={item.item_id} className="border-b">
                              <td className="py-2 px-2">{item.description}</td>
                              <td className="text-right py-2 px-2">{item.quantity}</td>
                              <td className="text-right py-2 px-2">{formatCurrency(item.unit_price / 100)}</td>
                              <td className="text-right py-2 px-2">{formatCurrency(item.total_price / 100)}</td>
                            </tr>
                          );
                        }
                      }
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="text-right py-2 font-semibold">Subtotal</td>
                      {/* Use previewState.data for totals */}
                      <td className="text-right py-2">{formatCurrency(previewState.data.subtotal / 100)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="text-right py-2 font-semibold">Tax</td>
                      <td className="text-right py-2">{formatCurrency(previewState.data.tax / 100)}</td>
                    </tr>
                    <tr>
                      <td colSpan={3} className="text-right py-2 font-semibold">Total</td>
                      <td className="text-right py-2">{formatCurrency(previewState.data.total / 100)}</td>
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
            variant="outline" // Use outline for secondary action
            onClick={() => {
              setShowPreviewDialog(false);
              setPreviewState({ data: null, billingCycleId: null }); // Reset state on close
              setErrors({}); // Clear errors on close
            }}
            disabled={isGeneratingFromPreview} // Disable while generating
          >
            Close Preview
          </Button>
          {/* Add Generate Invoice button */}
          <Button
            id="generate-invoice-from-preview-button"
            onClick={handleGenerateFromPreview}
            // Disable if there's an error, no data, or generation is in progress
            disabled={!!errors.preview || !previewState.data || isGeneratingFromPreview || isPreviewLoading}
          >
            {isGeneratingFromPreview ? 'Generating...' : 'Generate Invoice'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation Dialog - Moved outside the table render loop */}
      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setSelectedCycleToDelete(null); // Clear selection on close
        }}
        onConfirm={handleDeleteBillingCycle}
        title="Permanently Delete Billing Cycle?"
        // Use the 'message' prop (string) instead of 'description'
        message={`This action cannot be undone. This will permanently delete the billing cycle and any associated invoice data for:\nCompany: ${selectedCycleToDelete?.company}\nPeriod: ${selectedCycleToDelete?.period}`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Yes, Delete Permanently'} // Renamed prop
        isConfirming={isDeleting}
        // Removed unsupported props: confirmButtonVariant, icon
        id="delete-billing-cycle-confirmation" // Added an ID for consistency
      />
      </>
    // Removed TooltipProvider closing tag
  );
};

export default AutomaticInvoices;
