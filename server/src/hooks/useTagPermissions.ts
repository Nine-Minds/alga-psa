import { useEffect, useRef } from 'react';
import { TaggedEntityType } from 'server/src/interfaces/tag.interfaces';
import { useTags } from 'server/src/context/TagContext';

/**
 * Hook to pre-fetch tag permissions for specified entity types
 * This prevents individual TagManager components from making duplicate permission requests
 */
export const useTagPermissions = (entityTypes: TaggedEntityType[]) => {
  const { getPermissions } = useTags();
  const hasInitialized = useRef(false);

  useEffect(() => {
    // Only run once per component mount to avoid infinite loops
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    
    // Pre-fetch permissions for all entity types used on this page
    const fetchPermissions = async () => {
      try {
        await Promise.all(
          entityTypes.map(entityType => getPermissions(entityType))
        );
      } catch (error) {
        console.error('Failed to pre-fetch tag permissions:', error);
      }
    };

    fetchPermissions();
  }, []); // Empty dependency array to run only once
};