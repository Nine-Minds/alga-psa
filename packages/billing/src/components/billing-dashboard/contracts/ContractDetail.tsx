'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle, CalendarClock, FileText, Layers3, Package, Users, Save, Pencil, X, Check, ArrowLeft, File, Upload, Trash2, Eye } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import { Input } from '@alga-psa/ui/components/Input';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useDrawer } from '@alga-psa/ui';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type {
  ColumnDefinition,
  IClient,
  IContract,
  IContractAssignmentSummary,
  IDocument,
  IStatus,
  IInvoiceTemplate,
  IQuote,
  InvoiceViewModel as BillingInvoiceViewModel
} from '@alga-psa/types';
import {
  getContractById,
  getContractSummary,
  getContractAssignments,
  updateContract,
  deleteContract,
} from '@alga-psa/billing/actions/contractActions';
import { getQuoteByConvertedContractId } from '@alga-psa/billing/actions/quoteActions';
import type { IContractSummary } from '@alga-psa/billing/actions/contractActions';
import {
  getClientContractByIdForBilling,
  updateClientContractForBilling,
  getClientByIdForBilling,
} from '@alga-psa/billing/actions/billingClientsActions';
import { getAllBoards, getTicketStatuses } from '@alga-psa/reference-data/actions';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { fetchInvoicesByContract } from '@alga-psa/billing/actions/invoiceQueries';
import { getInvoiceTemplates } from '@alga-psa/billing/actions/invoiceTemplates';

import { BILLING_FREQUENCY_OPTIONS } from '@alga-psa/billing/constants/billing';
import { useTenant } from '@alga-psa/ui/components/providers/TenantProvider';
import ContractHeader from './ContractHeader';
import ContractLines from './ContractLines';
import ContractOverview from './ContractOverview';
import PricingSchedules from './PricingSchedules';
import InvoicePreviewPanel from '../invoicing/InvoicePreviewPanel';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate, toISODate } from '@alga-psa/core';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';

import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import { cn } from '@alga-psa/ui/lib/utils';
import { formatCurrencyFromMinorUnits } from '@alga-psa/core';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const formatDate = (value?: string | Date | null): string => {
  if (!value) {
    return '—';
  }

  try {
    const plainDate = toPlainDate(value);
    const displayDate = new Date(Date.UTC(plainDate.year, plainDate.month - 1, plainDate.day, 12));
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(displayDate);
  } catch (error) {
    console.error('Error formatting date:', error);
    return '—';
  }
};

const normalizeRenewalMode = (value: unknown): 'none' | 'manual' | 'auto' | undefined => {
  return value === 'none' || value === 'manual' || value === 'auto' ? value : undefined;
};

const formatRenewalModeLabel = (value: unknown): string => {
  const mode = normalizeRenewalMode(value);
  if (mode === 'auto') return 'Auto-renew';
  if (mode === 'none') return 'Non-renewing';
  return 'Manual renewal';
};

function getCurrencyMeta(currencyCode: string): { fractionDigits: number; symbol: string } {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode });
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const symbol = formatter.formatToParts(0).find((part) => part.type === 'currency')?.value ?? currencyCode;
  return { fractionDigits, symbol };
}

interface ContractDetailProps {
  resolvedContractId?: string | null;
  resolvedClientContractId?: string | null;
  /** Documents fetched server-side when viewing documents tab */
  serverDocuments?: IDocument[] | null;
  /** Current user ID fetched server-side */
  serverUserId?: string | null;
  /** Optional injected UI for client quick view (e.g. @alga-psa/clients ClientDetails).
   *  If omitted, falls back to a minimal drawer with a link to open the client page. */
  renderClientDetails?: (args: { id: string; client: IClient }) => React.ReactNode;
}

interface ContractInvoicePreviewDrawerContentProps {
  invoiceId: string;
  templates: IInvoiceTemplate[];
  initialTemplateId: string;
  isFinalized: boolean;
}

const ContractInvoicePreviewDrawerContent: React.FC<ContractInvoicePreviewDrawerContentProps> = ({
  invoiceId,
  templates,
  initialTemplateId,
  isFinalized
}) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState(initialTemplateId);

  return (
    <InvoicePreviewPanel
      invoiceId={invoiceId}
      templates={templates}
      selectedTemplateId={selectedTemplateId}
      onTemplateChange={setSelectedTemplateId}
      isFinalized={isFinalized}
    />
  );
};

const ContractDetail: React.FC<ContractDetailProps> = ({
  resolvedContractId,
  resolvedClientContractId,
  serverDocuments,
  serverUserId,
  renderClientDetails
}) => {
  const { t } = useTranslation('msp/contracts');
  const searchParams = useSearchParams();
  const router = useRouter();
  const contractId = (searchParams?.get('contractId') ?? resolvedContractId ?? null) as string | null;
  const clientContractId = searchParams?.get('clientContractId') ?? resolvedClientContractId ?? null;
  const tenant = useTenant()!;
  const { getDocumentsByContractId, renderDocuments } = useDocumentsCrossFeature();

  const [contract, setContract] = useState<IContract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const validTabs = useMemo(() => new Set(['edit', 'lines', 'pricing', 'documents', 'invoices']), []);
  const initialTab = useMemo(() => {
    const requested = searchParams?.get('contractView');
    return requested && validTabs.has(requested) ? requested : 'edit';
  }, [searchParams, validTabs]);

  const [activeTab, setActiveTab] = useState(initialTab);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [summary, setSummary] = useState<IContractSummary | null>(null);
  const [assignments, setAssignments] = useState<IContractAssignmentSummary[]>([]);
  // Use server-provided documents if available, otherwise start empty
  const [documents, setDocuments] = useState<IDocument[]>(serverDocuments || []);
  const [contractInvoices, setContractInvoices] = useState<BillingInvoiceViewModel[]>([]);
  const [invoiceTemplates, setInvoiceTemplates] = useState<IInvoiceTemplate[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [sourceQuote, setSourceQuote] = useState<IQuote | null>(null);
  // Use server-provided userId if available
  const [currentUserId, setCurrentUserId] = useState<string>(serverUserId || '');

  const { openDrawer, replaceDrawer } = useDrawer();

  // Confirmation dialog state
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showNavigateAwayConfirm, setShowNavigateAwayConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // Edit tab state
  const [editContractName, setEditContractName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<string>('draft');
  const [editBillingFrequency, setEditBillingFrequency] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isFormInitialized, setIsFormInitialized] = useState(false);

  // Assignment editing state
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [editAssignments, setEditAssignments] = useState<Record<string, IContractAssignmentSummary>>({});
  const [preEditSnapshot, setPreEditSnapshot] = useState<IContractAssignmentSummary | null>(null);
  const [renewalTicketBoards, setRenewalTicketBoards] = useState<Array<{ value: string; label: string }>>([]);
  const [renewalTicketStatuses, setRenewalTicketStatuses] = useState<Array<{ value: string; label: string }>>([]);
  const [loadingRenewalTicketStatuses, setLoadingRenewalTicketStatuses] = useState(false);

  // Contract fields editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  // PO Amount input state for formatting (stores display value while editing)
  const [poAmountInputs, setPoAmountInputs] = useState<Record<string, string>>({});

  const currencyMeta = useMemo(() => {
    const currencyCode = contract?.currency_code ?? 'USD';
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode });
    const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    const symbol =
      formatter.formatToParts(0).find((part) => part.type === 'currency')?.value ?? currencyCode;

    return {
      currencyCode,
      fractionDigits,
      minorUnitFactor: Math.pow(10, fractionDigits),
      symbol,
    };
  }, [contract?.currency_code]);

  const renewalModeOptions = useMemo(
    () => [
      { value: 'manual', label: 'Manual renewal' },
      { value: 'auto', label: 'Auto-renew' },
      { value: 'none', label: 'Non-renewing' },
    ],
    []
  );
  const primaryAssignment =
    assignments.find((assignment) => assignment.client_contract_id === clientContractId) ??
    assignments[0] ??
    null;
  const primaryAssignmentStatus = primaryAssignment?.assignment_status ?? 'draft';
  const isLiveClientContract =
    contract?.is_template === false && primaryAssignment !== null;
  const isSystemManagedDefault = contract?.is_system_managed_default === true;
  const primaryAssignmentUsesTenantRenewalDefaults =
    primaryAssignment?.use_tenant_renewal_defaults !== false;

  useEffect(() => {
    let isMounted = true;

    const loadSourceQuote = async () => {
      if (!contractId) {
        if (isMounted) {
          setSourceQuote(null);
        }
        return;
      }

      try {
        const result = await getQuoteByConvertedContractId(contractId);
        if (!isMounted) {
          return;
        }

        if (result && !('permissionError' in result)) {
          setSourceQuote(result);
          return;
        }

        setSourceQuote(null);
      } catch (sourceQuoteError) {
        console.error('Failed to load source quote for contract detail:', sourceQuoteError);
        if (isMounted) {
          setSourceQuote(null);
        }
      }
    };

    void loadSourceQuote();

    return () => {
      isMounted = false;
    };
  }, [contractId]);
  const primaryAssignmentRenewalMode = normalizeRenewalMode(
    primaryAssignment?.effective_renewal_mode ?? primaryAssignment?.renewal_mode
  );
  const primaryAssignmentNoticePeriod =
    primaryAssignment?.effective_notice_period_days ?? primaryAssignment?.notice_period_days;
  const editingAssignment = editingAssignmentId ? editAssignments[editingAssignmentId] : null;
  const editingRenewalTicketBoardId = editingAssignment?.renewal_ticket_board_id ?? null;

  // Sync tab state FROM URL changes (e.g., browser back/forward)
  // Don't include activeTab in deps - handleTabChange handles state → URL direction
  useEffect(() => {
    const requested = searchParams?.get('contractView');
    if (requested && validTabs.has(requested)) {
      setActiveTab(requested);
    } else if (!requested) {
      setActiveTab('edit');
    }
  }, [searchParams, validTabs]);

  // Sync documents from server props when they change (e.g., after router.refresh())
  useEffect(() => {
    if (serverDocuments !== undefined && serverDocuments !== null) {
      setDocuments(serverDocuments);
    }
  }, [serverDocuments]);

  // Sync userId from server props when it changes
  useEffect(() => {
    if (serverUserId) {
      setCurrentUserId(serverUserId);
    }
  }, [serverUserId]);

  useEffect(() => {
    let active = true;

    const loadRenewalTicketBoards = async () => {
      try {
        const boards = await getAllBoards(true);
        if (!active) {
          return;
        }

        setRenewalTicketBoards(
          boards.map((board) => ({
            value: board.board_id ?? '',
            label: board.board_name ?? 'Unnamed board',
          }))
        );
      } catch (loadError) {
        if (active) {
          console.error('Failed to load renewal ticket boards:', loadError);
          setRenewalTicketBoards([]);
        }
      }
    };

    loadRenewalTicketBoards();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    const loadRenewalTicketStatuses = async () => {
      if (!editingRenewalTicketBoardId) {
        setRenewalTicketStatuses([]);
        return;
      }

      try {
        setLoadingRenewalTicketStatuses(true);
        const statuses: IStatus[] = await getTicketStatuses(editingRenewalTicketBoardId);
        if (!active) {
          return;
        }

        setRenewalTicketStatuses(
          statuses.map((status: IStatus) => ({
            value: status.status_id,
            label: status.name,
          }))
        );

        setEditAssignments((current) => {
          if (!editingAssignmentId) {
            return current;
          }

          const currentAssignment = current[editingAssignmentId];
          if (!currentAssignment?.renewal_ticket_status_id) {
            return current;
          }

          const hasSelectedStatus = statuses.some(
            (status: IStatus) => status.status_id === currentAssignment.renewal_ticket_status_id
          );
          if (hasSelectedStatus) {
            return current;
          }

          return {
            ...current,
            [editingAssignmentId]: {
              ...currentAssignment,
              renewal_ticket_status_id: null,
            },
          };
        });
      } catch (loadError) {
        if (!active) {
          return;
        }

        console.error('Failed to load renewal ticket statuses:', loadError);
        setRenewalTicketStatuses([]);
      } finally {
        if (active) {
          setLoadingRenewalTicketStatuses(false);
        }
      }
    };

    loadRenewalTicketStatuses();

    return () => {
      active = false;
    };
  }, [editingAssignmentId, editingRenewalTicketBoardId]);

  const updateContractViewParam = useCallback((tabValue: string) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    if (tabValue === 'edit') {
      params.delete('contractView');
    } else {
      params.set('contractView', tabValue);
    }
    router.replace(`/msp/billing?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const handleTabChange = useCallback((value: string) => {
    setActiveTab(value);
    updateContractViewParam(value);
  }, [updateContractViewParam]);

  const contractsListUrl = useMemo(() => {
    const targetSubtab = contract?.is_template ? 'templates' : 'client-contracts';
    return `/msp/billing?tab=contracts&subtab=${targetSubtab}`;
  }, [contract?.is_template]);

  // Track if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!contract || !isFormInitialized) {
      return false;
    }

    // Check contract field changes
    const contractChanged =
      editContractName !== contract.contract_name ||
      editDescription !== (contract.contract_description ?? '') ||
      (!isLiveClientContract && editStatus !== contract.status) ||
      editBillingFrequency !== contract.billing_frequency;

    // Check assignment changes
    const assignmentsChanged = Object.keys(editAssignments).length > 0;

    return contractChanged || assignmentsChanged;
  }, [contract, editContractName, editDescription, editStatus, editBillingFrequency, editAssignments, isFormInitialized, isLiveClientContract]);

  useEffect(() => {
    if (contractId || clientContractId) {
      loadContractData();
    }
  }, [contractId, clientContractId]);

  // Warn before leaving page with unsaved changes (browser navigation)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Intercept internal navigation (clicking links)
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!hasUnsavedChanges) return;

      const target = e.target as HTMLElement;
      const link = target.closest('a[href]') as HTMLAnchorElement;

      if (link && link.href) {
        const currentPath = window.location.pathname + window.location.search;
        const linkPath = new URL(link.href, window.location.origin).pathname + new URL(link.href, window.location.origin).search;

        // Only intercept if navigating to a different page
        if (linkPath !== currentPath && !link.target && !link.download) {
          e.preventDefault();
          e.stopPropagation();
          setPendingNavigation(link.href);
          setShowNavigateAwayConfirm(true);
        }
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [hasUnsavedChanges]);

  // Initialize edit form when contract loads
  useEffect(() => {
    if (contract) {
      // Use a microtask to ensure state updates happen together
      Promise.resolve().then(() => {
        setEditContractName(contract.contract_name);
        setEditDescription(contract.contract_description ?? '');
        setEditStatus(contract.status);
        setEditBillingFrequency(contract.billing_frequency);
        setIsFormInitialized(true);
      });
    }
  }, [contract]);

  const loadContractData = async () => {
    setIsLoading(true);
    setError(null);
    setIsFormInitialized(false);
    setEditAssignments({});
    setEditingAssignmentId(null);
    setPreEditSnapshot(null);
    setPoAmountInputs({});

    try {
      const selectedClientContract = clientContractId
        ? await getClientContractByIdForBilling(clientContractId)
        : null;
      const detailContractId = selectedClientContract?.contract_id ?? contractId;

      if (!detailContractId) {
        setError('Contract not found');
        setContract(null);
        setSummary(null);
        setAssignments([]);
        setDocuments([]);
        return;
      }

      const [contractData, summaryData, assignmentData] = await Promise.all([
        getContractById(detailContractId),
        getContractSummary(detailContractId),
        getContractAssignments(detailContractId),
      ]);

      // Load documents separately - permission errors should not prevent contract viewing
      let documentsData: any[] = [];
      try {
        const docsResult = await getDocumentsByContractId(detailContractId);
        if (docsResult && !('permissionError' in docsResult)) {
          documentsData = docsResult;
        }
      } catch {
        // User may lack document:read permission - contract is still viewable without documents
      }

      if (!contractData) {
        setError('Contract not found');
        setContract(null);
        setSummary(null);
        setAssignments([]);
        setDocuments([]);
        return;
      }

      setContract(contractData);
      setSummary(summaryData);
      setAssignments(assignmentData);
      setDocuments(documentsData);
    } catch (err) {
      console.error('Error loading contract details:', err);
      setError('Failed to load contract');
    } finally {
      setIsLoading(false);
    }
  };

  const loadContractInvoices = useCallback(async () => {
    const invoiceScopeClientContractId = clientContractId ?? assignments[0]?.client_contract_id ?? null;
    if (!invoiceScopeClientContractId) {
      setContractInvoices([]);
      setInvoiceTemplates([]);
      setInvoiceError(null);
      return;
    }

    setIsLoadingInvoices(true);
    setInvoiceError(null);

    try {
      const [invoices, templates] = await Promise.all([
        fetchInvoicesByContract(invoiceScopeClientContractId),
        getInvoiceTemplates()
      ]);

      setContractInvoices(invoices);
      setInvoiceTemplates(templates);
    } catch (err) {
      console.error('Error loading contract invoices:', err);
      setInvoiceError('Failed to load invoices for this contract assignment.');
    } finally {
      setIsLoadingInvoices(false);
    }
  }, [assignments, clientContractId]);

  useEffect(() => {
    if (activeTab === 'invoices') {
      void loadContractInvoices();
    }
  }, [activeTab, loadContractInvoices]);

  const handleDeleteContract = async () => {
    const detailContractId = contract?.contract_id ?? contractId;
    if (!detailContractId) return;
    setIsDeleting(true);
    try {
      await deleteContract(detailContractId);
      const params = new URLSearchParams();
      params.set('tab', 'contracts');
      params.set('subtab', 'client-contracts');
      router.push(`/msp/billing?${params.toString()}`);
    } catch (err) {
      console.error('Error deleting contract:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete contract');
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const refreshSummary = async () => {
    const detailContractId = contract?.contract_id ?? contractId;
    if (!detailContractId) {
      return;
    }

    try {
      const [summaryData, assignmentData] = await Promise.all([
        getContractSummary(detailContractId),
        getContractAssignments(detailContractId)
      ]);
      setSummary(summaryData);
      setAssignments(assignmentData);
    } catch (error) {
      console.error('Error refreshing contract summary:', error);
    }
  };

  const handleContractLinesChanged = () => {
    refreshSummary();
  };

  const handleDocumentCreated = useCallback(async () => {
    // Trigger server re-fetch by refreshing the route
    // This causes page.tsx to re-run and fetch fresh documents server-side
    router.refresh();
  }, [router]);

  const handleOpenClientDrawer = async (clientId: string) => {
    openDrawer(
      <div className="p-4 text-sm text-gray-600">Loading…</div>,
      undefined,
      undefined,
      '900px'
    );
    try {
      const clientData = await getClientByIdForBilling(clientId);
      if (!clientData) {
        replaceDrawer(<div className="p-4 text-sm text-gray-600">Client not found.</div>);
        return;
      }
      replaceDrawer(
        renderClientDetails
          ? renderClientDetails({ id: 'contract-client-details', client: clientData })
          : (
              <div className="p-4 space-y-3">
                <div className="text-lg font-semibold">{clientData.client_name}</div>
                <Button
                  id="contract-open-client"
                  type="button"
                  variant="outline"
                  onClick={() => window.open(`/msp/clients/${clientData.client_id}`, '_blank', 'noopener,noreferrer')}
                >
                  Open Client
                </Button>
              </div>
            ),
        undefined,
        '900px'
      );
    } catch (error) {
      console.error('Error fetching client details:', error);
      replaceDrawer(<div className="p-4 text-sm text-red-600">Failed to load client details.</div>);
    }
  };

  const handleCancelClick = () => {
    if (hasUnsavedChanges) {
      setShowCancelConfirm(true);
    } else {
      handleTabChange('edit');
    }
  };

  const handleCancelConfirm = () => {
    // Reset all changes
    if (contract) {
      setEditContractName(contract.contract_name);
      setEditDescription(contract.contract_description ?? '');
      setEditStatus(contract.status);
      setEditBillingFrequency(contract.billing_frequency);
    }
    setEditAssignments({});
    setEditingAssignmentId(null);
    setPreEditSnapshot(null);
    setPoAmountInputs({});
    setValidationErrors([]);
    setHasAttemptedSubmit(false);
    setShowCancelConfirm(false);
    handleTabChange('edit');
  };

  const handleCancelDismiss = () => {
    setShowCancelConfirm(false);
  };

  const handleNavigateAwayConfirm = () => {
    if (pendingNavigation) {
      // Allow navigation
      window.location.href = pendingNavigation;
    }
    setShowNavigateAwayConfirm(false);
    setPendingNavigation(null);
  };

  const handleNavigateAwayDismiss = () => {
    setShowNavigateAwayConfirm(false);
    setPendingNavigation(null);
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);

    const errors: string[] = [];
    if (!editContractName.trim()) {
      errors.push(
        t('contractDetail.validation.contractName', {
          defaultValue: 'Contract name',
        })
      );
    }
    if (!editBillingFrequency) {
      errors.push(
        t('contractDetail.validation.billingFrequency', {
          defaultValue: 'Billing frequency',
        })
      );
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);

    try {
      if (!contract || !contractId) {
        setIsSaving(false);
        return;
      }
      // Build contract update payload
      const contractUpdatePayload: any = {
        contract_name: editContractName,
        contract_description: editDescription || undefined,
        billing_frequency: editBillingFrequency,
        tenant
      };

      // Only include status if the contract is not expired
      // Expired contracts cannot have their status changed manually
      if (!isLiveClientContract && contract.status !== 'expired') {
        contractUpdatePayload.status = editStatus;
      }

      // Update contract
      await updateContract(contractId, contractUpdatePayload);

      // Update any edited assignments
      for (const [assignmentId, editedAssignment] of Object.entries(editAssignments)) {
        const originalAssignment = assignments.find(a => a.client_contract_id === assignmentId);
        if (!originalAssignment) continue;

        // Build update payload with only changed fields
        const updatePayload: any = {
          tenant
        };

        // Only include fields that have changed
        if (!datesAreEqual(editedAssignment.start_date, originalAssignment.start_date)) {
          updatePayload.start_date = editedAssignment.start_date
            ? toISODate(toPlainDate(editedAssignment.start_date))
            : undefined;
        }
        if (!datesAreEqual(editedAssignment.end_date, originalAssignment.end_date)) {
          updatePayload.end_date = editedAssignment.end_date
            ? toISODate(toPlainDate(editedAssignment.end_date))
            : null;
        }
        if (editedAssignment.po_required !== originalAssignment.po_required) {
          updatePayload.po_required = editedAssignment.po_required;
        }
        if (editedAssignment.po_number !== originalAssignment.po_number) {
          updatePayload.po_number = editedAssignment.po_number;
        }
        if (editedAssignment.po_amount !== originalAssignment.po_amount) {
          // po_amount is already in cents in the state
          updatePayload.po_amount = editedAssignment.po_amount;
        }
        if (
          editedAssignment.use_tenant_renewal_defaults !== originalAssignment.use_tenant_renewal_defaults
        ) {
          updatePayload.use_tenant_renewal_defaults = editedAssignment.use_tenant_renewal_defaults;
        }
        if (editedAssignment.renewal_mode !== originalAssignment.renewal_mode) {
          updatePayload.renewal_mode = editedAssignment.renewal_mode;
        }
        if (editedAssignment.notice_period_days !== originalAssignment.notice_period_days) {
          updatePayload.notice_period_days = editedAssignment.notice_period_days;
        }
        if (editedAssignment.renewal_term_months !== originalAssignment.renewal_term_months) {
          updatePayload.renewal_term_months = editedAssignment.renewal_term_months;
        }
        if (editedAssignment.renewal_ticket_board_id !== originalAssignment.renewal_ticket_board_id) {
          updatePayload.renewal_ticket_board_id = editedAssignment.renewal_ticket_board_id ?? null;
        }
        if (editedAssignment.renewal_ticket_status_id !== originalAssignment.renewal_ticket_status_id) {
          updatePayload.renewal_ticket_status_id = editedAssignment.renewal_ticket_status_id ?? null;
        }

        // Only update if there are changes
        if (Object.keys(updatePayload).length > 1) { // More than just tenant
          await updateClientContractForBilling(assignmentId, updatePayload);
        }
      }

      await loadContractData();
      setEditingAssignmentId(null);
      setEditAssignments({});
      setIsFormInitialized(true);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error updating contract:', error);
      const errorMessage = error instanceof Error
        ? error.message
        : t('contractDetail.validation.failedToUpdate', {
          defaultValue: 'Failed to update contract',
        });
      setValidationErrors([errorMessage]);
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartEditAssignment = (assignment: IContractAssignmentSummary) => {
    setEditingAssignmentId(assignment.client_contract_id);

    // Use edited data if it exists, otherwise use original assignment data
    const dataToEdit = editAssignments[assignment.client_contract_id] || assignment;
    const normalizedData: IContractAssignmentSummary = {
      ...dataToEdit,
      start_date: dataToEdit.start_date ? toISODate(toPlainDate(dataToEdit.start_date)) : null,
      end_date: dataToEdit.end_date ? toISODate(toPlainDate(dataToEdit.end_date)) : null,
      use_tenant_renewal_defaults:
        typeof dataToEdit.use_tenant_renewal_defaults === 'boolean'
          ? dataToEdit.use_tenant_renewal_defaults
          : true,
      renewal_mode: normalizeRenewalMode(dataToEdit.renewal_mode) ?? 'manual',
      notice_period_days:
        Number.isInteger(dataToEdit.notice_period_days) && Number(dataToEdit.notice_period_days) >= 0
          ? Number(dataToEdit.notice_period_days)
          : undefined,
      renewal_term_months:
        Number.isInteger(dataToEdit.renewal_term_months) && Number(dataToEdit.renewal_term_months) > 0
          ? Number(dataToEdit.renewal_term_months)
          : undefined,
      renewal_ticket_board_id: dataToEdit.renewal_ticket_board_id ?? null,
      renewal_ticket_status_id: dataToEdit.renewal_ticket_status_id ?? null,
    };

    // Save a snapshot of the data at the start of this edit session
    setPreEditSnapshot({ ...normalizedData });

    setEditAssignments(prev => ({
      ...prev,
      [assignment.client_contract_id]: { ...normalizedData }
    }));

    // Initialize PO amount input with formatted value (convert from minor units to major units)
    if (normalizedData.po_amount != null) {
      setPoAmountInputs(prev => ({
        ...prev,
        [assignment.client_contract_id]: (Number(normalizedData.po_amount) / currencyMeta.minorUnitFactor).toFixed(
          currencyMeta.fractionDigits
        ),
      }));
    }
  };

  const handleConfirmEditAssignment = () => {
    // Just close the editor - changes are kept in editAssignments state
    setEditingAssignmentId(null);
    setPreEditSnapshot(null);
  };

  const handleCancelEditAssignment = (assignmentId: string) => {
    // Revert to the snapshot from when editing started
    if (preEditSnapshot) {
      setEditAssignments(prev => ({
        ...prev,
        [assignmentId]: { ...preEditSnapshot }
      }));

      // Update PO amount input to match the snapshot
      if (preEditSnapshot.po_amount != null) {
        setPoAmountInputs(prev => ({
          ...prev,
          [assignmentId]: (Number(preEditSnapshot.po_amount) / currencyMeta.minorUnitFactor).toFixed(
            currencyMeta.fractionDigits
          ),
        }));
      } else {
        setPoAmountInputs(prev => {
          const newState = { ...prev };
          delete newState[assignmentId];
          return newState;
        });
      }
    }

    setEditingAssignmentId(null);
    setPreEditSnapshot(null);
  };


  const handleAssignmentFieldChange = (
    assignmentId: string,
    field: keyof IContractAssignmentSummary,
    value: any
  ) => {
    setEditAssignments(prev => {
      const nextAssignment = {
        ...prev[assignmentId],
        [field]: value
      } as IContractAssignmentSummary;

      if (field === 'renewal_ticket_board_id') {
        nextAssignment.renewal_ticket_status_id = null;
      }

      return {
        ...prev,
        [assignmentId]: nextAssignment
      };
    });
  };

  const convertToDatePickerValue = (value: string | null | undefined): Date | undefined => {
    if (!value) {
      return undefined;
    }

    try {
      const plainDate = toPlainDate(value);
      return new Date(Date.UTC(plainDate.year, plainDate.month - 1, plainDate.day, 12));
    } catch (error) {
      console.error('Error converting stored date for picker:', error);
      return undefined;
    }
  };

  const handleAssignmentDateChange = (
    assignmentId: string,
    field: 'start_date' | 'end_date',
    date: Date | undefined
  ) => {
    if (!date) {
      if (field === 'end_date') {
        // Clearing the end date keeps the assignment open-ended
        handleAssignmentFieldChange(assignmentId, field, null);
      }
      return;
    }

    try {
      const isoDate = toISODate(toPlainDate(date));
      handleAssignmentFieldChange(assignmentId, field, isoDate);
    } catch (error) {
      console.error('Error handling assignment date change:', error);
    }
  };

  const datesAreEqual = (
    first: string | null | undefined,
    second: string | null | undefined
  ): boolean => {
    if (!first && !second) {
      return true;
    }
    if (!first || !second) {
      return false;
    }

    try {
      const firstPlain = toPlainDate(first);
      const secondPlain = toPlainDate(second);
      return Temporal.PlainDate.compare(firstPlain, secondPlain) === 0;
    } catch (error) {
      console.error('Error comparing dates:', error);
      return first === second;
    }
  };

  const formatInvoiceStatus = useCallback((status: BillingInvoiceViewModel['status']) => {
    return status
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }, []);

  const renderInvoiceStatusBadge = useCallback((status: BillingInvoiceViewModel['status']) => {
    const variant =
      status === 'paid'
        ? 'success'
        : status === 'draft'
          ? 'warning'
          : status === 'overdue' || status === 'cancelled'
            ? 'error'
            : 'default-muted';

    return (
      <Badge variant={variant}>
        {formatInvoiceStatus(status)}
      </Badge>
    );
  }, [formatInvoiceStatus]);

  const handleOpenInvoicePreview = useCallback((invoice: BillingInvoiceViewModel) => {
    const defaultTemplateId =
      invoiceTemplates.find((template) => template.isStandard)?.template_id ??
      invoiceTemplates[0]?.template_id;

    if (!defaultTemplateId) {
      openDrawer(
        <div className="p-4 text-sm text-red-600">
          No invoice templates are available for preview.
        </div>,
        undefined,
        undefined,
        '1100px'
      );
      return;
    }

    openDrawer(
      <ContractInvoicePreviewDrawerContent
        invoiceId={invoice.invoice_id}
        templates={invoiceTemplates}
        initialTemplateId={defaultTemplateId}
        isFinalized={invoice.status !== 'draft'}
      />,
      undefined,
      undefined,
      '1100px'
    );
  }, [invoiceTemplates, openDrawer]);

  const invoiceColumns = useMemo<ColumnDefinition<BillingInvoiceViewModel>[]>(() => [
    {
      title: 'Invoice #',
      dataIndex: 'invoice_number',
      render: (value) => value || '—',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value) => renderInvoiceStatusBadge(value),
    },
    {
      title: 'Invoice Date',
      dataIndex: 'invoice_date',
      render: (value) => formatDate(value),
    },
    {
      title: 'Due Date',
      dataIndex: 'due_date',
      render: (value) => formatDate(value),
    },
    {
      title: 'Amount',
      dataIndex: 'total_amount',
      render: (value, record) =>
        formatCurrencyFromMinorUnits(
          Number(value),
          'en-US',
          record.currencyCode || 'USD'
        ),
    },
    {
      title: 'Preview',
      dataIndex: 'invoice_id',
      width: '120px',
      render: (_, record) => (
        <Button
          id={`contract-invoice-preview-${record.invoice_id}`}
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handleOpenInvoicePreview(record);
          }}
        >
          <Eye className="h-4 w-4 mr-1" />
          Preview
        </Button>
      ),
    },
  ], [handleOpenInvoicePreview, renderInvoiceStatusBadge]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 animate-pulse">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Skeleton className="h-9 w-36 md:w-32" />
          <div className="space-y-2 md:w-1/2 lg:w-1/3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-7 w-56" />
            <div className="grid gap-2 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`metric-${index}`} className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-6 w-28" />
                </div>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={`form-field-${index}`} className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
            </CardHeader>
            <CardContent className="space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={`client-row-${index}`} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={`header-${index}`} className="h-4" />
                ))}
              </div>
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, rowIndex) => (
                  <div key={`assignment-row-${rowIndex}`} className="grid grid-cols-6 gap-3">
                    {Array.from({ length: 6 }).map((_, cellIndex) => (
                      <Skeleton
                        key={`assignment-cell-${rowIndex}-${cellIndex}`}
                        className={cn(
                          'h-9',
                          cellIndex === 5 ? 'rounded-full w-10 justify-self-center' : 'w-full'
                        )}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="p-4 space-y-4">
        <Button
          id="back-to-contracts-error"
          variant="soft"
          size="sm"
          onClick={() => router.push(contractsListUrl)}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          ← Back to Contracts
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error || 'Contract not found'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <Button
          id="back-to-contracts"
          variant="soft"
          size="sm"
          onClick={() => router.push(contractsListUrl)}
          className="gap-2 self-start"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Contracts
        </Button>
        <ContractHeader contract={contract} summary={summary} liveStatus={primaryAssignmentStatus} />
        {sourceQuote ? (
          <div>
            <Button
              id="contract-detail-open-source-quote"
              variant="outline"
              size="sm"
              onClick={() => router.push(`/msp/billing?tab=quotes&quoteId=${sourceQuote.quote_id}`)}
            >
              View Source Quote {sourceQuote.quote_number ? `(${sourceQuote.quote_number})` : ''}
            </Button>
          </div>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="mb-4 flex flex-wrap gap-2">
          <TabsTrigger value="edit">
            {t('contractDetail.tabs.overview', { defaultValue: 'Overview' })}
          </TabsTrigger>
          <TabsTrigger value="lines" disabled={isSystemManagedDefault}>
            {t('contractDetail.tabs.lines', { defaultValue: 'Contract Lines' })}
          </TabsTrigger>
          <TabsTrigger value="pricing" disabled={isSystemManagedDefault}>
            {t('contractDetail.tabs.pricing', { defaultValue: 'Pricing Schedules' })}
          </TabsTrigger>
          <TabsTrigger value="documents">
            {t('contractDetail.tabs.documents', { defaultValue: 'Documents' })}
          </TabsTrigger>
          <TabsTrigger value="invoices">
            {t('contractDetail.tabs.invoices', { defaultValue: 'Invoices' })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <div className="space-y-6">
            {hasUnsavedChanges && (
              <Alert variant="warning">
                <AlertDescription>
                  {t('contractDetail.alerts.unsavedChanges', {
                    defaultValue: 'You have unsaved changes. Click "Save Changes" to apply them.',
                  })}
                </AlertDescription>
              </Alert>
            )}

            {saveSuccess && (
              <Alert variant="success">
                <AlertDescription>
                  {t('contractDetail.alerts.saveSuccess', {
                    defaultValue: 'Contract saved successfully!',
                  })}
                </AlertDescription>
              </Alert>
            )}

            {isSystemManagedDefault ? (
              <Alert variant="info" data-testid="system-managed-default-contract-alert">
                <AlertDescription>
                  <div className="space-y-1">
                    <div className="font-medium">
                      {t('contractDetail.systemManaged.title', {
                        defaultValue: 'System-managed default contract',
                      })}
                    </div>
                    <div>
                      {t('contractDetail.systemManaged.createdAutomatically', {
                        defaultValue: 'Created automatically for uncontracted work.',
                      })}
                    </div>
                    <div>
                      {t('contractDetail.systemManaged.attributionOnly', {
                        defaultValue: 'This contract is attribution-only and does not control recurring billing behavior.',
                      })}
                    </div>
                    <div>
                      {t('contractDetail.systemManaged.configureCustom', {
                        defaultValue: 'To configure custom billing behavior, create or edit a normal user-authored contract.',
                      })}
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}

            <form onSubmit={handleEditSubmit} className="space-y-6" noValidate>
              {hasAttemptedSubmit && validationErrors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {validationErrors.length === 1 && validationErrors[0].includes('Cannot set contract to draft') ? (
                      <p>{validationErrors[0]}</p>
                    ) : (
                      <>
                        <p className="font-medium mb-2">
                          {t('contractDetail.validation.fixErrors', {
                            defaultValue: 'Please fix the following errors:',
                          })}
                        </p>
                        <ul className="list-disc list-inside space-y-1">
                          {validationErrors.map((err, index) => (
                            <li key={index}>{err}</li>
                          ))}
                        </ul>
                      </>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Contract identity - Details, Snapshot, Client */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Pencil className="h-4 w-4 text-blue-600" />
                      {t('contractDetail.detailsCard.title', { defaultValue: 'Contract Details' })}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="edit-contract-name">
                          {t('contractDetail.detailsCard.contractNameLabel', {
                            defaultValue: 'Contract Name *',
                          })}
                        </Label>
                        {isSystemManagedDefault ? (
                          <Badge variant="info">
                            {t('contractDetail.labels.systemManagedDefault', {
                              defaultValue: 'System-managed default',
                            })}
                          </Badge>
                        ) : null}
                        {!isEditingName && (
                          <Button
                            id="edit-contract-name-btn"
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setIsEditingName(true)}
                            className="h-5 w-5 p-0"
                            disabled={isSystemManagedDefault}
                            aria-label={t('contractDetail.detailsCard.actions.editName', {
                              defaultValue: 'Edit contract name',
                            })}
                            title={t('contractDetail.detailsCard.actions.editName', {
                              defaultValue: 'Edit contract name',
                            })}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      {isSystemManagedDefault ? (
                        <p className="text-xs text-muted-foreground">
                          {t('contractDetail.systemManaged.createdAutomatically', {
                            defaultValue: 'Created automatically for uncontracted work.',
                          })}
                        </p>
                      ) : null}
                      {isEditingName ? (
                        <div className="flex items-center gap-2">
                          <Input
                            id="edit-contract-name"
                            value={editContractName}
                            onChange={(e) => {
                              setEditContractName(e.target.value);
                              clearErrorIfSubmitted();
                            }}
                            placeholder={t('contractDetail.detailsCard.contractNamePlaceholder', {
                              defaultValue: 'Enter contract name',
                            })}
                            required
                            className={hasAttemptedSubmit && !editContractName.trim() ? 'border-red-500' : ''}
                          />
                          <Button
                            id="save-contract-name"
                            type="button"
                            size="sm"
                            onClick={() => setIsEditingName(false)}
                            aria-label={t('contractDetail.detailsCard.actions.saveName', {
                              defaultValue: 'Save contract name',
                            })}
                            title={t('contractDetail.detailsCard.actions.saveName', {
                              defaultValue: 'Save contract name',
                            })}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            id="cancel-contract-name"
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditContractName(contract.contract_name);
                              setIsEditingName(false);
                            }}
                            aria-label={t('contractDetail.detailsCard.actions.cancelName', {
                              defaultValue: 'Cancel contract name',
                            })}
                            title={t('contractDetail.detailsCard.actions.cancelName', {
                              defaultValue: 'Cancel contract name',
                            })}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-base font-medium text-foreground">{editContractName}</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="edit-description">
                          {t('contractDetail.detailsCard.descriptionLabel', {
                            defaultValue: 'Description',
                          })}
                        </Label>
                        {!isEditingDescription && (
                          <Button
                            id="edit-description-btn"
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setIsEditingDescription(true)}
                            className="h-5 w-5 p-0"
                            disabled={isSystemManagedDefault}
                            aria-label={t('contractDetail.detailsCard.actions.editDescription', {
                              defaultValue: 'Edit contract description',
                            })}
                            title={t('contractDetail.detailsCard.actions.editDescription', {
                              defaultValue: 'Edit contract description',
                            })}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      {isEditingDescription ? (
                        <div className="space-y-2">
                          <TextArea
                            id="edit-description"
                            value={editDescription}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditDescription(e.target.value)}
                            placeholder={t('contractDetail.detailsCard.descriptionPlaceholder', {
                              defaultValue: 'Enter contract description',
                            })}
                            className="min-h-[100px]"
                          />
                          <div className="flex gap-2">
                            <Button
                              id="save-description"
                              type="button"
                              size="sm"
                              onClick={() => setIsEditingDescription(false)}
                              aria-label={t('contractDetail.detailsCard.actions.saveDescription', {
                                defaultValue: 'Save description',
                              })}
                              title={t('contractDetail.detailsCard.actions.saveDescription', {
                                defaultValue: 'Save description',
                              })}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              id="cancel-description"
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditDescription(contract.contract_description ?? '');
                                setIsEditingDescription(false);
                              }}
                              aria-label={t('contractDetail.detailsCard.actions.cancelDescription', {
                                defaultValue: 'Cancel description edits',
                              })}
                              title={t('contractDetail.detailsCard.actions.cancelDescription', {
                                defaultValue: 'Cancel description edits',
                              })}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-base text-[rgb(var(--color-text-700))]">
                          {editDescription || t('contractDetail.labels.noDescription', { defaultValue: 'No description' })}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <FileText className="h-4 w-4 text-purple-600" />
                      Contract Header
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-[rgb(var(--color-text-700))]">
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">
                          {isLiveClientContract ? 'Assignment Status' : 'Status'}
                        </span>
                        {isLiveClientContract ? (
                          <>
                            <Badge
                              variant={
                                primaryAssignmentStatus === 'active'
                                  ? 'success'
                                  : primaryAssignmentStatus === 'terminated'
                                    ? 'warning'
                                    : primaryAssignmentStatus === 'expired'
                                      ? 'error'
                                      : 'default-muted'
                              }
                            >
                              {primaryAssignmentStatus === 'active'
                                ? 'Active'
                                : primaryAssignmentStatus === 'terminated'
                                  ? 'Terminated'
                                  : primaryAssignmentStatus === 'expired'
                                    ? 'Expired'
                                    : 'Draft'}
                            </Badge>
                            <p className="text-xs text-muted-foreground">
                              Live client status is controlled by the assignment lifecycle below.
                            </p>
                          </>
                        ) : (
                          <>
                            <CustomSelect
                              id="edit-status"
                              value={editStatus}
                              onValueChange={(value) => setEditStatus(value)}
                              options={[
                                { value: 'active', label: 'Active' },
                                { value: 'draft', label: 'Draft' },
                                { value: 'terminated', label: 'Terminated' },
                                ...(contract.status === 'expired' ? [{ value: 'expired', label: 'Expired' }] : [])
                              ]}
                              disabled={contract.status === 'expired' || isSystemManagedDefault}
                            />
                            {contract.status === 'expired' && (
                              <p className="text-xs text-muted-foreground">
                                Expired contracts cannot be changed to another status
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-muted-foreground">Billing Frequency *</span>
                        <CustomSelect
                          id="edit-billing-frequency"
                          value={editBillingFrequency}
                          onValueChange={(value) => {
                            setEditBillingFrequency(value);
                            clearErrorIfSubmitted();
                          }}
                          options={BILLING_FREQUENCY_OPTIONS}
                          placeholder="Select billing frequency"
                          className={hasAttemptedSubmit && !editBillingFrequency ? 'ring-1 ring-red-500' : ''}
                          disabled={isSystemManagedDefault}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Currency</span>
                      <span className="font-medium">{contract.currency_code || 'USD'}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Created</span>
                      <span className="font-medium">{formatDate(contract.created_at)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Last Updated</span>
                      <span className="font-medium">{formatDate(contract.updated_at)}</span>
                    </div>
                    {primaryAssignment && (
                      <div className="rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-surface-50))] p-3 space-y-1.5">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Renewal</p>
                        <div className="flex items-center justify-between">
                          <span>Mode</span>
                          <span className="font-medium">
                            {primaryAssignment.end_date
                              ? formatRenewalModeLabel(primaryAssignmentRenewalMode)
                              : 'Ongoing (no end date)'}
                          </span>
                        </div>
                        {primaryAssignment.end_date && (
                          <div className="flex items-center justify-between">
                            <span>Source</span>
                            <span className="font-medium">
                              {primaryAssignmentUsesTenantRenewalDefaults ? 'Tenant defaults' : 'Custom settings'}
                            </span>
                          </div>
                        )}
                        {primaryAssignment.end_date &&
                          primaryAssignmentRenewalMode !== 'none' &&
                          primaryAssignmentNoticePeriod !== undefined && (
                            <div className="flex items-center justify-between">
                              <span>Notice</span>
                              <span className="font-medium">
                                {primaryAssignmentNoticePeriod} day{primaryAssignmentNoticePeriod === 1 ? '' : 's'}
                              </span>
                            </div>
                          )}
                        {primaryAssignment.end_date && primaryAssignment.decision_due_date && (
                          <div className="flex items-center justify-between">
                            <span>Decision Due</span>
                            <span className="font-medium">{formatDate(primaryAssignment.decision_due_date)}</span>
                          </div>
                        )}
                      </div>
                    )}
                    {editDescription && (
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Description</p>
                        <p className="text-sm text-[rgb(var(--color-text-800))]">{editDescription}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Users className="h-4 w-4 text-emerald-600" />
                      Client Ownership
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-[rgb(var(--color-text-700))]">
                    {isSystemManagedDefault ? (
                      <p className="text-xs text-muted-foreground">
                        Ownership is system-managed for this default contract.
                      </p>
                    ) : null}
                    {assignments.length === 0 ? (
                      <p className="text-muted-foreground">No client assigned to this contract yet.</p>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <span>Owner Client</span>
                          <span className="font-medium">
                            {primaryAssignment?.client_name || primaryAssignment?.client_id || contract.owner_client_id || '—'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Client Name</span>
                          <button
                            type="button"
                            onClick={() => handleOpenClientDrawer(assignments[0].client_id)}
                            className="font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {assignments[0].client_name || assignments[0].client_id}
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Assignment Status</span>
                          <Badge variant={
                            primaryAssignmentStatus === 'active' ? 'success' :
                            primaryAssignmentStatus === 'terminated' ? 'warning' :
                            primaryAssignmentStatus === 'expired' ? 'error' :
                            'default-muted'
                          }>
                            {primaryAssignmentStatus === 'active' ? 'Active' :
                             primaryAssignmentStatus === 'terminated' ? 'Terminated' :
                             primaryAssignmentStatus === 'expired' ? 'Expired' :
                             'Draft'}
                          </Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Start Date</span>
                          <span className="font-medium">{formatDate(assignments[0].start_date)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>End Date</span>
                          <span className="font-medium">
                            {assignments[0].end_date ? formatDate(assignments[0].end_date) : 'Ongoing'}
                          </span>
                        </div>
                    {assignments[0].po_required && (
                      <>
                            <div className="flex items-center justify-between">
                              <span>PO Number</span>
                              <span className="font-medium">
                                {assignments[0].po_number || <span className="text-orange-600">Required</span>}
                              </span>
                            </div>
                            {assignments[0].po_amount != null && (
                              <div className="flex items-center justify-between">
                                <span>PO Amount</span>
                                <span className="font-medium">
                                  {formatCurrencyFromMinorUnits(
                                    Number(assignments[0].po_amount),
                                    'en-US',
                                    currencyMeta.currencyCode
                                  )}
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Contract Overview - What's included at a glance */}
              {contractId ? (
                <ContractOverview
                  contractId={contractId}
                  onNavigateToLines={() => handleTabChange('lines')}
                />
              ) : null}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4 text-sky-600" />
                    Client Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {assignments.length === 0 ? (
                    <div className="py-6 text-sm text-muted-foreground">
                      This contract is not assigned to a client yet.
                    </div>
                  ) : (
                    assignments.map((assignment) => {
                      const isEditing = editingAssignmentId === assignment.client_contract_id;
                      const editData = editAssignments[assignment.client_contract_id] || assignment;
                      const supportsPo = typeof editData.po_required !== 'undefined';

                      return (
                        <div
                          key={assignment.client_contract_id}
                          className="rounded-lg border border-[rgb(var(--color-border-200))] bg-muted p-4 space-y-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-[rgb(var(--color-text-900))]">
                                {assignment.client_name || assignment.client_id}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Client Contract ID: {assignment.client_contract_id}
                              </p>
                            </div>
                            {isEditing ? (
                              <div className="flex gap-2">
                                <Button
                                  id={`confirm-assignment-${assignment.client_contract_id}`}
                                  type="button"
                                  size="sm"
                                  onClick={handleConfirmEditAssignment}
                                  className="gap-2"
                                >
                                  <Check className="h-4 w-4" />
                                  Save
                                </Button>
                                <Button
                                  id={`cancel-assignment-${assignment.client_contract_id}`}
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCancelEditAssignment(assignment.client_contract_id)}
                                  className="gap-2"
                                >
                                  <X className="h-4 w-4" />
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                id={`edit-assignment-${assignment.client_contract_id}`}
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleStartEditAssignment(assignment)}
                                className="gap-2"
                                disabled={isSystemManagedDefault}
                              >
                                <Pencil className="h-4 w-4" />
                                Edit
                              </Button>
                            )}
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                Start Date
                              </Label>
                              {isEditing ? (
                                <div
                                  className="mt-1 w-full md:w-56"
                                  title={
                                    contract.status === 'active'
                                      ? 'Start date cannot be changed for active contracts'
                                      : undefined
                                  }
                                >
                                  <DatePicker
                                    id={`assignment-start-date-${assignment.client_contract_id}`}
                                    value={convertToDatePickerValue(editData.start_date)}
                                    onChange={(date) =>
                                      handleAssignmentDateChange(
                                        assignment.client_contract_id,
                                        'start_date',
                                        date
                                      )
                                    }
                                    className="w-full"
                                    placeholder="Select start date"
                                    label="Assignment start date"
                                    disabled={contract.status === 'active'}
                                  />
                                </div>
                              ) : (
                                <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                  {formatDate(editData.start_date)}
                                </p>
                              )}
                            </div>
                            <div>
                              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                End Date
                              </Label>
                              {isEditing ? (
                                <div className="mt-1 w-full md:w-56">
                                  <DatePicker
                                    id={`assignment-end-date-${assignment.client_contract_id}`}
                                    value={convertToDatePickerValue(editData.end_date)}
                                    onChange={(date) =>
                                      handleAssignmentDateChange(
                                        assignment.client_contract_id,
                                        'end_date',
                                        date
                                      )
                                    }
                                    className="w-full"
                                    placeholder="Ongoing"
                                    label="Assignment end date"
                                    clearable
                                  />
                                </div>
                              ) : (
                                <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                  {editData.end_date ? formatDate(editData.end_date) : 'Ongoing'}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                Renewal Handling
                              </Label>
                              {isEditing ? (
                                <div className="space-y-3 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-surface-50))] p-3">
                                  <div className="flex items-center justify-between">
                                    <Label
                                      htmlFor={`assignment-use-tenant-renewal-defaults-${assignment.client_contract_id}`}
                                      className="text-sm"
                                    >
                                      Use tenant renewal defaults
                                    </Label>
                                    <Switch
                                      id={`assignment-use-tenant-renewal-defaults-${assignment.client_contract_id}`}
                                      checked={editData.use_tenant_renewal_defaults !== false}
                                      onCheckedChange={(checked) =>
                                        handleAssignmentFieldChange(
                                          assignment.client_contract_id,
                                          'use_tenant_renewal_defaults',
                                          checked
                                        )
                                      }
                                    />
                                  </div>

                                  {editData.use_tenant_renewal_defaults === false && (
                                    <div className="space-y-2">
                                      <Label htmlFor={`assignment-renewal-mode-${assignment.client_contract_id}`} className="text-sm">
                                        Renewal Mode
                                      </Label>
                                      <CustomSelect
                                        id={`assignment-renewal-mode-${assignment.client_contract_id}`}
                                        options={renewalModeOptions}
                                        value={normalizeRenewalMode(editData.renewal_mode) ?? 'manual'}
                                        onValueChange={(value) =>
                                          handleAssignmentFieldChange(
                                            assignment.client_contract_id,
                                            'renewal_mode',
                                            value as 'none' | 'manual' | 'auto'
                                          )
                                        }
                                        className="w-full"
                                        placeholder="Select renewal mode"
                                      />
                                    </div>
                                  )}

                                  {editData.use_tenant_renewal_defaults === false &&
                                    (normalizeRenewalMode(editData.renewal_mode) ?? 'manual') !== 'none' && (
                                      <div className="space-y-2">
                                        <Label htmlFor={`assignment-notice-period-${assignment.client_contract_id}`} className="text-sm">
                                          Notice Period (Days)
                                        </Label>
                                        <Input
                                          id={`assignment-notice-period-${assignment.client_contract_id}`}
                                          type="number"
                                          min={0}
                                          step={1}
                                          value={editData.notice_period_days ?? ''}
                                          onChange={(event) => {
                                            const raw = event.target.value.trim();
                                            if (!raw) {
                                              handleAssignmentFieldChange(
                                                assignment.client_contract_id,
                                                'notice_period_days',
                                                undefined
                                              );
                                              return;
                                            }
                                            const parsed = Number.parseInt(raw, 10);
                                            handleAssignmentFieldChange(
                                              assignment.client_contract_id,
                                              'notice_period_days',
                                              Number.isFinite(parsed) ? Math.max(0, parsed) : undefined
                                            );
                                          }}
                                          placeholder="e.g., 30"
                                        />
                                      </div>
                                    )}

                                  {editData.use_tenant_renewal_defaults === false &&
                                    (normalizeRenewalMode(editData.renewal_mode) ?? 'manual') === 'auto' && (
                                      <div className="space-y-2">
                                        <Label htmlFor={`assignment-renewal-term-${assignment.client_contract_id}`} className="text-sm">
                                          Renewal Term (Months)
                                        </Label>
                                        <Input
                                          id={`assignment-renewal-term-${assignment.client_contract_id}`}
                                          type="number"
                                          min={1}
                                          step={1}
                                          value={editData.renewal_term_months ?? ''}
                                          onChange={(event) => {
                                            const raw = event.target.value.trim();
                                            if (!raw) {
                                              handleAssignmentFieldChange(
                                                assignment.client_contract_id,
                                                'renewal_term_months',
                                                undefined
                                              );
                                              return;
                                            }
                                            const parsed = Number.parseInt(raw, 10);
                                            handleAssignmentFieldChange(
                                              assignment.client_contract_id,
                                              'renewal_term_months',
                                              Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
                                            );
                                          }}
                                          placeholder="e.g., 12"
                                        />
                                      </div>
                                    )}

                                  {editData.use_tenant_renewal_defaults === false && (
                                    <div className="space-y-2">
                                      <Label htmlFor={`assignment-renewal-ticket-board-${assignment.client_contract_id}`} className="text-sm">
                                        Renewal Ticket Board
                                      </Label>
                                      <CustomSelect
                                        id={`assignment-renewal-ticket-board-${assignment.client_contract_id}`}
                                        options={renewalTicketBoards}
                                        value={editData.renewal_ticket_board_id ?? ''}
                                        onValueChange={(value) =>
                                          handleAssignmentFieldChange(
                                            assignment.client_contract_id,
                                            'renewal_ticket_board_id',
                                            value || null
                                          )
                                        }
                                        className="w-full"
                                        placeholder="Select board"
                                      />
                                    </div>
                                  )}

                                  {editData.use_tenant_renewal_defaults === false && (
                                    <div className="space-y-2">
                                      <Label htmlFor={`assignment-renewal-ticket-status-${assignment.client_contract_id}`} className="text-sm">
                                        Renewal Ticket Status
                                      </Label>
                                      <CustomSelect
                                        id={`assignment-renewal-ticket-status-${assignment.client_contract_id}`}
                                        options={renewalTicketStatuses}
                                        value={editData.renewal_ticket_status_id ?? ''}
                                        onValueChange={(value) =>
                                          handleAssignmentFieldChange(
                                            assignment.client_contract_id,
                                            'renewal_ticket_status_id',
                                            value || null
                                          )
                                        }
                                        className="w-full"
                                        placeholder={
                                          editData.renewal_ticket_board_id
                                            ? (loadingRenewalTicketStatuses ? 'Loading statuses...' : 'Select status')
                                            : 'Select a board first'
                                        }
                                        disabled={!editData.renewal_ticket_board_id || loadingRenewalTicketStatuses}
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <p className="text-sm text-[rgb(var(--color-text-800))]">
                                    {formatRenewalModeLabel(
                                      editData.effective_renewal_mode ?? editData.renewal_mode
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {editData.use_tenant_renewal_defaults !== false
                                      ? 'Using tenant defaults'
                                      : 'Using custom assignment settings'}
                                  </p>
                                  {(editData.effective_notice_period_days ?? editData.notice_period_days) !== undefined && (
                                    <p className="text-xs text-muted-foreground">
                                      Notice:{' '}
                                      {editData.effective_notice_period_days ?? editData.notice_period_days} day
                                      {(editData.effective_notice_period_days ?? editData.notice_period_days) === 1 ? '' : 's'}
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="space-y-2">
                              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                Decision Due
                              </Label>
                              <p className="text-sm text-[rgb(var(--color-text-800))]">
                                {editData.decision_due_date ? formatDate(editData.decision_due_date) : '—'}
                              </p>
                            </div>
                          </div>

                          {supportsPo && (
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  PO Required
                                </Label>
                                {isEditing ? (
                                  <div className="mt-2">
                                    <Switch
                                      id={`po-required-${assignment.client_contract_id}`}
                                      checked={Boolean(editData.po_required)}
                                      onCheckedChange={(checked) => {
                                        handleAssignmentFieldChange(
                                          assignment.client_contract_id,
                                          'po_required',
                                          checked
                                        );
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                    {editData.po_required ? 'Yes' : 'No'}
                                  </p>
                                )}
                              </div>
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  PO Number
                                </Label>
                                {isEditing ? (
                                  <Input
                                    value={editData.po_number || ''}
                                    onChange={(e) =>
                                      handleAssignmentFieldChange(
                                        assignment.client_contract_id,
                                        'po_number',
                                        e.target.value || null
                                      )
                                    }
                                    placeholder="PO Number"
                                    className="mt-1 w-full max-w-xs"
                                    disabled={!editData.po_required}
                                  />
                                ) : (
                                  <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                    {editData.po_required
                                      ? editData.po_number || (
                                          <span className="text-orange-600">Required</span>
                                        )
                                      : 'Not required'}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}

                          {supportsPo && (
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                                  PO Amount
                                </Label>
                                {isEditing ? (
                                  <div className="relative mt-1 w-full max-w-xs">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                      {currencyMeta.symbol}
                                    </span>
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      value={poAmountInputs[assignment.client_contract_id] || ''}
                                      onChange={(e) => {
                                        const value = e.target.value.replace(/[^0-9.]/g, '');
                                        const decimalCount = (value.match(/\./g) || []).length;
                                        if (decimalCount <= 1) {
                                          setPoAmountInputs((prev) => ({
                                            ...prev,
                                            [assignment.client_contract_id]: value,
                                          }));
                                        }
                                      }}
                                      onBlur={() => {
                                        const input =
                                          poAmountInputs[assignment.client_contract_id] || '';
                                        if (input.trim() === '' || input === '.') {
                                          setPoAmountInputs((prev) => ({
                                            ...prev,
                                            [assignment.client_contract_id]: '',
                                          }));
                                          handleAssignmentFieldChange(
                                            assignment.client_contract_id,
                                            'po_amount',
                                            null
                                          );
                                        } else {
                                          const majorUnits = parseFloat(input) || 0;
                                          const minorUnits = Math.round(majorUnits * currencyMeta.minorUnitFactor);
                                          handleAssignmentFieldChange(
                                            assignment.client_contract_id,
                                            'po_amount',
                                            minorUnits
                                          );
                                          setPoAmountInputs((prev) => ({
                                            ...prev,
                                            [assignment.client_contract_id]: majorUnits.toFixed(currencyMeta.fractionDigits),
                                          }));
                                        }
                                      }}
                                      placeholder={
                                        currencyMeta.fractionDigits === 0
                                          ? '0'
                                          : `0.${'0'.repeat(currencyMeta.fractionDigits)}`
                                      }
                                      className="pl-10"
                                      disabled={!editData.po_required}
                                    />
                                  </div>
                                ) : (
                                  <p className="mt-1 text-sm text-[rgb(var(--color-text-800))]">
                                    {editData.po_amount != null
                                      ? formatCurrencyFromMinorUnits(
                                          Number(editData.po_amount),
                                          'en-US',
                                          currencyMeta.currencyCode
                                        )
                                      : '—'}
                                  </p>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Package className="h-4 w-4 text-purple-600" />
                    Quick Actions
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-3">
                  <Button
                    id="edit-manage-lines"
                    variant="outline"
                    onClick={() => handleTabChange('lines')}
                    disabled={isSystemManagedDefault}
                  >
                    <Layers3 className="mr-2 h-4 w-4" />
                    Manage Contract Lines
                  </Button>
                  <Button
                    id="edit-manage-pricing"
                    variant="outline"
                    onClick={() => handleTabChange('pricing')}
                    disabled={isSystemManagedDefault}
                  >
                    <CalendarClock className="mr-2 h-4 w-4" />
                    Manage Pricing Schedules
                  </Button>
                  <Button id="edit-view-documents" variant="outline" onClick={() => handleTabChange('documents')}>
                    <File className="mr-2 h-4 w-4" />
                    View Documents
                  </Button>
                  <Button id="edit-view-invoices" variant="outline" onClick={() => handleTabChange('invoices')}>
                    <FileText className="mr-2 h-4 w-4" />
                    View Invoices
                  </Button>
                  {!isSystemManagedDefault ? (
                    <Button
                      id="delete-contract-btn"
                      variant="destructive"
                      onClick={() => setShowDeleteConfirm(true)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete Contract
                    </Button>
                  ) : null}
                </CardContent>
              </Card>

              <div className="flex justify-end gap-3">
                <Button
                  id="cancel-edit-contract-btn"
                  type="button"
                  variant="outline"
                  onClick={handleCancelClick}
                >
                  Cancel
                </Button>
                <Button
                  id="save-edit-contract-btn"
                  type="submit"
                  disabled={isSaving || isSystemManagedDefault}
                  className={!editContractName.trim() || !editBillingFrequency ? 'opacity-50' : ''}
                >
                  <span className={hasUnsavedChanges ? 'font-bold' : ''}>
                    {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes *' : 'Save Changes'}
                  </span>
                  {!isSaving && <Save className="ml-2 h-4 w-4" />}
                </Button>
              </div>
            </form>
          </div>
        </TabsContent>

        <TabsContent value="lines">
          <ContractLines
            contract={contract}
            onContractLinesChanged={handleContractLinesChanged}
            isReadOnly={isSystemManagedDefault}
          />
        </TabsContent>

        <TabsContent value="pricing">
          <PricingSchedules contractId={contract.contract_id} isReadOnly={isSystemManagedDefault} />
        </TabsContent>

        <TabsContent value="documents">
          {currentUserId ? renderDocuments({
              id: "contract-documents",
              documents,
              userId: currentUserId,
              entityId: contractId,
              entityType: "contract",
              onDocumentCreated: handleDocumentCreated,
          }) : (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">
                Loading documents...
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                Contract Invoices
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Select an invoice to open a full preview in the drawer.
                </p>
                <Button
                  id="contract-invoices-refresh"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadContractInvoices()}
                  disabled={isLoadingInvoices}
                >
                  Refresh
                </Button>
              </div>

              {invoiceError && (
                <Alert variant="destructive">
                  <AlertDescription>{invoiceError}</AlertDescription>
                </Alert>
              )}

              {isLoadingInvoices ? (
                <div className="py-10">
                  <LoadingIndicator text="Loading contract invoices..." spinnerProps={{ size: 'sm' }} />
                </div>
              ) : contractInvoices.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No invoices are associated with this contract yet.
                </div>
              ) : (
                <DataTable
                  id="contract-invoices-table"
                  data={contractInvoices}
                  columns={invoiceColumns}
                  pagination={false}
                  onRowClick={handleOpenInvoicePreview}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ConfirmationDialog
        isOpen={showCancelConfirm}
        onClose={handleCancelDismiss}
        onConfirm={handleCancelConfirm}
        title="Discard Changes"
        message="Are you sure you want to discard all changes? Any unsaved changes will be lost."
        confirmLabel="Discard Changes"
        cancelLabel="Continue Editing"
      />

      <ConfirmationDialog
        isOpen={showNavigateAwayConfirm}
        onClose={handleNavigateAwayDismiss}
        onConfirm={handleNavigateAwayConfirm}
        title="Unsaved Changes"
        message="You have unsaved changes. Are you sure you want to leave this page? All changes will be lost."
        confirmLabel="Leave Page"
        cancelLabel="Stay on Page"
      />

      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDeleteContract}
        title="Delete Contract"
        message="Are you sure you want to delete this contract? This action cannot be undone and will remove all associated data."
        confirmLabel={isDeleting ? 'Deleting…' : 'Delete Contract'}
        cancelLabel="Cancel"
        isConfirming={isDeleting}
      />
    </div>
  );
};

export default ContractDetail;
