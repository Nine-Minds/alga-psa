'use client';

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, Palette } from "lucide-react";
import ColorPicker from 'server/src/components/ui/ColorPicker';
import { getAllPriorities, createPriority, deletePriority, updatePriority } from '@product/actions/priorityActions';
import { importReferenceData, getAvailableReferenceData, checkImportConflicts, type ImportConflict } from '@product/actions/referenceDataActions';
import { IPriority, IStandardPriority } from 'server/src/interfaces/ticket.interfaces';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { toast } from 'react-hot-toast';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { useSearchParams } from 'next/navigation';
import { DeleteConfirmationDialog } from './dialogs/DeleteConfirmationDialog';

interface PrioritySettingsProps {
  onShowConflictDialog?: (conflicts: ImportConflict[], type: 'priorities' | 'statuses', resolutions: Record<string, any>) => void;
  initialPriorityType?: string | null;
}

const PrioritySettings = ({ onShowConflictDialog, initialPriorityType }: PrioritySettingsProps): JSX.Element => {
  const searchParams = useSearchParams();
  const [priorities, setPriorities] = useState<(IPriority | IStandardPriority)[]>([]);
  const [selectedPriorityType, setSelectedPriorityType] = useState<'ticket' | 'project_task'>(() => {
    // Use initialPriorityType if provided, otherwise default to 'ticket'
    const validTypes: ('ticket' | 'project_task')[] = ['ticket', 'project_task'];
    const typeFromUrl = initialPriorityType || searchParams?.get('type');
    return validTypes.includes(typeFromUrl as 'ticket' | 'project_task') ? (typeFromUrl as 'ticket' | 'project_task') : 'ticket';
  });
  const [userId, setUserId] = useState<string>('');
  const [showPriorityDialog, setShowPriorityDialog] = useState(false);
  const [editingPriority, setEditingPriority] = useState<IPriority | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferencePriorities, setAvailableReferencePriorities] = useState<IStandardPriority[]>([]);
  const [selectedImportPriorities, setSelectedImportPriorities] = useState<string[]>([]);
  const [priorityColor, setPriorityColor] = useState('#6B7280');
  
  // Delete dialog state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [priorityToDelete, setPriorityToDelete] = useState<IPriority | null>(null);

  useEffect(() => {
    const initUser = async () => {
      const user = await getCurrentUser();
      if (user) {
        setUserId(user.user_id);
      }
    };
    initUser();
  }, []);

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

  const handleDeletePriorityRequest = (priorityId: string): void => {
    const priority = priorities.find(p => p.priority_id === priorityId);
    if (priority && 'tenant' in priority) {
      setPriorityToDelete(priority as IPriority);
      setShowDeleteDialog(true);
    }
  };

  const confirmDeletePriority = async (): Promise<void> => {
    if (!priorityToDelete) return;

    try {
      await deletePriority(priorityToDelete.priority_id);
      setPriorities(priorities.filter(p => p.priority_id !== priorityToDelete.priority_id));
      toast.success('Priority deleted successfully');
    } catch (error) {
      console.error('Error deleting priority:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete priority';
      if (message.toLowerCase().includes('in use') || message.toLowerCase().includes('referenced') || message.toLowerCase().includes('foreign key')) {
        toast.error(`Cannot delete "${priorityToDelete.priority_name}" because it is currently in use.`);
      } else {
        toast.error(message);
      }
    } finally {
      setShowDeleteDialog(false);
      setPriorityToDelete(null);
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
          toast.success(`Successfully imported ${result.imported.length} priorities`);
          // Refresh priorities list
          const updatedPriorities = await getAllPriorities();
          setPriorities(updatedPriorities);
        }
        
        if (result.skipped.length > 0) {
          toast.error(`Skipped ${result.skipped.length} priorities (already exist)`);
        }
        
        setShowImportDialog(false);
        setSelectedImportPriorities([]);
      }
    } catch (error) {
      console.error('Error importing priorities:', error);
      toast.error('Failed to import priorities');
    }
  };

  const priorityColumns: ColumnDefinition<IPriority | IStandardPriority>[] = [
    {
      title: 'Name',
      dataIndex: 'priority_name',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <div 
            className="w-4 h-4 rounded-full" 
            style={{ backgroundColor: record.color }}
          />
          <span>{value}</span>
          {'is_from_itil_standard' in record && record.is_from_itil_standard && (
            <span className="ml-1 px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">ITIL</span>
          )}
          {'tenant' in record ? null : (
            !('is_from_itil_standard' in record && record.is_from_itil_standard) && <span className="text-xs text-gray-500 italic">(Standard)</span>
          )}
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'item_type',
      render: (value) => (
        <span className="capitalize">{value === 'project_task' ? 'Project Task' : 'Ticket'}</span>
      ),
    },
    {
      title: 'Color',
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
      title: 'Order',
      dataIndex: 'order_number',
      render: (value) => value,
    },
  ];

  return (
    <div>
      {/* Priorities Section with Tabs for Ticket and Project Task */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Priorities</h3>
          <CustomSelect
            value={selectedPriorityType}
            onValueChange={(value) => {
              const newType = value as 'ticket' | 'project_task';
              setSelectedPriorityType(newType);
              
              // Update URL with new type parameter
              const currentSearchParams = new URLSearchParams(window.location.search);
              currentSearchParams.set('type', newType);
              const newUrl = `/msp/settings?${currentSearchParams.toString()}`;
              window.history.pushState({}, '', newUrl);
            }}
            options={[
              { value: 'ticket', label: 'Ticket Priorities' },
              { value: 'project_task', label: 'Project Task Priorities' }
            ]}
            className="w-64"
          />
        </div>
        
        {/* Info box about priorities */}
        <div className="bg-blue-50 p-4 rounded-md mb-4">
          <p className="text-sm text-blue-700">
            <strong>Priority Management:</strong> Create custom priorities for your organization or import from standard templates.
            {priorities.some(p => 'is_from_itil_standard' in p && p.is_from_itil_standard && p.item_type === selectedPriorityType) ?
              ' ITIL standard priorities cannot be edited or deleted.' :
              ' All priorities can be edited or deleted to fit your workflow.'}
          </p>
        </div>

        <DataTable
          data={priorities
            .filter(p => p.item_type === selectedPriorityType)
            .sort((a, b) => (a.order_number || 0) - (b.order_number || 0))
          }
          columns={[...priorityColumns, {
            title: 'Actions',
            dataIndex: 'action',
            width: '5%',
            render: (_, item) => {
              // ITIL imported priorities cannot be edited or deleted
              if ('is_from_itil_standard' in item && item.is_from_itil_standard) {
                return (
                  <span className="text-xs text-gray-400">Protected</span>
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
                      <span className="sr-only">Open menu</span>
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
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      id={`delete-priority-${item.priority_id}`}
                      className="text-red-600 focus:text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeletePriorityRequest(item.priority_id);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              );
            },
          }]}
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
            <Plus className="h-4 w-4 mr-2" /> Add Priority
          </Button>
          <Button 
            id='import-priorities-button' 
            onClick={handleImportPriorities} 
            variant="outline"
          >
            Import from Standard Priorities
          </Button>
        </div>
      </div>

      {/* Priority Add/Edit Dialog */}
      <Dialog
        isOpen={showPriorityDialog}
        onClose={() => setShowPriorityDialog(false)}
        title={editingPriority ? 'Edit Priority' : 'Add New Priority'}
        className="max-w-lg max-w-[90vw]"
        id="priority-dialog"
      >
        <DialogContent>
          <form onSubmit={async (e) => {
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
                toast.error(`Order number ${level} is already taken by "${existingWithOrder.priority_name}". Please choose a different order number.`);
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
                  item_type: selectedPriorityType,
                  created_by: userId,
                  created_at: new Date()
                });
              }
              
              // Refresh priorities list
              const updatedPriorities = await getAllPriorities();
              setPriorities(updatedPriorities);
              
              setShowPriorityDialog(false);
              setEditingPriority(null);
              setPriorityColor('#6B7280');
            } catch (error) {
              console.error('Error saving priority:', error);
              if (error instanceof Error && error.message.includes('unique constraint')) {
                toast.error('This order number is already in use. Please choose a different order number.');
              } else {
                toast.error('Failed to save priority');
              }
            }
          }}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority Name
                </label>
                <Input
                  name="name"
                  defaultValue={editingPriority?.priority_name || ''}
                  required
                  placeholder="e.g., Urgent"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Order Number (1-100, higher numbers appear first)
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
                  Controls the order in which priorities appear in dropdown menus throughout the platform. Higher numbers appear first for priorities.
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
                      return `Used order numbers: ${usedOrders.join(', ')}`;
                    }
                    return 'No order numbers used yet';
                  })()}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Color
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
                    trigger={
                      <Button
                        id="priority-color-picker-btn"
                        type="button"
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-2">
                        <Palette className="h-4 w-4" />
                        <span>Choose Color</span>
                      </Button>
                    }
                  />
                  <span className="text-sm text-gray-600">{priorityColor}</span>
                </div>
              </div>
            </div>
            
            <DialogFooter>
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
                Cancel
              </Button>
              <Button 
                id="submit-priority-dialog"
                type="submit" 
                variant="default"
              >
                {editingPriority ? 'Update' : 'Add'} Priority
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import Priorities Dialog */}
      <Dialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        title="Import Standard Priorities"
        className="max-w-lg"
        id="import-priorities-dialog"
      >
        <DialogContent>
          {availableReferencePriorities.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">All standard priorities have already been imported for {selectedPriorityType === 'ticket' ? 'tickets' : 'project tasks'}.</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Select the standard priorities you want to import. These will be copied to your organization's priorities.
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
                  <div className="flex-1">Name</div>
                  <div className="w-16 text-center">Order</div>
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
          
          <DialogFooter>
            <Button
              id="cancel-import-dialog"
              variant="outline"
              onClick={() => {
                setShowImportDialog(false);
                setSelectedImportPriorities([]);
              }}
            >
              Cancel
            </Button>
            <Button
              id="import-selected-priorities"
              variant="default"
              disabled={selectedImportPriorities.length === 0}
              onClick={handleImportSelected}
            >
              Import ({selectedImportPriorities.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setPriorityToDelete(null);
        }}
        itemName={priorityToDelete?.priority_name || ''}
        itemType="Priority"
        onConfirm={confirmDeletePriority}
      />
    </div>
  );
};

export default PrioritySettings;