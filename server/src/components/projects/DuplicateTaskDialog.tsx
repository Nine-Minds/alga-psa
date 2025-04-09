'use client';

import { useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from 'server/src/components/ui/Button';
import { Switch } from 'server/src/components/ui/Switch';
import { Label } from 'server/src/components/ui/Label';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from 'server/src/components/ui/TreeSelect';
import { toast } from 'react-hot-toast';
 
// Define the structure for the duplication options
export interface DuplicateOptions {
  duplicateChecklist?: boolean;
  duplicatePrimaryAssignee?: boolean;
  duplicateAdditionalAssignees?: boolean;
  duplicateTicketLinks?: boolean;
  newStatusMappingId?: string;
}
 
interface DuplicateTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  taskDetails: {
    originalTaskId: string;
    originalTaskName: string;
    hasChecklist: boolean;
    hasPrimaryAssignee: boolean;
    additionalAssigneeCount: number;
    ticketLinkCount: number;
  };
  projectTreeData: Array<TreeSelectOption<'project' | 'phase' | 'status'>>;
  onConfirm: (targetPhaseId: string, options: DuplicateOptions) => void;
  initialTargetPhaseId?: string;
  initialTargetStatusId?: string | null;
}

export default function DuplicateTaskDialog({
  isOpen,
  onClose,
  taskDetails,
  projectTreeData,
  onConfirm,
  initialTargetPhaseId,
  initialTargetStatusId,
}: DuplicateTaskDialogProps) {
  const [duplicateChecklist, setDuplicateChecklist] = useState(true);
  const [duplicatePrimaryAssignee, setDuplicatePrimaryAssignee] = useState(true);
  const [duplicateAdditionalAssignees, setDuplicateAdditionalAssignees] = useState(true);
  const [duplicateTicketLinks, setDuplicateTicketLinks] = useState(true);
  const [selectedTargetPath, setSelectedTargetPath] = useState<TreeSelectPath | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
 
  // Reset toggles when dialog opens with new details
  useEffect(() => {
    if (isOpen) {
      setDuplicateChecklist(true);
      setDuplicatePrimaryAssignee(true);
      setDuplicateAdditionalAssignees(true);
      setDuplicateTicketLinks(true);
      // Pre-fill target path if initial values are provided
      if (initialTargetPhaseId) {
        const initialPath: TreeSelectPath = { phase: initialTargetPhaseId };
        if (initialTargetStatusId) {
          initialPath.status = initialTargetStatusId;
        }
        // Find the project ID associated with the initial phase ID
        const findProjectId = (options: TreeSelectOption<'project' | 'phase' | 'status'>[], phaseId: string): string | undefined => {
            for (const opt of options) {
                if (opt.type === 'project' && opt.children?.some(child => child.value === phaseId)) {
                    return opt.value;
                }
                if (opt.children) {
                    const found = findProjectId(opt.children, phaseId);
                    if (found) return found;
                }
            }
            return undefined;
        };
        const projectId = findProjectId(projectTreeData, initialTargetPhaseId);
        if (projectId) {
            initialPath.project = projectId;
        }
        setSelectedTargetPath(initialPath);
      } else {
        setSelectedTargetPath(null);
      }
      setIsSubmitting(false);
    }
  }, [isOpen, taskDetails.originalTaskId]);
 
  const handleTreeSelect = (value: string, type: string, excluded: boolean, path?: TreeSelectPath) => {
    if (path && path['phase']) {
        setSelectedTargetPath(path);
    } else {
        setSelectedTargetPath(null);
    }
  };
 
  const handleConfirm = () => {
    if (!selectedTargetPath || !selectedTargetPath['phase']) {
        toast.error("Please select a target phase.");
        return;
    }
    setIsSubmitting(true);
    const targetPhaseId = selectedTargetPath['phase'];
    const targetStatusId = selectedTargetPath['status'] || null;
 
    const options: DuplicateOptions = {
      ...(taskDetails.hasChecklist && { duplicateChecklist: duplicateChecklist }),
      ...(taskDetails.hasPrimaryAssignee && { duplicatePrimaryAssignee: duplicatePrimaryAssignee }),
      ...(taskDetails.additionalAssigneeCount > 0 && { duplicateAdditionalAssignees: duplicateAdditionalAssignees }),
      ...(taskDetails.ticketLinkCount > 0 && { duplicateTicketLinks: duplicateTicketLinks }),
      newStatusMappingId: targetStatusId || undefined,
    };
    onConfirm(targetPhaseId, options);
  };

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black bg-opacity-50 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[500px] max-h-[90vh] overflow-y-auto z-50">
          <Dialog.Title className="text-lg font-semibold mb-4">Duplicate Task</Dialog.Title>
          <Dialog.Description className="mb-2 text-sm text-gray-600">
            Duplicate task <span className="font-medium">"{taskDetails.originalTaskName}"</span> to:
          </Dialog.Description>
 
          <div className="mb-4">
            <TreeSelect<'project' | 'phase' | 'status'>
                value={selectedTargetPath?.['phase'] || ''}
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

          <div className="space-y-3 mb-6">
            {taskDetails.hasChecklist && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="duplicateChecklist"
                  checked={duplicateChecklist}
                  onCheckedChange={setDuplicateChecklist}
                  disabled={isSubmitting}
                />
                <Label htmlFor="duplicateChecklist" className="text-sm font-normal">
                  {duplicateChecklist ? 'Duplicate task with checklist items' : 'Duplicate task without checklist items'}
                </Label>
              </div>
            )}
            {taskDetails.hasPrimaryAssignee && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="duplicatePrimaryAssignee"
                  checked={duplicatePrimaryAssignee}
                  onCheckedChange={setDuplicatePrimaryAssignee}
                  // Disable if submitting OR if duplicating additional assignees is checked (and there are some)
                  disabled={isSubmitting || (taskDetails.additionalAssigneeCount > 0 && duplicateAdditionalAssignees)}
                />
                <Label htmlFor="duplicatePrimaryAssignee" className="text-sm font-normal">
                  {duplicatePrimaryAssignee ? 'Duplicate task with primary assignee' : 'Duplicate task without primary assignee'}
                </Label>
              </div>
            )}
            {taskDetails.additionalAssigneeCount > 0 && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="duplicateAdditionalAssignees"
                  checked={duplicateAdditionalAssignees}
                  onCheckedChange={(checked) => {
                    setDuplicateAdditionalAssignees(checked);
                    // If enabling additional assignees, ensure primary assignee is also enabled
                    if (checked && !duplicatePrimaryAssignee) {
                      setDuplicatePrimaryAssignee(true);
                    }
                  }}
                  disabled={isSubmitting}
                />
                <Label htmlFor="duplicateAdditionalAssignees" className="text-sm font-normal">
                  {duplicateAdditionalAssignees ? `Duplicate task with additional assignees (${taskDetails.additionalAssigneeCount})` : 'Duplicate task without additional assignees'}
                </Label>
              </div>
            )}
            {taskDetails.ticketLinkCount > 0 && (
              <div className="flex items-center space-x-2">
                <Switch
                  id="duplicateTicketLinks"
                  checked={duplicateTicketLinks}
                  onCheckedChange={setDuplicateTicketLinks}
                  disabled={isSubmitting}
                />
                <Label htmlFor="duplicateTicketLinks" className="text-sm font-normal">
                  {duplicateTicketLinks ? `Duplicate task with ticket links (${taskDetails.ticketLinkCount})` : 'Duplicate task without ticket links'}
                </Label>
              </div>
            )}
          </div>

          <div className="flex justify-end space-x-2">
            <Button id='cancel-duplicate-button' variant="ghost" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button id='confirm-duplicate-button' onClick={handleConfirm} disabled={isSubmitting || !selectedTargetPath?.['phase']}>
              {isSubmitting ? 'Duplicating...' : 'Confirm Duplicate'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}