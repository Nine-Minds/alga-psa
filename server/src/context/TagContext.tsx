'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { getAllTags, updateTagColor } from 'server/src/lib/actions/tagActions';

interface TagContextType {
  tags: ITag[];
  updateTagColor: (tagId: string, backgroundColor: string | null, textColor: string | null) => Promise<void>;
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

  return (
    <TagContext.Provider value={{ tags, updateTagColor: handleUpdateTagColor, refetchTags: fetchTags }}>
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