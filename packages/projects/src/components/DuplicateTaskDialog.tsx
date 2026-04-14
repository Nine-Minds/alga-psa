'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Label } from '@alga-psa/ui/components/Label';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '@alga-psa/ui/components/TreeSelect';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
 
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
  const { t } = useTranslation(['features/projects', 'common']);
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
        toast.error(t('dialogs.duplicateTask.selectTargetError', 'Please select a target phase.'));
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
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose}
      title={t('dialogs.duplicateTask.title', 'Duplicate Task')}
      className="max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <DialogContent>
        <div className="mb-2 text-sm text-gray-600">
          {t('dialogs.duplicateTask.message', 'Duplicate task "{{taskName}}" to:', { taskName: taskDetails.originalTaskName })}
        </div>
 
          <div className="mb-4">
            <TreeSelect<'project' | 'phase' | 'status'>
                value={selectedTargetPath?.['status'] || selectedTargetPath?.['phase'] || ''}
                onValueChange={handleTreeSelect}
                options={projectTreeData}
                placeholder={t('dialogs.duplicateTask.placeholder', 'Select target project/phase/status...')}
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
                  {duplicateChecklist ? t('dialogs.duplicateTask.withChecklist', 'Duplicate task with checklist items') : t('dialogs.duplicateTask.withoutChecklist', 'Duplicate task without checklist items')}
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
                  {duplicatePrimaryAssignee ? t('dialogs.duplicateTask.withPrimaryAssignee', 'Duplicate task with primary assignee') : t('dialogs.duplicateTask.withoutPrimaryAssignee', 'Duplicate task without primary assignee')}
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
                  {duplicateAdditionalAssignees ? t('dialogs.duplicateTask.withAdditionalAssignees', 'Duplicate task with additional assignees ({{count}})', { count: taskDetails.additionalAssigneeCount }) : t('dialogs.duplicateTask.withoutAdditionalAssignees', 'Duplicate task without additional assignees')}
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
                  {duplicateTicketLinks ? t('dialogs.duplicateTask.withTicketLinks', 'Duplicate task with ticket links ({{count}})', { count: taskDetails.ticketLinkCount }) : t('dialogs.duplicateTask.withoutTicketLinks', 'Duplicate task without ticket links')}
                </Label>
              </div>
            )}
          </div>

        <div className="flex justify-end space-x-2">
          <Button id='cancel-duplicate-button' variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common:actions.cancel', 'Cancel')}
          </Button>
          <Button id='confirm-duplicate-button' onClick={handleConfirm} disabled={isSubmitting || !selectedTargetPath?.['phase']}>
            {isSubmitting ? t('dialogs.duplicateTask.duplicating', 'Duplicating...') : t('dialogs.duplicateTask.confirm', 'Confirm Duplicate')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}