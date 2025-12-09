'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Plus, Package, ChevronDown, ChevronUp, CheckCircle, Settings, Palette, Trash2, Star, AlertTriangle, CornerDownRight, HelpCircle } from 'lucide-react';
import { StepProps } from '../types';
import { Checkbox } from 'server/src/components/ui/Checkbox';
import ColorPicker from 'server/src/components/ui/ColorPicker';
import { useSession } from 'next-auth/react';
import { 
  getAvailableReferenceData, 
  importReferenceData,
  deleteReferenceDataItem
} from 'server/src/lib/actions/referenceDataActions';
import { getTenantTicketingData } from 'server/src/lib/actions/onboarding-actions/onboardingActions';
import { IStandardPriority, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { IStandardStatus } from 'server/src/interfaces/status.interface';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { createBoard, updateBoard } from 'server/src/lib/actions/board-actions/boardActions';
import { createCategory } from 'server/src/lib/actions/ticketCategoryActions';
import { createStatus } from 'server/src/lib/actions/status-actions/statusActions';
import { createPriority } from 'server/src/lib/actions/priorityActions';
import toast from 'react-hot-toast';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';

interface SectionState {
  numbering: boolean;
  boards: boolean;
  categories: boolean;
  statuses: boolean;
  priorities: boolean;
}

interface ImportSectionState {
  boards: boolean;
  categories: boolean;
  statuses: boolean;
  priorities: boolean;
}

interface AddFormState {
  board: boolean;
  category: boolean;
  status: boolean;
  priority: boolean;
}

interface BoardFormData {
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
  isItilCompliant: boolean;
}

interface CategoryFormData {
  name: string;
  parentCategory: string;
  displayOrder: number;
  boardId: string;
}

interface StatusFormData {
  name: string;
  isClosed: boolean;
  isDefault: boolean;
  displayOrder: number;
}

interface PriorityFormData {
  name: string;
  color: string;
  displayOrder: number;
}

export function TicketingConfigStep({ data, updateData }: StepProps) {
  const { data: session } = useSession();
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [expandedSections, setExpandedSections] = useState<SectionState>({
    numbering: false,
    boards: false,
    categories: false,
    statuses: false,
    priorities: false
  });

  const [showImportDialogs, setShowImportDialogs] = useState<ImportSectionState>({
    boards: false,
    categories: false,
    statuses: false,
    priorities: false
  });

  const [showAddForms, setShowAddForms] = useState<AddFormState>({
    board: false,
    category: false,
    status: false,
    priority: false
  });

  // Form data for adding new items
  const [boardForm, setBoardForm] = useState<BoardFormData>({
    name: '',
    description: '',
    displayOrder: 0,
    isActive: true,
    isDefault: false,
    isItilCompliant: false
  });
  const [categoryForm, setCategoryForm] = useState<CategoryFormData>({ 
    name: '', 
    parentCategory: '', 
    displayOrder: 0,
    boardId: '' 
  });
  const [statusForm, setStatusForm] = useState<StatusFormData>({ 
    name: '', 
    isClosed: false, 
    isDefault: false, 
    displayOrder: 0 
  });
  const [priorityForm, setPriorityForm] = useState<PriorityFormData>({ 
    name: '', 
    color: '#3b82f6', 
    displayOrder: 0 
  });

  // Available standard data
  const [availableBoards, setAvailableBoards] = useState<any[]>([]);
  const [availableCategories, setAvailableCategories] = useState<any[]>([]);
  const [availableStatuses, setAvailableStatuses] = useState<IStandardStatus[]>([]);
  const [availablePriorities, setAvailablePriorities] = useState<IStandardPriority[]>([]);

  // Selected items for import
  const [selectedBoards, setSelectedBoards] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  
  // Board selection for categories import
  const [importTargetBoard, setImportTargetBoard] = useState<string>('');

  // Import results
  const [importResults, setImportResults] = useState<Record<string, { imported: number; skipped: number }>>({});

  // Loading states
  const [isImporting, setIsImporting] = useState<Record<string, boolean>>({
    boards: false,
    categories: false,
    statuses: false,
    priorities: false
  });

  // Imported items tracking
  const [importedBoards, setImportedBoards] = useState<any[]>([]);
  const [importedStatuses, setImportedStatuses] = useState<any[]>([]);
  const [importedCategories, setImportedCategories] = useState<string[]>([]);
  const [importedPriorities, setImportedPriorities] = useState<any[]>([]);

  // ITIL configuration
  const [showItilInfoModal, setShowItilInfoModal] = useState(false);
  const [importBoardItilSettings, setImportBoardItilSettings] = useState<Record<string, boolean>>({});

  // Function to load existing ticketing data
  const loadExistingData = async () => {
    try {
      const result = await getTenantTicketingData();
        
        if (result.success && result.data) {
          // Set imported items from existing data
          setImportedBoards(result.data.boards);
          setImportedStatuses(result.data.statuses);
          setImportedPriorities(result.data.priorities);
          
          // Set categories and priorities in the form data if not already set
          if (data.categories.length === 0 && result.data.categories.length > 0) {
            // Ensure we only store full category objects, no strings
            const categoryObjects = result.data.categories.filter(cat => 
              typeof cat === 'object' && cat.category_id
            );
            updateData({ categories: categoryObjects });
            setImportedCategories(categoryObjects.map(cat => cat.category_name));
          }
          
          if (data.priorities.length === 0 && result.data.priorities.length > 0) {
            // Pass full priority objects to preserve colors
            updateData({ priorities: result.data.priorities });
          }
          
          // Set statuses in form data
          if (result.data.statuses.length > 0) {
            updateData({ statuses: result.data.statuses });
          }
          
          // If there's a default board and no board is set, use it
          if (!data.boardId && result.data.boards.length > 0) {
            const defaultBoard = result.data.boards.find(ch => ch.is_default);
            if (defaultBoard) {
              updateData({ 
                boardId: defaultBoard.board_id,
                boardName: defaultBoard.board_name 
              });
            }
          }
        }
      } catch (error) {
        console.error('Error loading existing ticketing data:', error);
      } finally {
        setIsLoadingData(false);
      }
  };

  // Load existing ticketing data on mount
  useEffect(() => {
    loadExistingData();
  }, []); // Only run once on mount

  // Load available standard data when import dialogs are opened
  useEffect(() => {
    if (showImportDialogs.boards && availableBoards.length === 0) {
      loadAvailableBoards();
    }
  }, [showImportDialogs.boards]);

  useEffect(() => {
    if (showImportDialogs.categories && availableCategories.length === 0) {
      loadAvailableCategories();
    }
  }, [showImportDialogs.categories]);

  useEffect(() => {
    if (showImportDialogs.statuses && availableStatuses.length === 0) {
      loadAvailableStatuses();
    }
  }, [showImportDialogs.statuses]);

  useEffect(() => {
    if (showImportDialogs.priorities && availablePriorities.length === 0) {
      loadAvailablePriorities();
    }
  }, [showImportDialogs.priorities]);

  const loadAvailableBoards = async () => {
    try {
      const boards = await getAvailableReferenceData('boards');
      setAvailableBoards(boards);
    } catch (error) {
      console.error('Error loading available boards:', error);
    }
  };

  const loadAvailableCategories = async () => {
    try {
      // For categories, we need a board first
      if (data.boardId || importedBoards.length > 0) {
        const boardId = data.boardId || importedBoards[0]?.board_id;
        const categories = await getAvailableReferenceData('categories', { board_id: boardId });
        
        // Sort categories to ensure parents come before children
        const sortedCategories = (categories as any[]).sort((a: any, b: any) => {
          // Parent categories first
          if (!a.parent_category_uuid && b.parent_category_uuid) return -1;
          if (a.parent_category_uuid && !b.parent_category_uuid) return 1;
          
          // Then by display order
          return (a.display_order || 0) - (b.display_order || 0);
        });
        
        setAvailableCategories(sortedCategories);
      }
    } catch (error) {
      console.error('Error loading available categories:', error);
    }
  };

  const loadAvailableStatuses = async () => {
    try {
      const statuses = await getAvailableReferenceData('statuses', { item_type: 'ticket' });
      setAvailableStatuses(statuses);
    } catch (error) {
      console.error('Error loading available statuses:', error);
    }
  };

  const loadAvailablePriorities = async () => {
    try {
      const priorities = await getAvailableReferenceData('priorities', { item_type: 'ticket' });
      setAvailablePriorities(priorities);
    } catch (error) {
      console.error('Error loading available priorities:', error);
    }
  };

  const handleImportBoards = async () => {
    if (selectedBoards.length === 0) return;

    setIsImporting(prev => ({ ...prev, boards: true }));
    try {
      // Get the reference boards data first
      const referenceBoards = availableBoards.filter(board =>
        selectedBoards.includes(board.id)
      );

      // Separate ITIL and non-ITIL boards
      const itilBoards = referenceBoards.filter(board =>
        importBoardItilSettings[board.id]
      );
      const regularBoards = referenceBoards.filter(board =>
        !importBoardItilSettings[board.id]
      );

      const allResults: any = { imported: [], skipped: [] };

      // Import regular boards using the existing process
      if (regularBoards.length > 0) {
        const regularBoardIds = regularBoards.map(c => c.id);
        const regularResult = await importReferenceData('boards', regularBoardIds);

        if (regularResult?.imported) allResults.imported.push(...regularResult.imported);
        if (regularResult?.skipped) allResults.skipped.push(...regularResult.skipped);
      }

      // Create ITIL boards manually using the createBoard API
      for (const board of itilBoards) {
        try {
          const createdBoard = await createBoard({
            board_name: board.board_name,
            description: board.description || '',
            display_order: board.display_order,
            is_inactive: board.is_inactive || false,
            category_type: 'itil',
            priority_type: 'itil'
          });

          allResults.imported.push(createdBoard);
        } catch (createError) {
          console.error(`Failed to create ITIL board ${board.board_name}:`, createError);
          allResults.skipped.push({
            name: board.board_name,
            reason: 'Failed to create as ITIL board'
          });
        }
      }

      setImportResults(prev => ({ ...prev, boards: {
        imported: allResults.imported?.length || 0,
        skipped: allResults.skipped?.length || 0
      }}));

      // Track imported boards
      if (allResults.imported?.length > 0) {
        // Check if any imported board is marked as default
        const hasDefaultBoard = allResults.imported.some((ch: any) => ch.is_default);

        // Check if there's already a default board in existing boards
        const existingHasDefault = importedBoards.some(ch => ch.is_default);

        // If no default board exists, mark the first one as default
        if (!hasDefaultBoard && !existingHasDefault) {
          const firstBoard: any = allResults.imported[0];
          // Update the board to be default
          await updateBoard(firstBoard.board_id, { is_default: true });
          firstBoard.is_default = true;
          toast.success('First board automatically set as default', {
            duration: 3000
          });
        }

        // Sort boards by display_order to maintain proper order
        const allBoards = [...importedBoards, ...allResults.imported].sort((a, b) =>
          (a.display_order || 0) - (b.display_order || 0)
        );
        setImportedBoards(allBoards);

        // If we don't have a board set yet, use the first imported
        if (!data.boardId) {
          const firstBoard = allResults.imported[0];
          const isItilCompliant = firstBoard.category_type === 'itil' && firstBoard.priority_type === 'itil';
          updateData({
            boardId: firstBoard.board_id,
            boardName: firstBoard.board_name,
            is_itil_compliant: isItilCompliant
          });
        }
      }

      setSelectedBoards([]);
      setImportBoardItilSettings({});
      setShowImportDialogs(prev => ({ ...prev, boards: false }));
      await loadAvailableBoards();
    } catch (error) {
      console.error('Error importing boards:', error);
      toast.error('Failed to import boards');
    } finally {
      setIsImporting(prev => ({ ...prev, boards: false }));
    }
  };

  const handleImportCategories = async () => {
    if (selectedCategories.length === 0 || !importTargetBoard) return;
    
    // Check if any selected subcategories don't have their parent selected
    const selectedSubcategories = availableCategories.filter(cat => 
      selectedCategories.includes(cat.id) && cat.parent_category_uuid
    );
    
    const missingParents = selectedSubcategories.filter(subcat => {
      const parentId = subcat.parent_category_uuid;
      return !selectedCategories.includes(parentId);
    });
    
    if (missingParents.length > 0) {
      const parentNames = missingParents.map(subcat => {
        const parent = availableCategories.find(c => c.id === subcat.parent_category_uuid);
        return parent?.category_name || 'Unknown parent';
      });
      toast.error(`Cannot import subcategories without their parent categories. Please also select: ${[...new Set(parentNames)].join(', ')}`);
      return;
    }
    
    setIsImporting(prev => ({ ...prev, categories: true }));
    try {
      const result = await importReferenceData('categories', selectedCategories, { board_id: importTargetBoard });
      setImportResults(prev => ({ ...prev, categories: { 
        imported: result.imported?.length || 0, 
        skipped: result.skipped?.length || 0 
      }}));
      
      // Track imported categories
      if (result.imported?.length > 0) {
        // Store full category objects to preserve parent-child relationships
        const importedCategoryObjects: any[] = result.imported as any[];
        setImportedCategories(prev => [...new Set([...prev, ...importedCategoryObjects.map(cat => cat.category_name)])]);
        
        // Update data with full category objects, not just names
        const existingCategoryIds = (data.categories as any[]).map((cat: any) => cat.category_id);
        const newCategories = importedCategoryObjects.filter((cat: any) => !existingCategoryIds.includes(cat.category_id));
        
        // Sort all categories by display_order to maintain proper order
        const allCategories = [...data.categories, ...newCategories].sort((a, b) => {
          // Parent categories first
          if (!a.parent_category && b.parent_category) return -1;
          if (a.parent_category && !b.parent_category) return 1;
          
          // Then by display order
          return (a.display_order || 0) - (b.display_order || 0);
        });
        
        updateData({ 
          categories: allCategories
        });
      }
      
      setSelectedCategories([]);
      setShowImportDialogs(prev => ({ ...prev, categories: false }));
      await loadAvailableCategories();
    } catch (error) {
      console.error('Error importing categories:', error);
    } finally {
      setIsImporting(prev => ({ ...prev, categories: false }));
    }
  };

  const handleImportStatuses = async () => {
    if (selectedStatuses.length === 0) return;
    
    setIsImporting(prev => ({ ...prev, statuses: true }));
    try {
      const result = await importReferenceData('statuses', selectedStatuses, { item_type: 'ticket' });
      setImportResults(prev => ({ ...prev, statuses: { 
        imported: result.imported?.length || 0, 
        skipped: result.skipped?.length || 0 
      }}));
      
      // Track imported statuses
      if (result.imported?.length > 0) {
        // Check if any imported status is marked as default
        const hasDefaultStatus = result.imported.some((s: any) => s.is_default);
        
        // Check if there's already a default status in existing statuses
        const existingHasDefault = importedStatuses.some(s => s.is_default);
        
        // If no default status exists, mark the first open status as default
        if (!hasDefaultStatus && !existingHasDefault) {
          const firstOpenStatus = result.imported.find((s: any) => !s.is_closed);
          if (firstOpenStatus) {
            // Update the status to be default
            const { updateStatus } = await import('server/src/lib/actions/status-actions/statusActions');
            await updateStatus(firstOpenStatus.status_id, { is_default: true });
            firstOpenStatus.is_default = true;
            toast.success('First open status automatically set as default', {
              duration: 3000
            });
          }
        }
        
        // Sort statuses by order_number to maintain proper order
        const allImportedStatuses = [...importedStatuses, ...result.imported].sort((a, b) => 
          (a.order_number || 0) - (b.order_number || 0)
        );
        setImportedStatuses(allImportedStatuses);
        
        // Sort all statuses by order_number
        const allStatuses = [...(data.statuses || []), ...result.imported].sort((a, b) => 
          (a.order_number || 0) - (b.order_number || 0)
        );
        updateData({ 
          statusesImported: true,
          statuses: allStatuses
        });
      }
      
      setSelectedStatuses([]);
      setShowImportDialogs(prev => ({ ...prev, statuses: false }));
      await loadAvailableStatuses();
    } catch (error) {
      console.error('Error importing statuses:', error);
    } finally {
      setIsImporting(prev => ({ ...prev, statuses: false }));
    }
  };

  const handleImportPriorities = async () => {
    if (selectedPriorities.length === 0) return;
    
    setIsImporting(prev => ({ ...prev, priorities: true }));
    try {
      const result = await importReferenceData('priorities', selectedPriorities, { item_type: 'ticket' });
      setImportResults(prev => ({ ...prev, priorities: { 
        imported: result.imported?.length || 0, 
        skipped: result.skipped?.length || 0 
      }}));
      
      // Track imported priorities
      if (result.imported?.length > 0) {
        // Sort priorities by order_number to maintain proper order
        const allImportedPriorities = [...importedPriorities, ...result.imported].sort((a, b) => 
          (a.order_number || 0) - (b.order_number || 0)
        );
        setImportedPriorities(allImportedPriorities);
        
        // Pass full priority objects, not just names, sorted by order
        const allPriorities = [...data.priorities, ...result.imported].sort((a, b) => 
          (a.order_number || 0) - (b.order_number || 0)
        );
        updateData({ 
          priorities: allPriorities
        });
      }
      
      setSelectedPriorities([]);
      setShowImportDialogs(prev => ({ ...prev, priorities: false }));
      await loadAvailablePriorities();
    } catch (error) {
      console.error('Error importing priorities:', error);
    } finally {
      setIsImporting(prev => ({ ...prev, priorities: false }));
    }
  };

  const addCategory = async () => {
    if (!categoryForm.name.trim() || !categoryForm.boardId) return;
    
    // Check if category already exists
    if (data.categories.some(cat => cat.category_name === categoryForm.name && cat.board_id === categoryForm.boardId)) {
      toast.error('Category already exists in this board');
      return;
    }
    
    try {
      // Calculate display order if not provided or if already in use
      let displayOrder = categoryForm.displayOrder;
      const boardCategories = data.categories.filter(c => c.board_id === categoryForm.boardId);
      
      let relevantCategories;
      if (categoryForm.parentCategory) {
        // For subcategories, consider siblings under the same parent
        relevantCategories = boardCategories.filter(c => c.parent_category === categoryForm.parentCategory);
      } else {
        // For parent categories in this board
        relevantCategories = boardCategories.filter(c => !c.parent_category);
      }
      
      const maxOrder = relevantCategories.length > 0 
        ? Math.max(...relevantCategories.map(cat => cat.display_order || 0))
        : 0;
      
      if (!displayOrder || displayOrder === 0) {
        displayOrder = maxOrder + 1;
      } else {
        // Check if the provided order is already in use
        const isOrderInUse = relevantCategories.some(cat => cat.display_order === displayOrder);
        if (isOrderInUse) {
          displayOrder = maxOrder + 1;
        }
      }
      
      // Create actual category in database
      const createdCategory = await createCategory({
        category_name: categoryForm.name,
        board_id: categoryForm.boardId,
        parent_category: categoryForm.parentCategory || undefined,
        display_order: displayOrder
      });
      
      // Update wizard data with the created category and sort by display_order
      const allCategories = [...data.categories, createdCategory].sort((a, b) => {
        // Parent categories first
        if (!a.parent_category && b.parent_category) return -1;
        if (a.parent_category && !b.parent_category) return 1;
        
        // Then by display order
        return (a.display_order || 0) - (b.display_order || 0);
      });
      
      updateData({ categories: allCategories });
      setImportedCategories(prev => [...prev, createdCategory.category_name]);
      
      // Reset form and close dialog
      setCategoryForm({ name: '', parentCategory: '', displayOrder: 0, boardId: '' });
      setShowAddForms(prev => ({ ...prev, category: false }));
    } catch (error) {
      console.error('Error creating category:', error);
      toast.error('Failed to create category. Please try again.');
    }
  };


  const addPriority = async () => {
    if (!priorityForm.name.trim()) return;
    
    // Check if priority already exists
    if (data.priorities.some(p => (typeof p === 'string' ? p : p.priority_name) === priorityForm.name)) {
      toast.error('Priority already exists');
      return;
    }
    
    try {
      // Get current user ID
      const userId = session?.user?.id;
      if (!userId) {
        toast.error('User session not found. Please refresh and try again.');
        return;
      }
      
      // Calculate the next order number if not provided or if already in use
      let orderNumber = priorityForm.displayOrder;
      const existingPriorities = [...importedPriorities, ...data.priorities.filter(p => typeof p === 'object')];
      const maxOrder = existingPriorities.reduce((max, priority) => 
        Math.max(max, priority.order_number || 0), 0
      );
      
      if (!orderNumber || orderNumber === 0) {
        orderNumber = maxOrder + 1;
      } else {
        // Check if the provided order is already in use
        const isOrderInUse = existingPriorities.some(p => p.order_number === orderNumber);
        if (isOrderInUse) {
          orderNumber = maxOrder + 1;
        }
      }
      
      // Create actual priority in database
      const createdPriority = await createPriority({
        priority_name: priorityForm.name,
        color: priorityForm.color,
        order_number: orderNumber,
        item_type: 'ticket',
      });
      
      // Add full priority object to data and sort by order_number
      const allPriorities = [...data.priorities, createdPriority]
        .filter(p => typeof p === 'object')
        .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
      updateData({ priorities: allPriorities });
      
      // Also track for display, sorted by order_number
      setImportedPriorities(prev => {
        const allImported = [...prev, createdPriority].sort((a, b) => 
          (a.order_number || 0) - (b.order_number || 0)
        );
        return allImported;
      });
      
      // Reset form and close dialog
      setPriorityForm({ name: '', color: '#3b82f6', displayOrder: 0 });
      setShowAddForms(prev => ({ ...prev, priority: false }));
    } catch (error) {
      console.error('Error creating priority:', error);
      toast.error('Failed to create priority. Please try again.');
    }
  };


  const toggleSection = (section: keyof SectionState) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleImportDialog = (section: keyof ImportSectionState) => {
    setShowImportDialogs(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const hasBoard = () => {
    return !!(data.boardId || data.boardName || importedBoards.length > 0);
  };

  // Remove functions for each type
  const removeBoard = async (boardId: string) => {
    try {
      const result = await deleteReferenceDataItem('boards', boardId);
      if (result.success) {
        // Remove from imported boards
        setImportedBoards(prev => prev.filter(ch => ch.board_id !== boardId));
        
        // If this was the selected board, clear it
        if (data.boardId === boardId) {
          updateData({ boardId: undefined, boardName: '' });
        }
        
        // Refresh data from server
        loadExistingData();
        toast.success('Board deleted successfully');
      } else {
        toast.error(result.error || 'Failed to delete board');
      }
    } catch (error) {
      console.error('Error deleting board:', error);
      toast.error('Failed to delete board');
    }
  };

  const setDefaultBoard = async (boardId: string) => {
    try {
      const board = importedBoards.find(ch => ch.board_id === boardId);
      if (!board) return;
      
      // Don't allow removing default status - at least one board must be default
      if (board.is_default) {
        toast.error('At least one board must be set as default', {
          duration: 3000
        });
        return;
      }
      
      // Set this board as default (this will automatically unset others)
      await updateBoard(board.board_id, { is_default: true });
      
      // Refresh data from server to get updated default states
      await loadExistingData();
      
      // Update the selected board in wizard data if no board is selected
      if (!data.boardId) {
        updateData({ 
          boardId: board.board_id,
          boardName: board.board_name 
        });
      }
      
      toast.success('Default board updated successfully');
    } catch (error) {
      console.error('Error setting default board:', error);
      toast.error('Failed to set default board');
    }
  };

  const removeCategory = async (categoryId: string) => {
    try {
      const result = await deleteReferenceDataItem('categories', categoryId);
      if (result.success) {
        // Remove from data.categories
        updateData({ 
          categories: data.categories.filter(cat => cat.category_id !== categoryId) 
        });
        
        // Remove from imported categories tracking
        const category = data.categories.find(cat => cat.category_id === categoryId);
        if (category) {
          setImportedCategories(prev => prev.filter(name => name !== category.category_name));
        }
        
        // Refresh data from server
        loadExistingData();
        toast.success('Category deleted successfully');
      } else {
        toast.error(result.error || 'Failed to delete category');
      }
    } catch (error) {
      console.error('Error deleting category:', error);
      toast.error('Failed to delete category');
    }
  };

  const removeStatus = async (statusId: string) => {
    try {
      const result = await deleteReferenceDataItem('statuses', statusId);
      if (result.success) {
        // Remove from imported statuses
        setImportedStatuses(prev => prev.filter(s => s.status_id !== statusId));
        
        // Remove from data.statuses
        updateData({ 
          statuses: (data.statuses || []).filter(s => s.status_id !== statusId) 
        });
        
        // Refresh data from server
        loadExistingData();
        toast.success('Status deleted successfully');
      } else {
        toast.error(result.error || 'Failed to delete status');
      }
    } catch (error) {
      console.error('Error deleting status:', error);
      toast.error('Failed to delete status');
    }
  };

  const removePriority = async (priorityId: string) => {
    try {
      const result = await deleteReferenceDataItem('priorities', priorityId);
      if (result.success) {
        // Find the priority to remove
        const priorityToRemove = data.priorities.find(p => 
          (typeof p === 'object' && p.priority_id === priorityId)
        );
        
        if (priorityToRemove && typeof priorityToRemove === 'object') {
          // Remove from imported priorities
          setImportedPriorities(prev => prev.filter(p => p.priority_id !== priorityId));
          
          // Remove from data.priorities
          updateData({ 
            priorities: data.priorities.filter(p => 
              !(typeof p === 'object' && p.priority_id === priorityId)
            ) 
          });
        }
        
        // Refresh data from server
        loadExistingData();
        toast.success('Priority deleted successfully');
      } else {
        toast.error(result.error || 'Failed to delete priority');
      }
    } catch (error) {
      console.error('Error deleting priority:', error);
      toast.error('Failed to delete priority');
    }
  };

  const setDefaultStatus = async (statusId: string) => {
    try {
      const status = importedStatuses.find(s => s.status_id === statusId);
      if (!status) return;
      
      // Don't allow removing default status - at least one status must be default
      if (status.is_default) {
        toast.error('At least one status must be set as default', {
          duration: 3000
        });
        return;
      }
      
      // Don't allow closed statuses to be default
      if (status.is_closed) {
        toast.error('Closed statuses cannot be set as default');
        return;
      }
      
      // Update status to be default (this will automatically unset others)
      const { updateStatus } = await import('server/src/lib/actions/status-actions/statusActions');
      await updateStatus(statusId, { is_default: true });
      
      // Refresh data from server to get updated default states
      await loadExistingData();
      
      toast.success('Default status updated successfully');
    } catch (error) {
      console.error('Error setting default status:', error);
      toast.error('Failed to set default status');
    }
  };

  if (isLoadingData) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Configure Ticketing System</h2>
          <p className="text-sm text-gray-600">Loading existing configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Configure Ticketing System</h2>
        <p className="text-sm text-gray-600">
          Set up your support ticketing system. Import standard configurations or create your own.
        </p>
      </div>

      {/* Ticket Numbering Section */}
      <div className="border rounded-lg">
        <button
          type="button"
          onClick={() => toggleSection('numbering')}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-gray-500" />
            <span className="font-medium">Ticket Numbering</span>
          </div>
          {expandedSections.numbering ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {expandedSections.numbering && (
          <div className="p-4 border-t space-y-4">
            <div className="rounded-md bg-blue-50 p-4 mb-4">
              <p className="text-sm text-blue-800">
                Configure how ticket numbers are generated. Each ticket will have a unique identifier consisting of an optional prefix and a sequential number with optional zero-padding.
              </p>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ticketPrefix">Ticket Prefix</Label>
                <Input
                  id="ticketPrefix"
                  value={data.ticketPrefix ?? ''}
                  onChange={(e) => updateData({ ticketPrefix: e.target.value })}
                  placeholder="TK-"
                />
                <p className="text-xs text-gray-500">
                  Optional. Leave empty for no prefix or enter a custom prefix (e.g., "TK-", "TICKET-")
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticketPaddingLength">Padding Length</Label>
                <Input
                  id="ticketPaddingLength"
                  type="number"
                  value={data.ticketPaddingLength ?? 6}
                  onChange={(e) => updateData({ ticketPaddingLength: parseInt(e.target.value) || 0 })}
                  min="1"
                  max="10"
                />
                <p className="text-xs text-gray-500">
                  Minimum total digits. E.g., 6 makes "1" become "000001"
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticketStartNumber">Starting Number</Label>
                <Input
                  id="ticketStartNumber"
                  type="number"
                  value={data.ticketStartNumber || 1}
                  onChange={(e) => updateData({ ticketStartNumber: parseInt(e.target.value) || 1 })}
                  min="1"
                />
              </div>
            </div>
            
            <p className="text-xs text-gray-500">
              Example: {data.ticketPrefix || ''}{String(data.ticketStartNumber || 1).padStart(data.ticketPaddingLength || 0, '0')}
            </p>
          </div>
        )}
      </div>

      {/* Boards Section */}
      <div className="border rounded-lg">
        <button
          type="button"
          onClick={() => toggleSection('boards')}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-500" />
            <span className="font-medium">Boards</span>
            {!hasBoard() && (
              <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Required</span>
            )}
          </div>
          {expandedSections.boards ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {expandedSections.boards && (
          <div className="p-4 border-t space-y-4">
            <div className="rounded-md bg-blue-50 p-4 mb-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Note:</span> Boards help organize tickets by department, team, or workflow type. When clients create tickets through the client portal, they will automatically be assigned to the board marked as default.
              </p>
              {importedBoards.length > 1 && (
                <p className="text-sm text-blue-800 mt-2">
                  <span className="font-semibold">Tip:</span> Click the star in the Default column to change which board is the default.
                </p>
              )}
            </div>

            {/* Action Buttons - Moved to top */}
            <div className="flex gap-2">
              <Button
                id="import-boards-button"
                type="button"
                variant="outline"
                onClick={() => toggleImportDialog('boards')}
                className="flex-1"
              >
                <Package className="w-4 h-4 mr-2" />
                Import from Standard
              </Button>
              <Button
                id="add-board-button"
                type="button"
                variant="outline"
                onClick={() => setShowAddForms(prev => ({ ...prev, board: !prev.board }))}
                className="flex-1"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New Board
              </Button>
            </div>

            {/* Add New Board Form - Right under buttons */}
            {showAddForms.board && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Add New Board</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="new-board-name">Board Name *</Label>
                    <Input
                      id="new-board-name"
                      value={boardForm.name}
                      onChange={(e) => setBoardForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter board name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-board-description">Description</Label>
                    <Input
                      id="new-board-description"
                      value={boardForm.description}
                      onChange={(e) => setBoardForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Enter description"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-board-order">Display Order</Label>
                    <Input
                      id="new-board-order"
                      type="number"
                      value={boardForm.displayOrder}
                      onChange={(e) => setBoardForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                      placeholder="Leave empty for auto-generate"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls the order in which boards appear in dropdown menus throughout the platform. Lower numbers appear first.
                    </p>
                  </div>
                </div>

                {/* ITIL Configuration */}
                <div className="border-t pt-4 space-y-4">
                  <h4 className="font-medium text-gray-800">Board Configuration</h4>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="board-itil-compliant">Make this board ITIL compliant</Label>
                      <button
                        type="button"
                        onClick={() => setShowItilInfoModal(true)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        title="View ITIL categories and priority matrix"
                      >
                        <HelpCircle className="w-4 h-4" />
                      </button>
                    </div>
                    <Switch
                      id="board-itil-compliant"
                      checked={boardForm.isItilCompliant}
                      onCheckedChange={(checked) => setBoardForm(prev => ({ ...prev, isItilCompliant: checked }))}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-add-board-form"
                    variant="outline"
                    onClick={() => {
                      setShowAddForms(prev => ({ ...prev, board: false }));
                      setBoardForm({ name: '', description: '', displayOrder: 0, isActive: true, isDefault: false, isItilCompliant: false });
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-add-board-form"
                    onClick={async () => {
                      if (!boardForm.name.trim()) return;
                      
                      // Check if board already exists
                      if (importedBoards.some(ch => ch.board_name === boardForm.name)) {
                        toast.error('Board already exists');
                        return;
                      }
                      
                      try {
                        // Calculate the next display order if not provided or if already in use
                        let displayOrder = boardForm.displayOrder;
                        const maxOrder = importedBoards.reduce((max, ch) => 
                          Math.max(max, ch.display_order || 0), 0
                        );
                        
                        if (!displayOrder || displayOrder === 0) {
                          displayOrder = maxOrder + 1;
                        } else {
                          // Check if the provided order is already in use
                          const isOrderInUse = importedBoards.some(ch => ch.display_order === displayOrder);
                          if (isOrderInUse) {
                            displayOrder = maxOrder + 1;
                          }
                        }
                        
                        // Set as default if this is the first board
                        const isDefault = importedBoards.length === 0;
                        
                        // Create actual board in database
                        const createdBoard = await createBoard({
                          board_name: boardForm.name,
                          description: boardForm.description || '',
                          display_order: displayOrder,
                          is_inactive: false,
                          is_default: isDefault,
                          category_type: boardForm.isItilCompliant ? 'itil' : 'custom',
                          priority_type: boardForm.isItilCompliant ? 'itil' : 'custom'
                        });
                        
                        // Add to imported boards list and sort by display_order
                        setImportedBoards(prev => {
                          const allBoards = [...prev, createdBoard].sort((a, b) => 
                            (a.display_order || 0) - (b.display_order || 0)
                          );
                          return allBoards;
                        });
                        
                        // Update wizard data if this is the first board
                        if (!data.boardId) {
                          updateData({
                            boardId: createdBoard.board_id,
                            boardName: createdBoard.board_name,
                            is_itil_compliant: boardForm.isItilCompliant
                          });
                        }
                        
                        // Reset and close
                        setBoardForm({ name: '', description: '', displayOrder: 0, isActive: true, isDefault: false, isItilCompliant: false });
                        setShowAddForms(prev => ({ ...prev, board: false }));
                        
                        // Reload available boards for category creation
                        await loadAvailableBoards();
                      } catch (error) {
                        console.error('Error creating board:', error);
                        toast.error('Failed to create board. Please try again.');
                      }
                    }}
                    disabled={!boardForm.name.trim()}
                    className="flex-1"
                  >
                    Add Board
                  </Button>
                </div>
              </div>
            )}

            {/* Import Dialog - Right under buttons */}
            {showImportDialogs.boards && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Import Standard Boards</h4>
                
                {importResults.boards && (
                  <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <p className="text-sm text-green-800">
                      Successfully imported {importResults.boards.imported} board{importResults.boards.imported !== 1 ? 's' : ''}.
                    </p>
                  </div>
                )}

                <div className="border rounded-lg overflow-hidden bg-white">
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2">
                            <Checkbox
                              id="select-all-boards-checkbox"
                              checked={availableBoards.length > 0 && 
                                availableBoards.every(c => selectedBoards.includes(c.id))}
                              onChange={() => {
                                if (availableBoards.every(c => selectedBoards.includes(c.id))) {
                                  setSelectedBoards([]);
                                } else {
                                  setSelectedBoards(availableBoards.map(c => c.id));
                                }
                              }}
                              disabled={availableBoards.length === 0}
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Name</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Default</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Order</th>
                          <th className="px-3 py-2 text-center text-sm font-medium text-gray-700">
                            <div className="flex items-center justify-center gap-1">
                              ITIL
                              <button
                                type="button"
                                onClick={() => setShowItilInfoModal(true)}
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                                title="View ITIL categories and priority matrix"
                              >
                                <HelpCircle className="w-3 h-3" />
                              </button>
                            </div>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {availableBoards.map((board, idx) => (
                          <tr key={board.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <Checkbox
                                id={`select-board-${board.id}-checkbox`}
                                checked={selectedBoards.includes(board.id)}
                                onChange={() => {
                                  if (selectedBoards.includes(board.id)) {
                                    setSelectedBoards(selectedBoards.filter(id => id !== board.id));
                                  } else {
                                    setSelectedBoards([...selectedBoards, board.id]);
                                  }
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-sm">{board.board_name}</td>
                            <td className="px-3 py-2 text-center">
                              {board.is_default && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 inline" />}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-600">{board.display_order || 0}</td>
                            <td className="px-3 py-2 text-center">
                              <Switch
                                checked={importBoardItilSettings[board.id] || false}
                                onCheckedChange={(checked) => {
                                  setImportBoardItilSettings(prev => ({
                                    ...prev,
                                    [board.id]: checked
                                  }));
                                }}
                                className="data-[state=checked]:bg-blue-500"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-import-boards"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowImportDialogs(prev => ({ ...prev, boards: false }));
                      setSelectedBoards([]);
                      setImportBoardItilSettings({});
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="confirm-import-boards"
                    type="button"
                    onClick={handleImportBoards}
                    disabled={selectedBoards.length === 0 || isImporting.boards}
                    className="flex-1"
                  >
                    {isImporting.boards ? 'Importing...' : `Import (${selectedBoards.length})`}
                  </Button>
                </div>
              </div>
            )}

            {/* Existing Boards */}
            {(importedBoards.length > 0 || data.boardName) && (
              <div>
                <Label className="mb-2 block">Current Boards</Label>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-700">Name</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Default</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Order</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">ITIL</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {importedBoards.map((board, idx) => (
                        <tr key={board.board_id}>
                          <td className="px-2 py-1 text-xs">{board.board_name}</td>
                          <td className="px-2 py-1 text-center">
                            <Button
                              id={`board-default-toggle-${idx}`}
                              data-board-id={board.board_id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDefaultBoard(board.board_id)}
                              className="p-0.5 h-5 w-5"
                              title={board.is_default ? "Default board" : "Set as default board"}
                            >
                              <Star className={`h-3.5 w-3.5 ${board.is_default ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`} />
                            </Button>
                          </td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">{board.display_order || 0}</td>
                          <td className="px-2 py-1 text-center">
                            {board.category_type === 'itil' && board.priority_type === 'itil' ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                ITIL
                              </span>
                            ) : (
                              <span className="text-gray-500 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Button
                              id={`remove-board-${board.board_id}-button`}
                              data-board-id={board.board_id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeBoard(board.board_id)}
                              className="p-1 h-6 w-6"
                              title="Remove board"
                              disabled={board.is_default}
                            >
                              <Trash2 className={`h-3 w-3 ${board.is_default ? 'text-gray-300' : 'text-gray-500 hover:text-red-600'}`} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {data.boardName && !importedBoards.some(c => c.board_name === data.boardName) && (
                        <tr>
                          <td className="px-2 py-1 text-xs">{data.boardName}</td>
                          <td className="px-2 py-1 text-center text-xs">-</td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">1</td>
                          <td className="px-2 py-1 text-center">
                            {data.is_itil_compliant ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                ITIL
                              </span>
                            ) : (
                              <span className="text-gray-500 text-xs">-</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center">-</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Categories Section */}
      <div className="border rounded-lg">
        <button
          type="button"
          onClick={() => toggleSection('categories')}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
          disabled={!hasBoard()}
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-500" />
            <span className="font-medium">Categories</span>
            {!hasBoard() && (
              <span className="text-xs text-gray-500">(requires board)</span>
            )}
          </div>
          {expandedSections.categories ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {expandedSections.categories && hasBoard() && (
          <div className="p-4 border-t space-y-4">
            <div className="rounded-md bg-blue-50 p-4 mb-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Note:</span> Categories help organize tickets by type of issue or request. You can create parent categories with subcategories for better organization. Examples include Technical Support (with subcategories like Hardware, Software, Network) or Service Requests.
              </p>
            </div>

            {/* Action Buttons - Moved to top */}
            <div className="flex gap-2">
              <Button
                id="import-categories-button"
                type="button"
                variant="outline"
                onClick={() => toggleImportDialog('categories')}
                className="flex-1"
              >
                <Package className="w-4 h-4 mr-2" />
                Import from Standard
              </Button>
              <Button
                id="add-category-button"
                type="button"
                variant="outline"
                onClick={() => setShowAddForms(prev => ({ ...prev, category: !prev.category }))}
                className="flex-1"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New Category
              </Button>
            </div>

            {/* Add New Category Form - Right under buttons */}
            {showAddForms.category && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Add New Category</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="new-category-name">Category Name *</Label>
                    <Input
                      id="new-category-name"
                      value={categoryForm.name}
                      onChange={(e) => setCategoryForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter category name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-category-board">Target Board *</Label>
                    <CustomSelect
                      id="new-category-board-select"
                      value={categoryForm.boardId}
                      onValueChange={(value) => setCategoryForm(prev => ({ ...prev, boardId: value }))}
                      options={importedBoards.map(ch => ({
                        value: ch.board_id,
                        label: ch.board_name
                      }))}
                      placeholder="Select a board"
                      className="w-full"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-category-parent">Parent Category</Label>
                    <CustomSelect
                      id="new-category-parent-select"
                      value={categoryForm.parentCategory || 'none'}
                      onValueChange={(value) => setCategoryForm(prev => ({ 
                        ...prev, 
                        parentCategory: value === 'none' ? '' : value 
                      }))}
                      options={[
                        { value: 'none', label: 'None (Top-level category)' },
                        ...data.categories
                          .filter(cat => !cat.parent_category && cat.board_id === categoryForm.boardId)
                          .map(cat => ({
                            value: cat.category_id,
                            label: cat.category_name
                          }))
                      ]}
                      placeholder="Select parent category"
                      className="w-full"
                      disabled={!categoryForm.boardId}
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-category-order">Display Order</Label>
                    <Input
                      id="new-category-order"
                      type="number"
                      value={categoryForm.displayOrder}
                      onChange={(e) => setCategoryForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                      placeholder="Leave empty for auto-generate"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls the order in which categories appear in dropdown menus throughout the platform. Lower numbers appear first.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-add-category-form"
                    variant="outline"
                    onClick={() => {
                      setShowAddForms(prev => ({ ...prev, category: false }));
                      setCategoryForm({ name: '', parentCategory: '', displayOrder: 0, boardId: '' });
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-add-category-form"
                    onClick={addCategory}
                    disabled={!categoryForm.name.trim() || !categoryForm.boardId}
                    className="flex-1"
                  >
                    Add Category
                  </Button>
                </div>
              </div>
            )}

            {/* Import Dialog - Right under buttons */}
            {showImportDialogs.categories && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Import Standard Categories</h4>
                
                {importResults.categories && (
                  <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <p className="text-sm text-green-800">
                      Successfully imported {importResults.categories.imported} categor{importResults.categories.imported !== 1 ? 'ies' : 'y'}.
                    </p>
                  </div>
                )}

                {/* Board Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Target Board *</Label>
                  <CustomSelect
                    id="import-category-target-select"
                    value={importTargetBoard}
                    onValueChange={setImportTargetBoard}
                    options={[
                      ...importedBoards.map(ch => ({
                        value: ch.board_id,
                        label: ch.board_name
                      }))
                    ]}
                    placeholder="Select a board for imported categories"
                    className="w-full"
                  />
                  <p className="text-xs text-gray-600">
                    All imported categories will be assigned to this board
                  </p>
                </div>

                <div className="border rounded-lg overflow-hidden bg-white">
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2">
                            <Checkbox
                              id="select-all-categories-checkbox"
                              checked={availableCategories.length > 0 && 
                                availableCategories.every(c => selectedCategories.includes(c.id))}
                              onChange={() => {
                                if (availableCategories.every(c => selectedCategories.includes(c.id))) {
                                  setSelectedCategories([]);
                                } else {
                                  setSelectedCategories(availableCategories.map(c => c.id));
                                }
                              }}
                              disabled={availableCategories.length === 0}
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Name</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Order</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(() => {
                          // Organize categories hierarchically: parents first, then their children
                          const parentCategories = availableCategories
                            .filter(c => !c.parent_category_uuid)
                            .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
                          const hierarchicalCategories: any[] = [];
                          
                          parentCategories.forEach(parent => {
                            hierarchicalCategories.push(parent);
                            // Add children immediately after parent, sorted by display order
                            const children = availableCategories
                              .filter(c => c.parent_category_uuid === parent.id)
                              .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
                            hierarchicalCategories.push(...children);
                          });
                          
                          return hierarchicalCategories.map((category, idx) => {
                            const isSubcategory = !!category.parent_category_uuid;
                            const parentNotSelected = isSubcategory && !selectedCategories.includes(category.parent_category_uuid);
                            
                            // For subcategories, calculate their order within the parent
                            let displayOrder;
                            if (isSubcategory) {
                              const siblingSubcategories = hierarchicalCategories
                                .filter(cat => cat.parent_category_uuid === category.parent_category_uuid);
                              displayOrder = siblingSubcategories.findIndex(cat => cat.id === category.id) + 1;
                            } else {
                              displayOrder = category.display_order || 0;
                            }
                            
                            return (
                              <tr key={category.id} className="hover:bg-gray-50">
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1">
                                    <Checkbox
                                      id={`select-category-${category.id}-checkbox`}
                                      checked={selectedCategories.includes(category.id)}
                                      onChange={() => {
                                        if (selectedCategories.includes(category.id)) {
                                          setSelectedCategories(selectedCategories.filter(id => id !== category.id));
                                        } else {
                                          // If selecting a subcategory, automatically select its parent
                                          if (isSubcategory && !selectedCategories.includes(category.parent_category_uuid)) {
                                            setSelectedCategories([...selectedCategories, category.parent_category_uuid, category.id]);
                                          } else {
                                            setSelectedCategories([...selectedCategories, category.id]);
                                          }
                                        }
                                      }}
                                    />
                                    {parentNotSelected && selectedCategories.includes(category.id) && (
                                      <div title="Parent category will be automatically selected">
                                        <AlertTriangle className="h-3 w-3 text-orange-600" />
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-sm">
                                  {isSubcategory && (
                                    <CornerDownRight className="inline-block h-3 w-3 ml-4 mr-1 text-gray-400" />
                                  )}
                                  <span className={isSubcategory ? '' : 'font-semibold'}>
                                    {category.category_name}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-sm">
                                  {isSubcategory ? (
                                    <div className="flex items-center pl-4">
                                      <CornerDownRight className="h-3 w-3 text-muted-foreground mr-1" />
                                      <span className="text-gray-500 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                        {displayOrder}
                                      </span>
                                    </div>
                                  ) : (
                                    <span className="text-gray-700 font-semibold">{displayOrder}</span>
                                  )}
                                </td>
                              </tr>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-import-categories"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowImportDialogs(prev => ({ ...prev, categories: false }));
                      setSelectedCategories([]);
                      setImportTargetBoard('');
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="confirm-import-categories"
                    type="button"
                    onClick={handleImportCategories}
                    disabled={selectedCategories.length === 0 || !importTargetBoard || isImporting.categories}
                    className="flex-1"
                  >
                    {isImporting.categories ? 'Importing...' : `Import (${selectedCategories.length})`}
                  </Button>
                </div>
              </div>
            )}

            {/* Existing Categories */}
            {data.categories.length > 0 && (
              <div>
                <Label className="mb-2 block">Current Categories ({data.categories.filter(c => typeof c === 'object' && c.category_id).length} total)</Label>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-700">Name</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Order</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {(() => {
                        // Log to help debug
                        const stringCategories = data.categories.filter(cat => typeof cat === 'string');
                        const invalidCategories = data.categories.filter(cat => typeof cat === 'object' && !cat.category_id);
                        
                        if (stringCategories.length > 0) {
                          console.warn('Found string categories:', stringCategories);
                        }
                        if (invalidCategories.length > 0) {
                          console.warn('Found categories without IDs:', invalidCategories);
                        }
                        
                        // First, filter out any string entries and deduplicate categories
                        const uniqueCategories: ITicketCategory[] = data.categories
                          .filter(cat => typeof cat === 'object' && cat !== null && cat.category_id)
                          .reduce((acc: ITicketCategory[], category) => {
                            // Check for duplicates by category_id
                            const existingIndex = acc.findIndex((c: ITicketCategory) => 
                              c.category_id === category.category_id
                            );
                            
                            if (existingIndex === -1) {
                              acc.push(category);
                            }
                            return acc;
                          }, [] as ITicketCategory[]);
                        
                        // Sort categories hierarchically: parents first, then their children
                        const sortedCategories = [...uniqueCategories].sort((a, b) => {
                          // Parent categories first
                          if (!a.parent_category && b.parent_category) return -1;
                          if (a.parent_category && !b.parent_category) return 1;
                          
                          // If both are parents or both are children, sort by display order
                          return (a.display_order || 0) - (b.display_order || 0);
                        });
                        
                        // Create a hierarchical list
                        const hierarchicalCategories: ITicketCategory[] = [];
                        const parentCategories = sortedCategories.filter(c => !c.parent_category);
                        
                        parentCategories.forEach(parent => {
                          hierarchicalCategories.push(parent);
                          // Add children of this parent
                          const children = sortedCategories.filter(c => c.parent_category === parent.category_id);
                          hierarchicalCategories.push(...children);
                        });
                        
                        return hierarchicalCategories.map((category, idx) => {
                          const isSubcategory = category.parent_category ? true : false;
                          // Find parent category name if this is a subcategory
                          const parentCategory = isSubcategory 
                            ? data.categories.find(c => c.category_id === category.parent_category)
                            : null;
                          
                          // For subcategories, calculate their order within the parent
                          let displayOrder;
                          if (isSubcategory) {
                            const siblingSubcategories = hierarchicalCategories
                              .filter(cat => cat.parent_category === category.parent_category)
                              .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
                            displayOrder = siblingSubcategories.findIndex(cat => cat.category_id === category.category_id) + 1;
                          } else {
                            displayOrder = category.display_order || 0;
                          }
                          
                          return (
                            <tr key={category.category_id}>
                              <td className="px-2 py-1 text-xs">
                                {isSubcategory && (
                                  <CornerDownRight className="inline-block h-3 w-3 ml-8 mr-1 text-gray-400" />
                                )}
                                <span className={isSubcategory ? '' : 'font-semibold'}>
                                  {category.category_name}
                                </span>
                              </td>
                              <td className="px-2 py-1 text-xs">
                                {isSubcategory ? (
                                  <div className="flex items-center justify-center">
                                    <CornerDownRight className="h-3 w-3 text-muted-foreground mr-1 ml-12" />
                                    <span className="text-gray-500 text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                                      {displayOrder}
                                    </span>
                                  </div>
                                ) : (
                                  <div className="text-center">
                                    <span className="text-gray-700 font-semibold">{displayOrder}</span>
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1 text-center">
                                <Button
                                  id={`remove-category-${category.category_id}-button`}
                                  data-category-id={category.category_id}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removeCategory(category.category_id)}
                                  className="p-1 h-6 w-6"
                                  title="Remove category"
                                >
                                  <Trash2 className="h-3 w-3 text-gray-500 hover:text-red-600" />
                                </Button>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Statuses Section */}
      <div className="border rounded-lg">
        <button
          type="button"
          onClick={() => toggleSection('statuses')}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-500" />
            <span className="font-medium">Statuses</span>
          </div>
          {expandedSections.statuses ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {expandedSections.statuses && (
          <div className="p-4 border-t space-y-4">
            <div className="rounded-md bg-blue-50 p-4 mb-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Note:</span> Statuses track the lifecycle of a ticket. Each status is either <span className="font-semibold">Open</span> (ticket needs attention) or <span className="font-semibold">Closed</span> (ticket is resolved). The <span className="font-semibold">Default</span> status is automatically assigned to new tickets. Common statuses include New, In Progress, Waiting for Customer, Resolved, and Closed.
              </p>
              {importedStatuses.length > 1 && (
                <p className="text-sm text-blue-800 mt-2">
                  <span className="font-semibold">Tip:</span> Click the star in the Default column to change which status is the default. Only open statuses can be set as default.
                </p>
              )}
            </div>

            {/* Action Buttons - Moved to top */}
            <div className="flex gap-2">
              <Button
                id="import-statuses-button"
                type="button"
                variant="outline"
                onClick={() => toggleImportDialog('statuses')}
                className="flex-1"
              >
                <Package className="w-4 h-4 mr-2" />
                Import from Standard
              </Button>
              <Button
                id="add-status-button"
                type="button"
                variant="outline"
                onClick={() => setShowAddForms(prev => ({ ...prev, status: !prev.status }))}
                className="flex-1"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New Status
              </Button>
            </div>

            {/* Add New Status Form - Right under buttons */}
            {showAddForms.status && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Add New Status</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="new-status-name">Status Name *</Label>
                    <Input
                      id="new-status-name"
                      value={statusForm.name}
                      onChange={(e) => setStatusForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter status name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-status-order">Display Order</Label>
                    <Input
                      id="new-status-order"
                      type="number"
                      value={statusForm.displayOrder}
                      onChange={(e) => setStatusForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                      placeholder="Leave empty for auto-generate"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls the order in which statuses appear in dropdown menus throughout the platform. Lower numbers appear first.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="status-closed-toggle"
                        checked={statusForm.isClosed}
                        onCheckedChange={(checked) => setStatusForm(prev => ({ ...prev, isClosed: checked }))}
                      />
                      <Label>{statusForm.isClosed ? 'Closed Status' : 'Open Status'}</Label>
                    </div>
                    <p className="text-xs text-gray-600 mt-2">
                      {statusForm.isClosed 
                        ? "This status indicates the ticket is resolved and closed"
                        : "This status indicates the ticket is still open and needs attention"}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-add-status-form"
                    variant="outline"
                    onClick={() => {
                      setShowAddForms(prev => ({ ...prev, status: false }));
                      setStatusForm({ name: '', isClosed: false, isDefault: false, displayOrder: 0 });
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-add-status-form"
                    onClick={async () => {
                      if (!statusForm.name.trim()) return;
                      
                      // Check if status already exists
                      if (importedStatuses.some(s => s.name === statusForm.name)) {
                        toast.error('Status already exists');
                        return;
                      }
                      
                      try {
                        // Calculate the next order number if not provided or if already in use
                        let orderNumber = statusForm.displayOrder;
                        const maxOrder = importedStatuses.reduce((max, status) => 
                          Math.max(max, status.order_number || 0), 0
                        );
                        
                        if (!orderNumber || orderNumber === 0) {
                          orderNumber = maxOrder + 1;
                        } else {
                          // Check if the provided order is already in use
                          const isOrderInUse = importedStatuses.some(s => s.order_number === orderNumber);
                          if (isOrderInUse) {
                            orderNumber = maxOrder + 1;
                          }
                        }
                        
                        // Set as default if this is the first open status
                        const hasDefaultOpenStatus = importedStatuses.some(s => s.is_default && !s.is_closed);
                        const isDefault = !statusForm.isClosed && !hasDefaultOpenStatus;
                        
                        // Create actual status in database
                        const createdStatus = await createStatus({
                          name: statusForm.name,
                          is_closed: statusForm.isClosed,
                          is_default: isDefault,
                          status_type: 'ticket',
                          order_number: orderNumber
                        });
                        
                        // Add to imported statuses list, sorted by order_number
                        setImportedStatuses(prev => {
                          const allImported = [...prev, createdStatus].sort((a, b) => 
                            (a.order_number || 0) - (b.order_number || 0)
                          );
                          return allImported;
                        });
                        
                        // Track all statuses in form data, sorted by order_number
                        const allStatuses = [...importedStatuses, createdStatus].sort((a, b) => 
                          (a.order_number || 0) - (b.order_number || 0)
                        );
                        updateData({ statuses: allStatuses });
                        
                        // Reset and close
                        setStatusForm({ name: '', isClosed: false, isDefault: false, displayOrder: 0 });
                        setShowAddForms(prev => ({ ...prev, status: false }));
                      } catch (error) {
                        console.error('Error creating status:', error);
                        toast.error('Failed to create status. Please try again.');
                      }
                    }}
                    disabled={!statusForm.name.trim()}
                    className="flex-1"
                  >
                    Add Status
                  </Button>
                </div>
              </div>
            )}

            {/* Import Dialog - Right under buttons */}
            {showImportDialogs.statuses && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Import Standard Statuses</h4>
                
                {importResults.statuses && (
                  <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <p className="text-sm text-green-800">
                      Successfully imported {importResults.statuses.imported} status{importResults.statuses.imported !== 1 ? 'es' : ''}.
                    </p>
                  </div>
                )}

                <div className="border rounded-lg overflow-hidden bg-white">
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2">
                            <Checkbox
                              id="select-all-statuses-checkbox"
                              checked={availableStatuses.length > 0 && 
                                availableStatuses.every(s => selectedStatuses.includes(s.standard_status_id))}
                              onChange={() => {
                                if (availableStatuses.every(s => selectedStatuses.includes(s.standard_status_id))) {
                                  setSelectedStatuses([]);
                                } else {
                                  setSelectedStatuses(availableStatuses.map(s => s.standard_status_id));
                                }
                              }}
                              disabled={availableStatuses.length === 0}
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Name</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Type</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Default</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Order</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {availableStatuses.map((status, idx) => (
                          <tr key={status.standard_status_id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <Checkbox
                                id={`select-status-${status.standard_status_id}-checkbox`}
                                checked={selectedStatuses.includes(status.standard_status_id)}
                                onChange={() => {
                                  if (selectedStatuses.includes(status.standard_status_id)) {
                                    setSelectedStatuses(selectedStatuses.filter(id => id !== status.standard_status_id));
                                  } else {
                                    setSelectedStatuses([...selectedStatuses, status.standard_status_id]);
                                  }
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-sm">{status.name}</td>
                            <td className="px-3 py-2 text-sm text-gray-600">
                              {status.is_closed ? 'Closed' : 'Open'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              {status.is_default && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 inline" />}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-600">{status.display_order || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-import-statuses"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowImportDialogs(prev => ({ ...prev, statuses: false }));
                      setSelectedStatuses([]);
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="confirm-import-statuses"
                    type="button"
                    onClick={handleImportStatuses}
                    disabled={selectedStatuses.length === 0 || isImporting.statuses}
                    className="flex-1"
                  >
                    {isImporting.statuses ? 'Importing...' : `Import (${selectedStatuses.length})`}
                  </Button>
                </div>
              </div>
            )}

            {/* Existing Statuses */}
            {importedStatuses.length > 0 && (
              <div>
                <Label className="mb-2 block">Current Statuses</Label>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-700">Name</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Type</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Default</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Order</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {importedStatuses.map((status, idx) => (
                        <tr key={status.status_id}>
                          <td className="px-2 py-1 text-xs">{status.name}</td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">
                            {status.is_closed ? 'Closed' : 'Open'}
                          </td>
                          <td className="px-2 py-1 text-center">
                            <Button
                              id={`status-default-toggle-${idx}`}
                              data-status-id={status.status_id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDefaultStatus(status.status_id)}
                              className="p-0.5 h-5 w-5"
                              title={status.is_default ? "Default status" : "Set as default status"}
                              disabled={status.is_closed}
                            >
                              <Star className={`h-3.5 w-3.5 ${status.is_default ? 'text-yellow-500 fill-yellow-500' : status.is_closed ? 'text-gray-300' : 'text-gray-400 hover:text-yellow-500'}`} />
                            </Button>
                          </td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">{status.order_number || 0}</td>
                          <td className="px-2 py-1 text-center">
                            <Button
                              id={`remove-status-${status.status_id}-button`}
                              data-status-id={status.status_id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeStatus(status.status_id)}
                              className="p-1 h-6 w-6"
                              title="Remove status"
                              disabled={status.is_default}
                            >
                              <Trash2 className={`h-3 w-3 ${status.is_default ? 'text-gray-300' : 'text-gray-500 hover:text-red-600'}`} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Priorities Section */}
      <div className="border rounded-lg">
        <button
          type="button"
          onClick={() => toggleSection('priorities')}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-500" />
            <span className="font-medium">Priorities</span>
            {data.priorities.length === 0 && (
              <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Required</span>
            )}
          </div>
          {expandedSections.priorities ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {expandedSections.priorities && (
          <div className="p-4 border-t space-y-4">
            <div className="rounded-md bg-blue-50 p-4 mb-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Note:</span> Priorities help determine the urgency of tickets and service level agreements (SLAs). Each priority has a color for quick visual identification. Typical priorities include Critical (red), High (orange), Medium (blue), and Low (green).
              </p>
            </div>

            {/* Action Buttons - Moved to top */}
            <div className="flex gap-2">
              <Button
                id="import-priorities-button"
                type="button"
                variant="outline"
                onClick={() => toggleImportDialog('priorities')}
                className="flex-1"
              >
                <Package className="w-4 h-4 mr-2" />
                Import from Standard
              </Button>
              <Button
                id="add-priority-button"
                type="button"
                variant="outline"
                onClick={() => setShowAddForms(prev => ({ ...prev, priority: !prev.priority }))}
                className="flex-1"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New Priority
              </Button>
            </div>

            {/* Add New Priority Form - Right under buttons */}
            {showAddForms.priority && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Add New Priority</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="new-priority-name">Priority Name *</Label>
                    <Input
                      id="new-priority-name"
                      value={priorityForm.name}
                      onChange={(e) => setPriorityForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter priority name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-priority-order">Display Order</Label>
                    <Input
                      id="new-priority-order"
                      type="number"
                      value={priorityForm.displayOrder}
                      onChange={(e) => setPriorityForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                      placeholder="Leave empty for auto-generate"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls the order in which priorities appear in dropdown menus throughout the platform. Lower numbers appear first.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <Label>Priority Color</Label>
                    <div className="flex items-center gap-2 mt-2">
                      <div 
                        className="w-10 h-10 rounded border border-gray-300" 
                        style={{ backgroundColor: priorityForm.color }}
                      />
                      <ColorPicker
                        currentBackgroundColor={priorityForm.color}
                        currentTextColor="#FFFFFF"
                        onSave={(backgroundColor) => {
                          if (backgroundColor) {
                            setPriorityForm(prev => ({ ...prev, color: backgroundColor }));
                          }
                        }}
                        showTextColor={false}
                        previewType="circle"
                        colorMode="tag"
                        trigger={
                          <Button
                            id="priority-color-picker-btn"
                            type="button"
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-2">
                            <Palette className="h-4 w-4" />
                            <span>Choose Color</span>
                          </Button>
                        }
                      />
                      <span className="text-sm text-gray-600">{priorityForm.color}</span>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-add-priority-form"
                    variant="outline"
                    onClick={() => {
                      setShowAddForms(prev => ({ ...prev, priority: false }));
                      setPriorityForm({ name: '', color: '#3b82f6', displayOrder: 0 });
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-add-priority-form"
                    onClick={addPriority}
                    disabled={!priorityForm.name.trim()}
                    className="flex-1"
                  >
                    Add Priority
                  </Button>
                </div>
              </div>
            )}

            {/* Import Dialog - Right under buttons */}
            {showImportDialogs.priorities && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Import Standard Priorities</h4>
                
                {importResults.priorities && (
                  <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <p className="text-sm text-green-800">
                      Successfully imported {importResults.priorities.imported} priorit{importResults.priorities.imported !== 1 ? 'ies' : 'y'}.
                    </p>
                  </div>
                )}

                <div className="border rounded-lg overflow-hidden bg-white">
                  <div className="max-h-48 overflow-y-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b sticky top-0">
                        <tr>
                          <th className="px-3 py-2">
                            <Checkbox
                              id="select-all-priorities-checkbox"
                              checked={availablePriorities.length > 0 && 
                                availablePriorities.every(p => selectedPriorities.includes(p.priority_id))}
                              onChange={() => {
                                if (availablePriorities.every(p => selectedPriorities.includes(p.priority_id))) {
                                  setSelectedPriorities([]);
                                } else {
                                  setSelectedPriorities(availablePriorities.map(p => p.priority_id));
                                }
                              }}
                              disabled={availablePriorities.length === 0}
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Name</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Color</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Order</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {availablePriorities.map((priority, idx) => (
                          <tr key={priority.priority_id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <Checkbox
                                id={`select-priority-${priority.priority_id}-checkbox`}
                                checked={selectedPriorities.includes(priority.priority_id)}
                                onChange={() => {
                                  if (selectedPriorities.includes(priority.priority_id)) {
                                    setSelectedPriorities(selectedPriorities.filter(id => id !== priority.priority_id));
                                  } else {
                                    setSelectedPriorities([...selectedPriorities, priority.priority_id]);
                                  }
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-sm">{priority.priority_name}</td>
                            <td className="px-3 py-2">
                              <div 
                                className="w-4 h-4 rounded" 
                                style={{ backgroundColor: priority.color }}
                              />
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-600">{priority.order_number || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-import-priorities"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowImportDialogs(prev => ({ ...prev, priorities: false }));
                      setSelectedPriorities([]);
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="confirm-import-priorities"
                    type="button"
                    onClick={handleImportPriorities}
                    disabled={selectedPriorities.length === 0 || isImporting.priorities}
                    className="flex-1"
                  >
                    {isImporting.priorities ? 'Importing...' : `Import (${selectedPriorities.length})`}
                  </Button>
                </div>
              </div>
            )}

            {/* Existing Priorities */}
            {data.priorities.length > 0 && (
              <div>
                <Label className="mb-2 block">Current Priorities</Label>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-700">Name</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Color</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Order</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {data.priorities.map((priority, index) => {
                        // Handle both string and object formats
                        const priorityName = typeof priority === 'string' ? priority : priority.priority_name;
                        const priorityObj = typeof priority === 'object' ? priority : 
                          importedPriorities.find(p => p.priority_name === priority);
                        
                        // Use priority color if available, otherwise use defaults
                        const defaultColors: Record<string, string> = {
                          'Critical': '#dc2626',
                          'High': '#f59e0b',
                          'Medium': '#3b82f6',
                          'Low': '#10b981',
                          'Urgent': '#dc2626',
                          'Normal': '#6b7280'
                        };
                        const color = priorityObj?.color || defaultColors[priorityName] || '#6b7280';
                        const priorityId = priorityObj?.priority_id;
                        
                        return (
                          <tr key={priorityName}>
                            <td className="px-2 py-1 text-xs">
                              {priorityName}
                            </td>
                            <td className="px-2 py-1 text-center">
                              <div 
                                className="w-3 h-3 rounded-full mx-auto" 
                                style={{ backgroundColor: color }}
                              />
                            </td>
                            <td className="px-2 py-1 text-center text-xs text-gray-600">
                              {priorityObj?.order_number || index + 1}
                            </td>
                            <td className="px-2 py-1 text-center">
                              {priorityId ? (
                                <Button
                                  id={`remove-priority-${priorityId}-button`}
                                  data-priority-id={priorityId}
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => removePriority(priorityId)}
                                  className="p-1 h-6 w-6"
                                  title="Remove priority"
                                >
                                  <Trash2 className="h-3 w-3 text-gray-500 hover:text-red-600" />
                                </Button>
                              ) : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      {/* Support Email Field */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <div className="space-y-2">
          <Label htmlFor="supportEmail">Support Email</Label>
          <Input
            id="supportEmail"
            type="email"
            value={data.supportEmail}
            onChange={(e) => updateData({ supportEmail: e.target.value })}
            placeholder="support@yourclient.com"
          />
          <p className="text-xs text-gray-600">
            This email address will be used to create support tickets. Emails sent to this address will automatically generate tickets in your system.
          </p>
        </div>
      </div>

      <div className="rounded-md bg-blue-50 p-4">
        <p className="text-sm text-blue-800">
          <span className="font-semibold">Required:</span> Please configure at least one board and one priority to complete setup.
          Import standard configurations to quickly set up your ticketing system.
        </p>
      </div>

      {/* ITIL Information Modal */}
      <Dialog
        isOpen={showItilInfoModal}
        onClose={() => setShowItilInfoModal(false)}
        title="ITIL Standards Reference"
      >
        <DialogContent className="max-w-4xl">
          <div className="space-y-6">
            {/* ITIL Categories Section */}
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">ITIL Standard Categories and Subcategories</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Hardware */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Hardware</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Server</li>
                    <li>• Desktop/Laptop</li>
                    <li>• Network Equipment</li>
                    <li>• Printer</li>
                    <li>• Storage</li>
                    <li>• Mobile Device</li>
                  </ul>
                </div>

                {/* Software */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Software</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Operating System</li>
                    <li>• Business Application</li>
                    <li>• Database</li>
                    <li>• Email/Collaboration</li>
                    <li>• Security Software</li>
                    <li>• Custom Application</li>
                  </ul>
                </div>

                {/* Network */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Network</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Connectivity</li>
                    <li>• VPN</li>
                    <li>• Wi-Fi</li>
                    <li>• Internet Access</li>
                    <li>• LAN/WAN</li>
                    <li>• Firewall</li>
                  </ul>
                </div>

                {/* Security */}
                <div className="border rounded-lg p-4">
                  <h4 className="font-medium text-blue-800 mb-2">Security</h4>
                  <ul className="text-sm text-gray-600 space-y-1">
                    <li>• Malware/Virus</li>
                    <li>• Unauthorized Access</li>
                    <li>• Data Breach</li>
                    <li>• Phishing/Spam</li>
                    <li>• Policy Violation</li>
                    <li>• Account Lockout</li>
                  </ul>
                </div>

                {/* Service Request */}
                <div className="border rounded-lg p-4 md:col-span-2">
                  <h4 className="font-medium text-blue-800 mb-2">Service Request</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Access Request</li>
                      <li>• New User Setup</li>
                      <li>• Software Installation</li>
                    </ul>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>• Equipment Request</li>
                      <li>• Information Request</li>
                      <li>• Change Request</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* ITIL Priority Matrix Section */}
            <div>
              <h3 className="text-lg font-semibold text-gray-800 mb-4">ITIL Priority Matrix (Impact × Urgency)</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border border-gray-200">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-gray-600 border-b border-r bg-gray-50"></th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-50">High<br/>Urgency (1)</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-50">Medium-High<br/>Urgency (2)</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-50">Medium<br/>Urgency (3)</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-50">Medium-Low<br/>Urgency (4)</th>
                      <th className="px-3 py-2 text-center text-gray-600 border-b bg-gray-50">Low<br/>Urgency (5)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-50">High Impact (1)</td>
                      <td className="px-3 py-2 text-center bg-red-100 text-red-800 font-semibold border">Critical (1)</td>
                      <td className="px-3 py-2 text-center bg-orange-100 text-orange-800 font-semibold border">High (2)</td>
                      <td className="px-3 py-2 text-center bg-orange-100 text-orange-800 font-semibold border">High (2)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-50">Medium-High Impact (2)</td>
                      <td className="px-3 py-2 text-center bg-orange-100 text-orange-800 font-semibold border">High (2)</td>
                      <td className="px-3 py-2 text-center bg-orange-100 text-orange-800 font-semibold border">High (2)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-blue-100 text-blue-800 font-semibold border">Low (4)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-50">Medium Impact (3)</td>
                      <td className="px-3 py-2 text-center bg-orange-100 text-orange-800 font-semibold border">High (2)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-blue-100 text-blue-800 font-semibold border">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-blue-100 text-blue-800 font-semibold border">Low (4)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-50">Medium-Low Impact (4)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-blue-100 text-blue-800 font-semibold border">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-blue-100 text-blue-800 font-semibold border">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-gray-100 text-gray-800 font-semibold border">Planning (5)</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-gray-600 border-r font-medium bg-gray-50">Low Impact (5)</td>
                      <td className="px-3 py-2 text-center bg-yellow-100 text-yellow-800 font-semibold border">Medium (3)</td>
                      <td className="px-3 py-2 text-center bg-blue-100 text-blue-800 font-semibold border">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-blue-100 text-blue-800 font-semibold border">Low (4)</td>
                      <td className="px-3 py-2 text-center bg-gray-100 text-gray-800 font-semibold border">Planning (5)</td>
                      <td className="px-3 py-2 text-center bg-gray-100 text-gray-800 font-semibold border">Planning (5)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 text-sm text-gray-600 space-y-1">
                <p><strong>Impact:</strong> How many users/business functions are affected?</p>
                <p><strong>Urgency:</strong> How quickly does this need to be resolved?</p>
                <p><strong>Priority:</strong> Automatically calculated based on Impact × Urgency matrix above.</p>
              </div>
            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button id="close-itil-info" onClick={() => setShowItilInfoModal(false)}>
            Close
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
