'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { toast } from 'react-hot-toast'; // Import toast
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import { ContractLineDialog } from '../ContractLineDialog';
import { getContractLines, deleteContractLine } from 'server/src/lib/actions/contractLineAction';
import { IContractLine, IServiceType } from 'server/src/interfaces/billing.interfaces'; // Added IServiceType
import { getServiceTypesForSelection } from 'server/src/lib/actions/serviceActions'; // Added import for fetching types
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { CONTRACT_LINE_TYPE_DISPLAY, BILLING_FREQUENCY_DISPLAY } from 'server/src/constants/billing';

const ContractLinesOverview: React.FC = () => {
  const [contractLines, setContractLines] = useState<IContractLine[]>([]);
  const [editingContractLine, setEditingContractLine] = useState<IContractLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allServiceTypes, setAllServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]>([]); // Added state for service types
  const router = useRouter();

  useEffect(() => {
    fetchContractLines();
    fetchAllServiceTypes(); // Fetch service types on mount
  }, []);

  const fetchContractLines = async () => {
    try {
      const fetchedContractLines = await getContractLines();
      setContractLines(fetchedContractLines);
      setError(null);
    } catch (error) {
      console.error('Error fetching contract lines:', error);
      setError('Failed to fetch contract lines');
    }
  };

  // Function to fetch all service types
  const fetchAllServiceTypes = async () => {
    try {
      const types = await getServiceTypesForSelection();
      setAllServiceTypes(types);
    } catch (error) {
      console.error('Error fetching service types:', error);
      // Optionally set an error state specific to service types
    }
  };

  const handleDeleteContractLine = async (contractLineId: string) => {
    try {
      await deleteContractLine(contractLineId);
      fetchContractLines();
    } catch (error) {
      console.error('Error deleting contract line:', error); // Keep console log for debugging
      if (error instanceof Error) {
        // Check for the specific error message for contract lines assigned to clients
        if (error.message === "Cannot delete contract line: It is currently assigned to one or more clients.") {
            toast.error(error.message);
        // Check for the specific error message for contract lines with associated services (from pre-check)
        } else if (error.message.includes('associated services')) {
          toast.error(error.message); // Use the exact message from the action
        } else {
          // Display other specific error messages directly
          toast.error(error.message);
        }
      } else {
        // Fallback for non-Error objects
        toast.error('An unexpected error occurred while deleting the contract line.');
      }
    }
  };

  const contractLineColumns: ColumnDefinition<IContractLine>[] = [
    {
      title: 'Contract Line Name',
      dataIndex: 'contract_line_name',
    },
    {
      title: 'Billing Frequency',
      dataIndex: 'billing_frequency',
      render: (value) => BILLING_FREQUENCY_DISPLAY[value] || value,
    },
    {
      title: 'Contract Line Type',
      dataIndex: 'contract_line_type',
      render: (value) => CONTRACT_LINE_TYPE_DISPLAY[value] || value,
    },
    {
      title: 'Is Custom',
      dataIndex: 'is_custom',
      render: (value) => value ? 'Yes' : 'No',
    },
    {
      title: 'Actions',
      dataIndex: 'contract_line_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="contract-line-actions-menu"
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
              id="edit-contract-line-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                if (record.contract_line_id) {
                  router.push(`/msp/billing?tab=contract-lines&contractLineId=${record.contract_line_id}`);
                }
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id="delete-contract-line-menu-item"
              className="text-red-600 focus:text-red-600"
              onClick={async (e) => {
                e.stopPropagation();
                if (record.contract_line_id) {
                  handleDeleteContractLine(record.contract_line_id);
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

  const handleContractLineClick = (contractLine: IContractLine) => {
    if (contractLine.contract_line_id) {
      router.push(`/msp/billing?tab=contract-lines&contractLineId=${contractLine.contract_line_id}`);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <Heading as="h3" size="4">Contract Lines</Heading>
          <ContractLineDialog
            onContractLineAdded={(newContractLineId) => {
              if (newContractLineId) {
                // Navigate directly. ContractLineTypeRouter will fetch the contract line details.
                router.push(`/msp/billing?tab=contract-lines&contractLineId=${newContractLineId}`);
              }
            }}
            editingContractLine={editingContractLine}
            onClose={() => setEditingContractLine(null)}
            triggerButton={
              <Button id='add-contract-line-button'>
                <Plus className="h-4 w-4 mr-2" />
                Add Contract Line
              </Button>
            }
            allServiceTypes={allServiceTypes} // Pass the fetched service types
          />
        </div>
        
        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <DataTable
          data={contractLines.filter(contractLine => contractLine.contract_line_id !== undefined)}
          columns={contractLineColumns}
          pagination={true}
          onRowClick={handleContractLineClick}
          rowClassName={() => "cursor-pointer"}
        />
      </Box>
    </Card>
  );
};

export default ContractLinesOverview;