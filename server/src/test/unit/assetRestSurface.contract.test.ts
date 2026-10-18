import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T147-T151 — F102-F105: the new asset REST surface. Route handlers, the
 * response schema fields the SDK consumers read, and the regenerated spec.
 *
 * The specs are generated artefacts, so asserting against them catches the
 * common failure of adding a route definition and forgetting to regenerate.
 */
const REPO_ROOT = path.resolve(__dirname, '../../../..');

function source(relativePath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relativePath), 'utf8');
}

function spec(edition: 'ce' | 'ee'): any {
  return JSON.parse(source(`sdk/docs/openapi/alga-openapi.${edition}.json`));
}

const NEW_PATHS = [
  '/api/v1/assets/{id}/assignments',
  '/api/v1/asset-statuses',
  '/api/v1/asset-groups',
  '/api/v1/asset-groups/{id}',
  '/api/v1/asset-groups/{id}/members',
  '/api/v1/asset-groups/{id}/contacts',
];

describe('asset REST surface', () => {
  it('T147: the assignments route exists and is tenant-scoped through the controller', () => {
    const text = source('server/src/app/api/v1/assets/[id]/assignments/route.ts');

    expect(text).toMatch(/export const GET/);
    expect(text).toMatch(/ApiAssetController/);
  });

  it('T149/T150: the group and status routes exist with their verbs', () => {
    expect(source('server/src/app/api/v1/asset-groups/route.ts')).toMatch(/export const GET/);
    expect(source('server/src/app/api/v1/asset-groups/route.ts')).toMatch(/export const POST/);
    expect(source('server/src/app/api/v1/asset-groups/[id]/route.ts')).toMatch(/export const (PUT|PATCH)/);
    expect(source('server/src/app/api/v1/asset-groups/[id]/route.ts')).toMatch(/export const DELETE/);
    expect(source('server/src/app/api/v1/asset-groups/[id]/members/route.ts')).toMatch(/export const POST/);
    expect(source('server/src/app/api/v1/asset-groups/[id]/contacts/route.ts')).toMatch(/export const POST/);
    expect(source('server/src/app/api/v1/asset-statuses/route.ts')).toMatch(/export const GET/);
  });

  it('T148: the asset response schema carries the new identity and billing fields', () => {
    const text = source('server/src/lib/api/schemas/asset.ts');
    const response = text.slice(
      text.indexOf('export const assetResponseSchema'),
      text.indexOf('export const assetWithDetailsResponseSchema')
    );

    for (const field of [
      'manufacturer',
      'model',
      'vendor_id',
      'vendor_name',
      'purchase_cost',
      'purchase_cost_currency',
      'order_number',
      'billing_profile_id',
      // F106: the two rows mobile renders.
      'contact_name',
      'group',
    ]) {
      expect(response).toContain(`${field}:`);
    }
  });

  it('T148: AssetService.getById joins the assignee and attaches the group', () => {
    const text = source('server/src/lib/api/services/AssetService.ts');
    const getById = text.slice(text.indexOf('async getById('), text.indexOf('async getWithDetails('));

    // Mobile reads /api/v1/assets/{id}; without these the Assigned-to and
    // Group rows render as "Unassigned" and nothing at all.
    expect(getById).toContain("'contacts.full_name as contact_name'");
    expect(getById).toContain('await getAssetGroupSummary(knex, context.tenant, id)');
    expect(getById).toContain("'vendors.vendor_name'");
  });

  it.each(['ce', 'ee'] as const)('T151: the %s spec documents every new path', (edition) => {
    const document = spec(edition);

    expect(document.openapi).toMatch(/^3\./);
    for (const route of NEW_PATHS) {
      expect(Object.keys(document.paths)).toContain(route);
    }
    expect(document.paths['/api/v1/asset-statuses'].get).toBeDefined();
    expect(document.paths['/api/v1/asset-groups'].post).toBeDefined();
    expect(document.paths['/api/v1/assets/{id}/assignments'].get).toBeDefined();
  });

  it('T144/T151: the merge schemas document the billing strategy and the asset preview', () => {
    const schemas = spec('ce').components.schemas;

    expect(Object.keys(schemas.ClientMergeBody.properties)).toContain('billing_strategy');
    expect(schemas.ClientMergeBody.properties.billing_strategy.enum)
      .toEqual(['source_profile', 'target_default']);
    expect(Object.keys(schemas.ClientMergeResource.properties)).toContain('billing_strategy');

    // F096: the dialog's counts come from the preview, so they have to be on
    // the documented shape too.
    const preview = schemas.ClientMergePreviewResource.properties;
    expect(Object.keys(preview)).toContain('assets');
    expect(Object.keys(preview.assets.properties)).toEqual(
      expect.arrayContaining(['total', 'byRmmOrganization', 'groups'])
    );
    // Every field readMergeAssetsPreview returns, integrationId included.
    expect(Object.keys(preview.assets.properties.byRmmOrganization.items.properties)).toEqual(
      expect.arrayContaining([
        'provider', 'integrationId', 'externalOrganizationId', 'externalOrganizationName', 'deviceCount',
      ])
    );
    expect(Object.keys(preview.billingChoice.properties)).toEqual(
      expect.arrayContaining(['unstampedTickets', 'unstampedProjects', 'unstampedAssets', 'unstampedRmmMappings'])
    );
  });

  it('T144: the REST merge body rejects an unknown billing strategy', async () => {
    const { clientMergeRequestSchema } = await import('../../lib/api/schemas/client');

    expect(clientMergeRequestSchema.safeParse({
      source_client_id: '11111111-1111-4111-8111-111111111111',
      billing_strategy: 'target_default',
    }).success).toBe(true);
    expect(clientMergeRequestSchema.safeParse({
      source_client_id: '11111111-1111-4111-8111-111111111111',
      billing_strategy: 'whatever',
    }).success).toBe(false);
  });
});
