'use client';

import React, { useEffect, useState } from 'react';
import { Card, Box } from '@radix-ui/themes';
import { useRouter } from 'next/navigation';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@alga-psa/ui/components/Tabs';
import { MoreVertical, Wand2, Search, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { ColumnDefinition } from '@alga-psa/types';
import { IContractWithClient } from '@alga-psa/types';
import {
  deleteContract,
  getContractsWithClients,
} from '@alga-psa/billing/actions/contractActions';
import {
  getDraftContractForResume,
  type DraftContractWizardData,
} from '@alga-psa/billing/actions/contractWizardActions';
import {
  listRenewalQueueRows,
  markRenewalQueueItemNonRenewing,
  markRenewalQueueItemRenewing,
  type RenewalQueueAction,
  type RenewalQueueRow,
} from '@alga-psa/billing/actions/renewalsQueueActions';
import { updateClientContractForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import { ContractWizard } from './ContractWizard';
import { ContractDialog } from './ContractDialog';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useFormatBillingFrequency } from '@alga-psa/billing/hooks/useBillingEnumOptions';

interface ClientContractsTabProps {
  onRefreshNeeded?: () => void;
  refreshTrigger?: number;
}

type UpcomingRenewalWindow = '30' | '60' | '90' | 'all';
type PendingUpcomingRenewalAction = Extract<RenewalQueueAction, 'mark_renewing' | 'mark_non_renewing'>;

const getAvailableActionsForStatus = (status: RenewalQueueRow['status']): RenewalQueueAction[] => {
  if (status === 'pending') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'renewing') {
    return ['mark_non_renewing', 'create_renewal_draft', 'snooze', 'assign_owner'];
  }
  if (status === 'non_renewing') {
    return ['mark_renewing', 'assign_owner'];
  }
  if (status === 'snoozed') {
    return ['mark_renewing', 'mark_non_renewing', 'create_renewal_draft', 'assign_owner'];
  }
  return ['assign_owner'];
};

const toWidgetRenewalRows = (rows: RenewalQueueRow[]): RenewalQueueRow[] =>
  rows.filter((row) => row.contract_type === 'fixed-term' || row.contract_type === 'evergreen');

const ClientContractsTab: React.FC<ClientContractsTabProps> = ({ onRefreshNeeded, refreshTrigger }) => {
  const { t } = useTranslation('msp/contracts');
  const formatBillingFrequency = useFormatBillingFrequency();
  const router = useRouter();
  const [clientContracts, setClientContracts] = useState<IContractWithClient[]>([]);
  const [renewalRows, setRenewalRows] = useState<RenewalQueueRow[]>([]);
  const [showClientWizard, setShowClientWizard] = useState(false);
  const [draftToResume, setDraftToResume] = useState<DraftContractWizardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [renewalsSearchTerm, setRenewalsSearchTerm] = useState('');
  const [renewalsWindow, setRenewalsWindow] = useState<UpcomingRenewalWindow>('30');
  const [contractsViewTab, setContractsViewTab] = useState('contracts');
  const [pendingUpcomingRenewalActions, setPendingUpcomingRenewalActions] = useState<Record<string, PendingUpcomingRenewalAction | undefined>>({});
  const [contractToDelete, setContractToDelete] = useState<{
    contractId: string;
    contractName: string;
    clientName?: string;
  } | null>(null);
  const [contractToTerminate, setContractToTerminate] = useState<{
    clientContractId: string;
    contractName: string;
    clientName?: string;
  } | null>(null);
  const [isDeletingContract, setIsDeletingContract] = useState(false);
  const [isTerminatingContract, setIsTerminatingContract] = useState(false);

  useEffect(() => {
    void fetchClientContracts();
  }, [refreshTrigger]);

  const syncRenewalRows = (rows: RenewalQueueRow[]) => {
    const rowsForWidget = toWidgetRenewalRows(rows);
    setRenewalRows(rowsForWidget);
  };

  const refreshRenewalRows = async () => {
    const rows = await listRenewalQueueRows();
    if (isActionPermissionError(rows)) {
      handleError(rows.permissionError);
      return;
    }
    syncRenewalRows(rows);
  };

  const fetchClientContracts = async () => {
    try {
      setIsLoading(true);
      const fetchedAssignments = await getContractsWithClients();
      const renewalRows = await listRenewalQueueRows();
      if (isActionPermissionError(renewalRows)) {
        handleError(renewalRows.permissionError);
        return;
      }
      syncRenewalRows(renewalRows);
      setClientContracts(fetchedAssignments.filter((assignment) => Boolean(assignment.client_id)));
      setError(null);
    } catch (err) {
      console.error('Error fetching client contracts:', err);
      setError(t('clientContracts.errors.failedToFetch', { defaultValue: 'Failed to fetch client contracts' }));
    } finally {
      setIsLoading(false);
    }
  };

  const confirmDeleteContract = async () => {
    if (!contractToDelete) return;
    setIsDeletingContract(true);
    try {
      const result = await deleteContract(contractToDelete.contractId);
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        setContractToDelete(null);
        return;
      }
      await fetchClientContracts();
      onRefreshNeeded?.();
      setContractToDelete(null);
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('clientContracts.toasts.failedToDelete', { defaultValue: 'Failed to delete contract' });
      toast.error(message);
    } finally {
      setIsDeletingContract(false);
    }
  };

  const handleTerminateContract = async (clientContractId?: string) => {
    setIsTerminatingContract(true);
    try {
      if (!clientContractId) {
        throw new Error('Missing client contract identifier');
      }
      await updateClientContractForBilling(clientContractId, { is_active: false });
      await fetchClientContracts();
      onRefreshNeeded?.();
      setContractToTerminate(null);
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('clientContracts.toasts.failedToTerminate', { defaultValue: 'Failed to terminate contract' });
      toast.error(message);
    } finally {
      setIsTerminatingContract(false);
    }
  };

  const handleRestoreContract = async (clientContractId?: string) => {
    try {
      if (!clientContractId) {
        throw new Error('Missing client contract identifier');
      }
      await updateClientContractForBilling(clientContractId, { is_active: true });
      await fetchClientContracts();
      onRefreshNeeded?.();
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('clientContracts.toasts.failedToRestore', { defaultValue: 'Failed to restore contract' });
      toast.error(message);
    }
  };

  const handleSetToActive = async (clientContractId?: string) => {
    try {
      if (!clientContractId) {
        throw new Error('Missing client contract identifier');
      }
      await updateClientContractForBilling(clientContractId, { is_active: true });
      await fetchClientContracts();
      onRefreshNeeded?.();
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('clientContracts.toasts.failedToActivate', { defaultValue: 'Failed to activate contract' });
      toast.error(message);
    }
  };

  const handleResumeDraft = async (contractId: string) => {
    try {
      setIsLoading(true);
      const draftData = await getDraftContractForResume(contractId);
      if (isActionPermissionError(draftData)) {
        handleError(draftData.permissionError);
        return;
      }
      setDraftToResume(draftData);
      setShowClientWizard(true);
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('clientContracts.toasts.failedToResumeDraft', { defaultValue: 'Failed to resume draft' });
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToContract = (contractId?: string, clientContractId?: string) => {
    if (contractId) {
      const params = new URLSearchParams();
      if (clientContractId) {
        // Client contract - use client-contracts tab
        params.set('tab', 'client-contracts');
        params.set('contractId', contractId);
        params.set('clientContractId', clientContractId);
      } else {
        // Template contract - use contract-templates tab
        params.set('tab', 'contract-templates');
        params.set('contractId', contractId);
      }
      router.push(`/msp/billing?${params.toString()}`);
    }
  };

  const renderStatusBadge = (status: string) => {
    const normalized = (status || 'draft').toLowerCase();
    const statusConfig: Record<string, { variant: 'success' | 'default-muted' | 'warning' | 'error' | 'info'; label: string }> = {
      active: { variant: 'success', label: t('status.active', { defaultValue: 'Active' }) },
      draft: { variant: 'default-muted', label: t('status.draft', { defaultValue: 'Draft' }) },
      terminated: { variant: 'warning', label: t('status.terminated', { defaultValue: 'Terminated' }) },
      expired: { variant: 'error', label: t('status.expired', { defaultValue: 'Expired' }) },
      published: { variant: 'success', label: t('contractsList.status.published', { defaultValue: 'Published' }) },
      archived: { variant: 'default-muted', label: t('contractsList.status.archived', { defaultValue: 'Archived' }) },
    };
    const config = statusConfig[normalized] ?? statusConfig.draft;
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const formatDateValue = (value: unknown): string => {
    if (!value) return t('contractsList.empty.dash', { defaultValue: '—' });
    if (!(typeof value === 'string' || typeof value === 'number' || value instanceof Date)) {
      return t('contractsList.empty.dash', { defaultValue: '—' });
    }

    // Treat YYYY-MM-DD as a date-only value to avoid timezone shifts.
    if (typeof value === 'string') {
      const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (dateOnlyMatch) {
        const year = Number(dateOnlyMatch[1]);
        const month = Number(dateOnlyMatch[2]);
        const day = Number(dateOnlyMatch[3]);
        const dateOnly = new Date(Date.UTC(year, month - 1, day, 12));
        return isNaN(dateOnly.getTime()) ? t('contractsList.empty.dash', { defaultValue: '—' }) : dateOnly.toLocaleDateString();
      }
    }

    const date = new Date(value);
    return isNaN(date.getTime()) ? t('contractsList.empty.dash', { defaultValue: '—' }) : date.toLocaleDateString();
  };

  const clientContractColumns: ColumnDefinition<IContractWithClient>[] = [
    {
      title: t('clientContracts.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      width: '15%',
      headerClassName: 'min-w-[11rem]',
      cellClassName: 'min-w-[11rem] max-w-none',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0
          ? value
          : t('contractsList.empty.dash', { defaultValue: '—' }),
    },
    {
      title: t('clientContracts.columns.sourceTemplate', { defaultValue: 'Source Template' }),
      dataIndex: 'template_contract_name',
      width: '12%',
      headerClassName: 'min-w-[10rem]',
      cellClassName: 'min-w-[10rem] max-w-none',
      render: (value: string | null) =>
        value && value.trim().length > 0 ? value : t('contractsList.empty.dash', { defaultValue: '—' }),
    },
    {
      title: t('clientContracts.columns.contractName', { defaultValue: 'Contract Name' }),
      dataIndex: 'contract_name',
      width: '20%',
      headerClassName: 'min-w-[13rem]',
      cellClassName: 'min-w-[13rem] max-w-none',
      render: (value: string | null, record) => {
        const hasName = typeof value === 'string' && value.trim().length > 0;
        const isSystemManagedDefault = record.is_system_managed_default === true;
        return (
          <div className="space-y-1">
            <span>{hasName ? value : t('contractsList.empty.dash', { defaultValue: '—' })}</span>
            {isSystemManagedDefault ? (
              <>
                <Badge variant="info">
                  {t('contractDetail.systemManaged.title', { defaultValue: 'System-managed default contract' })}
                </Badge>
                <p className="text-xs text-muted-foreground">
                  {t('contractDetail.systemManaged.createdAutomatically', {
                    defaultValue: 'Created automatically for uncontracted work.',
                  })}
                </p>
              </>
            ) : null}
          </div>
        );
      },
    },
    {
      title: t('clientContracts.columns.startDate', { defaultValue: 'Start Date' }),
      dataIndex: 'start_date',
      width: '8.5rem',
      headerClassName: 'min-w-[8.5rem]',
      cellClassName: 'min-w-[8.5rem] max-w-none whitespace-nowrap',
      render: (value: unknown) => formatDateValue(value),
    },
    {
      title: t('clientContracts.columns.endDate', { defaultValue: 'End Date' }),
      dataIndex: 'end_date',
      width: '8.5rem',
      headerClassName: 'min-w-[8.5rem]',
      cellClassName: 'min-w-[8.5rem] max-w-none whitespace-nowrap',
      render: (value: unknown) => formatDateValue(value),
    },
    {
      title: t('clientContracts.columns.billingFrequency', { defaultValue: 'Billing Frequency' }),
      dataIndex: 'billing_frequency',
      width: '9rem',
      headerClassName: 'min-w-[9rem]',
      cellClassName: 'min-w-[9rem] max-w-none whitespace-nowrap',
      render: (value: string | null, record) => formatBillingFrequency(value ?? record.billing_frequency),
    },
    {
      title: t('clientContracts.columns.poIndicator', { defaultValue: 'PO' }),
      dataIndex: 'contract_id',
      width: '8rem',
      headerClassName: 'min-w-[8rem]',
      cellClassName: 'min-w-[8rem] max-w-none',
      render: (_: string, record: IContractWithClient & { po_required?: boolean }) => (
        record.po_required
          ? t('clientContracts.po.required', { defaultValue: 'Required' })
          : t('clientContracts.po.notRequired', { defaultValue: 'Not required' })
      ),
    },
    {
      title: t('clientContracts.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'assignment_status',
      width: '7rem',
      headerClassName: 'min-w-[7rem] text-center',
      cellClassName: 'min-w-[7rem] max-w-none text-center',
      render: (value: string | null, record) => renderStatusBadge(value ?? record.status),
    },
    {
      title: t('clientContracts.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'contract_id',
      width: '4rem',
      headerClassName: 'min-w-[4rem] text-center',
      cellClassName: 'min-w-[4rem] max-w-none text-center',
      render: (value, record) => {
        const isSystemManagedDefault = record.is_system_managed_default === true;
        return (
          <div className="flex justify-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  id="contract-actions-menu"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={(event) => event.stopPropagation()}
                >
                  <span className="sr-only">
                    {t('contractsList.actions.openMenu', { defaultValue: 'Open menu' })}
                  </span>
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  id={(record.assignment_status ?? record.status) === 'draft' ? 'resume-contract-menu-item' : 'edit-contract-menu-item'}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!record.contract_id) return;
                    if ((record.assignment_status ?? record.status) === 'draft' && !isSystemManagedDefault) {
                      void handleResumeDraft(record.contract_id);
                      return;
                    }
                    navigateToContract(record.contract_id, record.client_contract_id);
                  }}
                >
                  {(record.assignment_status ?? record.status) === 'draft' && !isSystemManagedDefault
                    ? t('contractsList.actions.resume', { defaultValue: 'Resume' })
                    : t('clientContracts.actions.viewDetails', { defaultValue: 'View details' })}
                </DropdownMenuItem>
                {!isSystemManagedDefault && (record.assignment_status ?? record.status) === 'active' && (
                  <DropdownMenuItem
                    id="terminate-contract-menu-item"
                    className="text-orange-600 focus:text-orange-600"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!record.client_contract_id) return;
                      setContractToTerminate({
                        clientContractId: record.client_contract_id,
                        contractName: record.contract_name?.trim()
                          || t('contractsList.empty.untitledContract', { defaultValue: 'Untitled contract' }),
                        clientName: record.client_name?.trim() || undefined,
                      });
                    }}
                  >
                    {t('contractsList.actions.terminate', { defaultValue: 'Terminate' })}
                  </DropdownMenuItem>
                )}
                {!isSystemManagedDefault && (record.assignment_status ?? record.status) === 'terminated' && (
                  <DropdownMenuItem
                    id="restore-contract-menu-item"
                    className="text-green-600 focus:text-green-600"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleRestoreContract(record.client_contract_id);
                    }}
                  >
                    {t('contractsList.actions.restore', { defaultValue: 'Restore' })}
                  </DropdownMenuItem>
                )}
                {!isSystemManagedDefault && (record.assignment_status ?? record.status) === 'draft' && (
                  <DropdownMenuItem
                    id="set-to-active-menu-item"
                    className="text-green-600 focus:text-green-600"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleSetToActive(record.client_contract_id);
                    }}
                  >
                    {t('contractsList.actions.setToActive', { defaultValue: 'Set to Active' })}
                  </DropdownMenuItem>
                )}
                {!isSystemManagedDefault ? (
                  <DropdownMenuItem
                    id="client-contracts-tab-delete-menu-item"
                    className="text-red-600 focus:text-red-600"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (record.contract_id) {
                        setContractToDelete({
                          contractId: record.contract_id,
                          contractName: record.contract_name?.trim()
                            || t('contractsList.empty.untitledContract', { defaultValue: 'Untitled contract' }),
                          clientName: record.client_name?.trim() || undefined,
                        });
                      }
                    }}
                  >
                    {t('common.actions.delete', { defaultValue: 'Delete' })}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  const filteredClientContracts = clientContracts.filter((contract) => {
    if (!clientSearchTerm) {
      return true;
    }
    const search = clientSearchTerm.toLowerCase();
    return (
      contract.contract_name?.toLowerCase().includes(search) ||
      contract.template_contract_name?.toLowerCase().includes(search) ||
      contract.client_name?.toLowerCase().includes(search)
    );
  });
  const renderRenewalStatusBadge = (status: RenewalQueueRow['status']) => {
    if (status === 'renewing') {
      return <Badge variant="success">{t('clientContracts.upcoming.status.renewing', { defaultValue: 'Renewing' })}</Badge>;
    }
    if (status === 'non_renewing') {
      return <Badge variant="warning">{t('clientContracts.upcoming.status.nonRenewing', { defaultValue: 'Non-renewing' })}</Badge>;
    }
    if (status === 'snoozed') {
      return <Badge variant="info">{t('clientContracts.upcoming.status.snoozed', { defaultValue: 'Snoozed' })}</Badge>;
    }
    if (status === 'completed') {
      return <Badge variant="default-muted">{t('clientContracts.upcoming.status.completed', { defaultValue: 'Completed' })}</Badge>;
    }
    return <Badge variant="default">{t('clientContracts.upcoming.status.pending', { defaultValue: 'Pending' })}</Badge>;
  };

  const handleMarkRenewalRowRenewing = async (row: RenewalQueueRow) => {
    const rowId = row.client_contract_id;
    setPendingUpcomingRenewalActions((current) => ({ ...current, [rowId]: 'mark_renewing' }));
    setRenewalRows((current) =>
      current.map((candidate) =>
        candidate.client_contract_id === rowId
          ? {
              ...candidate,
              status: 'renewing',
              available_actions: getAvailableActionsForStatus('renewing'),
            }
          : candidate
      )
    );

    try {
      await markRenewalQueueItemRenewing(rowId);
      await refreshRenewalRows();
      onRefreshNeeded?.();
    } catch (mutationError) {
      const message = mutationError instanceof Error
        ? mutationError.message
        : t('clientContracts.toasts.failedToMarkRenewing', { defaultValue: 'Failed to mark renewal as renewing' });
      toast.error(message);
      await refreshRenewalRows();
    } finally {
      setPendingUpcomingRenewalActions((current) => ({ ...current, [rowId]: undefined }));
    }
  };

  const handleMarkRenewalRowNonRenewing = async (row: RenewalQueueRow) => {
    const rowId = row.client_contract_id;
    setPendingUpcomingRenewalActions((current) => ({ ...current, [rowId]: 'mark_non_renewing' }));
    setRenewalRows((current) =>
      current.map((candidate) =>
        candidate.client_contract_id === rowId
          ? {
              ...candidate,
              status: 'non_renewing',
              available_actions: getAvailableActionsForStatus('non_renewing'),
            }
          : candidate
      )
    );

    try {
      await markRenewalQueueItemNonRenewing(rowId);
      await refreshRenewalRows();
      onRefreshNeeded?.();
    } catch (mutationError) {
      const message = mutationError instanceof Error
        ? mutationError.message
        : t('clientContracts.toasts.failedToMarkNonRenewing', { defaultValue: 'Failed to mark renewal as non-renewing' });
      toast.error(message);
      await refreshRenewalRows();
    } finally {
      setPendingUpcomingRenewalActions((current) => ({ ...current, [rowId]: undefined }));
    }
  };

  const upcomingRenewalColumns: ColumnDefinition<RenewalQueueRow>[] = [
    {
      title: t('clientContracts.upcoming.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value: string | null, record) =>
        typeof value === 'string' && value.trim().length > 0 ? value : record.client_id,
    },
    {
      title: t('clientContracts.upcoming.columns.contract', { defaultValue: 'Contract' }),
      dataIndex: 'contract_name',
      render: (value: string | null, record) =>
        typeof value === 'string' && value.trim().length > 0 ? value : record.contract_id,
    },
    {
      title: t('clientContracts.upcoming.columns.type', { defaultValue: 'Type' }),
      dataIndex: 'contract_type',
      render: (value: RenewalQueueRow['contract_type']) => (
        <Badge variant={value === 'evergreen' ? 'info' : 'default'}>
          {value === 'evergreen'
            ? t('clientContracts.upcoming.type.evergreen', { defaultValue: 'Evergreen' })
            : t('clientContracts.upcoming.type.fixedTerm', { defaultValue: 'Fixed-term' })}
        </Badge>
      ),
    },
    {
      title: t('clientContracts.upcoming.columns.decisionDue', { defaultValue: 'Decision Due' }),
      dataIndex: 'decision_due_date',
      render: (value: string | undefined) => formatDateValue(value),
    },
    {
      title: t('clientContracts.upcoming.columns.daysUntilDue', { defaultValue: 'Days Until Due' }),
      dataIndex: 'days_until_due',
      render: (value: number | undefined) =>
        (typeof value === 'number' ? String(value) : t('contractsList.empty.dash', { defaultValue: '—' })),
    },
    {
      title: t('clientContracts.upcoming.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: (value: RenewalQueueRow['status']) => renderRenewalStatusBadge(value),
    },
    {
      title: t('clientContracts.upcoming.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'client_contract_id',
      render: (_value: string, row: RenewalQueueRow) => {
        const hasMarkRenewing = row.available_actions.includes('mark_renewing');
        const hasMarkNonRenewing = row.available_actions.includes('mark_non_renewing');
        const isPending = Boolean(pendingUpcomingRenewalActions[row.client_contract_id]);

        if (!hasMarkRenewing && !hasMarkNonRenewing) {
          return <span className="text-[rgb(var(--color-text-400))]">{t('contractsList.empty.dash', { defaultValue: '—' })}</span>;
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`upcoming-renewals-row-actions-${row.client_contract_id}`}
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                data-testid="upcoming-renewals-row-actions-trigger"
                disabled={isPending}
              >
                <span className="sr-only">
                  {t('clientContracts.upcoming.actions.openMenu', { defaultValue: 'Open renewal actions' })}
                </span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="upcoming-renewals-action-edit"
                onClick={(event) => {
                  event.stopPropagation();
                  navigateToContract(row.contract_id, row.client_contract_id);
                }}
              >
                {t('common.actions.edit', { defaultValue: 'Edit' })}
              </DropdownMenuItem>
              {hasMarkRenewing && (
                <DropdownMenuItem
                  data-testid="upcoming-renewals-action-mark-renewing"
                  disabled={isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleMarkRenewalRowRenewing(row);
                  }}
                >
                  {t('clientContracts.upcoming.actions.markRenewing', { defaultValue: 'Mark renewing' })}
                </DropdownMenuItem>
              )}
              {hasMarkNonRenewing && (
                <DropdownMenuItem
                  data-testid="upcoming-renewals-action-mark-non-renewing"
                  disabled={isPending}
                  onClick={(event) => {
                    event.stopPropagation();
                    void handleMarkRenewalRowNonRenewing(row);
                  }}
                >
                  {t('clientContracts.upcoming.actions.markNonRenewing', { defaultValue: 'Mark non-renewing' })}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const totalUpcomingRenewals = renewalRows.length;

  const renewalBucketOptions: SelectOption[] = [
    { value: '30', label: t('clientContracts.upcoming.window.next30', { defaultValue: 'Next 30 days' }) },
    { value: '60', label: t('clientContracts.upcoming.window.next60', { defaultValue: 'Next 60 days' }) },
    { value: '90', label: t('clientContracts.upcoming.window.next90', { defaultValue: 'Next 90 days' }) },
    { value: 'all', label: t('clientContracts.upcoming.window.all', { defaultValue: 'All' }) },
  ];

  const filteredUpcomingRenewals = renewalRows.filter((row) => {
    const daysUntilDue = row.days_until_due ?? Number.MAX_SAFE_INTEGER;
    if (renewalsWindow !== 'all' && (daysUntilDue < 0 || daysUntilDue > Number(renewalsWindow))) {
      return false;
    }

    if (!renewalsSearchTerm.trim()) {
      return true;
    }

    const search = renewalsSearchTerm.toLowerCase();
    const formattedDecisionDueDate = formatDateValue(row.decision_due_date).toLowerCase();
    return (
      row.client_name?.toLowerCase().includes(search) ||
      row.contract_name?.toLowerCase().includes(search) ||
      row.client_id.toLowerCase().includes(search) ||
      row.contract_id.toLowerCase().includes(search) ||
      row.decision_due_date?.toLowerCase().includes(search) ||
      formattedDecisionDueDate.includes(search)
    );
  });

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-muted-foreground"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text={t('clientContracts.loading', { defaultValue: 'Loading client contracts...' })}
            textClassName="text-muted-foreground"
          />
        </Box>
      </Card>
    );
  }

  if (error) {
    return (
      <Card size="2">
        <Box p="4">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </Box>
      </Card>
    );
  }

  return (
    <>
      <Card size="2">
        <Box p="4">
          <Tabs
            value={contractsViewTab}
            onValueChange={setContractsViewTab}
            data-testid="client-contracts-upcoming-renewals-tabs"
          >
            <TabsList className="mb-4">
              <TabsTrigger value="contracts" data-testid="client-contracts-tab-trigger">
                {t('clientContracts.tabs.contracts', { defaultValue: 'Contracts' })}
              </TabsTrigger>
              <TabsTrigger value="upcoming-renewals" data-testid="upcoming-renewals-tab-trigger">
                {t('clientContracts.tabs.upcomingRenewals', {
                  defaultValue: 'Upcoming Renewals ({{count}})',
                  count: totalUpcomingRenewals,
                })}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="contracts">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="relative max-w-md w-full">
                  <Search
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    type="text"
                    placeholder={t('clientContracts.search.placeholder', {
                      defaultValue: 'Search by client or contract...',
                    })}
                    value={clientSearchTerm}
                    onChange={(event) => setClientSearchTerm(event.target.value)}
                    className="pl-10"
                    aria-label={t('clientContracts.search.ariaLabel', { defaultValue: 'Search client contracts' })}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <ContractDialog
                    onContractSaved={() => {
                      void fetchClientContracts();
                      onRefreshNeeded?.();
                    }}
                    triggerButton={
                      <Button
                        id="quick-add-contract-button"
                        variant="outline"
                        className="inline-flex items-center gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        {t('contractsList.actions.quickAdd', { defaultValue: 'Quick Add' })}
                      </Button>
                    }
                  />
                  <Button
                    id="client-wizard-button"
                    onClick={() => {
                      setDraftToResume(null);
                      setShowClientWizard(true);
                    }}
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
                  >
                    <Wand2 className="h-4 w-4" />
                    {t('contractsList.actions.createContract', { defaultValue: 'Create Contract' })}
                  </Button>
                </div>
              </div>

              {filteredClientContracts.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  {t('clientContracts.empty.noMatches', { defaultValue: 'No client contracts match your search.' })}
                </div>
              ) : (
                <DataTable
                  data={filteredClientContracts}
                  columns={clientContractColumns}
                  pagination
                  onRowClick={(record) => navigateToContract(record.contract_id, record.client_contract_id)}
                  rowClassName={() => 'cursor-pointer'}
                />
              )}
            </TabsContent>

            <TabsContent value="upcoming-renewals">
              <section
                data-testid="upcoming-renewals-widget"
                className="mb-4 rounded-md border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-bg-100))] p-4"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">
                      {t('clientContracts.upcoming.title', { defaultValue: 'Upcoming Renewals' })}
                    </h3>
                    <p className="text-xs text-[rgb(var(--color-text-500))]">
                      {t('clientContracts.upcoming.description', {
                        defaultValue: 'Contracts with renewal decisions due within the selected window.',
                      })}
                    </p>
                  </div>
                  <div
                    className="w-full md:w-[240px]"
                    data-testid="upcoming-renewals-bucket-filter-dropdown"
                  >
                    <CustomSelect
                      id="upcoming-renewals-bucket-filter-select"
                      options={renewalBucketOptions}
                      value={renewalsWindow}
                      onValueChange={(value) => setRenewalsWindow(value as UpcomingRenewalWindow)}
                      placeholder={t('clientContracts.upcoming.windowPlaceholder', {
                        defaultValue: 'Select renewal window',
                      })}
                    />
                  </div>
                </div>
              </section>

              <div className="mb-4 relative max-w-md w-full">
                <Search
                  className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <Input
                  type="text"
                  placeholder={t('clientContracts.upcoming.filterPlaceholder', {
                    defaultValue: 'Filter upcoming renewals...',
                  })}
                  value={renewalsSearchTerm}
                  onChange={(event) => setRenewalsSearchTerm(event.target.value)}
                  className="pl-10"
                  aria-label={t('clientContracts.upcoming.filterAriaLabel', {
                    defaultValue: 'Filter upcoming renewals',
                  })}
                  data-testid="upcoming-renewals-list-filter"
                />
              </div>

              {filteredUpcomingRenewals.length === 0 ? (
                <div
                  className="rounded-md border border-dashed border-[rgb(var(--color-border-200))] p-4 text-sm text-[rgb(var(--color-text-500))]"
                  data-testid="upcoming-renewals-empty-state"
                >
                  {t('clientContracts.upcoming.empty', {
                    defaultValue: 'No upcoming renewals for the selected window.',
                  })}
                </div>
              ) : (
                <DataTable
                  data={filteredUpcomingRenewals}
                  columns={upcomingRenewalColumns}
                  pagination
                  onRowClick={(record) => navigateToContract(record.contract_id, record.client_contract_id)}
                  rowClassName={() => 'cursor-pointer'}
                />
              )}
            </TabsContent>
          </Tabs>
        </Box>
      </Card>
      <ContractWizard
        open={showClientWizard}
        onOpenChange={(open) => {
          if (!open) {
            setDraftToResume(null);
          }
          setShowClientWizard(open);
        }}
        onComplete={() => {
          setShowClientWizard(false);
          setDraftToResume(null);
          void fetchClientContracts();
          onRefreshNeeded?.();
        }}
        editingContract={draftToResume}
      />
      <ConfirmationDialog
        id="client-contracts-tab-delete-confirmation"
        isOpen={!!contractToDelete}
        onClose={() => {
          if (!isDeletingContract) {
            setContractToDelete(null);
          }
        }}
        onConfirm={confirmDeleteContract}
        title={t('contractsList.dialogs.deleteClient.title', { defaultValue: 'Delete client contract?' })}
        message={
          contractToDelete
            ? t('contractsList.dialogs.deleteClient.message', {
              defaultValue: 'Are you sure you want to permanently delete the client contract "{{contractName}}"{{clientSuffix}}? This action cannot be undone.',
              contractName: contractToDelete.contractName,
              clientSuffix: contractToDelete.clientName
                ? t('contractsList.dialogs.deleteClient.clientSuffix', {
                  defaultValue: ' for {{clientName}}',
                  clientName: contractToDelete.clientName,
                })
                : '',
            })
            : ''
        }
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        confirmLabel={isDeletingContract
          ? t('contractsList.actions.deleting', { defaultValue: 'Deleting…' })
          : t('common.actions.delete', { defaultValue: 'Delete' })}
        isConfirming={isDeletingContract}
      />
      <ConfirmationDialog
        id="client-contracts-tab-terminate-confirmation"
        isOpen={!!contractToTerminate}
        onClose={() => {
          if (!isTerminatingContract) {
            setContractToTerminate(null);
          }
        }}
        onConfirm={() => void handleTerminateContract(contractToTerminate?.clientContractId)}
        title={t('clientContracts.dialogs.terminate.title', { defaultValue: 'Terminate client contract?' })}
        message={
          contractToTerminate
            ? t('clientContracts.dialogs.terminate.message', {
              defaultValue: 'Are you sure you want to terminate "{{contractName}}"{{clientSuffix}}?',
              contractName: contractToTerminate.contractName,
              clientSuffix: contractToTerminate.clientName
                ? t('clientContracts.dialogs.terminate.clientSuffix', {
                  defaultValue: ' for {{clientName}}',
                  clientName: contractToTerminate.clientName,
                })
                : '',
            })
            : ''
        }
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        confirmLabel={isTerminatingContract
          ? t('contractsList.actions.deleting', { defaultValue: 'Deleting…' })
          : t('contractsList.actions.terminate', { defaultValue: 'Terminate' })}
        isConfirming={isTerminatingContract}
      />
    </>
  );
};

export default ClientContractsTab;
