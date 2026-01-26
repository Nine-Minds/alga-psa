'use client';

import React, { useState, useEffect } from 'react';
import { getCurrentTenant } from '@alga-psa/tenancy/actions';
import { Card } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Bell, Search, Filter, Plus, MoreVertical } from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import { Badge } from '@alga-psa/ui/components/Badge';
import { Skeleton } from '@alga-psa/ui/components/Skeleton';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem
} from '@alga-psa/ui/components/DropdownMenu';
import { toast } from 'react-hot-toast';
import {
  getEventCatalogEntries,
  getEventCategories
} from '../../actions';
import {
  getWorkflowEventAttachmentsForEventType,
  deleteWorkflowEventAttachment,
  updateWorkflowEventAttachment
} from '../../actions/workflow-event-attachment-actions';
import {
  IEventCatalogEntry,
  IWorkflowEventAttachment
} from '@alga-psa/shared/workflow/types/eventCatalog';
import { Dialog, DialogContent, DialogFooter } from '@alga-psa/ui/components/Dialog';
import EventTriggerDialog from '../events-catalog/EventTriggerDialog';

export default function EventsCatalog() {
  const [events, setEvents] = useState<IEventCatalogEntry[]>([]);
  const [filteredEvents, setFilteredEvents] = useState<IEventCatalogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [eventAttachments, setEventAttachments] = useState<Record<string, (IWorkflowEventAttachment & { isSystemManaged?: boolean })[]>>({}); // Include isSystemManaged

  // Dialog states
  const [selectedEvent, setSelectedEvent] = useState<IEventCatalogEntry | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDetachDialogOpen, setIsDetachDialogOpen] = useState(false);
  const [selectedAttachment, setSelectedAttachment] = useState<IWorkflowEventAttachment | null>(null);

  // Load events and categories
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        
        // Load events
        const tenant = await getCurrentTenant();
        const eventsData = await getEventCatalogEntries({ tenant: tenant || '' });
        setEvents(eventsData);
        setFilteredEvents(eventsData);
        // Load categories
        const categoriesData = await getEventCategories({ tenant: tenant || '' });
        setCategories(categoriesData);
        
        // Load attachments for each event
        const attachmentsMap: Record<string, (IWorkflowEventAttachment & { isSystemManaged?: boolean })[]> = {}; // Include isSystemManaged
        for (const event of eventsData) {
          const attachments = await getWorkflowEventAttachmentsForEventType({
            eventType: event.event_type,
            tenant: tenant || '',
            isActive: true
          });
          attachmentsMap[event.event_id] = attachments;
        }
        setEventAttachments(attachmentsMap);
      } catch (error) {
        console.error('Error loading events data:', error);
        toast.error('Failed to load events data');
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, []);

  // Filter events based on search query and category
  useEffect(() => {
    let filtered = events;
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        event =>
          event.name.toLowerCase().includes(query) ||
          (event.description && event.description.toLowerCase().includes(query))
      );
    }
    
    // Filter by category
    if (selectedCategory) {
      filtered = filtered.filter(event => event.category === selectedCategory);
    }
    
    setFilteredEvents(filtered);
  }, [searchQuery, selectedCategory, events]);

  // Handle attach workflow
  const handleAttachWorkflow = (event: IEventCatalogEntry) => {
    setSelectedEvent(event);
    setIsDialogOpen(true);
  };

  // Handle dialog close
  const handleDialogClose = (refreshData: boolean = false) => {
    setIsDialogOpen(false);
    setSelectedEvent(null);
    
    // Refresh data if needed
    if (refreshData) {
      setIsLoading(true);
      getCurrentTenant().then((tenant) => {
        getEventCatalogEntries({ tenant: tenant || '' })
        .then(eventsData => {
          setEvents(eventsData);
          setFilteredEvents(eventsData);
          
          // Refresh attachments for each event
          const loadAttachments = async () => {
            const attachmentsMap: Record<string, (IWorkflowEventAttachment & { isSystemManaged?: boolean })[]> = {}; // Include isSystemManaged
            for (const event of eventsData) {
              const attachments = await getWorkflowEventAttachmentsForEventType({
                eventType: event.event_type,
                tenant: tenant || '',
                isActive: true
              });
              attachmentsMap[event.event_id] = attachments;
            }
            setEventAttachments(attachmentsMap);
            setIsLoading(false);
          };
          
          loadAttachments();
        })
        .catch(error => {
          console.error('Error refreshing events data:', error);
          toast.error('Failed to refresh events data');
          setIsLoading(false);
        });
      });
    }
  };
  
  // Handle detach workflow
  const handleDetachWorkflow = (attachment: IWorkflowEventAttachment) => {
    setSelectedAttachment(attachment);
    setIsDetachDialogOpen(true);
  };
  
  // Handle confirm detach
  const handleConfirmDetach = async () => {
    if (!selectedAttachment) return;
    
    try {
      setIsLoading(true);
      
      // Delete the attachment
      const tenant = await getCurrentTenant();
      await deleteWorkflowEventAttachment({
        attachmentId: selectedAttachment.attachment_id,
        tenant: tenant || ''
      });
      
      toast.success('Workflow detached successfully');
      
      // Refresh data
      const eventsData = await getEventCatalogEntries({ tenant: tenant || '' });
      setEvents(eventsData);
      setFilteredEvents(eventsData);
      
      // Refresh attachments for each event
      const attachmentsMap: Record<string, (IWorkflowEventAttachment & { isSystemManaged?: boolean })[]> = {}; // Include isSystemManaged
      for (const event of eventsData) {
        const attachments = await getWorkflowEventAttachmentsForEventType({
          eventType: event.event_type,
          tenant: tenant || '',
          isActive: true
        });
        attachmentsMap[event.event_id] = attachments;
      }
      setEventAttachments(attachmentsMap);
    } catch (error) {
      console.error('Error detaching workflow:', error);
      toast.error('Failed to detach workflow');
    } finally {
      setIsLoading(false);
      setIsDetachDialogOpen(false);
      setSelectedAttachment(null);
    }
  };
  
  // Handle toggle workflow active state
  const handleToggleWorkflowActive = async (attachment: IWorkflowEventAttachment) => {
    try {
      setIsLoading(true);
      
      // Update the attachment
      const tenant = await getCurrentTenant();
      await updateWorkflowEventAttachment({
        attachmentId: attachment.attachment_id,
        tenant: tenant || '',
        data: {
          is_active: !attachment.is_active
        }
      });
      
      toast.success(`Workflow ${attachment.is_active ? 'deactivated' : 'activated'} successfully`);
      
      // Refresh data
      const eventsData = await getEventCatalogEntries({ tenant: tenant || '' });
      setEvents(eventsData);
      setFilteredEvents(eventsData);
      
      // Refresh attachments for each event
      const attachmentsMap: Record<string, (IWorkflowEventAttachment & { isSystemManaged?: boolean })[]> = {}; // Include isSystemManaged
      for (const event of eventsData) {
        const attachments = await getWorkflowEventAttachmentsForEventType({
          eventType: event.event_type,
          tenant: tenant || ''
          // Get all attachments, both active and inactive
        });
        attachmentsMap[event.event_id] = attachments;
      }
      setEventAttachments(attachmentsMap);
    } catch (error) {
      console.error('Error toggling workflow active state:', error);
      toast.error('Failed to update workflow');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Bell className="h-6 w-6 text-primary-500 mr-2" />
            <h1 className="text-xl font-semibold">Events Catalog</h1>
          </div>
          <div className="flex items-center space-x-4">
            <div className="relative w-64">
              <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                id="search-events-input"
                placeholder="Search events..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            {categories.length > 0 && (
              <div className="flex items-center space-x-2">
                <Filter className="h-4 w-4 text-gray-500" />
                <select
                  id="category-filter"
                  className="text-sm border border-gray-300 rounded-md p-1"
                  value={selectedCategory || ''}
                  onChange={(e) => setSelectedCategory(e.target.value || null)}
                >
                  <option value="">All Categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
        
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-4 border border-gray-200">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-48 mb-1" />
                    <Skeleton className="h-4 w-64 mb-2" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-8 w-32" />
                </div>
              </Card>
            ))}
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500">No events found matching your criteria.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEvents.map((event) => (
              <Card key={event.event_id} className="p-4 border border-gray-200">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-medium mb-1">{event.name}</h3>
                    <p className="text-gray-600 text-sm mb-2">{event.description}</p>
                    {event.category && (
                      <Badge className="bg-primary-100 text-primary-800">
                        {event.category}
                      </Badge>
                    )}
                  </div>
                  <Button
                    id={`attach-workflow-${event.event_id}-button`}
                    onClick={() => handleAttachWorkflow(event)}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Attach Workflow
                  </Button>
                </div>
                
                {/* Attached workflows */}
                {eventAttachments[event.event_id] && eventAttachments[event.event_id].length > 0 ? (
                  <div className="mt-4 border-t pt-3">
                    <h4 className="text-sm font-medium mb-2">Attached Workflows:</h4>
                    <div className="space-y-2">
                      {eventAttachments[event.event_id].map((attachment) => (
                        <div key={attachment.attachment_id} className="flex justify-between items-center bg-gray-50 p-2 rounded">
                          <div className="flex items-center">
                            <Badge
                              className={`mr-2 ${attachment.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}
                            >
                              {attachment.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                            <div className="text-sm">
                              {attachment.workflow_name} ({attachment.workflow_version})<br />
                              Id: {attachment.workflow_id}
                            </div>
                            {attachment.isSystemManaged && ( // Display badge if workflow is system managed
                              <Badge variant="secondary" className="ml-2">System</Badge>
                            )}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                id={`${attachment.attachment_id}-actions-menu`}
                                variant="ghost"
                                className="h-8 w-8 p-0"
                              >
                                <span className="sr-only">Open menu</span>
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                id={`view-${attachment.attachment_id}-menu-item`}
                              >
                                View Details
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                id={`toggle-${attachment.attachment_id}-menu-item`}
                                onClick={() => handleToggleWorkflowActive(attachment)}
                                disabled={!!attachment.isSystemManaged} // Disable for system workflows
                              >
                                {attachment.is_active ? 'Deactivate' : 'Activate'}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                id={`detach-${attachment.attachment_id}-menu-item`}
                                className={`text-red-600 focus:text-red-600 ${attachment.isSystemManaged ? 'opacity-50 cursor-not-allowed' : ''}`} // Add disabled styling
                                onClick={() => !attachment.isSystemManaged && handleDetachWorkflow(attachment)} // Prevent action if system managed
                                disabled={!!attachment.isSystemManaged} // Disable for system workflows
                              >
                                Detach Workflow
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 border-t pt-3">
                    <p className="text-sm text-gray-500">No workflows attached to this event.</p>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Card>
      
      {/* Event Trigger Dialog */}
      {selectedEvent && (
        <EventTriggerDialog
          isOpen={isDialogOpen}
          onClose={handleDialogClose}
          event={selectedEvent}
        />
      )}
      
      {/* Detach Workflow Confirmation Dialog */}
      <Dialog 
        isOpen={isDetachDialogOpen} 
        onClose={() => setIsDetachDialogOpen(false)} 
        title="Detach Workflow"
      >
        <DialogContent>
          <div className="py-4">
            <p className="text-sm text-gray-500">
              Are you sure you want to detach this workflow from the event? This will remove the trigger and any parameter mappings.
            </p>
          </div>
          <DialogFooter>
            <Button
              id="cancel-detach-button"
              variant="outline"
              onClick={() => setIsDetachDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              id="confirm-detach-button"
              onClick={handleConfirmDetach}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Detach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
