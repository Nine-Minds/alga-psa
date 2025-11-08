'use client';

import { useState, useRef, useEffect } from 'react';
import { IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { IProjectPhaseComment } from 'server/src/interfaces';
import { Pencil, Trash2, GripVertical } from 'lucide-react';
import { Button } from '../ui/Button';
import { TextArea } from '../ui/TextArea';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import styles from './ProjectDetail.module.css';
import PhaseComments from './PhaseComments';
import { getPhaseComments, addPhaseComment, updatePhaseComment, deletePhaseComment, getCommentUserMap } from 'server/src/lib/actions/project-actions/projectCommentActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { toast } from 'react-hot-toast';

interface PhaseListItemProps {
  phase: IProjectPhase;
  isSelected: boolean;
  isEditing: boolean;
  isAnimating: boolean;
  editingName: string;
  editingDescription: string | null;
  editingStartDate?: Date;
  editingEndDate?: Date;
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
  const [phaseComments, setPhaseComments] = useState<IProjectPhaseComment[]>([]);
  const [commentUserMap, setCommentUserMap] = useState<Record<string, any>>({});
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [deletedCommentIds, setDeletedCommentIds] = useState<string[]>([]);
  const [isLoadingComments, setIsLoadingComments] = useState(false);

  // Load comments when phase editing starts
  useEffect(() => {
    const loadComments = async () => {
      if (isEditing && phase.phase_id) {
        setIsLoadingComments(true);
        try {
          const [comments, user] = await Promise.all([
            getPhaseComments(phase.phase_id),
            getCurrentUser()
          ]);
          setPhaseComments(comments);
          const userMap = await getCommentUserMap(comments);
          setCommentUserMap(userMap);
          if (user) {
            setCurrentUserId(user.user_id);
          }
        } catch (error) {
          console.error('Error loading phase comments:', error);
        } finally {
          setIsLoadingComments(false);
        }
      }
    };

    loadComments();
  }, [isEditing, phase.phase_id]);

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
    const dropData = e.dataTransfer.getData('application/json');
    
    
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

          {/* Comments section - only show in edit mode */}
          {isEditing && (
            <div className="mt-6">
              <PhaseComments
                phaseId={phase.phase_id}
                comments={phaseComments}
                userMap={commentUserMap}
                currentUser={{ id: currentUserId, name: null, email: null, avatarUrl: null }}
                onAddComment={async (content) => {
                  // For edit mode, just add to local state - will be saved when phase is saved
                  const newComment = {
                    project_phase_comment_id: `temp-${Date.now()}`,
                    tenant: '',
                    project_phase_id: phase.phase_id,
                    user_id: currentUserId,
                    note: content,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                  };
                  setPhaseComments([newComment, ...phaseComments]);
                  return true;
                }}
                onEditComment={async (commentId, content) => {
                  // For edit mode, update local state - will be saved when phase is saved
                  setPhaseComments(phaseComments.map(c =>
                    c.project_phase_comment_id === commentId ? { ...c, note: content } : c
                  ));
                }}
                onDeleteComment={async (commentId) => {
                  // For edit mode, remove from local state - will be saved when phase is saved
                  // Track deleted comments that need to be removed from database
                  if (!commentId.startsWith('temp-')) {
                    setDeletedCommentIds([...deletedCommentIds, commentId]);
                  }
                  setPhaseComments(phaseComments.filter(c => c.project_phase_comment_id !== commentId));
                }}
                isSubmitting={false}
                className="mb-6"
              />
            </div>
          )}

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
              onClick={async (e) => {
                e.stopPropagation();
                // Save comments first before saving phase
                try {
                  // Handle deleted comments
                  for (const deletedId of deletedCommentIds) {
                    await deletePhaseComment(deletedId);
                  }

                  // Handle existing and new comments
                  for (const comment of phaseComments) {
                    if (comment.project_phase_comment_id.startsWith('temp-')) {
                      // New comment - create it
                      await addPhaseComment(phase.phase_id, comment.note);
                    } else {
                      // Existing comment - update it
                      await updatePhaseComment(comment.project_phase_comment_id!, comment.note);
                    }
                  }
                } catch (error) {
                  console.error('Error saving comments:', error);
                  toast.error('Failed to save comments');
                  return;
                }
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
            <GripVertical className="w-5 h-5 text-gray-400" />
          </div>
          {/* Display View */}
          <div className="flex flex-col flex-1">
            <span className="text-lg font-bold text-gray-900">{phase.phase_name}</span>
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
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              id={`edit-phase-button-${phase.phase_id}`}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(phase);
              }}
              className="p-1 rounded-md hover:bg-gray-50 transition-colors"
              title="Edit phase"
            >
              <Pencil className="w-4 h-4 text-gray-500 hover:text-gray-700" />
            </button>
            <button
              id={`delete-phase-button-${phase.phase_id}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(phase);
              }}
              className="p-1 rounded-md hover:bg-red-50 transition-colors"
              title="Delete phase"
            >
              <Trash2 className="w-4 h-4 text-red-600 hover:text-red-800" />
            </button>
          </div>
        </>
      )}
    </li>
  );
};

export default PhaseListItem;
