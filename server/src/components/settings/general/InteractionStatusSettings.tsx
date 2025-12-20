'use client';

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical } from "lucide-react";
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { getStatuses, deleteStatus, updateStatus } from 'server/src/lib/actions/status-actions/statusActions';
import { importReferenceData, getAvailableReferenceData, checkImportConflicts, type ImportConflict } from 'server/src/lib/actions/referenceDataActions';
import { IStatus, IStandardStatus } from 'server/src/interfaces/status.interface';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { Switch } from 'server/src/components/ui/Switch';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
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

/**
 * InteractionStatusSettings - Manages interaction statuses
 * This is for interaction statuses only
 */
const InteractionStatusSettings = (): React.JSX.Element => {
  const STATUS_TYPE = 'interaction'; // Fixed to interaction type

  const [statuses, setStatuses] = useState<IStatus[]>([]);
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

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

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
    fetchStatuses();
  }, []);

  const fetchStatuses = async (): Promise<void> => {
    try {
      const fetchedStatuses = await getStatuses(STATUS_TYPE);
      setStatuses(fetchedStatuses);
    } catch (error) {
      console.error('Error fetching statuses:', error);
    }
  };

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
      toast.success('Status updated successfully');
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error('Failed to update status');
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
    const available = await getAvailableReferenceData('statuses', { item_type: STATUS_TYPE });
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
        { item_type: STATUS_TYPE }
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
          { item_type: STATUS_TYPE }
        );

        if (result.imported.length > 0) {
          toast.success(`Successfully imported ${result.imported.length} statuses`);
          await fetchStatuses();
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
        { item_type: STATUS_TYPE },
        conflictResolutions
      );

      if (result.imported.length > 0) {
        toast.success(`Successfully imported ${result.imported.length} statuses`);
        await fetchStatuses();
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

  const statusColumns: ColumnDefinition<IStatus>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      width: '30%',
    },
    {
      title: 'Status',
      dataIndex: 'is_closed',
      width: '40%',
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
              ? 'Interactions with this status will be marked as closed'
              : 'Interactions with this status will remain open'
            }
          </span>
        </div>
      ),
    },
    {
      title: 'Order',
      dataIndex: 'order_number',
      width: '10%',
      render: (value) => value || 0,
    },
    {
      title: 'Actions',
      dataIndex: 'action',
      width: '10%',
      render: (_, item) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`interaction-status-actions-menu-${item.status_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-interaction-status-${item.status_id}`}
              onClick={(e) => {
                e.stopPropagation();
                setEditingStatus(item);
                setShowStatusDialog(true);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-interaction-status-${item.status_id}`}
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
    }
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <Alert variant="info" className="mb-4">
        <AlertDescription>
          <strong>Interaction Statuses:</strong> Track the state of customer interactions
          such as calls, emails, and meetings.
        </AlertDescription>
      </Alert>

      <h3 className="text-lg font-semibold mb-4 text-gray-800">Interaction Statuses</h3>

      <DataTable
        id="interaction-statuses-table"
        data={statuses.filter(s => s.status_type === STATUS_TYPE).sort((a, b) => (a.order_number || 0) - (b.order_number || 0))}
        columns={statusColumns}
        pagination={true}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        pageSize={pageSize}
        onItemsPerPageChange={handlePageSizeChange}
      />

      <div className="mt-4 flex gap-2">
        <Button
          id='add-interaction-status-button'
          onClick={() => {
            setEditingStatus(null);
            setShowStatusDialog(true);
          }}
          className="bg-primary-500 text-white hover:bg-primary-600"
        >
          <Plus className="h-4 w-4 mr-2" /> Add Status
        </Button>
        <Button
          id='import-interaction-statuses-button'
          onClick={handleImportStatuses}
          variant="outline"
        >
          Import from Standard
        </Button>
      </div>

      {/* Status Dialog */}
      <StatusDialog
        open={showStatusDialog}
        onOpenChange={setShowStatusDialog}
        editingStatus={editingStatus}
        selectedStatusType={STATUS_TYPE}
        userId={userId}
        existingStatuses={statuses}
        onSuccess={async () => {
          await fetchStatuses();
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

export default InteractionStatusSettings;
