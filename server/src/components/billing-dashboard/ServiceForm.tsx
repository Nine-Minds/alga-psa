'use client'

import React, { useState, useEffect } from 'react'
import { Button } from 'server/src/components/ui/Button'
import { Input } from 'server/src/components/ui/Input'
import CustomSelect from 'server/src/components/ui/CustomSelect'
import { createService, getServiceTypesForSelection } from 'server/src/lib/actions/serviceActions'
import { getActiveTaxRegions, getTaxRates } from 'server/src/lib/actions/taxSettingsActions'; // Added getTaxRates
import { ITaxRate, ITaxRegion } from 'server/src/interfaces/tax.interfaces';
import { UnitOfMeasureInput } from 'server/src/components/ui/UnitOfMeasureInput';
import { toast } from 'react-hot-toast';

export const ServiceForm: React.FC = () => {
  const [serviceName, setServiceName] = useState('')
  const [serviceTypeId, setServiceTypeId] = useState<string>('') // Store the selected service type ID
  const [defaultRate, setDefaultRate] = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('')
  const [billingMethod, setBillingMethod] = useState<'fixed' | 'hourly' | 'usage' | 'per_unit'>('fixed')
  const [description, setDescription] = useState('')
  const [serviceTypes, setServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'hourly' | 'usage' | 'per_unit'; is_standard: boolean }[]>([])
  const [error, setError] = useState<string | null>(null)
  // Removed regionCode state and related hooks
  // Assuming tax_rate_id is handled by a dedicated component or passed in props now
  const [taxRateId, setTaxRateId] = useState<string | null>(null); // Placeholder for tax_rate_id state
  const [taxRates, setTaxRates] = useState<ITaxRate[]>([]);
  const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]);
  const [isLoadingTaxData, setIsLoadingTaxData] = useState(true); // Combined loading state
  const [errorTaxData, setErrorTaxData] = useState<string | null>(null); // Combined error state
  useEffect(() => {
    const fetchServiceTypes = async () => {
      try {
        const types = await getServiceTypesForSelection()
        setServiceTypes(types)
      } catch (error) {
        console.error('Error fetching service types:', error)
        setError('Failed to fetch service types')
      }
    }
    const fetchTaxData = async () => {
      setIsLoadingTaxData(true);
      setErrorTaxData(null);
      try {
        // Fetch both rates and regions concurrently
        const [rates, regions] = await Promise.all([
          getTaxRates(), // Use the imported function
          getActiveTaxRegions() // Use the imported function
        ]);
        setTaxRates(rates);
        setTaxRegions(regions);
      } catch (err) {
        console.error("Failed to fetch tax data:", err);
        const errorMessage = err instanceof Error ? err.message : "Failed to load tax data.";
        setErrorTaxData(errorMessage);
        toast.error(errorMessage);
      } finally {
        setIsLoadingTaxData(false);
      }
    };

    fetchServiceTypes();
    fetchTaxData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!serviceTypeId) {
      setError('Please select a service type')
      return
    }

    try {
      // Find the selected service type to determine if it's standard or custom
      const selectedServiceType = serviceTypes.find(t => t.id === serviceTypeId)

      if (!selectedServiceType) {
        setError('Selected service type not found')
        return
      }

      // Create base data
      const baseData = {
        service_name: serviceName,
        default_rate: parseFloat(defaultRate) || 0,
        currency_code: 'USD', // Default to USD; TODO: add currency selector to form
        unit_of_measure: unitOfMeasure,
        category_id: null,
        billing_method: billingMethod,
        description: description,
        tax_rate_id: taxRateId // Use tax_rate_id instead
      }

      // Create the final data with the service type ID
      const submitData = {
        ...baseData,
        custom_service_type_id: serviceTypeId,
      }

      await createService(submitData)
      setError(null)
      // Clear form fields after successful submission
      setServiceName('')
      setServiceTypeId('')
      setDefaultRate('')
      setUnitOfMeasure('')
      setBillingMethod('fixed')
      setDescription('')
      setTaxRateId(null); // Clear tax rate ID
    } catch (error) {
      console.error('Error creating service:', error)
      setError(error instanceof Error ? error.message : 'Failed to create service'); // Show specific error
    }
  }

  // Create a map for quick region lookup
  const regionMap = new Map(taxRegions.map(r => [r.region_code, r.region_name]));

  // Define tax rate options based on fetched taxRates and taxRegions state
  const taxRateOptions = taxRates.map(rate => {
    const regionName = regionMap.get(rate.country_code);
    // Use region name if found, otherwise fallback to tax_type or country_code
    const descriptionPart = regionName || rate.tax_type || rate.country_code || 'N/A';
    const percentagePart = rate.tax_percentage.toFixed(2); // tax_percentage is number
    return {
      value: rate.tax_rate_id,
      label: `${descriptionPart} - ${percentagePart}%`
    };
  });
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-red-500 mb-4">{error}</div>}
      {errorTaxData && <div className="text-red-500 mb-4">{errorTaxData}</div>} {/* Show combined tax data loading error */}
      <Input
        value={serviceName}
        onChange={(e) => setServiceName(e.target.value)}
        placeholder="Service Name"
        required
      />

      <CustomSelect
        options={serviceTypes.map(type => ({ value: type.id, label: type.name }))}
        value={serviceTypeId}
        onValueChange={(value) => {
          setServiceTypeId(value)
          // Optionally update billing method based on selected service type
          const selectedType = serviceTypes.find(t => t.id === value)
          if (selectedType) {
            setBillingMethod(selectedType.billing_method)
          }
        }}
        placeholder="Select Service Type"
      />

      <CustomSelect
        options={[
          { value: 'fixed', label: 'Fixed Price' },
          { value: 'hourly', label: 'Hourly' },
          { value: 'usage', label: 'Usage Based' }
        ]}
        value={billingMethod}
        onValueChange={(value) => setBillingMethod(value as 'fixed' | 'hourly' | 'usage')}
        placeholder="Select Billing Method"
      />

      <Input
        type="number"
        value={defaultRate}
        onChange={(e) => setDefaultRate(e.target.value)}
        placeholder="Default Rate"
        required
      />

      <UnitOfMeasureInput
        value={unitOfMeasure}
        onChange={(value) => setUnitOfMeasure(value)}
        placeholder="Unit of Measure"
        className="w-full"
        required
      />

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Service Description"
        />
      </div>

      {/* Added Tax Region Dropdown */}
      <div className="space-y-2">
        {/* Replace region select with tax rate select */}
        <CustomSelect
          label="Tax Rate"
          id="service-tax-rate-field"
          value={taxRateId || ''}
          onValueChange={(value) => setTaxRateId(value || null)}
          options={taxRateOptions} // Use tax rate options
          placeholder={isLoadingTaxData ? "Loading tax data..." : "Select Tax Rate (Optional)"}
          disabled={isLoadingTaxData}
        />
      </div>

      <Button id='add-service-button' type="submit">Add Service</Button>
    </form>
  )
}
