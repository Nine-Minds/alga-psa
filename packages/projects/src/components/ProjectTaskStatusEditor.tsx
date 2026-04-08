'use client';

import { useState, useEffect } from 'react';
import { IStatus } from '@alga-psa/types';
import { IProjectStatusMapping } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { ChevronUp, ChevronDown, Plus, X, ChevronRight } from 'lucide-react';
import {
  getProjectStatusMappings,
  getTenantProjectStatuses,
  addStatusToProject,
  deleteProjectStatusMapping,
  reorderProjectStatuses
} from '../actions/projectTaskStatusActions';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';

interface ProjectTaskStatusEditorProps {
  projectId: string;
  phaseId?: string | null;
  error?: string;
  onChange?: () => void;
}

export function ProjectTaskStatusEditor({
  projectId,
  phaseId,
  error,
  onChange
}: ProjectTaskStatusEditorProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [showAvailableList, setShowAvailableList] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [availableStatuses, setAvailableStatuses] = useState<IStatus[]>([]);
  const [projectStatusMappings, setProjectStatusMappings] = useState<IProjectStatusMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        const [mappings, tenantStatuses] = await Promise.all([
          getProjectStatusMappings(projectId, phaseId),
          getTenantProjectStatuses()
        ]);
        setProjectStatusMappings(mappings);
        setAvailableStatuses(tenantStatuses);
      } catch (error) {
        handleError(error, t('settings.statuses.load_task_statuses_failed', 'Failed to load task statuses'));
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [projectId, phaseId, t]);

  // Get status details by ID from tenant library
  const getStatusDetails = (statusId: string) => {
    return availableStatuses.find(s => s.status_id === statusId);
  };

  // Add a status to the project
  const addStatus = async (statusId: string) => {
    if (projectStatusMappings.find(m => m.status_id === statusId)) {
      toast.error(t('settings.statuses.already_added', 'Status already added'));
      return;
    }

    try {
      const newMapping = await addStatusToProject(projectId, {
        status_id: statusId,
        is_visible: true
      }, phaseId);

      setProjectStatusMappings([...projectStatusMappings, newMapping]);

      // Close the dropdown if this was the last unselected status
      const remainingUnselected = availableStatuses.filter(
        s => s.status_id !== statusId && !projectStatusMappings.find(m => m.status_id === s.status_id)
      );
      if (remainingUnselected.length === 0) {
        setShowAvailableList(false);
      }

      onChange?.();
      toast.success(t('settings.statuses.added_success', 'Status added successfully'));
    } catch (error) {
      handleError(error, t('settings.statuses.add_task_status_failed', 'Failed to add status'));
    }
  };

  // Remove a status from the project
  const removeStatus = async (mappingId: string) => {
    try {
      await deleteProjectStatusMapping(mappingId);
      setProjectStatusMappings(projectStatusMappings.filter(m => m.project_status_mapping_id !== mappingId));
      onChange?.();
      toast.success(t('settings.statuses.removed_success', 'Status removed successfully'));
    } catch (error) {
      handleError(error, t('settings.statuses.remove_task_status_failed', 'Failed to remove status'));
    }
  };

  // Move status up in order
  const moveUp = async (index: number) => {
    if (index === 0) return;

    const newMappings = [...projectStatusMappings];
    [newMappings[index - 1], newMappings[index]] = [newMappings[index], newMappings[index - 1]];

    // Update display_order to match new positions
    const statusOrder = newMappings.map((m, idx) => ({
      mapping_id: m.project_status_mapping_id,
      display_order: idx + 1
    }));

    try {
      await reorderProjectStatuses(projectId, statusOrder, phaseId);
      

      // Update local state with new order
      const reordered = newMappings.map((m, idx) => ({
        ...m,
        display_order: idx + 1
      }));
      setProjectStatusMappings(reordered);
      onChange?.();
    } catch (error) {
      handleError(error, t('settings.statuses.reorder_failed', 'Failed to reorder statuses'));
    }
  };

  // Move status down in order
  const moveDown = async (index: number) => {
    if (index === projectStatusMappings.length - 1) return;

    const newMappings = [...projectStatusMappings];
    [newMappings[index], newMappings[index + 1]] = [newMappings[index + 1], newMappings[index]];

    // Update display_order to match new positions
    const statusOrder = newMappings.map((m, idx) => ({
      mapping_id: m.project_status_mapping_id,
      display_order: idx + 1
    }));

    try {
      await reorderProjectStatuses(projectId, statusOrder, phaseId);
      

      // Update local state with new order
      const reordered = newMappings.map((m, idx) => ({
        ...m,
        display_order: idx + 1
      }));
      setProjectStatusMappings(reordered);
      onChange?.();
    } catch (error) {
      handleError(error, t('settings.statuses.reorder_failed', 'Failed to reorder statuses'));
    }
  };

  // Get unselected statuses
  const unselectedStatuses = availableStatuses.filter(
    status => !projectStatusMappings.find(m => m.status_id === status.status_id)
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700">
          {phaseId
            ? t('settings.statuses.phase_task_statuses_label', 'Phase Task Statuses')
            : t('settings.statuses.task_statuses_label', 'Task Statuses')}
        </label>
        <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded-lg border">
          {t('settings.statuses.loading', 'Loading...')}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label className="block text-sm font-medium text-gray-700">
          {phaseId
            ? t('settings.statuses.phase_task_statuses_label', 'Phase Task Statuses')
            : t('settings.statuses.task_statuses_label', 'Task Statuses')}
        </label>
        {!isExpanded && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(true)}
            id="customize-task-statuses-button"
          >
            <ChevronRight className="w-4 h-4 mr-1" />
            {t('settings.statuses.customize', 'Customize')}
          </Button>
        )}
      </div>

      {/* Collapsed view - show summary only */}
      {!isExpanded && projectStatusMappings.length > 0 && (
        <div className="text-sm text-gray-600 p-3 bg-gray-50 rounded-lg border">
          <div className="flex items-center gap-2 flex-wrap">
            {projectStatusMappings.map((mapping, index) => {
              const status = getStatusDetails(mapping.status_id!);
              if (!status) return null;
              return (
                <span key={mapping.project_status_mapping_id}>
                  {status.name}
                  {index < projectStatusMappings.length - 1 && (
                    <ChevronRight className="w-3 h-3 inline mx-1 text-gray-400" />
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Expanded view - full customization */}
      {isExpanded && (
        <>
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-gray-600">
              {phaseId
                ? t('settings.statuses.customize_phase', 'Customize task statuses for this phase')
                : t('settings.statuses.customize_project', 'Customize task statuses for this project')}
            </span>
            {unselectedStatuses.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowAvailableList(!showAvailableList)}
                id="toggle-available-task-statuses"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {t('settings.statuses.add_from_library', 'Add Status')}
                </Button>
              )}
          </div>

          {/* Available statuses dropdown */}
          {showAvailableList && unselectedStatuses.length > 0 && (
            <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
              <div className="text-xs font-medium text-gray-600 mb-2">
                {t('settings.statuses.available_statuses_click_add', 'Available Statuses (click to add):')}
              </div>
              {unselectedStatuses.map((status) => (
                <button
                  key={status.status_id}
                  type="button"
                  onClick={() => addStatus(status.status_id)}
                  className="w-full text-left px-3 py-2 text-sm bg-[rgb(var(--color-card))] border rounded hover:bg-primary/10 hover:border-primary/30 transition-colors"
                  id={`add-task-status-${status.status_id}`}
                >
                  {status.name}
                    {status.is_closed && (
                      <span className="ml-2 text-xs px-2 py-0.5 bg-gray-200 rounded">
                        {t('settings.statuses.closed', 'Closed')}
                      </span>
                    )}
                </button>
              ))}
            </div>
          )}

          {/* Selected statuses list */}
          {projectStatusMappings.length > 0 ? (
            <div className="border rounded-lg divide-y">
              {projectStatusMappings.map((mapping, index) => {
                const status = getStatusDetails(mapping.status_id!);
                if (!status) return null;

                return (
                  <div
                    key={mapping.project_status_mapping_id}
                    className="flex items-center gap-2 p-3 bg-white hover:bg-gray-50"
                  >
                    {/* Reorder buttons */}
                    <div className="flex flex-col gap-0.5">
                      <button
                        type="button"
                        onClick={() => moveUp(index)}
                        disabled={index === 0}
                        className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title={t('settings.statuses.move_up', 'Move up')}
                        id={`move-up-task-status-${status.status_id}`}
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(index)}
                        disabled={index === projectStatusMappings.length - 1}
                        className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                        title={t('settings.statuses.move_down', 'Move down')}
                        id={`move-down-task-status-${status.status_id}`}
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Status info */}
                    <div className="flex-1 text-sm">
                      <span className="font-medium">{status.name}</span>
                      {status.is_closed && (
                        <span className="ml-2 text-xs px-2 py-0.5 bg-gray-200 rounded">
                          {t('settings.statuses.closed', 'Closed')}
                        </span>
                      )}
                    </div>

                    {/* Order number */}
                    <div className="text-xs text-gray-500 w-8 text-center">
                      #{index + 1}
                    </div>

                    {/* Remove button */}
                    <button
                      type="button"
                      onClick={() => removeStatus(mapping.project_status_mapping_id)}
                      className="p-1 hover:bg-destructive/15 rounded text-destructive"
                      title={t('settings.statuses.remove', 'Remove status')}
                      id={`remove-task-status-${status.status_id}`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-gray-500 p-4 bg-gray-50 rounded-lg border-2 border-dashed">
              <p className="font-medium mb-1">
                {t('settings.statuses.none_selected', 'No statuses selected')}
              </p>
              <p className="text-xs">
                {t('settings.statuses.none_selected_hint', 'Click "Add Status" to add statuses to your project.')}
              </p>
            </div>
          )}

          <p className="text-xs text-gray-500 mt-2">
            {t('settings.statuses.arrange_hint', 'Arrange statuses in the order tasks will flow through them.')}
          </p>
        </>
      )}

      {/* Error message */}
      {error && (
        <p className="text-xs text-destructive mt-1">{error}</p>
      )}
    </div>
  );
}
