'use client';

import { useEffect, useRef, useState } from 'react';

export function useTruncationDetection<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const check = () => {
      setIsTruncated(el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight);
    };

    check();

    const resizeObserver = new ResizeObserver(() => check());
    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, []);

  return { ref, isTruncated };
}

