'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Plus } from 'lucide-react';
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
  const [isWizardOpen, setIsWizardOpen] = useState(false);
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
    } catch (error) {
      console.error('Error fetching contracts:', error);
      setError('Failed to fetch contracts');
    }
  };

  const handleDeleteContract = async (contractId: string) => {
    try {
      await deleteContract(contractId);
      fetchContracts();
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert('Failed to delete contract');
      }
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
      render: (value) => value ?? 'No description',
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (value) => value ? 'Active' : 'Inactive',
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
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id="edit-contract-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setEditingContract({ ...record });
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-contract-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteContract(record.contract_id!);
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
    <Card size="2">
      <Box p="4">
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <Heading as="h3" size="4">Contracts</Heading>
          <div className="flex items-center gap-2">
            <Button
              id="wizard-contract-button"
              data-automation-id="wizard-contract-button"
              variant="primary"
              onClick={() => setIsWizardOpen(true)}
            >
              Start Contract Wizard
            </Button>
            <ContractDialog
              onContractSaved={fetchContracts}
              editingContract={editingContract}
              onClose={() => setEditingContract(null)}
              triggerButton={
                <Button id='add-contract-button'>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Contract
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
          rowClassName={() => "cursor-pointer"}
        />
      </Box>
      <ContractWizard
        open={isWizardOpen}
        onOpenChange={(open) => setIsWizardOpen(open)}
        onComplete={() => {
          setIsWizardOpen(false);
          fetchContracts();
        }}
      />
    </Card>
  );
};

export default Contracts;
