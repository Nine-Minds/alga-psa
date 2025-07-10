'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { StepProps } from '../types';
import { CheckCircle, ChevronDown, ChevronUp, Package } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { 
  getStandardServiceTypes, 
  importServiceTypes, 
  getTenantServiceTypes 
} from 'server/src/lib/actions/onboarding-actions/serviceTypeActions';

export function BillingSetupStep({ data, updateData }: StepProps) {
  const isServiceCreated = !!data.serviceId;
  const [showImportSection, setShowImportSection] = useState(false);
  const [standardTypes, setStandardTypes] = useState<Array<{ id: string; name: string; billing_method: string; display_order?: number }>>([]);
  const [tenantTypes, setTenantTypes] = useState<Array<{ id: string; name: string; billing_method: string }>>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);

  useEffect(() => {
    loadTenantServiceTypes();
  }, []);

  useEffect(() => {
    if (showImportSection) {
      loadStandardServiceTypes();
    }
  }, [showImportSection, tenantTypes]); // Reload when tenant types change

  const loadStandardServiceTypes = async () => {
    const result = await getStandardServiceTypes();
    if (result.success && result.data) {
      // Filter out any types that might have been imported since last load
      const availableTypes = result.data.filter(st => 
        !tenantTypes.some(tt => tt.name === st.name)
      );
      setStandardTypes(availableTypes);
    }
  };

  const loadTenantServiceTypes = async () => {
    setIsLoadingTypes(true);
    const result = await getTenantServiceTypes();
    if (result.success && result.data) {
      setTenantTypes(result.data);
      // Set default service type if none selected
      if (!data.serviceTypeId && result.data.length > 0) {
        updateData({ serviceTypeId: result.data[0].id });
      }
    }
    setIsLoadingTypes(false);
  };

  const handleImport = async () => {
    if (selectedTypes.length === 0) return;
    
    setIsImporting(true);
    setImportResult(null);
    
    const result = await importServiceTypes(selectedTypes);
    if (result.success && result.data) {
      setImportResult(result.data);
      setSelectedTypes([]);
      // Reload both tenant service types and available standard types
      await loadTenantServiceTypes();
      await loadStandardServiceTypes();
    }
    
    setIsImporting(false);
  };

  const toggleTypeSelection = (typeId: string) => {
    setSelectedTypes(prev => 
      prev.includes(typeId) 
        ? prev.filter(id => id !== typeId)
        : [...prev, typeId]
    );
  };

  const serviceTypeOptions = tenantTypes.map(type => ({
    value: type.id,
    label: `${type.name} (${type.billing_method})`
  }));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Create Your First Service</h2>
        <p className="text-sm text-gray-600">
          Add a billable service to your catalog. This will be available when creating invoices and tracking time.
        </p>
      </div>

      {isServiceCreated && (
        <div className="rounded-md bg-green-50 border border-green-200 p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-800">Service created successfully!</p>
            <p className="text-sm text-green-600 mt-1">
              <span className="font-semibold">{data.serviceName}</span> has been added to your service catalog.
            </p>
          </div>
        </div>
      )}

      {/* Import Service Types Section */}
      <div className="border rounded-lg">
        <button
          type="button"
          onClick={() => setShowImportSection(!showImportSection)}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-500" />
            <span className="font-medium">Import Service Types</span>
            {tenantTypes.length === 0 && (
              <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Required</span>
            )}
          </div>
          {showImportSection ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {showImportSection && (
          <div className="p-4 border-t space-y-4">
            <p className="text-sm text-gray-600">
              Select standard service types to import into your system:
            </p>

            {importResult && importResult.imported > 0 && (
              <div className="rounded-md bg-green-50 border border-green-200 p-4 flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">
                    Service type{importResult.imported !== 1 ? 's' : ''} imported successfully!
                  </p>
                  <p className="text-sm text-green-600 mt-1">
                    {importResult.imported} type{importResult.imported !== 1 ? 's' : ''} added to your catalog.
                    {importResult.skipped > 0 && ` ${importResult.skipped} skipped.`}
                  </p>
                </div>
              </div>
            )}

            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={standardTypes.length > 0 && 
                            standardTypes.every(t => selectedTypes.includes(t.id))}
                          onChange={() => {
                            if (standardTypes.every(t => selectedTypes.includes(t.id))) {
                              setSelectedTypes([]);
                            } else {
                              setSelectedTypes(standardTypes.map(t => t.id));
                            }
                          }}
                          disabled={standardTypes.length === 0}
                        />
                      </div>
                    </th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Name</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Billing Method</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {standardTypes.map(type => (
                    <tr key={type.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <Checkbox
                          checked={selectedTypes.includes(type.id)}
                          onChange={() => toggleTypeSelection(type.id)}
                        />
                      </td>
                      <td className="px-4 py-2 text-sm">{type.name}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{type.billing_method}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">{type.display_order || 0}</td>
                    </tr>
                  ))}
                  </tbody>
                </table>
              </div>
            </div>

            <Button
              id="import-service-types"
              type="button"
              onClick={handleImport}
              disabled={selectedTypes.length === 0 || isImporting}
              className="w-full"
            >
              {isImporting ? 'Importing...' : `Import Selected (${selectedTypes.length})`}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="serviceTypeId">Service Type *</Label>
          <CustomSelect
            value={data.serviceTypeId || ''}
            onValueChange={(value) => updateData({ serviceTypeId: value })}
            options={serviceTypeOptions}
            disabled={isLoadingTypes || serviceTypeOptions.length === 0}
            placeholder={serviceTypeOptions.length === 0 ? "Import service types first" : "Select a service type"}
          />
          {serviceTypeOptions.length === 0 && !isLoadingTypes && (
            <p className="text-xs text-red-600">
              You must import service types above before creating a service
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="serviceName">Service Name *</Label>
          <Input
            id="serviceName"
            value={data.serviceName}
            onChange={(e) => updateData({ serviceName: e.target.value })}
            placeholder="Managed IT Services"
            disabled={!data.serviceTypeId}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="billingMethod">Billing Method</Label>
            <Input
              id="billingMethod"
              value={tenantTypes.find(t => t.id === data.serviceTypeId)?.billing_method || ''}
              disabled
              className="bg-gray-100"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="servicePrice">Default Rate</Label>
            <Input
              id="servicePrice"
              value={data.servicePrice}
              onChange={(e) => updateData({ servicePrice: e.target.value })}
              placeholder="150"
              disabled={!data.serviceTypeId}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="serviceDescription">Service Description</Label>
          <TextArea
            id="serviceDescription"
            value={data.serviceDescription}
            onChange={(e) => updateData({ serviceDescription: e.target.value })}
            placeholder="Comprehensive IT support and management services..."
            rows={3}
            disabled={!data.serviceTypeId}
          />
        </div>
      </div>

      {serviceTypeOptions.length === 0 && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-700">
            <span className="font-semibold">Action Required:</span> Import at least one service type from the section above to proceed with service creation.
          </p>
        </div>
      )}
    </div>
  );
}