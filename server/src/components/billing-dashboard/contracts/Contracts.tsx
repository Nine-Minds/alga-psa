'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Plus, Wand2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { getContracts, deleteContract } from 'server/src/lib/actions/contractActions';
import { ContractDialog } from './ContractDialog';
import { ContractWizard } from './ContractWizard';

const Contracts: React.FC = () => {
  const [contracts, setContracts] = useState<IContract[]>([]);
  const [editingContract, setEditingContract] = useState<IContract | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      const fetchedContracts = await getContracts();
      setContracts(fetchedContracts);
      setError(null);
    } catch (err) {
      console.error('Error fetching contracts:', err);
      setError('Failed to fetch contracts');
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

  const contractColumns: ColumnDefinition<IContract>[] = [
    {
      title: 'Contract Name',
      dataIndex: 'contract_name',
    },
    {
      title: 'Description',
      dataIndex: 'contract_description',
      render: (value) => value || 'No description',
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (value) => (value ? 'Active' : 'Inactive'),
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
                setEditingContract({ ...record });
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

  const handleContractClick = (record: IContract) => {
    if (record.contract_id) {
      router.push(`/msp/billing?tab=contracts&contractId=${record.contract_id}`);
    }
  };

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

          <DataTable
            data={contracts.filter((contract) => contract.contract_id !== undefined)}
            columns={contractColumns}
            pagination={true}
            onRowClick={handleContractClick}
            rowClassName={() => 'cursor-pointer'}
          />
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
