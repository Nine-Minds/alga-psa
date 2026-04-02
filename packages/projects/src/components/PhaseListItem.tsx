'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { IProjectPhase } from '@alga-psa/types';
import { Pencil, Trash2, GripVertical, Columns3 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { ProjectTaskStatusSettings } from './settings/projects/ProjectTaskStatusSettings';
import { getProjectStatusMappings } from '../actions/projectTaskStatusActions';
import styles from './ProjectDetail.module.css';

interface PhaseListItemProps {
  phase: IProjectPhase;
  projectId: string;
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
  taskDraggingOverPhaseId?: string | null;
  onDragOver: (e: React.DragEvent, phaseId: string, dropPosition: 'before' | 'after' | '', isOverPhaseItemBody?: boolean) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, phase: IProjectPhase, beforePhaseId: string | null, afterPhaseId: string | null) => void;
  onDragStart: (e: React.DragEvent, phaseId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onStatusesChanged?: () => void;
  phases: IProjectPhase[];
}

export const PhaseListItem: React.FC<PhaseListItemProps> = ({
  phase,
  projectId,
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
  onStatusesChanged,
  phases,
  taskDraggingOverPhaseId,
}) => {
  const { t } = useTranslation('features/projects');
  const [isDragging, setIsDragging] = useState(false);
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [customStatusCount, setCustomStatusCount] = useState<number | null>(null);
  const itemRef = useRef<HTMLLIElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLTextAreaElement>(null);

  // Load phase custom status count when entering edit mode or after dialog closes
  useEffect(() => {
    if (!isEditing && !showStatusDialog) return;
    let cancelled = false;
    getProjectStatusMappings(projectId, phase.phase_id)
      .then((mappings) => { if (!cancelled) setCustomStatusCount(mappings.length); })
      .catch(() => { if (!cancelled) setCustomStatusCount(null); });
    return () => { cancelled = true; };
  }, [isEditing, showStatusDialog, projectId, phase.phase_id]);

  // Auto-scroll the editing form into view when editing starts
  useEffect(() => {
    if (isEditing && itemRef.current) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      requestAnimationFrame(() => {
        const target = actionsRef.current ?? itemRef.current;
        target?.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion ? 'auto' : 'smooth' });

        try { nameInputRef.current?.focus({ preventScroll: true }); }
        catch { nameInputRef.current?.focus(); }
      });
    }
  }, [isEditing]);

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

    const draggedPhaseId = e.dataTransfer.getData('text/plain');

    if (draggedPhaseId === phase.phase_id) {
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
        ${isSelected ? 'bg-purple-50 dark:bg-purple-500/10' : 'hover:bg-gray-50 dark:hover:bg-[rgb(var(--color-border-100))]'}
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phase Name</label>
              <TextArea
                ref={nameInputRef}
                value={editingName}
                onChange={(e) => onNameChange(e.target.value)}
                className="w-full px-3 py-1 border border-gray-200 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            {/* Description Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Phase Description</label>
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Start Date</label>
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-0.5">End Date</label>
              <DatePicker
                value={editingEndDate}
                onChange={(date: Date | undefined) => onEndDateChange?.(date)}
                placeholder="End date"
                className="w-full"
                clearable={true}
              />
            </div>
            {/* Status columns indicator */}
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              <Tooltip content={`${t('phases.statusColumns')}: ${
                customStatusCount != null && customStatusCount > 0
                  ? t('phases.statusColumnsCustom', { count: customStatusCount })
                  : t('phases.statusColumnsProjectDefaults')
              }`}>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                  <Columns3 className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {customStatusCount != null && customStatusCount > 0
                      ? t('phases.statusColumnsCustom', { count: customStatusCount })
                      : t('phases.statusColumnsProjectDefaults')}
                  </span>
                </div>
              </Tooltip>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowStatusDialog(true);
                }}
                className="text-xs text-primary hover:underline shrink-0"
                id={`configure-phase-statuses-${phase.phase_id}`}
              >
                {t('phases.configureStatuses')}
              </button>
            </div>
            <div ref={actionsRef} className={styles.phaseEditActions}>
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
        </div>
      ) : (
        <>
          {/* Drag Handle — absolutely positioned so it doesn't consume layout space */}
          <div className="absolute -left-3 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
            <GripVertical className="w-4 h-4 text-gray-400 dark:text-gray-500" />
          </div>
          {/* Display View */}
          <div className="flex flex-col w-full min-w-0">
            <div className="flex items-start justify-between gap-2">
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100 min-w-0 break-words">{phase.phase_name}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 shrink-0">
                {taskCount ?? 0} {(taskCount ?? 0) === 1 ? 'task' : 'tasks'}
              </span>
            </div>
            {phase.description && (
              <span className="text-sm text-gray-600 dark:text-gray-400 mt-1">{phase.description}</span>
            )}
            <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-1">
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
          {/* Hover Action Buttons — absolutely positioned so they don't consume layout space */}
          <div className="absolute right-2 top-2 flex gap-1 opacity-0 group-hover:opacity-100 bg-inherit rounded">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(phase);
              }}
              className="p-1 rounded hover:bg-gray-200 dark:hover:bg-[rgb(var(--color-border-200))]"
              title="Edit phase"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(phase);
              }}
              className="p-1 rounded hover:bg-destructive/15 text-destructive"
              title="Delete phase"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        </>
      )}

      {showStatusDialog && (
        <Dialog
          isOpen
          onClose={() => { setShowStatusDialog(false); onStatusesChanged?.(); }}
          title={`${t('settings.statuses.project.title')} — ${phase.phase_name}`}
        >
          <ProjectTaskStatusSettings
            projectId={projectId}
            initialPhaseId={phase.phase_id}
          />
          <div className="flex justify-end pt-3 mt-3 border-t">
            <Button
              id={`close-phase-statuses-dialog-${phase.phase_id}`}
              onClick={(e) => {
                e.stopPropagation();
                setShowStatusDialog(false);
                onStatusesChanged?.();
              }}
            >
              {t('common:actions.done', { defaultValue: 'Done' })}
            </Button>
          </div>
        </Dialog>
      )}
    </li>
  );
};

export default PhaseListItem;
