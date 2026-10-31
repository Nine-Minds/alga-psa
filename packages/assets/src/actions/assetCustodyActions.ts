'use server';

import { z } from 'zod';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import type {
  IAssetCustody,
  IAssetCustodyDetail,
  IAssetCustodyEvent,
  IAssetCustodyEventDetail,
  ICustodyLocationOption,
  ICustodyQueueFilters,
  ICustodyQueuePage,
} from '@alga-psa/types';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  custodyEventInputSchema,
  custodyQueueFiltersSchema,
  openCustodyInputSchema,
  updateCustodyPatchSchema,
} from '../lib/schemas/assetCustody.schema';
import {
  getAssetCustodyService,
  getOpenCustodyBadgesService,
  type OpenCustodyBadge,
  listCustodyBinsService,
  listCustodyEventsService,
  listCustodyLocationsService,
  listCustodyQueueService,
  listHeldEquipmentService,
  openCustodyService,
  recordCustodyEventService,
  resolveCustodyToday,
  updateCustodyService,
} from '../lib/custody/service';
import { toCustodyResult, type CustodyActionResult } from '../lib/custody/actionResult';

/**
 * Equipment custody server actions (alga-2026-0002683, C4).
 *
 * No new RBAC resource: reads need `asset:read`, writes need `asset:update`, and every call also passes
 * the per-record asset check inside the service (an unreadable asset is "not found"). Ticket intake
 * (`receiveEquipment`) lives in @alga-psa/msp-composition because it needs the ticket record check and
 * @alga-psa/tickets depends on inventory, which depends on this package.
 *
 * Nothing here touches stock, billing or time.
 */

type Denied = ActionPermissionError;

const idSchema = z.string().guid();

async function denyUnless(user: Parameters<typeof hasPermission>[0], action: 'read' | 'update'): Promise<Denied | null> {
  return (await hasPermission(user, 'asset', action))
    ? null
    : (permissionError(`Permission denied: Cannot ${action} asset custody`) as Denied);
}

async function ctx() {
  const { knex } = await createTenantKnex();
  return knex;
}

type Step<E extends 'moved' | 'handed_off' | 'shipped' | 'received' | 'returned'> = Extract<
  z.input<typeof custodyEventInputSchema>,
  { event_type: E }
>;
type WithoutType<T> = Omit<T, 'event_type'>;

async function step(
  user: Parameters<typeof hasPermission>[0] & { user_id: string; user_type: 'internal' | 'client' },
  tenant: string,
  custodyId: string,
  input: unknown
): Promise<CustodyActionResult<{ custody: IAssetCustody; event: IAssetCustodyEvent }> | Denied> {
  const denied = await denyUnless(user, 'update');
  if (denied) return denied;
  return toCustodyResult(async () => {
    idSchema.parse(custodyId);
    const parsed = custodyEventInputSchema.parse(input);
    const { custody, event } = await recordCustodyEventService(await ctx(), tenant, user as any, custodyId, parsed);
    return { custody, event };
  });
}

export const openAssetCustody = withAuth(
  async (user, { tenant }, input: z.input<typeof openCustodyInputSchema>) => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toCustodyResult(async () => {
      const parsed = openCustodyInputSchema.parse(input);
      const { custody, event } = await openCustodyService(await ctx(), tenant, user as any, parsed);
      return { custody, event };
    });
  }
);

export const moveCustody = withAuth(
  async (user, { tenant }, custodyId: string, input: WithoutType<Step<'moved'>>) =>
    step(user as any, tenant, custodyId, { ...input, event_type: 'moved' })
);

export const handOffCustody = withAuth(
  async (user, { tenant }, custodyId: string, input: WithoutType<Step<'handed_off'>>) =>
    step(user as any, tenant, custodyId, { ...input, event_type: 'handed_off' })
);

export const shipCustody = withAuth(
  async (user, { tenant }, custodyId: string, input: WithoutType<Step<'shipped'>>) =>
    step(user as any, tenant, custodyId, { ...input, event_type: 'shipped' })
);

export const receiveBackCustody = withAuth(
  async (user, { tenant }, custodyId: string, input: WithoutType<Step<'received'>>) =>
    step(user as any, tenant, custodyId, { ...input, event_type: 'received' })
);

export const returnCustodyToClient = withAuth(
  async (user, { tenant }, custodyId: string, input: WithoutType<Step<'returned'>> = {}) =>
    step(user as any, tenant, custodyId, { ...input, event_type: 'returned' })
);

export const updateCustody = withAuth(
  async (user, { tenant }, custodyId: string, patch: z.input<typeof updateCustodyPatchSchema>) => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toCustodyResult(async () => {
      idSchema.parse(custodyId);
      const parsed = updateCustodyPatchSchema.parse(patch);
      const { custody } = await updateCustodyService(await ctx(), tenant, user as any, custodyId, parsed);
      return { custody };
    });
  }
);

export const getAssetCustody = withAuth(
  async (
    user,
    { tenant },
    assetId: string
  ): Promise<CustodyActionResult<{ open: IAssetCustodyDetail | null; episodes: IAssetCustodyDetail[] }> | Denied> => {
    const denied = await denyUnless(user, 'read');
    if (denied) return denied;
    return toCustodyResult(async () => getAssetCustodyService(await ctx(), tenant, user as any, idSchema.parse(assetId)));
  }
);

export const listCustodyEvents = withAuth(
  async (user, { tenant }, assetId: string): Promise<CustodyActionResult<IAssetCustodyEventDetail[]> | Denied> => {
    const denied = await denyUnless(user, 'read');
    if (denied) return denied;
    return toCustodyResult(async () => listCustodyEventsService(await ctx(), tenant, user as any, idSchema.parse(assetId)));
  }
);

/** The "Equipment in custody" queue. Rows and counts are record-level filtered. */
export const listCustodyQueue = withAuth(
  async (user, { tenant }, filters: ICustodyQueueFilters = {}): Promise<CustodyActionResult<ICustodyQueuePage> | Denied> => {
    const denied = await denyUnless(user, 'read');
    if (denied) return denied;
    return toCustodyResult(async () => {
      const knex = await ctx();
      const today = await resolveCustodyToday(knex, tenant, user.user_id);
      return listCustodyQueueService(knex, tenant, user as any, custodyQueueFiltersSchema.parse(filters), { today });
    });
  }
);

/** Open custody episodes on a ticket's linked assets, for the ticket's chip. */
export const listHeldEquipment = withAuth(
  async (user, { tenant }, ticketId: string): Promise<CustodyActionResult<IAssetCustodyDetail[]> | Denied> => {
    const denied = await denyUnless(user, 'read');
    if (denied) return denied;
    return toCustodyResult(async () => listHeldEquipmentService(await ctx(), tenant, user as any, idSchema.parse(ticketId)));
  }
);

export const listCustodyBins = withAuth(
  async (user, { tenant }, locationId: string): Promise<CustodyActionResult<string[]> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toCustodyResult(async () => listCustodyBinsService(await ctx(), tenant, idSchema.parse(locationId)));
  }
);

/** Gated by asset:update (not inventory permissions); exposes only id, name, type and default flag. */
export const listCustodyLocations = withAuth(
  async (user, { tenant }): Promise<CustodyActionResult<ICustodyLocationOption[]> | Denied> => {
    const denied = await denyUnless(user, 'update');
    if (denied) return denied;
    return toCustodyResult(async () => listCustodyLocationsService(await ctx(), tenant));
  }
);

/** Custody badges for a page of assets (list rows, ticket chips). Record-level filtered. */
export const getOpenCustodyBadges = withAuth(
  async (user, { tenant }, assetIds: string[]): Promise<CustodyActionResult<OpenCustodyBadge[]> | Denied> => {
    const denied = await denyUnless(user, 'read');
    if (denied) return denied;
    return toCustodyResult(async () =>
      getOpenCustodyBadgesService(await ctx(), tenant, user as any, z.array(idSchema).max(500).parse(assetIds))
    );
  }
);
