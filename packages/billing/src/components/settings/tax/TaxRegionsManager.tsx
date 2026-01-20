'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod'; // Assuming this is installed, will verify later if needed
import * as z from 'zod';
import toast from 'react-hot-toast'; // Use react-hot-toast
import { MoreVertical, PlusCircle } from 'lucide-react';

import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@alga-psa/ui/components/Card';
import { DataTable } from '@alga-psa/ui/components/DataTable';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@alga-psa/ui/components/DropdownMenu';

// Removed Form imports as we'll use standard HTML form + react-hook-form control
import { Label } from '@alga-psa/ui/components/Label'; // Import Label directly

import { Input } from '@alga-psa/ui/components/Input';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Row } from '@tanstack/react-table'; // Keep Row type
import { Controller, ControllerRenderProps, FieldValues, Path, FieldError } from 'react-hook-form'; // Import Controller
import { ITaxRegion } from '@alga-psa/types';
import { ColumnDefinition } from '@alga-psa/types'; // Import custom ColumnDefinition
import GenericDialog from '@alga-psa/ui/components/GenericDialog'; // Import GenericDialog
import {
  getTaxRegions,
  createTaxRegion,
  updateTaxRegion,
} from '@alga-psa/billing/actions';

// Zod schema for form validation
const taxRegionSchema = z.object({
  region_code: z.string().min(1, 'Region code is required').max(10, 'Region code max 10 chars'), // Assuming a max length
  region_name: z.string().min(1, 'Region name is required').max(100, 'Region name max 100 chars'), // Assuming a max length
  is_active: z.boolean().optional(),
});

type TaxRegionFormData = z.infer<typeof taxRegionSchema>;

export function TaxRegionsManager() {
  const [regions, setRegions] = useState<ITaxRegion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRegion, setEditingRegion] = useState<ITaxRegion | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const form = useForm<TaxRegionFormData>({
    resolver: zodResolver(taxRegionSchema),
    defaultValues: {
      region_code: '',
      region_name: '',
      is_active: true,
    },
  });

  const fetchRegions = useCallback(async () => {
    setIsLoading(true);
    try {
      const fetchedRegions = await getTaxRegions();
      setRegions(fetchedRegions);
    } catch (error) {
      console.error('Failed to fetch tax regions:', error);
      toast.error('Failed to load tax regions.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  const handleOpenDialog = (region: ITaxRegion | null = null) => {
    setEditingRegion(region);
    if (region) {
      form.reset({
        region_code: region.region_code,
        region_name: region.region_name,
        is_active: region.is_active,
      });
    } else {
      form.reset({
        region_code: '',
        region_name: '',
        is_active: true,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingRegion(null);
    form.reset(); // Reset form on close
  };

  const onSubmit = async (data: TaxRegionFormData) => {
    setIsSubmitting(true);
    const action = editingRegion ? 'update' : 'create';
    const successMessage = editingRegion ? 'Tax region updated successfully.' : 'Tax region created successfully.';
    const errorMessage = editingRegion ? 'Failed to update tax region.' : 'Failed to create tax region.';

    try {
      if (editingRegion) {
        // Update requires region_code separately
        await updateTaxRegion(editingRegion.region_code, {
            region_code: data.region_code,
            region_name: data.region_name,
            is_active: data.is_active,
        });
      } else {
        // Create uses data directly
        await createTaxRegion({
            region_code: data.region_code,
            region_name: data.region_name,
            is_active: data.is_active,
        });
      }
      toast.success(successMessage);
      await fetchRegions(); // Refresh data
      handleCloseDialog();
    } catch (error: any) {
      console.error(`${errorMessage}:`, error);
      toast.error(`${errorMessage} ${error?.message ? `(${error.message})` : ''}`);
    } finally {
      setIsSubmitting(false);
    }
  };

   const handleToggleActive = async (region: ITaxRegion) => {
    const newStatus = !region.is_active;
    const actionText = newStatus ? 'activate' : 'deactivate';
    setIsSubmitting(true); // Use isSubmitting to disable actions during toggle
    toast(`Attempting to ${actionText} ${region.region_name}...`); // Changed from toast.info

    try {
      await updateTaxRegion(region.region_code, { is_active: newStatus });
      toast.success(`Tax region ${region.region_name} ${actionText}d successfully.`);
      await fetchRegions(); // Refresh data
    } catch (error: any) {
      console.error(`Failed to ${actionText} tax region:`, error);
      toast.error(`Failed to ${actionText} tax region. ${error?.message ? `(${error.message})` : ''}`);
    } finally {
      setIsSubmitting(false);
    }
  };


  // Use ColumnDefinition from the project's interface
  const columns: ColumnDefinition<ITaxRegion>[] = [
    {
      title: 'Code',
      dataIndex: 'region_code',
    },
    {
      title: 'Name',
      dataIndex: 'region_name',
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      render: (value: any) => {
        const isActive = !!value;
        return (
          <Badge variant={isActive ? 'default' : 'warning'}>
            {isActive ? 'Active' : 'Inactive'}
          </Badge>
        );
      },
    },
    {
      title: 'Actions', // Use title
      dataIndex: 'actions', // Use a dummy dataIndex or omit if not needed by DataTable implementation
      render: (_: any, region: ITaxRegion) => { // Use render function
        // region is now passed directly to render
        const isActive = region.is_active;
        const actionText = isActive ? 'Deactivate' : 'Activate';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 p-0"
                id={`tax-region-actions-menu-${region.region_code}`}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                disabled={isSubmitting} // Disable during any submission
              >
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`edit-tax-region-menu-item-${region.region_code}`}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleOpenDialog(region);
                }}
                disabled={isSubmitting}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                id={`${actionText.toLowerCase()}-tax-region-menu-item-${region.region_code}`}
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleToggleActive(region);
                }}
                className={isActive ? "text-orange-600 focus:text-orange-600" : "text-green-600 focus:text-green-600"}
                disabled={isSubmitting}
              >
                {actionText}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <Card id="tax-regions-manager-card">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Manage Tax Regions</CardTitle>
        <Button
          size="sm"
          onClick={() => handleOpenDialog()}
          id="add-tax-region-button"
        >
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Tax Region
        </Button>
      </CardHeader>
      <CardContent>
        {/* Add loading indicator */}
        {isLoading && <div className="text-center p-4">Loading regions...</div>}
        {!isLoading && (
          <DataTable
            id="tax-regions-table"
            columns={columns}
            data={regions}
            onRowClick={(row) => handleOpenDialog(row)}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
          />
        )}
      </CardContent>

      {/* Use GenericDialog */}
      <GenericDialog
        isOpen={isDialogOpen}
        onClose={handleCloseDialog}
        title={editingRegion ? 'Edit Tax Region' : 'Add New Tax Region'}
        id="tax-region-dialog" // Provide an ID for reflection
      >
        {/* Form content goes inside GenericDialog */}
        {/* Removed DialogContent, DialogHeader, DialogTitle, DialogDescription - handled by GenericDialog */}
        {/* Removed Shadcn Form wrapper */}
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4" id="tax-region-form">
          {/* Manual Field Implementation */}
          <div className="space-y-1">
            <Label htmlFor="tax-region-code-field">Region Code</Label>
            <Input
              id="tax-region-code-field"
              placeholder="e.g., CA, NY, VAT-UK"
              {...form.register('region_code')} // Register field
              disabled={isSubmitting}
              aria-invalid={form.formState.errors.region_code ? "true" : "false"}
            />
            {form.formState.errors.region_code && (
              <p className="text-sm text-red-600" role="alert">
                {form.formState.errors.region_code?.message}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="tax-region-name-field">Region Name</Label>
            <Input
              id="tax-region-name-field"
              placeholder="e.g., California, New York, United Kingdom VAT"
              {...form.register('region_name')} // Register field
              disabled={isSubmitting}
              aria-invalid={form.formState.errors.region_name ? "true" : "false"}
            />
            {form.formState.errors.region_name && (
               <p className="text-sm text-red-600" role="alert">
                {form.formState.errors.region_name?.message} 
              </p>
            )}
          </div>

          {/* Use Controller for Switch */}
           <Controller
              name="is_active"
              control={form.control}
              render={({ field: { onChange, value, ref } }) => (
                 <div className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5">
                      <Label htmlFor="tax-region-active-field">Active</Label>
                    </div>
                      <Switch
                        id="tax-region-active-field"
                        checked={value}
                        onCheckedChange={onChange}
                        disabled={isSubmitting}
                        ref={ref}
                        aria-invalid={form.formState.errors.is_active ? "true" : "false"}
                      />
                 </div>
              )}
            /> 

           {form.formState.errors.is_active && (
             <p className="text-sm text-red-600" role="alert">
              {form.formState.errors.is_active?.message}
            </p>
          )}


          {/* Keep DialogFooter structure if needed within GenericDialog's children */}
          <div className="flex justify-end space-x-2 pt-4">
             <Button type="button" variant="outline" onClick={handleCloseDialog} id="tax-region-dialog-cancel-button">
               Cancel
             </Button>
             <Button type="submit" disabled={isSubmitting} id="tax-region-dialog-save-button">
               {isSubmitting ? 'Saving...' : 'Save Changes'}
             </Button>
          </div>
        </form>
      </GenericDialog>
    </Card>
  );
}

// Removed FormError helper as it's not needed