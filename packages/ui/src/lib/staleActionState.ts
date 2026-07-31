'use client';

import { useSyncExternalStore } from 'react';
import { unstable_isUnrecognizedActionError } from 'next/navigation';

type StaleActionListener = () => void;

let isStale = false;
const listeners = new Set<StaleActionListener>();

const getServerSnapshot = () => false;

export function isStaleServerActionError(error: unknown): boolean {
  if (unstable_isUnrecognizedActionError(error)) {
    return true;
  }

  return (
    typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'UnrecognizedActionError'
  );
}

export function markStaleActionState(): void {
  if (isStale) {
    return;
  }

  isStale = true;
  listeners.forEach((listener) => listener());
}

export function getStaleActionState(): boolean {
  return isStale;
}

export function subscribeToStaleActionState(listener: StaleActionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStaleActionState(): boolean {
  return useSyncExternalStore(
    subscribeToStaleActionState,
    getStaleActionState,
    getServerSnapshot,
  );
}
