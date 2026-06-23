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
import { AlertTriangle, X, MoreVertical, Eye, ChevronRight, ChevronDown, Check, Link2, Clock, Hourglass, Wrench, FileText } from 'lucide-react';
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
import { repairAllRecurringServicePeriodsForTenant } from '@alga-psa/billing/actions/recurringServicePeriodActions';
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
import { Dialog, DialogContent, DialogDescription } from '@alga-psa/ui/components/Dialog';
import { formatCurrency } from '@alga-psa/core';
import { useFormatters, useTranslation } from '@alga-psa/ui/lib/i18n/client';
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
import Drawer from '@alga-psa/ui/components/Drawer';
import { useRangeSelection } from '@alga-psa/ui/hooks';

interface AutomaticInvoicesProps {
  onGenerateSuccess: () => void;
  refreshTrigger?: number;
}

type AutomaticInvoiceGroupLabelKey = 'ready' | 'canCombine' | 'separate' | 'blocked' | 'notReady' | 'upcoming';
type AutomaticInvoiceIncompatibilityReasonKey =
  | 'invoiceWindowDiffers'
  | 'clientDiffers'
  | 'poScopeDiffers'
  | 'currencyDiffers'
  | 'taxTreatmentDiffers'
  | 'exportShapeDiffers';

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
    combinabilitySummaryKey: AutomaticInvoiceGroupLabelKey;
    incompatibilityReasons: AutomaticInvoiceIncompatibilityReasonKey[];
    canGenerate: boolean;
    blockedReason: string | null;
    notYetDue: boolean;
    availableOnDate: string | null;
  };
  childExecutionRows: ReadyPeriod['members'];
  candidate: ReadyPeriod;
}

type RecurringSelectionGroup = {
  groupKey: string;
  selectorInputs: IRecurringDueSelectionInput[];
  billingCycleId: string | null;
};

const AUTOMATIC_INVOICE_GROUP_LABELS: Record<AutomaticInvoiceGroupLabelKey, string> = {
  ready: 'Ready to invoice',
  canCombine: 'Can combine into 1 invoice',
  separate: 'Must invoice separately',
  blocked: 'Contains blocked items',
  notReady: 'Not ready to invoice',
  upcoming: 'Not yet due',
};

const getParentGroupSummary = ({
  isCombinable,
  canGenerate,
  notYetDue,
  incompatibilityReasons,
  childCount,
}: {
  isCombinable: boolean;
  canGenerate: boolean;
  notYetDue: boolean;
  incompatibilityReasons: AutomaticInvoiceIncompatibilityReasonKey[];
  childCount: number;
}): {
  labelKey: AutomaticInvoiceGroupLabelKey;
  className: string;
} => {
  if (isCombinable) {
    return {
      labelKey: childCount > 1 ? 'canCombine' : 'ready',
      className: 'border-border/70 text-foreground',
    };
  }

  // A period that simply hasn't reached its invoice window yet is "upcoming",
  // not blocked — keep it visually neutral so it doesn't read like an error.
  if (notYetDue) {
    return {
      labelKey: 'upcoming',
      className: 'border-border/60 text-muted-foreground',
    };
  }

  if (incompatibilityReasons.length > 0) {
    return {
      labelKey: 'separate',
      className: 'border-warning/40 text-warning',
    };
  }

  if (!canGenerate) {
    return {
      labelKey: childCount > 1 ? 'blocked' : 'notReady',
      className: 'border-border/60 text-muted-foreground',
    };
  }

  return {
    labelKey: 'separate',
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
    const notYetDue = candidate.notYetDue === true;
    const parentGroupSummary = getParentGroupSummary({
      isCombinable,
      canGenerate: candidate.canGenerate,
      notYetDue,
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
      combinabilitySummaryKey: parentGroupSummary.labelKey,
      incompatibilityReasons,
      canGenerate: candidate.canGenerate,
      blockedReason: candidate.blockedReason ?? null,
      notYetDue,
      availableOnDate: candidate.availableOnDate ?? null,
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
): {
  label: string;
  labelKey?: string;
  labelValues?: Record<string, string>;
  variant: 'outline' | 'secondary';
} => {
  switch (cadenceSource) {
    case 'contract_anniversary':
      return {
        label: 'Contract anniversary',
        labelKey: 'automaticInvoices.history.badges.contractAnniversary',
        variant: 'outline',
      };
    case 'client_schedule':
      return {
        label: 'Client schedule',
        labelKey: 'automaticInvoices.history.badges.clientSchedule',
        variant: 'outline',
      };
    default:
      const source = cadenceSource?.trim() ? cadenceSource : 'missing';
      return {
        label: `Unknown cadence source (${source})`,
        labelKey: 'automaticInvoices.history.badges.unknownCadenceSource',
        labelValues: { source },
        variant: 'secondary',
      };
  }
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

const AUTOMATIC_INVOICE_INCOMPATIBILITY_LABELS: Record<AutomaticInvoiceIncompatibilityReasonKey, string> = {
  invoiceWindowDiffers: 'Invoice window differs',
  clientDiffers: 'Client differs',
  poScopeDiffers: 'PO scope differs',
  currencyDiffers: 'Currency differs',
  taxTreatmentDiffers: 'Tax treatment differs',
  exportShapeDiffers: 'Export shape differs',
};

const resolveIncompatibilityReasons = (candidate: ReadyPeriod): AutomaticInvoiceIncompatibilityReasonKey[] => {
  const eligibleMembers = candidate.members.filter((member) => member.canGenerate);
  const members = eligibleMembers.length > 0 ? eligibleMembers : candidate.members;
  if (members.length <= 1) {
    return [];
  }

  const reasons: AutomaticInvoiceIncompatibilityReasonKey[] = [];
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
    reasons.push('invoiceWindowDiffers');
  }
  if (uniqueClients.size > 1) {
    reasons.push('clientDiffers');
  }
  if (uniquePoScopes.size > 1) {
    reasons.push('poScopeDiffers');
  }
  if (uniqueCurrencies.size > 1) {
    reasons.push('currencyDiffers');
  }
  if (uniqueTaxSources.size > 1) {
    reasons.push('taxTreatmentDiffers');
  }
  if (uniqueExportShapes.size > 1) {
    reasons.push('exportShapeDiffers');
  }

  return reasons;
};

// --- Pro-grid presentation helpers --------------------------------------------
// Each obligation is tagged by how its amount is determined. Colors come from the
// brand palette (primary = purple, secondary = cyan, accent = orange) plus the
// semantic warning token; the family also tells the user whether the dollar
// figure is known up front (Fixed) or only finalized at generation.
type RecurringChargeTypeKey = 'Fixed' | 'Hourly' | 'Usage' | 'Bucket';

const CHARGE_TAG_META: Record<RecurringChargeTypeKey, {
  labelKey: string;
  default: string;
  className: string;
  /** Fixed lines have a known amount before generation; the rest are computed at run time. */
  knownUpFront: boolean;
}> = {
  Fixed: {
    labelKey: 'automaticInvoices.chargeTags.fixed',
    default: 'FIX',
    className: 'border-primary-200 bg-primary-50 text-primary-700',
    knownUpFront: true,
  },
  Hourly: {
    labelKey: 'automaticInvoices.chargeTags.hourly',
    default: 'T&M',
    className: 'border-accent-200 bg-accent-50 text-accent-700',
    knownUpFront: false,
  },
  Usage: {
    labelKey: 'automaticInvoices.chargeTags.usage',
    default: 'USE',
    className: 'border-secondary-200 bg-secondary-50 text-secondary-700',
    knownUpFront: false,
  },
  Bucket: {
    labelKey: 'automaticInvoices.chargeTags.bucket',
    default: 'BKT',
    className: 'border-warning/40 bg-warning/10 text-warning',
    knownUpFront: false,
  },
};

// Full names for the charge-tag tooltips (terse codes show in the column).
const CHARGE_TAG_FULL_NAME: Record<RecurringChargeTypeKey, string> = {
  Fixed: 'Fixed fee',
  Hourly: 'Time & materials',
  Usage: 'Usage-based',
  Bucket: 'Bucket / retainer',
};

const isRecurringChargeTypeKey = (value: unknown): value is RecurringChargeTypeKey =>
  value === 'Fixed' || value === 'Hourly' || value === 'Usage' || value === 'Bucket';

// Status of a parent group, derived from its combinability summary plus the
// not-yet-due / blocked flags. Drives the colored pill in the Status column.
type AutomaticInvoiceStatusKey = 'ready' | 'combine' | 'separate' | 'notYetDue' | 'approval' | 'blocked';

const STATUS_PILL_META: Record<AutomaticInvoiceStatusKey, {
  labelKey: string;
  default: string;
  className: string;
}> = {
  ready: {
    labelKey: 'automaticInvoices.status.ready',
    default: 'Ready',
    className: 'border-success/30 bg-success/10 text-success',
  },
  combine: {
    labelKey: 'automaticInvoices.status.combine',
    default: 'Combine',
    className: 'border-primary-200 bg-primary-50 text-primary-700',
  },
  separate: {
    labelKey: 'automaticInvoices.status.separate',
    default: 'Separate',
    className: 'border-warning/40 bg-warning/10 text-warning',
  },
  notYetDue: {
    labelKey: 'automaticInvoices.status.notYetDue',
    default: 'Not yet due',
    className: 'border-border bg-muted text-muted-foreground',
  },
  approval: {
    labelKey: 'automaticInvoices.status.approval',
    default: 'Approval',
    className: 'border-accent-200 bg-accent-50 text-accent-700',
  },
  blocked: {
    labelKey: 'automaticInvoices.status.blocked',
    default: 'Blocked',
    className: 'border-border bg-muted text-muted-foreground',
  },
};

const resolveStatusKey = (summary: {
  isCombinable: boolean;
  canGenerate: boolean;
  notYetDue: boolean;
  combinabilitySummaryKey: AutomaticInvoiceGroupLabelKey;
  approvalBlockedEntryCount: number;
}): AutomaticInvoiceStatusKey => {
  if (summary.approvalBlockedEntryCount > 0) {
    return 'approval';
  }
  if (summary.notYetDue) {
    return 'notYetDue';
  }
  switch (summary.combinabilitySummaryKey) {
    case 'ready':
      return 'ready';
    case 'canCombine':
      return 'combine';
    case 'separate':
      return 'separate';
    case 'blocked':
    case 'notReady':
    default:
      return summary.isCombinable ? 'ready' : 'blocked';
  }
};

// Saved views shown as the segmented control above the grid. Each is a pure
// predicate over the already-loaded page of candidates, so counts and filtering
// stay honest about what is on screen (server pagination still applies).
type AutomaticInvoiceViewKey = 'all' | 'ready' | 'combinable' | 'attention' | 'notYetDue';

const matchesAutomaticInvoiceView = (
  view: AutomaticInvoiceViewKey,
  summary: RecurringInvoiceParentGroup['parentSummary'],
): boolean => {
  switch (view) {
    case 'all':
      return true;
    case 'ready':
      return summary.isCombinable && summary.canGenerate;
    case 'combinable':
      return summary.isCombinable && summary.childCount > 1;
    case 'attention':
      // "Needs attention" = a problem that needs action (not combinable / can't
      // generate), excluding the benign not-yet-due state. Approval-blocked work
      // is surfaced in its own panel and is filtered out of readyParentGroups.
      return !summary.notYetDue && (!summary.canGenerate || summary.incompatibilityReasons.length > 0);
    case 'notYetDue':
      return summary.notYetDue;
    default:
      return true;
  }
};

const AutomaticInvoices: React.FC<AutomaticInvoicesProps> = ({ onGenerateSuccess, refreshTrigger = 0 }) => {
  const { t } = useTranslation('msp/invoicing');
  const { formatDate } = useFormatters();
  const router = useRouter();
  const translateAssignmentContext = (contextValue: string | null): string | null => {
    if (!contextValue) {
      return null;
    }

    switch (contextValue) {
      case 'Unresolved time entry':
        return t('automaticInvoices.executionRows.assignmentContext.unresolvedTimeEntry', {
          defaultValue: 'Unresolved time entry',
        });
      case 'Unresolved usage record':
        return t('automaticInvoices.executionRows.assignmentContext.unresolvedUsageRecord', {
          defaultValue: 'Unresolved usage record',
        });
      case 'Assigned contract line':
        return t('automaticInvoices.executionRows.assignmentContext.assignedContractLine', {
          defaultValue: 'Assigned contract line',
        });
      case 'Assigned work item':
        return t('automaticInvoices.executionRows.assignmentContext.assignedWorkItem', {
          defaultValue: 'Assigned work item',
        });
      case 'Unresolved work':
        return t('automaticInvoices.executionRows.assignmentContext.unresolvedWork', {
          defaultValue: 'Unresolved work',
        });
      default:
        return contextValue;
    }
  };
  const formatBlockedReason = (reason: string | null | undefined): string | null => {
    if (!reason) {
      return null;
    }

    const approvalBlockMatch = reason.match(/^Blocked until approval:\s+(\d+)\s+unapproved\s+(entry|entries)\.$/i);
    if (approvalBlockMatch?.[1]) {
      return t('automaticInvoices.executionRows.blockedUntilApproval', {
        count: Number(approvalBlockMatch[1]),
        defaultValue: reason,
      });
    }

    return reason;
  };
  const formatCadenceSourceText = (cadenceSource: string | null | undefined): string => {
    const badge = formatCadenceSourceBadge(cadenceSource);
    return badge.labelKey
      ? t(badge.labelKey, {
        ...badge.labelValues,
        defaultValue: badge.label,
      })
      : badge.label;
  };
  const formatPoLabel = (poNumber: string | null | undefined): string =>
    poNumber
      ? t('automaticInvoices.dialogs.poOverage.poNumber', {
        number: poNumber,
        defaultValue: `PO ${poNumber}`,
      })
      : t('purchaseOrder.labels.short', { defaultValue: 'PO' });
  // Drawer removed: client details quick view no longer used here
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [expandedParentGroups, setExpandedParentGroups] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<AutomaticInvoiceViewKey>('all');
  const [focusedGroupKey, setFocusedGroupKey] = useState<string | null>(null);
  const [chargeFilter, setChargeFilter] = useState<RecurringChargeTypeKey | ''>('');
  const [currencyFilter, setCurrencyFilter] = useState<string>('');
  const [windowOpenOnly, setWindowOpenOnly] = useState<boolean>(false);
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
  const [isRepairingAll, setIsRepairingAll] = useState(false);
  const [repairAllMessage, setRepairAllMessage] = useState<string | null>(null);
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [selectedCycleToReverse, setSelectedCycleToReverse] = useState<{
    invoiceId: string;
    billingCycleId: string | null;
    hasBillingCycleBridge: boolean;
    client: string;
    servicePeriodLabel: string;
    cadenceSource: string | null | undefined;
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
    cadenceSource: string | null | undefined;
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
          setLoadError(t('automaticInvoices.errors.loadReady', {
            defaultValue: 'Failed to load billing periods. Please try again.',
          }));
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

  // Rebuild every drifted client-cadence schedule in the tenant in one pass, so
  // the user does not have to repair each one by hand. Refreshes on success so
  // the gap panel reflects the healed state.
  const handleFixAllServicePeriods = async () => {
    setIsRepairingAll(true);
    setRepairAllMessage(null);
    try {
      const result = await repairAllRecurringServicePeriodsForTenant();
      if (!result || !('schedulesRepaired' in result)) {
        setRepairAllMessage(t('automaticInvoices.materializationGap.fixAllDenied', {
          defaultValue: 'You do not have permission to rebuild service periods.',
        }));
        return;
      }
      setRepairAllMessage(t('automaticInvoices.materializationGap.fixAllResult', {
        schedules: result.schedulesRepaired,
        clients: result.clientsRepaired,
        defaultValue: 'Rebuilt {{schedules}} schedule(s) across {{clients}} client(s).',
      }));
      onGenerateSuccess?.();
    } catch (error) {
      console.error('Error rebuilding recurring service periods:', error);
      setRepairAllMessage(t('automaticInvoices.materializationGap.fixAllError', {
        defaultValue: 'Could not rebuild service periods. Please try again.',
      }));
    } finally {
      setIsRepairingAll(false);
    }
  };

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
  const selectableParentGroups = readyParentGroups.filter(
    (group) => group.parentSummary.canGenerate && group.parentSummary.isCombinable,
  );
  const selectedParentTargetSet = new Set(
    selectableParentGroups
      .filter((group) => selectedTargets.has(group.parentSummary.parentSelectionKey))
      .map((group) => group.parentSummary.parentSelectionKey),
  );
  const parentGroupRangeSelect = useRangeSelection<RecurringInvoiceParentGroup>({
    items: selectableParentGroups,
    getId: (group) => group.parentSummary.parentSelectionKey,
    selectedIds: selectedParentTargetSet,
    onSelectedIdsChange: (nextParentKeys) => {
      const changedParentKeys = new Set<string>();
      for (const key of selectedParentTargetSet) {
        if (!nextParentKeys.has(key)) changedParentKeys.add(key);
      }
      for (const key of nextParentKeys) {
        if (!selectedParentTargetSet.has(key)) changedParentKeys.add(key);
      }

      setSelectedTargets((previous) => {
        const next = new Set(previous);
        for (const group of selectableParentGroups) {
          const parentSelectionKey = group.parentSummary.parentSelectionKey;
          if (!changedParentKeys.has(parentSelectionKey)) {
            continue;
          }

          for (const child of group.childExecutionRows) {
            next.delete(childSelectionKeyForMember(child));
          }

          if (nextParentKeys.has(parentSelectionKey)) {
            next.add(parentSelectionKey);
          } else {
            next.delete(parentSelectionKey);
          }
        }
        return next;
      });
    },
  });

  // --- Pro-grid view model -----------------------------------------------------
  type AutomaticInvoiceDisplayRow =
    | { kind: 'group'; rowId: string; group: RecurringInvoiceParentGroup }
    | {
        kind: 'member';
        rowId: string;
        group: RecurringInvoiceParentGroup;
        member: RecurringInvoiceParentGroup['childExecutionRows'][number];
      };

  // View counts reflect the candidates on the loaded page (server pagination still
  // governs how many candidates are fetched at a time).
  const viewCounts: Record<AutomaticInvoiceViewKey, number> = {
    all: readyParentGroups.length,
    ready: 0,
    combinable: 0,
    attention: 0,
    notYetDue: 0,
  };
  for (const group of readyParentGroups) {
    if (matchesAutomaticInvoiceView('ready', group.parentSummary)) viewCounts.ready += 1;
    if (matchesAutomaticInvoiceView('combinable', group.parentSummary)) viewCounts.combinable += 1;
    if (matchesAutomaticInvoiceView('attention', group.parentSummary)) viewCounts.attention += 1;
    if (matchesAutomaticInvoiceView('notYetDue', group.parentSummary)) viewCounts.notYetDue += 1;
  }

  // Quick filter chips operate on the loaded page alongside the saved view.
  const availableCurrencies = Array.from(
    new Set(
      readyParentGroups
        .map((group) => group.candidate.currencyCode?.trim())
        .filter((code): code is string => Boolean(code)),
    ),
  ).sort();
  const availableChargeTypes = (['Fixed', 'Hourly', 'Usage', 'Bucket'] as RecurringChargeTypeKey[]).filter((type) =>
    readyParentGroups.some((group) =>
      group.childExecutionRows.some((member) => (member as { chargeType?: string | null }).chargeType === type),
    ),
  );
  const matchesQuickFilters = (group: RecurringInvoiceParentGroup): boolean => {
    if (windowOpenOnly && group.parentSummary.notYetDue) {
      return false;
    }
    if (currencyFilter && group.candidate.currencyCode?.trim() !== currencyFilter) {
      return false;
    }
    if (chargeFilter && !group.childExecutionRows.some((member) => (member as { chargeType?: string | null }).chargeType === chargeFilter)) {
      return false;
    }
    return true;
  };

  const viewFilteredGroups = readyParentGroups.filter(
    (group) => matchesAutomaticInvoiceView(activeView, group.parentSummary) && matchesQuickFilters(group),
  );
  const hasActiveQuickFilters = Boolean(chargeFilter) || Boolean(currencyFilter) || windowOpenOnly;

  const focusedGroup = focusedGroupKey
    ? readyParentGroups.find((group) => group.parentSummary.parentGroupKey === focusedGroupKey) ?? null
    : null;

  const automaticInvoiceDisplayRows: AutomaticInvoiceDisplayRow[] = [];
  for (const group of viewFilteredGroups) {
    automaticInvoiceDisplayRows.push({
      kind: 'group',
      rowId: group.parentSummary.parentGroupKey,
      group,
    });
    if (expandedParentGroups.has(group.parentSummary.parentGroupKey)) {
      for (const member of group.childExecutionRows) {
        automaticInvoiceDisplayRows.push({
          kind: 'member',
          rowId: `${group.parentSummary.parentGroupKey}:${member.executionIdentityKey}`,
          group,
          member,
        });
      }
    }
  }

  const amountCentsOf = (member: { amountCents?: number | null }): number | null =>
    typeof member.amountCents === 'number' && Number.isFinite(member.amountCents) ? member.amountCents : null;

  // Compact date-range label: a whole calendar month collapses to "Jun 2026";
  // other ranges show "Jun 15 – Jul 15, 2026" (year shown once) or span years
  // explicitly. Falls back to the raw ISO range if the dates don't parse.
  const formatPeriodLabel = (startISO?: string | null, endISO?: string | null): string => {
    if (!startISO || !endISO) return '';
    const s = startISO.slice(0, 10).split('-').map(Number);
    const e = endISO.slice(0, 10).split('-').map(Number);
    if (s.length !== 3 || e.length !== 3 || [...s, ...e].some((n) => Number.isNaN(n))) {
      return `${startISO.slice(0, 10)} – ${endISO.slice(0, 10)}`;
    }
    const [sy, sm, sd] = s;
    const [ey, em, ed] = e;
    const nextY = sm === 12 ? sy + 1 : sy;
    const nextM = sm === 12 ? 1 : sm + 1;
    if (sd === 1 && ed === 1 && ey === nextY && em === nextM) {
      return formatDate(startISO, { timeZone: 'UTC', month: 'short', year: 'numeric' });
    }
    if (sy === ey) {
      const startStr = formatDate(startISO, { timeZone: 'UTC', month: 'short', day: 'numeric' });
      const endStr = formatDate(endISO, { timeZone: 'UTC', month: 'short', day: 'numeric' });
      return `${startStr} – ${endStr}, ${sy}`;
    }
    const startStrY = formatDate(startISO, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    const endStrY = formatDate(endISO, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    return `${startStrY} – ${endStrY}`;
  };

  // Running totals for the selection bar. Only amounts the system already knows
  // (Fixed lines + already-calculated unresolved charges) are summed as "known
  // now"; the rest are finalized when the batch is generated.
  let selectionKnownCents = 0;
  let selectionAtGenerationCount = 0;
  for (const member of selectedExecutionRows) {
    const amount = amountCentsOf(member as { amountCents?: number | null });
    if (amount === null) {
      selectionAtGenerationCount += 1;
    } else {
      selectionKnownCents += amount;
    }
  }
  const selectionInvoiceCount = selectedSelectionGroups.length;
  const selectionCombineCount = selectedSelectionGroups.filter((group) => group.selectorInputs.length > 1).length;
  const selectionSeparateCount = selectedSelectionGroups.filter((group) => group.selectorInputs.length === 1).length;
  const hasSelection = selectedExecutionRows.length > 0;

  const summarizeGroupAmount = (members: RecurringInvoiceParentGroup['childExecutionRows']): {
    knownCents: number;
    atGenerationCount: number;
    hasKnown: boolean;
    allKnown: boolean;
  } => {
    let knownCents = 0;
    let atGenerationCount = 0;
    let sawKnown = false;
    for (const member of members) {
      const amount = amountCentsOf(member as { amountCents?: number | null });
      if (amount === null) {
        atGenerationCount += 1;
      } else {
        knownCents += amount;
        sawKnown = true;
      }
    }
    return {
      knownCents,
      atGenerationCount,
      hasKnown: sawKnown,
      allKnown: members.length > 0 && atGenerationCount === 0,
    };
  };

  const distinctChargeTags = (members: RecurringInvoiceParentGroup['childExecutionRows']): Array<{
    type: RecurringChargeTypeKey;
    count: number;
  }> => {
    const counts = new Map<RecurringChargeTypeKey, number>();
    for (const member of members) {
      const type = (member as { chargeType?: string | null }).chargeType;
      if (isRecurringChargeTypeKey(type)) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
      }
    }
    const order: RecurringChargeTypeKey[] = ['Fixed', 'Hourly', 'Usage', 'Bucket'];
    return order
      .filter((type) => counts.has(type))
      .map((type) => ({ type, count: counts.get(type) ?? 0 }));
  };

  const renderChargeTag = (type: RecurringChargeTypeKey, count: number) => {
    const meta = CHARGE_TAG_META[type];
    return (
      <span
        key={type}
        title={CHARGE_TAG_FULL_NAME[type]}
        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide ${meta.className}`}
      >
        {t(meta.labelKey, { defaultValue: meta.default })}{count > 1 ? ` ×${count}` : ''}
      </span>
    );
  };

  const statusPillIcon = (key: AutomaticInvoiceStatusKey) => {
    switch (key) {
      case 'ready':
        return <Check className="h-3 w-3" />;
      case 'combine':
        return <Link2 className="h-3 w-3" />;
      case 'separate':
        return <AlertTriangle className="h-3 w-3" />;
      case 'notYetDue':
        return <Clock className="h-3 w-3" />;
      case 'approval':
        return <Hourglass className="h-3 w-3" />;
      default:
        return null;
    }
  };

  // For a group that must be invoiced separately, how many distinct invoices it
  // splits into (one per incompatible scope bucket) — surfaced as "Separate ×N".
  const countSeparateInvoices = (members: RecurringInvoiceParentGroup['childExecutionRows']): number => {
    const eligible = members.filter((member) => member.canGenerate);
    const source = eligible.length > 0 ? eligible : members;
    const buckets = new Set(
      source.map((member) => [
        normalizeScopeValue(member.invoiceWindowStart),
        normalizeScopeValue(member.invoiceWindowEnd),
        normalizeScopeValue(member.clientId),
        normalizeScopeValue(member.currencyCode),
        normalizeScopeValue(member.purchaseOrderScopeKey),
        normalizeScopeValue(member.taxSource),
        normalizeScopeValue(member.exportShapeKey),
      ].join('|')),
    );
    return Math.max(buckets.size, 1);
  };

  const renderStatusPill = (summary: RecurringInvoiceParentGroup['parentSummary'], separateCount?: number) => {
    const key = resolveStatusKey({
      isCombinable: summary.isCombinable,
      canGenerate: summary.canGenerate,
      notYetDue: summary.notYetDue,
      combinabilitySummaryKey: summary.combinabilitySummaryKey,
      approvalBlockedEntryCount: 0,
    });
    const meta = STATUS_PILL_META[key];
    const showCount = key === 'separate' && typeof separateCount === 'number' && separateCount > 1;
    return (
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-2xs font-medium ${meta.className}`}
      >
        {statusPillIcon(key)}
        {t(meta.labelKey, { defaultValue: meta.default })}{showCount ? ` ×${separateCount}` : ''}
      </span>
    );
  };

  const renderGroupAmountCell = (group: RecurringInvoiceParentGroup) => {
    const summary = summarizeGroupAmount(group.childExecutionRows);
    if (summary.allKnown) {
      return (
        <div className="flex items-center justify-end gap-1 font-semibold font-mono tabular-nums text-foreground">
          <Check className="h-3.5 w-3.5 text-success" />
          {formatCurrency(summary.knownCents / 100)}
        </div>
      );
    }
    if (summary.hasKnown) {
      return (
        <div className="text-right">
          <div className="font-semibold font-mono tabular-nums text-foreground">{formatCurrency(summary.knownCents / 100)}</div>
          <div className="text-2xs text-muted-foreground">
            {t('automaticInvoices.amount.plusAtGeneration', {
              count: summary.atGenerationCount,
              defaultValue: `+ ${summary.atGenerationCount} at generation`,
            })}
          </div>
        </div>
      );
    }
    return (
      <div className="text-right text-2xs font-medium text-muted-foreground">
        {t('automaticInvoices.amount.atGeneration', { defaultValue: 'Calculated at generation' })}
      </div>
    );
  };

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
          setLoadError(t('automaticInvoices.errors.loadHistory', {
            defaultValue: 'Failed to load recurring invoice history. Please try again.',
          }));
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
            t('automaticInvoices.dialogs.poOverage.skippedError', {
              amount: formatCurrency(info.overageCents),
              poLabel: formatPoLabel(info.poNumber),
              defaultValue:
                `Skipped due to PO overage (${formatPoLabel(info.poNumber)}): `
                + `over by ${formatCurrency(info.overageCents)}.`,
            });
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
        [selectedCycleToReverse.client]: error instanceof Error
          ? error.message
          : t('automaticInvoices.dialogs.reverse.error', {
            defaultValue: 'Failed to reverse recurring invoice',
          })
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
        [selectedCycleToDelete.client]: error instanceof Error
          ? error.message
          : t('automaticInvoices.dialogs.delete.error', {
            defaultValue: 'Failed to delete recurring invoice',
          })
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
        throw new Error(
          runResult.failures[0]?.errorMessage
          || t('automaticInvoices.dialogs.preview.generateError', {
            defaultValue: 'Failed to generate invoice from preview',
          }),
        );
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
        preview: err instanceof Error
          ? err.message
          : t('automaticInvoices.dialogs.preview.generateError', {
            defaultValue: 'Failed to generate invoice from preview',
          }),
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
          text={t('automaticInvoices.loading.billingData', {
            defaultValue: 'Loading billing data',
          })}
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
              {t('common.actions.retry', { defaultValue: 'Retry' })}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
      <div className="space-y-8">
        <div>
          {needsApprovalParentGroups.length > 0 ? (
            <div className="mb-6 rounded-md border border-warning/40 bg-warning/5 p-4" data-testid="needs-approval-section">
              <h2 className="text-lg font-semibold">
                {t('automaticInvoices.ready.needsApproval.title', {
                  defaultValue: 'Needs Approval',
                })}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('automaticInvoices.ready.needsApproval.description', {
                  defaultValue: 'These recurring windows contain billable time that is not approved yet. The entire invoice window is blocked until approvals are complete.',
                })}
              </p>
              <div className="mt-4 space-y-3">
                {needsApprovalParentGroups.map((group) => {
                  const blockedEntryCount = group.candidate.approvalBlockedEntryCount ?? 0;
                  return (
                    <div
                      key={`needs-approval-${group.parentSummary.candidateKey}`}
                      className="rounded-md border border-warning/30 bg-background/90 p-3"
                      data-testid={`needs-approval-row-${group.parentSummary.candidateKey}`}
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="space-y-1 text-sm">
                          <div className="font-medium">
                            {group.parentSummary.clientName ?? t('common.labels.unknownClient', {
                              defaultValue: 'Unknown client',
                            })}
                          </div>
                          <div>
                            {t('automaticInvoices.ready.needsApproval.labels.servicePeriod', {
                              defaultValue: 'Service period',
                            })}: {group.parentSummary.servicePeriodLabel}
                          </div>
                          <div>
                            {t('automaticInvoices.ready.needsApproval.labels.invoiceWindow', {
                              defaultValue: 'Invoice window',
                            })}: {group.parentSummary.windowLabel}
                          </div>
                          <div className="text-warning">
                            {t('automaticInvoices.ready.needsApproval.unapprovedEntries', {
                              count: blockedEntryCount,
                              defaultValue: `${blockedEntryCount} unapproved ${blockedEntryCount === 1 ? 'entry' : 'entries'}`,
                            })}
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
                          {t('automaticInvoices.ready.needsApproval.actions.reviewApprovals', {
                            defaultValue: 'Review Approvals',
                          })}
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* Header + saved-view tabs */}
          <div className="mb-3 space-y-3">
            <h2 className="text-lg font-semibold">
              {t('automaticInvoices.ready.title', { defaultValue: 'Ready to Invoice' })}
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
                {([
                  { key: 'all', labelKey: 'automaticInvoices.views.all', default: 'All' },
                  { key: 'ready', labelKey: 'automaticInvoices.views.ready', default: 'Ready' },
                  { key: 'combinable', labelKey: 'automaticInvoices.views.combinable', default: 'Combinable' },
                  { key: 'attention', labelKey: 'automaticInvoices.views.attention', default: 'Needs attention' },
                  { key: 'notYetDue', labelKey: 'automaticInvoices.views.notYetDue', default: 'Not yet due' },
                ] as Array<{ key: AutomaticInvoiceViewKey; labelKey: string; default: string }>).map((tab) => {
                  const isActive = activeView === tab.key;
                  return (
                    <button
                      key={tab.key}
                      id={`automatic-invoices-view-${tab.key}`}
                      type="button"
                      onClick={() => setActiveView(tab.key)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                        isActive ? 'bg-primary-500 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {t(tab.labelKey, { defaultValue: tab.default })}
                      <span className={`text-2xs font-semibold ${isActive ? 'text-white/80' : 'text-muted-foreground'}`}>
                        {viewCounts[tab.key]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                id="automatic-invoices-filter-window-open"
                onClick={() => setWindowOpenOnly((value) => !value)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                  windowOpenOnly ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {t('automaticInvoices.filters.windowOpen', { defaultValue: 'Window open' })}
              </button>
              {availableChargeTypes.length > 0 ? (
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {t('automaticInvoices.filters.charge', { defaultValue: 'Charge' })}
                  <select
                    id="automatic-invoices-filter-charge"
                    value={chargeFilter}
                    onChange={(event) => setChargeFilter(event.target.value as RecurringChargeTypeKey | '')}
                    className="bg-transparent font-semibold text-foreground focus:outline-none"
                  >
                    <option value="">{t('automaticInvoices.filters.any', { defaultValue: 'any' })}</option>
                    {availableChargeTypes.map((type) => (
                      <option key={type} value={type}>
                        {t(CHARGE_TAG_META[type].labelKey, { defaultValue: CHARGE_TAG_META[type].default })}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {availableCurrencies.length > 1 ? (
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                  {t('automaticInvoices.filters.currency', { defaultValue: 'Currency' })}
                  <select
                    id="automatic-invoices-filter-currency"
                    value={currencyFilter}
                    onChange={(event) => setCurrencyFilter(event.target.value)}
                    className="bg-transparent font-semibold text-foreground focus:outline-none"
                  >
                    <option value="">{t('automaticInvoices.filters.any', { defaultValue: 'any' })}</option>
                    {availableCurrencies.map((code) => (
                      <option key={code} value={code}>{code}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {hasActiveQuickFilters ? (
                <button
                  type="button"
                  id="automatic-invoices-filter-clear"
                  onClick={() => { setChargeFilter(''); setCurrencyFilter(''); setWindowOpenOnly(false); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                  {t('automaticInvoices.filters.clear', { defaultValue: 'Clear' })}
                </button>
              ) : null}
            </div>
          </div>

          {/* Filters row */}
          <div className="flex items-end gap-4 mb-4">
            <DateRangePicker
              id="billing-period-date-range"
              label={t('automaticInvoices.ready.dateRange', {
                defaultValue: 'Service period start date range',
              })}
              value={pendingDateRange}
              onChange={(range) => setPendingDateRange(range)}
            />
            <Button
              id="apply-billing-period-date-filter"
              variant="outline"
              onClick={handleDateRangeSearch}
            >
              {t('automaticInvoices.ready.search', { defaultValue: 'Apply' })}
            </Button>
            <Input
              id="filter-clients-input"
              type="text"
              placeholder={t('automaticInvoices.ready.filterPlaceholder', {
                defaultValue: 'Filter by client',
              })}
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
                  aria-label={t('common.actions.close', { defaultValue: 'Close' })}
                >
                  <X className="h-5 w-5" />
                </button>
                <h4 className="font-semibold mb-2">
                  {t('automaticInvoices.errors.title', {
                    defaultValue: 'Errors occurred while finalizing invoices:',
                  })}
                </h4>
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
                    <div className="space-y-2">
                      <h4 className="font-semibold">
                        {t('automaticInvoices.materializationGap.title', {
                          defaultValue: 'These billing schedules need to be rebuilt',
                        })}
                      </h4>
                      <p className="text-sm text-muted-foreground">
                        {t('automaticInvoices.materializationGap.description', {
                          defaultValue: 'A billing schedule changed for these clients, so their upcoming charges are out of date and cannot be invoiced yet. Rebuilding updates the charges to match the current schedule. Charges that were already invoiced are not affected.',
                        })}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          id="fix-all-service-periods"
                          variant="default"
                          size="sm"
                          onClick={handleFixAllServicePeriods}
                          disabled={isRepairingAll}
                        >
                          {isRepairingAll
                            ? t('automaticInvoices.materializationGap.fixAllBusy', { defaultValue: 'Rebuilding…' })
                            : t('automaticInvoices.materializationGap.fixAll', { defaultValue: 'Fix all' })}
                        </Button>
                        {repairAllMessage ? (
                          <span className="text-sm text-muted-foreground" data-testid="fix-all-result">
                            {repairAllMessage}
                          </span>
                        ) : null}
                      </div>
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
                              <div className="font-medium">
                                {gap.clientName ?? t('common.labels.unknownClient', { defaultValue: 'Unknown client' })}
                              </div>
                              <div className="text-muted-foreground">{gap.detail}</div>
                              <div>
                                {t('automaticInvoices.materializationGap.labels.servicePeriod', {
                                  defaultValue: 'Service period',
                                })}: {gap.servicePeriodStart} to {gap.servicePeriodEnd}
                              </div>
                              <div>
                                {t('automaticInvoices.materializationGap.labels.invoiceWindow', {
                                  defaultValue: 'Invoice window',
                                })}: {gap.invoiceWindowStart} to {gap.invoiceWindowEnd}
                              </div>
                              <div className="break-all text-xs text-muted-foreground">
                                {t('automaticInvoices.materializationGap.labels.scheduleKey', {
                                  defaultValue: 'Schedule key',
                                })}: {gap.scheduleKey}
                              </div>
                            </div>
                            <div className="flex flex-col items-start gap-2">
                              <a
                                href={buildServicePeriodRepairHref(gap.scheduleKey)}
                                className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                              >
                                {t('automaticInvoices.materializationGap.reviewLink', {
                                  defaultValue: 'Review Service Periods',
                                })}
                              </a>
                              <span className="text-xs text-muted-foreground">
                                {t('automaticInvoices.materializationGap.helpText', {
                                  defaultValue: 'Repair the canonical service-period records instead of generating a compatibility invoice row.',
                                })}
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

          {/* Selection / summary bar */}
          <div
            className={`sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border px-4 py-3 shadow-sm ${
              hasSelection
                ? 'border-transparent bg-gradient-to-r from-primary-600 to-primary-500 text-white'
                : 'border-border bg-card text-foreground'
            }`}
            data-testid="automatic-invoices-summary-bar"
          >
            {hasSelection ? (
              <>
                <span className="text-sm font-semibold">
                  {t('automaticInvoices.summary.selected', {
                    count: selectedExecutionRows.length,
                    defaultValue: `${selectedExecutionRows.length} selected`,
                  })}
                </span>
                <span className="text-xs text-white/80">
                  {t('automaticInvoices.summary.breakdown', {
                    invoices: selectionInvoiceCount,
                    combine: selectionCombineCount,
                    separate: selectionSeparateCount,
                    defaultValue: `${selectionInvoiceCount} invoice(s) · ${selectionCombineCount} combined · ${selectionSeparateCount} separate`,
                  })}
                </span>
                <div className="ml-auto text-right leading-tight">
                  {selectionKnownCents > 0 ? (
                    <>
                      <div className="font-semibold font-mono tabular-nums">{formatCurrency(selectionKnownCents / 100)}</div>
                      <div className="text-2xs text-white/80">
                        {selectionAtGenerationCount > 0
                          ? t('automaticInvoices.summary.knownPlusAtGeneration', {
                              count: selectionAtGenerationCount,
                              defaultValue: `known now · ${selectionAtGenerationCount} calculated at generation`,
                            })
                          : t('automaticInvoices.summary.knownNow', { defaultValue: 'known now' })}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-sm font-semibold">
                        {t('automaticInvoices.amount.atGeneration', { defaultValue: 'Calculated at generation' })}
                      </div>
                      <div className="text-2xs text-white/80">
                        {t('automaticInvoices.drawer.obligations', {
                          count: selectionAtGenerationCount,
                          defaultValue: `${selectionAtGenerationCount} line item${selectionAtGenerationCount === 1 ? '' : 's'}`,
                        })}
                      </div>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    id="preview-selected-button"
                    variant="outline"
                    className="border-white/40 bg-white/10 text-white hover:bg-white/20"
                    onClick={() => {
                      if (selectedSelectionGroups.length > 0) {
                        handlePreviewSelection(selectedSelectionGroups);
                      }
                    }}
                    disabled={selectedSelectionGroups.length === 0 || isPreviewLoading}
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    {isPreviewLoading
                      ? t('common.actions.loading', { defaultValue: 'Loading...' })
                      : t('automaticInvoices.actions.previewSelected', { defaultValue: 'Preview Selected' })}
                  </Button>
                  <Button
                    id="generate-invoices-button"
                    className="bg-white text-primary-700 hover:bg-white/90"
                    onClick={handleGenerateInvoices}
                    disabled={selectedExecutionRows.length === 0 || isGenerating}
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    {isGenerating
                      ? t('manualInvoices.actions.processing', { defaultValue: 'Processing...' })
                      : t('automaticInvoices.actions.generateSelected', {
                          count: selectedExecutionRows.length,
                          defaultValue: `Generate Invoices (${selectedExecutionRows.length})`,
                        })}
                  </Button>
                </div>
              </>
            ) : (
              // Resting state: just the hint. Disabled Preview/Generate buttons
              // teach nothing — the action bar fills in once a row is checked.
              <span className="text-sm font-medium text-muted-foreground">
                {t('automaticInvoices.summary.empty', {
                  defaultValue: 'Select groups or line items to preview or generate invoices.',
                })}
              </span>
            )}
          </div>
          {!previewSupportsDirectGeneration && selectedSelectionGroups.length > 0 ? (
            <p className="mb-2 text-xs text-muted-foreground" data-testid="grouped-preview-unavailable-copy">
              {t('automaticInvoices.ready.groupedPreviewUnavailable', {
                defaultValue: 'Preview supports grouped selections; direct "Generate from preview" remains single-selection only.',
              })}
            </p>
          ) : null}

          {/* LEVERAGE: friction datatable-column-sizing — column proportions here are coaxed via
              per-column dataIndex tricks (select/tags → compact ids) + mixed px/% widths because
              DataTable's auto-fit overrides plain widths; a first-class "column width spec" on
              DataTable would remove this dance. */}
          <DataTable
            id="automatic-invoices-table"
            key={`${currentReadyPage}-${pageSize}-${activeView}`}
            data={automaticInvoiceDisplayRows as unknown as RecurringInvoiceParentGroup[]}
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
                dataIndex: 'select',
                width: '48px',
                sortable: false,
                headerClassName: 'px-2 text-center',
                cellClassName: 'px-2 text-center align-top',
                render: (_: unknown, rowRecord: unknown) => {
                  const record = rowRecord as AutomaticInvoiceDisplayRow;
                  if (record.kind === 'member') {
                    const isChildSelected = selectedTargets.has(childSelectionKeyForMember(record.member));
                    return (
                      <div className="flex justify-center">
                        <Checkbox
                          id={`select-child-${record.group.parentSummary.parentGroupKey}-${record.member.executionIdentityKey}`}
                          checked={isChildSelected}
                          disabled={!record.member.canGenerate}
                          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                            event.stopPropagation();
                            handleSelectChild(record.group, record.member, event);
                          }}
                        />
                      </div>
                    );
                  }
                  const group = record.group;
                  const isParentSelected = selectedTargets.has(group.parentSummary.parentSelectionKey);
                  const selectedChildrenCount = group.childExecutionRows.filter((member) =>
                    selectedTargets.has(childSelectionKeyForMember(member)),
                  ).length;
                  const isPartiallySelected = !isParentSelected && selectedChildrenCount > 0;
                  return (
                    <div className="flex justify-center">
                      <Checkbox
                        id={`select-${group.parentSummary.parentGroupKey}`}
                        checked={isParentSelected}
                        indeterminate={isPartiallySelected}
                        disabled={!group.parentSummary.canGenerate || !group.parentSummary.isCombinable}
                        onClick={(event: React.MouseEvent<HTMLInputElement>) => {
                          event.stopPropagation();
                          parentGroupRangeSelect.handleSelect(group.parentSummary.parentSelectionKey, {
                            shiftKey: event.shiftKey,
                            selected: !isParentSelected,
                            preventDefault: () => event.preventDefault(),
                          });
                          event.preventDefault();
                        }}
                        onChange={() => { /* controlled via onClick for shift-range support */ }}
                      />
                    </div>
                  );
                },
              },
              {
                title: t('automaticInvoices.ready.columns.group', { defaultValue: 'Client / Group' }),
                dataIndex: 'title',
                width: '34%',
                sortable: false,
                headerClassName: 'text-2xs uppercase tracking-wide',
                cellClassName: 'align-top',
                render: (_: unknown, rowRecord: unknown) => {
                  const record = rowRecord as AutomaticInvoiceDisplayRow;
                  if (record.kind === 'member') {
                    const member = record.member;
                    const assignmentContext = translateAssignmentContext(getRecurringAssignmentContext(member));
                    const nonContractSelection = parseNonContractSelectionFromScheduleKey(member.scheduleKey ?? null);
                    const childTitle =
                      member.contractName?.trim()
                      || assignmentContext
                      || member.contractLineName?.trim()
                      || member.executionIdentityKey;
                    const cadenceSourceBadge = formatCadenceSourceBadge(member.cadenceSource);
                    const cadenceSource = cadenceSourceBadge.labelKey
                      ? t(cadenceSourceBadge.labelKey, { defaultValue: cadenceSourceBadge.label })
                      : cadenceSourceBadge.label;
                    const billingTiming = member.duePosition === 'advance'
                      ? t('recurringServicePeriods.values.advance', { defaultValue: 'Advance' })
                      : t('recurringServicePeriods.values.arrears', { defaultValue: 'Arrears' });
                    return (
                      <div className="min-w-0 space-y-0.5 pl-8">
                        <div className="flex items-center gap-2 font-medium leading-snug">
                          <span className="min-w-0 truncate">{childTitle}</span>
                          {distinctChargeTags([member]).map(({ type }) => renderChargeTag(type, 1))}
                        </div>
                        {member.contractLineName?.trim() && member.contractLineName.trim() !== childTitle ? (
                          <div className="text-xs text-muted-foreground">{member.contractLineName.trim()}</div>
                        ) : null}
                        {nonContractSelection ? (
                          <div className="text-xs text-muted-foreground" data-testid={`non-contract-child-${member.executionIdentityKey}`}>
                            {t('automaticInvoices.executionRows.assignmentContext.unresolvedWork', { defaultValue: 'Unresolved work' })}
                          </div>
                        ) : null}
                        <div className="text-xs text-muted-foreground">{cadenceSource} · {billingTiming}</div>
                        {member.attribution?.isComplete === false ? (
                          <div className="text-xs text-warning" data-testid={`child-attribution-warning-${member.executionIdentityKey}`}>
                            {t('automaticInvoices.executionRows.attributionWarning', { defaultValue: 'Assignment attribution metadata missing' })}
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  const group = record.group;
                  const isExpanded = expandedParentGroups.has(group.parentSummary.parentGroupKey);
                  const contractNames = Array.from(new Set(
                    group.childExecutionRows.map((member) => member.contractName?.trim()).filter((name): name is string => Boolean(name)),
                  ));
                  const contractLineNames = Array.from(new Set(
                    group.childExecutionRows.map((member) => member.contractLineName?.trim()).filter((name): name is string => Boolean(name)),
                  ));
                  const contractMetadataMissingCount = group.childExecutionRows.filter((member) => member.attribution?.isComplete === false).length;
                  const assignmentContexts = Array.from(new Set(
                    group.childExecutionRows.map((member) => getRecurringAssignmentContext(member)).filter((value): value is string => Boolean(value)),
                  ));
                  const attributionSummaryLabels = group.candidate.attributionSummary?.labels ?? [];
                  const assignmentLabels = Array.from(new Set([...attributionSummaryLabels, ...assignmentContexts]));
                  const shouldShowAssignmentContexts = !isExpanded && contractNames.length === 0 && contractLineNames.length === 0 && assignmentLabels.length > 0;
                  const poScope = group.candidate.purchaseOrderScopeKey?.trim();
                  const currencyCode = group.candidate.currencyCode?.trim();
                  return (
                    <div className="flex min-w-0 items-start gap-2">
                      <Button
                        id={`toggle-group-${group.parentSummary.parentGroupKey}`}
                        variant="ghost"
                        size="sm"
                        className="mt-0.5 h-7 w-7 shrink-0 p-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleParentGroupExpansion(group.parentSummary.parentGroupKey);
                        }}
                        aria-label={isExpanded
                          ? t('automaticInvoices.groups.actions.collapse', { defaultValue: 'Collapse' })
                          : t('automaticInvoices.groups.actions.expand', { defaultValue: 'Expand' })}
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <div className="min-w-0 space-y-1">
                        <div className="break-words font-semibold leading-snug">
                          {group.parentSummary.clientName ?? t('common.labels.unknownClient', { defaultValue: 'Unknown client' })}
                          {(() => {
                            const tags = distinctChargeTags(group.childExecutionRows);
                            return tags.length > 0 ? (
                              <span className="ml-2 inline-flex gap-1 align-middle">
                                {tags.map(({ type, count }) => renderChargeTag(type, count))}
                              </span>
                            ) : null;
                          })()}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                          {/* A single charge names its line; multiple charges show a count.
                              Currency only when the page mixes currencies. Items joined by "·". */}
                          {(() => {
                            const meta: React.ReactNode[] = [
                              group.parentSummary.childCount === 1 && contractLineNames.length === 1 ? (
                                <span key="line" className="truncate" title={contractLineNames[0]}>{contractLineNames[0]}</span>
                              ) : (
                                <span key="line" title={contractLineNames.length > 0 ? contractLineNames.join(', ') : undefined}>
                                  {t('automaticInvoices.groups.item', {
                                    count: group.parentSummary.childCount,
                                    defaultValue: `${group.parentSummary.childCount} line item${group.parentSummary.childCount === 1 ? '' : 's'}`,
                                  })}
                                </span>
                              ),
                            ];
                            if (currencyCode && availableCurrencies.length > 1) {
                              meta.push(<span key="currency">{currencyCode}</span>);
                            }
                            if (poScope) {
                              meta.push(<span key="po" title={poScope}>{formatPoLabel(poScope)}</span>);
                            }
                            return meta.flatMap((node, index) =>
                              index === 0
                                ? [node]
                                : [<span key={`sep-${index}`} aria-hidden="true" className="text-muted-foreground/50">·</span>, node],
                            );
                          })()}
                        </div>
                        {!group.parentSummary.isCombinable && group.parentSummary.incompatibilityReasons.length > 0 ? (
                          <div className="text-xs text-muted-foreground" data-testid={`combinability-reasons-${group.parentSummary.parentGroupKey}`}>
                            {group.parentSummary.incompatibilityReasons
                              .map((reasonKey) => t(`automaticInvoices.incompatibilityReasons.${reasonKey}`, { defaultValue: AUTOMATIC_INVOICE_INCOMPATIBILITY_LABELS[reasonKey] }))
                              .join(', ')}
                          </div>
                        ) : null}
                        {!group.parentSummary.canGenerate && group.parentSummary.blockedReason && !group.parentSummary.notYetDue ? (
                          <div className="text-xs text-muted-foreground">{formatBlockedReason(group.parentSummary.blockedReason)}</div>
                        ) : null}
                        {shouldShowAssignmentContexts ? assignmentLabels.map((contextValue) => (
                          <div
                            key={`${group.parentSummary.candidateKey}:assignment:${contextValue}`}
                            className="text-xs text-muted-foreground"
                            data-testid={`contract-assignment-context-${group.parentSummary.candidateKey}`}
                          >
                            {translateAssignmentContext(contextValue)}
                          </div>
                        )) : null}
                        {contractMetadataMissingCount > 0 ? (
                          <div className="text-xs text-warning" data-testid={`contract-metadata-warning-${group.parentSummary.candidateKey}`}>
                            {t('automaticInvoices.groups.attributionMetadataMissing', {
                              count: contractMetadataMissingCount,
                              defaultValue: `Assignment attribution metadata missing (${contractMetadataMissingCount} line item${contractMetadataMissingCount === 1 ? '' : 's'})`,
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                },
              },
              {
                title: t('automaticInvoices.ready.columns.status', { defaultValue: 'Status' }),
                dataIndex: 'status',
                width: '120px',
                sortable: false,
                headerClassName: 'text-2xs uppercase tracking-wide',
                cellClassName: 'align-top',
                render: (_: unknown, rowRecord: unknown) => {
                  const record = rowRecord as AutomaticInvoiceDisplayRow;
                  if (record.kind === 'member') {
                    return null;
                  }
                  const summary = record.group.parentSummary;
                  return (
                    <div className="space-y-0.5">
                      {renderStatusPill(summary, countSeparateInvoices(record.group.childExecutionRows))}
                      {summary.notYetDue && summary.availableOnDate ? (
                        <div className="text-xs text-muted-foreground">
                          {t('automaticInvoices.window.opensOn', {
                            date: formatDate(summary.availableOnDate, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }),
                            defaultValue: `Opens ${formatDate(summary.availableOnDate, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })}`,
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                },
              },
              {
                title: t('automaticInvoices.ready.columns.servicePeriod', { defaultValue: 'Service Period' }),
                dataIndex: 'servicePeriod',
                width: '128px',
                sortable: false,
                headerClassName: 'text-2xs uppercase tracking-wide',
                cellClassName: 'align-top',
                render: (_: unknown, rowRecord: unknown) => {
                  const record = rowRecord as AutomaticInvoiceDisplayRow;
                  if (record.kind === 'member') {
                    return <div className="text-sm text-muted-foreground">{formatPeriodLabel(record.member.servicePeriodStart, record.member.servicePeriodEnd)}</div>;
                  }
                  // Line-item count lives in the client cell ("N line items · N
                  // contracts · N lines"); don't repeat it here.
                  return (
                    <div className="font-medium">{formatPeriodLabel(record.group.candidate.servicePeriodStart, record.group.candidate.servicePeriodEnd)}</div>
                  );
                },
              },
              {
                title: t('automaticInvoices.ready.columns.amount', { defaultValue: 'Amount' }),
                dataIndex: 'amount',
                width: '150px',
                sortable: false,
                headerClassName: 'text-2xs uppercase tracking-wide text-right',
                cellClassName: 'align-top text-right',
                render: (_: unknown, rowRecord: unknown) => {
                  const record = rowRecord as AutomaticInvoiceDisplayRow;
                  if (record.kind === 'member') {
                    const amount = amountCentsOf(record.member as { amountCents?: number | null });
                    if (amount === null) {
                      return (
                        <span className="text-2xs text-muted-foreground">
                          {t('automaticInvoices.amount.atGeneration', { defaultValue: 'Calculated at generation' })}
                        </span>
                      );
                    }
                    return <span className="font-medium font-mono tabular-nums">{formatCurrency(amount / 100)}</span>;
                  }
                  return renderGroupAmountCell(record.group);
                },
              },
            ]}
            pagination={true}
            currentPage={currentReadyPage}
            onPageChange={handleReadyPageChange}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
            totalItems={normalizedReadyClientFilter.length > 0 ? filteredPeriods.length : totalPeriods}
            onRowClick={(rowRecord: unknown) => {
              const record = rowRecord as AutomaticInvoiceDisplayRow;
              if (record.kind === 'group') {
                setFocusedGroupKey(record.group.parentSummary.parentGroupKey);
              }
            }}
            rowClassName={(rowRecord: unknown) => {
              const record = rowRecord as AutomaticInvoiceDisplayRow;
              if (record.kind === 'member') {
                return 'bg-muted/30';
              }
              const isSelected = selectedTargets.has(record.group.parentSummary.parentSelectionKey)
                || record.group.childExecutionRows.some((member) => selectedTargets.has(childSelectionKeyForMember(member)));
              return isSelected ? 'bg-primary-50' : '';
            }}
          />

          {/* Focused-group detail drawer */}
          {focusedGroup ? (() => {
            const summary = focusedGroup.parentSummary;
            const amountSummary = summarizeGroupAmount(focusedGroup.childExecutionRows);
            const focusedSelectionGroup: RecurringSelectionGroup = {
              groupKey: summary.parentSelectionKey,
              selectorInputs: focusedGroup.childExecutionRows.map((member) => member.selectorInput),
              billingCycleId: resolveSelectionGroupBillingCycleId(focusedGroup.childExecutionRows),
            };
            const isSelected = selectedTargets.has(summary.parentSelectionKey);
            const canSelect = summary.canGenerate && summary.isCombinable;
            const currencyCode = focusedGroup.candidate.currencyCode?.trim();
            return (
              <Drawer
                id="automatic-invoice-detail-drawer"
                isOpen={!!focusedGroup}
                onClose={() => setFocusedGroupKey(null)}
                width="400px"
              >
                <div className="flex h-full flex-col">
                  <div className="border-b border-border px-5 py-4">
                    <h3 className="text-lg font-semibold">
                      {summary.clientName ?? t('common.labels.unknownClient', { defaultValue: 'Unknown client' })}
                    </h3>
                    <div className="mt-0.5 text-sm text-muted-foreground">{formatPeriodLabel(focusedGroup.candidate.servicePeriodStart, focusedGroup.candidate.servicePeriodEnd)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatPeriodLabel(focusedGroup.candidate.windowStart, focusedGroup.candidate.windowEnd)}{currencyCode ? ` · ${currencyCode}` : ''}
                    </div>
                    <div className="mt-2">{renderStatusPill(summary, countSeparateInvoices(focusedGroup.childExecutionRows))}</div>
                  </div>

                  <div className="flex-1 space-y-4 overflow-auto px-5 py-4">
                    {!summary.isCombinable && summary.incompatibilityReasons.length > 0 ? (
                      <div>
                        <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {t('automaticInvoices.drawer.whySeparate', { defaultValue: 'Why these must be separate' })}
                        </div>
                        <ul className="space-y-0">
                          {summary.incompatibilityReasons.map((reasonKey) => (
                            <li key={reasonKey} className="flex items-center justify-between border-b border-border/60 py-1.5 text-sm">
                              <span className="text-muted-foreground">
                                {t(`automaticInvoices.incompatibilityReasons.${reasonKey}`, { defaultValue: AUTOMATIC_INVOICE_INCOMPATIBILITY_LABELS[reasonKey] })}
                              </span>
                              <X className="h-3.5 w-3.5 shrink-0 text-warning" />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div>
                      <div className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('automaticInvoices.drawer.lines', {
                          count: summary.childCount,
                          defaultValue: `Lines (${summary.childCount})`,
                        })}
                      </div>
                      <ul className="space-y-0">
                        {focusedGroup.childExecutionRows.map((member) => {
                          const amount = amountCentsOf(member as { amountCents?: number | null });
                          const chargeType = (member as { chargeType?: string | null }).chargeType;
                          const title =
                            member.contractName?.trim()
                            || member.contractLineName?.trim()
                            || translateAssignmentContext(getRecurringAssignmentContext(member))
                            || member.executionIdentityKey;
                          return (
                            <li key={member.executionIdentityKey} className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 text-sm">
                              <span className="flex min-w-0 items-center gap-1.5">
                                {isRecurringChargeTypeKey(chargeType) ? renderChargeTag(chargeType, 1) : null}
                                <span className="truncate">{title}</span>
                              </span>
                              <span className="shrink-0 tabular-nums">
                                {amount === null
                                  ? <span className="text-2xs text-muted-foreground">{t('automaticInvoices.amount.atGeneration', { defaultValue: 'Calculated at generation' })}</span>
                                  : <span className="font-medium font-mono tabular-nums">{formatCurrency(amount / 100)}</span>}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5">
                      {amountSummary.hasKnown ? (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t('automaticInvoices.drawer.knownNow', { defaultValue: 'Known now' })}</span>
                          <span className="font-semibold font-mono tabular-nums text-foreground">{formatCurrency(amountSummary.knownCents / 100)}</span>
                        </div>
                      ) : null}
                      {amountSummary.atGenerationCount > 0 ? (
                        <div className="mt-1 flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t('automaticInvoices.drawer.atGeneration', { defaultValue: 'Calculated at generation' })}</span>
                          <span className="font-medium text-muted-foreground">
                            {t('automaticInvoices.drawer.obligations', {
                              count: amountSummary.atGenerationCount,
                              defaultValue: `${amountSummary.atGenerationCount} line item${amountSummary.atGenerationCount === 1 ? '' : 's'}`,
                            })}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {t('automaticInvoices.drawer.note', {
                        defaultValue: 'The known amount comes from fixed lines. Time, usage and bucket amounts are finalized when you generate — use Preview to see them first.',
                      })}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
                    <Button
                      id="drawer-preview-invoice"
                      variant="outline"
                      disabled={!summary.canGenerate || isPreviewLoading}
                      onClick={() => handlePreviewSelection([focusedSelectionGroup])}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      {isPreviewLoading
                        ? t('common.actions.loading', { defaultValue: 'Loading...' })
                        : t('automaticInvoices.drawer.preview', { defaultValue: 'Preview invoice' })}
                    </Button>
                    <Button
                      id="drawer-toggle-select"
                      disabled={!canSelect}
                      onClick={() => {
                        setSelectedTargets((previous) => {
                          const next = new Set(previous);
                          if (next.has(summary.parentSelectionKey)) {
                            next.delete(summary.parentSelectionKey);
                          } else {
                            next.add(summary.parentSelectionKey);
                          }
                          return next;
                        });
                      }}
                    >
                      {isSelected
                        ? t('automaticInvoices.drawer.deselect', { defaultValue: 'Remove from selection' })
                        : t('automaticInvoices.drawer.select', { defaultValue: 'Select for generation' })}
                    </Button>
                  </div>
                </div>
              </Drawer>
            );
          })() : null}
        </div>

        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">
              {t('automaticInvoices.history.title', {
                defaultValue: 'Recurring Invoice History',
              })}
            </h2>
            <Input
              id="filter-invoiced-clients-input"
              type="text"
              placeholder={t('automaticInvoices.history.filterPlaceholder', {
                defaultValue: 'Filter clients...',
              })}
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
              {
                title: t('automaticInvoices.history.columns.client', { defaultValue: 'Client' }),
                dataIndex: 'clientName',
              },
              {
                title: t('automaticInvoices.history.columns.assignmentScope', {
                  defaultValue: 'Assignment Scope',
                }),
                dataIndex: 'assignmentSummary',
                render: (_: unknown, record: InvoicedPeriod) => (
                  <div className="space-y-1">
                    <div>{record.assignmentSummary}</div>
                    {record.isMultiAssignment ? (
                      <Badge variant="secondary">
                        {t('automaticInvoices.history.badges.multiContractInvoice', {
                          defaultValue: 'Multi-contract invoice',
                        })}
                      </Badge>
                    ) : null}
                  </div>
                ),
              },
              {
                title: t('automaticInvoices.history.columns.cadenceSource', {
                  defaultValue: 'Cadence Source',
                }),
                dataIndex: 'cadenceSource',
                render: (_: unknown, record: InvoicedPeriod) => (
                  <div className="space-y-1">
                    <Badge variant={formatCadenceSourceBadge(record.cadenceSource).variant}>
                      {formatCadenceSourceText(record.cadenceSource)}
                    </Badge>
                    {!record.hasBillingCycleBridge ? (
                      <Badge variant="secondary">
                        {t('automaticInvoices.history.badges.servicePeriodBacked', {
                          defaultValue: 'Service-period-backed',
                        })}
                      </Badge>
                    ) : null}
                  </div>
                ),
              },
              {
                title: t('automaticInvoices.history.columns.servicePeriod', {
                  defaultValue: 'Service Period',
                }),
                dataIndex: 'servicePeriodLabel',
              },
              {
                title: t('automaticInvoices.history.columns.invoiceWindow', {
                  defaultValue: 'Invoice Window',
                }),
                dataIndex: 'invoiceWindowLabel',
              },
              {
                title: t('automaticInvoices.history.columns.invoice', {
                  defaultValue: 'Invoice',
                }),
                dataIndex: 'invoiceNumber',
                render: (_: unknown, record: InvoicedPeriod) => (
                  <div className="space-y-1">
                    <div>{record.invoiceNumber ?? record.invoiceId}</div>
                    {record.invoiceDate ? (
                      <div className="text-xs text-muted-foreground">
                        {formatDate(record.invoiceDate)}
                      </div>
                    ) : null}
                  </div>
                ),
              },
              {
                title: t('automaticInvoices.history.columns.actions', {
                  defaultValue: 'Actions',
                }),
                dataIndex: 'invoiceId',
                render: (_: unknown, record: InvoicedPeriod) => (
                  <div className="flex justify-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button id={`actions-trigger-invoiced-${record.invoiceId}`} variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">
                            {t('common.actions.openMenu', { defaultValue: 'Open menu' })}
                          </span>
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
                              cadenceSource: record.cadenceSource,
                            });
                            setShowReverseDialog(true);
                          }}
                        >
                          {t('automaticInvoices.actions.reverseInvoice', { defaultValue: 'Reverse Invoice' })}
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
                              cadenceSource: record.cadenceSource,
                            });
                            setShowDeleteDialog(true);
                          }}
                        >
                          {t('automaticInvoices.actions.deleteInvoice', { defaultValue: 'Delete Invoice' })}
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
        title={t('automaticInvoices.dialogs.reverse.title', {
          defaultValue: 'Reverse Recurring Invoice',
        })}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id='cancel-reverse-billing-cycle-button'
              variant="outline"
              onClick={() => setShowReverseDialog(false)}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id='reverse-billing-cycle-button'
              variant="destructive"
              onClick={handleReverseBillingCycle}
              disabled={isReversing}
            >
              {isReversing
                ? t('automaticInvoices.dialogs.reverse.reversing', { defaultValue: 'Reversing...' })
                : t('automaticInvoices.dialogs.reverse.confirm', {
                  defaultValue: 'Yes, Reverse Invoice',
                })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="flex items-center gap-2 text-destructive mb-4">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-semibold">
              {t('automaticInvoices.dialogs.reverse.warningTitle', {
                defaultValue: 'Warning: Reverse Recurring Invoice',
              })}
            </span>
          </div>
          <div className="text-sm space-y-2">
            <p className="font-semibold">
              {t('automaticInvoices.dialogs.reverse.description', {
                defaultValue: 'You are about to reverse the recurring invoice for:',
              })}
            </p>
            <p>
              {t('automaticInvoices.dialogs.reverse.labels.client', { defaultValue: 'Client' })}: {selectedCycleToReverse?.client}
            </p>
            <p>
              {t('automaticInvoices.dialogs.reverse.labels.cadenceSource', {
                defaultValue: 'Cadence source',
              })}: {formatCadenceSourceText(selectedCycleToReverse?.cadenceSource)}
            </p>
            <p>
              {t('automaticInvoices.dialogs.reverse.labels.servicePeriod', {
                defaultValue: 'Service period',
              })}: {selectedCycleToReverse?.servicePeriodLabel}
            </p>
          </div>

          <Alert variant="warning" className="mt-4">
            <AlertDescription className="text-sm space-y-2">
              <p className="font-semibold">
                {t('automaticInvoices.dialogs.reverse.impactTitle', {
                  defaultValue: 'This action will:',
                })}
              </p>
              <ul className="list-disc pl-5">
                <li>{t('automaticInvoices.dialogs.reverse.effects.deleteDraft', { defaultValue: 'Delete the generated recurring invoice draft' })}</li>
                <li>{t('automaticInvoices.dialogs.reverse.effects.reissueCredits', { defaultValue: 'Reissue any credits that were applied to that invoice' })}</li>
                <li>{t('automaticInvoices.dialogs.reverse.effects.unmarkRecords', { defaultValue: 'Unmark linked time entries and usage records as invoiced' })}</li>
                <li>
                  {selectedCycleToReverse?.hasBillingCycleBridge
                    ? t('automaticInvoices.dialogs.reverse.effects.retireBridge', {
                      defaultValue: 'Retire the linked client cadence bridge record and reopen the linked recurring service periods',
                    })
                    : t('automaticInvoices.dialogs.reverse.effects.reopenPeriods', {
                      defaultValue: 'Reopen the linked recurring service periods without requiring client-cycle bridge metadata',
                    })}
                </li>
              </ul>
              <p className="text-destructive font-semibold mt-4">
                {t('automaticInvoices.dialogs.reverse.cannotUndo', {
                  defaultValue: 'This action cannot be undone!',
                })}
              </p>
            </AlertDescription>
          </Alert>
        </DialogContent>
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
        title={t('automaticInvoices.dialogs.preview.title', {
          defaultValue: 'Invoice Preview',
        })}
        footer={(
          <div className="flex justify-end space-x-2">
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
              {t('automaticInvoices.actions.closePreview', { defaultValue: 'Close Preview' })}
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
              {isGeneratingFromPreview
                ? t('automaticInvoices.dialogs.preview.generating', { defaultValue: 'Generating...' })
                : t('automaticInvoices.actions.generateInvoice', { defaultValue: 'Generate Invoice' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <DialogDescription>
            {t('automaticInvoices.dialogs.preview.description', {
              defaultValue: 'This is a preview of how the invoice will look when finalized.',
            })}
          </DialogDescription>
          {errors.preview ? (
            <div className="text-center py-8">
              {/* Display error message if present */}
              <p className="text-destructive">{errors.preview}</p>
            </div>
          ) : previewState.previews.length > 0 && (
            <div className="space-y-4">
              <div className="rounded-md border border-border/70 bg-muted/10 px-3 py-2 text-sm" data-testid="preview-invoice-count-summary">
                {previewState.invoiceCount === 1
                  ? t('automaticInvoices.dialogs.preview.summaryCombined', {
                    defaultValue: 'This selection will generate one combined invoice.',
                  })
                  : t('automaticInvoices.dialogs.preview.summarySeparate', {
                    count: previewState.invoiceCount,
                    defaultValue: `This selection will generate ${previewState.invoiceCount} separate invoices.`,
                  })}
              </div>
              {previewState.previews.map((previewEntry, previewIndex) => (
                <div key={previewEntry.previewGroupKey} className="space-y-4 rounded-md border border-border/70 p-3" data-testid={`preview-group-${previewEntry.previewGroupKey}`}>
                  <h3 className="font-semibold">
                    {t('automaticInvoices.dialogs.preview.invoiceTitle', {
                      index: previewIndex + 1,
                      defaultValue: `Invoice ${previewIndex + 1}`,
                    })}
                  </h3>
                  <div className="border-b pb-4">
                    <h4 className="font-semibold">
                      {t('automaticInvoices.dialogs.preview.sections.clientDetails', {
                        defaultValue: 'Client Details',
                      })}
                    </h4>
                    <p>{previewEntry.data.customer?.name}</p>
                    <p>{previewEntry.data.customer?.address}</p>
                  </div>
                  <div className="border-b pb-4">
                    <h4 className="font-semibold">
                      {t('automaticInvoices.dialogs.preview.sections.invoiceDetails', {
                        defaultValue: 'Invoice Details',
                      })}
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {t('common.labels.invoiceNumber', { defaultValue: 'Invoice Number' })}
                        </p>
                        <p>{previewEntry.data.invoiceNumber}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {t('automaticInvoices.dialogs.preview.fields.date', { defaultValue: 'Date' })}
                        </p>
                        <p>{toPlainDate(previewEntry.data.issueDate).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-sm text-muted-foreground">
                          {t('common.labels.dueDate', { defaultValue: 'Due Date' })}
                        </p>
                        <p>{toPlainDate(previewEntry.data.dueDate).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-semibold mb-2">
                      {t('automaticInvoices.dialogs.preview.sections.lineItems', {
                        defaultValue: 'Line Items',
                      })}
                    </h4>
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2">{t('automaticInvoices.dialogs.preview.columns.description', { defaultValue: 'Description' })}</th>
                          <th className="text-right py-2">{t('automaticInvoices.dialogs.preview.columns.quantity', { defaultValue: 'Quantity' })}</th>
                          <th className="text-right py-2">{t('automaticInvoices.dialogs.preview.columns.rate', { defaultValue: 'Rate' })}</th>
                          <th className="text-right py-2">{t('automaticInvoices.dialogs.preview.columns.amount', { defaultValue: 'Amount' })}</th>
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
                          <td colSpan={3} className="text-right py-2 font-semibold">{t('automaticInvoices.dialogs.preview.totals.subtotal', { defaultValue: 'Subtotal' })}</td>
                          <td className="text-right py-2">{formatCurrency(previewEntry.data.subtotal / 100)}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="text-right py-2 font-semibold">{t('automaticInvoices.dialogs.preview.totals.tax', { defaultValue: 'Tax' })}</td>
                          <td className="text-right py-2">{formatCurrency(previewEntry.data.tax / 100)}</td>
                        </tr>
                        <tr>
                          <td colSpan={3} className="text-right py-2 font-semibold">{t('automaticInvoices.dialogs.preview.totals.total', { defaultValue: 'Total' })}</td>
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
      </Dialog>

      <ConfirmationDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setSelectedCycleToDelete(null);
        }}
        onConfirm={handleDeleteRecurringInvoice}
        title={t('automaticInvoices.dialogs.delete.title', {
          defaultValue: 'Permanently Delete Recurring Invoice?',
        })}
        message={t('automaticInvoices.dialogs.delete.message', {
          client: selectedCycleToDelete?.client ?? '',
          cadenceSource: formatCadenceSourceText(selectedCycleToDelete?.cadenceSource),
          servicePeriod: selectedCycleToDelete?.servicePeriodLabel ?? '',
          bridgeEffect: selectedCycleToDelete?.hasBillingCycleBridge
            ? t('automaticInvoices.dialogs.delete.bridgeDeleted', {
              defaultValue: 'The linked client cadence bridge record will also be deleted.',
            })
            : t('automaticInvoices.dialogs.delete.bridgeReopened', {
              defaultValue: 'Linked recurring service periods will be reopened without requiring client-cycle bridge metadata.',
            }),
          defaultValue:
            `This action cannot be undone. This will permanently delete the recurring invoice for:\n`
            + `Client: ${selectedCycleToDelete?.client}\n`
            + `Cadence source: ${formatCadenceSourceText(selectedCycleToDelete?.cadenceSource)}\n`
            + `Service period: ${selectedCycleToDelete?.servicePeriodLabel}\n`
            + `${selectedCycleToDelete?.hasBillingCycleBridge
              ? 'The linked client cadence bridge record will also be deleted.'
              : 'Linked recurring service periods will be reopened without requiring client-cycle bridge metadata.'}`,
        })}
        confirmLabel={isDeleting
          ? t('automaticInvoices.dialogs.delete.deleting', { defaultValue: 'Deleting...' })
          : t('automaticInvoices.dialogs.delete.confirm', {
            defaultValue: 'Yes, Delete Permanently',
          })}
        isConfirming={isDeleting}
        id="delete-recurring-invoice-confirmation"
      />

      <ConfirmationDialog
        id="po-overage-batch-decision"
        isOpen={poOverageDialogState.isOpen}
        onClose={() =>
          setPoOverageDialogState({ isOpen: false, executionIdentityKeys: [], overageByExecutionIdentityKey: {} })
        }
        title={t('automaticInvoices.dialogs.poOverage.title', {
          defaultValue: 'Purchase Order Limit Overages',
        })}
        message={
          <div className="space-y-2">
            <p>
              {t('automaticInvoices.dialogs.poOverage.batchDescription', {
                defaultValue: 'One or more invoices would exceed a Purchase Order authorized amount. What do you want to do?',
              })}
            </p>
            <ul className="list-disc pl-5">
              {Object.entries(poOverageDialogState.overageByExecutionIdentityKey).map(([id, info]) => (
                <li key={id}>
                  {t('automaticInvoices.dialogs.poOverage.batchItem', {
                    clientName: info.clientName,
                    amount: formatCurrency(info.overageCents),
                    defaultValue: `${info.clientName}: over by ${formatCurrency(info.overageCents)}`,
                  })}
                  {info.poNumber ? ` (${formatPoLabel(info.poNumber)})` : ''}
                </li>
              ))}
            </ul>
          </div>
        }
        confirmLabel={t('automaticInvoices.dialogs.poOverage.continue', { defaultValue: 'Continue' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        options={[
          {
            value: 'allow',
            label: t('automaticInvoices.dialogs.poOverage.allowOverages', {
              defaultValue: 'Allow overages (generate all invoices)',
            }),
          },
          {
            value: 'skip',
            label: t('automaticInvoices.dialogs.poOverage.skipInvoices', {
              defaultValue: 'Skip invoices that would overrun their PO',
            }),
          },
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
        title={t('automaticInvoices.dialogs.poOverage.title', {
          defaultValue: 'Purchase Order Limit Overages',
        })}
        message={
          <div className="space-y-2">
            <p>
              {t('automaticInvoices.dialogs.poOverage.singleDescription', {
                amount: formatCurrency(poOverageSingleConfirm.overageCents),
                defaultValue:
                  `This invoice would exceed the Purchase Order authorized amount by ${formatCurrency(poOverageSingleConfirm.overageCents)}.`,
              })}
            </p>
            {poOverageSingleConfirm.poNumber && (
              <p>
                {t('purchaseOrder.labels.number', { defaultValue: 'PO Number' })}: {poOverageSingleConfirm.poNumber}
              </p>
            )}
            <p>{t('automaticInvoices.dialogs.poOverage.proceedAnyway', { defaultValue: 'Proceed anyway?' })}</p>
          </div>
        }
        confirmLabel={t('automaticInvoices.dialogs.poOverage.proceedConfirm', { defaultValue: 'Proceed Anyway' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        onConfirm={handlePoOverageSingleConfirm}
      />
      </>
  // Removed TooltipProvider closing tag
  );
};

export default AutomaticInvoices;
