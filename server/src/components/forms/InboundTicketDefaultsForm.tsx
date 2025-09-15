'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { TextArea } from '../ui/TextArea';
import { Switch } from '../ui/Switch';
import CustomSelect from '../ui/CustomSelect';
import { Alert, AlertDescription } from '../ui/Alert';
import { 
  createInboundTicketDefaults, 
  updateInboundTicketDefaults 
} from '../../lib/actions/email-actions/inboundTicketDefaultsActions';
import { getTicketFieldOptions, getCategoriesByChannel } from '../../lib/actions/email-actions/ticketFieldOptionsActions';
import type { InboundTicketDefaults, TicketFieldOptions } from '../../types/email.types';
// Dedicated pickers used elsewhere in the app
import { ChannelPicker } from 'server/src/components/settings/general/ChannelPicker';
import { CompanyPicker } from 'server/src/components/companies/CompanyPicker';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import { PrioritySelect } from 'server/src/components/tickets/PrioritySelect';
import UserPicker from 'server/src/components/ui/UserPicker';
// Loaders to hydrate pickers with full data
import { getAllChannels } from 'server/src/lib/actions/channel-actions/channelActions';
import { getAllCompanies } from 'server/src/lib/actions/company-actions/companyActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import type { IChannel, IPriority } from 'server/src/interfaces';
import type { ICompany } from 'server/src/interfaces/company.interfaces';
import type { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import type { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';

export interface InboundTicketDefaultsFormProps {
  defaults?: InboundTicketDefaults | null;
  onSuccess: (defaults: InboundTicketDefaults) => void;
  onCancel: () => void;
}

export function InboundTicketDefaultsForm({ 
  defaults, 
  onSuccess, 
  onCancel 
}: InboundTicketDefaultsFormProps) {
  const [formData, setFormData] = useState({
    short_name: '',
    display_name: '',
    description: '',
    is_active: true,
    channel_id: '',
    status_id: '',
    priority_id: '',
    company_id: '',
    category_id: '',
    subcategory_id: '',
    location_id: '',
    entered_by: null as string | null
  });
  
  const [fieldOptions, setFieldOptions] = useState<TicketFieldOptions>({
    channels: [],
    statuses: [],
    priorities: [],
    categories: [],
    companies: [],
    users: [],
    locations: []
  });
  
  const [loading, setLoading] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data for dedicated pickers
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [companies, setCompanies] = useState<ICompany[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [usersWithRoles, setUsersWithRoles] = useState<IUserWithRoles[]>([]);
  const [channelFilterState, setChannelFilterState] = useState<'active' | 'inactive' | 'all'>('all');
  const [companyFilterState, setCompanyFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  // Note: category/subcategory are now selected via CategoryPicker

  // Load field options on mount
  useEffect(() => {
    loadFieldOptions();
  }, []);

  // Load categories when channel changes (server-side filtered)
  useEffect(() => {
    const loadCategoriesForChannel = async () => {
      if (!formData.channel_id) {
        // Clear categories if no channel selected
        setFieldOptions(prev => ({ ...prev, categories: [] }));
        return;
      }
      try {
        const { categories } = await getCategoriesByChannel(formData.channel_id);
        setFieldOptions(prev => ({ ...prev, categories }));
      } catch (err) {
        // On error, keep categories empty for safety
        setFieldOptions(prev => ({ ...prev, categories: [] }));
      }
    };
    loadCategoriesForChannel();
  }, [formData.channel_id]);

  // Populate form when editing
  useEffect(() => {
    if (defaults) {
      setFormData({
        short_name: defaults.short_name,
        display_name: defaults.display_name,
        description: defaults.description || '',
        is_active: defaults.is_active,
        channel_id: defaults.channel_id || '',
        status_id: defaults.status_id || '',
        priority_id: defaults.priority_id || '',
        company_id: defaults.company_id || '',
        category_id: defaults.category_id || '',
        subcategory_id: defaults.subcategory_id || '',
        location_id: defaults.location_id || '',
        entered_by: defaults.entered_by || null
      });
    }
  }, [defaults]);

  const loadFieldOptions = async () => {
    try {
      setLoadingOptions(true);
      const data = await getTicketFieldOptions();
      setFieldOptions(data.options);

      // Hydrate dedicated pickers with richer datasets
      // Channels with full metadata for ChannelPicker
      const [allChannels, allCompanies, allPriorities, allUsers] = await Promise.all([
        getAllChannels(true),
        getAllCompanies(true),
        getAllPriorities('ticket'),
        getAllUsers(true, 'internal')
      ]);
      setChannels(allChannels || []);
      setCompanies(allCompanies || []);
      setPriorities((allPriorities as IPriority[]) || []);
      setUsersWithRoles(allUsers || []);
    } catch (err: any) {
      setError('Failed to load field options');
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.short_name.trim() || !formData.display_name.trim()) {
      setError('Short name and display name are required');
      return;
    }

    if (!formData.channel_id || !formData.status_id || !formData.priority_id) {
      setError('Board, status, and priority are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const payload = {
        short_name: formData.short_name.trim(),
        display_name: formData.display_name.trim(),
        description: formData.description.trim() || undefined,
        is_active: formData.is_active,
        channel_id: formData.channel_id,
        status_id: formData.status_id,
        priority_id: formData.priority_id,
        company_id: formData.company_id || undefined,
        category_id: formData.category_id || undefined,
        subcategory_id: formData.subcategory_id || undefined,
        location_id: formData.location_id || undefined,
        entered_by: formData.entered_by || null
      };

      let result;
      if (defaults) {
        result = await updateInboundTicketDefaults(defaults.id, payload);
      } else {
        result = await createInboundTicketDefaults(payload);
      }

      onSuccess(result.defaults);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDefaultChange = (field: string, value: string | null) => {
    setFormData(prev => {
      const next = { ...prev, [field]: value } as typeof prev;
      // Clear dependent fields when parents change
      if (field === 'channel_id') {
        next.category_id = '';
        next.subcategory_id = '';
      }
      if (field === 'category_id') {
        next.subcategory_id = '';
      }
      if (field === 'company_id' && prev.company_id !== value) {
        // Clear location if company changes
        next.location_id = '';
      }
      return next;
    });
  };

  if (loadingOptions) {
    return (
      <div className="flex items-center justify-center p-6">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        <span className="ml-2">Loading form options...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Basic Information */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="short_name">Short Name *</Label>
          <Input
            id="short_name"
            value={formData.short_name}
            onChange={(e) => setFormData(prev => ({ ...prev, short_name: e.target.value }))}
            placeholder="email-general"
            required
          />
          <p className="text-xs text-muted-foreground mt-1">
            Unique identifier (e.g., email-general, support-billing)
          </p>
        </div>

        <div>
          <Label htmlFor="display_name">Display Name *</Label>
          <Input
            id="display_name"
            value={formData.display_name}
            onChange={(e) => setFormData(prev => ({ ...prev, display_name: e.target.value }))}
            placeholder="General Email Support"
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <TextArea
          id="description"
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Optional description of when these defaults are used"
          rows={2}
        />
      </div>

      <div className="flex items-center space-x-2">
        <Switch
          id="is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
        />
        <Label htmlFor="is_active">Active</Label>
      </div>

      {/* Ticket Defaults */}
      <div className="border-t pt-6">
        <h4 className="text-lg font-medium mb-4">Ticket Defaults</h4>
        
        <div className="grid grid-cols-2 gap-4">
          {/* Required Fields */}
          <div>
          <Label htmlFor="channel_id">Board *</Label>
            <ChannelPicker
              id="channel_id"
              channels={channels}
              selectedChannelId={formData.channel_id || null}
              onSelect={(value) => handleDefaultChange('channel_id', value)}
              filterState={channelFilterState}
              onFilterStateChange={setChannelFilterState}
              placeholder="Select Board"
            />
          </div>

          <div>
            <Label htmlFor="status_id">Status *</Label>
            <CustomSelect
              id="status_id"
              value={formData.status_id}
              onValueChange={(value) => handleDefaultChange('status_id', value)}
              options={fieldOptions.statuses.map(s => ({ 
                value: s.id, 
                label: s.name + (s.is_default ? ' (Default)' : '') 
              }))}
              placeholder="Select status"
            />
          </div>

          <div>
            <Label htmlFor="priority_id">Priority *</Label>
            <PrioritySelect
              id="priority_id"
              value={formData.priority_id}
              onValueChange={(value) => handleDefaultChange('priority_id', value)}
              options={priorities.map(p => ({ 
                value: p.priority_id, 
                label: p.priority_name, 
                color: p.color 
              }))}
              placeholder="Select priority"
            />
          </div>

          {/* Optional Fields */}
          <div>
            <Label htmlFor="company_id">Company</Label>
            <CompanyPicker
              id="company_id"
              companies={companies}
              selectedCompanyId={formData.company_id || null}
              onSelect={(value) => handleDefaultChange('company_id', value || '')}
              filterState={companyFilterState}
              onFilterStateChange={setCompanyFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
              placeholder="Select Client"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used as a catch-all when no company can be matched from the email; otherwise ignored.
            </p>
          </div>

          <div>
            <Label htmlFor="category_id">Category</Label>
            <CategoryPicker
              id="category_id"
              categories={(fieldOptions.categories || []).map((c): ITicketCategory => ({
                category_id: c.id,
                category_name: c.name,
                parent_category: c.parent_id,
                channel_id: c.channel_id
              }))}
              selectedCategories={(() => {
                // Represent current selection as either subcategory or parent
                if (formData.subcategory_id) return [formData.subcategory_id];
                if (formData.category_id) return [formData.category_id];
                return [];
              })()}
              onSelect={(categoryIds) => {
                const selectedId = categoryIds[0] || '';
                // Treat both "Clear Selection" and "No Category" as no category
                if (!selectedId || selectedId === 'no-category') {
                  handleDefaultChange('category_id', '');
                  handleDefaultChange('subcategory_id', '');
                  return;
                }
                const found = fieldOptions.categories.find(c => c.id === selectedId);
                if (found?.parent_id) {
                  // Selected a subcategory
                  handleDefaultChange('category_id', found.parent_id);
                  handleDefaultChange('subcategory_id', found.id);
                } else {
                  // Selected a top-level category
                  handleDefaultChange('category_id', selectedId);
                  handleDefaultChange('subcategory_id', '');
                }
              }}
              placeholder={formData.channel_id ? 'Select category' : 'Select board first'}
              multiSelect={false}
              disabled={!formData.channel_id}
              showReset
              allowEmpty
            />
            {formData.channel_id && (fieldOptions.categories || []).filter(c => !c.parent_id && String(c.channel_id || '') === String(formData.channel_id)).length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">No categories found for the selected board.</p>
            )}
          </div>

          <div>
            <Label htmlFor="location_id">Location</Label>
            <CustomSelect
              id="location_id"
              value={formData.location_id}
              onValueChange={(value) => handleDefaultChange('location_id', value || '')}
              options={fieldOptions.locations
                .filter(l => !formData.company_id || l.company_id === formData.company_id)
                .map(l => ({ value: l.id, label: l.name }))}
              placeholder={formData.company_id ? 'Select location' : 'Select company first (optional)'}
              disabled={!formData.company_id}
              allowClear
            />
            <p className="text-xs text-muted-foreground mt-1">
              Only applied when the catch-all company is used (no match case).
            </p>
          </div>

          <div>
            <Label htmlFor="entered_by">Entered By</Label>
            <UserPicker
              label={undefined}
              value={formData.entered_by || ''}
              onValueChange={(value) => handleDefaultChange('entered_by', value || null)}
              users={usersWithRoles}
              placeholder="System (null)"
              userTypeFilter="internal"
              buttonWidth="full"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Used only when we cannot match a contact or company. System tickets will show "System" as creator.
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-6 border-t">
        <Button id="cancel-button" type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button id="submit-button" type="submit" disabled={loading}>
          {loading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              {defaults ? 'Updating...' : 'Creating...'}
            </>
          ) : (
            defaults ? 'Update Defaults' : 'Create Defaults'
          )}
        </Button>
      </div>
    </form>
  );
}
