'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Plus, Settings, Trash2, Edit, CheckCircle, XCircle } from 'lucide-react';
import { InboundTicketDefaultsForm } from '../forms/InboundTicketDefaultsForm';
import { 
  getInboundTicketDefaults, 
  deleteInboundTicketDefaults 
} from '@alga-psa/integrations/actions';
import type { InboundTicketDefaults, TicketFieldOptions } from '@alga-psa/types';
import { getTicketFieldOptions } from '@alga-psa/integrations/actions';
import { MoreVertical } from 'lucide-react';
import { 
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@alga-psa/ui/components/DropdownMenu';

export interface InboundTicketDefaultsManagerProps {
  onDefaultsChange?: () => void;
}

export function InboundTicketDefaultsManager({ onDefaultsChange }: InboundTicketDefaultsManagerProps) {
  const { t } = useTranslation('msp/admin');
  const [defaults, setDefaults] = useState<InboundTicketDefaults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDefaults, setEditingDefaults] = useState<InboundTicketDefaults | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [fieldOptions, setFieldOptions] = useState<TicketFieldOptions>({
    boards: [],
    statuses: [],
    priorities: [],
    categories: [],
    clients: [],
    users: [],
    locations: []
  });

  useEffect(() => {
    loadDefaults();
  }, []);

  useEffect(() => {
    // Load option names for display mapping
    const loadOptions = async () => {
      try {
        const data = await getTicketFieldOptions();
        setFieldOptions(data.options);
      } catch (err) {
        // Keep options empty on failure; UI will fall back to IDs
      }
    };
    loadOptions();
  }, []);

  const loadDefaults = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await getInboundTicketDefaults();
      setDefaults(data.defaults || []);
    } catch (err: any) {
      setError(err.message || t('inboundDefaults.errors.load', { defaultValue: 'Failed to load ticket defaults' }));
    } finally {
      setLoading(false);
    }
  };

  const handleDefaultsCreated = (newDefaults: InboundTicketDefaults) => {
    setDefaults(prev => [newDefaults, ...prev]);
    setShowForm(false);
    onDefaultsChange?.();
  };

  const handleDefaultsUpdated = (updatedDefaults: InboundTicketDefaults) => {
    setDefaults(prev => prev.map(d => d.id === updatedDefaults.id ? updatedDefaults : d));
    setEditingDefaults(null);
    onDefaultsChange?.();
  };

  const handleEdit = (defaults: InboundTicketDefaults) => {
    setEditingDefaults(defaults);
    setShowForm(false);
  };

  const handleDelete = async (id: string) => {
    try {
      setDeleting(id);
      setError(null);
      
      await deleteInboundTicketDefaults(id);
      setDefaults(prev => prev.filter(d => d.id !== id));
      onDefaultsChange?.();
    } catch (err: any) {
      setError(err.message || t('inboundDefaults.errors.delete', { defaultValue: 'Failed to delete ticket defaults' }));
    } finally {
      setDeleting(null);
    }
  };

  const nameById = (list: { id: string; name: string }[], id?: string | null): string => {
    if (!id) return t('inboundDefaults.fallbacks.notSet', { defaultValue: 'Not set' });
    const found = list.find(x => String(x.id) === String(id));
    return found?.name || id;
  };

  const userNameById = (id?: string | null): string => {
    if (!id) return t('inboundDefaults.fallbacks.system', { defaultValue: 'System' });
    const u = fieldOptions.users.find(x => String(x.id) === String(id));
    return u ? (u.name || u.username || id) : id;
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingDefaults(null);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 !pt-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="ml-2">
              {t('inboundDefaults.loading', { defaultValue: 'Loading ticket defaults...' })}
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            {t('inboundDefaults.header.title', { defaultValue: 'Inbound Ticket Defaults' })}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t('inboundDefaults.header.description', {
              defaultValue: 'Configure default values for tickets created from email processing'
            })}
          </p>
        </div>
        <Button 
          id="add-defaults-button"
          onClick={() => setShowForm(true)}
          disabled={showForm || !!editingDefaults}
        >
          <Plus className="h-4 w-4 mr-2" />
          {t('inboundDefaults.actions.addDefaults', { defaultValue: 'Add Defaults' })}
        </Button>
      </div>

      {/* Error Alert */}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Add/Edit Form */}
      {(showForm || editingDefaults) && (
        <Card>
          <CardHeader>
            <CardTitle>
              {editingDefaults
                ? t('inboundDefaults.form.editTitle', { defaultValue: 'Edit Ticket Defaults' })
                : t('inboundDefaults.form.createTitle', { defaultValue: 'Create Ticket Defaults' })}
            </CardTitle>
            <CardDescription>
              {t('inboundDefaults.form.description', {
                defaultValue: 'Configure the default values that will be applied to tickets created from email processing'
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InboundTicketDefaultsForm
              defaults={editingDefaults}
              onSuccess={editingDefaults ? handleDefaultsUpdated : handleDefaultsCreated}
              onCancel={handleCancel}
            />
          </CardContent>
        </Card>
      )}

      {/* Defaults List */}
      {defaults.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="px-6 text-center !pt-12 !pb-12">
            <Settings className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">
              {t('inboundDefaults.empty.title', { defaultValue: 'No ticket defaults configured' })}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {t('inboundDefaults.empty.description', {
                defaultValue: 'Create your first configuration to define default values for email-generated tickets'
              })}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {defaults.map((defaultConfig) => (
            <Card key={defaultConfig.id}>
              <CardContent className="p-6 !pt-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-medium">{defaultConfig.display_name}</h4>
                      <Badge variant="secondary" className="text-xs">
                        {defaultConfig.short_name}
                      </Badge>
                      <Badge variant={defaultConfig.is_active ? "default" : "secondary"}>
                        {defaultConfig.is_active ? (
                          <>
                            <CheckCircle className="h-3 w-3 mr-1" />
                            {t('inboundDefaults.badges.active', { defaultValue: 'Active' })}
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3 mr-1" />
                            {t('inboundDefaults.badges.inactive', { defaultValue: 'Inactive' })}
                          </>
                        )}
                      </Badge>
                    </div>
                    
                    {defaultConfig.description && (
                      <p className="text-sm text-muted-foreground mb-3">
                        {defaultConfig.description}
                      </p>
                    )}

                    {/* Defaults Preview */}
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="font-medium">
                          {t('inboundDefaults.fields.board', { defaultValue: 'Board:' })}
                        </span>{' '}
                        {nameById(fieldOptions.boards, defaultConfig.board_id)}
                      </div>
                      <div>
                        <span className="font-medium">
                          {t('inboundDefaults.fields.status', { defaultValue: 'Status:' })}
                        </span>{' '}
                        {nameById(fieldOptions.statuses, defaultConfig.status_id)}
                      </div>
                      <div>
                        <span className="font-medium">
                          {t('inboundDefaults.fields.priority', { defaultValue: 'Priority:' })}
                        </span>{' '}
                        {nameById(fieldOptions.priorities, defaultConfig.priority_id)}
                      </div>
                      <div>
                        <span className="font-medium">
                          {t('inboundDefaults.fields.enteredBy', { defaultValue: 'Entered By:' })}
                        </span>{' '}
                        {userNameById(defaultConfig.entered_by)}
                      </div>
                    </div>
                  </div>

                  <div className="ml-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button id={`defaults-menu-${defaultConfig.id}`} variant="outline" size="sm">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          id={`defaults-menu-edit-${defaultConfig.id}`}
                          onClick={() => handleEdit(defaultConfig)}
                          disabled={showForm || !!editingDefaults || deleting === defaultConfig.id}
                        >
                          {t('inboundDefaults.menu.edit', { defaultValue: 'Edit' })}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          id={`defaults-menu-delete-${defaultConfig.id}`}
                          onClick={() => handleDelete(defaultConfig.id)}
                          disabled={showForm || !!editingDefaults || deleting === defaultConfig.id}
                          className="text-red-600 focus:text-red-700"
                        >
                          {deleting === defaultConfig.id
                            ? t('inboundDefaults.menu.deleting', { defaultValue: 'Deleting…' })
                            : t('inboundDefaults.menu.delete', { defaultValue: 'Delete' })}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Help Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t('inboundDefaults.help.title', { defaultValue: 'How It Works' })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>{t('inboundDefaults.help.items.providerReference', { defaultValue: '• Each email provider can reference one ticket defaults configuration' })}</p>
          <p>{t('inboundDefaults.help.items.requiredValues', { defaultValue: '• When an email creates a ticket, these defaults provide required field values' })}</p>
          <p>{t('inboundDefaults.help.items.systemCreator', { defaultValue: '• System-generated tickets will show "System" as the creator when entered_by is null' })}</p>
          <p>{t('inboundDefaults.help.items.scenarios', { defaultValue: '• You can create different defaults for different email scenarios (support, billing, etc.)' })}</p>
        </CardContent>
      </Card>
    </div>
  );
}
