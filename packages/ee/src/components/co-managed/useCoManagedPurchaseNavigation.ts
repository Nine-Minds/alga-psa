'use client';

// CE stub: no purchase-discovery contribution, whatever the rollout flag or price configuration says.
// Structural return type: a CE stub must not depend on the host's menu types.
export function useCoManagedPurchaseNavigation(): { id?: string; title: string; items: never[] } | null {
  return null;
}
