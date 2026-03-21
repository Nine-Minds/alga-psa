'use client'

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toPlainDate } from '@alga-psa/core';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Input } from '@alga-psa/ui/components/Input';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DateRangePicker, DateRange } from '@alga-psa/ui/components/DateRangePicker';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Search, AlertTriangle, X, MoreVertical, Eye } from 'lucide-react';
import type {
  IRecurringDueSelectionInput,
  IRecurringDueWorkInvoiceCandidate,
  IRecurringDueWorkMaterializationGap,
} from '@alga-psa/types';
import {
  getPurchaseOrderOverageForSelectionInput,
  previewInvoiceForSelectionInput,
} from '@alga-psa/billing/actions/invoiceGeneration';
import { generateInvoicesAsRecurringBillingRun } from '@alga-psa/billing/actions/recurringBillingRunActions';
import { WasmInvoiceViewModel } from '@alga-psa/types';
import {
  getRecurringInvoiceHistoryPaginated,
  reverseRecurringInvoice,
  hardDeleteRecurringInvoice,
  type RecurringInvoiceHistoryRow,
} from '@alga-psa/billing/actions/billingCycleActions';
import {
  getAvailableRecurringDueWork,
  type BillingPeriodDateRange,
} from '@alga-psa/billing/actions/billingAndTax';
import { Dialog, DialogContent, DialogFooter, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { formatCurrency } from '@alga-psa/core';
// Added imports for DropdownMenu
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  // DropdownMenuLabel, // Removed - not exported/needed
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@alga-psa/ui/components/DropdownMenu";
// Use ConfirmationDialog instead of AlertDialog
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog'; // Corrected import
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

interface AutomaticInvoicesProps {
  onGenerateSuccess: () => void;
  refreshTrigger?: number;
}

type ReadyPeriod = IRecurringDueWorkInvoiceCandidate;

type InvoicedPeriod = RecurringInvoiceHistoryRow;

interface RecurringInvoiceParentGroup {
  parentSummary: {
    parentGroupKey: string;
    parentSelectionKey: string;
    candidateKey: string;
    clientName: string | null;
    windowLabel: string;
    servicePeriodLabel: string;
    childCount: number;
    aggregateAmountCents: number | null;
    isCombinable: boolean;
    combinabilitySummary: string;
    incompatibilityReasons: string[];
    canGenerate: boolean;
    blockedReason: string | null;
  };
  childExecutionRows: ReadyPeriod['members'];
  candidate: ReadyPeriod;
}

const buildRecurringInvoiceParentGroups = (candidates: ReadyPeriod[]): RecurringInvoiceParentGroup[] =>
  candidates.map((candidate) => {
    const memberAmounts = candidate.members
      .map((member) => (member as { amountCents?: number | null }).amountCents)
      .filter((amount): amount is number => typeof amount === 'number' && Number.isFinite(amount));
    const aggregateAmountCents =
      memberAmounts.length > 0 && memberAmounts.length === candidate.members.length
        ? memberAmounts.reduce((sum, amount) => sum + amount, 0)
        : null;
    const incompatibilityReasons = resolveIncompatibilityReasons(candidate);
    const isCombinable = candidate.canGenerate && incompatibilityReasons.length === 0;

    return {
      parentSummary: {
      parentGroupKey: `parent-group:${candidate.clientId}:${candidate.windowStart}:${candidate.windowEnd}`,
      parentSelectionKey: `parent-selection:${candidate.candidateKey}`,
      candidateKey: candidate.candidateKey,
      clientName: candidate.clientName ?? null,
      windowLabel: candidate.windowLabel,
      servicePeriodLabel: candidate.servicePeriodLabel,
      childCount: candidate.memberCount,
      aggregateAmountCents,
      isCombinable,
      combinabilitySummary: isCombinable ? 'Combinable as one invoice' : 'Not combinable as one invoice',
      incompatibilityReasons,
      canGenerate: candidate.canGenerate,
      blockedReason: candidate.blockedReason ?? null,
    },
    childExecutionRows: candidate.members,
    candidate,
    };
  });

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

const getTodayDate = (): Date => {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
};

const buildServicePeriodRepairHref = (scheduleKey: string) =>
  `/msp/billing?tab=service-periods&scheduleKey=${encodeURIComponent(scheduleKey)}`;

const isInvoiceDraftStatus = (status: string | null | undefined): boolean =>
  (status ?? '').toLowerCase() === 'draft';

const formatCadenceSourceBadge = (
  cadenceSource: string | null | undefined,
): { label: string; variant: 'outline' | 'secondary' } => {
  switch (cadenceSource) {
    case 'contract_anniversary':
      return { label: 'Contract anniversary', variant: 'outline' };
    case 'client_schedule':
      return { label: 'Client schedule', variant: 'outline' };
    default:
      return {
        label: `Unknown cadence source (${cadenceSource?.trim() ? cadenceSource : 'missing'})`,
        variant: 'secondary',
      };
  }
};

const getRecurringAssignmentContext = (member: IRecurringDueWorkInvoiceCandidate['members'][number]): string | null => {
  if (member.contractLineId?.trim()) {
    return `Assignment line ${member.contractLineId.trim()}`;
  }

  const scheduleKey = member.scheduleKey?.trim();
  if (scheduleKey) {
    const contractLineMatch = scheduleKey.match(/contract_line:([^:]+)/);
    if (contractLineMatch?.[1]) {
      return `Assignment line ${contractLineMatch[1]}`;
    }
    const clientContractLineMatch = scheduleKey.match(/client_contract_line:([^:]+)/);
    if (clientContractLineMatch?.[1]) {
      return `Assignment line ${clientContractLineMatch[1]}`;
    }
  }

  return member.executionIdentityKey?.trim()
    ? `Execution ${member.executionIdentityKey.trim()}`
    : null;
};

const normalizeScopeValue = (value: string | null | undefined): string => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : '__none__';
};

const resolveIncompatibilityReasons = (candidate: ReadyPeriod): string[] => {
  const eligibleMembers = candidate.members.filter((member) => member.canGenerate);
  const members = eligibleMembers.length > 0 ? eligibleMembers : candidate.members;
  if (members.length <= 1) {
    return [];
  }

  const reasons: string[] = [];
  const uniqueClients = new Set(members.map((member) => normalizeScopeValue(member.clientId)));
  const uniqueCurrencies = new Set(members.map((member) => normalizeScopeValue(member.currencyCode)));
  const uniquePoScopes = new Set(members.map((member) => normalizeScopeValue(member.purchaseOrderScopeKey)));
  const uniqueTaxSources = new Set(members.map((member) => normalizeScopeValue(member.taxSource)));
  const uniqueExportShapes = new Set(members.map((member) => normalizeScopeValue(member.exportShapeKey)));

  if (uniqueClients.size > 1) {
    reasons.push('Client differs');
  }
  if (uniquePoScopes.size > 1) {
    reasons.push('PO scope differs');
  }
  if (uniqueCurrencies.size > 1) {
    reasons.push('Currency differs');
  }
  if (uniqueTaxSources.size > 1) {
    reasons.push('Tax treatment differs');
  }
  if (uniqueExportShapes.size > 1) {
    reasons.push('Export shape differs');
  }

  return reasons;
};

const AutomaticInvoices: React.FC<AutomaticInvoicesProps> = ({ onGenerateSuccess, refreshTrigger = 0 }) => {
  const router = useRouter();
  // Drawer removed: client details quick view no longer used here
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [expandedParentGroups, setExpandedParentGroups] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [clientFilter, setClientFilter] = useState<string>('');
  const [debouncedClientFilter, setDebouncedClientFilter] = useState<string>('');

  // Date range filter state (pending = user selection, applied = active filter)
  const [pendingDateRange, setPendingDateRange] = useState<DateRange>(() => ({
    from: undefined,
    to: getTodayDate(),
  }));
  const [appliedDateRange, setAppliedDateRange] = useState<DateRange>(() => ({
    from: undefined,
    to: getTodayDate(),
  }));
  const [invoicedPeriods, setInvoicedPeriods] = useState<InvoicedPeriod[]>([]);
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
    invoiceId: string;
    billingCycleId: string | null;
    hasBillingCycleBridge: boolean;
    client: string;
    servicePeriodLabel: string;
    cadenceSource: string;
  } | null>(null);
  // State to hold preview data and the canonical selector metadata used to generate it.
  const [previewState, setPreviewState] = useState<{
    data: WasmInvoiceViewModel | null; // Use the directly imported ViewModel type
    billingCycleId: string | null;
    executionIdentityKey: string | null;
    selectorInput: IRecurringDueSelectionInput | null;
  }>({ data: null, billingCycleId: null, executionIdentityKey: null, selectorInput: null });
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isGeneratingFromPreview, setIsGeneratingFromPreview] = useState(false); // Loading state for generate from preview
  const [poOverageDialogState, setPoOverageDialogState] = useState<{
    isOpen: boolean;
    executionIdentityKeys: string[];
    overageByExecutionIdentityKey: Record<string, { clientName: string; overageCents: number; poNumber: string | null }>;
  }>({
    isOpen: false,
    executionIdentityKeys: [],
    overageByExecutionIdentityKey: {},
  });
  const [poOverageSingleConfirm, setPoOverageSingleConfirm] = useState<{
    isOpen: boolean;
    billingCycleId: string | null;
    executionIdentityKey: string | null;
    selectorInput: IRecurringDueSelectionInput | null;
    overageCents: number;
    poNumber: string | null;
  }>({
    isOpen: false,
    billingCycleId: null,
    executionIdentityKey: null,
    selectorInput: null,
    overageCents: 0,
    poNumber: null,
  });
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedCycleToDelete, setSelectedCycleToDelete] = useState<{
    invoiceId: string;
    billingCycleId: string | null;
    hasBillingCycleBridge: boolean;
    client: string;
    servicePeriodLabel: string;
    cadenceSource: string;
  } | null>(null);

  // Server-side pagination state for "Ready to Invoice"
  const [periods, setPeriods] = useState<ReadyPeriod[]>([]);
  const [materializationGaps, setMaterializationGaps] = useState<IRecurringDueWorkMaterializationGap[]>([]);
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
        setExpandedParentGroups(new Set());
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [clientFilter]);

  // Handle page size change - reset to page 1 and clear selection
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentReadyPage(1);
    setSelectedPeriods(new Set());
    setExpandedParentGroups(new Set());
  };

  // Handle page change - clear selection (server-side pagination means selected items may not be visible)
  const handleReadyPageChange = (newPage: number) => {
    setCurrentReadyPage(newPage);
    setSelectedPeriods(new Set());
    setExpandedParentGroups(new Set());
  };

  // Handle date range search - apply filter, reset page, and clear selection
  const handleDateRangeSearch = () => {
    setAppliedDateRange(pendingDateRange);
    setCurrentReadyPage(1);
    setSelectedPeriods(new Set());
    setExpandedParentGroups(new Set());
  };

  // Load available billing periods with server-side pagination
  useEffect(() => {
    let isMounted = true;

    const loadPeriods = async () => {
      setIsPeriodsLoading(true);
      setLoadError(null);
      try {
        const dateRangeFilter = buildDateRangeFilter(appliedDateRange);
        const result = await getAvailableRecurringDueWork({
          page: currentReadyPage,
          pageSize: pageSize,
          searchTerm: debouncedClientFilter,
          dateRange: dateRangeFilter
        });

        if (!isMounted) return;

        setPeriods(result.invoiceCandidates as ReadyPeriod[]);
        setMaterializationGaps(result.materializationGaps);
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
          setMaterializationGaps([]);
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
  const parentGroups = buildRecurringInvoiceParentGroups(filteredPeriods);
  const readyRows = parentGroups.flatMap((group) => group.childExecutionRows);
  const selectedParentGroups = parentGroups.filter((group) =>
    selectedPeriods.has(group.parentSummary.parentSelectionKey),
  );
  const selectedPreviewCandidate = selectedParentGroups.length === 1
    ? selectedParentGroups[0]?.candidate ?? null
    : null;
  const selectedPreviewPeriod =
    selectedPreviewCandidate
    && selectedPreviewCandidate.memberCount === 1
    && selectedPreviewCandidate.members.length === 1
      ? selectedPreviewCandidate.members[0] ?? null
      : null;
  const groupedPreviewSelection =
    selectedPreviewCandidate
    && (selectedPreviewCandidate.memberCount > 1 || selectedPreviewCandidate.members.length > 1);

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

  // Load recurring invoice history with server-side pagination
  useEffect(() => {
    let isMounted = true;

    const loadInvoicedPeriods = async () => {
      setIsInvoicedLoading(true);
      try {
        const result = await getRecurringInvoiceHistoryPaginated({
          page: invoicedCurrentPage,
          pageSize: invoicedPageSize,
          searchTerm: debouncedInvoicedSearchTerm
        });

        if (!isMounted) return;

        setInvoicedPeriods(result.rows as InvoicedPeriod[]);
        setTotalInvoicedPeriods(result.total);

        // Clamp page if current page is beyond available pages
        const maxPage = Math.max(1, Math.ceil(result.total / invoicedPageSize));
        if (invoicedCurrentPage > maxPage && invoicedCurrentPage !== maxPage) {
          setInvoicedCurrentPage(maxPage);
        }
      } catch (error) {
        console.error('Error loading invoiced periods:', error);
        if (isMounted) {
          setLoadError('Failed to load recurring invoice history. Please try again.');
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
      const validIds = parentGroups
        .filter((group) => group.parentSummary.canGenerate && group.parentSummary.isCombinable)
        .map((group) => group.parentSummary.parentSelectionKey);
      setSelectedPeriods(new Set(validIds));
    } else {
      setSelectedPeriods(new Set());
    }
  };

  const handleSelectPeriod = (parentSelectionKey: string, event: React.ChangeEvent<HTMLInputElement>) => {
    if (!parentSelectionKey) return;

    const newSelected = new Set(selectedPeriods);
    if (event.target.checked) {
      newSelected.add(parentSelectionKey);
    } else {
      newSelected.delete(parentSelectionKey);
    }
    setSelectedPeriods(newSelected);
  };

  const toggleParentGroupExpansion = (parentGroupKey: string) => {
    setExpandedParentGroups((previous) => {
      const next = new Set(previous);
      if (next.has(parentGroupKey)) {
        next.delete(parentGroupKey);
      } else {
        next.add(parentGroupKey);
      }
      return next;
    });
  };

  const buildRecurringRunTarget = (period: { selectorInput: IRecurringDueSelectionInput; executionWindow: IRecurringDueSelectionInput['executionWindow'] }) => {
    return {
      selectorInput: period.selectorInput,
      executionWindow: period.executionWindow,
    };
  };

  const buildRecurringRunTargetFromSelection = (selection: {
    selectorInput: IRecurringDueSelectionInput;
  }) => {
    return {
      selectorInput: selection.selectorInput,
      executionWindow: selection.selectorInput.executionWindow,
    };
  };

  const resolveFailurePeriod = (failure: {
    billingCycleId?: string | null;
    executionIdentityKey?: string;
  }) =>
    readyRows.find((period) =>
      (failure.executionIdentityKey && period.executionIdentityKey === failure.executionIdentityKey)
      || (failure.billingCycleId && period.billingCycleId === failure.billingCycleId),
    );

  const resolveRecurringFailureLabel = (failure: {
    billingCycleId?: string | null;
    executionIdentityKey?: string;
  }) => {
    const period = resolveFailurePeriod(failure);
    const clientName = period?.clientName?.trim();
    return clientName || failure.billingCycleId || failure.executionIdentityKey || 'Recurring invoice window';
  };

  const handlePreviewInvoice = async (period: {
    selectorInput: IRecurringDueSelectionInput;
    billingCycleId?: string | null;
    executionIdentityKey: string;
  }) => {
    setIsPreviewLoading(true);
    setErrors({}); // Clear previous errors
    const response = await previewInvoiceForSelectionInput(period.selectorInput);
    if (response.success) {
      // No cast needed now, types should match directly
      setPreviewState({
        data: response.data,
        billingCycleId: period.billingCycleId ?? null,
        executionIdentityKey: period.executionIdentityKey,
        selectorInput: period.selectorInput,
      });
      setShowPreviewDialog(true);
    } else {
      setPreviewState({
        data: null,
        billingCycleId: null,
        executionIdentityKey: null,
        selectorInput: null,
      }); // Clear preview state on error
      setErrors({
        preview: (response as { success: false; error: string }).error
      });
      // Optionally open the dialog even on error to show the message
      setShowPreviewDialog(true);
    }
    setIsPreviewLoading(false);
  };

  const handleGenerateInvoices = async () => {
    const selectedCandidates = parentGroups
      .filter((group) => selectedPeriods.has(group.parentSummary.parentSelectionKey))
      .map((group) => group.candidate);
    if (selectedCandidates.length === 0) {
      return;
    }
    const selectedExecutionPeriods = selectedCandidates.flatMap((candidate) => candidate.members);

    setIsGenerating(true);
    setErrors({});

    try {
      const overageResults = await Promise.all(
        selectedExecutionPeriods
          .map(async (period) => {
          try {
            const overage = await getPurchaseOrderOverageForSelectionInput(period.selectorInput);
            return { period, overage };
          } catch (err) {
            // If overage analysis fails, treat as "no overage warning" and let generation surface errors normally.
            return { period, overage: null as any };
          }
        }),
      );

      const overageByExecutionIdentityKey: Record<string, { clientName: string; overageCents: number; poNumber: string | null }> = {};
      for (const result of overageResults) {
        const overage = result.overage;
        if (!overage || overage.overage_cents <= 0) {
          continue;
        }

        const clientName = result.period.clientName || result.period.executionIdentityKey;
        overageByExecutionIdentityKey[result.period.executionIdentityKey] = {
          clientName,
          overageCents: overage.overage_cents,
          poNumber: overage.po_number ?? null,
        };
      }

      const overageIds = Object.keys(overageByExecutionIdentityKey);
      if (overageIds.length > 0) {
        setPoOverageDialogState({
          isOpen: true,
          executionIdentityKeys: selectedExecutionPeriods.map((period) => period.executionIdentityKey),
          overageByExecutionIdentityKey,
        });
        return;
      }

      const runResult = await generateInvoicesAsRecurringBillingRun({
        targets: selectedExecutionPeriods.map(buildRecurringRunTarget),
      });
      const newErrors: { [key: string]: string } = {};
      for (const failure of runResult.failures) {
        const label = resolveRecurringFailureLabel(failure);
        newErrors[label] = failure.errorMessage;
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
    const { executionIdentityKeys, overageByExecutionIdentityKey } = poOverageDialogState;

    setPoOverageDialogState({ isOpen: false, executionIdentityKeys: [], overageByExecutionIdentityKey: {} });
    setIsGenerating(true);
    setErrors({});

    try {
      const newErrors: { [key: string]: string } = {};
      const overageIds = new Set(Object.keys(overageByExecutionIdentityKey));
      const selectedExecutionPeriods = readyRows.filter((period) =>
        executionIdentityKeys.includes(period.executionIdentityKey),
      );
      const toGenerate =
        decision === 'skip'
          ? selectedExecutionPeriods.filter((period) => !overageIds.has(period.executionIdentityKey))
          : selectedExecutionPeriods;

      if (decision === 'skip') {
        for (const [, info] of Object.entries(overageByExecutionIdentityKey)) {
          newErrors[info.clientName] =
            `Skipped due to PO overage (${info.poNumber ? `PO ${info.poNumber}` : 'PO'}): ` +
            `over by ${formatCurrency(info.overageCents)}.`;
        }
      }

      const runResult = await generateInvoicesAsRecurringBillingRun({
        targets: toGenerate.map(buildRecurringRunTarget),
        allowPoOverage: decision === 'allow',
      });
      for (const failure of runResult.failures) {
        const label = resolveRecurringFailureLabel(failure);
        newErrors[label] = failure.errorMessage;
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
      await reverseRecurringInvoice({
        invoiceId: selectedCycleToReverse.invoiceId,
        billingCycleId: selectedCycleToReverse.billingCycleId,
      });
      setShowReverseDialog(false);
      setSelectedCycleToReverse(null);
      // Let onGenerateSuccess trigger refresh via refreshTrigger
      onGenerateSuccess();
    } catch (error) {
      setErrors({
        [selectedCycleToReverse.client]: error instanceof Error ? error.message : 'Failed to reverse recurring invoice'
      });
    }
    setIsReversing(false);
  };

  const handleDeleteRecurringInvoice = async () => {
    if (!selectedCycleToDelete) return;

    setIsDeleting(true);
    setErrors({});
    try {
      await hardDeleteRecurringInvoice({
        invoiceId: selectedCycleToDelete.invoiceId,
        billingCycleId: selectedCycleToDelete.billingCycleId,
      });
      setShowDeleteDialog(false);
      setSelectedCycleToDelete(null);
      onGenerateSuccess();
    } catch (error) {
      setErrors({
        [selectedCycleToDelete.client]: error instanceof Error ? error.message : 'Failed to delete recurring invoice'
      });
      setShowDeleteDialog(false);
    }
    setIsDeleting(false);
  };

  const handleGenerateFromPreview = async () => {
    if (!previewState.selectorInput) return;

    setIsGeneratingFromPreview(true);
    setErrors({}); // Clear previous errors

    try {
      const overage = await getPurchaseOrderOverageForSelectionInput(previewState.selectorInput);
      if (overage && overage.overage_cents > 0) {
        setPoOverageSingleConfirm({
          isOpen: true,
          billingCycleId: previewState.billingCycleId,
          executionIdentityKey: previewState.executionIdentityKey,
          selectorInput: previewState.selectorInput,
          overageCents: overage.overage_cents,
          poNumber: overage.po_number ?? null,
        });
        return;
      }

      const runResult = await generateInvoicesAsRecurringBillingRun({
        targets: [
          buildRecurringRunTargetFromSelection({
            selectorInput: previewState.selectorInput,
          }),
        ],
      });
      if (runResult.failures.length > 0) {
        throw new Error(runResult.failures[0]?.errorMessage || 'Failed to generate invoice from preview');
      }
      setShowPreviewDialog(false); // Close dialog on success
      setPreviewState({
        data: null,
        billingCycleId: null,
        executionIdentityKey: null,
        selectorInput: null,
      }); // Reset preview state
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
    if (!poOverageSingleConfirm.selectorInput) {
      return;
    }

    const { selectorInput } = poOverageSingleConfirm;
    setPoOverageSingleConfirm({
      isOpen: false,
      billingCycleId: null,
      executionIdentityKey: null,
      selectorInput: null,
      overageCents: 0,
      poNumber: null,
    });

    setIsGeneratingFromPreview(true);
    setErrors({});

    try {
      const runResult = await generateInvoicesAsRecurringBillingRun({
        targets: [
          buildRecurringRunTargetFromSelection({
            selectorInput,
          }),
        ],
        allowPoOverage: true,
      });
      if (runResult.failures.length > 0) {
        throw new Error(runResult.failures[0]?.errorMessage || 'Failed to generate invoice from preview');
      }
      setShowPreviewDialog(false);
      setPreviewState({
        data: null,
        billingCycleId: null,
        executionIdentityKey: null,
        selectorInput: null,
      });
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

  const handleRecurringHistoryRowClick = (record: InvoicedPeriod) => {
    const subtab = isInvoiceDraftStatus(record.invoiceStatus) ? 'drafts' : 'finalized';
    const params = new URLSearchParams();
    params.set('tab', 'invoicing');
    params.set('subtab', subtab);
    params.set('invoiceId', record.invoiceId);
    router.push(`/msp/billing?${params.toString()}`);
  };

  // Show combined loading state only during initial load (before any data has loaded)
  const isInitialLoading = !initialLoadDone.current && (isPeriodsLoading || isInvoicedLoading);

  return (
  // Removed TooltipProvider wrapper
      <>
      {isInitialLoading ? (
        <LoadingIndicator
          layout="stacked"
          className="py-10 text-muted-foreground"
          spinnerProps={{ size: 'md' }}
          text="Loading billing data"
        />
      ) : loadError ? (
        <Alert variant="destructive" className="relative mb-4">
          <AlertDescription>
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
          </AlertDescription>
        </Alert>
      ) : (
      <div className="space-y-8">
        <div>
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-semibold">Ready to Invoice</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each parent row groups due obligations by client and invoice window. Child obligations remain the atomic execution units.
              </p>
            </div>
            <div className="flex gap-2 items-end">
              <Button
                id='preview-selected-button'
                variant="outline"
                onClick={() => {
                  if (selectedPreviewPeriod) {
                    handlePreviewInvoice(selectedPreviewPeriod);
                  }
                }}
                disabled={
                  selectedPeriods.size !== 1
                  || !selectedPreviewPeriod
                  || isPreviewLoading
                }
              >
                <Eye className="h-4 w-4 mr-2" />
                {isPreviewLoading ? 'Loading...' : 'Preview Selected'}
              </Button>
              {groupedPreviewSelection ? (
                <span className="text-xs text-muted-foreground" data-testid="grouped-preview-unavailable-copy">
                  Preview is only available for single-obligation candidates.
                </span>
              ) : null}
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
              label="Service period start date range"
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
            <Alert variant="destructive" className="relative mb-4">
              <AlertDescription>
                <button
                  onClick={() => setErrors({})}
                  className="absolute top-2 right-2 p-1 hover:bg-destructive/20 rounded-full transition-colors"
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
              </AlertDescription>
            </Alert>
          )}

          {materializationGaps.length > 0 ? (
            <Alert className="mb-4 border-warning/40 bg-warning/5" data-testid="recurring-materialization-gap-panel">
              <AlertDescription>
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-semibold">Recurring service period repair required</h4>
                      <p className="text-sm text-muted-foreground">
                        These client-cadence windows are missing persisted recurring service periods, so they are blocked from ready-to-invoice work until the canonical schedule is repaired.
                      </p>
                    </div>
                    <ul className="space-y-3">
                      {materializationGaps.map((gap) => (
                        <li
                          key={gap.selectionKey}
                          className="rounded-md border border-warning/30 bg-background/80 px-3 py-3"
                          data-testid={`recurring-materialization-gap-${gap.selectionKey}`}
                        >
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="space-y-1 text-sm">
                              <div className="font-medium">{gap.clientName ?? 'Unknown client'}</div>
                              <div className="text-muted-foreground">{gap.detail}</div>
                              <div>
                                Service period: {gap.servicePeriodStart} to {gap.servicePeriodEnd}
                              </div>
                              <div>
                                Invoice window: {gap.invoiceWindowStart} to {gap.invoiceWindowEnd}
                              </div>
                              <div className="break-all text-xs text-muted-foreground">
                                Schedule key: {gap.scheduleKey}
                              </div>
                            </div>
                            <div className="flex flex-col items-start gap-2">
                              <a
                                href={buildServicePeriodRepairHref(gap.scheduleKey)}
                                className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                              >
                                Review Service Periods
                              </a>
                              <span className="text-xs text-muted-foreground">
                                Repair the canonical service-period records instead of generating a compatibility invoice row.
                              </span>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <DataTable
            id="automatic-invoices-table"
            key={`${currentReadyPage}-${pageSize}`}
            data={parentGroups}
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
                    checked={parentGroups.length > 0 && selectedPeriods.size === parentGroups.filter((group) => group.parentSummary.canGenerate && group.parentSummary.isCombinable).length}
                    onChange={handleSelectAll}
                    disabled={!parentGroups.some((group) => group.parentSummary.canGenerate && group.parentSummary.isCombinable)}
                  />
                ),
                dataIndex: 'candidateKey',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => (
                  <Checkbox
                    id={`select-${record.parentSummary.parentGroupKey}`}
                    checked={selectedPeriods.has(record.parentSummary.parentSelectionKey)}
                    disabled={!record.parentSummary.canGenerate || !record.parentSummary.isCombinable}
                    // Stop propagation to prevent row click when clicking checkbox
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                      event.stopPropagation();
                      handleSelectPeriod(record.parentSummary.parentSelectionKey, event);
                    }}
                    onClick={(e) => e.stopPropagation()} // Also stop propagation on click
                  />
                )
              },
              {
                title: 'Group',
                dataIndex: 'parentGroupKey',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => {
                  const isExpanded = expandedParentGroups.has(record.parentSummary.parentGroupKey);
                  return (
                    <Button
                      id={`toggle-group-${record.parentSummary.parentGroupKey}`}
                      variant="outline"
                      size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleParentGroupExpansion(record.parentSummary.parentGroupKey);
                      }}
                    >
                      {isExpanded ? 'Collapse' : 'Expand'}
                    </Button>
                  );
                },
              },
              {
                title: 'Client',
                dataIndex: 'clientName',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => (
                  <div className="space-y-1">
                    <div>{record.parentSummary.clientName ?? 'Unknown client'}</div>
                    <Badge variant={record.parentSummary.isCombinable ? 'outline' : 'secondary'}>
                      {record.parentSummary.combinabilitySummary}
                    </Badge>
                    {!record.parentSummary.isCombinable && record.parentSummary.incompatibilityReasons.length > 0 ? (
                      <div
                        className="text-xs text-muted-foreground"
                        data-testid={`combinability-reasons-${record.parentSummary.parentGroupKey}`}
                      >
                        {record.parentSummary.incompatibilityReasons.join(', ')}
                      </div>
                    ) : null}
                    {!record.parentSummary.canGenerate && record.parentSummary.blockedReason ? (
                      <div className="text-xs text-muted-foreground">{record.parentSummary.blockedReason}</div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: 'Cadence Source',
                dataIndex: 'cadenceSources',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => (
                  <div className="space-y-1">
                    {record.candidate.cadenceSources.map((source) => {
                      const formattedSource = formatCadenceSourceBadge(source);
                      return (
                      <Badge
                        key={`${record.parentSummary.candidateKey}:${source ?? 'missing'}`}
                        variant={formattedSource.variant}
                        data-testid={`cadence-source-${record.parentSummary.candidateKey}-${source ?? 'missing'}`}
                      >
                        {formattedSource.label}
                      </Badge>
                      );
                    })}
                    {record.childExecutionRows.some((member) => !member.billingCycleId) ? (
                      <Badge variant="secondary">Service-period-backed</Badge>
                    ) : null}
                  </div>
                ),
              },
              {
                title: 'Service Period',
                dataIndex: 'servicePeriodLabel',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => (
                  <div className="space-y-1">
                    <div>{record.parentSummary.servicePeriodLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {record.parentSummary.childCount} obligation{record.parentSummary.childCount === 1 ? '' : 's'}
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid={`group-amount-${record.parentSummary.parentGroupKey}`}>
                      {record.parentSummary.aggregateAmountCents === null
                        ? 'Amount unavailable'
                        : formatCurrency(record.parentSummary.aggregateAmountCents / 100)}
                    </div>
                  </div>
                ),
              },
              {
                title: 'Invoice Window',
                dataIndex: 'windowLabel',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => record.parentSummary.windowLabel,
              },
              {
                title: 'Children',
                dataIndex: 'childExecutionRows',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => {
                  const isExpanded = expandedParentGroups.has(record.parentSummary.parentGroupKey);
                  if (!isExpanded) {
                    return (
                      <div className="text-xs text-muted-foreground">
                        {record.parentSummary.childCount} child candidate{record.parentSummary.childCount === 1 ? '' : 's'}
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-2">
                      {record.childExecutionRows.map((member) => {
                        const assignmentContext = getRecurringAssignmentContext(member);
                        const cadenceSource = formatCadenceSourceBadge(member.cadenceSource).label;
                        const duePosition = (member.selectorInput.executionWindow as { duePosition?: string }).duePosition;
                        const billingTiming = duePosition === 'advance' ? 'Advance' : 'Arrears';
                        const amountCents = (member as { amountCents?: number | null }).amountCents;

                        return (
                          <div
                            key={`${record.parentSummary.parentGroupKey}:${member.executionIdentityKey}`}
                            className="rounded border border-border/60 p-2"
                            data-testid={`child-row-${record.parentSummary.parentGroupKey}-${member.executionIdentityKey}`}
                          >
                            <div className="text-sm font-medium">
                              {assignmentContext ?? member.contractLineName ?? member.executionIdentityKey}
                            </div>
                            <div className="text-xs text-muted-foreground">Cadence: {cadenceSource}</div>
                            <div className="text-xs text-muted-foreground">Billing timing: {billingTiming}</div>
                            <div className="text-xs text-muted-foreground">Service period: {member.servicePeriodLabel}</div>
                            <div className="text-xs text-muted-foreground">
                              Amount: {typeof amountCents === 'number' ? formatCurrency(amountCents / 100) : 'Amount unavailable'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                },
              },
              {
                title: 'Contract',
                dataIndex: 'contractName',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => {
                  const contractNames = Array.from(
                    new Set(
                      record.childExecutionRows
                        .map((member) => member.contractName?.trim())
                        .filter((name): name is string => Boolean(name)),
                    ),
                  );
                  const contractLineNames = Array.from(
                    new Set(
                      record.childExecutionRows
                        .map((member) => member.contractLineName?.trim())
                        .filter((name): name is string => Boolean(name)),
                    ),
                  );
                  const contractMetadataMissingCount = record.childExecutionRows.filter((member) => {
                    const hasContractSignal = Boolean(
                      member.cadenceOwner === 'contract'
                      || member.contractId
                      || member.contractLineId
                      || member.contractName?.trim()
                      || member.contractLineName?.trim(),
                    );
                    if (!hasContractSignal) {
                      return false;
                    }

                    const missingContractIdentity =
                      !member.contractId
                      && !member.contractName?.trim();
                    const missingContractLineIdentity =
                      !member.contractLineId
                      && !member.contractLineName?.trim();
                    const missingContractName = Boolean(member.contractId && !member.contractName?.trim());
                    const missingContractLineName = Boolean(member.contractLineId && !member.contractLineName?.trim());

                    return (
                      missingContractIdentity
                      || missingContractLineIdentity
                      || missingContractName
                      || missingContractLineName
                    );
                  }).length;
                  const assignmentContexts = Array.from(
                    new Set(
                      record.childExecutionRows
                        .map((member) => getRecurringAssignmentContext(member))
                        .filter((value): value is string => Boolean(value)),
                    ),
                  );

                  if (contractNames.length === 0 && contractLineNames.length === 0 && contractMetadataMissingCount === 0) {
                    return <span className="text-muted-foreground">No contract context</span>;
                  }

                  return (
                    <div className="space-y-1">
                      {contractNames.map((name) => (
                        <div key={`${record.parentSummary.candidateKey}:contract:${name}`}>{name}</div>
                      ))}
                      {contractLineNames.map((lineName) => (
                        <div key={`${record.parentSummary.candidateKey}:${lineName}`} className="text-xs text-muted-foreground">
                          {lineName}
                        </div>
                      ))}
                      {assignmentContexts.map((contextValue) => (
                        <div
                          key={`${record.parentSummary.candidateKey}:assignment:${contextValue}`}
                          className="text-xs text-muted-foreground"
                          data-testid={`contract-assignment-context-${record.parentSummary.candidateKey}`}
                        >
                          {contextValue}
                        </div>
                      ))}
                      {contractMetadataMissingCount > 0 ? (
                        <div
                          className="text-xs text-warning"
                          data-testid={`contract-metadata-warning-${record.parentSummary.candidateKey}`}
                        >
                          Contract metadata missing ({contractMetadataMissingCount} obligation{contractMetadataMissingCount === 1 ? '' : 's'})
                        </div>
                      ) : null}
                    </div>
                  );
                },
              }
            ]}
            pagination={true}
            currentPage={currentReadyPage}
            onPageChange={handleReadyPageChange}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
            totalItems={totalPeriods}
            // Fixed rowClassName prop - removed cursor-pointer since row click is disabled
            rowClassName={() => ""}
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Recurring Invoice History</h2>
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
            onRowClick={handleRecurringHistoryRowClick}
            columns={[
              { title: 'Client', dataIndex: 'clientName' },
              {
                title: 'Cadence Source',
                dataIndex: 'cadenceSource',
                render: (_: unknown, record: InvoicedPeriod) => (
                  <div className="space-y-1">
                    <Badge variant={formatCadenceSourceBadge(record.cadenceSource).variant}>
                      {formatCadenceSourceBadge(record.cadenceSource).label}
                    </Badge>
                    {!record.hasBillingCycleBridge ? (
                      <Badge variant="secondary">Service-period-backed</Badge>
                    ) : null}
                  </div>
                ),
              },
              {
                title: 'Service Period',
                dataIndex: 'servicePeriodLabel',
              },
              {
                title: 'Invoice Window',
                dataIndex: 'invoiceWindowLabel',
              },
              {
                title: 'Invoice',
                dataIndex: 'invoiceNumber',
                render: (_: unknown, record: InvoicedPeriod) => (
                  <div className="space-y-1">
                    <div>{record.invoiceNumber ?? record.invoiceId}</div>
                    {record.invoiceDate ? (
                      <div className="text-xs text-muted-foreground">
                        {toPlainDate(record.invoiceDate).toLocaleString()}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: 'Actions',
                dataIndex: 'invoiceId',
                render: (_: unknown, record: InvoicedPeriod) => (
                  <div className="flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button id={`actions-trigger-invoiced-${record.invoiceId}`} variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          id={`reverse-billing-cycle-${record.invoiceId}`}
                          onClick={() => {
                            setSelectedCycleToReverse({
                              invoiceId: record.invoiceId,
                              billingCycleId: record.billingCycleId,
                              hasBillingCycleBridge: record.hasBillingCycleBridge,
                              client: record.clientName,
                              servicePeriodLabel: record.servicePeriodLabel,
                              cadenceSource: record.cadenceSource === 'contract_anniversary'
                                ? 'Contract anniversary'
                                : 'Client schedule',
                            });
                            setShowReverseDialog(true);
                          }}
                        >
                          Reverse Invoice
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          id={`delete-billing-cycle-${record.invoiceId}`}
                          className="text-destructive focus:text-destructive focus:bg-destructive/10"
                          onSelect={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedCycleToDelete({
                              invoiceId: record.invoiceId,
                              billingCycleId: record.billingCycleId,
                              hasBillingCycleBridge: record.hasBillingCycleBridge,
                              client: record.clientName,
                              servicePeriodLabel: record.servicePeriodLabel,
                              cadenceSource: record.cadenceSource === 'contract_anniversary'
                                ? 'Contract anniversary'
                                : 'Client schedule',
                            });
                            setShowDeleteDialog(true);
                          }}
                        >
                          Delete Invoice
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
        title="Reverse Recurring Invoice"
      >
        <DialogContent>
          <div className="flex items-center gap-2 text-red-600 mb-4">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-semibold">Warning: Reverse Recurring Invoice</span>
          </div>
          <div className="text-sm space-y-2">
            <p className="font-semibold">You are about to reverse the recurring invoice for:</p>
            <p>Client: {selectedCycleToReverse?.client}</p>
            <p>Cadence source: {selectedCycleToReverse?.cadenceSource}</p>
            <p>Service period: {selectedCycleToReverse?.servicePeriodLabel}</p>
          </div>

          <Alert variant="warning" className="mt-4">
            <AlertDescription className="text-sm space-y-2">
              <p className="font-semibold">This action will:</p>
              <ul className="list-disc pl-5">
                <li>Delete the generated recurring invoice draft</li>
                <li>Reissue any credits that were applied to that invoice</li>
                <li>Unmark linked time entries and usage records as invoiced</li>
                <li>
                  {selectedCycleToReverse?.hasBillingCycleBridge
                    ? 'Retire the linked client cadence bridge record and reopen the linked recurring service periods'
                    : 'Reopen the linked recurring service periods without requiring client-cycle bridge metadata'}
                </li>
              </ul>
              <p className="text-destructive font-semibold mt-4">This action cannot be undone!</p>
            </AlertDescription>
          </Alert>
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
            {isReversing ? 'Reversing...' : 'Yes, Reverse Invoice'}
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        isOpen={showPreviewDialog}
        // Reset preview state when dialog is closed
        onClose={() => {
          setShowPreviewDialog(false);
          setPreviewState({
            data: null,
            billingCycleId: null,
            executionIdentityKey: null,
            selectorInput: null,
          });
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
                    <p className="text-sm text-muted-foreground">Invoice Number</p>
                    {/* Use invoiceNumber */}
                    <p>{previewState.data.invoiceNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Date</p>
                    {/* Use issueDate and convert */}
                    <p>{toPlainDate(previewState.data.issueDate).toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Due Date</p>
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
              setPreviewState({
                data: null,
                billingCycleId: null,
                executionIdentityKey: null,
                selectorInput: null,
              }); // Reset state on close
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
            disabled={
              !!errors.preview
              || !previewState.data
              || !previewState.selectorInput
              || isGeneratingFromPreview
              || isPreviewLoading
            }
          >
            {isGeneratingFromPreview ? 'Generating...' : 'Generate Invoice'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmationDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setSelectedCycleToDelete(null);
        }}
        onConfirm={handleDeleteRecurringInvoice}
        title="Permanently Delete Recurring Invoice?"
        message={`This action cannot be undone. This will permanently delete the recurring invoice for:\nClient: ${selectedCycleToDelete?.client}\nCadence source: ${selectedCycleToDelete?.cadenceSource}\nService period: ${selectedCycleToDelete?.servicePeriodLabel}\n${selectedCycleToDelete?.hasBillingCycleBridge ? 'The linked client cadence bridge record will also be deleted.' : 'Linked recurring service periods will be reopened without requiring client-cycle bridge metadata.'}`}
        confirmLabel={isDeleting ? 'Deleting...' : 'Yes, Delete Permanently'}
        isConfirming={isDeleting}
        id="delete-recurring-invoice-confirmation"
      />

      <ConfirmationDialog
        id="po-overage-batch-decision"
        isOpen={poOverageDialogState.isOpen}
        onClose={() =>
          setPoOverageDialogState({ isOpen: false, executionIdentityKeys: [], overageByExecutionIdentityKey: {} })
        }
        title="Purchase Order Limit Overages"
        message={
          <div className="space-y-2">
            <p>
              One or more invoices would exceed a Purchase Order authorized amount. What do you want to do?
            </p>
            <ul className="list-disc pl-5">
              {Object.entries(poOverageDialogState.overageByExecutionIdentityKey).map(([id, info]) => (
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
        onClose={() =>
          setPoOverageSingleConfirm({
            isOpen: false,
            billingCycleId: null,
            executionIdentityKey: null,
            selectorInput: null,
            overageCents: 0,
            poNumber: null,
          })
        }
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
