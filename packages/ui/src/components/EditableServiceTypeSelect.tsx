'use client';

import React, { useState, useEffect } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import { Label } from './Label';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import * as Select from '@radix-ui/react-select';
import { ChevronDown } from 'lucide-react';

interface ServiceType {
  id: string;
  name: string;
  billing_method: 'fixed' | 'hourly' | 'usage' | 'per_unit';
  is_standard?: boolean;
}

interface EditableServiceTypeSelectProps {
  value: string;
  onChange: (value: string) => void;
  serviceTypes: ServiceType[];
  onCreateType: (name: string) => Promise<void>;
  onUpdateType: (id: string, name: string) => Promise<void>;
  onDeleteType: (id: string) => Promise<void>;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
}

export function EditableServiceTypeSelect({
  value,
  onChange,
  serviceTypes,
  onCreateType,
  onUpdateType,
  onDeleteType,
  className = '',
  placeholder = 'Select service type...',
  disabled = false,
  label,
}: EditableServiceTypeSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [newTypeName, setNewTypeName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const selectedType = serviceTypes.find(t => t.id === value);

  const handleStartEdit = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editingName.trim()) return;

    setIsSaving(true);
    try {
      await onUpdateType(editingId, editingName.trim());
      setEditingId(null);
      setEditingName('');
    } catch (error) {
      console.error('Error updating service type:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this service type?')) return;

    setIsSaving(true);
    try {
      await onDeleteType(id);
      // If the deleted type was selected, clear the selection
      if (value === id) {
        onChange('');
      }
    } catch (error) {
      console.error('Error deleting service type:', error);
      alert('Cannot delete this service type. It may be in use by existing services.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartAdd = () => {
    setIsAdding(true);
    setNewTypeName('');
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setNewTypeName('');
  };

  const handleSaveAdd = async () => {
    if (!newTypeName.trim()) return;

    setIsSaving(true);
    try {
      await onCreateType(newTypeName.trim());
      setIsAdding(false);
      setNewTypeName('');
    } catch (error) {
      console.error('Error creating service type:', error);
      alert('Failed to create service type. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, action: 'edit' | 'add') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (action === 'edit') {
        handleSaveEdit();
      } else {
        handleSaveAdd();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (action === 'edit') {
        handleCancelEdit();
      } else {
        handleCancelAdd();
      }
    }
  };

  return (
    <div className={className}>
      {label && (
        <Label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </Label>
      )}
      <Select.Root
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        open={isOpen}
        onOpenChange={setIsOpen}
      >
        <Select.Trigger
          className="inline-flex items-center justify-between w-full px-3 py-2 text-sm bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none disabled:bg-gray-100 disabled:cursor-not-allowed"
          disabled={disabled}
        >
          <Select.Value placeholder={placeholder}>
            {selectedType?.name || placeholder}
          </Select.Value>
          <Select.Icon>
            <ChevronDown className="h-4 w-4" />
          </Select.Icon>
        </Select.Trigger>

        <Select.Portal>
          <Select.Content
            className="bg-white rounded-md shadow-lg border border-gray-200 z-50"
            position="popper"
            sideOffset={5}
          >
            <div
              className="max-h-60 overflow-y-auto p-1"
              onWheel={(e) => {
                e.stopPropagation();
              }}
            >
              {serviceTypes.map((type) => (
                <div key={type.id}>
                  {editingId === type.id ? (
                    // Editing mode
                    <div className="flex items-center gap-1 px-2 py-1">
                      <Input
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, 'edit')}
                        className="flex-1 h-8 text-sm"
                        autoFocus
                        disabled={isSaving}
                      />
                      <Button
                        id={`save-edit-service-type-${type.id}`}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={handleSaveEdit}
                        disabled={isSaving || !editingName.trim()}
                      >
                        <Check className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button
                        id={`cancel-edit-service-type-${type.id}`}
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={handleCancelEdit}
                        disabled={isSaving}
                      >
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  ) : (
                    // Display mode with select and action buttons
                    <div className="flex items-center justify-between group">
                      <Select.Item
                        value={type.id}
                        className="flex-1 relative flex items-center px-8 py-2 text-sm outline-none cursor-pointer select-none hover:bg-gray-100 data-[highlighted]:bg-gray-100"
                      >
                        <Select.ItemText>{type.name}</Select.ItemText>
                      </Select.Item>
                      <div className="flex items-center gap-1 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          id={`start-edit-service-type-${type.id}`}
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartEdit(type.id, type.name);
                          }}
                          disabled={isSaving}
                        >
                          <Pencil className="h-3 w-3 text-gray-600" />
                        </Button>
                        <Button
                          id={`delete-service-type-${type.id}`}
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(type.id);
                          }}
                          disabled={isSaving}
                        >
                          <Trash2 className="h-3 w-3 text-red-600" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Separator before add button */}
              {serviceTypes.length > 0 && (
                <Select.Separator className="h-px bg-gray-200 my-1" />
              )}

              {/* Add new service type */}
              {isAdding ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <Input
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    onKeyDown={(e) => handleKeyDown(e, 'add')}
                    className="flex-1 h-8 text-sm"
                    placeholder="New service type name..."
                    autoFocus
                    disabled={isSaving}
                  />
                  <Button
                    id="save-new-service-type-button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleSaveAdd}
                    disabled={isSaving || !newTypeName.trim()}
                  >
                    <Check className="h-4 w-4 text-green-600" />
                  </Button>
                  <Button
                    id="cancel-new-service-type-button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0"
                    onClick={handleCancelAdd}
                    disabled={isSaving}
                  >
                    <X className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              ) : (
                <button
                  className="w-full flex items-center gap-2 px-8 py-2 text-sm text-primary-600 hover:bg-primary-50 cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleStartAdd();
                  }}
                  disabled={isSaving}
                >
                  <Plus className="h-4 w-4" />
                  Add new service type
                </button>
              )}
            </div>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
