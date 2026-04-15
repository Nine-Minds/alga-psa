'use client';

import React from 'react';
import toast from 'react-hot-toast';

import { getAllBoards, getTicketStatuses } from '@alga-psa/reference-data/actions';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from '@alga-psa/billing/actions';
import type { BillingSettings } from '@alga-psa/billing/actions';
import type { IStatus } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

const DEFAULT_SETTINGS: BillingSettings = {
  zeroDollarInvoiceHandling: 'normal',
  suppressZeroDollarInvoices: false,
  enableCreditExpiration: true,
  creditExpirationDays: 365,
  creditExpirationNotificationDays: [30, 7, 1],
  defaultRenewalMode: 'manual',
  defaultNoticePeriodDays: 30,
  renewalDueDateActionPolicy: 'create_ticket',
  renewalTicketBoardId: undefined,
  renewalTicketStatusId: undefined,
  renewalTicketPriority: undefined,
  renewalTicketAssigneeId: undefined,
};

type BoardOption = {
  value: string;
  label: string;
};

type StatusOption = {
  value: string;
  label: string;
};

const RenewalAutomationSettings = (): React.JSX.Element => {
  const { t } = useTranslation('msp/billing-settings');
  const [settings, setSettings] = React.useState<BillingSettings>(DEFAULT_SETTINGS);
  const [boardOptions, setBoardOptions] = React.useState<BoardOption[]>([]);
  const [statusOptions, setStatusOptions] = React.useState<StatusOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingStatuses, setLoadingStatuses] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const policyOptions = React.useMemo(
    () => ([
      {
        value: 'create_ticket',
        label: t('general.renewal.options.createTicket', { defaultValue: 'Create ticket' }),
      },
      {
        value: 'queue_only',
        label: t('general.renewal.options.queueOnly', { defaultValue: 'Queue only' }),
      },
    ]),
    [t]
  );

  React.useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const [currentSettings, boards] = await Promise.all([
          getDefaultBillingSettings(),
          getAllBoards(true),
        ]);

        if (!active) {
          return;
        }

        setSettings(currentSettings);
        setBoardOptions(
          boards.map((board) => ({
            value: board.board_id ?? '',
            label: board.board_name ?? t('general.renewal.states.unnamedBoard', { defaultValue: 'Unnamed board' }),
          }))
        );
      } catch (error) {
        if (active) {
          handleError(error, t('general.renewal.errors.load', {
            defaultValue: 'Failed to load renewal automation settings'
          }));
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadSettings();

    return () => {
      active = false;
    };
  }, [t]);

  React.useEffect(() => {
    let active = true;

    const loadStatuses = async () => {
      if (!settings.renewalTicketBoardId) {
        setStatusOptions([]);
        setSettings((current) => (
          current.renewalTicketStatusId
            ? { ...current, renewalTicketStatusId: undefined }
            : current
        ));
        return;
      }

      try {
        setLoadingStatuses(true);
        const statuses: IStatus[] = await getTicketStatuses(settings.renewalTicketBoardId);
        if (!active) {
          return;
        }

        const nextStatusOptions = statuses.map((status: IStatus) => ({
          value: status.status_id,
          label: status.name,
        }));
        setStatusOptions(nextStatusOptions);
        setSettings((current) => {
          if (!current.renewalTicketStatusId) {
            return current;
          }

          const hasSelectedStatus = statuses.some(
            (status: IStatus) => status.status_id === current.renewalTicketStatusId
          );

          return hasSelectedStatus
            ? current
            : { ...current, renewalTicketStatusId: undefined };
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setStatusOptions([]);
        setSettings((current) => (
          current.renewalTicketStatusId
            ? { ...current, renewalTicketStatusId: undefined }
            : current
        ));
        handleError(error, t('general.renewal.errors.loadStatuses', {
          defaultValue: 'Failed to load renewal ticket statuses'
        }));
      } finally {
        if (active) {
          setLoadingStatuses(false);
        }
      }
    };

    loadStatuses();

    return () => {
      active = false;
    };
  }, [settings.renewalTicketBoardId, t]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const result = await updateDefaultBillingSettings(settings);
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }

      toast.success(t('general.renewal.toast.updated', {
        defaultValue: 'Renewal automation settings have been updated.'
      }));
    } catch (error) {
      handleError(error, t('general.renewal.errors.save', {
        defaultValue: 'Failed to save renewal automation settings'
      }));
    } finally {
      setSaving(false);
    }
  };

  const isCreateTicketPolicy = settings.renewalDueDateActionPolicy !== 'queue_only';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="renewal-due-date-action-policy">
          {t('general.renewal.fields.dueDateAction.label', { defaultValue: 'Due Date Action' })}
        </Label>
        <CustomSelect
          id="renewal-due-date-action-policy"
          options={policyOptions}
          value={settings.renewalDueDateActionPolicy ?? 'create_ticket'}
          onValueChange={(value) => {
            setSettings((current) => ({
              ...current,
              renewalDueDateActionPolicy: value as BillingSettings['renewalDueDateActionPolicy'],
            }));
          }}
          className="!w-fit"
          disabled={loading || saving}
        />
        <p className="text-sm text-muted-foreground">
          {t('general.renewal.fields.dueDateAction.help', {
            defaultValue: 'Choose whether renewal due dates should create tickets or stay queue-only by default.'
          })}
        </p>
      </div>

      {isCreateTicketPolicy && (
        <>
          <div className="space-y-2">
            <Label htmlFor="renewal-ticket-board">
              {t('general.renewal.fields.ticketBoard.label', { defaultValue: 'Renewal Ticket Board' })}
            </Label>
            <CustomSelect
              id="renewal-ticket-board"
              options={boardOptions}
              value={settings.renewalTicketBoardId ?? ''}
              onValueChange={(value) => {
                setSettings((current) => ({
                  ...current,
                  renewalTicketBoardId: value || undefined,
                  renewalTicketStatusId: undefined,
                }));
              }}
              placeholder={loading
                ? t('general.renewal.fields.ticketBoard.placeholderLoading', { defaultValue: 'Loading boards...' })
                : t('general.renewal.fields.ticketBoard.placeholderSelect', { defaultValue: 'Select board' })}
              className="!w-fit"
              disabled={loading || saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="renewal-ticket-status">
              {t('general.renewal.fields.ticketStatus.label', { defaultValue: 'Renewal Ticket Status' })}
            </Label>
            <CustomSelect
              id="renewal-ticket-status"
              options={statusOptions}
              value={settings.renewalTicketStatusId ?? ''}
              onValueChange={(value) => {
                setSettings((current) => ({
                  ...current,
                  renewalTicketStatusId: value || undefined,
                }));
              }}
              placeholder={
                settings.renewalTicketBoardId
                  ? (loadingStatuses
                    ? t('general.renewal.fields.ticketStatus.placeholderLoading', { defaultValue: 'Loading statuses...' })
                    : t('general.renewal.fields.ticketStatus.placeholderSelect', { defaultValue: 'Select status' }))
                  : t('general.renewal.fields.ticketStatus.placeholderSelectBoardFirst', {
                    defaultValue: 'Select a board first'
                  })
              }
              className="!w-fit"
              disabled={loading || saving || loadingStatuses || !settings.renewalTicketBoardId}
            />
            <p className="text-sm text-muted-foreground">
              {t('general.renewal.fields.ticketStatus.help', {
                defaultValue: 'Renewal ticket statuses are scoped to the selected board.'
              })}
            </p>
          </div>
        </>
      )}

      <div>
        <Button
          id="save-renewal-automation-settings"
          onClick={handleSave}
          disabled={loading || saving}
        >
          {saving
            ? t('general.renewal.actions.saving', { defaultValue: 'Saving...' })
            : t('general.renewal.actions.save', { defaultValue: 'Save' })}
        </Button>
      </div>
    </div>
  );
};

export default RenewalAutomationSettings;
