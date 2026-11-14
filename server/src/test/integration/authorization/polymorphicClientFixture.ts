import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import {
  compileResourceReadAuthorizationSql,
  polymorphicClientsHook,
  type AuthorizationSubject,
  type BundleNarrowingRule,
  type RelationshipSqlAdapter,
} from '@alga-psa/authorization/kernel';
import { tenantDb } from '@alga-psa/db';
import { createClient } from '../../../../test-utils/testDataFactory';

// Shared fixture for the polymorphic client-resolver tests (T004): two clients in
// one tenant, each with a parent record of every kind the tests point at, and a
// helper that runs a relationship template against a polymorphic table.

export interface ClientParents {
  clientId: string;
  contactId: string;
  ticketId: string;
  projectId: string;
  taskId: string;
  interactionId: string;
  assetId: string;
}

export interface PolymorphicFixture {
  a: ClientParents;
  b: ClientParents;
  /** A ticket in ANOTHER tenant, owned by that tenant's own client. */
  foreignTicketId: string;
  foreignClientId: string;
  foreignTenantId: string;
}

export const UNKNOWN_KIND = 'no_such_kind';

async function seedParents(
  db: Knex,
  tenant: string,
  userId: string,
  label: string,
  projectStatusId: string,
  interactionTypeId: string
): Promise<ClientParents> {
  const clientId = await createClient(db, tenant, `Polymorphic ${label}`);
  const parents: ClientParents = {
    clientId,
    contactId: randomUUID(),
    ticketId: randomUUID(),
    projectId: randomUUID(),
    taskId: randomUUID(),
    interactionId: randomUUID(),
    assetId: randomUUID(),
  };
  const phaseId = randomUUID();
  const wbs = label === 'A' ? '71' : '72';
  await db('contacts').insert({ tenant, contact_name_id: parents.contactId, full_name: `Contact ${label}`, client_id: clientId });
  await db('tickets').insert({ tenant, ticket_id: parents.ticketId, ticket_number: `T-${label}-${randomUUID().slice(0, 8)}`, client_id: clientId });
  await db('projects').insert({
    tenant, project_id: parents.projectId, project_name: `Project ${label}`, client_id: clientId,
    status: projectStatusId, wbs_code: wbs, project_number: `P-${label}-${randomUUID().slice(0, 8)}`,
  });
  await db('project_phases').insert({ tenant, phase_id: phaseId, project_id: parents.projectId, phase_name: 'Phase', status: 'open', order_number: 1, wbs_code: `${wbs}.1` });
  await db('project_tasks').insert({ tenant, task_id: parents.taskId, phase_id: phaseId, task_name: `Task ${label}`, wbs_code: `${wbs}.1.1` });
  await db('interactions').insert({ tenant, interaction_id: parents.interactionId, type_id: interactionTypeId, user_id: userId, client_id: clientId, title: `Interaction ${label}` });
  await db('assets').insert({ tenant, asset_id: parents.assetId, asset_tag: `A-${label}-${randomUUID().slice(0, 8)}`, name: `Asset ${label}`, status: 'active', client_id: clientId });
  return parents;
}

export async function seedPolymorphicFixture(db: Knex, tenant: string, userId: string): Promise<PolymorphicFixture> {
  const existing = await db('statuses').where({ tenant, status_type: 'project' }).first('status_id');
  const projectStatusId: string = existing?.status_id ?? randomUUID();
  if (!existing) {
    await db('statuses').insert({ tenant, status_id: projectStatusId, name: 'Open', status_type: 'project', order_number: 1 });
  }
  const interactionTypeId = randomUUID();
  await db('interaction_types').insert({ tenant, type_id: interactionTypeId, type_name: `Call ${interactionTypeId.slice(0, 6)}` });

  const a = await seedParents(db, tenant, userId, 'A', projectStatusId, interactionTypeId);
  const b = await seedParents(db, tenant, userId, 'B', projectStatusId, interactionTypeId);

  // A second tenant with its own client and ticket. A row of THIS tenant that
  // points at that ticket must resolve to no client.
  const foreignTenantId = randomUUID();
  await db('tenants').insert({ tenant: foreignTenantId, client_name: `Foreign ${foreignTenantId.slice(0, 6)}`, email: `foreign-${foreignTenantId.slice(0, 6)}@example.com` });
  const foreignClientId = await createClient(db, foreignTenantId, 'Foreign Client');
  const foreignTicketId = randomUUID();
  await db('tickets').insert({ tenant: foreignTenantId, ticket_id: foreignTicketId, ticket_number: `T-F-${foreignTicketId.slice(0, 8)}`, client_id: foreignClientId });

  return { a, b, foreignTicketId, foreignClientId, foreignTenantId };
}

/** Remove what `seedPolymorphicFixture` created in the foreign tenant (the base tenant is reset by TestContext). */
export async function dropForeignTenant(db: Knex, fixture: PolymorphicFixture): Promise<void> {
  await db('tickets').where({ tenant: fixture.foreignTenantId }).del();
  await db('clients').where({ tenant: fixture.foreignTenantId }).del();
  await db('tenants').where({ tenant: fixture.foreignTenantId }).del();
}

export type PolymorphicTemplate = 'client_portfolio' | 'selected_clients' | 'same_client';

/**
 * Run `template` against `table` (aliased `alias`) for `clientIds` and return the
 * value of `pk` for every row that survives, sorted.
 */
export async function polymorphicRowsAllowed(
  db: Knex,
  tenant: string,
  params: { table: string; alias: string; pk: string; template: PolymorphicTemplate; clientIds: string[] }
): Promise<string[]> {
  const adapter: RelationshipSqlAdapter = {
    applyAssignedUsers(builder) {
      builder.whereRaw('1 = 0');
    },
    applyClients: polymorphicClientsHook(params.table, params.alias),
  };
  const subject: AuthorizationSubject = {
    tenant,
    userId: randomUUID(),
    userType: params.template === 'same_client' ? 'client' : 'internal',
    teamIds: [],
    managedUserIds: [],
    portfolioClientIds: params.template === 'client_portfolio' ? params.clientIds : [],
    clientId: params.template === 'same_client' ? (params.clientIds[0] ?? null) : null,
  };
  const rule: BundleNarrowingRule = {
    id: `polymorphic-${params.template}`,
    resource: 'ticket',
    action: 'read',
    templateKey: params.template,
    selectedClientIds: params.template === 'selected_clients' ? params.clientIds : undefined,
  };
  const query = tenantDb(db, tenant).table(`${params.table} as ${params.alias}`) as unknown as Knex.QueryBuilder;
  const result = compileResourceReadAuthorizationSql(query, {
    resourceType: 'ticket',
    action: 'read',
    builtinRules: [],
    bundleRules: [rule],
    ctx: { subject, adapter },
  });
  if (!result.supported) throw new Error(`template ${params.template} did not compile: ${result.reason}`);
  const rows = await query.clearSelect().select<Array<Record<string, string>>>(`${params.alias}.${params.pk}`);
  return rows.map((row) => row[params.pk]).sort();
}
