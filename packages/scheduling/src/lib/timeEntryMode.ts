import { loadProductPrincipal } from '@shared/services/productPrincipal';
import { CO_MANAGED_SEAT_SURFACE } from '@shared/services/productSurfaceKinds';
import type { CoManagedTimeEntryMode } from '@alga-psa/co-managed/timeEntryBillingMode';

// LEVERAGE: friction time-source-seam-forbids-co-managed — the A1 static guard (src/test/timeSourceCoverage.static.test.ts)
// bars the time-entry call sites from importing @alga-psa/co-managed, so the operational field set and the service rule
// reach them through this module. The seat mode is not a time source (it writes natively), so it wants its own seam
// rather than a re-export that sidesteps the guard.
export { operationalTimeEntryFields, serviceRequiredForTimeEntry } from '@alga-psa/co-managed/timeEntryBillingMode';
export type { CoManagedTimeEntryMode };

/**
 * The one decision of which mode a principal's time entries are written in.
 *
 * `operational` for a co-managed seat technician (the S12 principal kind), `commercial` for everyone else.
 * Decided here, on the server, from the authenticated principal. No client value is an input, so a payload
 * claiming `operational` cannot turn billing off and a seat cannot ask for `commercial`.
 *
 * The release capability is deliberately not consulted: a seat principal exists only while `co-managed-seat`
 * admitted the tenant, and once it exists the mode never reverts to billable because a flag moved (same
 * stance as `resolveTicketViewerCapabilities`). A failed principal read propagates, so a save fails rather
 * than falling back to commercial.
 */
export function timeEntryModeForSurfaceKind(surfaceKind: string | null | undefined): CoManagedTimeEntryMode {
  return surfaceKind === CO_MANAGED_SEAT_SURFACE ? 'operational' : 'commercial';
}

export async function resolveTimeEntryMode(tenant: string, userId: string): Promise<CoManagedTimeEntryMode> {
  const { surfaceKind } = await loadProductPrincipal({ tenantId: tenant, userId });
  return timeEntryModeForSurfaceKind(surfaceKind);
}
