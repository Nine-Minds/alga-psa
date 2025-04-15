'use client'
import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from 'server/src/components/ui/Button'
import { Input } from 'server/src/components/ui/Input'
import { Label } from 'server/src/components/ui/Label'
import CustomSelect from 'server/src/components/ui/CustomSelect'
import { SearchableSelect } from 'server/src/components/ui/SearchableSelect'
import { Switch } from 'server/src/components/ui/Switch'
import { createService } from 'server/src/lib/actions/serviceActions'
// Import getTaxRates and ITaxRate instead
import { getTaxRates } from 'server/src/lib/actions/taxSettingsActions'; // Removed getActiveTaxRegions
import { ITaxRate } from 'server/src/interfaces/tax.interfaces'; // Removed ITaxRegion
// Note: getServiceCategories might be removable if categories are fully replaced by service types
import { getServiceCategories } from 'server/src/lib/actions/categoryActions'
import { IService, IServiceCategory, IServiceType } from 'server/src/interfaces/billing.interfaces' // Added IServiceType
import { UnitOfMeasureInput } from './UnitOfMeasureInput'
import { useTenant } from '../TenantProvider'

interface QuickAddServiceProps {
  onServiceAdded: () => void;
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]; // Updated type
}

// Updated interface to use standard_service_type_id or custom_service_type_id
// and tax_rate_id instead of old tax fields
interface ServiceFormData extends Omit<IService, 'service_id' | 'tenant' | 'category_id'> { // Removed is_taxable, region_code from Omit
  // Temporary field for UI selection - not sent to API
  service_type_id: string;
  // Fields that will be sent to API
  standard_service_type_id?: string;
  custom_service_type_id?: string;
  tax_rate_id?: string | null; // Added tax_rate_id
  description?: string | null;
  // Fields to remove from final submission (or add to IService if needed)
  sku?: string;
  inventory_count?: number;
  seat_limit?: number;
  license_term?: string;
}

// Removed old SERVICE_TYPE_OPTIONS

// Define service category options (as per plan) - This might become obsolete or used differently
const SERVICE_CATEGORY_OPTIONS = [
  { value: 'Labor - Support', label: 'Labor - Support' },
  { value: 'Labor - Project', label: 'Labor - Project' },
  { value: 'Managed Service - Server', label: 'Managed Service - Server' },
  { value: 'Managed Service - Workstation', label: 'Managed Service - Workstation' },
  { value: 'Software License', label: 'Software License' },
  { value: 'Hardware', label: 'Hardware' },
  { value: 'Hosting', label: 'Hosting' },
  { value: 'Consulting', label: 'Consulting' },
];

const LICENSE_TERM_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'perpetual', label: 'Perpetual' }
];

const BILLING_METHOD_OPTIONS = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'per_unit', label: 'Per Unit' }
];

export function QuickAddService({ onServiceAdded, allServiceTypes }: QuickAddServiceProps) { // Destructure new prop
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<IServiceCategory[]>([]) // Keep for now, might be replaced
  // State for tax rates instead of regions
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  // Renamed states back to focus only on tax rates
  const [isLoadingTaxRates, setIsLoadingTaxRates] = useState(true);
  const [errorTaxRates, setErrorTaxRates] = useState<string | null>(null);
  const tenant = useTenant()

  // Initialize service state with service_type_id for UI selection
  const [serviceData, setServiceData] = useState<ServiceFormData>({
    service_name: '',
    service_type_id: '', // Used for UI selection only
    standard_service_type_id: undefined,
    custom_service_type_id: undefined,
    billing_method: 'fixed',
    default_rate: 0,
    unit_of_measure: '',
    // is_taxable and region_code removed
    tax_rate_id: null, // Added
    description: '',
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
    try {
      // Validate required fields
      if (!serviceData.service_type_id) { // Check ID
        setError('Service Type is required') // Updated label
        return
      }
      // Removed category_id validation

      // Find the selected service type name for conditional checks
      const selectedServiceTypeName = allServiceTypes.find(t => t.id === serviceData.service_type_id)?.name;

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
// Find the selected service type to determine if it's standard or custom
const selectedServiceType = allServiceTypes.find(t => t.id === serviceData.service_type_id);

if (!selectedServiceType) {
  setError('Selected service type not found');
  return;
}

// Create base data without the service type IDs
const baseData = {
  service_name: serviceData.service_name,
  billing_method: serviceData.billing_method,
  default_rate: serviceData.default_rate,
  unit_of_measure: serviceData.unit_of_measure,
  // is_taxable and region_code removed
  tax_rate_id: serviceData.tax_rate_id || null, // Added tax_rate_id
  category_id: null, // Explicitly set optional category_id to null
  description: serviceData.description || '', // Include description field
};

// Create the final data with the correct service type ID based on is_standard flag
let submitData;
if (selectedServiceType.is_standard) {
  submitData = {
    ...baseData,
    standard_service_type_id: serviceData.service_type_id,
  };
} else {
  submitData = {
    ...baseData,
    custom_service_type_id: serviceData.service_type_id,
  };
}

console.log('[QuickAddService] Submitting service data:', submitData);
console.log('[QuickAddService] Unit of measure value:', submitData.unit_of_measure);
await createService(submitData);
console.log('[QuickAddService] Service created successfully');

      onServiceAdded()
      setOpen(false)
      // Reset form
      setServiceData({
        service_name: '',
        service_type_id: '', // Reset UI selection ID
        standard_service_type_id: undefined,
        custom_service_type_id: undefined,
        billing_method: 'fixed',
        default_rate: 0,
        unit_of_measure: '',
        description: '',
        // is_taxable and region_code removed
        tax_rate_id: null, // Added
        // Reset optional fields too
        sku: '',
        inventory_count: 0,
        seat_limit: 0,
        license_term: 'monthly'
      })
      setError(null)
    } catch (error) {
      console.error('[QuickAddService] Error creating service:', error)
      setError('Failed to create service')
    }
  }

  // Removed unused categoryOptions derived from fetched categories

  // Removed regionMap creation

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button id='add-service'>Add Service</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-[550px]">
          <Dialog.Title className="text-lg font-bold mb-4">Add New Service</Dialog.Title>
          {error && <div className="text-red-500 mb-4">{error}</div>}
          {errorTaxRates && <div className="text-red-500 mb-4">{errorTaxRates}</div>} {/* Show tax rate error */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="serviceName" className="block text-sm font-medium text-gray-700 mb-1">Service Name</Label>
              <Input
                id="serviceName"
                value={serviceData.service_name}
                onChange={(e) => setServiceData({ ...serviceData, service_name: e.target.value })}
                placeholder="Service Name"
                required
              />
            </div>

            {/* Updated to Service Type dropdown using allServiceTypes */}
            <div>
              <Label htmlFor="serviceType" className="block text-sm font-medium text-gray-700 mb-1">Service Type</Label>
              <SearchableSelect
                id="serviceType"
                options={allServiceTypes.map(type => ({ value: type.id, label: type.name }))}
                value={serviceData.service_type_id}
                onChange={(value) => {
                  // Find the selected service type to get its billing method
                  const selectedType = allServiceTypes.find(t => t.id === value);
                  
                  // Update service data with the selected type ID and its billing method
                  setServiceData({
                    ...serviceData,
                    service_type_id: value,
                    // Update billing_method based on the selected service type
                    billing_method: selectedType?.billing_method || serviceData.billing_method,
                  });
                  
                  // Reset the service_id when service type changes
                  setServiceData((prev) => ({
                    ...prev,
                    service_id: null,
                  }));
                }}
                placeholder="Select service type..."
                emptyMessage="No service types found"
                className="w-full"
              />
            </div>

            <div>
              <Label htmlFor="billingMethod" className="block text-sm font-medium text-gray-700 mb-1">Billing Method</Label>
              <CustomSelect
                options={BILLING_METHOD_OPTIONS}
                value={serviceData.billing_method}
                onValueChange={(value) => setServiceData({ ...serviceData, billing_method: value as 'fixed' | 'per_unit' })}
                placeholder="Select billing method..."
                className="w-full"
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

            <div>
              <Label htmlFor="defaultRate" className="block text-sm font-medium text-gray-700 mb-1">Default Rate</Label>
              <Input
                id="defaultRate"
                type="number"
                step="0.01" // Allow cents
                value={serviceData.default_rate / 100} // Display in dollars
                onChange={(e) => setServiceData({ ...serviceData, default_rate: Math.round(parseFloat(e.target.value) * 100) || 0 })} // Store in cents, default to 0 if invalid
                placeholder="Default Rate"
                required
              />
            </div>
            {/* Conditional Unit of Measure */}
            {serviceData.billing_method === 'per_unit' && (
              <div>
                <Label htmlFor="unitOfMeasure" className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure</Label>
                <UnitOfMeasureInput
                  value={serviceData.unit_of_measure}
                  onChange={(value) => {
                    console.log('[QuickAddService] UnitOfMeasureInput onChange called with:', value);
                    setServiceData({ ...serviceData, unit_of_measure: value });
                  }}
                  placeholder="Select unit of measure..."
                  serviceType={allServiceTypes.find(t => t.id === serviceData.service_type_id)?.name}
                />
              </div>
            )}

            {/* Removed separate Category dropdown (category_id) */}


            {/* Replaced Is Taxable Switch and Tax Region Select with Tax Rate Select */}
            <div>
              <Label htmlFor="taxRate" className="block text-sm font-medium text-gray-700 mb-1">Tax Rate (Optional)</Label>
              <CustomSelect
                  id="quick-add-service-tax-rate-select"
                  value={serviceData.tax_rate_id || ''} // Bind to tax_rate_id
                  placeholder={isLoadingTaxRates ? "Loading tax rates..." : "Select Tax Rate (or leave blank for Non-Taxable)"}
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
            {allServiceTypes.find(t => t.id === serviceData.service_type_id)?.name === 'Hardware' && (
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
            {allServiceTypes.find(t => t.id === serviceData.service_type_id)?.name === 'Software License' && (
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
              <Button id='cancel-button' type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button id='save-button' type="submit">Save Service</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
