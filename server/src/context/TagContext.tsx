'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef, useMemo } from 'react';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { getAllTags, updateTagColor, updateTagText, deleteAllTagsByText, checkTagPermissions } from '@alga-psa/tags/actions';
import { TaggedEntityType } from 'server/src/interfaces/tag.interfaces';

interface TagPermissions {
  canAddExisting: boolean;
  canCreateNew: boolean;
  canEditColors: boolean;
  canEditText: boolean;
  canDelete: boolean;
  canDeleteAll: boolean;
}

interface TagContextType {
  tags: ITag[];
  tagsLoaded: boolean;
  isLoading: boolean;
  updateTagColor: (tagId: string, backgroundColor: string | null, textColor: string | null) => Promise<void>;
  updateTagText: (tagId: string, newTagText: string) => Promise<void>;
  deleteAllTagsByText: (tagText: string, taggedType: TaggedEntityType) => Promise<void>;
  addTag: (tag: ITag) => void;
  removeTag: (tagId: string) => void;
  refetchTags: () => Promise<void>;
  getPermissions: (entityType: TaggedEntityType) => Promise<TagPermissions>;
  permissions: Record<TaggedEntityType, TagPermissions>;
}

const TagContext = createContext<TagContextType | undefined>(undefined);

export const TagProvider = ({ children }: { children: ReactNode }) => {
  const [tags, setTags] = useState<ITag[]>([]);
  const [permissions, setPermissions] = useState<Record<TaggedEntityType, TagPermissions>>({} as Record<TaggedEntityType, TagPermissions>);
  const [tagsLoaded, setTagsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const lastFetchRef = useRef<number>(0);
  const pendingPermissions = useRef<Record<string, Promise<TagPermissions> | null>>({});
  const permissionsRef = useRef<Record<TaggedEntityType, TagPermissions>>({} as Record<TaggedEntityType, TagPermissions>);
  const FETCH_DEBOUNCE_MS = 1000; // Prevent fetching more than once per second

  // Keep permissionsRef in sync with permissions state
  useEffect(() => {
    permissionsRef.current = permissions;
  }, [permissions]);

  // Create a stable refetch function that doesn't create circular dependencies
  const refetchTagsStable = useCallback(async () => {
    const now = Date.now();
    if (now - lastFetchRef.current < FETCH_DEBOUNCE_MS) {
      return;
    }
    lastFetchRef.current = now;
    
    setIsLoading(true);
    try {
      const allTags = await getAllTags();
      setTags(allTags);
      setTagsLoaded(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Don't fetch tags on mount - wait for components to request them
  // This prevents unnecessary tag loading on pages that don't need tags

  const handleUpdateTagColor = useCallback(async (tagId: string, backgroundColor: string | null, textColor: string | null) => {
    setTags(currentTags => {
      const tagToUpdate = currentTags.find(t => t.tag_id === tagId);
      if (!tagToUpdate) return currentTags;

      const { tag_text, tagged_type } = tagToUpdate;
      return currentTags.map(tag => {
        // Update tags with the same text AND same type
        if (tag.tag_text === tag_text && tag.tagged_type === tagged_type) {
          return { ...tag, background_color: backgroundColor, text_color: textColor };
        }
        return tag;
      });
    });

    try {
      await updateTagColor(tagId, backgroundColor, textColor);
      // Skip automatic refetch - let individual components handle their own updates
    } catch (error) {
      console.error("Failed to update tag color:", error);
      // On error, revert the optimistic update
      refetchTagsStable();
      throw error;
    }
  }, [refetchTagsStable]);

  const handleUpdateTagText = useCallback(async (tagId: string, newTagText: string) => {
    setTags(currentTags => {
      const tagToUpdate = currentTags.find(t => t.tag_id === tagId);
      if (!tagToUpdate) return currentTags;

      const oldTagText = tagToUpdate.tag_text;
      return currentTags.map(tag => {
        // Update tags with the same text AND same type
        if (tag.tag_text === oldTagText && tag.tagged_type === tagToUpdate.tagged_type) {
          return { ...tag, tag_text: newTagText };
        }
        return tag;
      });
    });

    try {
      await updateTagText(tagId, newTagText);
      // Skip automatic refetch - let individual components handle their own updates
    } catch (error) {
      console.error("Failed to update tag text:", error);
      // On error, revert the optimistic update
      refetchTagsStable();
      throw error;
    }
  }, [refetchTagsStable]);

  const handleDeleteAllTagsByText = useCallback(async (tagText: string, taggedType: TaggedEntityType) => {
    setTags(currentTags =>
      currentTags.filter(tag => 
        !(tag.tag_text === tagText && tag.tagged_type === taggedType)
      )
    );

    try {
      await deleteAllTagsByText(tagText, taggedType);
      // Skip automatic refetch - let individual components handle their own updates
    } catch (error) {
      console.error("Failed to delete tags:", error);
      // On error, revert the optimistic update
      refetchTagsStable();
      throw error;
    }
  }, [refetchTagsStable]);

  // Use useRef to create a stable function that doesn't change on re-renders
  // Define the function implementation
  const getPermissionsImpl = async (entityType: TaggedEntityType): Promise<TagPermissions> => {
    // Return cached permissions if available using ref to avoid stale closures
    const currentPerms = permissionsRef.current[entityType];
    if (currentPerms) {
      return currentPerms;
    }

    // Check if there's already a pending request for this entityType
    if (pendingPermissions.current[entityType]) {
      return pendingPermissions.current[entityType]!;
    }

    // Create a new promise and cache it
    const permissionPromise = checkTagPermissions(entityType)
      .then(perms => {
        setPermissions(current => ({ ...current, [entityType]: perms }));
        return perms;
      })
      .finally(() => {
        // Clear the pending promise
        pendingPermissions.current[entityType] = null;
      });

    // Store the promise so other concurrent calls can use it
    pendingPermissions.current[entityType] = permissionPromise;

    return permissionPromise;
  };

  // Initialize ref with the implementation - ref ensures stable identity across renders
  const getPermissionsRef = useRef(getPermissionsImpl);
  const getPermissions = getPermissionsRef.current;

  // Create stable function references to prevent context value from changing unnecessarily
  const addTag = useCallback((tag: ITag) => setTags(current => [...current, tag]), []);
  const removeTag = useCallback((tagId: string) => setTags(current => current.filter(t => t.tag_id !== tagId)), []);

  const contextValue = useMemo(() => ({
    tags,
    tagsLoaded,
    isLoading,
    updateTagColor: handleUpdateTagColor, 
    updateTagText: handleUpdateTagText,
    deleteAllTagsByText: handleDeleteAllTagsByText,
    addTag,
    removeTag,
    refetchTags: refetchTagsStable,
    permissions,
    getPermissions
  }), [tags, tagsLoaded, isLoading, handleUpdateTagColor, handleUpdateTagText, handleDeleteAllTagsByText, addTag, removeTag, refetchTagsStable, permissions, getPermissions]);

  return (
    <TagContext value={contextValue}>
      {children}
    </TagContext>
  );
};

export const useTags = () => {
  const context = useContext(TagContext);
  if (context === undefined) {
    throw new Error('useTags must be used within a TagProvider');
  }
  
  // Lazy load tags on first access
  useEffect(() => {
    // Only fetch if not already loaded and not currently loading
    if (!context.tagsLoaded && !context.isLoading) {
      context.refetchTags();
    }
  }, [context]);
  
  return context;
};