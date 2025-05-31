'use client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from 'server/src/components/ui/Dialog';
import { IWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { WorkItemPicker } from './WorkItemPicker';
import { ITimePeriodView } from 'server/src/interfaces/timeEntry.interfaces';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { DialogComponent } from 'server/src/types/ui-reflection/types';
import { CommonActions } from 'server/src/types/ui-reflection/actionBuilders';

interface AddWorkItemDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (workItem: IWorkItem) => void;
  availableWorkItems: IWorkItem[];
  timePeriod?: ITimePeriodView;
}

export function AddWorkItemDialog({ isOpen, onClose, onAdd, availableWorkItems, timePeriod }: AddWorkItemDialogProps) {
  const handleSelect = (workItem: IWorkItem | null) => {
    if (workItem) {
      onAdd(workItem);
    }
  };

  // Register dialog for UI automation
  const { automationIdProps: dialogProps } = useAutomationIdAndRegister<DialogComponent>({
    type: 'dialog',
    id: 'add-work-item-dialog',
    title: 'Add Work Item',
    open: isOpen,
  }, () => [
    CommonActions.close('Close add work item dialog'),
    CommonActions.focus('Focus on add work item dialog'),
    {
      type: 'select' as const,
      available: true,
      description: 'Select a work item to add to timesheet',
      parameters: [
        {
          name: 'workItemId',
          type: 'string' as const,
          required: true,
          description: 'ID of the work item to select'
        }
      ]
    }
  ]);

  return (
    <Dialog 
      isOpen={isOpen} 
      onClose={onClose}
      {...dialogProps}
    >
      <DialogContent className="z-[500]">
        <div className="max-w-2xl max-h-[80vh] flex flex-col overflow-visible">
          <DialogHeader>
            <DialogTitle>Add Work Item</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-visible">
            <WorkItemPicker 
              onSelect={handleSelect} 
              availableWorkItems={availableWorkItems}
              timePeriod={timePeriod}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
