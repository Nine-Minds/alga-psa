'use client';

import React, { useState } from 'react';
import { Dialog, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
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

const TRIGGER_OPTIONS: TriggerTypeOption[] = [
  {
    type: 'event',
    icon: <Zap className="w-6 h-6" />,
    title: 'Event-based',
    description: 'Triggered automatically when specific events occur (e.g., ticket created, invoice paid).'
  },
  {
    type: 'scheduled',
    icon: <Calendar className="w-6 h-6" />,
    title: 'Scheduled',
    description: 'Runs on a recurring schedule using cron expressions (e.g., daily, weekly).'
  },
  {
    type: 'manual',
    icon: <MousePointer className="w-6 h-6" />,
    title: 'Manual',
    description: 'Started on-demand by users or via API calls. No automatic triggers.'
  }
];

export default function CreateWorkflowDialog({
  isOpen,
  onClose,
  onCreate
}: CreateWorkflowDialogProps) {
  const [workflowName, setWorkflowName] = useState('');
  const [selectedType, setSelectedType] = useState<WorkflowTriggerType>('manual');
  const [nameError, setNameError] = useState<string | null>(null);

  const handleCreate = () => {
    const trimmedName = workflowName.trim();
    if (!trimmedName) {
      setNameError('Workflow name is required');
      return;
    }
    if (trimmedName.length < 3) {
      setNameError('Name must be at least 3 characters');
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

  return (
    <Dialog
      id="create-workflow-dialog"
      isOpen={isOpen}
      onClose={handleClose}
      title="Create New Workflow"
      className="max-w-lg"
      draggable={false}
    >
      <div className="space-y-6">
        {/* Workflow Name */}
        <div>
          <Input
            id="new-workflow-name"
            label="Workflow Name"
            value={workflowName}
            onChange={handleNameChange}
            placeholder="e.g., Send Welcome Email"
            autoFocus
          />
          {nameError && (
            <p className="mt-1 text-sm text-red-600">{nameError}</p>
          )}
        </div>

        {/* Trigger Type Selection */}
        <div>
          <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-3">
            Trigger Type
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

      <DialogFooter className="mt-6">
        <Button
          id="cancel-create-workflow"
          variant="outline"
          onClick={handleClose}
        >
          Cancel
        </Button>
        <Button
          id="confirm-create-workflow"
          onClick={handleCreate}
        >
          Create Workflow
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
