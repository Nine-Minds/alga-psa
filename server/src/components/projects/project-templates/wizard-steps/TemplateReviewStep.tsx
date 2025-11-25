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

  // Debug logging
  React.useEffect(() => {
    console.log('[TemplateReviewStep] Status mappings:', data.status_mappings);
    console.log('[TemplateReviewStep] Available statuses:', availableStatuses);
  }, [data.status_mappings, availableStatuses]);

  // Helper to add transparency to hex color
  const addTransparency = (hex: string, alpha: number) => {
    // Remove # if present
    const cleanHex = hex.replace('#', '');
    // Convert hex to RGB
    const r = parseInt(cleanHex.substring(0, 2), 16);
    const g = parseInt(cleanHex.substring(2, 4), 16);
    const b = parseInt(cleanHex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

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
      {data.status_mappings.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Circle className="w-5 h-5 text-blue-600" />
            <h4 className="font-semibold">Status Columns ({data.status_mappings.length})</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.status_mappings
              .sort((a, b) => a.display_order - b.display_order)
              .map((mapping, index) => {
                // Get status name
                const statusName = mapping.status_id
                  ? availableStatuses.find(s => s.status_id === mapping.status_id)?.name || mapping.status_id
                  : mapping.custom_status_name;

                // Get status color - prefer system status color, then custom color, then default
                let statusColor = '#6B7280'; // default gray
                if (mapping.status_id) {
                  const systemStatus = availableStatuses.find(s => s.status_id === mapping.status_id);
                  statusColor = systemStatus?.color || '#6B7280';
                  console.log(`[TemplateReviewStep] Status chips - Looking up color for status_id ${mapping.status_id}:`, systemStatus?.color);
                } else if (mapping.custom_status_color && mapping.custom_status_color !== '#6B7280') {
                  statusColor = mapping.custom_status_color;
                }

                return (
                  <div
                    key={mapping.temp_id}
                    className="flex items-center gap-2 px-3 py-2 rounded-full text-sm border-2"
                    style={{
                      backgroundColor: addTransparency(statusColor, 0.15),
                      borderColor: statusColor
                    }}
                  >
                    <Circle
                      className="w-3 h-3"
                      fill={statusColor}
                      stroke={statusColor}
                    />
                    <span className="font-medium">{statusName}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

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

      {/* Task Details by Phase and Status */}
      {data.phases.length > 0 && data.tasks.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h4 className="font-semibold mb-3">Task Details by Phase</h4>
          <div className="space-y-6">
            {data.phases
              .sort((a, b) => a.order_number - b.order_number)
              .map((phase) => {
                const phaseTasks = data.tasks.filter(
                  (t) => t.phase_temp_id === phase.temp_id
                );
                if (phaseTasks.length === 0) return null;

                return (
                  <div key={phase.temp_id}>
                    <h5 className="text-sm font-semibold text-gray-700 mb-3 pb-2 border-b">
                      {phase.phase_name}
                    </h5>

                    {data.status_mappings.length === 0 ? (
                      // Fallback: show tasks as a simple list if no status columns
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
                    ) : (
                      // Show tasks organized by status columns
                      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${data.status_mappings.length}, minmax(0, 1fr))` }}>
                        {data.status_mappings
                          .sort((a, b) => a.display_order - b.display_order)
                          .map((statusMapping, statusIndex) => {
                            // Filter tasks for this status column
                            // Tasks without a status mapping go to the first column
                            const isFirstColumn = statusIndex === 0;
                            const statusTasks = phaseTasks.filter(
                              (task) =>
                                task.template_status_mapping_id === statusMapping.temp_id ||
                                (isFirstColumn && !task.template_status_mapping_id)
                            );

                            const statusName = statusMapping.status_id
                              ? availableStatuses.find(s => s.status_id === statusMapping.status_id)?.name
                              : statusMapping.custom_status_name;

                            // Get status color - prefer system status color, then custom color, then default
                            let statusColor = '#6B7280'; // default gray
                            if (statusMapping.status_id) {
                              const systemStatus = availableStatuses.find(s => s.status_id === statusMapping.status_id);
                              statusColor = systemStatus?.color || '#6B7280';
                            } else if (statusMapping.custom_status_color && statusMapping.custom_status_color !== '#6B7280') {
                              statusColor = statusMapping.custom_status_color;
                            }

                            return (
                              <div key={statusMapping.temp_id} className="border rounded-lg overflow-hidden">
                                {/* Status column header */}
                                <div
                                  className="px-3 py-2 text-xs font-semibold flex items-center justify-between"
                                  style={{
                                    backgroundColor: addTransparency(statusColor, 0.15),
                                    borderBottom: `2px solid ${statusColor}`
                                  }}
                                >
                                  <div className="flex items-center gap-2">
                                    <Circle
                                      className="w-3 h-3"
                                      fill={statusColor}
                                      stroke={statusColor}
                                    />
                                    <span>{statusName}</span>
                                  </div>
                                  <span className="text-gray-500">{statusTasks.length}</span>
                                </div>

                                {/* Tasks in this status */}
                                <div className="p-2 space-y-2 bg-gray-50 min-h-[60px]">
                                  {statusTasks
                                    .sort((a, b) => a.order_number - b.order_number)
                                    .map((task) => {
                                      const taskChecklists = data.checklist_items.filter(
                                        (c) => c.task_temp_id === task.temp_id
                                      );
                                      return (
                                        <div
                                          key={task.temp_id}
                                          className="bg-white p-2 rounded border text-xs"
                                        >
                                          <div className="font-medium text-gray-900 mb-1">
                                            {task.task_name}
                                          </div>
                                          {(task.estimated_hours || taskChecklists.length > 0) && (
                                            <div className="flex gap-2 text-gray-500">
                                              {task.estimated_hours && (
                                                <span>{task.estimated_hours}h</span>
                                              )}
                                              {taskChecklists.length > 0 && (
                                                <span>{taskChecklists.length} items</span>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    )}
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
