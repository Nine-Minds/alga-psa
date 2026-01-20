'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, GripVertical, Trash2, Pencil } from 'lucide-react';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { TextArea } from 'server/src/components/ui/TextArea';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import { toast } from 'react-hot-toast';
import {
  ICustomField,
  CustomFieldEntityType,
  CustomFieldType,
  CreateCustomFieldInput,
  UpdateCustomFieldInput,
  IPicklistOption
} from 'server/src/interfaces/customField.interfaces';
import {
  getCustomFieldsByEntity,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  permanentlyDeleteCustomField
} from 'server/src/lib/actions/customFieldActions';

const ENTITY_TYPES: { value: CustomFieldEntityType; label: string }[] = [
  { value: 'ticket', label: 'Tickets' },
  { value: 'company', label: 'Accounts' },
  { value: 'contact', label: 'Contacts' }
];

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'boolean', label: 'Yes/No (Checkbox)' },
  { value: 'picklist', label: 'Picklist (Dropdown)' }
];

interface PicklistOptionEditorProps {
  options: IPicklistOption[];
  onChange: (options: IPicklistOption[]) => void;
}

function PicklistOptionEditor({ options, onChange }: PicklistOptionEditorProps) {
  const [newOptionLabel, setNewOptionLabel] = useState('');

  const addOption = () => {
    if (!newOptionLabel.trim()) return;

    const newOption: IPicklistOption = {
      value: newOptionLabel.trim().toLowerCase().replace(/\s+/g, '_'),
      label: newOptionLabel.trim(),
      order: options.length
    };

    onChange([...options, newOption]);
    setNewOptionLabel('');
  };

  const removeOption = (index: number) => {
    const newOptions = options.filter((_, i) => i !== index);
    // Reorder
    onChange(newOptions.map((opt, i) => ({ ...opt, order: i })));
  };

  const updateOption = (index: number, label: string) => {
    const newOptions = [...options];
    newOptions[index] = {
      ...newOptions[index],
      label,
      value: label.trim().toLowerCase().replace(/\s+/g, '_')
    };
    onChange(newOptions);
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">Picklist Options</label>
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {options.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={option.label}
              onChange={(e) => updateOption(index, e.target.value)}
              className="flex-1"
              containerClassName="mb-0 flex-1"
            />
            <Button
              id={`remove-picklist-option-${index}`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeOption(index)}
              className="text-red-500 hover:text-red-700"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={newOptionLabel}
          onChange={(e) => setNewOptionLabel(e.target.value)}
          placeholder="Add new option..."
          className="flex-1"
          containerClassName="mb-0 flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOption();
            }
          }}
        />
        <Button id="add-picklist-option" type="button" variant="outline" size="sm" onClick={addOption}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {options.length === 0 && (
        <p className="text-xs text-amber-600">Add at least one option for the picklist</p>
      )}
    </div>
  );
}

export function CustomFieldsManager() {
  const [selectedEntityType, setSelectedEntityType] = useState<CustomFieldEntityType>('ticket');
  const [fields, setFields] = useState<ICustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingField, setEditingField] = useState<ICustomField | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    fieldId: string;
    fieldName: string;
    permanent: boolean;
  }>({ isOpen: false, fieldId: '', fieldName: '', permanent: false });

  // Form state
  const [formData, setFormData] = useState<{
    name: string;
    type: CustomFieldType;
    description: string;
    is_required: boolean;
    options: IPicklistOption[];
  }>({
    name: '',
    type: 'text',
    description: '',
    is_required: false,
    options: []
  });

  const fetchFields = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getCustomFieldsByEntity(selectedEntityType, true);
      setFields(data);
    } catch (error) {
      console.error('Error fetching custom fields:', error);
      toast.error('Failed to load custom fields');
    } finally {
      setLoading(false);
    }
  }, [selectedEntityType]);

  useEffect(() => {
    fetchFields();
  }, [fetchFields]);

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'text',
      description: '',
      is_required: false,
      options: []
    });
  };

  const openAddDialog = () => {
    resetForm();
    setEditingField(null);
    setShowAddDialog(true);
  };

  const openEditDialog = (field: ICustomField) => {
    setFormData({
      name: field.name,
      type: field.type,
      description: field.description || '',
      is_required: field.is_required,
      options: field.options || []
    });
    setEditingField(field);
    setShowAddDialog(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Field name is required');
      return;
    }

    if (formData.type === 'picklist' && formData.options.length === 0) {
      toast.error('Picklist fields require at least one option');
      return;
    }

    try {
      if (editingField) {
        // Update existing field
        const updateData: UpdateCustomFieldInput = {
          name: formData.name.trim(),
          type: formData.type,
          description: formData.description.trim() || undefined,
          is_required: formData.is_required,
          options: formData.type === 'picklist' ? formData.options : undefined
        };
        await updateCustomField(editingField.field_id, updateData);
        toast.success('Custom field updated');
      } else {
        // Create new field
        const createData: CreateCustomFieldInput = {
          entity_type: selectedEntityType,
          name: formData.name.trim(),
          type: formData.type,
          description: formData.description.trim() || undefined,
          is_required: formData.is_required,
          options: formData.type === 'picklist' ? formData.options : undefined
        };
        await createCustomField(createData);
        toast.success('Custom field created');
      }

      setShowAddDialog(false);
      resetForm();
      fetchFields();
    } catch (error) {
      console.error('Error saving custom field:', error);
      toast.error('Failed to save custom field');
    }
  };

  const handleDelete = async () => {
    try {
      if (deleteDialog.permanent) {
        await permanentlyDeleteCustomField(deleteDialog.fieldId);
        toast.success('Custom field permanently deleted');
      } else {
        await deleteCustomField(deleteDialog.fieldId);
        toast.success('Custom field deactivated');
      }
      setDeleteDialog({ isOpen: false, fieldId: '', fieldName: '', permanent: false });
      fetchFields();
    } catch (error) {
      console.error('Error deleting custom field:', error);
      toast.error('Failed to delete custom field');
    }
  };

  const handleToggleActive = async (field: ICustomField) => {
    try {
      await updateCustomField(field.field_id, { is_active: !field.is_active });
      toast.success(field.is_active ? 'Field deactivated' : 'Field activated');
      fetchFields();
    } catch (error) {
      console.error('Error toggling field status:', error);
      toast.error('Failed to update field status');
    }
  };

  const columns: ColumnDefinition<ICustomField>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      render: (value: string, record: ICustomField) => (
        <div className="flex items-center gap-2">
          <span className={record.is_active ? '' : 'text-gray-400 line-through'}>{value}</span>
          {record.is_required && (
            <span className="text-xs text-red-500">*Required</span>
          )}
          {!record.is_active && (
            <span className="text-xs bg-gray-200 text-gray-600 px-1 rounded">Inactive</span>
          )}
        </div>
      )
    },
    {
      title: 'Type',
      dataIndex: 'type',
      render: (value: CustomFieldType) => {
        const typeLabel = FIELD_TYPES.find(t => t.value === value)?.label || value;
        return <span className="text-sm text-gray-600">{typeLabel}</span>;
      }
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value: string) => (
        <span className="text-sm text-gray-500 truncate max-w-[200px] block">
          {value || '-'}
        </span>
      )
    },
    {
      title: 'Actions',
      dataIndex: 'field_id',
      render: (_: string, record: ICustomField) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id={`field-actions-${record.field_id}`} variant="ghost" size="sm">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openEditDialog(record)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleToggleActive(record)}>
              {record.is_active ? 'Deactivate' : 'Activate'}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-600"
              onClick={() => setDeleteDialog({
                isOpen: true,
                fieldId: record.field_id,
                fieldName: record.name,
                permanent: true
              })}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Permanently
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Custom Fields</h2>
          <p className="text-sm text-gray-500 mt-1">
            Define custom fields to capture additional data on tickets, accounts, and contacts.
            Use required fields sparingly to avoid form friction.
          </p>
        </div>
      </div>

      {/* Entity Type Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {ENTITY_TYPES.map((entityType) => (
          <button
            key={entityType.value}
            onClick={() => setSelectedEntityType(entityType.value)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              selectedEntityType === entityType.value
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {entityType.label}
          </button>
        ))}
      </div>

      {/* Add Button */}
      <div className="flex justify-end">
        <Button id="add-custom-field" onClick={openAddDialog}>
          <Plus className="w-4 h-4 mr-2" />
          Add Custom Field
        </Button>
      </div>

      {/* Fields Table */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"></div>
        </div>
      ) : fields.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No custom fields defined for {ENTITY_TYPES.find(e => e.value === selectedEntityType)?.label}.</p>
          <p className="text-sm mt-1">Click "Add Custom Field" to create one.</p>
        </div>
      ) : (
        <DataTable
          data={fields}
          columns={columns}
          pagination={false}
        />
      )}

      {/* Add/Edit Dialog */}
      <Dialog isOpen={showAddDialog} onClose={() => setShowAddDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingField ? 'Edit Custom Field' : 'Add Custom Field'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Input
              label="Field Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Contract Tier, VIP Status"
              required
            />

            <CustomSelect
              label="Field Type"
              options={FIELD_TYPES}
              value={formData.type}
              onValueChange={(value) => setFormData({
                ...formData,
                type: value as CustomFieldType,
                options: value === 'picklist' ? formData.options : []
              })}
            />

            {formData.type === 'picklist' && (
              <PicklistOptionEditor
                options={formData.options}
                onChange={(options) => setFormData({ ...formData, options })}
              />
            )}

            <TextArea
              label="Description (optional)"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Help text shown to users"
              rows={2}
            />

            <div className="flex items-center gap-3">
              <Switch
                checked={formData.is_required}
                onCheckedChange={(checked) => setFormData({ ...formData, is_required: checked })}
              />
              <div>
                <label className="text-sm font-medium text-gray-700">Required Field</label>
                <p className="text-xs text-gray-500">Users must fill this field when creating/editing</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button id="cancel-custom-field-dialog" variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button id="save-custom-field" onClick={handleSave}>
              {editingField ? 'Save Changes' : 'Create Field'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmationDialog
        id="delete-custom-field-dialog"
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, fieldId: '', fieldName: '', permanent: false })}
        onConfirm={handleDelete}
        title="Delete Custom Field"
        message={
          deleteDialog.permanent
            ? `Are you sure you want to permanently delete "${deleteDialog.fieldName}"? This will remove the field definition but existing values will be preserved in the data.`
            : `Are you sure you want to deactivate "${deleteDialog.fieldName}"? The field will be hidden from forms but data will be preserved.`
        }
        confirmLabel={deleteDialog.permanent ? 'Delete Permanently' : 'Deactivate'}
      />
    </div>
  );
}

export default CustomFieldsManager;
