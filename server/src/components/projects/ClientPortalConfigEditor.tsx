'use client';

import React from 'react';
import { IClientPortalConfig, CONFIGURABLE_TASK_FIELDS } from 'server/src/interfaces/project.interfaces';
import { Switch } from 'server/src/components/ui/Switch';
import { Checkbox } from 'server/src/components/ui/Checkbox';

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

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-gray-900 mb-3">
          Client Portal Visibility
        </h4>
        <p className="text-sm text-gray-500 mb-4">
          Configure what clients can see about this project in their portal. Basic project information (name, description, dates, overall progress) is always visible.
        </p>
      </div>

      <div className="space-y-4 border-l-2 border-gray-200 pl-4">
        {/* Show Phases Toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <label htmlFor="show-phases" className="text-sm font-medium text-gray-700">
                Show Phases
              </label>
              <p className="text-xs text-gray-500">
                Display project phase breakdown to clients
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
                  show_tasks: checked ? config.show_tasks : false,
                  show_task_services: checked && config.show_tasks ? config.show_task_services : false,
                  allow_document_uploads: checked && config.show_tasks ? config.allow_document_uploads : false
                });
              }}
              disabled={disabled}
            />
          </div>

          {/* Show Phase Completion (nested under Show Phases) */}
          {config.show_phases && (
            <div className="ml-6 border-l-2 border-gray-200 pl-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label htmlFor="show-phase-completion" className="text-sm font-medium text-gray-700">
                    Show Completion %
                  </label>
                  <p className="text-xs text-gray-500">
                    Show task completion percentage per phase
                  </p>
                </div>
                <Switch
                  id="show-phase-completion"
                  checked={config.show_phase_completion}
                  onCheckedChange={(checked) => updateConfig({ show_phase_completion: checked })}
                  disabled={disabled || !config.show_phases}
                />
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
                Display individual tasks to clients
              </p>
            </div>
            <Switch
              id="show-tasks"
              checked={config.show_tasks}
              onCheckedChange={(checked) => {
                updateConfig({
                  show_tasks: checked,
                  // Auto-disable dependent options when parent is disabled
                  show_task_services: checked ? config.show_task_services : false,
                  allow_document_uploads: checked ? config.allow_document_uploads : false
                });
              }}
              disabled={disabled || !config.show_phases}
            />
          </div>

          {/* Task Fields Selection (nested under Show Tasks) */}
          {config.show_tasks && config.show_phases && (
            <div className="ml-6 border-l-2 border-gray-200 pl-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-2">
                  Visible Task Fields
                </label>
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

              {/* Show Services (nested under Show Tasks) */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label htmlFor="show-services" className="text-sm font-medium text-gray-700">
                    Show Services
                  </label>
                  <p className="text-xs text-gray-500">
                    Display associated services on tasks for billing transparency
                  </p>
                </div>
                <Switch
                  id="show-services"
                  checked={config.show_task_services}
                  onCheckedChange={(checked) => updateConfig({ show_task_services: checked })}
                  disabled={disabled || !config.show_tasks}
                />
              </div>

              {/* Allow Document Uploads (nested under Show Tasks) */}
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label htmlFor="allow-uploads" className="text-sm font-medium text-gray-700">
                    Allow Document Uploads
                  </label>
                  <p className="text-xs text-gray-500">
                    Let clients attach documents to tasks
                  </p>
                </div>
                <Switch
                  id="allow-uploads"
                  checked={config.allow_document_uploads}
                  onCheckedChange={(checked) => updateConfig({ allow_document_uploads: checked })}
                  disabled={disabled || !config.show_tasks}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
