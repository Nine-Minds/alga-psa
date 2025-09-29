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
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundles, deletePlanBundle } from 'server/src/lib/actions/planBundleActions';
import { ContractDialog } from './ContractDialog';
import { ContractWizard } from './ContractWizard';

const Contracts: React.FC = () => {
  const [contracts, setContracts] = useState<IPlanBundle[]>([]);
  const [editingContract, setEditingContract] = useState<IPlanBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showWizard, setShowWizard] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetchContracts();
  }, []);

  const fetchContracts = async () => {
    try {
      const fetchedContracts = await getPlanBundles();
      setContracts(fetchedContracts);
      setError(null);
    } catch (error) {
      console.error('Error fetching contracts:', error);
      setError('Failed to fetch contracts');
    }
  };

  const handleDeleteContract = async (contractId: string) => {
    try {
      await deletePlanBundle(contractId);
      fetchContracts();
    } catch (error) {
      if (error instanceof Error) {
        alert(error.message);
      } else {
        alert('Failed to delete contract');
      }
    }
  };

  const contractColumns: ColumnDefinition<IPlanBundle>[] = [
    {
      title: 'Contract Name',
      dataIndex: 'bundle_name',
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value) => value || 'No description',
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (value) => value ? 'Active' : 'Inactive',
    },
    {
      title: 'Actions',
      dataIndex: 'bundle_id',
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
                setEditingContract({...record});
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-contract-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={async (e) => {
                e.stopPropagation();
                if (record.bundle_id) {
                  handleDeleteContract(record.bundle_id);
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

  const handleContractClick = (contract: IPlanBundle) => {
    if (contract.bundle_id) {
      router.push(`/msp/billing?tab=contracts&contractId=${contract.bundle_id}`);
    }
  };

  return (
    <>
      <Card size="2">
        <Box p="4">
          <div className="flex justify-between items-center mb-4">
            <Heading as="h3" size="4">Contracts</Heading>
            <div className="flex gap-2">
              <Button
                id='wizard-contract-button'
                onClick={() => setShowWizard(true)}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                <Wand2 className="h-4 w-4 mr-2" />
                Create with Wizard
              </Button>
              <ContractDialog
                onContractAdded={fetchContracts}
                editingContract={editingContract}
                onClose={() => setEditingContract(null)}
                triggerButton={
                  <Button id='add-contract-button' variant="outline">
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
            data={contracts.filter(contract => contract.bundle_id !== undefined)}
            columns={contractColumns}
            pagination={true}
            onRowClick={handleContractClick}
            rowClassName={() => "cursor-pointer"}
          />
        </Box>
      </Card>

      <ContractWizard
        open={showWizard}
        onOpenChange={setShowWizard}
        onComplete={(data) => {
          console.log('Contract created:', data);
          setShowWizard(false);
          fetchContracts();
        }}
      />
    </>
  );
};

export default Contracts;