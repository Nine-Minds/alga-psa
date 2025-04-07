'use client';

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { DataTable } from 'server/src/components/ui/DataTable';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from 'server/src/components/ui/Card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Input } from 'server/src/components/ui/Input';
import { TextArea } from 'server/src/components/ui/TextArea';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Label } from 'server/src/components/ui/Label';
import { MoreVertical, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import { IServiceType } from 'server/src/interfaces/billing.interfaces';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { 
    getServiceTypesForSelection, 
    createServiceType, 
    updateServiceType, 
    deleteServiceType 
} from 'server/src/lib/actions/serviceActions';

// Type for the data returned by getServiceTypesForSelection
type ServiceTypeSelectionItem = {
  id: string;
  name: string;
  billing_method: 'fixed' | 'per_unit';
  is_standard: boolean;
};

const ServiceTypeSettings: React.FC = () => {
  const [allTypes, setAllTypes] = useState<ServiceTypeSelectionItem[]>([]);
  const [tenantTypes, setTenantTypes] = useState<IServiceType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State for Add/Edit Dialog
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingType, setEditingType] = useState<Partial<IServiceType> | null>(null); // Partial for add/edit

  // State for Delete Dialog
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [typeToDelete, setTypeToDelete] = useState<IServiceType | null>(null);

  const fetchTypes = async () => {
    setLoading(true);
    setError(null);
    try {
      const fetchedTypes = await getServiceTypesForSelection();
      setAllTypes(fetchedTypes);
      
      // Filter for tenant-specific (custom) types
      const customTypes = fetchedTypes.filter(t => !t.is_standard).map(t => ({
        id: t.id,
        name: t.name,
        billing_method: t.billing_method,
        is_active: true, // Default to true if not provided
        created_at: new Date().toISOString(), // Placeholder
        updated_at: new Date().toISOString(), // Placeholder
        // Any other required IServiceType fields
      } as IServiceType));
      
      setTenantTypes(customTypes);
    } catch (fetchError) {
      console.error("Error fetching service types:", fetchError);
      setError(fetchError instanceof Error ? fetchError.message : "Failed to fetch service types");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTypes();
  }, []);

  // --- Dialog Handlers ---
  const handleOpenAddDialog = () => {
    setEditingType({}); // Empty object for add mode
    setIsEditDialogOpen(true);
  };

  const handleOpenEditDialog = (type: IServiceType) => {
    setEditingType({ ...type }); // Copy type data for editing
    setIsEditDialogOpen(true);
  };

  const handleCloseEditDialog = () => {
    setIsEditDialogOpen(false);
    setEditingType(null);
    setError(null); // Clear errors on close
  };

  const handleSaveType = async () => {
    if (!editingType) return;
    setError(null);
    
    // Validation
    if (!editingType.name) {
      setError("Service Type name cannot be empty.");
      return;
    }
    
    // Billing method is now mandatory for custom types
    if (!editingType.billing_method) {
      setError("Billing Method is required.");
      return;
    }

    try {
      if (editingType.id) { // Update existing
        // Prepare update data (exclude non-updatable fields)
        const { id, tenant, created_at, updated_at, ...updateData } = editingType;
        await updateServiceType(id, updateData);
      } else { // Create new
        // Prepare create data with required fields
        const createData = {
            name: editingType.name,
            billing_method: editingType.billing_method, // Now required
            description: editingType.description || null,
            is_active: editingType.is_active ?? true, // Default to active
        };
        await createServiceType(createData);
      }
      handleCloseEditDialog();
      await fetchTypes(); // Refresh list
    } catch (saveError) {
      console.error("Error saving service type:", saveError);
      setError(saveError instanceof Error ? saveError.message : "Failed to save service type");
    }
  };

  const handleOpenDeleteDialog = (type: IServiceType) => {
    setTypeToDelete(type);
    setIsDeleteDialogOpen(true);
  };

  const handleCloseDeleteDialog = () => {
    setIsDeleteDialogOpen(false);
    setTypeToDelete(null);
  };

  const handleConfirmDelete = async () => {
    // If there's already an error and the user clicks "Close", just close the dialog
    if (error && error.includes("in use")) {
      handleCloseDeleteDialog();
      return;
    }
    
    if (!typeToDelete) return;
    setError(null);
    try {
      await deleteServiceType(typeToDelete.id);
      handleCloseDeleteDialog();
      await fetchTypes(); // Refresh list
    } catch (deleteError) {
      console.error("Error deleting service type:", deleteError);
      
      // Get the specific error message
      const errorMessage = deleteError instanceof Error
        ? deleteError.message
        : "Failed to delete service type";
      
      // Set the error message to be displayed
      setError(errorMessage);
      
      // Keep the delete dialog open if it's a constraint violation
      // so the user can see which service type couldn't be deleted
      if (errorMessage.includes("in use")) {
        // Don't close the dialog so user can see which type has the error
      } else {
        handleCloseDeleteDialog();
      }
    }
  };

  // --- Column Definitions ---
  const tenantColumns: ColumnDefinition<IServiceType>[] = [
    { title: 'Name', dataIndex: 'name' },
    { 
      title: 'Billing Method', 
      dataIndex: 'billing_method', 
      render: (value) => value === 'fixed' ? 'Fixed' : 'Per Unit'
    },
    { title: 'Description', dataIndex: 'description', render: (value) => value || '-' },
    { 
      title: 'Active', 
      dataIndex: 'is_active', 
      render: (value, record) => (
        <Switch 
          checked={value} 
          disabled // Read-only for now, edit via dialog
        />
      ) 
    },
    {
      title: 'Actions',
      dataIndex: 'id',
      render: (id, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`servicetype-actions-${id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-servicetype-${id}`}
              onClick={(e) => {
                e.stopPropagation();
                handleOpenEditDialog(record);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-servicetype-${id}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDeleteDialog(record);
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (loading) {
    return <div>Loading service types...</div>;
  }

  return (
    <div className="space-y-6">
      {error && <div className="text-red-500 mb-4 p-4 border border-red-500 rounded">{error}</div>}

      {/* Main card - only for custom types now */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>Custom Service Types</CardTitle>
              <CardDescription>Manage your organization's custom service types.</CardDescription>
            </div>
            <Button id="add-custom-service-type-button" onClick={handleOpenAddDialog}>
              <Plus className="mr-2 h-4 w-4" /> Add Custom Type
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={tenantColumns}
            data={tenantTypes}
            pagination={true}
            onRowClick={handleOpenEditDialog}
            id="service-types-table"
          />
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog isOpen={isEditDialogOpen} onClose={handleCloseEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingType?.id ? 'Edit' : 'Add'} Custom Service Type</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {error && <div className="text-red-500 mb-4">{error}</div>}
            <div>
              <label htmlFor="typeName" className="block text-sm font-medium text-gray-700">Name</label>
              <Input
                id="typeName"
                value={editingType?.name || ''}
                onChange={(e) => setEditingType({ ...editingType, name: e.target.value })}
                placeholder="e.g., Custom Support Tier"
                required
              />
            </div>
            <div>
              <label htmlFor="typeDescription" className="block text-sm font-medium text-gray-700">Description (Optional)</label>
              <TextArea
                id="typeDescription"
                value={editingType?.description || ''}
                onChange={(e) => setEditingType({ ...editingType, description: e.target.value })}
                placeholder="Describe this service type"
              />
            </div>
            <div>
              <Label htmlFor="billing-method-select">Billing Method</Label>
              <CustomSelect
                id="billing-method-select"
                options={[
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'per_unit', label: 'Per Unit' },
                ]}
                value={editingType?.billing_method || ''}
                onValueChange={(value: string) => {
                  if (value === 'fixed' || value === 'per_unit') {
                    setEditingType({ ...editingType, billing_method: value as 'fixed' | 'per_unit' });
                  }
                }}
                placeholder="Select billing method"
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button id="cancel-edit-type-button" variant="outline" onClick={handleCloseEditDialog}>Cancel</Button>
            <Button id="save-type-button" onClick={handleSaveType}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={handleCloseDeleteDialog}
        onConfirm={handleConfirmDelete}
        title="Delete Service Type"
        message={
          error && error.includes("in use")
            ? `Error: ${error}`
            : `Are you sure you want to delete the service type "${typeToDelete?.name}"? This cannot be undone.`
        }
        confirmLabel={error && error.includes("in use") ? "Close" : "Delete"}
        cancelLabel="Cancel"
      />
    </div>
  );
};

export default ServiceTypeSettings;