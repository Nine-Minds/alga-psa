'use client';

import { IProjectPhase } from '@/interfaces/project.interfaces';
import { Button } from '@/components/ui/Button';
import PhaseListItem from './PhaseListItem';

interface ProjectPhasesProps {
  phases: IProjectPhase[];
  selectedPhase: IProjectPhase | null;
  isAddingTask: boolean;
  editingPhaseId: string | null;
  editingPhaseName: string;
  dragOverPhaseId: string | null;
  onPhaseSelect: (phase: IProjectPhase) => void;
  onAddTask: () => void;
  onAddPhase: () => void;
  onEditPhase: (phase: IProjectPhase) => void;
  onSavePhase: (phase: IProjectPhase) => void;
  onCancelEdit: () => void;
  onDeletePhase: (phase: IProjectPhase) => void;
  onEditingPhaseNameChange: (name: string) => void;
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
  dragOverPhaseId,
  onPhaseSelect,
  onAddTask,
  onAddPhase,
  onEditPhase,
  onSavePhase,
  onCancelEdit,
  onDeletePhase,
  onEditingPhaseNameChange,
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
        {phases.map((phase: IProjectPhase): JSX.Element => (
          <PhaseListItem
            key={phase.phase_id}
            phase={phase}
            isSelected={selectedPhase?.phase_id === phase.phase_id}
            isEditing={editingPhaseId === phase.phase_id}
            isDragOver={dragOverPhaseId === phase.phase_id}
            editingName={editingPhaseName}
            onSelect={onPhaseSelect}
            onEdit={onEditPhase}
            onSave={onSavePhase}
            onCancel={onCancelEdit}
            onDelete={onDeletePhase}
            onNameChange={onEditingPhaseNameChange}
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
