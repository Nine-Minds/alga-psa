'use client';

import React, { useState, useEffect, Fragment } from 'react'; // Added Fragment
import { Card, Box } from '@radix-ui/themes';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, Calendar, Info } from 'lucide-react'; // Added Info icon
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from 'server/src/components/ui/DropdownMenu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger, // Keep Trigger
  DialogFooter,
} from "server/src/components/ui/Dialog"; // Removed DialogClose
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { IContract } from 'server/src/interfaces/contract.interfaces';
import { IClientContract } from 'server/src/interfaces/contract.interfaces';
import { getContracts } from 'server/src/lib/actions/contractActions';
import {
  getClientContracts,
  getDetailedClientContract,
  assignContractToClient,
  updateClientContract,
  deactivateClientContract,
  applyContractToClient
} from 'server/src/lib/actions/client-actions/clientContractActions';
import { getClientById } from 'server/src/lib/actions/client-actions/clientActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { Badge } from 'server/src/components/ui/Badge';
import { ClientContractDialog } from './ClientContractDialog';

interface ClientContractAssignmentProps {
  clientId: string;
}

interface DetailedClientContract extends IClientContract {
  contract_name: string;
  description?: string;
  contract_line_count: number;
  contract_line_names?: string[];
}

const ClientContractAssignment: React.FC<ClientContractAssignmentProps> = ({ clientId }) => {
  const [clientContracts, setClientContracts] = useState<DetailedClientContract[]>([]);
  const [availableContracts, setAvailableContracts] = useState<IContract[]>([]);
  const [selectedContractToAdd, setSelectedContractToAdd] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [editingContract, setEditingContract] = useState<DetailedClientContract | null>(null); // Keep state for editing dialog
  // Remove state for separate details dialog

  useEffect(() => {
    if (clientId) {
      fetchData();
    }
  }, [clientId]);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Fetch client name
      const client = await getClientById(clientId);
      setClientName(client?.client_name || '');

      // Get all contracts and client contracts
      const [contracts, clientContractsData] = await Promise.all([
        getContracts(),
        getClientContracts(clientId)
      ]);

      // Get detailed information for each client contract
      const detailedContracts: DetailedClientContract[] = [];
      for (const contract of clientContractsData) {
        if (contract.client_contract_id) {
          const detailedContract = await getDetailedClientContract(contract.client_contract_id);
          if (detailedContract) {
            detailedContracts.push({
              ...contract,
              contract_name: detailedContract.contract_name,
              description: detailedContract.description,
              contract_line_count: detailedContract.contract_line_count || 0,
              contract_line_names: detailedContract.contract_line_names || []
            });
          }
        }
      }

      setClientContracts(detailedContracts);
      setAvailableContracts(contracts.filter(c => c.is_active));

      // Set default selected contract if available
      const filteredContracts = contracts.filter(
        c => c.is_active && !detailedContracts.some(dc => dc.contract_id === c.contract_id)
      );

      if (filteredContracts.length > 0) {
        setSelectedContractToAdd(filteredContracts[0].contract_id || null);
      } else {
        setSelectedContractToAdd(null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load contracts data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddContract = async (startDate: string, endDate: string | null) => {
    if (!clientId || !selectedContractToAdd) return;
    
    try {
      await assignContractToClient(
        clientId,
        selectedContractToAdd,
        startDate,
        endDate
      );
      
      // Apply the contract to create client contract lines
      const newContracts = await getClientContracts(clientId);
      const newContract = newContracts.find(c => c.contract_id === selectedContractToAdd);

      if (newContract && newContract.client_contract_id) {
        await applyContractToClient(newContract.client_contract_id);
      }
      
      fetchData(); // Refresh data
    } catch (error: any) {
      console.error('Error adding contract to client:', error);
      // Try to extract backend error message
      let errorMsg = 'Failed to add contract to client';
      if (error?.message) {
        errorMsg = error.message;
      } else if (typeof error === 'string') {
        errorMsg = error;
      } else if (error?.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      // Replace clientId with clientName in error message if present
      if (clientName && errorMsg.includes(clientId)) {
        errorMsg = errorMsg.replaceAll(clientId, clientName);
      }
      setError(errorMsg);
    }
  };

  const handleDeactivateContract = async (clientContractId: string) => {
    try {
      await deactivateClientContract(clientContractId);
      fetchData(); // Refresh data
    } catch (error: any) {
      console.error('Error deactivating client contract:', error);
      let errorMsg = 'Failed to deactivate contract';
      if (error?.message) {
        errorMsg = error.message;
      } else if (typeof error === 'string') {
        errorMsg = error;
      } else if (error?.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      if (clientName && errorMsg.includes(clientId)) {
        errorMsg = errorMsg.replaceAll(clientId, clientName);
      }
      setError(errorMsg);
    }
  };

  const handleEditContract = (contract: DetailedClientContract) => {
    setEditingContract(contract);
  };

  const handleContractUpdated = async (clientContractId: string, startDate: string, endDate: string | null) => {
    try {
      await updateClientContract(clientContractId, { 
        start_date: startDate,
        end_date: endDate
      });
      fetchData(); // Refresh data
      setEditingContract(null);
    } catch (error: any) {
      console.error('Error updating client contract:', error);
      let errorMsg = 'Failed to update contract';
      if (error?.message) {
        errorMsg = error.message;
      } else if (typeof error === 'string') {
        errorMsg = error;
      } else if (error?.response?.data?.message) {
        errorMsg = error.response.data.message;
      }
      if (clientName && errorMsg.includes(clientId)) {
        errorMsg = errorMsg.replaceAll(clientId, clientName);
      }
      setError(errorMsg);
    }
  };

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return 'Ongoing';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const contractColumns: ColumnDefinition<DetailedClientContract>[] = [
    {
      title: 'Contract Name',
      dataIndex: 'contract_name',
      // Revert to just displaying the value, no button/dialog trigger needed here
      render: (value) => value,
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value) => value || 'No description',
    },
    {
      title: 'Start Date',
      dataIndex: 'start_date',
      render: (value) => formatDate(value),
    },
    {
      title: 'End Date',
      dataIndex: 'end_date',
      render: (value) => formatDate(value),
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (value) => (
        <Badge className={value ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}>
          {value ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      title: 'Contract Lines',
      dataIndex: 'contract_line_names',
      render: (contractLineNames: string[] | undefined) => {
        if (!contractLineNames || contractLineNames.length === 0) {
          return '0';
        }
        return contractLineNames.join(', ');
      },
    },
    {
      title: 'Actions',
      dataIndex: 'client_contract_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="client-contract-actions-menu"
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
              id="edit-client-contract-menu-item"
              onClick={() => handleEditContract(record)}
            >
              <Calendar className="h-4 w-4 mr-2" />
              Edit {/* Changed text */}
            </DropdownMenuItem>
            {record.is_active && (
              <DropdownMenuItem
                id="deactivate-client-contract-menu-item"
                className="text-red-600 focus:text-red-600"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent event bubbling to row click
                  handleDeactivateContract(value);
                }}
              >
                Unassign {/* Updated text only */}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  // Filter available contracts to only show those not already assigned to the client
  const filteredAvailableContracts = availableContracts.filter(
    contract => !clientContracts.some(cc => cc.contract_id === contract.contract_id && cc.is_active)
  );

  return (
    <Card size="2">
      <Box p="4">
        <h3 className="text-lg font-medium mb-4">Contracts</h3>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="text-center py-4">Loading contracts...</div>
        ) : (
          <>
            <div className="mb-4">
              {clientContracts.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  No contracts have been assigned to this client yet.
                </div>
              ) : (
                <DataTable
                  id="client-contract-assignment-table"
                  data={clientContracts}
                  columns={contractColumns}
                  pagination={false}
                  onRowClick={handleEditContract} // Keep row click handler
                  rowClassName={() => 'cursor-pointer'} // Use function for type compatibility
                />
              )}
            </div>
            
            <div className="flex space-x-2 mt-4">
              <CustomSelect
                options={filteredAvailableContracts.map(c => ({
                  value: c.contract_id!,
                  label: c.contract_name
                }))}
                onValueChange={setSelectedContractToAdd}
                value={selectedContractToAdd || ''}
                placeholder="Select contract..."
                className="flex-grow"
              />
              <ClientContractDialog
                onContractAssigned={handleAddContract}
                triggerButton={
                  <Button
                    id="assign-contract-button"
                    disabled={!selectedContractToAdd || filteredAvailableContracts.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Assign Contract
                  </Button>
                }
              />
            </div>
          </>
        )}
      </Box>
      
      {editingContract && (
        <ClientContractDialog
          isOpen={true}
          onClose={() => setEditingContract(null)}
          onContractAssigned={(startDate: string, endDate: string | null) =>
            handleContractUpdated(editingContract.client_contract_id, startDate, endDate)
          }
          initialStartDate={editingContract.start_date}
          initialEndDate={editingContract.end_date}
          contractLineNames={editingContract.contract_line_names}
        />
      )}

      {/* Removed the separate details dialog */}
    </Card>
  );
};

export default ClientContractAssignment;