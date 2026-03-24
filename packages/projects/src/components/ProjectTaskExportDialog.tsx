'use client';

import React, { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Download, Check, FileSpreadsheet } from 'lucide-react';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { exportProjectTasksToCSV } from '../actions/projectTaskExportActions';
import type { IProjectPhase } from '@alga-psa/types';

interface ProjectTaskExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  phases: IProjectPhase[];
}

type ExportStep = 'configure' | 'exporting' | 'complete';

const EXPORT_FIELDS = [
  { key: 'task_name', label: 'Task Name' },
  { key: 'description', label: 'Description' },
  { key: 'phase', label: 'Phase' },
  { key: 'status', label: 'Status' },
  { key: 'is_closed', label: 'Is Closed' },
  { key: 'task_type', label: 'Task Type' },
  { key: 'priority', label: 'Priority' },
  { key: 'assigned_to', label: 'Assigned To' },
  { key: 'assigned_team', label: 'Assigned Team' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'estimated_hours', label: 'Estimated Hours' },
  { key: 'actual_hours', label: 'Actual Hours' },
  { key: 'checklist_progress', label: 'Checklist Progress' },
  { key: 'tags', label: 'Tags' },
  { key: 'created_at', label: 'Created At' },
  { key: 'updated_at', label: 'Updated At' },
];

const ALL_FIELD_KEYS = EXPORT_FIELDS.map(f => f.key);

const ProjectTaskExportDialog: React.FC<ProjectTaskExportDialogProps> = ({
  isOpen,
  onClose,
  projectId,
  phases,
}) => {
  const [step, setStep] = useState<ExportStep>('configure');
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(ALL_FIELD_KEYS));
  const [selectedPhaseIds, setSelectedPhaseIds] = useState<Set<string>>(
    new Set(phases.map(p => p.phase_id))
  );
  const [exportedCount, setExportedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const allFieldsSelected = selectedFields.size === EXPORT_FIELDS.length;
  const noFieldsSelected = selectedFields.size === 0;
  const allPhasesSelected = selectedPhaseIds.size === phases.length;
  const noPhasesSelected = selectedPhaseIds.size === 0;

  const handleClose = useCallback(() => {
    if (step === 'exporting') return;
    setStep('configure');
    setSelectedFields(new Set(ALL_FIELD_KEYS));
    setSelectedPhaseIds(new Set(phases.map(p => p.phase_id)));
    setExportedCount(0);
    setError(null);
    onClose();
  }, [step, onClose, phases]);

  const toggleField = useCallback((key: string) => {
    setSelectedFields(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const toggleAllFields = useCallback(() => {
    setSelectedFields(prev =>
      prev.size === EXPORT_FIELDS.length ? new Set() : new Set(ALL_FIELD_KEYS)
    );
  }, []);

  const togglePhase = useCallback((phaseId: string) => {
    setSelectedPhaseIds(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  }, []);

  const toggleAllPhases = useCallback(() => {
    setSelectedPhaseIds(prev =>
      prev.size === phases.length
        ? new Set()
        : new Set(phases.map(p => p.phase_id))
    );
  }, [phases]);

  const handleExport = useCallback(async () => {
    setStep('exporting');
    setError(null);

    try {
      const orderedFields = ALL_FIELD_KEYS.filter(k => selectedFields.has(k));
      const { csv, count } = await exportProjectTasksToCSV(
        projectId,
        Array.from(selectedPhaseIds),
        orderedFields,
      );

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `project-tasks-export-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportedCount(count);
      setStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export tasks');
      setStep('configure');
      handleError(err, 'Failed to export tasks');
    }
  }, [projectId, selectedFields, selectedPhaseIds]);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Export Project Tasks"
      className="max-w-lg"
    >
      <DialogContent>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step 1: Configure */}
        {step === 'configure' && (
          <div>
            {/* Phase selection */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))]">
                  Phases to export
                </h3>
                <button
                  type="button"
                  onClick={toggleAllPhases}
                  className="text-xs text-primary-600 hover:text-primary-700 dark:text-[rgb(var(--color-primary-400))] dark:hover:text-[rgb(var(--color-primary-300))]"
                >
                  {allPhasesSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 p-3">
                  {phases.map((phase) => (
                    <Checkbox
                      key={phase.phase_id}
                      id={`export-phase-${phase.phase_id}`}
                      label={phase.phase_name}
                      checked={selectedPhaseIds.has(phase.phase_id)}
                      onChange={() => togglePhase(phase.phase_id)}
                      size="sm"
                      containerClassName="mb-0"
                      skipRegistration
                    />
                  ))}
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-[rgb(var(--color-text-500))]">
                {selectedPhaseIds.size} of {phases.length} phase{phases.length === 1 ? '' : 's'} selected
              </p>
            </div>

            {/* Field selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))]">
                  Fields to export
                </h3>
                <button
                  type="button"
                  onClick={toggleAllFields}
                  className="text-xs text-primary-600 hover:text-primary-700 dark:text-[rgb(var(--color-primary-400))] dark:hover:text-[rgb(var(--color-primary-300))]"
                >
                  {allFieldsSelected ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="border rounded-lg dark:border-[rgb(var(--color-border-200))]">
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 p-3">
                  {EXPORT_FIELDS.map((field) => (
                    <Checkbox
                      key={field.key}
                      id={`export-field-${field.key}`}
                      label={field.label}
                      checked={selectedFields.has(field.key)}
                      onChange={() => toggleField(field.key)}
                      size="sm"
                      containerClassName="mb-0"
                      skipRegistration
                    />
                  ))}
                </div>
              </div>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-[rgb(var(--color-text-500))]">
                {selectedFields.size} of {EXPORT_FIELDS.length} fields selected
              </p>
            </div>

            <DialogFooter>
              <Button
                id="export-tasks-cancel-btn"
                variant="outline"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                id="export-tasks-btn"
                onClick={() => void handleExport()}
                disabled={noPhasesSelected || noFieldsSelected}
                className="flex items-center gap-2"
              >
                <Download className="h-4 w-4" />
                Export Tasks
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Exporting */}
        {step === 'exporting' && (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-[rgb(var(--color-text-400))]">Exporting tasks...</p>
          </div>
        )}

        {/* Step 3: Complete */}
        {step === 'complete' && (
          <div className="text-center py-8">
            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100 mb-4">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-lg font-medium mb-2">Export Complete</h3>
            <p className="text-gray-600 dark:text-[rgb(var(--color-text-400))]">
              Successfully exported {exportedCount} task{exportedCount === 1 ? '' : 's'} to CSV.
            </p>
            <DialogFooter>
              <Button
                id="export-tasks-done-btn"
                onClick={handleClose}
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProjectTaskExportDialog;
