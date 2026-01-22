'use client';

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import RichTextViewer from 'server/src/components/editor/RichTextViewer';
import TextEditor from 'server/src/components/editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import { ITicket, IComment, ITicketCategory } from 'server/src/interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { TicketResponseState } from 'server/src/interfaces/ticket.interfaces';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { PrioritySelect } from '@/components/tickets/PrioritySelect';
import UserPicker from 'server/src/components/ui/UserPicker';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { TimePicker } from 'server/src/components/ui/TimePicker';
import { format, setHours, setMinutes } from 'date-fns';
import { TagManager } from 'server/src/components/tags';
import { ResponseStateDisplay } from 'server/src/components/tickets/ResponseStateSelect';
import styles from './TicketDetails.module.css';
import { getTicketCategories, getTicketCategoriesByBoard, BoardCategoryData } from 'server/src/lib/actions/ticketCategoryActions';
import { ItilLabels, calculateItilPriority } from 'server/src/lib/utils/itilUtils';
import { Pencil, Check, X, HelpCircle, Save, AlertCircle } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { Input } from 'server/src/components/ui/Input';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import { useRegisterUnsavedChanges } from 'server/src/contexts/UnsavedChangesContext';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';


interface TicketInfoProps {
  id: string; // Made required since it's needed for reflection registration
  ticket: ITicket;
  conversations: IComment[];
  statusOptions: { value: string; label: string }[];
  agentOptions: { value: string; label: string }[];
  boardOptions: { value: string; label: string }[];
  priorityOptions: { value: string; label: string }[];
  onSelectChange: (field: keyof ITicket, newValue: string | null) => void;
  onSaveChanges?: (changes: Record<string, unknown>) => Promise<boolean>;
  onUpdateDescription?: (content: string) => Promise<boolean>;
  isSubmitting?: boolean;
  users?: IUserWithRoles[];
  tags?: ITag[];
  allTagTexts?: string[];
  onTagsChange?: (tags: ITag[]) => void;
  isInDrawer?: boolean;
  onItilFieldChange?: (field: 'itil_impact' | 'itil_urgency', value: number | null) => void;
  isBundledChild?: boolean;
  // Pre-fetched categories from server to avoid timing issues
  initialCategories?: ITicketCategory[];
  // Local ITIL state values
  itilImpact?: number;
  itilUrgency?: number;
  itilCategory?: string;
  itilSubcategory?: string;
}

const TicketInfo: React.FC<TicketInfoProps> = ({
  id,
  ticket,
  conversations,
  statusOptions,
  agentOptions,
  boardOptions,
  priorityOptions,
  onSelectChange,
  onSaveChanges,
  onUpdateDescription,
  isSubmitting = false,
  users = [],
  tags = [],
  onTagsChange,
  isInDrawer = false,
  onItilFieldChange,
  isBundledChild = false,
  initialCategories = [],
  itilImpact,
  itilUrgency,
  itilCategory,
  itilSubcategory,
}) => {
  // Use initialCategories from server to avoid timing issues on first render
  const [categories, setCategories] = useState<ITicketCategory[]>(initialCategories);
  const [boardConfig, setBoardConfig] = useState<BoardCategoryData['boardConfig']>({
    category_type: 'custom',
    priority_type: 'custom',
    display_itil_impact: false,
    display_itil_urgency: false,
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(ticket.title);
  const [showPriorityMatrix, setShowPriorityMatrix] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const workflowLocked = isBundledChild;

  // Local state for pending changes (not saved until Save Changes is clicked)
  const [pendingChanges, setPendingChanges] = useState<Partial<ITicket>>({});
  const [pendingItilChanges, setPendingItilChanges] = useState<{ itil_impact?: number | null; itil_urgency?: number | null }>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isFormInitialized, setIsFormInitialized] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Capture original ticket values when form is initialized
  // This prevents stale comparisons if ticket updates externally while user has pending changes
  const [originalTicketValues, setOriginalTicketValues] = useState<Partial<ITicket>>(() => ({
    status_id: ticket.status_id,
    assigned_to: ticket.assigned_to,
    board_id: ticket.board_id,
    category_id: ticket.category_id,
    subcategory_id: ticket.subcategory_id,
    priority_id: ticket.priority_id,
    due_date: ticket.due_date,
    response_state: ticket.response_state,
    title: ticket.title,
  }));

  // Local state for board config based on selected (pending) board
  const [pendingBoardConfig, setPendingBoardConfig] = useState<BoardCategoryData['boardConfig'] | null>(null);
  const [pendingCategories, setPendingCategories] = useState<ITicketCategory[] | null>(null);

  // Get the effective board ID (pending or current)
  const effectiveBoardId = pendingChanges.board_id ?? ticket.board_id;

  // Get the effective board config (pending or current)
  const effectiveBoardConfig = pendingBoardConfig ?? boardConfig;

  // Get the effective categories (pending or current)
  const effectiveCategories = pendingCategories ?? categories;

  // Calculate ITIL priority when impact and urgency are available
  // Use pending ITIL values if available, otherwise use prop values
  const effectiveItilImpact = pendingItilChanges.itil_impact ?? itilImpact;
  const effectiveItilUrgency = pendingItilChanges.itil_urgency ?? itilUrgency;

  const calculatedItilPriority = useMemo(() => {
    if (effectiveItilImpact && effectiveItilUrgency) {
      try {
        return calculateItilPriority(effectiveItilImpact, effectiveItilUrgency);
      } catch {
        return null;
      }
    }
    return null;
  }, [effectiveItilImpact, effectiveItilUrgency]);

  // Store original description when entering edit mode (for cancel reset)
  const originalDescriptionRef = useRef<PartialBlock[] | null>(null);
  // Track if description content has actually changed from original
  const [hasDescriptionContentChanged, setHasDescriptionContentChanged] = useState(false);

  // Track if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    if (!isFormInitialized) {
      return false;
    }

    // Check if any pending changes exist
    const hasPendingTicketChanges = Object.keys(pendingChanges).length > 0;
    const hasPendingItilChanges = Object.keys(pendingItilChanges).length > 0;
    const hasTitleChange = titleValue !== ticket.title;
    // Check if description content has actually changed (not just if in edit mode)
    const hasDescriptionChange = hasDescriptionContentChanged;

    return hasPendingTicketChanges || hasPendingItilChanges || hasTitleChange || hasDescriptionChange;
  }, [isFormInitialized, pendingChanges, pendingItilChanges, titleValue, ticket.title, hasDescriptionContentChanged]);

  // Register unsaved changes with the context
  // This hook will throw if used outside of UnsavedChangesProvider,
  // but we wrap it conditionally at a higher level
  useRegisterUnsavedChanges(`ticket-info-${id}`, hasUnsavedChanges);

  // Initialize form when ticket loads
  useEffect(() => {
    if (ticket && !isFormInitialized) {
      setTitleValue(ticket.title);
      setPendingChanges({});
      setPendingItilChanges({});
      setPendingBoardConfig(null);
      setPendingCategories(null);
      setIsFormInitialized(true);
    }
  }, [ticket, isFormInitialized]);

  // Track loading state for board config
  const [isLoadingBoardConfig, setIsLoadingBoardConfig] = useState(false);
  // Track the board_id being fetched to handle race conditions
  const fetchingBoardIdRef = useRef<string | null>(null);
  // Track save success timeout for cleanup on unmount
  const saveSuccessTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
    };
  }, []);

  // Track current board's priority type in a ref to avoid triggering re-fetches
  const currentPriorityTypeRef = useRef(boardConfig.priority_type);
  useEffect(() => {
    currentPriorityTypeRef.current = boardConfig.priority_type;
  }, [boardConfig.priority_type]);

  // Fetch board config when pending board changes
  useEffect(() => {
    const boardIdToFetch = pendingChanges.board_id;

    const fetchPendingBoardConfig = async () => {
      if (boardIdToFetch && boardIdToFetch !== ticket.board_id) {
        // Track which board we're fetching
        fetchingBoardIdRef.current = boardIdToFetch;

        // Immediately clear old pending data to avoid showing stale categories
        setPendingCategories([]);
        setPendingBoardConfig(null);
        setIsLoadingBoardConfig(true);

        try {
          const data = await getTicketCategoriesByBoard(boardIdToFetch);

          // Only update state if this is still the board we want
          if (fetchingBoardIdRef.current === boardIdToFetch) {
            if (data && data.categories) {
              const categoriesArray = Array.isArray(data.categories) ? data.categories : [];
              setPendingCategories(categoriesArray);
              if (data.boardConfig) {
                setPendingBoardConfig(data.boardConfig);

                // Only clear priority fields if the priority_type changes (custom <-> ITIL)
                // This preserves priority when switching between boards with the same priority type
                const currentPriorityType = currentPriorityTypeRef.current;
                const newPriorityType = data.boardConfig.priority_type;

                if (currentPriorityType !== newPriorityType) {
                  // Priority type changed, clear priority fields (use null for proper JSON serialization)
                  setPendingChanges(prev => ({
                    ...prev,
                    priority_id: null,
                  }));
                  setPendingItilChanges({ itil_impact: null, itil_urgency: null });
                }
              }
            }
            setIsLoadingBoardConfig(false);
          }
        } catch (error) {
          // Only update state if this is still the board we want
          if (fetchingBoardIdRef.current === boardIdToFetch) {
            console.error('Failed to fetch pending board config:', error);
            setIsLoadingBoardConfig(false);
          }
        }
      } else if (!boardIdToFetch) {
        // Reset pending config if board is cleared from pending
        fetchingBoardIdRef.current = null;
        setPendingBoardConfig(null);
        setPendingCategories(null);
        setIsLoadingBoardConfig(false);
      }
    };

    fetchPendingBoardConfig();
  }, [pendingChanges.board_id, ticket.board_id]);

  // Note: Category clearing when board changes is handled directly in the board select's
  // onValueChange handler (which sets category_id and subcategory_id to null).
  // We don't use a separate useEffect because that would remove the null values from
  // pendingChanges, preventing them from being sent to the server.

  // Get ITIL categories from props (now includes both custom and ITIL)
  // NOTE: Categories are now unified - no need for separate ITIL category filtering

  // NOTE: ITIL category selection is now handled by the unified CategoryPicker system

  // NOTE: ITIL category selection is now handled by the unified CategoryPicker
  // Categories are managed through the regular onCategoryChange handler

  const [descriptionContent, setDescriptionContent] = useState<PartialBlock[]>([{
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

  useEffect(() => {
    // Initialize description content from the ticket attributes
    const descriptionText = (ticket.attributes?.description as string) || '';

    if (descriptionText) {
      try {
        const parsedContent = JSON.parse(descriptionText);
        if (Array.isArray(parsedContent) && parsedContent.length > 0) {
          setDescriptionContent(parsedContent);
          return;
        }
      } catch (e) {
        // If parsing fails, continue to the fallback
      }
      
      // Fallback: create a default block with the text
      setDescriptionContent([{
        type: "paragraph",
        props: {
          textAlignment: "left",
          backgroundColor: "default",
          textColor: "default"
        },
        content: [{
          type: "text",
          text: descriptionText,
          styles: {}
        }]
      }]);
    }
  }, [ticket, conversations]);

  // Sync categories with initialCategories when they change (handles navigation between tickets)
  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) {
      setCategories(initialCategories);
    }
  }, [initialCategories]);

  // Separate useEffect for fetching categories and board config based on board
  // NOTE: We intentionally omit `categories` and `ticket.category_id` from deps to avoid
  // infinite loops. This effect should only run when board_id changes, using the current
  // categories state at that moment to decide whether to fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const fetchCategoriesAndConfig = async () => {
      // Check if we already have categories from initialCategories
      const hasValidCategories = categories.length > 0 && categories.some(c => c.category_id === ticket.category_id);

      try {
        if (ticket.board_id) {
          // Always fetch board config to get ITIL settings, even if we have categories
          const data = await getTicketCategoriesByBoard(ticket.board_id);

          // Always set board config for ITIL support
          if (data && data.boardConfig) {
            setBoardConfig(data.boardConfig);
          }

          // Only update categories if we don't have valid ones from initialCategories
          if (!hasValidCategories && data && data.categories) {
            const categoriesArray = Array.isArray(data.categories) ? data.categories : [];
            setCategories(categoriesArray);
          }
        } else {
          // If no board, use custom config
          setBoardConfig({
            category_type: 'custom',
            priority_type: 'custom',
            display_itil_impact: false,
            display_itil_urgency: false,
          });

          // Only fetch categories if we don't have them
          if (!hasValidCategories) {
            const fetchedCategories = await getTicketCategories();
            if (Array.isArray(fetchedCategories)) {
              setCategories(fetchedCategories);
            } else {
              console.error('Invalid categories data received:', fetchedCategories);
              setCategories([]);
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch categories and config:', error);
        // Set defaults on error
        setBoardConfig({
          category_type: 'custom',
          priority_type: 'custom',
          display_itil_impact: false,
          display_itil_urgency: false,
        });
        if (!hasValidCategories) {
          setCategories([]);
        }
      }
    };

    fetchCategoriesAndConfig();
  }, [ticket.board_id]); // Re-fetch when board changes

  useEffect(() => {
    setTitleValue(ticket.title);
  }, [ticket.title]);

  // Handler for title save (saves immediately when checkmark is clicked)
  const handleTitleSubmit = useCallback(() => {
    if (titleValue.trim() !== '' && titleValue.trim() !== ticket.title) {
      // Save title immediately (not part of pending changes)
      onSelectChange('title', titleValue.trim());
      setIsEditingTitle(false);
    } else {
      setIsEditingTitle(false);
    }
  }, [titleValue, ticket.title, onSelectChange]);

  // Handler for title cancel
  const handleTitleCancel = useCallback(() => {
    setTitleValue(ticket.title);
    setIsEditingTitle(false);
  }, [ticket.title]);

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleTitleCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSubmit();
    }
  };

  // Handler for pending field changes (not saved until Save Changes is clicked)
  // Uses originalTicketValues to prevent stale comparisons if ticket updates externally
  const handlePendingChange = useCallback((field: keyof ITicket, value: string | null) => {
    setPendingChanges(prev => {
      // If the value is the same as the original ticket value (when form was loaded), remove from pending
      // This prevents issues where external ticket updates could incorrectly clear pending changes
      if (value === originalTicketValues[field]) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: value };
    });
  }, [originalTicketValues]);

  // Handler for pending ITIL field changes
  const handlePendingItilChange = useCallback((field: 'itil_impact' | 'itil_urgency', value: number | null) => {
    setPendingItilChanges(prev => {
      const originalValue = field === 'itil_impact' ? itilImpact : itilUrgency;
      // If the value is the same as the original, remove from pending
      if (value === originalValue) {
        const { [field]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [field]: value };
    });
  }, [itilImpact, itilUrgency]);

  // Handler for saving all pending changes
  const handleSaveChanges = useCallback(async () => {
    if (!hasUnsavedChanges) return;

    setIsSaving(true);
    try {
      // Collect all changes to save using Record for flexibility
      const allChanges: Record<string, unknown> = { ...pendingChanges };

      // Add title if changed
      if (titleValue !== ticket.title) {
        allChanges.title = titleValue;
      }

      // Note: When board changes, the board change handler (lines 687-699) already clears
      // category_id, subcategory_id, and priority_id in pendingChanges. If the user then
      // selects new values, those are captured in pendingChanges and will be saved.
      // We no longer need to force-clear these fields here - that was overwriting user selections.

      // Save ITIL changes if any (include null values to clear fields on server)
      if (Object.keys(pendingItilChanges).length > 0) {
        if ('itil_impact' in pendingItilChanges) {
          allChanges.itil_impact = pendingItilChanges.itil_impact;
        }
        if ('itil_urgency' in pendingItilChanges) {
          allChanges.itil_urgency = pendingItilChanges.itil_urgency;
        }
      }

      // Save description if it's being edited
      if (isEditingDescription && onUpdateDescription) {
        const descriptionSaved = await onUpdateDescription(JSON.stringify(descriptionContent));
        if (!descriptionSaved) {
          // Short-circuit - don't clear pending changes or show success if description failed to save
          // The onUpdateDescription handler already shows an error toast
          return;
        }
      }

      // Use the onSaveChanges prop if available, otherwise fall back to individual updates
      if (onSaveChanges) {
        const success = await onSaveChanges(allChanges);
        if (success) {
          // Update original values to reflect saved state for future change detection
          setOriginalTicketValues(prev => ({
            ...prev,
            ...allChanges,
            // Ensure title is updated if it was changed
            ...(allChanges.title ? { title: allChanges.title as string } : {}),
          }));
          // Clear pending changes on success
          setPendingChanges({});
          setPendingItilChanges({});
          setPendingBoardConfig(null);
          setPendingCategories(null);
          // Update original description ref to saved content
          if (isEditingDescription) {
            originalDescriptionRef.current = descriptionContent;
          }
          setHasDescriptionContentChanged(false);
          // Close all edit modes
          setIsEditingTitle(false);
          setIsEditingDescription(false);
          // Show success message for 3 seconds (like contracts)
          setSaveSuccess(true);
          // Clear any existing timeout before setting a new one
          if (saveSuccessTimeoutRef.current) {
            clearTimeout(saveSuccessTimeoutRef.current);
          }
          saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
        }
      } else {
        // Fallback: save each field individually using onSelectChange
        for (const [field, value] of Object.entries(allChanges)) {
          if (field === 'itil_impact' || field === 'itil_urgency') {
            if (onItilFieldChange) {
              onItilFieldChange(field, value);
            }
          } else {
            onSelectChange(field as keyof ITicket, value as string | null);
          }
        }
        // Update original values to reflect saved state for future change detection
        setOriginalTicketValues(prev => ({
          ...prev,
          ...allChanges,
          ...(allChanges.title ? { title: allChanges.title as string } : {}),
        }));
        // Clear pending changes
        setPendingChanges({});
        setPendingItilChanges({});
        setPendingBoardConfig(null);
        setPendingCategories(null);
        // Update original description ref to saved content
        if (isEditingDescription) {
          originalDescriptionRef.current = descriptionContent;
        }
        setHasDescriptionContentChanged(false);
        // Close all edit modes
        setIsEditingTitle(false);
        setIsEditingDescription(false);
        // Show success message for 3 seconds (like contracts)
        setSaveSuccess(true);
        // Clear any existing timeout before setting a new one
        if (saveSuccessTimeoutRef.current) {
          clearTimeout(saveSuccessTimeoutRef.current);
        }
        saveSuccessTimeoutRef.current = setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (error) {
      console.error('Error saving changes:', error);
    } finally {
      setIsSaving(false);
    }
  }, [hasUnsavedChanges, pendingChanges, pendingItilChanges, titleValue, ticket.title, ticket.board_id, onSaveChanges, onSelectChange, onItilFieldChange, isEditingDescription, onUpdateDescription, descriptionContent, hasDescriptionContentChanged]);

  // Handler for discarding all pending changes
  const handleDiscardChanges = useCallback(() => {
    setTitleValue(ticket.title);
    setPendingChanges({});
    setPendingItilChanges({});
    setPendingBoardConfig(null);
    setPendingCategories(null);
    // Reset description to original content
    if (originalDescriptionRef.current) {
      setDescriptionContent(originalDescriptionRef.current);
    }
    setHasDescriptionContentChanged(false);
    // Close all edit modes
    setIsEditingTitle(false);
    setIsEditingDescription(false);
  }, [ticket.title]);

  // Handler for Cancel button click (like contracts)
  const handleCancelClick = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowCancelConfirm(true);
    }
    // If no unsaved changes, Cancel does nothing (already in clean state)
  }, [hasUnsavedChanges]);

  // Handler for confirming cancel (discard changes)
  const handleCancelConfirm = useCallback(() => {
    handleDiscardChanges();
    setShowCancelConfirm(false);
  }, [handleDiscardChanges]);

  const handleCategoryChange = (categoryIds: string[]) => {
    // Handle empty selection or "no-category" special value
    if (categoryIds.length === 0 || categoryIds[0] === 'no-category' || categoryIds[0] === '') {
      handlePendingChange('category_id', null);
      handlePendingChange('subcategory_id', null);
      return;
    }

    const selectedCategoryId = categoryIds[0];
    const selectedCategory = effectiveCategories.find(c => c.category_id === selectedCategoryId);

    if (!selectedCategory) {
      // Don't return early - still try to set the category ID even if not found in local state
      // This handles cases where effectiveCategories might be stale
      handlePendingChange('category_id', selectedCategoryId);
      handlePendingChange('subcategory_id', null);
      return;
    }

    if (selectedCategory.parent_category) {
      handlePendingChange('category_id', selectedCategory.parent_category);
      handlePendingChange('subcategory_id', selectedCategoryId);
    } else {
      handlePendingChange('category_id', selectedCategoryId);
      handlePendingChange('subcategory_id', null);
    }

    // Don't automatically change the board - categories are now filtered by current board
    // This prevents unwanted board switches when selecting categories
  };

  const getSelectedCategoryId = () => {
    // Check pending changes first
    const pendingSubcategory = pendingChanges.subcategory_id;
    const pendingCategory = pendingChanges.category_id;

    if (pendingSubcategory !== undefined) {
      return pendingSubcategory || '';
    }
    if (pendingCategory !== undefined) {
      return pendingCategory || '';
    }

    // Fall back to ticket values
    if (ticket.subcategory_id) {
      return ticket.subcategory_id;
    }
    return ticket.category_id || '';
  };

  // Handler for ITIL field changes (now uses pending changes)
  const handleLocalItilFieldChange = (field: 'itil_impact' | 'itil_urgency', value: number | null) => {
    if (field === 'itil_impact' || field === 'itil_urgency') {
      handlePendingItilChange(field, value);
    }
  };

  const customStyles = {
    trigger: "w-fit !inline-flex items-center justify-between rounded px-3 py-2 text-sm font-medium bg-white border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500",
    content: "bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 overflow-auto",
    item: "text-gray-900 cursor-default select-none relative py-2 pl-3 pr-9 hover:bg-indigo-600 hover:text-white",
    itemIndicator: "absolute inset-y-0 right-0 flex items-center pr-4 text-indigo-600",
  };

  // If we don't have users data but have agentOptions, convert agentOptions to users format
  const usersList: IUserWithRoles[] = users.length > 0
    ? users
    : agentOptions.map((agent): IUserWithRoles => ({
        user_id: agent.value,
        username: agent.value,
        first_name: agent.label.split(' ')[0] || '',
        last_name: agent.label.split(' ').slice(1).join(' ') || '',
        email: '',
        hashed_password: '',
        is_inactive: false,
        tenant: '',
        user_type: 'internal',
        roles: []
      }));

  return (
    <ReflectionContainer id={id} label={`Info for ticket ${ticket.ticket_number}`}>
      <div className={`${styles['card']}`}>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4 min-w-0">
            {isEditingTitle ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Input
                  id={`${id}-title-input`}
                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                  className="text-2xl font-bold flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  containerClassName="mb-0 flex-1"
                  style={{minWidth: '300px', width: '100%'}}
                />
                {/* Checkmark button - saves title immediately */}
                <Button
                  id={`${id}-save-title-btn`}
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={handleTitleSubmit}
                  className="flex-shrink-0"
                  title="Save title"
                >
                  <Check className="w-4 h-4" />
                </Button>
                {/* X button - cancels title edit */}
                <Button
                  id={`${id}-cancel-title-btn`}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleTitleCancel}
                  className="flex-shrink-0"
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <h1
                  className="text-2xl font-bold break-words max-w-full min-w-0 flex-1"
                  style={{overflowWrap: 'break-word', wordBreak: 'break-word', whiteSpace: 'pre-wrap'}}
                >
                  {ticket.title}
                </h1>
                <button
                  onClick={() => setIsEditingTitle(true)}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200 flex-shrink-0"
                  title="Edit title"
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
              </>
            )}
          </div>
          {/* Unsaved changes alert banner */}
          {hasUnsavedChanges && (
            <Alert className="bg-amber-50 border-amber-200 mb-4">
              <AlertDescription className="text-amber-800 flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span>You have unsaved changes. Click &quot;Save Changes&quot; to apply them.</span>
              </AlertDescription>
            </Alert>
          )}

          {/* Success alert after saving (like contracts) */}
          {saveSuccess && (
            <Alert className="bg-green-50 border-green-200 mb-4">
              <AlertDescription className="text-green-800">
                Changes saved successfully!
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <h5 className="font-bold mb-2">Status</h5>
              <CustomSelect
                value={pendingChanges.status_id ?? ticket.status_id ?? ''}
                options={statusOptions}
                onValueChange={(value) => handlePendingChange('status_id', value)}
                customStyles={customStyles}
                className="!w-fit"
                disabled={workflowLocked}
              />
            </div>
            <div>
              <ResponseStateDisplay
                value={((pendingChanges.response_state ?? ticket.response_state) || null) as TicketResponseState}
                onValueChange={(value) => handlePendingChange('response_state', value)}
                editable={true}
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Assigned To</h5>
              <UserPicker
                value={pendingChanges.assigned_to ?? ticket.assigned_to ?? ''}
                onValueChange={(value) => handlePendingChange('assigned_to', value)}
                users={usersList}
                labelStyle="none"
                buttonWidth="fit"
                size="sm"
                className="!w-fit"
                placeholder="Not assigned"
                disabled={workflowLocked}
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Board</h5>
              <CustomSelect
                value={effectiveBoardId || ''}
                options={boardOptions}
                onValueChange={(value) => {
                  handlePendingChange('board_id', value);
                  // Clear pending categories when board changes
                  // (categories are board-specific)
                  handlePendingChange('category_id', null);
                  handlePendingChange('subcategory_id', null);
                  // Note: Priority is NOT cleared here anymore.
                  // Priority will only be cleared if priority_type changes (custom <-> ITIL)
                  // after the new board's config is loaded in the useEffect below.
                }}
                customStyles={customStyles}
                className="!w-fit"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Priority</h5>
              {effectiveBoardConfig.priority_type === 'itil' ? (
                calculatedItilPriority ? (
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full border border-gray-300"
                      style={{ backgroundColor:
                        calculatedItilPriority === 1 ? '#DC2626' : // Red
                        calculatedItilPriority === 2 ? '#EA580C' : // Orange
                        calculatedItilPriority === 3 ? '#F59E0B' : // Amber
                        calculatedItilPriority === 4 ? '#3B82F6' : // Blue
                        '#6B7280' // Gray
                      }}
                    />
                    <span className="text-sm font-medium">
                      {ItilLabels.priority[calculatedItilPriority]}
                    </span>
                    <span className="text-xs text-gray-500">
                      (Impact {effectiveItilImpact} × Urgency {effectiveItilUrgency})
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowPriorityMatrix(!showPriorityMatrix)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                      title="Show ITIL Priority Matrix"
                    >
                      <HelpCircle className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="text-sm text-gray-500">
                    Please set Impact and Urgency below to determine priority
                  </div>
                )
              ) : (
                <PrioritySelect
                  value={pendingChanges.priority_id ?? ticket.priority_id ?? null}
                  options={priorityOptions}
                  onValueChange={(value) => handlePendingChange('priority_id', value)}
                  customStyles={customStyles}
                  className="!w-fit"
                  disabled={workflowLocked}
                />
              )}
            </div>
            {effectiveBoardConfig.category_type && (
              <div className="col-span-2">
                <h5 className="font-bold mb-1">{effectiveBoardConfig.category_type === 'custom' ? 'Category' : 'ITIL Category'}</h5>
                <div className="w-fit">
                  {isLoadingBoardConfig ? (
                    <div className="h-10 w-48 bg-gray-100 animate-pulse rounded-md flex items-center justify-center text-sm text-gray-500">
                      Loading categories...
                    </div>
                  ) : (
                    <CategoryPicker
                      id={`${id}-category-picker`}
                      categories={effectiveCategories}
                      selectedCategories={[getSelectedCategoryId()]}
                      onSelect={handleCategoryChange}
                      placeholder={effectiveBoardConfig.category_type === 'custom' ? "Select a category..." : "Select ITIL category..."}
                    />
                  )}
                </div>
              </div>
            )}
            <div>
              <h5 className="font-bold mb-2">Due Date</h5>
              {(() => {
                // Use pending due_date if available
                const effectiveDueDate = pendingChanges.due_date !== undefined
                  ? (pendingChanges.due_date ? new Date(pendingChanges.due_date as string) : undefined)
                  : (ticket.due_date ? new Date(ticket.due_date) : undefined);
                const existingTime = effectiveDueDate ? format(effectiveDueDate, 'HH:mm') : undefined;
                const isMidnight = existingTime === '00:00';

                // Determine styling based on due date status
                let containerClass = '';
                if (effectiveDueDate) {
                  const now = new Date();
                  const hoursUntilDue = (effectiveDueDate.getTime() - now.getTime()) / (1000 * 60 * 60);
                  if (hoursUntilDue < 0) {
                    containerClass = '[&_button]:border-red-500 [&_button]:text-red-600 [&_button]:bg-red-50';
                  } else if (hoursUntilDue <= 24) {
                    containerClass = '[&_button]:border-orange-500 [&_button]:text-orange-600 [&_button]:bg-orange-50';
                  }
                }

                const handleDateChange = (newDate: Date | undefined) => {
                  if (!newDate) {
                    handlePendingChange('due_date', null);
                    return;
                  }
                  // Preserve existing time or use midnight
                  if (effectiveDueDate && !isMidnight) {
                    newDate = setHours(newDate, effectiveDueDate.getHours());
                    newDate = setMinutes(newDate, effectiveDueDate.getMinutes());
                  } else {
                    newDate = setHours(newDate, 0);
                    newDate = setMinutes(newDate, 0);
                  }
                  handlePendingChange('due_date', newDate.toISOString());
                };

                const handleTimeChange = (newTime: string) => {
                  if (!effectiveDueDate) return;
                  const [hours, minutes] = newTime.split(':').map(Number);
                  let newDate = setHours(effectiveDueDate, hours);
                  newDate = setMinutes(newDate, minutes);
                  handlePendingChange('due_date', newDate.toISOString());
                };

                return (
                  <>
                    <div className={`flex items-center gap-2 w-fit ${containerClass}`}>
                      <div className="w-fit">
                        <DatePicker
                          id={`${id}-due-date-picker`}
                          value={effectiveDueDate}
                          onChange={handleDateChange}
                          placeholder="Select date"
                          label="Due Date"
                        />
                      </div>
                      <div className="w-fit">
                        <TimePicker
                          id={`${id}-due-time-picker`}
                          value={effectiveDueDate && !isMidnight ? existingTime : undefined}
                          onChange={handleTimeChange}
                          placeholder="Time"
                          disabled={!effectiveDueDate}
                        />
                      </div>
                      {effectiveDueDate && (
                        <Button
                          id={`${id}-clear-due-date`}
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handlePendingChange('due_date', null)}
                          className="text-gray-400 hover:text-gray-600 px-2"
                          title="Clear due date"
                        >
                          ✕
                        </Button>
                      )}
                    </div>
                    {effectiveDueDate && isMidnight && (
                      <p className="text-xs text-gray-500 mt-1">No time set - defaults to 12:00 AM</p>
                    )}
                  </>
                );
              })()}
            </div>
            {/* ITIL Fields for ITIL priority boards */}
            {effectiveBoardConfig.priority_type === 'itil' && (
              <>
                <div>
                  <h5 className="font-bold mb-2">Impact</h5>
                  <div className="w-fit">
                    <CustomSelect
                      options={[
                        { value: '1', label: '1 - High (Critical business function affected)' },
                        { value: '2', label: '2 - Medium-High (Important function affected)' },
                        { value: '3', label: '3 - Medium (Minor function affected)' },
                        { value: '4', label: '4 - Medium-Low (Minimal impact)' },
                        { value: '5', label: '5 - Low (No business impact)' }
                      ]}
                      value={effectiveItilImpact?.toString() || null}
                      onValueChange={(value) => handleLocalItilFieldChange('itil_impact', Number(value))}
                      placeholder="Select Impact"
                    />
                  </div>
                </div>
                <div>
                  <h5 className="font-bold mb-2">Urgency</h5>
                  <div className="w-fit">
                    <CustomSelect
                      options={[
                        { value: '1', label: '1 - High (Work cannot continue)' },
                        { value: '2', label: '2 - Medium-High (Work severely impaired)' },
                        { value: '3', label: '3 - Medium (Work continues with limitations)' },
                        { value: '4', label: '4 - Medium-Low (Minor inconvenience)' },
                        { value: '5', label: '5 - Low (Work continues normally)' }
                      ]}
                      value={effectiveItilUrgency?.toString() || null}
                      onValueChange={(value) => handleLocalItilFieldChange('itil_urgency', Number(value))}
                      placeholder="Select Urgency"
                    />
                  </div>
                </div>
              </>
            )}
            {/* ITIL Categories for ITIL category boards */}
            {/* ITIL Categories are now handled by the unified CategoryPicker above */}
          </div>

          {/* ITIL Priority Matrix - Show when help icon is clicked */}
          {showPriorityMatrix && effectiveBoardConfig.priority_type === 'itil' && (
            <div className="mt-4 p-4 bg-gray-50 border rounded-lg">
              <h4 className="text-sm font-medium text-gray-800 mb-3">ITIL Priority Matrix (Impact × Urgency)</h4>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left text-gray-600 border-b"></th>
                      <th className="px-2 py-1 text-center text-gray-600 border-b">High<br/>Urgency (1)</th>
                      <th className="px-2 py-1 text-center text-gray-600 border-b">Medium-High<br/>Urgency (2)</th>
                      <th className="px-2 py-1 text-center text-gray-600 border-b">Medium<br/>Urgency (3)</th>
                      <th className="px-2 py-1 text-center text-gray-600 border-b">Medium-Low<br/>Urgency (4)</th>
                      <th className="px-2 py-1 text-center text-gray-600 border-b">Low<br/>Urgency (5)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="px-2 py-1 text-gray-600 border-r font-medium">High Impact (1)</td>
                      <td className="px-2 py-1 text-center bg-red-100 text-red-800 font-semibold">Critical (1)</td>
                      <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                      <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-gray-600 border-r font-medium">Medium-High Impact (2)</td>
                      <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                      <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                      <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-gray-600 border-r font-medium">Medium Impact (3)</td>
                      <td className="px-2 py-1 text-center bg-orange-100 text-orange-800 font-semibold">High (2)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                      <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                      <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-gray-600 border-r font-medium">Medium-Low Impact (4)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                      <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                      <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                      <td className="px-2 py-1 text-center bg-gray-100 text-gray-800 font-semibold">Planning (5)</td>
                    </tr>
                    <tr>
                      <td className="px-2 py-1 text-gray-600 border-r font-medium">Low Impact (5)</td>
                      <td className="px-2 py-1 text-center bg-yellow-100 text-yellow-800 font-semibold">Medium (3)</td>
                      <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                      <td className="px-2 py-1 text-center bg-blue-100 text-blue-800 font-semibold">Low (4)</td>
                      <td className="px-2 py-1 text-center bg-gray-100 text-gray-800 font-semibold">Planning (5)</td>
                      <td className="px-2 py-1 text-center bg-gray-100 text-gray-800 font-semibold">Planning (5)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-xs text-gray-600">
                <p><strong>Impact:</strong> How many users/business functions are affected?</p>
                <p><strong>Urgency:</strong> How quickly does this need to be resolved?</p>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-semibold">Description</h2>
              {!isEditingDescription && (
                <button
                  onClick={() => {
                    // Store original content before entering edit mode
                    originalDescriptionRef.current = descriptionContent;
                    setHasDescriptionContentChanged(false);
                    setIsEditingDescription(true);
                  }}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200"
                  title="Edit description"
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
              )}
            </div>
            
            {isEditingDescription ? (
              <div className="min-w-0 w-full">
                <div className="min-w-0 w-full">
                  <TextEditor
                    id={`${id}-description-editor`}
                    initialContent={descriptionContent}
                    onContentChange={(content) => {
                      setDescriptionContent(content);
                      // Track if content has changed from original
                      if (originalDescriptionRef.current) {
                        const originalStr = JSON.stringify(originalDescriptionRef.current);
                        const currentStr = JSON.stringify(content);
                        setHasDescriptionContentChanged(originalStr !== currentStr);
                      }
                    }}
                  />
                </div>
                <div className="flex justify-end space-x-2 mt-2">
                  <Button
                    id={`${id}-save-description-btn`}
                    onClick={async () => {
                      if (onUpdateDescription) {
                        try {
                          const result = await onUpdateDescription(JSON.stringify(descriptionContent));
                          // Strict check: only close edit mode on explicit true
                          if (result === true) {
                            // Update original ref to new saved content
                            originalDescriptionRef.current = descriptionContent;
                            setHasDescriptionContentChanged(false);
                            setIsEditingDescription(false);
                          }
                        } catch (error) {
                          console.error('Failed to save description:', error);
                        }
                      }
                    }}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    id={`${id}-cancel-description-btn`}
                    disabled={isSubmitting}
                    variant="outline"
                    onClick={() => {
                      // Reset to original content and cancel editing
                      if (originalDescriptionRef.current) {
                        setDescriptionContent(originalDescriptionRef.current);
                      }
                      setHasDescriptionContentChanged(false);
                      setIsEditingDescription(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="prose max-w-none break-words overflow-hidden min-w-0" style={{overflowWrap: 'break-word', wordBreak: 'break-word'}}>
                {(() => {
                  // Get description from ticket attributes
                  const descriptionText = ticket.attributes?.description as string;

                  if (!descriptionText) return 'No description found.';

                  return <RichTextViewer content={descriptionText} className="break-words max-w-full min-w-0" />;
                })()}
              </div>
            )}
          </div>
          
          {/* Tags Section */}
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Tags</h2>
            {onTagsChange && ticket.ticket_id ? (
              <TagManager
                entityId={ticket.ticket_id}
                entityType="ticket"
                initialTags={tags}
                onTagsChange={onTagsChange}
                useInlineInput={isInDrawer}
              />
            ) : (
              <p className="text-sm text-gray-500">Tags cannot be managed</p>
            )}
          </div>

          {/* Save Changes Button - matching contracts behavior */}
          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
            <Button
              id={`${id}-cancel-btn`}
              type="button"
              variant="outline"
              onClick={handleCancelClick}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              id={`${id}-save-changes-btn`}
              type="button"
              onClick={handleSaveChanges}
              disabled={isSaving}
            >
              <span className={hasUnsavedChanges ? 'font-bold' : ''}>
                {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save Changes *' : 'Save Changes'}
              </span>
              {!isSaving && <Save className="ml-2 h-4 w-4" />}
            </Button>
          </div>

          {/* Cancel confirmation dialog (like contracts) */}
          <ConfirmationDialog
            id={`${id}-cancel-confirm-dialog`}
            isOpen={showCancelConfirm}
            onClose={() => setShowCancelConfirm(false)}
            onConfirm={handleCancelConfirm}
            title="Discard Changes"
            message="You have unsaved changes. Are you sure you want to discard them?"
            confirmLabel="Discard"
            cancelLabel="Keep Editing"
          />
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default TicketInfo;
