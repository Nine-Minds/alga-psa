'use client'
import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent } from 'server/src/components/ui/Dialog'
import { Button } from 'server/src/components/ui/Button'
import { Input } from 'server/src/components/ui/Input'
import { Label } from 'server/src/components/ui/Label'
import CustomSelect from 'server/src/components/ui/CustomSelect'
import { EditableServiceTypeSelect } from 'server/src/components/ui/EditableServiceTypeSelect'
import { Switch } from 'server/src/components/ui/Switch'
import { Alert, AlertDescription } from 'server/src/components/ui/Alert'
import { createService, type CreateServiceInput, createServiceTypeInline, updateServiceTypeInline, deleteServiceTypeInline } from '@product/actions/serviceActions'
// Import getTaxRates and ITaxRate instead
import { getTaxRates } from '@product/actions/taxSettingsActions'; // Removed getActiveTaxRegions
import { ITaxRate } from 'server/src/interfaces/tax.interfaces'; // Removed ITaxRegion
// Note: getServiceCategories might be removable if categories are fully replaced by service types
import { getServiceCategories } from '@product/actions/categoryActions'
import { IService, IServiceCategory, IServiceType } from 'server/src/interfaces/billing.interfaces' // Added IServiceType
import { UnitOfMeasureInput } from 'server/src/components/ui/UnitOfMeasureInput'
import { useTenant } from 'server/src/components/TenantProvider'

interface QuickAddServiceProps {
  onServiceAdded: () => void;
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage' }[]; // Updated billing methods
  onServiceTypesChange: () => void; // Add callback to refresh service types
}

// Updated interface to use custom_service_type_id
// and tax_rate_id instead of old tax fields
interface ServiceFormData {
  service_name: string;
  custom_service_type_id: string; // Required for form state
  billing_method: 'fixed' | 'hourly' | 'usage' | '';
  default_rate: number;
  unit_of_measure: string;
  tax_rate_id?: string | null;
  description?: string | null;
  category_id?: string | null; // Added category field
  // Additional fields for form
  sku?: string;
  inventory_count?: number;
  seat_limit?: number;
  license_term?: string;
}

// Removed old SERVICE_TYPE_OPTIONS

// Removed hardcoded SERVICE_CATEGORY_OPTIONS - will use fetched categories instead

const LICENSE_TERM_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'perpetual', label: 'Perpetual' }
];

const BILLING_METHOD_OPTIONS = [
  { value: 'fixed', label: 'Fixed Fee' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'usage', label: 'Usage Based' }
];

export function QuickAddService({ onServiceAdded, allServiceTypes, onServiceTypesChange }: QuickAddServiceProps) { // Destructure new prop
  const [open, setOpen] = useState(false)
  const [triggerButton, setTriggerButton] = useState<HTMLButtonElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<IServiceCategory[]>([]) // Keep for now, might be replaced
  // State for tax rates instead of regions
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  // Renamed states back to focus only on tax rates
  const [isLoadingTaxRates, setIsLoadingTaxRates] = useState(true);
  const [errorTaxRates, setErrorTaxRates] = useState<string | null>(null);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const tenant = useTenant()
  // State for rate input (display value while typing)
  const [rateInput, setRateInput] = useState<string>('')

  // Initialize service state
  const [serviceData, setServiceData] = useState<ServiceFormData>({
    service_name: '',
    custom_service_type_id: '',
    billing_method: '',
    default_rate: 0,
    unit_of_measure: '',
    // is_taxable and region_code removed
    tax_rate_id: null, // Added
    description: '',
    category_id: null, // Added
    sku: '',
    inventory_count: 0,
    seat_limit: 0,
    license_term: 'monthly'
  })

  // This useEffect might be removable if categories are fully replaced by service types
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const fetchedCategories = await getServiceCategories()
        setCategories(fetchedCategories)
      } catch (error) {
        console.error('Error fetching categories:', error)
        setError('Failed to fetch categories')
      }
    }

    // Fetch tax rates instead of regions
    // Fetch only tax rates (as they contain description/region_code)
    const fetchTaxRates = async () => {
       setIsLoadingTaxRates(true);
       setErrorTaxRates(null);
       try {
           const rates = await getTaxRates();
           // Log fetched rates to confirm structure (optional, can be removed later)
           console.log('[QuickAddService] Fetched Tax Rates:', rates);
           setTaxRates(rates);
       } catch (error) {
           console.error('Error loading tax rates:', error);
           const errorMessage = error instanceof Error ? error.message : 'Failed to load tax rates.';
           setErrorTaxRates(errorMessage);
           setTaxRates([]); // Clear rates on error
       } finally {
           setIsLoadingTaxRates(false);
       }
    };

    fetchCategories(); // Keep fetching categories for now
    fetchTaxRates(); // Call fetchTaxRates
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setHasAttemptedSubmit(true)
    const errors: string[] = []
    
    try {
      // Validate required fields
      if (!serviceData.service_name.trim()) {
        errors.push('Service name is required')
      }
      if (!serviceData.custom_service_type_id || serviceData.custom_service_type_id.trim() === '') { // Check ID is not empty
        errors.push('Service type is required') // Updated label
      }
      if (!serviceData.default_rate || serviceData.default_rate === 0) {
        errors.push('Default rate is required')
      }
      if (!serviceData.billing_method) {
        errors.push('Billing method is required')
      }
      
      if (errors.length > 0) {
        setValidationErrors(errors)
        return
      }
      
      setValidationErrors([])
      // Removed category_id validation

      // Find the selected service type name for conditional checks
      const selectedServiceTypeName = allServiceTypes.find(t => t.id === serviceData.custom_service_type_id)?.name;

      // Validate product-specific fields
      if (selectedServiceTypeName === 'Hardware') { // Check name
        if (!serviceData.sku) {
          setError('SKU is required for Hardware')
          return
        }
      }

      // Validate license-specific fields
      if (selectedServiceTypeName === 'Software License') { // Check name
        if (!serviceData.license_term) {
          setError('License term is required for Software Licenses')
          return
        }
      }
// Find the selected service type
const selectedServiceType = allServiceTypes.find(t => t.id === serviceData.custom_service_type_id);

if (!selectedServiceType) {
  setError('Selected service type not found');
  return;
}

// Create base data without the service type IDs
const baseData = {
  service_name: serviceData.service_name,
  billing_method: serviceData.billing_method as 'fixed' | 'hourly' | 'usage', // Cast to remove empty string type
  default_rate: serviceData.default_rate,
  unit_of_measure: serviceData.unit_of_measure,
  // is_taxable and region_code removed
  tax_rate_id: serviceData.tax_rate_id || null, // Added tax_rate_id
  category_id: serviceData.category_id || null, // Use selected category_id from form
  description: serviceData.description || '', // Include description field
};

// Create the final data with the custom service type ID
// At this point, we've already validated that custom_service_type_id is not empty
const submitData: CreateServiceInput = {
  ...baseData,
  custom_service_type_id: serviceData.custom_service_type_id,
};

console.log('[QuickAddService] Submitting service data:', submitData);
console.log('[QuickAddService] Unit of measure value:', submitData.unit_of_measure);
await createService(submitData);
console.log('[QuickAddService] Service created successfully');

      onServiceAdded()
      setOpen(false)
      // Reset form
      setServiceData({
        service_name: '',
        custom_service_type_id: '',
        billing_method: '',
        default_rate: 0,
        unit_of_measure: '',
        description: '',
        // is_taxable and region_code removed
        tax_rate_id: null, // Added
        category_id: null, // Reset category
        // Reset optional fields too
        sku: '',
        inventory_count: 0,
        seat_limit: 0,
        license_term: 'monthly'
      })
      setRateInput('')
      setError(null)
      setHasAttemptedSubmit(false)
      setValidationErrors([])
    } catch (error) {
      console.error('[QuickAddService] Error creating service:', error)
      setError('Failed to create service')
    }
  }

  // Removed unused categoryOptions derived from fetched categories

  // Removed regionMap creation

  return (
    <>
      <Button 
        ref={setTriggerButton}
        id='add-service' 
        onClick={() => setOpen(true)}
      >
        Add Service
      </Button>
      <Dialog
        isOpen={open}
        onClose={() => {
          setOpen(false);
          setRateInput('');
          setHasAttemptedSubmit(false);
          setValidationErrors([]);
        }}
        title="Add New Service"
        className="max-w-[550px]"
      >
        <DialogContent>
          {error && <div className="text-red-500 mb-4">{error}</div>}
          {errorTaxRates && <div className="text-red-500 mb-4">{errorTaxRates}</div>} {/* Show tax rate error */}
          {hasAttemptedSubmit && validationErrors.length > 0 && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>
                Please fix the following errors:
                <ul className="list-disc pl-5 mt-1 text-sm">
                  {validationErrors.map((err, index) => (
                    <li key={index}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <Label htmlFor="serviceName" className="block text-sm font-medium text-gray-700 mb-1">Service Name *</Label>
              <Input
                id="serviceName"
                value={serviceData.service_name}
                onChange={(e) => setServiceData({ ...serviceData, service_name: e.target.value })}
                placeholder="Service Name"
                required
                className={hasAttemptedSubmit && !serviceData.service_name.trim() ? 'border-red-500' : ''}
              />
            </div>

            {/* Updated to Service Type dropdown using EditableServiceTypeSelect */}
            <div>
              <EditableServiceTypeSelect
                label="Service Type *"
                value={serviceData.custom_service_type_id}
                onChange={(value) => {
                  // Find the selected service type to get its billing method
                  const selectedType = allServiceTypes.find(t => t.id === value);

                  // Update service data with the selected type ID and its billing method
                  setServiceData({
                    ...serviceData,
                    custom_service_type_id: value,
                    // Update billing_method based on the selected service type
                    billing_method: selectedType?.billing_method || serviceData.billing_method,
                  });
                }}
                serviceTypes={allServiceTypes}
                onCreateType={async (name) => {
                  await createServiceTypeInline(name);
                  onServiceTypesChange(); // Refresh the service types list
                }}
                onUpdateType={async (id, name) => {
                  await updateServiceTypeInline(id, name);
                  onServiceTypesChange(); // Refresh the service types list
                }}
                onDeleteType={async (id) => {
                  await deleteServiceTypeInline(id);
                  onServiceTypesChange(); // Refresh the service types list
                }}
                placeholder="Select service type..."
                className={`w-full ${hasAttemptedSubmit && !serviceData.custom_service_type_id ? 'ring-1 ring-red-500' : ''}`}
              />
            </div>

            <div>
              <Label htmlFor="billingMethod" className="block text-sm font-medium text-gray-700 mb-1">Billing Method *</Label>
              <CustomSelect
                options={BILLING_METHOD_OPTIONS}
                value={serviceData.billing_method}
                onValueChange={(value) => setServiceData({ ...serviceData, billing_method: value as 'fixed' | 'hourly' | 'usage' | '' })}
                placeholder="Select billing method..."
                className={`w-full ${hasAttemptedSubmit && !serviceData.billing_method ? 'ring-1 ring-red-500' : ''}`}
              />
            </div>

            <div>
              <Label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">Description</Label>
              <Input
                id="description"
                value={serviceData.description || ''}
                onChange={(e) => setServiceData({ ...serviceData, description: e.target.value })}
                placeholder="Service Description"
              />
            </div>

            {/* Conditional Rate Fields Based on Billing Method */}
            {serviceData.billing_method === 'fixed' && (
              <div>
                <Label htmlFor="fixedRate" className="block text-sm font-medium text-gray-700 mb-1">Monthly Base Rate *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <Input
                    id="fixedRate"
                    type="text"
                    inputMode="decimal"
                    value={rateInput}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9.]/g, '');
                      const decimalCount = (value.match(/\./g) || []).length;
                      if (decimalCount <= 1) {
                        setRateInput(value);
                      }
                    }}
                    onBlur={() => {
                      if (rateInput.trim() === '' || rateInput === '.') {
                        setRateInput('');
                        setServiceData({ ...serviceData, default_rate: 0 });
                      } else {
                        const dollars = parseFloat(rateInput) || 0;
                        const cents = Math.round(dollars * 100);
                        setServiceData({ ...serviceData, default_rate: cents });
                        setRateInput((cents / 100).toFixed(2));
                      }
                    }}
                    placeholder="0.00"
                    required
                    className={`pl-7 ${hasAttemptedSubmit && (!serviceData.default_rate || serviceData.default_rate === 0) ? 'border-red-500' : ''}`}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">The monthly fee for this service</p>
              </div>
            )}

            {serviceData.billing_method === 'hourly' && (
              <div>
                <Label htmlFor="hourlyRate" className="block text-sm font-medium text-gray-700 mb-1">Hourly Rate *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                  <Input
                    id="hourlyRate"
                    type="text"
                    inputMode="decimal"
                    value={rateInput}
                    onChange={(e) => {
                      const value = e.target.value.replace(/[^0-9.]/g, '');
                      const decimalCount = (value.match(/\./g) || []).length;
                      if (decimalCount <= 1) {
                        setRateInput(value);
                      }
                    }}
                    onBlur={() => {
                      if (rateInput.trim() === '' || rateInput === '.') {
                        setRateInput('');
                        setServiceData({ ...serviceData, default_rate: 0 });
                      } else {
                        const dollars = parseFloat(rateInput) || 0;
                        const cents = Math.round(dollars * 100);
                        setServiceData({ ...serviceData, default_rate: cents });
                        setRateInput((cents / 100).toFixed(2));
                      }
                    }}
                    placeholder="0.00"
                    required
                    className={`pl-7 ${hasAttemptedSubmit && (!serviceData.default_rate || serviceData.default_rate === 0) ? 'border-red-500' : ''}`}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">Rate charged per hour</p>
              </div>
            )}

            {serviceData.billing_method === 'usage' && (
              <>
                <div>
                  <Label htmlFor="unitRate" className="block text-sm font-medium text-gray-700 mb-1">Unit Rate *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                    <Input
                      id="unitRate"
                      type="text"
                      inputMode="decimal"
                      value={rateInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^0-9.]/g, '');
                        const decimalCount = (value.match(/\./g) || []).length;
                        if (decimalCount <= 1) {
                          setRateInput(value);
                        }
                      }}
                      onBlur={() => {
                        if (rateInput.trim() === '' || rateInput === '.') {
                          setRateInput('');
                          setServiceData({ ...serviceData, default_rate: 0 });
                        } else {
                          const dollars = parseFloat(rateInput) || 0;
                          const cents = Math.round(dollars * 100);
                          setServiceData({ ...serviceData, default_rate: cents });
                          setRateInput((cents / 100).toFixed(2));
                        }
                      }}
                      placeholder="0.00"
                      required
                      className={`pl-7 ${hasAttemptedSubmit && (!serviceData.default_rate || serviceData.default_rate === 0) ? 'border-red-500' : ''}`}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Price per unit</p>
                </div>
                <div>
                  <Label htmlFor="unitOfMeasure" className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure *</Label>
                  <UnitOfMeasureInput
                    value={serviceData.unit_of_measure}
                    onChange={(value) => {
                      console.log('[QuickAddService] UnitOfMeasureInput onChange called with:', value);
                      setServiceData({ ...serviceData, unit_of_measure: value });
                    }}
                    placeholder="e.g., GB, API call, user"
                    serviceType={allServiceTypes.find(t => t.id === serviceData.custom_service_type_id)?.name}
                  />
                  <p className="text-xs text-gray-500 mt-1">The measurable unit for billing (e.g., GB, API call, user)</p>
                </div>
              </>
            )}

            {/* Removed separate Category dropdown (category_id) */}


            {/* Replaced Is Taxable Switch and Tax Region Select with Tax Rate Select */}
            <div>
              <Label htmlFor="taxRate" className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (Optional)</Label>
              <CustomSelect
                  id="quick-add-service-tax-rate-select"
                  value={serviceData.tax_rate_id || ''} // Bind to tax_rate_id
                  placeholder={isLoadingTaxRates ? "Loading tax rates..." : "Select Tax Rate (optional)"}
                  onValueChange={(value) => setServiceData({ ...serviceData, tax_rate_id: value || null })} // Set null if cleared
                  // Populate with fetched tax rates, construct label using regionMap
                  // Use description or region_code directly from the rate object
                  options={taxRates.map(r => { // r is now correctly typed as ITaxRate
                    // Construct label using fields directly from ITaxRate
                    const descriptionPart = r.description || r.region_code || 'N/A'; // Use description or region_code

                    // Ensure tax_percentage is treated as a number before calling toFixed
                    const percentageValue = typeof r.tax_percentage === 'string'
                      ? parseFloat(r.tax_percentage)
                      : Number(r.tax_percentage);
                    const percentagePart = !isNaN(percentageValue) ? percentageValue.toFixed(2) : '0.00';

                    return {
                      value: r.tax_rate_id,
                      label: `${descriptionPart} - ${percentagePart}%`
                    };
                  })}
                  disabled={isLoadingTaxRates}
                  allowClear={true} // Allow clearing
              />
            </div>

            {/* Product-specific fields */}
            {/* Conditional fields based on Service Type Name */}
            {allServiceTypes.find(t => t.id === serviceData.custom_service_type_id)?.name === 'Hardware' && (
              <>
                <div>
                  <Label htmlFor="sku" className="block text-sm font-medium text-gray-700 mb-1">SKU</Label>
                  <Input
                    id="sku"
                    value={serviceData.sku || ''}
                    onChange={(e) => setServiceData({ ...serviceData, sku: e.target.value })}
                    placeholder="SKU"
                  />
                </div>
                <div>
                  <Label htmlFor="inventoryCount" className="block text-sm font-medium text-gray-700 mb-1">Inventory Count</Label>
                  <Input
                    id="inventoryCount"
                    type="number"
                    value={serviceData.inventory_count || 0}
                    onChange={(e) => setServiceData({ ...serviceData, inventory_count: parseInt(e.target.value) })}
                    placeholder="Inventory Count"
                  />
                </div>
              </>
            )}

            {/* License-specific fields */}
            {allServiceTypes.find(t => t.id === serviceData.custom_service_type_id)?.name === 'Software License' && (
              <>
                <div>
                  <Label htmlFor="seatLimit" className="block text-sm font-medium text-gray-700 mb-1">Seat Limit</Label>
                  <Input
                    id="seatLimit"
                    type="number"
                    value={serviceData.seat_limit || 0}
                    onChange={(e) => setServiceData({ ...serviceData, seat_limit: parseInt(e.target.value) })}
                    placeholder="Seat Limit"
                  />
                </div>
                <div>
                  <Label htmlFor="licenseTerm" className="block text-sm font-medium text-gray-700 mb-1">License Term</Label>
                  <CustomSelect
                    options={LICENSE_TERM_OPTIONS}
                    value={serviceData.license_term || 'monthly'}
                    onValueChange={(value) => setServiceData({ ...serviceData, license_term: value })} // Corrected prop name
                    placeholder="Select license term..."
                    className="w-full"
                  />
                </div>
              </>
            )}

            <div className="flex justify-end space-x-2 pt-4">
              <Button id='cancel-button' type="button" variant="outline" onClick={() => {
                setOpen(false);
                setRateInput('');
                setHasAttemptedSubmit(false);
                setValidationErrors([]);
              }}>
                Cancel
              </Button>
              <Button id='save-button' type="submit" className={!serviceData.service_name || !serviceData.custom_service_type_id || !serviceData.default_rate || !serviceData.billing_method ? 'opacity-50' : ''}>Save Service</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
