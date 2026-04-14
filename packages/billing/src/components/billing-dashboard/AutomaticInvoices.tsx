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
import { Search, AlertTriangle, X, MoreVertical, Eye, ChevronRight, ChevronDown } from 'lucide-react';
import type {
  IRecurringDueSelectionInput,
  IRecurringDueWorkInvoiceCandidate,
  IRecurringDueWorkMaterializationGap,
} from '@alga-psa/types';
import {
  getPurchaseOrderOverageForSelectionInput,
  previewGroupedInvoicesForSelectionInputs,
} from '@alga-psa/billing/actions/invoiceGeneration';
import { generateGroupedInvoicesAsRecurringBillingRun, generateInvoicesAsRecurringBillingRun } from '@alga-psa/billing/actions/recurringBillingRunActions';
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

type RecurringSelectionGroup = {
  groupKey: string;
  selectorInputs: IRecurringDueSelectionInput[];
  billingCycleId: string | null;
};

const getParentGroupSummary = ({
  isCombinable,
  canGenerate,
  incompatibilityReasons,
  childCount,
}: {
  isCombinable: boolean;
  canGenerate: boolean;
  incompatibilityReasons: string[];
  childCount: number;
}): {
  label: string;
  className: string;
} => {
  if (isCombinable) {
    return {
      label: 'Can combine into 1 invoice',
      className: 'border-border/70 text-foreground',
    };
  }

  if (incompatibilityReasons.length > 0) {
    return {
      label: 'Must invoice separately',
      className: 'border-warning/40 text-warning',
    };
  }

  if (!canGenerate) {
    return {
      label: childCount > 1 ? 'Contains blocked items' : 'Not ready to invoice',
      className: 'border-border/60 text-muted-foreground',
    };
  }

  return {
    label: 'Must invoice separately',
    className: 'border-warning/40 text-warning',
  };
};

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
    const parentGroupSummary = getParentGroupSummary({
      isCombinable,
      canGenerate: candidate.canGenerate,
      incompatibilityReasons,
      childCount: candidate.memberCount,
    });

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
      combinabilitySummary: parentGroupSummary.label,
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

const AUTOMATIC_INVOICES_CLIENT_FILTER_QUERY_PARAM = 'automaticClientFilter';

const readAutomaticInvoicesClientFilterFromLocation = (): string => {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URLSearchParams(window.location.search).get(AUTOMATIC_INVOICES_CLIENT_FILTER_QUERY_PARAM) ?? '';
};

const buildReviewApprovalsHref = (input: {
  clientId: string;
  windowStart: string;
  windowEnd: string;
}) =>
  `/msp/time-sheet-approvals?clientId=${encodeURIComponent(input.clientId)}&windowStart=${encodeURIComponent(input.windowStart)}&windowEnd=${encodeURIComponent(input.windowEnd)}`;

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

const summarizeCadenceSources = (cadenceSources: Array<string | null | undefined>): string => {
  const labels = Array.from(
    new Set(
      cadenceSources.map((source) => formatCadenceSourceBadge(source).label),
    ),
  );

  if (labels.length === 0) {
    return 'Unknown cadence source';
  }

  return labels.join(' + ');
};

const parseNonContractSelectionFromScheduleKey = (scheduleKey: string | null | undefined): {
  chargeType: 'time' | 'usage';
  recordId: string;
} | null => {
  if (!scheduleKey) {
    return null;
  }

  const match = scheduleKey.match(/:(?:unresolved|non_contract):(time|usage):([^:]+)$/);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return {
    chargeType: match[1] as 'time' | 'usage',
    recordId: match[2],
  };
};

const getRecurringAssignmentContext = (member: IRecurringDueWorkInvoiceCandidate['members'][number]): string | null => {
  if (member.attribution?.label?.trim()) {
    return member.attribution.label.trim();
  }

  const nonContractSelection = parseNonContractSelectionFromScheduleKey(member.scheduleKey ?? null);
  if (nonContractSelection) {
    return nonContractSelection.chargeType === 'time'
      ? 'Unresolved time entry'
      : 'Unresolved usage record';
  }

  if (member.contractLineId?.trim()) {
    return 'Assigned contract line';
  }

  const scheduleKey = member.scheduleKey?.trim();
  if (scheduleKey) {
    const contractLineMatch = scheduleKey.match(/contract_line:([^:]+)/);
    if (contractLineMatch?.[1]) {
      return 'Assigned contract line';
    }
    const clientContractLineMatch = scheduleKey.match(/client_contract_line:([^:]+)/);
    if (clientContractLineMatch?.[1]) {
      return 'Assigned contract line';
    }
  }

  return member.executionIdentityKey?.trim()
    ? 'Assigned work item'
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
  const uniqueWindows = new Set(
    members.map((member) =>
      `${normalizeScopeValue(member.invoiceWindowStart)}:${normalizeScopeValue(member.invoiceWindowEnd)}`,
    ),
  );
  const uniqueClients = new Set(members.map((member) => normalizeScopeValue(member.clientId)));
  const uniqueCurrencies = new Set(members.map((member) => normalizeScopeValue(member.currencyCode)));
  const uniquePoScopes = new Set(members.map((member) => normalizeScopeValue(member.purchaseOrderScopeKey)));
  const uniqueTaxSources = new Set(members.map((member) => normalizeScopeValue(member.taxSource)));
  const uniqueExportShapes = new Set(members.map((member) => normalizeScopeValue(member.exportShapeKey)));

  if (uniqueWindows.size > 1) {
    reasons.push('Invoice window differs');
  }
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
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [expandedParentGroups, setExpandedParentGroups] = useState<Set<string>>(new Set());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReversing, setIsReversing] = useState(false);
  const [errors, setErrors] = useState<{[key: string]: string}>({});
  const [clientFilter, setClientFilter] = useState<string>(() => readAutomaticInvoicesClientFilterFromLocation());
  const [debouncedClientFilter, setDebouncedClientFilter] = useState<string>(() => readAutomaticInvoicesClientFilterFromLocation());

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
    previews: Array<{ previewGroupKey: string; data: WasmInvoiceViewModel; selectorInputs: IRecurringDueSelectionInput[] }>;
    invoiceCount: number;
    billingCycleId: string | null;
    executionIdentityKey: string | null;
    selectorInput: IRecurringDueSelectionInput | null;
  }>({ previews: [], invoiceCount: 0, billingCycleId: null, executionIdentityKey: null, selectorInput: null });
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

  // Debounce client filter for local ready/blocked row filtering and persist it in the URL.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedClientFilter(clientFilter);
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const normalizedFilter = clientFilter.trim();
        if (normalizedFilter) {
          params.set(AUTOMATIC_INVOICES_CLIENT_FILTER_QUERY_PARAM, normalizedFilter);
        } else {
          params.delete(AUTOMATIC_INVOICES_CLIENT_FILTER_QUERY_PARAM);
        }

        const nextSearch = params.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (nextUrl !== currentUrl) {
          window.history.replaceState(window.history.state, '', nextUrl);
        }
      }

      if (initialLoadDone.current) {
        setCurrentReadyPage(1);
        setSelectedTargets(new Set()); // Clear selection when filter changes
        setExpandedParentGroups(new Set());
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [clientFilter]);

  // Handle page size change - reset to page 1 and clear selection
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentReadyPage(1);
    setSelectedTargets(new Set());
    setExpandedParentGroups(new Set());
  };

  // Handle page change - clear selection (server-side pagination means selected items may not be visible)
  const handleReadyPageChange = (newPage: number) => {
    setCurrentReadyPage(newPage);
    setSelectedTargets(new Set());
    setExpandedParentGroups(new Set());
  };

  // Handle date range search - apply filter, reset page, and clear selection
  const handleDateRangeSearch = () => {
    setAppliedDateRange(pendingDateRange);
    setCurrentReadyPage(1);
    setSelectedTargets(new Set());
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
          setSelectedTargets(new Set()); // Clear selection since visible rows changed
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
  }, [currentReadyPage, pageSize, appliedDateRange, refreshTrigger]);

  const normalizedReadyClientFilter = debouncedClientFilter.trim().toLowerCase();

  // Client filtering is intentionally scoped to Needs Approval + Ready to Invoice only.
  const filteredPeriods = normalizedReadyClientFilter.length === 0
    ? periods
    : periods.filter((period) =>
        (period.clientName ?? '').toLowerCase().includes(normalizedReadyClientFilter),
      );
  const parentGroups = buildRecurringInvoiceParentGroups(filteredPeriods);
  const needsApprovalParentGroups = parentGroups.filter(
    (group) => (group.candidate.approvalBlockedEntryCount ?? 0) > 0,
  );
  const readyParentGroups = parentGroups.filter(
    (group) => (group.candidate.approvalBlockedEntryCount ?? 0) === 0,
  );
  const readyRows = readyParentGroups.flatMap((group) => group.childExecutionRows);
  const childSelectionKeyForMember = (member: RecurringInvoiceParentGroup['childExecutionRows'][number]) =>
    `child-selection:${member.executionIdentityKey}`;
  const selectedParentGroups = readyParentGroups.filter((group) =>
    selectedTargets.has(group.parentSummary.parentSelectionKey),
  );
  const selectedParentSelectionKeys = new Set(
    selectedParentGroups.map((group) => group.parentSummary.parentSelectionKey),
  );
  const selectedChildRows = readyRows.filter((member) => selectedTargets.has(childSelectionKeyForMember(member)));
  const selectedExecutionRows = [
    ...selectedParentGroups.flatMap((group) => group.childExecutionRows),
    ...selectedChildRows,
  ].filter((member, index, allMembers) =>
    allMembers.findIndex((item) => item.executionIdentityKey === member.executionIdentityKey) === index,
  );
  const resolveSelectionGroupBillingCycleId = (
    members: Array<{
      billingCycleId?: string | null;
      selectorInput: IRecurringDueSelectionInput;
    }>,
  ): string | null => {
    if (members.some((member) => member.selectorInput.executionWindow.kind !== 'client_cadence_window')) {
      return null;
    }

    const billingCycleIds = new Set(
      members
        .map((member) => member.billingCycleId)
        .filter((billingCycleId): billingCycleId is string => Boolean(billingCycleId)),
    );

    if (billingCycleIds.size !== 1 || members.some((member) => !member.billingCycleId)) {
      return null;
    }

    return Array.from(billingCycleIds)[0] ?? null;
  };
  const selectedSelectionGroups: RecurringSelectionGroup[] = [
    ...selectedParentGroups.map((group) => ({
      groupKey: group.parentSummary.parentSelectionKey,
      selectorInputs: group.childExecutionRows.map((member) => member.selectorInput),
      billingCycleId: resolveSelectionGroupBillingCycleId(group.childExecutionRows),
    })),
    ...selectedChildRows
      .filter((member) => {
        const parentGroup = readyParentGroups.find((group) =>
          group.childExecutionRows.some((groupMember) => groupMember.executionIdentityKey === member.executionIdentityKey),
        );
        return !parentGroup || !selectedParentSelectionKeys.has(parentGroup.parentSummary.parentSelectionKey);
      })
      .map((member) => ({
        groupKey: childSelectionKeyForMember(member),
        selectorInputs: [member.selectorInput],
        billingCycleId:
          member.selectorInput.executionWindow.kind === 'client_cadence_window'
            ? member.billingCycleId ?? null
            : null,
      })),
  ].filter((group) => group.selectorInputs.length > 0);
  const previewSupportsDirectGeneration =
    selectedSelectionGroups.length === 1
    && selectedSelectionGroups[0].selectorInputs.length === 1;
  const isGroupFullySelected = (group: RecurringInvoiceParentGroup): boolean => {
    if (selectedTargets.has(group.parentSummary.parentSelectionKey)) {
      return true;
    }

    const selectableChildren = group.childExecutionRows.filter((member) => member.canGenerate);
    if (selectableChildren.length === 0) {
      return false;
    }

    return selectableChildren.every((member) => selectedTargets.has(childSelectionKeyForMember(member)));
  };
  const allGroupsFullySelected = readyParentGroups.length > 0 && readyParentGroups.every((group) => isGroupFullySelected(group));
  const hasAnyGroupSelection = readyParentGroups.some((group) => {
    if (selectedTargets.has(group.parentSummary.parentSelectionKey)) {
      return true;
    }

    return group.childExecutionRows.some((member) => selectedTargets.has(childSelectionKeyForMember(member)));
  });

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

  const handleSelectAll = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.checked) {
      const nextSelections = new Set<string>();
      for (const group of readyParentGroups) {
        const selectableChildren = group.childExecutionRows.filter((member) => member.canGenerate);
        if (selectableChildren.length === 0) {
          continue;
        }

        if (group.parentSummary.canGenerate && group.parentSummary.isCombinable) {
          nextSelections.add(group.parentSummary.parentSelectionKey);
          continue;
        }

        for (const child of selectableChildren) {
          nextSelections.add(childSelectionKeyForMember(child));
        }
      }
      setSelectedTargets(nextSelections);
    } else {
      setSelectedTargets(new Set());
    }
  };

  const handleSelectParentGroup = (
    group: RecurringInvoiceParentGroup,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const parentSelectionKey = group.parentSummary.parentSelectionKey;
    if (!parentSelectionKey) return;

    const newSelected = new Set(selectedTargets);
    for (const child of group.childExecutionRows) {
      newSelected.delete(childSelectionKeyForMember(child));
    }

    if (event.target.checked) {
      newSelected.add(parentSelectionKey);
    } else {
      newSelected.delete(parentSelectionKey);
    }
    setSelectedTargets(newSelected);
  };

  const handleSelectChild = (
    group: RecurringInvoiceParentGroup,
    child: RecurringInvoiceParentGroup['childExecutionRows'][number],
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const childSelectionKey = childSelectionKeyForMember(child);
    const nextSelected = new Set(selectedTargets);
    nextSelected.delete(group.parentSummary.parentSelectionKey);

    if (event.target.checked) {
      nextSelected.add(childSelectionKey);
    } else {
      nextSelected.delete(childSelectionKey);
    }

    setSelectedTargets(nextSelected);
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

  const buildRecurringRunTargetFromSelection = (selection: {
    selectorInput: IRecurringDueSelectionInput;
    billingCycleId?: string | null;
  }) => {
    return {
      selectorInput: selection.selectorInput,
      executionWindow: selection.selectorInput.executionWindow,
      billingCycleId: selection.billingCycleId ?? null,
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

  const handlePreviewSelection = async (groups: RecurringSelectionGroup[]) => {
    if (groups.length === 0) {
      return;
    }

    const primarySelection = groups[0]?.selectorInputs[0] ?? null;
    setIsPreviewLoading(true);
    setErrors({}); // Clear previous errors
    const response = await previewGroupedInvoicesForSelectionInputs(
      groups.map((group) => ({
        previewGroupKey: group.groupKey,
        selectorInputs: group.selectorInputs,
      })),
    );
    if (response.success) {
      setPreviewState({
        previews: response.previews,
        invoiceCount: response.invoiceCount,
        billingCycleId: groups.length === 1 ? groups[0]?.billingCycleId ?? null : null,
        executionIdentityKey: primarySelection?.executionWindow.identityKey ?? null,
        selectorInput: response.previews.length === 1 && response.previews[0].selectorInputs.length === 1
          ? response.previews[0].selectorInputs[0]
          : null,
      });
      setShowPreviewDialog(true);
    } else {
      setPreviewState({
        previews: [],
        invoiceCount: 0,
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
    const selectedExecutionPeriods = selectedExecutionRows.filter((period) => period.canGenerate);
    if (selectedExecutionPeriods.length === 0) {
      return;
    }

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

      const runResult = await generateGroupedInvoicesAsRecurringBillingRun({
        groupedTargets: selectedSelectionGroups.map((group) => ({
          groupKey: group.groupKey,
          selectorInputs: group.selectorInputs,
          billingCycleId: group.billingCycleId,
        })),
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

      setSelectedTargets(new Set());
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

      const runResult = await generateGroupedInvoicesAsRecurringBillingRun({
        groupedTargets: toGenerate.map((period) => ({
          groupKey: `child-selection:${period.executionIdentityKey}`,
          selectorInputs: [period.selectorInput],
          billingCycleId: period.billingCycleId ?? null,
        })),
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

      setSelectedTargets(new Set());
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
            billingCycleId: previewState.billingCycleId,
          }),
        ],
      });
      if (runResult.failures.length > 0) {
        throw new Error(runResult.failures[0]?.errorMessage || 'Failed to generate invoice from preview');
      }
      setShowPreviewDialog(false); // Close dialog on success
      setPreviewState({
        previews: [],
        invoiceCount: 0,
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
            billingCycleId: poOverageSingleConfirm.billingCycleId,
          }),
        ],
        allowPoOverage: true,
      });
      if (runResult.failures.length > 0) {
        throw new Error(runResult.failures[0]?.errorMessage || 'Failed to generate invoice from preview');
      }
      setShowPreviewDialog(false);
      setPreviewState({
        previews: [],
        invoiceCount: 0,
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
          {needsApprovalParentGroups.length > 0 ? (
            <div className="mb-6 rounded-md border border-warning/40 bg-warning/5 p-4" data-testid="needs-approval-section">
              <h2 className="text-lg font-semibold">Needs Approval</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These recurring windows contain billable time that is not approved yet. The entire invoice window is blocked until approvals are complete.
              </p>
              <div className="mt-4 space-y-3">
                {needsApprovalParentGroups.map((group) => {
                  const blockedEntryCount = group.candidate.approvalBlockedEntryCount ?? 0;
                  const blockedEntryLabel = blockedEntryCount === 1 ? 'entry' : 'entries';
                  return (
                    <div
                      key={`needs-approval-${group.parentSummary.candidateKey}`}
                      className="rounded-md border border-warning/30 bg-background/90 p-3"
                      data-testid={`needs-approval-row-${group.parentSummary.candidateKey}`}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1 text-sm">
                          <div className="font-medium">{group.parentSummary.clientName ?? 'Unknown client'}</div>
                          <div>Service period: {group.parentSummary.servicePeriodLabel}</div>
                          <div>Invoice window: {group.parentSummary.windowLabel}</div>
                          <div className="text-warning">
                            {blockedEntryCount} unapproved {blockedEntryLabel}
                          </div>
                        </div>
                        <a
                          href={buildReviewApprovalsHref({
                            clientId: group.candidate.clientId,
                            windowStart: group.candidate.windowStart,
                            windowEnd: group.candidate.windowEnd,
                          })}
                          className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                        >
                          Review Approvals
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-semibold">Ready to Invoice</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Each parent row groups due obligations by client and invoice window. Child obligations remain the atomic execution units.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Select All chooses parent rows when a group is combinable and falls back to individual child rows when a group is not combinable.
              </p>
            </div>
            <div className="flex gap-2 items-end">
              <Button
                id='preview-selected-button'
                variant="outline"
                onClick={() => {
                  if (selectedSelectionGroups.length > 0) {
                    handlePreviewSelection(selectedSelectionGroups);
                  }
                }}
                disabled={
                  selectedSelectionGroups.length === 0
                  || isPreviewLoading
                }
              >
                <Eye className="h-4 w-4 mr-2" />
                {isPreviewLoading ? 'Loading...' : 'Preview Selected'}
              </Button>
              {!previewSupportsDirectGeneration && selectedSelectionGroups.length > 0 ? (
                <span className="text-xs text-muted-foreground" data-testid="grouped-preview-unavailable-copy">
                  Preview supports grouped selections; direct "Generate from preview" remains single-selection only.
                </span>
              ) : null}
              <Button
                id='generate-invoices-button'
                onClick={handleGenerateInvoices}
                disabled={selectedExecutionRows.length === 0 || isGenerating}
                className={selectedExecutionRows.length === 0 ? 'opacity-50' : ''}
              >
                {isGenerating ? 'Generating...' : `Generate Invoices for Selected Periods (${selectedExecutionRows.length})`}
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
            data={readyParentGroups}
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
                  <div className="flex justify-center">
                    <Checkbox
                      id="select-all"
                      checked={allGroupsFullySelected}
                      indeterminate={!allGroupsFullySelected && hasAnyGroupSelection}
                      onChange={handleSelectAll}
                      disabled={readyParentGroups.length === 0}
                    />
                  </div>
                ),
                dataIndex: 'candidateKey',
                width: '6rem',
                headerClassName: 'px-2 text-center',
                cellClassName: 'px-2 text-center',
                render: (_: unknown, record: RecurringInvoiceParentGroup) => {
                  const isParentSelected = selectedTargets.has(record.parentSummary.parentSelectionKey);
                  const selectedChildrenCount = record.childExecutionRows.filter((member) =>
                    selectedTargets.has(childSelectionKeyForMember(member)),
                  ).length;
                  const isPartiallySelected = !isParentSelected && selectedChildrenCount > 0;
                  return (
                    <div className="flex justify-center">
                      <Checkbox
                        id={`select-${record.parentSummary.parentGroupKey}`}
                        checked={isParentSelected}
                        indeterminate={isPartiallySelected}
                        disabled={!record.parentSummary.canGenerate || !record.parentSummary.isCombinable}
                        // Stop propagation to prevent row click when clicking checkbox
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                          event.stopPropagation();
                          handleSelectParentGroup(record, event);
                        }}
                        onClick={(e) => e.stopPropagation()} // Also stop propagation on click
                      />
                    </div>
                  );
                }
              },
	              {
	                title: 'Group',
	                dataIndex: 'parentGroupKey',
	                render: (_: unknown, record: RecurringInvoiceParentGroup) => {
	                  const isExpanded = expandedParentGroups.has(record.parentSummary.parentGroupKey);
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
                      return member.attribution?.isComplete === false;
                    }).length;
                    const assignmentContexts = Array.from(
                      new Set(
                        record.childExecutionRows
                          .map((member) => getRecurringAssignmentContext(member))
                          .filter((value): value is string => Boolean(value)),
                      ),
                    );
                    const attributionSummaryLabels = record.candidate.attributionSummary?.labels ?? [];
                    const assignmentLabels = Array.from(new Set([...attributionSummaryLabels, ...assignmentContexts]));
	                    const cadenceSummary = summarizeCadenceSources(record.candidate.cadenceSources);
                      const shouldShowAssignmentContexts =
                        !isExpanded
                        && contractNames.length === 0
                        && contractLineNames.length === 0
                        && assignmentLabels.length > 0;
	                  return (
                      <div className="min-w-[16rem] space-y-2">
                        <div className="flex items-start gap-2">
                          <Button
                            id={`toggle-group-${record.parentSummary.parentGroupKey}`}
                            variant="ghost"
                            size="sm"
                            className="mt-0.5 h-8 w-8 shrink-0 p-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleParentGroupExpansion(record.parentSummary.parentGroupKey);
                            }}
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                          <div className="min-w-0 space-y-1">
                            <div className="font-medium">{record.parentSummary.clientName ?? 'Unknown client'}</div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{record.parentSummary.childCount} item{record.parentSummary.childCount === 1 ? '' : 's'}</span>
                              {contractNames.length > 0 ? (
                                <span title={contractNames.join(', ')}>
                                  {contractNames.length} contract{contractNames.length === 1 ? '' : 's'}
                                </span>
                              ) : null}
                              {contractLineNames.length > 0 ? (
                                <span title={contractLineNames.join(', ')}>
                                  {contractLineNames.length} line{contractLineNames.length === 1 ? '' : 's'}
                                </span>
                              ) : null}
                              <span>{cadenceSummary}</span>
                              {record.childExecutionRows.some((member) => !member.billingCycleId) ? (
                                <span>Service-period-backed</span>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2 text-xs">
                              <span
                                className={`inline-flex rounded-full border px-2 py-0.5 font-medium ${getParentGroupSummary({
                                  isCombinable: record.parentSummary.isCombinable,
                                  canGenerate: record.parentSummary.canGenerate,
                                  incompatibilityReasons: record.parentSummary.incompatibilityReasons,
                                  childCount: record.parentSummary.childCount,
                                }).className}`}
                              >
                                {record.parentSummary.combinabilitySummary}
                              </span>
                            </div>
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
                            {shouldShowAssignmentContexts ? assignmentLabels.map((contextValue) => (
                              <div
                                key={`${record.parentSummary.candidateKey}:assignment:${contextValue}`}
                                className="text-xs text-muted-foreground"
                                data-testid={`contract-assignment-context-${record.parentSummary.candidateKey}`}
                              >
                                {contextValue}
                              </div>
                            )) : null}
                            {contractMetadataMissingCount > 0 ? (
                              <div
                                className="text-xs text-warning"
                                data-testid={`contract-metadata-warning-${record.parentSummary.candidateKey}`}
                              >
                                Assignment attribution metadata missing ({contractMetadataMissingCount} obligation{contractMetadataMissingCount === 1 ? '' : 's'})
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
	                  );
	                },
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
	                    {record.parentSummary.aggregateAmountCents !== null ? (
	                      <div
	                        className="text-sm font-medium"
	                        data-testid={`group-amount-${record.parentSummary.parentGroupKey}`}
	                      >
	                        {formatCurrency(record.parentSummary.aggregateAmountCents / 100)}
	                      </div>
	                    ) : null}
	                  </div>
	                ),
	              },
	              {
	                title: 'Invoice Window',
	                dataIndex: 'windowLabel',
	                render: (_: unknown, record: RecurringInvoiceParentGroup) => (
                    <div className="space-y-1">
                      <div>{record.parentSummary.windowLabel}</div>
                      <div className="text-xs text-muted-foreground">
                        {record.parentSummary.isCombinable ? '1 invoice if parent selected' : 'Select items individually'}
                      </div>
                    </div>
                  ),
	              },
	              {
	                title: 'Included',
	                dataIndex: 'childExecutionRows',
	                render: (_: unknown, record: RecurringInvoiceParentGroup) => {
	                  const isExpanded = expandedParentGroups.has(record.parentSummary.parentGroupKey);
	                  if (!isExpanded) {
	                    return (
	                      <div className="text-xs text-muted-foreground">
	                        {record.parentSummary.childCount} item{record.parentSummary.childCount === 1 ? '' : 's'} included
	                      </div>
	                    );
	                  }

	                  return (
	                    <div className="min-w-[20rem] space-y-2">
	                      {record.childExecutionRows.map((member) => {
		                        const assignmentContext = getRecurringAssignmentContext(member);
	                          const nonContractSelection = parseNonContractSelectionFromScheduleKey(member.scheduleKey ?? null);
		                        const cadenceSource = formatCadenceSourceBadge(member.cadenceSource).label;
		                        const billingTiming = member.duePosition === 'advance' ? 'Advance' : 'Arrears';
		                        const amountCents = (member as { amountCents?: number | null }).amountCents;
	                        const isChildSelected = selectedTargets.has(childSelectionKeyForMember(member));
                          const childTitle =
                            member.contractName?.trim()
                            || assignmentContext
                            || member.contractLineName?.trim()
                            || member.executionIdentityKey;

	                        return (
	                          <div
	                            key={`${record.parentSummary.parentGroupKey}:${member.executionIdentityKey}`}
	                            className="rounded-md border border-border/60 bg-background p-3"
	                            data-testid={`child-row-${record.parentSummary.parentGroupKey}-${member.executionIdentityKey}`}
	                          >
	                            <div className="flex items-start gap-3">
	                              <Checkbox
	                                id={`select-child-${record.parentSummary.parentGroupKey}-${member.executionIdentityKey}`}
	                                checked={isChildSelected}
	                                disabled={!member.canGenerate}
                                  className="mt-0.5"
	                                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
	                                  event.stopPropagation();
	                                  handleSelectChild(record, member, event);
	                                }}
	                              />
                                <div className="min-w-0 flex-1 space-y-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="font-medium">{childTitle}</div>
                                      {member.contractLineName?.trim() && member.contractLineName?.trim() !== childTitle ? (
                                        <div className="text-sm text-muted-foreground">{member.contractLineName.trim()}</div>
                                      ) : null}
                                      {nonContractSelection ? (
                                        <div className="text-xs text-muted-foreground" data-testid={`non-contract-child-${member.executionIdentityKey}`}>
                                          Unresolved work
                                        </div>
                                      ) : null}
                                      {member.attribution?.isComplete === false ? (
                                        <div className="text-xs text-warning" data-testid={`child-attribution-warning-${member.executionIdentityKey}`}>
                                          Assignment attribution metadata missing
                                        </div>
                                      ) : null}
                                    </div>
                                    <div className="shrink-0 text-sm font-medium">
                                      {typeof amountCents === 'number' ? formatCurrency(amountCents / 100) : 'Pending amount'}
                                    </div>
                                  </div>
                                  <div className="text-xs text-muted-foreground">Cadence: {cadenceSource}</div>
                                  <div className="text-xs text-muted-foreground">Billing timing: {billingTiming}</div>
                                  <div className="text-xs text-muted-foreground">Service period: {member.servicePeriodLabel}</div>
                                  {!member.canGenerate && (member as { blockedReason?: string | null }).blockedReason ? (
                                    <div className="text-xs text-muted-foreground">
                                      {(member as { blockedReason?: string | null }).blockedReason}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
	                          </div>
	                        );
	                      })}
	                    </div>
	                  );
	                },
	              },
	            ]}
            pagination={true}
            currentPage={currentReadyPage}
            onPageChange={handleReadyPageChange}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
            totalItems={normalizedReadyClientFilter.length > 0 ? filteredPeriods.length : totalPeriods}
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
                title: 'Assignment Scope',
                dataIndex: 'assignmentSummary',
                render: (_: unknown, record: InvoicedPeriod) => (
                  <div className="space-y-1">
                    <div>{record.assignmentSummary}</div>
                    {record.isMultiAssignment ? (
                      <Badge variant="secondary">Multi-contract invoice</Badge>
                    ) : null}
                  </div>
                ),
              },
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
            previews: [],
            invoiceCount: 0,
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
          ) : previewState.previews.length > 0 && (
            <div className="space-y-4">
              <div className="rounded border border-border/70 bg-muted/10 px-3 py-2 text-sm" data-testid="preview-invoice-count-summary">
                {previewState.invoiceCount === 1
                  ? 'This selection will generate one combined invoice.'
                  : `This selection will generate ${previewState.invoiceCount} separate invoices.`}
              </div>
              {previewState.previews.map((previewEntry, previewIndex) => (
                <div key={previewEntry.previewGroupKey} className="space-y-4 rounded border border-border/70 p-3" data-testid={`preview-group-${previewEntry.previewGroupKey}`}>
                  <h3 className="font-semibold">Invoice {previewIndex + 1}</h3>
                  <div className="border-b pb-4">
                    <h4 className="font-semibold">Client Details</h4>
                    <p>{previewEntry.data.customer?.name}</p>
                    <p>{previewEntry.data.customer?.address}</p>
                  </div>
                  <div className="border-b pb-4">
                    <h4 className="font-semibold">Invoice Details</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">Invoice Number</p>
                        <p>{previewEntry.data.invoiceNumber}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Date</p>
                        <p>{toPlainDate(previewEntry.data.issueDate).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">Due Date</p>
                        <p>{toPlainDate(previewEntry.data.dueDate).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">Line Items</h4>
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
                        {previewEntry.data.items.map((item) => {
                          const isContractHeader = item.description?.startsWith('Contract:');
                          const isDetailLine = !isContractHeader && item.quantity === undefined && item.unitPrice === undefined;

                          if (isContractHeader) {
                            return (
                              <tr key={item.id} className="border-b bg-muted/50 font-semibold">
                                <td className="py-2 px-2" colSpan={4}>{item.description}</td>
                              </tr>
                            );
                          }
                          if (isDetailLine) {
                            return (
                              <tr key={item.id} className="border-b">
                                <td className="py-2 px-2">{item.description}</td>
                                <td className="text-right py-2 px-2"></td>
                                <td className="text-right py-2 px-2"></td>
                                <td className="text-right py-2 px-2">{formatCurrency(item.total / 100)}</td>
                              </tr>
                            );
                          }
                          return (
                            <tr key={item.id} className="border-b">
                              <td className="py-2 px-2">{item.description}</td>
                              <td className="text-right py-2 px-2">{item.quantity}</td>
                              <td className="text-right py-2 px-2">{formatCurrency(item.unitPrice / 100)}</td>
                              <td className="text-right py-2 px-2">{formatCurrency(item.total / 100)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3} className="text-right py-2 font-semibold">Subtotal</td>
                          <td className="text-right py-2">{formatCurrency(previewEntry.data.subtotal / 100)}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="text-right py-2 font-semibold">Tax</td>
                          <td className="text-right py-2">{formatCurrency(previewEntry.data.tax / 100)}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="text-right py-2 font-semibold">Total</td>
                          <td className="text-right py-2">{formatCurrency(previewEntry.data.total / 100)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              ))}
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
                previews: [],
                invoiceCount: 0,
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
              || previewState.previews.length === 0
              || !previewState.selectorInput
              || isGeneratingFromPreview
              || isPreviewLoading
              || !previewSupportsDirectGeneration
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
