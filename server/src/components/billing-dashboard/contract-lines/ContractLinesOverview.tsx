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
import { getContractLinePresets, deleteContractLinePreset } from 'server/src/lib/actions/contractLinePresetActions';
import { IContractLinePreset, IServiceType } from 'server/src/interfaces/billing.interfaces'; // Added IServiceType
import { getServiceTypesForSelection } from 'server/src/lib/actions/serviceActions'; // Added import for fetching types
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { PLAN_TYPE_DISPLAY, BILLING_FREQUENCY_DISPLAY, CONTRACT_LINE_TYPE_DISPLAY } from 'server/src/constants/billing';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';

const ContractLinesOverview: React.FC = () => {
  const [contractLines, setContractLines] = useState<IContractLinePreset[]>([]);
  const [editingPlan, setEditingPlan] = useState<IContractLinePreset | null>(null);
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
      const presets = await getContractLinePresets();
      setContractLines(presets);
      setError(null);
    } catch (error) {
      console.error('Error fetching contract line presets:', error);
      setError('Failed to fetch contract line presets');
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

  const handleDeletePlan = async (presetId: string) => {
    try {
      await deleteContractLinePreset(presetId);
      await fetchContractLines();
      toast.success('Contract line preset deleted successfully');
    } catch (error) {
      console.error('Error deleting contract line preset:', error);
      if (error instanceof Error) {
        toast.error(error.message);
      } else {
        toast.error('An unexpected error occurred while deleting the contract line preset.');
      }
    }
  };

  // Filter contract line presets based on search term and contract line type
  const filteredContractLines = useMemo(() => {
    return contractLines.filter(preset => {
      // Search filter
      const matchesSearch = preset.preset_name?.toLowerCase().includes(searchTerm.toLowerCase());

      // Type filter
      const matchesType = filterType === 'all' || preset.contract_line_type === filterType;

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

  const contractLineColumns: ColumnDefinition<IContractLinePreset>[] = [
    {
      title: 'Contract Line Name',
      dataIndex: 'preset_name',
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
      dataIndex: 'preset_id',
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
                if (record.preset_id) {
                  router.push(`/msp/billing?tab=contract-lines&presetId=${record.preset_id}`);
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
                if (record.preset_id) {
                  handleDeletePlan(record.preset_id);
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

  const handleContractLineClick = (preset: IContractLinePreset) => {
    if (preset.preset_id) {
      router.push(`/msp/billing?tab=contract-lines&presetId=${preset.preset_id}`);
    }
  };

  return (
    <Card size="2">
      <Box p="4">
        <div className="flex justify-between items-center mb-4">
          <Heading as="h3" size="4">Contract Line Presets</Heading>
          <ContractLineDialog
            onPlanAdded={(newPresetId) => {
              if (newPresetId) {
                // Refresh the contract lines list to show the new preset
                fetchContractLines();
              }
            }}
            editingPlan={editingPlan}
            onClose={() => setEditingPlan(null)}
            triggerButton={
              <Button id='add-contract-line-button'>
                <Plus className="h-4 w-4 mr-2" />
                Add Contract Line Preset
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
              placeholder="Search contract line presets"
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
            text="Loading contract line presets"
          />
        ) : (
          <DataTable
            data={filteredContractLines.filter(preset => preset.preset_id !== undefined)}
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
