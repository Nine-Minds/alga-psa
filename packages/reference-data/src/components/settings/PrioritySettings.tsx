'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, MoreVertical, Palette } from "lucide-react";
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import { getAllPriorities, createPriority, deletePriority, updatePriority, validatePriorityDeletion } from '@alga-psa/reference-data/actions';
import { importReferenceData, getAvailableReferenceData, checkImportConflicts, type ImportConflict } from '@alga-psa/reference-data/actions';
import type { IPriority, IStandardPriority, DeletionValidationResult } from '@alga-psa/types';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import type { ColumnDefinition } from '@alga-psa/types';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DeleteEntityDialog } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface PrioritySettingsProps {
  onShowConflictDialog?: (conflicts: ImportConflict[], type: 'priorities' | 'statuses', resolutions: Record<string, any>) => void;
  initialPriorityType?: string | null;
}

const PrioritySettings = ({ onShowConflictDialog, initialPriorityType }: PrioritySettingsProps): React.JSX.Element => {
  const { t } = useTranslation('msp/settings');
  const [priorities, setPriorities] = useState<(IPriority | IStandardPriority)[]>([]);
  const [selectedPriorityType] = useState<'ticket' | 'project_task'>(() => {
    // Use initialPriorityType, default to 'ticket' if not provided
    const validTypes: ('ticket' | 'project_task')[] = ['ticket', 'project_task'];
    return validTypes.includes(initialPriorityType as 'ticket' | 'project_task')
      ? (initialPriorityType as 'ticket' | 'project_task')
      : 'ticket';
  });
  const [showPriorityDialog, setShowPriorityDialog] = useState(false);
  const [editingPriority, setEditingPriority] = useState<IPriority | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferencePriorities, setAvailableReferencePriorities] = useState<IStandardPriority[]>([]);
  const [selectedImportPriorities, setSelectedImportPriorities] = useState<string[]>([]);
  const [priorityColor, setPriorityColor] = useState('#6B7280');

  // Delete dialog state
  const [priorityToDelete, setPriorityToDelete] = useState<IPriority | null>(null);
  const [deleteValidation, setDeleteValidation] = useState<DeletionValidationResult | null>(null);
  const [isDeleteValidating, setIsDeleteValidating] = useState(false);
  const [isDeleteProcessing, setIsDeleteProcessing] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  useEffect(() => {
    const fetchPriorities = async (): Promise<void> => {
      try {
        const fetchedPriorities = await getAllPriorities();
        setPriorities(fetchedPriorities);
      } catch (error) {
        console.error('Error fetching priorities:', error);
      }
    };

    fetchPriorities();
  }, []);

  const updatePriorityItem = async (updatedPriority: IPriority): Promise<void> => {
    try {
      await updatePriority(updatedPriority.priority_id, updatedPriority);
      setPriorities(priorities.map((priority) =>
        'tenant' in priority && priority.priority_id === updatedPriority.priority_id ? updatedPriority : priority
      ));
    } catch (error) {
      console.error('Error updating priority:', error);
    }
  };

  const resetDeleteState = () => {
    setPriorityToDelete(null);
    setDeleteValidation(null);
    setIsDeleteValidating(false);
    setIsDeleteProcessing(false);
  };

  const runDeleteValidation = useCallback(async (priorityId: string) => {
    setIsDeleteValidating(true);
    try {
      const result = await validatePriorityDeletion(priorityId);
      setDeleteValidation(result);
    } catch (error) {
      console.error('Error validating priority deletion:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: t('ticketing.priorities.messages.error.deleteValidationFailed'),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteValidating(false);
    }
  }, [t]);

  const handleDeletePriorityRequest = (priorityId: string): void => {
    const priority = priorities.find(p => p.priority_id === priorityId);
    if (priority && 'tenant' in priority) {
      setPriorityToDelete(priority as IPriority);
      void runDeleteValidation(priorityId);
    }
  };

  const confirmDeletePriority = async (): Promise<void> => {
    if (!priorityToDelete) return;

    try {
      setIsDeleteProcessing(true);
      const result = await deletePriority(priorityToDelete.priority_id);
      if (!result.success) {
        setDeleteValidation(result);
        return;
      }

      setPriorities(priorities.filter(p => p.priority_id !== priorityToDelete.priority_id));
      toast.success(t('ticketing.priorities.messages.success.deleted'));
      resetDeleteState();
    } catch (error) {
      console.error('Error deleting priority:', error);
      setDeleteValidation({
        canDelete: false,
        code: 'VALIDATION_FAILED',
        message: error instanceof Error ? error.message : t('ticketing.priorities.messages.error.deleteFailed'),
        dependencies: [],
        alternatives: []
      });
    } finally {
      setIsDeleteProcessing(false);
    }
  };

  const handleImportPriorities = async () => {
    const available = await getAvailableReferenceData('priorities', { item_type: selectedPriorityType });
    setAvailableReferencePriorities(available);
    setSelectedImportPriorities([]);
    setShowImportDialog(true);
  };

  const handleImportSelected = async () => {
    try {
      // Check for conflicts first
      const conflicts = await checkImportConflicts(
        'priorities',
        selectedImportPriorities,
        { item_type: selectedPriorityType }
      );

      if (conflicts.length > 0 && onShowConflictDialog) {
        // Use parent's conflict dialog if provided
        onShowConflictDialog(conflicts, 'priorities', {});
        setShowImportDialog(false);
      } else if (conflicts.length === 0) {
        // No conflicts, proceed with import
        const result = await importReferenceData(
          'priorities',
          selectedImportPriorities,
          { item_type: selectedPriorityType }
        );

        if (result.imported.length > 0) {
          toast.success(t('ticketing.priorities.messages.success.imported', { count: result.imported.length }));
          // Refresh priorities list
          const updatedPriorities = await getAllPriorities();
          setPriorities(updatedPriorities);
        }

        if (result.skipped.length > 0) {
          toast.error(t('ticketing.priorities.messages.success.skipped', { count: result.skipped.length }));
        }

        setShowImportDialog(false);
        setSelectedImportPriorities([]);
      }
    } catch (error) {
      handleError(error, t('ticketing.priorities.messages.error.importFailed'));
    }
  };

  const priorityColumns: ColumnDefinition<IPriority | IStandardPriority>[] = [
    {
      title: t('ticketing.priorities.table.name'),
      dataIndex: 'priority_name',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <div
            className="w-4 h-4 rounded-full"
            style={{ backgroundColor: record.color }}
          />
          <span>{value}</span>
          {'is_from_itil_standard' in record && record.is_from_itil_standard && (
            <span className="ml-1 px-1.5 py-0.5 text-xs font-medium bg-blue-500/15 text-blue-600 rounded">ITIL</span>
          )}
          {'tenant' in record ? null : (
            !('is_from_itil_standard' in record && record.is_from_itil_standard) && <span className="text-xs text-gray-500 italic">{t('ticketing.priorities.table.standardTag')}</span>
          )}
        </div>
      ),
    },
    {
      title: t('ticketing.priorities.table.type'),
      dataIndex: 'item_type',
      render: (value) => (
        <span className="capitalize">{value === 'project_task' ? t('ticketing.priorities.itemTypes.projectTask') : t('ticketing.priorities.itemTypes.ticket')}</span>
      ),
    },
    {
      title: t('ticketing.priorities.table.color'),
      dataIndex: 'color',
      render: (value) => (
        <div className="flex items-center gap-2">
          <div
            className="w-6 h-6 rounded border border-gray-300"
            style={{ backgroundColor: value }}
          />
          <span className="text-xs text-gray-500">{value}</span>
        </div>
      ),
    },
    {
      title: t('ticketing.priorities.table.order'),
      dataIndex: 'order_number',
      render: (value) => value,
    },
  ];

  return (
    <div>
      {/* Priorities Section */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            {selectedPriorityType === 'project_task' ? t('ticketing.priorities.title.projectTask') : t('ticketing.priorities.title.ticket')}
          </h3>
        </div>

        {/* Info box about priorities */}
        <Alert variant="info" className="mb-4">
          <AlertDescription>
            <strong>{t('ticketing.priorities.alert.header')}</strong> {t('ticketing.priorities.alert.description')}
            {priorities.some(p => 'is_from_itil_standard' in p && p.is_from_itil_standard && p.item_type === selectedPriorityType) ?
              ` ${t('ticketing.priorities.alert.itilNote')}` :
              ` ${t('ticketing.priorities.alert.nonItilNote')}`}
          </AlertDescription>
        </Alert>

        <DataTable
          id="priorities-table"
          data={priorities
            .filter(p => p.item_type === selectedPriorityType)
            .sort((a, b) => (a.order_number || 0) - (b.order_number || 0))
          }
          columns={[...priorityColumns, {
            title: t('ticketing.priorities.table.actions'),
            dataIndex: 'action',
            width: '5%',
            render: (_, item) => {
              // ITIL imported priorities cannot be edited or deleted
              if ('is_from_itil_standard' in item && item.is_from_itil_standard) {
                return (
                  <span className="text-xs text-gray-400">{t('ticketing.priorities.table.itilProtected')}</span>
                );
              }

              return (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      id={`priority-actions-menu-${item.priority_id}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="sr-only">{t('ticketing.priorities.actions.openMenu')}</span>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      id={`edit-priority-${item.priority_id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingPriority(item as IPriority);
                        setPriorityColor(item.color || '#6B7280');
                        setShowPriorityDialog(true);
                      }}
                    >
                      {t('ticketing.priorities.actions.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      id={`delete-priority-${item.priority_id}`}
                      className="text-red-600 focus:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePriorityRequest(item.priority_id);
                      }}
                    >
                      {t('ticketing.priorities.actions.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          }]}
          pagination={true}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          pageSize={pageSize}
          onItemsPerPageChange={handlePageSizeChange}
        />

        <div className="mt-4 flex gap-2">
          <Button
            id='add-priority-button'
            onClick={() => {
              setEditingPriority(null);
              setPriorityColor('#6B7280');
              setShowPriorityDialog(true);
            }}
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            <Plus className="h-4 w-4 mr-2" /> {t('ticketing.priorities.actions.addPriority')}
          </Button>
          <Button
            id='import-priorities-button'
            onClick={handleImportPriorities}
            variant="outline"
          >
            {t('ticketing.priorities.actions.importStandard')}
          </Button>
        </div>
      </div>

      {/* Priority Add/Edit Dialog */}
      <Dialog
        isOpen={showPriorityDialog}
        onClose={() => setShowPriorityDialog(false)}
        title={editingPriority ? t('ticketing.priorities.dialog.editTitle') : t('ticketing.priorities.dialog.addTitle')}
        className="max-w-lg max-w-[90vw]"
        id="priority-dialog"
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-priority-dialog"
              type="button"
              variant="outline"
              onClick={() => {
                setShowPriorityDialog(false);
                setEditingPriority(null);
                setPriorityColor('#6B7280');
              }}
            >
              {t('ticketing.priorities.actions.cancel')}
            </Button>
            <Button
              id="submit-priority-dialog"
              type="button"
              variant="default"
              onClick={() => (document.getElementById('priority-dialog-form') as HTMLFormElement | null)?.requestSubmit()}
            >
              {editingPriority ? t('ticketing.priorities.dialog.submitUpdate') : t('ticketing.priorities.dialog.submitAdd')}
            </Button>
          </div>
        }
      >
        <DialogContent>
          <form id="priority-dialog-form" onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const name = formData.get('name') as string;
            const level = parseInt(formData.get('level') as string);

            try {
              // Check if order number is already taken
              const existingWithOrder = priorities.find(p =>
                'item_type' in p &&
                p.item_type === selectedPriorityType &&
                p.order_number === level &&
                p.priority_id !== editingPriority?.priority_id
              );

              if (existingWithOrder) {
                toast.error(t('ticketing.priorities.messages.error.orderTaken', { order: level, name: existingWithOrder.priority_name }));
                return;
              }

              if (editingPriority) {
                await updatePriorityItem({
                  ...editingPriority,
                  priority_name: name,
                  order_number: level,
                  color: priorityColor
                });
              } else {
                await createPriority({
                  priority_name: name,
                  order_number: level,
                  color: priorityColor,
                  item_type: selectedPriorityType
                });
              }

              // Refresh priorities list
              const updatedPriorities = await getAllPriorities();
              setPriorities(updatedPriorities);

              setShowPriorityDialog(false);
              setEditingPriority(null);
              setPriorityColor('#6B7280');
            } catch (error) {
              if (error instanceof Error && error.message.includes('unique constraint')) {
                handleError(error, t('ticketing.priorities.messages.error.uniqueConstraint'));
              } else {
                handleError(error, t('ticketing.priorities.messages.error.saveFailed'));
              }
            }
          }}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('ticketing.priorities.fields.priorityName.label')}
                </label>
                <Input
                  name="name"
                  defaultValue={editingPriority?.priority_name || ''}
                  required
                  placeholder={t('ticketing.priorities.fields.priorityName.placeholder')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('ticketing.priorities.fields.orderNumber.label')}
                </label>
                <Input
                  name="level"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={editingPriority?.order_number || (() => {
                    // Suggest next available order number
                    const prioritiesOfType = priorities.filter(p =>
                      'item_type' in p && p.item_type === selectedPriorityType
                    );
                    const maxOrder = Math.max(...prioritiesOfType.map(p => p.order_number || 0), 0);
                    return Math.min(maxOrder + 1, 100);
                  })()}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  {t('ticketing.priorities.fields.orderNumber.help')}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {(() => {
                    const prioritiesOfType = priorities.filter(p =>
                      'item_type' in p && p.item_type === selectedPriorityType
                    );
                    const usedOrders = prioritiesOfType
                      .filter(p => p.priority_id !== editingPriority?.priority_id)
                      .map(p => p.order_number)
                      .filter(n => n !== null && n !== undefined)
                      .sort((a, b) => a - b);
                    if (usedOrders.length > 0) {
                      return t('ticketing.priorities.fields.orderNumber.used', { numbers: usedOrders.join(', ') });
                    }
                    return t('ticketing.priorities.fields.orderNumber.noneUsed');
                  })()}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {t('ticketing.priorities.fields.color.label')}
                </label>
                <div className="flex items-center gap-2">
                  <div
                    className="w-10 h-10 rounded border border-gray-300"
                    style={{ backgroundColor: priorityColor }}
                  />
                  <ColorPicker
                    currentBackgroundColor={priorityColor}
                    currentTextColor="#FFFFFF"
                    onSave={(backgroundColor) => {
                      if (backgroundColor) {
                        setPriorityColor(backgroundColor);
                      }
                    }}
                    showTextColor={false}
                    previewType="circle"
                    colorMode="tag"
                    trigger={
                      <Button
                        id="priority-color-picker-btn"
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2">
                        <Palette className="h-4 w-4" />
                        <span>{t('ticketing.priorities.fields.color.chooseButton')}</span>
                      </Button>
                    }
                  />
                  <span className="text-sm text-gray-600">{priorityColor}</span>
                </div>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import Priorities Dialog */}
      <Dialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        title={t('ticketing.priorities.import.title')}
        className="max-w-lg"
        id="import-priorities-dialog"
        footer={
          <div className="flex justify-end space-x-2">
            <Button
              id="cancel-import-dialog"
              variant="outline"
              onClick={() => {
                setShowImportDialog(false);
                setSelectedImportPriorities([]);
              }}
            >
              {t('ticketing.priorities.actions.cancel')}
            </Button>
            <Button
              id="import-selected-priorities"
              variant="default"
              disabled={selectedImportPriorities.length === 0}
              onClick={handleImportSelected}
            >
              {t('ticketing.priorities.import.submit', { count: selectedImportPriorities.length })}
            </Button>
          </div>
        }
      >
        <DialogContent>
          {availableReferencePriorities.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">{selectedPriorityType === 'ticket' ? t('ticketing.priorities.import.allImportedTicket') : t('ticketing.priorities.import.allImportedProjectTask')}</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                {t('ticketing.priorities.import.instructions')}
              </p>

              <div className="border rounded-md">
                {/* Table Header */}
                <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                  <div className="w-8 [&>div]:mb-0">
                    <Checkbox
                      id="select-all-priorities"
                      checked={availableReferencePriorities.length > 0 && selectedImportPriorities.length === availableReferencePriorities.length}
                      onChange={(e) => {
                        if ((e.target as HTMLInputElement).checked) {
                          setSelectedImportPriorities(availableReferencePriorities.map(p => p.priority_id));
                        } else {
                          setSelectedImportPriorities([]);
                        }
                      }}
                    />
                  </div>
                  <div className="w-12"></div> {/* Color column */}
                  <div className="flex-1">{t('ticketing.priorities.table.name')}</div>
                  <div className="w-16 text-center">{t('ticketing.priorities.table.order')}</div>
                </div>
                {/* Table Body */}
                <div className="max-h-96 overflow-y-auto">
                  {availableReferencePriorities.map((priority) => (
                    <label
                      key={priority.priority_id}
                      className="flex items-center space-x-2 p-2 hover:bg-muted/50 border-b last:border-b-0 cursor-pointer"
                    >
                      <div className="w-8 [&>div]:mb-0">
                        <Checkbox
                          id={`import-priority-${priority.priority_id}`}
                          checked={selectedImportPriorities.includes(priority.priority_id)}
                          onChange={(e) => {
                            if ((e.target as HTMLInputElement).checked) {
                              setSelectedImportPriorities([...selectedImportPriorities, priority.priority_id]);
                            } else {
                              setSelectedImportPriorities(selectedImportPriorities.filter(id => id !== priority.priority_id));
                            }
                          }}
                        />
                      </div>
                      <div className="w-12 flex justify-center">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: priority.color }}
                        />
                      </div>
                      <div className="flex-1 font-medium">{priority.priority_name}</div>
                      <div className="w-16 text-center text-sm text-muted-foreground">
                        {priority.order_number}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

      <DeleteEntityDialog
        id="delete-priority-dialog"
        isOpen={Boolean(priorityToDelete)}
        onClose={resetDeleteState}
        onConfirmDelete={confirmDeletePriority}
        entityName={priorityToDelete?.priority_name || t('ticketing.priorities.entity.fallback')}
        validationResult={deleteValidation}
        isValidating={isDeleteValidating}
        isDeleting={isDeleteProcessing}
      />
    </div>
  );
};

export default PrioritySettings;
