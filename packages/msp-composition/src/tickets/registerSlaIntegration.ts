/**
 * Registers SLA service integrations for the tickets package.
 * Called at app startup to wire SLA backends into ticket actions
 * without creating a direct tickets→sla cross-package dependency.
 */
import { SlaBackendFactory } from '@alga-psa/sla/services';
import { configureItilSlaForBoard } from '@alga-psa/sla';
import { registerSlaCancellation, registerItilSlaConfiguration } from '@alga-psa/tickets/actions';

let registered = false;

export function registerSlaIntegration(): void {
  if (registered) return;
  registered = true;

  registerSlaCancellation(async (ticketId: string) => {
    const backend = await SlaBackendFactory.getBackend();
    await backend.cancelSla(ticketId);
  });

  registerItilSlaConfiguration(configureItilSlaForBoard);
}
