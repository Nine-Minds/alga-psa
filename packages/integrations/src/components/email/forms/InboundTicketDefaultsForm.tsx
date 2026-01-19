'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Switch } from '@alga-psa/ui/components/Switch';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { 
  createInboundTicketDefaults, 
  updateInboundTicketDefaults 
} from '@alga-psa/integrations/actions';
import { getTicketFieldOptions, getCategoriesByBoard } from '@alga-psa/integrations/actions';
import type { InboundTicketDefaults, TicketFieldOptions } from '@alga-psa/types';
// Dedicated pickers used elsewhere in the app
import { BoardPicker } from '@alga-psa/ui/components/settings/general/BoardPicker';
import { ClientPicker } from '@alga-psa/clients/components/clients/ClientPicker';
import CategoryPicker from '@alga-psa/tickets/components/CategoryPicker';
import { PrioritySelect } from '@alga-psa/tickets/components/PrioritySelect';
import UserPicker from '@alga-psa/ui/components/UserPicker';
// Loaders to hydrate pickers with full data
import { getAllBoards } from '@alga-psa/tickets/actions';
import { getAllClients } from '@alga-psa/clients/actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getAllUsersBasic } from '@alga-psa/users/actions';
import type { IBoard, IPriority } from '@alga-psa/types';
import type { IClient } from '@alga-psa/types';
import type { ITicketCategory } from '@alga-psa/types';
import type { IUser } from '@shared/interfaces/user.interfaces';

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
    board_id: '',
    status_id: '',
    priority_id: '',
    client_id: '',
    category_id: '',
    subcategory_id: '',
    location_id: '',
    entered_by: null as string | null
  });
  
  const [fieldOptions, setFieldOptions] = useState<TicketFieldOptions>({
    boards: [],
    statuses: [],
    priorities: [],
    categories: [],
    clients: [],
    users: [],
    locations: []
  });
  
  const [loading, setLoading] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Data for dedicated pickers
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [priorities, setPriorities] = useState<IPriority[]>([]);
  const [usersWithRoles, setUsersWithRoles] = useState<IUser[]>([]);
  const [boardFilterState, setBoardFilterState] = useState<'active' | 'inactive' | 'all'>('all');
  const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');

  // Note: category/subcategory are now selected via CategoryPicker

  // Load field options on mount
  useEffect(() => {
    loadFieldOptions();
  }, []);

  // Load categories when board changes (server-side filtered)
  useEffect(() => {
    const loadCategoriesForBoard = async () => {
      if (!formData.board_id) {
        // Clear categories if no board selected
        setFieldOptions(prev => ({ ...prev, categories: [] }));
        return;
      }
      try {
        const { categories } = await getCategoriesByBoard(formData.board_id);
        setFieldOptions(prev => ({ ...prev, categories }));
      } catch (err) {
        // On error, keep categories empty for safety
        setFieldOptions(prev => ({ ...prev, categories: [] }));
      }
    };
    loadCategoriesForBoard();
  }, [formData.board_id]);

  // Populate form when editing
  useEffect(() => {
    if (defaults) {
      setFormData({
        short_name: defaults.short_name,
        display_name: defaults.display_name,
        description: defaults.description || '',
        is_active: defaults.is_active,
        board_id: defaults.board_id || '',
        status_id: defaults.status_id || '',
        priority_id: defaults.priority_id || '',
        client_id: defaults.client_id || '',
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
      // Boards with full metadata for BoardPicker
      const [allBoards, allClients, allPriorities, allUsers] = await Promise.all([
        getAllBoards(true),
        getAllClients(true),
        getAllPriorities('ticket'),
        getAllUsersBasic(true, 'internal')
      ]);
      setBoards(allBoards || []);
      setClients(allClients || []);
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

    if (!formData.board_id) {
      setError('Board is required');
      return;
    }

    if (!formData.status_id) {
      setError('Status is required');
      return;
    }

    if (!formData.priority_id) {
      setError('Priority is required');
      return;
    }

    // Client/Company is required
    if (!formData.client_id) {
      setError('Company is required');
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
        board_id: formData.board_id,
        status_id: formData.status_id,
        priority_id: formData.priority_id,
        client_id: formData.client_id || undefined,
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
      if (field === 'board_id') {
        next.category_id = '';
        next.subcategory_id = '';
      }
      if (field === 'category_id') {
        next.subcategory_id = '';
      }
      if (field === 'client_id' && prev.client_id !== value) {
        // Clear location if client changes
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
          <Label htmlFor="board_id">Board *</Label>
            <BoardPicker
              id="board_id"
              boards={boards}
              selectedBoardId={formData.board_id || null}
              onSelect={(value) => handleDefaultChange('board_id', value)}
              filterState={boardFilterState}
              onFilterStateChange={setBoardFilterState}
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
            <Label htmlFor="client_id">Client *</Label>
            <ClientPicker
              id="client_id"
              clients={clients}
              selectedClientId={formData.client_id || null}
              onSelect={(clientId) => handleDefaultChange('client_id', clientId || '')}
              filterState={clientFilterState}
              onFilterStateChange={setClientFilterState}
              clientTypeFilter={clientTypeFilter}
              onClientTypeFilterChange={setClientTypeFilter}
              placeholder="Select Client"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Required: used as a catch-all when no client can be matched from the email.
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
                board_id: c.board_id
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
              placeholder={formData.board_id ? 'Select category' : 'Select board first'}
              multiSelect={false}
              disabled={!formData.board_id}
              showReset
              allowEmpty
            />
            {formData.board_id && (fieldOptions.categories || []).filter(c => !c.parent_id && String(c.board_id || '') === String(formData.board_id)).length === 0 && (
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
                .filter(l => !formData.client_id || l.client_id === formData.client_id)
                .map(l => ({ value: l.id, label: l.name }))}
              placeholder={formData.client_id ? 'Select location' : 'Select client first (optional)'}
              disabled={!formData.client_id}
              allowClear
            />
            <p className="text-xs text-muted-foreground mt-1">
              Only applied when the catch-all client is used (no match case).
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
              Used only when we cannot match a contact or client. System tickets will show "System" as creator.
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
