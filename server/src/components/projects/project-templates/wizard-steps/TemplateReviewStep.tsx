'use client';

import React from 'react';
import { FileText, Layers, CheckSquare, Circle } from 'lucide-react';
import { TemplateWizardData } from '../TemplateCreationWizard';

interface TemplateReviewStepProps {
  data: TemplateWizardData;
  availableStatuses: Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>;
}

export function TemplateReviewStep({ data, availableStatuses }: TemplateReviewStepProps) {
  const totalTasks = data.tasks.length;
  const totalChecklistItems = data.checklist_items.length;
  const totalEstimatedHours = data.tasks.reduce(
    (sum, task) => sum + (task.estimated_hours || 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">Review Your Template</h3>
        <p className="text-sm text-gray-600">
          Review your template details before creating. You can edit any section by going back.
        </p>
      </div>

      {/* Template Basics */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-5 h-5 text-purple-600" />
          <h4 className="font-semibold">Template Information</h4>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-600">Name:</dt>
            <dd className="font-medium">{data.template_name}</dd>
          </div>
          {data.description && (
            <div className="flex justify-between">
              <dt className="text-gray-600">Description:</dt>
              <dd className="font-medium text-right max-w-md">{data.description}</dd>
            </div>
          )}
          {data.category && (
            <div className="flex justify-between">
              <dt className="text-gray-600">Category:</dt>
              <dd className="font-medium">{data.category}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Status Columns */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Circle className="w-5 h-5 text-blue-600" />
          <h4 className="font-semibold">Status Columns</h4>
        </div>
        {data.status_mappings.length === 0 ? (
          <p className="text-sm text-gray-500">No status columns defined</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.status_mappings
              .sort((a, b) => a.display_order - b.display_order)
              .map((mapping, index) => {
                const statusName = mapping.status_id
                  ? availableStatuses.find(s => s.status_id === mapping.status_id)?.name || mapping.status_id
                  : mapping.custom_status_name;

                return (
                  <div
                    key={mapping.temp_id}
                    className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full text-sm"
                  >
                    <span className="text-gray-600">{index + 1}.</span>
                    <span className="font-medium">{statusName}</span>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Phases Summary */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-5 h-5 text-green-600" />
          <h4 className="font-semibold">Phases ({data.phases.length})</h4>
        </div>
        {data.phases.length === 0 ? (
          <p className="text-sm text-gray-500">No phases defined</p>
        ) : (
          <div className="space-y-3">
            {data.phases
              .sort((a, b) => a.order_number - b.order_number)
              .map((phase, index) => {
                const phaseTasks = data.tasks.filter((t) => t.phase_temp_id === phase.temp_id);
                return (
                  <div key={phase.temp_id} className="border-l-4 border-green-500 pl-4">
                    <div className="font-medium">
                      {index + 1}. {phase.phase_name}
                    </div>
                    {phase.description && (
                      <p className="text-sm text-gray-600 mt-1">{phase.description}</p>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-gray-600">
                      {phase.duration_days && <span>{phase.duration_days} days</span>}
                      {phase.start_offset_days > 0 && (
                        <span>Starts: +{phase.start_offset_days} days</span>
                      )}
                      <span>{phaseTasks.length} tasks</span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Tasks Summary */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <CheckSquare className="w-5 h-5 text-orange-600" />
          <h4 className="font-semibold">Tasks Summary</h4>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="p-3 bg-orange-50 rounded-lg">
            <div className="text-2xl font-bold text-orange-600">{totalTasks}</div>
            <div className="text-xs text-gray-600">Total Tasks</div>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="text-2xl font-bold text-blue-600">{totalChecklistItems}</div>
            <div className="text-xs text-gray-600">Checklist Items</div>
          </div>
          <div className="p-3 bg-green-50 rounded-lg">
            <div className="text-2xl font-bold text-green-600">
              {totalEstimatedHours.toFixed(1)}h
            </div>
            <div className="text-xs text-gray-600">Est. Hours</div>
          </div>
        </div>
      </div>

      {/* Task Details by Phase */}
      {data.phases.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h4 className="font-semibold mb-3">Task Details</h4>
          <div className="space-y-4">
            {data.phases
              .sort((a, b) => a.order_number - b.order_number)
              .map((phase) => {
                const phaseTasks = data.tasks.filter(
                  (t) => t.phase_temp_id === phase.temp_id
                );
                if (phaseTasks.length === 0) return null;

                return (
                  <div key={phase.temp_id}>
                    <h5 className="text-sm font-semibold text-gray-700 mb-2">
                      {phase.phase_name}
                    </h5>
                    <ul className="space-y-1 pl-4">
                      {phaseTasks
                        .sort((a, b) => a.order_number - b.order_number)
                        .map((task, index) => {
                          const taskChecklists = data.checklist_items.filter(
                            (c) => c.task_temp_id === task.temp_id
                          );
                          return (
                            <li key={task.temp_id} className="text-sm flex items-start gap-2">
                              <span className="text-gray-400">{index + 1}.</span>
                              <div className="flex-1">
                                <span className="font-medium">{task.task_name}</span>
                                {task.estimated_hours && (
                                  <span className="text-gray-500 ml-2">
                                    ({task.estimated_hours}h)
                                  </span>
                                )}
                                {taskChecklists.length > 0 && (
                                  <span className="text-gray-500 ml-2">
                                    [{taskChecklists.length} items]
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                    </ul>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h4 className="font-medium text-green-900 mb-2">Ready to Create</h4>
        <p className="text-sm text-green-800">
          Once you create this template, you'll be able to use it to quickly start new projects
          with this structure. Click "Create Template" to finish.
        </p>
      </div>
    </div>
  );
}
