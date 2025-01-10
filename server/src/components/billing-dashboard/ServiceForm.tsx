'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import CustomSelect from '@/components/ui/CustomSelect'
import { createService } from '@/lib/actions/serviceActions'
import { ServiceType } from '@/interfaces'
import { UnitOfMeasureInput } from './UnitOfMeasureInput'

export const ServiceForm: React.FC = () => {
  const [serviceName, setServiceName] = useState('')
  const [serviceType, setServiceType] = useState<ServiceType>('Time')
  const [defaultRate, setDefaultRate] = useState('')
  const [unitOfMeasure, setUnitOfMeasure] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createService({
        service_name: serviceName,
        service_type: serviceType,
        default_rate: parseFloat(defaultRate),
        unit_of_measure: unitOfMeasure,
        category_id: ''
      })
      // Clear form fields after successful submission
      setServiceName('')
      setServiceType('Time')
      setDefaultRate('')
      setUnitOfMeasure('')
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
        onValueChange={(value) => setServiceType(value as ServiceType)}
        placeholder="Select Service Type"
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
