// server/src/components/projects/PhaseQuickAdd.tsx
'use client'
import React, { useState } from 'react';
import { IProjectPhase } from 'server/src/interfaces/project.interfaces';
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { TextArea } from 'server/src/components/ui/TextArea';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { toast } from 'react-hot-toast';
import { addProjectPhase } from '@product/actions/project-actions/projectActions';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';

interface PhaseQuickAddProps {
  projectId: string;
  onClose: () => void;
  onPhaseAdded: (newPhase: IProjectPhase) => void;
  onCancel: () => void;
}


const PhaseQuickAdd: React.FC<PhaseQuickAddProps> = ({ 
  projectId,
  onClose, 
  onPhaseAdded,
  onCancel
}) => {
  const [phaseName, setPhaseName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setHasAttemptedSubmit(true);
    if (phaseName.trim() === '') return;

    setIsSubmitting(true);

    try {
      const phaseData = {
        project_id: projectId,
        phase_name: phaseName.trim(),
        description: description || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status: 'In Progress',
        order_number: 0, // Will be set by server
        wbs_code: '', // Will be set by server
      };

      const newPhase = await addProjectPhase(phaseData);
      onPhaseAdded(newPhase);
      onClose();
    } catch (error) {
      console.error('Error adding phase:', error);
      toast.error('Failed to add phase. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    onCancel();
    onClose();
  };

  return (
    <Dialog 
      isOpen={true} 
      onClose={() => {
        setHasAttemptedSubmit(false);
        onClose();
      }}
      title="Add New Phase"
      className="max-w-2xl"
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto">
          {hasAttemptedSubmit && !phaseName.trim() && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                Phase name is required
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col">
            <div className="space-y-4 mb-2 mt-2">
              <TextArea
                value={phaseName}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPhaseName(e.target.value)}
                placeholder="Phase name... *"
                className={`w-full px-3 py-3 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg font-semibold ${hasAttemptedSubmit && !phaseName.trim() ? 'border-red-500' : 'border-gray-300'}`}
                rows={1}
              />
              <TextArea
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                    placeholder="Select start date"
                    clearable={true}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <DatePicker
                    value={endDate}
                    onChange={setEndDate}
                    placeholder="Select end date"
                    clearable={true}
                  />
                </div>
              </div>
              <div className="flex justify-between mt-6">
                <Button id="cancel-phase-button" variant="ghost" onClick={handleCancel} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button id="save-phase-button" type="submit" disabled={isSubmitting} className={!phaseName.trim() ? 'opacity-50' : ''}>
                  {isSubmitting ? 'Adding...' : 'Save'}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
};

export default PhaseQuickAdd;
