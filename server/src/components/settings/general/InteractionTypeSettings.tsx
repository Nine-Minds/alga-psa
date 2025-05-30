'use client'

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, Lock, MoreVertical } from "lucide-react";
import { IInteractionType, ISystemInteractionType } from 'server/src/interfaces/interaction.interfaces';
import { 
  getAllInteractionTypes, 
  deleteInteractionType,
  getSystemInteractionTypes 
} from 'server/src/lib/actions/interactionTypeActions';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { QuickAddInteractionType } from './QuickAddInteractionType';
import InteractionIcon from 'server/src/components/ui/InteractionIcon';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
const InteractionTypesSettings: React.FC = () => {
  const [interactionTypes, setInteractionTypes] = useState<IInteractionType[]>([]);
  const [systemTypes, setSystemTypes] = useState<ISystemInteractionType[]>([]);
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

  useEffect(() => {
    fetchTypes();
  }, []);

  const fetchTypes = async () => {
    try {
      const [allTypes, sysTypes] = await Promise.all([
        getAllInteractionTypes(),
        getSystemInteractionTypes()
      ]);
      
      // Filter out system types from allTypes since they'll be displayed separately
      const tenantTypes = allTypes.filter(type => !sysTypes.some(sysType => sysType.type_id === type.type_id));
      
      setInteractionTypes(tenantTypes);
      setSystemTypes(sysTypes);
    } catch (error) {
      console.error('Error fetching types:', error);
      setError('Failed to fetch interaction types');
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

  const systemTypeColumns: ColumnDefinition<ISystemInteractionType>[] = [
    {
      title: 'Name',
      dataIndex: 'type_name',
      render: (value: string, record: ISystemInteractionType) => (
        <div className="flex items-center space-x-2">
          <InteractionIcon icon={record.icon} typeName={record.type_name} />
          <span className="text-gray-700 font-medium">{value}</span>
          <span className="text-xs text-gray-400">(System)</span>
          <Lock className="h-4 w-4 text-gray-400" />
        </div>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'type_id',
      width: '10%',
      render: () => (
        <div className="flex items-center justify-end">
          <span className="text-xs text-gray-400">Read-only</span>
        </div>
      ),
    },
  ];

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

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm space-y-8">
      <div>
        <h3 className="text-lg font-semibold mb-4 text-gray-800">System Interaction Types</h3>
        <DataTable
          data={systemTypes}
          columns={systemTypeColumns}
          pagination={false}
        />
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Custom Interaction Types</h3>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataTable
          data={interactionTypes}
          columns={tenantTypeColumns}
          pagination={false}
        />
        <div className="mt-4">
          <Button 
            id='add-interaction-type-button'
            onClick={() => setShowAddDialog(true)} 
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Interaction Type
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
    </div>
  );
};

export default InteractionTypesSettings;
