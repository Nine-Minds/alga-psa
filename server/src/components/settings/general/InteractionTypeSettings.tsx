'use client'

import React, { useState, useEffect, useRef } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Plus, X, Edit2, Lock } from "lucide-react";
import { IInteractionType, ISystemInteractionType } from 'server/src/interfaces/interaction.interfaces';
import { 
  getAllInteractionTypes, 
  createInteractionType, 
  updateInteractionType, 
  deleteInteractionType,
  getSystemInteractionTypes 
} from 'server/src/lib/actions/interactionTypeActions';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import CustomSelect from 'server/src/components/ui/CustomSelect';

const InteractionTypesSettings: React.FC = () => {
  const [interactionTypes, setInteractionTypes] = useState<IInteractionType[]>([]);
  const [systemTypes, setSystemTypes] = useState<ISystemInteractionType[]>([]);
  const [newTypeName, setNewTypeName] = useState('');
  const [selectedSystemType, setSelectedSystemType] = useState<string>('');
  const [editingTypeId, setEditingTypeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    typeId: string;
    typeName: string;
  }>({
    isOpen: false,
    typeId: '',
    typeName: ''
  });

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

  const startEditing = (typeId: string, initialValue: string) => {
    setEditingTypeId(typeId);
    setError(null);
    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.value = initialValue;
        editInputRef.current.focus();
      }
    }, 0);
  };

  const cancelEditing = () => {
    setEditingTypeId(null);
    setError(null);
  };

  const handleCreateType = async () => {
    if (newTypeName.trim()) {
      try {
        const typeData = {
          type_name: newTypeName.trim(),
          system_type_id: selectedSystemType || undefined
        };
        
        await createInteractionType(typeData);
        setNewTypeName('');
        setSelectedSystemType('');
        setError(null);
        fetchTypes();
      } catch (error) {
        console.error('Error creating interaction type:', error);
        setError('Failed to create interaction type');
      }
    }
  };

  const handleUpdateType = async (typeId: string) => {
    const newValue = editInputRef.current?.value.trim();
    if (newValue) {
      try {
        await updateInteractionType(typeId, { type_name: newValue });
        setEditingTypeId(null);
        setError(null);
        fetchTypes();
      } catch (error) {
        console.error('Error updating interaction type:', error);
        setError('Failed to update interaction type');
      }
    }
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
      render: (value: string) => (
        <div className="flex items-center space-x-2">
          <Lock className="h-4 w-4 text-gray-400" />
          <span className="text-gray-700 font-medium">{value}</span>
          <span className="text-xs text-gray-400">(System)</span>
        </div>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'type_id',
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
        <div>
          {editingTypeId === record.type_id ? (
            <Input
              ref={editInputRef}
              defaultValue={value}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleUpdateType(record.type_id);
                } else if (e.key === 'Escape') {
                  cancelEditing();
                }
              }}
              className="w-full"
            />
          ) : (
            <div className="flex items-center">
              <span className="text-gray-700">{value}</span>
              {record.system_type_id && (
                <span className="ml-2 text-xs text-gray-400">
                  (Inherits from system type)
                </span>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'type_id',
      render: (_: any, record: IInteractionType) => (
        <div className="flex items-center justify-end space-x-2">
          {editingTypeId === record.type_id ? (
            <>
              <Button 
                id='save-button'
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handleUpdateType(record.type_id);
                }}
              >
                Save
              </Button>
              <Button
                id='cancel-button'
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  cancelEditing();
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          ) : (
            <>
              {!record.system_type_id && (
                <Button
                  id='edit-button'
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditing(record.type_id, record.type_name);
                  }}
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
              )}
              <Button
                id='delete-button'
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteDialog({
                    isOpen: true,
                    typeId: record.type_id,
                    typeName: record.type_name
                  });
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
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
        <div className="flex space-x-2 mt-4">
          <div className="flex-grow space-y-2">
            <Input
              type="text"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="New Interaction Type"
              className="w-full"
            />
            <CustomSelect
              options={[
                { value: 'standalone', label: 'Create as standalone type' },
                ...systemTypes.map((type): { value: string; label: string } => ({
                  value: type.type_id,
                  label: `Inherit from ${type.type_name}`
                }))
              ]}
              value={selectedSystemType || 'standalone'}
              onValueChange={(value) => setSelectedSystemType(value === 'standalone' ? '' : value)}
              placeholder="Optional: Inherit from system type"
            />
          </div>
          <Button 
            id='add-button'
            onClick={handleCreateType} 
            className="bg-primary-500 text-white hover:bg-primary-600 self-start"
          >
            <Plus className="h-4 w-4 mr-2" /> Add
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
    </div>
  );
};

export default InteractionTypesSettings;
