import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { DELETION_CONFIGS, getDeletionConfig } from './index';

function makeTrx() {
  const builder = {
    where: vi.fn().mockReturnThis(),
    count: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ count: '0' }),
    select: vi.fn().mockReturnThis()
  };
  const trx = vi.fn().mockReturnValue(builder) as unknown as Knex;
  return { trx, builder };
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
    expect(builder.where).toHaveBeenCalledWith({
      tenant: 'tenant-1',
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
    expect(builder.where).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      contact_id: 'contact-1',
      user_type: 'client'
    });
  });

  it('T024: team config uses table team_members', () => {
    const memberDep = DELETION_CONFIGS.team.dependencies.find((dep) => dep.type === 'member');
    expect(memberDep?.table).toBe('team_members');
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
