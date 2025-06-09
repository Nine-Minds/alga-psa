'use client';

import React, { useState, useEffect, useRef } from 'react';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Plus, X, Edit2, ChevronRight, ChevronDown, Network, Search, MoreVertical } from "lucide-react"; 
import { getAllChannels, createChannel, deleteChannel, updateChannel } from 'server/src/lib/actions/channel-actions/channelActions';
import { getStatuses, createStatus, deleteStatus, updateStatus } from 'server/src/lib/actions/status-actions/statusActions';
import { getAllPriorities, getAllPrioritiesWithStandard, createPriority, deletePriority, updatePriority } from 'server/src/lib/actions/priorityActions';
import { getTicketCategories, createTicketCategory, deleteTicketCategory, updateTicketCategory } from 'server/src/lib/actions/ticketCategoryActions';
import { IChannel } from 'server/src/interfaces/channel.interface';
import { IStatus, ItemType } from 'server/src/interfaces/status.interface';
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
import * as Dialog from '@radix-ui/react-dialog';

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
          getAllPrioritiesWithStandard(),
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
      },
      {
        title: 'Status',
        dataIndex: 'is_closed',
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
                ? `${type === 'project' ? 'Projects' : 'Tickets'} with this status will be marked as closed` 
                : `${type === 'project' ? 'Projects' : 'Tickets'} with this status will remain open`
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
          {/* Setting Section */}
          <SettingSection<IStatus>
            title={`${selectedStatusType.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} Statuses`}
            items={statuses}
            newItem={newStatus}
            setNewItem={setNewStatus}
            addItem={addStatus}
            updateItem={updateStatusItem}
            deleteItem={handleDeleteStatusRequestWrapper}
            getItemName={(status) => status.name}
            getItemKey={(status) => status.status_id || ''}
            columns={getStatusColumns(selectedStatusType)}
            headerControls={
              <CustomSelect
                value={selectedStatusType}
                onValueChange={(value: string) => setSelectedStatusType(value as ItemType)}
                options={[
                  { value: 'ticket', label: 'Ticket Statuses' },
                  { value: 'project', label: 'Project Statuses' }
                ]}
                className="w-64"
              />
            }
          />
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
            
            {/* Info box about standard priorities */}
            <div className="bg-blue-50 p-4 rounded-md mb-4">
              <p className="text-sm text-blue-700">
                <strong>Standard Priorities:</strong> System-defined priorities cannot be edited or deleted. 
                You can create custom priorities specific to your organization that will appear alongside standard ones.
              </p>
            </div>

            <DataTable
              data={priorities.filter(p => p.item_type === selectedPriorityType)}
              columns={[...priorityColumns, {
                title: 'Actions',
                dataIndex: 'action',
                width: '5%',
                render: (_, item) => (
                  'tenant' in item ? (
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
                  ) : (
                    <span className="text-xs text-gray-400">System</span>
                  )
                ),
              }]}
              pagination={false}
            />
            
            <div className="mt-4">
              <Button 
                id='add-priority-button' 
                onClick={() => {
                  setEditingPriority(null);
                  setShowPriorityDialog(true);
                }} 
                className="bg-primary-500 text-white hover:bg-primary-600"
              >
                <Plus className="h-4 w-4 mr-2" /> Add Priority
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
      <Dialog.Root open={showPriorityDialog} onOpenChange={setShowPriorityDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg p-6 w-[500px] max-w-[90vw]">
            <Dialog.Title className="text-lg font-semibold mb-4">
              {editingPriority ? 'Edit Priority' : 'Add New Priority'}
            </Dialog.Title>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const name = formData.get('name') as string;
              const level = parseInt(formData.get('level') as string);
              const color = formData.get('color') as string;
              
              if (editingPriority) {
                await updatePriorityItem({
                  ...editingPriority,
                  priority_name: name,
                  order_number: level,
                  color: color
                });
              } else {
                await createPriority({
                  priority_name: name,
                  order_number: level,
                  color: color,
                  item_type: selectedPriorityType,
                  created_by: userId,
                  created_at: new Date()
                });
                // Refresh priorities list
                const updatedPriorities = await getAllPrioritiesWithStandard();
                setPriorities(updatedPriorities);
              }
              
              setShowPriorityDialog(false);
              setEditingPriority(null);
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
                    defaultValue={editingPriority?.order_number || 50}
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Color
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      name="color"
                      type="color"
                      defaultValue={editingPriority?.color || '#6B7280'}
                      className="h-10 w-20"
                      required
                    />
                    <Input
                      type="text"
                      value={editingPriority?.color || '#6B7280'}
                      readOnly
                      className="flex-1"
                    />
                  </div>
                </div>
              </div>
              
              <div className="flex justify-end gap-2 mt-6">
                <Button
                  id="cancel-priority-dialog"
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowPriorityDialog(false);
                    setEditingPriority(null);
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
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
};

export default TicketingSettings;