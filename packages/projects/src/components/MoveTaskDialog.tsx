'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '@alga-psa/ui/components/TreeSelect';
import { toast } from 'react-hot-toast';
import { moveTaskToPhase } from '../actions/projectTaskActions';
import { IProjectTask } from 'server/src/interfaces/project.interfaces';

interface MoveTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  task: IProjectTask;
  currentProjectId: string;
  projectTreeData: Array<TreeSelectOption<'project' | 'phase' | 'status'>>;
  onConfirm: (targetPhaseId: string, targetStatusId: string | undefined) => Promise<void>;
}

export default function MoveTaskDialog({
  isOpen,
  onClose,
  task,
  currentProjectId,
  projectTreeData,
  onConfirm: onConfirmProp,
}: MoveTaskDialogProps) {
  const [selectedTargetPath, setSelectedTargetPath] = useState<TreeSelectPath | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCrossProjectMove, setIsCrossProjectMove] = useState<boolean>(false);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedTargetPath(null); // Start fresh, don't pre-fill from current task location
      setIsSubmitting(false);
      setIsCrossProjectMove(false);
    }
  }, [isOpen, task.task_id]);

  const handleTreeSelect = (value: string, type: string, excluded: boolean, path?: TreeSelectPath) => {
    if (path && path['phase']) {
        setSelectedTargetPath(path);
        const newProjectId = path['project'];
        setIsCrossProjectMove(Boolean(newProjectId && currentProjectId !== newProjectId));
    } else {
        setSelectedTargetPath(null);
        setIsCrossProjectMove(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedTargetPath || !selectedTargetPath['phase']) {
        toast.error("Please select a target phase.");
        return;
    }

    const targetPhaseId = selectedTargetPath['phase'];
    const targetStatusId = selectedTargetPath['status'] || undefined;

    // Check if moving to the same phase AND same status (or no status specified)
    if (targetPhaseId === task.phase_id && (!targetStatusId || targetStatusId === task.project_status_mapping_id)) {
        toast.error("Please select a different phase or status to move the task.");
        return;
    }

    setIsSubmitting(true);
    try {
      await onConfirmProp(targetPhaseId, targetStatusId);
      // Parent component (ProjectDetail) will handle closing the dialog in finally block
    } catch (error) {
      // Error is already handled by parent, but we need to reset submitting state
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose}
      title="Move Task"
      className="max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <DialogContent>
        <div className="mb-2 text-sm text-gray-600">
          Move task <span className="font-medium">"{task.task_name}"</span> to a new phase/status:
        </div>

          <div className="mb-6"> {/* Increased bottom margin */}
            <TreeSelect<'project' | 'phase' | 'status'>
                // Use status if selected, otherwise phase, to show full path including status
                value={selectedTargetPath?.['status'] || selectedTargetPath?.['phase'] || ''}
                onValueChange={handleTreeSelect}
                options={projectTreeData}
                placeholder="Select target project/phase/status..."
                className="w-full"
                multiSelect={false}
                showExclude={false}
                showReset={false}
                allowEmpty={false}
            />
          </div>

        {/* No switches needed for move */}

        <div className="flex justify-end space-x-2">
          <Button id='cancel-move-button' variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            id='confirm-move-button'
            onClick={handleConfirm}
            disabled={
              !selectedTargetPath?.['phase'] ||
              (selectedTargetPath?.['phase'] === task.phase_id &&
                (!selectedTargetPath?.['status'] || selectedTargetPath?.['status'] === task.project_status_mapping_id)) ||
              isSubmitting
            }
          >
            {isSubmitting ? 'Moving...' : 'Confirm Move'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
