'use client';

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical } from "lucide-react";
import { getStatuses, deleteStatus, updateStatus } from '@product/actions/status-actions/statusActions';
import { importReferenceData, getAvailableReferenceData, checkImportConflicts, type ImportConflict } from '@product/actions/referenceDataActions';
import { IStatus, IStandardStatus, ItemType } from 'server/src/interfaces/status.interface';
import { getCurrentUser } from '@product/actions/user-actions/userActions';
import { Switch } from 'server/src/components/ui/Switch';
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
import { StatusDialog } from './dialogs/StatusDialog';
import { StatusImportDialog } from './dialogs/StatusImportDialog';
import { ConflictResolutionDialog } from './dialogs/ConflictResolutionDialog';
import { DeleteConfirmationDialog } from './dialogs/DeleteConfirmationDialog';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { useSearchParams } from 'next/navigation';

interface StatusSettingsProps {
  initialStatusType?: string | null;
}

const StatusSettings = ({ initialStatusType }: StatusSettingsProps): JSX.Element => {
  const searchParams = useSearchParams();
  const [statuses, setStatuses] = useState<IStatus[]>([]);
  const [selectedStatusType, setSelectedStatusType] = useState<ItemType>(() => {
    // Use initialStatusType if provided, otherwise default to 'ticket'
    const validTypes: ItemType[] = ['ticket', 'project', 'interaction'];
    const typeFromUrl = initialStatusType || searchParams?.get('type');
    return validTypes.includes(typeFromUrl as ItemType) ? (typeFromUrl as ItemType) : 'ticket';
  });
  const [userId, setUserId] = useState<string>('');
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [editingStatus, setEditingStatus] = useState<IStatus | null>(null);
  const [showStatusImportDialog, setShowStatusImportDialog] = useState(false);
  const [availableReferenceStatuses, setAvailableReferenceStatuses] = useState<IStandardStatus[]>([]);
  const [selectedImportStatuses, setSelectedImportStatuses] = useState<string[]>([]);
  
  // Conflict resolution state
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});
  
  // Delete confirmation state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [statusToDelete, setStatusToDelete] = useState<IStatus | null>(null);

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
    const fetchStatuses = async (): Promise<void> => {
      try {
        const fetchedStatuses = await getStatuses(selectedStatusType);
        setStatuses(fetchedStatuses);
      } catch (error) {
        console.error('Error fetching statuses:', error);
      }
    };

    fetchStatuses();
  }, [selectedStatusType]);

  const updateStatusItem = async (updatedStatus: IStatus): Promise<void> => {
    // Prevent removing the last closed status
    const currentStatus = statuses.find(s => s.status_id === updatedStatus.status_id);
    if (currentStatus?.is_closed && !updatedStatus.is_closed) {
      const otherClosedStatuses = statuses.filter(s => 
        s.status_id !== updatedStatus.status_id && s.is_closed
      );
      if (otherClosedStatuses.length === 0) {
        toast.error('At least one status must remain marked as closed');
        return;
      }
    }

    try {
      await updateStatus(updatedStatus.status_id!, updatedStatus);
      setStatuses(statuses.map((status): IStatus =>
        status.status_id === updatedStatus.status_id ? updatedStatus : status
      ));
    } catch (error) {
      console.error('Error updating status:', error);
    }
  };

  const handleDeleteStatusRequest = (statusId: string): void => {
    const status = statuses.find(s => s.status_id === statusId);
    if (status) {
      if (status.is_closed) {
        const otherClosedStatuses = statuses.filter(s =>
          s.status_id !== statusId && s.is_closed && s.status_type === status.status_type
        );
        if (otherClosedStatuses.length === 0) {
          toast.error('Cannot delete the last closed status for this type.');
          return;
        }
      }
      setStatusToDelete(status);
      setShowDeleteDialog(true);
    }
  };

  const confirmDeleteStatus = async (): Promise<void> => {
    if (!statusToDelete) return;

    try {
      await deleteStatus(statusToDelete.status_id);
      setStatuses(statuses.filter(s => s.status_id !== statusToDelete.status_id));
      toast.success('Status deleted successfully');
    } catch (error) {
      console.error('Error deleting status:', error);
      const message = error instanceof Error ? error.message : 'Cannot delete status because it is currently in use';
      if (message.toLowerCase().includes('in use') || message.toLowerCase().includes('referenced') || message.toLowerCase().includes('foreign key')) {
        toast.error(`Cannot delete "${statusToDelete.name}" because it is currently in use.`);
      } else {
        toast.error(message);
      }
    } finally {
      setShowDeleteDialog(false);
      setStatusToDelete(null);
    }
  };

  const handleImportStatuses = async () => {
    const available = await getAvailableReferenceData('statuses', { item_type: selectedStatusType });
    setAvailableReferenceStatuses(available);
    setSelectedImportStatuses([]);
    setShowStatusImportDialog(true);
  };

  const handleImportSelected = async () => {
    try {
      // Check for conflicts first
      const conflicts = await checkImportConflicts(
        'statuses',
        selectedImportStatuses,
        { item_type: selectedStatusType }
      );
      
      if (conflicts.length > 0) {
        // Show conflict resolution dialog
        setImportConflicts(conflicts);
        setConflictResolutions({});
        setShowConflictDialog(true);
        setShowStatusImportDialog(false);
      } else {
        // No conflicts, proceed with import
        const result = await importReferenceData(
          'statuses',
          selectedImportStatuses,
          { item_type: selectedStatusType }
        );
        
        if (result.imported.length > 0) {
          toast.success(`Successfully imported ${result.imported.length} statuses`);
          // Refresh statuses list
          const updatedStatuses = await getStatuses(selectedStatusType);
          setStatuses(updatedStatuses);
        }
        
        if (result.skipped.length > 0) {
          toast.error(`Skipped ${result.skipped.length} statuses (${(result.skipped as any[])[0].reason})`);
        }
        
        setShowStatusImportDialog(false);
        setSelectedImportStatuses([]);
      }
    } catch (error) {
      console.error('Error importing statuses:', error);
      toast.error('Failed to import statuses');
    }
  };

  const handleResolveConflicts = async () => {
    try {
      const result = await importReferenceData(
        'statuses',
        selectedImportStatuses,
        { item_type: selectedStatusType },
        conflictResolutions
      );
      
      if (result.imported.length > 0) {
        toast.success(`Successfully imported ${result.imported.length} statuses`);
        const updatedStatuses = await getStatuses(selectedStatusType);
        setStatuses(updatedStatuses);
        setSelectedImportStatuses([]);
      }
      
      if (result.skipped.length > 0) {
        const skippedNames = (result.skipped as any[]).map((s: any) => s.name).join(', ');
        toast(`Skipped: ${skippedNames}`, {
          icon: 'ℹ️',
          duration: 4000,
        });
      }
      
      setShowConflictDialog(false);
      setImportConflicts([]);
      setConflictResolutions({});
    } catch (error) {
      console.error('Error importing statuses:', error);
      toast.error('Failed to import statuses');
    }
  };

  const getStatusColumns = (type: ItemType): ColumnDefinition<IStatus>[] => {
    const baseColumns: ColumnDefinition<IStatus>[] = [
      {
        title: 'Name',
        dataIndex: 'name',
        width: '30%',
      },
      {
        title: 'Status',
        dataIndex: 'is_closed',
        width: '25%',
        render: (value, record) => (
          <div className="flex items-center space-x-2 text-gray-500">
            <span className="text-sm mr-2">
              {record.is_closed ? 'Closed' : 'Open'}
            </span>
            <Switch
              checked={record.is_closed}
              onCheckedChange={() => updateStatusItem({ ...record, is_closed: !record.is_closed })}
              className="data-[state=checked]:bg-primary-500"
            />
            <span className="text-xs text-gray-400 ml-2">
              {record.is_closed 
                ? `${
                    type === 'project' ? 'Projects' : 
                    type === 'ticket' ? 'Tickets' : 
                    type === 'project_task' ? 'Tasks' : 
                    'Interactions'
                  } with this status will be marked as closed` 
                : `${
                    type === 'project' ? 'Projects' : 
                    type === 'ticket' ? 'Tickets' : 
                    type === 'project_task' ? 'Tasks' : 
                    'Interactions'
                  } with this status will remain open`
              }
            </span>
          </div>
        ),
      }
    ];

    // Only add default column for ticket statuses
    if (type === 'ticket') {
      baseColumns.push({
        title: 'Default',
        dataIndex: 'is_default',
        width: '25%',
        render: (value, record) => (
          <div className="flex items-center space-x-2 text-gray-500">
            <Switch
              checked={record.is_default || false}
              onCheckedChange={async (checked) => {
                if (checked) {
                  try {
                    // Update this status first
                    await updateStatusItem({ ...record, is_default: true });
                    
                    // Update local state to reflect the change
                    setStatuses(prevStatuses => 
                      prevStatuses.map(status => ({
                        ...status,
                        is_default: status.status_id === record.status_id
                      }))
                    );
                  } catch (error) {
                    console.error('Error updating default status:', error);
                    toast.error('Failed to update default status');
                  }
                } else {
                  try {
                    // Check if this is the last default status
                    const defaultStatuses = statuses.filter(s => 
                      s.status_id !== record.status_id && 
                      s.is_default &&
                      s.status_type === record.status_type
                    );
                    
                    if (defaultStatuses.length === 0) {
                      toast.error('Cannot remove default status from the last default status');
                      return;
                    }

                    await updateStatusItem({ ...record, is_default: false });
                    
                    // Update local state
                    setStatuses(prevStatuses => 
                      prevStatuses.map(status => 
                        status.status_id === record.status_id ? 
                          { ...status, is_default: false } : 
                          status
                      )
                    );
                  } catch (error) {
                    console.error('Error updating default status:', error);
                    toast.error('Failed to update default status');
                  }
                }
              }}
              className="data-[state=checked]:bg-primary-500"
            />
            <span className="text-xs text-gray-400 ml-2">
              {record.is_default ? 'Default status for new tickets from client portal' : ''}
            </span>
          </div>
        ),
      });
    }

    // Add Order column right before Actions
    baseColumns.push({
      title: 'Order',
      dataIndex: 'order_number',
      width: '10%',
      render: (value) => value || 0,
    });

    return baseColumns;
  };

  return (
    <div>
      {selectedStatusType === 'ticket' && (
        <div className="bg-blue-50 p-4 rounded-md mb-4">
          <p className="text-sm text-blue-700">
            <strong>Default Status:</strong> When clients create tickets through the client portal,
            they will automatically be assigned the status marked as default. Only one status can
            be set as default at a time.
          </p>
        </div>
      )}
      {selectedStatusType === 'project' && (
        <div className="bg-blue-50 p-4 rounded-md mb-4">
          <p className="text-sm text-blue-700">
            <strong>Project Statuses:</strong> Define the workflow stages for your projects.
            Mark statuses as "closed" to indicate project completion.
          </p>
        </div>
      )}
      {selectedStatusType === 'interaction' && (
        <div className="bg-blue-50 p-4 rounded-md mb-4">
          <p className="text-sm text-blue-700">
            <strong>Interaction Statuses:</strong> Track the state of customer interactions
            such as calls, emails, and meetings.
          </p>
        </div>
      )}
      
      {/* Statuses Section */}
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">
            {selectedStatusType.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} Statuses
          </h3>
          <CustomSelect
            value={selectedStatusType}
            onValueChange={(value: string) => {
              const newType = value as ItemType;
              setSelectedStatusType(newType);
              
              // Update URL with new type parameter
              const currentSearchParams = new URLSearchParams(window.location.search);
              currentSearchParams.set('type', newType);
              const newUrl = `/msp/settings?${currentSearchParams.toString()}`;
              window.history.pushState({}, '', newUrl);
            }}
            options={[
              { value: 'ticket', label: 'Ticket Statuses' },
              { value: 'project', label: 'Project Statuses' },
              { value: 'interaction', label: 'Interaction Statuses' }
            ]}
            className="w-64"
          />
        </div>
        
        <DataTable
          data={statuses.filter(s => s.status_type === selectedStatusType).sort((a, b) => (a.order_number || 0) - (b.order_number || 0))}
          columns={[...getStatusColumns(selectedStatusType), {
            title: 'Actions',
            dataIndex: 'action',
            width: '10%',
            render: (_, item) => (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    id={`status-actions-menu-${item.status_id}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="sr-only">Open menu</span>
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    id={`edit-status-${item.status_id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingStatus(item);
                      setShowStatusDialog(true);
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    id={`delete-status-${item.status_id}`}
                    className="text-red-600 focus:text-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteStatusRequest(item.status_id);
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          }]}
        />
        
        <div className="mt-4 flex gap-2">
          <Button 
            id='add-status-button' 
            onClick={() => {
              setEditingStatus(null);
              setShowStatusDialog(true);
            }} 
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Status
          </Button>
          <Button 
            id='import-statuses-button' 
            onClick={handleImportStatuses} 
            variant="outline"
          >
            Import from Standard Statuses
          </Button>
        </div>
      </div>

      {/* Status Dialog */}
      <StatusDialog
        open={showStatusDialog}
        onOpenChange={setShowStatusDialog}
        editingStatus={editingStatus}
        selectedStatusType={selectedStatusType}
        userId={userId}
        existingStatuses={statuses}
        onSuccess={async () => {
          const updatedStatuses = await getStatuses(selectedStatusType);
          setStatuses(updatedStatuses);
        }}
      />
      
      {/* Import Dialog */}
      <StatusImportDialog
        open={showStatusImportDialog}
        onOpenChange={setShowStatusImportDialog}
        availableStatuses={availableReferenceStatuses}
        selectedStatuses={selectedImportStatuses}
        onSelectionChange={(statusId) => {
          setSelectedImportStatuses(prev => 
            prev.includes(statusId) 
              ? prev.filter(id => id !== statusId)
              : [...prev, statusId]
          );
        }}
        onImport={handleImportSelected}
      />
      
      {/* Conflict Resolution Dialog */}
      <ConflictResolutionDialog
        open={showConflictDialog}
        onOpenChange={setShowConflictDialog}
        conflicts={importConflicts}
        resolutions={conflictResolutions}
        onResolutionChange={(itemId, resolution) => {
          setConflictResolutions(prev => ({
            ...prev,
            [itemId]: resolution
          }));
        }}
        onResolve={handleResolveConflicts}
        onCancel={() => {
          setShowConflictDialog(false);
          setImportConflicts([]);
          setConflictResolutions({});
        }}
      />
      
      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setStatusToDelete(null);
        }}
        itemName={statusToDelete?.name || ''}
        itemType="Status"
        onConfirm={confirmDeleteStatus}
      />
    </div>
  );
};

export default StatusSettings;
