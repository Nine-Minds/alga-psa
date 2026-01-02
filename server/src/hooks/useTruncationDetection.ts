import { useState, useEffect, useRef, RefObject } from 'react';

/**
 * Hook to detect if text content is being truncated by CSS line-clamp.
 * Returns a ref to attach to the element and a boolean indicating if truncation is occurring.
 *
 * @param content - The text content being displayed (used as dependency to re-check on change)
 * @param isExpanded - Whether the content is currently expanded (skip check when expanded)
 * @returns [ref, isTruncated] - Ref to attach to element and truncation state
 */
export function useTruncationDetection<T extends HTMLElement = HTMLParagraphElement>(
  content: string | undefined | null,
  isExpanded: boolean
): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    if (ref.current && !isExpanded) {
      setIsTruncated(ref.current.scrollHeight > ref.current.clientHeight);
    }
  }, [content, isExpanded]);

  return [ref, isTruncated];
}
