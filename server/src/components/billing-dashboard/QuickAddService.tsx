'use client'
import React, { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from 'server/src/components/ui/Button'
import { Input } from 'server/src/components/ui/Input'
import CustomSelect from 'server/src/components/ui/CustomSelect'
import { Switch } from 'server/src/components/ui/Switch'
import { createService } from 'server/src/lib/actions/serviceActions'
import { getServiceCategories } from 'server/src/lib/actions/categoryActions'
import { IService, IServiceCategory } from 'server/src/interfaces/billing.interfaces'
import { UnitOfMeasureInput } from './UnitOfMeasureInput'
import { useTenant } from '../TenantProvider'

interface QuickAddServiceProps {
  onServiceAdded: () => void
}

// Updated interface to remove category_id as service_type is now the category string
interface ServiceFormData extends Omit<IService, 'service_id' | 'tenant' | 'category_id'> {
  sku?: string;
  inventory_count?: number;
  seat_limit?: number;
  license_term?: string;
}

// Removed old SERVICE_TYPE_OPTIONS

// Define service category options (as per plan)
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

export function QuickAddService({ onServiceAdded }: QuickAddServiceProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<IServiceCategory[]>([])
  const tenant = useTenant()

  // Initialize service state with all fields
  const [serviceData, setServiceData] = useState<ServiceFormData>({
    service_name: '',
    service_type: '', // This is now the category string
    billing_method: 'fixed',
    default_rate: 0,
    unit_of_measure: '',
    // category_id removed
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
        setError('Category is required') // Updated label
        return
      }
      // Removed category_id validation

      // Validate product-specific fields
      if (serviceData.service_type === 'Hardware') { // Updated category check
        if (!serviceData.sku) {
          setError('SKU is required for products')
          return
        }
      }

      // Validate license-specific fields
      if (serviceData.service_type === 'Software License') { // Updated category check
        if (!serviceData.license_term) {
          setError('License term is required')
          return
        }
      }

      // Only include valid service type when submitting
      const submitData: Omit<IService, 'service_id' | 'tenant'> = {
        ...serviceData,
        category_id: null, // Explicitly set optional category_id to null
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
        billing_method: 'fixed', // Added billing_method reset
        default_rate: 0,
        unit_of_measure: '',
        // category_id removed from reset
        is_taxable: true,
        tax_region: '',
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

            {/* Changed to Category dropdown */}
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category</label>
              <CustomSelect
                options={SERVICE_CATEGORY_OPTIONS}
                value={serviceData.service_type}
                onValueChange={(value) => setServiceData({ ...serviceData, service_type: value })}
                placeholder="Select category..."
                className="w-full"
              />
            </div>

            <div>
              <label htmlFor="billingMethod" className="block text-sm font-medium text-gray-700">Billing Method</label>
              <CustomSelect
                options={BILLING_METHOD_OPTIONS}
                value={serviceData.billing_method}
                onValueChange={(value) => setServiceData({ ...serviceData, billing_method: value as 'fixed' | 'per_unit' })}
                placeholder="Select billing method..."
                className="w-full"
              />
            </div>

            <div>
              <label htmlFor="defaultRate" className="block text-sm font-medium text-gray-700">Default Rate</label>
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
                <label htmlFor="unitOfMeasure" className="block text-sm font-medium text-gray-700">Unit of Measure</label>
                <UnitOfMeasureInput
                  value={serviceData.unit_of_measure}
                  onChange={(value) => setServiceData({ ...serviceData, unit_of_measure: value })}
                  placeholder="Select unit of measure..."
                />
              </div>
            )}

            {/* Removed separate Category dropdown (category_id) */}


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
            {/* Conditional fields based on Category */}
            {serviceData.service_type === 'Hardware' && (
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
            {serviceData.service_type === 'Software License' && (
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
