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
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { ColumnDefinition } from '@alga-psa/types';
import { DeleteEntityDialog } from '@alga-psa/ui';
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
import { useDeletionValidation } from '@alga-psa/auth/hooks/useDeletionValidation';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
const InteractionTypesSettings: React.FC = () => {
  const { t } = useTranslation('msp/settings');
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
  const {
    validate: validateDeletion,
    reset: resetDeletionValidation,
    validationResult: deleteValidation,
    isValidating: isDeleteValidating
  } = useDeletionValidation('interaction_type');
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);
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
      setError(t('interactions.types.messages.error.fetchFailed'));
    } finally {
      setLoading(false);
    }
  };

  const startEditing = (type: IInteractionType) => {
    setEditingType(type);
    setError(null);
  };

  const resetDeleteDialog = () => {
    setDeleteDialog({ isOpen: false, typeId: '', typeName: '' });
    resetDeletionValidation();
    setIsDeleteProcessing(false);
  };

  const openDeleteDialog = async (type: IInteractionType) => {
    setDeleteDialog({ isOpen: true, typeId: type.type_id, typeName: type.type_name });
    try {
      await validateDeletion(type.type_id);
    } catch (error: any) {
      handleError(error, t('interactions.types.messages.error.validateDeleteFailed'));
    }
  };

  const handleDeleteType = async () => {
    setIsDeleteProcessing(true);
    try {
      const result = await deleteInteractionType(deleteDialog.typeId);
      if (result.deleted) {
        toast.success(t('interactions.types.messages.success.deleted'));
        setError(null);
        fetchTypes();
        resetDeleteDialog();
        return;
      }
      await validateDeletion(deleteDialog.typeId);
    } catch (error: any) {
      console.error('Error deleting interaction type:', error);
      setError(error?.message || t('interactions.types.messages.error.deleteFailed'));
    } finally {
      setIsDeleteProcessing(false);
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
      handleError(error, t('interactions.types.messages.error.checkConflicts'));
    }
  };

  const handleImport = async () => {
    try {
      const result = await importReferenceData('interaction_types', selectedImportTypes, undefined, conflictResolutions);
      
      if (result.imported.length > 0) {
        toast.success(t('interactions.types.messages.success.imported', { count: result.imported.length }));
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
      handleError(error, t('interactions.types.messages.error.importFailed'));
    }
  };


  const tenantTypeColumns: ColumnDefinition<IInteractionType>[] = [
    {
      title: t('interactions.types.table.name'),
      dataIndex: 'type_name',
      render: (value: string, record: IInteractionType) => (
        <div className="flex items-center space-x-2">
          <InteractionIcon icon={record.icon} typeName={record.type_name} />
          <span className="text-gray-700">{value}</span>
        </div>
      ),
    },
    {
      title: t('interactions.types.table.order'),
      dataIndex: 'display_order',
      width: '10%',
      render: (value: number) => (
        <span className="text-gray-600">{value || 0}</span>
      ),
    },
    {
      title: t('interactions.types.table.actions'),
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
              {t('interactions.types.actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-interaction-type-${record.type_id}`}
              className="text-destructive focus:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                openDeleteDialog(record);
              }}
            >
              {t('interactions.types.actions.delete')}
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
            text={t('interactions.types.loading')}
            spinnerProps={{ size: 'md' }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div>
        <h3 className="text-lg font-semibold mb-4 text-gray-800">{t('interactions.types.title')}</h3>
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
            <Plus className="h-4 w-4 mr-2" /> {t('interactions.types.actions.addType')}
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
                handleError(error, t('interactions.types.messages.error.fetchAvailable'));
              }
            }}
          >
            {t('interactions.types.actions.importStandard')}
          </Button>
        </div>
      </div>

      <DeleteEntityDialog
        id="delete-interaction-type-dialog"
        isOpen={deleteDialog.isOpen}
        onClose={resetDeleteDialog}
        onConfirmDelete={handleDeleteType}
        entityName={deleteDialog.typeName || 'interaction type'}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
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
        title={t('interactions.types.dialog.import.title')}
        footer={(
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-import-interaction-types"
              variant="outline"
              onClick={() => {
                setShowImportDialog(false);
                setSelectedImportTypes([]);
              }}
            >
              {t('interactions.types.actions.cancel')}
            </Button>
            <Button
              id="confirm-import-interaction-types"
              onClick={handleCheckConflicts}
              disabled={selectedImportTypes.length === 0}
            >
              {t('interactions.types.actions.importSelected')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            {!availableReferenceTypes || availableReferenceTypes.length === 0 ? (
              <p className="text-muted-foreground">{t('interactions.types.dialog.import.empty')}</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {t('interactions.types.dialog.import.description')}
                </p>
                <div className="border rounded-md">
                  {/* Table Header */}
                  <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                    <div className="w-8"></div> {/* Checkbox column */}
                    <div className="w-12"></div> {/* Icon column */}
                    <div className="flex-1">{t('interactions.types.table.name')}</div>
                    <div className="w-20 text-center">{t('interactions.types.table.order')}</div>
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
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <Dialog
        isOpen={importConflicts.length > 0}
        onClose={() => {
          setImportConflicts([]);
          setConflictResolutions({});
        }}
        title={t('interactions.types.dialog.conflicts.title')}
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
              {t('interactions.types.actions.cancel')}
            </Button>
            <Button
              id="confirm-import-with-resolutions"
              onClick={handleImport}
            >
              {t('interactions.types.dialog.conflicts.resolve')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t('interactions.types.dialog.conflicts.description')}
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
                          ? t('interactions.types.dialog.conflicts.nameConflict')
                          : t('interactions.types.dialog.conflicts.orderConflict', { order: conflict.referenceItem.display_order })}
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
                        <span>{t('interactions.types.dialog.conflicts.skipItem')}</span>
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
                        <span>{t('interactions.types.dialog.conflicts.importDifferentName')}</span>
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
                          <span>{t('interactions.types.dialog.conflicts.importDifferentOrder', { order: conflict.suggestedOrder })}</span>
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

export default InteractionTypesSettings;
