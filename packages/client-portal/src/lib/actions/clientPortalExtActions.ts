"use server";

export type ClientPortalMenuItem = {
  id: string;
  label: string;
};

export async function listClientPortalMenuItemsForTenant(): Promise<ClientPortalMenuItem[]> {
  try {
    const mod = await import('@enterprise/lib/actions/clientPortalExtActions');
    const fn = (mod as { listClientPortalMenuItemsForTenant?: () => Promise<unknown> })
      .listClientPortalMenuItemsForTenant;
    if (typeof fn !== 'function') {
      return [];
    }

    const result = await fn();
    if (!Array.isArray(result)) {
      return [];
    }

    return result
      .map((item) => ({
        id: String((item as { id?: unknown }).id ?? ''),
        label: String((item as { label?: unknown }).label ?? ''),
      }))
      .filter((item) => item.id.length > 0 && item.label.length > 0);
  } catch {
    return [];
  }
}
