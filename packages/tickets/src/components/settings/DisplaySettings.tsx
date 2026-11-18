'use client';

import { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getTicketingDisplaySettings,
  updateTicketingDisplaySettings
} from '@alga-psa/tickets/actions/ticketDisplaySettings';
import { TOGGLEABLE_TICKET_COLUMNS, resolveTicketColumnVisibility } from '@alga-psa/tickets/lib';
import { useDateFormat } from '@alga-psa/ui/lib';

const DisplaySettings = (): React.JSX.Element => {
  const { t } = useTranslation('features/tickets');
  // Ticket display preferences (tenant-wide)
  const [showWeekday, setShowWeekday] = useState<boolean>(false);
  // A null country means the pattern fell through to the fixed system default:
  // the company country is still the 'XX' placeholder. Tenants who lose dd/MM
  // on cutover need to be told where it went, and this screen is where they
  // used to set it.
  const countryMissing = useDateFormat().country === null;
  const [isSavingDisplay, setIsSavingDisplay] = useState<boolean>(false);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>(() => resolveTicketColumnVisibility());
  // LEVERAGE: friction tags-inline-dead — tagsInlineUnderTitle no longer affects
  // any rendering (on-screen tags are always inline; export always lists tags).
  // Still loaded/saved but inert. Remove the field across catalog/loader/types
  // and drop this state in a follow-up.
  const [tagsInlineUnderTitle, setTagsInlineUnderTitle] = useState<boolean>(false);
  const [responseStateTrackingEnabled, setResponseStateTrackingEnabled] = useState<boolean>(true);
  const [defaultReplyInternal, setDefaultReplyInternal] = useState(false);
  // Only user-toggleable columns appear here. Title is always shown; ticket
  // number and category fold into the Title cell, so they're not toggles.
  const columnOptions = TOGGLEABLE_TICKET_COLUMNS.map((c) => ({
    key: c.key,
    label: t(c.titleKey, c.titleFallback),
  }));

  // Track original values to detect changes
  const [originalDisplaySettings, setOriginalDisplaySettings] = useState<{
    showWeekday: boolean;
    columnVisibility: Record<string, boolean>;
    tagsInlineUnderTitle: boolean;
    responseStateTrackingEnabled: boolean;
    defaultReplyInternal: boolean;
  }>({
    showWeekday: false,
    columnVisibility: resolveTicketColumnVisibility(),
    tagsInlineUnderTitle: false,
    responseStateTrackingEnabled: true,
    defaultReplyInternal: false,
  });
  
  // Check if there are unsaved changes
  const hasUnsavedChanges = (): boolean => {
    return (
      showWeekday !== originalDisplaySettings.showWeekday ||
      JSON.stringify(columnVisibility) !== JSON.stringify(originalDisplaySettings.columnVisibility) ||
      tagsInlineUnderTitle !== originalDisplaySettings.tagsInlineUnderTitle ||
      responseStateTrackingEnabled !== originalDisplaySettings.responseStateTrackingEnabled ||
      defaultReplyInternal !== originalDisplaySettings.defaultReplyInternal
    );
  };

  // Load ticketing display settings
  useEffect(() => {
    const loadDisplay = async () => {
      try {
        const s = await getTicketingDisplaySettings();
        const loadedShowWeekday = s?.showWeekday ?? false;
        const loadedColumnVisibility = resolveTicketColumnVisibility(
          s?.list?.columnVisibility as Record<string, boolean> | undefined,
        );
        const loadedTagsInline = s?.list?.tagsInlineUnderTitle || false;
        const loadedResponseStateTracking = s?.responseStateTrackingEnabled ?? true;
        const loadedDefaultReplyInternal = s?.defaultReplyInternal ?? false;

        // Set current values
        setShowWeekday(loadedShowWeekday);
        setColumnVisibility(loadedColumnVisibility);
        setTagsInlineUnderTitle(loadedTagsInline);
        setResponseStateTrackingEnabled(loadedResponseStateTracking);
        setDefaultReplyInternal(loadedDefaultReplyInternal);

        // Store original values for change detection
        setOriginalDisplaySettings({
          showWeekday: loadedShowWeekday,
          columnVisibility: loadedColumnVisibility,
          tagsInlineUnderTitle: loadedTagsInline,
          responseStateTrackingEnabled: loadedResponseStateTracking,
          defaultReplyInternal: loadedDefaultReplyInternal,
        });
      } catch (e) {
        console.error('Failed to load ticketing display settings', e);
      }
    };
    loadDisplay();
  }, []);

  const handleSaveDisplaySettings = async (): Promise<void> => {
    try {
      setIsSavingDisplay(true);
      const result = await updateTicketingDisplaySettings({
        showWeekday,
        responseStateTrackingEnabled,
        defaultReplyInternal,
        list: {
          columnVisibility,
          tagsInlineUnderTitle,
        },
      });
      if (isActionMessageError(result) || isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('settings.display.saveSuccess', 'Ticket display settings saved'));

      // Update original settings after successful save
      setOriginalDisplaySettings({
        showWeekday,
        columnVisibility: { ...columnVisibility },
        tagsInlineUnderTitle,
        responseStateTrackingEnabled,
        defaultReplyInternal,
      });
    } catch (e) {
      handleError(e, t('settings.display.saveFailed', 'Failed to save display settings'));
    } finally {
      setIsSavingDisplay(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-4">
        <h3 className="text-sm font-semibold text-[rgb(var(--color-text-800))] mb-2">
          {t('settings.display.defaultReplyInternalTitle', 'Default reply visibility')}
        </h3>
        <p className="text-sm text-[rgb(var(--color-text-700))] mb-4">
          {t(
            'settings.display.defaultReplyInternalDescription',
            'Start new ticket replies as Internal for all team members. Users can still switch a reply to Client. Client portal replies and replies within existing threads are unchanged.'
          )}
        </p>
        <Switch
          id="default-ticket-reply-internal-toggle"
          checked={defaultReplyInternal}
          onCheckedChange={setDefaultReplyInternal}
          label={t('settings.display.defaultReplyInternalLabel', 'Default ticket replies to Internal')}
        />
      </div>
      <div className="bg-white p-6 rounded-lg shadow-sm">
        <h3 className="text-lg font-semibold text-gray-800 mb-2">
          {t('settings.display.responseStateTrackingTitle', 'Response State Tracking')}
        </h3>
        <p className="text-sm text-gray-600 mb-4">
          {t(
            'settings.display.responseStateTrackingDescription',
            'When enabled, tickets automatically track who needs to respond next (awaiting client or awaiting internal response). Disabling this hides response state badges, filters, and related SLA pause options.'
          )}
        </p>
        <Switch
          id="response-state-tracking-toggle"
          checked={responseStateTrackingEnabled}
          onCheckedChange={(v) => setResponseStateTrackingEnabled(Boolean(v))}
          label={responseStateTrackingEnabled
            ? t('settings.display.responseStateTrackingEnabled', 'Response state tracking enabled')
            : t('settings.display.responseStateTrackingDisabled', 'Response state tracking disabled')}
        />
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm">
      <h3 className="text-lg font-semibold text-gray-800 mb-2">
        {t('settings.display.preferencesTitle', 'Ticket Display Preferences')}
      </h3>
      <p className="text-sm text-gray-600 mb-4">
        {t(
          'settings.display.preferencesDescription',
          'Configure how your Ticketing dashboard displays columns and timestamps for your team.'
        )}
      </p>
      <div className="flex flex-col gap-3">
        <Checkbox
          id="show-weekday"
          label={t('settings.display.showWeekday', 'Show weekday in timestamps')}
          checked={showWeekday}
          onChange={(e) => setShowWeekday((e.target as HTMLInputElement).checked)}
        />
        {countryMissing && (
          <p className="text-sm text-gray-600">
            {t(
              'settings.display.countryDrivesFormat',
              'Date and time format follows your company country. Set it under Settings \u2192 General.'
            )}
          </p>
        )}
      </div>

      <div className="mt-6">
        <h4 className="text-md font-semibold text-gray-800 mb-2">
          {t('settings.display.columnsTitle', 'Ticket List Columns')}
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {columnOptions.map(({ key, label }) => (
            <div key={key}>
              <Checkbox
                id={`column-${key}`}
                label={label}
                checked={!!columnVisibility[key]}
                onChange={(e) => setColumnVisibility(v => ({ ...v, [key]: (e.target as HTMLInputElement).checked }))}
              />
            </div>
          ))}
        </div>
        {/* Tags visibility (tags always render inline under the title) */}
        <div className="mt-4 space-y-2">
          <div>
            <Checkbox
              id="column-tags"
              label={t('settings.display.showTags', 'Show Tags')}
              checked={!!columnVisibility['tags']}
              onChange={(e) => setColumnVisibility(v => ({ ...v, tags: (e.target as HTMLInputElement).checked }))}
            />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <Button
          id="save-display-settings"
          variant="default"
          onClick={handleSaveDisplaySettings}
          disabled={isSavingDisplay || !hasUnsavedChanges()}>
          {isSavingDisplay
            ? t('settings.display.saving', 'Saving…')
            : t('actions.save', 'Save')}
        </Button>
      </div>
      </div>
    </div>
  );
};

export default DisplaySettings;
