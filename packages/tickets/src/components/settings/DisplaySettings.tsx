'use client';

import { useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { toast } from 'react-hot-toast';
import { 
  getTicketingDisplaySettings, 
  updateTicketingDisplaySettings 
} from '@alga-psa/tickets/actions/ticketDisplaySettings';

const DisplaySettings = (): React.JSX.Element => {
  // Ticket display preferences (tenant-wide)
  const [dateTimeFormat, setDateTimeFormat] = useState<string>('MMM d, yyyy h:mm a');
  const [isSavingDisplay, setIsSavingDisplay] = useState<boolean>(false);
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({
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
  });
  const [tagsInlineUnderTitle, setTagsInlineUnderTitle] = useState<boolean>(false);
  
  // Track original values to detect changes
  const [originalDisplaySettings, setOriginalDisplaySettings] = useState<{
    dateTimeFormat: string;
    columnVisibility: Record<string, boolean>;
    tagsInlineUnderTitle: boolean;
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
  });
  
  // Check if there are unsaved changes
  const hasUnsavedChanges = (): boolean => {
    return (
      dateTimeFormat !== originalDisplaySettings.dateTimeFormat ||
      JSON.stringify(columnVisibility) !== JSON.stringify(originalDisplaySettings.columnVisibility) ||
      tagsInlineUnderTitle !== originalDisplaySettings.tagsInlineUnderTitle
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
        
        // Set current values
        setDateTimeFormat(loadedDateFormat);
        setColumnVisibility(loadedColumnVisibility);
        setTagsInlineUnderTitle(loadedTagsInline);
        
        // Store original values for change detection
        setOriginalDisplaySettings({
          dateTimeFormat: loadedDateFormat,
          columnVisibility: loadedColumnVisibility,
          tagsInlineUnderTitle: loadedTagsInline,
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
        list: {
          columnVisibility,
          tagsInlineUnderTitle,
        },
      });
      toast.success('Ticket display settings saved');
      
      // Update original settings after successful save
      setOriginalDisplaySettings({
        dateTimeFormat,
        columnVisibility: { ...columnVisibility },
        tagsInlineUnderTitle,
      });
    } catch (e) {
      console.error('Failed to save ticket display settings', e);
      const errorMessage = e instanceof Error ? e.message : 'Failed to save display settings';
      
      // Check if it's a permission error
      if (errorMessage.includes('Permission denied')) {
        toast.error('You do not have permission to update ticket settings');
      } else {
        toast.error(errorMessage);
      }
    } finally {
      setIsSavingDisplay(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h3 className="text-lg font-semibold text-gray-800 mb-2">Ticket Display Preferences</h3>
      <p className="text-sm text-gray-600 mb-4">Configure how your Ticketing dashboard displays columns and timestamps for your team.</p>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:gap-4">
        <div className="flex-1 min-w-[260px]">
          <label className="block text-md font-semibold text-gray-800 mb-2">Date/Time Format</label>
          <CustomSelect
            value={dateTimeFormat}
            onValueChange={(v: string) => setDateTimeFormat(v)}
            options={[
              { value: 'MMM d, yyyy h:mm a', label: 'Aug 22, 2025 1:23 PM' },
              { value: 'yyyy-MM-dd HH:mm', label: '2025-08-22 13:23' },
              { value: 'MM/dd/yyyy h:mm a', label: '08/22/2025 1:23 PM' },
              { value: 'dd/MM/yyyy HH:mm', label: '22/08/2025 13:23' },
              { value: 'EEE, MMM d, yyyy h:mm a', label: 'Fri, Aug 22, 2025 1:23 PM' },
            ]}
            className="!w-fit"
          />
        </div>
      </div>

      <div className="mt-6">
        <h4 className="text-md font-semibold text-gray-800 mb-2">Ticket List Columns</h4>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {[
            { key: 'ticket_number', label: 'Ticket Number', required: true },
            { key: 'title', label: 'Title', required: true },
            { key: 'status', label: 'Status', required: false },
            { key: 'priority', label: 'Priority', required: false },
            { key: 'board', label: 'Board', required: false },
            { key: 'category', label: 'Category', required: false },
            { key: 'client', label: 'Client', required: false },
            { key: 'assigned_to', label: 'Assigned To', required: false },
            { key: 'created', label: 'Created', required: false },
            { key: 'created_by', label: 'Created By', required: false },
            { key: 'due_date', label: 'Due Date', required: false },
            { key: 'actions', label: 'Actions', required: true },
          ].map(({ key, label, required }) => (
            <div key={key} className="[&>div]:mb-0">
              <Checkbox
                id={`column-${key}`}
                label={`${label}${required ? ' (required)' : ''}`}
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
              label="Show Tags"
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
                label={tagsInlineUnderTitle ? 'Display under Title' : 'Display in separate column'}
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
          {isSavingDisplay ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
};

export default DisplaySettings;
