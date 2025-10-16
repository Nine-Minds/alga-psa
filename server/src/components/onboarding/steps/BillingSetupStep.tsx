'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { TextArea } from 'server/src/components/ui/TextArea';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { StepProps } from '../types';
import { CheckCircle, ChevronDown, ChevronUp, Package, Trash2, Settings } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { 
  getStandardServiceTypes, 
  importServiceTypes, 
  getTenantServiceTypes 
} from 'server/src/lib/actions/onboarding-actions/serviceTypeActions';
import { deleteReferenceDataItem } from 'server/src/lib/actions/referenceDataActions';
import { createServiceType } from 'server/src/lib/actions/serviceActions';
import { useSession } from 'next-auth/react';
import { Switch } from 'server/src/components/ui/Switch';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';

export function BillingSetupStep({ data, updateData, attemptedToProceed = false }: StepProps) {
  const { data: session } = useSession();
  const isServiceCreated = !!data.serviceId;
  const [showServiceTypes, setShowServiceTypes] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [standardTypes, setStandardTypes] = useState<Array<{ id: string; name: string; billing_method: string; display_order?: number }>>([]);
  const [tenantTypes, setTenantTypes] = useState<Array<{ id: string; name: string; billing_method: string }>>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [isLoadingTypes, setIsLoadingTypes] = useState(false);
  
  // Form state for new service type
  const [serviceTypeForm, setServiceTypeForm] = useState({
    name: '',
    description: '',
    billingMethod: 'fixed' as 'fixed' | 'hourly' | 'usage',
    isActive: true,
    displayOrder: 0
  });

  useEffect(() => {
    loadTenantServiceTypes();
  }, []);

  useEffect(() => {
    if (showImportDialog) {
      loadStandardServiceTypes();
    }
  }, [showImportDialog, tenantTypes]); // Reload when tenant types change

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
    label: type.name
  }));

  const removeServiceType = async (typeId: string) => {
    try {
      const result = await deleteReferenceDataItem('service_types', typeId);
      if (result.success) {
        // Remove from tenant types
        setTenantTypes(prev => prev.filter(t => t.id !== typeId));
        
        // If this was the selected type, clear it
        if (data.serviceTypeId === typeId) {
          updateData({ serviceTypeId: undefined });
        }
        
        // Refresh data from server
        loadTenantServiceTypes();
        toast.success('Service type deleted successfully');
      } else {
        toast.error(result.error || 'Failed to delete service type');
      }
    } catch (error) {
      console.error('Error deleting service type:', error);
      toast.error('Failed to delete service type');
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Create Your First Service</h2>
        <p className="text-sm text-gray-600">
          Add a service type to your catalog. This will be used for time tracking. When billing becomes available, it will also be used for creating invoices.
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

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="serviceName">Service Name *</Label>
          <Input
            id="serviceName"
            value={data.serviceName}
            onChange={(e) => updateData({ serviceName: e.target.value })}
            placeholder="Managed IT Services"
          />
        </div>

        <div>
          <Label htmlFor="serviceDescription" className="block mb-2">Service Description</Label>
          <TextArea
            id="serviceDescription"
            value={data.serviceDescription}
            onChange={(e) => updateData({ serviceDescription: e.target.value })}
            placeholder="Comprehensive IT support and management services..."
            rows={3}
            className="!max-w-none"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="serviceTypeId">
            Service Type *
            {(!data.serviceTypeId && attemptedToProceed) && (
              <span className="text-xs text-red-600 ml-2">(Required)</span>
            )}
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect
              id="service-type-select"
              value={data.serviceTypeId || ''}
              onValueChange={(value) => updateData({ serviceTypeId: value })}
              options={serviceTypeOptions}
              disabled={isLoadingTypes || serviceTypeOptions.length === 0}
              placeholder={serviceTypeOptions.length === 0 ? "Create or import service types" : "Select a service type"}
            />
            <Button
              id="manage-service-types-button"
              type="button"
              variant="outline"
              onClick={() => setShowServiceTypes(!showServiceTypes)}
              className="flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              <span>Manage Service Types</span>
            </Button>
          </div>
          {serviceTypeOptions.length === 0 && !isLoadingTypes && (
            <p className="text-xs text-red-600">
              Click "Manage Service Types" to create or import service types
            </p>
          )}
        </div>

        {/* Service Types Management Section */}
        {showServiceTypes && (
          <div className="border rounded-lg p-4 space-y-4">
            <div className="rounded-md bg-blue-50 p-4 mb-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Note:</span> Service types define how services are billed. Fixed billing means a flat rate, hourly billing tracks time-based work, and usage billing charges per unit consumed.
              </p>
            </div>
            
            <div className="flex gap-2">
              <Button
                id="import-standard-types-btn"
                type="button"
                variant="outline"
                onClick={() => {
                  setShowImportDialog(prev => !prev);
                  if (!showImportDialog) {
                    setShowAddForm(false);
                    loadStandardServiceTypes();
                  }
                }}
                className="flex-1"
              >
                <Package className="w-4 h-4 mr-2" />
                Import from Standard
              </Button>
              <Button
                id="add-service-type-btn"
                type="button"
                variant="outline"
                onClick={() => {
                  setShowAddForm(prev => !prev);
                  if (!showAddForm) {
                    setShowImportDialog(false);
                    // Calculate next order number
                    const maxOrder = tenantTypes.reduce((max, t) => {
                      const order = (t as any).order_number || (t as any).display_order || 0;
                      return Math.max(max, order);
                    }, 0);
                    setServiceTypeForm(prev => ({ ...prev, displayOrder: maxOrder + 1 }));
                  }
                }}
                className="flex-1"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New
              </Button>
            </div>

            {/* Add New Service Type Form */}
            {showAddForm && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Add New Service Type</h4>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="serviceTypeName">Name *</Label>
                    <Input
                      id="serviceTypeName"
                      value={serviceTypeForm.name}
                      onChange={(e) => setServiceTypeForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Premium Support"
                    />
                  </div>

                  <div>
                    <Label htmlFor="serviceTypeDescription">Description</Label>
                    <TextArea
                      id="serviceTypeDescription"
                      value={serviceTypeForm.description}
                      onChange={(e) => setServiceTypeForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe this service type..."
                      rows={2}
                    />
                  </div>

                  <div>
                    <Label htmlFor="billingMethod">Billing Method *</Label>
                    <CustomSelect
                      id="billingMethod"
                      options={[
                        { value: 'fixed', label: 'Fixed' },
                        { value: 'hourly', label: 'Hourly' },
                        { value: 'usage', label: 'Usage Based' },
                      ]}
                      value={serviceTypeForm.billingMethod}
                      onValueChange={(value: string) => 
                        setServiceTypeForm(prev => ({ ...prev, billingMethod: value as 'fixed' | 'hourly' | 'usage' }))
                      }
                    />
                  </div>

                  <div>
                    <Label htmlFor="displayOrder">Display Order</Label>
                    <Input
                      id="displayOrder"
                      type="number"
                      value={serviceTypeForm.displayOrder}
                      onChange={(e) => setServiceTypeForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                      placeholder="Leave empty for auto-generate"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls the order in which service types appear in dropdown menus throughout the platform. Lower numbers appear first.
                    </p>
                  </div>

                </div>

                <div className="flex gap-2 justify-end">
                  <Button
                    id="cancel-service-type-form"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAddForm(false);
                      setServiceTypeForm({
                        name: '',
                        description: '',
                        billingMethod: 'fixed',
                        isActive: true,
                        displayOrder: 0
                      });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-service-type-form"
                    type="button"
                    onClick={async () => {
                      if (!serviceTypeForm.name.trim()) {
                        toast.error('Service type name is required');
                        return;
                      }

                      try {
                        // Get the latest service types directly from the API
                        const result = await getTenantServiceTypes();
                        let latestTypes: any[] = [];
                        if (result.success && result.data) {
                          latestTypes = result.data;
                        }

                        // Check if service type already exists using latest data
                        const nameExists = latestTypes.some(type => 
                          type.name.toLowerCase() === serviceTypeForm.name.trim().toLowerCase()
                        );
                        
                        if (nameExists) {
                          toast.error('Service type with this name already exists');
                          return;
                        }
                        
                        // Calculate the actual next order number to avoid conflicts
                        const allOrders = latestTypes.map(t => 
                          t.order_number || t.display_order || 0
                        );
                        const maxOrder = allOrders.length > 0 ? Math.max(...allOrders) : 0;
                        let finalOrder = maxOrder + 1;
                        
                        // If user provided a custom order, check if it's available
                        if (serviceTypeForm.displayOrder && serviceTypeForm.displayOrder > 0) {
                          const usedOrders = new Set(allOrders);
                          if (usedOrders.has(serviceTypeForm.displayOrder)) {
                            // Order is taken, use the next available
                            finalOrder = maxOrder + 1;
                          } else {
                            // Use the user's preferred order
                            finalOrder = serviceTypeForm.displayOrder;
                          }
                        }

                        console.log('Creating service type with order:', finalOrder, 'Existing orders:', allOrders);

                        await createServiceType({
                          name: serviceTypeForm.name,
                          description: serviceTypeForm.description || null,
                          billing_method: serviceTypeForm.billingMethod,
                          is_active: true,
                          order_number: finalOrder
                        });

                        // Reload tenant types
                        await loadTenantServiceTypes();
                        
                        // Reset form and close
                        setServiceTypeForm({
                          name: '',
                          description: '',
                          billingMethod: 'fixed',
                          isActive: true,
                          displayOrder: 0
                        });
                        setShowAddForm(false);
                      } catch (error) {
                        console.error('Error creating service type:', error);
                        toast.error('Failed to create service type. Please try again.');
                      }
                    }}
                    disabled={!serviceTypeForm.name.trim()}
                  >
                    Add Service Type
                  </Button>
                </div>
              </div>
            )}

            {/* Import Dialog */}
            {showImportDialog && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Import Standard Service Types</h4>
                
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
                  {standardTypes.map((type, idx) => (
                    <tr key={type.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <Checkbox
                          checked={selectedTypes.includes(type.id)}
                          onChange={() => toggleTypeSelection(type.id)}
                        />
                      </td>
                      <td className="px-4 py-2 text-sm">{type.name}</td>
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {type.billing_method === 'fixed'
                          ? 'Fixed'
                          : type.billing_method === 'hourly'
                            ? 'Hourly'
                            : 'Usage'}
                      </td>
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

            {/* Current Service Types */}
            {tenantTypes.length > 0 && (
              <div className="mt-4">
                <Label className="mb-2 block">Current Service Types</Label>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-700">Name</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Billing Method</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Order</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {tenantTypes.map((type, idx) => (
                        <tr key={type.id}>
                          <td className="px-2 py-1 text-xs">{type.name}</td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">
                            {type.billing_method === 'fixed'
                              ? 'Fixed'
                              : type.billing_method === 'hourly'
                                ? 'Hourly'
                                : 'Usage'}
                          </td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">
                            {(type as any).order_number || (type as any).display_order || '-'}
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Button
                              id={`service-type-remove-${idx}`}
                              data-type-id={type.id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeServiceType(type.id)}
                              className="p-1 h-6 w-6"
                              title="Remove service type"
                            >
                              <Trash2 className="h-3 w-3 text-gray-500 hover:text-red-600" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="servicePrice">Default Rate</Label>
          <Input
            id="servicePrice"
            value={data.servicePrice}
            onChange={(e) => updateData({ servicePrice: e.target.value })}
            placeholder="150"
          />
        </div>
      </div>

      {serviceTypeOptions.length === 0 && attemptedToProceed && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4">
          <p className="text-sm text-red-800">
            <span className="font-semibold">Action Required:</span> Click "Manage Service Types" above to create or import at least one service type before creating a service.
          </p>
        </div>
      )}
    </div>
  );
}
