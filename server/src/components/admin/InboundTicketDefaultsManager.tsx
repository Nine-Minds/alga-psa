'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Alert, AlertDescription } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Plus, Settings, Trash2, Edit, CheckCircle, XCircle } from 'lucide-react';
import { InboundTicketDefaultsForm } from '../forms/InboundTicketDefaultsForm';
import { 
  getInboundTicketDefaults, 
  deleteInboundTicketDefaults 
} from '../../lib/actions/email-actions/inboundTicketDefaultsActions';
import type { InboundTicketDefaults } from '../../types/email.types';

export interface InboundTicketDefaultsManagerProps {
  onDefaultsChange?: () => void;
}

export function InboundTicketDefaultsManager({ onDefaultsChange }: InboundTicketDefaultsManagerProps) {
  const [defaults, setDefaults] = useState<InboundTicketDefaults[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingDefaults, setEditingDefaults] = useState<InboundTicketDefaults | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    loadDefaults();
  }, []);

  const loadDefaults = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const data = await getInboundTicketDefaults();
      setDefaults(data.defaults || []);
    } catch (err: any) {
      setError(err.message);
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
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingDefaults(null);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="ml-2">Loading ticket defaults...</span>
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
          <h3 className="text-lg font-semibold">Inbound Ticket Defaults</h3>
          <p className="text-sm text-muted-foreground">
            Configure default values for tickets created from email processing
          </p>
        </div>
        <Button 
          id="add-defaults-button"
          onClick={() => setShowForm(true)}
          disabled={showForm || !!editingDefaults}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Defaults
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
              {editingDefaults ? 'Edit Ticket Defaults' : 'Create Ticket Defaults'}
            </CardTitle>
            <CardDescription>
              Configure the default values that will be applied to tickets created from email processing
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
            <p className="text-muted-foreground">No ticket defaults configured</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create your first configuration to define default values for email-generated tickets
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {defaults.map((defaultConfig) => (
            <Card key={defaultConfig.id}>
              <CardContent className="p-6">
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
                            Active
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3 mr-1" />
                            Inactive
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
                        <span className="font-medium">Channel:</span> {defaultConfig.channel_id || 'Not set'}
                      </div>
                      <div>
                        <span className="font-medium">Status:</span> {defaultConfig.status_id || 'Not set'}
                      </div>
                      <div>
                        <span className="font-medium">Priority:</span> {defaultConfig.priority_id || 'Not set'}
                      </div>
                      <div>
                        <span className="font-medium">Entered By:</span> {defaultConfig.entered_by || 'System'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <Button
                      id={`edit-defaults-${defaultConfig.id}`}
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(defaultConfig)}
                      disabled={showForm || !!editingDefaults || deleting === defaultConfig.id}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      id={`delete-defaults-${defaultConfig.id}`}
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(defaultConfig.id)}
                      disabled={showForm || !!editingDefaults || deleting === defaultConfig.id}
                      className="text-red-600 hover:text-red-700"
                    >
                      {deleting === defaultConfig.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
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
          <CardTitle className="text-base">How It Works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• Each email provider can reference one ticket defaults configuration</p>
          <p>• When an email creates a ticket, these defaults provide required field values</p>
          <p>• System-generated tickets will show "System" as the creator when entered_by is null</p>
          <p>• You can create different defaults for different email scenarios (support, billing, etc.)</p>
        </CardContent>
      </Card>
    </div>
  );
}
