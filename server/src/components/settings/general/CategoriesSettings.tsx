'use client'

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical } from "lucide-react";
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { 
  getAllCategories, 
  createCategory,
  updateCategory,
  deleteCategory
} from 'server/src/lib/actions/ticketCategoryActions';
import { getAllChannels } from 'server/src/lib/actions/channel-actions/channelActions';
import { IChannel } from 'server/src/interfaces/channel.interface';
import { getAvailableReferenceData, importReferenceData, checkImportConflicts, ImportConflict } from 'server/src/lib/actions/referenceDataActions';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
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
import CustomSelect from 'server/src/components/ui/CustomSelect';

const CategoriesSettings: React.FC = () => {
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
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
  const [editingCategory, setEditingCategory] = useState<ITicketCategory | null>(null);
  const [formData, setFormData] = useState({
    category_name: '',
    display_order: 0,
    channel_id: '',
    parent_category: ''
  });
  
  // State for Import Dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferenceCategories, setAvailableReferenceCategories] = useState<any[]>([]);
  const [selectedImportCategories, setSelectedImportCategories] = useState<string[]>([]);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});
  const [importTargetChannel, setImportTargetChannel] = useState<string>('');
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [channelFilter, setChannelFilter] = useState<string>('all');

  useEffect(() => {
    fetchCategories();
    fetchChannels();
  }, []);

  const fetchCategories = async () => {
    try {
      const allCategories = await getAllCategories();
      // Organize categories hierarchically
      const parentCategories = allCategories
        .filter(cat => !cat.parent_category)
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      
      const organizedCategories: ITicketCategory[] = [];
      
      parentCategories.forEach(parent => {
        organizedCategories.push(parent);
        // Add children immediately after parent, sorted by their display_order
        const children = allCategories
          .filter(cat => cat.parent_category === parent.category_id)
          .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
        organizedCategories.push(...children);
      });
      
      setCategories(organizedCategories);
    } catch (error) {
      console.error('Error fetching categories:', error);
      setError('Failed to fetch categories');
    }
  };

  const fetchChannels = async () => {
    try {
      const allChannels = await getAllChannels();
      setChannels(allChannels.filter(ch => !ch.is_inactive));
    } catch (error) {
      console.error('Error fetching channels:', error);
    }
  };

  const startEditing = (category: ITicketCategory) => {
    setEditingCategory(category);
    setFormData({
      category_name: category.category_name,
      display_order: category.display_order || 0,
      channel_id: category.channel_id || '',
      parent_category: category.parent_category || ''
    });
    setShowAddEditDialog(true);
    setError(null);
  };

  const handleDeleteCategory = async () => {
    try {
      await deleteCategory(deleteDialog.categoryId);
      toast.success('Category deleted successfully');
      await fetchCategories();
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete category');
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
        const updateData: any = {
          category_name: formData.category_name,
          display_order: formData.display_order
        };
        
        // Only include channel_id for parent categories
        if (!editingCategory.parent_category) {
          updateData.channel_id = formData.channel_id;
        }
        
        await updateCategory(editingCategory.category_id, updateData);
        toast.success('Category updated successfully');
      } else {
        // For new categories
        if (!formData.parent_category && !formData.channel_id) {
          setError('Channel is required for top-level categories');
          return;
        }
        
        const createData: any = {
          category_name: formData.category_name,
          display_order: formData.display_order
        };
        
        if (formData.parent_category) {
          // For subcategories, get channel from parent
          const parentCategory = categories.find(cat => cat.category_id === formData.parent_category);
          if (parentCategory) {
            createData.channel_id = parentCategory.channel_id;
            createData.parent_category = formData.parent_category;
          }
        } else {
          // For top-level categories
          createData.channel_id = formData.channel_id;
        }
        
        await createCategory(createData);
        toast.success('Category created successfully');
      }
      
      setShowAddEditDialog(false);
      setEditingCategory(null);
      setFormData({ category_name: '', display_order: 0, channel_id: '', parent_category: '' });
      await fetchCategories();
    } catch (error) {
      console.error('Error saving category:', error);
      setError(error instanceof Error ? error.message : 'Failed to save category');
    }
  };

  const handleImport = async () => {
    try {
      if (!importTargetChannel) {
        toast.error('Please select a channel for the imported categories');
        return;
      }

      const importOptions = { channel_id: importTargetChannel };
      
      if (importConflicts.length > 0) {
        await importReferenceData('categories', selectedImportCategories, importOptions, conflictResolutions);
      } else {
        const conflicts = await checkImportConflicts('categories', selectedImportCategories, importOptions);
        if (conflicts.length > 0) {
          setImportConflicts(conflicts);
          return;
        }
        await importReferenceData('categories', selectedImportCategories, importOptions);
      }
      
      toast.success('Categories imported successfully');
      setShowImportDialog(false);
      setSelectedImportCategories([]);
      setImportTargetChannel('');
      setImportConflicts([]);
      setConflictResolutions({});
      await fetchCategories();
    } catch (error) {
      console.error('Error importing categories:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import categories');
    }
  };

  // Filter categories based on selected channel while maintaining hierarchy
  const getFilteredCategories = () => {
    if (channelFilter === 'all') {
      return categories;
    }
    
    // Filter and reorganize to maintain parent-child structure
    const allFilteredCategories = categories.filter(cat => cat.channel_id === channelFilter);
    const filteredParents = allFilteredCategories
      .filter(cat => !cat.parent_category)
      .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
    
    const organized: ITicketCategory[] = [];
    filteredParents.forEach(parent => {
      organized.push(parent);
      const children = allFilteredCategories
        .filter(cat => cat.parent_category === parent.category_id)
        .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
      organized.push(...children);
    });
    
    return organized;
  };
  
  const filteredCategories = getFilteredCategories();

  const columns: ColumnDefinition<ITicketCategory>[] = [
    {
      title: 'Name',
      dataIndex: 'category_name',
      render: (value: string, record: ITicketCategory) => (
        <div className="flex items-center">
          {record.parent_category && (
            <span className="text-muted-foreground mr-2 ml-4">↳</span>
          )}
          <span className={`text-gray-700 font-medium ${record.parent_category ? '' : 'font-semibold'}`}>
            {value}
          </span>
        </div>
      ),
    },
    {
      title: 'Channel',
      dataIndex: 'channel_id',
      render: (value: string) => {
        const channel = channels.find(ch => ch.channel_id === value);
        return <span className="text-gray-600">{channel?.channel_name || '-'}</span>;
      },
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      render: (value: number, record: ITicketCategory) => {
        if (!record.parent_category) {
          // For parent categories, show their main order
          return <span className="text-gray-700 font-medium">{value}</span>;
        } else {
          // For subcategories, show their order within the parent
          const parentCategory = categories.find(cat => cat.category_id === record.parent_category);
          const siblingSubcategories = categories
            .filter(cat => cat.parent_category === record.parent_category)
            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
          const orderWithinParent = siblingSubcategories.findIndex(cat => cat.category_id === record.category_id) + 1;
          
          return (
            <span className="text-gray-600 ml-4">
              {orderWithinParent}
            </span>
          );
        }
      },
    },
    {
      title: 'Actions',
      dataIndex: 'category_id',
      width: '10%',
      render: (value: string, record: ITicketCategory) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id="category-actions-menu" variant="ghost" className="h-8 w-8 p-0">
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
      ),
    },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Categories</h3>
          <CustomSelect
            value={channelFilter}
            onValueChange={setChannelFilter}
            options={[
              { value: 'all', label: 'All Channels' },
              ...channels.map(ch => ({
                value: ch.channel_id || '',
                label: ch.channel_name || ''
              }))
            ]}
            placeholder="Filter by channel"
            className="w-64"
          />
        </div>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataTable
          data={filteredCategories}
          columns={columns}
        />
        <div className="mt-4 flex gap-2">
          <Button 
            id="add-category-button"
            onClick={() => {
              setEditingCategory(null);
              // Calculate next display order for parent categories
              const parentCategories = categories.filter(cat => !cat.parent_category);
              const nextOrder = parentCategories.length > 0 
                ? Math.max(...parentCategories.map(cat => cat.display_order || 0)) + 1 
                : 1;
              setFormData({ category_name: '', display_order: nextOrder, channel_id: '', parent_category: '' });
              setShowAddEditDialog(true);
              setError(null);
            }} 
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Category
          </Button>
          <Button 
            id="import-categories-button"
            variant="outline"
            onClick={async () => {
              try {
                const available = await getAvailableReferenceData('categories');
                setAvailableReferenceCategories(available || []);
                setSelectedImportCategories([]);
                setShowImportDialog(true);
              } catch (error) {
                console.error('Error fetching available categories:', error);
                toast.error('Failed to fetch available categories for import');
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
        title="Delete Category"
        message={`Are you sure you want to delete "${deleteDialog.categoryName}"? This action cannot be undone.`}
        confirmLabel="Delete"
      />

      {/* Add/Edit Dialog */}
      <Dialog 
        isOpen={showAddEditDialog} 
        onClose={() => {
          setShowAddEditDialog(false);
          setEditingCategory(null);
          setFormData({ category_name: '', display_order: 0, channel_id: '', parent_category: '' });
          setError(null);
        }} 
        title={editingCategory ? "Edit Category" : "Add Category"}
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
            {!editingCategory && (
              <div>
                <Label htmlFor="parent_category">Parent Category (Optional)</Label>
                <CustomSelect
                  value={formData.parent_category || 'none'}
                  onValueChange={(value) => {
                    // Update display order based on parent selection
                    let nextOrder = 1;
                    const actualValue = value === 'none' ? '' : value;
                    
                    if (actualValue) {
                      // For subcategories, calculate next order within parent
                      const siblingCategories = categories.filter(cat => cat.parent_category === actualValue);
                      nextOrder = siblingCategories.length > 0 
                        ? Math.max(...siblingCategories.map(cat => cat.display_order || 0)) + 1 
                        : 1;
                    } else {
                      // For parent categories
                      const parentCategories = categories.filter(cat => !cat.parent_category);
                      nextOrder = parentCategories.length > 0 
                        ? Math.max(...parentCategories.map(cat => cat.display_order || 0)) + 1 
                        : 1;
                    }
                    setFormData({ ...formData, parent_category: actualValue, display_order: nextOrder });
                  }}
                  options={[
                    { value: 'none', label: 'None (Top-level category)' },
                    ...categories
                      .filter(cat => !cat.parent_category)
                      .map(cat => ({
                        value: cat.category_id,
                        label: cat.category_name
                      }))
                  ]}
                  placeholder="Select parent category"
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave empty to create a top-level category
                </p>
              </div>
            )}
            {!editingCategory && !formData.parent_category && (
              <div>
                <Label htmlFor="channel_id">Channel *</Label>
                <CustomSelect
                  value={formData.channel_id}
                  onValueChange={(value) => setFormData({ ...formData, channel_id: value })}
                  options={channels.map(ch => ({
                    value: ch.channel_id || '',
                    label: ch.channel_name || ''
                  }))}
                  placeholder="Select a channel"
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Required for top-level categories
                </p>
              </div>
            )}
            {editingCategory && !editingCategory.parent_category && (
              <>
                <div>
                  <Label htmlFor="channel_id">Channel</Label>
                  <CustomSelect
                    value={formData.channel_id}
                    onValueChange={(value) => setFormData({ ...formData, channel_id: value })}
                    options={channels.map(ch => ({
                      value: ch.channel_id || '',
                      label: ch.channel_name || ''
                    }))}
                    placeholder="Select a channel"
                    className="w-full"
                  />
                </div>
                {formData.channel_id !== editingCategory.channel_id && (
                  <Alert>
                    <AlertDescription>
                      Changing the channel for this parent category will also update all its subcategories to the same channel.
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
            <div>
              <Label htmlFor="display_order">Display Order</Label>
              <Input
                id="display_order"
                type="number"
                value={formData.display_order}
                onChange={(e) => setFormData({ ...formData, display_order: parseInt(e.target.value) || 0 })}
                placeholder="Enter display order"
              />
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-category-dialog"
            variant="outline" 
            onClick={() => {
              setShowAddEditDialog(false);
              setEditingCategory(null);
              setFormData({ category_name: '', display_order: 0, channel_id: '', parent_category: '' });
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button id="save-category-button" onClick={handleSaveCategory}>
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
          setImportTargetChannel('');
        }} 
        title="Import Standard Categories"
      >
        <DialogContent>
          <div className="space-y-4">
            {!availableReferenceCategories || availableReferenceCategories.length === 0 ? (
              <p className="text-muted-foreground">No standard categories available to import.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Select standard categories to import into your organization:
                </p>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Target Channel *</label>
                  <CustomSelect
                    value={importTargetChannel}
                    onValueChange={setImportTargetChannel}
                    options={channels.map(ch => ({
                      value: ch.channel_id || '',
                      label: ch.channel_name || ''
                    }))}
                    placeholder="Select a channel for imported categories"
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    All imported categories will be assigned to this channel
                  </p>
                </div>
                <div className="border rounded-md">
                  <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                    <div className="w-8">
                      <input
                        type="checkbox"
                        checked={availableReferenceCategories.length > 0 && selectedImportCategories.length === availableReferenceCategories.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedImportCategories(availableReferenceCategories.map(cat => cat.id));
                          } else {
                            setSelectedImportCategories([]);
                          }
                        }}
                        className="w-4 h-4"
                      />
                    </div>
                    <div className="flex-1">Name</div>
                    <div className="flex-1">Description</div>
                    <div className="w-20 text-center">Order</div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {(() => {
                      // Organize categories hierarchically
                      const parentCategories = availableReferenceCategories.filter(cat => !cat.parent_category_uuid);
                      const organizedCategories: any[] = [];
                      
                      parentCategories.forEach(parent => {
                        organizedCategories.push(parent);
                        // Add children immediately after parent
                        const children = availableReferenceCategories.filter(
                          cat => cat.parent_category_uuid === parent.id
                        );
                        organizedCategories.push(...children);
                      });
                      
                      return organizedCategories.map((category) => {
                        const isSubcategory = !!category.parent_category_uuid;
                        return (
                        <div 
                          key={category.id} 
                          className={`flex items-center space-x-2 p-2 hover:bg-muted/30 border-b ${
                            isSubcategory ? 'pl-8' : ''
                          }`}
                        >
                          <div className="w-8">
                            <input
                              type="checkbox"
                              checked={selectedImportCategories.includes(category.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  // If selecting a parent category, also select its children
                                  const categoriesToAdd = [category.id];
                                  if (!isSubcategory) {
                                    const children = availableReferenceCategories.filter(
                                      c => c.parent_category_uuid === category.id
                                    );
                                    categoriesToAdd.push(...children.map(c => c.id));
                                  }
                                  setSelectedImportCategories([
                                    ...selectedImportCategories,
                                    ...categoriesToAdd.filter(id => !selectedImportCategories.includes(id))
                                  ]);
                                } else {
                                  // If deselecting a parent category, also deselect its children
                                  const categoriesToRemove = [category.id];
                                  if (!isSubcategory) {
                                    const children = availableReferenceCategories.filter(
                                      c => c.parent_category_uuid === category.id
                                    );
                                    categoriesToRemove.push(...children.map(c => c.id));
                                  }
                                  setSelectedImportCategories(
                                    selectedImportCategories.filter(id => !categoriesToRemove.includes(id))
                                  );
                                }
                              }}
                              className="w-4 h-4"
                            />
                          </div>
                          <div className="flex-1">
                            {isSubcategory && <span className="text-muted-foreground mr-2">↳</span>}
                            {category.category_name}
                          </div>
                          <div className="flex-1 text-sm text-muted-foreground">
                            {category.description || '-'}
                          </div>
                          <div className="w-20 text-center text-sm text-muted-foreground">
                            {category.display_order}
                          </div>
                        </div>
                      );
                    });
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-import-categories-dialog"
            variant="outline" 
            onClick={() => {
              setShowImportDialog(false);
              setSelectedImportCategories([]);
              setImportTargetChannel('');
            }}
          >
            Cancel
          </Button>
          <Button 
            id="import-selected-categories"
            onClick={handleImport} 
            disabled={selectedImportCategories.length === 0 || !importTargetChannel}
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
                const itemId = conflict.referenceItem.id;
                const resolution = conflictResolutions[itemId];
                
                return (
                  <div key={itemId} className="border rounded-lg p-4 space-y-3">
                    <div className="font-medium">{conflict.referenceItem.category_name}</div>
                    
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
                                [itemId]: { action: 'rename', newName: conflict.referenceItem.category_name + ' (2)' }
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
                          Display order {conflict.referenceItem.display_order} is already in use.
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
            id="cancel-categories-conflict-dialog"
            variant="outline" 
            onClick={() => {
              setImportConflicts([]);
              setConflictResolutions({});
            }}
          >
            Cancel
          </Button>
          <Button id="import-categories-with-resolutions" onClick={handleImport}>
            Import with Resolutions
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
};

export default CategoriesSettings;