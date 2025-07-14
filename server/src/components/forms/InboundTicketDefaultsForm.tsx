'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Label } from '../ui/Label';
import { Textarea } from '../ui/Textarea';
import { Switch } from '../ui/Switch';
import CustomSelect from '../ui/CustomSelect';
import { Alert, AlertDescription } from '../ui/Alert';
import { 
  createInboundTicketDefaults, 
  updateInboundTicketDefaults 
} from '../../lib/actions/email-actions/inboundTicketDefaultsActions';
import { getTicketFieldOptions } from '../../lib/actions/email-actions/ticketFieldOptionsActions';
import type { InboundTicketDefaults, TicketFieldOptions } from '../../types/email.types';

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

  // Load field options on mount
  useEffect(() => {
    loadFieldOptions();
  }, []);

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
        entered_by: defaults.entered_by
      });
    }
  }, [defaults]);

  const loadFieldOptions = async () => {
    try {
      setLoadingOptions(true);
      const data = await getTicketFieldOptions();
      setFieldOptions(data.options);
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
      setError('Channel, status, and priority are required');
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

  const handleDefaultChange = (field: string, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
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
        <Textarea
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
            <Label htmlFor="channel_id">Channel *</Label>
            <CustomSelect
              id="channel_id"
              value={formData.channel_id}
              onValueChange={(value) => handleDefaultChange('channel_id', value)}
              options={fieldOptions.channels.map(c => ({ 
                value: c.id, 
                label: c.name + (c.is_default ? ' (Default)' : '') 
              }))}
              placeholder="Select channel"
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
            <CustomSelect
              id="priority_id"
              value={formData.priority_id}
              onValueChange={(value) => handleDefaultChange('priority_id', value)}
              options={fieldOptions.priorities.map(p => ({ 
                value: p.id, 
                label: p.name + (p.is_default ? ' (Default)' : '') 
              }))}
              placeholder="Select priority"
            />
          </div>

          {/* Optional Fields */}
          <div>
            <Label htmlFor="company_id">Company</Label>
            <CustomSelect
              id="company_id"
              value={formData.company_id}
              onValueChange={(value) => handleDefaultChange('company_id', value)}
              options={[
                { value: '', label: 'None' },
                ...fieldOptions.companies.map(c => ({ value: c.id, label: c.name }))
              ]}
              placeholder="Select company"
            />
          </div>

          <div>
            <Label htmlFor="category_id">Category</Label>
            <CustomSelect
              id="category_id"
              value={formData.category_id}
              onValueChange={(value) => handleDefaultChange('category_id', value)}
              options={[
                { value: '', label: 'None' },
                ...fieldOptions.categories
                  .filter(c => !c.parent_id)
                  .map(c => ({ value: c.id, label: c.name }))
              ]}
              placeholder="Select category"
            />
          </div>

          <div>
            <Label htmlFor="subcategory_id">Subcategory</Label>
            <CustomSelect
              id="subcategory_id"
              value={formData.subcategory_id}
              onValueChange={(value) => handleDefaultChange('subcategory_id', value)}
              options={[
                { value: '', label: 'None' },
                ...fieldOptions.categories
                  .filter(c => c.parent_id === formData.category_id)
                  .map(c => ({ value: c.id, label: c.name }))
              ]}
              placeholder="Select subcategory"
              disabled={!formData.category_id}
            />
          </div>

          <div>
            <Label htmlFor="entered_by">Entered By</Label>
            <CustomSelect
              id="entered_by"
              value={formData.entered_by || 'system'}
              onValueChange={(value) => handleDefaultChange('entered_by', value === 'system' ? null : value)}
              options={[
                { value: 'system', label: 'System (null)' },
                ...fieldOptions.users.map(u => ({ value: u.id, label: `${u.name} (${u.username})` }))
              ]}
              placeholder="Select user or system"
            />
            <p className="text-xs text-muted-foreground mt-1">
              System tickets will show "System" as creator
            </p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-6 border-t">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" disabled={loading}>
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