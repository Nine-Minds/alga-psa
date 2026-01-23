'use client';

import React, { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { utcToLocal, formatDateTime, getUserTimeZone } from '@alga-psa/core';
import { getTicketingDisplaySettings } from '../../actions/ticketDisplaySettings';
import { ConfirmationDialog } from "@alga-psa/ui/components/ConfirmationDialog";
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
} from "@alga-psa/types";
import { ITag } from "@alga-psa/types";
import { TagManager } from "@alga-psa/tags/components";
import { findTagsByEntityId } from "@alga-psa/tags/actions";
import { useTags } from '@alga-psa/tags/context';
import TicketInfo from "./TicketInfo";
import TicketProperties from "./TicketProperties";
import TicketDocumentsSection from "./TicketDocumentsSection";
import TicketConversation from "./TicketConversation";
import { useSession } from 'next-auth/react';
import { toast } from 'react-hot-toast';
import { useDrawer } from "@alga-psa/ui";
import { findUserById, getCurrentUser } from "@alga-psa/users/actions";
import { findBoardById, getAllBoards } from "@alga-psa/tickets/actions";
import { findCommentsByTicketId, deleteComment, createComment, updateComment, findCommentById } from "@alga-psa/tickets/actions";
import { getDocumentByTicketId } from "@alga-psa/documents/actions/documentActions";
import { getContactByContactNameId, getContactsByClient, getClientById, getAllClients } from "../../actions/clientLookupActions";
import { updateTicketWithCache } from "../../actions/optimizedTicketActions";
import { updateTicket } from "../../actions/ticketActions";
import { getTicketStatuses } from "@alga-psa/reference-data/actions";
import { getAllPriorities } from "@alga-psa/reference-data/actions";
import { addTicketResource, getTicketResources, removeTicketResource } from "@alga-psa/tickets/actions";
import AgentScheduleDrawer from "./AgentScheduleDrawer";
import { Button } from "@alga-psa/ui/components/Button";
import { Input } from "@alga-psa/ui/components/Input";
import { ExternalLink } from 'lucide-react';
import { WorkItemType } from "@alga-psa/types";
import { ReflectionContainer } from "@alga-psa/ui/ui-reflection/ReflectionContainer";
import { PartialBlock, StyledText } from '@blocknote/core';
import { useTicketTimeTracking } from "@alga-psa/ui/hooks";
import { IntervalTrackingService } from "@alga-psa/ui/services";
import { convertBlockNoteToMarkdown } from "@alga-psa/documents/lib/blocknoteUtils";
import BackNav from '@alga-psa/ui/components/BackNav';
import type { SurveyTicketSatisfactionSummary } from '@alga-psa/types';
import {
    addChildrenToBundleAction,
    findTicketByNumberAction,
    promoteBundleMasterAction,
    removeChildFromBundleAction,
    unbundleMasterTicketAction,
    updateBundleSettingsAction
} from '../../actions/ticketBundleActions';


interface TicketDetailsProps {
    id?: string; // Made optional to maintain backward compatibility
    initialTicket: ITicket & { tenant: string | undefined };
    initialBundle?: any;
    aggregatedChildClientComments?: any[];
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

    /**
     * Optional injected UI for cross-slice composition (e.g. assets associations).
     * This keeps @alga-psa/tickets from importing other vertical slices directly.
     */
    associatedAssets?: React.ReactNode;
}

const TicketDetails: React.FC<TicketDetailsProps> = ({
    id = 'ticket-details',
    initialTicket,
    initialBundle = null,
    aggregatedChildClientComments = [],
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
    surveySummary = null,
    associatedAssets = null
}) => {
    const { data: session } = useSession();
    const [hasHydrated, setHasHydrated] = useState(false);

    useEffect(() => {
        setHasHydrated(true);
    }, []);

    // Use passed currentUser if available (for drawer), otherwise fallback to session
    const userId = currentUser?.user_id || session?.user?.id;
    const tenant = initialTicket.tenant;
    if (!tenant) {
        return (
            <div id="ticket-error-message" className="p-4">
                Error: tenant is not defined
            </div>
        );
    }

    const [ticket, setTicket] = useState(initialTicket);
    const [bundle, setBundle] = useState<any>(initialBundle);
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
    const [addChildTicketNumber, setAddChildTicketNumber] = useState<string>('');
    const [isUpdatingBundleSettings, setIsUpdatingBundleSettings] = useState(false);
    const [isAddChildMultiClientConfirmOpen, setIsAddChildMultiClientConfirmOpen] = useState(false);
    const [pendingChildToAdd, setPendingChildToAdd] = useState<{ ticket_id: string; ticket_number?: string | null; client_id?: string | null } | null>(null);

    useEffect(() => {
        setBundle(initialBundle);
    }, [initialBundle]);

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
            return prevTime + 1;
        });
    }, [isRunning]);

    useEffect(() => {
        let intervalId: NodeJS.Timeout | undefined;
        if (isRunning) {
            intervalId = setInterval(tick, 1000);
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
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
                // Ignore auto-start failures; time tracking is best-effort here.
            }
        };
        auto();
        // only attempt once when ids are ready and not already tracking
    }, [initialTicket.ticket_id, userId, isTracking]);

    // New screens start from zero; no seeding from existing intervals

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
        doStart(false);
    }, [doStart]);

    const handleConfirmReplace = useCallback(async () => {
        setIsReplaceDialogOpen(false);
        await doStart(true);
    }, [doStart]);

    const handlePauseClick = useCallback(async () => {
        try {
            await stopTracking();
        } catch {}
        setIsRunning(false);
    }, [stopTracking]);

    const handleStopClick = useCallback(async () => {
        try {
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
            stopTrackingRef.current?.().catch(() => {});
        };
    }, []);

    const handleClientClick = () => {
        if (client) {
            openDrawer(
                <div className="p-4 space-y-3">
                    <div className="text-lg font-semibold">{client.client_name}</div>
                    <Button
                        id="ticket-details-open-client"
                        type="button"
                        variant="outline"
                        onClick={() => window.open(`/msp/clients/${client.client_id}`, '_blank', 'noopener,noreferrer')}
                    >
                        Open Client <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            );
        }
    };

    const handleContactClick = () => {
        if (contactInfo && client) {
            openDrawer(
                <div className="p-4 space-y-3">
                    <div className="text-lg font-semibold">{contactInfo.full_name}</div>
                    {contactInfo.email ? <div className="text-sm text-gray-600">{contactInfo.email}</div> : null}
                    {contactInfo.phone_number ? <div className="text-sm text-gray-600">{contactInfo.phone_number}</div> : null}
                    <Button
                        id="ticket-details-open-contact-client"
                        type="button"
                        variant="outline"
                        onClick={() => window.open(`/msp/clients/${client.client_id}`, '_blank', 'noopener,noreferrer')}
                    >
                        Open Client <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                </div>
            );
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
            const result = await addTicketResource(ticket.ticket_id!, userId, 'support');

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
            await removeTicketResource(assignmentId);
            setAdditionalAgents(prev => prev.filter(agent => agent.assignment_id !== assignmentId));
            toast.success('Agent removed successfully');
        } catch (error) {
            console.error('Error removing agent:', error);
            toast.error('Failed to remove agent');
        }
    };

    const handleSelectChange = async (field: keyof ITicket, newValue: string | null) => {
        const normalizedValue =
            field === 'assigned_to'
                ? (newValue && newValue !== 'unassigned' ? newValue : null)
                : newValue;

        // Store the previous value before updating
        const previousValue = ticket[field];
        
        // Optimistically update the UI
        setTicket(prevTicket => ({ ...prevTicket, [field]: normalizedValue }));

        try {
            // Use the optimized handler if provided
            if (onTicketUpdate) {
                await onTicketUpdate(field, normalizedValue);
                
                // If we're changing the assigned_to field, we need to handle additional resources
                // This will be handled by the container component and passed back in props
            } else {
                // Fallback to the original implementation if no optimized handler is provided
                const result = await updateTicket(ticket.ticket_id || '', { [field]: normalizedValue });
                
                if (result === 'success') {
                    console.log(`${field} changed to: ${normalizedValue}`);
                    
                    // If we're changing the assigned_to field, refresh the additional resources
                    if (field === 'assigned_to') {
                        try {
                            // Refresh the additional resources
                            const resources = await getTicketResources(ticket.ticket_id!);
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
                    updated_at: new Date().toISOString()
                });

                // Update the local ticket state
                setTicket(prev => ({
                    ...prev,
                    attributes: updatedAttributes,
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
            toast('Time entry is managed in Scheduling.');
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
        setTags(updatedTags);
    };

    const handleContactChange = async (newContactId: string | null) => {
        try {
            await updateTicket(ticket.ticket_id!, { contact_name_id: newContactId });
            
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

    const handleItilFieldChange = async (field: string, value: any) => {
        try {
            // First update local state immediately for UI responsiveness
            switch (field) {
                case 'itil_impact':
                    setItilImpact(value);
                    break;
                case 'itil_urgency':
                    setItilUrgency(value);
                    break;
                // NOTE: itil_category and itil_subcategory are now handled by unified CategoryPicker
            }

            // Create update object with the specific ITIL field
            const updateData: any = {};
            updateData[field] = value;

            // If we're updating impact or urgency, calculate the new ITIL priority
            if (field === 'itil_impact' || field === 'itil_urgency') {
                const currentImpact = field === 'itil_impact' ? value : itilImpact;
                const currentUrgency = field === 'itil_urgency' ? value : itilUrgency;

                // NOTE: Priority mapping is now handled in the backend
                // The backend will calculate and map ITIL priority to the correct priority_id
            }

            // NOTE: Category management is now unified through the CategoryPicker

            await updateTicketWithCache(ticket.ticket_id!, updateData);

            // Update local ticket state to reflect the change
            setTicket(prevTicket => ({
                ...prevTicket,
                ...updateData
            }));

            toast.success(`ITIL ${field.replace('itil_', '').replace('_', ' ')} updated successfully`);
        } catch (error) {
            console.error('Error updating ITIL field:', error);
            toast.error(`Failed to update ITIL ${field.replace('itil_', '').replace('_', ' ')}`);
        }
    };

    const handleClientChange = async (newClientId: string) => {
        try {
            await updateTicket(ticket.ticket_id!, {
                client_id: newClientId,
                contact_name_id: null, // Reset contact when client changes
                location_id: null // Reset location when client changes
            });
            
            const [clientData, contactsData] = await Promise.all([
                getClientById(newClientId),
                getContactsByClient(newClientId)
            ]);
            
            setClient(clientData);
            setContacts(contactsData || []);
            setContactInfo(null); // Reset contact info
            
            // Update locations for the new client
            if (newClientId) {
                // TODO: Fetch locations for the new client
                // For now, we'll rely on the parent component to provide updated locations
            }

            setIsChangeClientDialogOpen(false);
            toast.success('Client updated successfully');
        } catch (error) {
            console.error('Error updating client:', error);
            toast.error('Failed to update client');
        }
    };
    
    const handleLocationChange = async (newLocationId: string | null) => {
        try {
            await updateTicket(ticket.ticket_id!, {
                location_id: newLocationId
            });
            
            // Update the ticket state with the new location
            setTicket(prevTicket => ({
                ...prevTicket,
                location_id: newLocationId,
                location: newLocationId ? locations.find(l => l.location_id === newLocationId) : undefined
            }));

            toast.success('Location updated successfully');
        } catch (error) {
            console.error('Error updating location:', error);
            toast.error('Failed to update location');
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

    // Function to open ticket in a new window
    const openTicketInNewWindow = useCallback(() => {
        if (ticket.ticket_id) {
            window.open(`/msp/tickets/${ticket.ticket_id}`, '_blank');
        }
    }, [ticket.ticket_id]);

    const handleRemoveChildFromBundle = useCallback(async (childTicketId: string) => {
        try {
            await removeChildFromBundleAction({ childTicketId });
            toast.success('Removed ticket from bundle');
            router.refresh();
        } catch (error) {
            console.error('Failed to remove child from bundle:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to remove ticket from bundle');
        }
    }, [router]);

    const handleUnbundleMaster = useCallback(async () => {
        if (!ticket.ticket_id) return;
        try {
            await unbundleMasterTicketAction({ masterTicketId: ticket.ticket_id });
            toast.success('Bundle removed');
            router.refresh();
        } catch (error) {
            console.error('Failed to unbundle master ticket:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to unbundle ticket');
        }
    }, [ticket.ticket_id, router]);

    const performAddChildToBundle = useCallback(async (childTicketId: string) => {
        if (!ticket.ticket_id) return;
        await addChildrenToBundleAction({ masterTicketId: ticket.ticket_id, childTicketIds: [childTicketId] });
        toast.success('Added ticket to bundle');
        setAddChildTicketNumber('');
        router.refresh();
    }, [ticket.ticket_id, router]);

    const handleAddChildToBundle = useCallback(async () => {
        if (!ticket.ticket_id) return;
        const normalized = addChildTicketNumber.trim();
        if (!normalized) return;

        try {
            const found = await findTicketByNumberAction({ ticketNumber: normalized });
            if (!found) {
                toast.error('Ticket not found');
                return;
            }
            if (found.ticket_id === ticket.ticket_id) {
                toast.error('Cannot add the master ticket as a child');
                return;
            }
            if (found.master_ticket_id) {
                toast.error('That ticket is already bundled');
                return;
            }

            if (ticket.client_id && found.client_id && found.client_id !== ticket.client_id) {
                setPendingChildToAdd(found);
                setIsAddChildMultiClientConfirmOpen(true);
                return;
            }

            await performAddChildToBundle(found.ticket_id);
        } catch (error) {
            console.error('Failed to add child to bundle:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to add ticket to bundle');
        }
    }, [ticket.ticket_id, ticket.client_id, addChildTicketNumber, performAddChildToBundle]);

    const bundleHasMultipleClients = useMemo(() => {
        if (!bundle?.isBundleMaster || !Array.isArray(bundle.children)) return false;
        const ids = new Set<string>();
        if (ticket.client_id) ids.add(ticket.client_id);
        for (const child of bundle.children) {
            if (child?.client_id) ids.add(child.client_id);
        }
        return ids.size > 1;
    }, [bundle?.isBundleMaster, bundle?.children, ticket.client_id]);

    const handlePromoteChildToMaster = useCallback(async (childTicketId: string) => {
        if (!ticket.ticket_id) return;
        try {
            await promoteBundleMasterAction({ oldMasterTicketId: ticket.ticket_id, newMasterTicketId: childTicketId });
            toast.success('Promoted new master');
            router.push(`/msp/tickets/${childTicketId}`);
            router.refresh();
        } catch (error) {
            console.error('Failed to promote master:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to promote master');
        }
    }, [ticket.ticket_id, router]);

    const handleToggleBundleMode = useCallback(async () => {
        if (!ticket.ticket_id || !bundle?.isBundleMaster) return;
        try {
            setIsUpdatingBundleSettings(true);
            const nextMode = bundle.mode === 'link_only' ? 'sync_updates' : 'link_only';
            await updateBundleSettingsAction({ masterTicketId: ticket.ticket_id, mode: nextMode });
            toast.success('Bundle settings updated');
            router.refresh();
        } catch (error) {
            console.error('Failed to update bundle settings:', error);
            toast.error(error instanceof Error ? error.message : 'Failed to update bundle settings');
        } finally {
            setIsUpdatingBundleSettings(false);
        }
    }, [ticket.ticket_id, bundle?.isBundleMaster, bundle?.mode, router]);

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
                </div>

                <div className="flex items-center space-x-5 mb-5 text-sm text-gray-600">
                    {ticket.entered_at && (
                        <p>
                            Created {createdRelativeTime || (() => {
                                const tz = hasHydrated ? getUserTimeZone() : 'UTC';
                                const localDate = utcToLocal(ticket.entered_at, tz);
                                return formatDateTime(localDate, tz, dateTimeFormat);
                            })()}
                        </p>
                    )}
                    {ticket.updated_at && (
                        <p>
                            Updated {updatedRelativeTime || (() => {
                                const tz = hasHydrated ? getUserTimeZone() : 'UTC';
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
                    id={`${id}-bundle-add-child-multi-client-confirm`}
                    isOpen={isAddChildMultiClientConfirmOpen}
                    onClose={() => {
                        setIsAddChildMultiClientConfirmOpen(false);
                        setPendingChildToAdd(null);
                    }}
                    onConfirm={async () => {
                        if (!pendingChildToAdd?.ticket_id) {
                            setIsAddChildMultiClientConfirmOpen(false);
                            return;
                        }
                        try {
                            await performAddChildToBundle(pendingChildToAdd.ticket_id);
                        } catch (error) {
                            console.error('Failed to add child to bundle after confirmation:', error);
                            toast.error(error instanceof Error ? error.message : 'Failed to add ticket to bundle');
                        } finally {
                            setIsAddChildMultiClientConfirmOpen(false);
                            setPendingChildToAdd(null);
                        }
                    }}
                    title="Bundle spans multiple clients"
                    message={`This will add ${pendingChildToAdd?.ticket_number || 'this ticket'} from a different client into the bundle. Confirm you want to proceed.`}
                    confirmLabel="Proceed"
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
                                {bundle?.isBundleChild && bundle?.masterTicket ? (
                                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" id="ticket-bundle-child-banner">
                                        This ticket is bundled under{' '}
                                        <a className="font-medium underline" href={`/msp/tickets/${bundle.masterTicket.ticket_id}`}>
                                            {bundle.masterTicket.ticket_number}
                                        </a>
                                        . Workflow fields are locked; work from the master ticket.
                                    </div>
                                ) : null}

                                {bundle?.isBundleMaster ? (
                                    <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-900" id="ticket-bundle-master-banner">
                                        This ticket is the master of a bundle ({Array.isArray(bundle.children) ? bundle.children.length : 0} children). Mode:{' '}
                                        {bundle.mode || 'sync_updates'}.
                                        {bundleHasMultipleClients ? (
                                            <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                                                Multiple clients
                                            </span>
                                        ) : null}
                                    </div>
                                ) : null}

                                {bundle?.isBundleMaster ? (
                                    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-3" id="ticket-bundle-master-panel">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-sm font-semibold text-gray-900">Bundle</div>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    id="ticket-bundle-toggle-mode-button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleToggleBundleMode}
                                                    disabled={isUpdatingBundleSettings}
                                                >
                                                    Mode: {bundle.mode || 'sync_updates'}
                                                </Button>
                                                <Button
                                                    id="ticket-bundle-unbundle-button"
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={handleUnbundleMaster}
                                                >
                                                    Unbundle
                                                </Button>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-500 mb-2">
                                            Children keep their current status; workflow fields are locked on children. Inbound child replies are surfaced below as view-only.
                                        </div>
                                        <div className="flex items-center gap-2 mb-3">
                                            <Input
                                                id="ticket-bundle-add-child-input"
                                                value={addChildTicketNumber}
                                                onChange={(e) => setAddChildTicketNumber(e.target.value)}
                                                placeholder="Add child by ticket number…"
                                                className="h-8"
                                                containerClassName="mb-0 flex-1"
                                            />
                                            <Button
                                                id="ticket-bundle-add-child-button"
                                                size="sm"
                                                onClick={handleAddChildToBundle}
                                                disabled={!addChildTicketNumber.trim()}
                                            >
                                                Add
                                            </Button>
                                        </div>
                                        <div className="max-h-56 overflow-y-auto rounded border border-gray-100">
                                            {Array.isArray(bundle.children) && bundle.children.length > 0 ? (
                                                <ul>
                                                    {bundle.children.map((child: any) => (
                                                        <li key={child.ticket_id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0">
                                                            <div className="min-w-0">
                                                                <a className="text-sm text-blue-600 hover:underline" href={`/msp/tickets/${child.ticket_id}`}>
                                                                    {child.ticket_number}
                                                                </a>
                                                                <div className="text-xs text-gray-500 truncate">
                                                                    {(child.client_name ? `${child.client_name} · ` : '')}{child.title}
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2">
                                                                <Button
                                                                    id={`ticket-bundle-promote-child-${child.ticket_id}`}
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => handlePromoteChildToMaster(child.ticket_id)}
                                                                >
                                                                    Promote
                                                                </Button>
                                                                <Button
                                                                    id={`ticket-bundle-remove-child-${child.ticket_id}`}
                                                                    variant="outline"
                                                                    size="sm"
                                                                    onClick={() => handleRemoveChildFromBundle(child.ticket_id)}
                                                                >
                                                                    Remove
                                                                </Button>
                                                            </div>
                                                        </li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <div className="px-3 py-2 text-sm text-gray-500">No children in this bundle.</div>
                                            )}
                                        </div>
                                    </div>
                                ) : null}

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
                                    isBundledChild={Boolean(bundle?.isBundleChild)}
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
                                    externalComments={bundle?.isBundleMaster ? aggregatedChildClientComments : []}
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
                        
                        {associatedAssets ? <div className="mt-6" id="associated-assets-container">{associatedAssets}</div> : null}
                    </div>
                </div>
            </div>
        </ReflectionContainer>
    );
};

export default TicketDetails;
