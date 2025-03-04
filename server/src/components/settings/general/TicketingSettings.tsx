'use client';

import React, { useState, useEffect, useRef } from 'react';
import CustomTabs from 'server/src/components/ui/CustomTabs';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { Plus, X, Edit2, ChevronRight, ChevronDown, Network, Search } from "lucide-react";
import { getAllChannels, createChannel, deleteChannel, updateChannel } from 'server/src/lib/actions/channel-actions/channelActions';
import { getStatuses, createStatus, deleteStatus, updateStatus } from 'server/src/lib/actions/status-actions/statusActions';
import { getAllPriorities, createPriority, deletePriority, updatePriority } from 'server/src/lib/actions/priorityActions';
import { getTicketCategories, createTicketCategory, deleteTicketCategory, updateTicketCategory } from 'server/src/lib/actions/ticketCategoryActions';
import { IChannel } from 'server/src/interfaces/channel.interface';
import { IStatus, ItemType } from 'server/src/interfaces/status.interface';
import { IPriority, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import NumberingSettings from './NumberingSettings';
import { Switch } from 'server/src/components/ui/Switch';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { toast } from 'react-hot-toast';

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
  columns
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
    title: 'Action',
    dataIndex: 'action',
    width: '15%',
    render: (_, item) => (
      <div className="flex items-center justify-end space-x-2">
        {editingItem === item ? (
          <>
            <Button 
              id='save-button'
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                saveEdit();
              }}
            >
              Save
            </Button>
            <Button
              id='cancel-button'
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                cancelEditing();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <Button
              id='edit-button'
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                startEditing(item);
              }}
            >
              <Edit2 className="h-4 w-4" />
            </Button>
            <Button
              id='delete-button'
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                deleteItem(getItemKey(item));
              }}
            >
              <X className="h-4 w-4" />
            </Button>
            {renderExtraActions && renderExtraActions(item)}
          </>
        )}
      </div>
    )
  };

  const allColumns = [...modifiedColumns, actionColumn];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h3 className="text-lg font-semibold mb-4 text-gray-800">{title}</h3>
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
  const [priorities, setPriorities] = useState<IPriority[]>([]);
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
        setPriorities(priorities.map((priority): IPriority =>
          priority.priority_id === updatedPriority.priority_id ? updatedPriority : priority
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

    const handleDeleteChannel = async (channelId: string): Promise<void> => {
      try {
        await deleteChannel(channelId);
        setChannels(channels.filter(channel => channel.channel_id !== channelId));
      } catch (error) {
        console.error('Error deleting channel:', error);
      }
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
                  toast.error('Failed to update default channel');
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
                  toast.error('Failed to update default channel');
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

  const priorityColumns: ColumnDefinition<IPriority>[] = [
    {
      title: 'Name',
      dataIndex: 'priority_name',
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
          <div className="space-y-4">
            <div className="flex justify-end gap-6">
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
            <div className="bg-blue-50 p-4 rounded-md">
              <p className="text-sm text-blue-700">
                <strong>Default Channel:</strong> When clients create tickets through the client portal, 
                they will automatically be assigned to the channel marked as default. Only one channel can 
                be set as default at a time.
              </p>
            </div>
          </div>
          <SettingSection<IChannel>
            title="Channels"
            items={filteredChannels}
            newItem={newChannel}
            setNewItem={setNewChannel}
            addItem={addChannel}
            updateItem={updateChannelItem}
            deleteItem={handleDeleteChannel}
            getItemName={(channel) => channel.channel_name || ''}
            getItemKey={(channel) => channel.channel_id || ''}
            columns={channelColumns}
          />
        </div>
      )
    },
    {
      label: "Statuses",
      content: (
        <div>
          <div className="space-y-4">
            <div className="flex justify-end gap-6">
              <CustomSelect
                value={selectedStatusType}
                onValueChange={(value: string) => setSelectedStatusType(value as ItemType)}
                options={[
                  { value: 'ticket', label: 'Ticket Statuses' },
                  { value: 'project', label: 'Project Statuses' }
                ]}
                className="w-64"
              />
            </div>
            {selectedStatusType === 'ticket' && (
              <div className="bg-blue-50 p-4 rounded-md">
                <p className="text-sm text-blue-700">
                  <strong>Default Status:</strong> When clients create tickets through the client portal, 
                  they will automatically be assigned the status marked as default. Only one status can 
                  be set as default at a time.
                </p>
              </div>
            )}
          </div>
          <SettingSection<IStatus>
            title={`${selectedStatusType.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')} Statuses`}
            items={statuses}
            newItem={newStatus}
            setNewItem={setNewStatus}
            addItem={addStatus}
            updateItem={updateStatusItem}
            deleteItem={handleDeleteStatus}
            getItemName={(status) => status.name}
            getItemKey={(status) => status.status_id || ''}
            columns={getStatusColumns(selectedStatusType)}
          />
        </div>
      )
    },
    {
      label: "Priorities",
      content: (
        <SettingSection<IPriority>
          title="Priorities"
          items={priorities}
          newItem={newPriority}
          setNewItem={setNewPriority}
          addItem={addPriority}
          updateItem={updatePriorityItem}
          deleteItem={handleDeletePriority}
          getItemName={(priority) => priority.priority_name}
          getItemKey={(priority) => priority.priority_id}
          columns={priorityColumns}
        />
      )
    },
    {
      label: "Categories",
      content: (
        <div>
          <div className="flex justify-end mb-4 gap-6">
            <CustomSelect
              value={categoryChannelFilter}
              onValueChange={(value: string) => setCategoryChannelFilter(value)}
              options={channelFilterOptions}
              className="w-64"
            />
          </div>
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h3 className="text-lg font-semibold mb-4 text-gray-800">Categories</h3>
            <DataTable
              data={visibleCategories}
              columns={[...categoryColumns, {
                title: 'Action',
                dataIndex: 'action',
                width: '15%',
                render: (_, item) => (
                  <div className="flex items-center justify-end space-x-2">
                    {editingCategory === item.category_id ? (
                      <>
                        <Button
                          id='save-button'
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveCategory(item.category_id);
                          }}
                        >
                          Save
                        </Button>
                        <Button
                          id='cancel-button'
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingCategory('');
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          id='edit-button'
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditCategory(item);
                          }}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          id='add-subcategory-button'
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedParentCategory(item.category_id);
                          }}
                          title="Add Subcategory"
                        >
                          <Network className="h-4 w-4" />
                        </Button>
                        <Button
                          id='delete-button'
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory(item.category_id);
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
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
      <h2 className="text-2xl font-bold mb-6 text-gray-800">Ticket Settings</h2>
      <CustomTabs tabs={tabs} defaultTab="Categories" />
    </div>
  );
};

export default TicketingSettings;
