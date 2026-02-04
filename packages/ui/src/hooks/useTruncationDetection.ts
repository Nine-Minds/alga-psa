'use client';

import { useCallback, useEffect, useState } from 'react';

export function useTruncationDetection<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  // Callback ref that tracks when the element mounts/unmounts
  const ref = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  useEffect(() => {
    if (!element) {
      setIsTruncated(false);
      return;
    }

    const check = () => {
      setIsTruncated(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight);
    };

    check();

    const resizeObserver = new ResizeObserver(() => check());
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [element]);

  return { ref, isTruncated };
}

