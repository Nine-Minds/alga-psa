import React, { useState, useEffect, useRef } from 'react';
import { ITag, TaggedEntityType } from 'server/src/interfaces/tag.interfaces';
import { createTag, deleteTag, getAllTags, checkTagPermissions } from 'server/src/lib/actions/tagActions';
import { TagList } from './TagList';
import { TagInput } from './TagInput';
import { TagInputInline } from './TagInputInline';
// import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
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
  useInlineInput?: boolean; // Use inline input instead of portal-based input
  permissions?: {
    canAddExisting: boolean;
    canCreateNew: boolean;
    canEditColors: boolean;
    canEditText: boolean;
    canDelete: boolean;
    canDeleteAll: boolean;
  };
}

export const TagManager: React.FC<TagManagerProps> = ({
  id = 'tag-manager',
  entityId,
  entityType,
  initialTags,
  onTagsChange,
  className = '',
  allowColorEdit = true,
  allowTextEdit = true,
  useInlineInput = false,
  permissions: passedPermissions
}) => {
  // Always call useTags to avoid conditional hooks
  const tagContext = useTags();
  const [tags, setTags] = useState<ITag[]>(initialTags);
  const [localAllTags, setLocalAllTags] = useState<ITag[]>([]);
  const [permissions, setPermissions] = useState(
    passedPermissions || {
      canAddExisting: true,
      canCreateNew: true,
      canEditColors: true,
      canEditText: true,
      canDelete: true,
      canDeleteAll: false
    }
  );
  const lastGlobalTagsRef = useRef<ITag[]>([]);
  const skipNextSyncRef = useRef(false);

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
  // Remove unused variables

  // Initialize tags only once, then let optimistic updates take over
  useEffect(() => {
    if (initialTags.length > 0 || tags.length === 0) {
      setTags(initialTags);
    }
  }, [initialTags.length]); // Only depend on length to avoid overriding optimistic updates

  // Sync with global TagContext for tag updates from other components of the SAME TYPE
  useEffect(() => {
    if (tagContext?.tags && tags.length > 0) {
      // Create a map of all global tags by their original text (before any local changes)
      const globalTagsByText = new Map<string, ITag>();
      (tagContext?.tags || [])
        .filter(globalT => globalT.tagged_type === entityType)
        .forEach(globalT => {
          const key = `${globalT.tag_text}_${globalT.tagged_type}`;
          if (!globalTagsByText.has(key)) {
            globalTagsByText.set(key, globalT);
          }
        });
      
      const updatedTags = tags.map(localTag => {
        // First try to find by exact tag_id match (for the tag that was just edited)
        const exactMatch = tagContext?.tags?.find(globalT => globalT.tag_id === localTag.tag_id);
        if (exactMatch) {
          return {
            ...localTag,
            tag_text: exactMatch.tag_text,
            background_color: exactMatch.background_color,
            text_color: exactMatch.text_color
          };
        }
        
        // For other tags, try to find a canonical version with same current text
        const key = `${localTag.tag_text}_${localTag.tagged_type}`;
        const canonicalTag = globalTagsByText.get(key);
        if (canonicalTag) {
          return {
            ...localTag,
            tag_text: canonicalTag.tag_text,
            background_color: canonicalTag.background_color,
            text_color: canonicalTag.text_color
          };
        }
        
        return localTag;
      });
      
      // Only update if there are actual changes
      const hasChanges = updatedTags.some((tag, index) => {
        const original = tags[index];
        return tag.tag_text !== original.tag_text ||
               tag.background_color !== original.background_color ||
               tag.text_color !== original.text_color;
      });
      
      if (hasChanges) {
        setTags(updatedTags);
        onTagsChange?.(updatedTags);
      }
    }
  }, [tagContext?.tags, entityType]); // Include entityType to ensure we only sync same-type tags

  // Removed problematic global tag syncing that was causing infinite loops
  // Individual TagManager instances will handle their own optimistic updates

  // Re-enable proper permissions checking
  useEffect(() => {
    if (passedPermissions) {
      console.log('Using passed permissions:', passedPermissions);
      setPermissions(passedPermissions);
      return;
    }
    
    // Fetch permissions from TagContext if not passed as props
    const fetchPermissions = async () => {
      if (tagContext?.getPermissions) {
        try {
          const perms = await tagContext.getPermissions(entityType);
          console.log('Fetched permissions for', entityType, ':', perms);
          setPermissions(perms);
        } catch (error) {
          console.error('Failed to get tag permissions:', error);
          // Fallback to restrictive permissions on error
          setPermissions({
            canAddExisting: false,
            canCreateNew: false,
            canEditColors: false,
            canEditText: false,
            canDelete: false,
            canDeleteAll: false
          });
        }
      }
    };
    
    fetchPermissions();
  }, [passedPermissions, entityType]); // Remove tagContext?.getPermissions from dependencies


  const handleAddTag = async (tagText: string) => {
    // Check if tag already exists on this entity
    const isDuplicate = tags.some(tag =>
      tag.tag_text.toLowerCase() === tagText.toLowerCase()
    );
    
    if (isDuplicate) {
      toast.error(`Tag "${tagText}" already exists on this item`);
      return;
    }

    if (!entityId) {
      console.error('Entity ID is missing, cannot add tag');
      toast.error('Cannot add tag: entity ID is missing');
      return;
    }

    try {
      console.log('Adding tag:', { tagText, entityId, entityType });
      const newTag = await createTag({
        tag_text: tagText,
        tagged_id: entityId,
        tagged_type: entityType,
      });
      console.log('Tag created successfully:', newTag);

      const updatedTags = [...tags, newTag];
      setTags(updatedTags);
      onTagsChange?.(updatedTags);
      
      // Skip TagContext updates to prevent circular updates
      // Global syncing is handled by the parent component through onTagsChange
      toast.success(`Tag "${tagText}" added successfully`);
    } catch (error) {
      console.error('Failed to add tag:', error);
      handleError(error);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    try {
      await deleteTag(tagId);
      const updatedTags = tags.filter(tag => tag.tag_id !== tagId);
      setTags(updatedTags);
      onTagsChange?.(updatedTags);
      
      // Skip TagContext updates to prevent circular updates
      // Global syncing is handled by the parent component through onTagsChange
    } catch (error) {
      handleError(error);
    }
  };

  const handleTagUpdate = async (tagId: string, updates: { text?: string; backgroundColor?: string | null; textColor?: string | null }) => {
    
    try {
      // Store original text for syncing other tags with same text
      const originalTag = tags.find(t => t.tag_id === tagId);
      const originalText = originalTag?.tag_text;
      
      // For text updates, update ALL local tags with the same original text immediately
      const updatedTags = tags.map(tag => {
        if (updates.text !== undefined && tag.tag_text === originalText && tag.tagged_type === entityType) {
          // Update all tags with the same original text
          return {
            ...tag,
            tag_text: updates.text,
            ...(updates.backgroundColor !== undefined && { background_color: updates.backgroundColor }),
            ...(updates.textColor !== undefined && { text_color: updates.textColor })
          };
        } else if (tag.tag_id === tagId) {
          // Update the specific tag for color-only changes
          return {
            ...tag,
            ...(updates.backgroundColor !== undefined && { background_color: updates.backgroundColor }),
            ...(updates.textColor !== undefined && { text_color: updates.textColor })
          };
        }
        return tag;
      });
      
      setTags(updatedTags);
      onTagsChange?.(updatedTags);
      
      // Perform actual API updates through TagContext for global syncing
      // Only update TagContext if the API call is successful
      if (updates.text !== undefined && tagContext?.updateTagText) {
        await tagContext.updateTagText(tagId, updates.text);
      }
      
      if ((updates.backgroundColor !== undefined || updates.textColor !== undefined) && tagContext?.updateTagColor) {
        const tag = originalTag;
        if (tag) {
          await tagContext?.updateTagColor?.(
            tagId, 
            updates.backgroundColor !== undefined ? updates.backgroundColor : (tag.background_color ?? null),
            updates.textColor !== undefined ? updates.textColor : (tag.text_color ?? null)
          );
        }
      }
    } catch (error) {
      console.error('TagManager update error:', error);
      handleError(error);
      // Revert optimistic update on error
      setTags(tags);
      onTagsChange?.(tags);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-1 overflow-visible ${className}`}>
      <div className="flex flex-wrap gap-1">
        <TagList
          tags={tags}
          onRemoveTag={handleRemoveTag}
          allowColorEdit={allowColorEdit && permissions.canEditColors}
          allowTextEdit={allowTextEdit && permissions.canEditText}
          allowDeleteAll={permissions.canDeleteAll}
          onTagUpdate={handleTagUpdate}
        />
      </div>
      {(permissions.canAddExisting || permissions.canCreateNew) && (
        <div className="flex-shrink-0 overflow-visible">
          {useInlineInput ? (
            <TagInputInline
              id={`${id}-input`}
              existingTags={allTags.filter(t => t.tagged_type === entityType)}
              currentTags={tags}
              onAddTag={handleAddTag}
            />
          ) : (
            <TagInput
              id={`${id}-input`}
              existingTags={allTags.filter(t => t.tagged_type === entityType)}
              currentTags={tags}
              onAddTag={handleAddTag}
            />
          )}
        </div>
      )}
    </div>
  );
};
