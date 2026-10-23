'use client';

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, RefreshCw } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { QuickAddStatus } from '@alga-psa/ui/components/QuickAddStatus';
import type { IStatus } from '@alga-psa/types';
import { createTenantProjectStatus } from '../../actions/projectTaskStatusActions';

export interface AddStatusColumnControlsProps {
  /** Library statuses that are not already used in the current scope. */
  availableStatuses: Array<{ status_id: string; name: string; is_closed?: boolean }>;
  /** Every library status name, used for the create-new duplicate guard. */
  existingStatuses?: Array<{ name: string }>;
  disabled?: boolean;
  isBusy?: boolean;
  /** Re-read the library; called every time the picker is opened or refreshed. */
  onRefresh?: () => void | Promise<void>;
  onAddExisting: (statusId: string) => void | Promise<void>;
  onStatusCreated: (status: IStatus) => void | Promise<void>;
  idPrefix?: string;
}

/**
 * "Add Existing" library picker plus an inline "Create New" flow. The picker
 * re-reads the library every time it opens, so a status created elsewhere (or
 * right here) shows up without a page reload.
 */
export function AddStatusColumnControls({
  availableStatuses,
  existingStatuses = [],
  disabled = false,
  isBusy = false,
  onRefresh,
  onAddExisting,
  onStatusCreated,
  idPrefix = 'status-column',
}: AddStatusColumnControlsProps): React.ReactElement {
  const { t } = useTranslation(['features/projects', 'common']);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [selectedStatusId, setSelectedStatusId] = useState('');
  const [showQuickAdd, setShowQuickAdd] = useState(false);

  const openPicker = async () => {
    setSelectedStatusId('');
    setIsPickerOpen(true);
    await onRefresh?.();
  };

  const handleAdd = async () => {
    if (!selectedStatusId) return;
    await onAddExisting(selectedStatusId);
    setSelectedStatusId('');
    setIsPickerOpen(false);
  };

  const handleCreated = async (status: IStatus) => {
    await onStatusCreated(status);
    setSelectedStatusId('');
    setIsPickerOpen(false);
  };

  return (
    <div className="space-y-2">
      {!isPickerOpen ? (
        <div className="flex gap-2">
          <Button
            id={`${idPrefix}-add-existing-button`}
            size="sm"
            variant="outline"
            onClick={() => void openPicker()}
            disabled={disabled}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('settings.statuses.add_existing', 'Add Existing')}
          </Button>
          <Button
            id={`${idPrefix}-create-new-button`}
            size="sm"
            variant="outline"
            onClick={() => setShowQuickAdd(true)}
            disabled={disabled}
          >
            <Plus className="mr-1 h-4 w-4" />
            {t('settings.statuses.create_new', 'Create New')}
          </Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          {availableStatuses.length > 0 ? (
            <CustomSelect
              value={selectedStatusId}
              onValueChange={setSelectedStatusId}
              options={availableStatuses.map((status) => ({
                value: status.status_id,
                label: status.is_closed
                  ? `${status.name} ${t('settings.statuses.closed_badge', '(Closed)')}`
                  : status.name,
              }))}
              placeholder={t('settings.statuses.choose_status', 'Choose a status')}
              onAddNew={() => setShowQuickAdd(true)}
              addNewLabel={t('settings.statuses.create_new', 'Create New')}
              id={`${idPrefix}-library-select`}
            />
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              <p className="font-medium">{t('settings.statuses.no_statuses_available', 'No statuses available')}</p>
              <p>
                {t(
                  'settings.statuses.all_library_statuses_used',
                  'Every library status is already a column here. Use Create New to add another one.'
                )}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              id={`${idPrefix}-confirm-add-existing`}
              size="sm"
              onClick={() => void handleAdd()}
              disabled={!selectedStatusId || isBusy}
            >
              {isBusy ? t('common:actions.saving', 'Saving...') : t('settings.statuses.add_from_library', 'Add Status')}
            </Button>
            <Button
              id={`${idPrefix}-create-new-inline`}
              size="sm"
              variant="outline"
              onClick={() => setShowQuickAdd(true)}
              disabled={isBusy}
            >
              <Plus className="mr-1 h-4 w-4" />
              {t('settings.statuses.create_new', 'Create New')}
            </Button>
            <Button
              id={`${idPrefix}-refresh-library`}
              size="sm"
              variant="ghost"
              onClick={() => void onRefresh?.()}
              disabled={isBusy}
              title={t('settings.statuses.refresh_library', 'Refresh status library')}
              aria-label={t('settings.statuses.refresh_library', 'Refresh status library')}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              id={`${idPrefix}-cancel-add-existing`}
              size="sm"
              variant="ghost"
              onClick={() => {
                setSelectedStatusId('');
                setIsPickerOpen(false);
              }}
            >
              {t('common:actions.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      )}

      <QuickAddStatus
        open={showQuickAdd}
        onOpenChange={setShowQuickAdd}
        onStatusCreated={(status) => void handleCreated(status)}
        statusType="project_task"
        createStatus={async ({ name, isClosed, color }) =>
          createTenantProjectStatus({ name, is_closed: isClosed, color })
        }
        existingStatuses={existingStatuses}
      />
    </div>
  );
}

export default AddStatusColumnControls;
