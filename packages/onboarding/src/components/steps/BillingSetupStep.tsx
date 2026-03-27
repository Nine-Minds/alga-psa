'use client';

// Onboarding step: seed initial billing/service type configuration.

import React, { useState, useEffect } from 'react';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import type { StepProps } from '@alga-psa/types';
import { ChevronDown, ChevronUp, Package, Trash2, Settings } from 'lucide-react';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import {
  getStandardServiceTypes,
  importServiceTypes,
  getTenantServiceTypes,
  createTenantServiceType,
} from '@alga-psa/onboarding/actions';
import { CURRENCY_OPTIONS, getCurrencySymbol } from '@alga-psa/core';
import { deleteReferenceDataItem } from '@alga-psa/reference-data/actions';
import { useSession } from 'next-auth/react';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function BillingSetupStep({ data, updateData, attemptedToProceed = false }: StepProps) {
  const { data: session } = useSession();
  const { t } = useTranslation('msp/onboarding');
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

  const getBillingMethodLabel = (billingMethod: string) =>
    t(`billingSetupStep.billingMethods.${billingMethod}`, {
      defaultValue:
        billingMethod === 'fixed'
          ? 'Fixed'
          : billingMethod === 'hourly'
            ? 'Hourly'
            : billingMethod === 'usage'
              ? 'Usage'
              : billingMethod
    });

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
        toast.success(t('billingSetupStep.serviceTypes.toasts.deleted', {
          defaultValue: 'Service type deleted successfully'
        }));
      } else {
        toast.error(result.error || t('billingSetupStep.serviceTypes.errors.delete', {
          defaultValue: 'Failed to delete service type'
        }));
      }
    } catch (error) {
      handleError(error, t('billingSetupStep.serviceTypes.errors.delete', {
        defaultValue: 'Failed to delete service type'
      }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">
          {t('billingSetupStep.header.title', {
            defaultValue: 'Create Your First Service'
          })}
        </h2>
        <p className="text-sm text-gray-600">
          {t('billingSetupStep.header.description', {
            defaultValue: 'Add a service and choose how it should be billed. Service type identifies the service category, while billing mode controls pricing behavior.'
          })}
        </p>
      </div>

      {isServiceCreated && (
        <Alert variant="success">
          <AlertDescription>
            <p className="font-medium">
              {t('billingSetupStep.created.title', {
                defaultValue: 'Service created successfully!'
              })}
            </p>
            <p className="text-sm mt-1">
              {t('billingSetupStep.created.description', {
                defaultValue: '{{serviceName}} has been added to your service catalog.',
                serviceName: data.serviceName
              })}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="serviceName">
            {t('billingSetupStep.fields.serviceName.label', {
              defaultValue: 'Service Name *'
            })}
          </Label>
          <Input
            id="serviceName"
            value={data.serviceName}
            onChange={(e) => updateData({ serviceName: e.target.value })}
            placeholder={t('billingSetupStep.fields.serviceName.placeholder', {
              defaultValue: 'Managed IT Services'
            })}
          />
        </div>

        <div>
          <Label htmlFor="serviceDescription" className="block mb-2">
            {t('billingSetupStep.fields.serviceDescription.label', {
              defaultValue: 'Service Description'
            })}
          </Label>
          <TextArea
            id="serviceDescription"
            value={data.serviceDescription}
            onChange={(e) => updateData({ serviceDescription: e.target.value })}
            placeholder={t('billingSetupStep.fields.serviceDescription.placeholder', {
              defaultValue: 'Comprehensive IT support and management services...'
            })}
            rows={3}
            className="!max-w-none"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="serviceTypeId">
            {t('billingSetupStep.fields.serviceType.label', {
              defaultValue: 'Service Type *'
            })}
            {(!data.serviceTypeId && attemptedToProceed) && (
              <span className="text-xs text-red-600 ml-2">
                {t('billingSetupStep.fields.serviceType.required', {
                  defaultValue: '(Required)'
                })}
              </span>
            )}
          </Label>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <CustomSelect
              id="service-type-select"
              value={data.serviceTypeId || ''}
              onValueChange={(value) => updateData({ serviceTypeId: value })}
              options={serviceTypeOptions}
              disabled={isLoadingTypes || serviceTypeOptions.length === 0}
              placeholder={serviceTypeOptions.length === 0
                ? t('billingSetupStep.fields.serviceType.emptyPlaceholder', {
                    defaultValue: 'Create or import service types'
                  })
                : t('billingSetupStep.fields.serviceType.placeholder', {
                    defaultValue: 'Select a service type'
                  })}
            />
            <CustomSelect
              id="currency-select"
              value={data.currencyCode || 'USD'}
              onValueChange={(value) => updateData({ currencyCode: value })}
              options={CURRENCY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
              className="min-w-[130px]"
            />
            <Button
              id="manage-service-types-button"
              type="button"
              variant="outline"
              onClick={() => setShowServiceTypes(!showServiceTypes)}
              className="flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              <span>
                {t('billingSetupStep.serviceTypes.actions.manage', {
                  defaultValue: 'Manage Service Types'
                })}
              </span>
            </Button>
          </div>
          {serviceTypeOptions.length === 0 && !isLoadingTypes && (
            <p className="text-xs text-red-600">
              {t('billingSetupStep.fields.serviceType.emptyHelp', {
                defaultValue: 'Click "Manage Service Types" to create or import service types'
              })}
            </p>
          )}
        </div>

        {/* Service Types Management Section */}
        {showServiceTypes && (
          <div className="border rounded-lg p-4 space-y-4">
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                <span className="font-semibold">
                  {t('billingSetupStep.serviceTypes.noteLabel', {
                    defaultValue: 'Note:'
                  })}
                </span>{' '}
                {t('billingSetupStep.serviceTypes.description', {
                  defaultValue: 'Service types are taxonomy labels for organization and filtering. Billing mode is configured separately on each service.'
                })}
              </AlertDescription>
            </Alert>
            
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
                {t('billingSetupStep.serviceTypes.actions.import', {
                  defaultValue: 'Import from Standard'
                })}
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
                {t('billingSetupStep.serviceTypes.actions.add', {
                  defaultValue: 'Add New'
                })}
              </Button>
            </div>

            {/* Add New Service Type Form */}
            {showAddForm && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">
                  {t('billingSetupStep.serviceTypes.addForm.title', {
                    defaultValue: 'Add New Service Type'
                  })}
                </h4>
                
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="serviceTypeName">
                      {t('billingSetupStep.serviceTypes.addForm.fields.name.label', {
                        defaultValue: 'Name *'
                      })}
                    </Label>
                    <Input
                      id="serviceTypeName"
                      value={serviceTypeForm.name}
                      onChange={(e) => setServiceTypeForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder={t('billingSetupStep.serviceTypes.addForm.fields.name.placeholder', {
                        defaultValue: 'e.g., Premium Support'
                      })}
                    />
                  </div>

                  <div>
                    <Label htmlFor="serviceTypeDescription">
                      {t('billingSetupStep.serviceTypes.addForm.fields.description.label', {
                        defaultValue: 'Description'
                      })}
                    </Label>
                    <TextArea
                      id="serviceTypeDescription"
                      value={serviceTypeForm.description}
                      onChange={(e) => setServiceTypeForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder={t('billingSetupStep.serviceTypes.addForm.fields.description.placeholder', {
                        defaultValue: 'Describe this service type...'
                      })}
                      rows={2}
                    />
                  </div>

                  <div>
                    <Label htmlFor="billingMethod">
                      {t('billingSetupStep.serviceTypes.addForm.fields.billingMethod.label', {
                        defaultValue: 'Billing Method *'
                      })}
                    </Label>
                    <CustomSelect
                      id="billingMethod"
                      options={[
                        { value: 'fixed', label: t('billingSetupStep.billingMethods.fixed', { defaultValue: 'Fixed' }) },
                        { value: 'hourly', label: t('billingSetupStep.billingMethods.hourly', { defaultValue: 'Hourly' }) },
                        { value: 'usage', label: t('billingSetupStep.billingMethods.usageBased', { defaultValue: 'Usage Based' }) },
                      ]}
                      value={serviceTypeForm.billingMethod}
                      onValueChange={(value: string) => 
                        setServiceTypeForm(prev => ({ ...prev, billingMethod: value as 'fixed' | 'hourly' | 'usage' }))
                      }
                    />
                  </div>

                  <div>
                    <Label htmlFor="displayOrder">
                      {t('billingSetupStep.serviceTypes.addForm.fields.displayOrder.label', {
                        defaultValue: 'Display Order'
                      })}
                    </Label>
                    <Input
                      id="displayOrder"
                      type="number"
                      value={serviceTypeForm.displayOrder}
                      onChange={(e) => setServiceTypeForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                      placeholder={t('billingSetupStep.serviceTypes.addForm.fields.displayOrder.placeholder', {
                        defaultValue: 'Leave empty for auto-generate'
                      })}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('billingSetupStep.serviceTypes.addForm.fields.displayOrder.help', {
                        defaultValue: 'Controls the order in which service types appear in dropdown menus throughout the platform. Lower numbers appear first.'
                      })}
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
                    {t('common.actions.cancel', {
                      defaultValue: 'Cancel'
                    })}
                  </Button>
                  <Button
                    id="save-service-type-form"
                    type="button"
                    onClick={async () => {
                      if (!serviceTypeForm.name.trim()) {
                        toast.error(t('billingSetupStep.serviceTypes.errors.nameRequired', {
                          defaultValue: 'Service type name is required'
                        }));
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
                          toast.error(t('billingSetupStep.serviceTypes.errors.duplicate', {
                            defaultValue: 'Service type with this name already exists'
                          }));
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

                        const created = await createTenantServiceType({
                          name: serviceTypeForm.name,
                          description: serviceTypeForm.description || null,
                          billing_method: serviceTypeForm.billingMethod,
                          is_active: true,
                          order_number: finalOrder
                        });
                        if (!created.success) {
                          throw new Error(created.error || t('billingSetupStep.serviceTypes.errors.create', {
                            defaultValue: 'Failed to create service type'
                          }));
                        }

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
                        handleError(error, t('billingSetupStep.serviceTypes.errors.createRetry', {
                          defaultValue: 'Failed to create service type. Please try again.'
                        }));
                      }
                    }}
                    disabled={!serviceTypeForm.name.trim()}
                  >
                    {t('billingSetupStep.serviceTypes.actions.confirmAdd', {
                      defaultValue: 'Add Service Type'
                    })}
                  </Button>
                </div>
              </div>
            )}

            {/* Import Dialog */}
            {showImportDialog && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">
                  {t('billingSetupStep.serviceTypes.import.title', {
                    defaultValue: 'Import Standard Service Types'
                  })}
                </h4>
                
                <p className="text-sm text-gray-600">
                  {t('billingSetupStep.serviceTypes.import.description', {
                    defaultValue: 'Select standard service types to import into your system:'
                  })}
                </p>

                {importResult && importResult.imported > 0 && (
              <Alert variant="success">
                <AlertDescription>
                  <p className="font-medium">
                    {importResult.imported === 1
                      ? t('billingSetupStep.serviceTypes.import.success.titleOne', {
                          defaultValue: 'Service type imported successfully!'
                        })
                      : t('billingSetupStep.serviceTypes.import.success.titleOther', {
                          defaultValue: 'Service types imported successfully!'
                        })}
                  </p>
                  <p className="text-sm mt-1">
                    {t('billingSetupStep.serviceTypes.import.success.description', {
                      defaultValue: '{{count}} type{{suffix}} added to your catalog.',
                      count: importResult.imported,
                      suffix: importResult.imported !== 1 ? 's' : ''
                    })}
                    {importResult.skipped > 0 && ` ${t('billingSetupStep.serviceTypes.import.success.skipped', {
                      defaultValue: '{{count}} skipped.',
                      count: importResult.skipped
                    })}`}
                  </p>
                </AlertDescription>
              </Alert>
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
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">
                      {t('billingSetupStep.serviceTypes.table.headers.name', {
                        defaultValue: 'Name'
                      })}
                    </th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">
                      {t('billingSetupStep.serviceTypes.table.headers.billingMethod', {
                        defaultValue: 'Billing Method'
                      })}
                    </th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">
                      {t('billingSetupStep.serviceTypes.table.headers.order', {
                        defaultValue: 'Order'
                      })}
                    </th>
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
                        {getBillingMethodLabel(type.billing_method)}
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
                  {isImporting
                    ? t('billingSetupStep.serviceTypes.import.actions.importing', {
                        defaultValue: 'Importing...'
                      })
                    : t('billingSetupStep.serviceTypes.import.actions.importSelected', {
                        defaultValue: 'Import Selected ({{count}})',
                        count: selectedTypes.length
                      })}
                </Button>
              </div>
            )}

            {/* Current Service Types */}
            {tenantTypes.length > 0 && (
              <div className="mt-4">
                <Label className="mb-2 block">
                  {t('billingSetupStep.serviceTypes.current.title', {
                    defaultValue: 'Current Service Types'
                  })}
                </Label>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-700">
                          {t('billingSetupStep.serviceTypes.table.headers.name', {
                            defaultValue: 'Name'
                          })}
                        </th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">
                          {t('billingSetupStep.serviceTypes.table.headers.billingMethod', {
                            defaultValue: 'Billing Method'
                          })}
                        </th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">
                          {t('billingSetupStep.serviceTypes.table.headers.order', {
                            defaultValue: 'Order'
                          })}
                        </th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">
                          {t('billingSetupStep.serviceTypes.table.headers.actions', {
                            defaultValue: 'Actions'
                          })}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {tenantTypes.map((type, idx) => (
                        <tr key={type.id}>
                          <td className="px-2 py-1 text-xs">{type.name}</td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">
                            {getBillingMethodLabel(type.billing_method)}
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
                              title={t('billingSetupStep.serviceTypes.current.removeTitle', {
                                defaultValue: 'Remove service type'
                              })}
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
          <Label htmlFor="serviceBillingMode">
            {t('billingSetupStep.fields.billingMode.label', {
              defaultValue: 'Billing Mode'
            })}
          </Label>
          <CustomSelect
            id="serviceBillingMode"
            value={data.serviceBillingMode || 'usage'}
            onValueChange={(value) => updateData({ serviceBillingMode: value as 'fixed' | 'hourly' | 'usage' })}
            options={[
              { value: 'fixed', label: t('billingSetupStep.billingMethods.fixed', { defaultValue: 'Fixed' }) },
              { value: 'hourly', label: t('billingSetupStep.billingMethods.hourly', { defaultValue: 'Hourly' }) },
              { value: 'usage', label: t('billingSetupStep.billingMethods.usage', { defaultValue: 'Usage' }) },
            ]}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="servicePrice">
            {t('billingSetupStep.fields.defaultRate.label', {
              defaultValue: 'Default Rate'
            })}
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 pointer-events-none">
              {getCurrencySymbol(data.currencyCode || 'USD')}
            </span>
            <Input
              id="servicePrice"
              value={data.servicePrice}
              onChange={(e) => updateData({ servicePrice: e.target.value })}
              placeholder={t('billingSetupStep.fields.defaultRate.placeholder', {
                defaultValue: '150'
              })}
              style={{ paddingLeft: `${getCurrencySymbol(data.currencyCode || 'USD').length * 0.6 + 0.75}rem` }}
            />
          </div>
        </div>
      </div>

      {serviceTypeOptions.length === 0 && attemptedToProceed && (
        <Alert variant="destructive">
          <AlertDescription>
            <span className="font-semibold">
              {t('billingSetupStep.validation.actionRequiredLabel', {
                defaultValue: 'Action Required:'
              })}
            </span>{' '}
            {t('billingSetupStep.validation.actionRequiredDescription', {
              defaultValue: 'Click "Manage Service Types" above to create or import at least one service type before creating a service.'
            })}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
