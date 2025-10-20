'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle, CalendarClock, FileText, Layers3, Package, Users, Save, Pencil, X, Check, ArrowLeft } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Switch } from 'server/src/components/ui/Switch';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import Drawer from 'server/src/components/ui/Drawer';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { IContract, IContractAssignmentSummary } from 'server/src/interfaces/contract.interfaces';
import { IClient } from 'server/src/interfaces';
import {
  getContractById,
  getContractSummary,
  getContractAssignments,
  updateContract,
  IContractSummary
} from 'server/src/lib/actions/contractActions';
import { updateClientContract } from 'server/src/lib/actions/client-actions/clientContractActions';
import { getClientById } from 'server/src/lib/actions/client-actions/clientActions';
import { BILLING_FREQUENCY_OPTIONS } from 'server/src/constants/billing';
import { useTenant } from 'server/src/components/TenantProvider';
import ContractHeader from './ContractHeader';
import ContractLines from './ContractLines';
import PricingSchedules from './PricingSchedules';
import ClientDetails from 'server/src/components/clients/ClientDetails';
import { Temporal } from '@js-temporal/polyfill';
import { toPlainDate, toISODate } from 'server/src/lib/utils/dateTimeUtils';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Skeleton } from 'server/src/components/ui/Skeleton';
import { cn } from 'server/src/lib/utils';

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

const ContractDetail: React.FC = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const contractId = searchParams?.get('contractId') as string;
  const tenant = useTenant()!;

  const [contract, setContract] = useState<IContract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('edit');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [summary, setSummary] = useState<IContractSummary | null>(null);
  const [assignments, setAssignments] = useState<IContractAssignmentSummary[]>([]);

  // Client drawer state
  const [quickViewClient, setQuickViewClient] = useState<IClient | null>(null);
  const [isQuickViewOpen, setIsQuickViewOpen] = useState(false);

  // Confirmation dialog state
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [showNavigateAwayConfirm, setShowNavigateAwayConfirm] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // Edit tab state
  const [editContractName, setEditContractName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState<string>('draft');
  const [editBillingFrequency, setEditBillingFrequency] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [isFormInitialized, setIsFormInitialized] = useState(false);

  // Assignment editing state
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [editAssignments, setEditAssignments] = useState<Record<string, IContractAssignmentSummary>>({});
  const [preEditSnapshot, setPreEditSnapshot] = useState<IContractAssignmentSummary | null>(null);

  // Contract fields editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);

  // PO Amount input state for formatting (stores display value while editing)
  const [poAmountInputs, setPoAmountInputs] = useState<Record<string, string>>({});

  // Track if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!contract || !isFormInitialized) {
      return false;
    }

    // Check contract field changes
    const contractChanged =
      editContractName !== contract.contract_name ||
      editDescription !== (contract.contract_description ?? '') ||
      editStatus !== contract.status ||
      editBillingFrequency !== contract.billing_frequency;

    // Check assignment changes
    const assignmentsChanged = Object.keys(editAssignments).length > 0;

    return contractChanged || assignmentsChanged;
  }, [contract, editContractName, editDescription, editStatus, editBillingFrequency, editAssignments, isFormInitialized]);

  useEffect(() => {
    if (contractId) {
      loadContractData();
    }
  }, [contractId]);

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
      const [contractData, summaryData, assignmentData] = await Promise.all([
        getContractById(contractId),
        getContractSummary(contractId),
        getContractAssignments(contractId)
      ]);

      if (!contractData) {
        setError('Contract not found');
        setContract(null);
        setSummary(null);
        setAssignments([]);
        return;
      }

      setContract(contractData);
      setSummary(summaryData);
      setAssignments(assignmentData);
    } catch (err) {
      console.error('Error loading contract details:', err);
      setError('Failed to load contract');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshSummary = async () => {
    if (!contractId) {
      return;
    }

    try {
      const [summaryData, assignmentData] = await Promise.all([
        getContractSummary(contractId),
        getContractAssignments(contractId)
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

  const handleOpenClientDrawer = async (clientId: string) => {
    try {
      const clientData = await getClientById(clientId);
      if (clientData) {
        setQuickViewClient(clientData);
        setIsQuickViewOpen(true);
      }
    } catch (error) {
      console.error('Error fetching client details:', error);
    }
  };

  const handleCancelClick = () => {
    if (hasUnsavedChanges) {
      setShowCancelConfirm(true);
    } else {
      setActiveTab('edit');
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
    setActiveTab('edit');
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
      errors.push('Contract name');
    }
    if (!editBillingFrequency) {
      errors.push('Billing frequency');
    }

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setValidationErrors([]);
    setIsSaving(true);

    try {
      if (!contract) {
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
      if (contract.status !== 'expired') {
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

        // Only update if there are changes
        if (Object.keys(updatePayload).length > 1) { // More than just tenant
          await updateClientContract(assignmentId, updatePayload);
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
      const errorMessage = error instanceof Error ? error.message : 'Failed to update contract';
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
      end_date: dataToEdit.end_date ? toISODate(toPlainDate(dataToEdit.end_date)) : null
    };

    // Save a snapshot of the data at the start of this edit session
    setPreEditSnapshot({ ...normalizedData });

    setEditAssignments(prev => ({
      ...prev,
      [assignment.client_contract_id]: { ...normalizedData }
    }));

    // Initialize PO amount input with formatted value (convert from cents to dollars)
    if (normalizedData.po_amount != null) {
      setPoAmountInputs(prev => ({
        ...prev,
        [assignment.client_contract_id]: (Number(normalizedData.po_amount) / 100).toFixed(2)
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
          [assignmentId]: (Number(preEditSnapshot.po_amount) / 100).toFixed(2)
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
    setEditAssignments(prev => ({
      ...prev,
      [assignmentId]: {
        ...prev[assignmentId],
        [field]: value
      }
    }));
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
          variant="ghost"
          size="sm"
          onClick={() => router.push('/msp/billing?tab=contracts')}
          className="gap-2 px-0 text-sm text-blue-600 hover:text-blue-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Contracts
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
          variant="ghost"
          size="sm"
          onClick={() => router.push('/msp/billing?tab=contracts')}
          className="gap-2 px-0 text-sm text-blue-600 hover:text-blue-800 self-start"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Contracts
        </Button>
        <ContractHeader contract={contract} summary={summary} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 flex flex-wrap gap-2">
          <TabsTrigger value="edit">Overview</TabsTrigger>
          <TabsTrigger value="lines">Contract Lines</TabsTrigger>
          <TabsTrigger value="pricing">Pricing Schedules</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="edit">
          <div className="space-y-6">
            {hasUnsavedChanges && (
              <Alert className="bg-amber-50 border-amber-200">
                <AlertDescription className="text-amber-800 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>You have unsaved changes. Click "Save Changes" to apply them.</span>
                </AlertDescription>
              </Alert>
            )}

            {saveSuccess && (
              <Alert className="bg-green-50 border-green-200">
                <AlertDescription className="text-green-800">
                  Contract saved successfully!
                </AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleEditSubmit} className="space-y-6" noValidate>
              {hasAttemptedSubmit && validationErrors.length > 0 && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {validationErrors.length === 1 && validationErrors[0].includes('Cannot set contract to draft') ? (
                      <p>{validationErrors[0]}</p>
                    ) : (
                      <>
                        <p className="font-medium mb-2">Please fix the following errors:</p>
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

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Pencil className="h-4 w-4 text-blue-600" />
                      Contract Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="edit-contract-name">Contract Name *</Label>
                        {!isEditingName && (
                          <Button
                            id="edit-contract-name-btn"
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setIsEditingName(true)}
                            className="h-5 w-5 p-0"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      {isEditingName ? (
                        <div className="flex items-center gap-2">
                          <Input
                            id="edit-contract-name"
                            value={editContractName}
                            onChange={(e) => {
                              setEditContractName(e.target.value);
                              clearErrorIfSubmitted();
                            }}
                            placeholder="Enter contract name"
                            required
                            className={hasAttemptedSubmit && !editContractName.trim() ? 'border-red-500' : ''}
                          />
                          <Button
                            id="save-contract-name"
                            type="button"
                            size="sm"
                            onClick={() => setIsEditingName(false)}
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
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-base font-medium text-gray-900">{editContractName}</span>
                      )}
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Label htmlFor="edit-description">Description</Label>
                        {!isEditingDescription && (
                          <Button
                            id="edit-description-btn"
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setIsEditingDescription(true)}
                            className="h-5 w-5 p-0"
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
                            placeholder="Enter contract description"
                            className="min-h-[100px]"
                          />
                          <div className="flex gap-2">
                            <Button
                              id="save-description"
                              type="button"
                              size="sm"
                              onClick={() => setIsEditingDescription(false)}
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
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-base text-gray-700">{editDescription || 'No description'}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <FileText className="h-4 w-4 text-purple-600" />
                      Contract Snapshot
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-gray-700">
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">Status</span>
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
                          disabled={contract.status === 'expired'}
                        />
                        {contract.status === 'expired' && (
                          <p className="text-xs text-gray-500">
                            Expired contracts cannot be changed to another status
                          </p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs text-gray-500">Billing Frequency *</span>
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
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Created</span>
                      <span className="font-medium">{formatDate(contract.created_at)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Last Updated</span>
                      <span className="font-medium">{formatDate(contract.updated_at)}</span>
                    </div>
                    {editDescription && (
                      <div>
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Description</p>
                        <p className="text-sm text-gray-800">{editDescription}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Users className="h-4 w-4 text-emerald-600" />
                      Client Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-gray-700">
                    {assignments.length === 0 ? (
                      <p className="text-gray-500">No client assigned to this contract yet.</p>
                    ) : (
                      <>
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
                          <Badge className={
                            contract.status === 'active' ? 'bg-green-100 text-green-800' :
                            contract.status === 'terminated' ? 'bg-orange-100 text-orange-800' :
                            contract.status === 'expired' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }>
                            {contract.status === 'active' ? 'Active' :
                             contract.status === 'terminated' ? 'Terminated' :
                             contract.status === 'expired' ? 'Expired' :
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
                                  ${(Number(assignments[0].po_amount) / 100).toFixed(2)}
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

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4 text-sky-600" />
                    Client Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {assignments.length === 0 ? (
                    <div className="py-6 text-sm text-gray-500">
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
                          className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold text-gray-900">
                                {assignment.client_name || assignment.client_id}
                              </p>
                              <p className="text-xs text-gray-500">
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
                              >
                                <Pencil className="h-4 w-4" />
                                Edit
                              </Button>
                            )}
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <Label className="text-xs uppercase tracking-wide text-gray-500">
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
                                <p className="mt-1 text-sm text-gray-800">
                                  {formatDate(editData.start_date)}
                                </p>
                              )}
                            </div>
                            <div>
                              <Label className="text-xs uppercase tracking-wide text-gray-500">
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
                                <p className="mt-1 text-sm text-gray-800">
                                  {editData.end_date ? formatDate(editData.end_date) : 'Ongoing'}
                                </p>
                              )}
                            </div>
                          </div>

                          {supportsPo && (
                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-gray-500">
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
                                  <p className="mt-1 text-sm text-gray-800">
                                    {editData.po_required ? 'Yes' : 'No'}
                                  </p>
                                )}
                              </div>
                              <div>
                                <Label className="text-xs uppercase tracking-wide text-gray-500">
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
                                  <p className="mt-1 text-sm text-gray-800">
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
                                <Label className="text-xs uppercase tracking-wide text-gray-500">
                                  PO Amount
                                </Label>
                                {isEditing ? (
                                  <div className="relative mt-1 w-full max-w-xs">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                                      $
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
                                          const dollars = parseFloat(input) || 0;
                                          const cents = Math.round(dollars * 100);
                                          handleAssignmentFieldChange(
                                            assignment.client_contract_id,
                                            'po_amount',
                                            cents
                                          );
                                          setPoAmountInputs((prev) => ({
                                            ...prev,
                                            [assignment.client_contract_id]: dollars.toFixed(2),
                                          }));
                                        }
                                      }}
                                      placeholder="0.00"
                                      className="pl-7"
                                      disabled={!editData.po_required}
                                    />
                                  </div>
                                ) : (
                                  <p className="mt-1 text-sm text-gray-800">
                                    {editData.po_amount != null
                                      ? `$${(Number(editData.po_amount) / 100).toFixed(2)}`
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
                  <Button id="edit-manage-lines" variant="outline" onClick={() => setActiveTab('lines')}>
                    <Layers3 className="mr-2 h-4 w-4" />
                    Manage Contract Lines
                  </Button>
                  <Button id="edit-manage-pricing" variant="outline" onClick={() => setActiveTab('pricing')}>
                    <CalendarClock className="mr-2 h-4 w-4" />
                    Manage Pricing Schedules
                  </Button>
                  <Button id="edit-view-invoices" variant="outline" onClick={() => setActiveTab('invoices')}>
                    <FileText className="mr-2 h-4 w-4" />
                    View Invoices
                  </Button>
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
                  disabled={isSaving}
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
          <ContractLines contract={contract} onContractLinesChanged={handleContractLinesChanged} />
        </TabsContent>

        <TabsContent value="pricing">
          <PricingSchedules contractId={contract.contract_id} />
        </TabsContent>

        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                Contract Invoices
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-600">
              <p className="mb-2">
                Invoice reporting for this contract is coming soon. Once available, you’ll be able to review invoice history, open balances, and links to generated documents here.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Drawer
        isOpen={isQuickViewOpen}
        onClose={() => {
          setIsQuickViewOpen(false);
          setQuickViewClient(null);
        }}
      >
        {quickViewClient && (
          <ClientDetails
            client={quickViewClient}
            isInDrawer={true}
            quickView={true}
          />
        )}
      </Drawer>

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
    </div>
  );
};

export default ContractDetail;
