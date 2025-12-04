'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { MoreVertical, Search, Sparkles } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Input } from 'server/src/components/ui/Input';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import {
  deleteContract,
  getContractTemplates,
} from 'server/src/lib/actions/contractActions';
import { TemplateWizard } from './template-wizard/TemplateWizard';

interface TemplatesTabProps {
  onRefreshNeeded?: () => void;
  refreshTrigger?: number;
}

const TemplatesTab: React.FC<TemplatesTabProps> = ({ onRefreshNeeded, refreshTrigger }) => {
  const router = useRouter();
  const [templateContracts, setTemplateContracts] = useState<IContract[]>([]);
  const [showTemplateWizard, setShowTemplateWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [templateSearchTerm, setTemplateSearchTerm] = useState('');

  useEffect(() => {
    void fetchTemplates();
  }, [refreshTrigger]);

  const fetchTemplates = async () => {
    try {
      setIsLoading(true);
      const fetchedTemplates = await getContractTemplates();
      setTemplateContracts(fetchedTemplates);
      setError(null);
    } catch (err) {
      console.error('Error fetching templates:', err);
      setError('Failed to fetch templates');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteContract = async (contractId: string) => {
    try {
      await deleteContract(contractId);
      await fetchTemplates();
      onRefreshNeeded?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete contract';
      alert(message);
    }
  };

  const navigateToContract = (contractId?: string) => {
    if (contractId) {
      const params = new URLSearchParams();
      params.set('tab', 'contracts');
      params.set('contractId', contractId);
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
      title: 'Template Name',
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

  if (isLoading) {
    return (
      <Card size="2">
        <Box p="4">
          <LoadingIndicator
            className="py-12 text-gray-600"
            layout="stacked"
            spinnerProps={{ size: 'md' }}
            text="Loading templates..."
            textClassName="text-gray-600"
          />
        </Box>
      </Card>
    );
  }

  if (error) {
    return (
      <Card size="2">
        <Box p="4">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        </Box>
      </Card>
    );
  }

  return (
    <>
      <Card size="2">
        <Box p="4">
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
        </Box>
      </Card>
      <TemplateWizard
        open={showTemplateWizard}
        onOpenChange={setShowTemplateWizard}
        onComplete={() => {
          setShowTemplateWizard(false);
          void fetchTemplates();
          onRefreshNeeded?.();
        }}
      />
    </>
  );
};

export default TemplatesTab;
