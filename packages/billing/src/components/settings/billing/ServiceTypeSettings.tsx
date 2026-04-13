'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Label } from '@alga-psa/ui/components/Label';
import { MoreVertical, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { IServiceType, IStandardServiceType } from '@alga-psa/types';
import { ColumnDefinition } from '@alga-psa/types';
import { 
    getServiceTypesForSelection, 
    getAllServiceTypes,
    createServiceType, 
    updateServiceType, 
    deleteServiceType 
} from '@alga-psa/billing/actions';
import { getAvailableReferenceData, importReferenceData, checkImportConflicts, ImportConflict } from '@alga-psa/reference-data/actions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

// Type for the data returned by getServiceTypesForSelection
type ServiceTypeSelectionItem = {
  id: string;
  name: string;
  billing_method: 'fixed' | 'hourly' | 'usage';
  is_standard: boolean;
};

const ServiceTypeSettings: React.FC = () => {
  const { t } = useTranslation('msp/billing-settings');
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
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // State for Import Dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferenceTypes, setAvailableReferenceTypes] = useState<IStandardServiceType[]>([]);
  const [selectedImportTypes, setSelectedImportTypes] = useState<string[]>([]);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});

  const fetchTypes = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch the service types for selection (includes standard types)
      const fetchedTypes = await getServiceTypesForSelection();
      setAllTypes(fetchedTypes);
      
      // Fetch all tenant service types with full data including order_number
      const tenantServiceTypes = await getAllServiceTypes();
      
      // Sort by order_number
      tenantServiceTypes.sort((a, b) => a.order_number - b.order_number);
      
      setTenantTypes(tenantServiceTypes);
    } catch (fetchError) {
      console.error("Error fetching service types:", fetchError);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : t('serviceTypes.errors.fetch', { defaultValue: 'Failed to fetch service types' })
      );
    } finally {
      setLoading(false);
    }
  };

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    fetchTypes();
  }, []);

  // --- Dialog Handlers ---
  const handleOpenAddDialog = () => {
    // Calculate next order number
    const maxOrder = tenantTypes.reduce((max, t) => Math.max(max, t.order_number || 0), 0);
    const nextOrder = maxOrder + 1;
    
    setEditingType({ order_number: nextOrder }); // Empty object for add mode with suggested order
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
    setIsEditDialogOpen(true);
  };

  const handleOpenEditDialog = (type: IServiceType) => {
    setEditingType({ ...type }); // Copy type data for editing
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
    setIsEditDialogOpen(true);
  };

  const handleCloseEditDialog = () => {
    setIsEditDialogOpen(false);
    setEditingType(null);
    setError(null); // Clear errors on close
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
  };

  const clearErrorIfSubmitted = () => {
    if (hasAttemptedSubmit) {
      setValidationErrors([]);
    }
  };

  const handleSaveType = async () => {
    if (!editingType) return;
    setHasAttemptedSubmit(true);
    
    // Validation
    const errors: string[] = [];
    if (!editingType.name?.trim()) {
      errors.push(t('serviceTypes.validation.name', { defaultValue: 'Service Type name' }));
    }
    
    // Billing method is now mandatory for custom types
    if (!editingType.billing_method) {
      errors.push(t('serviceTypes.validation.billingMethod', { defaultValue: 'Billing method' }));
    }
    
    if (!editingType.order_number && editingType.order_number !== 0) {
      errors.push(t('serviceTypes.validation.displayOrder', { defaultValue: 'Display order' }));
    }
    
    // Check for duplicate order number
    const existingWithOrder = tenantTypes.find(t => 
      t.order_number === editingType.order_number && 
      t.id !== editingType.id
    );
    
    if (existingWithOrder) {
      errors.push(t('serviceTypes.validation.orderInUse', {
        defaultValue: 'Order {{order}} is already used by "{{name}}"',
        order: editingType.order_number,
        name: existingWithOrder.name
      }));
    }
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }
    
    setValidationErrors([]);

    try {
      if (editingType.id) { // Update existing
        // Prepare update data (exclude non-updatable fields)
        const { id, tenant, created_at, updated_at, ...updateData } = editingType;
        await updateServiceType(id, updateData);
      } else { // Create new
        // Prepare create data with required fields
        // We've already validated these fields exist above
        const createData = {
            name: editingType.name!,
            billing_method: editingType.billing_method!, // Now required
            description: editingType.description || null,
            is_active: editingType.is_active ?? true, // Default to active
            order_number: editingType.order_number!,
        };
        await createServiceType(createData);
      }
      handleCloseEditDialog();
      await fetchTypes(); // Refresh list
    } catch (saveError) {
      console.error("Error saving service type:", saveError);
      const errorMessage = saveError instanceof Error
        ? saveError.message
        : t('serviceTypes.errors.save', { defaultValue: 'Failed to save service type' });
      setValidationErrors([errorMessage]);
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
        : t('serviceTypes.errors.delete', { defaultValue: 'Failed to delete service type' });
      
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

  // Import functionality
  const handleCheckConflicts = async () => {
    if (selectedImportTypes.length === 0) return;

    try {
      const conflicts = await checkImportConflicts('service_types', selectedImportTypes);
      setImportConflicts(conflicts);
      
      if (conflicts.length === 0) {
        // No conflicts, proceed with import
        await handleImport();
      }
    } catch (error) {
      handleError(error, t('serviceTypes.errors.checkConflicts', {
        defaultValue: 'Failed to check conflicts'
      }));
    }
  };

  const handleImport = async () => {
    try {
      const result = await importReferenceData('service_types', selectedImportTypes, undefined, conflictResolutions);
      
      if (result.imported.length > 0) {
        toast.success(t('serviceTypes.toast.importedCount', {
          count: result.imported.length,
          defaultValue: 'Imported {{count}} service type'
        }));
      }
      
      if (result.skipped.length > 0) {
        const skippedMessage = (result.skipped as any[]).map((s: any) => t('serviceTypes.toast.skippedItem', {
          defaultValue: '{{name}}: {{reason}}',
          name: s.name,
          reason: s.reason
        })).join(', ');
        toast(skippedMessage, { icon: 'ℹ️' });
      }
      
      setShowImportDialog(false);
      setSelectedImportTypes([]);
      setImportConflicts([]);
      setConflictResolutions({});
      await fetchTypes();
    } catch (error) {
      handleError(error, t('serviceTypes.errors.import', {
        defaultValue: 'Failed to import service types'
      }));
    }
  };

  // --- Column Definitions ---
  const tenantColumns: ColumnDefinition<IServiceType>[] = [
    { 
      title: t('common.columns.name', { defaultValue: 'Name' }),
      dataIndex: 'name',
      width: '35%'
    },
    { 
      title: t('common.columns.billingMethod', { defaultValue: 'Billing Method' }), 
      dataIndex: 'billing_method',
      width: '20%', 
      render: (value) => {
        if (value === 'fixed') return t('common.billingMethod.fixed', { defaultValue: 'Fixed' });
        if (value === 'hourly') return t('common.billingMethod.hourly', { defaultValue: 'Hourly' });
        return t('common.billingMethod.usage', { defaultValue: 'Usage' });
      }
    },
    { 
      title: t('common.columns.description', { defaultValue: 'Description' }),
      dataIndex: 'description',
      width: '20%',
      render: (value) => value || t('common.emptyValue', { defaultValue: '-' }) 
    },
    { 
      title: t('common.columns.order', { defaultValue: 'Order' }),
      dataIndex: 'order_number',
      width: '10%' 
    },
    {
      title: t('common.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'id',
      width: '5%',
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
              {t('common.actions.edit', { defaultValue: 'Edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-servicetype-${id}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                handleOpenDeleteDialog(record);
              }}
            >
              {t('common.actions.delete', { defaultValue: 'Delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  if (loading) {
    return <div>{t('serviceTypes.loading', { defaultValue: 'Loading service types...' })}</div>;
  }

  return (
    <div className="space-y-6">
      {/* Main card - only for custom types now */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>{t('serviceTypes.title', { defaultValue: 'Custom Service Types' })}</CardTitle>
              <CardDescription>
                {t('serviceTypes.description', {
                  defaultValue: "Manage your organization's custom service types."
                })}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button 
                id="import-service-types-button" 
                variant="outline"
                onClick={async () => {
                  const available = await getAvailableReferenceData('service_types');
                  setAvailableReferenceTypes(available);
                  setSelectedImportTypes([]);
                  setShowImportDialog(true);
                }}
              >
                {t('serviceTypes.actions.importFromStandard', {
                  defaultValue: 'Import from Standard Service Types'
                })}
              </Button>
              <Button id="add-custom-service-type-button" onClick={handleOpenAddDialog}>
                <Plus className="mr-2 h-4 w-4" />
                {t('serviceTypes.actions.add', { defaultValue: 'Add Custom Type' })}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={tenantColumns}
            data={tenantTypes}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
            onRowClick={handleOpenEditDialog}
            id="service-types-table"
          />
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog
        isOpen={isEditDialogOpen}
        onClose={handleCloseEditDialog}
        title={editingType?.id
          ? t('serviceTypes.dialog.editTitle', { defaultValue: 'Edit Custom Service Type' })
          : t('serviceTypes.dialog.addTitle', { defaultValue: 'Add Custom Service Type' })}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button id="cancel-edit-type-button" variant="outline" onClick={handleCloseEditDialog}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="save-type-button"
              type="button"
              onClick={() => (document.getElementById('service-type-edit-form') as HTMLFormElement | null)?.requestSubmit()}
              className={!editingType?.name?.trim() || !editingType?.billing_method || (!editingType?.order_number && editingType?.order_number !== 0) ? 'opacity-50' : ''}
            >
              {t('serviceTypes.actions.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <form id="service-type-edit-form" onSubmit={(e) => { e.preventDefault(); handleSaveType(); }} noValidate>
          <div className="space-y-4 py-4">
            {hasAttemptedSubmit && validationErrors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <p className="font-medium mb-2">
                    {t('serviceTypes.validation.summary', { defaultValue: 'Please fill in the required fields:' })}
                  </p>
                  <ul className="list-disc list-inside space-y-1">
                    {validationErrors.map((err, index) => (
                      <li key={index}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div>
              <label htmlFor="typeName" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('serviceTypes.fields.name.label', { defaultValue: 'Name *' })}
              </label>
              <Input
                id="typeName"
                value={editingType?.name || ''}
                onChange={(e) => {
                  setEditingType({ ...editingType, name: e.target.value });
                  clearErrorIfSubmitted();
                }}
                placeholder={t('serviceTypes.fields.name.placeholder', {
                  defaultValue: 'e.g., Custom Support Tier *'
                })}
                required
                className={hasAttemptedSubmit && !editingType?.name?.trim() ? 'border-red-500' : ''}
              />
            </div>
            <div>
              <label htmlFor="typeDescription" className="block text-sm font-medium text-[rgb(var(--color-text-700))]">
                {t('serviceTypes.fields.description.label', { defaultValue: 'Description (Optional)' })}
              </label>
              <TextArea
                id="typeDescription"
                value={editingType?.description || ''}
                onChange={(e) => setEditingType({ ...editingType, description: e.target.value })}
                placeholder={t('serviceTypes.fields.description.placeholder', {
                  defaultValue: 'Describe this service type'
                })}
              />
            </div>
            <div>
              <Label htmlFor="billing-method-select">
                {t('serviceTypes.fields.billingMethod.label', { defaultValue: 'Billing Method *' })}
              </Label>
              <CustomSelect
                id="billing-method-select"
                options={[
                  { value: 'fixed', label: t('common.billingMethod.fixed', { defaultValue: 'Fixed' }) },
                  { value: 'hourly', label: t('common.billingMethod.hourly', { defaultValue: 'Hourly' }) },
                  { value: 'usage', label: t('common.billingMethod.usageBased', { defaultValue: 'Usage Based' }) },
                ]}
                value={editingType?.billing_method || ''}
                onValueChange={(value: string) => {
                  if (value === 'fixed' || value === 'hourly' || value === 'usage') {
                    setEditingType({ ...editingType, billing_method: value as 'fixed' | 'hourly' | 'usage' });
                    clearErrorIfSubmitted();
                  }
                }}
                placeholder={t('serviceTypes.fields.billingMethod.placeholder', {
                  defaultValue: 'Select billing method...'
                })}
                required
                className={hasAttemptedSubmit && !editingType?.billing_method ? 'ring-1 ring-red-500' : ''}
              />
            </div>
            <div>
              <Label htmlFor="order-number">
                {t('serviceTypes.fields.displayOrder.label', { defaultValue: 'Display Order *' })}
              </Label>
              <Input
                id="order-number"
                type="number"
                value={editingType?.order_number || ''}
                onChange={(e) => {
                  const value = e.target.value ? parseInt(e.target.value) : undefined;
                  setEditingType({ ...editingType, order_number: value });
                  clearErrorIfSubmitted();
                }}
                placeholder={t('serviceTypes.fields.displayOrder.placeholder', {
                  defaultValue: 'e.g., 1, 2, 3...'
                })}
                required
                className={hasAttemptedSubmit && !editingType?.order_number ? 'border-red-500' : ''}
              />
              <p className="text-sm text-muted-foreground mt-1">
                {t('serviceTypes.fields.displayOrder.help', {
                  defaultValue: 'Controls the order in which service types appear in dropdown menus throughout the platform. Lower numbers appear first.'
                })}
                {tenantTypes.length > 0 && (
                  <span className="block">
                    {t('serviceTypes.fields.displayOrder.usedOrders', {
                      defaultValue: 'Used orders: {{orders}}',
                      orders: tenantTypes
                        .filter(t => t.id !== editingType?.id)
                        .map(t => t.order_number)
                        .sort((a, b) => a - b)
                        .join(', ')
                    })}
                  </span>
                )}
              </p>
            </div>
          </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={handleCloseDeleteDialog}
        onConfirm={handleConfirmDelete}
        title={t('serviceTypes.dialog.deleteTitle', { defaultValue: 'Delete Service Type' })}
        message={
          error && error.includes("in use")
            ? t('serviceTypes.delete.errorPrefix', {
              defaultValue: 'Error: {{error}}',
              error
            })
            : t('serviceTypes.delete.message', {
              defaultValue: 'Are you sure you want to delete the service type "{{name}}"? This cannot be undone.',
              name: typeToDelete?.name || ''
            })
        }
        confirmLabel={error && error.includes("in use")
          ? t('serviceTypes.actions.close', { defaultValue: 'Close' })
          : t('common.actions.delete', { defaultValue: 'Delete' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
      />

      {/* Import Dialog */}
      <Dialog
        isOpen={showImportDialog && importConflicts.length === 0}
        onClose={() => {
          setShowImportDialog(false);
          setSelectedImportTypes([]);
        }}
        title={t('serviceTypes.import.title', { defaultValue: 'Import Standard Service Types' })}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-import-service-types"
              variant="outline"
              onClick={() => {
                setShowImportDialog(false);
                setSelectedImportTypes([]);
              }}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="confirm-import-service-types"
              onClick={handleCheckConflicts}
              disabled={selectedImportTypes.length === 0}
            >
              {t('common.actions.importSelected', { defaultValue: 'Import Selected' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            {availableReferenceTypes.length === 0 ? (
              <p className="text-muted-foreground">
                {t('serviceTypes.import.empty', {
                  defaultValue: 'No standard service types available to import.'
                })}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('serviceTypes.import.description', {
                    defaultValue: 'Select standard service types to import into your organization:'
                  })}
                </p>
                <div className="border rounded-md">
                  {/* Table Header */}
                  <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                    <div className="w-8"></div> {/* Checkbox column */}
                    <div className="flex-1">{t('common.columns.name', { defaultValue: 'Name' })}</div>
                    <div className="w-24 text-center">{t('common.columns.billingMethod', { defaultValue: 'Billing Method' })}</div>
                    <div className="w-16 text-center">{t('common.columns.order', { defaultValue: 'Order' })}</div>
                  </div>
                  {/* Table Body */}
                  <div className="max-h-[300px] overflow-y-auto">
                    {availableReferenceTypes.map((type) => (
                      <label 
                        key={type.id} 
                        className="flex items-center space-x-2 p-2 hover:bg-muted/50 border-b last:border-b-0 cursor-pointer"
                      >
                        <div className="w-8 [&>div]:mb-0">
                          <Checkbox
                            id={`import-service-type-${type.id}`}
                            checked={selectedImportTypes.includes(type.id)}
                            onChange={(e) => {
                              if ((e.target as HTMLInputElement).checked) {
                                setSelectedImportTypes([...selectedImportTypes, type.id]);
                              } else {
                                setSelectedImportTypes(selectedImportTypes.filter(id => id !== type.id));
                              }
                            }}
                            className="rounded border-[rgb(var(--color-border-300))]"
                          />
                        </div>
                        <div className="flex-1">{type.name}</div>
                        <div className="w-24 text-center text-sm text-muted-foreground">
                          {type.billing_method === 'fixed'
                            ? t('common.billingMethod.fixed', { defaultValue: 'Fixed' })
                            : type.billing_method === 'hourly'
                              ? t('common.billingMethod.hourly', { defaultValue: 'Hourly' })
                              : t('common.billingMethod.usage', { defaultValue: 'Usage' })}
                        </div>
                        <div className="w-16 text-center text-sm text-muted-foreground">
                          {type.display_order}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <Dialog
        isOpen={importConflicts.length > 0}
        onClose={() => {
          setImportConflicts([]);
          setConflictResolutions({});
        }}
        title={t('import.title', { defaultValue: 'Resolve Import Conflicts' })}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-resolve-conflicts"
              variant="outline"
              onClick={() => {
                setImportConflicts([]);
                setConflictResolutions({});
              }}
            >
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              id="confirm-import-with-resolutions"
              onClick={handleImport}
            >
              {t('common.actions.importWithResolutions', { defaultValue: 'Import with Resolutions' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('serviceTypes.conflicts.description', {
                defaultValue: 'The following items have conflicts that need to be resolved:'
              })}
            </p>
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {importConflicts.map((conflict) => {
                const itemId = conflict.referenceItem.id;
                const resolution = conflictResolutions[itemId] || { action: 'skip' };
                
                return (
                  <div key={itemId} className="border rounded-lg p-4 space-y-3">
                    <div>
                      <h4 className="font-medium">{conflict.referenceItem.name}</h4>
                      <p className="text-sm text-muted-foreground">
                        {conflict.conflictType === 'name'
                          ? t('serviceTypes.conflicts.nameExists', {
                            defaultValue: 'Conflict: Name already exists'
                          })
                          : t('serviceTypes.conflicts.orderInUse', {
                            defaultValue: 'Conflict: Order {{order}} is already in use',
                            order: conflict.referenceItem.order_number || conflict.referenceItem.display_order
                          })}
                      </p>
                    </div>
                    
                    <div className="space-y-2">
                      <label className="flex items-center space-x-2">
                        <input
                          type="radio"
                          name={`conflict-${itemId}`}
                          checked={resolution.action === 'skip'}
                          onChange={() => setConflictResolutions({
                            ...conflictResolutions,
                            [itemId]: { action: 'skip' }
                          })}
                        />
                        <span>{t('import.skipItem', { defaultValue: 'Skip this item' })}</span>
                      </label>
                      
                      {conflict.conflictType === 'name' && (
                        <label className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name={`conflict-${itemId}`}
                            checked={resolution.action === 'rename'}
                            onChange={() => setConflictResolutions({
                              ...conflictResolutions,
                              [itemId]: { action: 'rename', newName: conflict.referenceItem.name + ' (2)' }
                            })}
                          />
                          <span>{t('serviceTypes.conflicts.rename', { defaultValue: 'Import with different name:' })}</span>
                          {resolution.action === 'rename' && (
                            <Input
                              value={resolution.newName || ''}
                              onChange={(e) => setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { ...resolution, newName: e.target.value }
                              })}
                              className="ml-2 flex-1"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </label>
                      )}
                      
                      {conflict.conflictType === 'order' && (
                        <label className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name={`conflict-${itemId}`}
                            checked={resolution.action === 'reorder'}
                            onChange={() => setConflictResolutions({
                              ...conflictResolutions,
                              [itemId]: { action: 'reorder', newOrder: conflict.suggestedOrder }
                            })}
                          />
                          <span>{t('serviceTypes.conflicts.reorder', { defaultValue: 'Import with different order:' })}</span>
                          {resolution.action === 'reorder' && (
                            <Input
                              type="number"
                              value={resolution.newOrder || ''}
                              onChange={(e) => setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { ...resolution, newOrder: parseInt(e.target.value) }
                              })}
                              className="ml-2 w-24"
                              onClick={(e) => e.stopPropagation()}
                            />
                          )}
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ServiceTypeSettings;
