import React, { useState, useEffect, useRef } from 'react';
import { ITag, TaggedEntityType } from 'server/src/interfaces/tag.interfaces';
import { createTag, deleteTag } from 'server/src/lib/actions/tagActions';
import { TagList } from './TagList';
import { TagInput } from './TagInput';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';
import { toast } from 'react-hot-toast';
import { useTags } from 'server/src/context/TagContext';

interface TagManagerProps {
  id?: string; // Made optional to maintain backward compatibility
  entityId: string;
  entityType: TaggedEntityType;
  initialTags: ITag[];
  onTagsChange?: (tags: ITag[]) => void;
  className?: string;
  allowColorEdit?: boolean;
}

export const TagManager: React.FC<TagManagerProps> = ({
  id = 'tag-manager',
  entityId,
  entityType,
  initialTags,
  onTagsChange,
  className = '',
  allowColorEdit = true
}) => {
  const { tags: allTags, refetchTags, updateTagColor } = useTags();
  const [tags, setTags] = useState<ITag[]>(initialTags);
  const lastGlobalTagsRef = useRef<ITag[]>([]);

  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

  // Update local tags when global tags change (for color updates)
  useEffect(() => {
    if (tags.length > 0 && allTags.length > 0) {
      // Check if global tags actually changed to avoid infinite updates
      const globalTagsChanged = JSON.stringify(allTags) !== JSON.stringify(lastGlobalTagsRef.current);
      
      if (globalTagsChanged) {
        lastGlobalTagsRef.current = allTags;
        
        const updatedTags = tags.map(localTag => {
          const globalTag = allTags.find(gt => gt.tag_text === localTag.tag_text && gt.tagged_type === localTag.tagged_type);
          if (globalTag && (globalTag.background_color !== localTag.background_color || globalTag.text_color !== localTag.text_color)) {
            return { ...localTag, background_color: globalTag.background_color, text_color: globalTag.text_color };
          }
          return localTag;
        });
        
        // Only update if there are actual changes
        const hasChanges = updatedTags.some((tag, index) => 
          tag.background_color !== tags[index]?.background_color || 
          tag.text_color !== tags[index]?.text_color
        );
        
        if (hasChanges) {
          setTags(updatedTags);
        }
      }
    }
  }, [allTags]);


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
      console.error('Error adding tag:', error);
      toast.error('Failed to add tag');
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
      console.error('Error removing tag:', error);
    }
  };

  return (
    <ReflectionContainer id={id} label="Tag Manager">
      <div className={`flex flex-wrap items-center gap-1 ${className}`}>
        <div className="flex flex-wrap gap-1">
          <TagList
            tags={tags}
            onRemoveTag={handleRemoveTag}
            allowColorEdit={allowColorEdit}
          />
        </div>
        <div className="flex-shrink-0">
          <TagInput
            id={`${id}-input`}
            existingTags={allTags.filter(t => t.tagged_type === entityType)}
            currentTags={tags}
            onAddTag={handleAddTag}
          />
        </div>
      </div>
    </ReflectionContainer>
  );
};
