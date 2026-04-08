'use client';

import { useState, useEffect } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Input } from '@alga-psa/ui/components/Input';
import {
  getTenantProjectStatuses,
  createTenantProjectStatus,
  updateTenantProjectStatus,
  deleteTenantProjectStatus,
  reorderTenantProjectStatuses
} from '@alga-psa/projects/actions/projectTaskStatusActions';
import { importReferenceData, getAvailableReferenceData, checkImportConflicts, type ImportConflict } from '@alga-psa/reference-data/actions';
import type { IStatus, IStandardStatus } from '@alga-psa/types';
import { ChevronUp, ChevronDown, Trash2, Edit2, Plus, Palette } from 'lucide-react';
import * as LucideIcons from 'lucide-react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import { StatusImportDialog } from '@alga-psa/ui/components/settings/dialogs/StatusImportDialog';
import { ConflictResolutionDialog } from '@alga-psa/reference-data/components';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from 'react-i18next';

export function TenantProjectTaskStatusSettings() {
  const { t } = useTranslation(['features/projects', 'common']);
  const STATUS_TYPE = 'project_task'; // Fixed to project_task type

  const [statuses, setStatuses] = useState<IStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingStatus, setEditingStatus] = useState<IStatus | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    is_closed: false,
    color: '#6B7280', // Default gray
    icon: 'Clipboard' // Default icon
  });
  const [submitting, setSubmitting] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);

  // Import functionality state
  const [showStatusImportDialog, setShowStatusImportDialog] = useState(false);
  const [availableReferenceStatuses, setAvailableReferenceStatuses] = useState<IStandardStatus[]>([]);
  const [selectedImportStatuses, setSelectedImportStatuses] = useState<string[]>([]);

  // Conflict resolution state
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});

  // Curated icon selection organized by category
  const iconCategories = {
    'Status': ['Circle', 'CircleDot', 'CheckCircle', 'XCircle', 'AlertCircle', 'MinusCircle', 'CircleSlash', 'CircleOff', 'CircleDashed'],
    'Progress': ['PlayCircle', 'PauseCircle', 'Loader2', 'Activity', 'TrendingUp', 'TrendingDown', 'ArrowUp', 'ArrowDown', 'ArrowRight'],
    'Tasks': ['Clipboard', 'ClipboardCheck', 'CheckSquare', 'Square', 'ListTodo', 'FileText', 'File', 'Folder', 'FolderOpen'],
    'Time': ['Clock', 'Timer', 'Hourglass', 'Calendar', 'CalendarCheck', 'CalendarClock', 'Watch', 'AlarmClock', 'History'],
    'Markers': ['Flag', 'Bookmark', 'Star', 'Target', 'Pin', 'MapPin', 'Navigation', 'Compass', 'Award'],
    'Alerts': ['AlertTriangle', 'AlertOctagon', 'Info', 'Bell', 'Zap', 'ShieldAlert', 'TriangleAlert', 'OctagonAlert', 'MessageSquareWarning'],
    'Actions': ['Send', 'Archive', 'Lock', 'Unlock', 'Eye', 'EyeOff', 'Download', 'Upload', 'Trash2']
  };

  useEffect(() => {
    loadStatuses();
  }, []);

  async function loadStatuses() {
    setLoading(true);
    try {
      const data = await getTenantProjectStatuses();
      setStatuses(data);
    } catch (error) {
      console.error('Failed to load statuses:', error);
    } finally {
      setLoading(false);
    }
  }

  function openCreateDialog() {
    setEditingStatus(null);
    setFormData({
      name: '',
      is_closed: false,
      color: '#6B7280',
      icon: 'Clipboard'
    });
    setShowDialog(true);
  }

  function openEditDialog(status: IStatus) {
    setEditingStatus(status);
    setFormData({
      name: status.name,
      is_closed: status.is_closed,
      color: status.color || '#6B7280',
      icon: status.icon || 'Clipboard'
    });
    setShowDialog(true);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      if (editingStatus) {
        await updateTenantProjectStatus(editingStatus.status_id, formData);
        toast.success(t('settings.statuses.status_updated_success', 'Status updated successfully'));
      } else {
        await createTenantProjectStatus(formData);
        toast.success(t('settings.statuses.status_created_success', 'Status created successfully'));
      }
      await loadStatuses();
      setShowDialog(false);
    } catch (error) {
      handleError(error, t('settings.statuses.save_failed', 'Failed to save status. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(statusId: string, statusName: string) {
    if (!window.confirm(t('settings.statuses.delete_confirm_message', 'Are you sure you want to delete the status "{{statusName}}"? This cannot be undone.', {
      statusName,
    }))) {
      return;
    }

    try {
      await deleteTenantProjectStatus(statusId);
      setStatuses(statuses.filter(s => s.status_id !== statusId));
      toast.success(t('settings.statuses.status_deleted_success', 'Status "{{statusName}}" deleted successfully', {
        statusName,
      }));
    } catch (error: any) {
      handleError(error, t('settings.statuses.delete_in_use', 'Failed to delete status. It may be in use by projects.'));
    }
  }

  async function handleMoveUp(index: number) {
    if (index === 0) return;

    const newStatuses = [...statuses];
    [newStatuses[index - 1], newStatuses[index]] = [newStatuses[index], newStatuses[index - 1]];

    const updates = newStatuses.map((item, idx) => ({
      status_id: item.status_id,
      order_number: idx + 1
    }));

    setStatuses(newStatuses);

    try {
      await reorderTenantProjectStatuses(updates);
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      loadStatuses();
    }
  }

  async function handleMoveDown(index: number) {
    if (index === statuses.length - 1) return;

    const newStatuses = [...statuses];
    [newStatuses[index], newStatuses[index + 1]] = [newStatuses[index + 1], newStatuses[index]];

    const updates = newStatuses.map((item, idx) => ({
      status_id: item.status_id,
      order_number: idx + 1
    }));

    setStatuses(newStatuses);

    try {
      await reorderTenantProjectStatuses(updates);
    } catch (error) {
      console.error('Failed to reorder statuses:', error);
      loadStatuses();
    }
  }

  async function handleImportStatuses() {
    const available = await getAvailableReferenceData('statuses', { item_type: STATUS_TYPE });
    setAvailableReferenceStatuses(available);
    setSelectedImportStatuses([]);
    setShowStatusImportDialog(true);
  }

  async function handleImportSelected() {
    try {
      // Check for conflicts first
      const conflicts = await checkImportConflicts(
        'statuses',
        selectedImportStatuses,
        { item_type: STATUS_TYPE }
      );

      if (conflicts.length > 0) {
        // Show conflict resolution dialog
        setImportConflicts(conflicts);
        setConflictResolutions({});
        setShowConflictDialog(true);
        setShowStatusImportDialog(false);
      } else {
        // No conflicts, proceed with import
        const result = await importReferenceData(
          'statuses',
          selectedImportStatuses,
          { item_type: STATUS_TYPE }
        );

        if (result.imported.length > 0) {
          toast.success(t('settings.statuses.status_imported_success', 'Successfully imported {{count}} statuses', {
            count: result.imported.length,
          }));
          await loadStatuses();
        }

        if (result.skipped.length > 0) {
          toast.error(t('settings.statuses.status_import_skipped', 'Skipped {{count}} statuses ({{reason}})', {
            count: result.skipped.length,
            reason: (result.skipped as any[])[0].reason,
          }));
        }

        setShowStatusImportDialog(false);
        setSelectedImportStatuses([]);
      }
    } catch (error) {
      handleError(error, t('settings.statuses.import_failed', 'Failed to import statuses'));
    }
  }

  async function handleResolveConflicts() {
    try {
      const result = await importReferenceData(
        'statuses',
        selectedImportStatuses,
        { item_type: STATUS_TYPE },
        conflictResolutions
      );

      if (result.imported.length > 0) {
        toast.success(t('settings.statuses.status_imported_success', 'Successfully imported {{count}} statuses', {
          count: result.imported.length,
        }));
        await loadStatuses();
        setSelectedImportStatuses([]);
      }

      if (result.skipped.length > 0) {
        const skippedNames = (result.skipped as any[]).map((s: any) => s.name).join(', ');
        toast(t('settings.statuses.import_skipped_names', 'Skipped: {{names}}', {
          names: skippedNames,
        }), {
          icon: 'ℹ️',
          duration: 4000,
        });
      }

      setShowConflictDialog(false);
      setImportConflicts([]);
      setConflictResolutions({});
    } catch (error) {
      handleError(error, t('settings.statuses.import_failed', 'Failed to import statuses'));
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div>{t('settings.statuses.loading', 'Loading...')}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>{t('settings.statuses.task_status_library_title', 'Project Task Status Library')}</CardTitle>
            <CardDescription>
              {t('settings.statuses.task_status_library_description', `Manage your organization's project task statuses. These statuses can be used across all projects.`)}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button onClick={openCreateDialog} id="create-status-button">
              <Plus className="w-4 h-4 mr-2" />
              {t('settings.statuses.create_status_title', 'Create Status')}
            </Button>
            <Button onClick={handleImportStatuses} id="import-task-statuses-button" variant="outline">
              {t('settings.statuses.import_from_standard', 'Import from Standard')}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {statuses.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>{t('settings.statuses.task_status_library_empty', 'No project task statuses found')}</p>
            <p className="text-sm mt-2">
              {t('settings.statuses.task_status_library_empty_hint', 'Create your first status to get started')}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {statuses.map((status, index) => (
              <div
                key={status.status_id}
                className="flex items-center justify-between p-4 bg-white border rounded-lg hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex flex-col gap-1">
                    <Button
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      variant="ghost"
                      size="icon"
                      tooltipText="Move up"
                      id={`move-up-${status.status_id}`}
                    >
                      <ChevronUp className="w-4 h-4" />
                    </Button>
                    <Button
                      onClick={() => handleMoveDown(index)}
                      disabled={index === statuses.length - 1}
                      variant="ghost"
                      size="icon"
                      tooltipText="Move down"
                      id={`move-down-${status.status_id}`}
                    >
                      <ChevronDown className="w-4 h-4" />
                    </Button>
                  </div>
                  {/* Icon and color preview */}
                  <div className="flex items-center gap-2">
                    {status.icon && (() => {
                      const IconComponent = (LucideIcons as any)[status.icon];
                      return IconComponent ? (
                        <div
                          className="flex items-center justify-center w-8 h-8 rounded"
                          style={{ backgroundColor: status.color || '#6B7280' }}
                        >
                          <IconComponent className="w-4 h-4 text-white" />
                        </div>
                      ) : null;
                    })()}
                    {!status.icon && status.color && (
                      <div
                        className="w-8 h-8 rounded border border-gray-300"
                        style={{ backgroundColor: status.color }}
                      />
                    )}
                  </div>
                  <div>
                    <span className="font-medium">{status.name}</span>
                    {status.is_closed && (
                      <span className="ml-2 text-xs px-2 py-1 bg-gray-200 rounded">
                        {t('settings.statuses.closed', 'Closed')}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditDialog(status)}
                    id={`edit-status-${status.status_id}`}
                    >
                      <Edit2 className="w-4 h-4 mr-1" />
                      {t('common:actions.edit', 'Edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(status.status_id, status.name)}
                    id={`delete-status-${status.status_id}`}
                    >
                      <Trash2 className="w-4 h-4 mr-1" />
                      {t('common:actions.delete', 'Delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {showDialog && (
          <Dialog
            isOpen={true}
            onClose={() => setShowDialog(false)}
            title={editingStatus
              ? t('settings.statuses.edit_status_title', 'Edit Status')
              : t('settings.statuses.create_status_title', 'Create Status')}
            id="status-form-dialog"
          >
            <div className="space-y-6 p-6">
              {/* Status Name */}
              <Input
                id="status-name"
                label={t('settings.statuses.status_name', 'Status Name')}
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('settings.statuses.status_name_placeholder', 'e.g., In Progress, Blocked, etc.')}
                required
                autoFocus
                containerClassName="mb-0"
              />

              {/* Preview */}
              <div>
                <label className="block text-sm font-medium text-[rgb(var(--color-text-700))] mb-2">
                  {t('settings.statuses.preview', 'Preview')}
                </label>
                <div
                  className="p-4 rounded-lg border min-h-[120px]"
                  style={{
                    backgroundColor: (() => {
                      const hex = formData.color || '#6B7280';
                      const num = parseInt(hex.replace('#', ''), 16);
                      const r = Math.min(255, Math.floor((num >> 16) + (255 - (num >> 16)) * 0.85));
                      const g = Math.min(255, Math.floor(((num >> 8) & 0x00FF) + (255 - ((num >> 8) & 0x00FF)) * 0.85));
                      const b = Math.min(255, Math.floor((num & 0x0000FF) + (255 - (num & 0x0000FF)) * 0.85));
                      return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
                    })(),
                    borderColor: formData.color || '#6B7280'
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg"
                      style={{
                        backgroundColor: formData.color || '#6B7280',
                        border: '1px solid rgba(0,0,0,0.1)'
                      }}
                    >
                      {formData.icon && (() => {
                        const IconComponent = (LucideIcons as any)[formData.icon];
                        return IconComponent ? (
                          <IconComponent className="w-4 h-4" style={{ color: '#ffffff' }} />
                        ) : null;
                      })()}
                      <span className="text-sm font-medium" style={{ color: '#ffffff' }}>
                        {formData.name || t('settings.statuses.status_name', 'Status Name')}
                      </span>
                    </div>
                  </div>
                  <div className="bg-[rgb(var(--color-card))] rounded-lg p-3 shadow-sm">
                    <div className="text-xs text-[rgb(var(--color-text-500))] mb-1">
                      {t('settings.statuses.sample_task', 'Sample Task')}
                    </div>
                    <div className="text-sm text-[rgb(var(--color-text-700))]">
                      {t('settings.statuses.sample_task_hint', 'This is how tasks will appear in the column')}
                    </div>
                  </div>
                </div>
              </div>

              {/* Color and Icon Selection */}
              <div className="grid grid-cols-2 gap-4">
                {/* Color Picker */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('settings.statuses.color', 'Color')}
                  </label>
                  <ColorPicker
                    currentBackgroundColor={formData.color}
                    currentTextColor={null}
                    showTextColor={false}
                    previewType="circle"
                    colorMode="solid"
                    onSave={(backgroundColor) => {
                      setFormData({ ...formData, color: backgroundColor || '#6B7280' });
                    }}
                    trigger={
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full flex items-center gap-3 px-4 py-2.5 justify-start h-auto"
                        id="color-picker-trigger"
                      >
                        <div
                          className="w-8 h-8 rounded-md border-2 border-white shadow-sm"
                          style={{ backgroundColor: formData.color || '#6B7280' }}
                        />
                        <div className="flex-1 text-left">
                          <div className="text-xs text-gray-500">
                            {t('settings.statuses.selected_color', 'Selected Color')}
                          </div>
                          <div className="text-sm font-medium">{formData.color || '#6B7280'}</div>
                        </div>
                        <Palette className="w-4 h-4 text-gray-400" />
                      </Button>
                    }
                  />
                </div>

                {/* Icon Selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('settings.statuses.icon', 'Icon')}
                  </label>
                  <Button
                    type="button"
                    onClick={() => setShowIconPicker(true)}
                    variant="outline"
                    className="w-full flex items-center gap-3 px-4 py-2.5 justify-start h-auto"
                    id="icon-picker-trigger"
                  >
                    {formData.icon && (() => {
                      const IconComponent = (LucideIcons as any)[formData.icon];
                      return IconComponent ? (
                        <div
                          className="flex items-center justify-center w-8 h-8 rounded"
                          style={{ backgroundColor: formData.color || '#6B7280' }}
                        >
                          <IconComponent className="w-4 h-4 text-white" />
                        </div>
                      ) : null;
                    })()}
                    <div className="flex-1 text-left">
                      <div className="text-xs text-gray-500">
                        {t('settings.statuses.selected_icon', 'Selected Icon')}
                      </div>
                      <div className="text-sm font-medium">{formData.icon}</div>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400" />
                  </Button>

                  {/* Icon Picker Modal */}
                  {showIconPicker && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={() => setShowIconPicker(false)}>
                      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[65vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                          <h3 className="text-sm font-semibold">
                            {t('settings.statuses.choose_icon', 'Choose Icon')}
                          </h3>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowIconPicker(false)}
                            id="close-icon-picker"
                          >
                            ✕
                          </Button>
                        </div>
                        <div className="p-3 overflow-y-auto max-h-[calc(65vh-50px)]">
                          {Object.entries(iconCategories).map(([category, icons]) => (
                            <div key={category} className="mb-3">
                              <h4 className="text-xs font-semibold text-gray-600 mb-1.5">{category}</h4>
                              <div className="grid grid-cols-9 gap-1">
                                {icons.map((iconName) => {
                                  const IconComponent = (LucideIcons as any)[iconName];
                                  if (!IconComponent) return null;

                                  const isSelected = formData.icon === iconName;

                                  return (
                                    <Button
                                      key={iconName}
                                      type="button"
                                      onClick={() => {
                                        setFormData({ ...formData, icon: iconName });
                                        setShowIconPicker(false);
                                      }}
                                      variant="ghost"
                                      size="icon"
                                      className={`
                                        w-8 h-8 rounded border
                                        hover:border-primary-500 hover:bg-primary-50
                                        ${isSelected ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-white'}
                                      `}
                                      title={iconName}
                                      id={`icon-option-${iconName}`}
                                    >
                                      <IconComponent className={`w-4 h-4 ${isSelected ? 'text-primary-600' : 'text-gray-600'}`} />
                                    </Button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Is Closed Checkbox */}
              <div className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                <Checkbox
                  id="is-closed"
                  checked={formData.is_closed}
                  onChange={(e) => setFormData({ ...formData, is_closed: e.target.checked })}
                  containerClassName="mb-0 mt-0.5"
                  label={
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-700 cursor-pointer block">
                        {t('settings.statuses.mark_closed', 'Mark as closed status')}
                      </span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t('settings.statuses.mark_closed_help', 'Tasks with this status will be considered complete')}
                      </p>
                    </div>
                  }
                />
              </div>

              {/* Action Buttons */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button variant="outline" onClick={() => setShowDialog(false)} id="cancel-button">
                  {t('common:actions.cancel', 'Cancel')}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || !formData.name.trim()}
                  id="submit-button"
                  variant="default"
                >
                  {submitting
                    ? t('common:actions.saving', 'Saving...')
                    : editingStatus
                      ? t('settings.statuses.update_status', 'Update Status')
                      : t('settings.statuses.create_status_title', 'Create Status')}
                </Button>
              </div>
            </div>
          </Dialog>
        )}

        {/* Import Dialog */}
        <StatusImportDialog
          open={showStatusImportDialog}
          onOpenChange={setShowStatusImportDialog}
          availableStatuses={availableReferenceStatuses}
          selectedStatuses={selectedImportStatuses}
          onSelectionChange={(statusId) => {
            setSelectedImportStatuses(prev =>
              prev.includes(statusId)
                ? prev.filter(id => id !== statusId)
                : [...prev, statusId]
            );
          }}
          onImport={handleImportSelected}
        />

        {/* Conflict Resolution Dialog */}
        <ConflictResolutionDialog
          open={showConflictDialog}
          onOpenChange={setShowConflictDialog}
          conflicts={importConflicts}
          resolutions={conflictResolutions}
          onResolutionChange={(itemId, resolution) => {
            setConflictResolutions(prev => ({
              ...prev,
              [itemId]: resolution
            }));
          }}
          onResolve={handleResolveConflicts}
          onCancel={() => {
            setShowConflictDialog(false);
            setImportConflicts([]);
            setConflictResolutions({});
          }}
        />
      </CardContent>
    </Card>
  );
}
