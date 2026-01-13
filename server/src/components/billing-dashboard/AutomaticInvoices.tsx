'use client'

import React, { useState, useEffect, useRef } from 'react';
import { toPlainDate } from '../../lib/utils/dateTimeUtils';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Input } from '../ui/Input';
import { DataTable } from '../ui/DataTable';
import { Checkbox } from '../ui/Checkbox';
import { Tooltip } from '../ui/Tooltip';
import { DateRangePicker, DateRange } from '../ui/DateRangePicker';
import { Search, Info, AlertTriangle, X, MoreVertical, Eye } from 'lucide-react';
import { IClientContractLineCycle } from '../../interfaces/billing.interfaces';
import { PreviewInvoiceResponse } from '../../interfaces/invoice.interfaces';
import { generateInvoice, getPurchaseOrderOverageForBillingCycle, previewInvoice } from '../../lib/actions/invoiceGeneration';
import { WasmInvoiceViewModel } from 'server/src/lib/invoice-renderer/types';
import { getInvoicedBillingCyclesPaginated, removeBillingCycle, hardDeleteBillingCycle } from '../../lib/actions/billingCycleActions';
import { getAvailableBillingPeriods, BillingPeriodDateRange } from '../../lib/actions/billingAndTax';
import { ISO8601String } from '../../types/types.d';
import { Dialog, DialogContent, DialogFooter, DialogDescription } from '../ui/Dialog';
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
import LoadingIndicator from '../ui/LoadingIndicator';

interface AutomaticInvoicesProps {
  onGenerateSuccess: () => void;
  refreshTrigger?: number;
}

interface Period extends IClientContractLineCycle {
  client_name: string;
  can_generate: boolean;
  billing_cycle_id?: string;
  period_start_date: ISO8601String;
  period_end_date: ISO8601String;
  is_early?: boolean;
  contract_name?: string; // Added for Phase 4
}

// Convert DateRange to API format using YYYY-MM-DD to avoid timezone drift
const buildDateRangeFilter = (range: DateRange): BillingPeriodDateRange | undefined => {
  if (!range.from && !range.to) {
    return undefined;
  }

  // Use YYYY-MM-DD format for date-only comparisons (avoids timezone issues)
  const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const from = range.from ? formatDate(range.from) : undefined;
  const to = range.to ? formatDate(range.to) : undefined;

  return { from, to };
};

const AutomaticInvoices: React.FC<AutomaticInvoicesProps> = ({ onGenerateSuccess, refreshTrigger = 0 }) => {
  // Drawer removed: client details quick view no longer used here
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [clientFilter, setClientFilter] = useState<string>('');
  const [debouncedClientFilter, setDebouncedClientFilter] = useState<string>('');

  // Date range filter state (pending = user selection, applied = active filter)
  const [pendingDateRange, setPendingDateRange] = useState<DateRange>(() => ({
    from: undefined,
    to: undefined,
  }));
  const [appliedDateRange, setAppliedDateRange] = useState<DateRange>(() => ({
    from: undefined,
    to: undefined,
  }));
  const [invoicedPeriods, setInvoicedPeriods] = useState<Period[]>([]);
  const [invoicedCurrentPage, setInvoicedCurrentPage] = useState(1);
  const [invoicedPageSize, setInvoicedPageSize] = useState(10);
  const [totalInvoicedPeriods, setTotalInvoicedPeriods] = useState(0);
  const [invoicedSearchTerm, setInvoicedSearchTerm] = useState('');
  const [debouncedInvoicedSearchTerm, setDebouncedInvoicedSearchTerm] = useState('');
  const [currentReadyPage, setCurrentReadyPage] = useState(1);
  const [isInvoicedLoading, setIsInvoicedLoading] = useState(false);
  const [isPeriodsLoading, setIsPeriodsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [selectedCycleToReverse, setSelectedCycleToReverse] = useState<{
    id: string;
    client: string;
    period: string;
  } | null>(null);
  // State to hold both preview data and the associated billing cycle ID
  const [previewState, setPreviewState] = useState<{
    data: WasmInvoiceViewModel | null; // Use the directly imported ViewModel type
    billingCycleId: string | null;
  }>({ data: null, billingCycleId: null });
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isGeneratingFromPreview, setIsGeneratingFromPreview] = useState(false); // Loading state for generate from preview
  const [poOverageDialogState, setPoOverageDialogState] = useState<{
    isOpen: boolean;
    billingCycleIds: string[];
    overageByBillingCycleId: Record<string, { clientName: string; overageCents: number; poNumber: string | null }>;
  }>({
    isOpen: false,
    billingCycleIds: [],
    overageByBillingCycleId: {},
  });
  const [poOverageSingleConfirm, setPoOverageSingleConfirm] = useState<{
    isOpen: boolean;
    billingCycleId: string | null;
    overageCents: number;
    poNumber: string | null;
  }>({
    isOpen: false,
    billingCycleId: null,
    overageCents: 0,
    poNumber: null,
  });
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  // State for delete confirmation
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedCycleToDelete, setSelectedCycleToDelete] = useState<{
    id: string;
    client: string;
    period: string;
  } | null>(null);

  // Server-side pagination state for "Ready to Invoice"
  const [periods, setPeriods] = useState<Period[]>([]);
  const [totalPeriods, setTotalPeriods] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const initialLoadDone = useRef(false);

  // Debounce client filter for server-side search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedClientFilter(clientFilter);
      if (initialLoadDone.current) {
        setCurrentReadyPage(1);
        setSelectedPeriods(new Set()); // Clear selection when filter changes
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [clientFilter]);

  // Handle page size change - reset to page 1 and clear selection
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentReadyPage(1);
    setSelectedPeriods(new Set());
  };

  // Handle page change - clear selection (server-side pagination means selected items may not be visible)
  const handleReadyPageChange = (newPage: number) => {
    setCurrentReadyPage(newPage);
    setSelectedPeriods(new Set());
  };

  // Handle date range search - apply filter, reset page, and clear selection
  const handleDateRangeSearch = () => {
    setAppliedDateRange(pendingDateRange);
    setCurrentReadyPage(1);
    setSelectedPeriods(new Set());
  };

  // Load available billing periods with server-side pagination
  useEffect(() => {
    let isMounted = true;

    const loadPeriods = async () => {
      setIsPeriodsLoading(true);
      setLoadError(null);
      try {
        const dateRangeFilter = buildDateRangeFilter(appliedDateRange);
        const result = await getAvailableBillingPeriods({
          page: currentReadyPage,
          pageSize: pageSize,
          searchTerm: debouncedClientFilter,
          dateRange: dateRangeFilter
        });

        if (!isMounted) return;

        setPeriods(result.periods as Period[]);
        setTotalPeriods(result.total);
        initialLoadDone.current = true;

        // Clamp page if current page is beyond available pages (e.g., after delete/filter)
        const maxPage = Math.max(1, Math.ceil(result.total / pageSize));
        if (currentReadyPage > maxPage && currentReadyPage !== maxPage) {
          setCurrentReadyPage(maxPage);
          setSelectedPeriods(new Set()); // Clear selection since visible rows changed
        }
      } catch (error) {
        console.error('Error loading billing periods:', error);
        if (isMounted) {
          setLoadError('Failed to load billing periods. Please try again.');
        }
      }
      if (isMounted) {
        setIsPeriodsLoading(false);
      }
    };
    loadPeriods();

    return () => {
      isMounted = false;
    };
  }, [currentReadyPage, pageSize, debouncedClientFilter, appliedDateRange, refreshTrigger]);

  // For server-side pagination, filteredPeriods is just periods
  const filteredPeriods = periods;

  // Debounce invoiced search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedInvoicedSearchTerm(invoicedSearchTerm);
      if (initialLoadDone.current) {
        setInvoicedCurrentPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [invoicedSearchTerm]);

  // Handle invoiced page size change
  const handleInvoicedPageSizeChange = (newPageSize: number) => {
    setInvoicedPageSize(newPageSize);
    setInvoicedCurrentPage(1);
  };

  // Load invoiced billing periods with server-side pagination
  useEffect(() => {
    let isMounted = true;

    const loadInvoicedPeriods = async () => {
      setIsInvoicedLoading(true);
      try {
        const result = await getInvoicedBillingCyclesPaginated({
          page: invoicedCurrentPage,
          pageSize: invoicedPageSize,
          searchTerm: debouncedInvoicedSearchTerm
        });

        if (!isMounted) return;

        setInvoicedPeriods(result.cycles.map((cycle): Period => ({
          ...cycle,
          can_generate: false // Already invoiced periods can't be generated again
        })));
        setTotalInvoicedPeriods(result.total);

        // Clamp page if current page is beyond available pages
        const maxPage = Math.max(1, Math.ceil(result.total / invoicedPageSize));
        if (invoicedCurrentPage > maxPage && invoicedCurrentPage !== maxPage) {
          setInvoicedCurrentPage(maxPage);
        }
      } catch (error) {
        console.error('Error loading invoiced periods:', error);
        if (isMounted) {
          setLoadError('Failed to load invoiced periods. Please try again.');
        }
      }
      if (isMounted) {
        setIsInvoicedLoading(false);
      }
    };

    loadInvoicedPeriods();

    return () => {
      isMounted = false;
    };
  }, [invoicedCurrentPage, invoicedPageSize, debouncedInvoicedSearchTerm, refreshTrigger]);

  // Debug effect to log preview data
  useEffect(() => {
    if (previewState.data) {
      console.log("Preview data items:", previewState.data.items); // Use items
      // Need to check item structure for contract headers if needed, assuming 'description' for now
      console.log("Contract headers:", previewState.data.items.filter(item => item.description?.startsWith('Contract:')));
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
      // No cast needed now, types should match directly
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
    const billingCycleIds = Array.from(selectedPeriods);
    if (billingCycleIds.length === 0) {
      return;
    }

    setIsGenerating(true);
    setErrors({});

    try {
      const overageResults = await Promise.all(
        billingCycleIds.map(async (id) => {
          try {
            const overage = await getPurchaseOrderOverageForBillingCycle(id);
            return { id, overage };
          } catch (err) {
            // If overage analysis fails, treat as "no overage warning" and let generation surface errors normally.
            return { id, overage: null as any };
          }
        })
      );

      const overageByBillingCycleId: Record<string, { clientName: string; overageCents: number; poNumber: string | null }> = {};
      for (const result of overageResults) {
        const overage = result.overage;
        if (!overage || overage.overage_cents <= 0) {
          continue;
        }

        const period = periods.find((p) => p.billing_cycle_id === result.id);
        const clientName = period?.client_name || result.id;
        overageByBillingCycleId[result.id] = {
          clientName,
          overageCents: overage.overage_cents,
          poNumber: overage.po_number ?? null,
        };
      }

      const overageIds = Object.keys(overageByBillingCycleId);
      if (overageIds.length > 0) {
        setPoOverageDialogState({
          isOpen: true,
          billingCycleIds,
          overageByBillingCycleId,
        });
        return;
      }

      // Generate invoices sequentially (they're already sequential, but we could batch if needed)
      const newErrors: { [key: string]: string } = {};
      for (const billingCycleId of billingCycleIds) {
        try {
          await generateInvoice(billingCycleId);
        } catch (err) {
          const period = periods.find((p) => p.billing_cycle_id === billingCycleId);
          const clientName = period?.client_name || billingCycleId;
          newErrors[clientName] = err instanceof Error ? err.message : 'Unknown error occurred';
        }
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }

      setSelectedPeriods(new Set());
      // Let onGenerateSuccess trigger refresh via refreshTrigger - no need to manually reload
      onGenerateSuccess();
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePoOverageBatchDecision = async (decisionValue?: string) => {
    const decision = (decisionValue ?? 'allow') as 'allow' | 'skip';
    const { billingCycleIds, overageByBillingCycleId } = poOverageDialogState;

    setPoOverageDialogState({ isOpen: false, billingCycleIds: [], overageByBillingCycleId: {} });
    setIsGenerating(true);
    setErrors({});

    try {
      const newErrors: { [key: string]: string } = {};
      const overageIds = new Set(Object.keys(overageByBillingCycleId));
      const toGenerate =
        decision === 'skip' ? billingCycleIds.filter((id) => !overageIds.has(id)) : billingCycleIds;

      if (decision === 'skip') {
        for (const [, info] of Object.entries(overageByBillingCycleId)) {
          newErrors[info.clientName] =
            `Skipped due to PO overage (${info.poNumber ? `PO ${info.poNumber}` : 'PO'}): ` +
            `over by ${formatCurrency(info.overageCents)}.`;
        }
      }

      for (const billingCycleId of toGenerate) {
        try {
          await generateInvoice(billingCycleId, { allowPoOverage: decision === 'allow' });
        } catch (err) {
          const period = periods.find((p) => p.billing_cycle_id === billingCycleId);
          const clientName = period?.client_name || billingCycleId;
          newErrors[clientName] = err instanceof Error ? err.message : 'Unknown error occurred';
        }
      }

      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return;
      }

      setSelectedPeriods(new Set());
      // Let onGenerateSuccess trigger refresh via refreshTrigger - no need to manually reload
      onGenerateSuccess();
    } finally {
      setIsGenerating(false);
    }
  };

  const handleReverseBillingCycle = async () => {
    if (!selectedCycleToReverse) return;

    setIsReversing(true);
    try {
      await removeBillingCycle(selectedCycleToReverse.id);
      setShowReverseDialog(false);
      setSelectedCycleToReverse(null);
      // Let onGenerateSuccess trigger refresh via refreshTrigger
      onGenerateSuccess();
    } catch (error) {
      setErrors({
        [selectedCycleToReverse.client]: error instanceof Error ? error.message : 'Failed to reverse billing cycle'
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
      setShowDeleteDialog(false);
      setSelectedCycleToDelete(null);
      // Let onGenerateSuccess trigger refresh via refreshTrigger
      onGenerateSuccess();
    } catch (error) {
      setErrors({
        [selectedCycleToDelete.client]: error instanceof Error ? error.message : 'Failed to delete billing cycle'
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
      const overage = await getPurchaseOrderOverageForBillingCycle(previewState.billingCycleId);
      if (overage && overage.overage_cents > 0) {
        setPoOverageSingleConfirm({
          isOpen: true,
          billingCycleId: previewState.billingCycleId,
          overageCents: overage.overage_cents,
          poNumber: overage.po_number ?? null,
        });
        return;
      }

      await generateInvoice(previewState.billingCycleId);
      setShowPreviewDialog(false); // Close dialog on success
      setPreviewState({ data: null, billingCycleId: null }); // Reset preview state
      onGenerateSuccess(); // Refresh data lists
    } catch (err) {
      setErrors({
        preview: err instanceof Error ? err.message : 'Failed to generate invoice from preview',
      });
    } finally {
      setIsGeneratingFromPreview(false);
    }
  };

  const handlePoOverageSingleConfirm = async () => {
    if (!poOverageSingleConfirm.billingCycleId) {
      return;
    }

    const billingCycleId = poOverageSingleConfirm.billingCycleId;
    setPoOverageSingleConfirm({ isOpen: false, billingCycleId: null, overageCents: 0, poNumber: null });

    setIsGeneratingFromPreview(true);
    setErrors({});

    try {
      await generateInvoice(billingCycleId, { allowPoOverage: true });
      setShowPreviewDialog(false);
      setPreviewState({ data: null, billingCycleId: null });
      onGenerateSuccess();
    } catch (err) {
      setErrors({
        preview: err instanceof Error ? err.message : 'Failed to generate invoice from preview',
      });
    } finally {
      setIsGeneratingFromPreview(false);
    }
  };

  // Removed company drawer handler (migrated to client-only flow)

  // Show combined loading state only during initial load (before any data has loaded)
  const isInitialLoading = !initialLoadDone.current && (isPeriodsLoading || isInvoicedLoading);

  return (
  // Removed TooltipProvider wrapper
      <>
      {isInitialLoading ? (
        <LoadingIndicator
          layout="stacked"
          className="py-10 text-gray-600"
          spinnerProps={{ size: 'md' }}
          text="Loading billing data"
        />
      ) : loadError ? (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
          <button
            id="dismiss-load-error-button"
            className="absolute top-2 right-2"
            onClick={() => setLoadError(null)}
          >
            <X className="h-4 w-4" />
          </button>
          <p>{loadError}</p>
          <Button
            id="retry-load-button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              setLoadError(null);
              // Reset to page 1 to trigger a fresh load
              setCurrentReadyPage(1);
              setInvoicedCurrentPage(1);
            }}
          >
            Retry
          </Button>
        </div>
      ) : (
      <div className="space-y-8">
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Ready to Invoice</h2>
            <div className="flex gap-2 items-end">
              <Button
                id='preview-selected-button'
                variant="outline"
                onClick={() => {
                  if (selectedPeriods.size === 1) {
                    handlePreviewInvoice(Array.from(selectedPeriods)[0]);
                  }
                }}
                disabled={selectedPeriods.size !== 1 || isPreviewLoading}
              >
                <Eye className="h-4 w-4 mr-2" />
                {isPreviewLoading ? 'Loading...' : 'Preview Selected'}
              </Button>
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

          {/* Filters row */}
          <div className="flex items-end gap-4 mb-4">
            <DateRangePicker
              id="billing-period-date-range"
              label="Period end date range"
              value={pendingDateRange}
              onChange={(range) => setPendingDateRange(range)}
            />
            <Button
              id="apply-billing-period-date-filter"
              variant="outline"
              onClick={handleDateRangeSearch}
            >
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
            <Input
              id="filter-clients-input"
              type="text"
              placeholder="Filter clients..."
              containerClassName=""
              value={clientFilter}
              onChange={(e) => setClientFilter(e.target.value)}
              className="w-64"
            />
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
                {Object.entries(errors).map(([client, errorMessage]): React.JSX.Element => (
                  <li key={client}>
                    <span className="font-medium">{client}:</span> {errorMessage}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DataTable
            id="automatic-invoices-table"
            key={`${currentReadyPage}-${pageSize}`}
            data={filteredPeriods}
            // Add onRowClick prop - implementation depends on DataTable component
            // Assuming it takes a function like this:
            // Temporarily disabled invoice preview on row click
            // onRowClick={(record: Period) => {
            //   if (record.billing_cycle_id) {
            //     handlePreviewInvoice(record.billing_cycle_id);
            //   }
            // }
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
              { title: 'Client', dataIndex: 'client_name' },
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
                          {/* Temporarily disabled invoice preview */}
                          {/* <DropdownMenuItem
                            id={`preview-invoice-${record.billing_cycle_id}`}
                            onClick={() => handlePreviewInvoice(record.billing_cycle_id || '')}
                            disabled={isPreviewLoading} // Disable only during preview loading
                          >
                            Preview
                          </DropdownMenuItem> */}
                          {/* <DropdownMenuSeparator /> */}
                          {/* Delete Option Moved Here */}
                          <DropdownMenuItem
                            id={`delete-billing-cycle-${record.billing_cycle_id}`}
                            className="text-red-600 focus:text-red-600 focus:bg-red-50"
                            onSelect={(e) => e.preventDefault()} // Prevent closing dropdown immediately
                            onClick={() => {
                              setSelectedCycleToDelete({
                                id: record.billing_cycle_id || '',
                                client: record.client_name,
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
            pagination={true}
            currentPage={currentReadyPage}
            onPageChange={handleReadyPageChange}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
            totalItems={totalPeriods}
            // Fixed rowClassName prop - removed cursor-pointer since row click is disabled
            rowClassName={() => "hover:bg-muted/50"}
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Already Invoiced</h2>
            <Input
              id="filter-invoiced-clients-input"
              type="text"
              placeholder="Filter clients..."
              value={invoicedSearchTerm}
              onChange={(e) => setInvoicedSearchTerm(e.target.value)}
              className="w-64"
            />
          </div>
          <DataTable
            id="already-invoiced-table"
            data={invoicedPeriods}
            columns={[
              { title: 'Client', dataIndex: 'client_name' },
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
                              client: record.client_name,
                              period: `${toPlainDate(record.period_start_date).toLocaleString()} - ${toPlainDate(record.period_end_date).toLocaleString()}`
                            });
                            setShowReverseDialog(true);
                          }}
                        >
                          Reverse Invoice
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              }
            ]}
            pagination={true}
            currentPage={invoicedCurrentPage}
            onPageChange={setInvoicedCurrentPage}
            pageSize={invoicedPageSize}
            onItemsPerPageChange={handleInvoicedPageSizeChange}
            totalItems={totalInvoicedPeriods}
          />
        </div>
      </div>
      )}

      <Dialog
        isOpen={showReverseDialog}
        onClose={() => setShowReverseDialog(false)}
        title="Reverse Billing Cycle"
      >
        <DialogContent>
          <div className="flex items-center gap-2 text-red-600 mb-4">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-semibold">Warning: Reverse Billing Cycle</span>
          </div>
          <div className="text-sm space-y-2">
            <p className="font-semibold">You are about to reverse the billing cycle for:</p>
            <p>Client: {selectedCycleToReverse?.client}</p>
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
        title="Invoice Preview"
      >
        <DialogContent>
          <DialogDescription>
            This is a preview of how the invoice will look when finalized.
          </DialogDescription>
          {errors.preview ? (
            <div className="text-center py-8">
              {/* Display error message if present */}
              <p className="text-red-600">{errors.preview}</p>
            </div>
          ) : previewState.data && ( // Check previewState.data instead of previewData
            <div className="space-y-4">
              <div className="border-b pb-4">
                <h3 className="font-semibold">Client Details</h3>
                {/* Use customer property */}
                <p>{previewState.data.customer?.name}</p>
                <p>{previewState.data.customer?.address}</p>
              </div>

              <div className="border-b pb-4">
                <h3 className="font-semibold">Invoice Details</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Invoice Number</p>
                    {/* Use invoiceNumber */}
                    <p>{previewState.data.invoiceNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Date</p>
                    {/* Use issueDate and convert */}
                    <p>{toPlainDate(previewState.data.issueDate).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Due Date</p>
                    {/* Use dueDate and convert */}
                    <p>{toPlainDate(previewState.data.dueDate).toLocaleString()}</p>
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
                    {/* Map over previewState.data.items */}
                    {previewState.data.items.map((item) => {
                      // Check for contract header based on description (adjust if needed)
                      const isContractHeader = item.description?.startsWith('Contract:');
                      // Check for detail line (assuming no quantity/unitPrice for now)
                      const isDetailLine = !isContractHeader && item.quantity === undefined && item.unitPrice === undefined;

                      if (isContractHeader) {
                        // Render contract header style
                        return (
                          <tr key={item.id} className="border-b bg-muted/50 font-semibold">
                            <td className="py-2 px-2" colSpan={4}>{item.description}</td>
                          </tr>
                        );
                      } else if (isDetailLine) {
                        // Render detail line (blank Qty/Rate)
                        return (
                          <tr key={item.id} className="border-b">
                            <td className="py-2 px-2">{item.description}</td>
                            <td className="text-right py-2 px-2"></td> {/* Blank Quantity */}
                            <td className="text-right py-2 px-2"></td> {/* Blank Rate */}
                            <td className="text-right py-2 px-2">{formatCurrency(item.total / 100)}</td>
                          </tr>
                        );
                      } else {
                        // Render regular standalone item
                        return (
                          <tr key={item.id} className="border-b">
                            <td className="py-2 px-2">{item.description}</td>
                            <td className="text-right py-2 px-2">{item.quantity}</td>
                            <td className="text-right py-2 px-2">{formatCurrency(item.unitPrice / 100)}</td>
                            <td className="text-right py-2 px-2">{formatCurrency(item.total / 100)}</td>
                          </tr>
                        );
                      }
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={3} className="text-right py-2 font-semibold">Subtotal</td>
                      {/* Use previewState.data properties */}
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
        message={`This action cannot be undone. This will permanently delete the billing cycle and any associated invoice data for:\nClient: ${selectedCycleToDelete?.client}\nPeriod: ${selectedCycleToDelete?.period}`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Yes, Delete Permanently'} // Renamed prop
        isConfirming={isDeleting}
        // Removed unsupported props: confirmButtonVariant, icon
        id="delete-billing-cycle-confirmation" // Added an ID for consistency
      />

      <ConfirmationDialog
        id="po-overage-batch-decision"
        isOpen={poOverageDialogState.isOpen}
        onClose={() =>
          setPoOverageDialogState({ isOpen: false, billingCycleIds: [], overageByBillingCycleId: {} })
        }
        title="Purchase Order Limit Overages"
        message={
          <div className="space-y-2">
            <p>
              One or more invoices would exceed a Purchase Order authorized amount. What do you want to do?
            </p>
            <ul className="list-disc pl-5">
              {Object.entries(poOverageDialogState.overageByBillingCycleId).map(([id, info]) => (
                <li key={id}>
                  {info.clientName}: over by {formatCurrency(info.overageCents)}
                  {info.poNumber ? ` (PO ${info.poNumber})` : ''}
                </li>
              ))}
            </ul>
          </div>
        }
        confirmLabel="Continue"
        cancelLabel="Cancel"
        options={[
          { value: 'allow', label: 'Allow overages (generate all invoices)' },
          { value: 'skip', label: 'Skip invoices that would overrun their PO' },
        ]}
        onConfirm={handlePoOverageBatchDecision}
      />

      <ConfirmationDialog
        id="po-overage-single-confirm"
        isOpen={poOverageSingleConfirm.isOpen}
        onClose={() => setPoOverageSingleConfirm({ isOpen: false, billingCycleId: null, overageCents: 0, poNumber: null })}
        title="Purchase Order Limit Overages"
        message={
          <div className="space-y-2">
            <p>
              This invoice would exceed the Purchase Order authorized amount by {formatCurrency(poOverageSingleConfirm.overageCents)}.
            </p>
            {poOverageSingleConfirm.poNumber && <p>PO Number: {poOverageSingleConfirm.poNumber}</p>}
            <p>Proceed anyway?</p>
          </div>
        }
        confirmLabel="Proceed Anyway"
        cancelLabel="Cancel"
        onConfirm={handlePoOverageSingleConfirm}
      />
      </>
  // Removed TooltipProvider closing tag
  );
};

export default AutomaticInvoices;
