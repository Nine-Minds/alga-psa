import {
  buildAssetAssignedPayload,
  buildAssetCreatedPayload,
  buildAssetUnassignedPayload,
  buildAssetUpdatedPayload,
  buildAssetWarrantyExpiringPayload,
  computeAssetWarrantyExpiring,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW, EARLIER } from '../fixtures';

/**
 * Assets. The server-side REST AssetService used to publish hand-built ASSET_CREATED / ASSET_UPDATED
 * literals (userId/timestamp, and `changes` as the raw request body, which the registered schema
 * rejects); it now uses the same builders as assetActions.
 */

const ASSET_ACTIONS = 'packages/assets/src/actions/assetActions.ts';
const ASSET_SERVICE = 'server/src/lib/api/services/AssetService.ts';
const WARRANTY_SOURCE = 'packages/jobs/src/lib/dateTriggers/sources/assetWarrantyEnd.ts';

type AssetEventType =
  | 'ASSET_CREATED'
  | 'ASSET_UPDATED'
  | 'ASSET_ASSIGNED'
  | 'ASSET_UNASSIGNED'
  | 'ASSET_WARRANTY_EXPIRING';

const user = { actor: { actorType: 'USER' as const, actorUserId: IDS.user }, occurredAt: NOW };

const assetBefore = {
  asset_id: IDS.asset,
  client_id: IDS.client,
  name: 'FIN-LT-014',
  status: 'active',
  location_id: null,
  warranty_end_date: '2026-12-31T00:00:00.000Z',
  updated_at: EARLIER,
};
const assetAfter = { ...assetBefore, name: 'FIN-LT-014 (spare)', status: 'in_repair', updated_at: NOW };

const warrantyWindow = () =>
  computeAssetWarrantyExpiring({
    now: NOW,
    previousExpiresAt: undefined,
    newExpiresAt: '2026-08-05T00:00:00.000Z',
    windowDays: 30,
  })!;

export const assetContracts = {
  ASSET_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${ASSET_ACTIONS}#createAssetRecord`,
        ctx: user,
        build: () =>
          buildAssetCreatedPayload({
            assetId: IDS.asset,
            clientId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: EARLIER,
            assetType: 'workstation',
            serialNumber: 'SN-48211',
          }),
      },
      {
        site: `${ASSET_SERVICE}#AssetService.create`,
        ctx: user,
        build: () =>
          buildAssetCreatedPayload({
            assetId: IDS.asset,
            clientId: IDS.client,
            createdByUserId: IDS.user,
            createdAt: new Date(NOW),
            assetType: 'server',
          }),
      },
    ],
  },
  ASSET_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${ASSET_ACTIONS}#updateAssetRecord`,
        ctx: user,
        build: () =>
          buildAssetUpdatedPayload({
            assetId: IDS.asset,
            before: assetBefore,
            after: assetAfter,
            updatedPaths: ['name', 'status'],
            updatedByUserId: IDS.user,
            updatedAt: NOW,
          }),
      },
      {
        site: `${ASSET_SERVICE}#AssetService.update`,
        ctx: user,
        build: () =>
          buildAssetUpdatedPayload({
            assetId: IDS.asset,
            before: assetBefore,
            after: { ...assetAfter, updated_at: new Date(NOW) },
            updatedPaths: ['status'],
            updatedByUserId: IDS.user,
            updatedAt: new Date(NOW),
          }),
      },
    ],
  },
  ASSET_ASSIGNED: {
    status: 'covered',
    cases: [
      {
        // reassigned to another client on update
        site: `${ASSET_ACTIONS}#updateAssetRecord`,
        ctx: user,
        build: () =>
          buildAssetAssignedPayload({
            assetId: IDS.asset,
            previousOwnerType: 'client',
            previousOwnerId: IDS.client,
            newOwnerType: 'client',
            newOwnerId: IDS.otherClient,
            assignedAt: NOW,
          }),
      },
      {
        // linked to a ticket
        site: `${ASSET_ACTIONS}#createAssetAssociation`,
        ctx: user,
        build: () =>
          buildAssetAssignedPayload({
            assetId: IDS.asset,
            newOwnerType: 'ticket',
            newOwnerId: IDS.ticket,
            assignedAt: NOW,
          }),
      },
    ],
  },
  ASSET_UNASSIGNED: {
    status: 'covered',
    cases: [
      {
        site: `${ASSET_ACTIONS}#removeAssetAssociation`,
        ctx: user,
        build: () =>
          buildAssetUnassignedPayload({
            assetId: IDS.asset,
            previousOwnerType: 'ticket',
            previousOwnerId: IDS.ticket,
            unassignedAt: NOW,
            reason: 'manual_detach',
          }),
      },
    ],
  },
  ASSET_WARRANTY_EXPIRING: {
    status: 'covered',
    cases: [
      {
        site: `${ASSET_ACTIONS}#createAssetRecord`,
        ctx: user,
        build: () =>
          buildAssetWarrantyExpiringPayload({ assetId: IDS.asset, clientId: IDS.client, ...warrantyWindow() }),
      },
      {
        site: `${ASSET_ACTIONS}#updateAssetRecord`,
        ctx: user,
        build: () =>
          buildAssetWarrantyExpiringPayload({ assetId: IDS.asset, clientId: IDS.otherClient, ...warrantyWindow() }),
      },
      {
        // daily date-trigger job: SYSTEM actor, expiry at tenant-local midnight of the warranty date
        site: `${WARRANTY_SOURCE}#assetWarrantyEndSource`,
        ctx: { actor: { actorType: 'SYSTEM' }, occurredAt: NOW },
        build: () =>
          buildAssetWarrantyExpiringPayload({
            assetId: IDS.asset,
            clientId: IDS.client,
            expiresAt: '2026-08-05T00:00:00.000Z',
            daysUntilExpiry: 20,
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, AssetEventType>;
