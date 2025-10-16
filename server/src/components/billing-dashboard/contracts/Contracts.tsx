'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Badge } from 'server/src/components/ui/Badge';
import { MoreVertical, Plus, Wand2, Search } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Input } from 'server/src/components/ui/Input';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContractWithClient } from 'server/src/interfaces/contract.interfaces';
import { getContractsWithClients, deleteContract, updateContract, checkClientHasActiveContract } from 'server/src/lib/actions/contractActions';
import { ContractDialog } from './ContractDialog';
import { ContractWizard } from './ContractWizard';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';

const Contracts: React.FC = () => {
  const [contracts, setContracts] = useState<IContractWithClient[]>([]);
  const [editingContract, setEditingContract] = useState<IContractWithClient | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      setIsLoading(true);
      const fetchedContracts = await getContractsWithClients();
      setContracts(fetchedContracts);
      setError(null);
    } catch (err) {
      console.error('Error fetching contracts:', err);
      setError('Failed to fetch contracts');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteContract = async (contractId: string) => {
    try {
      await deleteContract(contractId);
      fetchContracts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete contract';
      alert(message);
    }
  };

  const handleTerminateContract = async (contractId: string) => {
    try {
      await updateContract(contractId, { status: 'terminated' });
      fetchContracts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to terminate contract';
      alert(message);
    }
  };

  const handleRestoreContract = async (contractId: string, clientId?: string) => {
    if (!clientId) {
      alert('Cannot restore contract: client information is missing.');
      return;
    }

    try {
      // Check if client already has an active contract
      const hasActiveContract = await checkClientHasActiveContract(clientId, contractId);

      if (hasActiveContract) {
        alert('Cannot restore this contract to active status because the client already has an active contract. Please terminate their current active contract first, or restore this contract as a draft.');
        return;
      }

      await updateContract(contractId, { status: 'active' });
      fetchContracts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to restore contract';
      alert(message);
    }
  };

  const handleSetToActive = async (contractId: string, clientId?: string) => {
    if (!clientId) {
      alert('Cannot activate contract: client information is missing.');
      return;
    }

    try {
      // Check if client already has an active contract
      const hasActiveContract = await checkClientHasActiveContract(clientId, contractId);

      if (hasActiveContract) {
        alert('Cannot set this contract to active because the client already has an active contract. Please terminate their current active contract first.');
        return;
      }

      await updateContract(contractId, { status: 'active' });
      fetchContracts();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to activate contract';
      alert(message);
    }
  };

  const contractColumns: ColumnDefinition<IContractWithClient>[] = [
    {
      title: 'Contract Name',
      dataIndex: 'contract_name',
    },
    {
      title: 'Client',
      dataIndex: 'client_name',
      render: (value) => value || '—',
    },
    {
      title: 'Description',
      dataIndex: 'contract_description',
      render: (value) => value || 'No description',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (value) => {
        const statusConfig = {
          active: { className: 'bg-green-100 text-green-800', label: 'Active' },
          draft: { className: 'bg-gray-100 text-gray-800', label: 'Draft' },
          terminated: { className: 'bg-orange-100 text-orange-800', label: 'Terminated' },
          expired: { className: 'bg-red-100 text-red-800', label: 'Expired' },
        };
        const config = statusConfig[value as keyof typeof statusConfig] || statusConfig.draft;
        return (
          <Badge className={config.className}>
            {config.label}
          </Badge>
        );
      },
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
            {record.status === 'active' && (
              <DropdownMenuItem
                id="terminate-contract-menu-item"
                className="text-orange-600 focus:text-orange-600"
                onClick={(event) => {
                  event.stopPropagation();
                  if (record.contract_id) {
                    handleTerminateContract(record.contract_id);
                  }
                }}
              >
                Terminate
              </DropdownMenuItem>
            )}
            {record.status === 'terminated' && (
              <DropdownMenuItem
                id="restore-contract-menu-item"
                className="text-green-600 focus:text-green-600"
                onClick={(event) => {
                  event.stopPropagation();
                  if (record.contract_id) {
                    handleRestoreContract(record.contract_id, record.client_id);
                  }
                }}
              >
                Restore
              </DropdownMenuItem>
            )}
            {record.status === 'draft' && (
              <DropdownMenuItem
                id="set-to-active-menu-item"
                className="text-green-600 focus:text-green-600"
                onClick={(event) => {
                  event.stopPropagation();
                  if (record.contract_id) {
                    handleSetToActive(record.contract_id, record.client_id);
                  }
                }}
              >
                Set to Active
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              id="delete-contract-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(event) => {
                event.stopPropagation();
                if (record.contract_id) {
                  handleDeleteContract(record.contract_id);
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

  const handleContractClick = (record: IContractWithClient) => {
    if (record.contract_id) {
      router.push(`/msp/billing?tab=contracts&contractId=${record.contract_id}`);
    }
  };

  // Filter contracts by search term
  const filteredContracts = contracts
    .filter((contract) => contract.contract_id !== undefined)
    .filter((contract) => {
      if (!searchTerm) return true;
      const searchLower = searchTerm.toLowerCase();
      return (
        contract.contract_name?.toLowerCase().includes(searchLower) ||
        contract.client_name?.toLowerCase().includes(searchLower)
      );
    });

  return (
    <>
      <Card size="2">
        <Box p="4">
          <div className="flex justify-between items-center mb-4">
            <Heading as="h3" size="4">
              Contracts
            </Heading>
            <div className="flex gap-2">
              <Button
                id="wizard-contract-button"
                data-automation-id="wizard-contract-button"
                onClick={() => setShowWizard(true)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Create with Wizard
              </Button>
              <ContractDialog
                onContractSaved={fetchContracts}
                editingContract={editingContract}
                onClose={() => setEditingContract(null)}
                triggerButton={
                  <Button id="add-contract-button" variant="outline">
                    <Plus className="h-4 w-4 mr-2" />
                    Quick Add
                  </Button>
                }
              />
            </div>
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
            <>
              <div className="mb-4">
                <div className="relative max-w-md">
                  <Search
                    className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"
                    aria-hidden="true"
                  />
                  <Input
                    type="text"
                    placeholder="Search by contract name or client..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                    aria-label="Search contracts"
                  />
                </div>
              </div>

              <DataTable
                data={filteredContracts}
                columns={contractColumns}
                pagination={true}
                onRowClick={handleContractClick}
                rowClassName={() => 'cursor-pointer'}
              />
            </>
          )}
        </Box>
      </Card>

      <ContractWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        onComplete={() => {
          setShowWizard(false);
          fetchContracts();
        }}
      />
    </>
  );
};

export default Contracts;
