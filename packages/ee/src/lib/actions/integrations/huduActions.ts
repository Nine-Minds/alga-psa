/**
 * CE stub for the EE Hudu connection actions
 * (ee/server/src/lib/actions/integrations/huduActions.ts, resolved via the
 * edition-swapped `@enterprise` alias). Community Edition has no Hudu
 * integration, so the Documents-page tab gate always resolves hidden.
 */

export interface HuduConnectionStatusData {
  connected: boolean;
  isActive: boolean;
  baseUrl: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  passwordAccess: boolean;
}

export type HuduActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function getHuduConnectionStatus(): Promise<
  HuduActionResult<HuduConnectionStatusData>
> {
  return {
    success: true,
    data: {
      connected: false,
      isActive: false,
      baseUrl: null,
      connectedAt: null,
      lastSyncedAt: null,
      passwordAccess: false,
    },
  };
}
