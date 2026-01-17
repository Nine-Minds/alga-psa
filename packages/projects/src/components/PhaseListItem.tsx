'use client';

import { useState, useRef } from 'react';
import { IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { Pencil, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import styles from './ProjectDetail.module.css';

interface PhaseListItemProps {
  phase: IProjectPhase;
  isSelected: boolean;
  isEditing: boolean;
  isAnimating: boolean;
  editingName: string;
  editingDescription: string | null;
  editingStartDate?: Date;
  editingEndDate?: Date;
  taskCount?: number;
  onSelect: (phase: IProjectPhase) => void;
  onEdit: (phase: IProjectPhase) => void;
  onSave: (phase: IProjectPhase) => void;
  onCancel: () => void;
  onDelete: (phase: IProjectPhase) => void;
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string | null) => void;
  onStartDateChange?: (date: Date | undefined) => void;
  onEndDateChange?: (date: Date | undefined) => void;
  taskDraggingOverPhaseId?: string | null; // Added prop
  onDragOver: (e: React.DragEvent, phaseId: string, dropPosition: 'before' | 'after' | '', isOverPhaseItemBody?: boolean) => void; // Updated signature
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, phase: IProjectPhase, beforePhaseId: string | null, afterPhaseId: string | null) => void;
  onDragStart: (e: React.DragEvent, phaseId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  phases: IProjectPhase[]; // Need all phases to calculate before/after
}

export const PhaseListItem: React.FC<PhaseListItemProps> = ({
  phase,
  isSelected,
  isEditing,
  isAnimating,
  editingName,
  editingDescription,
  editingStartDate,
  editingEndDate,
  taskCount,
  onSelect,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onNameChange,
  onDescriptionChange,
  onStartDateChange,
  onEndDateChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  phases,
  taskDraggingOverPhaseId, // Destructure new prop
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const itemRef = useRef<HTMLLIElement>(null);

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', phase.phase_id);
    e.dataTransfer.setData('application/json', JSON.stringify({ type: 'phase', phaseId: phase.phase_id }));
    onDragStart(e, phase.phase_id);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    setIsDragging(false);
    onDragEnd(e);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    
    if (!itemRef.current) return;
    
    const rect = itemRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    const dropZoneThreshold = height * 0.25; // 25% top/bottom for before/after

    const isPhaseBeingDragged = e.dataTransfer.types.includes('application/json');

    if (isPhaseBeingDragged) {
      if (y < dropZoneThreshold) {
        onDragOver(e, phase.phase_id, 'before', false);
      } else if (y > height - dropZoneThreshold) {
        onDragOver(e, phase.phase_id, 'after', false);
      } else {
        // Dragging a phase over the middle of another phase item
        onDragOver(e, phase.phase_id, '', true); // Indicate it's over the body
      }
    } else {
      // Task is being dragged over this phase item
      onDragOver(e, phase.phase_id, '', true); // Indicate it's over the body
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if we're leaving the entire element
    if (e.currentTarget === e.target) {
      onDragLeave();
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    console.log('PhaseListItem handleDrop called for phase:', phase.phase_name);
    
    const draggedPhaseId = e.dataTransfer.getData('text/plain');
    const dropData = e.dataTransfer.getData('application/json');
    
    console.log('PhaseListItem drop data:', { draggedPhaseId, dropData });
    
    if (draggedPhaseId === phase.phase_id) {
      console.log('Cannot drop phase on itself');
      return; // Can't drop on itself
    }
    
    // Get the drop position from the event
    if (!itemRef.current) return;
    
    const rect = itemRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const height = rect.height;
    const isDropBefore = y < height / 2;
    
    // Sort phases to find positions
    const sortedPhases = [...phases].sort((a, b) => {
      // Handle cases where one or both might be missing order_key
      const aKey = a.order_key || 'zzz'; // Put phases without order_key at the end
      const bKey = b.order_key || 'zzz';
      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    });
    
    const targetIndex = sortedPhases.findIndex(p => p.phase_id === phase.phase_id);
    let beforePhaseId: string | null = null;
    let afterPhaseId: string | null = null;
    
    if (targetIndex !== -1) {
      if (isDropBefore) {
        // Dropping before the target phase
        // Find the phase that will be before our dropped phase
        let searchIndex = targetIndex - 1;
        while (searchIndex >= 0) {
          if (sortedPhases[searchIndex].phase_id !== draggedPhaseId) {
            beforePhaseId = sortedPhases[searchIndex].phase_id;
            break;
          }
          searchIndex--;
        }
        
        // The target phase will be after our dropped phase
        if (phase.phase_id !== draggedPhaseId) {
          afterPhaseId = phase.phase_id;
        } else {
          // If dropping on itself, find the next phase
          let nextIndex = targetIndex + 1;
          while (nextIndex < sortedPhases.length) {
            if (sortedPhases[nextIndex].phase_id !== draggedPhaseId) {
              afterPhaseId = sortedPhases[nextIndex].phase_id;
              break;
            }
            nextIndex++;
          }
        }
      } else {
        // Dropping after the target phase
        // The target phase will be before our dropped phase
        if (phase.phase_id !== draggedPhaseId) {
          beforePhaseId = phase.phase_id;
        } else {
          // If dropping on itself, find the previous phase
          let prevIndex = targetIndex - 1;
          while (prevIndex >= 0) {
            if (sortedPhases[prevIndex].phase_id !== draggedPhaseId) {
              beforePhaseId = sortedPhases[prevIndex].phase_id;
              break;
            }
            prevIndex--;
          }
        }
        
        // Find the phase that will be after our dropped phase
        let searchIndex = targetIndex + 1;
        while (searchIndex < sortedPhases.length) {
          if (sortedPhases[searchIndex].phase_id !== draggedPhaseId) {
            afterPhaseId = sortedPhases[searchIndex].phase_id;
            break;
          }
          searchIndex++;
        }
      }
    }
    
    onDrop(e, phase, beforePhaseId, afterPhaseId);
  };

  return (
    <li
      ref={itemRef}
      draggable={!isEditing}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      className={`relative flex items-center justify-between px-3 py-2.5 rounded-md cursor-pointer group
        ${isSelected ? 'bg-purple-50' : 'hover:bg-gray-50'}
        ${isDragging ? styles.dragging + ' opacity-50 scale-95' : ''}
        ${isAnimating ? styles.entering : ''}
        ${taskDraggingOverPhaseId === phase.phase_id ? styles.taskDragOver : ''}
        ${styles.phaseItem}
      `}
      onClick={() => {
        if (!isEditing) {
          onSelect(phase);
        }
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isEditing ? (
        <div className="flex flex-col w-full gap-3">
          <div className="flex-1 min-w-0">
            {/* Phase Name Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Phase Name</label>
              <TextArea
                value={editingName}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full px-3 py-1 border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                onClick={(e) => e.stopPropagation()}
                autoFocus
              />
            </div>
            {/* Description Input - Added */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Phase Description</label>
              <TextArea
                value={editingDescription ?? ''}
                onChange={(e) => onDescriptionChange(e.target.value || null)}
                className="w-full px-3 py-1 border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                placeholder="Description"
                onClick={(e) => e.stopPropagation()}
                rows={2}
              />
            </div>
            {/* Start Date Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700">Start Date</label>
              <DatePicker
                value={editingStartDate}
                onChange={(date: Date | undefined) => onStartDateChange?.(date)}
                placeholder="Start date"
                className="w-full"
                clearable={true}
              />
            </div>
            {/* End Date Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-0.5">End Date</label>
              <DatePicker
                value={editingEndDate}
                onChange={(date: Date | undefined) => onEndDateChange?.(date)}
                placeholder="End date"
                className="w-full"
                clearable={true}
              />
            </div>
          </div>
          {/* Action Buttons  */}
          <div className="flex justify-end gap-2 mt-3">
            <Button
              id={`cancel-edit-phase-${phase.phase_id}`}
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              title="Cancel editing"
            >
              Cancel
            </Button>
            <Button
              id={`save-edit-phase-${phase.phase_id}`}
              variant="default"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onSave(phase);
              }}
              title="Save changes"
            >
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          {/* Drag Handle */}
          <div className="opacity-0 group-hover:opacity-100 transition-opacity cursor-grab pr-2">
            <GripVertical className="w-4 h-4 text-gray-400" />
          </div>
          {/* Display View */}
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="text-lg font-bold text-gray-900">{phase.phase_name}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 shrink-0">
                {taskCount ?? 0} {(taskCount ?? 0) === 1 ? 'task' : 'tasks'}
              </span>
            </div>
            {phase.description && (
              <span className="text-sm text-gray-600 mt-1">{phase.description}</span>
            )}
            <div className="mt-1 text-xs text-gray-500 space-y-1">
              <div>
                Start: {phase.start_date
                  ? new Date(phase.start_date).toLocaleDateString()
                  : 'Not set'}
              </div>
              <div>
                Due: {phase.end_date
                  ? new Date(phase.end_date).toLocaleDateString()
                  : 'Not set'}
              </div>
            </div>
          </div>
          {/* Hover Action Buttons */}
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(phase);
              }}
              className="p-1 rounded hover:bg-gray-200"
              title="Edit phase"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(phase);
              }}
              className="p-1 rounded hover:bg-red-100 text-red-600"
              title="Delete phase"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </>
      )}
    </li>
  );
};

export default PhaseListItem;
