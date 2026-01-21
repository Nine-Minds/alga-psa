'use client';

import React, { useState } from 'react';
import { TabbedCustomFieldsCard } from 'server/src/components/ui/TabbedCustomFieldsCard';
import { CustomFieldsManager } from 'server/src/components/settings/custom-fields/CustomFieldsManager';
import { Tabs, TabsList, TabsTrigger, TabsContent } from 'server/src/components/ui/Tabs';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Building2, User, Ticket, Settings } from 'lucide-react';
import { CustomFieldEntityType } from 'server/src/interfaces/customField.interfaces';

/**
 * Test page for viewing Custom Fields on Companies/Contacts
 * Access at: /msp/test-entity-fields
 *
 * DELETE THIS FILE when ready to integrate into production
 */

const ENTITY_TYPES: { value: CustomFieldEntityType; label: string; icon: React.ReactNode }[] = [
  { value: 'ticket', label: 'Tickets', icon: <Ticket className="w-4 h-4" /> },
  { value: 'company', label: 'Companies', icon: <Building2 className="w-4 h-4" /> },
  { value: 'contact', label: 'Contacts', icon: <User className="w-4 h-4" /> }
];

export default function TestEntityFieldsPage() {
  const [activeTab, setActiveTab] = useState('preview');
  const [entityType, setEntityType] = useState<CustomFieldEntityType>('company');
  const [entityId, setEntityId] = useState('');
  const [viewMode, setViewMode] = useState<'tabbed' | 'collapsible'>('tabbed');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-sm text-yellow-800">
          <strong>Test Page:</strong> This is a temporary page for previewing Custom Fields on Companies/Contacts.
          Delete <code>src/app/(authenticated)/msp/test-entity-fields/page.tsx</code> when ready to integrate.
        </p>
      </div>

      <h1 className="text-2xl font-bold mb-6">Custom Fields - Entity Types</h1>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="preview">
            <Building2 className="w-4 h-4 mr-2" />
            Preview Fields
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="w-4 h-4 mr-2" />
            Manage Fields
          </TabsTrigger>
        </TabsList>

        {/* Preview Tab - Test viewing fields on entities */}
        <TabsContent value="preview">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Configuration Panel */}
            <div className="bg-white rounded-lg border p-6">
              <h2 className="text-lg font-semibold mb-4">Configuration</h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Entity Type
                  </label>
                  <div className="flex gap-2">
                    {ENTITY_TYPES.map(({ value, label, icon }) => (
                      <Button
                        key={value}
                        id={`select-entity-${value}`}
                        variant={entityType === value ? 'default' : 'outline'}
                        onClick={() => setEntityType(value)}
                        className="flex-1"
                      >
                        {icon}
                        <span className="ml-2">{label}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="entity-id" className="block text-sm font-medium text-gray-700 mb-1">
                    Entity ID
                  </label>
                  <Input
                    id="entity-id"
                    value={entityId}
                    onChange={(e) => setEntityId(e.target.value)}
                    placeholder={`Enter ${entityType} ID (UUID)...`}
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {entityType === 'company' && 'Get a company_id from the companies table'}
                    {entityType === 'contact' && 'Get a contact_name_id from the contact_names table'}
                    {entityType === 'ticket' && 'Get a ticket_id from the tickets table'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    View Mode
                  </label>
                  <div className="flex gap-2">
                    <Button
                      id="view-tabbed"
                      variant={viewMode === 'tabbed' ? 'default' : 'outline'}
                      onClick={() => setViewMode('tabbed')}
                      size="sm"
                    >
                      Tabbed
                    </Button>
                    <Button
                      id="view-collapsible"
                      variant={viewMode === 'collapsible' ? 'default' : 'outline'}
                      onClick={() => setViewMode('collapsible')}
                      size="sm"
                    >
                      Collapsible
                    </Button>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                <h3 className="text-sm font-medium text-blue-800 mb-2">How to test:</h3>
                <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                  <li>First, create some custom fields in the "Manage Fields" tab</li>
                  <li>Create field groups to organize fields</li>
                  <li>Then switch to this tab and enter an entity ID</li>
                  <li>The custom fields card will appear with your configured fields</li>
                </ol>
              </div>
            </div>

            {/* Preview Panel */}
            <div className="bg-gray-50 rounded-lg border p-6">
              <h2 className="text-lg font-semibold mb-4">Preview</h2>

              {entityId ? (
                <TabbedCustomFieldsCard
                  id={`preview-${entityType}-${entityId}`}
                  entityType={entityType}
                  entityId={entityId}
                  title={`${entityType.charAt(0).toUpperCase() + entityType.slice(1)} Custom Fields`}
                  viewMode={viewMode}
                  autoSaveDelay={0} // Manual save for testing
                />
              ) : (
                <div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
                  <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">Enter an entity ID to preview custom fields</p>
                </div>
              )}
            </div>
          </div>

          {/* Comparison: Both view modes side by side */}
          {entityId && (
            <div className="mt-8">
              <h2 className="text-lg font-semibold mb-4">View Mode Comparison</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Tabbed View</h3>
                  <TabbedCustomFieldsCard
                    id={`comparison-tabbed-${entityType}-${entityId}`}
                    entityType={entityType}
                    entityId={entityId}
                    viewMode="tabbed"
                    autoSaveDelay={1500}
                  />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Collapsible View</h3>
                  <TabbedCustomFieldsCard
                    id={`comparison-collapsible-${entityType}-${entityId}`}
                    entityType={entityType}
                    entityId={entityId}
                    viewMode="collapsible"
                    autoSaveDelay={1500}
                  />
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Settings Tab - Manage field definitions */}
        <TabsContent value="settings">
          <div className="bg-white rounded-lg border p-6">
            <CustomFieldsManager />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
