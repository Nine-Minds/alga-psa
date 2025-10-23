'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Box, Card, Heading } from '@radix-ui/themes';
import { toast } from 'react-hot-toast'; // Import toast
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Plus, Search, XCircle } from 'lucide-react';
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
import { PLAN_TYPE_DISPLAY, BILLING_FREQUENCY_DISPLAY, CONTRACT_LINE_TYPE_DISPLAY } from 'server/src/constants/billing';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';

const ContractLinesOverview: React.FC = () => {
  const [contractLines, setContractLines] = useState<IContractLine[]>([]);
  const [editingPlan, setEditingPlan] = useState<IContractLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allServiceTypes, setAllServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage'; is_standard: boolean }[]>([]); // Added state for service types
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const router = useRouter();

  useEffect(() => {
    fetchContractLines();
    fetchAllServiceTypes(); // Fetch service types on mount
  }, []);

  const fetchContractLines = async () => {
    setIsLoading(true);
    try {
      const plans = await getContractLines();
      setContractLines(plans);
      setError(null);
    } catch (error) {
      console.error('Error fetching contract lines:', error);
      setError('Failed to fetch contract lines');
    } finally {
      setIsLoading(false);
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

  const handleDeletePlan = async (planId: string) => {
    try {
      await deleteContractLine(planId);
      await fetchContractLines();
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

  // Filter contract lines based on search term and contract line type
  const filteredContractLines = useMemo(() => {
    return contractLines.filter(line => {
      // Search filter
      const matchesSearch = line.contract_line_name?.toLowerCase().includes(searchTerm.toLowerCase());

      // Type filter
      const matchesType = filterType === 'all' || line.contract_line_type === filterType;

      return matchesSearch && matchesType;
    });
  }, [contractLines, searchTerm, filterType]);

  // Contract line type filter options
  const typeFilterOptions = [
    { value: 'all', label: 'All types' },
    ...Object.entries(CONTRACT_LINE_TYPE_DISPLAY).map(([value, label]) => ({
      value,
      label
    }))
  ];

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
      render: (value) => PLAN_TYPE_DISPLAY[value] || value,
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
                  handleDeletePlan(record.contract_line_id);
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

  const handleContractLineClick = (plan: IContractLine) => {
    if (plan.contract_line_id) {
      router.push(`/msp/billing?tab=contract-lines&contractLineId=${plan.contract_line_id}`);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <Heading as="h3" size="4">Contract Lines</Heading>
          <ContractLineDialog
            onPlanAdded={(newPlanId) => {
              if (newPlanId) {
                // Navigate directly. PlanTypeRouter will fetch the plan details.
                router.push(`/msp/billing?tab=contract-lines&contractLineId=${newPlanId}`);
              }
            }}
            editingPlan={editingPlan}
            onClose={() => setEditingPlan(null)}
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

        {/* Filter section */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {/* Search bar */}
          <div className="relative">
            <Input
              id="contract-line-search"
              type="text"
              placeholder="Search contract lines"
              className="pl-10 pr-4 py-2 w-64"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          </div>

          {/* Type filter */}
          <div className="relative z-10">
            <CustomSelect
              id="contract-line-type-filter"
              options={typeFilterOptions}
              value={filterType}
              onValueChange={(value) => setFilterType(value)}
              placeholder="Select type"
              customStyles={{
                content: 'mt-1'
              }}
            />
          </div>

          {/* Clear filters button */}
          {(searchTerm || filterType !== 'all') && (
            <Button
              id="clear-contract-line-filters-button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSearchTerm('');
                setFilterType('all');
              }}
              className="flex items-center gap-1 bg-white"
            >
              <XCircle className="h-4 w-4" />
              <span>Clear filters</span>
            </Button>
          )}
        </div>

        {isLoading ? (
          <LoadingIndicator
            layout="stacked"
            className="py-10 text-gray-600"
            spinnerProps={{ size: 'md' }}
            text="Loading contract lines"
          />
        ) : (
          <DataTable
            data={filteredContractLines.filter(plan => plan.contract_line_id !== undefined)}
            columns={contractLineColumns}
            pagination={true}
            onRowClick={handleContractLineClick}
            rowClassName={() => "cursor-pointer"}
          />
        )}
      </Box>
    </Card>
  );
};

export default ContractLinesOverview;
