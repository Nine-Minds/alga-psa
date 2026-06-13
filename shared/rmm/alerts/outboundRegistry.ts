import type { RmmAlertOutboundAdapter } from './contracts';

/**
 * Per-provider outbound adapters (reset an alert in the RMM). Providers
 * register at wiring time — CE providers from server code, EE providers from
 * ee/server boot — so the ticket-close subscriber can stay provider-agnostic.
 * A provider without an adapter is simply skipped.
 */
const adapters = new Map<string, RmmAlertOutboundAdapter>();

export function registerRmmAlertOutboundAdapter(provider: string, adapter: RmmAlertOutboundAdapter): void {
  adapters.set(provider, adapter);
}

export function getRmmAlertOutboundAdapter(provider: string): RmmAlertOutboundAdapter | undefined {
  return adapters.get(provider);
}
