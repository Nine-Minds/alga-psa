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
import { ICompanyPlanBundle } from 'server/src/interfaces/planBundle.interfaces';
import { getPlanBundles } from 'server/src/lib/actions/planBundleActions';
import { 
  getCompanyBundles,
  getDetailedCompanyBundle,
  assignBundleToCompany,
  updateCompanyBundle,
  deactivateCompanyBundle,
  applyBundleToCompany
} from 'server/src/lib/actions/companyPlanBundleActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { AlertCircle } from 'lucide-react';
import { Badge } from 'server/src/components/ui/Badge';
import { CompanyBundleDialog } from './CompanyBundleDialog';

interface CompanyBundleAssignmentProps {
  companyId: string;
}

interface DetailedCompanyBundle extends ICompanyPlanBundle {
  bundle_name: string;
  description?: string;
  plan_count: number; // Keep for potential other uses or backward compatibility
  plan_names?: string[]; // Added field for plan names
}

const CompanyBundleAssignment: React.FC<CompanyBundleAssignmentProps> = ({ companyId }) => {
  const [companyBundles, setCompanyBundles] = useState<DetailedCompanyBundle[]>([]);
  const [availableBundles, setAvailableBundles] = useState<IPlanBundle[]>([]);
  const [selectedBundleToAdd, setSelectedBundleToAdd] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingBundle, setEditingBundle] = useState<DetailedCompanyBundle | null>(null); // Keep state for editing dialog
  // Remove state for separate details dialog

  useEffect(() => {
    if (companyId) {
      fetchData();
    }
  }, [companyId]);

  const fetchData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Get all bundles and company bundles
      const [bundles, companyBundlesData] = await Promise.all([
        getPlanBundles(),
        getCompanyBundles(companyId)
      ]);
      
      // Get detailed information for each company bundle
      const detailedBundles: DetailedCompanyBundle[] = [];
      for (const bundle of companyBundlesData) {
        if (bundle.company_bundle_id) {
          const detailedBundle = await getDetailedCompanyBundle(bundle.company_bundle_id);
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
      
      setCompanyBundles(detailedBundles);
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
    if (!companyId || !selectedBundleToAdd) return;
    
    try {
      await assignBundleToCompany(
        companyId,
        selectedBundleToAdd,
        startDate,
        endDate
      );
      
      // Apply the bundle to create company billing plans
      const newBundles = await getCompanyBundles(companyId);
      const newBundle = newBundles.find(b => b.bundle_id === selectedBundleToAdd);
      
      if (newBundle && newBundle.company_bundle_id) {
        await applyBundleToCompany(newBundle.company_bundle_id);
      }
      
      fetchData(); // Refresh data
    } catch (error) {
      console.error('Error adding bundle to company:', error);
      setError('Failed to add bundle to company');
    }
  };

  const handleDeactivateBundle = async (companyBundleId: string) => {
    try {
      await deactivateCompanyBundle(companyBundleId);
      fetchData(); // Refresh data
    } catch (error) {
      console.error('Error deactivating company bundle:', error);
      setError('Failed to deactivate bundle');
    }
  };

  const handleEditBundle = (bundle: DetailedCompanyBundle) => {
    setEditingBundle(bundle);
  };

  const handleBundleUpdated = async (companyBundleId: string, startDate: string, endDate: string | null) => {
    try {
      await updateCompanyBundle(companyBundleId, { 
        start_date: startDate,
        end_date: endDate
      });
      fetchData(); // Refresh data
      setEditingBundle(null);
    } catch (error) {
      console.error('Error updating company bundle:', error);
      setError('Failed to update bundle');
    }
  };

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return 'Ongoing';
    const date = new Date(dateString);
    return date.toLocaleDateString();
  };

  const bundleColumns: ColumnDefinition<DetailedCompanyBundle>[] = [
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
      dataIndex: 'company_bundle_id',
      render: (value, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="company-bundle-actions-menu"
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
              id="edit-company-bundle-menu-item"
              onClick={() => handleEditBundle(record)}
            >
              <Calendar className="h-4 w-4 mr-2" />
              Edit {/* Changed text */}
            </DropdownMenuItem>
            {record.is_active && (
              <DropdownMenuItem
                id="deactivate-company-bundle-menu-item"
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

  // Filter available bundles to only show those not already assigned to the company
  const filteredAvailableBundles = availableBundles.filter(
    bundle => !companyBundles.some(cb => cb.bundle_id === bundle.bundle_id && cb.is_active)
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
              {companyBundles.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  No bundles have been assigned to this company yet.
                </div>
              ) : (
                <DataTable
                  data={companyBundles}
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
              <CompanyBundleDialog
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
        <CompanyBundleDialog
          isOpen={true}
          onClose={() => setEditingBundle(null)}
          onBundleAssigned={(startDate: string, endDate: string | null) =>
            handleBundleUpdated(editingBundle.company_bundle_id, startDate, endDate)
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

export default CompanyBundleAssignment;