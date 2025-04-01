'use client';

import React, { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { ConfirmationDialog } from '../ui/ConfirmationDialog';
import {
    ITicket,
    IComment,
    ITimeSheet,
    ITimePeriod,
    ITimePeriodView,
    ITimeEntry,
    ICompany,
    IContact,
    IUser,
    IUserWithRoles,
    ITeam,
    ITicketResource,
    ITicketCategory
} from '../../interfaces';
import TicketInfo from './TicketInfo';
import TicketProperties from './TicketProperties';
import TicketConversation from './TicketConversation';
import AssociatedAssets from '../assets/AssociatedAssets';
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import { useDrawer } from '../../context/DrawerContext';
import { findUserById, getAllUsers, getCurrentUser } from '../../lib/actions/user-actions/userActions';
import { findChannelById, getAllChannels } from '../../lib/actions/channel-actions/channelActions';
import { findCommentsByTicketId, deleteComment, createComment, updateComment, findCommentById } from '../../lib/actions/comment-actions/commentActions';
import { getDocumentByTicketId } from '../../lib/actions/document-actions/documentActions';
import { getContactByContactNameId, getContactsByCompany } from '../../lib/actions/contact-actions/contactActions';
import { getCompanyById, getAllCompanies } from '../../lib/actions/companyActions';
import { updateTicket } from '../../lib/actions/ticket-actions/ticketActions';
import { getTicketStatuses } from '../../lib/actions/status-actions/statusActions';
import { getAllPriorities } from '../../lib/actions/priorityActions';
import { fetchTimeSheets, fetchOrCreateTimeSheet, saveTimeEntry } from '../../lib/actions/timeEntryActions';
import { getCurrentTimePeriod } from '../../lib/actions/timePeriodsActions';
import CompanyDetails from '../companies/CompanyDetails';
import ContactDetailsView from '../contacts/ContactDetailsView';
import { addTicketResource, getTicketResources, removeTicketResource } from '../../lib/actions/ticketResourceActions';
import TechnicianDispatchDashboard from '../technician-dispatch/TechnicianDispatchDashboard';
import { WorkItemType } from '../../interfaces/workItem.interfaces';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import TimeEntryDialog from 'server/src/components/time-management/time-entry/time-sheet/TimeEntryDialog';
import { PartialBlock, StyledText } from '@blocknote/core';
import { useTicketTimeTracking } from '../../hooks/useTicketTimeTracking';
import { IntervalTrackingService } from '../../services/IntervalTrackingService';
import { IntervalManagement } from '../time-management/interval-tracking/IntervalManagement';
import { convertBlockNoteToMarkdown } from '../../lib/utils/blocknoteUtils';

interface TicketDetailsProps {
    id?: string; // Made optional to maintain backward compatibility
    initialTicket: ITicket & { tenant: string | undefined };
    onClose?: () => void; // Callback when user wants to close the ticket screen
    
    // Pre-fetched data props
    initialComments?: IComment[];
    initialDocuments?: any[];
    initialCompany?: ICompany | null;
    initialContacts?: IContact[];
    initialContactInfo?: IContact | null;
    initialCreatedByUser?: IUser | null;
    initialChannel?: any;
    initialAdditionalAgents?: ITicketResource[];
    initialAvailableAgents?: IUserWithRoles[];
    initialUserMap?: Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string }>;
    statusOptions?: { value: string; label: string }[];
    agentOptions?: { value: string; label: string }[];
    channelOptions?: { value: string; label: string }[];
    priorityOptions?: { value: string; label: string }[];
    initialCategories?: ITicketCategory[];
    initialCompanies?: ICompany[];
    initialAgentSchedules?: { userId: string; minutes: number }[];
    
    // Optimized handlers
    onTicketUpdate?: (field: string, value: any) => Promise<void>;
    onAddComment?: (content: string, isInternal: boolean, isResolution: boolean) => Promise<void>;
    onUpdateDescription?: (content: string) => Promise<boolean>;
    isSubmitting?: boolean;
}

const TicketDetails: React.FC<TicketDetailsProps> = ({
    id = 'ticket-details',
    initialTicket,
    onClose,
    // Pre-fetched data with defaults
    initialComments = [],
    initialDocuments = [],
    initialCompany = null,
    initialContacts = [],
    initialContactInfo = null,
    initialCreatedByUser = null,
    initialChannel = null,
    initialAdditionalAgents = [],
    initialAvailableAgents = [],
    initialUserMap = {},
    statusOptions = [],
    agentOptions = [],
    channelOptions = [],
    priorityOptions = [],
    initialCategories = [],
    initialCompanies = [],
    initialAgentSchedules = [],
    // Optimized handlers
    onTicketUpdate,
    onAddComment,
    onUpdateDescription,
    isSubmitting = false
}) => {
    const { data: session } = useSession();
    const userId = session?.user?.id;
    const tenant = initialTicket.tenant;
    if (!tenant) {
        throw new Error('tenant is not defined');
    }

    const [ticket, setTicket] = useState(initialTicket);
    const [conversations, setConversations] = useState<IComment[]>(initialComments);
    const [documents, setDocuments] = useState<any[]>(initialDocuments);
    const [company, setCompany] = useState<ICompany | null>(initialCompany);
    const [contactInfo, setContactInfo] = useState<IContact | null>(initialContactInfo);
    const [createdByUser, setCreatedByUser] = useState<IUser | null>(initialCreatedByUser);
    const [channel, setChannel] = useState<any>(initialChannel);
    const [companies, setCompanies] = useState<ICompany[]>(initialCompanies);
    const [contacts, setContacts] = useState<IContact[]>(initialContacts);

    // Use pre-fetched options directly
    const [userMap, setUserMap] = useState<Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string }>>(initialUserMap);

    const [availableAgents, setAvailableAgents] = useState<IUserWithRoles[]>(initialAvailableAgents);
    const [additionalAgents, setAdditionalAgents] = useState<ITicketResource[]>(initialAdditionalAgents);

    const [newCommentContent, setNewCommentContent] = useState<PartialBlock[]>([{
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
    }]);
    const [activeTab, setActiveTab] = useState('Comments');
    const [isEditing, setIsEditing] = useState(false);
    const [currentComment, setCurrentComment] = useState<IComment | null>(null);

    const [elapsedTime, setElapsedTime] = useState(0);
    const [isRunning, setIsRunning] = useState(true);
    const [timeDescription, setTimeDescription] = useState('');
    const [currentTimeSheet, setCurrentTimeSheet] = useState<ITimeSheet | null>(null);
    const [currentTimePeriod, setCurrentTimePeriod] = useState<ITimePeriodView | null>(null);

    const [team, setTeam] = useState<ITeam | null>(null);

    const [isChangeContactDialogOpen, setIsChangeContactDialogOpen] = useState(false);
    const [isChangeCompanyDialogOpen, setIsChangeCompanyDialogOpen] = useState(false);
    const [companyFilterState, setCompanyFilterState] = useState<'all' | 'active' | 'inactive'>('all');
    const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
    const [isTimeEntryPeriodDialogOpen, setIsTimeEntryPeriodDialogOpen] = useState(false);

    const { openDrawer, closeDrawer } = useDrawer();
    const router = useRouter();
    // Create a single instance of the service
    const intervalService = useMemo(() => new IntervalTrackingService(), []);

    // Timer logic
    const tick = useCallback(() => {
        setElapsedTime(prevTime => prevTime + 1);
    }, []);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;
        if (isRunning) {
            intervalId = setInterval(tick, 1000);
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [isRunning, tick]);
    
    
    // Add automatic interval tracking using the custom hook
    const { currentIntervalId } = useTicketTimeTracking(
        initialTicket.ticket_id || '',
        initialTicket.ticket_number || '',
        initialTicket.title || '',
        userId || ''
    );
    
    // Function to close the current interval before navigation
    // Enhanced function to close the interval - will find and close any open interval for this ticket
    const closeCurrentInterval = useCallback(async () => {
        try {
            // If we have a currentIntervalId, use it
            if (currentIntervalId) {
                console.debug('Closing known interval before navigation:', currentIntervalId);
                await intervalService.endInterval(currentIntervalId);
                return;
            }
            
            // If currentIntervalId is null, try to find any open interval for this ticket
            console.debug('No currentIntervalId available, checking for open intervals');
            if (userId && initialTicket.ticket_id) {
                const openInterval = await intervalService.getOpenInterval(initialTicket.ticket_id, userId);
                if (openInterval) {
                    console.debug('Found open interval to close:', openInterval.id);
                    await intervalService.endInterval(openInterval.id);
                } else {
                    console.debug('No open intervals found for this ticket');
                }
            }
        } catch (error: any) {
            console.error('Error closing interval:', error);
        }
    }, [currentIntervalId, intervalService, userId, initialTicket.ticket_id]);
    
    // Fixed navigation function - wait for interval to close before navigating
    const handleBackToTickets = useCallback(async () => {
        try {
            // Wait for the interval to close
            await closeCurrentInterval();
            
            // Navigate after interval is closed
            if (onClose) {
                onClose();
            } else {
                router.back();
            }
        } catch (error) {
            console.error('Error closing interval before navigation:', error);
            // Navigate anyway to prevent user from being stuck
            if (onClose) {
                onClose();
            } else {
                router.back();
            }
        }
    }, [closeCurrentInterval, onClose, router]);
    
    // Skip the core data fetch since we're now receiving all data via props

    // Skip the channel-specific data fetch

    // Skip the company-specific data fetch

    // Skip the contact-specific data fetch

    // Skip the created-by user data fetch

    const handleCompanyClick = async () => {
        if (ticket.company_id) {
            try {
                const company = await getCompanyById(ticket.company_id);
                if (company) {
                    openDrawer(
                        <CompanyDetails 
                            company={company} 
                            documents={[]} 
                            contacts={[]} 
                            isInDrawer={true}
                        />
                    );
                } else {
                    console.error('Company not found');
                }
            } catch (error) {
                console.error('Error fetching company details:', error);
            }
        } else {
            console.log('No company associated with this ticket');
        }
    };

    const handleContactClick = () => {
        if (contactInfo && company) {
            openDrawer(
                <ContactDetailsView 
                    initialContact={{
                        ...contactInfo,
                        company_id: company.company_id
                    }}
                    companies={[company]}
                    isInDrawer={true}
                />
            );
        } else {
            console.log('No contact information or company information available');
        }
    };

    const handleAgentClick = (userId: string) => {
        openDrawer(
            <TechnicianDispatchDashboard
                filterWorkItemId={ticket.ticket_id}
                filterWorkItemType="ticket"
            />
        );
    };

    const handleAddAgent = async (userId: string) => {
        try {
            const currentUser = await getCurrentUser();
            if (!currentUser) {
                toast.error('No user session found');
                return;
            }
            const result = await addTicketResource(ticket.ticket_id!, userId, 'support', currentUser);
            setAdditionalAgents(prev => [...prev, result]);
            toast.success('Agent added successfully');
        } catch (error) {
            console.error('Error adding agent:', error);
            toast.error('Failed to add agent');
        }
    };  
    
    const handleRemoveAgent = async (assignmentId: string) => {
        try {
            const currentUser = await getCurrentUser();
            if (!currentUser) {
                toast.error('No user session found');
                return;
            }
            await removeTicketResource(assignmentId, currentUser);
            setAdditionalAgents(prev => prev.filter(agent => agent.assignment_id !== assignmentId));
            toast.success('Agent removed successfully');
        } catch (error) {
            console.error('Error removing agent:', error);
            toast.error('Failed to remove agent');
        }
    };

    const handleSelectChange = async (field: keyof ITicket, newValue: string | null) => {
        // Store the previous value before updating
        const previousValue = ticket[field];
        
        // Optimistically update the UI
        setTicket(prevTicket => ({ ...prevTicket, [field]: newValue }));

        try {
            // Use the optimized handler if provided
            if (onTicketUpdate) {
                await onTicketUpdate(field, newValue);
                
                // If we're changing the assigned_to field, we need to handle additional resources
                // This will be handled by the container component and passed back in props
            } else {
                // Fallback to the original implementation if no optimized handler is provided
                const user = await getCurrentUser();
                if (!user) {
                    console.error('Failed to get user');
                    // Revert to previous value if we can't get the user
                    setTicket(prevTicket => ({ ...prevTicket, [field]: previousValue }));
                    return;
                }
                
                const result = await updateTicket(ticket.ticket_id || '', { [field]: newValue }, user);
                
                if (result === 'success') {
                    console.log(`${field} changed to: ${newValue}`);
                    
                    // If we're changing the assigned_to field, refresh the additional resources
                    if (field === 'assigned_to') {
                        try {
                            // Refresh the additional resources
                            const resources = await getTicketResources(ticket.ticket_id!, user);
                            setAdditionalAgents(resources);
                            console.log('Additional resources refreshed after assignment change');
                        } catch (resourceError) {
                            console.error('Error refreshing additional resources:', resourceError);
                        }
                    }
                } else {
                    console.error(`Failed to update ticket ${field}`);
                    // Revert to previous value on failure
                    setTicket(prevTicket => ({ ...prevTicket, [field]: previousValue }));
                }
            }
        } catch (error) {
            console.error(`Error updating ticket ${field}:`, error);
            // Revert to previous value on error
            setTicket(prevTicket => ({ ...prevTicket, [field]: previousValue }));
        }
    };

    const [editorKey, setEditorKey] = useState(0);

    const handleAddNewComment = async () => {
        // Check if content is empty
        const contentStr = JSON.stringify(newCommentContent);
        const hasContent = contentStr !== JSON.stringify([{
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
        }]);

        if (!hasContent) {
            console.log("Cannot add empty note");
            return;
        }
    
        try {
            if (!userId) {
                console.error("No valid user ID found");
                return;
            }
            
            // Use the centralized utility to convert BlockNote content to markdown
            const markdownContent = await convertBlockNoteToMarkdown(newCommentContent);
            console.log("Converted markdown content:", markdownContent);
    
            // Use the optimized handler if provided
            if (onAddComment) {
                await onAddComment(
                    JSON.stringify(newCommentContent),
                    activeTab === 'Internal',
                    activeTab === 'Resolution'
                );
                
                // Reset the comment input
                setNewCommentContent([{
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
                }]);
            } else {
                // Fallback to the original implementation
                const newComment: Omit<IComment, 'tenant'> = {
                    ticket_id: ticket.ticket_id || '',
                    note: JSON.stringify(newCommentContent),
                    user_id: userId,
                    author_type: 'internal',
                    is_internal: activeTab === 'Internal',
                    is_resolution: activeTab === 'Resolution',
                    markdown_content: markdownContent // Explicitly set markdown content
                };
        
                const commentId = await createComment(newComment);
        
                if (commentId) {
                    const newlyCreatedComment = await findCommentById(commentId);
                    if (!newlyCreatedComment) {
                        console.error('Error fetching newly created comment:', commentId);
                        return;
                    }
        
                    setConversations(prevConversations => [...prevConversations, newlyCreatedComment]);
                    setNewCommentContent([{
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
                    }]);
                    console.log("New note added successfully");
                }
            }
        } catch (error) {
            console.error("Error adding new note:", error);
        }
    };
    
    const handleEdit = (conversation: IComment) => {
        // Only allow users to edit their own comments
        if (userId === conversation.user_id) {
            setIsEditing(true);
            setCurrentComment(conversation);
        } else {
            toast.error('You can only edit your own comments');
        }
    };

    const handleSave = async (updates: Partial<IComment>) => {
        if (!currentComment) return;

        try {
            // Extract plain text from the content for markdown
            const extractPlainText = (noteStr: string): string => {
                try {
                    const blocks = JSON.parse(noteStr);
                    return blocks.map((block: any) => {
                        if (!block.content) return '';
                        
                        if (Array.isArray(block.content)) {
                            return block.content
                                .filter((item: any) => item && item.type === 'text')
                                .map((item: any) => item.text || '')
                                .join('');
                        }
                        
                        if (typeof block.content === 'string') {
                            return block.content;
                        }
                        
                        return '';
                    }).filter((text: string) => text.trim() !== '').join('\n\n');
                } catch (e) {
                    console.error("Error parsing note JSON:", e);
                    return noteStr || "";
                }
            };
            
            // Extract markdown content directly if note is being updated
            if (updates.note) {
                const markdownContent = extractPlainText(updates.note);
                console.log("Extracted markdown content for update:", markdownContent);
                updates.markdown_content = markdownContent;
            }

            await updateComment(currentComment.comment_id!, updates);

            const updatedCommentData = await findCommentById(currentComment.comment_id!);
            if (updatedCommentData) {
                setConversations(prevConversations =>
                    prevConversations.map((conv):IComment =>
                        conv.comment_id === updatedCommentData.comment_id ? updatedCommentData : conv
                    )
                );
            }

            setIsEditing(false);
            setCurrentComment(null);
        } catch (error) {
            console.error("Error saving comment:", error);
            toast.error("Failed to save comment changes");
        }
    };
const handleClose = () => {
    setIsEditing(false);
    setCurrentComment(null);
};



    // This function is no longer used directly - we use handleDeleteRequest instead
    // Keeping it for backward compatibility with other components that might use it
    const handleDelete = async (comment: IComment) => {
        if (!comment.comment_id) return;
        
        try {
            await deleteComment(comment.comment_id);
            setConversations(prevConversations =>
                prevConversations.filter(conv => conv.comment_id !== comment.comment_id)
            );
        } catch (error) {
            console.error("Error deleting comment:", error);
        }
    };

    const handleContentChange = (blocks: PartialBlock[]) => {
        if (currentComment) {
            setCurrentComment({ ...currentComment, note: JSON.stringify(blocks) });
        }
    };

    const handleUpdateDescription = async (content: string) => {
        try {
            // Use the optimized handler if provided
            if (onUpdateDescription) {
                const success = await onUpdateDescription(content);
                
                if (success) {
                    // Update the local ticket state
                    const currentAttributes = ticket.attributes || {};
                    const updatedAttributes = {
                        ...currentAttributes,
                        description: content
                    };
                    
                    setTicket(prev => ({
                        ...prev,
                        attributes: updatedAttributes,
                        updated_at: new Date().toISOString()
                    }));
                }
                
                return success;
            } else {
                // Fallback to the original implementation
                const user = await getCurrentUser();
                if (!user) {
                    console.error('Failed to get user');
                    return false;
                }

                if (!ticket.ticket_id) {
                    console.error('Ticket ID is missing');
                    return false;
                }

                // Update the ticket's attributes.description field
                const currentAttributes = ticket.attributes || {};
                const updatedAttributes = {
                    ...currentAttributes,
                    description: content
                };

                // Update the ticket
                await updateTicket(ticket.ticket_id, {
                    attributes: updatedAttributes,
                    updated_by: user.user_id,
                    updated_at: new Date().toISOString()
                }, user);

                // Update the local ticket state
                setTicket(prev => ({
                    ...prev,
                    attributes: updatedAttributes,
                    updated_by: user.user_id,
                    updated_at: new Date().toISOString()
                }));


                toast.success('Description updated successfully');
                return true;
            }
        } catch (error) {
            console.error('Error updating description:', error);
            toast.error('Failed to update description');
            return false;
        }
    };

    const handleAddTimeEntry = async () => {
        try {
            if (!ticket.ticket_id || !userId) {
                console.error('Ticket ID or User ID is missing');
                toast.error('Unable to add time entry: Missing required information');
                return;
            }

            const currentTimePeriod = await getCurrentTimePeriod();

            if (!currentTimePeriod) {
                console.error('No current time period found');
                // Show the time period dialog instead of a toast
                setIsTimeEntryPeriodDialogOpen(true);
                return;
            }

            const timeSheet = await fetchOrCreateTimeSheet(userId!, currentTimePeriod.period_id);

            if (!timeSheet) {
                console.error('Failed to fetch or create time sheet');
                toast.error('Unable to add time entry: Failed to create or fetch time sheet');
                return;
            }

            // Create work item from ticket
            const workItem = {
                work_item_id: ticket.ticket_id,
                type: 'ticket' as const,
                name: ticket.title || 'Untitled Ticket',
                description: timeDescription,
                is_billable: true,
                ticket_number: ticket.ticket_number
            };

            // Calculate times based on timer
            const endTime = new Date();
            const startTime = new Date(endTime.getTime() - (elapsedTime * 1000));

            // Create initial time entry with description
            const initialEntry = {
                notes: timeDescription || '',
                start_time: startTime.toISOString(),
                end_time: endTime.toISOString(),
                billable_duration: Math.round(elapsedTime / 60), // Convert seconds to minutes
                work_item_type: 'ticket',
                work_item_id: ticket.ticket_id!
            };

            // Open drawer with TimeEntryDialog
            openDrawer(
                <TimeEntryDialog
                    id={`${id}-time-entry-dialog`}
                    isOpen={true}
                    onClose={closeDrawer}
                    onSave={async (timeEntry) => {
                        try {
                            await saveTimeEntry({
                                ...timeEntry,
                                time_sheet_id: timeSheet.id,
                                user_id: userId,
                                created_at: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                                approval_status: 'DRAFT',
                                billable_duration: Math.round(elapsedTime / 60), // Convert seconds to minutes
                                work_item_type: 'ticket',
                                work_item_id: ticket.ticket_id!,
                                start_time: startTime.toISOString(),
                                end_time: endTime.toISOString()
                            });
                            toast.success('Time entry saved successfully');
                            closeDrawer();
                        } catch (error) {
                            console.error('Error saving time entry:', error);
                            toast.error('Failed to save time entry');
                        }
                    }}
                    workItem={workItem}
                    date={new Date()}
                    existingEntries={[]}
                    timePeriod={currentTimePeriod!} // Already a view type from getCurrentTimePeriod
                    isEditable={true}
                    defaultStartTime={startTime}
                    defaultEndTime={endTime}
                    timeSheetId={timeSheet.id}
                    inDrawer={true}
                />
            );

            // Stop and reset timer
            setIsRunning(false);
            setElapsedTime(0);
            setTimeDescription('');
        } catch (error) {
            console.error('Error in handleAddTimeEntry:', error);
            toast.error('An error occurred while preparing the time entry. Please try again.');
        }
    };

    const handleChangeContact = () => {
        setIsChangeContactDialogOpen(true);
    };

    const handleChangeCompany = () => {
        setIsChangeCompanyDialogOpen(true);
    };

    const handleContactChange = async (newContactId: string | null) => {
        try {
            const user = await getCurrentUser();
            if (!user) {
                toast.error('No user session found');
                return;
            }

            await updateTicket(ticket.ticket_id!, { contact_name_id: newContactId }, user);
            
            if (newContactId) {
                const contactData = await getContactByContactNameId(newContactId);
                setContactInfo(contactData);
            } else {
                setContactInfo(null);
            }

            setIsChangeContactDialogOpen(false);
            toast.success('Contact updated successfully');
        } catch (error) {
            console.error('Error updating contact:', error);
            toast.error('Failed to update contact');
        }
    };

    const handleCompanyChange = async (newCompanyId: string) => {
        try {
            const user = await getCurrentUser();
            if (!user) {
                toast.error('No user session found');
                return;
            }

            await updateTicket(ticket.ticket_id!, { 
                company_id: newCompanyId,
                contact_name_id: null // Reset contact when company changes
            }, user);
            
            const [companyData, contactsData] = await Promise.all([
                getCompanyById(newCompanyId),
                getContactsByCompany(newCompanyId)
            ]);
            
            setCompany(companyData);
            setContacts(contactsData || []);
            setContactInfo(null); // Reset contact info

            setIsChangeCompanyDialogOpen(false);
            toast.success('Client updated successfully');
        } catch (error) {
            console.error('Error updating company:', error);
            toast.error('Failed to update client');
        }
    };

    const handleDeleteRequest = (conversation: IComment) => {
        // Only allow users to delete their own comments
        if (userId === conversation.user_id) {
            setCommentToDelete(conversation.comment_id!);
            setIsDeleteDialogOpen(true);
        } else {
            toast.error('You can only delete your own comments');
        }
    };

    const handleDeleteConfirm = async () => {
        if (!commentToDelete) return;
        
        try {
            await deleteComment(commentToDelete);
            setConversations(prevConversations =>
                prevConversations.filter(conv => conv.comment_id !== commentToDelete)
            );
            toast.success('Comment deleted successfully');
        } catch (error) {
            console.error("Error deleting comment:", error);
            toast.error('Failed to delete comment');
        } finally {
            setIsDeleteDialogOpen(false);
            setCommentToDelete(null);
        }
    };

    return (
        <ReflectionContainer id={id} label={`Ticket Details - ${ticket.ticket_number}`}>
            <div className="bg-gray-100">
                <div className="flex items-center space-x-5 mb-4">
                    {/* Only show the Back button if onClose is NOT provided (i.e., not in a drawer) */}
                    {!onClose && (
                        <button
                            id="back-to-tickets-button"
                            type="button"
                            className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300"
                            onClick={handleBackToTickets}
                        >
                            Back to Tickets
                        </button>
                    )}
                    <h6 className="text-sm font-medium">#{ticket.ticket_number}</h6>
                    <h1 className="text-xl font-bold">{ticket.title}</h1>
                </div>

                <div className="flex items-center space-x-5 mb-5">
                    {ticket.entered_at && (
                        <p>Created {formatDistanceToNow(new Date(ticket.entered_at))} ago</p>
                    )}
                    {ticket.updated_at && (
                        <p>Updated {formatDistanceToNow(new Date(ticket.updated_at))} ago</p>
                    )}
                </div>
                {/* Confirmation Dialog for Comment Deletion */}
                <ConfirmationDialog
                    id={`${id}-delete-comment-dialog`}
                    isOpen={isDeleteDialogOpen}
                    onClose={() => {
                        setIsDeleteDialogOpen(false);
                        setCommentToDelete(null);
                    }}
                    onConfirm={handleDeleteConfirm}
                    title="Delete Comment"
                    message="Are you sure you want to delete this comment? This action cannot be undone."
                    confirmLabel="Delete"
                    cancelLabel="Cancel"
                />
                
                <ConfirmationDialog
                    id={`${id}-time-period-dialog`}
                    isOpen={isTimeEntryPeriodDialogOpen}
                    onClose={() => setIsTimeEntryPeriodDialogOpen(false)}
                    onConfirm={() => {
                        setIsTimeEntryPeriodDialogOpen(false);
                        router.push('/msp/billing?tab=time-periods');
                    }}
                    title="No Active Time Period"
                    message="No active time period found. Time periods need to be set up in the billing dashboard before adding time entries."
                    confirmLabel="Go to Time Periods Setup"
                    cancelLabel="Cancel"
                />

                <div className="flex gap-6">
                    <div className="flex-grow col-span-2 space-y-6" id="ticket-main-content">
                        <Suspense fallback={<div id="ticket-info-skeleton" className="animate-pulse bg-gray-200 h-64 rounded-lg mb-6"></div>}>
                            <TicketInfo
                                id={`${id}-info`}
                                ticket={ticket}
                                conversations={conversations}
                                statusOptions={statusOptions}
                                agentOptions={agentOptions}
                                channelOptions={channelOptions}
                                priorityOptions={priorityOptions}
                                onSelectChange={handleSelectChange}
                                onUpdateDescription={handleUpdateDescription}
                                isSubmitting={isSubmitting}
                                users={availableAgents}
                            />
                        </Suspense>
                        <Suspense fallback={<div id="ticket-conversation-skeleton" className="animate-pulse bg-gray-200 h-96 rounded-lg mb-6"></div>}>
                            <TicketConversation
                                id={`${id}-conversation`}
                                ticket={ticket}
                                conversations={conversations}
                                documents={documents}
                                userMap={userMap}
                                currentUser={session?.user}
                                activeTab={activeTab}
                                isEditing={isEditing}
                                currentComment={currentComment}
                                editorKey={editorKey}
                                onNewCommentContentChange={setNewCommentContent}
                                onAddNewComment={handleAddNewComment}
                                onTabChange={setActiveTab}
                                onEdit={handleEdit}
                                onSave={handleSave}
                                onClose={handleClose}
                                onDelete={handleDeleteRequest}
                                onContentChange={handleContentChange}
                                isSubmitting={isSubmitting}
                            />
                        </Suspense>
                    </div>
                    <div className="w-96" id="ticket-properties-container">
                        <Suspense fallback={<div id="ticket-properties-skeleton" className="animate-pulse bg-gray-200 h-96 rounded-lg mb-6"></div>}>
                            <TicketProperties
                                id={`${id}-properties`}
                                ticket={ticket}
                                company={company}
                                contactInfo={contactInfo}
                                createdByUser={createdByUser}
                                channel={channel}
                                elapsedTime={elapsedTime}
                                isRunning={isRunning}
                                timeDescription={timeDescription}
                                onStart={() => setIsRunning(true)}
                                onPause={() => setIsRunning(false)}
                                onStop={() => {
                                    setIsRunning(false);
                                    setElapsedTime(0);
                                }}
                                onTimeDescriptionChange={setTimeDescription}
                                onAddTimeEntry={handleAddTimeEntry}
                                onCompanyClick={handleCompanyClick}
                                onContactClick={handleContactClick}
                                team={team}
                                additionalAgents={additionalAgents}
                                availableAgents={availableAgents}
                                onAgentClick={handleAgentClick}
                                onAddAgent={handleAddAgent}
                                onRemoveAgent={handleRemoveAgent}
                                currentTimeSheet={currentTimeSheet}
                                currentTimePeriod={currentTimePeriod}
                                userId={userId || ''}
                                tenant={tenant}
                                contacts={contacts}
                                companies={companies}
                                companyFilterState={companyFilterState}
                                clientTypeFilter={clientTypeFilter}
                                onChangeContact={handleContactChange}
                                onChangeCompany={handleCompanyChange}
                                onCompanyFilterStateChange={setCompanyFilterState}
                                onClientTypeFilterChange={setClientTypeFilter}
                            />
                        </Suspense>
                        
                        {/* Assets - commented out for now
                        {ticket.company_id && ticket.ticket_id && (
                            <div className="mt-6" id="associated-assets-container">
                                <Suspense fallback={<div id="associated-assets-skeleton" className="animate-pulse bg-gray-200 h-32 rounded-lg"></div>}>
                                    <AssociatedAssets
                                        id={`${id}-associated-assets`}
                                        entityId={ticket.ticket_id}
                                        entityType="ticket"
                                        companyId={ticket.company_id}
                                    />
                                </Suspense>
                            </div>
                        )}
                        */}
                    </div>
                </div>
            </div>
        </ReflectionContainer>
    );
};

export default TicketDetails;
