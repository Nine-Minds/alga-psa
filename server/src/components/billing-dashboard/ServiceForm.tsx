'use client'

import React, { useState, useEffect } from 'react'
import { Button } from 'server/src/components/ui/Button'
import { Input } from 'server/src/components/ui/Input'
import CustomSelect from 'server/src/components/ui/CustomSelect'
import { createService, getServiceTypesForSelection } from 'server/src/lib/actions/serviceActions'
import { getActiveTaxRegions } from 'server/src/lib/actions/taxSettingsActions'; // Added
import { ITaxRegion } from 'server/src/interfaces/tax.interfaces'; // Added
import { UnitOfMeasureInput } from './UnitOfMeasureInput'

export const ServiceForm: React.FC = () => {
  const [serviceName, setServiceName] = useState('')
  const [serviceTypeId, setServiceTypeId] = useState<string>('') // Store the selected service type ID
  const [defaultRate, setDefaultRate] = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('')
  const [billingMethod, setBillingMethod] = useState<'fixed' | 'per_unit'>('fixed')
  const [description, setDescription] = useState('')
  const [serviceTypes, setServiceTypes] = useState<{ id: string; name: string; billing_method: 'fixed' | 'per_unit'; is_standard: boolean }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [regionCode, setRegionCode] = useState<string | null>(null); // Added state for region code
  const [taxRegions, setTaxRegions] = useState<Pick<ITaxRegion, 'region_code' | 'region_name'>[]>([]); // Added
  const [isLoadingTaxRegions, setIsLoadingTaxRegions] = useState(true); // Added
  const [errorTaxRegions, setErrorTaxRegions] = useState<string | null>(null); // Added
  // Fetch service types on component mount
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
    const fetchTaxRegions = async () => { // Added function
       try {
           setIsLoadingTaxRegions(true);
           const regions = await getActiveTaxRegions();
           setTaxRegions(regions);
           setErrorTaxRegions(null);
       } catch (error) {
           console.error('Error loading tax regions:', error);
           setErrorTaxRegions('Failed to load tax regions.');
           setTaxRegions([]); // Clear regions on error
       } finally {
           setIsLoadingTaxRegions(false);
       }
    };

    fetchServiceTypes()
    fetchTaxRegions(); // Call new function
  }, [])

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
        unit_of_measure: unitOfMeasure,
        category_id: null,
        billing_method: billingMethod,
        description: description,
        region_code: regionCode // Added region_code
      }
      
      // Create the final data with the correct service type ID based on is_standard flag
      let submitData
      if (selectedServiceType.is_standard) {
        submitData = {
          ...baseData,
          standard_service_type_id: serviceTypeId,
        }
      } else {
        submitData = {
          ...baseData,
          custom_service_type_id: serviceTypeId,
        }
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
      setRegionCode(null); // Clear region code
    } catch (error) {
      console.error('Error creating service:', error)
      setError(error instanceof Error ? error.message : 'Failed to create service'); // Show specific error
    }
  }

  const taxRegionOptions = taxRegions.map(region => ({
     value: region.region_code,
     label: region.region_name
  }));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <div className="text-red-500 mb-4">{error}</div>}
      {errorTaxRegions && <div className="text-red-500 mb-4">{errorTaxRegions}</div>} {/* Show tax region loading error */}
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
          { value: 'per_unit', label: 'Per Unit' }
        ]}
        value={billingMethod}
        onValueChange={(value) => setBillingMethod(value as 'fixed' | 'per_unit')}
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
          <CustomSelect
              id="service-tax-region-select"
              label="Tax Region (Optional)"
              value={regionCode || ''}
              placeholder={isLoadingTaxRegions ? "Loading regions..." : "Use Company Default"}
              onValueChange={(value) => setRegionCode(value || null)} // Set to null if cleared
              options={taxRegionOptions}
              disabled={isLoadingTaxRegions}
              allowClear={true} // Allow clearing the selection
          />
      </div>

      <Button id='add-service-button' type="submit">Add Service</Button>
    </form>
  )
}
