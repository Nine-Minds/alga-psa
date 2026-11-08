'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { getErrorMessage, isActionMessageError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { createProjectStagingBox, updateProjectStagingBox } from '../../actions/stagingActions';
import type { StagingContainerView, StagingLocationOption, StagingTaskOption } from './stagingTypes';

const NONE = '__none__';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  projectId: string;
  /** Edit this box; create a new one when absent. */
  box?: StagingContainerView | null;
  tasks: StagingTaskOption[];
  locations: StagingLocationOption[];
}

const isError = (value: unknown) => isActionMessageError(value) || isActionPermissionError(value);

export default function BoxFormDialog({ isOpen, onClose, onSaved, projectId, box, tasks, locations }: Props) {
  const { t } = useTranslation(['features/projects', 'common']);
  const st = useCallback((key: string, fallback: string, options?: Record<string, unknown>) =>
    t(`staging.boxForm.${key}`, { defaultValue: fallback, ...(options ?? {}) }), [t]);
  const [name, setName] = useState('');
  const [taskId, setTaskId] = useState(NONE);
  const [locationId, setLocationId] = useState(NONE);
  const [locationNote, setLocationNote] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName(box?.name ?? '');
    setTaskId(box?.task_id ?? NONE);
    setLocationId(box?.stock_location_id ?? NONE);
    setLocationNote(box?.location_note ?? '');
    setNotes(box?.notes ?? '');
    setError(null);
  }, [isOpen, box]);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    const input = {
      name: name.trim() || null,
      task_id: taskId === NONE ? null : taskId,
      stock_location_id: locationId === NONE ? null : locationId,
      location_note: locationNote.trim() || null,
      notes: notes.trim() || null,
    };
    try {
      const result = box
        ? await updateProjectStagingBox(projectId, box.container_id, input)
        : await createProjectStagingBox(projectId, input);
      if (isError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : st('failed', 'Could not save the box.'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog
      id="staging-box-form-dialog"
      isOpen={isOpen}
      onClose={onClose}
      title={box ? st('editTitle', 'Edit box {{identifier}}', { identifier: box.identifier }) : st('createTitle', 'New box')}
    >
      <DialogContent className="space-y-4">
        {!box && (
          <p className="text-sm text-muted-foreground">
            {st('numbering', 'Boxes are numbered in order on this project; a number is never reused.')}
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="staging-box-name">{st('name', 'Name (optional)')}</Label>
          <Input id="staging-box-name" value={name} maxLength={500} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="staging-box-task">{st('task', 'Task')}</Label>
          <CustomSelect
            id="staging-box-task"
            options={[
              { value: NONE, label: st('noTask', 'No task') },
              ...tasks.map((task) => ({ value: task.task_id, label: `${task.phase_name}: ${task.task_name}` })),
            ]}
            value={taskId}
            onValueChange={setTaskId}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="staging-box-location">{st('location', 'Where the box is')}</Label>
            <CustomSelect
              id="staging-box-location"
              options={[{ value: NONE, label: st('noLocation', 'Not set') }, ...locations.map((l) => ({ value: l.location_id, label: l.name }))]}
              value={locationId}
              onValueChange={setLocationId}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="staging-box-location-note">{st('locationNote', 'Shelf / bay')}</Label>
            <Input id="staging-box-location-note" value={locationNote} maxLength={500} onChange={(e) => setLocationNote(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="staging-box-notes">{st('notes', 'Notes (printed on the manifest)')}</Label>
          <Input id="staging-box-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && (
          <Alert variant="destructive" id="staging-box-form-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogContent>
      <DialogFooter>
        <Button id="staging-box-form-cancel" variant="outline" onClick={onClose}>
          {t('common:actions.cancel', 'Cancel')}
        </Button>
        <Button id="staging-box-form-submit" onClick={handleSave} disabled={isSaving}>
          {isSaving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          {box ? t('common:actions.save', 'Save') : st('create', 'Create box')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
