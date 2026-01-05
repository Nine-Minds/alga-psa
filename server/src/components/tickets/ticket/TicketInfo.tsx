'use client';

import React, { useEffect, useState, useRef } from 'react';
import RichTextViewer from 'server/src/components/editor/RichTextViewer';
import TextEditor from 'server/src/components/editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import { ITicket, IComment, ITicketCategory } from 'server/src/interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITicketResource } from 'server/src/interfaces/ticketResource.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { PrioritySelect } from '@/components/tickets/PrioritySelect';
import UserPicker from 'server/src/components/ui/UserPicker';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import { TagManager } from 'server/src/components/tags';
import styles from './TicketDetails.module.css';
import { getTicketCategories, getTicketCategoriesByBoard, BoardCategoryData } from 'server/src/lib/actions/ticketCategoryActions';
import { ItilLabels, calculateItilPriority } from 'server/src/lib/utils/itilUtils';
import { Pencil, HelpCircle, X, Save } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { Input } from 'server/src/components/ui/Input';
import UserAvatar from 'server/src/components/ui/UserAvatar';


interface TicketInfoProps {
  id: string; // Made required since it's needed for reflection registration
  ticket: ITicket;
  conversations: IComment[];
  statusOptions: { value: string; label: string }[];
  agentOptions: { value: string; label: string }[];
  boardOptions: { value: string; label: string }[];
  priorityOptions: { value: string; label: string }[];
  onSelectChange: (field: keyof ITicket, newValue: string | null) => void;
  onUpdateDescription?: (content: string) => Promise<boolean>;
  isSubmitting?: boolean;
  users?: IUserWithRoles[];
  tags?: ITag[];
  allTagTexts?: string[];
  onTagsChange?: (tags: ITag[]) => void;
  isInDrawer?: boolean;
  onItilFieldChange?: (field: string, value: any) => void;
  // Local ITIL state values
  itilImpact?: number;
  itilUrgency?: number;
  // Sectional save props (like contracts pattern)
  onSaveSection?: () => Promise<void>;
  onCancelSection?: () => void;
  hasUnsavedChanges?: boolean;
  isSavingSection?: boolean;
  // Callback to notify parent of temp (unsaved) changes for navigation confirmation
  onTempChangesUpdate?: (hasTempChanges: boolean) => void;
  // Additional agents props (moved from TicketProperties)
  additionalAgents?: ITicketResource[];
  availableAgents?: IUserWithRoles[];
  onAddAgent?: (userId: string) => Promise<void>;
  onRemoveAgent?: (assignmentId: string) => Promise<void>;
  onAgentClick?: (userId: string) => void;
  agentAvatarUrls?: Record<string, string | null>;
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
  onUpdateDescription,
  isSubmitting = false,
  users = [],
  tags = [],
  onTagsChange,
  isInDrawer = false,
  onItilFieldChange,
  itilImpact,
  itilUrgency,
  // Sectional save props
  onSaveSection,
  onCancelSection,
  hasUnsavedChanges = false,
  isSavingSection = false,
  onTempChangesUpdate,
  // Additional agents props
  additionalAgents = [],
  availableAgents = [],
  onAddAgent,
  onRemoveAgent,
  onAgentClick,
  agentAvatarUrls = {},
}) => {
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
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

  // Ref for title input to position cursor at end when editing starts
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Temp states for dropdown fields - holds UI value before saving
  const [tempStatus, setTempStatus] = useState(ticket.status_id || '');
  const [tempAssignedTo, setTempAssignedTo] = useState(ticket.assigned_to || '');
  const [tempBoard, setTempBoard] = useState(ticket.board_id || '');
  const [tempPriority, setTempPriority] = useState(ticket.priority_id || '');
  const [tempCategory, setTempCategory] = useState(ticket.category_id || '');
  const [tempSubcategory, setTempSubcategory] = useState(ticket.subcategory_id || '');
  const [tempImpact, setTempImpact] = useState(itilImpact?.toString() || '');
  const [tempUrgency, setTempUrgency] = useState(itilUrgency?.toString() || '');


  // Calculate ITIL priority when impact and urgency are available
  const calculatedItilPriority = React.useMemo(() => {
    if (itilImpact && itilUrgency) {
      try {
        return calculateItilPriority(itilImpact, itilUrgency);
      } catch {
        return null;
      }
    }
    return null;
  }, [itilImpact, itilUrgency]);

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

  // Separate useEffect for fetching categories based on board
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        if (ticket.board_id) {
          // Fetch categories for the specific board
          const data = await getTicketCategoriesByBoard(ticket.board_id);
          // Ensure data is properly resolved and categories is an array
          if (data && data.categories) {
            // Extra safety check - ensure it's actually an array
            const categoriesArray = Array.isArray(data.categories) ? data.categories : [];
            setCategories(categoriesArray);
            if (data.boardConfig) {
              setBoardConfig(data.boardConfig);
            }
          } else {
            console.error('Invalid categories data received:', data);
            setCategories([]);
            setBoardConfig({
              category_type: 'custom',
              priority_type: 'custom',
              display_itil_impact: false,
              display_itil_urgency: false,
              });
          }
        } else {
          // If no board, fetch all categories and use custom categories
          const fetchedCategories = await getTicketCategories();
          // Ensure fetchedCategories is an array
          if (Array.isArray(fetchedCategories)) {
            setCategories(fetchedCategories);
          } else {
            console.error('Invalid categories data received:', fetchedCategories);
            setCategories([]);
          }
          setBoardConfig({
            category_type: 'custom',
            priority_type: 'custom',
            display_itil_impact: false,
            display_itil_urgency: false,
          });
        }
      } catch (error) {
        console.error('Failed to fetch categories:', error);
        // Set empty defaults on error
        setCategories([]);
        setBoardConfig({
          category_type: 'custom',
          priority_type: 'custom',
          display_itil_impact: false,
          display_itil_urgency: false,
        });
      }
    };

    fetchCategories();
  }, [ticket.board_id]); // Re-fetch when board changes

  useEffect(() => {
    setTitleValue(ticket.title);
  }, [ticket.title]);

  // Sync temp values with ticket values when save is complete (hasUnsavedChanges becomes false)
  // This makes Save/Cancel buttons disappear after successful save
  useEffect(() => {
    if (!hasUnsavedChanges) {
      setTempStatus(ticket.status_id || '');
      setTempAssignedTo(ticket.assigned_to || '');
      setTempBoard(ticket.board_id || '');
      setTempPriority(ticket.priority_id || '');
      setTempCategory(ticket.category_id || '');
      setTempSubcategory(ticket.subcategory_id || '');
      setTempImpact(itilImpact?.toString() || '');
      setTempUrgency(itilUrgency?.toString() || '');
    }
  }, [hasUnsavedChanges, ticket.status_id, ticket.assigned_to, ticket.board_id, ticket.priority_id, ticket.category_id, ticket.subcategory_id, itilImpact, itilUrgency]);

  // Check if any dropdown field has unsaved temp changes
  const hasUnsavedTempChanges = () => {
    return tempStatus !== (ticket.status_id || '') ||
           tempAssignedTo !== (ticket.assigned_to || '') ||
           tempBoard !== (ticket.board_id || '') ||
           tempPriority !== (ticket.priority_id || '') ||
           tempCategory !== (ticket.category_id || '') ||
           tempSubcategory !== (ticket.subcategory_id || '') ||
           tempImpact !== (itilImpact?.toString() || '') ||
           tempUrgency !== (itilUrgency?.toString() || '');
  };

  // Notify parent component when temp changes status updates
  // This allows TicketDetails to show navigation confirmation even for unsaved temp changes
  useEffect(() => {
    if (onTempChangesUpdate) {
      const hasTempChanges = hasUnsavedTempChanges() || (isEditingTitle && titleValue !== ticket.title);
      onTempChangesUpdate(hasTempChanges);
    }
  }, [tempStatus, tempAssignedTo, tempBoard, tempPriority, tempCategory, tempSubcategory, tempImpact, tempUrgency, isEditingTitle, titleValue, ticket.title, ticket.status_id, ticket.assigned_to, ticket.board_id, ticket.priority_id, ticket.category_id, ticket.subcategory_id, itilImpact, itilUrgency, onTempChangesUpdate]);

  // Position cursor at end of title input when editing starts
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      const input = titleInputRef.current;
      // Focus and move cursor to end
      input.focus();
      const length = input.value.length;
      input.setSelectionRange(length, length);
    }
  }, [isEditingTitle]);

  // Handle clicking on title edit
  const handleTitleEditClick = () => {
    setIsEditingTitle(true);
  };

  const handleTitleSubmit = () => {
    if (titleValue.trim() !== '') {
      onSelectChange('title', titleValue.trim());
      setIsEditingTitle(false);
    }
  };

  const handleTitleCancel = () => {
    setTitleValue(ticket.title);
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleTitleCancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSubmit();
    }
  };

  // Temp category handler for Save/Cancel pattern
  const handleTempCategoryChange = (categoryIds: string[]) => {
    if (categoryIds.length === 0) {
      setTempCategory('');
      setTempSubcategory('');
      return;
    }

    const selectedCategoryId = categoryIds[0];
    const selectedCategory = categories.find(c => c.category_id === selectedCategoryId);

    if (!selectedCategory) {
      console.error('Selected category not found');
      return;
    }

    if (selectedCategory.parent_category) {
      setTempCategory(selectedCategory.parent_category);
      setTempSubcategory(selectedCategoryId);
    } else {
      setTempCategory(selectedCategoryId);
      setTempSubcategory('');
    }
  };

  const getTempSelectedCategoryId = () => {
    if (tempSubcategory) {
      return tempSubcategory;
    }
    return tempCategory || '';
  };

  // Check if category has changed from ticket value
  const hasCategoryChanged = () => {
    return tempCategory !== (ticket.category_id || '') ||
           tempSubcategory !== (ticket.subcategory_id || '');
  };

  // Save category changes
  const saveCategoryChanges = () => {
    onSelectChange('category_id', tempCategory || null);
    onSelectChange('subcategory_id', tempSubcategory || null);
  };

  // Cancel category changes - reset to ticket values
  const cancelCategoryChanges = () => {
    setTempCategory(ticket.category_id || '');
    setTempSubcategory(ticket.subcategory_id || '');
  };

  const handleItilFieldChange = (field: string, value: any) => {
    if (onItilFieldChange) {
      onItilFieldChange(field, value);
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
          <div className="flex flex-col gap-2 mb-4 min-w-0">
            {isEditingTitle ? (
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <Input
                  ref={titleInputRef}
                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  className="text-2xl font-bold flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  containerClassName="flex-1"
                  style={{minWidth: '300px', width: '100%'}}
                />
                {/* Save/Cancel buttons for title - like description pattern */}
                <div className="flex justify-end space-x-2">
                  <Button
                    id="save-title-button"
                    onClick={handleTitleSubmit}
                    disabled={!titleValue.trim()}
                    size="sm"
                  >
                    Save
                  </Button>
                  <Button
                    id="cancel-title-button"
                    variant="outline"
                    onClick={handleTitleCancel}
                    size="sm"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1
                  className="text-2xl font-bold break-words max-w-full min-w-0 flex-1"
                  style={{overflowWrap: 'break-word', wordBreak: 'break-word', whiteSpace: 'pre-wrap'}}
                >
                  {ticket.title}
                </h1>
                <button
                  onClick={handleTitleEditClick}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200 flex-shrink-0"
                  title="Edit title"
                >
                  <Pencil className="w-4 h-4 text-gray-500" />
                </button>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Status - with Save/Cancel buttons */}
            <div>
              <h5 className="font-bold mb-2">Status</h5>
              <CustomSelect
                value={tempStatus}
                options={statusOptions}
                onValueChange={setTempStatus}
                customStyles={customStyles}
                className="!w-fit"
              />
              {tempStatus !== (ticket.status_id || '') && (
                <div className="flex gap-2 mt-2">
                  <Button
                    id="save-status-btn"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectChange('status_id', tempStatus || null);
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    id="cancel-status-btn"
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTempStatus(ticket.status_id || '');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            {/* Assigned To - with Save/Cancel buttons */}
            <div>
              <h5 className="font-bold mb-2">Assigned To</h5>
              <UserPicker
                value={tempAssignedTo}
                onValueChange={setTempAssignedTo}
                users={usersList}
                labelStyle="none"
                buttonWidth="fit"
                size="sm"
                className="!w-fit"
                placeholder="Not assigned"
              />
              {tempAssignedTo !== (ticket.assigned_to || '') && (
                <div className="flex gap-2 mt-2">
                  <Button
                    id="save-assigned-to-btn"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectChange('assigned_to', tempAssignedTo || null);
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    id="cancel-assigned-to-btn"
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTempAssignedTo(ticket.assigned_to || '');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            {/* Board - with Save/Cancel buttons */}
            <div>
              <h5 className="font-bold mb-2">Board</h5>
              <CustomSelect
                value={tempBoard}
                options={boardOptions}
                onValueChange={(value) => {
                  setTempBoard(value);
                  // Clear temp categories and priority when board changes
                  setTempCategory('');
                  setTempSubcategory('');
                  setTempPriority('');
                  setTempImpact('');
                  setTempUrgency('');
                }}
                customStyles={customStyles}
                className="!w-fit"
              />
              {tempBoard !== (ticket.board_id || '') && (
                <div className="flex gap-2 mt-2">
                  <Button
                    id="save-board-btn"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectChange('board_id', tempBoard || null);
                      // Clear categories when board changes
                      onSelectChange('category_id', null);
                      onSelectChange('subcategory_id', null);
                      // Clear priority fields when board changes
                      onSelectChange('priority_id', null);
                      if (onItilFieldChange) {
                        onItilFieldChange('itil_impact', null);
                        onItilFieldChange('itil_urgency', null);
                      }
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    id="cancel-board-btn"
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setTempBoard(ticket.board_id || '');
                      // Also restore temp category and priority when canceling board change
                      setTempCategory(ticket.category_id || '');
                      setTempSubcategory(ticket.subcategory_id || '');
                      setTempPriority(ticket.priority_id || '');
                      setTempImpact(itilImpact?.toString() || '');
                      setTempUrgency(itilUrgency?.toString() || '');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
            <div>
              <h5 className="font-bold mb-2">Priority</h5>
              {boardConfig.priority_type === 'itil' ? (
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
                      (Impact {ticket.itil_impact} × Urgency {ticket.itil_urgency})
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowPriorityMatrix(!showPriorityMatrix);
                      }}
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
                <>
                  <PrioritySelect
                    value={tempPriority || null}
                    options={priorityOptions}
                    onValueChange={(value) => setTempPriority(value || '')}
                    customStyles={customStyles}
                    className="!w-fit"
                  />
                  {tempPriority !== (ticket.priority_id || '') && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        id="save-priority-btn"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectChange('priority_id', tempPriority || null);
                            }}
                      >
                        Save
                      </Button>
                      <Button
                        id="cancel-priority-btn"
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTempPriority(ticket.priority_id || '');
                            }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
            {boardConfig.category_type && (
              <div className="col-span-2">
                <h5 className="font-bold mb-1">{boardConfig.category_type === 'custom' ? 'Category' : 'ITIL Category'}</h5>
                <div className="w-fit">
                  <CategoryPicker
                    id={`${id}-category-picker`}
                    categories={categories}
                    selectedCategories={[getTempSelectedCategoryId()]}
                    onSelect={handleTempCategoryChange}
                    placeholder={boardConfig.category_type === 'custom' ? "Select a category..." : "Select ITIL category..."}
                  />
                </div>
                {hasCategoryChanged() && (
                  <div className="flex gap-2 mt-2">
                    <Button
                      id="save-category-btn"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveCategoryChanges();
                        }}
                    >
                      Save
                    </Button>
                    <Button
                      id="cancel-category-btn"
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelCategoryChanges();
                        }}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
            {/* ITIL Fields for ITIL priority boards */}
            {boardConfig.priority_type === 'itil' && (
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
                      value={tempImpact || null}
                      onValueChange={(value) => setTempImpact(value || '')}
                      placeholder="Select Impact"
                    />
                  </div>
                  {tempImpact !== (itilImpact?.toString() || '') && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        id="save-impact-btn"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleItilFieldChange('itil_impact', tempImpact ? Number(tempImpact) : null);
                            }}
                      >
                        Save
                      </Button>
                      <Button
                        id="cancel-impact-btn"
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTempImpact(itilImpact?.toString() || '');
                            }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
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
                      value={tempUrgency || null}
                      onValueChange={(value) => setTempUrgency(value || '')}
                      placeholder="Select Urgency"
                    />
                  </div>
                  {tempUrgency !== (itilUrgency?.toString() || '') && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        id="save-urgency-btn"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleItilFieldChange('itil_urgency', tempUrgency ? Number(tempUrgency) : null);
                            }}
                      >
                        Save
                      </Button>
                      <Button
                        id="cancel-urgency-btn"
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTempUrgency(itilUrgency?.toString() || '');
                            }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
            {/* ITIL Categories for ITIL category boards */}
            {/* ITIL Categories are now handled by the unified CategoryPicker above */}
          </div>

          {/* ITIL Priority Matrix - Show when help icon is clicked */}
          {showPriorityMatrix && boardConfig.priority_type === 'itil' && (
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
                  onClick={() => setIsEditingDescription(true)}
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
                    onContentChange={setDescriptionContent}
                  />
                </div>
                <div className="flex justify-end space-x-2 mt-2">
                  <Button
                    id="save-description-button"
                    onClick={async () => {
                      if (onUpdateDescription) {
                        const success = await onUpdateDescription(JSON.stringify(descriptionContent));
                        if (success) {
                          setIsEditingDescription(false);
                        }
                      }
                    }}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    id="cancel-description-button"
                    disabled={isSubmitting}
                    variant="outline"
                    onClick={() => {
                      // Reset to original content and cancel editing
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
          
          {/* Tags Section - auto-saves, no manual save button needed */}
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

          {/* Additional Agents Section - badge-style display with horizontal wrap */}
          <div className="mt-6">
            <h2 className="text-lg font-semibold mb-2">Additional Agents</h2>

            {/* Additional Agent badges - horizontal wrap like tags (3-4 per line) */}
            <div className="flex flex-wrap gap-2 mb-3">
              {additionalAgents.map((agent) => {
                const agentUser = (availableAgents.length > 0 ? availableAgents : users).find(u => u.user_id === agent.additional_user_id);
                return (
                  <div
                    key={agent.assignment_id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full text-sm group"
                  >
                    <div
                      className="flex items-center gap-2 cursor-pointer hover:text-blue-900"
                      onClick={() => agent.additional_user_id && onAgentClick && onAgentClick(agent.additional_user_id)}
                    >
                      <UserAvatar
                        userId={agent.additional_user_id!}
                        userName={`${agentUser?.first_name || ''} ${agentUser?.last_name || ''}`}
                        avatarUrl={agentAvatarUrls[agent.additional_user_id!] || null}
                        size="xs"
                      />
                      <span>
                        {agentUser?.first_name || 'Unknown'} {agentUser?.last_name || 'Agent'}
                      </span>
                    </div>
                    {onRemoveAgent && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveAgent(agent.assignment_id!);
                        }}
                        className="ml-1 p-0.5 rounded-full hover:bg-blue-200 transition-colors"
                        title="Remove agent"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* No additional agents message */}
              {additionalAgents.length === 0 && !onAddAgent && (
                <p className="text-sm text-gray-500">No additional agents assigned</p>
              )}
            </div>

            {/* Inline Agent Picker - always visible for adding agents */}
            {onAddAgent && (
              <div className="max-w-xs">
                <UserPicker
                  label=""
                  value=""
                  onValueChange={(userId) => {
                    onAddAgent(userId);
                  }}
                  users={(availableAgents.length > 0 ? availableAgents : users).filter(
                    agent =>
                      agent.user_id !== ticket.assigned_to &&
                      !additionalAgents.some(a => a.additional_user_id === agent.user_id)
                  )}
                  placeholder="Add agent..."
                  size="sm"
                />
              </div>
            )}
          </div>

          {/* Sectional Save Changes button - like contracts pattern */}
          {onSaveSection && (
            <div className="pt-4 mt-4 border-t border-gray-200">
              {/* Section-level unsaved changes warning - shows when any field has unsaved changes */}
              {(hasUnsavedTempChanges() || (isEditingTitle && titleValue !== ticket.title)) && (
                <p className="text-amber-600 text-sm mb-3">You have unsaved changes</p>
              )}
              <div className="flex justify-end gap-2">
              {onCancelSection && (
                <Button
                  id="cancel-ticket-info-changes"
                  type="button"
                  variant="outline"
                  onClick={onCancelSection}
                  disabled={isSavingSection}
                >
                  Cancel
                </Button>
              )}
              <Button
                id="save-ticket-info-changes"
                type="button"
                onClick={onSaveSection}
                disabled={isSavingSection}
              >
                <span className={hasUnsavedChanges ? 'font-bold' : ''}>
                  {isSavingSection ? 'Saving...' : hasUnsavedChanges ? 'Save Changes *' : 'Save Changes'}
                </span>
                {!isSavingSection && <Save className="ml-2 h-4 w-4" />}
              </Button>
              </div>
            </div>
          )}
        </div>
      </div>

    </ReflectionContainer>
  );
};

export default TicketInfo;
