// server/src/components/projects/PhaseQuickAdd.tsx
'use client'
import React, { useEffect, useState } from 'react';
import { IProjectPhase } from '@alga-psa/types';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { SearchableSelect } from '@alga-psa/ui/components/SearchableSelect';
import { handleError, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { addProjectPhase } from '../actions/projectActions';
import { getServices } from '../actions/serviceCatalogActions';
import { timeEntryServiceChoices, type TimeEntryServiceChoice } from '@alga-psa/core';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from 'react-i18next';

interface PhaseQuickAddProps {
  projectId: string;
  onClose: () => void;
  onPhaseAdded: (newPhase: IProjectPhase) => void;
  onCancel: () => void;
}

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
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
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [services, setServices] = useState<TimeEntryServiceChoice[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

  // The phase-level default is offered here so it does not have to be set again
  // by reopening the phase for editing right after creating it.
  useEffect(() => {
    let cancelled = false;
    getServices(1, 999)
      .then((response) => { if (!cancelled) setServices(response.services); })
      .catch(() => { if (!cancelled) setServices([]); });
    return () => { cancelled = true; };
  }, []);

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
        service_id: serviceId,
        status: 'In Progress',
        order_number: 0, // Will be set by server
        wbs_code: '', // Will be set by server
      };

      const newPhase = await addProjectPhase(phaseData);
      if (isReturnedActionError(newPhase)) {
        handleError(newPhase);
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
    <div className="flex w-full justify-between">
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
                className={`w-full px-3 py-3 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))] text-lg font-semibold ${hasAttemptedSubmit && !phaseName.trim() ? 'border-destructive' : 'border-gray-300'}`}
                rows={1}
              />
              <TextArea
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder={t('projectPhases.descriptionPlaceholder', 'Description')}
                className="w-full p-2 border border-gray-300 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-500))]"
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
              {/* Default service for time entries logged against this phase's tasks */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('projectPhases.serviceLabel', 'Default Service (for time entries)')}</label>
                <SearchableSelect
                  id="phase-quick-add-service-select"
                  value={serviceId || ''}
                  onChange={(value) => setServiceId(value || null)}
                  options={[
                    { value: '', label: t('projectPhases.noService', 'No service') },
                    ...timeEntryServiceChoices(services, serviceId).map((service) => ({
                      value: service.service_id,
                      label: service.service_name,
                    })),
                  ]}
                  placeholder={t('projectPhases.servicePlaceholder', 'Select default service')}
                  className="w-full"
                  dropdownMode="overlay"
                />
                <p className="text-xs text-gray-500 mt-1">{t('projectPhases.serviceHelp', "Used for time entries on this phase's tasks when the task itself sets no service.")}</p>
              </div>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
};

export default PhaseQuickAdd;
