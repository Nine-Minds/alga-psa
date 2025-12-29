'use client';

import React, { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { utcToLocal, formatDateTime, getUserTimeZone } from 'server/src/lib/utils/dateTimeUtils';
import { getTicketingDisplaySettings } from 'server/src/lib/actions/ticket-actions/ticketDisplaySettings';
import { ConfirmationDialog } from "server/src/components/ui/ConfirmationDialog";
import {
    ITicket,
    IComment,
    ITimeSheet,
    ITimePeriod,
    ITimePeriodView,
    ITimeEntry,
    IClient,
    IClientLocation,
    IContact,
    IUser,
    IUserWithRoles,
    ITeam,
    ITicketResource,
    ITicketCategory
} from "server/src/interfaces";
import { ITag } from "server/src/interfaces/tag.interfaces";
import { TagManager } from "server/src/components/tags";
import { findTagsByEntityId } from "server/src/lib/actions/tagActions";
import { useTags } from "server/src/context/TagContext";
import TicketInfo from "server/src/components/tickets/ticket/TicketInfo";
import TicketProperties from "server/src/components/tickets/ticket/TicketProperties";
import TicketDocumentsSection from "server/src/components/tickets/ticket/TicketDocumentsSection";
import TicketConversation from "server/src/components/tickets/ticket/TicketConversation";
import AssociatedAssets from "server/src/components/assets/AssociatedAssets";
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import { useDrawer } from "server/src/context/DrawerContext";
import { findUserById, getCurrentUser } from "server/src/lib/actions/user-actions/userActions";
import { findBoardById, getAllBoards } from "server/src/lib/actions/board-actions/boardActions";
import { findCommentsByTicketId, deleteComment, createComment, updateComment, findCommentById } from "server/src/lib/actions/comment-actions/commentActions";
import { getDocumentByTicketId } from "server/src/lib/actions/document-actions/documentActions";
import { getContactByContactNameId, getContactsByClient } from "server/src/lib/actions/contact-actions/contactActions";
import { getClientById, getAllClients } from "server/src/lib/actions/client-actions/clientActions";
import { updateTicketWithCache } from "server/src/lib/actions/ticket-actions/optimizedTicketActions";
import { updateTicket } from "server/src/lib/actions/ticket-actions/ticketActions";
import { getTicketStatuses } from "server/src/lib/actions/status-actions/statusActions";
import { getAllPriorities } from "server/src/lib/actions/priorityActions";
import { fetchTimeSheets, fetchOrCreateTimeSheet, saveTimeEntry } from "server/src/lib/actions/timeEntryActions";
import { getCurrentTimePeriod } from "server/src/lib/actions/timePeriodsActions";
import ContactDetailsView from "server/src/components/contacts/ContactDetailsView";
import ClientDetails from "server/src/components/clients/ClientDetails";
import { addTicketResource, getTicketResources, removeTicketResource } from "server/src/lib/actions/ticketResourceActions";
import AgentScheduleDrawer from "server/src/components/tickets/ticket/AgentScheduleDrawer";
import { Button } from "server/src/components/ui/Button";
import { ExternalLink, Save, X } from 'lucide-react';
import { WorkItemType } from "server/src/interfaces/workItem.interfaces";
import { ReflectionContainer } from "server/src/types/ui-reflection/ReflectionContainer";
import TimeEntryDialog from "server/src/components/time-management/time-entry/time-sheet/TimeEntryDialog";
import { PartialBlock, StyledText } from '@blocknote/core';
import { useTicketTimeTracking } from "server/src/hooks/useTicketTimeTracking";
import { IntervalTrackingService } from "server/src/services/IntervalTrackingService";
import { IntervalManagement } from "server/src/components/time-management/interval-tracking/IntervalManagement";
import { convertBlockNoteToMarkdown } from "server/src/lib/utils/blocknoteUtils";
import BackNav from 'server/src/components/ui/BackNav';
import type { SurveyTicketSatisfactionSummary } from 'server/src/interfaces/survey.interface';

interface TicketDetailsProps {
    id?: string; // Made optional to maintain backward compatibility
    initialTicket: ITicket & { tenant: string | undefined };
    onClose?: () => void; // Callback when user wants to close the ticket screen
    isInDrawer?: boolean;

    // Pre-fetched data props
    initialComments?: IComment[];
    initialDocuments?: any[];
    initialClient?: IClient | null;
    initialContacts?: IContact[];
    initialContactInfo?: IContact | null;
    initialCreatedByUser?: IUser | null;
    initialBoard?: any;
    initialAdditionalAgents?: ITicketResource[];
    initialAvailableAgents?: IUserWithRoles[];
    initialUserMap?: Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string, avatarUrl: string | null }>;
    statusOptions?: { value: string; label: string }[];
    agentOptions?: { value: string; label: string }[];
    boardOptions?: { value: string; label: string }[];
    priorityOptions?: { value: string; label: string }[];
    initialCategories?: ITicketCategory[];
    initialClients?: IClient[];
    initialLocations?: IClientLocation[];
    initialAgentSchedules?: { userId: string; minutes: number }[];

    // Current user (for drawer usage)
    currentUser?: IUser | null;

    // Optimized handlers
    onTicketUpdate?: (field: string, value: any) => Promise<void>;
    onAddComment?: (content: string, isInternal: boolean, isResolution: boolean) => Promise<void>;
    onUpdateDescription?: (content: string) => Promise<boolean>;
    isSubmitting?: boolean;
    surveySummary?: SurveyTicketSatisfactionSummary | null;
}

const TicketDetails: React.FC<TicketDetailsProps> = ({
    id = 'ticket-details',
    initialTicket,
    onClose,
    isInDrawer = false,
    // Pre-fetched data with defaults
    initialComments = [],
    initialDocuments = [],
    initialClient = null,
    initialContacts = [],
    initialContactInfo = null,
    initialCreatedByUser = null,
    initialBoard = null,
    initialAdditionalAgents = [],
    initialAvailableAgents = [],
    initialUserMap = {},
    statusOptions = [],
    agentOptions = [],
    boardOptions = [],
    priorityOptions = [],
    initialCategories = [],
    initialClients = [],
    initialLocations = [],
    initialAgentSchedules = [],
    // Current user (for drawer usage)
    currentUser,
    // Optimized handlers
    onTicketUpdate,
    onAddComment,
    onUpdateDescription,
    isSubmitting = false,
    surveySummary = null
}) => {
    const { data: session } = useSession();
    // Use passed currentUser if available (for drawer), otherwise fallback to session
    const userId = currentUser?.user_id || session?.user?.id;
    const tenant = initialTicket.tenant;
    if (!tenant) {
        throw new Error('tenant is not defined');
    }

    const [ticket, setTicket] = useState(initialTicket);
    const [conversations, setConversations] = useState<IComment[]>(initialComments);
    const [documents, setDocuments] = useState<any[]>(initialDocuments);
    const [client, setClient] = useState<IClient | null>(initialClient);
    const [contactInfo, setContactInfo] = useState<IContact | null>(initialContactInfo);
    const [createdByUser, setCreatedByUser] = useState<IUser | null>(initialCreatedByUser);
    const [board, setBoard] = useState<any>(initialBoard);
    const [clients, setClients] = useState<IClient[]>(initialClients);
    const [contacts, setContacts] = useState<IContact[]>(initialContacts);
    const [locations, setLocations] = useState<IClientLocation[]>(initialLocations);
    const [dateTimeFormat, setDateTimeFormat] = useState<string>('MMM d, yyyy h:mm a');
    const [createdRelativeTime, setCreatedRelativeTime] = useState<string>('');
    const [updatedRelativeTime, setUpdatedRelativeTime] = useState<string>('');

    // Use pre-fetched options directly
    const [userMap, setUserMap] = useState<Record<string, { user_id: string; first_name: string; last_name: string; email?: string, user_type: string, avatarUrl: string | null }>>(initialUserMap);

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
    const [isRunning, setIsRunning] = useState(false);
    const [timeDescription, setTimeDescription] = useState('');
    const [tags, setTags] = useState<ITag[]>([]);
    const { tags: allTags } = useTags();
    const [currentTimeSheet, setCurrentTimeSheet] = useState<ITimeSheet | null>(null);
    const [currentTimePeriod, setCurrentTimePeriod] = useState<ITimePeriodView | null>(null);

    const [team, setTeam] = useState<ITeam | null>(null);

    const [isChangeContactDialogOpen, setIsChangeContactDialogOpen] = useState(false);
    const [isChangeClientDialogOpen, setIsChangeClientDialogOpen] = useState(false);
    const [clientFilterState, setClientFilterState] = useState<'all' | 'active' | 'inactive'>('all');
    const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [commentToDelete, setCommentToDelete] = useState<string | null>(null);
    const [isTimeEntryPeriodDialogOpen, setIsTimeEntryPeriodDialogOpen] = useState(false);

    // Track if any changes have been made to the ticket (for Save button feedback)
    // Store original ticket state for cancel/reset functionality (like ContractDialog pattern)
    const [originalTicket, setOriginalTicket] = useState<ITicket & { tenant: string | undefined }>(initialTicket);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSavingTicket, setIsSavingTicket] = useState(false);
    const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    // ITIL-specific state for editing
    const [itilImpact, setItilImpact] = useState<number | undefined>(ticket.itil_impact || undefined);
    const [itilUrgency, setItilUrgency] = useState<number | undefined>(ticket.itil_urgency || undefined);
    // NOTE: ITIL categories are now managed through the unified category system

    const { openDrawer, closeDrawer } = useDrawer();
    const router = useRouter();
    // Create a single instance of the service
    const intervalService = useMemo(() => new IntervalTrackingService(), []);

    // Timer logic
    const tick = useCallback(() => {
        setElapsedTime(prevTime => {
            const next = prevTime + 1;
            try {
                console.log('[TicketDetails][tick] +1s ->', next, 'isRunning=', isRunning);
            } catch {}
            return next;
        });
    }, [isRunning]);

    useEffect(() => {
        let intervalId: NodeJS.Timeout | undefined;
        if (isRunning) {
            console.log('[TicketDetails] starting 1s UI timer');
            intervalId = setInterval(tick, 1000);
        } else {
            console.log('[TicketDetails] not running; UI timer not started');
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
                console.log('[TicketDetails] cleared 1s UI timer');
            }
        };
    }, [isRunning, tick]);

    // Load ticketing display settings
    useEffect(() => {
        const loadDisplaySettings = async () => {
            try {
                const settings = await getTicketingDisplaySettings();
                if (settings?.dateTimeFormat) {
                    setDateTimeFormat(settings.dateTimeFormat);
                }
            } catch (error) {
                console.error('Failed to load ticketing display settings:', error);
            }
        };
        loadDisplaySettings();
    }, []);

    // Calculate relative time strings only on client side to avoid hydration mismatch
    useEffect(() => {
        const tz = getUserTimeZone();
        
        if (ticket.entered_at) {
            const localDate = utcToLocal(ticket.entered_at, tz);
            const formattedDate = formatDateTime(localDate, tz, dateTimeFormat);
            const distance = formatDistanceToNow(new Date(ticket.entered_at));
            setCreatedRelativeTime(`${formattedDate} (${distance} ago)`);
        }
        
        if (ticket.updated_at) {
            const localDate = utcToLocal(ticket.updated_at, tz);
            const formattedDate = formatDateTime(localDate, tz, dateTimeFormat);
            const distance = formatDistanceToNow(new Date(ticket.updated_at));
            setUpdatedRelativeTime(`${formattedDate} (${distance} ago)`);
        }
    }, [ticket.entered_at, ticket.updated_at, dateTimeFormat]);

    // Fetch tags when component mounts
    useEffect(() => {
        const fetchTags = async () => {
            if (!ticket.ticket_id) return;
            
            try {
                const ticketTags = await findTagsByEntityId(ticket.ticket_id, 'ticket');
                setTags(ticketTags);
            } catch (error) {
                console.error('Error fetching tags:', error);
            }
        };
        fetchTags();
    }, [ticket.ticket_id]);
    
    
    // Add automatic interval tracking using the custom hook
    // Unique holder ID per tab for lock ownership
    const [holderId] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            const existing = sessionStorage.getItem('tabHolderId');
            if (existing) return existing;
            const id = crypto.randomUUID();
            sessionStorage.setItem('tabHolderId', id);
            return id;
        }
        return Math.random().toString(36).slice(2);
    });

    const {
        isTracking,
        currentIntervalId,
        isLockedByOther,
        startTracking,
        stopTracking,
        refreshLockState,
    } = useTicketTimeTracking(
        initialTicket.ticket_id || '',
        initialTicket.ticket_number || '',
        initialTicket.title || '',
        userId || '',
        { autoStart: false, holderId }
    );

    // Stabilize startTracking for effects to avoid repeated auto-attempts due to function identity changes
    const startTrackingRef = React.useRef(startTracking);
    useEffect(() => { startTrackingRef.current = startTracking; }, [startTracking]);

    // Reflect tracking state into local stopwatch state
    useEffect(() => {
        console.log('[TicketDetails] isTracking changed ->', isTracking);
        setIsRunning(!!isTracking);
    }, [isTracking]);

    // Proactive auto-start on mount when userId/ticketId ready (no dialog on lock)
    const autoStartedRef = React.useRef(false);
    useEffect(() => {
        const auto = async () => {
            if (autoStartedRef.current) return;
            if (!initialTicket.ticket_id || !userId) return;
            if (isTracking) return;
            console.log('[TicketDetails] auto-start attempt');
            try {
                const started = await startTrackingRef.current(false);
                console.log('[TicketDetails] auto-start result ->', started);
                if (started) {
                    setElapsedTime(0);
                    autoStartedRef.current = true;
                }
            } catch (e) {
                console.log('[TicketDetails] auto-start error', e);
            }
        };
        auto();
        // only attempt once when ids are ready and not already tracking
    }, [initialTicket.ticket_id, userId, isTracking]);

    // New screens start from zero; no seeding from existing intervals

    // Log holder id creation
    useEffect(() => {
        if (holderId) {
            console.log('[TicketDetails] holderId for this tab:', holderId);
        }
    }, [holderId]);

    // Log UI button handlers
    useEffect(() => {
        console.log('[TicketDetails] mounted; ticket=', initialTicket.ticket_id, 'user=', userId);
        return () => {
            console.log('[TicketDetails] unmounting; will call stopTracking in cleanup below');
        };
    }, [initialTicket.ticket_id, userId]);

    // Poll lock state periodically to update UI lock indicator
    useEffect(() => {
        let id: any;
        const poll = async () => {
            try { await refreshLockState(); } catch {}
        };
        id = setInterval(poll, 5000);
        poll();
        return () => clearInterval(id);
    }, [refreshLockState]);
    
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
            // Stop tracking and release lock before leaving
            await stopTracking();
            // Wait for the interval to close
            await closeCurrentInterval();
            
            // Navigate after interval is closed
            if (onClose) {
                onClose();
            } else {
                // Use proper routing to tickets dashboard instead of router.back()
                router.push('/msp/tickets');
            }
        } catch (error) {
            console.error('Error closing interval before navigation:', error);
            // Navigate anyway to prevent user from being stuck
            if (onClose) {
                onClose();
            } else {
                // Use proper routing to tickets dashboard instead of router.back()
                router.push('/msp/tickets');
            }
        }
    }, [closeCurrentInterval, onClose, router, stopTracking]);

    // Handle timer control actions with locking
    const [isReplaceDialogOpen, setIsReplaceDialogOpen] = useState(false);

    const doStart = useCallback(async (force = false) => {
        if (!initialTicket.ticket_id || !userId) return;
        try {
            const started = await startTracking(force);
            if (started) {
                setElapsedTime(0);
                setIsRunning(true);
            } else if (!force) {
                // Locked elsewhere
                setIsReplaceDialogOpen(true);
            }
        } catch (e) {
            console.error('Failed to start tracking:', e);
        }
    }, [initialTicket.ticket_id, userId, startTracking]);

    const handleStartClick = useCallback(() => {
        console.log('[TicketDetails] Start button clicked');
        doStart(false);
    }, [doStart]);

    const handleConfirmReplace = useCallback(async () => {
        setIsReplaceDialogOpen(false);
        await doStart(true);
    }, [doStart]);

    const handlePauseClick = useCallback(async () => {
        try {
            console.log('[TicketDetails] Pause button clicked');
            await stopTracking();
        } catch {}
        setIsRunning(false);
    }, [stopTracking]);

    const handleStopClick = useCallback(async () => {
        try {
            console.log('[TicketDetails] Stop/Reset button clicked');
            await stopTracking();
        } catch {}
        setIsRunning(false);
        setElapsedTime(0);
    }, [stopTracking]);

    // Ensure we stop tracking only when component unmounts (not on re-renders)
    const stopTrackingRef = React.useRef(stopTracking);
    useEffect(() => {
        stopTrackingRef.current = stopTracking;
    }, [stopTracking]);
    useEffect(() => {
        return () => {
            console.log('[TicketDetails] unmount cleanup -> stopTracking');
            stopTrackingRef.current?.().catch(() => {});
        };
    }, []);

    const handleClientClick = () => {
        if (client) {
            openDrawer(
                <ClientDetails
                    client={client}
                    isInDrawer={true}
                    quickView={true}
                />
            );
        } else {
            console.log('No client associated with this ticket');
        }
    };

    const handleContactClick = () => {
        if (contactInfo && client) {
            openDrawer(
                <ContactDetailsView
                    initialContact={{
                        ...contactInfo,
                        client_id: client.client_id
                    }}
                    clients={[client]}
                    isInDrawer={true}
                    clientReadOnly={true}
                />
            );
        } else {
            console.log('No contact information or client information available');
        }
    };

  const handleAgentClick = (userId: string) => {
    openDrawer(
      <AgentScheduleDrawer
        agentId={userId}
      />
    );
  };

    const handleAddAgent = async (userId: string) => {
        try {
            // Note: Agent changes are saved immediately (separate resource table)
            // They don't use the batch save pattern like other ticket fields
            const currentUser = await getCurrentUser();
            if (!currentUser) {
                toast.error('No user session found');
                return;
            }
            const result = await addTicketResource(ticket.ticket_id!, userId, 'support', currentUser);

            if (result) {
                setAdditionalAgents(prev => [...prev, result]);
                toast.success('Agent added successfully');
            } else {
                setTicket(prevTicket => ({
                    ...prevTicket,
                    assigned_to: userId
                }));
                toast.success('Agent assigned successfully');
            }
        } catch (error) {
            console.error('Error adding agent:', error);
            toast.error('Failed to add agent');
        }
    };  
    
    const handleRemoveAgent = async (assignmentId: string) => {
        try {
            // Note: Agent changes are saved immediately (separate resource table)
            // They don't use the batch save pattern like other ticket fields
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

    // Update local state only - save happens when Save button is clicked (like Clients/Contacts pattern)
    const handleSelectChange = (field: keyof ITicket, newValue: string | null) => {
        const normalizedValue =
            field === 'assigned_to'
                ? (newValue && newValue !== 'unassigned' ? newValue : null)
                : newValue;

        // Mark that changes have been made
        setHasUnsavedChanges(true);

        // Update local state only - no backend call (consistent with Clients/Contacts)
        setTicket(prevTicket => ({ ...prevTicket, [field]: normalizedValue }));
    };

    const [editorKey, setEditorKey] = useState(0);

    const handleAddNewComment = async (isInternal: boolean, isResolution: boolean): Promise<boolean> => {
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
            console.log("Cannot add empty comment");
            return false;
        }
    
        try {
            if (!userId) {
                console.error("No valid user ID found");
                return false;
            }
            
            // Use the centralized utility to convert BlockNote content to markdown
            const markdownContent = await convertBlockNoteToMarkdown(newCommentContent);
            console.log("Converted markdown content:", markdownContent);
    
            // Use the optimized handler if provided
            if (onAddComment) {
                await onAddComment(
                    JSON.stringify(newCommentContent),
                    isInternal,
                    isResolution
                );

                // Refresh comments to ensure immediate UI update
                if (ticket.ticket_id) {
                    try {
                        const updatedComments = await findCommentsByTicketId(ticket.ticket_id);
                        setConversations(updatedComments);
                    } catch (e) {
                        console.error('Failed to refresh comments after add:', e);
                    }
                }
                
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
                
                return true;
            } else {
                // Use the regular createComment action for MSP portal
                if (ticket.ticket_id && userId) {
                    // Call the regular comment creation action
                    const newComment = await createComment({
                        ticket_id: ticket.ticket_id,
                        note: JSON.stringify(newCommentContent),
                        is_internal: isInternal,
                        is_resolution: isResolution,
                        user_id: userId,
                        author_type: 'internal' // Will be overridden based on user type in the action
                    });
                    
                    if (newComment) {
                        // Refresh comments after adding
                        const updatedComments = await findCommentsByTicketId(ticket.ticket_id);
                        setConversations(updatedComments);
                        
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
                        console.log("New note added successfully");
                        return true;
                    } else {
                        console.error('Failed to add comment');
                        return false;
                    }
                } else {
                    console.error('Ticket ID is missing');
                    return false;
                }
            }
        } catch (error) {
            console.error("Error adding new note:", error);
            return false;
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

    // Update local state only - save happens when Save button is clicked (like Clients/Contacts pattern)
    const handleUpdateDescription = async (content: string): Promise<boolean> => {
        // Mark that changes have been made
        setHasUnsavedChanges(true);

        // Update local state only - no backend call
        const currentAttributes = ticket.attributes || {};
        const updatedAttributes = {
            ...currentAttributes,
            description: content
        };

        setTicket(prev => ({
            ...prev,
            attributes: updatedAttributes
        }));

        return true;
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
            const startTime = new Date();
            
            startTime.setTime(startTime.getTime() - (elapsedTime * 1000));
            if (elapsedTime > 0 && (endTime.getTime() - startTime.getTime()) < 60000) {
                startTime.setTime(endTime.getTime() - 60000);
            }
            
            console.log('Time entry times:', {
                startTime,
                endTime,
                elapsedTimeSeconds: elapsedTime,
                elapsedTimeMinutes: Math.round(elapsedTime / 60),
                timeDifferenceMs: endTime.getTime() - startTime.getTime(),
                timeDifferenceMinutes: (endTime.getTime() - startTime.getTime()) / 60000
            });

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
                                work_item_type: 'ticket',
                                work_item_id: ticket.ticket_id!
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

    const handleChangeClient = () => {
        setIsChangeClientDialogOpen(true);
    };

    const handleTagsChange = (updatedTags: ITag[]) => {
        // Mark that changes have been made
        setHasUnsavedChanges(true);
        setTags(updatedTags);
    };

    // Update local state only - save happens when Save button is clicked (like Clients/Contacts pattern)
    const handleContactChange = async (newContactId: string | null) => {
        try {
            // Mark that changes have been made
            setHasUnsavedChanges(true);

            // Update local state - no backend call
            setTicket(prevTicket => ({ ...prevTicket, contact_name_id: newContactId }));

            // Fetch contact info for display (but don't save to backend)
            if (newContactId) {
                const contactData = await getContactByContactNameId(newContactId);
                setContactInfo(contactData);
            } else {
                setContactInfo(null);
            }

            setIsChangeContactDialogOpen(false);
        } catch (error) {
            console.error('Error fetching contact data:', error);
            toast.error('Failed to load contact data');
        }
    };

    // Update local state only - save happens when Save button is clicked (like Clients/Contacts pattern)
    const handleItilFieldChange = (field: string, value: any) => {
        // Mark that changes have been made
        setHasUnsavedChanges(true);

        // Update local state only - no backend call (consistent with Clients/Contacts)
        switch (field) {
            case 'itil_impact':
                setItilImpact(value);
                setTicket(prevTicket => ({ ...prevTicket, itil_impact: value }));
                break;
            case 'itil_urgency':
                setItilUrgency(value);
                setTicket(prevTicket => ({ ...prevTicket, itil_urgency: value }));
                break;
        }
    };

    // Update local state only - save happens when Save button is clicked (like Clients/Contacts pattern)
    const handleClientChange = async (newClientId: string) => {
        try {
            // Mark that changes have been made
            setHasUnsavedChanges(true);

            // Fetch the new client data and contacts for UI (but don't save to backend)
            const [clientData, contactsData] = await Promise.all([
                getClientById(newClientId),
                getContactsByClient(newClientId)
            ]);

            // Update local state only - no backend call
            setTicket(prevTicket => ({
                ...prevTicket,
                client_id: newClientId,
                contact_name_id: null, // Reset contact when client changes
                location_id: null // Reset location when client changes
            }));

            setClient(clientData);
            setContacts(contactsData || []);
            setContactInfo(null); // Reset contact info
            setIsChangeClientDialogOpen(false);
        } catch (error) {
            console.error('Error fetching client data:', error);
            toast.error('Failed to load client data');
        }
    };
    
    // Update local state only - save happens when Save button is clicked (like Clients/Contacts pattern)
    const handleLocationChange = (newLocationId: string | null) => {
        // Mark that changes have been made
        setHasUnsavedChanges(true);

        // Update local state only - no backend call
        setTicket(prevTicket => ({
            ...prevTicket,
            location_id: newLocationId,
            location: newLocationId ? locations.find(l => l.location_id === newLocationId) : undefined
        }));
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

    // Function to open ticket in a new window
    const openTicketInNewWindow = useCallback(() => {
        if (ticket.ticket_id) {
            window.open(`/msp/tickets/${ticket.ticket_id}`, '_blank');
        }
    }, [ticket.ticket_id]);

    // Validate ticket before save (like ContractDialog pattern)
    const validateTicket = useCallback((): string[] => {
        const errors: string[] = [];

        // Required field validation
        if (!ticket.title?.trim()) {
            errors.push('Title is required');
        }

        if (!ticket.status_id) {
            errors.push('Status is required');
        }

        if (!ticket.priority_id) {
            errors.push('Priority is required');
        }

        if (!ticket.assigned_to) {
            errors.push('Assigned agent is required');
        }

        return errors;
    }, [ticket.title, ticket.status_id, ticket.priority_id, ticket.assigned_to]);

    // Handle save button click - validates and provides confirmation (ContractDialog pattern)
    // Save all changes to backend (like Clients/Contacts pattern)
    const handleSaveTicket = useCallback(async () => {
        setHasAttemptedSave(true);

        // Validate before saving
        const errors = validateTicket();
        setValidationErrors(errors);

        if (errors.length > 0) {
            toast.error('Please fix validation errors before saving');
            return;
        }

        setIsSavingTicket(true);
        try {
            const user = await getCurrentUser();
            if (!user) {
                toast.error('No user session found');
                return;
            }

            if (!ticket.ticket_id) {
                toast.error('Ticket ID is missing');
                return;
            }

            // Build the update object with all changed fields
            const updateData: Partial<ITicket> = {
                title: ticket.title,
                status_id: ticket.status_id,
                priority_id: ticket.priority_id,
                assigned_to: ticket.assigned_to,
                client_id: ticket.client_id,
                contact_name_id: ticket.contact_name_id,
                location_id: ticket.location_id,
                category_id: ticket.category_id,
                subcategory_id: ticket.subcategory_id,
                attributes: ticket.attributes,
                itil_impact: ticket.itil_impact,
                itil_urgency: ticket.itil_urgency,
                updated_by: user.user_id,
                updated_at: new Date().toISOString()
            };

            // Save to backend
            const result = await updateTicket(ticket.ticket_id, updateData, user);

            if (result === 'success') {
                // Update the original ticket state to reflect saved changes
                setOriginalTicket(ticket);
                setHasUnsavedChanges(false);
                setHasAttemptedSave(false);
                setValidationErrors([]);
                toast.success('Ticket saved successfully');
            } else {
                toast.error('Failed to save ticket');
            }
        } catch (error) {
            console.error('Error saving ticket:', error);
            toast.error('Failed to save ticket');
        } finally {
            setIsSavingTicket(false);
        }
    }, [validateTicket, ticket]);

    // Handle cancel button click - resets to original state (ContractDialog pattern)
    const handleCancelChanges = useCallback(() => {
        if (!hasUnsavedChanges) {
            toast('No changes to discard');
            return;
        }

        // Reset ticket state to original
        setTicket(originalTicket);

        // Reset ITIL-specific state
        setItilImpact(originalTicket.itil_impact || undefined);
        setItilUrgency(originalTicket.itil_urgency || undefined);

        // Clear tracking states
        setHasUnsavedChanges(false);
        setHasAttemptedSave(false);
        setValidationErrors([]);

        toast.success('Changes discarded');
    }, [hasUnsavedChanges, originalTicket]);

    return (
        <ReflectionContainer id={id} label={`Ticket Details - ${ticket.ticket_number}`}>
            <div className="bg-gray-100">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-5 min-w-0 flex-1">
                        {/* Only show the Back button if NOT in a drawer, using BackNav */}
                        {!isInDrawer && (
                            <BackNav href="/msp/tickets">← Back to Tickets</BackNav>
                        )}
                        <h6 className="text-sm font-medium whitespace-nowrap">#{ticket.ticket_number}</h6>
                        <h1 className="text-xl font-bold break-words max-w-full min-w-0 flex-1" style={{overflowWrap: 'break-word', wordBreak: 'break-word', whiteSpace: 'pre-wrap'}}>{ticket.title}</h1>
                    </div>
                    
                    {/* Action buttons - ContractDialog pattern with Cancel/Save */}
                    <div className="flex items-center gap-2">
                        {/* Add popout button only when in drawer */}
                        {isInDrawer && (
                            <Button
                                id="ticket-popout-button"
                                variant="outline"
                                size="sm"
                                onClick={openTicketInNewWindow}
                                className="flex items-center gap-2"
                                aria-label="Open in new tab"
                            >
                                <ExternalLink className="h-4 w-4" />
                                <span>Open in new tab</span>
                            </Button>
                        )}
                        {/* Cancel button - resets local edits (ContractDialog pattern) */}
                        {hasUnsavedChanges && (
                            <Button
                                id="cancel-ticket-changes-btn"
                                variant="outline"
                                size="sm"
                                onClick={handleCancelChanges}
                                disabled={isSavingTicket}
                                className="flex items-center gap-2"
                            >
                                <X className="h-4 w-4" />
                                <span>Cancel</span>
                            </Button>
                        )}
                        {/* Save button - validates and commits (ContractDialog pattern) */}
                        <Button
                            id="save-ticket-btn"
                            variant="default"
                            size="sm"
                            onClick={handleSaveTicket}
                            disabled={isSavingTicket}
                            className={`flex items-center gap-2 ${hasUnsavedChanges ? 'ring-2 ring-primary-300' : ''}`}
                        >
                            <Save className="h-4 w-4" />
                            <span>{isSavingTicket ? 'Saving...' : 'Save Ticket'}</span>
                        </Button>
                    </div>
                </div>

                {/* Validation errors alert - shown after attempted save (ContractDialog pattern) */}
                {hasAttemptedSave && validationErrors.length > 0 && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-sm font-medium text-red-800 mb-1">Please fix the following errors:</p>
                        <ul className="list-disc list-inside text-sm text-red-700">
                            {validationErrors.map((error, index) => (
                                <li key={index}>{error}</li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="flex items-center space-x-5 mb-5 text-sm text-gray-600">
                    {ticket.entered_at && (
                        <p>
                            Created {createdRelativeTime || (() => {
                                const tz = getUserTimeZone();
                                const localDate = utcToLocal(ticket.entered_at, tz);
                                return formatDateTime(localDate, tz, dateTimeFormat);
                            })()}
                        </p>
                    )}
                    {ticket.updated_at && (
                        <p>
                            Updated {updatedRelativeTime || (() => {
                                const tz = getUserTimeZone();
                                const localDate = utcToLocal(ticket.updated_at, tz);
                                return formatDateTime(localDate, tz, dateTimeFormat);
                            })()}
                        </p>
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
                
                {/* Timer Replace Confirmation */}
                <ConfirmationDialog
                    id={`${id}-replace-timer-dialog`}
                    isOpen={isReplaceDialogOpen}
                    onClose={() => setIsReplaceDialogOpen(false)}
                    onConfirm={handleConfirmReplace}
                    title="Timer Active Elsewhere"
                    message="This ticket's timer is active in another window. Do you want to take over and replace it here?"
                    confirmLabel="Replace Here"
                    cancelLabel="Cancel"
                />

                <ConfirmationDialog
                    id={`${id}-time-period-dialog`}
                    isOpen={isTimeEntryPeriodDialogOpen}
                    onClose={() => setIsTimeEntryPeriodDialogOpen(false)}
                    onConfirm={() => {
                        setIsTimeEntryPeriodDialogOpen(false);
                        router.push('/msp/settings?tab=time-entry&subtab=time-periods');
                    }}
                    title="No Active Time Period"
                    message="No active time period found. Time periods need to be set up in the billing dashboard before adding time entries."
                    confirmLabel="Go to Time Periods Setup"
                    cancelLabel="Cancel"
                />

                <div className="flex gap-6 min-w-0">
                    <div className="flex-grow col-span-2 min-w-0" id="ticket-main-content">
                        <Suspense fallback={<div id="ticket-info-skeleton" className="animate-pulse bg-gray-200 h-64 rounded-lg mb-6"></div>}>
                            <div className="mb-6">
                                <TicketInfo
                                    id={`${id}-info`}
                                    ticket={ticket}
                                    conversations={conversations}
                                    statusOptions={statusOptions}
                                    agentOptions={agentOptions}
                                    boardOptions={boardOptions}
                                    priorityOptions={priorityOptions}
                                    onSelectChange={handleSelectChange}
                                    onUpdateDescription={handleUpdateDescription}
                                    isSubmitting={isSubmitting}
                                    users={availableAgents}
                                    tags={tags}
                                    allTagTexts={allTags.filter(tag => tag.tagged_type === 'ticket').map(tag => tag.tag_text)}
                                    onTagsChange={handleTagsChange}
                                    isInDrawer={isInDrawer}
                                    onItilFieldChange={handleItilFieldChange}
                                    itilImpact={itilImpact}
                                    itilUrgency={itilUrgency}
                                />
                            </div>
                        </Suspense>
                        <Suspense fallback={<div id="ticket-conversation-skeleton" className="animate-pulse bg-gray-200 h-96 rounded-lg mb-6"></div>}>
                            <div className="mb-6">
                                <TicketConversation
                                    id={`${id}-conversation`}
                                    ticket={ticket}
                                    conversations={conversations}
                                    documents={documents}
                                    userMap={userMap}
                                    currentUser={currentUser ? {
                                        id: currentUser.user_id,
                                        name: `${currentUser.first_name} ${currentUser.last_name}`,
                                        email: currentUser.email,
                                        avatarUrl: null
                                    } : session?.user}
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
                                    hideInternalTab={false}
                                />
                            </div>
                        </Suspense>
                        
                        <Suspense fallback={<div id="ticket-documents-skeleton" className="animate-pulse bg-gray-200 h-64 rounded-lg mb-6"></div>}>
                            <TicketDocumentsSection
                                id={`${id}-documents-section`}
                                ticketId={ticket.ticket_id || ''}
                                initialDocuments={documents}
                                onDocumentCreated={async () => {
                                    router.refresh();
                                }}
                            />
                        </Suspense>
                    </div>
                    <div className={isInDrawer ? "w-96" : "w-1/4"} id="ticket-properties-container">
                        <Suspense fallback={<div id="ticket-properties-skeleton" className="animate-pulse bg-gray-200 h-96 rounded-lg mb-6"></div>}>
                            <TicketProperties
                                id={`${id}-properties`}
                                ticket={ticket}
                                client={client}
                                contactInfo={contactInfo}
                                createdByUser={createdByUser}
                                board={board}
                                elapsedTime={elapsedTime}
                                isRunning={isRunning}
                                timeDescription={timeDescription}
                                isTimerLocked={isLockedByOther}
                                onStart={handleStartClick}
                                onPause={handlePauseClick}
                                onStop={handleStopClick}
                                onTimeDescriptionChange={setTimeDescription}
                                onAddTimeEntry={handleAddTimeEntry}
                                onClientClick={handleClientClick}
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
                                clients={clients}
                                locations={locations}
                                clientFilterState={clientFilterState}
                                clientTypeFilter={clientTypeFilter}
                                onChangeContact={handleContactChange}
                                onChangeClient={handleClientChange}
                                onChangeLocation={handleLocationChange}
                                onClientFilterStateChange={setClientFilterState}
                                onClientTypeFilterChange={setClientTypeFilter}
                                tags={tags}
                                allTagTexts={allTags.filter(tag => tag.tagged_type === 'ticket').map(tag => tag.tag_text)}
                                onTagsChange={handleTagsChange}
                                onItilFieldChange={handleItilFieldChange}
                                surveySummary={surveySummary}
                            />
                        </Suspense>
                        
                        {/* Associated Assets - with Remote Access for RMM-managed devices */}
                        {ticket.client_id && ticket.ticket_id && (
                            <div className="mt-6" id="associated-assets-container">
                                <Suspense fallback={<div id="associated-assets-skeleton" className="animate-pulse bg-gray-200 h-32 rounded-lg"></div>}>
                                    <AssociatedAssets
                                        id={`${id}-associated-assets`}
                                        entityId={ticket.ticket_id}
                                        entityType="ticket"
                                        clientId={ticket.client_id}
                                        defaultBoardId={ticket.board_id}
                                    />
                                </Suspense>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </ReflectionContainer>
    );
};

export default TicketDetails;
