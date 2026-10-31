/**
 * Shared seeding for the alga-2026-0002683 C2 label integration tests. Every row is created here, inside
 * the test, in tenants made for the test: nothing depends on what a seed happens to put first in a table.
 *
 * Authorization is real, not mocked: the users get RBAC through roles/permissions rows, and the
 * "restricted" user is narrowed to ONE client by a published authorization bundle (a record-level deny).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';

import type { IUserWithRoles } from '@alga-psa/types';
import { runWithTenant } from '@alga-psa/db';

/** A 1x1 PNG. Real bytes: the logo path sniffs the format and base64-inlines it. */
export const LOGO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

export interface LabelWorld {
  tenant: string;
  otherTenant: string;
  clientA: string;
  clientB: string;
  /** Reads everything in the tenant. */
  tech: IUserWithRoles;
  /** Same RBAC as `tech`, but a bundle narrows ticket/asset reads to client A. */
  restricted: IUserWithRoles;
  /** Has no ticket/asset read permission at all. */
  noPerm: IUserWithRoles;
  tickets: {
    a1: string;
    a2: string;
    /** Linked to exactly one readable asset (a1Asset). */
    withOneAsset: string;
    /** Linked to two readable assets. */
    withTwoAssets: string;
    /** Linked to one asset the restricted user cannot read (client B). */
    withDeniedAsset: string;
    /** Linked to a readable (client A) and an unreadable-for-restricted (client B) asset. */
    withMixedAssets: string;
    /** Linked to one asset whose serial is too short for a suffix. */
    withShortSerial: string;
    /** Client B: unreadable for `restricted`. */
    b1: string;
    /** Another tenant. */
    foreign: string;
  };
  assets: {
    a1: string;
    a2: string;
    a3: string;
    b1: string;
    foreign: string;
    unlinked: string;
  };
  serials: { a1: string; a2: string };
  logoFileId: string;
}

async function insertTenant(db: Knex, name: string): Promise<string> {
  const tenant = randomUUID();
  await db('tenants').insert({
    tenant,
    client_name: name,
    email: `${tenant.slice(0, 8)}@example.com`,
    phone_number: '555-0100',
    payment_platform_id: `p-${tenant.slice(0, 8)}`,
    payment_method_id: `m-${tenant.slice(0, 8)}`,
    auth_service_id: `a-${tenant.slice(0, 8)}`,
    plan: 'pro',
    product_code: 'psa',
  });
  return tenant;
}

async function insertClient(db: Knex, tenant: string, name: string): Promise<string> {
  const client_id = randomUUID();
  await db('clients').insert({ tenant, client_id, client_name: name, billing_cycle: 'monthly', is_tax_exempt: false });
  return client_id;
}

async function insertUser(db: Knex, tenant: string, label: string, roleId: string | null): Promise<IUserWithRoles> {
  const user_id = randomUUID();
  await db('users').insert({
    tenant,
    user_id,
    username: `${label}.${user_id}`,
    first_name: label,
    last_name: 'User',
    email: `${label}.${user_id}@example.com`,
    hashed_password: 'x',
    user_type: 'internal',
    is_inactive: false,
  });
  if (roleId) await db('user_roles').insert({ tenant, user_id, role_id: roleId });
  const row = await db('users').where({ tenant, user_id }).first();
  return { ...row, roles: roleId ? [{ role_id: roleId }] : [] } as IUserWithRoles;
}

async function insertTicket(db: Knex, tenant: string, clientId: string, title: string, number: string, enteredBy: string) {
  const ticket_id = randomUUID();
  await db('tickets').insert({
    tenant,
    ticket_id,
    ticket_number: number,
    title,
    client_id: clientId,
    entered_by: enteredBy,
    is_closed: false,
  });
  return ticket_id;
}

async function insertAsset(
  db: Knex,
  tenant: string,
  clientId: string,
  tag: string,
  serial: string | null
): Promise<string> {
  const asset_id = randomUUID();
  await db('assets').insert({
    tenant,
    asset_id,
    asset_tag: tag,
    name: `Asset ${tag}`,
    status: 'active',
    asset_type: 'workstation',
    client_id: clientId,
    serial_number: serial,
  });
  return asset_id;
}

async function link(db: Knex, tenant: string, assetId: string, ticketId: string, by: string) {
  await db('asset_associations').insert({
    tenant,
    asset_id: assetId,
    entity_id: ticketId,
    entity_type: 'ticket',
    relationship_type: 'affected',
    created_by: by,
  });
}

/** Seed two tenants, the users, tickets, assets, links, a narrowing bundle and an issuer logo. */
export async function seedLabelWorld(db: Knex, storageBasePath: string): Promise<LabelWorld> {
  const tenant = await insertTenant(db, 'Label Tenant');
  const otherTenant = await insertTenant(db, 'Other Tenant');
  const clientA = await insertClient(db, tenant, 'Client A');
  const clientB = await insertClient(db, tenant, 'Client B');
  const foreignClient = await insertClient(db, otherTenant, 'Foreign Client');

  // RBAC: a role carrying ticket:read and asset:read (msp), one without.
  const role_id = randomUUID();
  await db('roles').insert({ tenant, role_id, role_name: 'Label Tech', msp: true, client: false });
  const bareRole = randomUUID();
  await db('roles').insert({ tenant, role_id: bareRole, role_name: 'Bare', msp: true, client: false });
  for (const [resource, action] of [['ticket', 'read'], ['asset', 'read'], ['billing', 'update']]) {
    const permission_id = randomUUID();
    await db('permissions').insert({ tenant, permission_id, resource, action, msp: true, client: false });
    await db('role_permissions').insert({ tenant, role_id, permission_id });
  }

  const tech = await insertUser(db, tenant, 'tech', role_id);
  const restricted = await insertUser(db, tenant, 'restricted', role_id);
  const noPerm = await insertUser(db, tenant, 'noperm', bareRole);
  const foreignUser = await insertUser(db, otherTenant, 'foreign', null);

  const serials = { a1: 'SN-ALPHA-12345678', a2: 'SHORT' };
  const assets = {
    a1: await insertAsset(db, tenant, clientA, 'TAG-A1', serials.a1),
    a2: await insertAsset(db, tenant, clientA, 'TAG-A2', serials.a2),
    a3: await insertAsset(db, tenant, clientA, 'TAG-A3', 'SN-GAMMA-99990000'),
    b1: await insertAsset(db, tenant, clientB, 'TAG-B1', 'SN-BRAVO-00001111'),
    foreign: await insertAsset(db, otherTenant, foreignClient, 'TAG-F1', 'SN-FOREIGN-22223333'),
    unlinked: await insertAsset(db, tenant, clientA, 'TAG-UNLINKED', 'SN-UNLINKED-44445555'),
  };

  const tickets = {
    a1: await insertTicket(db, tenant, clientA, 'Printer jam', 'LBL-1', tech.user_id),
    a2: await insertTicket(db, tenant, clientA, 'VPN down', 'LBL-2', tech.user_id),
    withOneAsset: await insertTicket(db, tenant, clientA, 'Replace disk', 'LBL-3', tech.user_id),
    withTwoAssets: await insertTicket(db, tenant, clientA, 'Two machines', 'LBL-4', tech.user_id),
    withDeniedAsset: await insertTicket(db, tenant, clientA, 'Cross-client asset', 'LBL-5', tech.user_id),
    withMixedAssets: await insertTicket(db, tenant, clientA, 'Mixed assets', 'LBL-7', tech.user_id),
    withShortSerial: await insertTicket(db, tenant, clientA, 'Short serial', 'LBL-8', tech.user_id),
    b1: await insertTicket(db, tenant, clientB, 'Client B ticket', 'LBL-6', tech.user_id),
    foreign: await insertTicket(db, otherTenant, foreignClient, 'Foreign ticket', 'LBL-F', foreignUser.user_id),
  };

  await link(db, tenant, assets.a1, tickets.withOneAsset, tech.user_id);
  await link(db, tenant, assets.a1, tickets.withTwoAssets, tech.user_id);
  await link(db, tenant, assets.a3, tickets.withTwoAssets, tech.user_id);
  await link(db, tenant, assets.b1, tickets.withDeniedAsset, tech.user_id);
  await link(db, tenant, assets.a1, tickets.withMixedAssets, tech.user_id);
  await link(db, tenant, assets.b1, tickets.withMixedAssets, tech.user_id);
  await link(db, tenant, assets.a2, tickets.withShortSerial, tech.user_id);

  // Record-level deny: a published bundle narrows `restricted` to client A for ticket + asset reads.
  const bundle_id = randomUUID();
  const revision_id = randomUUID();
  await db('authorization_bundles').insert({
    tenant,
    bundle_id,
    bundle_key: `label-narrow-${bundle_id.slice(0, 8)}`,
    name: 'Client A only',
    is_system: false,
    status: 'active',
  });
  await db('authorization_bundle_revisions').insert({
    tenant,
    revision_id,
    bundle_id,
    revision_number: 1,
    lifecycle_state: 'published',
  });
  await db('authorization_bundles').where({ tenant, bundle_id }).update({ published_revision_id: revision_id });
  for (const resource_type of ['ticket', 'asset']) {
    await db('authorization_bundle_rules').insert({
      tenant,
      bundle_id,
      revision_id,
      resource_type,
      action: 'read',
      template_key: 'selected_clients',
      effect: 'narrow',
      config: JSON.stringify({ selectedClientIds: [clientA] }),
      position: 0,
    });
  }
  await db('authorization_bundle_assignments').insert({
    tenant,
    bundle_id,
    target_type: 'user',
    target_id: restricted.user_id,
    status: 'active',
  });

  // The issuing company (tenant_companies -> client) with a real logo stored on the local provider.
  await db('tenant_companies').insert({ tenant, client_id: clientA, is_default: true });
  const file_id = randomUUID();
  const storage_path = `label-logo/${file_id}.png`;
  fs.mkdirSync(path.dirname(path.join(storageBasePath, storage_path)), { recursive: true });
  fs.writeFileSync(path.join(storageBasePath, storage_path), LOGO_PNG);
  await db('external_files').insert({
    tenant,
    file_id,
    file_name: `${file_id}.png`,
    original_name: 'logo.png',
    mime_type: 'image/png',
    file_size: LOGO_PNG.length,
    storage_path,
    uploaded_by_id: tech.user_id,
    is_deleted: false,
  });
  const document_id = randomUUID();
  await db('documents').insert({
    tenant,
    document_id,
    document_name: 'logo',
    user_id: tech.user_id,
    created_by: tech.user_id,
    file_id,
  });
  await db('document_associations').insert({
    tenant,
    document_id,
    entity_id: clientA,
    entity_type: 'client',
    is_entity_logo: true,
    entity_logo_variant: 'default',
  });

  return {
    tenant,
    otherTenant,
    clientA,
    clientB,
    tech,
    restricted,
    noPerm,
    tickets,
    assets,
    serials,
    logoFileId: file_id,
  };
}

/**
 * The same deps the /api/labels/pdf route wires, with REAL providers, template resolution, linked-asset
 * merge and renderer. `renderPdf` may be overridden (to capture items) when a test is not about rendering.
 */
export async function buildRealLabelDeps(overrides: { renderPdf?: unknown } = {}) {
  const { renderLabelBatchPdf, resolveLabelTemplateForTenant, LabelRenderError, LabelLayoutError } = await import(
    '@alga-psa/billing/services'
  );
  const { getTicketLinkedAssetLabelParts } = await import('@alga-psa/assets/lib/ticketLinkedAssetLabels');
  const { assetLabelViewModelProvider } = await import('@alga-psa/assets/lib/labelViewModelProvider');
  const { ticketLabelViewModelProvider } = await import('@alga-psa/tickets/lib/labelViewModelProvider');
  return {
    providers: {
      'ticket-work-tag': ticketLabelViewModelProvider,
      'asset-identity': assetLabelViewModelProvider,
      'stock-unit-identity': undefined,
    },
    renderPdf: (overrides.renderPdf as never) ?? ((tenant: string, items: never, layout: never) => renderLabelBatchPdf(tenant, items, layout)),
    resolveTemplate: (tenant: string, labelClass: never, templateId: string | null) =>
      resolveLabelTemplateForTenant(tenant, labelClass, templateId),
    getLinkedAssetParts: (context: never, subjects: ReadonlyArray<{ recordId: string; linkedAssetId?: string }>) =>
      getTicketLinkedAssetLabelParts(context, subjects),
    describeClientError: (error: unknown) =>
      error instanceof LabelRenderError
        ? { message: error.message, failures: error.failures }
        : error instanceof LabelLayoutError
          ? { message: error.message }
          : null,
  } as never;
}

/**
 * Run `fn` the way `withAuth` runs a route handler: inside the caller's tenant context. Code that reads
 * the tenant from the context (storage downloads) behaves differently without it, so tests must not omit it.
 */
export function asRequest<T>(tenant: string, fn: () => Promise<T>): Promise<T> {
  return runWithTenant(tenant, fn);
}
