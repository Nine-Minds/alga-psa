'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { getAllTags, updateTagColor, updateTagText, deleteAllTagsByText } from 'server/src/lib/actions/tagActions';
import { TaggedEntityType } from 'server/src/interfaces/tag.interfaces';

interface TagContextType {
  tags: ITag[];
  updateTagColor: (tagId: string, backgroundColor: string | null, textColor: string | null) => Promise<void>;
  updateTagText: (tagId: string, newTagText: string) => Promise<void>;
  deleteAllTagsByText: (tagText: string, taggedType: TaggedEntityType) => Promise<void>;
  refetchTags: () => Promise<void>;
}

const TagContext = createContext<TagContextType | undefined>(undefined);

export const TagProvider = ({ children }: { children: ReactNode }) => {
  const [tags, setTags] = useState<ITag[]>([]);

  const fetchTags = useCallback(async () => {
    const allTags = await getAllTags();
    setTags(allTags);
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const handleUpdateTagColor = async (tagId: string, backgroundColor: string | null, textColor: string | null) => {
    const tagToUpdate = tags.find(t => t.tag_id === tagId);
    if (!tagToUpdate) return;

    const originalTags = [...tags];
    const { tag_text } = tagToUpdate;

    // Optimistic UI update
    setTags(currentTags =>
      currentTags.map(tag => {
        if (tag.tag_text === tag_text) {
          return { ...tag, background_color: backgroundColor, text_color: textColor };
        }
        return tag;
      })
    );

    try {
      // Persist the change in the background
      await updateTagColor(tagId, backgroundColor, textColor);
      // Refetch the tags to ensure consistency
      await fetchTags();
    } catch (error) {
      console.error("Failed to update tag color:", error);
      // Revert on error
      setTags(originalTags);
    }
  };

  const handleUpdateTagText = async (tagId: string, newTagText: string) => {
    const tagToUpdate = tags.find(t => t.tag_id === tagId);
    if (!tagToUpdate) return;

    const originalTags = [...tags];
    const oldTagText = tagToUpdate.tag_text;

    // Optimistic UI update
    setTags(currentTags =>
      currentTags.map(tag => {
        if (tag.tag_text === oldTagText && tag.tagged_type === tagToUpdate.tagged_type) {
          return { ...tag, tag_text: newTagText };
        }
        return tag;
      })
    );

    try {
      // Persist the change in the background
      await updateTagText(tagId, newTagText);
      // Refetch the tags to ensure consistency
      await fetchTags();
    } catch (error) {
      console.error("Failed to update tag text:", error);
      // Revert on error
      setTags(originalTags);
      // Re-throw to allow component to handle error
      throw error;
    }
  };

  const handleDeleteAllTagsByText = async (tagText: string, taggedType: TaggedEntityType) => {
    const originalTags = [...tags];

    // Optimistic UI update - remove all tags with this text and type
    setTags(currentTags =>
      currentTags.filter(tag => 
        !(tag.tag_text === tagText && tag.tagged_type === taggedType)
      )
    );

    try {
      // Persist the change in the background
      await deleteAllTagsByText(tagText, taggedType);
      // Refetch the tags to ensure consistency
      await fetchTags();
    } catch (error) {
      console.error("Failed to delete tags:", error);
      // Revert on error
      setTags(originalTags);
      // Re-throw to allow component to handle error
      throw error;
    }
  };

  return (
    <TagContext.Provider value={{ 
      tags, 
      updateTagColor: handleUpdateTagColor, 
      updateTagText: handleUpdateTagText,
      deleteAllTagsByText: handleDeleteAllTagsByText,
      refetchTags: fetchTags 
    }}>
      {children}
    </TagContext.Provider>
  );
};

export const useTags = () => {
  const context = useContext(TagContext);
  if (context === undefined) {
    throw new Error('useTags must be used within a TagProvider');
  }
  return context;
};