'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from 'server/src/components/ui/Tabs';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import BackNav from 'server/src/components/ui/BackNav';
import { AlertCircle, CalendarClock, FileCheck, FileText, Layers3, Package, Users, Save, Pencil, X, Check } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from 'server/src/components/ui/Card';
import { Badge } from 'server/src/components/ui/Badge';
import { Button } from 'server/src/components/ui/Button';
import { Label } from 'server/src/components/ui/Label';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Switch } from 'server/src/components/ui/Switch';
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
import ContractForm from './ContractForm';
import ContractLines from './ContractLines';
import PricingSchedules from './PricingSchedules';
import ClientDetails from 'server/src/components/clients/ClientDetails';

const formatDate = (value?: string | Date | null): string => {
  if (!value) {
    return '—';
  }

  const date = typeof value === 'string' ? new Date(value) : value;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
};

const formatCount = (value?: number): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '—';
  }
  return value.toLocaleString();
};

const ContractDetail: React.FC = () => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const contractId = searchParams?.get('contractId') as string;
  const tenant = useTenant()!;

  const [contract, setContract] = useState<IContract | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
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
  const [editIsActive, setEditIsActive] = useState<boolean>(false);
  const [editBillingFrequency, setEditBillingFrequency] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

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
    if (!contract) return false;

    // Check contract field changes
    const contractChanged =
      editContractName !== contract.contract_name ||
      editDescription !== (contract.contract_description ?? '') ||
      editIsActive !== contract.is_active ||
      editBillingFrequency !== contract.billing_frequency;

    // Check assignment changes
    const assignmentsChanged = Object.keys(editAssignments).length > 0;

    return contractChanged || assignmentsChanged;
  }, [contract, editContractName, editDescription, editIsActive, editBillingFrequency, editAssignments]);

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
      setEditContractName(contract.contract_name);
      setEditDescription(contract.contract_description ?? '');
      setEditIsActive(contract.is_active);
      setEditBillingFrequency(contract.billing_frequency);
    }
  }, [contract]);

  const loadContractData = async () => {
    setIsLoading(true);
    setError(null);

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

  const handleContractUpdated = () => {
    loadContractData();
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
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
      setActiveTab('overview');
    }
  };

  const handleCancelConfirm = () => {
    // Reset all changes
    if (contract) {
      setEditContractName(contract.contract_name);
      setEditDescription(contract.contract_description ?? '');
      setEditIsActive(contract.is_active);
      setEditBillingFrequency(contract.billing_frequency);
    }
    setEditAssignments({});
    setEditingAssignmentId(null);
    setPreEditSnapshot(null);
    setPoAmountInputs({});
    setValidationErrors([]);
    setHasAttemptedSubmit(false);
    setShowCancelConfirm(false);
    setActiveTab('overview');
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
      // Update contract
      await updateContract(contractId, {
        contract_name: editContractName,
        contract_description: editDescription || undefined,
        billing_frequency: editBillingFrequency,
        is_active: editIsActive,
        tenant
      });

      // Update any edited assignments
      for (const [assignmentId, editedAssignment] of Object.entries(editAssignments)) {
        const originalAssignment = assignments.find(a => a.client_contract_id === assignmentId);
        if (!originalAssignment) continue;

        // Build update payload with only changed fields
        const updatePayload: any = {
          tenant
        };

        // Only include fields that have changed
        if (editedAssignment.start_date !== originalAssignment.start_date) {
          updatePayload.start_date = editedAssignment.start_date || undefined;
        }
        if (editedAssignment.end_date !== originalAssignment.end_date) {
          updatePayload.end_date = editedAssignment.end_date;
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

    // Save a snapshot of the data at the start of this edit session
    setPreEditSnapshot({ ...dataToEdit });

    setEditAssignments(prev => ({
      ...prev,
      [assignment.client_contract_id]: { ...dataToEdit }
    }));

    // Initialize PO amount input with formatted value (convert from cents to dollars)
    if (dataToEdit.po_amount != null) {
      setPoAmountInputs(prev => ({
        ...prev,
        [assignment.client_contract_id]: (Number(dataToEdit.po_amount) / 100).toFixed(2)
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

  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.is_active),
    [assignments]
  );

  const poNumbers = useMemo(() => summary?.poNumbers ?? [], [summary]);

  const totalAssignments = summary?.totalClientAssignments ?? assignments.length;


  if (isLoading) {
    return <div className="p-4">Loading contract details...</div>;
  }

  if (error || !contract) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error || 'Contract not found'}
          </AlertDescription>
        </Alert>
        <BackNav href="/msp/billing?tab=contracts">
          Back to Contracts
        </BackNav>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <BackNav href="/msp/billing?tab=contracts">Back to Contracts</BackNav>
        <ContractHeader contract={contract} summary={summary} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 flex flex-wrap gap-2">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="lines">Contract Lines</TabsTrigger>
          <TabsTrigger value="pricing">Pricing Schedules</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-600" />
                    Contract Snapshot
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Status</span>
                    <Badge className={contract.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                      {contract.is_active ? 'Active' : 'Draft'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Billing Frequency</span>
                    <span className="font-medium">{contract.billing_frequency}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Created</span>
                    <span className="font-medium">{formatDate(contract.created_at)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Last Updated</span>
                    <span className="font-medium">{formatDate(contract.updated_at)}</span>
                  </div>
                  {contract.contract_description && (
                    <div>
                      <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Description</p>
                      <p className="text-sm text-gray-800">{contract.contract_description}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Layers3 className="h-4 w-4 text-emerald-600" />
                    Client Overview
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Assigned Clients</span>
                    <span className="font-semibold">{formatCount(totalAssignments)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Active Assignments</span>
                    <span className="font-semibold text-green-700">{formatCount(activeAssignments.length)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Earliest Start</span>
                    <span className="font-medium">{formatDate(summary?.earliestStartDate)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Latest End</span>
                    <span className="font-medium">
                      {summary?.latestEndDate ? formatDate(summary.latestEndDate) : totalAssignments > 0 ? 'Ongoing' : '—'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-600" />
                    Client Assignments
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Total Assignments</span>
                    <span className="font-semibold">{formatCount(totalAssignments)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Active Clients</span>
                    <span className="font-semibold text-green-700">{formatCount(activeAssignments.length)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Earliest Start</span>
                    <span className="font-medium">{formatDate(summary?.earliestStartDate)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Latest End</span>
                    <span className="font-medium">
                      {summary?.latestEndDate ? formatDate(summary.latestEndDate) : totalAssignments > 0 ? 'Ongoing' : '—'}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <FileCheck className="h-4 w-4 text-orange-600" />
                    Purchase Orders
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Assignments Requiring PO</span>
                    <span className="font-semibold">{formatCount(summary?.poRequiredCount)}</span>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">PO Numbers</p>
                    {poNumbers.length > 0 ? (
                      <ul className="space-y-1">
                        {poNumbers.map((po) => (
                          <li key={po} className="font-medium text-gray-800">
                            {po}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-gray-500">No purchase orders recorded.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Package className="h-4 w-4 text-amber-600" />
                    Revenue Snapshot
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-gray-700">
                  <p className="text-gray-500">
                    Detailed revenue metrics are coming soon. This section will summarize recurring charges and billing totals once reporting hooks are in place.
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Package className="h-4 w-4 text-purple-600" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button id="overview-edit-details" variant="outline" onClick={() => setActiveTab('details')}>
                  <FileText className="mr-2 h-4 w-4" />
                  Edit Contract Details
                </Button>
                <Button id="overview-manage-lines" variant="outline" onClick={() => setActiveTab('lines')}>
                  <Layers3 className="mr-2 h-4 w-4" />
                  Manage Contract Lines
                </Button>
                <Button id="overview-manage-pricing" variant="outline" onClick={() => setActiveTab('pricing')}>
                  <CalendarClock className="mr-2 h-4 w-4" />
                  Manage Pricing Schedules
                </Button>
                <Button id="overview-view-invoices" variant="outline" onClick={() => setActiveTab('invoices')}>
                  <FileText className="mr-2 h-4 w-4" />
                  View Invoices
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Users className="h-4 w-4 text-sky-600" />
                  Assignment Details
                </CardTitle>
              </CardHeader>
              <CardContent>
                {assignments.length === 0 ? (
                  <div className="py-8 text-center text-sm text-gray-500">
                    No clients are currently assigned to this contract.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200 text-sm">
                      <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                        <tr>
                          <th className="px-4 py-3">Client</th>
                          <th className="px-4 py-3">Start Date</th>
                          <th className="px-4 py-3">End Date</th>
                          <th className="px-4 py-3">PO</th>
                          <th className="px-4 py-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {assignments.map((assignment) => (
                          <tr key={assignment.client_contract_id} className="text-gray-700">
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">
                                {assignment.client_name || assignment.client_id}
                              </div>
                            </td>
                            <td className="px-4 py-3">{formatDate(assignment.start_date)}</td>
                            <td className="px-4 py-3">
                              {assignment.end_date ? formatDate(assignment.end_date) : 'Ongoing'}
                            </td>
                            <td className="px-4 py-3">
                              {assignment.po_required ? (
                                <Badge variant="outline" className="border-orange-300 text-orange-700">
                                  {assignment.po_number ? assignment.po_number : 'Required'}
                                </Badge>
                              ) : (
                                <span className="text-gray-500">Not required</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <Badge className={assignment.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}>
                                {assignment.is_active ? 'Active' : 'Inactive'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

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
                          id="edit-is-active"
                          value={editIsActive ? 'active' : 'draft'}
                          onValueChange={(value) => setEditIsActive(value === 'active')}
                          options={[
                            { value: 'active', label: 'Active' },
                            { value: 'draft', label: 'Draft' }
                          ]}
                        />
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
                          <Badge className={contract.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
                            {contract.is_active ? 'Active' : 'Draft'}
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
                    Assignment Details
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {assignments.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-500">
                      No clients are currently assigned to this contract.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                          <tr>
                            <th className="px-4 py-3">Client</th>
                            <th className="px-4 py-3">Start Date</th>
                            <th className="px-4 py-3">End Date</th>
                            <th className="px-4 py-3">PO Required</th>
                            <th className="px-4 py-3">PO Number</th>
                            <th className="px-4 py-3">PO Amount</th>
                            <th className="px-4 py-3">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {assignments.map((assignment) => {
                            const isEditing = editingAssignmentId === assignment.client_contract_id;
                            const editData = editAssignments[assignment.client_contract_id] || assignment;

                            return (
                              <tr key={assignment.client_contract_id} className="text-gray-700">
                                <td className="px-4 py-3">
                                  <div className="font-medium text-gray-900">
                                    {assignment.client_name || assignment.client_id}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <Input
                                      type="date"
                                      value={editData.start_date ? new Date(editData.start_date).toISOString().split('T')[0] : ''}
                                      onChange={(e) => handleAssignmentFieldChange(
                                        assignment.client_contract_id,
                                        'start_date',
                                        e.target.value
                                      )}
                                      className="w-40"
                                      disabled={contract.is_active}
                                      title={contract.is_active ? 'Start date cannot be changed for active contracts' : ''}
                                    />
                                  ) : (
                                    formatDate(editData.start_date)
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <Input
                                      type="date"
                                      value={editData.end_date ? new Date(editData.end_date).toISOString().split('T')[0] : ''}
                                      onChange={(e) => handleAssignmentFieldChange(
                                        assignment.client_contract_id,
                                        'end_date',
                                        e.target.value || null
                                      )}
                                      className="w-40"
                                      placeholder="Ongoing"
                                    />
                                  ) : (
                                    editData.end_date ? formatDate(editData.end_date) : 'Ongoing'
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <Switch
                                      id={`po-required-${assignment.client_contract_id}`}
                                      checked={editData.po_required}
                                      onCheckedChange={(checked) => {
                                        handleAssignmentFieldChange(
                                          assignment.client_contract_id,
                                          'po_required',
                                          checked
                                        );
                                      }}
                                    />
                                  ) : (
                                    <span>{editData.po_required ? 'Yes' : 'No'}</span>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <Input
                                      value={editData.po_number || ''}
                                      onChange={(e) => handleAssignmentFieldChange(
                                        assignment.client_contract_id,
                                        'po_number',
                                        e.target.value || null
                                      )}
                                      placeholder="PO Number"
                                      className="w-32"
                                      disabled={!editData.po_required}
                                    />
                                  ) : (
                                    editData.po_required ? (
                                      <Badge variant="outline" className="border-orange-300 text-orange-700">
                                        {editData.po_number ? editData.po_number : 'Required'}
                                      </Badge>
                                    ) : (
                                      <span className="text-gray-500">Not required</span>
                                    )
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <div className="relative">
                                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                                      <Input
                                        type="text"
                                        inputMode="decimal"
                                        value={poAmountInputs[assignment.client_contract_id] || ''}
                                        onChange={(e) => {
                                          const value = e.target.value.replace(/[^0-9.]/g, '');
                                          const decimalCount = (value.match(/\./g) || []).length;
                                          if (decimalCount <= 1) {
                                            setPoAmountInputs(prev => ({
                                              ...prev,
                                              [assignment.client_contract_id]: value
                                            }));
                                          }
                                        }}
                                        onBlur={() => {
                                          const input = poAmountInputs[assignment.client_contract_id] || '';
                                          if (input.trim() === '' || input === '.') {
                                            setPoAmountInputs(prev => ({
                                              ...prev,
                                              [assignment.client_contract_id]: ''
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
                                            setPoAmountInputs(prev => ({
                                              ...prev,
                                              [assignment.client_contract_id]: dollars.toFixed(2)
                                            }));
                                          }
                                        }}
                                        placeholder="0.00"
                                        className="w-28 pl-7"
                                        disabled={!editData.po_required}
                                      />
                                    </div>
                                  ) : (
                                    editData.po_amount != null ? `$${(Number(editData.po_amount) / 100).toFixed(2)}` : '—'
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {isEditing ? (
                                    <div className="flex gap-2">
                                      <Button
                                        id={`confirm-assignment-${assignment.client_contract_id}`}
                                        type="button"
                                        size="sm"
                                        onClick={handleConfirmEditAssignment}
                                      >
                                        <Check className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        id={`cancel-assignment-${assignment.client_contract_id}`}
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        onClick={() => handleCancelEditAssignment(assignment.client_contract_id)}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    </div>
                                  ) : (
                                    <Button
                                      id={`edit-assignment-${assignment.client_contract_id}`}
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => handleStartEditAssignment(assignment)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
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
