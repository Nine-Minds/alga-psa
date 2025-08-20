'use client';

import React, { useState, useEffect } from 'react';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { Button } from 'server/src/components/ui/Button';
import { Plus, Package, ChevronDown, ChevronUp, CheckCircle, Settings, Palette, Trash2, Star } from 'lucide-react';
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
import { createChannel, updateChannel } from 'server/src/lib/actions/channel-actions/channelActions';
import { createCategory } from 'server/src/lib/actions/ticketCategoryActions';
import { createStatus } from 'server/src/lib/actions/status-actions/statusActions';
import { createPriority } from 'server/src/lib/actions/priorityActions';
import toast from 'react-hot-toast';

interface SectionState {
  numbering: boolean;
  channels: boolean;
  categories: boolean;
  statuses: boolean;
  priorities: boolean;
}

interface ImportSectionState {
  channels: boolean;
  categories: boolean;
  statuses: boolean;
  priorities: boolean;
}

interface AddFormState {
  channel: boolean;
  category: boolean;
  status: boolean;
  priority: boolean;
}

interface ChannelFormData {
  name: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
  isDefault: boolean;
}

interface CategoryFormData {
  name: string;
  parentCategory: string;
  displayOrder: number;
  channelId: string;
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
    channels: false,
    categories: false,
    statuses: false,
    priorities: false
  });

  const [showImportDialogs, setShowImportDialogs] = useState<ImportSectionState>({
    channels: false,
    categories: false,
    statuses: false,
    priorities: false
  });

  const [showAddForms, setShowAddForms] = useState<AddFormState>({
    channel: false,
    category: false,
    status: false,
    priority: false
  });

  // Form data for adding new items
  const [channelForm, setChannelForm] = useState<ChannelFormData>({ 
    name: '', 
    description: '', 
    displayOrder: 0, 
    isActive: true, 
    isDefault: false 
  });
  const [categoryForm, setCategoryForm] = useState<CategoryFormData>({ 
    name: '', 
    parentCategory: '', 
    displayOrder: 0,
    channelId: '' 
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
  const [availableChannels, setAvailableChannels] = useState<any[]>([]);
  const [availableCategories, setAvailableCategories] = useState<any[]>([]);
  const [availableStatuses, setAvailableStatuses] = useState<IStandardStatus[]>([]);
  const [availablePriorities, setAvailablePriorities] = useState<IStandardPriority[]>([]);

  // Selected items for import
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedPriorities, setSelectedPriorities] = useState<string[]>([]);
  
  // Channel selection for categories import
  const [importTargetChannel, setImportTargetChannel] = useState<string>('');

  // Import results
  const [importResults, setImportResults] = useState<Record<string, { imported: number; skipped: number }>>({});

  // Loading states
  const [isImporting, setIsImporting] = useState<Record<string, boolean>>({
    channels: false,
    categories: false,
    statuses: false,
    priorities: false
  });

  // Imported items tracking
  const [importedChannels, setImportedChannels] = useState<any[]>([]);
  const [importedStatuses, setImportedStatuses] = useState<any[]>([]);
  const [importedCategories, setImportedCategories] = useState<string[]>([]);
  const [importedPriorities, setImportedPriorities] = useState<any[]>([]);

  // Function to load existing ticketing data
  const loadExistingData = async () => {
    try {
      const result = await getTenantTicketingData();
        
        if (result.success && result.data) {
          // Set imported items from existing data
          setImportedChannels(result.data.channels);
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
          
          // If there's a default channel and no channel is set, use it
          if (!data.channelId && result.data.channels.length > 0) {
            const defaultChannel = result.data.channels.find(ch => ch.is_default);
            if (defaultChannel) {
              updateData({ 
                channelId: defaultChannel.channel_id,
                channelName: defaultChannel.channel_name 
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
    if (showImportDialogs.channels && availableChannels.length === 0) {
      loadAvailableChannels();
    }
  }, [showImportDialogs.channels]);

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

  const loadAvailableChannels = async () => {
    try {
      const channels = await getAvailableReferenceData('channels');
      setAvailableChannels(channels);
    } catch (error) {
      console.error('Error loading available boards:', error);
    }
  };

  const loadAvailableCategories = async () => {
    try {
      // For categories, we need a channel first
      if (data.channelId || importedChannels.length > 0) {
        const channelId = data.channelId || importedChannels[0]?.channel_id;
        const categories = await getAvailableReferenceData('categories', { channel_id: channelId });
        
        // Sort categories to ensure parents come before children
        const sortedCategories = categories.sort((a, b) => {
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

  const handleImportChannels = async () => {
    if (selectedChannels.length === 0) return;
    
    setIsImporting(prev => ({ ...prev, channels: true }));
    try {
      const result = await importReferenceData('channels', selectedChannels);
      setImportResults(prev => ({ ...prev, channels: { 
        imported: result.imported?.length || 0, 
        skipped: result.skipped?.length || 0 
      }}));
      
      // Track imported channels
      if (result.imported?.length > 0) {
        setImportedChannels(prev => [...prev, ...result.imported]);
        
        // If we don't have a channel set yet, use the first imported
        if (!data.channelId) {
          updateData({ 
            channelId: result.imported[0].channel_id,
            channelName: result.imported[0].channel_name
          });
        }
      }
      
      setSelectedChannels([]);
      setShowImportDialogs(prev => ({ ...prev, channels: false }));
      await loadAvailableChannels();
    } catch (error) {
      console.error('Error importing boards:', error);
    } finally {
      setIsImporting(prev => ({ ...prev, channels: false }));
    }
  };

  const handleImportCategories = async () => {
    if (selectedCategories.length === 0 || !importTargetChannel) return;
    
    setIsImporting(prev => ({ ...prev, categories: true }));
    try {
      const result = await importReferenceData('categories', selectedCategories, { channel_id: importTargetChannel });
      setImportResults(prev => ({ ...prev, categories: { 
        imported: result.imported?.length || 0, 
        skipped: result.skipped?.length || 0 
      }}));
      
      // Track imported categories
      if (result.imported?.length > 0) {
        // Store full category objects to preserve parent-child relationships
        const importedCategoryObjects = result.imported;
        setImportedCategories(prev => [...new Set([...prev, ...importedCategoryObjects.map(cat => cat.category_name)])]);
        
        // Update data with full category objects, not just names
        const existingCategoryIds = data.categories.map(cat => cat.category_id);
        const newCategories = importedCategoryObjects.filter(cat => !existingCategoryIds.includes(cat.category_id));
        updateData({ 
          categories: [...data.categories, ...newCategories]
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
        setImportedStatuses(prev => [...prev, ...result.imported]);
        updateData({ 
          statusesImported: true,
          statuses: [...(data.statuses || []), ...result.imported]
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
        setImportedPriorities(prev => [...prev, ...result.imported]);
        // Pass full priority objects, not just names
        updateData({ 
          priorities: [...data.priorities, ...result.imported]
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
    if (!categoryForm.name.trim() || !categoryForm.channelId) return;
    
    // Check if category already exists
    if (data.categories.some(cat => cat.category_name === categoryForm.name && cat.channel_id === categoryForm.channelId)) {
      toast.error('Category already exists in this board');
      return;
    }
    
    try {
      // Calculate display order if not provided or if already in use
      let displayOrder = categoryForm.displayOrder;
      const channelCategories = data.categories.filter(c => c.channel_id === categoryForm.channelId);
      
      let relevantCategories;
      if (categoryForm.parentCategory) {
        // For subcategories, consider siblings under the same parent
        relevantCategories = channelCategories.filter(c => c.parent_category === categoryForm.parentCategory);
      } else {
        // For parent categories in this channel
        relevantCategories = channelCategories.filter(c => !c.parent_category);
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
        channel_id: categoryForm.channelId,
        parent_category: categoryForm.parentCategory || undefined,
        display_order: displayOrder
      });
      
      // Update wizard data with the created category
      updateData({ categories: [...data.categories, createdCategory] });
      setImportedCategories(prev => [...prev, createdCategory.category_name]);
      
      // Reset form and close dialog
      setCategoryForm({ name: '', parentCategory: '', displayOrder: 0, channelId: '' });
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
      const allPriorities = [...importedPriorities, ...data.priorities.filter(p => typeof p === 'object')];
      const maxOrder = allPriorities.reduce((max, priority) => 
        Math.max(max, priority.order_number || 0), 0
      );
      
      if (!orderNumber || orderNumber === 0) {
        orderNumber = maxOrder + 1;
      } else {
        // Check if the provided order is already in use
        const isOrderInUse = allPriorities.some(p => p.order_number === orderNumber);
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
        created_by: userId,
        created_at: new Date()
      });
      
      // Add full priority object to data
      updateData({ priorities: [...data.priorities, createdPriority] });
      
      // Also track for display
      setImportedPriorities(prev => [...prev, createdPriority]);
      
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

  const hasChannel = () => {
    return !!(data.channelId || data.channelName || importedChannels.length > 0);
  };

  // Remove functions for each type
  const removeChannel = async (channelId: string) => {
    try {
      const result = await deleteReferenceDataItem('channels', channelId);
      if (result.success) {
        // Remove from imported channels
        setImportedChannels(prev => prev.filter(ch => ch.channel_id !== channelId));
        
        // If this was the selected channel, clear it
        if (data.channelId === channelId) {
          updateData({ channelId: undefined, channelName: '' });
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

  const setDefaultChannel = async (channelId: string) => {
    try {
      const channel = importedChannels.find(ch => ch.channel_id === channelId);
      if (!channel) return;
      
      // Don't allow removing default status - at least one board must be default
      if (channel.is_default) {
        toast('At least one board must be set as default', {
          icon: 'ℹ️',
          duration: 3000
        });
        return;
      }
      
      // Set this channel as default (this will automatically unset others)
      await updateChannel(channel.channel_id, { is_default: true });
      
      // Refresh data from server to get updated default states
      await loadExistingData();
      
      // Update the selected channel in wizard data if no channel is selected
      if (!data.channelId) {
        updateData({ 
          channelId: channel.channel_id,
          channelName: channel.channel_name 
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
        toast('At least one status must be set as default', {
          icon: 'ℹ️',
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
                Configure how ticket numbers are generated. Each ticket will have a unique identifier consisting of a prefix and a sequential number with zero-padding.
              </p>
            </div>
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ticketPrefix">Ticket Prefix</Label>
                <Input
                  id="ticketPrefix"
                  value={data.ticketPrefix || 'TK-'}
                  onChange={(e) => updateData({ ticketPrefix: e.target.value })}
                  placeholder="TK-"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ticketPaddingLength">Padding Length</Label>
                <Input
                  id="ticketPaddingLength"
                  type="number"
                  value={data.ticketPaddingLength || 6}
                  onChange={(e) => updateData({ ticketPaddingLength: parseInt(e.target.value) || 6 })}
                  min="1"
                  max="10"
                />
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
              Example: {data.ticketPrefix || 'TK-'}{String(data.ticketStartNumber || 1).padStart(data.ticketPaddingLength || 6, '0')}
            </p>
          </div>
        )}
      </div>

      {/* Channels Section */}
      <div className="border rounded-lg">
        <button
          type="button"
          onClick={() => toggleSection('channels')}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-500" />
            <span className="font-medium">Boards</span>
            {!hasChannel() && (
              <span className="text-xs bg-red-100 text-red-800 px-2 py-1 rounded">Required</span>
            )}
          </div>
          {expandedSections.channels ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {expandedSections.channels && (
          <div className="p-4 border-t space-y-4">
            <div className="rounded-md bg-blue-50 p-4 mb-4">
              <p className="text-sm text-blue-800">
                <span className="font-semibold">Note:</span> Boards help organize tickets by department, team, or workflow type. When clients create tickets through the client portal, they will automatically be assigned to the board marked as default.
              </p>
              {importedChannels.length > 1 && (
                <p className="text-sm text-blue-800 mt-2">
                  <span className="font-semibold">Tip:</span> Click the star in the Default column to change which board is the default.
                </p>
              )}
            </div>

            {/* Action Buttons - Moved to top */}
            <div className="flex gap-2">
              <Button
                id="import-channels-button"
                type="button"
                variant="outline"
                onClick={() => toggleImportDialog('channels')}
                className="flex-1"
              >
                <Package className="w-4 h-4 mr-2" />
                Import from Standard
              </Button>
              <Button
                id="add-channel-button"
                type="button"
                variant="outline"
                onClick={() => setShowAddForms(prev => ({ ...prev, channel: !prev.channel }))}
                className="flex-1"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add New Board
              </Button>
            </div>

            {/* Add New Channel Form - Right under buttons */}
            {showAddForms.channel && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Add New Board</h4>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="new-channel-name">Board Name *</Label>
                    <Input
                      id="new-channel-name"
                      value={channelForm.name}
                      onChange={(e) => setChannelForm(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Enter board name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-channel-description">Description</Label>
                    <Input
                      id="new-channel-description"
                      value={channelForm.description}
                      onChange={(e) => setChannelForm(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Enter description"
                    />
                  </div>
                  <div>
                    <Label htmlFor="new-channel-order">Display Order</Label>
                    <Input
                      id="new-channel-order"
                      type="number"
                      value={channelForm.displayOrder}
                      onChange={(e) => setChannelForm(prev => ({ ...prev, displayOrder: parseInt(e.target.value) || 0 }))}
                      placeholder="Leave empty for auto-generate"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Controls the order in which boards appear in dropdown menus throughout the platform. Lower numbers appear first.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-add-channel-form"
                    variant="outline"
                    onClick={() => {
                      setShowAddForms(prev => ({ ...prev, channel: false }));
                      setChannelForm({ name: '', description: '', displayOrder: 0, isActive: true, isDefault: false });
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-add-channel-form"
                    onClick={async () => {
                      if (!channelForm.name.trim()) return;
                      
                      // Check if channel already exists
                      if (importedChannels.some(ch => ch.channel_name === channelForm.name)) {
                        toast.error('Board already exists');
                        return;
                      }
                      
                      try {
                        // Calculate the next display order if not provided or if already in use
                        let displayOrder = channelForm.displayOrder;
                        const maxOrder = importedChannels.reduce((max, ch) => 
                          Math.max(max, ch.display_order || 0), 0
                        );
                        
                        if (!displayOrder || displayOrder === 0) {
                          displayOrder = maxOrder + 1;
                        } else {
                          // Check if the provided order is already in use
                          const isOrderInUse = importedChannels.some(ch => ch.display_order === displayOrder);
                          if (isOrderInUse) {
                            displayOrder = maxOrder + 1;
                          }
                        }
                        
                        // Set as default if this is the first board
                        const isDefault = importedChannels.length === 0;
                        
                        // Create actual channel in database
                        const createdChannel = await createChannel({
                          channel_name: channelForm.name,
                          description: channelForm.description || '',
                          display_order: displayOrder,
                          is_inactive: false,
                          is_default: isDefault
                        });
                        
                        // Add to imported channels list
                        setImportedChannels(prev => [...prev, createdChannel]);
                        
                        // Update wizard data if this is the first channel
                        if (!data.channelId) {
                          updateData({ 
                            channelId: createdChannel.channel_id,
                            channelName: createdChannel.channel_name
                          });
                        }
                        
                        // Reset and close
                        setChannelForm({ name: '', description: '', displayOrder: 0, isActive: true, isDefault: false });
                        setShowAddForms(prev => ({ ...prev, channel: false }));
                        
                        // Reload available channels for category creation
                        await loadAvailableChannels();
                      } catch (error) {
                        console.error('Error creating channel:', error);
                        toast.error('Failed to create board. Please try again.');
                      }
                    }}
                    disabled={!channelForm.name.trim()}
                    className="flex-1"
                  >
                    Add Board
                  </Button>
                </div>
              </div>
            )}

            {/* Import Dialog - Right under buttons */}
            {showImportDialogs.channels && (
              <div className="border rounded-lg p-4 bg-gray-50 space-y-4">
                <h4 className="font-medium">Import Standard Boards</h4>
                
                {importResults.channels && (
                  <div className="rounded-md bg-green-50 border border-green-200 p-3 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                    <p className="text-sm text-green-800">
                      Successfully imported {importResults.channels.imported} board{importResults.channels.imported !== 1 ? 's' : ''}.
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
                              checked={availableChannels.length > 0 && 
                                availableChannels.every(c => selectedChannels.includes(c.id))}
                              onChange={() => {
                                if (availableChannels.every(c => selectedChannels.includes(c.id))) {
                                  setSelectedChannels([]);
                                } else {
                                  setSelectedChannels(availableChannels.map(c => c.id));
                                }
                              }}
                              disabled={availableChannels.length === 0}
                            />
                          </th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Name</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Default</th>
                          <th className="px-3 py-2 text-left text-sm font-medium text-gray-700">Order</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {availableChannels.map((channel, idx) => (
                          <tr key={channel.id} className="hover:bg-gray-50">
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={selectedChannels.includes(channel.id)}
                                onChange={() => {
                                  if (selectedChannels.includes(channel.id)) {
                                    setSelectedChannels(selectedChannels.filter(id => id !== channel.id));
                                  } else {
                                    setSelectedChannels([...selectedChannels, channel.id]);
                                  }
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 text-sm">{channel.channel_name}</td>
                            <td className="px-3 py-2 text-center">
                              {channel.is_default && <Star className="h-3.5 w-3.5 text-yellow-500 fill-yellow-500 inline" />}
                            </td>
                            <td className="px-3 py-2 text-sm text-gray-600">{channel.display_order || 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    id="cancel-import-channels"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowImportDialogs(prev => ({ ...prev, channels: false }));
                      setSelectedChannels([]);
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="confirm-import-channels"
                    type="button"
                    onClick={handleImportChannels}
                    disabled={selectedChannels.length === 0 || isImporting.channels}
                    className="flex-1"
                  >
                    {isImporting.channels ? 'Importing...' : `Import (${selectedChannels.length})`}
                  </Button>
                </div>
              </div>
            )}

            {/* Existing Channels */}
            {(importedChannels.length > 0 || data.channelName) && (
              <div>
                <Label className="mb-2 block">Current Boards</Label>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b">
                      <tr>
                        <th className="px-2 py-1 text-left text-xs font-medium text-gray-700">Name</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Default</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Order</th>
                        <th className="px-2 py-1 text-center text-xs font-medium text-gray-700">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {importedChannels.map((channel, idx) => (
                        <tr key={channel.channel_id}>
                          <td className="px-2 py-1 text-xs">{channel.channel_name}</td>
                          <td className="px-2 py-1 text-center">
                            <Button
                              id={`channel-default-toggle-${idx}`}
                              data-channel-id={channel.channel_id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setDefaultChannel(channel.channel_id)}
                              className="p-0.5 h-5 w-5"
                              title={channel.is_default ? "Default board" : "Set as default board"}
                            >
                              <Star className={`h-3.5 w-3.5 ${channel.is_default ? 'text-yellow-500 fill-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`} />
                            </Button>
                          </td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">{channel.display_order || 0}</td>
                          <td className="px-2 py-1 text-center">
                            <Button
                              id={`channel-remove-${idx}`}
                              data-channel-id={channel.channel_id}
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeChannel(channel.channel_id)}
                              className="p-1 h-6 w-6"
                              title="Remove board"
                              disabled={channel.is_default}
                            >
                              <Trash2 className={`h-3 w-3 ${channel.is_default ? 'text-gray-300' : 'text-gray-500 hover:text-red-600'}`} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {data.channelName && !importedChannels.some(c => c.channel_name === data.channelName) && (
                        <tr>
                          <td className="px-2 py-1 text-xs">{data.channelName}</td>
                          <td className="px-2 py-1 text-center text-xs">-</td>
                          <td className="px-2 py-1 text-center text-xs text-gray-600">1</td>
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
          disabled={!hasChannel()}
        >
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-gray-500" />
            <span className="font-medium">Categories</span>
            {!hasChannel() && (
              <span className="text-xs text-gray-500">(requires board)</span>
            )}
          </div>
          {expandedSections.categories ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {expandedSections.categories && hasChannel() && (
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
                    <Label htmlFor="new-category-channel">Target Board *</Label>
                    <CustomSelect
                      id="new-category-channel-select"
                      value={categoryForm.channelId}
                      onValueChange={(value) => setCategoryForm(prev => ({ ...prev, channelId: value }))}
                      options={importedChannels.map(ch => ({
                        value: ch.channel_id,
                        label: ch.channel_name
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
                          .filter(cat => !cat.parent_category && cat.channel_id === categoryForm.channelId)
                          .map(cat => ({
                            value: cat.category_id,
                            label: cat.category_name
                          }))
                      ]}
                      placeholder="Select parent category"
                      className="w-full"
                      disabled={!categoryForm.channelId}
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
                      setCategoryForm({ name: '', parentCategory: '', displayOrder: 0, channelId: '' });
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="save-add-category-form"
                    onClick={addCategory}
                    disabled={!categoryForm.name.trim() || !categoryForm.channelId}
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

                {/* Channel Selection */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Target Board *</Label>
                  <CustomSelect
                    id="import-category-target-select"
                    value={importTargetChannel}
                    onValueChange={setImportTargetChannel}
                    options={[
                      ...importedChannels.map(ch => ({
                        value: ch.channel_id,
                        label: ch.channel_name
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
                        {availableCategories.map((category, idx) => {
                          // Find parent category name if this is a subcategory
                          const parentCategory = category.parent_category_uuid 
                            ? availableCategories.find(c => c.id === category.parent_category_uuid)
                            : null;
                          
                          return (
                            <tr key={category.id} className="hover:bg-gray-50">
                              <td className="px-3 py-2">
                                <Checkbox
                                  checked={selectedCategories.includes(category.id)}
                                  onChange={() => {
                                    if (selectedCategories.includes(category.id)) {
                                      setSelectedCategories(selectedCategories.filter(id => id !== category.id));
                                    } else {
                                      setSelectedCategories([...selectedCategories, category.id]);
                                    }
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2 text-sm">
                                {category.parent_category_uuid && (
                                  <span className="ml-4 text-gray-500">
                                    {parentCategory ? `${parentCategory.category_name} → ` : '→ '}
                                  </span>
                                )}
                                {category.category_name}
                              </td>
                              <td className="px-3 py-2 text-sm text-gray-600">{category.display_order || 0}</td>
                            </tr>
                          );
                        })}
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
                      setImportTargetChannel('');
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    id="confirm-import-categories"
                    type="button"
                    onClick={handleImportCategories}
                    disabled={selectedCategories.length === 0 || !importTargetChannel || isImporting.categories}
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
                          
                          return (
                            <tr key={category.category_id}>
                              <td className="px-2 py-1 text-xs">
                                {isSubcategory && (
                                  <span className="ml-4 text-gray-400">
                                    {parentCategory ? `${parentCategory.category_name} → ` : '→ '}
                                  </span>
                                )}
                                {category.category_name}
                              </td>
                              <td className="px-2 py-1 text-center text-xs text-gray-600">{category.display_order || '-'}</td>
                              <td className="px-2 py-1 text-center">
                                <Button
                                  id={`category-remove-${idx}`}
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
                        
                        // Add to imported statuses list
                        setImportedStatuses(prev => [...prev, createdStatus]);
                        
                        // Track all statuses in form data
                        const allStatuses = [...importedStatuses, createdStatus];
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
                              id={`status-remove-${idx}`}
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
                                  id={`priority-remove-${index}`}
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
            placeholder="support@yourcompany.com"
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
    </div>
  );
}