import React, { useState, useEffect } from 'react';
import { Activity, ActivityType } from '../../interfaces/activity.interfaces';
import Drawer from '../ui/Drawer';
import { Button } from '../ui/Button';
import { X, Loader2 } from 'lucide-react';
import { Badge } from '../ui/Badge';
import { ActivityActionMenu } from './ActivityActionMenu';
import { TaskForm } from '../workflow/TaskForm';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import { getTaskDetails } from '../../lib/actions/workflow-actions/taskInboxActions';

interface ActivityDetailsDrawerProps {
  activity: Activity;
  isOpen: boolean;
  onClose: () => void;
  onActionComplete?: () => void;
}

export function ActivityDetailsDrawer({ 
  activity, 
  isOpen, 
  onClose,
  onActionComplete
}: ActivityDetailsDrawerProps) {
  // Format date to a readable format
  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    });
  };

  // Render activity details based on type
  const renderActivityDetails = () => {
    switch (activity.type) {
      case ActivityType.SCHEDULE:
        return renderScheduleDetails();
      case ActivityType.PROJECT_TASK:
        return renderProjectTaskDetails();
      case ActivityType.TICKET:
        return renderTicketDetails();
      case ActivityType.TIME_ENTRY:
        return renderTimeEntryDetails();
      case ActivityType.WORKFLOW_TASK:
        return renderWorkflowTaskDetails();
      default:
        return (
          <div className="bg-gray-50 p-4 rounded-md">
            <p>No details available for this activity type.</p>
          </div>
        );
    }
  };

  // Render schedule-specific details
  const renderScheduleDetails = () => {
    const scheduleActivity = activity as any; // Type assertion for schedule-specific fields
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Time:</span>
          <span className="text-sm">
            {formatDate(scheduleActivity.startDate)} - {formatDate(scheduleActivity.endDate)}
          </span>
        </div>
        {scheduleActivity.workItemId && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Related Item:</span>
            <span className="text-sm">{scheduleActivity.workItemType} #{scheduleActivity.workItemId}</span>
          </div>
        )}
        {scheduleActivity.isRecurring && (
          <div className="flex items-center gap-2">
            <Badge variant="default">Recurring</Badge>
          </div>
        )}
      </div>
    );
  };

  // Render project task-specific details
  const renderProjectTaskDetails = () => {
    const projectTask = activity as any; // Type assertion for project-specific fields
    return (
      <div className="space-y-4">
        {projectTask.projectName && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Project:</span>
            <span className="text-sm">{projectTask.projectName}</span>
          </div>
        )}
        {projectTask.phaseName && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Phase:</span>
            <span className="text-sm">{projectTask.phaseName}</span>
          </div>
        )}
        <div className="flex items-center gap-4">
          {projectTask.estimatedHours !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Estimated:</span>
              <span className="text-sm">{projectTask.estimatedHours}h</span>
            </div>
          )}
          {projectTask.actualHours !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Actual:</span>
              <span className="text-sm">{projectTask.actualHours}h</span>
            </div>
          )}
        </div>
        {projectTask.wbsCode && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">WBS Code:</span>
            <span className="text-sm">{projectTask.wbsCode}</span>
          </div>
        )}
      </div>
    );
  };

  // Render ticket-specific details
  const renderTicketDetails = () => {
    const ticket = activity as any; // Type assertion for ticket-specific fields
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Ticket Number:</span>
          <span className="text-sm font-mono bg-gray-100 px-1 rounded">#{ticket.ticketNumber}</span>
        </div>
        {ticket.companyName && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Company:</span>
            <span className="text-sm">{ticket.companyName}</span>
          </div>
        )}
        {ticket.contactName && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Contact:</span>
            <span className="text-sm">{ticket.contactName}</span>
          </div>
        )}
        {ticket.estimatedHours !== undefined && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Estimated Hours:</span>
            <span className="text-sm">{ticket.estimatedHours}h</span>
          </div>
        )}
      </div>
    );
  };

  // Render time entry-specific details
  const renderTimeEntryDetails = () => {
    const timeEntry = activity as any; // Type assertion for time entry-specific fields
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Duration:</span>
          <span className="text-sm">{(timeEntry.billableDuration / 60).toFixed(1)}h</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Time Period:</span>
          <span className="text-sm">
            {formatDate(timeEntry.startDate)} - {formatDate(timeEntry.endDate)}
          </span>
        </div>
        {timeEntry.workItemType && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Related Item:</span>
            <span className="text-sm">{timeEntry.workItemType} #{timeEntry.workItemId}</span>
          </div>
        )}
        {timeEntry.approvalStatus && (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Approval Status:</span>
            <Badge variant={timeEntry.approvalStatus === 'approved' ? 'success' : 'default'}>
              {timeEntry.approvalStatus}
            </Badge>
          </div>
        )}
      </div>
    );
  };

  // Fetch task details and form schema for workflow task
  const fetchWorkflowTaskDetails = async (taskId: string) => {
    try {
      const taskDetails = await getTaskDetails(taskId);
      return {
        formId: taskDetails.formId,
        formSchema: taskDetails.formSchema
      };
    } catch (error) {
      console.error('Error fetching workflow task details:', error);
      return null;
    }
  };

  // Render workflow task-specific details
  const renderWorkflowTaskDetails = () => {
    const workflowTask = activity as any; // Type assertion for workflow task-specific fields
    const [taskDetails, setTaskDetails] = useState<{formId?: string, formSchema?: any}>({});
    const [activeTab, setActiveTab] = useState<string>('details');
    const [formSchema, setFormSchema] = useState<any>(null);
    const [isLoadingForm, setIsLoadingForm] = useState<boolean>(false);
    
    // Fetch task details when component mounts
    useEffect(() => {
      setIsLoadingForm(true);
      fetchWorkflowTaskDetails(workflowTask.id)
        .then(details => {
          if (details) {
            setTaskDetails(details);
            setFormSchema(details.formSchema);
            // Set active tab to form if form exists
            if (details.formId) {
              setActiveTab('form');
            }
          }
          setIsLoadingForm(false);
        })
        .catch(() => {
          setIsLoadingForm(false);
        });
    }, [workflowTask.id]);
    
    return (
      <div className="space-y-4">
        <div className="space-y-4 mb-4">
          {workflowTask.executionId && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Workflow:</span>
              <span className="text-sm">{workflowTask.executionId}</span>
            </div>
          )}
          {workflowTask.assignedRoles && workflowTask.assignedRoles.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Assigned Roles:</span>
              <span className="text-sm">{workflowTask.assignedRoles.join(', ')}</span>
            </div>
          )}
        </div>
        {taskDetails?.formId && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="mb-4">
              <TabsTrigger value="details">Details</TabsTrigger>
              <TabsTrigger value="form">Form</TabsTrigger>
            </TabsList>
            
            <TabsContent value="details">
              <div className="bg-gray-50 p-4 rounded-md">
                {workflowTask.description || 'No additional details available.'}
              </div>
            </TabsContent>
            
            <TabsContent value="form">
              <div className="bg-white p-4 rounded-md border">
                {isLoadingForm ? (
                  <div className="flex justify-center items-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
                    <span className="ml-2 text-gray-500">Loading form...</span>
                  </div>
                ) : formSchema ? (
                  <TaskForm
                    taskId={workflowTask.id}
                    schema={formSchema.jsonSchema || {}}
                    uiSchema={formSchema.uiSchema || {}}
                    initialFormData={workflowTask.responseData || formSchema.defaultValues || {}}
                    onComplete={onActionComplete}
                    contextData={workflowTask.contextData}
                    executionId={workflowTask.executionId}
                  />
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <p>Could not load the form. Please try again later.</p>
                    <Button
                      id="retry-load-form-button"
                      variant="outline"
                      className="mt-4"
                      onClick={() => {
                        setIsLoadingForm(true);
                        fetchWorkflowTaskDetails(workflowTask.id)
                          .then(details => {
                            if (details) {
                              setTaskDetails(details);
                              setFormSchema(details.formSchema);
                            }
                            setIsLoadingForm(false);
                          })
                          .catch(() => {
                            setIsLoadingForm(false);
                          });
                      }}
                    >
                      Retry
                    </Button>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>
    );
  };

  return (
    <Drawer
      id={`activity-details-drawer-${activity.id}`}
      isOpen={isOpen}
      onClose={onClose}
    >
      <div className="min-w-[640px] max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold">{activity.title}</h2>
          <div className="flex items-center gap-2">
            <ActivityActionMenu
              activity={activity}
              onActionComplete={onActionComplete}
              onViewDetails={() => {}} // Self-reference to prevent navigation
            />
            <Button id="close-drawer-button" variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Badge variant="default">{activity.status}</Badge>
            <Badge variant={
              activity.priority === 'high' ? 'error' : 
              activity.priority === 'medium' ? 'warning' : 
              'default'
            }>
              {activity.priority.charAt(0).toUpperCase() + activity.priority.slice(1)} Priority
            </Badge>
            {activity.dueDate && (
              <span className="text-sm text-gray-500">
                Due: {formatDate(activity.dueDate)}
              </span>
            )}
          </div>
          
          <div className="bg-gray-50 p-4 rounded-md">
            {activity.description || 'No description provided'}
          </div>
          
          <div className="border-t pt-4">
            <h3 className="text-lg font-medium mb-4">Details</h3>
            {renderActivityDetails()}
          </div>
          
          {activity.assignedToNames && activity.assignedToNames.length > 0 && (
            <div className="border-t pt-4">
              <h3 className="text-lg font-medium mb-4">Assigned To</h3>
              <div className="flex flex-wrap gap-2">
                {activity.assignedToNames.map((name, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full"
                  >
                    <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center text-xs font-medium">
                      {name.charAt(0)}
                    </div>
                    <span className="text-sm">{name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {activity.relatedEntities && activity.relatedEntities.length > 0 && (
            <div className="border-t pt-4">
              <h3 className="text-lg font-medium mb-4">Related Items</h3>
              <div className="space-y-2">
                {activity.relatedEntities.map((entity, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm font-medium">{entity.type.charAt(0).toUpperCase() + entity.type.slice(1)}:</span>
                    <span className="text-sm">{entity.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}