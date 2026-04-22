import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readActionSource = () => readFileSync(path.resolve(__dirname, 'assetActions.ts'), 'utf8');

describe('asset authorization kernel contracts', () => {
  const source = readActionSource();

  it('T021: keeps selected asset surfaces on shared kernel with baseline + bundle narrowing composition', () => {
    expect(source).toContain('async function resolveAssetAuthorizationRecords(');
    expect(source).toContain('async function createAssetReadAuthorizationContext(');
    expect(source).toContain('async function authorizeAssetReadDecision(');
    expect(source).toContain('async function assertAssetReadAllowed(');
    expect(source).toContain('export const getAsset = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const getAssetDetailBundle = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const listAssets = withAuth(async (user, { tenant }, params: AssetQueryParams)');
    expect(source).toContain('buildAuthorizationAwarePage<any>({');
    expect(source).toContain('authorizeRecord: async (asset) => {');
    expect(source).toContain('total: authorizedPage.total,');
    expect(source).toContain('builtinProvider: new BuiltinAuthorizationKernelProvider(),');
    expect(source).toContain('bundleProvider: new BundleAuthorizationKernelProvider({');
    expect(source).toContain('return await resolveBundleNarrowingRulesForEvaluation(trx, input);');
    expect(source).toContain('record: assetRecords.get(asset.asset_id),');
  });

  it('T016: applies asset-level read authorization to relationship, maintenance, history, linked-ticket, entity-list, and summary-metric surfaces', () => {
    expect(source).toContain('async function resolveAssetAuthorizationInputById(');
    expect(source).toContain('async function assertAssetReadAllowedById(');
    expect(source).toContain('async function createAuthorizedAssetReadContextForUser(');
    expect(source).toContain('export const getAssetRelationships = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const getAssetMaintenanceSchedules = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const getAssetMaintenanceReport = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const getAssetHistory = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const getAssetLinkedTickets = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('export const listEntityAssets = withAuth(async (user, { tenant }, entity_id: string, entity_type: \'ticket\' | \'project\')');
    expect(source).toContain('export const getAssetSummaryMetrics = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('await createAuthorizedAssetReadContextForUser(trx, tenant, user as AssetAuthUser, asset_id);');
    expect(source).toContain('const context = await createAssetReadAuthorizationContext(trx, tenant, user as AssetAuthUser);');
    expect(source).toContain('const authorizedAssetIds = await getAuthorizedAssetIdsForClient(trx, tenant, context, client_id);');
    expect(source).toContain('return getClientMaintenanceSummaryForTenant(trx, tenant, client_id, authorizedAssetIds);');
  });

  it('T017: enforces asset-level authorization across update/delete, relationship, association, and maintenance mutations', () => {
    expect(source).toContain('export const updateAsset = withAuth(async (user, { tenant }, asset_id: string, data: UpdateAssetRequest)');
    expect(source).toContain('export const deleteAsset = withAuth(async (');
    expect(source).toContain('export const createAssetRelationship = withAuth(async (user, { tenant }, data: CreateAssetRelationshipRequest)');
    expect(source).toContain('export const deleteAssetRelationship = withAuth(async (user, { tenant }, parent_asset_id: string, child_asset_id: string)');
    expect(source).toContain('export const createAssetAssociation = withAuth(async (user, { tenant }, data: CreateAssetAssociationRequest)');
    expect(source).toContain('export const removeAssetAssociation = withAuth(async (');
    expect(source).toContain('export const createMaintenanceSchedule = withAuth(async (user, { tenant }, data: CreateMaintenanceScheduleRequest)');
    expect(source).toContain('export const updateMaintenanceSchedule = withAuth(async (');
    expect(source).toContain('export const deleteMaintenanceSchedule = withAuth(async (user, { tenant }, schedule_id: string)');
    expect(source).toContain('export const recordMaintenanceHistory = withAuth(async (user, { tenant }, data: CreateMaintenanceHistoryRequest)');
    expect(source).toContain('await assertAssetReadAllowedById(trx, tenant, context, validated.parent_asset_id);');
    expect(source).toContain('await assertAssetReadAllowedById(trx, tenant, context, validated.child_asset_id);');
    expect(source).toContain('if (!await hasPermission(user, \'asset\', \'delete\')) {');
    expect(source).toContain('await createAuthorizedAssetReadContextForUser(trx as Knex.Transaction, tenantId, user as AssetAuthUser, asset_id);');
    expect(source).toContain('if (schedule.asset_id !== validatedData.asset_id) {');
  });

  it('T018: enforces linked-child intersection semantics in asset detail bundles for linked ticket/document payloads', () => {
    expect(source).toContain('export const getAssetDetailBundle = withAuth(async (user, { tenant }, asset_id: string)');
    expect(source).toContain('canReadTickets ? fetchAssetLinkedTickets(trx, tenant, asset_id, context) : Promise.resolve([])');
    expect(source).toContain('canReadDocuments ? fetchAssetDocuments(trx, tenant, asset_id, 15, context) : Promise.resolve([])');
    expect(source).toContain("resource: { type: 'ticket', action: 'read', id: row.ticket_id }");
    expect(source).toContain("resource: { type: 'document', action: 'read', id: record.document_id }");
    expect(source).toContain('const rowsAfterIntersection = authorizationContext');
    expect(source).toContain('const recordsAfterIntersection = authorizationContext');
    expect(source).toContain('// Structural child data inherits parent-asset authorization. Linked ticket/document data');
  });
});
