'use client';

import React, { useState } from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Calendar, Zap, MousePointer, Check } from 'lucide-react';

export type WorkflowTriggerType = 'event' | 'scheduled' | 'manual';

export interface CreateWorkflowDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, triggerType: WorkflowTriggerType) => void;
}

interface TriggerTypeOption {
  type: WorkflowTriggerType;
  icon: React.ReactNode;
  title: string;
  description: string;
}

export default function CreateWorkflowDialog({
  isOpen,
  onClose,
  onCreate
}: CreateWorkflowDialogProps) {
  const { t } = useTranslation('msp/workflows');
  const [workflowName, setWorkflowName] = useState('');
  const [selectedType, setSelectedType] = useState<WorkflowTriggerType>('manual');
  const [nameError, setNameError] = useState<string | null>(null);

  const TRIGGER_OPTIONS: TriggerTypeOption[] = [
    {
      type: 'event',
      icon: <Zap className="w-6 h-6" />,
      title: t('automation.createWorkflow.triggers.event.title', { defaultValue: 'Event-based' }),
      description: t('automation.createWorkflow.triggers.event.description', {
        defaultValue: 'Triggered automatically when specific events occur (e.g., ticket created, invoice paid).'
      })
    },
    {
      type: 'scheduled',
      icon: <Calendar className="w-6 h-6" />,
      title: t('automation.createWorkflow.triggers.scheduled.title', { defaultValue: 'Scheduled' }),
      description: t('automation.createWorkflow.triggers.scheduled.description', {
        defaultValue: 'Runs on a recurring schedule using cron expressions (e.g., daily, weekly).'
      })
    },
    {
      type: 'manual',
      icon: <MousePointer className="w-6 h-6" />,
      title: t('automation.createWorkflow.triggers.manual.title', { defaultValue: 'Manual' }),
      description: t('automation.createWorkflow.triggers.manual.description', {
        defaultValue: 'Started on-demand by users or via API calls. No automatic triggers.'
      })
    }
  ];

  const handleCreate = () => {
    const trimmedName = workflowName.trim();
    if (!trimmedName) {
      setNameError(t('automation.createWorkflow.validation.nameRequired', { defaultValue: 'Workflow name is required' }));
      return;
    }
    if (trimmedName.length < 3) {
      setNameError(t('automation.createWorkflow.validation.nameTooShort', { defaultValue: 'Name must be at least 3 characters' }));
      return;
    }
    onCreate(trimmedName, selectedType);
    handleClose();
  };

  const handleClose = () => {
    setWorkflowName('');
    setSelectedType('manual');
    setNameError(null);
    onClose();
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWorkflowName(e.target.value);
    if (nameError) setNameError(null);
  };

  const footer = (
    <div className="flex justify-end space-x-2">
      <Button
        id="cancel-create-workflow"
        variant="outline"
        onClick={handleClose}
      >
        {t('automation.createWorkflow.actions.cancel', { defaultValue: 'Cancel' })}
      </Button>
      <Button
        id="confirm-create-workflow"
        onClick={handleCreate}
      >
        {t('automation.createWorkflow.actions.create', { defaultValue: 'Create Workflow' })}
      </Button>
    </div>
  );

  return (
    <Dialog
      id="create-workflow-dialog"
      isOpen={isOpen}
      onClose={handleClose}
      title={t('automation.createWorkflow.dialogTitle', { defaultValue: 'Create New Workflow' })}
      className="max-w-lg"
      draggable={false}
      footer={footer}
    >
      <div className="space-y-6">
        {/* Workflow Name */}
        <div>
          <Input
            id="new-workflow-name"
            label={t('automation.createWorkflow.fields.name', { defaultValue: 'Workflow Name' })}
            value={workflowName}
            onChange={handleNameChange}
            placeholder={t('automation.createWorkflow.fields.namePlaceholder', { defaultValue: 'e.g., Send Welcome Email' })}
            autoFocus
          />
          {nameError && (
            <p className="mt-1 text-sm text-destructive">{nameError}</p>
          )}
        </div>

        {/* Trigger Type Selection */}
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-3">
            {t('automation.createWorkflow.fields.triggerType', { defaultValue: 'Trigger Type' })}
          </label>
          <div className="space-y-2">
            {TRIGGER_OPTIONS.map((option) => (
              <button
                key={option.type}
                id={`trigger-type-${option.type}`}
                type="button"
                onClick={() => setSelectedType(option.type)}
                className={`
                  w-full p-4 rounded-lg border-2 text-left transition-all
                  ${selectedType === option.type
                    ? 'border-[rgb(var(--color-primary-500))] bg-[rgb(var(--color-primary-50))]'
                    : 'border-[rgb(var(--color-border-200))] hover:border-[rgb(var(--color-border-300))] bg-white'
                  }
                `}
              >
                <div className="flex items-start gap-3">
                  <div className={`
                    flex-shrink-0 p-2 rounded-lg
                    ${selectedType === option.type
                      ? 'bg-[rgb(var(--color-primary-100))] text-[rgb(var(--color-primary-600))]'
                      : 'bg-[rgb(var(--color-border-100))] text-[rgb(var(--color-text-500))]'
                    }
                  `}>
                    {option.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${
                        selectedType === option.type
                          ? 'text-[rgb(var(--color-primary-700))]'
                          : 'text-[rgb(var(--color-text-900))]'
                      }`}>
                        {option.title}
                      </span>
                      {selectedType === option.type && (
                        <Check className="w-4 h-4 text-[rgb(var(--color-primary-600))]" />
                      )}
                    </div>
                    <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
                      {option.description}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

    </Dialog>
  );
}
