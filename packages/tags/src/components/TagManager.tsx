'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ITag, TaggedEntityType } from '@alga-psa/types';
import { createTag, deleteTag, getAllTags, getTagMappingUsageCount, isTagActionError } from '../actions';
import { TagList, TagInput, TagInputInline, type TagSize } from '@alga-psa/ui/components/tags';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { toast } from 'react-hot-toast';
import { useTags } from '../context/TagContext';
import { handleError } from '@alga-psa/ui';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isProvisionalTagId, useReconciledTags, type PendingTagOp } from './useReconciledTags';

interface TagManagerProps {
  id?: string;
  entityId: string;
  entityType: TaggedEntityType;
  initialTags: ITag[];
  onTagsChange?: (tags: ITag[]) => void;
  className?: string;
  allowColorEdit?: boolean;
  allowTextEdit?: boolean;
  useInlineInput?: boolean;
  size?: TagSize;
  permissions?: {
    canAddExisting: boolean;
    canCreateNew: boolean;
    canEditColors: boolean;
    canEditText: boolean;
    canDelete: boolean;
    canDeleteAll: boolean;
  };
  /** Display the entity's tags with no add, remove, or edit affordance. */
  readOnly?: boolean;
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
  size = 'md',
  permissions: passedPermissions,
  readOnly = false
}) => {
  const { t } = useTranslation('common');
  // Always call useTags to avoid conditional hooks
  const tagContext = useTags();
  const { tags, commitBase, getBase, runPendingOp, newProvisionalTagId } = useReconciledTags(initialTags);
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
  const [pendingRemoveTagId, setPendingRemoveTagId] = useState<string | null>(null);
  const [pendingRemoveTagText, setPendingRemoveTagText] = useState<string>('');
  const [showLastUsageDialog, setShowLastUsageDialog] = useState(false);

  // Use context if available, otherwise use local state
  const allTags = tagContext?.tags || localAllTags;
  const refetchTags = tagContext?.refetchTags || (async () => {
    try {
      const fetchedTags = await getAllTags();
      if (isTagActionError(fetchedTags)) {
        handleError(fetchedTags);
        return;
      }
      setLocalAllTags(fetchedTags);
    } catch (error) {
      console.error('Error fetching tags:', error);
    }
  });

  // Sync with global TagContext for tag updates from other components of the SAME TYPE
  useEffect(() => {
    if (tagContext?.tags && tags.length > 0) {
      // Create a map of all global tags by their original text (before any local changes)
      const globalTagsByText = new Map<string, ITag>();
      tagContext.tags
        .filter(globalT => globalT.tagged_type === entityType)
        .forEach(globalT => {
          const key = `${globalT.tag_text}_${globalT.tagged_type}`;
          if (!globalTagsByText.has(key)) {
            globalTagsByText.set(key, globalT);
          }
        });

      const syncWithGlobal = (localTag: ITag): ITag => {
        // First try to find by exact tag_id match (for the tag that was just edited)
        const exactMatch = tagContext.tags.find(globalT => globalT.tag_id === localTag.tag_id);
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
      };
      const updatedTags = tags.map(syncWithGlobal);

      // Only update if there are actual changes
      const hasChanges = updatedTags.some((tag, index) => {
        const original = tags[index];
        return tag.tag_text !== original.tag_text ||
               tag.background_color !== original.background_color ||
               tag.text_color !== original.text_color;
      });

      if (hasChanges) {
        // Apply to the reconciled base (not the displayed list) so a later
        // initialTags refresh or settling op does not undo the sync.
        onTagsChange?.(commitBase(getBase().map(syncWithGlobal)));
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
      toast.error(t('tags.messages.error.duplicate', { tag: tagText }));
      return;
    }

    if (!entityId) {
      console.error('Entity ID is missing, cannot add tag');
      toast.error(t('tags.messages.error.missingEntityId'));
      return;
    }

    const provisionalTag: ITag = {
      tag_id: newProvisionalTagId(),
      tag_text: tagText,
      tagged_id: entityId,
      tagged_type: entityType,
    };

    try {
      const updatedTags = await runPendingOp({ kind: 'add', tag: provisionalTag }, async () => {
        const newTag = await createTag({
          tag_text: tagText,
          tagged_id: entityId,
          tagged_type: entityType,
        });
        if (isTagActionError(newTag)) {
          handleError(newTag);
          return null;
        }
        return { kind: 'add', tag: newTag };
      });
      if (!updatedTags) return;

      onTagsChange?.(updatedTags);

      // Skip TagContext updates to prevent circular updates
      // Global syncing is handled by the parent component through onTagsChange
      toast.success(t('tags.messages.success.added', { tag: tagText }));
    } catch (error) {
      console.error('Failed to add tag:', error);
      handleError(error);
    }
  };

  /** Hide the tag until deleteTag settles; restore it if the delete fails. */
  const removeTagOptimistically = async (tagId: string, deleteDefinition?: boolean) => {
    const op: PendingTagOp = { kind: 'remove', tagId };
    const updatedTags = await runPendingOp(op, async () => {
      const result = deleteDefinition === undefined
        ? await deleteTag(tagId)
        : await deleteTag(tagId, deleteDefinition);
      if (isTagActionError(result)) {
        handleError(result);
        return null;
      }
      return op;
    });
    if (updatedTags) {
      onTagsChange?.(updatedTags);
    }
  };

  const handleRemoveTag = async (tagId: string) => {
    // A provisional chip has no server row yet; it settles on its own.
    if (isProvisionalTagId(tagId)) return;
    try {
      // Check if this is the last usage of the tag definition
      const usage = await getTagMappingUsageCount(tagId);
      if (isTagActionError(usage)) {
        handleError(usage);
        return;
      }
      if (usage.usageCount === 1) {
        // Show confirmation dialog for last usage
        setPendingRemoveTagId(tagId);
        setPendingRemoveTagText(usage.tagText);
        setShowLastUsageDialog(true);
        return;
      }

      await removeTagOptimistically(tagId);
    } catch (error) {
      handleError(error);
    }
  };

  const handleConfirmRemoveAndDeleteDefinition = async () => {
    if (!pendingRemoveTagId) return;
    try {
      await removeTagOptimistically(pendingRemoveTagId, true);
    } catch (error) {
      handleError(error);
    } finally {
      setShowLastUsageDialog(false);
      setPendingRemoveTagId(null);
      setPendingRemoveTagText('');
    }
  };

  const handleRemoveAndKeepDefinition = async () => {
    if (!pendingRemoveTagId) return;
    try {
      await removeTagOptimistically(pendingRemoveTagId, false);
    } catch (error) {
      handleError(error);
    } finally {
      setShowLastUsageDialog(false);
      setPendingRemoveTagId(null);
      setPendingRemoveTagText('');
    }
  };

  const handleTagUpdate = async (tagId: string, updates: { text?: string; backgroundColor?: string | null; textColor?: string | null }) => {
    if (isProvisionalTagId(tagId)) return;
    const previousBase = getBase();
    let optimisticBase: ITag[] | null = null;

    try {
      // Store original text for syncing other tags with same text
      const originalTag = tags.find(t => t.tag_id === tagId);
      const originalText = originalTag?.tag_text;

      // For text updates, update ALL local tags with the same original text immediately
      const applyUpdate = (tag: ITag): ITag => {
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
      };

      optimisticBase = previousBase.map(applyUpdate);
      onTagsChange?.(commitBase(optimisticBase));

      // Perform actual API updates through TagContext for global syncing
      // Only update TagContext if the API call is successful
      if (updates.text !== undefined && tagContext?.updateTagText) {
        await tagContext.updateTagText(tagId, updates.text);
      }

      if ((updates.backgroundColor !== undefined || updates.textColor !== undefined) && tagContext?.updateTagColor) {
        const tag = originalTag;
        if (tag) {
          await tagContext.updateTagColor(
            tagId,
            updates.backgroundColor !== undefined ? updates.backgroundColor : (tag.background_color ?? null),
            updates.textColor !== undefined ? updates.textColor : (tag.text_color ?? null)
          );
        }
      }
    } catch (error) {
      console.error('TagManager update error:', error);
      handleError(error);
      // Revert optimistic update on error, unless an initialTags refresh has
      // since replaced the base: that refresh is authoritative.
      if (getBase() === optimisticBase) {
        onTagsChange?.(commitBase(previousBase));
      }
    }
  };

  const gapClass = size === 'sm' ? 'gap-0.5' : size === 'lg' ? 'gap-1.5' : 'gap-1';

  return (
    <>
      <div className={`flex flex-wrap items-center ${gapClass} overflow-visible ${className}`}>
        <div className={`flex flex-wrap ${gapClass}`}>
          <TagList
            tags={tags}
            readOnly={readOnly}
            onRemoveTag={handleRemoveTag}
            allowColorEdit={allowColorEdit && permissions.canEditColors}
            allowTextEdit={allowTextEdit && permissions.canEditText}
            allowDeleteAll={permissions.canDeleteAll}
            onTagUpdate={handleTagUpdate}
            size={size}
          />
        </div>
        {!readOnly && (permissions.canAddExisting || permissions.canCreateNew) && (
          <div className="flex-shrink-0 overflow-visible">
            {useInlineInput ? (
              <TagInputInline
                id={`${id}-input`}
                existingTags={allTags.filter(t => t.tagged_type === entityType)}
                currentTags={tags}
                onAddTag={handleAddTag}
                size={size}
              />
            ) : (
              <TagInput
                id={`${id}-input`}
                existingTags={allTags.filter(t => t.tagged_type === entityType)}
                currentTags={tags}
                onAddTag={handleAddTag}
                size={size}
              />
            )}
          </div>
        )}
      </div>
      <ConfirmationDialog
        id="tag-last-usage-dialog"
        isOpen={showLastUsageDialog}
        onClose={() => {
          setShowLastUsageDialog(false);
          setPendingRemoveTagId(null);
          setPendingRemoveTagText('');
        }}
        onConfirm={handleConfirmRemoveAndDeleteDefinition}
        onCancel={handleRemoveAndKeepDefinition}
        title={t('tags.dialogs.lastUsage.title')}
        message={t('tags.dialogs.lastUsage.message', { tag: pendingRemoveTagText })}
        confirmLabel={t('tags.dialogs.lastUsage.confirm')}
        thirdButtonLabel={t('tags.dialogs.lastUsage.keep')}
        cancelLabel={t('actions.cancel')}
      />
    </>
  );
};
