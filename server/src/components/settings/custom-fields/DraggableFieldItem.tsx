'use client';

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MoreVertical, Pencil, Trash2, Eye, EyeOff, FolderOpen } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import { FieldTypeIcon, FieldTypeBadge } from 'server/src/components/ui/FieldTypeIcon';
import { ICustomField, ICustomFieldGroup } from 'server/src/interfaces/customField.interfaces';

interface DraggableFieldItemProps {
  field: ICustomField;
  groups: ICustomFieldGroup[];
  onEdit: (field: ICustomField) => void;
  onDelete: (field: ICustomField) => void;
  onToggleActive: (field: ICustomField) => void;
  isDragging?: boolean;
}

/**
 * Draggable field item for use in DraggableFieldList
 * Supports drag-and-drop reordering with visual feedback
 */
export function DraggableFieldItem({
  field,
  groups,
  onEdit,
  onDelete,
  onToggleActive,
  isDragging: externalIsDragging,
}: DraggableFieldItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.field_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isCurrentlyDragging = isDragging || externalIsDragging;
  const group = field.group_id ? groups.find(g => g.group_id === field.group_id) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg
        ${isCurrentlyDragging ? 'opacity-50 shadow-lg ring-2 ring-primary-500' : 'hover:bg-gray-50'}
        ${!field.is_active ? 'opacity-60' : ''}
        transition-all duration-150
      `}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-gray-600 touch-none"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Field Type Icon */}
      <div className="flex-shrink-0">
        <FieldTypeIcon type={field.type} className="text-gray-500" size={18} />
      </div>

      {/* Field Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-medium text-sm ${!field.is_active ? 'line-through text-gray-400' : 'text-gray-900'}`}>
            {field.name}
          </span>
          {field.is_required && (
            <span className="text-xs text-red-500 font-medium">*</span>
          )}
          {!field.is_active && (
            <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">
              Inactive
            </span>
          )}
        </div>

        {/* Metadata Row */}
        <div className="flex items-center gap-2 mt-1">
          <FieldTypeBadge type={field.type} />

          {group && (
            <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
              <FolderOpen className="w-3 h-3" />
              {group.name}
            </span>
          )}

          {field.conditional_logic && (
            <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">
              <Eye className="w-3 h-3" />
              Conditional
            </span>
          )}
        </div>

        {/* Description */}
        {field.description && (
          <p className="text-xs text-gray-500 mt-1 truncate max-w-md">
            {field.description}
          </p>
        )}
      </div>

      {/* Actions Menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id={`field-actions-${field.field_id}`}
            variant="ghost"
            size="sm"
            className="flex-shrink-0"
          >
            <MoreVertical className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(field)}>
            <Pencil className="w-4 h-4 mr-2" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onToggleActive(field)}>
            {field.is_active ? (
              <>
                <EyeOff className="w-4 h-4 mr-2" />
                Deactivate
              </>
            ) : (
              <>
                <Eye className="w-4 h-4 mr-2" />
                Activate
              </>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-red-600"
            onClick={() => onDelete(field)}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Compact version for use in tight spaces
 */
export function CompactDraggableFieldItem({
  field,
  onEdit,
}: {
  field: ICustomField;
  onEdit: (field: ICustomField) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.field_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`
        flex items-center gap-2 px-2 py-1.5 bg-white border border-gray-200 rounded
        ${isDragging ? 'opacity-50 shadow-md' : 'hover:bg-gray-50'}
        ${!field.is_active ? 'opacity-60' : ''}
        cursor-pointer
      `}
      onClick={() => onEdit(field)}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 touch-none"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3 h-3" />
      </button>

      <FieldTypeIcon type={field.type} className="text-gray-400" size={14} />

      <span className={`text-sm flex-1 truncate ${!field.is_active ? 'text-gray-400' : ''}`}>
        {field.name}
      </span>

      {field.is_required && (
        <span className="text-red-500 text-xs">*</span>
      )}
    </div>
  );
}

export default DraggableFieldItem;
