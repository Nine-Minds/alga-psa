'use client';

import { IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { Button } from 'server/src/components/ui/Button';
import PhaseListItem from './PhaseListItem';

interface ProjectPhasesProps {
  phases: IProjectPhase[];
  selectedPhase: IProjectPhase | null;
  isAddingTask: boolean;
  editingPhaseId: string | null;
  editingPhaseName: string;
  editingStartDate?: Date;
  editingEndDate?: Date;
  dragOverPhaseId: string | null;
  onPhaseSelect: (phase: IProjectPhase) => void;
  onEditingPhaseNameChange: (name: string) => void;
  onEditingStartDateChange?: (date: Date | undefined) => void;
  onEditingEndDateChange?: (date: Date | undefined) => void;
  onAddTask: () => void;
  onAddPhase: () => void;
  onEditPhase: (phase: IProjectPhase) => void;
  onSavePhase: (phase: IProjectPhase) => void;
  onCancelEdit: () => void;
  onDeletePhase: (phase: IProjectPhase) => void;
  onDragOver: (e: React.DragEvent, phaseId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, phase: IProjectPhase) => void;
}

export const ProjectPhases: React.FC<ProjectPhasesProps> = ({
  phases,
  selectedPhase,
  isAddingTask,
  editingPhaseId,
  editingPhaseName,
  editingStartDate,
  editingEndDate,
  dragOverPhaseId,
  onPhaseSelect,
  onAddTask,
  onAddPhase,
  onEditPhase,
  onSavePhase,
  onCancelEdit,
  onDeletePhase,
  onEditingPhaseNameChange,
  onEditingStartDateChange,
  onEditingEndDateChange,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  return (
    <div className="bg-white shadow rounded-lg p-4">
      <h2 className="text-xl font-bold mb-2">Project Phases</h2>
      <div className="flex gap-2 mb-4">
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
      </div>
      <ul className="space-y-2">
        {phases
          .sort((a, b) => {
            const aDate = a.end_date ? new Date(a.end_date).getTime() : Infinity;
            const bDate = b.end_date ? new Date(b.end_date).getTime() : Infinity;
            return aDate - bDate;
          })
          .map((phase: IProjectPhase): JSX.Element => (
          <PhaseListItem
            key={phase.phase_id}
            phase={phase}
            isSelected={selectedPhase?.phase_id === phase.phase_id}
            isEditing={editingPhaseId === phase.phase_id}
            isDragOver={dragOverPhaseId === phase.phase_id}
            editingName={editingPhaseName}
            editingStartDate={editingStartDate}
            editingEndDate={editingEndDate}
            onSelect={onPhaseSelect}
            onEdit={onEditPhase}
            onSave={onSavePhase}
            onCancel={onCancelEdit}
            onDelete={onDeletePhase}
            onNameChange={onEditingPhaseNameChange}
            onStartDateChange={onEditingStartDateChange}
            onEndDateChange={onEditingEndDateChange}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          />
        ))}
      </ul>
    </div>
  );
};

export default ProjectPhases;
