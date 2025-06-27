'use client';

import React, { useState, useEffect, useRef } from 'react';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Plus, X, Edit2, ChevronRight, ChevronDown, Network, Search, MoreVertical, Palette } from "lucide-react";
import ColorPicker from 'server/src/components/ui/ColorPicker';
import { getAllChannels, createChannel, deleteChannel, updateChannel } from 'server/src/lib/actions/channel-actions/channelActions';
import { getStatuses, createStatus, deleteStatus, updateStatus } from 'server/src/lib/actions/status-actions/statusActions';
import { getAllPriorities, getAllPrioritiesWithStandard, createPriority, deletePriority, updatePriority } from 'server/src/lib/actions/priorityActions';
import { importReferenceData, getAvailableReferenceData, checkImportConflicts, type ImportConflict } from 'server/src/lib/actions/referenceDataActions';
import { getTicketCategories, createTicketCategory, deleteTicketCategory, updateTicketCategory } from 'server/src/lib/actions/ticketCategoryActions';
import { IChannel } from 'server/src/interfaces/channel.interface';
import { IStatus, IStandardStatus, ItemType } from 'server/src/interfaces/status.interface';
import { IPriority, IStandardPriority, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import NumberingSettings from './NumberingSettings';
import { Switch } from 'server/src/components/ui/Switch';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { toast } from 'react-hot-toast';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';

interface SettingSectionProps<T extends object> {
  title: string;
  items: T[];
  newItem: string;
  setNewItem: (value: string) => void;
  addItem: () => void;
  updateItem: (item: T) => void;
  getItemName: (item: T) => string;
  getItemKey: (item: T) => string;
  deleteItem: (key: string) => void;
  renderExtraActions?: (item: T) => React.ReactNode;
  columns: ColumnDefinition<T>[];
  headerControls?: React.ReactNode;
}

function SettingSection<T extends object>({
  title,
  items,
  newItem,
  setNewItem,
  addItem,
  updateItem,
  deleteItem,
  getItemName,
  getItemKey,
  renderExtraActions,
  columns,
  headerControls
}: SettingSectionProps<T>): JSX.Element {
  const [editingItem, setEditingItem] = useState<T | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const startEditing = (item: T): void => {
    setEditingItem(item);
    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.value = getItemName(item);
        editInputRef.current.focus();
      }
    }, 0);
  };

  const cancelEditing = (): void => {
    setEditingItem(null);
  };

  const getPlaceholder = (): string => {
    switch (title) {
      case "Channels":
        return "New Channel";
      case "Ticket Statuses":
        return "New Status";
      case "Priorities":
        return "New Priority";
      case "Categories":
        return "New Category";
      default:
        return "New Item";
    }
  };

  const saveEdit = (): void => {
    if (editingItem && editInputRef.current?.value.trim()) {
      let propertyName: string;
      switch (title) {
        case "Channels":
          propertyName = "channel_name";
          break;
        case "Ticket Statuses":
        case "Project Statuses":
        case "Project Task Statuses":
          propertyName = "name";
          break;
        case "Priorities":
          propertyName = "priority_name";
          break;
        case "Categories":
          propertyName = "category_name";
          break;
        default:
          console.error("Unknown title:", title);
          return;
      }

      const updatedItem = { ...editingItem, [propertyName]: editInputRef.current.value.trim() };
      updateItem(updatedItem as T);
      setEditingItem(null);
    }
  };

  // Modify columns to include inline editing
  const modifiedColumns: ColumnDefinition<T>[] = columns.map((column): ColumnDefinition<T> => {
    if (column.dataIndex === 'channel_name' || column.dataIndex === 'name' || 
        column.dataIndex === 'priority_name' || column.dataIndex === 'category_name') {
      return {
        ...column,
        render: (value: any, record: T) => (
          editingItem === record ? (
          <div className="p-0.5">
            <Input
              ref={editInputRef}
              defaultValue={value}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  saveEdit();
                } else if (e.key === 'Escape') {
                  cancelEditing();
                }
              }}
              className="w-full"
            />
          </div>
          ) : (
            <span className="text-gray-700">{value}</span>
          )
        )
      };
    }
    return column;
  });

  const actionColumn: ColumnDefinition<T> = {
    title: 'Actions',
    dataIndex: 'action',
    width: '5%', // Adjusted width
    render: (_, item) => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 w-8 p-0"
            id={`actions-menu-${getItemKey(item)}`}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="sr-only">Open menu</span>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {editingItem === item ? (
            <>
              <DropdownMenuItem
                id={`save-item-${getItemKey(item)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  saveEdit();
                }}
              >
                Save
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`cancel-edit-${getItemKey(item)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  cancelEditing();
                }}
              >
                Cancel
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuItem
                id={`edit-item-${getItemKey(item)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing(item);
                }}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                id={`delete-item-${getItemKey(item)}`}
                className="text-red-600 focus:text-red-600"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteItem(getItemKey(item));
                }}
              >
                Delete
              </DropdownMenuItem>
              {/* Integrate renderExtraActions if needed, potentially as more DropdownMenuItems */}
              {/* {renderExtraActions && renderExtraActions(item)} */}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  };

  const allColumns = [...modifiedColumns, actionColumn];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        {headerControls && <div>{headerControls}</div>}
      </div>
      <DataTable
        data={items}
        columns={allColumns}
        pagination={false}
      />
      <div className="flex space-x-2 mt-4">
        <Input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          placeholder={getPlaceholder()}
          className="flex-grow"
        />
        <Button id='add-button' onClick={addItem} className="bg-primary-500 text-white hover:bg-primary-600">
          <Plus className="h-4 w-4 mr-2" /> Add
        </Button>
      </div>
    </div>
  );
}

const TicketingSettings = (): JSX.Element => {
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [statuses, setStatuses] = useState<IStatus[]>([]);
  const [selectedStatusType, setSelectedStatusType] = useState<ItemType>('ticket');
  const [priorities, setPriorities] = useState<(IPriority | IStandardPriority)[]>([]);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [newChannel, setNewChannel] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [newPriority, setNewPriority] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [selectedParentCategory, setSelectedParentCategory] = useState<string>('');
  const [categoryChannelFilter, setCategoryChannelFilter] = useState<string>('all');
  const [editingCategory, setEditingCategory] = useState<string>('');
  const [editedCategoryName, setEditedCategoryName] = useState<string>('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string>('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<IChannel | IStatus | IPriority | ITicketCategory | null>(null);
  const [itemTypeToDelete, setItemTypeToDelete] = useState<string | null>(null);
  const [selectedPriorityType, setSelectedPriorityType] = useState<'ticket' | 'project_task'>('ticket');
  const [showPriorityDialog, setShowPriorityDialog] = useState(false);
  const [editingPriority, setEditingPriority] = useState<IPriority | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferencePriorities, setAvailableReferencePriorities] = useState<IStandardPriority[]>([]);
  const [selectedImportPriorities, setSelectedImportPriorities] = useState<string[]>([]);
  const [priorityColor, setPriorityColor] = useState('#6B7280');
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [editingStatus, setEditingStatus] = useState<IStatus | null>(null);
  const [showStatusImportDialog, setShowStatusImportDialog] = useState(false);
  const [availableReferenceStatuses, setAvailableReferenceStatuses] = useState<IStandardStatus[]>([]);
  const [selectedImportStatuses, setSelectedImportStatuses] = useState<string[]>([]);
  
  // Conflict resolution state
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});
  const [currentImportType, setCurrentImportType] = useState<'priorities' | 'statuses'>('priorities');

  useEffect(() => {
    const initUser = async () => {
      const user = await getCurrentUser();
      if (user) {
        setUserId(user.user_id);
      }
    };
    initUser();
  }, []);

  useEffect(() => {
    const fetchData = async (): Promise<void> => {
      try {
        const [fetchedChannels, fetchedStatuses, fetchedPriorities, fetchedCategories] = await Promise.all([
          getAllChannels(true),
          getStatuses(selectedStatusType),
          getAllPriorities(),
          getTicketCategories()
        ]);
        setChannels(fetchedChannels);
        setStatuses(fetchedStatuses);
        setPriorities(fetchedPriorities);
        setCategories(fetchedCategories);
      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
  }, [selectedStatusType]);

    useEffect(() => {
      if (categoryChannelFilter !== 'all' && selectedParentCategory) {
        const parentCategory = categories.find(c => c.category_id === selectedParentCategory);
        if (parentCategory?.channel_id !== categoryChannelFilter) {
          setSelectedParentCategory('');
        }
      }
    }, [categoryChannelFilter, categories, selectedParentCategory]);

    const filteredChannels = channels.filter(channel => {
      const isStatusMatch = 
        filterStatus === 'all' || 
        (filterStatus === 'active' && !channel.is_inactive) ||
        (filterStatus === 'inactive' && channel.is_inactive);
    
      const channelName = channel.channel_name || '';
      const isNameMatch = channelName.toLowerCase().includes(searchTerm.toLowerCase());
    
      return isStatusMatch && isNameMatch;
    });

    const filteredCategories = categories.filter(category => {
      if (categoryChannelFilter === 'all') {
        return true;
      }
      return category.channel_id === categoryChannelFilter;
    });

    const toggleChannelStatus = async (channelId: string, currentStatus: boolean): Promise<void> => {
      try {
        await updateChannel(channelId, { is_inactive: !currentStatus });
        setChannels(channels.map((channel): IChannel =>
          channel.channel_id === channelId ? { ...channel, is_inactive: !currentStatus } : channel
        ));
      } catch (error) {
        console.error('Error toggling channel status:', error);
      }
    };

    const addChannel = async (): Promise<void> => {
      if (newChannel.trim() !== '') {
        try {
          const addedChannel = await createChannel({
            channel_name: newChannel.trim(),
            is_inactive: false
          });
          setChannels([...channels, addedChannel]);
          setNewChannel('');
        } catch (error) {
          console.error('Error adding new channel:', error);
        }
      }
    };

  const addStatus = async (): Promise<void> => {
    if (newStatus.trim() === '') {
      return;
    }

    try {
      const addedStatus = await createStatus({
        name: newStatus.trim(),
        status_type: selectedStatusType,
        is_closed: false,
      });

      if (addedStatus) {
        setStatuses([...statuses, addedStatus]);
        setNewStatus('');
      }
      } catch (error) {
        console.error('Error adding new status:', error);
        const message = error instanceof Error ? error.message : 'Failed to create status';
        toast.error(message);
    }
  };

    const addPriority = async (): Promise<void> => {
      if (newPriority.trim() !== '' && userId) {
        try {
          const addedPriority = await createPriority({
            priority_name: newPriority.trim(),
            order_number: 50,
            color: '#6B7280',
            item_type: selectedPriorityType,
            created_by: userId,
            created_at: new Date()
          });
          setPriorities([...priorities, addedPriority]);
          setNewPriority('');
        } catch (error) {
          console.error('Error adding new priority:', error);
        }
      }
    };

    const updateChannelItem = async (updatedChannel: IChannel): Promise<void> => {
      try {
        await updateChannel(updatedChannel.channel_id!, updatedChannel);
        setChannels(channels.map((channel): IChannel =>
          channel.channel_id === updatedChannel.channel_id ? updatedChannel : channel
        ));
      } catch (error) {
        console.error('Error updating channel:', error);
      }
    };

    const updateStatusItem = async (updatedStatus: IStatus): Promise<void> => {
      // Prevent removing the last closed status
      const currentStatus = statuses.find(s => s.status_id === updatedStatus.status_id);
      if (currentStatus?.is_closed && !updatedStatus.is_closed) {
        const otherClosedStatuses = statuses.filter(s => 
          s.status_id !== updatedStatus.status_id && s.is_closed
        );
        if (otherClosedStatuses.length === 0) {
          toast.error('At least one status must remain marked as closed');
          return;
        }
      }

      try {
        await updateStatus(updatedStatus.status_id!, updatedStatus);
        setStatuses(statuses.map((status): IStatus =>
          status.status_id === updatedStatus.status_id ? updatedStatus : status
        ));
      } catch (error) {
        console.error('Error updating status:', error);
      }
    };

    const updatePriorityItem = async (updatedPriority: IPriority): Promise<void> => {
      try {
        await updatePriority(updatedPriority.priority_id, updatedPriority);
        setPriorities(priorities.map((priority) =>
          'tenant' in priority && priority.priority_id === updatedPriority.priority_id ? updatedPriority : priority
        ));
      } catch (error) {
        console.error('Error updating priority:', error);
      }
    };

    const handleEditCategory = (category: ITicketCategory) => {
      setEditingCategory(category.category_id);
      // Let the input render first, then set its value
      setTimeout(() => {
        if (editInputRef.current) {
          editInputRef.current.value = category.category_name;
          editInputRef.current.focus();
        }
      }, 0);
    };

    const handleSaveCategory = async (categoryId: string) => {
      if (!editInputRef.current?.value.trim()) {
        return;
      }
  
      try {
        const category = categories.find(c => c.category_id === categoryId);
        if (!category) return;

        const updatedCategory = await updateTicketCategory(categoryId, {
          ...category,
          category_name: editInputRef.current.value.trim()
        });

        setCategories(categories.map((c):ITicketCategory => 
          c.category_id === categoryId ? updatedCategory : c
        ));
        setEditingCategory('');
      } catch (error) {
        console.error('Error updating category:', error);
        if (error instanceof Error) {
          toast.error(error.message);
        } else {
          toast.error('Failed to update category');
        }
      }
    };

    const addCategory = async (): Promise<void> => {
      if (newCategory.trim() === '') {
        return;
      }
    
      try {
        let selectedChannelId: string | undefined;
      
        if (selectedParentCategory) {
          const parentCategory = categories.find(c => c.category_id === selectedParentCategory);
          selectedChannelId = parentCategory?.channel_id;
        } 
        else if (categoryChannelFilter !== 'all') {
          selectedChannelId = categoryChannelFilter;
        }
        else {
          toast.error('Please select a specific channel from the dropdown first before adding a category.');
          return;
        }
      
        if (!selectedChannelId) {
          throw new Error('No channel selected');
        }
      
        const addedCategory = await createTicketCategory(
          newCategory.trim(),
          selectedChannelId,
          selectedParentCategory || undefined
        );
        setCategories([...categories, addedCategory]);
        setNewCategory('');
        setSelectedParentCategory('');
      } catch (error) {
        console.error('Error adding new ticket category:', error);
        if (error instanceof Error) {
          toast.error(error.message);
        } else {
          toast.error('Failed to create ticket category');
        }
      }
    };

    const handleDeleteItemRequest = (item: IChannel | IStatus | IPriority | ITicketCategory, type: string): void => {
      setItemToDelete(item);
      setItemTypeToDelete(type);
      setShowDeleteDialog(true);
    };

    const confirmDeleteItem = async (): Promise<void> => {
      if (!itemToDelete || !itemTypeToDelete) return;

      let itemName = '';
      try {
        if (itemTypeToDelete === 'channel' && 'channel_id' in itemToDelete) {
          itemName = (itemToDelete as IChannel).channel_name || 'Channel';
          await deleteChannel((itemToDelete as IChannel).channel_id!);
          setChannels(channels.filter(channel => channel.channel_id !== (itemToDelete as IChannel).channel_id));
        } else if (itemTypeToDelete === 'status' && 'status_id' in itemToDelete) {
          itemName = (itemToDelete as IStatus).name || 'Status';
          await deleteStatus((itemToDelete as IStatus).status_id!);
          setStatuses(statuses.filter(status => status.status_id !== (itemToDelete as IStatus).status_id));
        } else if (itemTypeToDelete === 'priority' && 'priority_id' in itemToDelete) {
          itemName = (itemToDelete as IPriority).priority_name || 'Priority';
          await deletePriority((itemToDelete as IPriority).priority_id!);
          setPriorities(priorities.filter(priority => priority.priority_id !== (itemToDelete as IPriority).priority_id));
        } else if (itemTypeToDelete === 'category' && 'category_id' in itemToDelete) {
          itemName = (itemToDelete as ITicketCategory).category_name || 'Category';
          const category = itemToDelete as ITicketCategory;
          const hasSubcategories = categories.some(c => c.parent_category === category.category_id);
          if (hasSubcategories) {
            toast.error(`Cannot delete "${category.category_name}" because it has subcategories. Please delete all subcategories first.`);
            setShowDeleteDialog(false);
            setItemToDelete(null);
            setItemTypeToDelete(null);
            return;
          }
          await deleteTicketCategory(category.category_id!);
          setCategories(categories.filter(c => c.category_id !== category.category_id));
        }
        toast.success(`${itemName} deleted successfully.`);
      } catch (error) {
        console.error(`Error deleting ${itemTypeToDelete}:`, error);
        const specificError = error instanceof Error ? error.message : `Failed to delete ${itemTypeToDelete}.`;
        if (specificError.toLowerCase().includes('in use') || specificError.toLowerCase().includes('referenced') || specificError.toLowerCase().includes('foreign key')) {
            toast.error(`Cannot delete "${itemName}" because it is currently in use.`);
        } else {
            toast.error(specificError);
        }
      } finally {
        setShowDeleteDialog(false);
        setItemToDelete(null);
        setItemTypeToDelete(null);
      }
    };
  
    const handleDeleteChannelRequestWrapper = (channelId: string): void => {
      const channel = channels.find(c => c.channel_id === channelId);
      if (channel) handleDeleteItemRequest(channel, 'channel');
    };

    const handleDeleteStatusRequestWrapper = (statusId: string): void => {
      const status = statuses.find(s => s.status_id === statusId);
      if (status) {
        if (status.is_closed) {
          const otherClosedStatuses = statuses.filter(s_1 =>
            s_1.status_id !== statusId && s_1.is_closed && s_1.status_type === status.status_type
          );
          if (otherClosedStatuses.length === 0) {
            toast.error('Cannot delete the last closed status for this type.');
            return;
          }
        }
        handleDeleteItemRequest(status, 'status');
      }
    };

    const handleDeletePriorityRequestWrapper = (priorityId: string): void => {
      const priority = priorities.find(p => p.priority_id === priorityId);
      if (priority && 'tenant' in priority) {
        handleDeleteItemRequest(priority as IPriority, 'priority');
      }
    };

    const handleDeleteCategoryRequestWrapper = (categoryId: string): void => {
      const category = categories.find(c => c.category_id === categoryId);
      if (category) handleDeleteItemRequest(category, 'category');
    };
  
    const handleDeleteStatus = async (statusId: string): Promise<void> => {
      try {
        const currentStatus = statuses.find(s => s.status_id === statusId);
        if (currentStatus?.is_closed) {
          const otherClosedStatuses = statuses.filter(s => 
            s.status_id !== statusId && s.is_closed
          );
          if (otherClosedStatuses.length === 0) {
            toast.error('Cannot delete the last closed status');
            return;
          }
        }

        await deleteStatus(statusId);
        setStatuses(statuses.filter(status => status.status_id !== statusId));
        toast.success('Status deleted successfully');
      } catch (error) {
        console.error('Error deleting status:', error);
        toast.error(
          error instanceof Error ? 
          error.message : 
          'Cannot delete status because it is currently in use'
        );
      }
    };
  
    const handleDeletePriority = async (priorityId: string): Promise<void> => {
      try {
        await deletePriority(priorityId);
        setPriorities(priorities.filter(priority => priority.priority_id !== priorityId));
      } catch (error) {
        console.error('Error deleting priority:', error);
      }
    };
  
    const handleDeleteCategory = async (categoryId: string): Promise<void> => {
      const category = categories.find(c => c.category_id === categoryId);
      if (!category) return;
    
      const hasSubcategories = categories.some(c => c.parent_category === categoryId);
      if (hasSubcategories) {
        toast.error(`Cannot delete "${category.category_name}" because it has subcategories.\n\nPlease delete all subcategories first.`);
        return;
      }
    
      if (!confirm(`Are you sure you want to delete the category "${category.category_name}"?\n\nThis action cannot be undone.`)) {
        return;
      }
    
      try {
        await deleteTicketCategory(categoryId);
        setCategories(categories.filter(c => c.category_id !== categoryId));
      } catch (error) {
        console.error('Error deleting ticket category:', error);
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          if (errorMessage.includes('in use') || errorMessage.includes('referenced') || errorMessage.includes('foreign key')) {
            toast.error(`Cannot delete "${category.category_name}" because it is being used by one or more tickets.\n\nPlease reassign those tickets to a different category first.`);
          } else {
            toast.error(`Failed to delete "${category.category_name}".\n\nError: ${error.message}`);
          }
        } else {
          toast.error(`Failed to delete "${category.category_name}".\n\nPlease try again or contact support if the issue persists.`);
        }
      }
    };

  const toggleCategoryCollapse = (categoryId: string) => {
    setCollapsedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  useEffect(() => {
    const parentCategories = categories.filter(c => !c.parent_category).map((c):string => c.category_id);
    setCollapsedCategories(new Set(parentCategories));
  }, [categories]);
  
  const topLevelCategories = categories.filter(category => {
    const matchesChannel = categoryChannelFilter === 'all' || category.channel_id === categoryChannelFilter;
    const isTopLevel = !category.parent_category;
    return matchesChannel && isTopLevel;
  });

  const visibleCategories = topLevelCategories.reduce((acc: ITicketCategory[], category): ITicketCategory[] => {
    acc.push(category);
    if (!collapsedCategories.has(category.category_id)) {
      const subcategories = categories.filter(c => c.parent_category === category.category_id);
      acc.push(...subcategories);
    }
    return acc;
  }, []);

  const channelColumns: ColumnDefinition<IChannel>[] = [
    {
      title: 'Name',
      dataIndex: 'channel_name',
    },
    {
      title: 'Status',
      dataIndex: 'is_inactive',
      render: (value, record) => (
        <div className="flex items-center space-x-2 text-gray-500">
          <span className="text-sm mr-2">
            {record.is_inactive ? 'Inactive' : 'Active'}
          </span>
          <Switch
            checked={!record.is_inactive}
            onCheckedChange={() => toggleChannelStatus(record.channel_id!, record.is_inactive)}
            className="data-[state=checked]:bg-primary-500"
          />
        </div>
      ),
    },
    {
      title: 'Default',
      dataIndex: 'is_default',
      render: (value, record) => (
        <div className="flex items-center space-x-2 text-gray-500">
          <Switch
            checked={record.is_default || false}
            onCheckedChange={async (checked) => {
              if (checked) {
                try {
                  // Update this channel first
                  await updateChannelItem({ ...record, is_default: true });
                  
                  // Update local state to reflect the change
                  setChannels(prevChannels => 
                    prevChannels.map(channel => ({
                      ...channel,
                      is_default: channel.channel_id === record.channel_id
                    }))
                  );
                 } catch (error) {
                   console.error('Error updating default channel:', error);
                   toast.error(error instanceof Error ? error.message : 'Failed to update default channel');
                 }
               } else {
                 try {
                   // Check if this is the last default channel
                   const defaultChannels = channels.filter(c => 
                    c.channel_id !== record.channel_id && c.is_default
                  );
                  
                  if (defaultChannels.length === 0) {
                    toast.error('Cannot remove default status from the last default channel');
                    return;
                  }

                  await updateChannelItem({ ...record, is_default: false });
                  
                  // Update local state
                  setChannels(prevChannels => 
                    prevChannels.map(channel => 
                      channel.channel_id === record.channel_id ? 
                        { ...channel, is_default: false } : 
                        channel
                    )
                  );
                 } catch (error) {
                   console.error('Error updating default channel:', error);
                   // Display the specific error message from the backend
                   toast.error(error instanceof Error ? error.message : 'Failed to update default channel');
                 }
               }
            }}
            className="data-[state=checked]:bg-primary-500"
          />
          <span className="text-xs text-gray-400 ml-2">
            {record.is_default ? 'Default channel for new tickets from client portal' : ''}
          </span>
        </div>
      ),
    },
  ];

  const filterStatusOptions = [
    { value: 'all', label: 'All Channels' },
    { value: 'active', label: 'Active Channels' },
    { value: 'inactive', label: 'Inactive Channels' }
  ];

  const channelFilterOptions = [
    { value: 'all', label: 'All Channels' },
    ...channels.map((channel): { value: string; label: string } => ({
      value: channel.channel_id || '',
      label: channel.channel_name || ''
    }))
  ];

  const getStatusColumns = (type: ItemType): ColumnDefinition<IStatus>[] => {
    const baseColumns: ColumnDefinition<IStatus>[] = [
      {
        title: 'Name',
        dataIndex: 'name',
        width: '30%',
      },
      {
        title: 'Order',
        dataIndex: 'order_number',
        width: '10%',
        render: (value) => value || 0,
      },
      {
        title: 'Status',
        dataIndex: 'is_closed',
        width: '50%',
        render: (value, record) => (
          <div className="flex items-center space-x-2 text-gray-500">
            <span className="text-sm mr-2">
              {record.is_closed ? 'Closed' : 'Open'}
            </span>
            <Switch
              checked={record.is_closed}
              onCheckedChange={() => updateStatusItem({ ...record, is_closed: !record.is_closed })}
              className="data-[state=checked]:bg-primary-500"
            />
            <span className="text-xs text-gray-400 ml-2">
              {record.is_closed 
                ? `${
                    type === 'project' ? 'Projects' : 
                    type === 'ticket' ? 'Tickets' : 
                    type === 'project_task' ? 'Tasks' : 
                    'Interactions'
                  } with this status will be marked as closed` 
                : `${
                    type === 'project' ? 'Projects' : 
                    type === 'ticket' ? 'Tickets' : 
                    type === 'project_task' ? 'Tasks' : 
                    'Interactions'
                  } with this status will remain open`
              }
            </span>
          </div>
        ),
      }
    ];

    // Only add default column for ticket statuses
    if (type === 'ticket') {
      baseColumns.push({
        title: 'Default',
        dataIndex: 'is_default',
        render: (value, record) => (
          <div className="flex items-center space-x-2 text-gray-500">
            <Switch
              checked={record.is_default || false}
              onCheckedChange={async (checked) => {
                if (checked) {
                  try {
                    // Update this status first
                    await updateStatusItem({ ...record, is_default: true });
                    
                    // Update local state to reflect the change
                    setStatuses(prevStatuses => 
                      prevStatuses.map(status => ({
                        ...status,
                        is_default: status.status_id === record.status_id
                      }))
                    );
                  } catch (error) {
                    console.error('Error updating default status:', error);
                    toast.error('Failed to update default status');
                  }
                } else {
                  try {
                    // Check if this is the last default status
                    const defaultStatuses = statuses.filter(s => 
                      s.status_id !== record.status_id && 
                      s.is_default &&
                      s.status_type === record.status_type
                    );
                    
                    if (defaultStatuses.length === 0) {
                      toast.error('Cannot remove default status from the last default status');
                      return;
                    }

                    await updateStatusItem({ ...record, is_default: false });
                    
                    // Update local state
                    setStatuses(prevStatuses => 
                      prevStatuses.map(status => 
                        status.status_id === record.status_id ? 
                          { ...status, is_default: false } : 
                          status
                      )
                    );
                  } catch (error) {
                    console.error('Error updating default status:', error);
                    toast.error('Failed to update default status');
                  }
                }
              }}
              className="data-[state=checked]:bg-primary-500"
            />
            <span className="text-xs text-gray-400 ml-2">
              {record.is_default ? 'Default status for new tickets from client portal' : ''}
            </span>
          </div>
        ),
      });
    }

    return baseColumns;
  };

  const priorityColumns: ColumnDefinition<IPriority | IStandardPriority>[] = [
    {
      title: 'Name',
      dataIndex: 'priority_name',
      render: (value, record) => (
        <div className="flex items-center gap-2">
          <div 
            className="w-4 h-4 rounded-full" 
            style={{ backgroundColor: record.color }}
          />
          <span>{value}</span>
          {'tenant' in record ? null : (
            <span className="text-xs text-gray-500 italic">(Standard)</span>
          )}
        </div>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'item_type',
      render: (value) => (
        <span className="capitalize">{value === 'project_task' ? 'Project Task' : 'Ticket'}</span>
      ),
    },
    {
      title: 'Order',
      dataIndex: 'order_number',
      render: (value) => value,
    },
    {
      title: 'Color',
      dataIndex: 'color',
      render: (value) => (
        <div className="flex items-center gap-2">
          <div 
            className="w-6 h-6 rounded border border-gray-300" 
            style={{ backgroundColor: value }}
          />
          <span className="text-xs text-gray-500">{value}</span>
        </div>
      ),
    },
  ];

  const categoryColumns: ColumnDefinition<ITicketCategory>[] = [
    {
      title: 'Name',
      dataIndex: 'category_name',
      render: (value, record) => {
        const hasSubcategories = categories.some(c => c.parent_category === record.category_id);
        const isCollapsed = collapsedCategories.has(record.category_id);

        return (
          <div className="flex items-center">
            {record.parent_category ? (
              <div className="ml-6 flex items-center">
                <div className="w-4 h-px bg-gray-300 mr-2"></div>
                <ChevronRight className="h-4 w-4 text-gray-400" />
              </div>
            ) : hasSubcategories ? (
              <Button
                id='expand-button'
                variant="ghost"
                size="sm"
                className="p-0 mr-2"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCategoryCollapse(record.category_id);
                }}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            ) : (
              <div className="w-6 mr-2" />
            )}
            {editingCategory === record.category_id ? (
              <div className="p-0.5">
                <Input
                  ref={editInputRef}
                  defaultValue={value}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveCategory(record.category_id);
                    } else if (e.key === 'Escape') {
                      setEditingCategory('');
                    }
                  }}
                  className="flex-grow"
                />
              </div>
            ) : (
              <span>{value}</span>
            )}
          </div>
        );
      },
    },
    {
      title: 'Channel',
      dataIndex: 'channel_id',
      render: (value) => {
        const channel = channels.find(ch => ch.channel_id === value);
        return channel?.channel_name || value;
      },
    },
  ];

  const tabs = [
    {
      label: "Ticket Numbering",
      content: <NumberingSettings entityType="TICKET" />
    },
    {
      label: "Channels",
      content: (
        <div>
          {/* Info Box - Moved before SettingSection */}
          <div className="bg-blue-50 p-4 rounded-md mb-4">
            <p className="text-sm text-blue-700">
              <strong>Default Channel:</strong> When clients create tickets through the client portal,
              they will automatically be assigned to the channel marked as default. Only one channel can
              be set as default at a time.
            </p>
          </div>
          {/* Setting Section */}
          <SettingSection<IChannel>
            title="Channels"
            items={filteredChannels}
            newItem={newChannel}
            setNewItem={setNewChannel}
            addItem={addChannel}
            updateItem={updateChannelItem}
            deleteItem={handleDeleteChannelRequestWrapper}
            getItemName={(channel) => channel.channel_name || ''}
            getItemKey={(channel) => channel.channel_id || ''}
            columns={channelColumns}
            headerControls={
              <div className="flex items-center gap-6">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search channels"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="border-2 border-gray-200 focus:border-purple-500 rounded-md pl-10 pr-4 py-2 w-64 outline-none bg-white"
                  />
                  <Search size={20} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                </div>
                <CustomSelect
                  value={filterStatus}
                  onValueChange={(value: string) => setFilterStatus(value as 'all' | 'active' | 'inactive')}
                  options={filterStatusOptions}
                  className="w-64"
                />
              </div>
            }
          />
        </div>
      )
    },
    {
      label: "Statuses",
      content: (
        <div>
          {selectedStatusType === 'ticket' && (
            <div className="bg-blue-50 p-4 rounded-md mb-4">
              <p className="text-sm text-blue-700">
                <strong>Default Status:</strong> When clients create tickets through the client portal,
                they will automatically be assigned the status marked as default. Only one status can
                be set as default at a time.
              </p>
            </div>
          )}
          {selectedStatusType === 'project' && (
            <div className="bg-blue-50 p-4 rounded-md mb-4">
              <p className="text-sm text-blue-700">
                <strong>Project Statuses:</strong> Define the workflow stages for your projects.
                Mark statuses as "closed" to indicate project completion.
              </p>
            </div>
          )}
          {selectedStatusType === 'interaction' && (
            <div className="bg-blue-50 p-4 rounded-md mb-4">
              <p className="text-sm text-blue-700">
                <strong>Interaction Statuses:</strong> Track the state of customer interactions
                such as calls, emails, and meetings.
              </p>
            </div>
          )}
          {/* Statuses Section */}
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                {selectedStatusType.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} Statuses
              </h3>
              <CustomSelect
                value={selectedStatusType}
                onValueChange={(value: string) => setSelectedStatusType(value as ItemType)}
                options={[
                  { value: 'ticket', label: 'Ticket Statuses' },
                  { value: 'project', label: 'Project Statuses' },
                  { value: 'interaction', label: 'Interaction Statuses' }
                ]}
                className="w-64"
              />
            </div>
            
            <DataTable
              data={statuses.filter(s => s.status_type === selectedStatusType).sort((a, b) => (a.order_number || 0) - (b.order_number || 0))}
              columns={[...getStatusColumns(selectedStatusType), {
                title: 'Actions',
                dataIndex: 'action',
                width: '10%',
                render: (_, item) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        id={`status-actions-menu-${item.status_id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="sr-only">Open menu</span>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        id={`edit-status-${item.status_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingStatus(item);
                          setShowStatusDialog(true);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        id={`delete-status-${item.status_id}`}
                        className="text-red-600 focus:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteStatusRequestWrapper(item.status_id);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ),
              }]}
              pagination={false}
            />
            
            <div className="mt-4 flex gap-2">
              <Button 
                id='add-status-button' 
                onClick={() => {
                  setEditingStatus(null);
                  setShowStatusDialog(true);
                }} 
                className="bg-primary-500 text-white hover:bg-primary-600"
              >
                <Plus className="h-4 w-4 mr-2" /> Add Status
              </Button>
              <Button 
                id='import-statuses-button' 
                onClick={async () => {
                  const available = await getAvailableReferenceData('statuses', { item_type: selectedStatusType });
                  setAvailableReferenceStatuses(available);
                  setSelectedImportStatuses([]);
                  setShowStatusImportDialog(true);
                }} 
                variant="outline"
              >
                Import from Standard Types
              </Button>
            </div>
          </div>
        </div>
      )
    },
    {
      label: "Priorities",
      content: (
        <div>
          {/* Priorities Section with Tabs for Ticket and Project Task */}
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Priorities</h3>
              <CustomSelect
                value={selectedPriorityType}
                onValueChange={(value) => setSelectedPriorityType(value as 'ticket' | 'project_task')}
                options={[
                  { value: 'ticket', label: 'Ticket Priorities' },
                  { value: 'project_task', label: 'Project Task Priorities' }
                ]}
                className="w-64"
              />
            </div>
            
            {/* Info box about priorities */}
            <div className="bg-blue-50 p-4 rounded-md mb-4">
              <p className="text-sm text-blue-700">
                <strong>Priority Management:</strong> Create custom priorities for your organization or import from standard templates. 
                All priorities can be edited or deleted to fit your workflow.
              </p>
            </div>

            <DataTable
              data={priorities.filter(p => p.item_type === selectedPriorityType)}
              columns={[...priorityColumns, {
                title: 'Actions',
                dataIndex: 'action',
                width: '5%',
                render: (_, item) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        id={`priority-actions-menu-${item.priority_id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="sr-only">Open menu</span>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        id={`edit-priority-${item.priority_id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPriority(item as IPriority);
                          setPriorityColor(item.color || '#6B7280');
                          setShowPriorityDialog(true);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        id={`delete-priority-${item.priority_id}`}
                        className="text-red-600 focus:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePriorityRequestWrapper(item.priority_id);
                        }}
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ),
              }]}
              pagination={false}
            />
            
            <div className="mt-4 flex gap-2">
              <Button 
                id='add-priority-button' 
                onClick={() => {
                  setEditingPriority(null);
                  setPriorityColor('#6B7280');
                  setShowPriorityDialog(true);
                }} 
                className="bg-primary-500 text-white hover:bg-primary-600"
              >
                <Plus className="h-4 w-4 mr-2" /> Add Priority
              </Button>
              <Button 
                id='import-priorities-button' 
                onClick={async () => {
                  const available = await getAvailableReferenceData('priorities', { item_type: selectedPriorityType });
                  setAvailableReferencePriorities(available);
                  setSelectedImportPriorities([]);
                  setShowImportDialog(true);
                }} 
                variant="outline"
              >
                Import from Standard Types
              </Button>
            </div>
          </div>
        </div>
      )
    },
    {
      label: "Categories",
      content: (
        <div>
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-800">Categories</h3>
              <CustomSelect
                value={categoryChannelFilter}
                onValueChange={(value: string) => setCategoryChannelFilter(value)}
                options={channelFilterOptions}
                className="w-64"
              />
            </div>
            <DataTable
              data={visibleCategories}
              columns={[...categoryColumns, {
                title: 'Actions',
                dataIndex: 'action',
                width: '5%',
                render: (_, item) => (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        id={`category-actions-menu-${item.category_id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="sr-only">Open menu</span>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {editingCategory === item.category_id ? (
                        <>
                          <DropdownMenuItem
                            id={`save-category-${item.category_id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSaveCategory(item.category_id);
                            }}
                          >
                            Save
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            id={`cancel-edit-category-${item.category_id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingCategory('');
                            }}
                          >
                            Cancel
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          <DropdownMenuItem
                            id={`edit-category-${item.category_id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditCategory(item);
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            id={`add-subcategory-${item.category_id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedParentCategory(item.category_id);
                            }}
                          >
                            Add Subcategory
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            id={`delete-category-${item.category_id}`}
                            className="text-red-600 focus:text-red-600"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCategoryRequestWrapper(item.category_id);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ),
              }]}
              pagination={true}
            />
            <div className="flex space-x-2 mt-4">
              <Input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder={selectedParentCategory ? "New Subcategory" : "New Category"}
                className="flex-grow"
              />
              <Button 
                id='add-button'
                onClick={addCategory} 
                className="bg-primary-500 text-white hover:bg-primary-600"
                disabled={!newCategory.trim()}
              >
                <Plus className="h-4 w-4 mr-2" /> Add
              </Button>
            </div>
            {selectedParentCategory && (
              <div className="mt-2 text-sm text-gray-500">
                Adding subcategory to: {categories.find(c => c.category_id === selectedParentCategory)?.category_name}
                <Button
                  id='cancel-button'
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedParentCategory('')}
                  className="ml-2"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="p-6 bg-gray-100 min-h-screen">
      <h2 className="text-xl font-bold mb-4 text-gray-800">Ticket Settings</h2>
      <CustomTabs tabs={tabs} defaultTab="Categories" />

      {/* Generic Confirmation Dialog */}
      <ConfirmationDialog
        id="delete-item-dialog"
        isOpen={showDeleteDialog}
        onClose={() => {
          setShowDeleteDialog(false);
          setItemToDelete(null);
          setItemTypeToDelete(null);
        }}
        onConfirm={confirmDeleteItem}
        title={`Delete ${itemTypeToDelete ? itemTypeToDelete.charAt(0).toUpperCase() + itemTypeToDelete.slice(1) : 'Item'}`}
        message={`Are you sure you want to delete this ${itemTypeToDelete || 'item'}? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
      
      {/* Priority Add/Edit Dialog */}
      <Dialog
        isOpen={showPriorityDialog}
        onClose={() => setShowPriorityDialog(false)}
        title={editingPriority ? 'Edit Priority' : 'Add New Priority'}
        className="max-w-lg max-w-[90vw]"
        id="priority-dialog"
      >
        <DialogContent>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const name = formData.get('name') as string;
              const level = parseInt(formData.get('level') as string);
              
              try {
                // Check if order number is already taken
                const existingWithOrder = priorities.find(p => 
                  'item_type' in p &&
                  p.item_type === selectedPriorityType && 
                  p.order_number === level &&
                  p.priority_id !== editingPriority?.priority_id
                );
                
                if (existingWithOrder) {
                  toast.error(`Order number ${level} is already taken by "${existingWithOrder.priority_name}". Please choose a different order number.`);
                  return;
                }
                
                if (editingPriority) {
                  await updatePriorityItem({
                    ...editingPriority,
                    priority_name: name,
                    order_number: level,
                    color: priorityColor
                  });
                } else {
                  await createPriority({
                    priority_name: name,
                    order_number: level,
                    color: priorityColor,
                    item_type: selectedPriorityType,
                    created_by: userId,
                    created_at: new Date()
                  });
                }
                
                // Refresh priorities list
                const updatedPriorities = await getAllPriorities();
                setPriorities(updatedPriorities);
                
                setShowPriorityDialog(false);
                setEditingPriority(null);
                setPriorityColor('#6B7280');
              } catch (error) {
                console.error('Error saving priority:', error);
                if (error instanceof Error && error.message.includes('unique constraint')) {
                  toast.error('This order number is already in use. Please choose a different order number.');
                } else {
                  toast.error('Failed to save priority');
                }
              }
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Priority Name
                  </label>
                  <Input
                    name="name"
                    defaultValue={editingPriority?.priority_name || ''}
                    required
                    placeholder="e.g., Urgent"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Order Number (1-100, higher numbers appear first)
                  </label>
                  <Input
                    name="level"
                    type="number"
                    min="1"
                    max="100"
                    defaultValue={editingPriority?.order_number || (() => {
                      // Suggest next available order number
                      const prioritiesOfType = priorities.filter(p => 
                        'item_type' in p && p.item_type === selectedPriorityType
                      );
                      const maxOrder = Math.max(...prioritiesOfType.map(p => p.order_number || 0), 0);
                      return Math.min(maxOrder + 10, 100);
                    })()}
                    required
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    {(() => {
                      const prioritiesOfType = priorities.filter(p => 
                        'item_type' in p && p.item_type === selectedPriorityType
                      );
                      const usedOrders = prioritiesOfType
                        .filter(p => p.priority_id !== editingPriority?.priority_id)
                        .map(p => p.order_number)
                        .filter(n => n !== null && n !== undefined)
                        .sort((a, b) => a - b);
                      if (usedOrders.length > 0) {
                        return `Used order numbers: ${usedOrders.join(', ')}`;
                      }
                      return 'No order numbers used yet';
                    })()}
                  </p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Color
                  </label>
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-10 h-10 rounded border border-gray-300" 
                      style={{ backgroundColor: priorityColor }}
                    />
                    <ColorPicker
                      currentBackgroundColor={priorityColor}
                      currentTextColor="#FFFFFF"
                      onSave={(backgroundColor) => {
                        if (backgroundColor) {
                          setPriorityColor(backgroundColor);
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
                    <span className="text-sm text-gray-600">{priorityColor}</span>
                  </div>
                </div>
              </div>
              
              <DialogFooter>
                <Button
                  id="cancel-priority-dialog"
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowPriorityDialog(false);
                    setEditingPriority(null);
                    setPriorityColor('#6B7280');
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  id="submit-priority-dialog"
                  type="submit" 
                  variant="default"
                >
                  {editingPriority ? 'Update' : 'Add'} Priority
                </Button>
              </DialogFooter>
            </form>
        </DialogContent>
      </Dialog>

      {/* Import Priorities Dialog */}
      <Dialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        title="Import Standard Priorities"
        className="max-w-lg"
        id="import-priorities-dialog"
      >
        <DialogContent>
          {availableReferencePriorities.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">All standard priorities have already been imported for {selectedPriorityType === 'ticket' ? 'tickets' : 'project tasks'}.</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Select the standard priorities you want to import. These will be copied to your organization's priorities.
              </p>
              
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {availableReferencePriorities.map((priority) => (
                  <div
                    key={priority.priority_id}
                    className="flex items-center p-3 border rounded-lg hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      id={`import-priority-${priority.priority_id}`}
                      checked={selectedImportPriorities.includes(priority.priority_id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedImportPriorities([...selectedImportPriorities, priority.priority_id]);
                        } else {
                          setSelectedImportPriorities(selectedImportPriorities.filter(id => id !== priority.priority_id));
                        }
                      }}
                      className="mr-3"
                    />
                    <label
                      htmlFor={`import-priority-${priority.priority_id}`}
                      className="flex-1 flex items-center justify-between cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-4 h-4 rounded"
                          style={{ backgroundColor: priority.color }}
                        />
                        <span className="font-medium">{priority.priority_name}</span>
                      </div>
                      <span className="text-sm text-gray-500">Order: {priority.order_number}</span>
                    </label>
                  </div>
                ))}
              </div>
              
              <div className="mt-4 flex items-center gap-2">
                <Button
                  id="import-priorities-select-all"
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedImportPriorities(availableReferencePriorities.map(p => p.priority_id))}
                >
                  Select All
                </Button>
                <Button
                  id="import-priorities-clear-selection"
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedImportPriorities([])}
                >
                  Clear Selection
                </Button>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button
              id="cancel-import-dialog"
              variant="outline"
              onClick={() => {
                setShowImportDialog(false);
                setSelectedImportPriorities([]);
              }}
            >
              Cancel
            </Button>
            <Button
              id="import-selected-priorities"
              variant="default"
              disabled={selectedImportPriorities.length === 0}
              onClick={async () => {
                try {
                  // Check for conflicts first
                  const conflicts = await checkImportConflicts(
                    'priorities',
                    selectedImportPriorities,
                    { item_type: selectedPriorityType }
                  );
                  
                  if (conflicts.length > 0) {
                    // Show conflict resolution dialog
                    setImportConflicts(conflicts);
                    setCurrentImportType('priorities');
                    setConflictResolutions({});
                    setShowConflictDialog(true);
                    setShowImportDialog(false);
                  } else {
                    // No conflicts, proceed with import
                    const result = await importReferenceData(
                      'priorities',
                      selectedImportPriorities,
                      { item_type: selectedPriorityType }
                    );
                    
                    if (result.imported.length > 0) {
                      toast.success(`Successfully imported ${result.imported.length} priorities`);
                      // Refresh priorities list
                      const updatedPriorities = await getAllPriorities();
                      setPriorities(updatedPriorities);
                    }
                    
                    if (result.skipped.length > 0) {
                      toast.error(`Skipped ${result.skipped.length} priorities (already exist)`);
                    }
                    
                    setShowImportDialog(false);
                    setSelectedImportPriorities([]);
                  }
                } catch (error) {
                  console.error('Error importing priorities:', error);
                  toast.error('Failed to import priorities');
                }
              }}
            >
              Import ({selectedImportPriorities.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Add/Edit Dialog */}
      <Dialog
        isOpen={showStatusDialog}
        onClose={() => setShowStatusDialog(false)}
        title={editingStatus ? 'Edit Status' : 'Add New Status'}
        className="max-w-lg"
        id="status-dialog"
      >
        <DialogContent>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            const name = formData.get('name') as string;
            const orderNumber = parseInt(formData.get('orderNumber') as string);
            const isClosed = formData.get('isClosed') === 'true';
            const isDefault = selectedStatusType === 'ticket' ? formData.get('isDefault') === 'true' : false;
            
            try {
              // Check if order number is already taken
              const existingWithOrder = statuses.find(s => 
                s.status_type === selectedStatusType && 
                s.order_number === orderNumber &&
                s.status_id !== editingStatus?.status_id
              );
              
              if (existingWithOrder) {
                toast.error(`Order number ${orderNumber} is already taken by "${existingWithOrder.name}". Please choose a different order number.`);
                return;
              }
              
              if (editingStatus) {
                await updateStatusItem({
                  ...editingStatus,
                  name: name,
                  order_number: orderNumber,
                  is_closed: isClosed,
                  is_default: isDefault
                });
              } else {
                await createStatus({
                  name: name,
                  status_type: selectedStatusType,
                  order_number: orderNumber,
                  is_closed: isClosed,
                  is_default: isDefault,
                  created_by: userId
                });
              }
              
              // Refresh statuses list
              const updatedStatuses = await getStatuses(selectedStatusType);
              setStatuses(updatedStatuses);
              
              setShowStatusDialog(false);
              setEditingStatus(null);
            } catch (error) {
              console.error('Error saving status:', error);
              if (error instanceof Error && error.message.includes('unique_tenant_type_order')) {
                toast.error('This order number is already in use. Please choose a different order number.');
              } else {
                toast.error('Failed to save status');
              }
            }
          }}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Status Name
                </label>
                <Input
                  name="name"
                  defaultValue={editingStatus?.name || ''}
                  required
                  placeholder="e.g., In Progress"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Order Number (1-100, lower numbers appear first)
                </label>
                <Input
                  name="orderNumber"
                  type="number"
                  min="1"
                  max="100"
                  defaultValue={editingStatus?.order_number || (() => {
                    // Suggest next available order number
                    const statusesOfType = statuses.filter(s => s.status_type === selectedStatusType);
                    const maxOrder = Math.max(...statusesOfType.map(s => s.order_number || 0), 0);
                    return Math.min(maxOrder + 10, 100);
                  })()}
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  {(() => {
                    const statusesOfType = statuses.filter(s => s.status_type === selectedStatusType);
                    const usedOrders = statusesOfType
                      .filter(s => s.status_id !== editingStatus?.status_id)
                      .map(s => s.order_number)
                      .filter(n => n !== null && n !== undefined)
                      .sort((a, b) => a - b);
                    if (usedOrders.length > 0) {
                      return `Used order numbers: ${usedOrders.join(', ')}`;
                    }
                    return 'No order numbers used yet';
                  })()}
                </p>
              </div>
              
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    name="isClosed"
                    id="status-is-closed"
                    value="true"
                    defaultChecked={editingStatus?.is_closed || false}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="status-is-closed" className="text-sm text-gray-700">
                    Mark as closed status
                  </label>
                </div>
                
                {selectedStatusType === 'ticket' && (
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      name="isDefault"
                      id="status-is-default"
                      value="true"
                      defaultChecked={editingStatus?.is_default || false}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                    />
                    <label htmlFor="status-is-default" className="text-sm text-gray-700">
                      Set as default status for new tickets
                    </label>
                  </div>
                )}
              </div>
            </div>
            
            <DialogFooter>
              <Button
                id="cancel-status-dialog"
                type="button"
                variant="outline"
                onClick={() => {
                  setShowStatusDialog(false);
                  setEditingStatus(null);
                }}
              >
                Cancel
              </Button>
              <Button 
                id="submit-status-dialog"
                type="submit" 
                variant="default"
              >
                {editingStatus ? 'Update' : 'Add'} Status
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Import Statuses Dialog */}
      <Dialog
        isOpen={showStatusImportDialog}
        onClose={() => setShowStatusImportDialog(false)}
        title="Import Standard Statuses"
        className="max-w-lg"
        id="import-statuses-dialog"
      >
        <DialogContent>
          {availableReferenceStatuses.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">All standard statuses have already been imported for {selectedStatusType}s.</p>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Select the standard statuses you want to import. These will be copied to your organization's statuses.
              </p>
              
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {availableReferenceStatuses.map((status) => (
                  <div
                    key={status.standard_status_id}
                    className="flex items-center p-3 border rounded-lg hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      id={`import-status-${status.standard_status_id}`}
                      checked={selectedImportStatuses.includes(status.standard_status_id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedImportStatuses([...selectedImportStatuses, status.standard_status_id]);
                        } else {
                          setSelectedImportStatuses(selectedImportStatuses.filter(id => id !== status.standard_status_id));
                        }
                      }}
                      className="mr-3"
                    />
                    <label
                      htmlFor={`import-status-${status.standard_status_id}`}
                      className="flex-1 flex items-center justify-between cursor-pointer"
                    >
                      <div>
                        <span className="font-medium">{status.name}</span>
                        {status.is_closed && (
                          <span className="ml-2 text-sm text-gray-500">(Closed)</span>
                        )}
                      </div>
                      <span className="text-sm text-gray-500">Order: {status.display_order}</span>
                    </label>
                  </div>
                ))}
              </div>
              
              <div className="mt-4 flex items-center gap-2">
                <Button
                  id="import-statuses-select-all"
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedImportStatuses(availableReferenceStatuses.map(s => s.standard_status_id))}
                >
                  Select All
                </Button>
                <Button
                  id="import-statuses-clear-selection"
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedImportStatuses([])}
                >
                  Clear Selection
                </Button>
              </div>
            </div>
          )}
          
          <DialogFooter>
            <Button
              id="cancel-import-statuses-dialog"
              variant="outline"
              onClick={() => {
                setShowStatusImportDialog(false);
                setSelectedImportStatuses([]);
              }}
            >
              Cancel
            </Button>
            <Button
              id="import-selected-statuses"
              variant="default"
              disabled={selectedImportStatuses.length === 0}
              onClick={async () => {
                try {
                  // Check for conflicts first
                  const conflicts = await checkImportConflicts(
                    'statuses',
                    selectedImportStatuses,
                    { item_type: selectedStatusType }
                  );
                  
                  console.log('Status import conflicts:', conflicts);
                  
                  if (conflicts.length > 0) {
                    // Show conflict resolution dialog
                    setImportConflicts(conflicts);
                    setCurrentImportType('statuses');
                    setConflictResolutions({});
                    setShowConflictDialog(true);
                    setShowStatusImportDialog(false);
                  } else {
                    // No conflicts, proceed with import
                    const result = await importReferenceData(
                      'statuses',
                      selectedImportStatuses,
                      { item_type: selectedStatusType }
                    );
                    
                    if (result.imported.length > 0) {
                      toast.success(`Successfully imported ${result.imported.length} statuses`);
                      // Refresh statuses list
                      const updatedStatuses = await getStatuses(selectedStatusType);
                      setStatuses(updatedStatuses);
                    }
                    
                    if (result.skipped.length > 0) {
                      const skippedReasons = result.skipped.map(s => `${s.name}: ${s.reason}`).join('\n');
                      console.log('Skipped statuses:', skippedReasons);
                      toast.error(`Skipped ${result.skipped.length} statuses (${result.skipped[0].reason})`);
                    }
                    
                    setShowStatusImportDialog(false);
                    setSelectedImportStatuses([]);
                  }
                } catch (error) {
                  console.error('Error importing statuses:', error);
                  toast.error('Failed to import statuses');
                }
              }}
            >
              Import ({selectedImportStatuses.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conflict Resolution Dialog */}
      <Dialog
        isOpen={showConflictDialog}
        onClose={() => {
          setShowConflictDialog(false);
          setImportConflicts([]);
          setConflictResolutions({});
        }}
        title="Resolve Import Conflicts"
        className="max-w-2xl"
        id="conflict-resolution-dialog"
      >
        <DialogContent>
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              The following items have conflicts with existing data. Choose how to resolve each conflict:
            </p>
            
            {(() => {
              // Group conflicts by item ID
              const conflictsByItem = importConflicts.reduce((acc, conflict) => {
                const itemId = conflict.referenceItem.id || conflict.referenceItem.priority_id || conflict.referenceItem.standard_status_id || conflict.referenceItem.status_id;
                if (!acc[itemId]) {
                  acc[itemId] = {
                    item: conflict.referenceItem,
                    conflicts: []
                  };
                }
                acc[itemId].conflicts.push(conflict);
                return acc;
              }, {} as Record<string, { item: any, conflicts: ImportConflict[] }>);

              return Object.entries(conflictsByItem).map(([itemId, { item, conflicts }]) => {
                const itemName = item.name || item.priority_name;
                const resolution = conflictResolutions[itemId] || { action: 'skip' };
                const hasNameConflict = conflicts.some(c => c.conflictType === 'name');
                const hasOrderConflict = conflicts.some(c => c.conflictType === 'order');
                const orderConflict = conflicts.find(c => c.conflictType === 'order');
                
                return (
                  <div key={itemId} className="border rounded-lg p-4 space-y-3">
                    <div className="font-medium">
                      {itemName}
                      {hasOrderConflict && (
                        <span className="text-sm text-gray-500 ml-2">
                          (Order: {item.order_number || item.display_order})
                        </span>
                      )}
                    </div>
                    
                    <div className="text-sm text-gray-600 space-y-1">
                      {hasNameConflict && <div>• An item with this name already exists.</div>}
                      {hasOrderConflict && <div>• Order number {item.order_number || item.display_order} is already taken.</div>}
                    </div>
                    
                    <div className="space-y-2">
                      <label className="flex items-center space-x-2">
                        <input
                          type="radio"
                          name={`conflict-${itemId}`}
                          value="skip"
                          checked={resolution.action === 'skip'}
                          onChange={() => {
                            setConflictResolutions({
                              ...conflictResolutions,
                              [itemId]: { action: 'skip' }
                            });
                          }}
                        />
                        <span>Skip this item</span>
                      </label>
                      
                      {hasNameConflict && (
                        <label className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name={`conflict-${itemId}`}
                            value="rename"
                            checked={resolution.action === 'rename'}
                            onChange={() => {
                              setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { action: 'rename', newName: `${itemName} (Imported)` }
                              });
                            }}
                          />
                          <span>Import with different name:</span>
                          {resolution.action === 'rename' && (
                            <Input
                              value={resolution.newName || ''}
                              onChange={(e) => {
                                setConflictResolutions({
                                  ...conflictResolutions,
                                  [itemId]: { ...resolution, newName: e.target.value }
                                });
                              }}
                              className="ml-2 w-64"
                            />
                          )}
                        </label>
                      )}
                      
                      {hasOrderConflict && !hasNameConflict && (
                        <label className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name={`conflict-${itemId}`}
                            value="reorder"
                            checked={resolution.action === 'reorder'}
                            onChange={() => {
                              setConflictResolutions({
                                ...conflictResolutions,
                                [itemId]: { action: 'reorder', newOrder: orderConflict?.suggestedOrder }
                              });
                            }}
                          />
                          <span>Import with different order:</span>
                          {resolution.action === 'reorder' && (
                            <Input
                              type="number"
                              value={resolution.newOrder || orderConflict?.suggestedOrder || 0}
                              onChange={(e) => {
                                setConflictResolutions({
                                  ...conflictResolutions,
                                  [itemId]: { ...resolution, newOrder: parseInt(e.target.value) }
                                });
                              }}
                              className="ml-2 w-24"
                            />
                          )}
                        </label>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button
            id="cancel-conflict-resolution"
            variant="destructive"
            onClick={() => {
              setShowConflictDialog(false);
              setImportConflicts([]);
              setConflictResolutions({});
              // Reopen the original import dialog
              if (currentImportType === 'priorities') {
                setShowImportDialog(true);
              } else {
                setShowStatusImportDialog(true);
              }
            }}
          >
            Cancel
          </Button>
          <Button
            id="apply-conflict-resolution"
            variant="default"
            onClick={async () => {
              try {
                const itemIds = currentImportType === 'priorities' ? selectedImportPriorities : selectedImportStatuses;
                const filters = currentImportType === 'priorities' 
                  ? { item_type: selectedPriorityType } 
                  : { item_type: selectedStatusType };
                
                const result = await importReferenceData(
                  currentImportType,
                  itemIds,
                  filters,
                  conflictResolutions
                );
                
                if (result.imported.length > 0) {
                  toast.success(`Successfully imported ${result.imported.length} ${currentImportType}`);
                  
                  // Refresh the appropriate list
                  if (currentImportType === 'priorities') {
                    const updatedPriorities = await getAllPriorities();
                    setPriorities(updatedPriorities);
                    setSelectedImportPriorities([]);
                  } else {
                    const updatedStatuses = await getStatuses(selectedStatusType);
                    setStatuses(updatedStatuses);
                    setSelectedImportStatuses([]);
                  }
                }
                
                if (result.skipped.length > 0) {
                  const skippedNames = result.skipped.map(s => s.name).join(', ');
                  toast(`Skipped: ${skippedNames}`, {
                    icon: 'ℹ️',
                    duration: 4000,
                  });
                }
                
                setShowConflictDialog(false);
                setImportConflicts([]);
                setConflictResolutions({});
              } catch (error) {
                console.error(`Error importing ${currentImportType}:`, error);
                toast.error(`Failed to import ${currentImportType}`);
              }
            }}
          >
            Apply and Import
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
};

export default TicketingSettings;