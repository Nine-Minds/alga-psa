'use client';

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@alga-psa/ui/components/Label';
import { Button } from '@alga-psa/ui/components/Button';
import { Plus, Circle } from 'lucide-react';
import type { TemplateStatusMapping, TemplateWizardData } from '../../../types/templateWizard';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import { QuickAddStatus } from '@alga-psa/ui/components/QuickAddStatus';
import type { IStatus } from '@alga-psa/types';
import { createTenantProjectStatus } from '../../../actions/projectTaskStatusActions';
import {
  DeleteStatusColumnDialog,
  StatusColumnsEditor,
  type DeleteStatusColumnRequest,
} from '../../status-columns';
import {
  getEffectiveTemplateStatusMappings,
  getTemplateDefaultStatusMappings,
  getTemplatePhaseStatusMappings,
  TEMPLATE_DEFAULT_SCOPE,
} from '../../../lib/templateStatusMappingUtils';

interface TemplateStatusColumnsStepProps {
  data: TemplateWizardData;
  updateData: (data: Partial<TemplateWizardData>) => void;
  availableStatuses: Array<{ status_id: string; name: string; color?: string; is_closed?: boolean }>;
  isLoadingStatuses: boolean;
  onStatusCreated?: (status: IStatus) => void;
}

export function TemplateStatusColumnsStep({
  data,
  updateData,
  availableStatuses,
  isLoadingStatuses,
  onStatusCreated,
}: TemplateStatusColumnsStepProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [showQuickAddStatus, setShowQuickAddStatus] = useState(false);
  const [deleteRequest, setDeleteRequest] = useState<DeleteStatusColumnRequest | null>(null);
  const [selectedScope, setSelectedScope] = useState<string>(TEMPLATE_DEFAULT_SCOPE);

  const selectedPhaseTempId = selectedScope === TEMPLATE_DEFAULT_SCOPE ? null : selectedScope;
  const defaultStatusMappings = useMemo(
    () => getTemplateDefaultStatusMappings(data.status_mappings),
    [data.status_mappings]
  );
  const phaseStatusMappings = useMemo(
    () => getTemplatePhaseStatusMappings(data.status_mappings, selectedPhaseTempId),
    [data.status_mappings, selectedPhaseTempId]
  );
  const sortedMappings = useMemo(
    () => getEffectiveTemplateStatusMappings(data.status_mappings, selectedPhaseTempId),
    [data.status_mappings, selectedPhaseTempId]
  );
  const hasPhaseSpecificStatuses = selectedPhaseTempId !== null && phaseStatusMappings.length > 0;
  const isUsingTemplateDefaults = selectedPhaseTempId !== null && !hasPhaseSpecificStatuses;
  const editableMappings = hasPhaseSpecificStatuses || selectedPhaseTempId === null;

  const scopeSelectedStatusIds = new Set(
    (hasPhaseSpecificStatuses ? phaseStatusMappings : defaultStatusMappings)
      .filter((mapping) => mapping.status_id)
      .map((mapping) => mapping.status_id as string)
  );

  const getStatusColor = (mapping: TemplateStatusMapping): string => {
    if (mapping.status_id) {
      const status = availableStatuses.find((candidate) => candidate.status_id === mapping.status_id);
      return status?.color || mapping.custom_status_color || '#6B7280';
    }

    return mapping.custom_status_color || '#6B7280';
  };

  const replaceScopedMappings = (nextScopedMappings: TemplateStatusMapping[]) => {
    const otherMappings = data.status_mappings.filter((mapping) =>
      selectedPhaseTempId
        ? mapping.template_phase_id !== selectedPhaseTempId
        : !!mapping.template_phase_id
    );

    updateData({
      status_mappings: [...otherMappings, ...nextScopedMappings],
    });
  };

  const clearTasksUsingMappings = (mappingIds: string[], phaseTempId?: string | null) => {
    if (mappingIds.length === 0) {
      return;
    }

    updateData({
      tasks: data.tasks.map((task) => {
        const isTargetPhase = phaseTempId ? task.phase_temp_id === phaseTempId : true;
        if (!isTargetPhase || !task.template_status_mapping_id || !mappingIds.includes(task.template_status_mapping_id)) {
          return task;
        }

        return {
          ...task,
          template_status_mapping_id: undefined,
        };
      }),
    });
  };

  const getAvailableOptionsForMapping = (currentMappingStatusId?: string) =>
    availableStatuses.filter((status) => {
      if (status.status_id === currentMappingStatusId) {
        return true;
      }

      return !scopeSelectedStatusIds.has(status.status_id);
    });

  // A row whose status is still unpicked. "Add Existing" focuses it
  // instead of spawning a second stray empty row.
  const pendingMapping = (hasPhaseSpecificStatuses ? phaseStatusMappings : defaultStatusMappings)
    .find((mapping) => !mapping.status_id);

  const addStatusMapping = (statusId?: string) => {
    if (!editableMappings) {
      return;
    }

    if (!statusId && pendingMapping) {
      const trigger = typeof document !== 'undefined'
        ? document.getElementById(`wizard-status-select-${pendingMapping.temp_id}`)
        : null;
      trigger?.scrollIntoView({ block: 'nearest' });
      trigger?.focus();
      return;
    }

    const scopedMappings = hasPhaseSpecificStatuses ? phaseStatusMappings : defaultStatusMappings;
    const status = statusId ? availableStatuses.find((candidate) => candidate.status_id === statusId) : null;

    const newMapping: TemplateStatusMapping = {
      temp_id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      template_phase_id: selectedPhaseTempId || undefined,
      status_id: statusId || '',
      statusSource: statusId ? 'tenant' : 'inline',
      custom_status_name: '',
      custom_status_color: status?.color || '#6B7280',
      display_order: scopedMappings.length,
    };

    replaceScopedMappings([...scopedMappings, newMapping]);
  };

  const copyDefaultsToPhase = () => {
    if (!selectedPhaseTempId || hasPhaseSpecificStatuses) {
      return;
    }

    const copiedMappings = defaultStatusMappings.map((mapping, index) => ({
      ...mapping,
      temp_id: `temp_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      template_phase_id: selectedPhaseTempId,
      display_order: index,
    }));

    replaceScopedMappings(copiedMappings);
  };

  const resetPhaseToDefaults = () => {
    if (!selectedPhaseTempId) {
      return;
    }

    const removedMappingIds = phaseStatusMappings.map((mapping) => mapping.temp_id);
    replaceScopedMappings([]);
    clearTasksUsingMappings(removedMappingIds, selectedPhaseTempId);
  };

  const removeStatusMapping = (mappingId: string, moveToMappingId?: string) => {
    const scopedMappings = (hasPhaseSpecificStatuses ? phaseStatusMappings : defaultStatusMappings)
      .filter((mapping) => mapping.temp_id !== mappingId)
      .map((mapping, index) => ({
        ...mapping,
        display_order: index,
      }));

    replaceScopedMappings(scopedMappings);

    if (moveToMappingId) {
      updateData({
        tasks: data.tasks.map((task) => (task.template_status_mapping_id === mappingId
          ? { ...task, template_status_mapping_id: moveToMappingId }
          : task)),
      });
      return;
    }

    clearTasksUsingMappings([mappingId], selectedPhaseTempId);
  };

  const reorderScopedMappings = (orderedIds: string[]) => {
    const scopedMappings = hasPhaseSpecificStatuses ? phaseStatusMappings : defaultStatusMappings;
    const byId = new Map(scopedMappings.map((mapping) => [mapping.temp_id, mapping]));
    replaceScopedMappings(
      orderedIds
        .map((id) => byId.get(id))
        .filter((mapping): mapping is TemplateStatusMapping => Boolean(mapping))
        .map((mapping, index) => ({ ...mapping, display_order: index }))
    );
  };

  const taskCountForMapping = (mappingId: string) =>
    data.tasks.filter((task) => task.template_status_mapping_id === mappingId).length;

  const updateStatusMapping = (mappingId: string, updates: Partial<TemplateStatusMapping>) => {
    const scopedMappings = (hasPhaseSpecificStatuses ? phaseStatusMappings : defaultStatusMappings).map((mapping) => {
      if (mapping.temp_id !== mappingId) {
        return mapping;
      }

      const nextMapping = { ...mapping, ...updates };
      if ('status_id' in updates) {
        nextMapping.statusSource = updates.status_id ? 'tenant' : 'inline';
      }
      if (updates.status_id) {
        const status = availableStatuses.find((candidate) => candidate.status_id === updates.status_id);
        if (status?.color) {
          nextMapping.custom_status_color = status.color;
        }
      }

      return nextMapping;
    });

    replaceScopedMappings(scopedMappings);
  };

  const handleNewStatusCreated = (newStatus: IStatus) => {
    onStatusCreated?.(newStatus);
    if (editableMappings) {
      addStatusMapping(newStatus.status_id);
    }
  };

  const selectedScopeLabel = selectedPhaseTempId
    ? data.phases.find((phase) => phase.temp_id === selectedPhaseTempId)?.phase_name || 'Phase'
    : t('templates.statuses.template_defaults');

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{t('settings.statuses.project.title')}</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t('templates.statuses.manage_description')}
        </p>
      </div>

      {data.phases.length > 0 && (
      <div className="space-y-2">
        <Label>{t('settings.statuses.scope_label')}</Label>
        <CustomSelect
          value={selectedScope}
          onValueChange={setSelectedScope}
          options={[
            { value: TEMPLATE_DEFAULT_SCOPE, label: t('templates.statuses.template_defaults') },
            ...data.phases
              .sort((a, b) => a.order_number - b.order_number)
              .map((phase) => ({
                value: phase.temp_id,
                label: phase.phase_name,
              })),
          ]}
        />
      </div>
      )}

      {selectedPhaseTempId && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button
              variant={isUsingTemplateDefaults ? 'default' : 'outline'}
              size="sm"
              onClick={resetPhaseToDefaults}
              disabled={isUsingTemplateDefaults}
              id="wizard-use-default-statuses"
            >
              {t('settings.statuses.use_project_defaults')}
            </Button>
            <Button
              variant={!isUsingTemplateDefaults ? 'default' : 'outline'}
              size="sm"
              onClick={copyDefaultsToPhase}
              disabled={hasPhaseSpecificStatuses || defaultStatusMappings.length === 0}
              id="wizard-copy-default-statuses"
            >
              {t('settings.statuses.custom_statuses')}
            </Button>
          </div>
          {isUsingTemplateDefaults && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('settings.statuses.phase_uses_defaults')}
            </p>
          )}
        </div>
      )}

      <div className="space-y-3">
        {sortedMappings.length === 0 ? (
          <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
            <Circle className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600 dark:text-gray-400 mb-4">{t('templates.statuses.empty')}</p>
            <div className="flex justify-center gap-2">
              {availableStatuses.length > 0 ? (
                <CustomSelect
                  value=""
                  onValueChange={(value) => {
                    if (value) {
                      addStatusMapping(value);
                    }
                  }}
                  options={[
                    { value: '', label: t('templates.statuses.select_placeholder') },
                    ...availableStatuses.map((status) => ({
                      value: status.status_id,
                      label: `${status.name}${status.is_closed ? ` ${t('settings.statuses.closed_badge')}` : ''}`,
                    })),
                  ]}
                  disabled={isLoadingStatuses || !editableMappings}
                  className="w-64"
                />
              ) : (
                <p className="text-sm text-gray-500">{t('templates.statuses.all_in_use')}</p>
              )}
              <Button
                id="add-new-status-empty"
                variant="outline"
                onClick={() => setShowQuickAddStatus(true)}
                disabled={!editableMappings}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('templates.statuses.create_new')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <StatusColumnsEditor
              items={sortedMappings.map((mapping) => ({
                id: mapping.temp_id,
                name: availableStatuses.find((status) => status.status_id === mapping.status_id)?.name
                  || mapping.custom_status_name
                  || t('templates.statuses.select_placeholder'),
                isClosed: availableStatuses.find((status) => status.status_id === mapping.status_id)?.is_closed,
                color: getStatusColor(mapping),
              }))}
              editable={editableMappings}
              idPrefix="wizard-status"
              onReorder={reorderScopedMappings}
              onRequestDelete={(item) => setDeleteRequest({
                id: item.id,
                name: item.name,
                taskCount: taskCountForMapping(item.id),
              })}
              canDelete={() => sortedMappings.length > 1}
              renderRowBody={(item, index) => {
                const mapping = sortedMappings[index];
                const availableOptions = getAvailableOptionsForMapping(mapping.status_id);

                return (
                  <div className="flex items-center gap-3">
                    {!mapping.status_id ? (
                      <ColorPicker
                        currentBackgroundColor={getStatusColor(mapping)}
                        currentTextColor={null}
                        onSave={(backgroundColor) =>
                          updateStatusMapping(mapping.temp_id, {
                            custom_status_color: backgroundColor || '#6B7280',
                          })
                        }
                        showTextColor={false}
                        previewType="circle"
                        colorMode="solid"
                        trigger={
                          <Button
                            id={`color-picker-trigger-${index}`}
                            variant="ghost"
                            size="sm"
                            className="p-0 hover:opacity-80 transition-opacity"
                            title={t('settings.statuses.color')}
                            disabled={!editableMappings}
                          >
                            <Circle
                              className="w-6 h-6"
                              fill={getStatusColor(mapping)}
                              stroke={getStatusColor(mapping)}
                            />
                          </Button>
                        }
                      />
                    ) : (
                      <Circle
                        className="w-6 h-6 shrink-0"
                        fill={getStatusColor(mapping)}
                        stroke={getStatusColor(mapping)}
                      />
                    )}
                    <div className="flex-1">
                      <Label className="text-xs text-gray-500 mb-1 block">
                        {t('settings.statuses.task_statuses_label')}
                      </Label>
                      <CustomSelect
                        id={`wizard-status-select-${mapping.temp_id}`}
                        value={mapping.status_id || ''}
                        onValueChange={(value) =>
                          updateStatusMapping(mapping.temp_id, {
                            status_id: value,
                            custom_status_name: '',
                          })
                        }
                        options={[
                          { value: '', label: t('templates.statuses.select_placeholder') },
                          ...availableOptions.map((status) => ({
                            value: status.status_id,
                            label: `${status.name}${status.is_closed ? ` ${t('settings.statuses.closed_badge')}` : ''}`,
                          })),
                        ]}
                        disabled={isLoadingStatuses || !editableMappings}
                      />
                    </div>
                  </div>
                );
              }}
            />

            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Button
                id="add-existing-status"
                variant="outline"
                onClick={() => addStatusMapping()}
                disabled={isLoadingStatuses || !editableMappings || Boolean(pendingMapping)}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('settings.statuses.add_existing', 'Add Existing')}
              </Button>
              <Button
                id="add-new-status"
                variant="outline"
                onClick={() => setShowQuickAddStatus(true)}
                disabled={!editableMappings}
              >
                <Plus className="w-4 h-4 mr-2" />
                {t('templates.statuses.create_new')}
              </Button>
              {pendingMapping && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t('templates.statuses.pending_row_hint')}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <DeleteStatusColumnDialog
        request={deleteRequest}
        moveTargets={sortedMappings
          .filter((mapping) => mapping.temp_id !== deleteRequest?.id)
          .map((mapping) => ({
            id: mapping.temp_id,
            name: availableStatuses.find((status) => status.status_id === mapping.status_id)?.name
              || mapping.custom_status_name
              || t('templates.statuses.select_placeholder'),
            isClosed: availableStatuses.find((status) => status.status_id === mapping.status_id)?.is_closed,
          }))}
        onCancel={() => setDeleteRequest(null)}
        onConfirm={(moveToId) => {
          if (deleteRequest) {
            removeStatusMapping(deleteRequest.id, moveToId);
          }
          setDeleteRequest(null);
        }}
        idPrefix="wizard-status"
      />

      <QuickAddStatus
        open={showQuickAddStatus}
        onOpenChange={setShowQuickAddStatus}
        onStatusCreated={handleNewStatusCreated}
        statusType="project_task"
        createStatus={async ({ name, isClosed, color }) =>
          createTenantProjectStatus({ name, is_closed: isClosed, color })
        }
        existingStatuses={availableStatuses}
      />
    </div>
  );
}
