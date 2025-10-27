'use client'

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical } from "lucide-react";
import { IServiceCategory, IStandardServiceCategory } from 'server/src/interfaces/billing.interfaces';
import { 
  getServiceCategories, 
  createServiceCategory,
  updateServiceCategory,
  deleteServiceCategory
} from '@product/actions/categoryActions';
import { getAvailableReferenceData, importReferenceData, checkImportConflicts, ImportConflict } from '@product/actions/referenceDataActions';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';

const ServiceCategoriesSettings: React.FC = () => {
  const [categories, setCategories] = useState<IServiceCategory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    categoryId: string;
    categoryName: string;
  }>({
    isOpen: false,
    categoryId: '',
    categoryName: ''
  });
  
  // State for Add/Edit Dialog
  const [showAddEditDialog, setShowAddEditDialog] = useState(false);
  const [editingCategory, setEditingCategory] = useState<IServiceCategory | null>(null);
  const [formData, setFormData] = useState({
    category_name: '',
    description: '',
    display_order: 0
  });
  
  // State for Import Dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferenceCategories, setAvailableReferenceCategories] = useState<IStandardServiceCategory[]>([]);
  const [selectedImportCategories, setSelectedImportCategories] = useState<string[]>([]);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const allCategories = await getServiceCategories();
      setCategories(allCategories);
    } catch (error) {
      console.error('Error fetching service categories:', error);
      setError('Failed to fetch service categories');
    }
  };

  const startEditing = (category: IServiceCategory) => {
    setEditingCategory(category);
    setFormData({
      category_name: category.category_name,
      description: category.description || '',
      display_order: category.display_order || 0
    });
    setShowAddEditDialog(true);
    setError(null);
  };

  const handleDeleteCategory = async () => {
    try {
      if (!deleteDialog.categoryId) {
        toast.error('Category ID is missing');
        return;
      }
      await deleteServiceCategory(deleteDialog.categoryId);
      toast.success('Service category deleted successfully');
      await fetchCategories();
    } catch (error) {
      console.error('Error deleting service category:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete service category');
    } finally {
      setDeleteDialog({ isOpen: false, categoryId: '', categoryName: '' });
    }
  };

  const handleSaveCategory = async () => {
    try {
      if (!formData.category_name.trim()) {
        setError('Category name is required');
        return;
      }

      if (editingCategory) {
        if (!editingCategory.category_id) {
          setError('Category ID is missing');
          return;
        }
        await updateServiceCategory(editingCategory.category_id, formData);
        toast.success('Service category updated successfully');
      } else {
        await createServiceCategory(formData);
        toast.success('Service category created successfully');
      }
      
      setShowAddEditDialog(false);
      setEditingCategory(null);
      setFormData({ category_name: '', description: '', display_order: 0 });
      await fetchCategories();
    } catch (error) {
      console.error('Error saving service category:', error);
      setError(error instanceof Error ? error.message : 'Failed to save service category');
    }
  };

  const handleImport = async () => {
    try {
      if (importConflicts.length > 0) {
        await importReferenceData('service_categories', selectedImportCategories, undefined, conflictResolutions);
      } else {
        const conflicts = await checkImportConflicts('service_categories', selectedImportCategories);
        if (conflicts.length > 0) {
          setImportConflicts(conflicts);
          return;
        }
        await importReferenceData('service_categories', selectedImportCategories);
      }
      
      toast.success('Service categories imported successfully');
      setShowImportDialog(false);
      setSelectedImportCategories([]);
      setImportConflicts([]);
      setConflictResolutions({});
      await fetchCategories();
    } catch (error) {
      console.error('Error importing service categories:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import service categories');
    }
  };

  const columns: ColumnDefinition<IServiceCategory>[] = [
    {
      title: 'Name',
      dataIndex: 'category_name',
      render: (value: string) => (
        <span className="text-gray-700 font-medium">{value}</span>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      render: (value: string | null) => (
        <span className="text-gray-600">{value || '-'}</span>
      ),
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      render: (value: number) => (
        <span className="text-gray-600">{value}</span>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'category_id',
      width: '10%',
      render: (value: string | null, record: IServiceCategory) => {
        if (!value) {
          return null;
        }
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id="service-category-actions" variant="ghost" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => startEditing(record)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setDeleteDialog({
                  isOpen: true,
                  categoryId: value,
                  categoryName: record.category_name
                })}
                className="text-red-600"
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div>
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Service Categories</h3>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataTable
          data={categories}
          columns={columns}
        />
        <div className="mt-4 flex gap-2">
          <Button 
            id="add-service-category"
            onClick={() => {
              setEditingCategory(null);
              setFormData({ category_name: '', description: '', display_order: categories.length + 1 });
              setShowAddEditDialog(true);
            }} 
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Service Category
          </Button>
          <Button 
            id="import-service-categories"
            variant="outline"
            onClick={async () => {
              try {
                const available = await getAvailableReferenceData('service_categories');
                setAvailableReferenceCategories(available || []);
                setSelectedImportCategories([]);
                setShowImportDialog(true);
              } catch (error) {
                console.error('Error fetching available service categories:', error);
                toast.error('Failed to fetch available service categories for import');
              }
            }}
          >
            Import from Standard Categories
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, categoryId: '', categoryName: '' })}
        onConfirm={handleDeleteCategory}
        title="Delete Service Category"
        message={`Are you sure you want to delete "${deleteDialog.categoryName}"? This action cannot be undone.`}
        confirmLabel="Delete"
      />

      {/* Add/Edit Dialog */}
      <Dialog 
        isOpen={showAddEditDialog} 
        onClose={() => {
          setShowAddEditDialog(false);
          setEditingCategory(null);
          setFormData({ category_name: '', description: '', display_order: 0 });
          setError(null);
        }} 
        title={editingCategory ? "Edit Service Category" : "Add Service Category"}
      >
        <DialogContent>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="category_name">Category Name *</Label>
              <Input
                id="category_name"
                value={formData.category_name}
                onChange={(e) => setFormData({ ...formData, category_name: e.target.value })}
                placeholder="Enter category name"
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter description"
              />
            </div>
            <div>
              <Label htmlFor="display_order">Display Order</Label>
              <Input
                id="display_order"
                type="number"
                value={formData.display_order}
                onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                placeholder="Enter display order"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Controls the order in which service categories appear in dropdown menus throughout the platform. Lower numbers appear first.
              </p>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-service-category"
            variant="outline" 
            onClick={() => {
              setShowAddEditDialog(false);
              setEditingCategory(null);
              setFormData({ category_name: '', description: '', display_order: 0 });
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button id="save-service-category" onClick={handleSaveCategory}>
            {editingCategory ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Import Dialog */}
      <Dialog 
        isOpen={showImportDialog && importConflicts.length === 0} 
        onClose={() => {
          setShowImportDialog(false);
          setSelectedImportCategories([]);
        }} 
        title="Import Standard Service Categories"
      >
        <DialogContent>
          <div className="space-y-4">
            {!availableReferenceCategories || availableReferenceCategories.length === 0 ? (
              <p className="text-muted-foreground">No standard service categories available to import.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Select standard service categories to import into your organization:
                </p>
                <div className="border rounded-md">
                  <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                    <div className="w-8 [&>div]:mb-0">
                      <Checkbox
                        id="select-all-categories"
                        checked={availableReferenceCategories.length > 0 && selectedImportCategories.length === availableReferenceCategories.length}
                        onChange={(e) => {
                          if ((e.target as HTMLInputElement).checked) {
                            setSelectedImportCategories(availableReferenceCategories.map(cat => cat.id));
                          } else {
                            setSelectedImportCategories([]);
                          }
                        }}
                      />
                    </div>
                    <div className="flex-1">Name</div>
                    <div className="flex-1">Description</div>
                    <div className="w-20 text-center">Order</div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {availableReferenceCategories.map((category) => (
                      <div
                        key={category.id}
                        className="flex items-center space-x-2 p-2 hover:bg-muted/30 border-b"
                      >
                        <div className="w-8 [&>div]:mb-0">
                          <Checkbox
                            id={`import-category-${category.id}`}
                            checked={selectedImportCategories.includes(category.id)}
                            onChange={(e) => {
                              if ((e.target as HTMLInputElement).checked) {
                                setSelectedImportCategories([...selectedImportCategories, category.id]);
                              } else {
                                setSelectedImportCategories(selectedImportCategories.filter(id => id !== category.id));
                              }
                            }}
                          />
                        </div>
                        <div className="flex-1">{category.category_name}</div>
                        <div className="flex-1 text-sm text-muted-foreground">
                          {category.description || '-'}
                        </div>
                        <div className="w-20 text-center text-sm text-muted-foreground">
                          {category.display_order}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-import"
            variant="outline" 
            onClick={() => {
              setShowImportDialog(false);
              setSelectedImportCategories([]);
            }}
          >
            Cancel
          </Button>
          <Button 
            id="import-selected"
            onClick={handleImport} 
            disabled={selectedImportCategories.length === 0}
          >
            Import Selected
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <Dialog 
        isOpen={importConflicts.length > 0} 
        onClose={() => {
          setImportConflicts([]);
          setConflictResolutions({});
        }} 
        title="Resolve Import Conflicts"
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The following items have conflicts. Choose how to resolve each:
            </p>
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
              {importConflicts.map((conflict) => {
                const referenceItem = conflict.referenceItem as IStandardServiceCategory;
                const itemId = referenceItem.id;
                const resolution = conflictResolutions[itemId];
                
                return (
                  <div key={itemId} className="border rounded-lg p-4 space-y-3">
                    <div className="font-medium">{referenceItem.category_name}</div>
                    
                    {conflict.conflictType === 'name' && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          A category with this name already exists.
                        </p>
                        <div className="space-y-2">
                          <label className="flex items-center space-x-2">
                            <input
                              type="radio"
                              name={`conflict-${itemId}`}
                              checked={resolution?.action === 'skip'}
                              onChange={() => setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { action: 'skip' }
                              })}
                            />
                            <span>Skip this item</span>
                          </label>
                          <label className="flex items-center space-x-2">
                            <input
                              type="radio"
                              name={`conflict-${itemId}`}
                              checked={resolution?.action === 'rename'}
                              onChange={() => setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { action: 'rename', newName: referenceItem.category_name + ' (2)' }
                              })}
                            />
                            <span>Import with new name:</span>
                          </label>
                          {resolution?.action === 'rename' && (
                            <Input
                              value={resolution.newName || ''}
                              onChange={(e) => setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { ...resolution, newName: e.target.value }
                              })}
                              className="ml-6"
                            />
                          )}
                        </div>
                      </div>
                    )}
                    
                    {conflict.conflictType === 'order' && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          Display order {referenceItem.display_order} is already in use.
                        </p>
                        <label className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name={`conflict-${itemId}`}
                            checked={resolution?.action === 'reorder'}
                            onChange={() => setConflictResolutions({
                              ...conflictResolutions,
                              [itemId]: { action: 'reorder', newOrder: conflict.suggestedOrder }
                            })}
                          />
                          <span>Import with order {conflict.suggestedOrder}</span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-conflicts"
            variant="outline" 
            onClick={() => {
              setImportConflicts([]);
              setConflictResolutions({});
            }}
          >
            Cancel
          </Button>
          <Button id="import-with-resolutions" onClick={handleImport}>
            Import with Resolutions
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
};

export default ServiceCategoriesSettings;