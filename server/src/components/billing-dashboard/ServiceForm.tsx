'use client'

import React, { useState } from 'react'
import { Button } from 'server/src/components/ui/Button'
import { Input } from 'server/src/components/ui/Input'
import CustomSelect from 'server/src/components/ui/CustomSelect'
import { createService } from 'server/src/lib/actions/serviceActions'
// Removed ServiceType import
import { UnitOfMeasureInput } from './UnitOfMeasureInput'

export const ServiceForm: React.FC = () => {
  const [serviceName, setServiceName] = useState('')
  const [serviceType, setServiceType] = useState<string>('Time') // Changed type to string
  const [defaultRate, setDefaultRate] = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('')
  const [billingMethod, setBillingMethod] = useState<'fixed' | 'per_unit'>('fixed') // Added state for billing method

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createService({
        service_name: serviceName,
        service_type_id: serviceType, // Corrected property name
        default_rate: parseFloat(defaultRate),
        unit_of_measure: unitOfMeasure,
        category_id: '',
        billing_method: billingMethod // Added billing method to payload
      })
      // Clear form fields after successful submission
      setServiceName('')
      setServiceType('Time') // No change needed here, already string
      setDefaultRate('')
      setUnitOfMeasure('')
      setBillingMethod('fixed') // Reset billing method state
    } catch (error) {
      console.error('Error creating service:', error)
      // Handle error (e.g., show error message to user)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        value={serviceName}
        onChange={(e) => setServiceName(e.target.value)}
        placeholder="Service Name"
        required
      />

      <CustomSelect
        options={[
          { value: 'Fixed', label: 'Fixed Price' },
          { value: 'Time', label: 'Time-Based' },
          { value: 'Usage', label: 'Usage-Based' }
        ]}
        value={serviceType}
        onValueChange={(value) => setServiceType(value)} // Removed 'as ServiceType' cast
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

      <Button id='add-service-button' type="submit">Add Service</Button>
    </form>
  )
}
