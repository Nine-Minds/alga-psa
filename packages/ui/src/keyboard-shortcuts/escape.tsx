'use client';

import { useEffect } from 'react';

let radixEscapeOwnerCount = 0;

export function pushRadixEscapeOwner(): () => void {
  radixEscapeOwnerCount += 1;
  let disposed = false;

  return () => {
    if (disposed) {
      return;
    }

    disposed = true;
    radixEscapeOwnerCount = Math.max(0, radixEscapeOwnerCount - 1);
  };
}

export function hasRadixEscapeOwner(): boolean {
  return radixEscapeOwnerCount > 0;
}

export function useRadixEscapeOwner(active: boolean): void {
  useEffect(() => {
    if (!active) {
      return;
    }

    return pushRadixEscapeOwner();
  }, [active]);
}

export function __resetRadixEscapeOwnersForTests(): void {
  radixEscapeOwnerCount = 0;
}
