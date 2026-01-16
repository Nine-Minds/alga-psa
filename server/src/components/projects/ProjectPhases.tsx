'use client';

import { useState, useRef } from 'react';
import { IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Upload } from 'lucide-react';
import PhaseListItem from './PhaseListItem';
import styles from './ProjectDetail.module.css';

interface ProjectPhasesProps {
  phases: IProjectPhase[];
  selectedPhase: IProjectPhase | null;
  isAddingTask: boolean;
  editingPhaseId: string | null;
  editingPhaseName: string;
  editingPhaseDescription: string | null;
  editingStartDate?: Date;
  editingEndDate?: Date;
  phaseTaskCounts?: Record<string, number>;
  phaseDropTarget: {
    phaseId: string;
    position: 'before' | 'after';
  } | null;
  taskDraggingOverPhaseId: string | null;
  animatingPhases: Set<string>;
  onPhaseSelect: (phase: IProjectPhase) => void;
  onEditingPhaseNameChange: (name: string) => void;
  onEditingPhaseDescriptionChange: (description: string | null) => void;
  onEditingStartDateChange?: (date: Date | undefined) => void;
  onEditingEndDateChange?: (date: Date | undefined) => void;
  onAddTask: () => void;
  onAddPhase: () => void;
  onEditPhase: (phase: IProjectPhase) => void;
  onSavePhase: (phase: IProjectPhase) => void;
  onCancelEdit: () => void;
  onDeletePhase: (phase: IProjectPhase) => void;
  onDragOver: (e: React.DragEvent, phaseId: string, dropPosition: 'before' | 'after' | '', isOverPhaseItemBody?: boolean) => void; // Ensure "" is allowed for dropPosition
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, phase: IProjectPhase, beforePhaseId: string | null, afterPhaseId: string | null) => void;
  onDragStart: (e: React.DragEvent, phaseId: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onImport?: () => void;
}

export const ProjectPhases: React.FC<ProjectPhasesProps> = ({
  phases,
  selectedPhase,
  isAddingTask,
  editingPhaseId,
  editingPhaseName,
  editingPhaseDescription,
  editingStartDate,
  editingEndDate,
  phaseTaskCounts = {},
  phaseDropTarget,
  taskDraggingOverPhaseId, // Destructure new prop
  animatingPhases,
  onPhaseSelect,
  onAddTask,
  onAddPhase,
  onEditPhase,
  onSavePhase,
  onCancelEdit,
  onDeletePhase,
  onEditingPhaseNameChange,
  onEditingPhaseDescriptionChange,
  onEditingStartDateChange,
  onEditingEndDateChange,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onDragEnd,
  onImport,
}) => {
  const handleContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    
    // Check if we're dragging over the empty space at the top
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    
    // If dragging in the top area before the first phase
    if (relativeY < 100 && phases.length > 0) {
      const sortedPhases = [...phases].sort((a, b) => {
        const aKey = a.order_key || 'zzz';
        const bKey = b.order_key || 'zzz';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });
      
      if (sortedPhases.length > 0) {
        // For container drag over, it's always for phase reordering (not over item body)
        onDragOver(e, sortedPhases[0].phase_id, 'before', false); 
      }
    }
  };

  const handleContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    
    // Check if we're dropping at the top
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    
    if (relativeY < 100 && phases.length > 0) {
      const sortedPhases = [...phases].sort((a, b) => {
        const aKey = a.order_key || 'zzz';
        const bKey = b.order_key || 'zzz';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });
      
      if (sortedPhases.length > 0) {
        // When dropping before all phases, beforePhaseId is null and afterPhaseId is the first phase
        onDrop(e, sortedPhases[0], null, sortedPhases[0].phase_id);
      }
    }
  };

  // Component for drop placeholders that can accept drops
  const DropPlaceholder: React.FC<{ 
    beforePhaseId: string | null; 
    afterPhaseId: string | null;
    phase: IProjectPhase;
    visible: boolean;
  }> = ({ beforePhaseId, afterPhaseId, phase, visible }) => {
    const handlePlaceholderDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDrop(e, phase, beforePhaseId, afterPhaseId);
    };

    const handlePlaceholderDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    return (
      <div 
        className={`${styles.phaseDropPlaceholder} ${visible ? styles.visible : ''}`}
        onDrop={handlePlaceholderDrop}
        onDragOver={handlePlaceholderDragOver}
      />
    );
  };

  return (
    <div className="bg-white shadow rounded-lg p-4" onDragOver={handleContainerDragOver} onDrop={handleContainerDrop}>
      <h2 className="text-xl font-bold mb-2">Project Phases</h2>
      <div className="flex gap-2 mb-4 flex-wrap">
        <Button
          id="add-task-button"
          onClick={onAddTask}
          className="text-sm"
          disabled={!selectedPhase || isAddingTask}
        >
          {isAddingTask ? 'Adding...' : '+ Add Task'}
        </Button>
        <Button
          id="add-phase-button"
          onClick={onAddPhase}
          className="text-sm"
        >
          + Add Phase
        </Button>
        {onImport && (
          <Button
            id="import-phases-tasks-button"
            onClick={onImport}
            variant="outline"
            className="text-sm"
          >
            <Upload className="h-4 w-4 mr-1" />
            Import
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {(() => {
          const sortedPhases = phases
            .sort((a, b) => {
              // Sort by order_key if available, otherwise fall back to end_date
              if (a.order_key || b.order_key) {
                // Handle cases where one or both might be missing order_key
                const aKey = a.order_key || 'zzz'; // Put phases without order_key at the end
                const bKey = b.order_key || 'zzz';
                // Use standard string comparison for fractional-indexing keys
                return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
              }
              const aDate = a.end_date ? new Date(a.end_date).getTime() : Infinity;
              const bDate = b.end_date ? new Date(b.end_date).getTime() : Infinity;
              return aDate - bDate;
            });
          
          return (
            <>
              {/* Drop placeholder before all phases */}
              {sortedPhases.length > 0 && 
               phaseDropTarget?.phaseId === sortedPhases[0].phase_id && 
               phaseDropTarget.position === 'before' && (
                <DropPlaceholder
                  beforePhaseId={null}
                  afterPhaseId={sortedPhases[0].phase_id}
                  phase={sortedPhases[0]}
                  visible={true}
                />
              )}
              {sortedPhases.map((phase: IProjectPhase, index: number): React.JSX.Element => (
          <div key={phase.phase_id}>
            {/* Drop placeholder before phase - but not for first phase as it's handled above */}
            {phaseDropTarget?.phaseId === phase.phase_id && phaseDropTarget.position === 'before' && index > 0 && (
              <DropPlaceholder
                beforePhaseId={sortedPhases[index - 1].phase_id}
                afterPhaseId={phase.phase_id}
                phase={phase}
                visible={true}
              />
            )}
            <PhaseListItem
              phase={phase}
              phases={phases}
              isSelected={selectedPhase?.phase_id === phase.phase_id}
              isEditing={editingPhaseId === phase.phase_id}
              isAnimating={animatingPhases.has(phase.phase_id)}
              editingName={editingPhaseName}
              editingDescription={editingPhaseDescription}
              editingStartDate={editingStartDate}
              editingEndDate={editingEndDate}
              taskCount={phaseTaskCounts[phase.phase_id]}
              taskDraggingOverPhaseId={taskDraggingOverPhaseId} // Pass prop to PhaseListItem
              onSelect={onPhaseSelect}
              onEdit={onEditPhase}
              onSave={onSavePhase}
              onCancel={onCancelEdit}
              onDelete={onDeletePhase}
              onNameChange={onEditingPhaseNameChange}
              onDescriptionChange={onEditingPhaseDescriptionChange}
              onStartDateChange={onEditingStartDateChange}
              onEndDateChange={onEditingEndDateChange}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
            {/* Drop placeholder after phase */}
            {phaseDropTarget?.phaseId === phase.phase_id && phaseDropTarget.position === 'after' && (
              <DropPlaceholder
                beforePhaseId={phase.phase_id}
                afterPhaseId={index < sortedPhases.length - 1 ? sortedPhases[index + 1].phase_id : null}
                phase={phase}
                visible={true}
              />
            )}
          </div>
        ))}
            </>
          );
        })()}
      </ul>
    </div>
  );
};

export default ProjectPhases;
