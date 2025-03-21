'use client'
import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from 'server/src/components/ui/Button'
import { Input } from 'server/src/components/ui/Input'
import CustomSelect from 'server/src/components/ui/CustomSelect'
import { Switch } from 'server/src/components/ui/Switch'
import { createService } from 'server/src/lib/actions/serviceActions'
import { getServiceCategories } from 'server/src/lib/actions/categoryActions'
import { IService, IServiceCategory, ServiceType } from 'server/src/interfaces/billing.interfaces'
import { UnitOfMeasureInput } from './UnitOfMeasureInput'
import { useTenant } from '../TenantProvider'

interface QuickAddServiceProps {
  onServiceAdded: () => void
}

interface ServiceFormData extends Omit<IService, 'service_id' | 'tenant' | 'service_type'> {
  service_type: string;
  sku?: string;
  inventory_count?: number;
  seat_limit?: number;
  license_term?: string;
}

const SERVICE_TYPE_OPTIONS = [
  { value: 'Fixed', label: 'Fixed Price' },
  { value: 'Time', label: 'Time Based' },
  { value: 'Usage', label: 'Usage Based' },
  { value: 'Product', label: 'Product' },
  { value: 'License', label: 'Software License' }
];

const LICENSE_TERM_OPTIONS = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annual', label: 'Annual' },
  { value: 'perpetual', label: 'Perpetual' }
];

export function QuickAddService({ onServiceAdded }: QuickAddServiceProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<IServiceCategory[]>([])
  const tenant = useTenant()

  // Initialize service state with all fields
  const [serviceData, setServiceData] = useState<ServiceFormData>({
    service_name: '',
    service_type: '',
    default_rate: 0,
    unit_of_measure: '',
    category_id: '',
    is_taxable: true,
    tax_region: '',
    sku: '',
    inventory_count: 0,
    seat_limit: 0,
    license_term: 'monthly'
  })

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

    fetchCategories()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      // Validate required fields
      if (!serviceData.service_type) {
        setError('Service Type is required')
        return
      }

      if (!serviceData.category_id) {
        setError('Category is required')
        return
      }

      // Validate product-specific fields
      if (serviceData.service_type === 'Product') {
        if (!serviceData.sku) {
          setError('SKU is required for products')
          return
        }
      }

      // Validate license-specific fields
      if (serviceData.service_type === 'License') {
        if (!serviceData.license_term) {
          setError('License term is required')
          return
        }
      }

      // Only include valid service type when submitting
      const submitData: Omit<IService, 'service_id' | 'tenant'> = {
        ...serviceData,
        service_type: serviceData.service_type as ServiceType
      }

      console.log('[QuickAddService] Submitting service data:', submitData)
      await createService(submitData)
      console.log('[QuickAddService] Service created successfully')
      
      onServiceAdded()
      setOpen(false)
      // Reset form
      setServiceData({
        service_name: '',
        service_type: '',
        default_rate: 0,
        unit_of_measure: '',
        category_id: '',
        is_taxable: true,
        tax_region: ''
      })
      setError(null)
    } catch (error) {
      console.error('[QuickAddService] Error creating service:', error)
      setError('Failed to create service')
    }
  }

  const categoryOptions = categories.map((cat): { value: string; label: string } => ({ 
    value: cat.category_id || 'None', 
    label: cat.category_name 
  }))

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button id='add-service'>Add Service</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white p-6 rounded-lg shadow-lg w-96">
          <Dialog.Title className="text-lg font-bold mb-4">Add New Service</Dialog.Title>
          {error && <div className="text-red-500 mb-4">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="serviceName" className="block text-sm font-medium text-gray-700">Service Name</label>
              <Input
                id="serviceName"
                value={serviceData.service_name}
                onChange={(e) => setServiceData({ ...serviceData, service_name: e.target.value })}
                placeholder="Service Name"
                required
              />
            </div>

            <div>
              <label htmlFor="serviceType" className="block text-sm font-medium text-gray-700">Service Type</label>
              <CustomSelect
                options={SERVICE_TYPE_OPTIONS}
                value={serviceData.service_type}
                onValueChange={(value) => setServiceData({ ...serviceData, service_type: value })}
                placeholder="Select service type..."
                className="w-full"
              />
            </div>

            <div>
              <label htmlFor="defaultRate" className="block text-sm font-medium text-gray-700">Default Rate</label>
              <Input
                id="defaultRate"
                type="number"
                value={serviceData.default_rate}
                onChange={(e) => setServiceData({ ...serviceData, default_rate: parseFloat(e.target.value) })}
                placeholder="Default Rate"
                required
              />
            </div>

            <div>
              <label htmlFor="unitOfMeasure" className="block text-sm font-medium text-gray-700">Unit of Measure</label>
              <UnitOfMeasureInput
                value={serviceData.unit_of_measure}
                onChange={(value) => setServiceData({ ...serviceData, unit_of_measure: value })}
                placeholder="Select unit of measure..."
              />
            </div>

            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category</label>
              <CustomSelect
                options={categoryOptions}
                onValueChange={(value) => setServiceData({ ...serviceData, category_id: value })}
                value={serviceData.category_id || 'None'}
                placeholder="Select category..."
                className="w-full"
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                checked={serviceData.is_taxable}
                onCheckedChange={(checked) => setServiceData({ ...serviceData, is_taxable: checked })}
              />
              <label className="text-sm font-medium text-gray-700">Is Taxable</label>
            </div>

            <div>
              <label htmlFor="taxRegion" className="block text-sm font-medium text-gray-700">Tax Region</label>
              <Input
                id="taxRegion"
                value={serviceData.tax_region || ''}
                onChange={(e) => setServiceData({ ...serviceData, tax_region: e.target.value })}
                placeholder="Tax Region"
              />
            </div>

            {/* Product-specific fields */}
            {serviceData.service_type === 'Product' && (
              <>
                <div>
                  <label htmlFor="sku" className="block text-sm font-medium text-gray-700">SKU</label>
                  <Input
                    id="sku"
                    value={serviceData.sku || ''}
                    onChange={(e) => setServiceData({ ...serviceData, sku: e.target.value })}
                    placeholder="SKU"
                  />
                </div>
                <div>
                  <label htmlFor="inventoryCount" className="block text-sm font-medium text-gray-700">Inventory Count</label>
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
            {serviceData.service_type === 'License' && (
              <>
                <div>
                  <label htmlFor="seatLimit" className="block text-sm font-medium text-gray-700">Seat Limit</label>
                  <Input
                    id="seatLimit"
                    type="number"
                    value={serviceData.seat_limit || 0}
                    onChange={(e) => setServiceData({ ...serviceData, seat_limit: parseInt(e.target.value) })}
                    placeholder="Seat Limit"
                  />
                </div>
                <div>
                  <label htmlFor="licenseTerm" className="block text-sm font-medium text-gray-700">License Term</label>
                  <CustomSelect
                    options={LICENSE_TERM_OPTIONS}
                    value={serviceData.license_term || 'monthly'}
                    onValueChange={(value) => setServiceData({ ...serviceData, license_term: value })}
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
