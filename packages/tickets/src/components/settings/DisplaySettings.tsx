'use client';

import { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getTicketingDisplaySettings, 
  updateTicketingDisplaySettings 
} from '@alga-psa/tickets/actions/ticketDisplaySettings';

const DisplaySettings = (): React.JSX.Element => {
  const { t, i18n } = useTranslation('features/tickets');
  // Ticket display preferences (tenant-wide)
  const [dateTimeFormat, setDateTimeFormat] = useState<string>('MMM d, yyyy h:mm a');
  const [isSavingDisplay, setIsSavingDisplay] = useState<boolean>(false);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
    ticket_number: true,
    title: true,
    status: true,
    priority: true,
    sla: false,
    board: true,
    category: true,
    client: true,
    assigned_to: true,
    created: true,
    created_by: true,
    due_date: true,
    tags: true,
    actions: true,
  });
  const [tagsInlineUnderTitle, setTagsInlineUnderTitle] = useState<boolean>(false);
  const [responseStateTrackingEnabled, setResponseStateTrackingEnabled] = useState<boolean>(true);
  const sampleDate = new Date(Date.UTC(2025, 7, 22, 13, 23));
  const locale = i18n.language || 'en';
  const formatDateExample = (options: Intl.DateTimeFormatOptions): string =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(sampleDate);
  const dateTimeOptions = [
    { value: 'MMM d, yyyy h:mm a', label: formatDateExample({ month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) },
    { value: 'yyyy-MM-dd HH:mm', label: '2025-08-22 13:23' },
    { value: 'MM/dd/yyyy h:mm a', label: formatDateExample({ month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }) },
    { value: 'dd/MM/yyyy HH:mm', label: '22/08/2025 13:23' },
    { value: 'EEE, MMM d, yyyy h:mm a', label: formatDateExample({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) },
  ];
  const columnOptions = [
    { key: 'ticket_number', label: t('fields.ticketNumber', 'Ticket Number'), required: true },
    { key: 'title', label: t('fields.title', 'Title'), required: true },
    { key: 'status', label: t('fields.status', 'Status'), required: false },
    { key: 'priority', label: t('fields.priority', 'Priority'), required: false },
    { key: 'sla', label: t('settings.display.columns.sla', 'SLA'), required: false },
    { key: 'board', label: t('fields.board', 'Board'), required: false },
    { key: 'category', label: t('fields.category', 'Category'), required: false },
    { key: 'client', label: t('fields.client', 'Client'), required: false },
    { key: 'assigned_to', label: t('fields.assignedTo', 'Assigned To'), required: false },
    { key: 'created', label: t('fields.created', 'Created'), required: false },
    { key: 'created_by', label: t('settings.display.columns.createdBy', 'Created By'), required: false },
    { key: 'due_date', label: t('fields.dueDate', 'Due Date'), required: false },
    { key: 'actions', label: t('settings.display.columns.actions', 'Actions'), required: true },
  ] as const;

  // Track original values to detect changes
  const [originalDisplaySettings, setOriginalDisplaySettings] = useState<{
    dateTimeFormat: string;
    columnVisibility: Record<string, boolean>;
    tagsInlineUnderTitle: boolean;
    responseStateTrackingEnabled: boolean;
  }>({
    dateTimeFormat: 'MMM d, yyyy h:mm a',
    columnVisibility: {
      ticket_number: true,
      title: true,
      status: true,
      priority: true,
      board: true,
      category: true,
      client: true,
      assigned_to: true,
      created: true,
      created_by: true,
      due_date: true,
      tags: true,
      actions: true,
    },
    tagsInlineUnderTitle: false,
    responseStateTrackingEnabled: true,
  });
  
  // Check if there are unsaved changes
  const hasUnsavedChanges = (): boolean => {
    return (
      dateTimeFormat !== originalDisplaySettings.dateTimeFormat ||
      JSON.stringify(columnVisibility) !== JSON.stringify(originalDisplaySettings.columnVisibility) ||
      tagsInlineUnderTitle !== originalDisplaySettings.tagsInlineUnderTitle ||
      responseStateTrackingEnabled !== originalDisplaySettings.responseStateTrackingEnabled
    );
  };

  // Load ticketing display settings
  useEffect(() => {
    const loadDisplay = async () => {
      try {
        const s = await getTicketingDisplaySettings();
        const loadedDateFormat = s?.dateTimeFormat || 'MMM d, yyyy h:mm a';
        const loadedColumnVisibility = (s?.list?.columnVisibility as Record<string, boolean>) || {
          ticket_number: true,
          title: true,
          status: true,
          priority: true,
          sla: false,
          board: true,
          category: true,
          client: true,
          assigned_to: true,
          created: true,
          created_by: true,
          due_date: true,
          tags: true,
          actions: true,
        };
        const loadedTagsInline = s?.list?.tagsInlineUnderTitle || false;
        const loadedResponseStateTracking = s?.responseStateTrackingEnabled ?? true;

        // Set current values
        setDateTimeFormat(loadedDateFormat);
        setColumnVisibility(loadedColumnVisibility);
        setTagsInlineUnderTitle(loadedTagsInline);
        setResponseStateTrackingEnabled(loadedResponseStateTracking);

        // Store original values for change detection
        setOriginalDisplaySettings({
          dateTimeFormat: loadedDateFormat,
          columnVisibility: loadedColumnVisibility,
          tagsInlineUnderTitle: loadedTagsInline,
          responseStateTrackingEnabled: loadedResponseStateTracking,
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
      await updateTicketingDisplaySettings({
        dateTimeFormat,
        responseStateTrackingEnabled,
        list: {
          columnVisibility,
          tagsInlineUnderTitle,
        },
      });
      toast.success(t('settings.display.saveSuccess', 'Ticket display settings saved'));

      // Update original settings after successful save
      setOriginalDisplaySettings({
        dateTimeFormat,
        columnVisibility: { ...columnVisibility },
        tagsInlineUnderTitle,
        responseStateTrackingEnabled,
      });
    } catch (e) {
      handleError(e, t('settings.display.saveFailed', 'Failed to save display settings'));
    } finally {
      setIsSavingDisplay(false);
    }
  };

  return (
    <div className="space-y-6">
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
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-md font-semibold text-gray-800 mb-2">
            {t('settings.display.dateTimeFormat', 'Date/Time Format')}
          </label>
          <CustomSelect
            value={dateTimeFormat}
            onValueChange={(v: string) => setDateTimeFormat(v)}
            options={dateTimeOptions}
            className="!w-fit"
          />
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-md font-semibold text-gray-800 mb-2">
          {t('settings.display.columnsTitle', 'Ticket List Columns')}
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {columnOptions.map(({ key, label, required }) => (
            <div key={key} className="[&>div]:mb-0">
              <Checkbox
                id={`column-${key}`}
                label={`${label}${required ? ` ${t('settings.display.requiredSuffix', '(required)')}` : ''}`}
                checked={!!columnVisibility[key]}
                disabled={required}
                onChange={(e) => setColumnVisibility(v => ({ ...v, [key]: (e.target as HTMLInputElement).checked }))}
              />
            </div>
          ))}
        </div>
        {/* Tags visibility and layout */}
        <div className="mt-4 space-y-2">
          <div className="[&>div]:mb-0">
            <Checkbox
              id="column-tags"
              label={t('settings.display.showTags', 'Show Tags')}
              checked={!!columnVisibility['tags']}
              onChange={(e) => setColumnVisibility(v => ({ ...v, tags: (e.target as HTMLInputElement).checked }))}
            />
          </div>
          {columnVisibility['tags'] && (
            <div className="pl-6">
              <Switch
                id="tags-layout-switch"
                checked={tagsInlineUnderTitle}
                onCheckedChange={(v) => setTagsInlineUnderTitle(Boolean(v))}
                label={tagsInlineUnderTitle
                  ? t('settings.display.tagsUnderTitle', 'Display under Title')
                  : t('settings.display.tagsSeparateColumn', 'Display in separate column')}
              />
            </div>
          )}
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
