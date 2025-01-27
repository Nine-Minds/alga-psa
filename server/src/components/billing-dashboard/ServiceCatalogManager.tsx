'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import CustomSelect from '@/components/ui/CustomSelect';
import { UnitOfMeasureInput } from './UnitOfMeasureInput';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/Dialog';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { getServices, updateService, deleteService } from '@/lib/actions/serviceActions';
import { getServiceCategories } from '@/lib/actions/serviceCategoryActions';
import { IService, IServiceCategory, ServiceType } from '@/interfaces/billing.interfaces';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { DataTable } from '@/components/ui/DataTable';
import { ColumnDefinition } from '@/interfaces/dataTable.interfaces';
import { QuickAddService } from './QuickAddService';

// Define service type options
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

const ServiceCatalogManager: React.FC = () => {
  const [services, setServices] = useState<IService[]>([]);
  const [categories, setCategories] = useState<IServiceCategory[]>([]);
  const [editingService, setEditingService] = useState<IService | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<string | null>(null);
  const [selectedServiceType, setSelectedServiceType] = useState<string>('all');

  const filteredServices = services.filter(service =>
    selectedServiceType === 'all' || service.service_type === selectedServiceType
  );

  useEffect(() => {
    fetchServices();
    fetchCategories();
  }, []);

  const fetchServices = async () => {
    try {
      const fetchedServices = await getServices();
      setServices(fetchedServices);
      setError(null);
    } catch (error) {
      console.error('Error fetching services:', error);
      setError('Failed to fetch services');
    }
  };

  const fetchCategories = async () => {
    try {
      const fetchedCategories = await getServiceCategories();
      setCategories(fetchedCategories);
      setError(null);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setError('Failed to fetch categories');
    }
  };

  const handleUpdateService = async () => {
    if (!editingService) return;
    if (!editingService.service_type) {
      setError('Service Type is required');
      return;
    }
    try {
      await updateService(editingService.service_id!, editingService);
      setEditingService(null);
      await fetchServices();
      setError(null);
      setIsEditDialogOpen(false);
    } catch (error) {
      console.error('Error updating service:', error);
      setError('Failed to update service');
    }
  };

  const handleDeleteService = async (serviceId: string) => {
    setServiceToDelete(serviceId);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteService = async () => {
    if (!serviceToDelete) return;
    
    try {
      await deleteService(serviceToDelete);
      await fetchServices();
      setError(null);
    } catch (error) {
      console.error('Error deleting service:', error);
      setError('Failed to delete service');
    } finally {
      setIsDeleteDialogOpen(false);
      setServiceToDelete(null);
    }
  };

  const getColumns = (): ColumnDefinition<IService>[] => {
    const baseColumns: ColumnDefinition<IService>[] = [
      {
        title: 'Service Name',
        dataIndex: 'service_name',
      },
      {
        title: 'Service Type',
        dataIndex: 'service_type',
      },
      {
        title: 'Default Rate',
        dataIndex: 'default_rate',
        render: (value) => `$${(value / 100).toFixed(2)}`,
      },
      {
        title: 'Category',
        dataIndex: 'category_id',
        render: (value, record) => categories.find(cat => cat.category_id === value)?.category_name || 'N/A',
      },
      {
        title: 'Unit of Measure',
        dataIndex: 'unit_of_measure',
      },
      {
        title: 'Is Taxable',
        dataIndex: 'is_taxable',
        render: (value) => value ? 'Yes' : 'No',
      },
      {
        title: 'Tax Region',
        dataIndex: 'tax_region',
        render: (value) => value || 'N/A',
      }
    ];

    // Add product-specific columns if we're filtering by products
    if (selectedServiceType === 'Product' || selectedServiceType === 'all') {
      baseColumns.push(
        {
          title: 'SKU',
          dataIndex: 'sku',
          render: (value, record) => record.service_type === 'Product' ? (value || 'N/A') : '-',
        },
        {
          title: 'Inventory',
          dataIndex: 'inventory_count',
          render: (value, record) => record.service_type === 'Product' ? (value || '0') : '-',
        }
      );
    }

    // Add license-specific columns if we're filtering by licenses
    if (selectedServiceType === 'License' || selectedServiceType === 'all') {
      baseColumns.push(
        {
          title: 'Seat Limit',
          dataIndex: 'seat_limit',
          render: (value, record) => record.service_type === 'License' ? (value || 'Unlimited') : '-',
        },
        {
          title: 'License Term',
          dataIndex: 'license_term',
          render: (value, record) => record.service_type === 'License' ? (value || 'N/A') : '-',
        }
      );
    }

    // Always add actions column at the end
    baseColumns.push({
      title: 'Actions',
      dataIndex: 'service_id',
      render: (_, record) => (
        <div className="space-x-2">
          <Button
            id='edit-button'
            variant="default"
            onClick={() => {
              setEditingService(record);
              setIsEditDialogOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            id='delete-button'
            variant="destructive"
            onClick={() => handleDeleteService(record.service_id!)}
          >
            Delete
          </Button>
        </div>
      ),
    });

    return baseColumns;
  };

  const columns = getColumns();

  return (
    <>
      <Card>
        <CardHeader>
          <h3 className="text-lg font-semibold">Service Catalog Management</h3>
        </CardHeader>
        <CardContent>
          {error && <div className="text-red-500 mb-4">{error}</div>}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="w-64">
                <CustomSelect
                  options={[
                    { value: 'all', label: 'All Services' },
                    ...SERVICE_TYPE_OPTIONS
                  ]}
                  value={selectedServiceType}
                  onValueChange={setSelectedServiceType}
                  placeholder="Filter by type..."
                />
              </div>
              <QuickAddService onServiceAdded={fetchServices} />
            </div>
            <DataTable
              data={filteredServices}
              columns={columns}
              pagination={true}
            />
          </div>
        </CardContent>
      </Card>
      <Dialog isOpen={isEditDialogOpen} onClose={() => setIsEditDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Service</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Service Name"
              value={editingService?.service_name || ''}
              onChange={(e) => setEditingService({ ...editingService!, service_name: e.target.value })}
            />
            <CustomSelect
              options={SERVICE_TYPE_OPTIONS}
              value={editingService?.service_type || 'Fixed'}
              onValueChange={(value) => {
                if (value === 'Fixed' || value === 'Time' || value === 'Usage' || value === 'Product' || value === 'License') {
                  setEditingService({ ...editingService!, service_type: value as ServiceType })
                }
              }}
              placeholder="Select service type..."
            />
            <Input
              type="number"
              placeholder="Default Rate"
              value={editingService?.default_rate || ''}
              onChange={(e) => setEditingService({ ...editingService!, default_rate: parseFloat(e.target.value) })}
            />
            <CustomSelect
              options={categories.map((cat): { value: string; label: string } => ({
                value: cat.category_id || 'None',
                label: cat.category_name
              }))}
              onValueChange={(value) => setEditingService({ ...editingService!, category_id: value })}
              value={editingService?.category_id || 'unassigned'}
              placeholder="Select category..."
            />
            <UnitOfMeasureInput
              value={editingService?.unit_of_measure || ''}
              onChange={(value) => setEditingService({ ...editingService!, unit_of_measure: value })}
              placeholder="Unit of Measure"
              className="w-full"
            />
            <div className="flex items-center space-x-2">
              <Switch
                checked={editingService?.is_taxable ?? true}
                onCheckedChange={(checked) => setEditingService({ ...editingService!, is_taxable: checked })}
              />
              <label>Is Taxable</label>
            </div>
            <Input
              placeholder="Tax Region"
              value={editingService?.tax_region || ''}
              onChange={(e) => setEditingService({ ...editingService!, tax_region: e.target.value })}
            />

            {/* Product-specific fields */}
            {editingService?.service_type === 'Product' && (
              <>
                <Input
                  placeholder="SKU"
                  value={editingService?.sku || ''}
                  onChange={(e) => setEditingService({ ...editingService!, sku: e.target.value })}
                />
                <Input
                  type="number"
                  placeholder="Inventory Count"
                  value={editingService?.inventory_count || ''}
                  onChange={(e) => setEditingService({ ...editingService!, inventory_count: parseInt(e.target.value) })}
                />
              </>
            )}

            {/* License-specific fields */}
            {editingService?.service_type === 'License' && (
              <>
                <Input
                  type="number"
                  placeholder="Seat Limit"
                  value={editingService?.seat_limit || ''}
                  onChange={(e) => setEditingService({ ...editingService!, seat_limit: parseInt(e.target.value) })}
                />
                <CustomSelect
                  options={LICENSE_TERM_OPTIONS}
                  value={editingService?.license_term || 'monthly'}
                  onValueChange={(value) => setEditingService({ ...editingService!, license_term: value })}
                  placeholder="Select license term..."
                />
              </>
            )}
          </div>
          <DialogFooter>
            <Button id='cancel-button' variant="outline" onClick={() => {
              setIsEditDialogOpen(false);
              setEditingService(null);
            }}>Cancel</Button>
            <Button id='save-button' onClick={() => {
              handleUpdateService();
              setIsEditDialogOpen(false);
            }}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={confirmDeleteService}
        title="Delete Service"
        message="Are you sure you want to delete this service? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </>
  );
};

export default ServiceCatalogManager;
