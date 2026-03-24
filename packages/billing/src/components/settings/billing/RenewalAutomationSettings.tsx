'use client';

import React from 'react';
import toast from 'react-hot-toast';

import { getAllBoards } from '@alga-psa/tickets/actions';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { getDefaultBillingSettings, updateDefaultBillingSettings } from '@alga-psa/billing/actions';
import type { BillingSettings } from '@alga-psa/billing/actions';
import type { IStatus } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Label } from '@alga-psa/ui/components/Label';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';

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

const POLICY_OPTIONS = [
  { value: 'create_ticket', label: 'Create ticket' },
  { value: 'queue_only', label: 'Queue only' },
];

const RenewalAutomationSettings = (): React.JSX.Element => {
  const [settings, setSettings] = React.useState<BillingSettings>(DEFAULT_SETTINGS);
  const [boardOptions, setBoardOptions] = React.useState<BoardOption[]>([]);
  const [statusOptions, setStatusOptions] = React.useState<StatusOption[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [loadingStatuses, setLoadingStatuses] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

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
            label: board.board_name ?? 'Unnamed board',
          }))
        );
      } catch (error) {
        if (active) {
          handleError(error, 'Failed to load renewal automation settings');
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
  }, []);

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

        const nextStatusOptions = statuses.map((status) => ({
          value: status.status_id,
          label: status.name,
        }));
        setStatusOptions(nextStatusOptions);
        setSettings((current) => {
          if (!current.renewalTicketStatusId) {
            return current;
          }

          const hasSelectedStatus = statuses.some(
            (status) => status.status_id === current.renewalTicketStatusId
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
        handleError(error, 'Failed to load renewal ticket statuses');
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
  }, [settings.renewalTicketBoardId]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const result = await updateDefaultBillingSettings(settings);
      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        return;
      }

      toast.success('Renewal automation settings have been updated.');
    } catch (error) {
      handleError(error, 'Failed to save renewal automation settings');
    } finally {
      setSaving(false);
    }
  };

  const isCreateTicketPolicy = settings.renewalDueDateActionPolicy !== 'queue_only';

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium mb-4">Renewal Automation Settings</h3>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="renewal-due-date-action-policy">Due Date Action</Label>
            <CustomSelect
              id="renewal-due-date-action-policy"
              options={POLICY_OPTIONS}
              value={settings.renewalDueDateActionPolicy ?? 'create_ticket'}
              onValueChange={(value) => {
                setSettings((current) => ({
                  ...current,
                  renewalDueDateActionPolicy: value as BillingSettings['renewalDueDateActionPolicy'],
                }));
              }}
              className="w-full"
              disabled={loading || saving}
            />
            <p className="text-sm text-muted-foreground">
              Choose whether renewal due dates should create tickets or stay queue-only by default.
            </p>
          </div>

          {isCreateTicketPolicy && (
            <>
              <div className="space-y-2">
                <Label htmlFor="renewal-ticket-board">Renewal Ticket Board</Label>
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
                  placeholder={loading ? 'Loading boards...' : 'Select board'}
                  className="w-full"
                  disabled={loading || saving}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="renewal-ticket-status">Renewal Ticket Status</Label>
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
                      ? (loadingStatuses ? 'Loading statuses...' : 'Select status')
                      : 'Select a board first'
                  }
                  className="w-full"
                  disabled={loading || saving || loadingStatuses || !settings.renewalTicketBoardId}
                />
                <p className="text-sm text-muted-foreground">
                  Renewal ticket statuses are scoped to the selected board.
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
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RenewalAutomationSettings;
