import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { DELETION_CONFIGS, getDeletionConfig } from './index';

const capabilityServed = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../../lib/capability', () => ({
  isCapabilityServed: (...args: unknown[]) => (capabilityServed as any)(...args),
}));

function makeTrx() {
  const builder = {
    where: vi.fn().mockReturnThis(),
    whereNull: vi.fn().mockReturnThis(),
    whereNotIn: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ count: '0' }),
    select: vi.fn().mockReturnThis()
  };
  const trx = vi.fn().mockReturnValue(builder) as unknown as Knex;
  return { trx, builder };
}

// makeTrx()'s builder has no `join`; joined countQueries need one that records
// the join clauses so the tenant-scoping `andOn` can be asserted.
function makeJoinTrx(count = 0) {
  const joinClause = {
    on: vi.fn().mockReturnThis(),
    andOn: vi.fn().mockReturnThis()
  };
  const builder: any = {};
  builder.join = vi.fn((_table: string, callback: (this: typeof joinClause) => void) => {
    callback.call(joinClause);
    return builder;
  });
  builder.where = vi.fn().mockReturnValue(builder);
  builder.count = vi.fn().mockReturnValue(builder);
  builder.first = vi.fn().mockResolvedValue({ count: String(count) });
  const trx = vi.fn().mockReturnValue(builder) as unknown as Knex;
  return { trx, builder, joinClause };
}

describe('deletion configs', () => {
  it('T019: client config has correct foreign keys', () => {
    const config = DELETION_CONFIGS.client;
    const deps = Object.fromEntries(config.dependencies.map((dep) => [dep.type, dep]));

    expect(deps.contact.foreignKey).toBe('client_id');
    expect(deps.ticket.foreignKey).toBe('client_id');
    expect(deps.project.foreignKey).toBe('client_id');
    expect(deps.invoice.foreignKey).toBe('client_id');
    expect(deps.interaction.foreignKey).toBe('client_id');
    expect(deps.asset.foreignKey).toBe('client_id');
    expect(deps.usage.foreignKey).toBe('client_id');
    expect(deps.bucket_usage.foreignKey).toBe('client_id');
  });

  it('T020: client config uses custom countQuery for document associations', async () => {
    const documentDep = DELETION_CONFIGS.client.dependencies.find((dep) => dep.type === 'document');
    expect(documentDep?.countQuery).toBeDefined();

    const { trx, builder } = makeTrx();
    await documentDep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'client-1' });

    expect(trx).toHaveBeenCalledWith('document_associations');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'document_associations.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenNthCalledWith(2, {
      entity_id: 'client-1',
      entity_type: 'company'
    });
  });

  it('T021: client config supports inactive and tagEntityType=client', () => {
    const config = DELETION_CONFIGS.client;

    expect(config.supportsInactive).toBe(true);
    expect(config.tagEntityType).toBe('client');
  });

  it('T022: contact config has correct foreign keys', () => {
    const config = DELETION_CONFIGS.contact;
    const deps = Object.fromEntries(config.dependencies.map((dep) => [dep.type, dep]));

    expect(deps.ticket.foreignKey).toBe('contact_name_id');
    expect(deps.interaction.foreignKey).toBe('contact_name_id');
  });

  it('T023: contact config uses custom countQuery for portal users', async () => {
    const portalDep = DELETION_CONFIGS.contact.dependencies.find((dep) => dep.type === 'portal_user');
    expect(portalDep?.countQuery).toBeDefined();

    const { trx, builder } = makeTrx();
    await portalDep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'contact-1' });

    expect(trx).toHaveBeenCalledWith('users');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'users.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenNthCalledWith(2, {
      contact_id: 'contact-1',
      user_type: 'client'
    });
  });

  it('T024: team config does not block on team_members', () => {
    // teams.manager_id is NOT NULL and the lead is always also a team_members row, so a
    // member blocker made every team undeletable. Team.delete clears the members itself.
    const memberDep = DELETION_CONFIGS.team.dependencies.find((dep) => dep.type === 'member');
    expect(memberDep).toBeUndefined();
    expect(DELETION_CONFIGS.team.dependencies.some((dep) => dep.table === 'team_members')).toBe(false);
  });

  it('T024b: team config keeps the real assignment blockers', () => {
    const deps = Object.fromEntries(DELETION_CONFIGS.team.dependencies.map((dep) => [dep.type, dep]));

    expect(deps.ticket).toMatchObject({ table: 'tickets', foreignKey: 'assigned_team_id' });
    expect(deps.project_task).toMatchObject({ table: 'project_tasks', foreignKey: 'assigned_team_id' });
    expect(deps.project_template_task).toMatchObject({ table: 'project_template_tasks', foreignKey: 'assigned_team_id' });
    expect(deps.board).toMatchObject({ table: 'boards', foreignKey: 'default_assigned_team_id' });
  });

  it('T025: user config uses table schedule_entry_assignees', () => {
    const scheduleDep = DELETION_CONFIGS.user.dependencies.find((dep) => dep.type === 'schedule_assignee');
    expect(scheduleDep?.table).toBe('schedule_entry_assignees');
  });

  it('T026: contract line config uses foreignKey contract_line_id on usage_tracking', () => {
    const usageDep = DELETION_CONFIGS.contract_line.dependencies.find((dep) => dep.type === 'usage');
    expect(usageDep?.foreignKey).toBe('contract_line_id');
  });

  it('T027: tax rate config uses table client_tax_rates', () => {
    const taxDep = DELETION_CONFIGS.tax_rate.dependencies.find((dep) => dep.type === 'client_tax_rate');
    expect(taxDep?.table).toBe('client_tax_rates');
  });

  it('T028: board config includes categories.board_id dependency', () => {
    const categoryDep = DELETION_CONFIGS.board.dependencies.find((dep) => dep.type === 'category');
    expect(categoryDep?.table).toBe('categories');
    expect(categoryDep?.foreignKey).toBe('board_id');
  });

  it('board config blocks on every reference deleteBoard refuses to cascade', () => {
    const deps = Object.fromEntries(DELETION_CONFIGS.board.dependencies.map((dep) => [dep.type, dep]));

    expect(deps.inbound_ticket_default).toMatchObject({
      table: 'inbound_ticket_defaults',
      foreignKey: 'board_id',
      label: 'inbound email default'
    });
    expect(deps.ticket_template).toMatchObject({
      table: 'ticket_templates',
      foreignKey: 'board_id',
      label: 'ticket template'
    });
    expect(deps.recurring_ticket_definition).toMatchObject({
      table: 'recurring_ticket_definitions',
      label: 'recurring ticket schedule'
    });
    expect(deps.checklist_apply_rule).toMatchObject({
      table: 'checklist_template_apply_rules',
      countQuery: expect.any(Function),
      label: 'checklist apply rule'
    });
    // A board-scoped canned response cannot give up its board_id (the
    // scope_target_check requires it), so it has to block too.
    expect(deps.canned_response).toMatchObject({
      table: 'canned_responses',
      foreignKey: 'board_id',
      label: 'board canned response'
    });
    // None of them opt out of blocking.
    for (const dep of DELETION_CONFIGS.board.dependencies) {
      expect(dep.blocking).not.toBe(false);
    }
  });

  it('board email_sender_route dependency counts only the board route type', async () => {
    const routeDep = DELETION_CONFIGS.board.dependencies.find((dep) => dep.type === 'email_sender_route');
    expect(routeDep?.table).toBe('email_sender_routes');
    expect(routeDep?.label).toBe('outbound sender route');
    expect(routeDep?.countQuery).toBeDefined();

    const { trx, builder } = makeTrx();
    await routeDep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'board-1' });

    expect(trx).toHaveBeenCalledWith('email_sender_routes');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'email_sender_routes.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenNthCalledWith(2, {
      route_type: 'board',
      board_id: 'board-1'
    });
  });

  it('board recurring_ticket_definition dependency ignores archived schedules', async () => {
    const recurringDep = DELETION_CONFIGS.board.dependencies.find(
      (dep) => dep.type === 'recurring_ticket_definition'
    );
    expect(recurringDep?.table).toBe('recurring_ticket_definitions');
    expect(recurringDep?.label).toBe('recurring ticket schedule');
    // Must be a countQuery, not a plain foreignKey count: archived definitions
    // are read-only forever, so blocking on one would strand the board.
    expect(recurringDep?.foreignKey).toBeUndefined();
    expect(recurringDep?.countQuery).toBeDefined();

    const { trx, builder } = makeTrx();
    await recurringDep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'board-1' });

    expect(trx).toHaveBeenCalledWith('recurring_ticket_definitions');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'recurring_ticket_definitions.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenNthCalledWith(2, { board_id: 'board-1' });
    expect(builder.whereNull).toHaveBeenCalledWith('archived_at');
  });

  it('ticket config includes schedule_entry dependency with polymorphic countQuery', async () => {
    const scheduleDep = DELETION_CONFIGS.ticket.dependencies.find((dep) => dep.type === 'schedule_entry');
    expect(scheduleDep).toBeDefined();
    expect(scheduleDep?.table).toBe('schedule_entries');
    expect(scheduleDep?.countQuery).toBeDefined();

    const { trx, builder } = makeTrx();
    await scheduleDep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'ticket-1' });

    expect(trx).toHaveBeenCalledWith('schedule_entries');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'schedule_entries.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenNthCalledWith(2, {
      work_item_id: 'ticket-1',
      work_item_type: 'ticket'
    });
  });

  it('project config includes schedule_entry dependency for project tasks', () => {
    const scheduleDep = DELETION_CONFIGS.project.dependencies.find((dep) => dep.type === 'schedule_entry');
    expect(scheduleDep).toBeDefined();
    expect(scheduleDep?.table).toBe('schedule_entries');
    expect(scheduleDep?.countQuery).toBeDefined();
  });

  it('ticket config includes ticket_material blocker', () => {
    const dep = DELETION_CONFIGS.ticket.dependencies.find((d) => d.type === 'ticket_material');
    expect(dep).toBeDefined();
    expect(dep?.table).toBe('ticket_materials');
    expect(dep?.foreignKey).toBe('ticket_id');
  });

  it('project config includes project_material blocker', () => {
    const dep = DELETION_CONFIGS.project.dependencies.find((d) => d.type === 'project_material');
    expect(dep).toBeDefined();
    expect(dep?.table).toBe('project_materials');
    expect(dep?.foreignKey).toBe('project_id');
  });

  it('client config includes material blockers', () => {
    const deps = Object.fromEntries(DELETION_CONFIGS.client.dependencies.map((d) => [d.type, d]));
    expect(deps.ticket_material.foreignKey).toBe('client_id');
    expect(deps.project_material.foreignKey).toBe('client_id');
  });

  it('service config includes material blockers', () => {
    const deps = Object.fromEntries(DELETION_CONFIGS.service.dependencies.map((d) => [d.type, d]));
    expect(deps.ticket_material.foreignKey).toBe('service_id');
    expect(deps.project_material.foreignKey).toBe('service_id');
  });

  it('asset_association blocker uses polymorphic countQuery per entity', async () => {
    for (const [entityType, entityKey] of [['client', 'client'], ['contact', 'contact'], ['ticket', 'ticket'], ['project', 'project']] as const) {
      const dep = DELETION_CONFIGS[entityKey].dependencies.find((d) => d.type === 'asset_association');
      expect(dep, `${entityKey} should have asset_association dep`).toBeDefined();
      expect(dep?.table).toBe('asset_associations');
      expect(dep?.countQuery).toBeDefined();

      const { trx, builder } = makeTrx();
      await dep?.countQuery?.(trx, { tenant: 't', entityId: 'id-1' });
      expect(trx).toHaveBeenCalledWith('asset_associations');
      expect(builder.where).toHaveBeenNthCalledWith(1, 'asset_associations.tenant', 't');
      expect(builder.where).toHaveBeenNthCalledWith(2, {
        entity_id: 'id-1',
        entity_type: entityType
      });
    }
  });

  it('ticket_entity_link blocker on project', async () => {
    const dep = DELETION_CONFIGS.project.dependencies.find((d) => d.type === 'ticket_entity_link');
    expect(dep, 'project should have ticket_entity_link dep').toBeDefined();
    expect(dep?.table).toBe('ticket_entity_links');
    expect(dep?.countQuery).toBeDefined();

    const { trx, builder } = makeTrx();
    await dep?.countQuery?.(trx, { tenant: 't', entityId: 'id-1' });
    expect(trx).toHaveBeenCalledWith('ticket_entity_links');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'ticket_entity_links.tenant', 't');
    expect(builder.where).toHaveBeenNthCalledWith(2, {
      entity_id: 'id-1',
      entity_type: 'project'
    });
  });

  it('T031: tax rate config exposes composite_tax_mapping dependency with a countQuery', () => {
    const dep = DELETION_CONFIGS.tax_rate.dependencies.find((d) => d.type === 'composite_tax_mapping');

    expect(dep, 'tax_rate should have composite_tax_mapping dep').toBeDefined();
    expect(dep?.table).toBe('composite_tax_mappings');
    expect(dep?.label).toBe('composite tax mapping');
    // Indirect relationship (tax_rates -> tax_components -> composite_tax_mappings),
    // so it must not degrade to a plain foreignKey count.
    expect(dep?.foreignKey).toBeUndefined();
    expect(dep?.countQuery).toBeDefined();
  });

  it('T032: composite_tax_mapping countQuery joins through tax_components and is tenant-scoped', async () => {
    const dep = DELETION_CONFIGS.tax_rate.dependencies.find((d) => d.type === 'composite_tax_mapping');
    const { trx, builder, joinClause } = makeJoinTrx(2);

    const count = await dep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'rate-a' });

    expect(trx).toHaveBeenCalledWith('composite_tax_mappings as ctm');
    expect(builder.join).toHaveBeenCalledTimes(2);
    expect(builder.join.mock.calls[0][0]).toBe('tax_components as tc');
    expect(builder.join.mock.calls[1][0]).toBe('tax_rates as owner');
    expect(joinClause.on).toHaveBeenCalledWith('tc.tax_component_id', '=', 'ctm.tax_component_id');
    expect(joinClause.on).toHaveBeenCalledWith('owner.tax_rate_id', '=', 'ctm.composite_tax_id');
    // composite_tax_mappings has no tenant column of its own, so the owning
    // composite rate is pinned to the component's tenant.
    expect(joinClause.andOn).toHaveBeenCalledWith('owner.tenant', '=', 'tc.tenant');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'tc.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenNthCalledWith(2, { 'tc.tax_rate_id': 'rate-a' });
    expect(count).toBe(2);
  });

  it('T033: composite_tax_mapping countQuery excludes mappings owned by the rate being deleted', async () => {
    const dep = DELETION_CONFIGS.tax_rate.dependencies.find((d) => d.type === 'composite_tax_mapping');
    const { trx, builder } = makeJoinTrx(0);

    await dep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'rate-a' });

    // Without this exclusion a composite rate that maps its own components
    // would block its own deletion — those mappings are cascaded by deleteTaxRate.
    expect(builder.where).toHaveBeenCalledWith('ctm.composite_tax_id', '!=', 'rate-a');
  });

  it('blocks client deletion while a co-managed setup still holds an unreleased allocation', async () => {
    const dep = DELETION_CONFIGS.client.dependencies.find((d) => d.type === 'co_managed_workspace');
    const { trx, builder, joinClause } = makeJoinTrx(2);
    (trx as any).schema = { hasTable: vi.fn().mockResolvedValue(true) };
    builder.whereRaw = vi.fn().mockReturnValue(builder);
    builder.whereNot = vi.fn().mockReturnValue(builder);

    expect(await dep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'client-a' })).toBe(2);
    expect(builder.whereNot).toHaveBeenCalledWith('co_managed_allocations.state', 'released');
    expect(joinClause.andOn).toHaveBeenCalledWith('co_managed_allocations.tenant', 'co_managed_provisioning_operations.tenant');
  });

  it('blocks board deletion while it is a live escalation queue or a live shared scope', async () => {
    const types = DELETION_CONFIGS.board.dependencies.map((d) => d.type);
    expect(types).toEqual(expect.arrayContaining(['co_managed_board_scope', 'co_managed_escalation']));

    const dep = DELETION_CONFIGS.board.dependencies.find((d) => d.type === 'co_managed_escalation');
    const { trx, builder } = makeJoinTrx(1);
    (trx as any).schema = { hasTable: vi.fn().mockResolvedValue(true) };
    builder.whereNot = vi.fn().mockReturnValue(builder);
    expect(await dep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'board-a' })).toBe(1);
    expect(builder.where).toHaveBeenCalledWith('co_managed_provisioning_operations.escalation_board_id', 'board-a');
  });

  it('issues no co-managed statement for a tenant that does not participate', async () => {
    capabilityServed.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    const { trx } = makeJoinTrx(1);
    (trx as any).schema = { hasTable: vi.fn().mockResolvedValue(true) };
    for (const type of ['co_managed_escalation', 'co_managed_board_scope']) {
      const dep = DELETION_CONFIGS.board.dependencies.find((d) => d.type === type);
      expect(await dep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'board-a' })).toBe(0);
    }
    expect((trx as any).schema.hasTable).not.toHaveBeenCalled();
    expect(trx).not.toHaveBeenCalled();
  });

  it('allows deletion checks before the co-managed tables exist', async () => {
    const { trx } = makeJoinTrx(0);
    (trx as any).schema = { hasTable: vi.fn().mockResolvedValue(false) };
    for (const [entity, type] of [['client', 'co_managed_workspace'], ['board', 'co_managed_escalation'],
      ['board', 'co_managed_board_scope']] as const) {
      const dep = DELETION_CONFIGS[entity].dependencies.find(d => d.type === type);
      expect(await dep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'entity-1' })).toBe(0);
    }
    expect(trx).not.toHaveBeenCalled();
  });

  it('asset config has no blocking dependencies (cascaded by deleteAsset)', () => {
    // Maintenance schedules and ticket-entity links are cascaded inside
    // deleteAsset rather than blocking deletion validation.
    expect(DELETION_CONFIGS.asset.dependencies).toEqual([]);
  });

  it('quote activity dependency ignores created/updated rows so edited drafts stay deletable', async () => {
    const dep = DELETION_CONFIGS.quote.dependencies.find((d) => d.type === 'quote_activity');
    const { trx, builder } = makeTrx();

    await dep?.countQuery?.(trx, { tenant: 'tenant-1', entityId: 'quote-1' });

    // Every save writes an 'updated' activity; counting it made any edited
    // draft permanently undeletable (silently, from the quotes list).
    expect(trx).toHaveBeenCalledWith('quote_activities');
    expect(builder.where).toHaveBeenNthCalledWith(1, 'quote_activities.tenant', 'tenant-1');
    expect(builder.where).toHaveBeenNthCalledWith(2, { quote_id: 'quote-1' });
    expect(builder.whereNotIn).toHaveBeenCalledWith('activity_type', ['created', 'updated']);
  });
});

describe('getDeletionConfig', () => {
  it('T029: returns correct config for known entity types', () => {
    const config = getDeletionConfig('client');

    expect(config).toBe(DELETION_CONFIGS.client);
  });

  it('T030: returns undefined for unknown entity type', () => {
    expect(getDeletionConfig('not_real')).toBeUndefined();
  });
});
