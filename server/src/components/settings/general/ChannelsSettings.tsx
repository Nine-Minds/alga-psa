'use client'

import React, { useState, useEffect } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { Plus, MoreVertical, HelpCircle } from "lucide-react";
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
    priority_type: 'custom' as PriorityType,
    is_itil_compliant: false
  });
  
  // State for Import Dialog
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [availableReferenceChannels, setAvailableReferenceChannels] = useState<any[]>([]);

  // State for ITIL Info Modal
  const [showItilInfoModal, setShowItilInfoModal] = useState(false);
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
      priority_type: channel.priority_type || 'custom',
      is_itil_compliant: channel.category_type === 'itil' && channel.priority_type === 'itil'
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

      // For new channels, set category_type and priority_type based on ITIL compliance
      const categoryType = editingChannel ? formData.category_type : (formData.is_itil_compliant ? 'itil' : 'custom');
      const priorityType = editingChannel ? formData.priority_type : (formData.is_itil_compliant ? 'itil' : 'custom');

      if (editingChannel) {
        await updateChannel(editingChannel.channel_id!, {
          channel_name: formData.channel_name,
          description: formData.description,
          display_order: formData.display_order,
          is_inactive: formData.is_inactive,
          category_type: categoryType,
          priority_type: priorityType
        });
        toast.success('Board updated successfully');
      } else {
        await createChannel({
          channel_name: formData.channel_name,
          description: formData.description,
          display_order: formData.display_order,
          is_inactive: formData.is_inactive,
          category_type: categoryType,
          priority_type: priorityType
        });
        toast.success('Board created successfully');
      }

      setShowAddEditDialog(false);
      setEditingChannel(null);
      setFormData({ channel_name: '', description: '', display_order: 0, is_inactive: false, category_type: 'custom', priority_type: 'custom', is_itil_compliant: false });
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
      title: 'ITIL Board',
      dataIndex: 'category_type',
      render: (_, record: IChannel) => (
        record.category_type === 'itil' && record.priority_type === 'itil' ? (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
            ITIL
          </span>
        ) : (
          <span className="text-gray-500">-</span>
        )
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
              setFormData({ channel_name: '', description: '', display_order: 0, is_inactive: false, category_type: 'custom', priority_type: 'custom', is_itil_compliant: false });
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
          setFormData({ channel_name: '', description: '', display_order: 0, is_inactive: false, category_type: 'custom', priority_type: 'custom', is_itil_compliant: false });
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

            {/* ITIL Configuration - Only show for new channels */}
            {!editingChannel && (
              <div className="border-t pt-4 space-y-4">
                <h4 className="font-medium text-gray-800">Board Configuration</h4>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="is_itil_compliant">Make this board ITIL compliant</Label>
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
                    id="is_itil_compliant"
                    checked={formData.is_itil_compliant}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_itil_compliant: checked })}
                  />
                </div>

              </div>
            )}
          </div>
        </DialogContent>
        <DialogFooter>
          <Button 
            id="cancel-channel-dialog"
            variant="outline" 
            onClick={() => {
              setShowAddEditDialog(false);
              setEditingChannel(null);
              setFormData({ channel_name: '', description: '', display_order: 0, is_inactive: false, category_type: 'custom', priority_type: 'custom', is_itil_compliant: false });
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
};

export default ChannelsSettings;