import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { applyProjectTemplate } from '@alga-psa/projects/services/applyProjectTemplate';
import {
  replaceTemplateStatusMappingCore,
  countUnresolvedStatusMappings,
  TemplateStatusMappingsUnresolvedError,
} from '@alga-psa/projects/lib/projectTemplateStatusMappingResolution';
import { buildTenantProjectStatusDeletionValidation } from '@alga-psa/projects/actions/projectTaskStatusActions';

type Fixture = {
  tenantId: string;
  clientId: string;
  projectStatusId: string;
  taskStatusId: string;
  templateId: string;
};

async function createFixture(trx: Knex.Transaction): Promise<Fixture> {
  const tenantId = uuidv4();
  await trx('tenants').insert({
    tenant: tenantId,
    client_name: `Apply status fixture ${tenantId.slice(0, 8)}`,
    email: `apply-status-${tenantId.slice(0, 8)}@example.com`,
    billing_source: 'internal',
  });

  const userId = uuidv4();
  await trx('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `apply-status-user-${tenantId.slice(0, 8)}`,
    email: `apply-status-user-${tenantId.slice(0, 8)}@example.com`,
    hashed_password: 'not-used',
    user_type: 'internal',
  });

  const clientId = uuidv4();
  await trx('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    client_type: 'company',
    is_tax_exempt: false,
  });

  const projectStatusId = uuidv4();
  await trx('statuses').insert({
    tenant: tenantId,
    status_id: projectStatusId,
    name: 'Planned Project Status',
    status_type: 'project',
    item_type: 'project',
    is_closed: false,
    order_number: 1,
  });

  const taskStatusId = uuidv4();
  await trx('statuses').insert({
    tenant: tenantId,
    status_id: taskStatusId,
    name: 'Tenant Task Status',
    status_type: 'project_task',
    item_type: 'project_task',
    is_closed: false,
    order_number: 1,
  });

  const templateId = uuidv4();
  await trx('project_templates').insert({
    tenant: tenantId,
    template_id: templateId,
    template_name: `Template ${tenantId.slice(0, 8)}`,
    use_count: 0,
  });

  return { tenantId, clientId, projectStatusId, taskStatusId, templateId };
}

async function addMapping(
  trx: Knex.Transaction,
  tenantId: string,
  templateId: string,
  input: {
    status_source: 'tenant' | 'standard' | 'inline' | 'unresolved';
    status_id?: string;
    standard_status_id?: string;
    unresolved_status_id?: string;
    unresolved_reason?: 'missing' | 'ambiguous';
    custom_status_name?: string;
    display_order?: number;
  }
): Promise<string> {
  const mappingId = uuidv4();
  await trx('project_template_status_mappings').insert({
    tenant: tenantId,
    template_status_mapping_id: mappingId,
    template_id: templateId,
    status_id: input.status_id ?? null,
    standard_status_id: input.standard_status_id ?? null,
    unresolved_status_id: input.unresolved_status_id ?? null,
    unresolved_reason: input.unresolved_reason ?? null,
    status_source: input.status_source,
    custom_status_name: input.custom_status_name ?? null,
    custom_status_color: null,
    display_order: input.display_order ?? 0,
  });
  return mappingId;
}

async function applyFixture(
  trx: Knex.Transaction,
  fixture: Fixture,
  options: { copyStatuses?: boolean; copyPhases?: boolean; copyTasks?: boolean } = {}
): Promise<string> {
  return applyProjectTemplate(trx, fixture.tenantId, fixture.templateId, {
    project_name: 'Applied Project',
    client_id: fixture.clientId,
    status_id: fixture.projectStatusId,
    options: {
      copyPhases: options.copyPhases ?? false,
      copyStatuses: options.copyStatuses ?? true,
      copyTasks: options.copyTasks ?? false,
      copyDependencies: false,
      copyChecklists: false,
      copyServices: false,
      assignmentOption: 'none',
    },
  });
}

describe('applyProjectTemplate status mapping variants (integration)', () => {
  let db: Knex;

  beforeAll(async () => {
    db = await createTestDbConnection({ runSeeds: true });
  });

  afterAll(async () => {
    await db?.destroy();
  }, 120_000);

  async function withRollback(run: (trx: Knex.Transaction) => Promise<void>): Promise<void> {
    const trx = await db.transaction();
    let testError: unknown;
    try {
      await run(trx);
    } catch (error) {
      testError = error;
    } finally {
      await trx.rollback();
    }
    if (testError) {
      throw testError;
    }
  }

  it('applies a template with a standard status mapping into an exclusive standard project mapping', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      const [standardStatus] = await trx('standard_statuses')
        .where({ item_type: 'project_task' })
        .limit(1)
        .select('standard_status_id');
      await addMapping(trx, fixture.tenantId, fixture.templateId, {
        status_source: 'standard',
        standard_status_id: standardStatus.standard_status_id,
      });

      const projectId = await applyFixture(trx, fixture);

      const mapping = await trx('project_status_mappings')
        .where({ tenant: fixture.tenantId, project_id: projectId })
        .first();
      expect(mapping).toBeTruthy();
      expect(mapping.standard_status_id).toBe(standardStatus.standard_status_id);
      expect(mapping.status_id).toBeNull();
      expect(mapping.is_standard).toBe(true);
    });
  });

  it('applies a template with a custom tenant status mapping into an exclusive tenant project mapping', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      await addMapping(trx, fixture.tenantId, fixture.templateId, {
        status_source: 'tenant',
        status_id: fixture.taskStatusId,
      });

      const projectId = await applyFixture(trx, fixture);

      const mapping = await trx('project_status_mappings')
        .where({ tenant: fixture.tenantId, project_id: projectId })
        .first();
      expect(mapping).toBeTruthy();
      expect(mapping.status_id).toBe(fixture.taskStatusId);
      expect(mapping.standard_status_id).toBeNull();
      expect(mapping.is_standard).toBe(false);
    });
  });

  it('applies an inline custom mapping by creating a template-owned tenant status', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      await addMapping(trx, fixture.tenantId, fixture.templateId, {
        status_source: 'inline',
        custom_status_name: 'Inline Custom Column',
        display_order: 0,
      });

      const projectId = await applyFixture(trx, fixture);

      const createdStatus = await trx('statuses')
        .where({ tenant: fixture.tenantId, status_type: 'project_task', name: 'Inline Custom Column' })
        .first();
      expect(createdStatus).toBeTruthy();

      const mapping = await trx('project_status_mappings')
        .where({ tenant: fixture.tenantId, project_id: projectId })
        .first();
      expect(mapping.status_id).toBe(createdStatus.status_id);
      expect(mapping.standard_status_id).toBeNull();
      expect(mapping.is_standard).toBe(false);
    });
  });

  it('refuses to apply when a mapping is unresolved, before creating any project rows', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      const orphanId = uuidv4();
      await addMapping(trx, fixture.tenantId, fixture.templateId, {
        status_source: 'unresolved',
        unresolved_status_id: orphanId,
        unresolved_reason: 'missing',
      });

      await expect(applyFixture(trx, fixture)).rejects.toThrow(TemplateStatusMappingsUnresolvedError);

      const projectCount = await trx('projects').where({ tenant: fixture.tenantId }).count<{ count: string }>('* as count').first();
      expect(Number(projectCount?.count ?? 0)).toBe(0);
      const mappingCount = await trx('project_status_mappings').where({ tenant: fixture.tenantId }).count<{ count: string }>('* as count').first();
      expect(Number(mappingCount?.count ?? 0)).toBe(0);
      const phaseCount = await trx('project_phases').where({ tenant: fixture.tenantId }).count<{ count: string }>('* as count').first();
      expect(Number(phaseCount?.count ?? 0)).toBe(0);
      const taskCount = await trx('project_tasks').where({ tenant: fixture.tenantId }).count<{ count: string }>('* as count').first();
      expect(Number(taskCount?.count ?? 0)).toBe(0);
    });
  });

  it('replaces a missing mapping in place, preserving mapping identity and task assignments, then applies', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      const orphanId = uuidv4();
      const mappingId = await addMapping(trx, fixture.tenantId, fixture.templateId, {
        status_source: 'unresolved',
        unresolved_status_id: orphanId,
        unresolved_reason: 'missing',
      });

      const phaseId = uuidv4();
      await trx('project_template_phases').insert({
        tenant: fixture.tenantId,
        template_phase_id: phaseId,
        template_id: fixture.templateId,
        phase_name: 'Phase One',
        start_offset_days: 0,
      });

      const taskId = uuidv4();
      await trx('project_template_tasks').insert({
        tenant: fixture.tenantId,
        template_task_id: taskId,
        template_phase_id: phaseId,
        task_name: 'Assigned task',
        template_status_mapping_id: mappingId,
        task_type_key: 'task',
      });

      expect(await countUnresolvedStatusMappings(trx, fixture.tenantId, fixture.templateId)).toBe(1);

      const result = await replaceTemplateStatusMappingCore(trx, fixture.tenantId, fixture.templateId, mappingId, {
        type: 'tenant',
        statusId: fixture.taskStatusId,
      });

      expect(result.unresolvedStatusMappingCount).toBe(0);
      expect(result.mapping.template_status_mapping_id).toBe(mappingId);
      expect(result.mapping.statusSource).toBe('tenant');
      expect(result.mapping.status_id).toBe(fixture.taskStatusId);

      const stored = await trx('project_template_status_mappings')
        .where({ tenant: fixture.tenantId, template_status_mapping_id: mappingId })
        .first();
      expect(stored.template_id).toBe(fixture.templateId);
      expect(stored.template_phase_id).toBeNull();
      expect(stored.display_order).toBe(0);
      expect(stored.unresolved_status_id).toBeNull();
      expect(stored.status_source).toBe('tenant');

      const task = await trx('project_template_tasks').where({ tenant: fixture.tenantId, template_task_id: taskId }).first();
      expect(task.template_status_mapping_id).toBe(mappingId);

      const projectId = await applyFixture(trx, fixture, { copyPhases: true, copyTasks: true });
      const projectMapping = await trx('project_status_mappings')
        .where({ tenant: fixture.tenantId, project_id: projectId })
        .first();
      expect(projectMapping.status_id).toBe(fixture.taskStatusId);
      expect(projectMapping.is_standard).toBe(false);
    });
  });

  it('rejects replacement targets that do not exist in the chosen catalog', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      const orphanId = uuidv4();
      const mappingId = await addMapping(trx, fixture.tenantId, fixture.templateId, {
        status_source: 'unresolved',
        unresolved_status_id: orphanId,
        unresolved_reason: 'missing',
      });

      await expect(
        replaceTemplateStatusMappingCore(trx, fixture.tenantId, fixture.templateId, mappingId, {
          type: 'tenant',
          statusId: uuidv4(),
        })
      ).rejects.toThrow('Status mapping not found');

      const stored = await trx('project_template_status_mappings')
        .where({ tenant: fixture.tenantId, template_status_mapping_id: mappingId })
        .first();
      expect(stored.status_source).toBe('unresolved');
    });
  });

  it('blocks tenant status deletion while a template references it, and unblocks after replacement', async () => {
    await withRollback(async (trx) => {
      const fixture = await createFixture(trx);
      await addMapping(trx, fixture.tenantId, fixture.templateId, {
        status_source: 'tenant',
        status_id: fixture.taskStatusId,
      });

      const before = await buildTenantProjectStatusDeletionValidation(trx, fixture.tenantId, fixture.taskStatusId);
      expect(before.canDelete).toBe(false);
      expect(before.dependencies.some((dependency) => dependency.type === 'project_template')).toBe(true);

      const mappingRow = await trx('project_template_status_mappings')
        .where({ tenant: fixture.tenantId, template_id: fixture.templateId })
        .first();
      const standardStatus = await trx('standard_statuses')
        .where({ item_type: 'project_task' })
        .limit(1)
        .select('standard_status_id')
        .first();
      await replaceTemplateStatusMappingCore(trx, fixture.tenantId, fixture.templateId, mappingRow.template_status_mapping_id, {
        type: 'standard',
        standardStatusId: standardStatus.standard_status_id,
      });

      const after = await buildTenantProjectStatusDeletionValidation(trx, fixture.tenantId, fixture.taskStatusId);
      expect(after.canDelete).toBe(true);
    });
  });
});
