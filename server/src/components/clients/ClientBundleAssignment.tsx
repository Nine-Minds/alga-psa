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
import { IPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { IClientPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundles } from 'server/src/lib/actions/planBundleActions';
import { 
  getClientBundles,
  getDetailedClientBundle,
  assignBundleToClient,
  updateClientBundle,
  deactivateClientBundle,
  applyBundleToClient
} from 'server/src/lib/actions/client-actions/clientPlanBundleActions';
import { getClientById } from 'server/src/lib/actions/client-actions/clientActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { Badge } from 'server/src/components/ui/Badge';
import { ClientBundleDialog } from './ClientBundleDialog';

interface ClientBundleAssignmentProps {
  clientId: string;
}

interface DetailedClientBundle extends IClientPlanBundle {
  bundle_name: string;
  description?: string;
  plan_count: number; // Keep for potential other uses or backward compatibility
  plan_names?: string[]; // Added field for plan names
}

const ClientBundleAssignment: React.FC<ClientBundleAssignmentProps> = ({ clientId }) => {
  const [clientBundles, setClientBundles] = useState<DetailedClientBundle[]>([]);
  const [availableBundles, setAvailableBundles] = useState<IPlanBundle[]>([]);
  const [selectedBundleToAdd, setSelectedBundleToAdd] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [editingBundle, setEditingBundle] = useState<DetailedClientBundle | null>(null); // Keep state for editing dialog
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

      // Get all bundles and client bundles
      const [bundles, clientBundlesData] = await Promise.all([
        getPlanBundles(),
        getClientBundles(clientId)
      ]);
      
      // Get detailed information for each client bundle
      const detailedBundles: DetailedClientBundle[] = [];
      for (const bundle of clientBundlesData) {
        if (bundle.client_bundle_id) {
          const detailedBundle = await getDetailedClientBundle(bundle.client_bundle_id);
          if (detailedBundle) {
            detailedBundles.push({
              ...bundle,
              bundle_name: detailedBundle.bundle_name,
              description: detailedBundle.description,
              plan_count: detailedBundle.plan_count || 0, // Use the count from the backend
              plan_names: detailedBundle.plan_names || [] // Use the names from the backend
            });
          }
        }
      }
      
      setClientBundles(detailedBundles);
      setAvailableBundles(bundles.filter(b => b.is_active));
      
      // Set default selected bundle if available
      const filteredBundles = bundles.filter(
        b => b.is_active && !detailedBundles.some(db => db.bundle_id === b.bundle_id)
      );
      
      if (filteredBundles.length > 0) {
        setSelectedBundleToAdd(filteredBundles[0].bundle_id || null);
      } else {
        setSelectedBundleToAdd(null);
      }
    } catch (error) {
      console.error('Error fetching data:', error);
      setError('Failed to load bundles data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddBundle = async (startDate: string, endDate: string | null) => {
    if (!clientId || !selectedBundleToAdd) return;
    
    try {
      await assignBundleToClient(
        clientId,
        selectedBundleToAdd,
        startDate,
        endDate
      );
      
      // Apply the bundle to create client billing plans
      const newBundles = await getClientBundles(clientId);
      const newBundle = newBundles.find(b => b.bundle_id === selectedBundleToAdd);
      
      if (newBundle && newBundle.client_bundle_id) {
        await applyBundleToClient(newBundle.client_bundle_id);
      }
      
      fetchData(); // Refresh data
    } catch (error: any) {
      console.error('Error adding bundle to client:', error);
      // Try to extract backend error message
      let errorMsg = 'Failed to add bundle to client';
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

  const handleDeactivateBundle = async (clientBundleId: string) => {
    try {
      await deactivateClientBundle(clientBundleId);
      fetchData(); // Refresh data
    } catch (error: any) {
      console.error('Error deactivating client bundle:', error);
      let errorMsg = 'Failed to deactivate bundle';
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

  const handleEditBundle = (bundle: DetailedClientBundle) => {
    setEditingBundle(bundle);
  };

  const handleBundleUpdated = async (clientBundleId: string, startDate: string, endDate: string | null) => {
    try {
      await updateClientBundle(clientBundleId, { 
        start_date: startDate,
        end_date: endDate
      });
      fetchData(); // Refresh data
      setEditingBundle(null);
    } catch (error: any) {
      console.error('Error updating client bundle:', error);
      let errorMsg = 'Failed to update bundle';
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

  const bundleColumns: ColumnDefinition<DetailedClientBundle>[] = [
    {
      title: 'Bundle Name',
      dataIndex: 'bundle_name',
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
      title: 'Plans',
      dataIndex: 'plan_names', // Change dataIndex to plan_names
      render: (planNames: string[] | undefined) => {
        if (!planNames || planNames.length === 0) {
          return '0'; // Or 'No plans'
        }
        // Simple comma-separated list for now. Consider a tooltip/popover for better UX if many plans.
        return planNames.join(', ');
      },
    },
    {
      title: 'Actions',
      dataIndex: 'client_bundle_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="client-bundle-actions-menu"
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
              id="edit-client-bundle-menu-item"
              onClick={() => handleEditBundle(record)}
            >
              <Calendar className="h-4 w-4 mr-2" />
              Edit {/* Changed text */}
            </DropdownMenuItem>
            {record.is_active && (
              <DropdownMenuItem
                id="deactivate-client-bundle-menu-item"
                className="text-red-600 focus:text-red-600"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent event bubbling to row click
                  handleDeactivateBundle(value);
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

  // Filter available bundles to only show those not already assigned to the client
  const filteredAvailableBundles = availableBundles.filter(
    bundle => !clientBundles.some(cb => cb.bundle_id === bundle.bundle_id && cb.is_active)
  );

  return (
    <Card size="2">
      <Box p="4">
        <h3 className="text-lg font-medium mb-4">Plan Bundles</h3>
        
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        
        {isLoading ? (
          <div className="text-center py-4">Loading bundles...</div>
        ) : (
          <>
            <div className="mb-4">
              {clientBundles.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  No bundles have been assigned to this client yet.
                </div>
              ) : (
                <DataTable
                  data={clientBundles}
                  columns={bundleColumns}
                  pagination={false}
                  onRowClick={handleEditBundle} // Keep row click handler
                  rowClassName={() => 'cursor-pointer'} // Use function for type compatibility
                />
              )}
            </div>
            
            <div className="flex space-x-2 mt-4">
              <CustomSelect
                options={filteredAvailableBundles.map(b => ({
                  value: b.bundle_id!,
                  label: b.bundle_name
                }))}
                onValueChange={setSelectedBundleToAdd}
                value={selectedBundleToAdd || ''}
                placeholder="Select bundle..."
                className="flex-grow"
              />
              <ClientBundleDialog
                onBundleAssigned={handleAddBundle}
                triggerButton={
                  <Button
                    id="assign-bundle-button"
                    disabled={!selectedBundleToAdd || filteredAvailableBundles.length === 0}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Assign Bundle
                  </Button>
                }
              />
            </div>
          </>
        )}
      </Box>
      
      {editingBundle && (
        <ClientBundleDialog
          isOpen={true}
          onClose={() => setEditingBundle(null)}
          onBundleAssigned={(startDate: string, endDate: string | null) =>
            handleBundleUpdated(editingBundle.client_bundle_id, startDate, endDate)
          }
          initialStartDate={editingBundle.start_date}
          initialEndDate={editingBundle.end_date}
          planNames={editingBundle.plan_names} // Pass plan names now that dialog is updated
        />
      )}

      {/* Removed the separate details dialog */}
    </Card>
  );
};

export default ClientBundleAssignment;