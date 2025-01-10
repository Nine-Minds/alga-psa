import React, { useState, useEffect } from 'react';
import { ITag, TaggedEntityType } from '../../interfaces/tag.interfaces';
import { createTag, deleteTag } from '../../lib/actions/tagActions';
import { TagList } from './TagList';
import { TagInput } from './TagInput';
import { useAutomationIdAndRegister } from '../../types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from '../../types/ui-reflection/ReflectionContainer';
import { ContainerComponent } from '../../types/ui-reflection/types';

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
  }, []);

  const handleAddTag = async (tagText: string) => {
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
          onAddTag={handleAddTag}
        />
      </div>
    </ReflectionContainer>
  );
};
