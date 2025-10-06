'use client'

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, CornerDownRight } from "lucide-react";
import { ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory
} from 'server/src/lib/actions/ticketCategoryActions';
import { getAllBoards } from 'server/src/lib/actions/board-actions/boardActions';
import { IBoard } from 'server/src/interfaces/board.interface';
import { getAvailableReferenceData, importReferenceData, checkImportConflicts, ImportConflict } from 'server/src/lib/actions/referenceDataActions';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { Checkbox } from 'server/src/components/ui/Checkbox';
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
    board_id: '',
    parent_category: ''
  });
  
  // State for Import Dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferenceCategories, setAvailableReferenceCategories] = useState<any[]>([]);
  const [selectedImportCategories, setSelectedImportCategories] = useState<string[]>([]);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});
  const [importTargetBoard, setImportTargetBoard] = useState<string>('');
  const [boards, setBoards] = useState<IBoard[]>([]);
  const [boardFilter, setBoardFilter] = useState<string>('all');

  useEffect(() => {
    fetchCategories();
    fetchBoards();
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

  const fetchBoards = async () => {
    try {
      const allBoards = await getAllBoards();
      setBoards(allBoards.filter(ch => !ch.is_inactive));
    } catch (error) {
      console.error('Error fetching boards:', error);
    }
  };

  const startEditing = (category: ITicketCategory) => {
    setEditingCategory(category);
    setFormData({
      category_name: category.category_name,
      display_order: category.display_order || 0,
      board_id: category.board_id || '',
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
    } catch (error: any) {
      console.error('Error deleting category:', error);
      // Extract the actual error message from Next.js server action error
      let errorMessage = 'Failed to delete category';
      
      if (error?.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      // Make the message more user-friendly
      if (errorMessage.includes('ticket') && errorMessage.includes('using this category')) {
        // Extract the ticket count from the message if present
        const match = errorMessage.match(/(\d+) ticket/);
        if (match) {
          const count = parseInt(match[1]);
          errorMessage = `Cannot delete this category because ${count} ticket${count === 1 ? ' is' : 's are'} currently using it. Please reassign or delete ${count === 1 ? 'that ticket' : 'those tickets'} first.`;
        } else {
          errorMessage = 'Cannot delete this category because it is currently assigned to one or more tickets. Please reassign or delete those tickets first.';
        }
      } else if (errorMessage.includes('has subcategories')) {
        errorMessage = 'Cannot delete this category because it has subcategories. Please delete all subcategories first.';
      }
      
      toast.error(errorMessage);
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
        
        // Only include board_id for parent categories
        if (!editingCategory.parent_category) {
          updateData.board_id = formData.board_id;
        }
        
        await updateCategory(editingCategory.category_id, updateData);
        toast.success('Category updated successfully');
      } else {
        // For new categories
        if (!formData.parent_category && !formData.board_id) {
          setError('Board is required for top-level categories');
          return;
        }
        
        const createData: any = {
          category_name: formData.category_name,
          display_order: formData.display_order
        };
        
        if (formData.parent_category) {
          // For subcategories, get board from parent
          const parentCategory = categories.find(cat => cat.category_id === formData.parent_category);
          if (parentCategory) {
            createData.board_id = parentCategory.board_id;
            createData.parent_category = formData.parent_category;
          }
        } else {
          // For top-level categories
          createData.board_id = formData.board_id;
        }
        
        await createCategory(createData);
        toast.success('Category created successfully');
      }
      
      setShowAddEditDialog(false);
      setEditingCategory(null);
      setFormData({ category_name: '', display_order: 0, board_id: '', parent_category: '' });
      await fetchCategories();
    } catch (error) {
      console.error('Error saving category:', error);
      setError(error instanceof Error ? error.message : 'Failed to save category');
    }
  };

  const handleImport = async () => {
    try {
      if (!importTargetBoard) {
        toast.error('Please select a board for the imported categories');
        return;
      }

      // Check if any selected subcategories don't have their parent selected
      const selectedSubcategories = availableReferenceCategories.filter(cat => 
        selectedImportCategories.includes(cat.id) && cat.parent_category_uuid
      );
      
      const missingParents = selectedSubcategories.filter(subcat => {
        const parentId = subcat.parent_category_uuid;
        return !selectedImportCategories.includes(parentId);
      });
      
      if (missingParents.length > 0) {
        const parentNames = missingParents.map(subcat => {
          const parent = availableReferenceCategories.find(c => c.id === subcat.parent_category_uuid);
          return parent?.category_name || 'Unknown parent';
        });
        toast.error(`Cannot import subcategories without their parent categories. Please also select: ${[...new Set(parentNames)].join(', ')}`);
        return;
      }

      const importOptions = { board_id: importTargetBoard };
      
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
      setImportTargetBoard('');
      setImportConflicts([]);
      setConflictResolutions({});
      await fetchCategories();
    } catch (error) {
      console.error('Error importing categories:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import categories');
    }
  };

  // Filter categories based on selected board while maintaining hierarchy
  const getFilteredCategories = () => {
    if (boardFilter === 'all') {
      return categories;
    }
    
    // Filter and reorganize to maintain parent-child structure
    const allFilteredCategories = categories.filter(cat => cat.board_id === boardFilter);
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
            <CornerDownRight className="h-3 w-3 text-muted-foreground mr-2 ml-4" />
          )}
          <span className={`text-gray-700 font-medium ${record.parent_category ? '' : 'font-semibold'}`}>
            {value}
          </span>
          {record.is_from_itil_standard && (
            <span className="ml-2 px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
              ITIL
            </span>
          )}
        </div>
      ),
    },
    {
      title: 'Board',
      dataIndex: 'board_id',
      render: (value: string) => {
        const board = boards.find(ch => ch.board_id === value);
        return <span className="text-gray-600">{board?.board_name || '-'}</span>;
      },
    },
    {
      title: 'Order',
      dataIndex: 'display_order',
      render: (value: number, record: ITicketCategory) => {
        if (!record.parent_category) {
          // For parent categories, show their main order
          return <span className="text-gray-700 font-semibold">{value}</span>;
        } else {
          // For subcategories, show their order within the parent
          const parentCategory = categories.find(cat => cat.category_id === record.parent_category);
          const siblingSubcategories = categories
            .filter(cat => cat.parent_category === record.parent_category)
            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
          const orderWithinParent = siblingSubcategories.findIndex(cat => cat.category_id === record.category_id) + 1;
          
          return (
            <div className="flex items-center pl-4">
              <CornerDownRight className="h-3 w-3 text-muted-foreground mr-2" />
              <span className="text-gray-500 text-sm bg-gray-100 px-2 py-0.5 rounded">
                {orderWithinParent}
              </span>
            </div>
          );
        }
      },
    },
    {
      title: 'Actions',
      dataIndex: 'category_id',
      width: '10%',
      render: (value: string, record: ITicketCategory) => {
        // ITIL imported categories cannot be edited or deleted
        if (record.is_from_itil_standard) {
          return (
            <span className="text-xs text-gray-400">Protected</span>
          );
        }

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id={`category-${value}-actions-button`} variant="ghost" className="h-8 w-8 p-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id={`edit-category-${value}-button`}
                onClick={() => startEditing(record)}>
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`delete-category-${value}-button`}
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
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-semibold text-gray-800">Categories</h3>
          <CustomSelect
            value={boardFilter}
            onValueChange={setBoardFilter}
            options={[
              { value: 'all', label: 'All Boards' },
              ...boards.map(ch => ({
                value: ch.board_id || '',
                label: ch.board_name || ''
              }))
            ]}
            placeholder="Filter by board"
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
              // Start with empty form - order will be calculated based on parent selection
              setFormData({ category_name: '', display_order: 0, board_id: '', parent_category: '' });
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
          setFormData({ category_name: '', display_order: 0, board_id: '', parent_category: '' });
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
                    const actualValue = value === 'none' ? '' : value;
                    setFormData({ ...formData, parent_category: actualValue });
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
                <Label htmlFor="board_id">Board *</Label>
                <CustomSelect
                  value={formData.board_id}
                  onValueChange={(value) => setFormData({ ...formData, board_id: value })}
                  options={boards
                    .filter(ch => ch.category_type !== 'itil')
                    .map(ch => ({
                      value: ch.board_id || '',
                      label: ch.board_name || ''
                    }))}
                  placeholder="Select a board"
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
                  <Label htmlFor="board_id">Board</Label>
                  <CustomSelect
                    value={formData.board_id}
                    onValueChange={(value) => setFormData({ ...formData, board_id: value })}
                    options={boards
                      .filter(ch => ch.category_type !== 'itil')
                      .map(ch => ({
                        value: ch.board_id || '',
                        label: ch.board_name || ''
                      }))}
                    placeholder="Select a board"
                    className="w-full"
                  />
                </div>
                {formData.board_id !== editingCategory.board_id && (
                  <Alert>
                    <AlertDescription>
                      Changing the board for this parent category will also update all its subcategories to the same board.
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
              <p className="text-xs text-muted-foreground mt-1">
                Controls the order in which categories appear in dropdown menus throughout the platform. Lower numbers appear first.
              </p>
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
              setFormData({ category_name: '', display_order: 0, board_id: '', parent_category: '' });
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
          setImportTargetBoard('');
        }} 
        title="Import Standard Categories"
        className="max-w-3xl"
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
                  <label className="text-sm font-medium">Target Board *</label>
                  <CustomSelect
                    value={importTargetBoard}
                    onValueChange={setImportTargetBoard}
                    options={boards
                      .filter(ch => ch.category_type !== 'itil')
                      .map(ch => ({
                        value: ch.board_id || '',
                        label: ch.board_name || ''
                      }))}
                    placeholder="Select a board for imported categories"
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    All imported categories will be assigned to this board
                  </p>
                </div>
                <div className="border rounded-md">
                  <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                    <div className="w-8 [&>div]:mb-0">
                      <Checkbox
                        id="select-all-categories-checkbox"
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
                    <div className="w-24 text-center">Order</div>
                  </div>
                  <div className="max-h-[350px] overflow-y-auto">
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
                        
                        // Calculate order display for subcategories
                        let orderDisplay: React.ReactNode;
                        if (isSubcategory) {
                          const siblingSubcategories = organizedCategories.filter(
                            cat => cat.parent_category_uuid === category.parent_category_uuid
                          );
                          const orderWithinParent = siblingSubcategories.findIndex(cat => cat.id === category.id) + 1;
                          orderDisplay = (
                            <div className="flex items-center justify-end pr-4">
                              <CornerDownRight className="h-3 w-3 text-muted-foreground mr-1" />
                              <span className="text-gray-500 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                {orderWithinParent}
                              </span>
                            </div>
                          );
                        } else {
                          orderDisplay = (
                            <span className="font-normal">{category.display_order}</span>
                          );
                        }
                        
                        return (
                        <div 
                          key={category.id} 
                          className={`flex items-center space-x-2 p-2 hover:bg-muted/30 border-b ${
                            isSubcategory ? 'pl-8' : ''
                          }`}
                        >
                          <div className="w-8 [&>div]:mb-0">
                            <Checkbox
                              id={`select-category-${category.id}-checkbox`}
                              checked={selectedImportCategories.includes(category.id)}
                              onChange={(e) => {
                                if ((e.target as HTMLInputElement).checked) {
                                  const categoriesToAdd = [category.id];
                                  
                                  // If selecting a subcategory, ensure parent is also selected
                                  if (isSubcategory && !selectedImportCategories.includes(category.parent_category_uuid)) {
                                    categoriesToAdd.push(category.parent_category_uuid);
                                  }
                                  
                                  // If selecting a parent category, also select its children
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
                            />
                          </div>
                          <div className="flex-1 flex items-center">
                            {isSubcategory && <CornerDownRight className="h-3 w-3 text-muted-foreground mr-2" />}
                            <span className={isSubcategory ? 'text-sm font-normal' : 'text-sm font-semibold'}>
                              {category.category_name}
                            </span>
                          </div>
                          <div className="flex-1 text-sm text-muted-foreground">
                            {category.description || '-'}
                          </div>
                          <div className="w-24 text-center text-sm text-muted-foreground">
                            {orderDisplay}
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
              setImportTargetBoard('');
            }}
          >
            Cancel
          </Button>
          <Button 
            id="import-selected-categories"
            onClick={handleImport} 
            disabled={selectedImportCategories.length === 0 || !importTargetBoard}
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