'use client';

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { AddStatusDialog } from './AddStatusDialog';
import {
  getProjectStatusMappings,
  deleteProjectStatusMapping,
  reorderProjectStatuses,
  copyProjectStatusesToPhase,
  removePhaseStatuses
} from '@alga-psa/projects/actions/projectTaskStatusActions';
import { getProjectMetadata } from '@alga-psa/projects/actions/projectActions';
import type { IProjectPhase, IProjectStatusMapping } from '@alga-psa/types';
import { ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

interface ProjectTaskStatusSettingsProps {
  projectId: string;
}

const DEFAULT_SCOPE = '__project_defaults__';

export function ProjectTaskStatusSettings({ projectId }: ProjectTaskStatusSettingsProps) {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<IProjectStatusMapping[]>([]);
  const [projectDefaultStatuses, setProjectDefaultStatuses] = useState<IProjectStatusMapping[]>([]);
  const [phases, setPhases] = useState<IProjectPhase[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>(DEFAULT_SCOPE);
  const [hasCustomStatuses, setHasCustomStatuses] = useState(false);
  const [showCustomSetup, setShowCustomSetup] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ mappingId: string; statusName: string } | null>(null);
  const [revertConfirmation, setRevertConfirmation] = useState(false);

  const selectedPhaseId = selectedScope === DEFAULT_SCOPE ? null : selectedScope;

  useEffect(() => {
    loadStatuses();
  }, [projectId, selectedScope]);

  useEffect(() => {
    loadPhases();
  }, [projectId]);

  useEffect(() => {
    setShowCustomSetup(false);
  }, [selectedScope]);

  async function loadPhases() {
    try {
      const metadata = await getProjectMetadata(projectId);
      if (metadata && 'phases' in metadata) {
        setPhases(metadata.phases);
      }
    } catch (error) {
      console.error('Failed to load project phases:', error);
    }
  }

  async function loadStatuses() {
    setLoading(true);
    try {
      const defaults = await getProjectStatusMappings(projectId);
      setProjectDefaultStatuses(defaults);

      if (selectedPhaseId) {
        const phaseStatuses = await getProjectStatusMappings(projectId, selectedPhaseId);
        const phaseHasCustomStatuses = phaseStatuses.length > 0;
        setHasCustomStatuses(phaseHasCustomStatuses);
        setStatuses(phaseHasCustomStatuses ? phaseStatuses : defaults);
      } else {
        setHasCustomStatuses(true);
        setStatuses(defaults);
      }
    } catch (error) {
      console.error('Failed to load statuses:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;
    if (selectedPhaseId && !hasCustomStatuses) return;

    const newStatuses = [...statuses];
    [newStatuses[index - 1], newStatuses[index]] = [newStatuses[index], newStatuses[index - 1]];

    // Update display_order
    const updates = newStatuses.map((item, idx) => ({
      mapping_id: item.project_status_mapping_id,
      display_order: idx + 1
    }));

    setStatuses(newStatuses);

    try {
      await reorderProjectStatuses(projectId, updates, selectedPhaseId);
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      loadStatuses(); // Reload on error
    }
  }

  async function handleMoveDown(index: number) {
    if (index === statuses.length - 1) return;
    if (selectedPhaseId && !hasCustomStatuses) return;

    const newStatuses = [...statuses];
    [newStatuses[index], newStatuses[index + 1]] = [newStatuses[index + 1], newStatuses[index]];

    // Update display_order
    const updates = newStatuses.map((item, idx) => ({
      mapping_id: item.project_status_mapping_id,
      display_order: idx + 1
    }));

    setStatuses(newStatuses);

    try {
      await reorderProjectStatuses(projectId, updates, selectedPhaseId);
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      loadStatuses(); // Reload on error
    }
  }

  async function handleDelete() {
    if (!deleteConfirmation) return;

    setIsMutating(true);
    try {
      await deleteProjectStatusMapping(deleteConfirmation.mappingId);
      setStatuses(statuses.filter(s => s.project_status_mapping_id !== deleteConfirmation.mappingId));
    } catch (error: any) {
      alert(error.message || t('projects.settings.statuses.delete_error'));
    } finally {
      setIsMutating(false);
      setDeleteConfirmation(null);
    }
  }

  async function handleEnableCustomStatuses() {
    if (!selectedPhaseId) return;
    setShowCustomSetup(true);
  }

  async function handleCopyDefaultsToPhase() {
    if (!selectedPhaseId || isMutating) return;

    setIsMutating(true);
    try {
      await copyProjectStatusesToPhase(projectId, selectedPhaseId);
      setShowCustomSetup(false);
      await loadStatuses();
    } catch (error) {
      console.error('Failed to copy project defaults to phase:', error);
      alert('Failed to copy project defaults to this phase.');
    } finally {
      setIsMutating(false);
    }
  }

  async function handleRevertToDefaults() {
    if (!selectedPhaseId || !hasCustomStatuses) return;

    setIsMutating(true);
    try {
      await removePhaseStatuses(selectedPhaseId);
      await loadStatuses();
    } catch (error) {
      console.error('Failed to remove phase statuses:', error);
      alert('Failed to revert this phase to project defaults.');
    } finally {
      setIsMutating(false);
      setRevertConfirmation(false);
    }
  }

  if (loading) {
    return <div className="p-4">{t('common.loading')}...</div>;
  }

  const scopeOptions = [
    { value: DEFAULT_SCOPE, label: 'Project Defaults' },
    ...phases.map((phase) => ({
      value: phase.phase_id,
      label: phase.phase_name
    }))
  ];

  const isUsingProjectDefaults = Boolean(selectedPhaseId) && !hasCustomStatuses;
  const canMutateStatuses = !selectedPhaseId || hasCustomStatuses;

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
        <Button
          onClick={() => setShowAddDialog(true)}
          id="add-status-button"
          disabled={Boolean(selectedPhaseId) && !hasCustomStatuses && !showCustomSetup}
        >
          {t('projects.settings.statuses.project.add_from_library')}
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
        <div>
          <label className="mb-2 block text-sm font-medium">Status Scope</label>
          <CustomSelect
            value={selectedScope}
            onValueChange={setSelectedScope}
            options={scopeOptions}
            placeholder="Select a status scope"
            id="phase-status-scope-select"
          />
        </div>

        {selectedPhaseId && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                variant={isUsingProjectDefaults ? 'default' : 'outline'}
                onClick={() => setRevertConfirmation(true)}
                disabled={isUsingProjectDefaults || isMutating}
                id="use-project-defaults-button"
              >
                Use project defaults
              </Button>
              <Button
                variant={!isUsingProjectDefaults ? 'default' : 'outline'}
                onClick={handleEnableCustomStatuses}
                id="use-custom-statuses-button"
              >
                Custom statuses
              </Button>
            </div>

            {isUsingProjectDefaults && (
              <div className="rounded-md border border-dashed bg-white p-3 text-sm text-gray-700">
                <p>This phase currently uses the project default status columns.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={handleCopyDefaultsToPhase}
                    disabled={isMutating}
                    id="copy-project-defaults-button"
                  >
                    Copy from project defaults
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowCustomSetup(true);
                      setShowAddDialog(true);
                    }}
                    id="start-phase-statuses-button"
                  >
                    Add custom status
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
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
                    disabled={index === 0 || !canMutateStatuses}
                    className="p-1 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    title={t('common.move_up')}
                    id={`move-up-${status.project_status_mapping_id}`}
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index === statuses.length - 1 || !canMutateStatuses}
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
                {canMutateStatuses && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteConfirmation({ mappingId: status.project_status_mapping_id, statusName: displayName })}
                    id={`delete-status-${status.project_status_mapping_id}`}
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    {t('common.delete')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showAddDialog && (
        <AddStatusDialog
          projectId={projectId}
          phaseId={selectedPhaseId}
          onClose={() => setShowAddDialog(false)}
          onAdded={loadStatuses}
        />
      )}

      {deleteConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setDeleteConfirmation(null)}
          onConfirm={handleDelete}
          title={t('projects.settings.statuses.confirm_delete_title', { defaultValue: 'Delete Status' })}
          message={t('projects.settings.statuses.confirm_delete', { statusName: deleteConfirmation.statusName })}
          confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
          cancelLabel={t('common.cancel', { defaultValue: 'Cancel' })}
        />
      )}

      {revertConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setRevertConfirmation(false)}
          onConfirm={handleRevertToDefaults}
          title="Revert to Project Defaults"
          message="Remove this phase's custom statuses and revert to project defaults?"
          confirmLabel="Revert"
          cancelLabel="Cancel"
        />
      )}
    </div>
  );
}
