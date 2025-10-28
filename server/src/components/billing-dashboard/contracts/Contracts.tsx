'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { MoreVertical, Wand2, Search, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Input } from 'server/src/components/ui/Input';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContract, IContractWithClient } from 'server/src/interfaces/contract.interfaces';
import {
  checkClientHasActiveContract,
  deleteContract,
  getContractTemplates,
  getContractsWithClients,
  updateContract,
} from 'server/src/lib/actions/contractActions';
import { ContractWizard } from './ContractWizard';
import { TemplateWizard } from './template-wizard/TemplateWizard';

const Contracts: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [templateContracts, setTemplateContracts] = useState<IContract[]>([]);
  const [clientContracts, setClientContracts] = useState<IContractWithClient[]>([]);
  const [showTemplateWizard, setShowTemplateWizard] = useState(false);
  const [showClientWizard, setShowClientWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeView, setActiveView] = useState<'Templates' | 'Client Contracts'>('Templates');
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');
  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const pendingViewRef = useRef<'Templates' | 'Client Contracts' | null>(null);

  useEffect(() => {
    void fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      setIsLoading(true);
      const [fetchedTemplates, fetchedAssignments] = await Promise.all([
        getContractTemplates(),
        getContractsWithClients(),
      ]);
      setTemplateContracts(fetchedTemplates);
      setClientContracts(fetchedAssignments.filter((assignment) => Boolean(assignment.client_id)));
      setError(null);
    } catch (err) {
      console.error('Error fetching contracts:', err);
      setError('Failed to fetch contracts');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const subtab = searchParams?.get('subtab');
    const desiredView = subtab === 'clients' ? 'Client Contracts' : 'Templates';
    if (pendingViewRef.current) {
      if (desiredView === pendingViewRef.current) {
        pendingViewRef.current = null;
      } else {
        return;
      }
    }
    if (activeView !== desiredView) {
      setActiveView(desiredView);
    }
  }, [searchParams, activeView]);

  const updateUrlForView = (view: 'Templates' | 'Client Contracts') => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('tab', 'contracts');
    if (view === 'Client Contracts') {
      params.set('subtab', 'clients');
    } else {
      params.set('subtab', 'templates');
    }
    router.replace(`/msp/billing?${params.toString()}`);
  };

  const handleDeleteContract = async (contractId: string) => {
    try {
      await deleteContract(contractId);
      await fetchContracts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete contract';
      alert(message);
    }
  };

  const handleTerminateContract = async (contractId: string) => {
    try {
      await updateContract(contractId, { status: 'terminated' });
      await fetchContracts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to terminate contract';
      alert(message);
    }
  };

  const handleRestoreContract = async (contractId: string, clientId?: string) => {
    try {
      if (clientId) {
        const hasActiveContract = await checkClientHasActiveContract(clientId, contractId);
        if (hasActiveContract) {
          alert('Cannot restore this contract to active status because the client already has an active contract. Please terminate their current active contract first, or restore this contract as a draft.');
          return;
        }
      }
      await updateContract(contractId, { status: 'active' });
      await fetchContracts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restore contract';
      alert(message);
    }
  };

  const handleSetToActive = async (contractId: string, clientId?: string) => {
    try {
      if (clientId) {
        const hasActiveContract = await checkClientHasActiveContract(clientId, contractId);
        if (hasActiveContract) {
          alert('Cannot set this contract to active because the client already has an active contract. Please terminate their current active contract first.');
          return;
        }
      }
      await updateContract(contractId, { status: 'active' });
      await fetchContracts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to activate contract';
      alert(message);
    }
  };

  const navigateToContract = (contractId?: string, clientContractId?: string) => {
    if (contractId) {
      const params = new URLSearchParams();
      params.set('tab', 'contracts');
      if (clientContractId) {
        params.set('subtab', 'clients');
        params.set('contractId', contractId);
        params.set('clientContractId', clientContractId);
      } else {
        params.set('subtab', 'templates');
        params.set('contractId', contractId);
      }
      router.push(`/msp/billing?${params.toString()}`);
    }
  };

const renderStatusBadge = (status: string) => {
  const normalized = (status || 'draft').toLowerCase();
  const statusConfig: Record<string, { className: string; label: string }> = {
    active: { className: 'bg-green-100 text-green-800', label: 'Active' },
    draft: { className: 'bg-gray-100 text-gray-800', label: 'Draft' },
    terminated: { className: 'bg-orange-100 text-orange-800', label: 'Terminated' },
    expired: { className: 'bg-red-100 text-red-800', label: 'Expired' },
    published: { className: 'bg-green-100 text-green-800', label: 'Published' },
    archived: { className: 'bg-gray-200 text-gray-700', label: 'Archived' },
  };
  const config = statusConfig[normalized] ?? statusConfig.draft;
  return <Badge className={config.className}>{config.label}</Badge>;
};

  const templateColumns: ColumnDefinition<IContract>[] = [
    {
      title: 'Contract Name',
      dataIndex: 'contract_name',
    },
    {
      title: 'Description',
      dataIndex: 'contract_description',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0 ? value : 'No description',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: renderStatusBadge,
    },
    {
      title: 'Actions',
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
              <span className="sr-only">Open menu</span>
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
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-contract-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                if (record.contract_id) {
                  void handleDeleteContract(record.contract_id);
                }
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const clientContractColumns: ColumnDefinition<IContractWithClient>[] = [
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0 ? value : '—',
    },
    {
      title: 'Contract Template',
      dataIndex: 'template_contract_name',
      render: (_value: string | null, record) =>
        record.template_contract_name && record.template_contract_name.trim().length > 0
          ? record.template_contract_name
          : record.contract_name && record.contract_name.trim().length > 0
            ? record.contract_name
            : '—',
    },
    {
      title: 'Contract Name',
      dataIndex: 'contract_name',
      render: (value: string | null) =>
        typeof value === 'string' && value.trim().length > 0 ? value : '—',
    },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      render: (value: string | null) => {
        if (typeof value !== 'string' || value.length === 0) {
          return '—';
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
      },
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value: string | null) => {
        if (typeof value !== 'string' || value.length === 0) {
          return '—';
        }
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: renderStatusBadge,
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

  const renderTemplateTab = () => (
    <>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="relative max-w-md w-full">
          <Search
            className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder="Search templates..."
            value={templateSearchTerm}
            onChange={(event) => setTemplateSearchTerm(event.target.value)}
            className="pl-10"
            aria-label="Search contract templates"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id="create-template-button"
            onClick={() => setShowTemplateWizard(true)}
            className="inline-flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4" />
            Create Template
          </Button>
        </div>
      </div>

      <DataTable
        data={filteredTemplateContracts}
        columns={templateColumns}
        pagination
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
            className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
            aria-hidden="true"
          />
          <Input
            type="text"
            placeholder="Search by client or contract..."
            value={clientSearchTerm}
            onChange={(event) => setClientSearchTerm(event.target.value)}
            className="pl-10"
            aria-label="Search client contracts"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id="client-wizard-button"
            onClick={() => setShowClientWizard(true)}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700"
          >
            <Wand2 className="h-4 w-4" />
            Create Contract
          </Button>
        </div>
      </div>

      <DataTable
        data={filteredClientContracts}
        columns={clientContractColumns}
        pagination
        onRowClick={(record) => navigateToContract(record.contract_id, record.client_contract_id)}
        rowClassName={() => 'cursor-pointer'}
      />
    </>
  );

  const tabs = [
    { label: 'Templates', content: renderTemplateTab() },
    { label: 'Client Contracts', content: renderClientContractsTab() },
  ];

  return (
    <>
      <Card size="2">
        <Box p="4">
          <div className="flex justify-between items-center mb-4">
            <Heading as="h3" size="4">
              Contracts
            </Heading>
          </div>

          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {isLoading ? (
            <LoadingIndicator
              className="py-12 text-gray-600"
              layout="stacked"
              spinnerProps={{ size: 'md' }}
              text="Loading contracts..."
              textClassName="text-gray-600"
            />
          ) : (
            <CustomTabs
              tabs={tabs}
              defaultTab={activeView}
              onTabChange={(tab) => {
                const view = tab === 'Client Contracts' ? 'Client Contracts' : 'Templates';
                pendingViewRef.current = view;
                setActiveView(view);
                updateUrlForView(view);
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
          void fetchContracts();
        }}
      />
    </>
  );
};

export default Contracts;
