'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { DraggableFieldItem, CompactDraggableFieldItem } from './DraggableFieldItem';
import { ICustomField, ICustomFieldGroup, BulkFieldOrderInput } from 'server/src/interfaces/customField.interfaces';

interface DraggableFieldListProps {
  fields: ICustomField[];
  groups: ICustomFieldGroup[];
  onReorder: (reorderedFields: BulkFieldOrderInput[]) => Promise<void>;
  onEdit: (field: ICustomField) => void;
  onDelete: (field: ICustomField) => void;
  onToggleActive: (field: ICustomField) => void;
  groupId?: string | null;
  compact?: boolean;
}

/**
 * Draggable list of custom fields with reordering support
 * Uses @dnd-kit for accessible drag-and-drop
 */
export function DraggableFieldList({
  fields,
  groups,
  onReorder,
  onEdit,
  onDelete,
  onToggleActive,
  groupId,
  compact = false,
}: DraggableFieldListProps) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [localFields, setLocalFields] = useState<ICustomField[]>(fields);

  // Update local fields when props change
  React.useEffect(() => {
    setLocalFields(fields);
  }, [fields]);

  // Filter fields by group
  const filteredFields = useMemo(() => {
    if (groupId === undefined) {
      return localFields;
    }
    return localFields.filter(f => f.group_id === groupId);
  }, [localFields, groupId]);

  // Sort fields by field_order
  const sortedFields = useMemo(() => {
    return [...filteredFields].sort((a, b) => a.field_order - b.field_order);
  }, [filteredFields]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id);
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = sortedFields.findIndex((f) => f.field_id === active.id);
    const newIndex = sortedFields.findIndex((f) => f.field_id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Optimistically reorder locally
    const newOrder = arrayMove(sortedFields, oldIndex, newIndex);
    setLocalFields(prev => {
      // Update the order of filtered fields while keeping others unchanged
      const otherFields = prev.filter(f => {
        if (groupId === undefined) return false;
        return f.group_id !== groupId;
      });
      return [...otherFields, ...newOrder.map((f, i) => ({ ...f, field_order: i }))];
    });

    // Create reorder payload
    const reorderPayload: BulkFieldOrderInput[] = newOrder.map((field, index) => ({
      fieldId: field.field_id,
      order: index,
      groupId: field.group_id,
    }));

    try {
      await onReorder(reorderPayload);
    } catch (error) {
      // Revert on error
      setLocalFields(fields);
      console.error('Failed to reorder fields:', error);
    }
  }, [sortedFields, groupId, onReorder, fields]);

  const activeField = activeId ? sortedFields.find((f) => f.field_id === activeId) : null;

  if (sortedFields.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
        <p className="text-sm">No fields in this group</p>
        <p className="text-xs mt-1">Drag fields here or create a new one</p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={sortedFields.map((f) => f.field_id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={`space-y-${compact ? '1' : '2'}`}>
          {sortedFields.map((field) => (
            compact ? (
              <CompactDraggableFieldItem
                key={field.field_id}
                field={field}
                onEdit={onEdit}
              />
            ) : (
              <DraggableFieldItem
                key={field.field_id}
                field={field}
                groups={groups}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleActive={onToggleActive}
              />
            )
          ))}
        </div>
      </SortableContext>

      {/* Drag Overlay for visual feedback */}
      <DragOverlay>
        {activeField ? (
          <div className="opacity-80">
            {compact ? (
              <CompactDraggableFieldItem
                field={activeField}
                onEdit={() => {}}
              />
            ) : (
              <DraggableFieldItem
                field={activeField}
                groups={groups}
                onEdit={() => {}}
                onDelete={() => {}}
                onToggleActive={() => {}}
                isDragging
              />
            )}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default DraggableFieldList;
