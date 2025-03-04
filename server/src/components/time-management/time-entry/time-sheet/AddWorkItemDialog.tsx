'use client'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from 'server/src/components/ui/Dialog';
import { IWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { WorkItemPicker } from './WorkItemPicker';
import { ITimePeriodView } from 'server/src/interfaces/timeEntry.interfaces';

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

  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
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
