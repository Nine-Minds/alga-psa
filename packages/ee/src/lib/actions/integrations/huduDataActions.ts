/**
 * CE stub for the EE Hudu reference-data actions
 * (ee/server/src/lib/actions/integrations/huduDataActions.ts, resolved via the
 * edition-swapped `@enterprise` alias). Community Edition has no Hudu
 * integration, so the client-tab gate always resolves hidden.
 */

export interface HuduClientContext {
  connected: boolean;
  mapped: boolean;
}

export async function getHuduClientContext(_clientId: string): Promise<HuduClientContext> {
  return { connected: false, mapped: false };
}
