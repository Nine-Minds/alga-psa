// server/src/components/projects/PhaseQuickAdd.tsx
'use client'
import React, { useState } from 'react';
import { IProjectPhase } from '@alga-psa/types';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { addProjectPhase } from '../actions/projectActions';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation(['features/projects', 'common']);
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
      if (isActionPermissionError(newPhase)) {
        handleError(newPhase.permissionError);
        return;
      }
      onPhaseAdded(newPhase);
      onClose();
    } catch (error) {
      handleError(error, t('projectPhases.addError', 'Failed to add phase. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    onCancel();
    onClose();
  };

  const footer = (
    <div className="flex justify-between">
      <Button id="cancel-phase-button" variant="ghost" onClick={handleCancel} disabled={isSubmitting}>
        {t('common:actions.cancel', 'Cancel')}
      </Button>
      <Button
        id="save-phase-button"
        type="button"
        disabled={isSubmitting}
        className={!phaseName.trim() ? 'opacity-50' : ''}
        onClick={() => (document.getElementById('phase-quick-add-form') as HTMLFormElement | null)?.requestSubmit()}
      >
        {isSubmitting
          ? t('projectPhases.adding', 'Adding...')
          : t('common:actions.save', 'Save')}
      </Button>
    </div>
  );

  return (
    <Dialog
      isOpen={true}
      onClose={() => {
        setHasAttemptedSubmit(false);
        onClose();
      }}
      title={t('projectPhases.addPhase', 'Add Phase')}
      className="max-w-2xl"
      footer={footer}
    >
      <DialogContent>
          {hasAttemptedSubmit && !phaseName.trim() && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                {t('projectDetail.phaseNameRequired', 'Phase name cannot be empty')}
              </AlertDescription>
            </Alert>
          )}
          <form id="phase-quick-add-form" onSubmit={handleSubmit} className="flex flex-col">
            <div className="space-y-4 mb-2 mt-2">
              <TextArea
                value={phaseName}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPhaseName(e.target.value)}
                placeholder={t('projectPhases.phaseNamePlaceholder', 'Phase name... *')}
                className={`w-full px-3 py-3 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 text-lg font-semibold ${hasAttemptedSubmit && !phaseName.trim() ? 'border-destructive' : 'border-gray-300'}`}
                rows={1}
              />
              <TextArea
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder={t('projectPhases.descriptionPlaceholder', 'Description')}
                className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('startDate', 'Start Date')}</label>
                  <DatePicker
                    value={startDate}
                    onChange={setStartDate}
                    placeholder={t('quickAdd.startDatePlaceholder', 'Select start date')}
                    clearable={true}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('endDate', 'End Date')}</label>
                  <DatePicker
                    value={endDate}
                    onChange={setEndDate}
                    placeholder={t('quickAdd.endDatePlaceholder', 'Select end date')}
                    clearable={true}
                  />
                </div>
              </div>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
};

export default PhaseQuickAdd;
