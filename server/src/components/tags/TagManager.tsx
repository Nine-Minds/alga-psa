import React, { useState, useEffect, useRef } from 'react';
import { ITag, TaggedEntityType } from 'server/src/interfaces/tag.interfaces';
import { createTag, deleteTag, getAllTags, updateTagColor, checkTagPermissions } from 'server/src/lib/actions/tagActions';
import { TagList } from './TagList';
import { TagInput } from './TagInput';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';
import { toast } from 'react-hot-toast';
import { useTags } from 'server/src/context/TagContext';
import { handleError } from 'server/src/lib/utils/errorHandling';

interface TagManagerProps {
  id?: string; // Made optional to maintain backward compatibility
  entityId: string;
  entityType: TaggedEntityType;
  initialTags: ITag[];
  onTagsChange?: (tags: ITag[]) => void;
  className?: string;
  allowColorEdit?: boolean;
  allowTextEdit?: boolean;
}

export const TagManager: React.FC<TagManagerProps> = ({
  id = 'tag-manager',
  entityId,
  entityType,
  initialTags,
  onTagsChange,
  className = '',
  allowColorEdit = true,
  allowTextEdit = true
}) => {
  const tagContext = useTags();
  const [tags, setTags] = useState<ITag[]>(initialTags);
  const [localAllTags, setLocalAllTags] = useState<ITag[]>([]);
  const [permissions, setPermissions] = useState({
    canAddExisting: false,
    canCreateNew: false,
    canEditColors: false,
    canEditText: false,
    canDelete: false,
    canDeleteAll: false
  });
  const lastGlobalTagsRef = useRef<ITag[]>([]);

  // Use context if available, otherwise use local state
  const allTags = tagContext?.tags || localAllTags;
  const refetchTags = tagContext?.refetchTags || (async () => {
    try {
      const fetchedTags = await getAllTags();
      setLocalAllTags(fetchedTags);
    } catch (error) {
      console.error('Error fetching tags:', error);
    }
  });
  const updateTagColorFn = tagContext?.updateTagColor || (async (tagId: string, backgroundColor: string | null, textColor: string | null) => {
    try {
      await updateTagColor(tagId, backgroundColor, textColor);
      await refetchTags();
    } catch (error) {
      console.error('Error updating tag color:', error);
    }
  });
  const updateTagTextFn = tagContext?.updateTagText;

  // Fetch tags on mount if no context is available
  useEffect(() => {
    if (!tagContext) {
      refetchTags();
    }
  }, [tagContext, refetchTags]);

  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  // Fetch permissions when entity type changes
  useEffect(() => {
    async function fetchPermissions() {
      try {
        const perms = await checkTagPermissions(entityType);
        setPermissions(perms);
      } catch (error) {
        console.error('Failed to check tag permissions:', error);
      }
    }
    fetchPermissions();
  }, [entityType]);

  // Update local tags when global tags change (for color and text updates)
  useEffect(() => {
    if (tags.length > 0 && allTags.length > 0) {
      // Check if global tags actually changed to avoid infinite updates
      const globalTagsChanged = JSON.stringify(allTags) !== JSON.stringify(lastGlobalTagsRef.current);
      
      if (globalTagsChanged) {
        lastGlobalTagsRef.current = allTags;
        
        const updatedTags = tags.map(localTag => {
          // Find the exact tag by ID first
          let globalTag = allTags.find(gt => gt.tag_id === localTag.tag_id);
          
          // If not found by ID, it might have been updated - find by old text and type
          if (!globalTag) {
            globalTag = allTags.find(gt => 
              gt.tagged_id === localTag.tagged_id && 
              gt.tagged_type === localTag.tagged_type
            );
          }
          
          if (globalTag) {
            // Update if text, background_color, or text_color changed
            if (globalTag.tag_text !== localTag.tag_text ||
                globalTag.background_color !== localTag.background_color || 
                globalTag.text_color !== localTag.text_color) {
              return { ...localTag, 
                tag_text: globalTag.tag_text,
                background_color: globalTag.background_color, 
                text_color: globalTag.text_color 
              };
            }
          }
          return localTag;
        });
        
        // Only update if there are actual changes
        const hasChanges = updatedTags.some((tag, index) => 
          tag.tag_text !== tags[index]?.tag_text ||
          tag.background_color !== tags[index]?.background_color || 
          tag.text_color !== tags[index]?.text_color
        );
        
        if (hasChanges) {
          setTags(updatedTags);
          onTagsChange?.(updatedTags);
        }
      }
    }
  }, [allTags, tags, onTagsChange]);


  const handleAddTag = async (tagText: string) => {
    // Check if tag already exists on this entity
    const isDuplicate = tags.some(tag =>
      tag.tag_text.toLowerCase() === tagText.toLowerCase()
    );
    
    if (isDuplicate) {
      toast.error(`Tag "${tagText}" already exists on this item`);
      return;
    }

    try {
      const newTag = await createTag({
        tag_text: tagText,
        tagged_id: entityId,
        tagged_type: entityType,
      });

      const updatedTags = [...tags, newTag];
      setTags(updatedTags);
      onTagsChange?.(updatedTags);
      await refetchTags();
    } catch (error) {
      handleError(error, 'Failed to add tag');
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      await deleteTag(tagId);
      const updatedTags = tags.filter(tag => tag.tag_id !== tagId);
      setTags(updatedTags);
      onTagsChange?.(updatedTags);
      await refetchTags();
    } catch (error) {
      handleError(error, 'Failed to remove tag');
    }
  };

  return (
    <ReflectionContainer id={id} label="Tag Manager">
      <div className={`flex flex-wrap items-center gap-1 overflow-visible ${className}`}>
        <div className="flex flex-wrap gap-1">
          <TagList
            tags={tags}
            onRemoveTag={handleRemoveTag}
            allowColorEdit={allowColorEdit && permissions.canEditColors}
            allowTextEdit={allowTextEdit && permissions.canEditText}
            allowDeleteAll={permissions.canDeleteAll}
          />
        </div>
        {permissions.canAddExisting && (
          <div className="flex-shrink-0 overflow-visible">
            <TagInput
              id={`${id}-input`}
              existingTags={allTags.filter(t => t.tagged_type === entityType)}
              currentTags={tags}
              onAddTag={handleAddTag}
            />
          </div>
        )}
      </div>
    </ReflectionContainer>
  );
};
