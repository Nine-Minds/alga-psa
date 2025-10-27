'use client';

import React, { useEffect, useState } from 'react';
import RichTextViewer from 'server/src/components/editor/RichTextViewer';
import TextEditor from 'server/src/components/editor/TextEditor';
import { PartialBlock } from '@blocknote/core';
import { ITicket, IComment, ITicketCategory } from 'server/src/interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { Button } from 'server/src/components/ui/Button';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { PrioritySelect } from '@/components/tickets/PrioritySelect';
import UserPicker from 'server/src/components/ui/UserPicker';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import { TagManager } from 'server/src/components/tags';
import styles from './TicketDetails.module.css';
import { getTicketCategories, getTicketCategoriesByBoard, BoardCategoryData } from '@product/actions/ticketCategoryActions';
import { ItilLabels, calculateItilPriority } from 'server/src/lib/utils/itilUtils';
import { Pencil, Check, HelpCircle } from 'lucide-react';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { Input } from 'server/src/components/ui/Input';


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
  onUpdateDescription,
  isSubmitting = false,
  users = [],
  tags = [],
  onTagsChange,
  isInDrawer = false,
  onItilFieldChange,
  itilImpact,
  itilUrgency,
  itilCategory,
  itilSubcategory,
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

  const handleTitleSubmit = () => {
    if (titleValue.trim() !== '') {
      onSelectChange('title', titleValue.trim());
      setIsEditingTitle(false);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setTitleValue(ticket.title);
      setIsEditingTitle(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleTitleSubmit();
    }
  };

  const handleCategoryChange = (categoryIds: string[]) => {
    if (categoryIds.length === 0) {
      onSelectChange('category_id', null);
      onSelectChange('subcategory_id', null);
      return;
    }

    const selectedCategoryId = categoryIds[0];
    const selectedCategory = categories.find(c => c.category_id === selectedCategoryId);
    
    if (!selectedCategory) {
      console.error('Selected category not found');
      return;
    }

    if (selectedCategory.parent_category) {
      onSelectChange('category_id', selectedCategory.parent_category);
      onSelectChange('subcategory_id', selectedCategoryId);
    } else {
      onSelectChange('category_id', selectedCategoryId);
      onSelectChange('subcategory_id', null);
    }

    // Don't automatically change the board - categories are now filtered by current board
    // This prevents unwanted board switches when selecting categories
  };

  const getSelectedCategoryId = () => {
    if (ticket.subcategory_id) {
      return ticket.subcategory_id;
    }
    return ticket.category_id || '';
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
          <div className="flex items-center gap-2 mb-4 min-w-0">
            {isEditingTitle ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Input

                  type="text"
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onKeyDown={handleTitleKeyDown}
                  autoFocus
                  className="text-2xl font-bold flex-1 px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  containerClassName="mb-2 flex-1"
                  style={{minWidth: '300px', width: '100%'}}
                />
                <button

                  onClick={handleTitleSubmit}
                  className="p-1 hover:bg-gray-100 rounded-full transition-colors duration-200 flex-shrink-0"
                  title="Save title"
                >
                  <Check className="w-4 h-4 text-gray-500" />
                </button>
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
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <h5 className="font-bold mb-2">Status</h5>
              <CustomSelect
                value={ticket.status_id || ''}
                options={statusOptions}
                onValueChange={(value) => onSelectChange('status_id', value)}
                customStyles={customStyles}
                className="!w-fit"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Assigned To</h5>
              <UserPicker
                value={ticket.assigned_to || ''}
                onValueChange={(value) => onSelectChange('assigned_to', value)}
                users={usersList}
                labelStyle="none"
                buttonWidth="fit"
                size="sm"
                className="!w-fit"
                placeholder="Not assigned"
              />
            </div>
            <div>
              <h5 className="font-bold mb-2">Board</h5>
              <CustomSelect
                value={ticket.board_id || ''}
                options={boardOptions}
                onValueChange={(value) => {
                  onSelectChange('board_id', value);
                  // Clear categories when board changes
                  onSelectChange('category_id', null);
                  onSelectChange('subcategory_id', null);

                  // Clear priority fields when board changes
                  // This ensures that switching between custom and ITIL priority types
                  // doesn't retain the wrong priority data
                  onSelectChange('priority_id', null);
                  if (onItilFieldChange) {
                    onItilFieldChange('itil_impact', null);
                    onItilFieldChange('itil_urgency', null);
                  }
                }}
                customStyles={customStyles}
                className="!w-fit"
              />
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
                  value={ticket.priority_id || null}
                  options={priorityOptions}
                  onValueChange={(value) => onSelectChange('priority_id', value)}
                  customStyles={customStyles}
                  className="!w-fit"
                />
              )}
            </div>
            {boardConfig.category_type && (
              <div className="col-span-2">
                <h5 className="font-bold mb-1">{boardConfig.category_type === 'custom' ? 'Category' : 'ITIL Category'}</h5>
                <div className="w-fit">
                  <CategoryPicker
                    id={`${id}-category-picker`}
                    categories={categories}
                    selectedCategories={[getSelectedCategoryId()]}
                    onSelect={handleCategoryChange}
                    placeholder={boardConfig.category_type === 'custom' ? "Select a category..." : "Select ITIL category..."}
                  />
                </div>
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
                      value={itilImpact?.toString() || null}
                      onValueChange={(value) => handleItilFieldChange('itil_impact', Number(value))}
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
                      value={itilUrgency?.toString() || null}
                      onValueChange={(value) => handleItilFieldChange('itil_urgency', Number(value))}
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
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default TicketInfo;
