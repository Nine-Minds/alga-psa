import React, { useState, useEffect } from 'react';
import { ITag, TaggedEntityType } from 'server/src/interfaces/tag.interfaces';
import { createTag, deleteTag } from 'server/src/lib/actions/tagActions';
import { TagList } from './TagList';
import { TagInput } from './TagInput';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ContainerComponent } from 'server/src/types/ui-reflection/types';
import { toast } from 'react-hot-toast';

interface TagManagerProps {
  id?: string; // Made optional to maintain backward compatibility
  entityId: string;
  entityType: TaggedEntityType;
  initialTags: ITag[];
  existingTags: string[];
  onTagsChange?: (tags: ITag[]) => void;
  className?: string;
}

export const TagManager: React.FC<TagManagerProps> = ({
  id = 'tag-manager',
  entityId,
  entityType,
  initialTags,
  existingTags,
  onTagsChange,
  className = ''
}) => {
  const [tags, setTags] = useState<ITag[]>(initialTags);


  useEffect(() => {
    setTags(initialTags);
  }, [initialTags]);

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
    } catch (error) {
      console.error('Error removing tag:', error);
    }
  };

  return (
    <ReflectionContainer id={id} label="Tag Manager">
      <div className={`flex flex-wrap gap-1 ${className}`}>
        <TagList 
          id={`${id}-list`}
          tags={tags} 
          onRemoveTag={handleRemoveTag}
        />
        <TagInput
          id={`${id}-input`}
          existingTags={existingTags}
          currentTags={tags}
          onAddTag={handleAddTag}
        />
      </div>
    </ReflectionContainer>
  );
};
