'use client';

import React from 'react';
import { IClientPortalConfig, CONFIGURABLE_TASK_FIELDS } from 'server/src/interfaces/project.interfaces';
import { Switch } from 'server/src/components/ui/Switch';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { Alert, AlertDescription, AlertTitle } from 'server/src/components/ui/Alert';

interface ClientPortalConfigEditorProps {
  config: IClientPortalConfig;
  onChange: (config: IClientPortalConfig) => void;
  disabled?: boolean;
}

export default function ClientPortalConfigEditor({
  config,
  onChange,
  disabled = false
}: ClientPortalConfigEditorProps) {

  const updateConfig = (updates: Partial<IClientPortalConfig>) => {
    onChange({ ...config, ...updates });
  };

  const toggleTaskField = (fieldKey: string) => {
    const currentFields = config.visible_task_fields || [];
    const newFields = currentFields.includes(fieldKey)
      ? currentFields.filter(f => f !== fieldKey)
      : [...currentFields, fieldKey];
    updateConfig({ visible_task_fields: newFields });
  };

  // Helper to generate summary of what clients will see
  const getVisibilitySummary = (): string[] => {
    const summary: string[] = ['Project name, description, dates, and overall progress'];

    if (config.show_phases) {
      summary.push('Phase names, descriptions, and date ranges');
      if (config.show_phase_completion) {
        summary.push('Completion percentage for each phase');
      }
    }

    if (config.show_tasks && config.show_phases) {
      const fields = config.visible_task_fields || [];
      const fieldLabels: string[] = [];
      if (fields.includes('task_name')) fieldLabels.push('task names');
      if (fields.includes('description')) fieldLabels.push('descriptions');
      if (fields.includes('due_date')) fieldLabels.push('due dates');
      if (fields.includes('status')) fieldLabels.push('status');
      if (fields.includes('assigned_to')) fieldLabels.push('assignees');
      if (fields.includes('estimated_hours')) fieldLabels.push('estimated hours');
      if (fields.includes('actual_hours')) fieldLabels.push('actual hours');
      if (fields.includes('priority')) fieldLabels.push('priority');
      if (fields.includes('checklist_progress')) fieldLabels.push('checklist progress');
      if (fields.includes('dependencies')) fieldLabels.push('task dependencies');
      if (fields.includes('document_uploads')) fieldLabels.push('document uploads');

      if (fieldLabels.length > 0) {
        summary.push(`Task details: ${fieldLabels.join(', ')}`);
      }
    }

    return summary;
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Configure what clients can see about this project in their portal.
      </p>

      {/* What clients will see summary */}
      <Alert variant="info">
        <AlertTitle>Clients will see:</AlertTitle>
        <AlertDescription>
          <ul className="space-y-1 mt-1">
            {getVisibilitySummary().map((item, index) => (
              <li key={index} className="flex items-start gap-1.5">
                <span className="mt-0.5">•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>

      <div className="space-y-4 border-l-2 border-gray-200 pl-4">
        {/* Show Phases Toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label htmlFor="show-phases" className="text-sm font-medium text-gray-700">
                Show Phases
              </label>
              <p className="text-xs text-gray-500">
                Clients will see phase cards with names, descriptions, and date ranges. They can select phases to view associated tasks.
              </p>
            </div>
            <Switch
              id="show-phases"
              checked={config.show_phases}
              onCheckedChange={(checked) => {
                updateConfig({
                  show_phases: checked,
                  // Auto-disable dependent options when parent is disabled
                  show_phase_completion: checked ? config.show_phase_completion : false,
                  show_tasks: checked ? config.show_tasks : false
                });
              }}
              disabled={disabled}
            />
          </div>

          {/* Show Phase Completion (nested under Show Phases) */}
          {config.show_phases && (
            <div className="ml-6 border-l-2 border-gray-200 pl-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="show-phase-completion"
                  checked={config.show_phase_completion}
                  onChange={(e) => updateConfig({ show_phase_completion: e.target.checked })}
                  disabled={disabled || !config.show_phases}
                  containerClassName=""
                />
                <div>
                  <label htmlFor="show-phase-completion" className="text-sm font-medium text-gray-700">
                    Show Completion %
                  </label>
                  <p className="text-xs text-gray-500">
                    Display a progress bar and percentage showing how many tasks are completed in each phase.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Show Tasks Toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label htmlFor="show-tasks" className="text-sm font-medium text-gray-700">
                Show Tasks
              </label>
              <p className="text-xs text-gray-500">
                Clients can view individual tasks within each phase. Tasks are displayed in a Kanban board or list view grouped by status.
              </p>
            </div>
            <Switch
              id="show-tasks"
              checked={config.show_tasks}
              onCheckedChange={(checked) => updateConfig({ show_tasks: checked })}
              disabled={disabled || !config.show_phases}
            />
          </div>

          {/* Task Fields Selection (nested under Show Tasks) */}
          {config.show_tasks && config.show_phases && (
            <div className="ml-6 border-l-2 border-gray-200 pl-4">
              <label className="text-sm font-medium text-gray-700 block mb-1">
                Visible Task Fields
              </label>
              <p className="text-xs text-gray-500 mb-3">
                Select which task details are visible to clients. Unchecked fields will be hidden from task cards.
              </p>
              <div className="space-y-2">
                {CONFIGURABLE_TASK_FIELDS.map(field => (
                  <div key={field.key} className="flex items-center">
                    <Checkbox
                      id={`field-${field.key}`}
                      checked={(config.visible_task_fields ?? []).includes(field.key)}
                      onChange={() => toggleTaskField(field.key)}
                      disabled={disabled || field.required}
                      containerClassName=""
                    />
                    <label
                      htmlFor={`field-${field.key}`}
                      className={`ml-2 text-sm ${field.required ? 'text-gray-500' : 'text-gray-700'}`}
                    >
                      {field.label}
                      {field.required && <span className="text-xs ml-1">(required)</span>}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
