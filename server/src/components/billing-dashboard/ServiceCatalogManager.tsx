'use client';

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { UnitOfMeasureInput } from './UnitOfMeasureInput';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/Dialog';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import { getServices, updateService, deleteService } from 'server/src/lib/actions/serviceActions';
import { getServiceCategories } from 'server/src/lib/actions/serviceCategoryActions';
import { IService, IServiceCategory } from 'server/src/interfaces/billing.interfaces';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { Switch } from '../ui/Switch';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { QuickAddService } from './QuickAddService';
import { MoreVertical } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';

// Removed old SERVICE_TYPE_OPTIONS

// Define billing method options (as per plan)
const BILLING_METHOD_OPTIONS = [
  { value: 'fixed', label: 'Fixed Price' },
  { value: 'per_unit', label: 'Per Unit' }
];

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
  // Add others if needed, ensure these match backend expectations
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
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedBillingMethod, setSelectedBillingMethod] = useState<string>('all');

  const filteredServices = services.filter(service => {
    const categoryMatch = selectedCategory === 'all' || service.service_type === selectedCategory;
    const billingMethodMatch = selectedBillingMethod === 'all' || service.billing_method === selectedBillingMethod;
    return categoryMatch && billingMethodMatch;
  });

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
        title: 'Category', // Renamed from Service Type
        dataIndex: 'service_type',
      },
      {
        title: 'Billing Method',
        dataIndex: 'billing_method',
        render: (value) => BILLING_METHOD_OPTIONS.find(opt => opt.value === value)?.label || value,
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
        title: 'Unit', // Shortened title
        dataIndex: 'unit_of_measure',
        render: (value, record) => record.billing_method === 'per_unit' ? value || 'N/A' : 'N/A',
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

    // Removed conditional columns based on old service_type
    // TODO: Re-add conditional columns based on new category/billing method if needed
    baseColumns.push(
      {
        title: 'SKU',
        dataIndex: 'sku',
        render: (value, record) => record.service_type === 'Hardware' ? value || 'N/A' : 'N/A',
      },
      {
        title: 'Inventory',
        dataIndex: 'inventory_count',
        render: (value, record) => record.service_type === 'Hardware' ? (value ?? 'N/A') : 'N/A', // Use ?? for 0
      },
      {
        title: 'Seat Limit',
        dataIndex: 'seat_limit',
        render: (value, record) => record.service_type === 'Software License' ? (value ?? 'N/A') : 'N/A', // Use ?? for 0
      },
      {
        title: 'License Term',
        dataIndex: 'license_term',
        render: (value, record) => record.service_type === 'Software License' ? value || 'N/A' : 'N/A',
      }
    );

    // Always add actions column at the end
    baseColumns.push({
      title: 'Action',
      dataIndex: 'service_id',
      render: (_, record) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="h-8 w-8 p-0"
              id={`service-actions-menu-${record.service_id}`}
              onClick={(e) => e.stopPropagation()}
            >
              <span className="sr-only">Open menu</span>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              id={`edit-service-${record.service_id}`}
              onClick={() => {
                setEditingService(record);
                setIsEditDialogOpen(true);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`delete-service-${record.service_id}`}
              onClick={() => handleDeleteService(record.service_id!)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
              <div className="flex space-x-2">
                <CustomSelect
                  options={[{ value: 'all', label: 'All Categories' }, ...SERVICE_CATEGORY_OPTIONS]}
                  value={selectedCategory}
                  onValueChange={setSelectedCategory}
                  placeholder="Filter by category..."
                  className="w-[200px]"
                />
                <CustomSelect
                  options={[{ value: 'all', label: 'All Billing Methods' }, ...BILLING_METHOD_OPTIONS]}
                  value={selectedBillingMethod}
                  onValueChange={setSelectedBillingMethod}
                  placeholder="Filter by billing method..."
                  className="w-[200px]"
                />
              </div>
              <QuickAddService onServiceAdded={fetchServices} />
            </div>
            <DataTable
              data={filteredServices}
              columns={columns}
              pagination={true}
              onRowClick={(record) => {
                setEditingService(record);
                setIsEditDialogOpen(true);
              }}
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
            {/* Changed service_type to CustomSelect for Category */}
            <CustomSelect
              options={SERVICE_CATEGORY_OPTIONS}
              value={editingService?.service_type || ''}
              onValueChange={(value) => setEditingService({ ...editingService!, service_type: value })}
              placeholder="Select category..."
            />
            {/* Added Billing Method dropdown */}
            <CustomSelect
              options={BILLING_METHOD_OPTIONS}
              value={editingService?.billing_method || 'fixed'}
              onValueChange={(value) => setEditingService({ ...editingService!, billing_method: value as 'fixed' | 'per_unit' })}
              placeholder="Select billing method..."
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
            {/* Conditional Unit of Measure */}
            {editingService?.billing_method === 'per_unit' && (
              <UnitOfMeasureInput
                value={editingService?.unit_of_measure || ''}
                onChange={(value) => setEditingService({ ...editingService!, unit_of_measure: value })}
                placeholder="Unit of Measure"
                className="w-full"
              />
            )}
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

            {/* Removed conditional rendering based on old service_type */}
            {/* Conditional Fields based on Category */}
            {editingService?.service_type === 'Hardware' && (
              <>
                <Input
                  placeholder="SKU"
                  value={editingService?.sku || ''}
                  onChange={(e) => setEditingService({ ...editingService!, sku: e.target.value })}
                />
                <Input
                  type="number"
                  placeholder="Inventory Count"
                  value={editingService?.inventory_count ?? ''} // Use ?? for 0
                  onChange={(e) => setEditingService({ ...editingService!, inventory_count: parseInt(e.target.value) || 0 })}
                />
              </>
            )}
            {editingService?.service_type === 'Software License' && (
              <>
                <Input
                  type="number"
                  placeholder="Seat Limit"
                  value={editingService?.seat_limit ?? ''} // Use ?? for 0
                  onChange={(e) => setEditingService({ ...editingService!, seat_limit: parseInt(e.target.value) || 0 })}
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
