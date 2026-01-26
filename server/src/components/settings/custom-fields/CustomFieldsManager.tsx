'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, GripVertical, Trash2, Pencil, FolderOpen, Eye, EyeOff, LayoutList, LayoutGrid } from 'lucide-react';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { DataTable } from 'server/src/components/ui/DataTable';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
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
  ICustomFieldGroup,
  IConditionalLogic,
  ConditionalLogicOperator,
  CustomFieldEntityType,
  CustomFieldType,
  CreateCustomFieldInput,
  UpdateCustomFieldInput,
  IPicklistOption,
  BulkFieldOrderInput,
  FieldGroupDisplayStyle
} from 'server/src/interfaces/customField.interfaces';
import {
  getCustomFieldsByEntity,
  createCustomField,
  updateCustomField,
  deleteCustomField,
  permanentlyDeleteCustomField,
  getCustomFieldGroups,
  createCustomFieldGroup,
  updateCustomFieldGroup,
  deleteCustomFieldGroup,
  bulkUpdateFieldOrder
} from 'server/src/lib/actions/customFieldActions';
import { TabbedFieldGroupsView, CollapsibleFieldGroupsView } from './TabbedFieldGroupsView';

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
  { value: 'picklist', label: 'Picklist (Dropdown)' },
  { value: 'multi_picklist', label: 'Multi-Select Picklist' }
];

const CONDITIONAL_OPERATORS: { value: ConditionalLogicOperator; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Does not equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'is_empty', label: 'Is empty' },
  { value: 'is_not_empty', label: 'Is not empty' }
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
              id={`picklist-option-${index}`}
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
          id="new-picklist-option"
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

interface ConditionalLogicEditorProps {
  condition: IConditionalLogic | null;
  onChange: (condition: IConditionalLogic | null) => void;
  availableFields: ICustomField[];
  currentFieldId?: string;
}

function ConditionalLogicEditor({
  condition,
  onChange,
  availableFields,
  currentFieldId
}: ConditionalLogicEditorProps) {
  const [enabled, setEnabled] = useState(condition !== null);

  // Filter out the current field and fields that already have conditions pointing to this field
  const selectableFields = availableFields.filter(f =>
    f.field_id !== currentFieldId && f.is_active
  );

  const handleToggle = (checked: boolean) => {
    setEnabled(checked);
    if (!checked) {
      onChange(null);
    } else if (selectableFields.length > 0) {
      onChange({
        field_id: selectableFields[0].field_id,
        operator: 'equals',
        value: ''
      });
    }
  };

  const selectedField = condition ? availableFields.find(f => f.field_id === condition.field_id) : null;
  const needsValue = condition && !['is_empty', 'is_not_empty'].includes(condition.operator);

  // Get value options for picklist fields
  const valueOptions = selectedField?.options?.map(opt => ({
    value: opt.value,
    label: opt.label
  })) || [];

  return (
    <div className="space-y-3 border border-gray-200 rounded-md p-3 bg-gray-50">
      <div className="flex items-center gap-3">
        <Switch
          id="conditional-logic-enabled"
          checked={enabled}
          onCheckedChange={handleToggle}
        />
        <div>
          <label className="text-sm font-medium text-gray-700">Conditional Logic</label>
          <p className="text-xs text-gray-500">Show this field only when another field has a specific value</p>
        </div>
      </div>

      {enabled && condition && (
        <div className="space-y-3 pt-2">
          <CustomSelect
            id="conditional-logic-field"
            label="Show when this field"
            options={selectableFields.map(f => ({ value: f.field_id, label: f.name }))}
            value={condition.field_id}
            onValueChange={(value) => onChange({ ...condition, field_id: value, value: '' })}
            placeholder="Select a field..."
          />

          <CustomSelect
            id="conditional-logic-operator"
            label="Condition"
            options={CONDITIONAL_OPERATORS}
            value={condition.operator}
            onValueChange={(value) => onChange({ ...condition, operator: value as ConditionalLogicOperator })}
          />

          {needsValue && (
            selectedField?.type === 'picklist' || selectedField?.type === 'multi_picklist' ? (
              <CustomSelect
                id="conditional-logic-value"
                label="Value"
                options={valueOptions}
                value={condition.value as string || ''}
                onValueChange={(value) => onChange({ ...condition, value })}
                placeholder="Select a value..."
              />
            ) : selectedField?.type === 'boolean' ? (
              <CustomSelect
                id="conditional-logic-value"
                label="Value"
                options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
                value={String(condition.value) || ''}
                onValueChange={(value) => onChange({ ...condition, value: value === 'true' })}
              />
            ) : (
              <Input
                id="conditional-logic-value"
                label="Value"
                value={condition.value as string || ''}
                onChange={(e) => onChange({ ...condition, value: e.target.value })}
                placeholder="Enter value..."
              />
            )
          )}

          {selectableFields.length === 0 && (
            <p className="text-xs text-amber-600">Create other fields first to use conditional logic</p>
          )}
        </div>
      )}
    </div>
  );
}

type ViewMode = 'table' | 'drag-drop';

export function CustomFieldsManager() {
  const [selectedEntityType, setSelectedEntityType] = useState<CustomFieldEntityType>('ticket');
  const [fields, setFields] = useState<ICustomField[]>([]);
  const [groups, setGroups] = useState<ICustomFieldGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showGroupDialog, setShowGroupDialog] = useState(false);
  const [editingField, setEditingField] = useState<ICustomField | null>(null);
  const [editingGroup, setEditingGroup] = useState<ICustomFieldGroup | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    fieldId: string;
    fieldName: string;
    permanent: boolean;
  }>({ isOpen: false, fieldId: '', fieldName: '', permanent: false });
  const [deleteGroupDialog, setDeleteGroupDialog] = useState<{
    isOpen: boolean;
    groupId: string;
    groupName: string;
  }>({ isOpen: false, groupId: '', groupName: '' });
  const [viewMode, setViewMode] = useState<ViewMode>('drag-drop');
  const [defaultGroupId, setDefaultGroupId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<{
    name: string;
    type: CustomFieldType;
    description: string;
    is_required: boolean;
    options: IPicklistOption[];
    conditional_logic: IConditionalLogic | null;
    group_id: string | null;
  }>({
    name: '',
    type: 'text',
    description: '',
    is_required: false,
    options: [],
    conditional_logic: null,
    group_id: null
  });

  // Group form state
  const [groupFormData, setGroupFormData] = useState<{
    name: string;
    description: string;
    is_collapsed_by_default: boolean;
    display_style: FieldGroupDisplayStyle;
    icon: string | null;
  }>({
    name: '',
    description: '',
    is_collapsed_by_default: false,
    display_style: 'collapsible',
    icon: null
  });

  const fetchFields = useCallback(async () => {
    try {
      setLoading(true);
      const [fieldsData, groupsData] = await Promise.all([
        getCustomFieldsByEntity(selectedEntityType, true),
        getCustomFieldGroups(selectedEntityType)
      ]);
      setFields(fieldsData);
      setGroups(groupsData);
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
      options: [],
      conditional_logic: null,
      group_id: null
    });
  };

  const resetGroupForm = () => {
    setGroupFormData({
      name: '',
      description: '',
      is_collapsed_by_default: false,
      display_style: 'collapsible',
      icon: null
    });
  };

  const openAddDialog = (groupId?: string | null) => {
    resetForm();
    setEditingField(null);
    // If groupId is provided, pre-select it in the form
    if (groupId !== undefined) {
      setFormData(prev => ({ ...prev, group_id: groupId }));
    }
    setShowAddDialog(true);
  };

  // Handle bulk reorder from drag-drop
  const handleReorder = async (reorderedFields: BulkFieldOrderInput[]) => {
    try {
      await bulkUpdateFieldOrder(selectedEntityType, reorderedFields);
      // Refresh to get updated order
      fetchFields();
    } catch (error) {
      console.error('Error reordering fields:', error);
      toast.error('Failed to reorder fields');
      throw error; // Re-throw so the UI can handle it
    }
  };

  const openEditDialog = (field: ICustomField) => {
    setFormData({
      name: field.name,
      type: field.type,
      description: field.description || '',
      is_required: field.is_required,
      options: field.options || [],
      conditional_logic: field.conditional_logic || null,
      group_id: field.group_id || null
    });
    setEditingField(field);
    setShowAddDialog(true);
  };

  const openAddGroupDialog = () => {
    resetGroupForm();
    setEditingGroup(null);
    setShowGroupDialog(true);
  };

  const openEditGroupDialog = (group: ICustomFieldGroup) => {
    setGroupFormData({
      name: group.name,
      description: group.description || '',
      is_collapsed_by_default: group.is_collapsed_by_default,
      display_style: group.display_style || 'collapsible',
      icon: group.icon || null
    });
    setEditingGroup(group);
    setShowGroupDialog(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Field name is required');
      return;
    }

    const isPicklistType = formData.type === 'picklist' || formData.type === 'multi_picklist';
    if (isPicklistType && formData.options.length === 0) {
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
          options: isPicklistType ? formData.options : undefined,
          conditional_logic: formData.conditional_logic,
          group_id: formData.group_id
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
          options: isPicklistType ? formData.options : undefined,
          conditional_logic: formData.conditional_logic,
          group_id: formData.group_id
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

  const handleSaveGroup = async () => {
    if (!groupFormData.name.trim()) {
      toast.error('Group name is required');
      return;
    }

    try {
      if (editingGroup) {
        await updateCustomFieldGroup(editingGroup.group_id, {
          name: groupFormData.name.trim(),
          description: groupFormData.description.trim() || undefined,
          is_collapsed_by_default: groupFormData.is_collapsed_by_default,
          display_style: groupFormData.display_style,
          icon: groupFormData.icon
        });
        toast.success('Group updated');
      } else {
        await createCustomFieldGroup({
          entity_type: selectedEntityType,
          name: groupFormData.name.trim(),
          description: groupFormData.description.trim() || undefined,
          is_collapsed_by_default: groupFormData.is_collapsed_by_default,
          display_style: groupFormData.display_style,
          icon: groupFormData.icon
        });
        toast.success('Group created');
      }

      setShowGroupDialog(false);
      resetGroupForm();
      fetchFields();
    } catch (error) {
      console.error('Error saving group:', error);
      toast.error('Failed to save group');
    }
  };

  const handleDeleteGroup = async () => {
    try {
      await deleteCustomFieldGroup(deleteGroupDialog.groupId);
      toast.success('Group deleted');
      setDeleteGroupDialog({ isOpen: false, groupId: '', groupName: '' });
      fetchFields();
    } catch (error) {
      console.error('Error deleting group:', error);
      toast.error('Failed to delete group');
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
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={record.is_active ? '' : 'text-gray-400 line-through'}>{value}</span>
            {record.is_required && (
              <span className="text-xs text-red-500">*Required</span>
            )}
            {!record.is_active && (
              <span className="text-xs bg-gray-200 text-gray-600 px-1 rounded">Inactive</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {record.group_id && (
              <span className="text-xs bg-blue-100 text-blue-700 px-1 rounded flex items-center gap-1">
                <FolderOpen className="w-3 h-3" />
                {groups.find(g => g.group_id === record.group_id)?.name || 'Group'}
              </span>
            )}
            {record.conditional_logic && (
              <span className="text-xs bg-purple-100 text-purple-700 px-1 rounded flex items-center gap-1">
                <Eye className="w-3 h-3" />
                Conditional
              </span>
            )}
          </div>
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
        <div className="flex items-center gap-2">
          <Button
            id="view-mode-toggle"
            variant={viewMode === 'drag-drop' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setViewMode(viewMode === 'drag-drop' ? 'table' : 'drag-drop')}
            title={viewMode === 'drag-drop' ? 'Switch to table view' : 'Switch to drag-drop view'}
          >
            {viewMode === 'drag-drop' ? (
              <>
                <LayoutGrid className="w-4 h-4 mr-1" />
                Grouped View
              </>
            ) : (
              <>
                <LayoutList className="w-4 h-4 mr-1" />
                Table View
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Entity Type Tabs */}
      <div className="flex gap-2 border-b border-gray-200" role="tablist">
        {ENTITY_TYPES.map((entityType) => (
          <button
            key={entityType.value}
            id={`custom-fields-tab-${entityType.value}`}
            role="tab"
            aria-selected={selectedEntityType === entityType.value}
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

      {/* Content based on view mode */}
      {loading ? (
        <div className="flex justify-center py-8" role="status" aria-label="Loading custom fields">
          <LoadingIndicator text="Loading custom fields..." />
        </div>
      ) : viewMode === 'drag-drop' ? (
        /* Drag-Drop Grouped View */
        <TabbedFieldGroupsView
          entityType={selectedEntityType}
          fields={fields}
          groups={groups}
          onReorder={handleReorder}
          onEditField={openEditDialog}
          onDeleteField={(field) => setDeleteDialog({
            isOpen: true,
            fieldId: field.field_id,
            fieldName: field.name,
            permanent: true
          })}
          onToggleFieldActive={handleToggleActive}
          onAddField={openAddDialog}
          onEditGroup={openEditGroupDialog}
          onDeleteGroup={(group) => setDeleteGroupDialog({
            isOpen: true,
            groupId: group.group_id,
            groupName: group.name
          })}
          onAddGroup={openAddGroupDialog}
        />
      ) : (
        /* Table View (Legacy) */
        <>
          {/* Groups Section */}
          {groups.length > 0 && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700">Field Groups</h3>
                <Button id="add-field-group" variant="outline" size="sm" onClick={openAddGroupDialog}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Group
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {groups.map(group => (
                  <div
                    key={group.group_id}
                    className="flex items-center gap-2 bg-white border border-gray-200 rounded px-3 py-1"
                  >
                    <FolderOpen className="w-4 h-4 text-blue-500" />
                    <span className="text-sm">{group.name}</span>
                    <button
                      onClick={() => openEditGroupDialog(group)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setDeleteGroupDialog({
                        isOpen: true,
                        groupId: group.group_id,
                        groupName: group.name
                      })}
                      className="text-gray-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Buttons */}
          <div className="flex justify-end gap-2">
            {groups.length === 0 && (
              <Button id="add-field-group" variant="outline" onClick={openAddGroupDialog}>
                <FolderOpen className="w-4 h-4 mr-2" />
                Add Group
              </Button>
            )}
            <Button id="add-custom-field" onClick={() => openAddDialog()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Custom Field
            </Button>
          </div>

          {/* Fields Table */}
          {fields.length === 0 ? (
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
        </>
      )}

      {/* Add/Edit Dialog */}
      <Dialog isOpen={showAddDialog} onClose={() => setShowAddDialog(false)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingField ? 'Edit Custom Field' : 'Add Custom Field'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Input
              id="custom-field-name"
              label="Field Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Contract Tier, VIP Status"
              required
            />

            <CustomSelect
              id="custom-field-type"
              label="Field Type"
              options={FIELD_TYPES}
              value={formData.type}
              onValueChange={(value) => setFormData({
                ...formData,
                type: value as CustomFieldType,
                options: (value === 'picklist' || value === 'multi_picklist') ? formData.options : []
              })}
            />

            {(formData.type === 'picklist' || formData.type === 'multi_picklist') && (
              <PicklistOptionEditor
                options={formData.options}
                onChange={(options) => setFormData({ ...formData, options })}
              />
            )}

            <TextArea
              id="custom-field-description"
              label="Description (optional)"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Help text shown to users"
              rows={2}
            />

            {groups.length > 0 && (
              <CustomSelect
                id="custom-field-group"
                label="Field Group (optional)"
                options={[
                  { value: '', label: 'No group' },
                  ...groups.map(g => ({ value: g.group_id, label: g.name }))
                ]}
                value={formData.group_id || ''}
                onValueChange={(value) => setFormData({ ...formData, group_id: value || null })}
                placeholder="Select a group..."
                allowClear
              />
            )}

            <div className="flex items-center gap-3">
              <Switch
                id="custom-field-required"
                checked={formData.is_required}
                onCheckedChange={(checked) => setFormData({ ...formData, is_required: checked })}
              />
              <div>
                <label className="text-sm font-medium text-gray-700">Required Field</label>
                <p className="text-xs text-gray-500">Users must fill this field when creating/editing</p>
              </div>
            </div>

            {/* Conditional Logic Editor */}
            <ConditionalLogicEditor
              condition={formData.conditional_logic}
              onChange={(condition) => setFormData({ ...formData, conditional_logic: condition })}
              availableFields={fields}
              currentFieldId={editingField?.field_id}
            />
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

      {/* Add/Edit Group Dialog */}
      <Dialog isOpen={showGroupDialog} onClose={() => setShowGroupDialog(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingGroup ? 'Edit Field Group' : 'Add Field Group'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <Input
              id="group-name"
              label="Group Name"
              value={groupFormData.name}
              onChange={(e) => setGroupFormData({ ...groupFormData, name: e.target.value })}
              placeholder="e.g., Contact Info, Billing Details"
              required
            />

            <TextArea
              id="group-description"
              label="Description (optional)"
              value={groupFormData.description}
              onChange={(e) => setGroupFormData({ ...groupFormData, description: e.target.value })}
              placeholder="Brief description of this group"
              rows={2}
            />

            <CustomSelect
              id="group-display-style"
              label="Display Style"
              options={[
                { value: 'collapsible', label: 'Collapsible Section' },
                { value: 'tab', label: 'Tab (Halo-style)' },
                { value: 'section', label: 'Always Visible Section' }
              ]}
              value={groupFormData.display_style}
              onValueChange={(value) => setGroupFormData({ ...groupFormData, display_style: value as FieldGroupDisplayStyle })}
            />

            <div className="flex items-center gap-3">
              <Switch
                id="group-collapsed"
                checked={groupFormData.is_collapsed_by_default}
                onCheckedChange={(checked) => setGroupFormData({ ...groupFormData, is_collapsed_by_default: checked })}
              />
              <div>
                <label className="text-sm font-medium text-gray-700">Collapsed by Default</label>
                <p className="text-xs text-gray-500">Group will be collapsed when forms load (for collapsible style)</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button id="cancel-group-dialog" variant="outline" onClick={() => setShowGroupDialog(false)}>
              Cancel
            </Button>
            <Button id="save-group" onClick={handleSaveGroup}>
              {editingGroup ? 'Save Changes' : 'Create Group'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Field Confirmation */}
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

      {/* Delete Group Confirmation */}
      <ConfirmationDialog
        id="delete-group-dialog"
        isOpen={deleteGroupDialog.isOpen}
        onClose={() => setDeleteGroupDialog({ isOpen: false, groupId: '', groupName: '' })}
        onConfirm={handleDeleteGroup}
        title="Delete Field Group"
        message={`Are you sure you want to delete "${deleteGroupDialog.groupName}"? Fields in this group will become ungrouped.`}
        confirmLabel="Delete Group"
      />
    </div>
  );
}

export default CustomFieldsManager;
