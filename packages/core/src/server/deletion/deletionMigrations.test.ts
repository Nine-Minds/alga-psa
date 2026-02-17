import type { Knex } from 'knex';
import { describe, expect, it, vi } from 'vitest';
import { DELETION_CONFIGS } from '../../config/deletion';
import { validateDeletion } from './deletionValidation';

/**
 * Build a mock knex/transaction that returns the given count for each
 * successive dependency query.  When `countsByTable` is provided the mock
 * returns a specific count per table name; otherwise it returns `defaultCount`
 * for every query.
 */
function makeTrx(
  defaultCount = 0,
  countsByTable?: Record<string, number>
) {
  function makeBuilder(count: number) {
    const b: Record<string, ReturnType<typeof vi.fn>> = {};
    b.where = vi.fn().mockReturnValue(b);
    b.andWhere = vi.fn().mockReturnValue(b);
    b.orWhere = vi.fn().mockReturnValue(b);
    b.whereIn = vi.fn().mockReturnValue(b);
    b.count = vi.fn().mockReturnValue(b);
    b.join = vi.fn().mockReturnValue(b);
    b.pluck = vi.fn().mockResolvedValue([]);
    b.first = vi.fn().mockResolvedValue({ count: String(count) });
    return b;
  }

  const builder = makeBuilder(defaultCount);

  const trx = vi.fn((table: string) => {
    if (countsByTable && table in countsByTable) {
      return makeBuilder(countsByTable[table]);
    }
    return makeBuilder(defaultCount);
  }) as unknown as Knex;

  return { trx, builder };
}

describe('DELETION_CONFIGS completeness', () => {
  const entityTypes = Object.keys(DELETION_CONFIGS);

  it('every config has a matching entityType field', () => {
    for (const key of entityTypes) {
      expect(DELETION_CONFIGS[key].entityType).toBe(key);
    }
  });

  it('every dependency has a table and either foreignKey or countQuery', () => {
    for (const key of entityTypes) {
      for (const dep of DELETION_CONFIGS[key].dependencies) {
        expect(dep.table).toBeTruthy();
        const hasFk = !!dep.foreignKey;
        const hasQuery = !!dep.countQuery;
        expect(hasFk || hasQuery).toBe(true);
      }
    }
  });

  it('every dependency has a non-empty label', () => {
    for (const key of entityTypes) {
      for (const dep of DELETION_CONFIGS[key].dependencies) {
        expect(dep.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('no duplicate dependency types within a config', () => {
    for (const key of entityTypes) {
      const types = DELETION_CONFIGS[key].dependencies.map((d) => d.type);
      expect(new Set(types).size).toBe(types.length);
    }
  });
});

describe('ticket deletion blocks on time entries', () => {
  it('canDelete is false when ticket has time entries', async () => {
    const { trx } = makeTrx(0, { time_entries: 3 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.ticket,
      'ticket-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    const timeDep = result.dependencies.find((d) => d.type === 'time_entry');
    expect(timeDep).toBeDefined();
    expect(timeDep!.count).toBe(3);
  });

  it('comments do not block ticket deletion (cleaned up during delete)', async () => {
    const { trx } = makeTrx(0, { comments: 5 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.ticket,
      'ticket-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(true);
    expect(result.dependencies.find((d) => d.type === 'comment')).toBeUndefined();
  });

  it('offers archive alternative when blocked', async () => {
    const { trx } = makeTrx(1);

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.ticket,
      'ticket-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    expect(result.alternatives.some((a) => a.action === 'archive')).toBe(true);
  });

  it('allows deletion when ticket has no dependencies', async () => {
    const { trx } = makeTrx(0);

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.ticket,
      'ticket-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(true);
  });
});

describe('client deletion blocks on surveys', () => {
  it('canDelete is false when client has survey invitations', async () => {
    const { trx } = makeTrx(0, { survey_invitations: 2 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.client,
      'client-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    expect(result.dependencies.find((d) => d.type === 'survey_invitation')).toBeDefined();
  });

  it('offers deactivate alternative when blocked', async () => {
    const { trx } = makeTrx(1);

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.client,
      'client-1',
      'tenant-1'
    );

    expect(result.alternatives.some((a) => a.action === 'deactivate')).toBe(true);
  });
});

describe('contact deletion blocks on surveys and portal users', () => {
  it('canDelete is false when contact has survey invitations', async () => {
    const { trx } = makeTrx(0, { survey_invitations: 1 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.contact,
      'contact-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    expect(result.dependencies.find((d) => d.type === 'survey_invitation')).toBeDefined();
  });

  it('comments and portal invitations are cleaned up, not blockers', async () => {
    const { trx } = makeTrx(0, { comments: 5, portal_invitations: 2 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.contact,
      'contact-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(true);
    expect(result.dependencies.find((d) => d.type === 'comment')).toBeUndefined();
    expect(result.dependencies.find((d) => d.type === 'portal_invitation')).toBeUndefined();
  });
});

describe('project deletion blocks on interactions', () => {
  it('canDelete is false when project has interactions', async () => {
    const { trx } = makeTrx(0, { interactions: 1 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.project,
      'project-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    expect(result.dependencies.find((d) => d.type === 'interaction')).toBeDefined();
  });

  it('phases, ticket links, email reply tokens are cleaned up, not blockers', async () => {
    const { trx } = makeTrx(0, { project_phases: 3, project_ticket_links: 2, email_reply_tokens: 1 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.project,
      'project-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(true);
  });

  it('offers archive alternative when blocked', async () => {
    const { trx } = makeTrx(0, { interactions: 1 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.project,
      'project-1',
      'tenant-1'
    );

    expect(result.alternatives.some((a) => a.action === 'archive')).toBe(true);
  });
});

describe('tax_rate deletion blocks on usage references', () => {
  it('canDelete is false when tax rate is assigned to clients', async () => {
    const { trx } = makeTrx(0, { client_tax_rates: 2 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.tax_rate,
      'rate-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    expect(result.dependencies.find((d) => d.type === 'client_tax_rate')).toBeDefined();
  });

  it('components, mappings, holidays, thresholds are cleaned up, not blockers', async () => {
    const { trx } = makeTrx(0, { tax_components: 3, composite_tax_mappings: 1, tax_holidays: 2, tax_rate_thresholds: 1 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.tax_rate,
      'rate-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(true);
  });
});

describe('role deletion blocks on user assignments', () => {
  it('canDelete is false when role has user assignments', async () => {
    const { trx } = makeTrx(0, { user_roles: 5 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.role,
      'role-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    expect(result.dependencies.find((d) => d.type === 'user')?.count).toBe(5);
  });

  it('permissions are cleaned up, not blockers', async () => {
    const { trx } = makeTrx(0, { role_permissions: 10 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.role,
      'role-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(true);
  });
});

describe('invoice_template deletion blocks on invoices and clients', () => {
  it('canDelete is false when template has invoices', async () => {
    const { trx } = makeTrx(0, { invoices: 4 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.invoice_template,
      'tpl-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    expect(result.dependencies.find((d) => d.type === 'invoice')?.count).toBe(4);
  });

  it('template sections are cleaned up, not blockers', async () => {
    const { trx } = makeTrx(0, { template_sections: 10 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.invoice_template,
      'tpl-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(true);
  });
});

describe('asset deletion blocks on maintenance schedules', () => {
  it('canDelete is false when asset has maintenance schedules', async () => {
    const { trx } = makeTrx(0, { asset_maintenance_schedules: 2 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.asset,
      'asset-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(false);
    expect(result.dependencies.find((d) => d.type === 'maintenance_schedule')?.count).toBe(2);
  });

  it('history, import mappings, and import job items are cleaned up, not blockers', async () => {
    const { trx } = makeTrx(0, { asset_history: 10, external_entity_mappings: 3, import_job_items: 1 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.asset,
      'asset-1',
      'tenant-1'
    );

    expect(result.canDelete).toBe(true);
  });

  it('offers deactivate alternative when blocked', async () => {
    const { trx } = makeTrx(0, { asset_maintenance_schedules: 1 });

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.asset,
      'asset-1',
      'tenant-1'
    );

    expect(result.alternatives.some((a) => a.action === 'deactivate')).toBe(true);
  });
});

describe('schedule_entry and workflow have no blocking dependencies', () => {
  it('schedule_entry has empty dependencies (conflicts cleaned up during delete)', () => {
    expect(DELETION_CONFIGS.schedule_entry.dependencies).toHaveLength(0);
  });

  it('workflow has empty dependencies (versions cleaned up during delete)', () => {
    expect(DELETION_CONFIGS.workflow.dependencies).toHaveLength(0);
  });
});

describe('message formatting', () => {
  it('includes all dependency labels in the block message', async () => {
    const { trx } = makeTrx(1);

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.ticket,
      'ticket-1',
      'tenant-1'
    );

    expect(result.message).toContain('time entry');
    expect(result.message).toContain('schedule entry');
    expect(result.message).toContain('interaction');
  });

  it('pluralizes labels for counts > 1', async () => {
    const { trx } = makeTrx(3);

    const result = await validateDeletion(
      trx,
      DELETION_CONFIGS.client,
      'client-1',
      'tenant-1'
    );

    expect(result.message).toContain('contacts');
    expect(result.message).toContain('tickets');
  });
});
