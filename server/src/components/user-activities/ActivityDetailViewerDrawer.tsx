'use client'

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { ISO8601String } from '@alga-psa/shared/types';
import { ActivityType } from "server/src/interfaces/activity.interfaces";
import { processTemplateVariables } from "server/src/utils/templateUtils";
import { useDrawer } from "server/src/context/DrawerContext";
import { useActivitiesCache } from "server/src/hooks/useActivitiesCache";
import { getConsolidatedTicketData } from "server/src/lib/actions/ticket-actions/optimizedTicketActions";
import { useTenant } from "server/src/components/TenantProvider";
import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from 'server/src/components/ui/Button';
import Spinner from 'server/src/components/ui/Spinner';
import { getTicketById } from "server/src/lib/actions/ticket-actions/ticketActions";
import { getTaskWithDetails } from "server/src/lib/actions/project-actions/projectTaskActions";
import { getTaskDetails } from "server/src/lib/actions/workflow-actions/taskInboxActions";
import { getScheduleEntries } from "server/src/lib/actions/scheduleActions";
import { getCurrentUser, getAllUsersBasic } from "server/src/lib/actions/user-actions/userActions";
import { getTimeEntryById, saveTimeEntry } from "server/src/lib/actions/timeEntryActions";
import TicketDetails from "server/src/components/tickets/ticket/TicketDetails";
import TaskEdit from "server/src/components/projects/TaskEdit";
import EntryPopup from "server/src/components/schedule/EntryPopup";
import { TaskForm } from "server/src/components/workflow/TaskForm";
import TimeEntryDialog from "server/src/components/time-management/time-entry/time-sheet/TimeEntryDialog";
import { toast } from 'react-hot-toast';
import { formatISO } from 'date-fns';
import { IWorkItem } from "server/src/interfaces/workItem.interfaces";
import { TimeSheetStatus, ITimePeriodWithStatusView } from "server/src/interfaces/timeEntry.interfaces";
import { NotificationDetailView } from "server/src/components/notifications/NotificationDetailView";
import { NotificationActivity } from "server/src/interfaces/activity.interfaces";
import { getNotificationByIdAction } from "server/src/lib/actions/internal-notification-actions/internalNotificationActions";
import { getBlockContent, updateBlockContent } from "server/src/lib/actions/document-actions/documentBlockContentActions";
import RichTextViewer from "server/src/components/editor/RichTextViewer";
import TextEditor from "server/src/components/editor/TextEditor";
import { PartialBlock } from '@blocknote/core';

interface ActivityDetailViewerDrawerProps {
  activityType: ActivityType;
  activityId: string;
  onClose: () => void;
  onActionComplete?: () => void;
}

// Helper component for document viewing/editing
function DocumentViewerEditor({
  documentId,
  initialContent,
  documentName,
  currentUser,
  onClose,
  showBackButton,
  onBack,
  invalidateCache,
  onActionComplete
}: {
  documentId: string;
  initialContent: PartialBlock[];
  documentName?: string;
  currentUser: any;
  onClose: () => void;
  showBackButton?: boolean;
  onBack?: () => void;
  invalidateCache: any;
  onActionComplete?: () => void;
}) {
  const [isEditMode, setIsEditMode] = useState(false);
  const [currentContent, setCurrentContent] = useState<PartialBlock[]>(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [hasContentChanged, setHasContentChanged] = useState(false);
  const editorRef = useRef<any>(null);

  const handleContentChange = (blocks: PartialBlock[]) => {
    setCurrentContent(blocks);
    setHasContentChanged(true);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      await updateBlockContent(documentId, {
        block_data: JSON.stringify(currentContent),
        user_id: currentUser.user_id
      });
      setHasContentChanged(false);
      setIsEditMode(false);
      toast.success('Document saved successfully');
      invalidateCache({ activityType: ActivityType.DOCUMENT });
      onActionComplete?.();
    } catch (error) {
      console.error('Error saving document:', error);
      toast.error('Failed to save document');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="flex-shrink-0 border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          {showBackButton && onBack ? (
            <Button
              id="back-to-notification"
              variant="soft"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Notification
            </Button>
          ) : (
            <h2 className="text-xl font-semibold">{documentName || (isEditMode ? 'Edit Document' : 'Document Viewer')}</h2>
          )}
          <div className="flex items-center gap-2">
            {!isEditMode && (
              <button
                onClick={() => setIsEditMode(true)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
            )}
          </div>
        </div>
        {documentName && showBackButton && (
          <h2 className="text-xl font-semibold mt-3">{documentName}</h2>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isEditMode ? (
          <TextEditor
            id={`document-editor-${documentId}`}
            initialContent={currentContent}
            onContentChange={handleContentChange}
            editorRef={editorRef}
          />
        ) : (
          <RichTextViewer
            id={`document-viewer-${documentId}`}
            content={currentContent}
          />
        )}
      </div>
      {isEditMode && (
        <div className="flex-shrink-0 border-t border-gray-200 px-6 py-4">
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setIsEditMode(false);
                setCurrentContent(initialContent);
                setHasContentChanged(false);
              }}
              className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || !hasContentChanged}
              className="px-4 py-2 text-sm font-medium rounded-md bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ActivityDetailViewerDrawer({
  activityType,
  activityId,
  onClose,
  onActionComplete
}: ActivityDetailViewerDrawerProps) {
  const [content, setContent] = useState<React.JSX.Element | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tenant = useTenant();
  const drawer = useDrawer();
  const { invalidateCache } = useActivitiesCache();

  // Memoize the loadContent function to prevent unnecessary re-renders
  const loadContent = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Get current user for actions that require user context
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        throw new Error('User not authenticated');
      }

      switch(activityType) {
        case ActivityType.TICKET: {
          // Use the consolidated function to get all ticket data in a single call
          const ticketData = await getConsolidatedTicketData(activityId);
          
          setContent(
            <div className="h-full">
              <TicketDetails
                isInDrawer={true}
                initialTicket={ticketData.ticket}
                initialComments={ticketData.comments}
                initialBoard={ticketData.board}
                initialClient={ticketData.client}
                initialContacts={ticketData.contacts}
                initialContactInfo={ticketData.contactInfo}
                initialCreatedByUser={ticketData.createdByUser}
                initialAdditionalAgents={ticketData.additionalAgents}
                statusOptions={ticketData.options.status}
                agentOptions={ticketData.options.agent}
                boardOptions={ticketData.options.board}
                priorityOptions={ticketData.options.priority}
                initialCategories={ticketData.categories}
                initialClients={ticketData.clients}
                initialLocations={ticketData.locations}
                initialAgentSchedules={ticketData.agentSchedules}
                currentUser={currentUser}
                initialUserMap={ticketData.userMap}
                initialAvailableAgents={ticketData.availableAgents}
                onClose={onClose}
              />
            </div>
          );
          break;
        }
        
        case ActivityType.PROJECT_TASK: {
          const taskData = await getTaskWithDetails(activityId, currentUser);
          // Get users for the TaskEdit component
          const users = await getAllUsersBasic();
          
          setContent(
            <div className="h-full">
              <TaskEdit
                inDrawer={true}
                users={users || []}
                phase={{
                  phase_id: taskData.phase_id,
                  project_id: taskData.project_id || '',
                  phase_name: taskData.phase_name || '',
                  description: null,
                  start_date: null,
                  end_date: null,
                  status: taskData.status_id || '',
                  order_number: 0,
                  created_at: new Date(),
                  updated_at: new Date(),
                  wbs_code: taskData.wbs_code,
                  tenant: tenant || ''
                }}
                task={{
                  ...taskData,
                  tenant: tenant || ''
                }}
                onClose={onClose}
                onTaskUpdated={async () => {
                  // Invalidate cache for this activity type
                  invalidateCache({ activityType: ActivityType.PROJECT_TASK });
                  onActionComplete?.();
                }}
              />
            </div>
          );
          break;
        }
        
        case ActivityType.SCHEDULE: {
          // For schedule entries, we need to get the entry from the schedule entries
          // This assumes the schedule entries API can filter by entry_id
          const now = new Date();
          const oneMonthAgo = new Date(now);
          oneMonthAgo.setMonth(now.getMonth() - 1);
          const oneMonthAhead = new Date(now);
          oneMonthAhead.setMonth(now.getMonth() + 1);
          
          const scheduleResult = await getScheduleEntries(oneMonthAgo, oneMonthAhead);
          const scheduleEntry = scheduleResult.success ? 
            scheduleResult.entries.find(e => e.entry_id === activityId) : null;
            
          if (!scheduleEntry) {
            throw new Error('Schedule entry not found');
          }
          
          // Get users for the EntryPopup
          const users = await getAllUsersBasic();
          const currentUser = await getCurrentUser();
          
          setContent(
            <div className="h-full">
              <EntryPopup
                canAssignMultipleAgents={true}
                users={users || []}
                currentUserId={currentUser?.user_id || ''}
                event={{
                  entry_id: scheduleEntry.entry_id,
                  work_item_id: scheduleEntry.work_item_id || '',
                  work_item_type: scheduleEntry.work_item_type || '',
                  title: scheduleEntry.title,
                  notes: scheduleEntry.notes || '',
                  scheduled_start: scheduleEntry.scheduled_start,
                  scheduled_end: scheduleEntry.scheduled_end,
                  status: scheduleEntry.status,
                  assigned_user_ids: scheduleEntry.assigned_user_ids || [],
                  created_at: scheduleEntry.created_at,
                  updated_at: scheduleEntry.updated_at
                }}
                onClose={onClose}
                onSave={async () => {
                  // Invalidate cache for this activity type
                  invalidateCache({ activityType: ActivityType.SCHEDULE });
                  onActionComplete?.();
                }}
                isInDrawer={true}
                canModifySchedule={true}
                focusedTechnicianId={currentUser?.user_id || ''}
                canAssignOthers={true}
              />
            </div>
          );
          break;
        }
        
        case ActivityType.TIME_ENTRY: {
          try {
            // Fetch the time entry details
            const timeEntryData = await getTimeEntryById(activityId);
            
            if (!timeEntryData) {
              throw new Error('Time entry not found');
            }
            
            console.log('Time entry data:', timeEntryData);
            
            // Get the current time period for the time entry
            const now = new Date();
            // Create a time period object with all required properties
            const timePeriod = {
              period_id: timeEntryData.time_sheet_id || '',
              start_date: formatISO(new Date(now.getFullYear(), now.getMonth(), 1)),
              end_date: formatISO(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
              timeSheetId: timeEntryData.time_sheet_id || '',
              timeSheetStatus: (timeEntryData.approval_status as TimeSheetStatus) || 'DRAFT'
            };
            
            // Ensure the time entry data has all required properties
            const formattedTimeEntry = {
              ...timeEntryData,
              // Ensure these properties exist and are in the correct format
              start_time: typeof timeEntryData.start_time === 'string' ? timeEntryData.start_time : formatISO(new Date(timeEntryData.start_time)),
              end_time: typeof timeEntryData.end_time === 'string' ? timeEntryData.end_time : formatISO(new Date(timeEntryData.end_time)),
              created_at: typeof timeEntryData.created_at === 'string' ? timeEntryData.created_at : formatISO(new Date(timeEntryData.created_at)),
              updated_at: typeof timeEntryData.updated_at === 'string' ? timeEntryData.updated_at : formatISO(new Date(timeEntryData.updated_at)),
              notes: timeEntryData.notes || '',
              billable_duration: timeEntryData.billable_duration || 0,
              approval_status: timeEntryData.approval_status || 'DRAFT',
              // Add any other required properties
              date: new Date(timeEntryData.start_time)
            };
            
            // Create a work item object from the time entry's work item
            const workItem: Omit<IWorkItem, 'tenant'> = {
              work_item_id: timeEntryData.work_item_id,
              name: timeEntryData.workItem?.name || 'Unknown Work Item',
              description: timeEntryData.workItem?.description || '',
              type: timeEntryData.work_item_type,
              is_billable: Boolean(timeEntryData.workItem?.is_billable)
            };
            
            console.log('Formatted time entry:', formattedTimeEntry);
            console.log('Work item:', workItem);
            
            setContent(
              <div className="h-full">
                <TimeEntryDialog
                  id={`time-entry-dialog-${activityId}`}
                  isOpen={true}
                  onClose={onClose}
                  onSave={async (updatedTimeEntry) => {
                    try {
                      // Save the updated time entry
                      await saveTimeEntry({
                        ...updatedTimeEntry,
                        entry_id: timeEntryData.entry_id
                      });
                      // Invalidate cache for this activity type
                      invalidateCache({ activityType: ActivityType.TIME_ENTRY });
                      toast.success('Time entry updated successfully');
                      onActionComplete?.();
                    } catch (error) {
                      console.error('Error updating time entry:', error);
                      toast.error('Failed to update time entry');
                    }
                  }}
                  workItem={workItem}
                  date={new Date(timeEntryData.start_time)}
                  existingEntries={[formattedTimeEntry]}
                  timePeriod={timePeriod}
                  isEditable={true}
                  inDrawer={true}
                  timeSheetId={timeEntryData.time_sheet_id}
                />
              </div>
            );
          } catch (error) {
            console.error('Error in TIME_ENTRY case:', error);
            setContent(
              <div className="h-full p-6">
                <h2 className="text-xl font-semibold mb-4">Time Entry Details</h2>
                <div className="bg-red-50 border border-red-200 rounded-md p-4 flex items-start">
                  <AlertCircle className="h-5 w-5 text-red-500 mr-3 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-medium text-red-800">Error loading time entry</h3>
                    <p className="text-sm text-red-700 mt-1">
                      {error instanceof Error ? error.message : String(error)}
                    </p>
                  </div>
                </div>
              </div>
            );
          }
          break;
        }
        
        case ActivityType.WORKFLOW_TASK: {
          const taskDetails = await getTaskDetails(activityId);
          
          console.log('[ActivityDetailViewerDrawer] Raw Task details for WORKFLOW_TASK:', JSON.stringify(taskDetails, null, 2));
          
          if (taskDetails.formId && taskDetails.formSchema && taskDetails.formSchema.jsonSchema) {
            let initialDataForForm = taskDetails.responseData || {};
            if (!taskDetails.responseData || Object.keys(taskDetails.responseData).length === 0) {
              if (taskDetails.formSchema.defaultValues) {
                console.log('[ActivityDetailViewerDrawer] Processing defaultValues for initialFormData. Raw defaultValues:', JSON.stringify(taskDetails.formSchema.defaultValues, null, 2));
                console.log('[ActivityDetailViewerDrawer] ContextData for defaultValues processing:', JSON.stringify(taskDetails.contextData, null, 2));
                initialDataForForm = processTemplateVariables(
                  taskDetails.formSchema.defaultValues,
                  taskDetails.contextData
                );
                console.log('[ActivityDetailViewerDrawer] Processed defaultValues for initialFormData:', JSON.stringify(initialDataForForm, null, 2));
              }
            }

            console.log('[ActivityDetailViewerDrawer] Passing to TaskForm - JSONSchema:', JSON.stringify(taskDetails.formSchema.jsonSchema, null, 2));
            console.log('[ActivityDetailViewerDrawer] Passing to TaskForm - UISchema:', JSON.stringify(taskDetails.formSchema.uiSchema, null, 2));
            console.log('[ActivityDetailViewerDrawer] Task contextData:', taskDetails.contextData);
            setContent(
              <div className="h-full p-6">
                <h2 className="text-xl font-semibold mb-4">Workflow Task</h2>
                <TaskForm
                  taskId={activityId}
                  schema={taskDetails.formSchema.jsonSchema || {}}
                  uiSchema={taskDetails.formSchema.uiSchema || {}}
                  initialFormData={initialDataForForm} // Use the prepared initialDataForForm
                  onComplete={() => {
                    // Invalidate cache for this activity type
                    invalidateCache({ activityType: ActivityType.WORKFLOW_TASK });
                    onActionComplete?.();
                  }}
                  contextData={taskDetails.contextData}
                  executionId={taskDetails.executionId}
                  isInDrawer={true}
                />
              </div>
            );
          } else {
            setContent(
              <div className="h-full p-6">
                <h2 className="text-xl font-semibold mb-4">Workflow Task</h2>
                <div className="bg-gray-50 p-4 rounded-md">
                  {taskDetails.description || 'No additional details available.'}
                </div>
              </div>
            );
          }
          break;
        }

        case ActivityType.DOCUMENT: {
          // Extract documentId - it's the same as activityId for documents
          const documentId = activityId;

          try {
            // Load the document content
            const content = await getBlockContent(documentId);
            let parsedContent: PartialBlock[] = [{
              type: "paragraph",
              props: {
                textAlignment: "left",
                backgroundColor: "default",
                textColor: "default"
              },
              content: [{
                type: "text",
                text: "",
                styles: {}
              }]
            }];

            if (content?.block_data) {
              try {
                parsedContent = typeof content.block_data === 'string'
                  ? JSON.parse(content.block_data)
                  : content.block_data;
              } catch (parseError) {
                console.error('Error parsing document content:', parseError);
              }
            }

            // Render document viewer/editor with edit capability
            setContent(
              <DocumentViewerEditor
                documentId={documentId}
                initialContent={parsedContent}
                currentUser={currentUser}
                onClose={onClose}
                invalidateCache={invalidateCache}
                onActionComplete={onActionComplete}
              />
            );
          } catch (error) {
            console.error('Error loading document:', error);
            throw new Error('Failed to load document content');
          }
          break;
        }

        case ActivityType.NOTIFICATION: {
          // Fetch the full notification details
          const notificationData = await getNotificationByIdAction(activityId, tenant || '', currentUser.user_id);

          if (!notificationData) {
            throw new Error('Notification not found');
          }

          // Convert to NotificationActivity for the detail view
          // Map priority based on notification type
          let priority: any;
          switch (notificationData.type) {
            case 'error':
              priority = 'high';
              break;
            case 'warning':
              priority = 'medium';
              break;
            default:
              priority = 'low';
          }

          const notificationActivity: NotificationActivity = {
            id: activityId,
            notificationId: notificationData.internal_notification_id,
            title: notificationData.title,
            message: notificationData.message,
            description: notificationData.message,
            type: ActivityType.NOTIFICATION,
            sourceType: ActivityType.NOTIFICATION,
            sourceId: activityId,
            status: notificationData.type || 'info',
            priority: priority,
            isRead: notificationData.is_read,
            readAt: notificationData.read_at || undefined,
            link: notificationData.link || undefined,
            category: notificationData.category || undefined,
            templateName: notificationData.template_name || '',
            metadata: notificationData.metadata as Record<string, any>,
            assignedTo: notificationData.user_id ? [notificationData.user_id] : [],
            actions: [],
            tenant: tenant || '',
            createdAt: notificationData.created_at,
            updatedAt: notificationData.updated_at || notificationData.created_at
          };

          setContent(
            <div className="h-full">
              <NotificationDetailView
                notification={notificationActivity}
                onClose={onClose}
                onNavigateToTicket={async (ticketId) => {
                  // Store the current notification content to allow going back
                  const currentNotificationContent = content;

                  // Load ticket data and render
                  try {
                    setIsLoading(true);
                    const ticketData = await getConsolidatedTicketData(ticketId);

                    setContent(
                      <div className="h-full flex flex-col">
                        <div className="flex-shrink-0 border-b border-gray-200 px-4 py-3">
                          <Button
                            id="back-to-notification-from-ticket"
                            variant="soft"
                            onClick={() => setContent(currentNotificationContent)}
                          >
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            ← Back to Notification
                          </Button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <TicketDetails
                            isInDrawer={true}
                            initialTicket={ticketData.ticket}
                            initialComments={ticketData.comments}
                            initialBoard={ticketData.board}
                            initialClient={ticketData.client}
                            initialContacts={ticketData.contacts}
                            initialContactInfo={ticketData.contactInfo}
                            initialCreatedByUser={ticketData.createdByUser}
                            initialAdditionalAgents={ticketData.additionalAgents}
                            statusOptions={ticketData.options.status}
                            agentOptions={ticketData.options.agent}
                            boardOptions={ticketData.options.board}
                            priorityOptions={ticketData.options.priority}
                            initialCategories={ticketData.categories}
                            initialClients={ticketData.clients}
                            initialLocations={ticketData.locations}
                            initialAgentSchedules={ticketData.agentSchedules}
                            currentUser={currentUser}
                            initialUserMap={ticketData.userMap}
                            initialAvailableAgents={ticketData.availableAgents}
                            onClose={onClose}
                          />
                        </div>
                      </div>
                    );
                  } catch (error) {
                    console.error('Error loading ticket:', error);
                    setError('Failed to load ticket details');
                  } finally {
                    setIsLoading(false);
                  }
                }}
                onNavigateToProjectTask={async (taskId, projectId) => {
                  // Store the current notification content to allow going back
                  const currentNotificationContent = content;

                  // Load task data and render
                  try {
                    setIsLoading(true);
                    const taskData = await getTaskWithDetails(taskId, currentUser);
                    const users = await getAllUsersBasic();

                    setContent(
                      <div className="h-full flex flex-col">
                        <div className="flex-shrink-0 border-b border-gray-200 px-4 py-3">
                          <Button
                            id="back-to-notification-from-task"
                            variant="soft"
                            onClick={() => setContent(currentNotificationContent)}
                          >
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back to Notification
                          </Button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <TaskEdit
                            inDrawer={true}
                            users={users || []}
                            phase={{
                              phase_id: taskData.phase_id,
                              project_id: taskData.project_id || '',
                              phase_name: taskData.phase_name || '',
                              description: null,
                              start_date: null,
                              end_date: null,
                              status: taskData.status_id || '',
                              order_number: 0,
                              created_at: new Date(),
                              updated_at: new Date(),
                              wbs_code: taskData.wbs_code,
                              tenant: tenant || ''
                            }}
                            task={{
                              ...taskData,
                              tenant: tenant || ''
                            }}
                            onClose={onClose}
                            onTaskUpdated={async () => {
                              invalidateCache({ activityType: ActivityType.PROJECT_TASK });
                              onActionComplete?.();
                            }}
                          />
                        </div>
                      </div>
                    );
                  } catch (error) {
                    console.error('Error loading task:', error);
                    setError('Failed to load task details');
                  } finally {
                    setIsLoading(false);
                  }
                }}
                onNavigateToDocument={(documentId, documentName) => {
                  // Directly load the document case without reloading notification
                  (async () => {
                    try {
                      setIsLoading(true);
                      const documentContent = await getBlockContent(documentId);
                      let parsedContent: PartialBlock[] = [{
                        type: "paragraph",
                        props: {
                          textAlignment: "left",
                          backgroundColor: "default",
                          textColor: "default"
                        },
                        content: [{
                          type: "text",
                          text: "",
                          styles: {}
                        }]
                      }];

                      if (documentContent?.block_data) {
                        try {
                          parsedContent = typeof documentContent.block_data === 'string'
                            ? JSON.parse(documentContent.block_data)
                            : documentContent.block_data;
                        } catch (parseError) {
                          console.error('Error parsing document content:', parseError);
                        }
                      }

                      // Render document viewer/editor with back button and edit capability
                      setContent(
                        <DocumentViewerEditor
                          documentId={documentId}
                          initialContent={parsedContent}
                          documentName={documentName}
                          currentUser={currentUser}
                          onClose={onClose}
                          showBackButton={true}
                          onBack={() => {
                            // Reload the notification content by re-fetching
                            loadContent();
                          }}
                          invalidateCache={invalidateCache}
                          onActionComplete={onActionComplete}
                        />
                      );
                    } catch (error) {
                      console.error('Error loading document:', error);
                      setError('Failed to load document content');
                    } finally {
                      setIsLoading(false);
                    }
                  })();
                }}
              />
            </div>
          );
          break;
        }

        default:
          setContent(
            <div className="h-full p-6">
              <h2 className="text-xl font-semibold mb-4">Unsupported Activity Type</h2>
              <p className="text-gray-600">
                This activity type ({activityType}) is not supported in the detail viewer.
              </p>
            </div>
          );
      }
    } catch (error) {
      console.error('Error loading activity details:', error);
      setError('Failed to load activity details. Please try again later.');
      setContent(
        <div className="h-full p-6">
          <div className="bg-red-50 border border-red-200 rounded-md p-4 flex items-start">
            <AlertCircle className="h-5 w-5 text-red-500 mr-3 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-red-800">Error loading activity details</h3>
              <p className="text-sm text-red-700 mt-1">
                {error instanceof Error ? error.message : String(error)}
              </p>
            </div>
          </div>
        </div>
      );
    } finally {
      setIsLoading(false);
    }
  }, [activityType, activityId, onActionComplete, onClose, tenant]);
  
  // Use effect to call loadContent when component mounts or dependencies change
  useEffect(() => {
    loadContent();
  }, [loadContent]);
  
  // Memoize the rendered content to prevent unnecessary re-renders
  const renderedContent = useMemo(() => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-full">
          <Spinner size="sm" />
        </div>
      );
    }
    return content;
  }, [isLoading, content]);
  
  return (
    <div className="min-w-auto h-full bg-white">
      {renderedContent}
    </div>
  );
}
