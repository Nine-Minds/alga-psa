'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@alga-psa/ui/components/Button';
import { AddStatusDialog } from './AddStatusDialog';
import {
  getProjectStatusMappings,
  deleteProjectStatusMapping,
  reorderProjectStatuses
} from '../../../actions/projectTaskStatusActions';
import type { IProjectStatusMapping } from '@alga-psa/types';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

interface ProjectTaskStatusSettingsProps {
  projectId: string;
}

export function ProjectTaskStatusSettings({ projectId }: ProjectTaskStatusSettingsProps) {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<IProjectStatusMapping[]>([]);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStatuses();
  }, [projectId]);

  async function loadStatuses() {
    setLoading(true);
    try {
      const data = await getProjectStatusMappings(projectId);
      setStatuses(data);
    } catch (error) {
      console.error('Failed to load statuses:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;

    const newStatuses = [...statuses];
    [newStatuses[index - 1], newStatuses[index]] = [newStatuses[index], newStatuses[index - 1]];

    // Update display_order
    const updates = newStatuses.map((item, idx) => ({
      mapping_id: item.project_status_mapping_id,
      display_order: idx + 1
    }));

    setStatuses(newStatuses);

    try {
      await reorderProjectStatuses(projectId, updates);
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      loadStatuses(); // Reload on error
    }
  }

  async function handleMoveDown(index: number) {
    if (index === statuses.length - 1) return;

    const newStatuses = [...statuses];
    [newStatuses[index], newStatuses[index + 1]] = [newStatuses[index + 1], newStatuses[index]];

    // Update display_order
    const updates = newStatuses.map((item, idx) => ({
      mapping_id: item.project_status_mapping_id,
      display_order: idx + 1
    }));

    setStatuses(newStatuses);

    try {
      await reorderProjectStatuses(projectId, updates);
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      loadStatuses(); // Reload on error
    }
  }

  async function handleDelete(mappingId: string, statusName: string) {
    if (!confirm(t('projects.settings.statuses.confirm_delete', { statusName }))) {
      return;
    }

    try {
      await deleteProjectStatusMapping(mappingId);
      setStatuses(statuses.filter(s => s.project_status_mapping_id !== mappingId));
    } catch (error: any) {
      alert(error.message || t('projects.settings.statuses.delete_error'));
    }
  }

  if (loading) {
    return <div className="p-4">{t('common.loading')}...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">
            {t('projects.settings.statuses.project.title')}
          </h2>
          <p className="text-sm text-gray-600 mt-1">
            {t('projects.settings.statuses.project.description')}
          </p>
        </div>
        <Button onClick={() => setShowAddDialog(true)} id="add-status-button">
          {t('projects.settings.statuses.project.add_from_library')}
        </Button>
      </div>

      <div className="space-y-2">
        {statuses.map((status, index) => {
          const displayName = status.custom_name || status.status_name || status.name || 'Unnamed Status';
          return (
            <div
              key={status.project_status_mapping_id}
              className="flex items-center justify-between p-4 bg-white border rounded-lg hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="p-1 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t('common.move_up')}
                    id={`move-up-${status.project_status_mapping_id}`}
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index === statuses.length - 1}
                    className="p-1 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t('common.move_down')}
                    id={`move-down-${status.project_status_mapping_id}`}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <span className="font-medium">{displayName}</span>
                  {status.is_closed && (
                    <span className="ml-2 text-xs px-2 py-1 bg-gray-200 rounded">
                      {t('projects.settings.statuses.closed')}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(status.project_status_mapping_id, displayName)}
                  id={`delete-status-${status.project_status_mapping_id}`}
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {showAddDialog && (
        <AddStatusDialog
          projectId={projectId}
          onClose={() => setShowAddDialog(false)}
          onAdded={loadStatuses}
        />
      )}
    </div>
  );
}
