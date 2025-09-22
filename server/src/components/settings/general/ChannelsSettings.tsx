'use client'

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical } from "lucide-react";
import { IChannel, CategoryType, PriorityType } from 'server/src/interfaces/channel.interface';
import { 
  getAllChannels, 
  createChannel,
  updateChannel,
  deleteChannel
} from 'server/src/lib/actions/channel-actions/channelActions';
import { getAvailableReferenceData, importReferenceData, checkImportConflicts, ImportConflict } from 'server/src/lib/actions/referenceDataActions';
import { toast } from 'react-hot-toast';
import { Dialog, DialogContent, DialogFooter } from 'server/src/components/ui/Dialog';
import { Input } from 'server/src/components/ui/Input';
import { Label } from 'server/src/components/ui/Label';
import { DataTable } from 'server/src/components/ui/DataTable';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { Switch } from 'server/src/components/ui/Switch';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from 'server/src/components/ui/DropdownMenu';

const ChannelsSettings: React.FC = () => {
  const [channels, setChannels] = useState<IChannel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    isOpen: boolean;
    channelId: string;
    channelName: string;
  }>({
    isOpen: false,
    channelId: '',
    channelName: ''
  });
  
  // State for Add/Edit Dialog
  const [showAddEditDialog, setShowAddEditDialog] = useState(false);
  const [editingChannel, setEditingChannel] = useState<IChannel | null>(null);
  const [formData, setFormData] = useState({
    channel_name: '',
    description: '',
    display_order: 0,
    is_inactive: false,
    category_type: 'custom' as CategoryType,
    priority_type: 'custom' as PriorityType
  });
  
  // State for Import Dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferenceChannels, setAvailableReferenceChannels] = useState<any[]>([]);
  const [selectedImportChannels, setSelectedImportChannels] = useState<string[]>([]);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, { action: 'skip' | 'rename' | 'reorder', newName?: string, newOrder?: number }>>({});

  useEffect(() => {
    fetchChannels();
  }, []);

  const fetchChannels = async () => {
    try {
      const allChannels = await getAllChannels(true);
      setChannels(allChannels);
    } catch (error) {
      console.error('Error fetching channels:', error);
      setError('Failed to fetch boards');
    }
  };

  const startEditing = (channel: IChannel) => {
    setEditingChannel(channel);
    setFormData({
      channel_name: channel.channel_name || '',
      description: channel.description || '',
      display_order: channel.display_order || 0,
      is_inactive: channel.is_inactive,
      category_type: channel.category_type || 'custom',
      priority_type: channel.priority_type || 'custom'
    });
    setShowAddEditDialog(true);
    setError(null);
  };

  const handleDeleteChannel = async () => {
    try {
      await deleteChannel(deleteDialog.channelId);
      toast.success('Board deleted successfully');
      await fetchChannels();
    } catch (error) {
      console.error('Error deleting channel:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete board');
    } finally {
      setDeleteDialog({ isOpen: false, channelId: '', channelName: '' });
    }
  };

  const handleSaveChannel = async () => {
    try {
      if (!formData.channel_name.trim()) {
        setError('Board name is required');
        return;
      }

      if (editingChannel) {
        await updateChannel(editingChannel.channel_id!, {
          channel_name: formData.channel_name,
          description: formData.description,
          display_order: formData.display_order,
          is_inactive: formData.is_inactive,
          category_type: formData.category_type,
          priority_type: formData.priority_type
        });
        toast.success('Board updated successfully');
      } else {
        await createChannel({
          channel_name: formData.channel_name,
          description: formData.description,
          display_order: formData.display_order,
          is_inactive: formData.is_inactive,
          category_type: formData.category_type,
          priority_type: formData.priority_type
        });
        toast.success('Board created successfully');
      }
      
      setShowAddEditDialog(false);
      setEditingChannel(null);
      setFormData({ channel_name: '', description: '', display_order: 0, is_inactive: false, category_type: 'custom', priority_type: 'custom' });
      await fetchChannels();
    } catch (error) {
      console.error('Error saving channel:', error);
      setError(error instanceof Error ? error.message : 'Failed to save board');
    }
  };

  const handleImport = async () => {
    try {
      if (importConflicts.length > 0) {
        await importReferenceData('channels', selectedImportChannels, undefined, conflictResolutions);
      } else {
        const conflicts = await checkImportConflicts('channels', selectedImportChannels);
        if (conflicts.length > 0) {
          setImportConflicts(conflicts);
          return;
        }
        await importReferenceData('channels', selectedImportChannels);
      }
      
      toast.success('Boards imported successfully');
      setShowImportDialog(false);
      setSelectedImportChannels([]);
      setImportConflicts([]);
      setConflictResolutions({});
      await fetchChannels();
    } catch (error) {
      console.error('Error importing channels:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import boards');
    }
  };

  const columns: ColumnDefinition<IChannel>[] = [
    {
      title: 'Name',
      dataIndex: 'channel_name',
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
      title: 'Status',
      dataIndex: 'is_inactive',
      render: (value: boolean, record: IChannel) => (
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-600">
            {value ? 'Inactive' : 'Active'}
          </span>
          <Switch
            checked={!value}
            onCheckedChange={async (checked) => {
              try {
                await updateChannel(record.channel_id!, {
                  is_inactive: !checked
                });
                await fetchChannels();
              } catch (error) {
                console.error('Error updating channel status:', error);
                toast.error('Failed to update board status');
              }
            }}
            className="data-[state=checked]:bg-primary-500"
          />
        </div>
      ),
    },
    {
      title: 'Default',
      dataIndex: 'is_default',
      render: (value: boolean, record: IChannel) => (
        <div className="flex items-center space-x-2">
          <Switch
            checked={value || false}
            onCheckedChange={async (checked) => {
              try {
                if (checked) {
                  // First unset any existing default channels
                  const currentDefault = channels.find(c => c.is_default && c.channel_id !== record.channel_id);
                  if (currentDefault) {
                    await updateChannel(currentDefault.channel_id!, { is_default: false });
                  }
                }
                await updateChannel(record.channel_id!, {
                  is_default: checked
                });
                await fetchChannels();
              } catch (error) {
                console.error('Error updating default channel:', error);
                toast.error('Failed to update default board');
              }
            }}
            className="data-[state=checked]:bg-primary-500"
          />
          {value && (
            <span className="text-xs text-gray-500">
              Default for client portal
            </span>
          )}
        </div>
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
      title: 'Category Type',
      dataIndex: 'category_type',
      render: (value: string) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          value === 'itil'
            ? 'bg-blue-100 text-blue-800'
            : 'bg-gray-100 text-gray-800'
        }`}>
          {value === 'itil' ? 'ITIL' : 'Custom'}
        </span>
      ),
    },
    {
      title: 'Priority Type',
      dataIndex: 'priority_type',
      render: (value: string) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          value === 'itil'
            ? 'bg-blue-100 text-blue-800'
            : 'bg-gray-100 text-gray-800'
        }`}>
          {value === 'itil' ? 'ITIL' : 'Custom'}
        </span>
      ),
    },
    {
      title: 'Actions',
      dataIndex: 'channel_id',
      width: '10%',
      render: (value: string, record: IChannel) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button id="channel-actions-menu" variant="ghost" className="h-8 w-8 p-0">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => startEditing(record)}>
              Edit
            </DropdownMenuItem>
            {!record.is_default && (
              <DropdownMenuItem 
                onClick={() => setDeleteDialog({
                  isOpen: true,
                  channelId: value,
                  channelName: record.channel_name || ''
                })}
                className="text-red-600"
              >
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  ];

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <div>
        <h3 className="text-lg font-semibold mb-4 text-gray-800">Boards</h3>
        <div className="bg-blue-50 p-4 rounded-md mb-4">
          <p className="text-sm text-blue-700">
            <strong>Default Board:</strong> When clients create tickets through the client portal,
            they will automatically be assigned to the board marked as default. Only one board can
            be set as default at a time. Boards help organize tickets by department, team, or workflow type.
          </p>
        </div>
        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <DataTable
          data={channels}
          columns={columns}
        />
        <div className="mt-4 flex gap-2">
          <Button 
            id="add-channel-button"
            onClick={() => {
              setEditingChannel(null);
              setFormData({ channel_name: '', description: '', display_order: 0, is_inactive: false, category_type: 'custom', priority_type: 'custom' });
              setShowAddEditDialog(true);
            }} 
            className="bg-primary-500 text-white hover:bg-primary-600"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Board
          </Button>
          <Button 
            id="import-channels-button"
            variant="outline"
            onClick={async () => {
              try {
                const available = await getAvailableReferenceData('channels');
                setAvailableReferenceChannels(available || []);
                setSelectedImportChannels([]);
                setShowImportDialog(true);
              } catch (error) {
                console.error('Error fetching available channels:', error);
                toast.error('Failed to fetch available boards for import');
              }
            }}
          >
            Import from Standard Boards
          </Button>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={deleteDialog.isOpen}
        onClose={() => setDeleteDialog({ isOpen: false, channelId: '', channelName: '' })}
        onConfirm={handleDeleteChannel}
        title="Delete Board"
        message={`Are you sure you want to delete "${deleteDialog.channelName}"? This action cannot be undone.`}
        confirmLabel="Delete"
      />

      {/* Add/Edit Dialog */}
      <Dialog 
        isOpen={showAddEditDialog} 
        onClose={() => {
          setShowAddEditDialog(false);
          setEditingChannel(null);
          setFormData({ channel_name: '', description: '', display_order: 0, is_inactive: false, category_type: 'custom', priority_type: 'custom' });
          setError(null);
        }} 
        title={editingChannel ? "Edit Board" : "Add Board"}
      >
        <DialogContent>
          <div className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div>
              <Label htmlFor="channel_name">Board Name *</Label>
              <Input
                id="channel_name"
                value={formData.channel_name}
                onChange={(e) => setFormData({ ...formData, channel_name: e.target.value })}
                placeholder="Enter channel name"
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
                Controls the order in which boards appear in dropdown menus throughout the platform. Lower numbers appear first.
              </p>
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="is_inactive">Inactive</Label>
              <Switch
                id="is_inactive"
                checked={formData.is_inactive}
                onCheckedChange={(checked) => setFormData({ ...formData, is_inactive: checked })}
              />
            </div>

            <div className="border-t pt-4 space-y-4">
              <h4 className="font-medium text-gray-800">Ticket Configuration</h4>

              <div>
                <Label htmlFor="category_type">Category Type</Label>
                <CustomSelect
                  value={formData.category_type}
                  onValueChange={(value) => setFormData({ ...formData, category_type: value as CategoryType })}
                  options={[
                    { value: 'custom', label: 'Custom Categories' },
                    { value: 'itil', label: 'ITIL Categories' }
                  ]}
                  placeholder="Select category type"
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Choose whether this board uses custom categories or ITIL-based categorization.
                </p>
              </div>

              <div>
                <Label htmlFor="priority_type">Priority Type</Label>
                <CustomSelect
                  value={formData.priority_type}
                  onValueChange={(value) => setFormData({ ...formData, priority_type: value as PriorityType })}
                  options={[
                    { value: 'custom', label: 'Custom Priorities' },
                    { value: 'itil', label: 'ITIL Priorities (Impact × Urgency)' }
                  ]}
                  placeholder="Select priority type"
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Choose whether this board uses custom priorities or ITIL-based priority calculation from Impact and Urgency.
                </p>
              </div>

            </div>
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-channel-dialog"
            variant="outline" 
            onClick={() => {
              setShowAddEditDialog(false);
              setEditingChannel(null);
              setFormData({ channel_name: '', description: '', display_order: 0, is_inactive: false, category_type: 'custom', priority_type: 'custom' });
              setError(null);
            }}
          >
            Cancel
          </Button>
          <Button id="save-channel-button" onClick={handleSaveChannel}>
            {editingChannel ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Import Dialog */}
      <Dialog 
        isOpen={showImportDialog && importConflicts.length === 0} 
        onClose={() => {
          setShowImportDialog(false);
          setSelectedImportChannels([]);
        }} 
        title="Import Standard Boards"
      >
        <DialogContent>
          <div className="space-y-4">
            {!availableReferenceChannels || availableReferenceChannels.length === 0 ? (
              <p className="text-muted-foreground">No standard boards available to import.</p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Select standard boards to import into your organization:
                </p>
                <div className="border rounded-md">
                  <div className="flex items-center space-x-2 p-2 bg-muted/50 font-medium text-sm border-b">
                    <div className="w-8">
                      <input
                        type="checkbox"
                        checked={availableReferenceChannels.length > 0 && selectedImportChannels.length === availableReferenceChannels.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedImportChannels(availableReferenceChannels.map(ch => ch.id));
                          } else {
                            setSelectedImportChannels([]);
                          }
                        }}
                        className="w-4 h-4"
                      />
                    </div>
                    <div className="flex-1">Name</div>
                    <div className="flex-1">Description</div>
                    <div className="w-20 text-center">Active</div>
                    <div className="w-20 text-center">Default</div>
                    <div className="w-16 text-center">Order</div>
                  </div>
                  <div className="max-h-[300px] overflow-y-auto">
                    {availableReferenceChannels.map((channel) => (
                      <div 
                        key={channel.id} 
                        className="flex items-center space-x-2 p-2 hover:bg-muted/30 border-b"
                      >
                        <div className="w-8">
                          <input
                            type="checkbox"
                            checked={selectedImportChannels.includes(channel.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedImportChannels([...selectedImportChannels, channel.id]);
                              } else {
                                setSelectedImportChannels(selectedImportChannels.filter(id => id !== channel.id));
                              }
                            }}
                            className="w-4 h-4"
                          />
                        </div>
                        <div className="flex-1">{channel.channel_name}</div>
                        <div className="flex-1 text-sm text-muted-foreground">
                          {channel.description || '-'}
                        </div>
                        <div className="w-20 text-center">
                          <Switch
                            checked={!channel.is_inactive}
                            disabled
                            className="data-[state=checked]:bg-primary-500"
                          />
                        </div>
                        <div className="w-20 text-center">
                          <Switch
                            checked={channel.is_default || false}
                            disabled
                            className="data-[state=checked]:bg-primary-500"
                          />
                        </div>
                        <div className="w-16 text-center text-sm text-muted-foreground">
                          {channel.display_order}
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
            id="cancel-import-dialog"
            variant="outline" 
            onClick={() => {
              setShowImportDialog(false);
              setSelectedImportChannels([]);
            }}
          >
            Cancel
          </Button>
          <Button 
            id="import-selected-channels"
            onClick={handleImport} 
            disabled={selectedImportChannels.length === 0}
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
                    <div className="font-medium">{conflict.referenceItem.channel_name}</div>
                    
                    {conflict.conflictType === 'name' && (
                      <div className="space-y-2">
                        <p className="text-sm text-muted-foreground">
                          A board with this name already exists.
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
                                [itemId]: { action: 'rename', newName: conflict.referenceItem.channel_name + ' (2)' }
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
            id="cancel-conflict-dialog"
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

export default ChannelsSettings;