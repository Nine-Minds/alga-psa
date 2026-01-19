'use client'

import React, { useState, useEffect } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, Lock, MoreVertical } from "lucide-react";
import { IInteractionType, ISystemInteractionType } from '@alga-psa/types';
import {
  getAllInteractionTypes,
  deleteInteractionType,
  getSystemInteractionTypes
} from '@alga-psa/clients/actions';
import { getAvailableReferenceData, importReferenceData, checkImportConflicts, ImportConflict } from '@alga-psa/reference-data/actions';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { QuickAddInteractionType } from './QuickAddInteractionType';
import InteractionIcon from '@alga-psa/ui/components/InteractionIcon';
import LoadingIndicator from '@alga-psa/ui/components/LoadingIndicator';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
const InteractionTypesSettings: React.FC = () => {
  const [interactionTypes, setInteractionTypes] = useState<IInteractionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    typeId: string;
    typeName: string;
  }>({
    isOpen: false,
    typeId: '',
    typeName: ''
  });
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingType, setEditingType] = useState<IInteractionType | null>(null);
  
  // State for Import Dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferenceTypes, setAvailableReferenceTypes] = useState<IInteractionType[]>([]);
  const [selectedImportTypes, setSelectedImportTypes] = useState<string[]>([]);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    fetchTypes();
  }, []);

  const fetchTypes = async () => {
    try {
      setLoading(true);
      const allTypes = await getAllInteractionTypes();
      setInteractionTypes(allTypes);
      setError(null);
    } catch (error) {
      console.error('Error fetching types:', error);
      setError('Failed to fetch interaction types');
    } finally {
      setLoading(false);
    }
  };

  const startEditing = (type: IInteractionType) => {
    setEditingType(type);
    setError(null);
  };

  const handleDeleteType = async () => {
    try {
      await deleteInteractionType(deleteDialog.typeId);
      setError(null);
      fetchTypes();
    } catch (error: any) {
      console.error('Error deleting interaction type:', error);
      if (error.message.includes('records exist')) {
        setError('Cannot delete this interaction type because it is being used by existing records');
      } else {
        setError('Failed to delete interaction type');
      }
    } finally {
      setDeleteDialog({ isOpen: false, typeId: '', typeName: '' });
    }
  };

  // Import functionality
  const handleCheckConflicts = async () => {
    if (selectedImportTypes.length === 0) return;

    try {
      const conflicts = await checkImportConflicts('interaction_types', selectedImportTypes);
      setImportConflicts(conflicts);
      
      if (conflicts.length === 0) {
        // No conflicts, proceed with import
        await handleImport();
      }
    } catch (error) {
      console.error('Error checking conflicts:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to check conflicts');
    }
  };

  const handleImport = async () => {
    try {
      const result = await importReferenceData('interaction_types', selectedImportTypes, undefined, conflictResolutions);
      
      if (result.imported.length > 0) {
        toast.success(`Imported ${result.imported.length} interaction type${result.imported.length !== 1 ? 's' : ''}`);
      }
      
      if (result.skipped.length > 0) {
        const skippedMessage = (result.skipped as any[]).map((s: any) => `${s.name}: ${s.reason}`).join(', ');
        toast(skippedMessage, { icon: 'ℹ️' });
      }
      
      setShowImportDialog(false);
      setSelectedImportTypes([]);
      setImportConflicts([]);
      setConflictResolutions({});
      await fetchTypes();
    } catch (error) {
      console.error('Error importing interaction types:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import interaction types');
    }
  };


  const tenantTypeColumns: ColumnDefinition<IInteractionType>[] = [
    {
      title: 'Name',
      dataIndex: 'type_name',
      render: (value: string, record: IInteractionType) => (
        <div className="flex items-center space-x-2">
          <InteractionIcon icon={record.icon} typeName={record.type_name} />
          <span className="text-gray-700">{value}</span>
        </div>
      ),
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      width: '10%',
      render: (value: number) => (
        <span className="text-gray-600">{value || 0}</span>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'type_id',
      width: '10%',
      render: (_: any, record: IInteractionType) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`interaction-type-actions-menu-${record.type_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-interaction-type-${record.type_id}`}
              onClick={(e) => {
                e.stopPropagation();
                startEditing(record);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-interaction-type-${record.type_id}`}
              className="text-red-600 focus:text-red-600"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteDialog({
                  isOpen: true,
                  typeId: record.type_id,
                  typeName: record.type_name
                });
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
    return (
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex items-center justify-center py-8">
          <LoadingIndicator 
            layout="stacked" 
            text="Loading interaction types..."
            spinnerProps={{ size: 'md' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div>
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Interaction Types</h3>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataTable
          id="interaction-types-table"
          data={interactionTypes}
          columns={tenantTypeColumns}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />
        <div className="mt-4 flex gap-2">
          <Button 
            id='add-interaction-type-button'
            onClick={() => setShowAddDialog(true)} 
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Interaction Type
          </Button>
          <Button 
            id="import-interaction-types-button" 
            variant="outline"
            onClick={async () => {
              try {
                const available = await getAvailableReferenceData('interaction_types');
                setAvailableReferenceTypes(available || []);
                setSelectedImportTypes([]);
                setShowImportDialog(true);
              } catch (error) {
                console.error('Error fetching available interaction types:', error);
                toast.error('Failed to fetch available interaction types for import');
              }
            }}
          >
            Import from Standard Interaction Types
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, typeId: '', typeName: '' })}
        onConfirm={handleDeleteType}
        title="Delete Interaction Type"
        message={`Are you sure you want to delete the interaction type "${deleteDialog.typeName}"?\n\nWarning: If there are any records using this interaction type, the deletion will fail.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />

      <QuickAddInteractionType
        isOpen={showAddDialog}
        onClose={() => setShowAddDialog(false)}
        onSuccess={() => {
          fetchTypes();
          setError(null);
        }}
      />

      <QuickAddInteractionType
        isOpen={!!editingType}
        onClose={() => setEditingType(null)}
        onSuccess={() => {
          fetchTypes();
          setError(null);
          setEditingType(null);
        }}
        editingType={editingType}
      />

      {/* Import Dialog */}
      <Dialog 
        isOpen={showImportDialog && importConflicts.length === 0} 
        onClose={() => {
          setShowImportDialog(false);
          setSelectedImportTypes([]);
        }} 
        title="Import Standard Interaction Types"
      >
        <DialogContent>
          <div className="space-y-4">
            {!availableReferenceTypes || availableReferenceTypes.length === 0 ? (
              <p className="text-muted-foreground">No standard interaction types available to import.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Select standard interaction types to import into your organization:
                </p>
                <div className="border rounded-md">
                  {/* Table Header */}
                  <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                    <div className="w-8"></div> {/* Checkbox column */}
                    <div className="w-12"></div> {/* Icon column */}
                    <div className="flex-1">Name</div>
                    <div className="w-20 text-center">Order</div>
                  </div>
                  {/* Table Body */}
                  <div className="max-h-[300px] overflow-y-auto">
                    {availableReferenceTypes.map((type) => (
                      <label 
                        key={type.type_id} 
                        className="flex items-center space-x-2 p-2 hover:bg-muted/50 border-b last:border-b-0 cursor-pointer"
                      >
                        <div className="w-8 [&>div]:mb-0">
                          <Checkbox
                            id={`import-type-${type.type_id}`}
                            checked={selectedImportTypes.includes(type.type_id)}
                            onChange={(e) => {
                              if ((e.target as HTMLInputElement).checked) {
                                setSelectedImportTypes([...selectedImportTypes, type.type_id]);
                              } else {
                                setSelectedImportTypes(selectedImportTypes.filter(id => id !== type.type_id));
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                        </div>
                        <div className="w-12 flex justify-center">
                          <InteractionIcon icon={type.icon} typeName={type.type_name} />
                        </div>
                        <div className="flex-1">{type.type_name}</div>
                        <div className="w-20 text-center text-gray-600">
                          {type.display_order || 0}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-import-interaction-types"
            variant="outline" 
            onClick={() => {
              setShowImportDialog(false);
              setSelectedImportTypes([]);
            }}
          >
            Cancel
          </Button>
          <Button 
            id="confirm-import-interaction-types"
            onClick={handleCheckConflicts}
            disabled={selectedImportTypes.length === 0}
          >
            Import Selected
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <Dialog 
        isOpen={importConflicts.length > 0} 
        onClose={() => {
          setImportConflicts([]);
          setConflictResolutions({});
        }} 
        title="Resolve Import Conflicts"
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The following items have conflicts that need to be resolved:
            </p>
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {importConflicts.map((conflict) => {
                const itemId = conflict.referenceItem.type_id;
                const resolution = conflictResolutions[itemId] || { action: 'skip' };
                
                return (
                  <div key={itemId} className="border rounded-lg p-4 space-y-3">
                    <div>
                      <h4 className="font-medium">{conflict.referenceItem.type_name}</h4>
                      <p className="text-sm text-muted-foreground">
                        Conflict: {conflict.conflictType === 'name' 
                          ? 'Name already exists' 
                          : `Order ${conflict.referenceItem.display_order} is already in use`}
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
                        <span>Skip this item</span>
                      </label>
                      
                      <label className="flex items-center space-x-2">
                        <input
                          type="radio"
                          name={`conflict-${itemId}`}
                          checked={resolution.action === 'rename'}
                          onChange={() => setConflictResolutions({
                            ...conflictResolutions,
                            [itemId]: { action: 'rename', newName: conflict.referenceItem.type_name + ' (2)' }
                          })}
                        />
                        <span>Import with different name:</span>
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
                          <span>Import with order {conflict.suggestedOrder}</span>
                        </label>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-resolve-conflicts"
            variant="outline" 
            onClick={() => {
              setImportConflicts([]);
              setConflictResolutions({});
            }}
          >
            Cancel
          </Button>
          <Button 
            id="confirm-import-with-resolutions"
            onClick={handleImport}
          >
            Import with Resolutions
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
};

export default InteractionTypesSettings;
