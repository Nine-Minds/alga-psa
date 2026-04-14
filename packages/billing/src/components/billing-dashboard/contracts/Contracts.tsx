'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from '@alga-psa/ui/components/Button';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { MoreVertical, Wand2, Search, Sparkles, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@alga-psa/ui/components/DropdownMenu';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Input } from '@alga-psa/ui/components/Input';
import CustomTabs from '@alga-psa/ui/components/CustomTabs';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ColumnDefinition } from '@alga-psa/types';
import { IContract, IContractWithClient } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  deleteContract,
  getDraftContracts,
  getContractTemplates,
  getContractsWithClients,
} from '@alga-psa/billing/actions/contractActions';
import {
  getDraftContractForResume,
  type DraftContractWizardData,
} from '@alga-psa/billing/actions/contractWizardActions';
import { ContractWizard } from './ContractWizard';
import { TemplateWizard } from './template-wizard/TemplateWizard';
import { ContractDialog } from './ContractDialog';
import { updateClientContractForBilling } from '@alga-psa/billing/actions/billingClientsActions';
import {
  type ContractSubTab,
  getDraftTabBadgeCount,
  normalizeContractSubtab,
} from './contractsTabs';

const Contracts: React.FC = () => {
  const { t } = useTranslation('msp/contracts');
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get active sub-tab from URL or default to 'templates'
  const activeSubTab = normalizeContractSubtab(searchParams?.get('subtab'));

  const [templateContracts, setTemplateContracts] = useState<IContract[]>([]);
  const [clientContracts, setClientContracts] = useState<IContractWithClient[]>([]);
  const [draftContracts, setDraftContracts] = useState<IContractWithClient[]>([]);
  const [draftToResume, setDraftToResume] = useState<DraftContractWizardData | null>(null);
  const [draftToDiscard, setDraftToDiscard] = useState<{
    contractId: string;
    contractName: string;
    clientName: string;
  } | null>(null);
  const [isDiscardingDraft, setIsDiscardingDraft] = useState(false);
  const [contractToDelete, setContractToDelete] = useState<{
    contractId: string;
    contractName: string;
    kind: 'template' | 'client';
    clientName?: string;
  } | null>(null);
  const [isDeletingContract, setIsDeletingContract] = useState(false);
  const [showTemplateWizard, setShowTemplateWizard] = useState(false);
  const [showClientWizard, setShowClientWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [draftSearchTerm, setDraftSearchTerm] = useState('');

  // Pagination state for templates
  const [templateCurrentPage, setTemplateCurrentPage] = useState(1);
  const [templatePageSize, setTemplatePageSize] = useState(10);

  // Pagination state for client contracts
  const [clientCurrentPage, setClientCurrentPage] = useState(1);
  const [clientPageSize, setClientPageSize] = useState(10);

  // Pagination state for draft contracts
  const [draftCurrentPage, setDraftCurrentPage] = useState(1);
  const [draftPageSize, setDraftPageSize] = useState(10);

  const contractSubtabLabels = useMemo<Record<ContractSubTab, string>>(
    () => ({
      templates: t('common.tabs.templates', { defaultValue: 'Templates' }),
      'client-contracts': t('common.tabs.clientContracts', { defaultValue: 'Client Contracts' }),
      drafts: t('common.tabs.drafts', { defaultValue: 'Drafts' }),
    }),
    [t]
  );

  // Handle page size change for templates - reset to page 1
  const handleTemplatePageSizeChange = (newPageSize: number) => {
    setTemplatePageSize(newPageSize);
    setTemplateCurrentPage(1);
  };

  // Handle page size change for client contracts - reset to page 1
  const handleClientPageSizeChange = (newPageSize: number) => {
    setClientPageSize(newPageSize);
    setClientCurrentPage(1);
  };

  // Handle page size change for draft contracts - reset to page 1
  const handleDraftPageSizeChange = (newPageSize: number) => {
    setDraftPageSize(newPageSize);
    setDraftCurrentPage(1);
  };

  useEffect(() => {
    void fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      setIsLoading(true);
      const [fetchedTemplates, fetchedAssignments, fetchedDrafts] = await Promise.all([
        getContractTemplates(),
        getContractsWithClients(),
        getDraftContracts(),
      ]);
      setTemplateContracts(fetchedTemplates);
      setClientContracts(fetchedAssignments.filter((assignment) => Boolean(assignment.client_id)));
      setDraftContracts(fetchedDrafts);
      setError(null);
    } catch (err) {
      console.error('Error fetching contracts:', err);
      setError(t('contractsList.errors.failedToFetch', { defaultValue: 'Failed to fetch contracts' }));
    } finally {
      setIsLoading(false);
    }
  };

  const updateUrlForView = (view: 'Templates' | 'Client Contracts') => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', 'contracts');
    if (view === 'Client Contracts') {
      params.set('subtab', 'client-contracts');
    } else {
      params.set('subtab', 'templates');
    }
    router.replace(`/msp/billing?${params.toString()}`);
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
      await fetchContracts();
      setContractToDelete(null);
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('contractsList.toasts.failedToDeleteContract', { defaultValue: 'Failed to delete contract' });
      toast.error(message);
    } finally {
      setIsDeletingContract(false);
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
        : t('contractsList.toasts.failedToResumeDraft', { defaultValue: 'Failed to resume draft' });
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDiscardDraft = async () => {
    if (!draftToDiscard) return;
    setIsDiscardingDraft(true);
    try {
      const result = await deleteContract(draftToDiscard.contractId);
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }
      await fetchContracts();
      toast.success(t('contractsList.toasts.draftDiscarded', { defaultValue: 'Draft discarded' }));
      setDraftToDiscard(null);
    } catch (err) {
      handleError(err, t('contractsList.toasts.failedToDiscardDraft', { defaultValue: 'Failed to discard draft' }));
    } finally {
      setIsDiscardingDraft(false);
    }
  };

  const handleTerminateContract = async (clientContractId?: string) => {
    try {
      if (!clientContractId) {
        throw new Error('Missing client contract identifier');
      }
      await updateClientContractForBilling(clientContractId, { is_active: false });
      await fetchContracts();
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('contractsList.toasts.failedToTerminateContract', { defaultValue: 'Failed to terminate contract' });
      toast.error(message);
    }
  };

  const handleRestoreContract = async (clientContractId?: string) => {
    try {
      if (!clientContractId) {
        throw new Error('Missing client contract identifier');
      }
      await updateClientContractForBilling(clientContractId, { is_active: true });
      await fetchContracts();
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('contractsList.toasts.failedToRestoreContract', { defaultValue: 'Failed to restore contract' });
      toast.error(message);
    }
  };

  const handleSetToActive = async (clientContractId?: string) => {
    try {
      if (!clientContractId) {
        throw new Error('Missing client contract identifier');
      }
      await updateClientContractForBilling(clientContractId, { is_active: true });
      await fetchContracts();
    } catch (err) {
      const message = err instanceof Error
        ? err.message
        : t('contractsList.toasts.failedToActivateContract', { defaultValue: 'Failed to activate contract' });
      toast.error(message);
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

  const templateColumns: ColumnDefinition<IContract>[] = [
    {
      title: t('contractsList.columns.contractName', { defaultValue: 'Contract Name' }),
      dataIndex: 'contract_name',
    },
    {
      title: t('contractsList.columns.description', { defaultValue: 'Description' }),
      dataIndex: 'contract_description',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0
          ? value
          : t('contractsList.empty.noDescription', { defaultValue: 'No description' }),
    },
    {
      title: t('contractsList.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'assignment_status',
      render: (value: string | null, record) => renderStatusBadge(value ?? record.status),
    },
    {
      title: t('contractsList.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'contract_id',
      render: (value, record) => (
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
              id="edit-contract-menu-item"
              onClick={(event) => {
                event.stopPropagation();
                if (record.contract_id) {
                  router.push(`/msp/billing?tab=contracts&contractId=${record.contract_id}`);
                }
              }}
            >
              {t('common.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-template-contract-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                if (record.contract_id) {
                  setContractToDelete({
                    contractId: record.contract_id,
                    contractName: (record.contract_name?.trim()
                      || t('contractsList.empty.untitledTemplate', { defaultValue: 'Untitled template' })),
                    kind: 'template',
                  });
                }
              }}
            >
              {t('common.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const clientContractColumns: ColumnDefinition<IContractWithClient>[] = [
    {
      title: t('contractsList.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0
          ? value
          : t('contractsList.empty.dash', { defaultValue: '—' }),
    },
    {
      title: t('contractsList.columns.sourceTemplate', { defaultValue: 'Source Template' }),
      dataIndex: 'template_contract_name',
      render: (value: string | null) =>
        value && value.trim().length > 0 ? value : t('contractsList.empty.dash', { defaultValue: '—' }),
    },
    {
      title: t('contractsList.columns.contractName', { defaultValue: 'Contract Name' }),
      dataIndex: 'contract_name',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0
          ? value
          : t('contractsList.empty.dash', { defaultValue: '—' }),
    },
    {
      title: t('contractsList.columns.startDate', { defaultValue: 'Start Date' }),
      dataIndex: 'start_date',
      render: (value: any) => {
        if (!value) return t('contractsList.empty.dash', { defaultValue: '—' });
        try {
          const date = new Date(value);
          return isNaN(date.getTime()) ? t('contractsList.empty.dash', { defaultValue: '—' }) : date.toLocaleDateString();
        } catch {
          return t('contractsList.empty.dash', { defaultValue: '—' });
        }
      },
    },
    {
      title: t('contractsList.columns.endDate', { defaultValue: 'End Date' }),
      dataIndex: 'end_date',
      render: (value: any) => {
        if (!value) return t('contractsList.empty.dash', { defaultValue: '—' });
        try {
          const date = new Date(value);
          return isNaN(date.getTime()) ? t('contractsList.empty.dash', { defaultValue: '—' }) : date.toLocaleDateString();
        } catch {
          return t('contractsList.empty.dash', { defaultValue: '—' });
        }
      },
    },
    {
      title: t('contractsList.columns.status', { defaultValue: 'Status' }),
      dataIndex: 'status',
      render: renderStatusBadge,
    },
    {
      title: t('contractsList.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'contract_id',
      render: (value, record) => {
        const liveStatus = record.assignment_status ?? record.status;
        const isDraft = liveStatus === 'draft';
        return (
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
                id={isDraft ? 'resume-contract-menu-item' : 'edit-contract-menu-item'}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!record.contract_id) return;
                  if (isDraft) {
                    void handleResumeDraft(record.contract_id);
                    return;
                  }
                  navigateToContract(record.contract_id, record.client_contract_id);
                }}
              >
                {isDraft
                  ? t('contractsList.actions.resume', { defaultValue: 'Resume' })
                  : t('common.actions.edit', { defaultValue: 'Edit' })}
              </DropdownMenuItem>
            {liveStatus === 'active' && (
              <DropdownMenuItem
                id="terminate-contract-menu-item"
                className="text-orange-600 focus:text-orange-600"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleTerminateContract(record.client_contract_id);
                }}
              >
                {t('contractsList.actions.terminate', { defaultValue: 'Terminate' })}
              </DropdownMenuItem>
            )}
            {liveStatus === 'terminated' && (
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
            {liveStatus === 'draft' && (
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
            <DropdownMenuItem
              id="delete-client-contract-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                if (record.contract_id) {
                  setContractToDelete({
                    contractId: record.contract_id,
                    contractName: (record.contract_name?.trim()
                      || t('contractsList.empty.untitledContract', { defaultValue: 'Untitled contract' })),
                    kind: 'client',
                    clientName: record.client_name?.trim() || undefined,
                  });
                }
              }}
            >
              {t('common.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const filteredTemplateContracts = templateContracts.filter((contract) => {
    if (!templateSearchTerm) {
      return true;
    }
    const search = templateSearchTerm.toLowerCase();
    return (
      contract.contract_name?.toLowerCase().includes(search) ||
      contract.contract_description?.toLowerCase().includes(search)
    );
  });

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

  const draftCount = draftContracts.length;
  const draftBadgeCount = getDraftTabBadgeCount(draftCount);

  const renderTemplateTab = () => (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-md w-full">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder={t('contractsList.search.templatesPlaceholder', { defaultValue: 'Search templates...' })}
            value={templateSearchTerm}
            onChange={(event) => setTemplateSearchTerm(event.target.value)}
            className="pl-10"
            aria-label={t('contractsList.search.templatesAriaLabel', { defaultValue: 'Search contract templates' })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id="create-template-button"
            onClick={() => setShowTemplateWizard(true)}
            className="inline-flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            {t('contractsList.actions.createTemplate', { defaultValue: 'Create Template' })}
          </Button>
        </div>
      </div>

      <DataTable
        id="contracts-table"
        data={filteredTemplateContracts}
        columns={templateColumns}
        pagination={true}
        currentPage={templateCurrentPage}
        onPageChange={setTemplateCurrentPage}
        pageSize={templatePageSize}
        onItemsPerPageChange={handleTemplatePageSizeChange}
        onRowClick={(record) => navigateToContract(record.contract_id)}
        rowClassName={() => 'cursor-pointer'}
      />
    </>
  );

  const renderClientContractsTab = () => (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-md w-full">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder={t('contractsList.search.clientContractsPlaceholder', {
              defaultValue: 'Search by client or contract...',
            })}
            value={clientSearchTerm}
            onChange={(event) => setClientSearchTerm(event.target.value)}
            className="pl-10"
            aria-label={t('contractsList.search.clientContractsAriaLabel', { defaultValue: 'Search client contracts' })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <ContractDialog
            onContractSaved={fetchContracts}
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
            onClick={() => setShowClientWizard(true)}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
          >
            <Wand2 className="h-4 w-4" />
            {t('contractsList.actions.createContract', { defaultValue: 'Create Contract' })}
          </Button>
        </div>
      </div>

      <DataTable
        id="client-contracts-table"
        data={filteredClientContracts}
        columns={clientContractColumns}
        pagination={true}
        currentPage={clientCurrentPage}
        onPageChange={setClientCurrentPage}
        pageSize={clientPageSize}
        onItemsPerPageChange={handleClientPageSizeChange}
        onRowClick={(record) => navigateToContract(record.contract_id, record.client_contract_id)}
        rowClassName={() => 'cursor-pointer'}
      />
    </>
  );

  const renderDraftsTab = () => (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-md w-full">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder={t('contractsList.search.draftsPlaceholder', { defaultValue: 'Search drafts...' })}
            value={draftSearchTerm}
            onChange={(event) => setDraftSearchTerm(event.target.value)}
            className="pl-10"
            aria-label={t('contractsList.search.draftsAriaLabel', { defaultValue: 'Search draft contracts' })}
          />
        </div>
      </div>

      {draftContracts.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">
          {t('contractsList.empty.noDrafts', {
            defaultValue: 'No draft contracts. Start creating a new contract to save as draft.',
          })}
        </div>
      ) : (
        <DataTable
          id="draft-contracts-table"
          data={draftContracts.filter((contract) => {
            if (!draftSearchTerm) return true;
            const search = draftSearchTerm.toLowerCase();
            return (
              contract.contract_name?.toLowerCase().includes(search) ||
              contract.client_name?.toLowerCase().includes(search)
            );
          })}
          columns={[
            {
              title: t('contractsList.columns.contractName', { defaultValue: 'Contract Name' }),
              dataIndex: 'contract_name',
              render: (value: string | null) =>
                typeof value === 'string' && value.trim().length > 0
                  ? value
                  : t('contractsList.empty.dash', { defaultValue: '—' }),
            },
            {
              title: t('contractsList.columns.client', { defaultValue: 'Client' }),
              dataIndex: 'client_name',
              render: (value: string | null) =>
                typeof value === 'string' && value.trim().length > 0
                  ? value
                  : t('contractsList.empty.dash', { defaultValue: '—' }),
            },
            {
              title: t('contractsList.columns.created', { defaultValue: 'Created' }),
              dataIndex: 'created_at',
              render: (value: any) => {
                if (!value) return t('contractsList.empty.dash', { defaultValue: '—' });
                try {
                  const date = new Date(value);
                  return isNaN(date.getTime()) ? t('contractsList.empty.dash', { defaultValue: '—' }) : date.toLocaleDateString();
                } catch {
                  return t('contractsList.empty.dash', { defaultValue: '—' });
                }
              },
            },
            {
              title: t('contractsList.columns.lastModified', { defaultValue: 'Last Modified' }),
              dataIndex: 'updated_at',
              render: (value: any) => {
                if (!value) return t('contractsList.empty.dash', { defaultValue: '—' });
                try {
                  const date = new Date(value);
                  return isNaN(date.getTime()) ? t('contractsList.empty.dash', { defaultValue: '—' }) : date.toLocaleDateString();
                } catch {
                  return t('contractsList.empty.dash', { defaultValue: '—' });
                }
              },
            },
            {
              title: t('contractsList.columns.actions', { defaultValue: 'Actions' }),
              dataIndex: 'contract_id',
              render: (value, record) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      id="draft-actions-menu"
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
                      id="resume-draft-menu-item"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (record.contract_id) {
                          void handleResumeDraft(record.contract_id);
                        }
                      }}
                    >
                      {t('contractsList.actions.resume', { defaultValue: 'Resume' })}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      id="discard-draft-menu-item"
                      className="text-red-600 focus:text-red-600"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (record.contract_id) {
                          setDraftToDiscard({
                            contractId: record.contract_id,
                            contractName: record.contract_name
                              || t('contractsList.empty.untitledDraft', { defaultValue: 'Untitled draft' }),
                            clientName: record.client_name
                              || t('contractsList.empty.unknownClient', { defaultValue: 'Unknown client' }),
                          });
                        }
                      }}
                    >
                      {t('common.actions.discard', { defaultValue: 'Discard' })}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ]}
          pagination={true}
          currentPage={draftCurrentPage}
          onPageChange={setDraftCurrentPage}
          pageSize={draftPageSize}
          onItemsPerPageChange={handleDraftPageSizeChange}
          initialSorting={[{ id: 'updated_at', desc: true }]}
        />
      )}
    </>
  );

  const tabs = [
    { id: 'templates', label: contractSubtabLabels.templates, content: renderTemplateTab() },
    { id: 'client-contracts', label: contractSubtabLabels['client-contracts'], content: renderClientContractsTab() },
    {
      id: 'drafts',
      label: contractSubtabLabels.drafts,
      icon: draftBadgeCount != null ? (
        <Badge
          variant="default-muted"
          className="ml-2 order-last"
          aria-label={t('contractsList.drafts.badgeCount', {
            defaultValue: '{{count}} draft contracts',
            count: draftBadgeCount,
          })}
        >
          {draftBadgeCount}
        </Badge>
      ) : undefined,
      content: renderDraftsTab(),
    },
  ];

  return (
    <>
      <Card size="2">
        <Box p="4">
          <div className="flex justify-between items-center mb-4">
            <div className="space-y-1">
              <Heading as="h3" size="4">
                {t('contractsList.heading.title', { defaultValue: 'Contracts' })}
              </Heading>
              <p className="text-sm text-muted-foreground">
                {t('contractsList.heading.description', {
                  defaultValue: 'Templates are reusable definitions. Client contracts are client-owned instances.',
                })}
              </p>
            </div>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isLoading ? (
            <LoadingIndicator
              className="py-12 text-muted-foreground"
              layout="stacked"
              spinnerProps={{ size: 'md' }}
              text={t('contractsList.loading.contracts', { defaultValue: 'Loading contracts...' })}
              textClassName="text-muted-foreground"
            />
          ) : (
            <CustomTabs
              tabs={tabs}
              defaultTab={activeSubTab}
              onTabChange={(tabId) => {
                if (tabId === activeSubTab) {
                  return;
                }

                const params = new URLSearchParams(searchParams?.toString() ?? '');
                params.set('tab', 'contracts');
                params.set('subtab', tabId);
                router.push(`/msp/billing?${params.toString()}`);
              }}
            />
          )}
        </Box>
      </Card>
      <TemplateWizard
        open={showTemplateWizard}
        onOpenChange={setShowTemplateWizard}
        onComplete={() => {
          setShowTemplateWizard(false);
          void fetchContracts();
        }}
      />
      <ContractWizard
        open={showClientWizard}
        onOpenChange={setShowClientWizard}
        onComplete={() => {
          setShowClientWizard(false);
          setDraftToResume(null);
          void fetchContracts();
        }}
        editingContract={draftToResume}
      />
      <ConfirmationDialog
        id="discard-draft-confirmation"
        isOpen={!!draftToDiscard}
        onClose={() => setDraftToDiscard(null)}
        onConfirm={handleConfirmDiscardDraft}
        title={t('contractsList.dialogs.discardDraft.title', { defaultValue: 'Discard Draft Contract?' })}
        message={
          draftToDiscard
            ? t('contractsList.dialogs.discardDraft.message', {
              defaultValue: 'This will permanently delete the draft "{{contractName}}" for {{clientName}}.\nThis action cannot be undone.',
              contractName: draftToDiscard.contractName,
              clientName: draftToDiscard.clientName,
            })
            : ''
        }
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        confirmLabel={t('common.actions.discard', { defaultValue: 'Discard' })}
        isConfirming={isDiscardingDraft}
      />
      <ConfirmationDialog
        id="delete-contract-confirmation"
        isOpen={!!contractToDelete}
        onClose={() => {
          if (!isDeletingContract) {
            setContractToDelete(null);
          }
        }}
        onConfirm={confirmDeleteContract}
        title={
          contractToDelete?.kind === 'client'
            ? t('contractsList.dialogs.deleteClient.title', { defaultValue: 'Delete client contract?' })
            : t('contractsList.dialogs.deleteTemplate.title', { defaultValue: 'Delete contract template?' })
        }
        message={
          contractToDelete
            ? contractToDelete.kind === 'client'
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
              : t('contractsList.dialogs.deleteTemplate.message', {
                defaultValue: 'Are you sure you want to permanently delete the template "{{contractName}}"? This action cannot be undone.',
                contractName: contractToDelete.contractName,
              })
            : ''
        }
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        confirmLabel={isDeletingContract
          ? t('contractsList.actions.deleting', { defaultValue: 'Deleting…' })
          : t('common.actions.delete', { defaultValue: 'Delete' })}
        isConfirming={isDeletingContract}
      />
    </>
  );
};

export default Contracts;
