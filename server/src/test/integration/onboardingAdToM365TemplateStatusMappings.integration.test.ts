import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  assertTemplateMappingsResolved,
  resolveTemplateStatusMappings,
} from '@alga-psa/projects/lib/projectTemplateStatusMappingResolution';
import { applyProjectTemplate } from '@alga-psa/projects/services/applyProjectTemplate';

const TEMPLATE_NAME = 'Active Directory to Microsoft 365 Migration';
const STATUS_NAMES = ['To Do', 'In Progress', 'Blocked', 'Done'] as const;

const require = createRequire(import.meta.url);
const seed06 = require('../../../../ee/server/seeds/onboarding/psa/06_project_task_statuses.cjs') as {
  seed: (knex: Knex | Knex.Transaction, tenantId: string) => Promise<void>;
};
const seed07 = require('../../../../ee/server/seeds/onboarding/psa/07_ad_to_m365_project_template.cjs') as {
  seed: (knex: Knex | Knex.Transaction, tenantId: string) => Promise<void>;
};

interface ApplyFixture {
  tenantId: string;
  clientId: string;
  projectStatusId: string;
}

async function createTenant(knex: Knex | Knex.Transaction): Promise<string> {
  const tenantId = uuidv4();
  await knex('tenants').insert({
    tenant: tenantId,
    client_name: `Onboarding status mappings ${tenantId.slice(0, 8)}`,
    email: `onboard-status-${tenantId.slice(0, 8)}@example.com`,
    billing_source: 'internal',
  });
  return tenantId;
}

async function createApplyFixture(
  knex: Knex | Knex.Transaction,
  tenantId: string,
): Promise<ApplyFixture> {
  await knex('users').insert({
    tenant: tenantId,
    user_id: uuidv4(),
    username: `onboard-apply-${tenantId.slice(0, 8)}`,
    email: `onboard-apply-${tenantId.slice(0, 8)}@example.com`,
    hashed_password: 'not-used',
    user_type: 'internal',
  });

  const clientId = uuidv4();
  await knex('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    client_type: 'company',
    is_tax_exempt: false,
  });

  const projectStatusId = uuidv4();
  await knex('statuses').insert({
    tenant: tenantId,
    status_id: projectStatusId,
    name: 'Planned Project Status',
    status_type: 'project',
    item_type: 'project',
    is_closed: false,
    order_number: 1,
  });

  return { tenantId, clientId, projectStatusId };
}

/**
 * Run onboarding seed 06 (project-task statuses) then seed 07 (the AD-to-M365
 * template) exactly as new-tenant provisioning does, and return the template id.
 */
async function runSeed06ThenSeed07(
  knex: Knex | Knex.Transaction,
  tenantId: string,
): Promise<string> {
  await seed06.seed(knex, tenantId);
  await seed07.seed(knex, tenantId);

  const template = await knex('project_templates')
    .where({ tenant: tenantId, template_name: TEMPLATE_NAME })
    .first();
  expect(template).toBeTruthy();
  return template.template_id;
}

async function loadTemplateMappings(
  knex: Knex | Knex.Transaction,
  tenantId: string,
  templateId: string,
) {
  return knex('project_template_status_mappings')
    .where({ tenant: tenantId, template_id: templateId })
    .orderBy('display_order');
}

async function taskStatusesOf(knex: Knex | Knex.Transaction, tenantId: string) {
  return knex('statuses')
    .where({ tenant: tenantId, status_type: 'project_task' })
    .select('status_id', 'name');
}

describe.sequential(
  'new-tenant AD-to-M365 template status mappings against the typed schema (real DB)',
  () => {
    let db: Knex;

    beforeAll(async () => {
      db = await createTestDbConnection({ runSeeds: false });
    });

    afterAll(async () => {
      await db?.destroy();
    }, 120_000);

    async function withRollback(
      run: (trx: Knex.Transaction) => Promise<void>,
    ): Promise<void> {
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

    it('T001: seeds 06+07 write exactly four typed tenant mappings for To Do, In Progress, Blocked, Done', async () => {
      await withRollback(async (trx) => {
        const tenantId = await createTenant(trx);
        const templateId = await runSeed06ThenSeed07(trx, tenantId);

        const mappings = await loadTemplateMappings(trx, tenantId, templateId);
        expect(mappings).toHaveLength(4);
        expect(mappings.map((mapping) => mapping.status_source)).toEqual(
          ['tenant', 'tenant', 'tenant', 'tenant'],
        );

        for (const mapping of mappings) {
          expect(mapping.status_id).toBeTruthy();
          expect(mapping.standard_status_id).toBeNull();
          expect(mapping.unresolved_status_id).toBeNull();
        }

        const statuses = await taskStatusesOf(trx, tenantId);
        expect(statuses).toHaveLength(4);
        expect(new Set(statuses.map((status) => status.name))).toEqual(
          new Set(STATUS_NAMES),
        );
        const nameByStatusId = new Map(statuses.map((status) => [status.status_id, status.name]));

        for (const mapping of mappings) {
          expect(nameByStatusId.has(mapping.status_id)).toBe(true);
          expect(STATUS_NAMES).toContain(nameByStatusId.get(mapping.status_id));
        }
      });
    });

    it('T002: seed 07 never binds a mapping to an identically named status in another tenant', async () => {
      await withRollback(async (trx) => {
        const targetTenant = await createTenant(trx);
        const otherTenant = await createTenant(trx);

        for (const [index, name] of STATUS_NAMES.entries()) {
          await trx('statuses').insert({
            tenant: otherTenant,
            status_id: uuidv4(),
            name,
            status_type: 'project_task',
            item_type: 'project_task',
            is_closed: name === 'Done',
            order_number: index + 1,
          });
        }
        const otherStatusIds = new Set(
          await trx('statuses')
            .where({ tenant: otherTenant, status_type: 'project_task' })
            .pluck('status_id'),
        );
        expect(otherStatusIds.size).toBe(4);

        const templateId = await runSeed06ThenSeed07(trx, targetTenant);
        const mappings = await loadTemplateMappings(trx, targetTenant, templateId);
        expect(mappings).toHaveLength(4);

        const targetStatusIds = new Set(
          (await taskStatusesOf(trx, targetTenant)).map((status) => status.status_id),
        );
        expect(targetStatusIds.size).toBe(4);

        for (const mapping of mappings) {
          expect(otherStatusIds.has(mapping.status_id)).toBe(false);
          expect(targetStatusIds.has(mapping.status_id)).toBe(true);
        }
      });
    });

    it('T003: the seeded template resolves through the production resolver and applies to a tenant-backed project', async () => {
      await withRollback(async (trx) => {
        const tenantId = await createTenant(trx);
        const fixture = await createApplyFixture(trx, tenantId);
        const templateId = await runSeed06ThenSeed07(trx, tenantId);

        const mappings = await loadTemplateMappings(trx, tenantId, templateId);
        expect(mappings).toHaveLength(4);

        const resolved = await resolveTemplateStatusMappings(trx, tenantId, mappings);
        expect(resolved.every((mapping) => mapping.source === 'tenant')).toBe(true);
        expect(
          resolved
            .map((mapping) => (mapping.source === 'tenant' ? mapping.name : ''))
            .sort(),
        ).toEqual([...STATUS_NAMES].sort());
        expect(() => assertTemplateMappingsResolved(templateId, resolved)).not.toThrow();

        const projectId = await applyProjectTemplate(
          trx,
          tenantId,
          templateId,
          {
            project_name: 'Applied AD to M365 Migration',
            client_id: fixture.clientId,
            status_id: fixture.projectStatusId,
            options: {
              copyPhases: true,
              copyStatuses: true,
              copyTasks: true,
              copyDependencies: false,
              copyChecklists: true,
              copyServices: false,
              assignmentOption: 'none',
            },
          },
        );

        const projectMappings = await trx('project_status_mappings')
          .where({ tenant: tenantId, project_id: projectId })
          .orderBy('display_order');
        expect(projectMappings).toHaveLength(4);

        const tenantTaskStatusIds = new Set(
          (await taskStatusesOf(trx, tenantId)).map((status) => status.status_id),
        );
        for (const mapping of projectMappings) {
          expect(mapping.is_standard).toBe(false);
          expect(mapping.standard_status_id).toBeNull();
          expect(mapping.status_id).toBeTruthy();
          expect(tenantTaskStatusIds.has(mapping.status_id)).toBe(true);
        }
      });
    });
  },
);
