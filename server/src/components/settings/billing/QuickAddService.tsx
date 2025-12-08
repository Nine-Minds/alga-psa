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
import { createService, type CreateServiceInput, createServiceTypeInline, updateServiceTypeInline, deleteServiceTypeInline, setServicePrices } from 'server/src/lib/actions/serviceActions'
import { CURRENCY_OPTIONS, getCurrencySymbol } from 'server/src/constants/currency'
// Import getTaxRates and ITaxRate instead
import { getTaxRates } from 'server/src/lib/actions/taxSettingsActions'; // Removed getActiveTaxRegions
import { ITaxRate } from 'server/src/interfaces/tax.interfaces'; // Removed ITaxRegion
// Note: getServiceCategories might be removable if categories are fully replaced by service types
import { getServiceCategories } from 'server/src/lib/actions/categoryActions'
import { IService, IServiceCategory, IServiceType } from 'server/src/interfaces/billing.interfaces' // Added IServiceType
import { useTenant } from 'server/src/components/TenantProvider'

interface QuickAddServiceProps {
  onServiceAdded: () => void;
  allServiceTypes: { id: string; name: string; billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage' }[]; // Updated billing methods
  onServiceTypesChange: () => void; // Add callback to refresh service types
  // Optional controlled mode props for quick create integration
  isOpen?: boolean;
  onClose?: () => void;
  // Optional ID for the trigger button (to avoid duplicate IDs when multiple instances exist)
  triggerId?: string;
}

// Updated interface to use custom_service_type_id
// and tax_rate_id instead of old tax fields
interface ServiceFormData {
  service_name: string;
  custom_service_type_id: string; // Required for form state
  billing_method: 'fixed' | 'hourly' | 'per_unit' | 'usage' | '';
  default_rate: number;
  currency_code: string; // Currency of the default_rate (ISO 4217 code)
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
  { value: 'per_unit', label: 'Per Unit' },
  { value: 'usage', label: 'Usage Based' }
];

export function QuickAddService({ onServiceAdded, allServiceTypes, onServiceTypesChange, isOpen, onClose, triggerId = 'add-service' }: QuickAddServiceProps) {
  // Support both controlled (isOpen/onClose) and uncontrolled (internal state) modes
  const isControlled = isOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false)

  // In controlled mode, use external state; in uncontrolled mode, use internal state
  const dialogOpen = isControlled ? isOpen : internalOpen;

  // Handler for closing the dialog - resets form state and calls appropriate close handler
  const handleDialogClose = () => {
    setPrices([{ currency_code: 'USD', rate: 0 }]);
    setPriceInputs(['']);
    setHasAttemptedSubmit(false);
    setValidationErrors([]);
    if (isControlled && onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
  };
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
  // State for multi-currency pricing (rate stored in cents)
  const [prices, setPrices] = useState<Array<{ currency_code: string; rate: number }>>([
    { currency_code: 'USD', rate: 0 }
  ])
  // State for price input display values (allows temporary invalid states during editing)
  const [priceInputs, setPriceInputs] = useState<string[]>([''])

  // Initialize service state
  const [serviceData, setServiceData] = useState<ServiceFormData>({
    service_name: '',
    custom_service_type_id: '',
    billing_method: '',
    default_rate: 0,
    currency_code: 'USD', // Default to USD
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
      if (prices.length === 0 || prices[0].rate === 0) {
        errors.push('At least one price is required')
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
// Use the first price as the default_rate
const primaryPrice = prices[0];
const baseData = {
  service_name: serviceData.service_name,
  billing_method: serviceData.billing_method as 'fixed' | 'hourly' | 'usage', // Cast to remove empty string type
  default_rate: primaryPrice.rate,
  currency_code: primaryPrice.currency_code, // Include currency code
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
const createdService = await createService(submitData);
console.log('[QuickAddService] Service created successfully:', createdService);

// Set all prices for the service (multi-currency support)
if (createdService?.service_id) {
  await setServicePrices(createdService.service_id, prices);
  console.log(`[QuickAddService] Set ${prices.length} price(s) for service ${createdService.service_id}`);
}

      onServiceAdded()
      // Close dialog - in controlled mode this is handled by parent via onServiceAdded callback
      if (!isControlled) {
        setInternalOpen(false);
      }
      // Reset form
      setServiceData({
        service_name: '',
        custom_service_type_id: '',
        billing_method: '',
        default_rate: 0,
        currency_code: 'USD', // Reset to default USD
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
      setPrices([{ currency_code: 'USD', rate: 0 }])
      setPriceInputs([''])
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
      {/* Only render trigger button in uncontrolled mode */}
      {!isControlled && (
        <Button
          ref={setTriggerButton}
          id={triggerId}
          onClick={() => setInternalOpen(true)}
        >
          Add Service
        </Button>
      )}
      <Dialog
        isOpen={dialogOpen}
        onClose={handleDialogClose}
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
                onValueChange={(value) => setServiceData({ ...serviceData, billing_method: value as 'fixed' | 'hourly' | 'per_unit' | 'usage' | '' })}
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

            {/* Multi-Currency Pricing Section */}
            <div className="border rounded-lg p-4 bg-gray-50">
              <div className="flex justify-between items-center mb-3">
                <label className="block text-sm font-medium text-gray-700">
                  Pricing *
                  <span className="text-xs font-normal text-gray-500 ml-2">
                    ({serviceData.billing_method === 'fixed' ? 'Monthly' : serviceData.billing_method === 'hourly' ? 'Per Hour' : serviceData.billing_method === 'usage' ? 'Per Unit' : 'Rate'})
                  </span>
                </label>
                <Button
                  id="add-currency-btn"
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    // Find currencies not yet added
                    const usedCurrencies = prices.map(p => p.currency_code);
                    const availableCurrency = CURRENCY_OPTIONS.find(c => !usedCurrencies.includes(c.value));
                    if (availableCurrency) {
                      setPrices([...prices, { currency_code: availableCurrency.value, rate: 0 }]);
                      setPriceInputs([...priceInputs, '']);
                    }
                  }}
                  disabled={prices.length >= CURRENCY_OPTIONS.length}
                >
                  + Add Currency
                </Button>
              </div>

              <div className="space-y-3">
                {prices.map((price, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="w-28">
                      <CustomSelect
                        id={`price-currency-${index}`}
                        options={CURRENCY_OPTIONS.filter(c =>
                          c.value === price.currency_code ||
                          !prices.some(p => p.currency_code === c.value)
                        ).map(c => ({ value: c.value, label: c.label }))}
                        value={price.currency_code}
                        onValueChange={(value) => {
                          const newPrices = [...prices];
                          newPrices[index] = { ...newPrices[index], currency_code: value };
                          setPrices(newPrices);
                        }}
                        placeholder="Currency"
                      />
                    </div>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
                        {getCurrencySymbol(price.currency_code)}
                      </span>
                      <Input
                        id={`price-rate-${index}`}
                        type="text"
                        inputMode="decimal"
                        value={priceInputs[index] ?? ''}
                        onChange={(e) => {
                          // Allow any input during editing - only filter non-numeric except decimal
                          const value = e.target.value.replace(/[^0-9.]/g, '');
                          const decimalCount = (value.match(/\./g) || []).length;
                          if (decimalCount <= 1) {
                            const newInputs = [...priceInputs];
                            newInputs[index] = value;
                            setPriceInputs(newInputs);
                          }
                        }}
                        onBlur={() => {
                          // Convert to cents and update prices array on blur
                          const inputValue = priceInputs[index] ?? '';
                          const dollars = parseFloat(inputValue) || 0;
                          const cents = Math.round(dollars * 100);
                          const newPrices = [...prices];
                          newPrices[index] = { ...newPrices[index], rate: cents };
                          setPrices(newPrices);
                          // Format the display value
                          const newInputs = [...priceInputs];
                          newInputs[index] = cents > 0 ? (cents / 100).toFixed(2) : '';
                          setPriceInputs(newInputs);
                        }}
                        placeholder="0.00"
                        className={`pl-10 ${hasAttemptedSubmit && index === 0 && prices[0].rate === 0 ? 'border-red-500' : ''}`}
                      />
                    </div>
                    {prices.length > 1 && (
                      <Button
                        id={`remove-price-${index}`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 px-2"
                        onClick={() => {
                          const newPrices = prices.filter((_, i) => i !== index);
                          const newInputs = priceInputs.filter((_, i) => i !== index);
                          setPrices(newPrices);
                          setPriceInputs(newInputs);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Add prices in multiple currencies. The first currency is the primary rate.
              </p>
            </div>

            {/* Unit of Measure for usage-based services */}
            {serviceData.billing_method === 'usage' && (
              <div>
                <Label htmlFor="unitOfMeasure" className="block text-sm font-medium text-gray-700 mb-1">Unit of Measure *</Label>
                <Input
                  id="unitOfMeasure"
                  type="text"
                  value={serviceData.unit_of_measure}
                  onChange={(e) => {
                    console.log('[QuickAddService] Unit of Measure onChange called with:', e.target.value);
                    setServiceData({ ...serviceData, unit_of_measure: e.target.value });
                  }}
                  placeholder="e.g., GB, API call, user"
                  required
                  className={`${hasAttemptedSubmit && !serviceData.unit_of_measure ? 'border-red-500' : ''}`}
                />
                <p className="text-xs text-gray-500 mt-1">The measurable unit for billing (e.g., GB, API call, user)</p>
              </div>
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
              <Button id='cancel-button' type="button" variant="outline" onClick={handleDialogClose}>
                Cancel
              </Button>
              <Button id='save-button' type="submit" className={!serviceData.service_name || !serviceData.custom_service_type_id || prices[0]?.rate === 0 || !serviceData.billing_method ? 'opacity-50' : ''}>Save Service</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
